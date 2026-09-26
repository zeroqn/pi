/** The host functions the sandbox reaches the host with: `bash_host`, `find`, `grep`,
 * `read_image` — plus whatever the contribution ledger merged in (`extra`).
 *
 * The base functions are code mode's (ticket 03) and the background names are its own as well;
 * everything else is contributed. **Both halves pass the session's guard** before they run
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
import { bool, num, str } from "./util";
import { refusal, type Guard } from "./contract";
import type { createBackgroundManager } from "./background";
import type { HostFns } from "./journal";

/** Where the host functions that shell out live, and how long a cell's output may be —
 * code mode's own environment knobs (ticket 03). */
const FD = process.env.RLM_FD ?? "/nix/store/5j3vslc4gccb95xnzr1mxhgwrc0wfgad-fd-10.4.2/bin/fd";
const SHELL = process.env.RLM_SHELL ?? process.env.SHELL ?? "/bin/bash";

/** `grep` is ripgrep when the host has it and GNU grep when it has not: the primitive is "search
 * the files", not "call one engine", so the first one on PATH answers and the other catches the
 * host that lacks it. The two want different flags, so the kind travels beside the path. */
const RG = onPath("rg");
const GREP_KIND: "rg" | "grep" = RG ? "rg" : "grep";
const GREP = RG ?? onPath("grep") ?? "grep";

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
/** One hit, as a cell reads it. Both engines are asked for the file name and the line number, so
 * neither field is ever absent — which is what lets a cell index on them without a null check. */
type Match = { path: string; line: number; text: string };

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

/** What a cell asked for, in the engine's terms rather than the cell's. */
export type GrepQuery = {
	pattern: string;
	path: string;
	glob: string | null;
	ignoreCase: boolean;
	literal: boolean;
	context: number;
	limit: number;
};

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

export function bind(args: unknown[], names: string[]): Record<string, unknown> {
	const list = [...args];
	let kwargs: Record<string, unknown> = {};
	const last = list[list.length - 1];
	if (last && typeof last === "object" && !Array.isArray(last) && !Buffer.isBuffer(last)) {
		kwargs = list.pop() as Record<string, unknown>;
	}
	const out: Record<string, unknown> = {};
	names.forEach((name, index) => {
		const positional = list[index];
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
}): HostFns {
	const { root, attachments, progress, extra, background: backgroundManager, guard } = options;
	const base: HostFns = {
		async bash_host(...args: unknown[]) {
			const { command, timeout, background } = bind(args, ["command", "timeout", "background"]);
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
			const bound = bind(args, ["pattern", "path", "limit"]);
			const searchPath = str(bound.path) || root;
			const limit = num(bound.limit, 1000);
			const argv = ["--glob", "--color=never", "--hidden", "--no-require-git", "--max-results", String(limit)];
			let effective = str(bound.pattern);
			if (effective.includes("/")) {
				argv.push("--full-path");
				if (!effective.startsWith("/") && !effective.startsWith("**/") && effective !== "**") effective = `**/${effective}`;
			}
			argv.push("--", effective, searchPath);
			const result = await run(FD, argv, { cwd: root });
			if (result.exitCode !== 0 && !result.stdout.trim()) {
				throw new Error(`find failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
			}
			return result.stdout.split("\n").filter(Boolean).slice(0, limit);
		},

		async grep(...args: unknown[]): Promise<Match[]> {
			const bound = bind(args, ["pattern", "path", "glob", "ignore_case", "literal", "context", "limit"]);
			const limit = num(bound.limit, 100);
			const query: GrepQuery = {
				pattern: str(bound.pattern),
				path: str(bound.path) || root,
				glob: bound.glob ? str(bound.glob) : null,
				ignoreCase: bool(bound.ignore_case),
				literal: bool(bound.literal),
				context: bound.context ? num(bound.context, 0) : 0,
				limit,
			};
			const result = await run(GREP, grepArgv(GREP_KIND, query), { cwd: root });
			const matches = parseGrepOutput(result.stdout);
			if (matches.length > 0) return matches.slice(0, limit);
			// Both engines answer exit 1 with nothing on stdout when the pattern is simply not
			// there: an empty result, not a failure. Anything else silent is a failure, and says so.
			if (result.exitCode === 1) return [];
			throw new Error(`grep failed: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
		},

		async read_image(...args: unknown[]) {
			const { path } = bind(args, ["path"]);
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
