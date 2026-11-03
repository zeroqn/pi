/**
 * The `zg` CLI: how it is spawned, which generation of it we are talking to, and how a call becomes
 * argv and back into text.
 *
 * Moved out of `index.ts` (`.scratch/zvec-grep` ticket 03) with the behaviour unchanged. The two things
 * that are *not* unchanged are the reasons it moved: `createZgCli` takes its executor as a parameter, so
 * a test drives the whole call path with no `zg` on the machine, and `spawnExec` is the same `spawn`
 * `pi.exec` performs (`pi-coding-agent/core/exec.js:10-74`) modelled on code mode's own runner
 * (`code-mode/src/output.ts:39-84`) — the extension stops needing pi's `exec` to exist at all.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export const VERSION_TIMEOUT_MS = 15_000;
export const SEARCH_TIMEOUT_MS = 10 * 60 * 1000;
export const RG_TIMEOUT_MS = 2 * 60 * 1000;
export const INDEX_TIMEOUT_MS = 60 * 60 * 1000;
export const STATUS_TIMEOUT_MS = 30 * 1000;
export const SERVER_TIMEOUT_MS = 30 * 1000;
export const MAX_OUTPUT_CHARS = 80_000;
/** What is buffered per stream before it is dropped. Four times the bound: `boundOutput` keeps the
 * head, so a cap above it cannot change what a caller sees — it only stops a runaway `--rg` from
 * filling memory on the way there. */
const MAX_STREAM_CHARS = MAX_OUTPUT_CHARS * 4;

export type CliStyle = "modern" | "legacy";

export type ExecResult = { stdout: string; stderr: string; code: number };
export type ExecOptions = { cwd: string; timeout: number; signal?: AbortSignal };
export type Exec = (command: string, args: string[], options: ExecOptions) => Promise<ExecResult>;

/** The extension's own executor: the call `pi.exec` makes, without pi. */
export const spawnExec: Exec = (command, args, options) =>
	new Promise<ExecResult>((settle) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, {
				cwd: options.cwd,
				shell: false,
				// Its own group, so a timeout can take the whole tree — `zg --rg` runs a bundled rg.
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			settle({ stdout: "", stderr: String(error), code: 1 });
			return;
		}
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			if (stdout.length < MAX_STREAM_CHARS) stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			if (stderr.length < MAX_STREAM_CHARS) stderr += chunk.toString();
		});
		let done = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const finish = (code: number | null, signal: NodeJS.Signals | null) => {
			if (done) return;
			done = true;
			if (timer) clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			options.signal?.removeEventListener("abort", kill);
			// A process that died of a signal did **not** exit 0. pi's own `exec` reports `code ?? 0`
			// and a `killed` flag nobody reads, so a timed-out search would look like a successful
			// short one; in a cell that is a wrong answer rather than a slow one, so it is a failure
			// here (ticket 03 records the deliberate divergence).
			settle({ stdout, stderr, code: code ?? (signal ? 1 : 0) });
		};
		const kill = () => {
			try {
				if (child.pid) process.kill(-child.pid, "SIGTERM");
				else child.kill("SIGTERM");
			} catch {
				child.kill("SIGTERM");
			}
			// Force the group down if it does not go on its own, as pi's `exec` does after 5s.
			killTimer = setTimeout(() => {
				try {
					if (child.pid) process.kill(-child.pid, "SIGKILL");
				} catch {
					/* already gone */
				}
			}, 5000);
		};
		const timer = options.timeout > 0 ? setTimeout(kill, options.timeout) : undefined;
		if (options.signal) {
			if (options.signal.aborted) kill();
			else options.signal.addEventListener("abort", kill, { once: true });
		}
		child.on("error", (error: Error & { code?: string }) => {
			// `spawn` answers ENOENT both for a binary it cannot find *and* for a working directory
			// that does not exist, and its message names only the binary ("spawn zg ENOENT"). A caller
			// that handed us a root that is not there would read that as "zg is not installed" and go
			// hunting for the wrong problem, so the directory is named instead.
			const missingCwd = error.code === "ENOENT" && !existsSync(options.cwd);
			stderr = `${stderr}\n${missingCwd ? `working directory does not exist: ${options.cwd}` : error.message}`.trim();
			finish(1, null);
		});
		child.on("close", (code: number | null, signal: NodeJS.Signals | null) => finish(code, signal));
	});

