/**
 * Child sessions — the delegation side of the kernel (ticket 06).
 *
 * A child is an in-process pi `AgentSession`, created the way pi-subagents creates
 * one, with the two differences ticket 07 decided:
 *
 *   - it loads **no ambient extensions** (`noExtensions: true`), so no ambient extension —
 *     a memory store, a lens, anything — initialises inside it. Ticket 07's structural
 *     isolation, and the reason issue #247's OOM cannot recur.
 *   - the kernel is injected **inline** through `extensionFactories`, so a child
 *     has the same tool surface as its parent.
 *
 * Spawning is **admission-only**: `spawn` returns a handle immediately and the
 * child's answer arrives later as a message, never as this call's return value.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { findKernel, type KernelActivity } from "../../host-bridge/src/client";
import { STALE_AFTER_DEFAULT_SECONDS } from "./config";
import { sessionKey } from "../../host-bridge/src/convention";

export type ChildStatus = "running" | "done" | "failed" | "stopped";

export interface ChildHandle {
	child_id: string;
	name: string;
	session_file: string | null;
	model: string | null;
	depth: number;
	status: ChildStatus;
	started_at: string;
	ended_at: string | null;
	reason?: string;
	usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
	/**
	 * The verdict, on a **running** child only (`.scratch/rlm-stop` ticket 06). A terminal record has no
	 * clock to read, so these are absent rather than false — and a reader that treats absent as healthy
	 * is reading a stopped child, which is not the question staleness answers.
	 */
	stale?: boolean;
	/** How long the child has been quiet: the age of the newest evidence of progress, in seconds. */
	idle_seconds?: number;
	/** What the kernel is doing, when this process can reach the child's kernel: absent means unknown. */
	phase?: "waiting" | "computing" | "idle";
	/** The call it is waiting on, named the way that call names itself — `bash: <command>` for a shell. */
	waiting_on?: string;
	/** Declared patience still running: seconds before a step the child or its call promised expires. */
	expectation_seconds?: number;
	/** The child's own last word on what it is doing (ticket 10), verbatim and newest-wins. */
	progress_note?: { text: string; at: string; expect_seconds: number | null };
}

export interface Notice {
	/** Transcript label; the child channel is the default. */
	customType?: string;
	key: string;
	content: string;
	/** Consulted at dispatch time: a cell that read the handle cancels the notice. */
	cancelled?: () => boolean;
}

/**
 * One child of a join (rlm-wait ticket 01): the handle a `poll` would have returned, plus the answer
 * when there is one to return. `answer` is present for a `done` child and absent for every other
 * status — a running child has not answered yet, and a failed one's offer is its `reason` and its
 * session file.
 */
export type WaitedChild = ChildHandle & { answer?: string };

/** A join's patience, in seconds: the default the guideline names (`rlm.wait(names, timeout=180)`). */
export const WAIT_DEFAULT_SECONDS = 180;

export interface ChildKernelContext {
	id: string;
	name: string;
	depth: number;
	/** Sends a message to the session that spawned this kernel. */
	onMessage: (text: string) => void;
	/**
	 * Says what this child is doing, and optionally how long it expects to be quiet (ticket 10). A
	 * **declaration**, never a query: the parent reads it off the handle, and it is the only thing that
	 * can buy patience for work with no host call in flight.
	 */
	note: (text: string, expectSeconds?: number | null) => { ok: true; at: string; expect_seconds: number | null };
	/** Spawns a grandchild through the same manager, one level deeper. */
	spawn: (request: Omit<SpawnRequest, "depth" | "ownerDispatch">) => Promise<ChildHandle>;
	/** The registry lives in the root, so a child reads it through the manager. */
	poll: (selector: string) => ChildHandle;
	list: () => ChildHandle[];
	/** Ends a child, and everything below it, when it is below this session (map `04`). */
	stop: (selector: string, reason?: string) => Promise<ChildHandle>;
	/** Ends it the same way, then forgets the record. */
	remove: (selector: string) => Promise<ChildHandle>;
	send: (selector: string, text: string) => Promise<ChildHandle>;
	/** Join: block until every named child is terminal or the patience runs out (ticket 03). */
	wait: (selectors: string[], timeoutSeconds: number) => Promise<WaitedChild[]>;
	findModels: (query?: string, limit?: number) => Promise<Array<Record<string, unknown>>>;
}

export interface SpawnRequest {
	prompt: string;
	name: string;
	model?: string;
	thinking?: string;
	depth: number;
	spawnCell: string;
	parentSessionFile?: string;
	ownerDispatch: (notice: Notice) => void;
	/**
	 * The **spawning** session's live surface, supplied by that session's own rlm instance
	 * (`.scratch/child-surface/` ticket 01 §3). It travels with the request because the manager that
	 * creates the child need not be the spawner's: a grandchild goes through the root's manager, so
	 * reading this session's `pi` here would compute the ceiling from the root's surface instead.
	 */
	surface?: string[];
	/** Computed by `spawn` from `surface`, and carried into the child's factories. */
	ceiling?: {
		ceiling: string[];
		source: "spawner" | "fallback";
		dropped?: string[];
	};
}

interface ChildRecord extends ChildHandle {
	/**
	 * Who spawned this child: its **direct** spawner's session file at every depth (`delegation.ts`
	 * files the child's own file as *its* child's parent, so a grandchild points at its parent child,
	 * never at the root). The tree the model builds is only real with this edge — a stop cascades down
	 * it, and the authority check walks up it (`.scratch/rlm-stop` ticket 04).
	 */
	parent_session_file: string | null;
	/**
	 * What the child last said it was doing, and how long it said the wait would be (ticket 10). This is
	 * **state on a record**, not a notice (nothing withdraws it, nothing dispatches it) and not a message
	 * (no turn is triggered): it rides the handle every read returns, which is how a parent sees it
	 * without reaching into the child's kernel.
	 */
	progress_note?: { text: string; at: string; expect_seconds: number | null };
	/**
	 * The monotonic reading taken when the child was created. Silence is judged as the **minimum** of
	 * the wall-clock silence and this elapsed monotonic time, so a host that slept cannot manufacture
	 * silence while a real silence still counts (ticket 06, from prime-agent's rule).
	 */
	startedMonotonic: number;
	session?: any;
	noticeRead: boolean;
	deleted: boolean;
	/** Where this child's notices go — retained so a resumed turn can still notify. */
	ownerDispatch: (notice: Notice) => void;
	cost: CostTotals;
	countedIds: Set<string>;
}

