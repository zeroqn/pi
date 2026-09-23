/**
 * Magic Context as a bridge owner — the child half of the seam (wayfinder ticket 05,
 * `.scratch/tool-ownership/`; the seam itself is tickets 07/16 of `.scratch/rlm-extension/` and v2's
 * 02/03/05 of `.scratch/rlm-v2/`).
 *
 * A child loads no ambient extensions, so Magic Context's own factory never runs in one. This owner
 * injects a **thin shim** instead, which forwards the child's context and compaction events to its
 * parent's instance through the process-global registry Magic Context publishes. The child therefore
 * holds no Magic Context storage, no factory and no allowlisted-away tools.
 *
 * The shim does three things:
 *   - registers the **three tools a bound child is granted** (`ctx_search`, `ctx_reduce`, `ctx_expand`)
 *     as thin proxies routing to the parent's instance through `runTool`, so `ctx_memory`, `ctx_note`
 *     and the todo tools are simply absent by name (v2 ticket 02);
 *   - binds the child explicitly — the header is not enough, because a `/fork` also carries
 *     `parentSession` (v1 ticket 04/16) — and by session id, because reduced mode is marked per id;
 *   - forwards `context`, `session_before_compact`, `message_end` and `session_shutdown`.
 *
 * Until the registry exists, every hook is a no-op and children fall back to pi's native compaction. That
 * is a **degradation, not a failure**: the bridge must run correctly with this owner absent, old, or
 * missing the registry entirely, and `childStatus()` reports which of the three states applies.
 */
import type { ChildBindInput, ChildRequest } from "../child-seam";
import type { OwnerModule } from "./index";

const REGISTRY_KEY = Symbol.for("@cortexkit/magic-context:pi-registry");

/** v2 ticket 02: exactly the tools a bound child is granted, and nothing else. */
const CHILD_TOOL_NAMES = ["ctx_search", "ctx_reduce", "ctx_expand"] as const;

interface MagicContextRegistry {
	transformContext(event: unknown, ctx: unknown): Promise<{ messages: unknown[] } | undefined>;
	compact(ctx: unknown): Promise<{ cancel: true } | undefined>;
	scrubMessage(message: unknown): void;
	bindChild(input: {
		childSessionFile?: string;
		childSessionId?: string;
		parentSessionFile?: string;
		cwd?: string;
	}): void;
	clearSession?(sessionId: string): void;
	/** v2: executes one allowlisted Magic Context tool on behalf of a bound child. */
	runTool?(
		toolName: string,
		params: Record<string, unknown>,
		ctx: unknown,
	): Promise<{ content: Array<{ type: string; text: string }>; details?: unknown }>;
}

/**
 * Finds the registry. The exact key is part of the interface the owner agrees to; the fallback scan
 * exists so a differently-named registry with the right shape still works rather than silently
 * degrading.
 */
