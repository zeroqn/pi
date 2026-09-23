/**
 * The kernel: a monty session (pool, checkout, mounts), the prelude it is fed, the journal
 * and dump that outlive it, mid-feed rotation when the suspension budget nears its ceiling,
 * the host functions it reaches the host with, and the `python` tool that drives all of it.
 *
 * Everything agent-shaped has left (map ticket 03's table): children, notices, the owner seams,
 * the RSI seam, the skills block and the web hook are contributions now. What
 * stays is the sandbox and its durability — and three things the kernel *asks for* rather
 * than owns: the provenance rule (`provenance`), the host-call observer (`onHostCall`) and
 * a notice sink (`onNotice`).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type * as MontyModule from "@pydantic/monty/node";
import { createBackgroundManager } from "./background";
import type { Ledger, KernelHandleCore, Notice, Provenance } from "./contract";
import { makeHost, bind, type Attachment } from "./host";
import { appendJournal, readJournal, readJournals, recordingHost, replayHost, restoredLine } from "./journal";
import type { CellRecord, HostCallRecord, HostFns, RestoreReport } from "./journal";
import { clientVersion, loadMonty } from "./monty";
import { spill, truncate } from "./output";
import { prelude } from "./prelude";
import { renderValue } from "./render";
import { errorText } from "./util";

// ---------------------------------------------------------------------------
// The kernel's suspension budget (see ../../kernel-budget/acceptance.md)
// ---------------------------------------------------------------------------

/**
 * monty's per-checkout host-round-trip budget. Every `bash`/`find`/`os` call, every name
 * lookup and every future resolution is one suspension, counted for the whole session;
 * when it runs out the pool aborts every later feed on its first suspension, so a session
 * that reaches it can no longer make progress.
 */
export const MAX_SUSPENSIONS = 100_000;
/**
 * Where the kernel rotates to a fresh checkout — proactively, with the last tenth held back as
 * headroom for the cell in flight and for a rotation that has to be retried.
 *
 * The rule is a function because the *derivation* is the thing worth testing, and testing it at
 * 90 000 suspensions is a twenty-minute run: `createKernel` takes an optional `limits`, whose
 * default is the constant above, so a test can drive the same code at 100. Nothing in production
 * passes it — there is still one number, and no environment knob to drift out of sync with it.
 */
export function rotateAtFor(maxSuspensions: number): number {
	return Math.floor(maxSuspensions * 0.9);
}
export const ROTATE_AT = rotateAtFor(MAX_SUSPENSIONS);
/** The reserve, split into retry steps so a broken rotation cannot retry per suspension. */
export const ROTATE_BACKOFF = Math.max(1, Math.floor((MAX_SUSPENSIONS - ROTATE_AT) / 8));
/** Consecutive failed rotations after which rotation stops until the next turn. */
export const ROTATE_FAILURE_CAP = 3;
/** Every checkout, so the limits are stated once. */
export const CHECKOUT_LIMITS = { maxMemory: 1_000_000_000, maxSuspensions: MAX_SUSPENSIONS };
const MAX_LIVE_BACKGROUND = 8;

type MontyPool = Awaited<ReturnType<typeof MontyModule.Monty.create>>;

/** What the entry needs from a mounted kernel, beyond `KernelHandleCore`. */
export type Kernel = KernelHandleCore & {
	/** The tool body. `ctx` comes from the tool call, as it always did. */
	execute: (params: { code: string }, onUpdate: unknown, ctx: unknown) => Promise<unknown>;
	/** The kernel's own `session_start` work: background records restored read-only, then
	 * the preflight. Returns the problems, which the entry reports (ticket 03, C7). */
	startSession: (ctx: unknown) => Promise<string[]>;
	/** `agent_end`: a new turn is a fresh chance to rotate, and the kernel is dumped. */
	endTurn: () => Promise<void>;
	/** Dump, stop the background handles, close the checkout and the pool. Code mode owns
	 * this end to end (ticket 01 §6); nothing waits on rlm's handler or is waited on by it. */
	shutdown: () => Promise<void>;
};

/**
 * The session file as an absolute host path. pi hands it over exactly as it was
 * configured, so `--session-dir sessions` yields `sessions/<id>.jsonl` — relative, and
 * monty refuses a relative *virtual* path. Every derived path (scratch, journal, dump) is
 * built from this one. rlm keeps its own three-line copy for provenance; the *key* a
 * kernel is mounted under comes from `contract.ts`.
 */