export interface ChildManagerDeps {
	cwd: () => string;
	/** The manager's own session file, for the process-wide tree walk (v2 ticket 07). */
	ownSessionFile?: () => string | undefined;
	kernelFactoryFor: (child: ChildKernelContext) => (pi: any) => void;
	/**
	 * Extra extension factories injected into a child — whatever the tool bridge's owners
	 * and the other seams provide (tickets 07/16). Children still load no *ambient*
	 * extensions.
	 */
	childFactories?: (request: SpawnRequest) => Array<(pi: any) => void>;
	/**
	 * This manager's own session's live surface — the fallback when a request carries none (a caller
	 * that predates the ceiling, or a test). The real operand rides the request (ticket 01 §3).
	 */
	ownSurface?: () => string[];
	/** The child-eligible policy: `parentSurface` in, a ceiling out. Absent means no ceiling is computed. */
	childCeiling?: (parentSurface?: readonly string[]) => {
		ceiling: string[];
		source: "spawner" | "fallback";
		dropped?: string[];
	};
	runtime: () => Promise<any>;
	maxDepth: number;
	maxLive: number;
	/**
	 * Whether `rlm.json` lets the environment change a child's prompt (config.ts). A thunk because the
	 * config is read at session start, after this manager is built.
	 */
	allowEnvOverrides?: () => boolean;
	/**
	 * Called whenever a record's status changes how many children are working — the status line's
	 * signal, so the footer's count is live mid-turn rather than as stale as the last turn boundary.
	 * Optional: a caller that only delegates never sees it.
	 */
	onChange?: () => void;
	/**
	 * The staleness threshold, in seconds, read at each verdict rather than at construction: the config
	 * is resolved at session start, after this manager exists (ticket 06). Absent means the default.
	 */
	staleAfterSeconds?: () => number;
	/**
	 * Appends a custom entry to **this** session's transcript. A stop leaves one (`rlm-stop`) and the
	 * manager has no `pi` of its own, so the session that owns the manager supplies the writer (ticket
	 * 03 §5). Optional: a caller that only delegates never sees it, and a missing writer costs the
	 * record, never the stop.
	 */
	appendEntry?: (customType: string, data: unknown) => void;
}

let piModulePromise: Promise<any> | null = null;
let sharedRuntimePromise: Promise<any> | null = null;

/**
 * The host module is provided by pi at runtime and is deliberately not a dependency
 * of this package — an extension must not bundle pi. It is loaded through a variable
 * specifier so no resolver demands an installed copy, the same way pi-subagents
 * reaches `createAgentSession`, `ModelRuntime` and `resolveCliModel`.
 */
const PI_CODING_AGENT = "@earendil-works/pi-coding-agent";

function loadPiModule(): Promise<any> {
	piModulePromise ??= import(PI_CODING_AGENT);
	return piModulePromise;
}

/** One ModelRuntime shared by every child, the way pi-subagents shares one. */
export function modelRuntime(): Promise<any> {
	sharedRuntimePromise ??= loadPiModule().then((pi) => pi.ModelRuntime.create());
	return sharedRuntimePromise;
}

function agentDir(): string {
	const configured = process.env.PI_CODING_AGENT_DIR;
	if (configured) return configured;
	return join(process.env.HOME || homedir(), ".pi", "agent");
}

function lastMessageUsage(session: any): ChildHandle["usage"] | undefined {
	const messages: any[] = Array.isArray(session?.messages) ? session.messages : [];
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const usage = messages[index]?.usage;
		if (!usage) continue;
		return {
			input_tokens: typeof usage.input === "number" ? usage.input : undefined,
			output_tokens: typeof usage.output === "number" ? usage.output : undefined,
			total_tokens: typeof usage.total === "number" ? usage.total : undefined,
		};
	}
	return undefined;
}

/* ------------------------------------------------------------------ *
 * Durability — v2 ticket 10: a child's own depth, from its own artifacts
 * ------------------------------------------------------------------ */

export const CHILD_ENTRY_TYPE = "rlm-child";

export interface ChildProvenance {
	depth: number;
	parentSessionFile?: string;
	maxDepth?: number;
	spawnedByRequestId?: string;
}

/** The entry written at child creation is the authoritative record of provenance. */
export function readChildProvenance(sessionManager: any): ChildProvenance | null {
	try {
		const entries: any[] = sessionManager?.getEntries?.() ?? [];
		for (let index = entries.length - 1; index >= 0; index -= 1) {
			const entry = entries[index];
			if (entry?.type === "custom" && entry.customType === CHILD_ENTRY_TYPE && entry.data) {
				return entry.data as ChildProvenance;
			}
		}
	} catch {
		/* an unreadable transcript is not a child */
	}
	return null;
}

function readSessionHeader(file: string): { parentSession?: string } | null {
	try {
		const firstLine = readFileSync(file, "utf8").split("\n", 1)[0];
		const parsed = JSON.parse(firstLine ?? "");
		return parsed?.type === "session" ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * A session's recorded fork source: its own header's `parentSession`, resolved.
 *
 * The CLI's `--fork <path>` copies the history into a new session and starts it as
 * `"startup"` with no `previousSessionFile` event field, so this header is the only
 * signal that a fork happened at all (`SessionManager.forkFrom` writes it).
 */
export function headerParentSession(sessionManager: any): string | undefined {
	const parent: string | undefined = sessionManager?.getHeader?.()?.parentSession;
	return parent ? resolve(parent) : undefined;
}

/**
 * The session a kernel should take its journal and scratch from, when this session is a
 * fork — or `undefined` for a session that is not one (ticket 13).
 *
 * Two signals, because pi has two forks: `/fork` and `/clone` emit
 * `session_start {reason: "fork", previousSessionFile}`, while `--fork <path>` records the
 * source only in the header. A child's header names its parent too, but that is
 * provenance rather than a fork, so a child is never handed the parent's scratch.
 */
export function forkSourceFile(input: {
	startReason: string;
	previousSessionFile?: string;
	parentSessionFile?: string;
	isChild: boolean;
}): string | undefined {
	if (input.startReason === "fork" && input.previousSessionFile) return input.previousSessionFile;
	return input.isChild ? undefined : input.parentSessionFile;
}

/**
 * Where a kernel's journal — and, for a fork, the scratch that goes with it — comes from.
 *
 * A session's **own** journal is its own history, so it always wins when it exists: a fork
 * replays the source's only to seed itself once, and after its first cell it has its own.
 * A **child** is never seeded from its parent — its scratch is deliberately its own
 * (ticket 03), and a child's header names its parent just as a fork's does, so provenance
 * (the `rlm-child` entry, or being an in-process child) decides rather than the header.
 */
export function journalSourceOf(input: {
	ownSessionFile?: string;
	/** The first index the session's own journal holds, when it has one. */
	ownFirstIndex?: number;
	startReason: string;
	previousSessionFile?: string;
	parentSessionFile?: string;
	isChild: boolean;
}): { files: string[]; seedFrom?: string } | undefined {
	const own = input.ownSessionFile;
	if (own && input.ownFirstIndex !== undefined) {
		// Its own journal wins — but a fork's is a fragment indexed against the history it
		// inherited, so the parent's prefix is replayed underneath it (ticket 13).
		if (input.ownFirstIndex > 0 && input.parentSessionFile && !input.isChild) {
			return { files: [input.parentSessionFile, own] };
		}
		return { files: [own] };
	}
	if (input.isChild) return own ? { files: [own] } : undefined;
	const source = forkSourceFile(input);
	if (source) return { files: [source], seedFrom: source };
	return own ? { files: [own] } : undefined;
}

/**
 * The fallback (v2 ticket 10): depth is the length of the `parentSession` chain in
 * session headers. Returns null when a chain exists but cannot be walked, which the
 * caller must read as *unknowable* rather than as zero.
 */
export function deriveDepth(input: { sessionFile?: string; maxHops?: number }): number | null {
	let file = input.sessionFile;
	if (!file) return 0;
	const maxHops = input.maxHops ?? 8;
	let depth = 0;
	for (let hop = 0; hop < maxHops; hop += 1) {
		const header = readSessionHeader(file);
		if (!header) return hop === 0 ? null : depth;
		if (!header.parentSession) return depth;
		depth += 1;
		file = header.parentSession;
	}
	return null;
}

/**
 * A session's own depth, from its artifacts rather than from what it was told.
 * Ticket 10: an unprovable depth reads as **maximum**, never zero — a child with
 * unreadable provenance must not be handed a root's spawning authority.
 */
export function resolveOwnDepth(input: {
	sessionManager?: any;
	sessionFile?: string;
	maxDepth: number;
}): { depth: number; source: "entry" | "chain" | "root" | "unknown" } {
	const provenance = readChildProvenance(input.sessionManager);
	if (provenance && typeof provenance.depth === "number") {
		return { depth: provenance.depth, source: "entry" };
	}
	if (!input.sessionFile) return { depth: 0, source: "root" };
	const header = readSessionHeader(input.sessionFile);
	if (!header || !header.parentSession) return { depth: 0, source: "root" };
	const derived = deriveDepth({ sessionFile: input.sessionFile });
	if (derived !== null) return { depth: derived, source: "chain" };
	return { depth: input.maxDepth, source: "unknown" };
}

/* ------------------------------------------------------------------ *
 * Cost — v2 ticket 07: usage summed over a session's entries, with a watermark
 * ------------------------------------------------------------------ */

export interface CostTotals {
	input: number;
	output: number;
	total: number;
	/** How many entries carried usage. Zero means "nothing recorded yet". */
	entries: number;
}

function addUsage(into: CostTotals, usage: any): void {
	if (!usage || typeof usage !== "object") return;
	const input = typeof usage.input === "number" ? usage.input : 0;
	const output = typeof usage.output === "number" ? usage.output : 0;
	into.input += input;
	into.output += output;
	into.total += typeof usage.total === "number" ? usage.total : input + output;
	into.entries += 1;
}

/**
 * The child's answer (rlm-wait ticket 01): the text parts of the last entry whose message role is
 * `assistant`, concatenated in their order, with thinking and tool-call parts excluded; if that entry
 * carries no text, the previous assistant entry with one is used.
 *
 * The last assistant message rather than anything the child *sent*: a live probe found the child's
 * final answer (`CHILD-ANSWER-42`) in its own transcript and **nowhere** in its parent's, while what
 * the child sends with `agent_message.send` is already the parent's. `undefined` when the child never
 * said anything in prose.
 */
export function answerOf(session: any): string | undefined {
	const entries = sessionEntries(session);
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const message = entries[index]?.message;
		if (message?.role !== "assistant") continue;
		const content: unknown[] = Array.isArray(message.content) ? message.content : [];
		const text = content
			.filter((part): part is { type: string; text: string } => {
				const candidate = part as { type?: unknown; text?: unknown } | null;
				return candidate?.type === "text" && typeof candidate.text === "string";
			})
			.map((part) => part.text)
			.join("")
			.trim();
		if (text) return text;
	}
	return undefined;
}

function sessionEntries(session: any): any[] {
	try {
		const entries: any[] = session?.sessionManager?.getEntries?.() ?? [];
		return Array.isArray(entries) ? entries : [];
	} catch {
		return [];
	}
}

/**
 * The stop reason on the child's last assistant message, or `undefined` when it has none.
 *
 * pi's `prompt()` **resolves** when a generation is aborted — it does not reject — and the message it
 * leaves carries `stopReason: "aborted"` (probed live 2026-09-30: a child cut off by its parent's
 * teardown was reported `done` while its own transcript said `stopReason: "aborted"`,
 * `errorMessage: "Request aborted"`; `.scratch/rlm-wait/answer-correctness.md`). `"error"` is the
 * same shape for a provider that failed mid-stream. `ChildStatus` has no `aborted` of its own, so
 * both endings read as `failed`: the turn did not complete.
 */
function lastAssistantStopReason(session: any): string | undefined {
	const entries = sessionEntries(session);
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const message = entries[index]?.message;
		if (message?.role !== "assistant") continue;
		return typeof message.stopReason === "string" ? message.stopReason : undefined;
	}
	return undefined;
}

