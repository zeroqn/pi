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
}

export interface ChildManagerDeps {
	cwd: () => string;
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

function usageOf(session: any): ChildHandle["usage"] | undefined {
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

function handleOf(record: ChildRecord): ChildHandle {
	const { session: _session, noticeRead: _noticeRead, deleted: _deleted, ...handle } = record;
	return { ...handle };
}

export function createChildManager(deps: ChildManagerDeps) {
	const records = new Map<string, ChildRecord>();
	let counter = 0;

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
				`You are "${request.name}", a delegated child session (depth ${request.depth}). Work the task and answer it. Use agent_message.send(...) to send anything your parent needs before you finish.`,
			],
		});
		await loader.reload();

		// A child lands beside its parent so the transcript tree is findable, and the
		// header's parentSession is what lets Magic Context recognise it (ticket 16).
		const parentFile = request.parentSessionFile;
		const sessionManager = parentFile
			? piModule.SessionManager.create(cwd, dirname(parentFile), { parentSession: parentFile })
			: piModule.SessionManager.create(cwd);
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
		};
		records.set(id, record);

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
				record.usage = usageOf(session);
				const detail = [
					`[${id} "${record.name}"] finished: ${record.status}`,
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
		return handleOf(record);
	}

	function list(): ChildHandle[] {
		const visible = [...records.values()].filter((record) => !record.deleted);
		for (const record of visible) {
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
					record.usage = usageOf(record.session);
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