export type ZgCli = {
	/** `ZVEC_GREP_BIN`, or `zg` on PATH. */
	readonly binary: string;
	/** Spawn it. */
	run(args: string[], options: ExecOptions): Promise<ExecResult>;
	/** The CLI generation, detected once per instance (`ZVEC_GREP_CLI_STYLE` overrides). */
	style(cwd: string): Promise<CliStyle>;
};

/**
 * One `zg`, as a small object: the binary, the way it is spawned, and which argv shape it wants.
 *
 * `env` is read once at construction rather than per call, so a test that sets a knob after importing
 * still decides what it gets — the extension never needed a live `process.env`.
 */
export function createZgCli(
	options: { exec?: Exec; env?: NodeJS.ProcessEnv; binary?: string } = {},
): ZgCli {
	const env = options.env ?? process.env;
	const binary = options.binary ?? (env.ZVEC_GREP_BIN?.trim() || "zg");
	const exec = options.exec ?? spawnExec;
	const override = env.ZVEC_GREP_CLI_STYLE?.trim().toLowerCase();
	let stylePromise: Promise<CliStyle> | undefined;
	return {
		binary,
		run: (args, runOptions) => exec(binary, args, runOptions),
		style(cwd) {
			if (!stylePromise) {
				if (override === "modern" || override === "legacy") {
					stylePromise = Promise.resolve(override);
				} else {
					stylePromise = exec(binary, ["--version"], { cwd, timeout: VERSION_TIMEOUT_MS })
						.then((result) => styleForVersion(`${result.stdout}\n${result.stderr}`))
						.catch(() => "modern" as CliStyle);
				}
			}
			return stylePromise;
		},
	};
}

/** Compare a parsed semver against 0.2.1 (the first "modern" CLI shape). */
export function styleForVersion(version: string): CliStyle {
	const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!match) return "modern";
	const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
	if (major > 0) return "modern";
	if (minor > 2) return "modern";
	if (minor === 2 && patch >= 1) return "modern";
	return "legacy";
}

/** One search, in the terms `zg` wants rather than the cell's. The enum unions are the ones the old
 * typebox schema declared. */
export type SearchParams = {
	query?: string;
	queries?: string[];
	fts?: string[];
	vector?: string[];
	fuse?: boolean;
	limit?: number;
	globs?: string[];
	iglobs?: string[];
	fileTypes?: string[];
	excludedFileTypes?: string[];
	symbolType?: "module" | "class" | "interface" | "function" | "value" | "alias";
	preferSymbol?: boolean;
	modifiedAfter?: string;
	modifiedBefore?: string;
	preview?: "none" | "short" | "full";
	refresh?: "background" | "wait" | "off";
	mode?: "direct" | "server" | "auto";
};

/** One managed-ripgrep call: the command string is tokenized, never shelled. */
export type RgParams = { command: string };

export function buildSearchArgs(style: CliStyle, params: SearchParams): string[] {
	const args: string[] = [];
	if (style === "legacy") args.push("query");
	for (const value of params.queries ?? []) args.push("--hybrid", value);
	for (const value of params.fts ?? []) args.push("--fts", value);
	for (const value of params.vector ?? []) args.push("--vector", value);
	if (params.fuse) args.push("--fuse");
	if (params.limit !== undefined) args.push("--limit", String(params.limit));
	for (const value of params.globs ?? []) args.push("-g", value);
	for (const value of params.iglobs ?? []) args.push("--iglob", value);
	for (const value of params.fileTypes ?? []) args.push("-t", value);
	for (const value of params.excludedFileTypes ?? []) args.push("-T", value);
	if (params.symbolType) args.push("--symbol-type", params.symbolType);
	if (params.preferSymbol) args.push("--prefer-symbol");
	if (params.modifiedAfter) args.push("--modified-after", params.modifiedAfter);
	if (params.modifiedBefore) args.push("--modified-before", params.modifiedBefore);
	if (params.preview) args.push("--preview", params.preview);
	if (params.refresh) args.push("--refresh", params.refresh);
	if (params.mode) args.push("--mode", params.mode);
	// Keep the positional query last so a leading `-` can be escaped with `--`.
	if (params.query) {
		if (params.query.startsWith("-")) args.push("--");
		args.push(params.query);
	}
	return args;
}