/**
 * Folds any not-yet-counted entries into `totals`. Entry ids are the watermark, so a
 * repeated call is incremental and a child that compacts keeps accumulating. Usage
 * lives on assistant messages and on compaction / branch-summary entries.
 */
export function foldSessionCost(
	session: any,
	totals: CostTotals,
	counted: Set<string>,
): CostTotals {
	for (const entry of sessionEntries(session)) {
		const id = typeof entry?.id === "string" ? entry.id : null;
		if (id) {
			if (counted.has(id)) continue;
			counted.add(id);
		}
		addUsage(totals, entry?.usage ?? entry?.message?.usage);
	}
	return totals;
}

/**
 * Managers register themselves by their own session file, which is what lets the
 * root walk the tree: every session involved is in the same process (v2 ticket 07).
 */
const managerChildren = new Map<string, () => Array<{ session_file: string | null; tokens: number }>>();

/**
 * How a child manager makes itself visible to the tree walk. Exported because it is
 * the whole mechanism, and because a registry that is only reachable from inside a
 * spawn is not testable.
 */
export function registerManagerView(
	ownSessionFile: string,
	childrenOf: () => Array<{ session_file: string | null; tokens: number }>,
): void {
	managerChildren.set(ownSessionFile, childrenOf);
}

/** Tokens spent by `sessionFile`'s descendants, recursively, cycle-safe. */
export function treeTokens(sessionFile: string | undefined, seen = new Set<string>()): number {
	if (!sessionFile || seen.has(sessionFile)) return 0;
	seen.add(sessionFile);
	const childrenOf = managerChildren.get(sessionFile);
	if (!childrenOf) return 0;
	let total = 0;
	for (const child of childrenOf()) {
		total += child.tokens + treeTokens(child.session_file ?? undefined, seen);
	}
	return total;
}

/** Exported for tests: the registry is process-wide, so it has to be resettable. */
export function forgetManagerViews(): void {
	managerChildren.clear();
}

/** The staleness fields a read reports about a running child; `null` for one that has ended. */
export type StallFields = {
	stale: boolean;
	idle_seconds: number;
	phase?: "waiting" | "computing" | "idle";
	waiting_on?: string;
	expectation_seconds?: number;
};