function findMagicContextRegistry(): MagicContextRegistry | null {
	const direct = (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
	if (isRegistry(direct)) return direct;
	for (const symbol of Object.getOwnPropertySymbols(globalThis)) {
		if (!/magic.?context/i.test(String(symbol.description ?? ""))) continue;
		const candidate = (globalThis as Record<symbol, unknown>)[symbol];
		if (isRegistry(candidate)) return candidate;
	}
	return null;
}

function isRegistry(value: unknown): value is MagicContextRegistry {
	return Boolean(value) && typeof (value as MagicContextRegistry).transformContext === "function";
}

/** Logged once per session, so the degradation is visible without being noisy. */
function statusLine(): string {
	const registry = findMagicContextRegistry();
	if (!registry) {
		return "magic-context: no registry — children fall back to pi's native compaction (degradation, not failure)";
	}
	return registry.runTool
		? "magic-context: registry found — children are context-managed by the parent's instance and granted ctx_search/ctx_reduce/ctx_expand"
		: "magic-context: registry found, but it has no runTool — children are context-managed without the granted tools (older Magic Context)";
}

/**
 * Binds a session to its parent's instance. Called by the shim for a freshly spawned child, and by the
 * adopter when a session turns out to be a child from its own header (v2 ticket 09).
 *
 * A throw is **not** swallowed here: the adopter's call goes through the seam, which contains a throwing
 * owner so one owner cannot stop another's bind (ticket 02). The shim, which runs inside the child with
 * no seam above it, contains its own call.
 */
function bind(input: ChildBindInput): void {
	const registry = findMagicContextRegistry();
	if (registry) registry.bindChild(input);
}

/** The parameter schemas mirror Magic Context's own, so a child's calls are shaped identically. */
const CHILD_TOOLS: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [
	{
		name: "ctx_search",
		description:
			"Search this project's memory (and your own session's messages) for anything relevant. Returns tagged hits you can open with ctx_expand.",
		parameters: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query." },
				limit: { type: "number", description: "Maximum results to return (default: 10)" },
				sources: {
					type: "array",
					items: { type: "string" },
					description: "Which sources to search, e.g. memory, message, git_commit, primer, note",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "ctx_reduce",
		description:
			"Reclaim context in your own window by dropping tagged items you have already processed. Ranges: '3-5', '1,2,9'.",
		parameters: {
			type: "object",
			properties: { drop: { type: "string", description: "Tag IDs to drop entirely. Ranges: '3-5', '1,2,9'" } },
			required: ["drop"],
		},
	},
	{
		name: "ctx_expand",
		description: "Open a tagged item that is currently compacted, or read a range of your session's messages.",
		parameters: {
			type: "object",
			properties: {
				start: { type: "number", description: 'First message ordinal to expand — a compartment\'s start="N" attribute' },
				end: { type: "number", description: "Last message ordinal to expand (inclusive)" },
				verbose: { type: "boolean", description: "Include more detail per message" },
				message: { type: "number", description: "A single message ordinal to expand" },
			},
			required: [],
		},
	},
];

/**
 * The shim injected into a child. Registered as an extension factory, so it runs in the child's own
 * session where its `ctx` is authentic.
 */
function shimFor(parentSessionFile: string | undefined) {
	return (childPi: any): void => {
		const registry = findMagicContextRegistry();
		if (!registry) return;

		childPi.on("session_start", async (_event: unknown, ctx: any) => {
			// Explicit binding: the parent already knows it is spawning, and the header is not enough —
			// a /fork also carries `parentSession` (v1 ticket 04/16). Best effort, because this runs in
			// the child's own session with no seam above it.
			try {
				bind({
					childSessionFile: ctx?.sessionManager?.getSessionFile?.(),
					// v2 ticket 02/03: Magic Context marks the child reduced by session id — the pass
					// decides by id — so the id travels with the binding, not just the file.
					childSessionId: ctx?.sessionManager?.getSessionId?.(),
					parentSessionFile,
					cwd: ctx?.cwd,
				});
			} catch {
				/* binding is best effort */
			}

			// v2 ticket 02: the granted tools, as proxies. Registered only when the registry can execute
			// them, so an older Magic Context degrades to "no tools" rather than "tools that fail".
			if (typeof registry.runTool !== "function") return;
			for (const tool of CHILD_TOOLS) {
				try {
					childPi.registerTool({
						...tool,
						async execute(_toolCallId: unknown, params: Record<string, unknown>, _signal: unknown, _onUpdate: unknown, ctx: any) {
							try {
								return await registry.runTool?.(tool.name, params ?? {}, ctx);
							} catch (error) {
								return {
									content: [
										{
											type: "text",
											text: `Error: ${tool.name} failed — ${error instanceof Error ? error.message : String(error)}`,
										},
									],
								};
							}
						},
					});
				} catch {
					// A refused registration must not take the child's session down.
				}
			}
		});

		childPi.on("context", async (event: unknown, ctx: any) => {
			try {
				return await registry.transformContext(event, ctx);
			} catch {
				return undefined;
			}
		});

		childPi.on("session_before_compact", async (_event: unknown, ctx: any) => {
			try {
				// The child's own ctx travels with the call: Magic Context's compaction needs it, and
				// this ctx is authentic because the shim runs inside the child's session.
				return await registry.compact(ctx);
			} catch {
				/* a failed compaction must not strand the child */
				return undefined;
			}
		});

		// The transform tags messages, so the tags must be scrubbed before the child's own transcript
		// persists them, exactly as Magic Context does for a normal session.
		childPi.on("message_end", async (event: any) => {
			try {
				registry.scrubMessage(event?.message);
			} catch {
				/* scrubbing is best effort */
			}
		});

		childPi.on("session_shutdown", async (_event: unknown, ctx: any) => {
			try {
				const sessionId = ctx?.sessionManager?.getSessionId?.();
				// The shim owns the child's lifecycle, so it clears the child's state.
				if (sessionId) registry.clearSession?.(sessionId);
			} catch {
				/* best effort */
			}
		});
	};
}

/** Exported for the test that asserts exactly which tools a child is granted. */
export const GRANTED_CHILD_TOOLS: readonly string[] = CHILD_TOOL_NAMES;

/** What this owner declares to the bridge. */
export const magicContext: OwnerModule = {
	name: "magic-context",
	// `todowrite` writes nothing itself — Magic Context captures its state from the transcript — so a
	// call routed through a cell would succeed and record nothing. It has to stay a real pi tool.
	nativeOnly: ["todowrite"],
	childFactories: (request: ChildRequest) => [shimFor(request.parentSessionFile)],
	bindChild: bind,
	childStatus: statusLine,
};
