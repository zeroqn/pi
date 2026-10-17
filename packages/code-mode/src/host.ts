/** The host functions the sandbox reaches the host with: `bash_host`, `find`, `grep`,
 * `read_image` — plus whatever the contribution ledger merged in (`extra`).
 *
 * The base functions are code mode's (ticket 03) and the background names are its own as well;
 * everything else is contributed. **`grep` and `find` ask the session's engine first** and fall back to
 * rg/fd when there is none or it throws (`fff-search` ticket 05): the two names, the normalized query
 * and the returned shapes stay code mode's, so the engines are interchangeable behind them. **Both halves pass the session's guard** before they run
 * (`readonly-guard` ticket 02): the guard's question is "may this call run", not "is this call
 * yours", so a policy that has to hold for a session cannot be routed around by contributing a
 * name of one's own.
 *
 * (There used to be an `onHostCall` observer here, invoked from `bash_host` alone. It was deleted
 * for having no claimant — see `../rsi-oneway` ticket 09 — and a *guard* is not its return: that
 * was a notification with no veto, and this is a decision that runs before the call.)
 */
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { run, spill, truncate, type RunRegistry } from "./output";
import { SHELL } from "./shell";
import { bool, num, str } from "./util";
import {
	abortReason,
	aborted,
	type Egress,
	type Fence,
	type FindQuery,
	type GrepQuery,
	type Guard,
	type Match,
	refusal,
	type SearchEngine,
} from "./contract";

/** The shapes the primitives ask their engines in, re-exported so a consumer can name them here. */
export type { FindQuery, GrepQuery, Match, SearchEngine };
import type { createBackgroundManager } from "./background";
import type { HostFns } from "./journal";

/** `grep` is ripgrep when the host has it and GNU grep when it has not: the primitive is "search
 * the files", not "call one engine", so the first one on PATH answers and the other catches the
 * host that lacks it. The two want different flags, so the kind travels beside the path. */
const RG = onPath("rg");
const GREP_KIND: "rg" | "grep" = RG ? "rg" : "grep";
const GREP = RG ?? onPath("grep") ?? "grep";

/** `find` is fd when the host has it and GNU find when it has not — the same rule, for the same
 * reason: a primitive that answers only on a host with one engine is not "find the files", it is
 * "find them where fd is installed". The two engines want different argv and print
 * differently, so the kind travels beside the path here too. */
const FD = onPath("fd");
const FIND_KIND: "fd" | "find" = FD ? "fd" : "find";
const FIND = FD ?? onPath("find") ?? "find";

/** The first `name` on PATH, or null. Probed once at load: this is the host's PATH, not a cell's. */
function onPath(name: string): string | null {
	for (const dir of (process.env.PATH ?? "").split(":")) {
		if (dir && existsSync(join(dir, name))) return join(dir, name);
	}
	return null;
}

const MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
};

/**
 * The host functions whose calls own a **process**, so an abort that abandons one *kills* it
 * (`.scratch/long-work/issues/01-the-aborts-kill.md`). The sibling of {@link HOST_DECLARERS}: a
 * per-function fact held outside `abortable`, which stays generic about promises.
 *
 * Code mode's own three, because they are the three `run()` serves — a contributor's spawn is not in
 * this set and cannot be: code mode owns no handle to a process it did not start. What reaches a
 * contributor instead is the run's signal (`KernelHandleCore.runSignal`, ticket 08).
 */
const SPAWNING: ReadonlySet<string> = new Set(["bash_host", "find", "grep"]);

/** Whether a host call owns a process — the one question a caller outside this file asks of that set. */
export function ownsProcess(name: string): boolean {
	return SPAWNING.has(name);
}