/** pi's messages carry **epoch milliseconds** (the entry's `timestamp` is the ISO one). */
function lastMessageAt(session: unknown): number | null {
	const messages: any[] = Array.isArray((session as { messages?: unknown })?.messages)
		? ((session as { messages: any[] }).messages ?? [])
		: [];
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const stamp = messages[index]?.timestamp;
		if (typeof stamp === "number" && Number.isFinite(stamp)) return stamp;
		if (typeof stamp === "string") {
			const parsed = Date.parse(stamp);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return null;
}

/**
 * What the child's kernel is waiting on, read through host-bridge's view of the registry (ticket 05).
 *
 * `undefined` means **unknown**, never idle: no kernel mounted for that session, an older code mode
 * that publishes no reader, a rotated kernel, or a throwing one. A caller that conflated the two would
 * report a wedged child as a healthy one — which is exactly the defect this exists to remove.
 */
function activityOf(session: unknown): KernelActivity | undefined {
	if (!session) return undefined;
	try {
		const lookup = findKernel();
		if (lookup.status !== "found") return undefined;
		// The registry key is the session key, and there is one derivation of it (host-bridge's).
		return lookup.entry.sessions.get(sessionKey(session))?.activity?.();
	} catch {
		return undefined;
	}
}

/**
 * Is this child stale — a **pure** function of what a read can see, so the child-10 case is a fixture
 * rather than a memory (ticket 06).
 *
 * ```
 * evidence = the newest of: its newest model message, its note, its oldest in-flight call's start
 * silence  = min(now − evidence, monotonic-now − the child's start)   // a host sleep is not silence
 * patience = the remaining declared bound of that oldest call, or of the note
 * stale    = silence ≥ threshold and patience ≤ 0
 * ```
 *
 * Three decisions are in those four lines. The floor is the child's **model messages**, not its session
 * entries: kernel bookkeeping is written *by* a wedged child's own machinery, so counting entries would
 * let a stuck child look busy (the child-10 case: its kernel wrote an `rlm-bg` entry and raised a notice
 * while its cell was frozen). The oldest in-flight call is the clock *inside* a cell, and a cell that
 * makes calls steadily always has a young oldest call. Declarations **push the verdict out** and are
 * never asked for: a child blocked in a call cannot answer a query, so it is only ever what the child
 * said *before* it went quiet that counts. `thresholdSeconds <= 0` means never stale.
 */
export function staleness(
	input: {
		status: ChildStatus;
		lastMessageAt: number | null;
		startedMonotonic: number;
		activity?: KernelActivity | null;
		note?: { at: string; expect_seconds: number | null } | null;
	},
	now: { wall: number; monotonic: number },
	thresholdSeconds: number,
): StallFields | null {
	if (input.status !== "running") return null;
	const calls = input.activity?.calls ?? [];
	const oldest = calls[0];
	const candidates: number[] = [];
	if (typeof input.lastMessageAt === "number") candidates.push(input.lastMessageAt);
	const oldestAt = oldest ? Date.parse(oldest.started_at) : Number.NaN;
	if (Number.isFinite(oldestAt)) candidates.push(oldestAt);
	const noteAt = input.note ? Date.parse(input.note.at) : Number.NaN;
	if (Number.isFinite(noteAt)) candidates.push(noteAt);
	// No evidence at all (a session whose messages this process cannot read) is not *freshness*: the
	// honest reading is "nothing has moved since the child started", which is what `monotonic` says.
	const wall = candidates.length > 0 ? Math.max(0, now.wall - Math.max(...candidates)) : Number.POSITIVE_INFINITY;
	const monotonic = Math.max(0, now.monotonic - input.startedMonotonic);
	// The verdict compares **unrounded** milliseconds while the report rounds to seconds: a threshold in
	// a fraction of a second (a test, or an operator who wants one) must not be reported as "stale" with
	// an `idle_seconds` that reads below it.
	const silenceMs = Math.min(wall, monotonic);
	const idleSeconds = Math.round(silenceMs / 1000);

	const expiries: number[] = [];
	if (oldest && typeof oldest.timeout_s === "number" && Number.isFinite(oldestAt)) {
		expiries.push(oldestAt + oldest.timeout_s * 1000);
	}
	if (input.note && typeof input.note.expect_seconds === "number" && Number.isFinite(noteAt)) {
		expiries.push(noteAt + input.note.expect_seconds * 1000);
	}
	const patience = expiries.length > 0 ? Math.max(0, Math.max(...expiries) - now.wall) : 0;

	const fields: StallFields = {
		stale: thresholdSeconds > 0 && silenceMs >= thresholdSeconds * 1000 && patience <= 0,
		idle_seconds: idleSeconds,
	};
	if (input.activity) {
		fields.phase = oldest ? "waiting" : input.activity.cell_running ? "computing" : "idle";
		if (oldest) fields.waiting_on = oldest.detail ?? oldest.name;
	}
	if (patience > 0) fields.expectation_seconds = Math.ceil(patience / 1000);
	return fields;
}

function handleOf(record: ChildRecord): ChildHandle {
	const {
		session: _session,
		noticeRead: _noticeRead,
		deleted: _deleted,
		ownerDispatch: _ownerDispatch,
		cost: _cost,
		countedIds: _countedIds,
		// The tree edge is the manager's, not the model's: no surface decided to publish it, and
		// `handleOf` is structural, so an internal field would otherwise ride out on every read.
		parent_session_file: _parentSessionFile,
		startedMonotonic: _startedMonotonic,
		...handle
	} = record;
	return { ...handle };
}

/** The rollup, falling back to the last message's usage while entries are still landing. */
function usageOfRecord(record: ChildRecord): ChildHandle["usage"] | undefined {
	const totals = foldSessionCost(record.session, record.cost, record.countedIds);
	if (totals.entries === 0) return lastMessageUsage(record.session);
	return { input_tokens: totals.input, output_tokens: totals.output, total_tokens: totals.total };
}

/**
 * Run one turn of a child to completion, then dispatch its completion notice (ticket 06:
 * completion always notifies with status only, and a child that fails silently is
 * impossible).
 *
 * Module-level so `spawn` and `send` share exactly one ending. A resumed child used to
 * reach a second `finally` that updated its status but dispatched nothing, so `send`ing a
 * finished child and ending the turn left the parent waiting for a notice that never came.
 *
 * The ending belongs to whoever gets there first. pi resolves `prompt()` when a generation is
 * aborted instead of throwing, so the turn's own verdict is **not** applied over a status a
 * teardown has already set — otherwise an aborting child's late resolution resurrects it as
 * `done`. And the verdict itself reads the stop reason, so an aborted or errored turn is a
 * failure rather than a completion.
 */
async function runChildTurn(
	record: ChildRecord,
	prompt: string,
	/** The manager's change signal: this turn's ending is a change in how many children work. */
	changed: () => void,
): Promise<void> {
	let status: ChildStatus = "done";
	let reason: string | undefined;
	try {
		await record.session?.prompt(prompt);
		const stop = lastAssistantStopReason(record.session);
		if (stop === "aborted" || stop === "error") {
			status = "failed";
			reason = stop;
		}
	} catch (error) {
		status = "failed";
		reason = error instanceof Error ? error.message : String(error);
	} finally {
		// A teardown that already stopped this child owns the ending (seen live 2026-09-30: the
		// parent's shutdown aborted an in-flight child, whose resolved `prompt()` then rewrote
		// `stopped` to `done` and notified the parent with no answer).
		if (record.status === "running") {
			record.status = status;
			record.reason = reason;
		}
		record.ended_at = new Date().toISOString();
		record.usage = usageOfRecord(record);
		changed();
		const spent = record.usage?.total_tokens ? ` ${record.usage.total_tokens} tokens` : "";
		const detail = [
			`[${record.child_id} "${record.name}"] finished: ${record.status}${spent}`,
			record.reason ? `— ${record.reason}` : "",
			record.session_file ? `\nsession: ${record.session_file}` : "",
			`\nRead the result from the stored transcript (the session file is outside the workspace mount, so read it through await bash("cat …")); rlm.poll("${record.child_id}") returns status and usage only, and only in the session that spawned the child — a resumed or forked session has no children.`,
		]
			.filter(Boolean)
			.join(" ");
		record.ownerDispatch({
			key: `done:${record.child_id}`,
			content: detail,
			cancelled: () => record.noticeRead,
		});
	}
}

/**
 * The child's system prompt (v2 ticket 05).
 *
 * RLM owns the kernel and delegation sentence and states it **parent-only**: a child is
 * told where its results go, not that it may one day have children of its own. At the cap
 * it is told the opposite, because `rlm.spawn` would be refused.
 *
 * `RLM_CHILD_PROMPT=none` drops the added sentences and leaves the pre-v2 prompt. That is
 * a **diagnostic, not a feature**: v2's criterion for this contract is an A/B — the same
 * task with and without the added prompt must produce the same artefact — and a
 * comparison needs a control that differs in exactly that one way. Being a diagnostic is also why
 * the environment does not decide it on its own: `rlm.json` has to allow environment overrides
 * (config.ts), so the control cannot be left on by a variable no transcript shows.
 */
export function childPromptFor(
	request: { name: string; depth: number },
	maxDepth: number,
	allowEnvironmentOverride = false,
): string[] {
	const identity = `You are "${request.name}", a delegated child session (depth ${request.depth}). Work the task and answer it.`;
	const reporting = "Use agent_message.send(text) to send anything your parent needs before you finish.";
	// Ticket 10: the discipline that keeps a child from being stopped for silence, with the reason a
	// child can act on. Inside the droppable set (`RLM_CHILD_PROMPT=none`), because v2's A/B criterion
	// is that the added sentences do not change the artefact.
	const declaring =
		"Before a step that may take more than a few minutes — or a command that can hang — say so with rlm.note(text, expect_seconds=...), and pass a timeout to bash: a parent that hears nothing may decide you are stuck and stop you.";
	if (allowEnvironmentOverride && process.env.RLM_CHILD_PROMPT === "none") return [identity, reporting];
	return [
		identity,
		request.depth < maxDepth
			? "You have a persistent Python kernel. You may delegate with rlm.spawn(name=..., prompt=...); results arrive as messages, never as the call's return value."
			: "You have a persistent Python kernel. You are at the delegation limit, so rlm.spawn will be refused — answer the task yourself.",
		declaring,
		reporting,
	];
}

/**
 * The read rule (ticket 06, matching ticket 10's background handles): a poll or list
 * withdraws a pending completion notice **only when there is a result to read**.
 *
 * Polling a child that is still running is a status check, not a read of its answer, so it
 * must leave the notice that child's completion will dispatch intact. Withdrawing on every
 * poll meant a parent that checked on a running child never heard it finish and had to be
 * prompted by hand — the bug this function exists to prevent.
 */
/**
 * The caller's stop reason, bounded the way the reference bounds model-authored text (ticket 03 §9):
 * trimmed, capped at 200 characters, never parsed. Empty and non-strings mean "no reason given".
 */
export function cleanReason(text: string | undefined): string | undefined {
	if (typeof text !== "string") return undefined;
	const trimmed = text.trim();
	return trimmed ? trimmed.slice(0, 200) : undefined;
}

export function markNoticeReadIfFinished(record: { status: ChildStatus; noticeRead: boolean }): void {
	if (record.status !== "running") record.noticeRead = true;
}

export function createChildManager(deps: ChildManagerDeps) {
	const records = new Map<string, ChildRecord>();
	let counter = 0;

	/**
	 * The joins currently waiting. A wait registers its own check here and is called on every
	 * transition — the same signal the status line rides — so a join wakes on the state change that
	 * matters instead of polling for it.
	 */
	const waiters = new Set<() => void>();

	/**
	 * Every transition that changes how many children are working is announced, so the status line's
	 * count is live rather than as stale as the last turn boundary. A footer must never break a child,
	 * so a throwing listener is swallowed — and so is a throwing waiter: a join that is woken too early
	 * simply checks again.
	 */
	function changed(): void {
		try {
			deps.onChange?.();
		} catch {
			/* the status line is not worth a child's turn */
		}
		for (const waiter of [...waiters]) {
			try {
				waiter();
			} catch {
				/* a waiter's own bookkeeping must not fail the transition that woke it */
			}
		}
	}

	/** Direct children with their tokens — the edges of one level of the tree. */
	function directChildren(): Array<{ session_file: string | null; tokens: number }> {
		return [...records.values()]
			.filter((record) => !record.deleted)
			.map((record) => ({ session_file: record.session_file, tokens: foldSessionCost(record.session, record.cost, record.countedIds).total }));
	}

	/**
	 * A child's own declaration (ticket 10), written onto its record.
	 *
	 * The text is truncated rather than refused (a long note is not a typo) while a malformed
	 * `expect_seconds` **is** refused, because that is a value nothing can be inferred from. The
	 * `changed()` fanout — waiters, the footer — is throttled to one note-driven wake per ten seconds:
	 * the newest text always lands, but a chattering child must not make the parent's session churn.
	 */
	function noteFrom(record: ChildRecord, text: string, expectSeconds?: number | null) {
		const trimmed = String(text ?? "").trim();
		if (!trimmed) throw new Error("rlm.note requires some text");
		let expectation: number | null = null;
		if (expectSeconds !== undefined && expectSeconds !== null) {
			if (typeof expectSeconds !== "number" || !Number.isFinite(expectSeconds) || expectSeconds <= 0) {
				throw new Error("rlm.note: expect_seconds must be a positive number of seconds");
			}
			expectation = Math.floor(expectSeconds);
		}
		const at = new Date().toISOString();
		record.progress_note = { text: trimmed.slice(0, 512), at, expect_seconds: expectation };
		const now = Date.now();
		if (now - lastNoteSignalAt >= NOTE_SIGNAL_INTERVAL_MS) {
			lastNoteSignalAt = now;
			changed();
		}
		return { ok: true as const, at, expect_seconds: expectation };
	}

	/** How often a note may wake the waiters and repaint the footer (ticket 10; the reference's 10 s). */
	const NOTE_SIGNAL_INTERVAL_MS = 10_000;
	let lastNoteSignalAt = 0;

	/** The verdict for one record, read at call time so no stored flag can drift (ticket 06). */
	function stallOf(record: ChildRecord): StallFields | null {
		return staleness(
			{
				status: record.status,
				lastMessageAt: lastMessageAt(record.session),
				startedMonotonic: record.startedMonotonic,
				activity: activityOf(record.session),
				note: record.progress_note ?? null,
			},
			{ wall: Date.now(), monotonic: performance.now() },
			deps.staleAfterSeconds?.() ?? STALE_AFTER_DEFAULT_SECONDS,
		);
	}

	/**
	 * The handle a read returns: what the record is, plus the verdict when the child is still running.
	 * One function so `poll`, `list`, `wait` and a stop's return value cannot disagree about a child.
	 */
	function handleNow(record: ChildRecord): ChildHandle {
		return { ...handleOf(record), ...(stallOf(record) ?? {}) };
	}

	function find(selector: string): ChildRecord {
		const direct = records.get(selector);
		if (direct && !direct.deleted) return direct;
		const byName = [...records.values()].filter((record) => !record.deleted && record.name === selector);
		if (byName.length === 1) return byName[0]!;
		if (byName.length > 1) {
			throw new Error(`ambiguous child name "${selector}"; candidates: ${byName.map((r) => r.child_id).join(", ")}`);
		}
		const byFile = [...records.values()].filter((record) => !record.deleted && record.session_file === selector);
		if (byFile.length === 1) return byFile[0]!;
		const known = [...records.values()].filter((record) => !record.deleted).map((r) => `${r.child_id} (${r.name})`);
		throw new Error(`no child matches "${selector}"${known.length ? `; known: ${known.join(", ")}` : ""}`);
	}

	async function spawn(request: SpawnRequest): Promise<ChildHandle> {
		if (request.depth > deps.maxDepth) {
			throw new Error(`cannot spawn at depth ${request.depth}: the maximum is ${deps.maxDepth}`);
		}
		const live = [...records.values()].filter((record) => record.status === "running" && !record.deleted);
		if (live.length >= deps.maxLive) {
			throw new Error(`${live.length} children are already running; the limit is ${deps.maxLive}`);
		}
		const piModule = await loadPiModule();
		const modelRuntime = await deps.runtime();
		const directory = agentDir();
		const cwd = deps.cwd();
		// The ceiling for this child, computed **here, at spawn time** (ticket 01 §2): the spawning
		// session's live surface, narrowed by the seam to what a child may hold. Two operands, both from
		// the seam's policy — never a record, and never a walk up a chain.
		const parentSurface = request.surface ?? deps.ownSurface?.();
		const ceiling = deps.childCeiling?.(parentSurface) ?? {
			ceiling: [],
			source: "fallback" as const,
		};
		const settingsManager = piModule.SettingsManager.create(cwd, directory);
		const id = `child-${++counter}`;

		const context: ChildKernelContext = {
			id,
			name: request.name,
			depth: request.depth,
			onMessage: (text) => {
				// A child's message is **content, not status**, so nothing withdraws it (rlm-wait ticket
				// 02). It used to carry the same `noticeRead` predicate as its completion notice, which
				// made any read of the child — a poll, a join — cancel whatever the child had sent and the
				// parent had not yet seen. The completion notice still withdraws on a read; this one never
				// does, which is why it has no `cancelled` at all.
				request.ownerDispatch({
					key: `msg:${id}:${Date.now()}`,
					content: `[${id} "${request.name}"] ${text}`,
				});
			},
			// The context is per child, so a note lands on *this* child's record — a grandchild's note
			// needs no walk and no kernel lookup (ticket 10). The record is built below, after pi answers
			// with the session, so the closure reads it through `recordRef`; a note before that (the child
			// cannot run a cell that early) is refused rather than dropped.
			note: (text, expectSeconds) => {
				if (!recordRef.current) throw new Error("rlm.note: this child has no record yet");
				return noteFrom(recordRef.current, text, expectSeconds);
			},
			spawn: (inner) =>
				spawn({
					...inner,
					depth: request.depth + 1,
					// Provenance at depth >= 2: the spawning cell belongs to the child, so it
					// travels with the request instead of being dropped (a gap v2's depth-2 run
					// found: the entry recorded no spawn cell for grandchildren).
					spawnCell: inner.spawnCell ?? "",
					// Provenance matters: a grandchild must record *its* parent, or an
					// owner seam cannot bind it (ticket 16).
					parentSessionFile: inner.parentSessionFile,
					ownerDispatch: request.ownerDispatch,
				}),
			poll,
			list,
			// The context is built per child, so the asker is this child — which is what makes the
			// authority check positional rather than an honour system (ticket 04 §3).
			stop: (selector, reason) => stop(selector, reason, id),
			remove: (selector) => remove(selector, id),
			send,
			wait,
			findModels: async (query, limit) => findModels(await deps.runtime(), query, limit),
		};

		const loader = new piModule.DefaultResourceLoader({
			cwd,
			agentDir: directory,
			settingsManager,
			// Ticket 07: no ambient extensions in a child, ever.
			noExtensions: true,
			noPromptTemplates: true,
			noThemes: true,
			// The ceiling rides the request so the child's own reconcile can record what it was given
			// and where the answer came from (ticket 01 §5).
			extensionFactories: [
				deps.kernelFactoryFor(context),
				...(deps.childFactories?.({ ...request, ceiling }) ?? []),
			],
			appendSystemPrompt: childPromptFor(request, deps.maxDepth, deps.allowEnvOverrides?.() ?? false),
		});
		await loader.reload();

		// A child lands beside its parent so the transcript tree is findable, and the
		// header's parentSession is the provenance an owner seam binds by (ticket 16).
		const parentFile = request.parentSessionFile;
		const sessionManager = parentFile
			? piModule.SessionManager.create(cwd, dirname(parentFile), { parentSession: parentFile })
			: piModule.SessionManager.create(cwd);
		// v2 ticket 10: provenance is written where the child will still find it after a
		// resume — its own transcript. pi's session header has no room for a depth, so it
		// is a custom entry, and `resolveOwnDepth` falls back to the parentSession chain.
		try {
			sessionManager.appendCustomEntry?.(CHILD_ENTRY_TYPE, {
				depth: request.depth,
				parentSessionFile: parentFile,
				maxDepth: deps.maxDepth,
				spawnedByRequestId: request.spawnCell || undefined,
			} satisfies ChildProvenance);
		} catch {
			// Provenance is not worth failing a child over; the header still carries the parent.
		}
		const resolved = request.model
			? piModule.resolveCliModel({ cliModel: request.model, modelRuntime })
			: undefined;
		if (resolved?.error) throw new Error(resolved.error);

		/** Filled once the record exists, which is after pi answers with the session (below). */
		const recordRef: { current: ChildRecord | null } = { current: null };
		const { session } = await piModule.createAgentSession({
			cwd,
			agentDir: directory,
			modelRuntime,
			...(resolved?.model ? { model: resolved.model } : {}),
			...(resolved?.thinkingLevel ? { thinkingLevel: resolved.thinkingLevel } : {}),
			resourceLoader: loader,
			sessionManager,
			// The **hard** half of the ceiling (ticket 03 §3). pi turns this into `allowedToolNames` and
			// filters the tool *registry* by it, so nothing outside the ceiling is merely inactive in a
			// child — it is unregistered: pi's own builtins included, and any owner's later registration.
			// The child's post-mount reconcile still runs, but as a guard and an artefact, not as the
			// mechanism.
			tools: ceiling.ceiling,
			sessionStartEvent: { type: "session_start", reason: "startup" },
		});
		await session.bindExtensions({ mode: "print" });

		const record: ChildRecord = {
			child_id: id,
			name: request.name,
			session_file: session.sessionFile ?? null,
			model: session.model ? `${session.model.provider}/${session.model.id}` : null,
			depth: request.depth,
			status: "running",
			started_at: new Date().toISOString(),
			ended_at: null,
			parent_session_file: request.parentSessionFile ?? null,
			startedMonotonic: performance.now(),
			session,
			noticeRead: false,
			deleted: false,
			ownerDispatch: request.ownerDispatch,
			cost: { input: 0, output: 0, total: 0, entries: 0 },
			countedIds: new Set<string>(),
		};
		recordRef.current = record;
		records.set(id, record);
		changed();

		// Register this manager under its own session file so the root can total the tree.
		const ownFile = deps.ownSessionFile?.();
		if (ownFile && !managerChildren.has(ownFile)) registerManagerView(ownFile, directChildren);

		// Admission-only: the turn runs on its own, and completion is a notice.
		void runChildTurn(record, request.prompt, changed);

		return handleOf(record);
	}

	/** A poll or list is a read — but only a finished child's is a read of its answer. */
	function poll(selector: string): ChildHandle {
		const record = find(selector);
		markNoticeReadIfFinished(record);
		record.usage = usageOfRecord(record) ?? record.usage;
		return handleNow(record);
	}

	function list(): ChildHandle[] {
		const visible = [...records.values()].filter((record) => !record.deleted);
		for (const record of visible) {
			// Refresh the rollup, and withdraw the pending notice of any child with a result.
			record.usage = usageOfRecord(record) ?? record.usage;
			markNoticeReadIfFinished(record);
		}
		return visible.map(handleNow);
	}

	/** The records whose **direct** spawner is `file` — the tree edge, one level down. */
	function childrenOfFile(file: string | null): ChildRecord[] {
		if (!file) return [];
		return [...records.values()].filter((record) => !record.deleted && record.parent_session_file === file);
	}

	/** A record and its descendants, depth-first in spawn order: what a stop ends (ticket 04 §2). */
	function subtreeOf(record: ChildRecord): ChildRecord[] {
		const out: ChildRecord[] = [record];
		for (const child of childrenOfFile(record.session_file)) out.push(...subtreeOf(child));
		return out;
	}

	/** The live record that owns a session file, or `undefined` when none does. */
	function recordOwning(file: string): ChildRecord | undefined {
		return [...records.values()].find((record) => !record.deleted && record.session_file === file);
	}

	/**
	 * Is `record` below `askerFile`? The walk goes **up** the edge, so one rule answers both "may this
	 * session end that one" and "what does the cascade include" (ticket 04 §3). Hop-bounded: the data is
	 * ours, but a cycle must not be able to hang a stop.
	 */
	function belowFile(record: ChildRecord, askerFile: string, hops = 0): boolean {
		if (hops > deps.maxDepth + 1) return false;
		const parent = record.parent_session_file;
		if (!parent) return false;
		if (parent === askerFile) return true;
		const owner = recordOwning(parent);
		return owner ? belowFile(owner, askerFile, hops + 1) : false;
	}

	/**
	 * Authority (ticket 04 §3): a session may end itself? **No** — the cascade would dispose the session
	 * running the very cell that asked — or anything **below** it. The root passes no asker and so keeps
	 * full reach, which is also what lets it clean up a grandchild it never spawned. Reads
	 * (`poll`/`list`/`send`/`wait`) keep their flat reach; only these verbs are bounded.
	 */
	function mayStop(record: ChildRecord, askerId: string | undefined, verb: string): void {
		if (!askerId) return;
		if (record.child_id === askerId) throw new Error(`${verb}: a session cannot stop itself.`);
		const askerFile = records.get(askerId)?.session_file ?? null;
		if (!askerFile || !belowFile(record, askerFile)) {
			throw new Error(`${verb}: ${record.child_id} is not below this session.`);
		}
	}

	/**
	 * Best effort and **detached**: tell each child's own extensions the session is gone, then dispose
	 * (tickets 03 §3, 04 §2). The caller never awaits this, which is the point — `abort()` cannot resolve
	 * at all on a cell that makes no host call (measured 2026-10-09: `remove` on such a child never
	 * returned and took its caller's cell with it), so a stop that waited for the unwind would hang
	 * exactly on the child it exists for.
	 */
	async function teardown(members: ChildRecord[]): Promise<void> {
		for (const member of members) {
			try {
				await disposeChildSession(member.session);
			} catch {
				/* a stop is never allowed to fail */
			}
		}
	}

	/**
	 * End a child, and everything below it, releasing the sessions while keeping the records (tickets 03
	 * and 04). The record is marked and the handle returned **before** the teardown runs; every child the
	 * cascade reached says who ended it, so "why did this grandchild die?" is answerable from its own
	 * record. Stopping a child that already ended is a no-op on its own ending, but still cascades into
	 * any of its descendants that are still running.
	 */
	async function stop(selector: string, reason?: string, askerId?: string): Promise<ChildHandle> {
		const record = find(selector);
		mayStop(record, askerId, "rlm.stop");
		const toStop = subtreeOf(record).filter((member) => member.status === "running");
		if (toStop.length === 0) return handleOf(record);
		// A stop's own return value keeps the record's plain shape: the child ends with this call, so a
		// verdict computed a moment ago would describe a state that no longer exists.
		// The verdict is read *before* the ending is written, because it describes the child as it was
		// (ticket 06 §6): a stale child's default reason says what was true at the moment of the stop.
		const stated = cleanReason(reason) ?? staleReason(stallOf(record)) ?? "stopped by parent";
		const endedAt = new Date().toISOString();
		for (const member of toStop) {
			member.status = "stopped";
			member.ended_at = endedAt;
			member.reason = member === record ? stated : `stopped with ${record.child_id} (${stated})`;
			// No notice: the model caused this ending, and a notice is for the endings it was not
			// watching (ticket 03 §5).
			member.noticeRead = true;
		}
		changed();
		const handle = handleOf(record);
		// The transcript's one mark (ticket 03 §5): the reason, and every id the cascade ended, in stop
		// order — parent first, then depth-first.
		try {
			deps.appendEntry?.("rlm-stop", {
				child_id: record.child_id,
				reason: stated,
				stopped_ids: toStop.map((member) => member.child_id),
			});
		} catch {
			/* a transcript entry is never worth a stop */
		}
		void teardown(toStop);
		return handle;
	}

	/** Stop what is running, then forget the named record — and only it (tickets 03 §8, 04 §6). */
	async function remove(selector: string, askerId?: string): Promise<ChildHandle> {
		const record = find(selector);
		mayStop(record, askerId, "rlm.remove");
		if (record.status === "running") await stop(selector, undefined, askerId);
		record.deleted = true;
		record.noticeRead = true;
		return handleOf(record);
	}

	async function send(selector: string, text: string): Promise<ChildHandle> {
		const record = find(selector);
		// A stopped child's session has been disposed, so there is nothing to resume — and the check is
		// on the **status**, not on the disposal: a stop returns before its teardown runs, so a flag
		// would let a `send` arriving in that gap resurrect the child the model just killed (ticket 03 §6).
		if (record.status === "stopped") {
			throw new Error(
				`rlm.send: ${record.child_id} is not resumable (stopped${record.reason ? `: ${record.reason}` : ""}); spawn a new child instead of resuming it.`,
			);
		}
		if (record.status === "running") {
			await record.session?.followUp(text);
		} else {
			// Resuming a finished child is a fresh turn: clear the previous ending (including
			// its reason, so a failure cannot bleed into a later success) and run it through
			// the same path a spawn takes, notice and all.
			record.status = "running";
			record.ended_at = null;
			record.reason = undefined;
			record.noticeRead = false;
			changed();
			void runChildTurn(record, text, changed);
		}
		return handleOf(record);
	}

	/**
	 * Join: block until every named child is terminal, or `timeoutSeconds` passes (rlm-wait tickets
	 * 01-03).
	 *
	 * An unknown selector **refuses the whole call** — `find` throws, and a typo has to be loud rather
	 * than a silently shorter list. A timeout is not a failure: whatever is already terminal is
	 * returned, a child still running comes back with its status and no answer, and its completion
	 * notice is untouched because `markNoticeReadIfFinished` only reads what has finished. Which is
	 * also the rule this join obeys: reading a child its completion notice, never the messages it sent.
	 */
	async function wait(selectors: string[], timeoutSeconds: number): Promise<WaitedChild[]> {
		const targets = selectors.map((selector) => find(selector));
		if (targets.some((record) => record.status === "running")) {
			await new Promise<void>((resolve) => {
				let settled = false;
				const finish = () => {
					if (settled) return;
					settled = true;
					waiters.delete(check);
					clearTimeout(timer);
					resolve();
				};
				const check = () => {
					if (targets.every((record) => record.status !== "running")) finish();
				};
				const timer = setTimeout(finish, Math.max(0, timeoutSeconds) * 1000);
				waiters.add(check);
				check();
			});
		}
		for (const record of targets) markNoticeReadIfFinished(record);
		// The footer's tree total has just moved if anything finished while we waited.
		changed();
		return targets.map((record) => {
			const usage = usageOfRecord(record);
			const answer = record.status === "done" ? answerOf(record.session) : undefined;
			return {
				...handleNow(record),
				...(usage ? { usage } : {}),
				...(answer ? { answer } : {}),
			};
		});
	}

	return {
		spawn,
		poll,
		list,
		// The root's own verbs: no asker, so its reach is every live record in the tree (ticket 04 §3).
		stop: (selector: string, reason?: string) => stop(selector, reason),
		remove: (selector: string) => remove(selector),
		send,
		wait,

		/** v2 ticket 07: every descendant's tokens, walked in-process. */
		treeCost: () => treeTokens(deps.ownSessionFile?.()),

		liveCount: () => [...records.values()].filter((record) => record.status === "running").length,

		/**
		 * The running children that have gone quiet, worst first (ticket 07): one predicate, and this is
		 * the read the footer's line rides without asking for a full `list()`.
		 */
		staleChildren: () =>
			[...records.values()]
				.filter((record) => !record.deleted && record.status === "running")
				.map((record) => ({ record, stall: stallOf(record) }))
				.filter((entry) => entry.stall?.stale === true)
				.sort((left, right) => (right.stall?.idle_seconds ?? 0) - (left.stall?.idle_seconds ?? 0))
				.map((entry) => ({ name: entry.record.name, idle_seconds: entry.stall?.idle_seconds ?? 0 })),

		/**
		 * Ticket 06: the spawning session is going away, so every child ends with it.
		 *
		 * Now the **same** teardown a stop uses, and deliberately without the `await abort()` this used
		 * to carry: `abort()` cannot resolve on a child wedged in a cell that makes no host call (ticket
		 * 03's amendment, measured 2026-10-09), so awaiting it here could hang a shutdown on exactly the
		 * child a shutdown needs to release.
		 */
		async shutdownAll(): Promise<void> {
			const running = [...records.values()].filter((record) => record.status === "running");
			for (const record of running) {
				record.status = "stopped";
				record.reason = record.reason ?? "the spawning session is shutting down";
				record.ended_at = new Date().toISOString();
				record.noticeRead = true;
			}
			if (running.length > 0) changed();
			await teardown(running);
		},
	};
}

/**
 * Dispose a child session, telling its extensions first.
 *
 * `AgentSession.dispose()` invalidates the child's extension runner **silently**. pi's own
 * `AgentSessionRuntime.dispose()` emits `session_shutdown` immediately before it, but a child built
 * through `createAgentSession` never passes through that wrapper, so without this line a child's
 * extensions are never told: RSI keeps its seam registered, its provider record and an armed quiet
 * timer; skill-bridge keeps the session's providers; and a background timer fires into the dead ctx
 * minutes later. That is how a headless run which had spawned a child came to die with
 * `This extension ctx is stale after session replacement or reload` — measured 2026-09-24: the
 * child's RSI quiet timer fired 60s after this dispose, its failure was reported through the same
 * dead ctx, and the unhandled rejection ended the process.
 *
 * `emitSessionShutdownEvent` is not a public export of pi; it is exactly `hasHandlers` + `emit` on
 * the runner the session exposes, which is what this reimplements. A handler that throws must not
 * keep the session alive, so both steps are best effort.
 */
export async function disposeChildSession(
	session: unknown,
	/** pi's own union, spelled out locally: this module takes no static dependency on pi. */
	reason: "quit" | "reload" | "new" | "resume" | "fork" = "quit",
): Promise<void> {
	const runner = (session as { extensionRunner?: { hasHandlers?: (event: string) => boolean; emit?: (event: unknown) => Promise<unknown> } } | undefined)
		?.extensionRunner;
	try {
		if (runner?.hasHandlers?.("session_shutdown")) {
			await runner.emit?.({ type: "session_shutdown", reason });
		}
	} catch {
		/* a throwing handler is that extension's problem, not the child's reason to stay open */
	}
	try {
		(session as { dispose?: () => void } | undefined)?.dispose?.();
	} catch {
		/* the process is going away either way */
	}
}

/** `find_models` (ticket 06): the kernel needs somewhere to learn valid selectors. */
export async function findModels(runtime: any, query?: string, limit = 20): Promise<Array<Record<string, unknown>>> {
	const models: any[] = typeof runtime?.getModels === "function" ? [...runtime.getModels()] : [];
	const needle = query ? String(query).toLowerCase() : null;
	const matched = models.filter((model) => {
		if (!needle) return true;
		const reference = `${model.provider ?? ""}/${model.id ?? model.model ?? ""}`.toLowerCase();
		return reference.includes(needle);
	});
	return matched.slice(0, Math.max(1, Math.min(Number(limit) || 20, 100))).map((model) => ({
		id: `${model.provider}/${model.id ?? model.model}`,
		provider: model.provider ?? null,
		context_window: model.contextWindow ?? model.context_window ?? null,
		reasoning: model.reasoning ?? model.supportsReasoning ?? null,
	}));
}

/**
 * The footer line rlm writes (`ctx.ui.setStatus("rlm", …)`): the kernel's state, how many children
 * are working when there are any, and what the tree has spent when it has spent anything.
 *
 * `live` is `liveCount()` — every running record in this session's manager, which for a root is every
 * live descendant, grandchildren included. Zero is left unsaid rather than shown as `0`, because the
 * line is read every turn. Print mode's UI is a no-op, so a child's own instance may call this
 * harmlessly.
 */
export function statusLine(mounted: boolean, live: number, tokens?: number, stale?: StaleSummary): string {
	const kernel = mounted ? "rlm: code-mode (monty)" : "rlm: kernel unavailable";
	// The kernel's state and the count keep the exact shape they had: this line is read every turn, and
	// the token field is an addition, not a reformatting.
	const base = live > 0 ? `${kernel} ch: ${live} running` : kernel;
	// The stale clause names the **worst** child (`staleChildren()` sorts by idle time) and counts the
	// rest, so a session with thirty children never grows a list — and a healthy session's line is
	// byte-identical to the one it showed before this existed (ticket 07 §1).
	const staleClause = stale && stale.count > 0
		? ` · ${stale.count} stale: ${shortName(stale.name)} ${ageText(stale.idle_seconds)}${stale.count > 1 ? ` (+${stale.count - 1} more)` : ""}`
		: "";
	// The tree's total is the same number `rlm.tree_cost()` reports (`treeTokens`, one definition, two
	// readers). Zero and unknown are left unsaid, exactly as the live count is.
	const tokensClause = typeof tokens === "number" && tokens > 0 ? ` · ${compactTokens(tokens)} tok` : "";
	return `${base}${staleClause}${tokensClause}`;
}

/** A model-chosen name, short enough for a footer: the line is read every turn. */
function shortName(name: string): string {
	return name.length > 24 ? name.slice(0, 24) : name;
}

/** Below a thousand the exact number, above it whole thousands: this is a footer, not a receipt. */
function compactTokens(tokens: number): string {
	return tokens < 1000 ? String(tokens) : `${Math.round(tokens / 1000)}k`;
}

/**
 * An age, as the footer and a stop's default reason both print it (ticket 07 §1): `45s`, `12m`, `19h`.
 *
 * **One definition, two readers** — the same rule `treeTokens` follows for the tree's total, and the
 * reason it matters: a footer that said `19h` while the transcript's reason said `1140m` would be the
 * same fact reported twice, differently.
 */
export function ageText(seconds: number): string {
	const value = Math.max(0, Math.round(seconds));
	if (value < 60) return `${value}s`;
	if (value < 3600) return `${Math.round(value / 60)}m`;
	return `${Math.round(value / 3600)}h`;
}

/** What the footer says about the stale children, when there are any (ticket 07 §1). */
export type StaleSummary = { count: number; name: string; idle_seconds: number };

/**
 * The default reason a stop records when the caller gave none and the child was stale (ticket 06 §6):
 * the age, and what it was waiting on, so a human reading the transcript a day later learns both facts.
 * `undefined` when the child was not stale — the caller's own words or `stopped by parent` then.
 */
export function staleReason(stall: StallFields | null): string | undefined {
	if (!stall?.stale) return undefined;
	const waiting = stall.waiting_on ? ` (${stall.waiting_on})` : "";
	return cleanReason(`stale: no progress for ${ageText(stall.idle_seconds)}${waiting}`);
}
