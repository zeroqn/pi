/**
 * Child sessions — the delegation side of the kernel (ticket 06).
 *
 * A child is an in-process pi `AgentSession`, created the way pi-subagents creates
 * one, with the two differences ticket 07 decided:
 *
 *   - it loads **no ambient extensions** (`noExtensions: true`), so Magic Context,
 *     pi-lens and the rest never initialise inside it. Ticket 07's structural
 *     isolation, and the reason issue #247's OOM cannot recur.
 *   - the kernel is injected **inline** through `extensionFactories`, so a child
 *     has the same tool surface as its parent.
 *
 * Spawning is **admission-only**: `spawn` returns a handle immediately and the
 * child's answer arrives later as a message, never as this call's return value.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
}

export interface Notice {
	key: string;
	content: string;
	/** Consulted at dispatch time: a cell that read the handle cancels the notice. */
	cancelled?: () => boolean;
}

export interface ChildKernelContext {
	id: string;
	name: string;
	depth: number;
	/** Sends a message to the session that spawned this kernel. */
	onMessage: (text: string) => void;
	/** Spawns a grandchild through the same manager, one level deeper. */
	spawn: (request: Omit<SpawnRequest, "depth" | "ownerDispatch" | "spawnCell">) => Promise<ChildHandle>;
	/** The registry lives in the root, so a child reads it through the manager. */
	poll: (selector: string) => ChildHandle;
	list: () => ChildHandle[];
	remove: (selector: string) => Promise<ChildHandle>;
	send: (selector: string, text: string) => Promise<ChildHandle>;
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
}

interface ChildRecord extends ChildHandle {
	session?: any;
	noticeRead: boolean;
	deleted: boolean;
	cost: CostTotals;
	countedIds: Set<string>;
}