/**
 * What a **foreground** `bash` gets when its caller declared no bound, and the bound that makes the
 * old promise false: *"a foreground `bash` waits forever unless you pass `timeout=`"* was true, and it
 * is the hole this closes.
 *
 * Why a default rather than the model's own care: a foreground call is turn-owned, and the model
 * cannot act while it runs — the tool call has not returned, so it cannot send a notice's remedy, and
 * nothing else in the stack bounds the call (measured: `maxFeedDurationSecs` does not reach a cell
 * parked in a host call, because monty's budget is checked at interpreter checkpoints and its duration
 * backstop compares a time the worker reports *on each protocol turn*, which a worker waiting on our
 * callback never makes — `monty/docs/resource-limits.md`). The model is the actor everywhere a notice
 * can reach it; a call it is blocked inside is the one place an automatic bound has to exist.
 *
 * Ten minutes, so a hang costs a retry rather than an afternoon, with two remedies in the error: a
 * declared `timeout=N` for work known to be long, or `background=True` for work that should outlive
 * attention. Nothing may outlive the cell either — its own budget (an hour) ends whatever the cell is
 * waiting on, this bound included.
 */
export const DEFAULT_FOREGROUND_SECONDS = 600;

export type TextPart = { type: "text"; text: string };
export type ImagePart = { type: "image"; data: string; mimeType: string };
export type Attachment = ImagePart & { path: string };
/** `path:line:text`, which is what ripgrep and GNU grep both print once the file name is forced.
 * A context line (`path-line-text`) and any other chatter are skipped, as they always were. */
export function parseGrepOutput(text: string): Match[] {
	const matches: Match[] = [];
	for (const raw of text.split("\n")) {
		if (!raw) continue;
		const hit = /^(.*?):(\d+):(.*)$/.exec(raw);
		if (!hit) continue;
		matches.push({ path: hit[1], line: Number(hit[2]), text: hit[3].trimEnd() });
	}
	return matches;
}

/** The flags each engine needs to answer one question the same way. `--with-filename`/`-H` are
 * forced so both print `path:line:text` (ripgrep drops the path when handed a single file), and
 * `--hidden` is ripgrep's alone: GNU grep has no ignore rules to re-enable. */
export function grepArgv(kind: "rg" | "grep", query: GrepQuery): string[] {
	const argv =
		kind === "rg"
			? ["--hidden", "--with-filename", "--line-number", "--no-heading", "--color=never"]
			: ["-r", "-n", "-H", "--color=never"];
	if (query.ignoreCase) argv.push("-i");
	if (query.literal) argv.push("-F");
	if (query.glob) {
		if (kind === "rg") argv.push("--glob", query.glob);
		else argv.push(query.glob.startsWith("!") ? `--exclude=${query.glob.slice(1)}` : `--include=${query.glob}`);
	}
	if (query.context) argv.push("-C", String(query.context));
	argv.push("-m", String(query.limit));
	argv.push(kind === "rg" ? "--" : "-e", query.pattern, query.path);
	return argv;
}

/** fd names a type and GNU find takes a letter for most of them — and has a primary of its own for
 * the two fd names that are not a `-type` at all. A name neither engine knows is handed to `-type`
 * to be rejected there, which is the same loud failure fd gives it. */
const FIND_TYPE: Record<string, string[]> = {
	file: ["-type", "f"],
	f: ["-type", "f"],
	directory: ["-type", "d"],
	dir: ["-type", "d"],
	d: ["-type", "d"],
	symlink: ["-type", "l"],
	l: ["-type", "l"],
	"block-device": ["-type", "b"],
	b: ["-type", "b"],
	"char-device": ["-type", "c"],
	c: ["-type", "c"],
	socket: ["-type", "s"],
	s: ["-type", "s"],
	pipe: ["-type", "p"],
	p: ["-type", "p"],
	executable: ["-executable"],
	x: ["-executable"],
	empty: ["-empty"],
	e: ["-empty"],
};

/** The flags each engine needs to answer one question the same way. fd's own two knobs are passed
 * through rather than re-tabulated: a `type` fd does not know exits 2 and prints the ones it takes,
 * which is louder than a silent no-match and does not drift from fd's own list. */
