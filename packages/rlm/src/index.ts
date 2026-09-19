/**
 * PROTOTYPE — do not ship.
 *
 * Wayfinder ticket 08, **Code-mode end-to-end spike**. Answers one question:
 * can pi's built-in tool surface be replaced by a single persistent monty
 * kernel, and is that usable for real work?
 *
 * Implements the contract from **The kernel namespace and tool contract** (05)
 * closely enough to be judged, and deliberately no further: no journal, no
 * durability, no Magic Context integration, no background handles, no
 * `agent_message`.
 *
 * The kernel runs **in this process**. pi is a compiled Bun binary, where a
 * bare-specifier `require()` at runtime cannot resolve an on-disk package, so
 * `@pydantic/monty`'s generated napi loader fails with "Cannot find native
 * binding". The loader checks `NAPI_RS_NATIVE_LIBRARY_PATH` *first*, so
 * pointing it at the platform package's `.node` before a dynamic import — see
 * `loadMonty` — is enough. No sidecar, no extra runtime.
 *
 * Run it:
 *
 *   MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty \
 *   pi -ne -e .scratch/rlm-extension/spike/code-mode/index.ts -nbt -na \
 *      --session-dir .scratch/rlm-extension/spike/code-mode/transcripts -- "your task"
 *
 * Environment overrides: `RLM_FD`, `RLM_ZG`, `RLM_SHELL`.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createChildManager, findModels, headerParentSession, journalSourceOf, modelRuntime, readChildProvenance, resolveOwnDepth } from "./children";
import type { ChildKernelContext, ChildHandle, Notice } from "./children";
import { createBackgroundManager } from "./background";
import type { BgHandleInfo } from "./background";
import { bindToParentInstance, magicContextChildShim, magicContextStatus } from "./magic-context";
import { findRsiSeam, reportCapability, reportHostCall, reportUsage, rsiChildFactory, rsiStatus, seamSkill, seamSkills } from "./rsi-seam";
import { beforeAgentStartResult } from "./skills-block";

const HERE = dirname(fileURLToPath(import.meta.url));
const FD = process.env.RLM_FD ?? "/nix/store/5j3vslc4gccb95xnzr1mxhgwrc0wfgad-fd-10.4.2/bin/fd";
const ZG = process.env.RLM_ZG ?? "zg";
const SHELL = process.env.RLM_SHELL ?? process.env.SHELL ?? "/bin/bash";
const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;
const MAX_DEPTH = 2;
const MAX_LIVE_CHILDREN = 8;
const MAX_LIVE_BACKGROUND = 8;

const MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
};

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image"; data: string; mimeType: string };
type Attachment = ImagePart & { path: string };
type RunResult = { stdout: string; stderr: string; exitCode: number | null; killed: boolean };
type Match = { path: string | null; line: number | null; text: string };

type MontyPool = Awaited<ReturnType<typeof MontyModule.Monty.create>>;


const str = (value: unknown): string => (value === null || value === undefined ? "" : String(value));
const num = (value: unknown, fallback: number): number => (typeof value === "number" ? value : fallback);
const bool = (value: unknown): boolean => value === true;
const errorText = (value: unknown): string => (value instanceof Error ? value.message : String(value));

// ---------------------------------------------------------------------------
// Loading the napi addon inside a compiled Bun binary
// ---------------------------------------------------------------------------

/** Find the platform package's `.node` without using a resolver that cannot see disk. */
function findBinding(startDir: string): string | null {
	let dir = startDir;
	for (let hop = 0; hop < 8; hop++) {
		const scope = join(dir, "node_modules", "@pydantic");
		if (existsSync(scope)) {
			for (const entry of readdirSync(scope)) {
				if (!entry.startsWith("monty-")) continue;
				const packageDir = join(scope, entry);
				for (const file of readdirSync(packageDir)) {
					if (file.endsWith(".node")) return join(packageDir, file);
				}
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

let montyModule: typeof MontyModule | null = null;

// Type-only, so it is erased: ANY static value import of the monty package loads
// the napi addon before `loadMonty` can point the loader at the binding.
import type * as MontyModule from "@pydantic/monty/node";
import { appendJournal, readJournal, readJournals, recordingHost, replayHost, restoredLine } from "./journal";
import type { CellRecord, HostCallRecord, HostFns, RestoreReport } from "./journal";
import { prelude } from "./prelude";
import { renderValue } from "./render";
import { instantiateWebHook, resolveWebHook, webDescriptionSuffix, webPromptGuidelines } from "./web-hook";

/** The installed client's version, or null when it cannot be read. */
function clientVersion(): string | null {
	let dir = HERE;
	for (let hop = 0; hop < 8; hop++) {
		const candidate = join(dir, "node_modules", "@pydantic", "monty", "package.json");
		if (existsSync(candidate)) {
			try {
				const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
				return parsed.version ?? null;
			} catch {
				return null;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

async function loadMonty(): Promise<typeof MontyModule> {
	if (montyModule) return montyModule;
	const previous = process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
	const binding = findBinding(HERE);
	if (binding) process.env.NAPI_RS_NATIVE_LIBRARY_PATH = binding;
	try {
		// Must be dynamic: the loading assignment has to happen before the addon loads.
		const loaded: typeof MontyModule = await import("@pydantic/monty/node");
		montyModule = loaded;
	} finally {
		if (previous === undefined) delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
		else process.env.NAPI_RS_NATIVE_LIBRARY_PATH = previous;
	}
	return montyModule;
}

// ---------------------------------------------------------------------------
// Output handling
// ---------------------------------------------------------------------------

function truncate(text: string, maxLines = MAX_LINES, maxBytes = MAX_BYTES) {
	const lines = text.split("\n");
	const kept: string[] = [];
	let bytes = 0;
	for (const line of lines) {
		if (kept.length >= maxLines) break;
		const size = Buffer.byteLength(line) + 1;
		if (bytes + size > maxBytes) break;
		kept.push(line);
		bytes += size;
	}
	return { text: kept.join("\n"), truncated: kept.length < lines.length, totalLines: lines.length, shownLines: kept.length };
}

function spill(text: string, label: string): string | null {
	try {
		const path = join(mkdtempSync(join(tmpdir(), "rlm-cell-")), `${label}.txt`);
		writeFileSync(path, text);
		return path;
	} catch {
		return null;
	}
}

function run(
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutSeconds?: number | null } = {},
): Promise<RunResult> {
	return new Promise<RunResult>((resolvePromise) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(command, args, {
				cwd: options.cwd,
				env: options.env ?? process.env,
				detached: process.platform !== "win32",
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			resolvePromise({ stdout: "", stderr: String(error), exitCode: null, killed: false });
			return;
		}
		let stdout = "";
		let stderr = "";
		let killed = false;
		child.stdout?.on("data", (chunk: Buffer) => {
			if (stdout.length < 8 * MAX_BYTES) stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			if (stderr.length < 8 * MAX_BYTES) stderr += chunk.toString();
		});
		const timer =
			options.timeoutSeconds != null
				? setTimeout(() => {
						killed = true;
						try {
							if (child.pid) process.kill(-child.pid, "SIGKILL");
						} catch {
							child.kill("SIGKILL");
						}
					}, options.timeoutSeconds * 1000)
				: undefined;
		const finish = (code: number | null, error: string | null) => {
			if (timer) clearTimeout(timer);
			resolvePromise({ stdout, stderr: error ? `${stderr}\n${error}` : stderr, exitCode: code, killed });
		};
		child.on("error", (error: Error) => finish(null, String(error?.message ?? error)));
		child.on("close", (code: number | null) => finish(code, null));
	});
}

// ---------------------------------------------------------------------------
// Host functions
// ---------------------------------------------------------------------------

function parseZgOutput(text: string): Match[] {
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

function bind(args: unknown[], names: string[]): Record<string, unknown> {
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
 * The identity every seam report carries. `makeHost` is a module-level function and cannot
 * see the kernel's closure, so the live session installs its caller here at `session_start`
 * and clears it at shutdown. `undefined` means "no session yet", and every report is inert.
 */
let seamCallerRef: (() => { sessionFile?: string; cwd?: string }) | undefined;

function seamCaller(): { sessionFile?: string; cwd?: string } {
	return seamCallerRef?.() ?? {};
}

function makeHost(
	root: string,
	attachments: Attachment[],
	progress: ((text: string) => void) | undefined,
	extra: HostFns,
	backgroundManager: ReturnType<typeof createBackgroundManager>,
): HostFns {
	return {
		async bash_host(...args: unknown[]) {
			const { command, timeout, background } = bind(args, ["command", "timeout", "background"]);
			// RSI's counted backstop (ticket 02): a bash command can always reach the store,
			// so its path-looking tokens are offered to RSI, which owns the matching.
			reportHostCall(str(command), seamCaller());
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

		// Injected last so the delegation surface (ticket 06) always wins.
		...extra,
	};
}

// ---------------------------------------------------------------------------
// Prelude
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

// The web hook is resolved once, at load time, so the tool description can promise
// exactly what exists (map ticket 03). Top-level await is accepted by pi's loader,
// and the environment cannot change under a running session.
const webHook = await resolveWebHook();

export default function (pi: any) {
	return createKernel(pi, null);
}

/**
 * The session file as an absolute host path. pi hands it over exactly as it was
 * configured, so `--session-dir sessions` yields `sessions/<id>.jsonl` — relative, and
 * monty refuses a relative *virtual* path, which killed the kernel before the first cell
 * (ticket 12). Every derived path (scratch, journal, dump) is built from this one.
 */
export function sessionFilePath(ctx: any): string | undefined {
	const file: string | undefined = ctx?.sessionManager?.getSessionFile?.();
	return file ? resolve(file) : undefined;
}

/**
 * The kernel, for a root session (`childContext === null`) or for a child created
 * by `rlm.spawn`. A child gets the same tool surface but **no ambient extensions**
 * (ticket 07), and its delegation calls route through the spawner that made it.
 */
export function createKernel(pi: any, childContext: ChildKernelContext | null) {
	let pool: Awaited<ReturnType<typeof MontyModule.Monty.create>> | null = null;
	let session: Awaited<ReturnType<MontyPool["checkout"]>> | null = null;
	let mount: InstanceType<typeof MontyModule.MountDir> | null = null;
	let scratchMount: InstanceType<typeof MontyModule.MountDir> | null = null;
	let root = "";
	let scratch = "";
	let attachments: Attachment[] = [];
	let queue: Promise<void> = Promise.resolve();
	let starting: Promise<void> | null = null;
	let journalPath = "";
	let dumpPath = "";
	let journal: CellRecord[] = [];
	let restored: RestoreReport | null = null;
	let startReason = "startup";
	// Web host functions (ticket 03). The factory is called once per kernel with this
	// kernel's context, so a child's fetches spill into the child's own scratch.
	let webFns: HostFns = {};
	let webNotified = false;
	let currentProgress: ((text: string) => void) | undefined;
	let previousSessionFile: string | undefined;
	// A fork's source as *the fork's own session records it*. pi's CLI `--fork <path>`
	// copies the history into a new session and starts it as `"startup"` with no
	// `previousSessionFile` (ticket 13), so the header is the only signal that survives.
	let parentSessionFile: string | undefined;
	/** Set when a restore stopped early, so the state is never dumped as if complete. */
	let kernelIncomplete = false;
	let sessionCtx: any = null;
	let currentCell = "";
	// v2 ticket 10: this session's own depth, resolved from its artifacts rather than
	// from what it was told, so a resumed child still knows how deep it is.
	let ownDepth = childContext ? childContext.depth : 0;
	const notices: Notice[] = [];
	let parentBusy = false;
	const manager = childContext
		? null
		: createChildManager({
				cwd: () => root || process.cwd(),
				ownSessionFile: () => sessionCtx?.sessionManager?.getSessionFile?.(),
				kernelFactoryFor: (child) => (childPi: any) => createKernel(childPi, child),
				// RSI offers its child factory through the seam (ticket 11); RLM never names
				// RSI, and an RSI that is absent or too old contributes nothing.
				childFactories: (request) => [magicContextChildShim(request.parentSessionFile), ...rsiChildFactory(request)],
				runtime: () => modelRuntime(),
				maxDepth: MAX_DEPTH,
				maxLive: MAX_LIVE_CHILDREN,
			});
	const bgReads = new Set<string>();
	const background = createBackgroundManager({
		cwd: () => root || process.cwd(),
		logDir: () => (journalPath ? `${journalPath}.bg` : join(tmpdir(), `rlm-bg-${process.pid}`)),
		cap: MAX_LIVE_BACKGROUND,
		onRecord: (record) => {
			try {
				pi.appendEntry("rlm-bg", record);
			} catch {
				// Bookkeeping must not fail a handle that started.
			}
		},
		onFinish: (record) => {
			dispatchNotice({
				key: `bg:${record.id}`,
				content: `[${record.id}] ${record.status}${record.reason ? ` (${record.reason})` : record.exit_code !== null ? ` (exit ${record.exit_code})` : ""} — ${record.command.split("\n")[0]?.slice(0, 120) ?? ""}${record.log_path ? `\noutput: ${record.log_path}` : ""}`,
				cancelled: () => bgReads.has(record.id),
			});
		},
	});

	/**
	 * Scratch lives beside the session file so it survives a resume, and is mounted
	 * read-write at its real host path so `bash` agrees on the path. It is never
	 * deleted during the session: journal replay re-reads it (ticket 14).
	 */
	function scratchDirFor(ctx: any): string {
		const sessionFile = sessionFilePath(ctx);
		return sessionFile ? `${sessionFile}.scratch` : join(tmpdir(), `rlm-scratch-${process.pid}`);
	}

	/**
	 * Which journals this kernel replays, and the fork it is seeded from when it is one
	 * (ticket 13/14; the rule and its reasons live in `journalSourceOf`).
	 */
	function journalSource(ctx: any): { records: CellRecord[]; seedFrom?: string } {
		const ownFile = sessionFilePath(ctx);
		const ownRecords = ownFile ? readJournal(`${ownFile}.rlm-journal.jsonl`) : [];
		const source = journalSourceOf({
			ownSessionFile: ownFile,
			ownFirstIndex: ownRecords[0]?.index,
			startReason,
			previousSessionFile,
			parentSessionFile,
			// A resumed child is a child even though no `childContext` is in play.
			isChild: childContext !== null || readChildProvenance(ctx?.sessionManager) !== null,
		});
		if (!source) return { records: [] };
		return { records: readJournals(source.files), seedFrom: source.seedFrom };
	}

	async function startKernel(ctx: any) {
		const monty = await loadMonty();
		const cwd: string = ctx?.cwd ?? process.cwd();
		scratch = scratchDirFor(ctx);
		mkdirSync(scratch, { recursive: true });
		const started = await monty.Monty.create();
		pool = started;
		session = await started.checkout({ limits: { maxMemory: 1_000_000_000, maxSuspensions: 100_000 } });
		mount = new monty.MountDir({ hostPath: cwd, virtualPath: cwd, mode: "read-write" });
		scratchMount = new monty.MountDir({ hostPath: scratch, virtualPath: scratch, mode: "read-write" });
		root = cwd;
		const sessionFile = sessionFilePath(ctx);
		journalPath = sessionFile ? `${sessionFile}.rlm-journal.jsonl` : "";
		dumpPath = sessionFile ? `${sessionFile}.rlm-dump.bin` : "";
		currentProgress = undefined;
		const web = instantiateWebHook(webHook, { cwd, sessionFile, progress: (text) => currentProgress?.(text) });
		webFns = web.status === "injected" ? (web.fns as HostFns) : {};
		if (web.status === "error") {
			// A plan error is already recorded at session_start; only a factory failure is news here.
			if (webHook.status === "loaded") {
				try {
					pi.appendEntry("rlm-web", { module: webHook.module, status: "error", reason: web.reason });
				} catch {
					/* a record must never fail a kernel */
				}
			}
			if (!webNotified) {
				webNotified = true;
				dispatchNotice({ key: "web", customType: "rlm-web", content: `web host functions unavailable: ${web.reason}` });
			}
		}
		// The dump fast path must come first: `loadSession` refuses a session that has
		// already been fed, and a matching dump already contains the prelude's state.
		if (await restoreFromDump(ctx)) return;
		await session.feedRun(prelude(cwd, scratch), { mount: [mount, scratchMount] });
		await restoreFromJournal(ctx, cwd);
	}

	/**
	 * The dump fast path (ticket 04). A **stale** dump — the client changed, so the
	 * version-locked bytes are unreadable — is ignored silently, because replay is the
	 * fallback rather than an error. A dump that matches but still fails to load is a
	 * bug, so it is recorded.
	 */
	async function restoreFromDump(ctx: any): Promise<boolean> {
		const { records } = journalSource(ctx);
		if (records.length === 0 || !existsSync(dumpPath)) return false;
		try {
			const meta = JSON.parse(readFileSync(`${dumpPath}.json`, "utf8")) as { client?: string; cells?: number };
			// `cells` is what the kernel held when the dump was written, so a dump from a
			// partially rebuilt kernel (or from before a fork's fragment existed) is stale
			// here and replay is the honest path.
			if (meta.client !== clientVersion() || meta.cells !== records.length) return false;
			await session?.loadSession(readFileSync(dumpPath));
			journal = records.slice();
			restored = {
				cells: records.length,
				hostCalls: 0,
				partial: false,
				note: `restored from a dump taken at cell ${records.length}`,
			};
			return true;
		} catch (error) {
			try {
				pi.appendEntry("rlm-dump", { problem: errorText(error), cells: records.length });
			} catch {
				/* diagnostics only */
			}
			return false;
		}
	}

	/** Written at `agent_end` and shutdown: per cell would serialise a trivial namespace. */
	async function dumpKernel(): Promise<void> {
		// A kernel rebuilt only in part must not be frozen into a dump: the next resume would
		// accept it as complete (the cell count matches) and the missing cells would be gone
		// for good. Replay stays the path until the session is rebuilt in full.
		if (kernelIncomplete) return;
		if (!session || !dumpPath || journal.length === 0) return;
		try {
			const bytes = await session.dump();
			writeFileSync(dumpPath, bytes as Uint8Array);
			writeFileSync(`${dumpPath}.json`, JSON.stringify({ client: clientVersion(), cells: journal.length, at: new Date().toISOString() }));
		} catch {
			// A dump is an optimisation; failing to write one must never fail a turn.
		}
	}

	/**
	 * Journal-and-replay (ticket 04). Replay is *reconstruction*: every journaled
	 * cell runs as ONE composite feed over `overlay` mounts — so it cannot write to
	 * the host — while host functions are served from the journal instead of being
	 * executed. One feed, not one per cell, because monty resets the overlay every
	 * feed and read-after-write across cells has to survive.
	 */
	async function restoreFromJournal(ctx: any, cwd: string) {
		const { records, seedFrom } = journalSource(ctx);
		if (records.length === 0) return;
		const monty = await loadMonty();

		// Ticket 14: a fork gets the source's scratch. A cell that read a file `bash`
		// produced only replays against real on-disk scratch, and replay stops at the
		// first failure, so an empty fork scratch would cost the whole namespace.
		let scratchNote: string | undefined;
		if (seedFrom) {
			// Seeding is one-shot: only a fork with no journal of its own needs the copy, and
			// only then is the source's scratch the one its cells were written against.
			const sourceScratch = `${seedFrom}.scratch`;
			if (existsSync(sourceScratch)) {
				try {
					cpSync(sourceScratch, scratch, { recursive: true });
				} catch (error) {
					scratchNote = `scratch copy failed: ${errorText(error)}`;
				}
			}
		}

		const replay = replayHost(records.flatMap((record) => record.hostCalls));
		const silent = new monty.CollectStreams();
		let failure: string | null = null;
		try {
			await session?.feedRun(records.map((record) => record.code).join("\n"), {
				mount: [
					new monty.MountDir({ hostPath: cwd, virtualPath: cwd, mode: "overlay" }),
					new monty.MountDir({ hostPath: scratch, virtualPath: scratch, mode: "overlay" }),
				],
				printCallback: silent,
				externalLookup: replay.host,
			});
		} catch (error) {
			const detail =
				error instanceof monty.MontyRuntimeError || error instanceof monty.MontySyntaxError
					? error.display("type-msg")
					: errorText(error);
			failure = detail.split("\n")[0] ?? "replay failed";
		}

		const consumed = replay.consumed();
		let seen = 0;
		let failedCell: number | null = null;
		for (let index = 0; index < records.length; index += 1) {
			seen += records[index]?.hostCalls.length ?? 0;
			if (seen > consumed) {
				failedCell = index;
				break;
			}
		}
		journal = records.slice();
		kernelIncomplete = Boolean(failure);
		restored = {
			cells: records.length,
			hostCalls: consumed,
			partial: Boolean(failure),
			note:
				[scratchNote, failure ? `stopped in cell ${failedCell ?? "?"}: ${failure}` : undefined]
					.filter(Boolean)
					.join("; ") || undefined,
		};
	}

	function journalCell(code: string, hostCalls: HostCallRecord[], durationMs: number) {
		if (!journalPath) return;
		const record: CellRecord = {
			index: journal.length,
			code,
			hostCalls,
			durationMs,
			at: new Date().toISOString(),
		};
		journal.push(record);
		appendJournal(journalPath, record);
		try {
			// Metadata only, so it costs no LLM context; the payload is the file above.
			pi.appendEntry("rlm-cell", { index: record.index, hostCalls: hostCalls.length, durationMs });
		} catch {
			// The transcript entry is bookkeeping; its absence must not fail the cell.
		}
	}

	function ensureKernel(ctx: any) {
		starting ??= startKernel(ctx);
		return starting;
	}

	/**
	 * Post-install preflight (13, 15): loud, once, and creates no pool, so the
	 * kernel stays lazy. A session with a broken kernel must never present as a
	 * working one.
	 */
	async function preflight(): Promise<string[]> {
		const problems: string[] = [];
		try {
			await loadMonty();
		} catch (error) {
			problems.push(
				`the monty binding did not load: ${errorText(error)} — this is the compiled-Bun hazard; the extension points NAPI_RS_NATIVE_LIBRARY_PATH at the platform .node before importing`,
			);
		}
		const workerPath = process.env.MONTY_BIN;
		if (workerPath) {
			if (!existsSync(workerPath)) {
				problems.push(`MONTY_BIN does not exist: ${workerPath}`);
			} else {
				const probe = spawnSync(workerPath, ["--version"], { encoding: "utf8" });
				const reported = String(probe.stdout ?? "").trim();
				const client = clientVersion();
				if (reported && client && !reported.includes(client)) {
					problems.push(
						`client ${client} and worker ${reported} disagree — point MONTY_BIN at a worker from the same release as @pydantic/monty`,
					);
				}
			}
		}
		return problems;
	}

	/**
	 * Child notices (ticket 06). pi cannot retract a delivered message, so a notice is
	 * held while the parent is mid-turn and dispatched when the agent goes idle —
	 * and dropped if a cell read the child in the meantime, which is the "read
	 * withdraws the notice" rule expressed without retraction.
	 */
	function dispatchNotice(notice: Notice) {
		notices.push(notice);
		trace("dispatch", { key: notice.key, busy: parentBusy, cancelled: notice.cancelled?.() === true });
		flushNotices();
	}

	function trace(stage: string, data: Record<string, unknown>) {
		try {
			pi.appendEntry("rlm-notice-trace", { stage, ...data });
		} catch {
			/* diagnostics must never break anything */
		}
	}

	function flushNotices() {
		if (parentBusy || notices.length === 0) return;
		for (const notice of notices.splice(0)) {
			if (notice.cancelled?.()) {
				trace("flush-cancelled", { key: notice.key });
				continue;
			}
			try {
				pi.sendMessage(
					{ customType: notice.customType ?? "rlm-child", content: notice.content, display: true },
					{ deliverAs: "steer", triggerTurn: true },
				);
				trace("flush-sent", { key: notice.key });
			} catch (error) {
				trace("flush-failed", { key: notice.key, error: errorText(error) });
			}
		}
	}

	/** The delegation and background surface the kernel sees (tickets 06, 10). */
	/**
	 * The seam's kernel host functions (RSI x RLM tickets 02 and 15). `skills()` and
	 * `skill(name)` are host functions rather than registered tools, because the kernel's
	 * surface is this fixed set (ticket 08). Both report their own consultation, and RSI
	 * does the matching and dedupe.
	 */
	function seamHostFns(): HostFns {
		return {
			// The prelude's `skills()`/`skill(name)` wrappers call these by name, so the
			// suffix is part of the contract, not decoration.
			async skills_host() {
				return seamSkills(seamCaller());
			},
			async skill_host(...args: unknown[]) {
				const { name } = bind(args, ["name"]);
				const wanted = str(name).trim();
				if (!wanted) throw new Error("skill(name) requires a name");
				const found = seamSkill(wanted, seamCaller());
				if (!found) {
					throw new Error(
						`no learned skill named "${wanted}" — call skills() for the ones this session can see`,
					);
				}
				reportUsage({ kind: "skill", target: wanted, caller: seamCaller() });
				return { content: found.content, files: found.files };
			},
		};
	}

	function hostExtensions(): HostFns {
		const spawnHandle = async (depth: number, args: unknown[]): Promise<ChildHandle> => {
			const { prompt, name, model, thinking } = bind(args, ["prompt", "name", "model", "thinking"]);
			const label = str(name).trim();
			if (!label) throw new Error("rlm.spawn requires a name");
			const inner = {
				prompt: str(prompt),
				name: label,
				model: model ? str(model) : undefined,
				thinking: thinking ? str(thinking) : undefined,
			};
			if (childContext) {
				// The child's own session file is *its* child's parent — provenance, not the root's.
				return childContext.spawn({
					...inner,
					parentSessionFile: sessionCtx?.sessionManager?.getSessionFile?.(),
					// Provenance at depth >= 2: the cell spawning the grandchild is this kernel's.
					spawnCell: currentCell,
				});
			}
			return manager!.spawn({
				...inner,
				depth,
				spawnCell: currentCell,
				parentSessionFile: sessionCtx?.sessionManager?.getSessionFile?.(),
				ownerDispatch: dispatchNotice,
			});
		};
		return {
			async rlm_spawn(...args: unknown[]) {
				// The depth is absolute: a session that is itself a child spawns one level
				// deeper than its own durable depth, which is what enforces the cap with no
				// root present (v2 ticket 10).
				return spawnHandle(ownDepth + 1, args);
			},
			async rlm_poll(...args: unknown[]) {
				const { selector } = bind(args, ["selector"]);
				return childContext ? childContext.poll(str(selector)) : manager!.poll(str(selector));
			},
			async rlm_list() {
				return childContext ? childContext.list() : manager!.list();
			},
			async rlm_remove(...args: unknown[]) {
				const { selector } = bind(args, ["selector"]);
				return childContext ? childContext.remove(str(selector)) : manager!.remove(str(selector));
			},
			async rlm_send(...args: unknown[]) {
				const { selector, text } = bind(args, ["selector", "text"]);
				return childContext ? childContext.send(str(selector), str(text)) : manager!.send(str(selector), str(text));
			},
			async rlm_find_models(...args: unknown[]) {
				const { query, limit } = bind(args, ["query", "limit"]);
				const text = query ? str(query) : undefined;
				const count = num(limit, 20);
				return childContext ? childContext.findModels(text, count) : findModels(await modelRuntime(), text, count);
			},
			/** v2 ticket 07: what this session's descendants have cost so far. */
			async rlm_tree_cost() {
				return { total_tokens: manager ? manager.treeCost() : 0, own_depth: ownDepth };
			},
			async agent_message_send(...args: unknown[]) {
				const { text, receiver_role } = bind(args, ["text", "receiver_role"]);
				const role = receiver_role ? str(receiver_role) : null;
				if (childContext && (!role || role === "parent")) {
					childContext.onMessage(str(text));
					return { sent: true, to: "parent" };
				}
				if (!childContext && role) {
					const handle = await manager!.send(role, str(text));
					return { sent: true, to: handle.child_id, status: handle.status };
				}
				throw new Error('agent_message.send needs receiver_role="parent" inside a child, or a child id or name at the root');
			},
			async bg_poll(...args: unknown[]) {
				const { id } = bind(args, ["id"]);
				const record = background.poll(str(id));
				if (record.status !== "running") bgReads.add(record.id);
				return record;
			},
			async bg_read(...args: unknown[]) {
				const { id, tail_bytes } = bind(args, ["id", "tail_bytes"]);
				const record = background.poll(str(id));
				if (record.status !== "running") bgReads.add(record.id);
				return background.output(str(id), num(tail_bytes, 0) || undefined);
			},
			async bg_kill(...args: unknown[]) {
				const { id } = bind(args, ["id"]);
				return background.kill(str(id));
			},
			async bg_list() {
				const all = background.list();
				for (const record of all) if (record.status !== "running") bgReads.add(record.id);
				return all;
			},
		};
	}

	function enqueue<T>(work: () => Promise<T>): Promise<T> {
		const next = queue.then(work, work);
		queue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	/**
	 * The code-mode skills block (ticket 16). pi renders no skills for a session whose active
	 * tools are `["python"]`, so RLM appends the block itself: the human tier from the event
	 * plus the learned store from the seam. In any other session this returns `undefined` and
	 * pi's prompt is untouched.
	 */
	pi.on("before_agent_start", async (event: any) => {
		try {
			return beforeAgentStartResult(event, seamCaller());
		} catch {
			// A prompt we cannot build must never take a turn down; the session simply runs
			// without the block, exactly as it did before this existed.
			return undefined;
		}
	});

	pi.on("session_start", async (event: any, ctx: any) => {
		startReason = event?.reason ?? "startup";
		previousSessionFile = event?.previousSessionFile ? resolve(event.previousSessionFile) : undefined;
		// The header, not the event, is what a CLI `--fork <path>` leaves behind (ticket 13).
		parentSessionFile = headerParentSession(ctx?.sessionManager);
		sessionCtx = ctx;
		seamCallerRef = () => ({ sessionFile: ctx?.sessionManager?.getSessionFile?.(), cwd: ctx?.cwd ?? root });
		// v2 ticket 10: this session's own depth comes from its own artifacts — the
		// `rlm-child` entry, or the parentSession chain — so a child resumed without its
		// spawner still knows how deep it is and how much spawning authority it has.
		// Ticket 09: a session that is itself a child is re-served by its parent's Magic
		// Context instance, which is what makes the contract survive a resume.
		const resolvedDepth = resolveOwnDepth({
			sessionManager: ctx?.sessionManager,
			sessionFile: ctx?.sessionManager?.getSessionFile?.(),
			maxDepth: MAX_DEPTH,
		});
		ownDepth = childContext ? childContext.depth : resolvedDepth.depth;
		if (!childContext && resolvedDepth.depth > 0) {
			const provenance = readChildProvenance(ctx?.sessionManager);
			bindToParentInstance({
				childSessionFile: ctx?.sessionManager?.getSessionFile?.(),
				parentSessionFile: provenance?.parentSessionFile,
				cwd: ctx?.cwd,
			});
		}
		pi.setActiveTools(["python"]);
		// The capability fact (RSI x RLM ticket 03): RSI's gate suppresses a session whose
		// active tools lack `write`/`edit`, which is every code-mode session — the kernel
		// can write, but not through a pi tool. The surface is fixed by this point, so this
		// is the right moment to publish it. A child publishes its own; the root's is never
		// inherited, because the fact is keyed by session file.
		reportCapability({
			sessionFile: ctx?.sessionManager?.getSessionFile?.(),
			canWrite: true,
			reason: "code-mode kernel: write_text/edit_text/bash host functions exist",
		});
		const problems = await preflight();
		// Background handles are restored read-only: nothing is ever re-executed.
		try {
			const entries: any[] = ctx?.sessionManager?.getEntries?.() ?? [];
			const previous: BgHandleInfo[] = [];
			for (const entry of entries) {
				if (entry?.type === "custom" && entry.customType === "rlm-bg" && entry.data) previous.push(entry.data as BgHandleInfo);
			}
			if (previous.length > 0) background.restore(previous);
		} catch {
			// Restoration is best effort; a missing record must not fail a session.
		}
		if (problems.length === 0) {
			// UI calls must never break extension logic: in `--mode json` there may be no UI
			// at all, and a throwing `setStatus` would take the record below with it.
			try {
				ctx.ui?.setStatus?.("rlm", "code-mode (monty)");
			} catch {
				/* no UI in this mode */
			}
		}
		if (!childContext) {
			// Recorded unconditionally — including on failure — because this entry is the
			// only durable evidence of whether the kernel and Magic Context were available.
			try {
				pi.appendEntry("rlm-magic-context", {
					status: magicContextStatus(),
					problems,
					startReason,
				});
			} catch {
				/* diagnostics must never fail a session */
			}
		}
		// The RSI seam's status, recorded for every session including a child, so a missing
		// RSI is one visible line rather than a silently absent capability (ticket 15).
		try {
			pi.appendEntry("rlm-rsi", { status: rsiStatus(), startReason });
		} catch {
			/* diagnostics must never fail a session */
		}
		// Web hook bookkeeping (ticket 03): unset is silent and normal; configured is
		// recorded always; broken is recorded, told to the human, and told to the model once.
		if (webHook.status === "loaded") {
			try {
				// The names are the contract, not a fact about this module: what it actually
				// returns is validated per kernel and recorded there if it deviates.
				pi.appendEntry("rlm-web", { module: webHook.module, status: "loaded", contract: ["web_search", "fetch_content"] });
			} catch {
				/* see above */
			}
		} else if (webHook.status === "error") {
			try {
				pi.appendEntry("rlm-web", { module: webHook.module, status: "error", reason: webHook.reason });
			} catch {
				/* see above */
			}
			try {
				ctx.ui?.notify?.(`web host functions unavailable: ${webHook.reason}`, "error");
			} catch {
				/* no UI in this mode */
			}
			// Deliberately no message to the model here: at session_start pi refuses a steer
			// send ("Agent is already processing") and the run dies. The kernel-start path
			// tells the model instead, where steering is legal.
		}
		if (problems.length === 0) return;
		try {
			ctx.ui?.setStatus?.("rlm", "kernel unavailable");
		} catch {
			/* no UI in this mode */
		}
		for (const problem of problems) {
			try {
				ctx.ui?.notify?.(`python kernel: ${problem}`, "error");
			} catch {
				/* no UI in this mode */
			}
			try {
				pi.appendEntry("rlm-preflight", { problem });
			} catch {
				/* see above */
			}
		}
	});

	pi.on("tool_execution_start", async () => {
		parentBusy = true;
	});

	pi.on("agent_end", async () => {
		parentBusy = false;
		flushNotices();
		await dumpKernel();
	});

	pi.on("session_shutdown", async () => {
		seamCallerRef = undefined;
		await dumpKernel();
		await manager?.shutdownAll();
		await background.shutdownAll();
		try {
			await session?.close();
		} catch {
			/* the kernel may already be gone */
		}
		try {
			await pool?.close();
		} catch {
			/* the kernel may already be gone */
		}
		session = null;
		pool = null;
		mount = null;
		scratchMount = null;
		starting = null;
		journal = [];
		journalPath = "";
		restored = null;
		notices.length = 0;
	});

	pi.registerTool({
		name: "python",
		label: "Python",
		description:
			"Run Python in a persistent kernel. Variables, imports and definitions survive between calls. " +
			"The workspace root is available as the constant ROOT, and SCRATCH names a directory for temporary files that " +
			"sits outside the repository and survives a resume. There is no working directory (os.getcwd and os.chdir are " +
			"absent), so use ROOT + '/path' or the read_text/write_text/edit_text/walk helpers, which resolve relative paths " +
			"against ROOT. The kernel is a sandboxed subset of Python 3.14 (monty): there are no third-party packages, no " +
			"generators, no class inheritance, no decorators such as @property, no match statements, and none of enum, time, " +
			"hashlib, random, shutil, subprocess or urllib. Everything host-side is async and must be awaited: await " +
			"bash(...), await find(...), await grep(...), await read_image(...), await rlm.spawn(...), await agent_message.send(...). For real CPython or any library, shell out: " +
			"await bash(\"python3 -c '...'\"). Reading many files is slow through the kernel — each file operation is a " +
			"separate host call — so prefer await bash(\"...\") for bulk reads. Variables, child handles and background handles live in the " +
			"kernel, not in the transcript, and are unaffected when the transcript is compacted. await rlm.spawn(...) delegates a task to a " +
			"child session and returns a handle immediately: it never returns the answer, which arrives later as a message. await bash(...) " +
			"blocks until the command finishes; pass background=True to get a handle instead — h.poll(), h.output(), h.kill(), and await " +
			"bg_list() — and end the turn, because you are notified when it finishes. Output is " +
			"truncated to 2000 lines or 50KB, whichever comes first; when that happens the full output is written to a file and its path is reported." +
			webDescriptionSuffix(webHook),
		promptSnippet: "Run Python in a persistent kernel with host-bridged shell, search, image reads and delegation",
		promptGuidelines: [
			"Use python for work that is stateful, multi-step or data-shaped — parsing, transforming, searching, summarising — instead of chaining many small tool calls.",
			"In python, every host call is awaited: await bash(...), await find(...), await grep(...), await read_image(...), await rlm.spawn(...), await agent_message.send(...). A host call without await returns an unfinished object, not a result.",
			"In python, a host call's result exists only in Python until you print or return it — `await bash(...)` on its own puts nothing in your context. Print the value you mean to read, or it is invisible to you even though the call succeeded.",
			"In python, use read_text, write_text, edit_text and walk for file work; they are plain Python and need no await.",
			'In python there are no third-party imports and no generators, inheritance or decorators. When you need real CPython or a library, use await bash("python3 ...").',
			"In python, bulk file reads are faster through await bash(...) than through the kernel's own open(): each file operation is a separate host call. Use Python loops for logic over files, not for reading many of them.",
			"Use await rlm.spawn(name=..., prompt=...) for work worth doing in parallel or in a cleaner context, then end the turn: the child's answer arrives as a message, and rlm.poll(id) reads its status. rlm.list() shows the children and their tokens; rlm.tree_cost() totals what the whole tree has spent.",
			...webPromptGuidelines(webHook),
		],
		parameters: {
			type: "object",
			properties: { code: { type: "string", description: "Python to run in the persistent kernel" } },
			required: ["code"],
		},

		async execute(_toolCallId: unknown, params: { code: string }, _signal: unknown, onUpdate: any, ctx: any) {
			attachments = [];
			return enqueue(async () => {
				await ensureKernel(ctx);
				const monty = await loadMonty();
				const streams = new monty.CollectStreams();
				const progress = (text: string) => onUpdate?.({ content: [{ type: "text", text }] });
				currentProgress = progress;
				const cellCalls: HostCallRecord[] = [];
				currentCell = String(params.code).split("\n")[0]?.slice(0, 100) ?? "";
				sessionCtx = ctx;
				const started = Date.now();
				let value: unknown;
				let failure: string | null = null;
				try {
					value = await session?.feedRun(params.code, {
						mount: [mount, scratchMount],
						printCallback: streams,
						externalLookup: recordingHost(makeHost(root, attachments, progress, { ...hostExtensions(), ...seamHostFns(), ...webFns }, background), (name, args, result, error) => {
							// A call that raised is journaled too, so the cell that caught it replays
							// (ticket 11) instead of stopping the rebuild.
							cellCalls.push(error ? { name, args, error } : { name, args, result });
						}),
						os: (name: string) => {
							if (/getenv|environ/i.test(name)) {
								const env: Record<string, string> = {};
								for (const [key, v] of Object.entries(process.env)) {
									if (key.startsWith("PI_") && v !== undefined) env[key] = v;
								}
								return env;
							}
							return monty.NOT_HANDLED;
						},
					});
				} catch (error) {
					if (error instanceof monty.MontyRuntimeError || error instanceof monty.MontySyntaxError) {
						failure = error.display("traceback");
					} else if (error instanceof monty.MontyError) {
						failure = error.display("type-msg");
					} else {
						failure = errorText(error);
					}
				}

				if (!failure) journalCell(params.code, cellCalls, Date.now() - started);

				const stdout = streams.output
					.filter((entry) => entry.stream === "stdout")
					.map((entry) => entry.text)
					.join("");
				const stderr = streams.output
					.filter((entry) => entry.stream === "stderr")
					.map((entry) => entry.text)
					.join("");

				let body = "";
				if (restored) {
					body += `${restoredLine(restored)}\n`;
					restored = null;
				}
				body += stdout;
				if (value !== undefined && value !== null) {
					// A Python dict arrives as a JS Map; renderValue converts it (see render.ts).
					body += `${body && !body.endsWith("\n") ? "\n" : ""}# => ${renderValue(value)}\n`;
				}
				if (failure) body += `${body.endsWith("\n") || !body ? "" : "\n"}${failure}`;

				const cut = truncate(body || "(no output)");
				let text = cut.text;
				let fullOutputPath: string | null = null;
				if (cut.truncated) {
					fullOutputPath = spill(body, "python");
					text += `\n\n[Output truncated: ${cut.shownLines} of ${cut.totalLines} lines.${fullOutputPath ? ` Full output saved to: ${fullOutputPath}]` : "]"}`;
				}

				const parts: Array<TextPart | ImagePart> = [{ type: "text", text }];
				for (const attachment of attachments) {
					parts.push({ type: "image", data: attachment.data, mimeType: attachment.mimeType });
				}

				return {
					content: parts,
					details: {
						cell: String(params.code).split("\n")[0].slice(0, 100),
						durationMs: Date.now() - started,
						truncated: cut.truncated,
						fullOutputPath,
						failed: Boolean(failure),
						stderr: stderr ? stderr.slice(0, 400) : undefined,
					},
				};
			});
		},
	});
}
