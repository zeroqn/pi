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
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { run, spill, truncate } from "./output";
import { bool, num, str } from "./util";
import { refusal, type Guard } from "./contract";
import type { createBackgroundManager } from "./background";
import type { HostFns } from "./journal";

/** Where the host functions that shell out live, and how long a cell's output may be —
 * code mode's own environment knobs (ticket 03). */
const FD = process.env.RLM_FD ?? "/nix/store/5j3vslc4gccb95xnzr1mxhgwrc0wfgad-fd-10.4.2/bin/fd";
const ZG = process.env.RLM_ZG ?? "zg";
const SHELL = process.env.RLM_SHELL ?? process.env.SHELL ?? "/bin/bash";

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
type Match = { path: string | null; line: number | null; text: string };

export function parseZgOutput(text: string): Match[] {
	const matches: Match[] = [];
	let current: string | null = null;
	for (const raw of text.split("\n")) {
		if (!raw.trim()) continue;
		if (!/^\s/.test(raw)) {
			current = raw.trim();
			continue;
		}
		if (!current) continue;
		const hit = /(\d+):(.*)$/.exec(raw);
		if (!hit) continue;
		matches.push({ path: current, line: Number(hit[1]), text: hit[2].replace(/^\t/, "").trimEnd() });
	}
	return matches;
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
			const argv = ["query", "--rg", "--hidden"];
			if (bool(bound.ignore_case)) argv.push("-i");
			if (bool(bound.literal)) argv.push("-F");
			if (bound.glob) argv.push("--glob", str(bound.glob));
			if (bound.context) argv.push("-C", str(bound.context));
			argv.push("-m", String(limit), str(bound.pattern), str(bound.path) || root);
			const result = await run(ZG, argv, { cwd: root });
			const parsed = parseZgOutput(result.stdout);
			if (parsed.length > 0) return parsed.slice(0, limit);
			if (!result.stdout.trim()) {
				throw new Error(`grep produced nothing: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
			}
			return result.stdout
				.split("\n")
				.filter(Boolean)
				.slice(0, limit)
				.map((line) => ({ path: null, line: null, text: line }));
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