export function findArgv(kind: "fd" | "find", query: FindQuery): string[] {
	// A pattern with a separator is matched against the whole path by both engines. fd has to be
	// told (`--full-path`) and wants the `**/` that says "at any depth" written out; find's `-path`
	// is the whole path already, and its `*` crosses separators on its own. An empty pattern is the
	// one thing the two do not agree on unwritten, so it becomes the glob that matches everything.
	const deep = query.pattern.includes("/");
	let glob = query.pattern || "*";
	if (deep && !glob.startsWith("/") && !glob.startsWith("**/") && glob !== "**") glob = `**/${glob}`;
	if (kind === "fd") {
		const argv = ["--glob", "--color=never", "--hidden", "--no-require-git", "--max-results", String(query.limit)];
		if (query.maxDepth > 0) argv.push("--max-depth", String(query.maxDepth));
		if (query.type) argv.push("--type", query.type);
		if (deep) argv.push("--full-path");
		return [...argv, "--", glob, query.path];
	}
	// `-mindepth 1`, because fd never answers with the search root itself and a cell cannot tell the
	// two engines apart if one of them lists it. `-printf '%y %p'` rather than `-print`, because the
	// type character is what lets the parse below mark a directory the way fd marks it.
	const argv = [query.path, "-mindepth", "1"];
	if (query.maxDepth > 0) argv.push("-maxdepth", String(query.maxDepth));
	if (query.type) argv.push(...(FIND_TYPE[query.type] ?? ["-type", query.type]));
	argv.push(deep ? "-path" : "-name", glob);
	argv.push("-printf", "%y %p\\n");
	return argv;
}

/**
 * The order the exact lane answers in: by path, then by line.
 *
 * Code mode's own, applied to an engine's answer — an index has no walk order to reproduce, and a cell that
 * takes the first of a set must get the same one twice (`find`'s sort, for the same reason).
 */
export function compareMatches(a: Match, b: Match): number {
	if (a.path !== b.path) return a.path < b.path ? -1 : 1;
	return a.line - b.line;
}

/** One path per line, a directory with fd's trailing `/`, whichever engine printed it. fd prints
 * that itself; GNU find is asked for the type character beside the path so this can add it. */
export function parseFindOutput(kind: "fd" | "find", text: string): string[] {
	const paths: string[] = [];
	for (const raw of text.split("\n")) {
		if (!raw) continue;
		if (kind === "fd") {
			paths.push(raw);
			continue;
		}
		const hit = /^([a-z]) (.*)$/.exec(raw);
		if (!hit) continue;
		paths.push(hit[1] === "d" ? `${hit[2]}/` : hit[2]);
	}
	return paths;
}

/** The exception a cell sees for an argument its primitive cannot bind. `.name` is what monty maps
 * onto the Python exception, so a misspelling arrives as a `ValueError` (`zvec_grep_*` refuses the
 * same way, for the same reason: a caller who passed a parameter believes it did something). */
function badArgument(message: string): Error {
	const error = new Error(message);
	error.name = "ValueError";
	return error;
}

/** The arguments monty handed over: the positionals, and Python's keyword arguments as one trailing
 * plain object.
 *
 * An unknown keyword and a surplus positional are **refused, not dropped**. `glob` is a name `grep`
 * binds and `find` does not, so a cell writing `find(glob="*.md")` would otherwise get a full listing
 * that reads as a filter that worked — the one failure a cell cannot detect from the answer. */
/**
 * Monty's containers, as the plain values a host function expects.
 *
 * A Python `dict` crosses the boundary as a **`Map`** — positionally, and nested inside a `list` even
 * when the call itself is keyword-shaped — while the trailing kwargs object is a plain object. So
 * `todos=[{"content": …, "status": …}]` reached a host as `[Map, Map]`, whose fields no `Object.entries`
 * or property read can see: Magic Context's `todowrite` capture rejected it (its shape gate is right to
 * reject what is not a todo) and a cell's call recorded nothing. Found by the live acceptance run in
 * `zeroqn/pi`'s `.scratch/one-tool-surface/`, which is the only place it *could* be found — the unit
 * tests built their arguments in JavaScript.
 *
 * Conversion is uniform and bounded: `Map` and `Set` become objects and arrays, arrays and plain objects
 * are rebuilt, and anything else (a `Buffer`, a `Date`, a class instance) is passed through untouched so a
 * host that wants those still gets them. Depth is capped, because a Python structure can be deeper than
 * anything a host should be reasoning about and a recursive conversion must terminate.
 */
const PLAIN_ARG_DEPTH = 8;