export function buildRgArgs(style: CliStyle, rgArgs: readonly string[]): string[] {
	return style === "legacy" ? ["query", "--rg", ...rgArgs] : ["--rg", ...rgArgs];
}

/** Parse a ripgrep command string into argv, honouring quotes. Never uses a shell. */
export function tokenizeRgCommand(command: string): { args: string[]; head?: number } {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let hasToken = false;

	const flush = (): void => {
		if (hasToken || current.length > 0) {
			tokens.push(current);
			current = "";
			hasToken = false;
		}
	};

	for (let i = 0; i < command.length; i++) {
		const ch = command[i]!;
		if (quote) {
			if (ch === quote) {
				quote = undefined;
			} else if (ch === "\\" && quote === '"' && i + 1 < command.length) {
				current += command[++i];
			} else {
				current += ch;
			}
			hasToken = true;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			hasToken = true;
			continue;
		}
		if (ch === "\\" && i + 1 < command.length) {
			current += command[++i];
			hasToken = true;
			continue;
		}
		if (/\s/.test(ch)) {
			flush();
			continue;
		}
		current += ch;
		hasToken = true;
	}
	flush();

	// Drop a leading `zg` and/or the managed-rg selector for convenience.
	if (tokens[0] === "zg") tokens.shift();
	if (tokens[0] === "--rg" || tokens[0] === "rg") tokens.shift();

	// Translate a trailing `| head -N` into an output bound.
	const pipeIndex = tokens.indexOf("|");
	if (pipeIndex === -1) return { args: tokens };
	const rest = tokens.slice(pipeIndex + 1);
	let head: number | undefined;
	if (rest[0] === "head") {
		const [a, b] = [rest[1], rest[2]];
		if (a && /^-\d+$/.test(a)) head = Number(a.slice(1));
		else if (a === "-n" && b && /^\d+$/.test(b)) head = Number(b);
		else if (a && /^-n\d+$/.test(a)) head = Number(a.slice(2));
		else if (a && /^\d+$/.test(a)) head = Number(a);
	}
	return { args: tokens.slice(0, pipeIndex), head };
}

export function boundOutput(text: string, head?: number): string {
	let out = text;
	if (head !== undefined && Number.isFinite(head) && head >= 0) {
		out = out.split("\n").slice(0, head).join("\n");
	}
	if (out.length > MAX_OUTPUT_CHARS) {
		out = `${out.slice(0, MAX_OUTPUT_CHARS)}\n…[output truncated at ${MAX_OUTPUT_CHARS} characters]`;
	}
	return out;
}

export function lastNonEmptyLine(text: string): string {
	const lines = text.split("\n").map((line) => line.trimEnd()).filter(Boolean);
	return lines.length > 0 ? lines[lines.length - 1]! : "";
}

export type RootRun = { root: string; result: ExecResult };

export async function runAcrossRoots(
	cli: ZgCli,
	roots: readonly string[],
	args: readonly string[],
	signal: AbortSignal | undefined,
	timeout: number,
): Promise<RootRun[]> {
	return Promise.all(
		roots.map(async (root) => ({
			root,
			result: await cli.run([...args], { cwd: root, signal, timeout }),
		})),
	);
}

/**
 * A failure's detail, in the caller's terms when the CLI cannot say it usefully itself.
 *
 * `excluded_file_types` becomes a `NOT LIKE` filter, and the pinned zvec release — the storage engine
 * both `zg` generations ship — cannot parse one. That is not a guess: it is upstream's own test
 * (`zg-engine/src/storage/fragments/tests.rs`, `the pinned zvec release does not parse NOT LIKE`), and
 * the CLI's answer is the storage engine's SQL error with no results, which says nothing a caller can
 * act on. A negated glob does the same job and *is* supported (measured against the Rust `zg`: `-g
 * '!*.ts'` and `--iglob '!*.ts'` each drop the excluded format), so the detail is rewritten to say so
 * and keeps the engine's own line, bounded, for diagnosis.
 */