export function sessionFilePath(ctx: any): string | undefined {
	const file: string | undefined = ctx?.sessionManager?.getSessionFile?.();
	return file ? resolve(file) : undefined;
}

export function createKernel(options: {
	pi: any;
	sessionKey: string;
	ledger: Ledger;
	/** Test seam, and only that: production passes nothing and gets the constants above. A
	 * small `maxSuspensions` lets a test cross the reserve in seconds, which is the difference
	 * between asserting the rotation's *outcomes* and waiting twenty minutes for them. */
	limits?: { maxMemory?: number; maxSuspensions?: number };
}): Kernel {
	const { pi, ledger } = options;
	const maxSuspensions = options.limits?.maxSuspensions ?? MAX_SUSPENSIONS;
	const checkoutLimits = { maxMemory: options.limits?.maxMemory ?? CHECKOUT_LIMITS.maxMemory, maxSuspensions };
	const rotateAt = rotateAtFor(maxSuspensions);
	const rotateBackoff = Math.max(1, Math.floor((maxSuspensions - rotateAt) / 8));
	let pool: MontyPool | null = null;
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
	let currentProgress: ((text: string) => void) | undefined;
	/** Set when a restore stopped early, so the state is never dumped as if complete. */
	let kernelIncomplete = false;
	/** Suspensions this checkout has received; reset by every rotation, as the pool's count is. */
	let suspensions = 0;
	/** The count at which the next rotation attempt is allowed (backoff after a failure). */
	let rotateRetryAt = rotateAt < maxSuspensions ? rotateAt : Number.POSITIVE_INFINITY;
	let rotateFailures = 0;
	/** Rotations performed inside the current cell, for the notice. */
	let cellRotations = 0;
	let cellRotateFailure: string | null = null;
	let cellAbort: string | null = null;
	let sessionCtx: any = null;
	let currentCell = "";
	let problemsPromise: Promise<string[]> | null = null;
	/** A finished handle is withdrawn from a notice queue when a cell read it (the read rule). */
	const bgReads = new Set<string>();
	const background = createBackgroundManager({
		cwd: () => root || process.cwd(),
		logDir: () => (journalPath ? `${journalPath}.bg` : join(tmpdir(), `rlm-bg-${process.pid}`)),
		cap: MAX_LIVE_BACKGROUND,
		onRecord: (record) => {
			try {
				// The name stays: it is a contract with sessions already on disk (ticket 03, C5).
				pi.appendEntry("rlm-bg", record);
			} catch {
				// Bookkeeping must not fail a handle that started.
			}
		},
		onFinish: (record) =>
			raiseNotice({
				key: `bg:${record.id}`,
				content: `[${record.id}] ${record.status}${record.reason ? ` (${record.reason})` : record.exit_code !== null ? ` (exit ${record.exit_code})` : ""} — ${record.command.split("\n")[0]?.slice(0, 120) ?? ""}${record.log_path ? `\noutput: ${record.log_path}` : ""}`,
				cancelled: () => bgReads.has(record.id),
			}),
	});

	/**
	 * Notices (ticket 03, C2). rlm's machinery dispatches them when it is present — it holds
	 * one while the agent is mid-turn, which pi cannot undo once delivered. With no
	 * contributor listening, code mode holds them until no cell is running and sends them
	 * itself, so a code-mode-only session still learns that its background handle finished.
	 */
	const ownNotices: Notice[] = [];
	let cellRunning = false;
	function raiseNotice(notice: Notice) {
		if (ledger.notify(notice)) return;
		ownNotices.push(notice);
		flushOwnNotices();
	}
	function flushOwnNotices() {
		if (cellRunning || ownNotices.length === 0) return;
		for (const notice of ownNotices.splice(0)) {
			if (notice.cancelled?.()) continue;
			try {
				pi.sendMessage(
					{ customType: notice.customType ?? "rlm-bg", content: notice.content, display: true },
					{ deliverAs: "steer", triggerTurn: true },
				);
			} catch {
				// A notice must never fail a cell.
			}
		}
	}

	/**
	 * Scratch lives beside the session file so it survives a resume, and is mounted
	 * read-write at its real host path so `bash` agrees on the path. It is never deleted
	 * during the session: journal replay re-reads it.
	 */
	function scratchDirFor(ctx: any): string {
		const sessionFile = sessionFilePath(ctx);
		return sessionFile ? `${sessionFile}.scratch` : join(tmpdir(), `rlm-scratch-${process.pid}`);
	}

	/**
	 * Which journals this kernel replays, and the fork it is seeded from when it is one. The
	 * *rule* is rlm's (v1 ticket 13: a fork's fragment plus its parent's prefix, a child's
	 * own journal only), so it arrives as a contribution; the reading is code mode's, and so
	 * is the one fact the rule needs from here: this session's own first journaled index.
	 */
	function provenanceFor(ctx: any): { records: CellRecord[]; seedFrom?: string } {
		const ownFile = sessionFilePath(ctx);
		const ownRecords = ownFile ? readJournal(`${ownFile}.rlm-journal.jsonl`) : [];
		const answer: Provenance | undefined =
			ledger.provenance(ctx, { sessionFile: ownFile, firstIndex: ownRecords[0]?.index }) ??
			// With no contributor the rule is the trivial one: this session's own journal and no
			// seeding. rlm refines it (a fork's fragment plus its parent's prefix, a child's own
			// journal only) — but "my own cells" is a fact code mode already holds, and a
			// code-mode-only resume that silently started empty instead of replaying its own
			// journal is the outcome ticket 04's Q1 forbids.
			(ownFile ? { journals: [ownFile] } : undefined);
		if (!answer || !Array.isArray(answer.journals) || answer.journals.length === 0) return { records: [] };
		return { records: readJournals(answer.journals), seedFrom: answer.seedScratchFrom };
	}

	async function startKernel(ctx: any) {
		const monty = await loadMonty();
		const cwd: string = ctx?.cwd ?? process.cwd();
		scratch = scratchDirFor(ctx);
		mkdirSync(scratch, { recursive: true });
		const started = await monty.Monty.create();
		pool = started;
		session = await started.checkout({ limits: checkoutLimits });
		mount = new monty.MountDir({ hostPath: cwd, virtualPath: cwd, mode: "read-write" });
		scratchMount = new monty.MountDir({ hostPath: scratch, virtualPath: scratch, mode: "read-write" });
		root = cwd;
		const sessionFile = sessionFilePath(ctx);
		journalPath = sessionFile ? `${sessionFile}.rlm-journal.jsonl` : "";
		dumpPath = sessionFile ? `${sessionFile}.rlm-dump.bin` : "";
		currentProgress = undefined;
		// The window closes with the kernel: the prelude is fed once, so a contribution that
		// arrived later could only half-arrive (ticket 01 §4).
		ledger.close();
		// The dump fast path must come first: `loadSession` refuses a session that has already
		// been fed, and a matching dump already contains the prelude's state.
		if (await restoreFromDump(ctx)) return;
		await session.feedRun(prelude(cwd, scratch) + ledger.preludeTail(), { mount: [mount, scratchMount] });
		await restoreFromJournal(ctx, cwd);
	}

	/**
	 * The dump fast path. A **stale** dump — the client changed, so the version-locked bytes
	 * are unreadable — is ignored silently, because replay is the fallback rather than an
	 * error. A dump that matches but still fails to load is a bug, so it is recorded.
	 *
	 * The sidecar's `schema` is a forward gate only (ticket 04): a missing value reads as 1,
	 * so every dump written before the split still loads, and the split changes no byte of
	 * what monty dumps.
	 */
	async function restoreFromDump(ctx: any): Promise<boolean> {
		const { records } = provenanceFor(ctx);
		if (records.length === 0 || !existsSync(dumpPath)) return false;
		try {
			const meta = JSON.parse(readFileSync(`${dumpPath}.json`, "utf8")) as {
				client?: string;
				cells?: number;
				schema?: number;
			};
			if (meta.schema !== undefined && meta.schema !== 1) return false;
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
			writeFileSync(
				`${dumpPath}.json`,
				JSON.stringify({ schema: 1, client: clientVersion(), cells: journal.length, at: new Date().toISOString() }),
			);
		} catch {
			// A dump is an optimisation; failing to write one must never fail a turn.
		}
	}

	/**
	 * Mid-feed rotation: dump the snapshot in hand, load it into a fresh checkout on the same
	 * pool, close the old session, and hand back the snapshot the new session is holding.
	 * Nothing is lost — the dump carries both the heap and the suspended frame — and the new
	 * checkout's suspension count starts at zero, which is the whole point.
	 *
	 * `snapshot.dump()` is not destructive, so a failed rotation leaves the caller holding a
	 * snapshot it can still resume in the old session.
	 */
	async function rotateKernel(snap: any, feedOptions: any): Promise<any> {
		const bytes = await snap.dump();
		const next = await pool!.checkout({ limits: checkoutLimits });
		let resumed: any;
		try {
			resumed = await next.loadSnapshot(bytes, feedOptions);
		} catch (error) {
			// A failed load poisons the session it was attempted on; the old one is untouched,
			// so only this one has to go.
			try {
				await next.close();
			} catch {
				/* already gone */
			}
			throw error;
		}
		const previous = session;
		session = next;
		try {
			await previous?.close();
		} catch {
			/* the pool releases the worker either way */
		}
		return resumed;
	}

	/**
	 * Runs one cell, rotating the kernel as its budget nears the ceiling.
	 *
	 * `feedStart` + `resumeAuto` rather than `feedRun`: `feedRun` answers every suspension
	 * internally, so neither the count nor the point of interruption is reachable from here —
	 * and a rotation has to happen *at* a suspension, with the snapshot in hand.
	 */
	async function driveCell(code: string, feedOptions: any): Promise<unknown> {
		const monty = await loadMonty();
		let snap: any = await session!.feedStart(code, feedOptions);
		while (!(snap instanceof monty.MontyComplete)) {
			suspensions += 1;
			// A FutureSnapshot's pending promises are tracked by the session that created it,
			// and `loadSnapshot` cannot restore them (monty's own note: "resolve those manually
			// with resume([...])"). Rotating there makes the resumed session's next call die on
			// `worker reported unknown pending call id N`. Rotate at the first suspension that
			// carries no futures instead, so the reserve is a floor rather than an exact landing
			// point — the dump then holds settled results, not a promise nobody can settle.
			const rotatable = !(snap instanceof monty.FutureSnapshot);
			if (rotatable && suspensions >= rotateRetryAt) {
				try {
					const at = suspensions;
					snap = await rotateKernel(snap, feedOptions);
					cellRotations += 1;
					rotateFailures = 0;
					rotateRetryAt = rotateAt;
					suspensions = 0;
					rotateTrace("ok", at);
				} catch (error) {
					// The snapshot we still hold resumes in the old session, so a failed rotation
					// costs the retry and nothing else — but it must not be retried on every
					// suspension, which inside the reserve would be thousands of checkouts.
					rotateFailures += 1;
					cellRotateFailure = errorText(error);
					rotateRetryAt =
						rotateFailures >= ROTATE_FAILURE_CAP ? Number.POSITIVE_INFINITY : suspensions + rotateBackoff;
					rotateTrace("failed", suspensions, cellRotateFailure);
				}
			}
			snap = await snap.resumeAuto();
		}
		return snap.output;
	}

	/** One line per rotation attempt, for the transcript: this is the thing to grep after the fact. */
	function rotateTrace(outcome: string, at: number, reason?: string): void {
		try {
			pi.appendEntry("rlm-rotation", { outcome, at, cell: currentCell, ...(reason ? { reason } : {}) });
		} catch {
			/* diagnostics must never break a kernel */
		}
	}

	/**
	 * True for monty's own over-budget abort — a `RuntimeError` whose message names this
	 * session's limit — and for nothing else. The inner exception arrives structured, so a
	 * user's own `RuntimeError` cannot be mistaken for it.
	 */
	function isSuspensionAbort(error: unknown): boolean {
		const exception = (error as { exception?: { typeName?: string; message?: string } } | null)?.exception;
		return (
			exception?.typeName === "RuntimeError" && exception?.message === `suspension limit ${maxSuspensions} exceeded`
		);
	}

	/**
	 * Last-resort recovery. The abort leaves the worker idle and dumpable, so the session
	 * rotates reactively; if that fails the session is dropped and the next cell rebuilds it
	 * through the ordinary restore path. A kernel that silently refuses every call is the one
	 * outcome this forbids. Returns null on success, or the reason it could not be rebuilt.
	 */
	async function recoverFromAbort(): Promise<string | null> {
		try {
			const bytes = await session!.dump();
			const next = await pool!.checkout({ limits: checkoutLimits });
			await next.loadSession(bytes);
			const previous = session;
			session = next;
			try {
				await previous?.close();
			} catch {
				/* the pool releases the worker either way */
			}
			suspensions = 0;
			rotateFailures = 0;
			rotateRetryAt = rotateAt;
			return null;
		} catch (error) {
			await dropKernel();
			return errorText(error);
		}
	}

	/**
	 * Drops the session *and* its pool, so the next cell's `ensureKernel` rebuilds both.
	 * Closing the pool is not tidiness: `startKernel` creates a new one, so a session dropped
	 * without it leaks a whole set of workers.
	 */
	async function dropKernel(): Promise<void> {
		const doomedSession = session;
		const doomedPool = pool;
		session = null;
		pool = null;
		starting = null;
		suspensions = 0;
		rotateFailures = 0;
		rotateRetryAt = rotateAt;
		try {
			await doomedSession?.close();
		} catch {
			/* the pool is about to go */
		}
		try {
			await doomedPool?.close();
		} catch {
			/* workers exit with it */
		}
	}

	/**
	 * Journal-and-replay. Replay is *reconstruction*: every journaled cell runs as ONE
	 * composite feed over `overlay` mounts — so it cannot write to the host — while host
	 * functions are served from the journal instead of being executed. One feed, not one per
	 * cell, because monty resets the overlay every feed and read-after-write across cells has
	 * to survive.
	 */
	async function restoreFromJournal(ctx: any, cwd: string) {
		const { records, seedFrom } = provenanceFor(ctx);
		if (records.length === 0) return;
		const monty = await loadMonty();

		// A fork gets the source's scratch. A cell that read a file `bash` produced only
		// replays against real on-disk scratch, and replay stops at the first failure, so an
		// empty fork scratch would cost the whole namespace.
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
	 * Preflight: loud, once, and creates no pool, so the kernel stays lazy. A session with a
	 * broken kernel must never present as a working one. The checks are code mode's; the
	 * reporting is the entry's (ticket 03, C7).
	 */
	async function preflight(): Promise<string[]> {
		const found: string[] = [];
		try {
			await loadMonty();
		} catch (error) {
			found.push(
				`the monty binding did not load: ${errorText(error)} — this is the compiled-Bun hazard; the extension points NAPI_RS_NATIVE_LIBRARY_PATH at the platform .node before importing`,
			);
		}
		const workerPath = process.env.MONTY_BIN;
		if (rotateAt >= maxSuspensions) {
			found.push(
				`rotation is disabled: ROTATE_AT (${rotateAt}) is not below MAX_SUSPENSIONS (${maxSuspensions}), so a rotation would fire on every suspension`,
			);
		}
		if (workerPath) {
			if (!existsSync(workerPath)) {
				found.push(`MONTY_BIN does not exist: ${workerPath}`);
			} else {
				const { spawnSync } = await import("node:child_process");
				const probe = spawnSync(workerPath, ["--version"], { encoding: "utf8" });
				const reported = String(probe.stdout ?? "").trim();
				const client = clientVersion();
				if (reported && client && !reported.includes(client)) {
					found.push(
						`client ${client} and worker ${reported} disagree — point MONTY_BIN at a worker from the same release as @pydantic/monty`,
					);
				}
			}
		}
		return found;
	}

	/** The background surface: code mode's own, because the handles are (ticket 03's table). */
	function backgroundHostFns(): HostFns {
		return {
			async bg_poll(...args: unknown[]) {
				const { id } = bind(args, ["id"]);
				const record = background.poll(String(id ?? ""));
				if (record.status !== "running") bgReads.add(record.id);
				return record;
			},
			async bg_read(...args: unknown[]) {
				const { id, tail_bytes } = bind(args, ["id", "tail_bytes"]);
				const record = background.poll(String(id ?? ""));
				if (record.status !== "running") bgReads.add(record.id);
				const tail = typeof tail_bytes === "number" ? tail_bytes : 0;
				return background.output(String(id ?? ""), tail || undefined);
			},
			async bg_kill(...args: unknown[]) {
				const { id } = bind(args, ["id"]);
				return background.kill(String(id ?? ""));
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

	function ensurePreflight(): Promise<string[]> {
		problemsPromise ??= preflight();
		return problemsPromise;
	}

	async function execute(params: { code: string }, onUpdate: any, ctx: any): Promise<unknown> {
		attachments = [];
		cellRunning = true;
		try {
			return await enqueue(async () => {
				// A session with a broken kernel must never present as a working one: the
				// preflight's answer comes before any cell, not as a traceback from inside one.
				const broken = await ensurePreflight();
				if (broken.length > 0) {
					return {
						content: [{ type: "text", text: `# the python kernel is not running: ${broken.join("; ")}` }],
						details: { failed: true },
					};
				}
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
				cellRotations = 0;
				cellRotateFailure = null;
				cellAbort = null;
				const hostFns = makeHost({
					root,
					attachments,
					progress,
					extra: { ...backgroundHostFns(), ...ledger.hostFns() },
					background,
					onHostCall: (name, args) => ledger.hostCall(name, args),
				});
				const feedOptions = {
					mount: [mount, scratchMount],
					printCallback: streams,
					externalLookup: recordingHost(hostFns, (name, args, result, error) => {
						// A call that raised is journaled too, so the cell that caught it replays
						// (rlm-web ticket 11) instead of stopping the rebuild.
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
				};
				try {
					value = await driveCell(params.code, feedOptions);
				} catch (error) {
					if (isSuspensionAbort(error)) {
						const reason = await recoverFromAbort();
						rotateTrace("recovered", suspensions, reason ?? undefined);
						cellAbort =
							reason === null
								? "# kernel budget exhausted: this cell was stopped at a host call and its work is lost.\n# The kernel has been rebuilt; your definitions and values are intact.\n"
								: `# kernel budget exhausted: this cell was stopped at a host call and its work is lost.\n# the kernel could not be rebuilt: ${reason} — the next cell will try again.\n`;
					}
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
					.filter((entry: any) => entry.stream === "stdout")
					.map((entry: any) => entry.text)
					.join("");
				const stderr = streams.output
					.filter((entry: any) => entry.stream === "stderr")
					.map((entry: any) => entry.text)
					.join("");

				let body = "";
				if (restored) {
					body += `${restoredLine(restored)}\n`;
					restored = null;
				}
				if (cellAbort) {
					body += cellAbort;
					cellAbort = null;
				}
				if (cellRotations > 0) {
					body += `# kernel reclaimed mid-cell (${cellRotations}x); nothing was lost.\n`;
				}
				if (cellRotateFailure) {
					body += `# kernel rotation failed (${cellRotateFailure}); the current budget is partly spent, so a later cell may fail before the next turn. Nothing was lost.\n`;
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

				const parts: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
					{ type: "text", text },
				];
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
		} finally {
			cellRunning = false;
			flushOwnNotices();
		}
	}

	async function startSession(ctx: unknown): Promise<string[]> {
		sessionCtx = ctx;
		// Background handles are restored read-only: nothing is ever re-executed.
		try {
			const entries: any[] = (ctx as any)?.sessionManager?.getEntries?.() ?? [];
			const previous: any[] = [];
			for (const entry of entries) {
				if (entry?.type === "custom" && entry.customType === "rlm-bg" && entry.data) previous.push(entry.data);
			}
			if (previous.length > 0) background.restore(previous);
		} catch {
			// Restoration is best effort; a missing record must not fail a session.
		}
		return ensurePreflight();
	}

	async function endTurn(): Promise<void> {
		// A failed rotation is usually transient (pool exhaustion), so the failure cap is per
		// turn rather than per session.
		rotateFailures = 0;
		rotateRetryAt = rotateAt < maxSuspensions ? rotateAt : Number.POSITIVE_INFINITY;
		await dumpKernel();
	}

	async function shutdown(): Promise<void> {
		await dumpKernel();
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
		ownNotices.length = 0;
	}

	return {
		execute,
		startSession,
		endTurn,
		shutdown,
		currentCell: () => currentCell,
		root: () => root,
		scratch: () => scratch,
		progress: () => currentProgress,
		problems: () => ensurePreflight(),
		contribute: (contribution) => ledger.accept(contribution),
	};
}