export function plainArg(value: unknown, depth = 0): unknown {
	if (depth >= PLAIN_ARG_DEPTH) return value;
	if (value instanceof Map) {
		const mapped: Record<string, unknown> = {};
		for (const [key, inner] of value.entries()) mapped[String(key)] = plainArg(inner, depth + 1);
		return mapped;
	}
	if (value instanceof Set) return [...value].map((inner) => plainArg(inner, depth + 1));
	if (Array.isArray(value)) return value.map((inner) => plainArg(inner, depth + 1));
	if (value === null || typeof value !== "object") return value;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return value;
	const plain: Record<string, unknown> = {};
	for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
		plain[key] = plainArg(inner, depth + 1);
	}
	return plain;
}

/**
 * The same host surface, with every call's arguments converted once at the boundary.
 *
 * Outside `recordingHost` on purpose: the journal and the `python` result's trace record what a host
 * function actually *received*, and recording monty's containers would have written `[{}, {}]` where the
 * cell passed `[{"content": …}]`. Function `.name` is preserved, because monty identifies a host function
 * by it after the sandbox has read the value (`recordingHost`'s note).
 */
export function plainArgs(host: HostFns): HostFns {
	const wrapped: HostFns = {};
	for (const [name, fn] of Object.entries(host)) {
		const wrapper = async (...args: unknown[]) => fn(...args.map((arg) => plainArg(arg)));
		Object.defineProperty(wrapper, "name", { value: name });
		wrapped[name] = wrapper;
	}
	return wrapped;
}

export function bind(args: unknown[], names: string[], fn: string): Record<string, unknown> {
	const list = [...args];
	let kwargs: Record<string, unknown> = {};
	const last = list[list.length - 1];
	if (last && typeof last === "object" && !Array.isArray(last) && !Buffer.isBuffer(last)) {
		kwargs = list.pop() as Record<string, unknown>;
	}
	if (list.length > names.length) {
		throw badArgument(
			`${fn} takes at most ${names.length} positional arguments (${names.join(", ")}), got ${list.length}`,
		);
	}
	for (const key of Object.keys(kwargs)) {
		if (!names.includes(key)) throw badArgument(`${fn} has no parameter "${key}" (takes ${names.join(", ")})`);
	}
	const out: Record<string, unknown> = {};
	names.forEach((name, index) => {
		const positional = list[index];
		if (index < list.length && kwargs[name] !== undefined) {
			throw badArgument(`${fn}: "${name}" was given twice, as a positional and by name`);
		}
		out[name] = positional !== undefined && positional !== null ? positional : (kwargs[name] ?? null);
	});
	return out;
}

/**
 * The fields of a structured result that carry external text. `bash_host` is the shape that matters
 * today: `stdout` and `stderr` are the remote text, while `exit_code`/`truncated`/`killed`/
 * `full_output_path` are this session's own facts about the call and never move. An object with none of
 * these is not a text-bearing result and comes back unchanged.
 */
const FENCE_TEXT_FIELDS = ["stdout", "stderr"] as const;

/** One text value under a fence: the opening marker, the preamble, the value, the closing marker.
 *
 * `fenceText`'s rule, verbatim (`web-access/guard.ts`): **always wrap**, even when the value already
 * carries the marker. An idempotency check would be a bypass — external text can forge the marker — so
 * re-entry is handled where it can happen, by recognising the exact wrapper. */
function underFence(text: string, fence: Fence): string {
	return `${fence.open}${fence.preamble}\n${text}\n${fence.close}`;
}

/**
 * Wrap the text of one call's result with the fence its policy answered (see `Fence`).
 *
 * A plain string result is wrapped unless it is empty; a structured result has its **text fields**
 * ({@link FENCE_TEXT_FIELDS}) wrapped, each only when it is a non-empty string; anything else — a
 * number, a boolean, an object with no text field, an empty string — is returned unchanged. The egress
 * owner supplies the words and code mode supplies only this act, so a revision of the marker text never
 * touches this file.
 */
export function applyFence(result: unknown, fence: Fence): unknown {
	if (typeof result === "string") return result === "" ? result : underFence(result, fence);
	if (result === null || typeof result !== "object" || Array.isArray(result)) return result;
	const record = result as Record<string, unknown>;
	let wrapped: Record<string, unknown> | undefined;
	for (const field of FENCE_TEXT_FIELDS) {
		const value = record[field];
		if (typeof value === "string" && value !== "") {
			wrapped ??= { ...record };
			wrapped[field] = underFence(value, fence);
		}
	}
	return wrapped ?? result;
}

