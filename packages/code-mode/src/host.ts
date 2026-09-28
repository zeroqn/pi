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
import { run, spill, truncate } from "./output";
import { SHELL } from "./shell";
import { bool, num, str } from "./util";
import {
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
 * The guard's gate: the same surface, with every call offered to the session's policy first.
 *
 * A refusal throws **before** the callee runs, and the wrapper carries the name of the function it
 * wraps — monty identifies a host function by its JS `.name` (`recordingHost`'s note; a wrapper
 * named `<anonymous>` binds as nothing and every later call through the binding raises `NameError`).
 *
 * With no `before` the surface is returned **unchanged**, not copied: a session with no guard has
 * to behave exactly as it did before this existed.
 */
export function guarded(host: HostFns, guard?: Guard): HostFns {
	const before = guard?.before;
	if (!before) return host;
	const wrapped: HostFns = {};
	for (const [name, fn] of Object.entries(host)) {
		const wrapper = async (...args: unknown[]) => {
			const verdict = await before({ name, args });
			if (verdict && verdict.allow === false) throw refusal(verdict.reason);
			return fn(...args);
		};
		Object.defineProperty(wrapper, "name", { value: name });
		wrapped[name] = wrapper;
	}
	return wrapped;
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
	/** What answers `grep`/`find` before rg/fd, when the session declared an engine
	 * (`fff-search` ticket 05). Absent is the ordinary state, and leaves both primitives as they were. */
	engine?: SearchEngine;
}): HostFns {
	const { root, attachments, progress, extra, background: backgroundManager, guard, engine } = options;
	const base: HostFns = {
		async bash_host(...args: unknown[]) {
			const { command, timeout, background } = bind(args, ["command", "timeout", "background"], "bash");
			if (background === true) {
				return backgroundManager.start(str(command), timeout === null ? null : num(timeout, 0) || null);
			}
			const startedAt = Date.now();
			progress?.(`bash: ${str(command).split("\n")[0].slice(0, 100)} — running`);
			const result = await run(SHELL, ["-lc", str(command)], {
				cwd: root,
				timeoutSeconds: timeout === null ? null : num(timeout, 0) || null,
			});
			progress?.(`bash: exit ${result.exitCode ?? "?"} after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
			const combined = result.stdout + (result.stderr ? `\n${result.stderr}` : "");
			const cut = truncate(combined);
			return {
				stdout: result.stdout,
				stderr: result.stderr,
				exit_code: result.exitCode,
				truncated: cut.truncated || result.killed,
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
			const result = await run(FIND, findArgv(FIND_KIND, query), { cwd: root });
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
			const result = await run(GREP, grepArgv(GREP_KIND, query), { cwd: root });
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
	return { ...guarded(base, guard), ...guarded(extra, guard) };
}