export function explainFailure(detail: string): string {
	if (!/parse filter failed/i.test(detail) || !/NOT ?LIKE/i.test(detail)) return detail;
	const said = (detail.split("\n").find((line) => line.trim()) ?? "").trim().slice(0, 200);
	return [
		"excluded_file_types needs a filter this zg's storage engine cannot parse: the pinned zvec release rejects the NOT LIKE clause the CLI builds for it.",
		'Pass the exclusion as a negated glob instead — globs=["!*.ts"] — which that engine does support.',
		`zg said: ${said}`,
	].join("\n");
}

export function formatRootResults(
	label: string,
	outcomes: readonly RootRun[],
	options: { header: boolean; head?: number },
): { text: string; failed: number } {
	let failed = 0;
	const sections = outcomes.map(({ root, result }) => {
		const prefix = options.header ? `### ${root}\n` : "";
		if (result.code !== 0) {
			failed += 1;
			const detail = explainFailure((result.stderr || result.stdout).trim() || "no output");
			return `${prefix}${label} failed (exit ${result.code}).\n${detail}`;
		}
		const body = boundOutput((result.stdout || result.stderr).trim() || "(no results)", options.head);
		return `${prefix}${body}`;
	});
	return { text: sections.join("\n\n"), failed };
}

/**
 * Run an index command, healing the one failure this extension's own pre-seed can cause.
 *
 * `ensureNestedRepoInclude` (src/config.ts) writes the *node* CLI's manifest into a workspace that has
 * none, because that generation skips nested git repositories without it. A `zg` that does not read that
 * shape refuses the whole command, so the seed is dropped and the command runs again — that generation
 * needs no seed at all. The caller owns the filesystem and passes `discardSeed`, so this stays a module
 * about argv and `spawn`; it is consulted only for the manifest refusal, never for an ordinary failure,
 * and answers whether it removed the seed.
 */
export async function indexWorkspace(
	cli: ZgCli,
	args: readonly string[],
	options: ExecOptions & { discardSeed?: () => boolean },
): Promise<ExecResult> {
	const { discardSeed, ...runOptions } = options;
	const first = await cli.run([...args], runOptions);
	if (first.code === 0 || !discardSeed) return first;
	// `rebuild_required` in the engine's manifest reader is the only place this sentence comes from, and
	// every reason it fires — an index version it does not support, the node manifest's unknown fields,
	// unreadable JSON — is a manifest it will not use.
	if (!`${first.stderr}\n${first.stdout}`.includes("rebuild the index with")) return first;
	if (!discardSeed()) return first;
	return cli.run([...args], runOptions);
}

/** Parse `/zg-index [--rebuild] [--drop] [--root <path>] [embedding-model]`. */
export function parseIndexArgs(args: string): {
	rebuild: boolean;
	drop: boolean;
	root?: string;
	model?: string;
} {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const rootFlag = tokens.indexOf("--root");
	const root = rootFlag === -1 ? undefined : tokens[rootFlag + 1]?.trim() || undefined;
	const model = tokens.find(
		(token, index) => !token.startsWith("-") && (rootFlag === -1 || index !== rootFlag + 1),
	);
	return {
		rebuild: tokens.includes("--rebuild"),
		drop: tokens.includes("--drop"),
		root,
		model,
	};
}

/** argv for `zg --server <action>`, in the generation's spelling. */
export function serverArgs(style: CliStyle, action: "on" | "off" | "status"): string[] {
	return style === "legacy" ? ["server", action] : ["--server", action];
}

export async function serverAction(
	cli: ZgCli,
	style: CliStyle,
	action: "on" | "off" | "status",
	cwd: string,
): Promise<ExecResult> {
	return cli.run(serverArgs(style, action), { cwd, timeout: SERVER_TIMEOUT_MS });
}

/** `PID: 12345` from a `--server status` answer, or `undefined` when it named none. */
export function daemonPid(text: string): string | undefined {
	const match = /^\s*PID:\s*(\d+)\s*$/m.exec(text);
	return match?.[1];
}

export type ServerState = {
	/** A daemon answers on this home's address. */
	ready: boolean;
	/** This call started it, rather than finding one already running. */
	started: boolean;
	/** `PID 12345`, the failure text, or "" — what a status line can say after the word daemon. */
	detail: string;
};