/**
 * The guard's gate: the same surface, with every call offered to the session's policy first.
 *
 * A refusal throws **before** the callee runs, and the wrapper carries the name of the function it
 * wraps — monty identifies a host function by its JS `.name` (`recordingHost`'s note; a wrapper
 * named `<anonymous>` binds as nothing and every later call through the binding raises `NameError`).
 *
 * A policy may also answer a **fenced allowance** (`EgressVerdict`): the call runs, and the fence is
 * applied to **its** result before the cell sees it — a plain string, or the text fields of a structured
 * result. Only that one call's answer changes shape.
 *
 * With no `before` the surface is returned **unchanged**, not copied: a session with no guard has
 * to behave exactly as it did before this existed. With no fence returned, the callee's result is the
 * callee's own object — byte-identical and uncopied.
 */
export function guarded(host: HostFns, ...policies: Array<Guard | Egress | undefined>): HostFns {
	// Flattened once, at wrap time, so the hot path is a loop over bare functions rather than a walk
	// over slots that may or may not be there.
	const asked: Array<(call: { name: string; args: unknown[] }) => unknown> = [];
	for (const policy of policies) {
		if (typeof policy?.before === "function") asked.push(policy.before.bind(policy));
	}
	if (asked.length === 0) return host;
	const wrapped: HostFns = {};
	for (const [name, fn] of Object.entries(host)) {
		const wrapper = async (...args: unknown[]) => {
			// Every policy is offered the call, **before** the callee runs, and the first refusal stops
			// it: `guard` is asked first (may this call run at all), then `egress` (may it leave the
			// host). The order is the contract's: a session policy decides whether the call is a call
			// before a subject policy decides whether it may reach out.
			let fence: Fence | undefined;
			for (const ask of asked) {
				const verdict = (await ask({ name, args })) as
					| { allow?: boolean; reason?: string; fence?: Fence }
					| undefined;
				if (verdict && verdict.allow === false) throw refusal(String(verdict.reason));
				// A fenced allowance is remembered rather than acted on yet: a fence lands on the result
				// of the call it allowed, and on nothing else.
				if (verdict?.fence) fence = verdict.fence;
			}
			const result = await fn(...args);
			return fence ? applyFence(result, fence) : result;
		};
		Object.defineProperty(wrapper, "name", { value: name });
		wrapped[name] = wrapper;
	}
	return wrapped;
}

/**
 * The abort gate: the same surface, refused once the turn is cancelled.
 *
 * Two rules, one exception, and — since `.scratch/long-work/issues/01-the-aborts-kill.md` — one split.
 * A call offered **after** the abort never runs. A call already in flight stops holding the cell: the
 * promise the sandbox is waiting on rejects with the abort, monty resumes that suspension with it, and
 * the cell ends in a `KeyboardInterrupt` naming the call.
 *
 * What happens to the *work* then depends on what the call was:
 *
 *  - a **spawning** call (`bash`, `find`, `grep`) is **killed, group and all** — its process is
 *    turn-owned, and nothing of it outlives the cell. `run()` performs that kill, because it is the
 *    only thing holding a pid; this wrapper deliberately knows nothing about processes.
 *  - and the message says which, because the model is holding that message and nothing else: a
 *    spawning call's abort reports *that its process group was killed*.
 *  - a **promise** — a join, a child, a background handle — is still **abandoned, not cancelled**
 *    (`bash` in the background keeps running, a child keeps working), the tradeoff
 *    `.scratch/rlm-wait/issues/06-…` decided and the reason the kernel survives either way.
 *
 * With no signal the surface is returned **unchanged**, not copied: a session whose tool call
 * carried none behaves exactly as it did before this existed. `.name` is preserved for the same
 * reason `guarded` preserves it: monty identifies a host function by it, and a wrapper named
 * `<anonymous>` binds as nothing.
 */