export interface ChildManagerDeps {
	cwd: () => string;
	/** The manager's own session file, for the process-wide tree walk (v2 ticket 07). */
	ownSessionFile?: () => string | undefined;
	kernelFactoryFor: (child: ChildKernelContext) => (pi: any) => void;
	/**
	 * Extra extension factories injected into a child — currently the Magic Context
	 * shim (tickets 07/16). Children still load no *ambient* extensions.
	 */
	childFactories?: (request: SpawnRequest) => Array<(pi: any) => void>;
	runtime: () => Promise<any>;
	maxDepth: number;
	maxLive: number;
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

function sessionEntries(session: any): any[] {
	try {
		const entries: any[] = session?.sessionManager?.getEntries?.() ?? [];
		return Array.isArray(entries) ? entries : [];
	} catch {
		return [];
	}
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

function handleOf(record: ChildRecord): ChildHandle {
	const { session: _session, noticeRead: _noticeRead, deleted: _deleted, cost: _cost, countedIds: _countedIds, ...handle } = record;
	return { ...handle };
}

/** The rollup, falling back to the last message's usage while entries are still landing. */
function usageOfRecord(record: ChildRecord): ChildHandle["usage"] | undefined {
	const totals = foldSessionCost(record.session, record.cost, record.countedIds);
	if (totals.entries === 0) return lastMessageUsage(record.session);
	return { input_tokens: totals.input, output_tokens: totals.output, total_tokens: totals.total };
}

export function createChildManager(deps: ChildManagerDeps) {
	const records = new Map<string, ChildRecord>();
	let counter = 0;

	/** Direct children with their tokens — the edges of one level of the tree. */
	function directChildren(): Array<{ session_file: string | null; tokens: number }> {
		return [...records.values()]
			.filter((record) => !record.deleted)
			.map((record) => ({ session_file: record.session_file, tokens: foldSessionCost(record.session, record.cost, record.countedIds).total }));
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
		const settingsManager = piModule.SettingsManager.create(cwd, directory);
		const id = `child-${++counter}`;

		const context: ChildKernelContext = {
			id,
			name: request.name,
			depth: request.depth,
			onMessage: (text) => {
				request.ownerDispatch({
					key: `msg:${id}:${Date.now()}`,
					content: `[${id} "${request.name}"] ${text}`,
					cancelled: () => records.get(id)?.noticeRead === true,
				});
			},
			spawn: (inner) =>
				spawn({
					...inner,
					depth: request.depth + 1,
					spawnCell: "",
					// Provenance matters: a grandchild must record *its* parent, or Magic
					// Context cannot bind it (ticket 16).
					parentSessionFile: inner.parentSessionFile,
					ownerDispatch: request.ownerDispatch,
				}),
			poll,
			list,
			remove,
			send,
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
			extensionFactories: [deps.kernelFactoryFor(context), ...(deps.childFactories?.(request) ?? [])],
			appendSystemPrompt: [
				`You are "${request.name}", a delegated child session (depth ${request.depth}). Work the task and answer it.`,
				// v2 ticket 05: RLM owns the kernel and delegation sentence, and it is
				// deliberately parent-only — a child is told where its results go, not that it
				// may one day have children of its own.
				"You have a persistent Python kernel. You may delegate with rlm.spawn(name=..., prompt=...); results arrive as messages, never as the call's return value.",
				"Use agent_message.send(text) to send anything your parent needs before you finish.",
			],
		});
		await loader.reload();

		// A child lands beside its parent so the transcript tree is findable, and the
		// header's parentSession is what lets Magic Context recognise it (ticket 16).
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

		const { session } = await piModule.createAgentSession({
			cwd,
			agentDir: directory,
			modelRuntime,
			...(resolved?.model ? { model: resolved.model } : {}),
			...(resolved?.thinkingLevel ? { thinkingLevel: resolved.thinkingLevel } : {}),
			resourceLoader: loader,
			sessionManager,
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
			session,
			noticeRead: false,
			deleted: false,
			cost: { input: 0, output: 0, total: 0, entries: 0 },
			countedIds: new Set<string>(),
		};
		records.set(id, record);

		// Register this manager under its own session file so the root can total the tree.
		const ownFile = deps.ownSessionFile?.();
		if (ownFile && !managerChildren.has(ownFile)) registerManagerView(ownFile, directChildren);

		// Admission-only: the turn runs on its own, and completion is a notice.
		void (async () => {
			try {
				await session.prompt(request.prompt);
				record.status = "done";
			} catch (error) {
				record.status = "failed";
				record.reason = error instanceof Error ? error.message : String(error);
			} finally {
				record.ended_at = new Date().toISOString();
				record.usage = usageOfRecord(record);
				const spent = record.usage?.total_tokens ? ` ${record.usage.total_tokens} tokens` : "";
				const detail = [
					`[${id} "${record.name}"] finished: ${record.status}${spent}`,
					record.reason ? `— ${record.reason}` : "",
					record.session_file ? `\nsession: ${record.session_file}` : "",
					`\nRead the result with await rlm.poll("${id}") or the stored transcript (the session file is outside the workspace mount, so read it through await bash("cat …")).`,
				]
					.filter(Boolean)
					.join(" ");
				request.ownerDispatch({
					key: `done:${id}`,
					content: detail,
					cancelled: () => record.noticeRead,
				});
			}
		})();

		return handleOf(record);
	}

	/** A poll or list is a read: it cancels the pending completion notice. */
	function poll(selector: string): ChildHandle {
		const record = find(selector);
		record.noticeRead = true;
		record.usage = usageOfRecord(record) ?? record.usage;
		return handleOf(record);
	}

	function list(): ChildHandle[] {
		const visible = [...records.values()].filter((record) => !record.deleted);
		for (const record of visible) {
			// A list is a read: refresh the rollup and cancel the pending notices.
			record.usage = usageOfRecord(record) ?? record.usage;
			if (record.status !== "running") record.noticeRead = true;
		}
		return visible.map(handleOf);
	}

	/** Stops if running, tombstones the record, and never erases a transcript. */
	async function remove(selector: string): Promise<ChildHandle> {
		const record = find(selector);
		if (record.status === "running") {
			try {
				await record.session?.abort();
			} catch {
				/* best effort */
			}
			record.status = "stopped";
			record.ended_at = new Date().toISOString();
		}
		record.deleted = true;
		record.noticeRead = true;
		return handleOf(record);
	}

	async function send(selector: string, text: string): Promise<ChildHandle> {
		const record = find(selector);
		if (record.status === "running") {
			await record.session?.followUp(text);
		} else {
			record.status = "running";
			record.ended_at = null;
			record.noticeRead = false;
			void (async () => {
				try {
					await record.session?.prompt(text);
					record.status = "done";
				} catch (error) {
					record.status = "failed";
					record.reason = error instanceof Error ? error.message : String(error);
				} finally {
					record.ended_at = new Date().toISOString();
					record.usage = usageOfRecord(record);
				}
			})();
		}
		return handleOf(record);
	}

	return {
		spawn,
		poll,
		list,
		remove,
		send,

		/** v2 ticket 07: every descendant's tokens, walked in-process. */
		treeCost: () => treeTokens(deps.ownSessionFile?.()),

		liveCount: () => [...records.values()].filter((record) => record.status === "running").length,

		/** Ticket 06: parent teardown kills descendants and marks them terminal. */
		async shutdownAll(): Promise<void> {
			for (const record of records.values()) {
				if (record.status !== "running") continue;
				record.status = "stopped";
				record.ended_at = new Date().toISOString();
				try {
					await record.session?.abort();
				} catch {
					/* best effort */
				}
				try {
					record.session?.dispose();
				} catch {
					/* best effort */
				}
			}
		},
	};
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