/**
 * Ensure the shared daemon is running, and **reuse** one that already is.
 *
 * The daemon is per *home* (`ZVEC_GREP_HOME`, else `$HOME/.zvec-grep`) and per machine: one process
 * serves every session that resolves the same home, and a `zg --server on` from a second session
 * answers with the first one's PID. None of that coordination is done here — `start_server` closes the
 * check/spawn race itself with a cross-process startup claim ("the winner alone may spawn; waiters
 * re-check state after the claim is released and reuse the ready daemon"), so N sessions starting at
 * once still end with one daemon and no error.
 *
 * `--check-ready` makes the exit code the answer, which is why the modern generation is asked that way.
 * The legacy generation has no such flag, so its printed state is read instead.
 *
 * Measured against 0.3.0: ~120 ms when a daemon answers, ~360 ms cold, ~110 ms when `on` only has to
 * reuse. Cheap enough to run once per session, which is what `session_start` does.
 */
export async function ensureServer(cli: ZgCli, style: CliStyle, cwd: string): Promise<ServerState> {
	const args = serverArgs(style, "status");
	if (style !== "legacy") args.push("--check-ready");
	const status = await cli.run(args, { cwd, timeout: SERVER_TIMEOUT_MS });
	const ready =
		style === "legacy" ? status.code === 0 && /\bready\b/i.test(status.stdout) : status.code === 0;
	if (ready) {
		const pid = daemonPid(status.stdout);
		return { ready: true, started: false, detail: pid ? `on (PID ${pid})` : "on" };
	}
	const started = await serverAction(cli, style, "on", cwd);
	const text = `${started.stdout}\n${started.stderr}`.trim();
	if (started.code !== 0) {
		return { ready: false, started: false, detail: lastNonEmptyLine(text) || `off (exit ${started.code})` };
	}
	const pid = daemonPid(started.stdout);
	return { ready: true, started: true, detail: pid ? `on (PID ${pid})` : "on" };
}

/** argv for a build. No model means `zg`'s own default for a new index. */
export function indexBuildArgs(
	style: CliStyle,
	options: { model?: string; rebuild?: boolean } = {},
): string[] {
	const args = style === "legacy" ? ["index"] : ["--index"];
	if (options.model) args.push("--embedding", options.model);
	if (options.rebuild) args.push("--rebuild");
	return args;
}

export type IndexBuildOutcome = { args: string[]; pid?: number };

/**
 * Start a build and walk away.
 *
 * Deliberately not `spawnExec`: that awaits its child and kills it when the run's signal aborts, and a
 * build is neither — it outlives the cell, the turn and this process. `detached` puts it in its own
 * process group, `stdio: "ignore"` denies it a pipe whose owner might go away, and `unref` lets this
 * process exit without waiting for it. With a daemon up the child's own `--index` posts
 * `/admin/index`, so the *daemon* does the work and `submit` joins a job another session already
 * started for the same root.
 */
export function startIndexBuild(
	binary: string,
	style: CliStyle,
	root: string,
	options: { model?: string; rebuild?: boolean } = {},
): IndexBuildOutcome {
	const args = indexBuildArgs(style, options);
	try {
		const child = spawn(binary, args, {
			cwd: root,
			shell: false,
			detached: true,
			stdio: "ignore",
		});
		// A missing binary arrives asynchronously; the search that got us here already reported it.
		child.on("error", () => {});
		child.unref();
		return { args, pid: child.pid };
	} catch {
		return { args };
	}
}

/**
 * Whether a failed search means "this workspace has no *usable* index", and what repairing it takes.
 *
 * Three sentences reach here, all of them from the engine, and the distinction matters because one
 * repairs by building and the other two by rebuilding: a workspace with nothing indexed (`No index
 * found in …`), an index another `zg` version wrote (`This index is incompatible with the current
 * version of zg`), and a manifest whose index version the engine does not support (`unsupported index
 * version … rebuild the index with …`, the `rebuild_required` reader).
 */
export function indexRepairFor(detail: string): { rebuild: boolean } | undefined {
	if (
		!/no index found|index is incompatible|rebuild the index|unsupported index version|rebuild_required/i.test(
			detail,
		)
	) {
		return undefined;
	}
	return { rebuild: /\brebuild\b/i.test(detail) };
}