export function abortable(host: HostFns, signal?: AbortSignal): HostFns {
	if (!signal) return host;
	const wrapped: HostFns = {};
	for (const [name, fn] of Object.entries(host)) {
		const wrapper = (...args: unknown[]): Promise<unknown> => {
			// An abort this repo raised may carry its own reason (the cell clock: `budgetEnded`), and that
			// reason says more than the generic message — *why* the cell is over. Any other reason (pi's own
			// Esc, whose DOM `AbortError` has no Python exception name) is ignored.
			if (signal.aborted) return Promise.reject(abortReason(signal) ?? aborted(name, false));
			let rejectAbort: (error: unknown) => void = () => {};
			const cancelled = new Promise<never>((_resolve, reject) => {
				rejectAbort = reject;
			});
			const onAbort = () => rejectAbort(abortReason(signal) ?? aborted(name, true, SPAWNING.has(name)));
			signal.addEventListener("abort", onAbort, { once: true });
			let work: Promise<unknown>;
			try {
				work = Promise.resolve(fn(...args));
			} catch (error) {
				signal.removeEventListener("abort", onAbort);
				return Promise.reject(error);
			}
			// The loser of the race is not ours to report: a call abandoned at the abort must not
			// surface later as an unhandled rejection.
			work.catch(() => {});
			return Promise.race([work, cancelled]).finally(() => signal.removeEventListener("abort", onAbort));
		};
		Object.defineProperty(wrapper, "name", { value: name });
		wrapped[name] = wrapper;
	}
	return wrapped;
}

/**
 * What a host call says about itself (rlm-stop ticket 05).
 *
 * Declared as a **pure function of the call's arguments**, read by the counter at call time — not by
 * ambient state the callee writes into. That shape is forced by two facts, and the second was found
 * live:
 *
 *  - the counter cannot guess `bash_host`'s `timeout` without a dependency on one function's schema, so
 *    the function that *enforces* the bound is the one that states it;
 *  - **anything asynchronous between the counter and the callee breaks an ambient slot.** A guard
 *    wraps the whole surface in an `async` prologue (`guarded`, below), so with a guard present the
 *    callee runs a microtask after the counter's prologue closed the slot, and the declaration landed
 *    nowhere — measured 2026-10-09 in a manifest-loaded session (`waiting_on: "bash_host"` where the
 *    trio it was built with said `waiting_on: "sleep 600"`).
 *
 * A declarer must be **total**: `bash_host`'s is read before the call runs, so a throw here would turn
 * a malformed call's own error into a different one.
 */
export type CallDeclaration = {
	/** Seconds this call may take; `null` is unbounded, the default. */
	timeout_s?: number | null;
	/** What it is doing in a few words — for `bash`, its command's first line. */
	detail?: string;
};

export type HostDeclarer = (args: unknown[]) => CallDeclaration | undefined;

/**
 * What each host function says about itself, keyed by the name the counter sees. One entry per
 * function that knows something a reader wants: a bound it will enforce, and what it is doing.
 */
/**
 * What each call *is*, read from the arguments before it runs — the bound it will be killed at and
 * the command it is doing that with.
 *
 * A function rather than a constant since the foreground default exists: the declaration has to report
 * the bound the call will actually be killed at (`DEFAULT_FOREGROUND_SECONDS` when the caller declared
 * none), and the kernel's own seam has to be able to change that number for a test. A background call
 * declares nothing here — its bound belongs to the handle, which reports its own `timeout_s`/`lease_s`.
 */
export function hostDeclarers(foregroundSeconds = DEFAULT_FOREGROUND_SECONDS): Record<string, HostDeclarer> {
	return {
		bash_host: (args) => {
			try {
				const { command, timeout, background } = bind(args, ["command", "timeout", "background"], "bash");
				const declared = timeout === null || timeout === undefined ? null : num(timeout, 0) || null;
				return {
					timeout_s: background === true ? declared : (declared ?? foregroundSeconds),
					detail: str(command).split("\n")[0]?.slice(0, 120),
				};
			} catch {
				return undefined;
			}
		},
	};
}

export function makeHost(options: {
	root: string;
	attachments: Attachment[];
	progress?: (text: string) => void;
	/** Code mode's own host functions and every accepted contribution, merged. */
	extra: HostFns;
	background: ReturnType<typeof createBackgroundManager>;
	/** The session's policy, when its owner declared one (readonly-guard ticket 02). */
	guard?: Guard;
	/** The session's egress policy, when its owner declared one — asked after `guard`, before the call. */
	egress?: Egress;
	/** What answers `grep`/`find` before rg/fd, when the session declared an engine
	 * (`fff-search` ticket 05). Absent is the ordinary state, and leaves both primitives as they were. */
	engine?: SearchEngine;
	/** The signal driving this cell: pi's own (`rlm-wait` ticket 06), composed with the kernel's own
	 * cell clock. Absent when neither exists, which leaves every function exactly as it was. */
	signal?: AbortSignal;
	/** The bound an undeclared foreground `bash` is given ({@link DEFAULT_FOREGROUND_SECONDS}). */
	foregroundSeconds?: number;
	/** Where a spawned process registers its kill, for the exit reaper (see `RunRegistry`). */
	registry?: RunRegistry;
}): HostFns {
	const {
		root,
		attachments,
		progress,
		extra,
		background: backgroundManager,
		guard,
		egress,
		engine,
		signal,
		foregroundSeconds = DEFAULT_FOREGROUND_SECONDS,
		registry,
	} = options;
	const base: HostFns = {
		async bash_host(...args: unknown[]) {
			const { command, timeout, background } = bind(args, ["command", "timeout", "background"], "bash");
			// What this call is (its bound, its command) is published by `HOST_DECLARERS`, read from these
			// same arguments by the counter before the call runs — deliberately not written here, because a
			// guard's async prologue puts this body a microtask after the counter's slot closed.
			if (background === true) {
				return backgroundManager.start(str(command), timeout === null ? null : num(timeout, 0) || null);
			}
			const startedAt = Date.now();
			progress?.(`bash: ${str(command).split("\n")[0].slice(0, 100)} — running`);
			// `None`, `0` and an omitted argument all mean "declared nothing" — the prelude's own wrapper
			// passes `timeout=None` by default, so the three cannot be told apart at this boundary, and a
			// bound of zero is not a bound. Any of them gets the default; only a positive number is one.
			const declared = timeout === null || timeout === undefined ? null : num(timeout, 0) || null;
			const bound = declared === null ? foregroundSeconds : declared;
			const result = await run(SHELL, ["-lc", str(command)], {
				cwd: root,
				timeoutSeconds: bound,
				registry,
				// The abort kills this call's group (01). A `background=True` call never reaches here,
				// which is what keeps a handle session-owned.
				signal,
			});
			progress?.(`bash: exit ${result.exitCode ?? "?"} after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
			const combined = result.stdout + (result.stderr ? `\n${result.stderr}` : "");
			const cut = truncate(combined);
			return {
				stdout: result.stdout,
				stderr: result.stderr,
				exit_code: result.exitCode,
				truncated: cut.truncated,
				// Separate from `truncated` on purpose: a call killed at its bound (or by the abort) and a
				// call whose output was merely long are different facts, and folding them together left
				// the model unable to tell which had happened (01).
				killed: result.killed,
				// Why it was killed, when the reason is not the one the caller declared. A model that has
				// just lost a build it expected to finish on its own has to be told the default exists, or
				// the only lesson available is "bash is unreliable".
				note:
					result.killed && declared === null
						? `${bound}s is the default bound for a foreground bash call — pass timeout=N for work you know takes longer, or run it with background=True`
						: null,
				full_output_path: cut.truncated ? spill(combined, "bash") : null,
			};
		},

		async find(...args: unknown[]) {
			const bound = bind(args, ["pattern", "path", "limit", "max_depth", "type", "fuzzy", "index"], "find");
			const query: FindQuery = {
				pattern: str(bound.pattern),
				path: str(bound.path) || root,
				limit: num(bound.limit, 1000),
				maxDepth: num(bound.max_depth, 0),
				type: str(bound.type),
				index: bool(bound.index),
				fuzzy: bool(bound.fuzzy),
			};
			// As `grep`: the session's engine first, rg/fd when there is none or it throws. The *sort* is
			// the parity half and therefore this function's, unless the cell asked for the engine's own
			// ranking (`fuzzy`) — sorting a ranked answer would throw away the reason to ask for one.
			if (engine && (query.index || query.fuzzy)) {
				try {
					const found = await engine.find(query);
					return query.fuzzy ? found.slice(0, query.limit) : [...found].sort().slice(0, query.limit);
				} catch {
					/* the fallback is the rule, not a failure path */
				}
			}
			const result = await run(FIND, findArgv(FIND_KIND, query), { cwd: root, signal, registry });
			if (result.exitCode !== 0 && !result.stdout.trim()) {
				throw new Error(`find failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
			}
			// Sorted, because fd walks in parallel and hands paths back in whatever order its threads
			// finished, and find walks in an order of its own: a cell that takes the first of a set
			// would get a different one twice. It orders what came back, it does not rank -- a result
			// that hit `limit` is still whichever entries the engine stopped after, so that set is not
			// the alphabetically first ones. fd stops early (`--max-results`); find has no such flag,
			// so there the walk is whole and the cut is the first ones, at the cost the flag avoids.
			return parseFindOutput(FIND_KIND, result.stdout).sort().slice(0, query.limit);
		},

		async grep(...args: unknown[]): Promise<Match[]> {
			const bound = bind(
				args,
				["pattern", "path", "glob", "ignore_case", "literal", "context", "limit", "fuzzy", "index"],
				"grep",
			);
			const limit = num(bound.limit, 100);
			const query: GrepQuery = {
				pattern: str(bound.pattern),
				path: str(bound.path) || root,
				glob: bound.glob ? str(bound.glob) : null,
				ignoreCase: bool(bound.ignore_case),
				literal: bool(bound.literal),
				context: bound.context ? num(bound.context, 0) : 0,
				limit,
				index: bool(bound.index),
				fuzzy: bool(bound.fuzzy),
			};
			// The session's engine first; rg/grep when there is none, when the cell asked for neither lane,
			// or when the engine throws. The engine is handed the *normalized* query and owns nothing else:
			// the limit is applied here, for the same reason the base path applies it — a cell's contract
			// is the shape and the cut, not whichever engine answered. `index` and `fuzzy` reach the engine
			// as part of the query; the base engines have no such notion and ignore them.
			//
			// The engine's answer is reordered in the exact lane and left alone in the fuzzy one: a cell that
			// asked for the engine's *ranking* must get it, and one that asked for the index with rg's
			// matcher must get a stable order. Neither can be rg's arrival order — that is a walk's, and an
			// index does not walk — so the exact lane sorts by path then line, as `find` already does.
			if (engine && (query.index || query.fuzzy)) {
				try {
					const found = await engine.grep(query);
					const ordered = query.fuzzy ? found : [...found].sort(compareMatches);
					return ordered.slice(0, limit);
				} catch {
					/* the fallback is the rule, not a failure path */
				}
			}
			const result = await run(GREP, grepArgv(GREP_KIND, query), { cwd: root, signal, registry });
			const matches = parseGrepOutput(result.stdout);
			if (matches.length > 0) return matches.slice(0, limit);
			// Both engines answer exit 1 with nothing on stdout when the pattern is simply not
			// there: an empty result, not a failure. Anything else silent is a failure, and says so.
			if (result.exitCode === 1) return [];
			throw new Error(`grep failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
		},

		async read_image(...args: unknown[]) {
			const { path } = bind(args, ["path"], "read_image");
			const wanted = str(path);
			const absolute = wanted.startsWith("/") ? wanted : join(root, wanted);
			const buffer = readFileSync(absolute);
			const mimeType = MIME[extname(absolute).toLowerCase()] ?? "application/octet-stream";
			attachments.push({ type: "image", data: buffer.toString("base64"), mimeType, path: absolute });
			return { path: absolute, attached: true, bytes: buffer.length, mime_type: mimeType };
		},

	};
	// Contributed names win over base ones (ticket 01), and both halves are gated before they run.
	// The abort gate is outermost of the three: a cancelled turn is refused before the policy is even
	// asked, which is the order `readonly-guard`'s question ("may this call run") implies.
	return abortable({ ...guarded(base, guard, egress), ...guarded(extra, guard, egress) }, signal);
}
