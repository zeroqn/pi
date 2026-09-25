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
 * The shim does four things:
 *   - binds the child explicitly — the header is not enough, because a `/fork` also carries
 *     `parentSession` (v1 ticket 04/16);
 *   - registers the child's **`todowrite`** from the capability the registry hands over, and forwards the
 *     child's `message_end` to that capability's capture, so the tool and the thing that records its state
 *     are one value (`.scratch/child-surface/` ticket 05);
 *   - forwards `context`, `session_before_compact`, `message_end` and `session_shutdown`.
 *
 * It **no longer registers `ctx_search`/`ctx_reduce`/`ctx_expand` as proxies** (`.scratch/child-surface/`
 * ticket 03 §4): a child reaches those from its own cell through the tool bridge, whose generated line
 * states how. Two routes to one effect was the thing this whole seam exists to remove, and the proxies
 * also meant a child's manual advertised tools that the bridge could not offer in a session with no
 * kernel.
 *
 * Until the registry exists, every hook is a no-op and children fall back to pi's native compaction. That
 * is a **degradation, not a failure**: the bridge must run correctly with this owner absent, old, or
 * missing the registry entirely, and `childStatus()` reports which state applies.
 */
import type { ChildBindInput, ChildRequest } from "../../../host-bridge/src/convention";
import type { OwnerModule } from "./index";

const REGISTRY_KEY = Symbol.for("@cortexkit/magic-context:pi-registry");

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
	clearSession?(sessionId: string, sessionFile?: string): void;
	/**
	 * A bound child's todo capability, or `undefined` when the instance cannot serve one.
	 *
	 * **One value, both halves** (`.scratch/child-surface/` ticket 05): a child is never given the tool
	 * without the capture, because a `todowrite` whose state is never recorded is the failure this whole
	 * convention exists to prevent. Its absence is therefore the whole answer to "may a child hold it?" —
	 * and it is absent in an older Magic Context, so a shim must read it optionally.
	 */
	childTodo?(): {
		definition: Record<string, unknown>;
		capture(message: unknown, ctx: unknown): void;
	};
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
	if (!registry.childTodo) {
		return "magic-context: registry found, but it has no childTodo — children are context-managed without a todo tool (older Magic Context)";
	}
	return registry.childTodo()
		? "magic-context: registry found — children are context-managed by the parent's instance, reach its tools from a cell through the bridge, and hold its own todowrite"
		: "magic-context: registry found — children are context-managed and reach its tools from a cell, but no todo tool (todowrite disabled in this project)";
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

/**
 * The shim injected into a child. Registered as an extension factory, so it runs in the child's own
 * session where its `ctx` is authentic.
 */
function shimFor(parentSessionFile: string | undefined) {
	return (childPi: any): void => {
		const registry = findMagicContextRegistry();
		if (!registry) return;
		// Resolved once, in the child's own `session_start`, and read by the `message_end` handler
		// below: one value carrying the tool *and* its capture, so the two cannot come apart.
		let todo: { definition: Record<string, unknown>; capture(m: unknown, c: unknown): void } | undefined;

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

			// `.scratch/child-surface/` ticket 05: the child's own `todowrite`, from the one value the
			// registry hands over. Registered only when that value exists, so an older Magic Context (or a
			// project with todowrite disabled) offers the child nothing rather than a tool whose state
			// would never be recorded. No activation step: the ceiling admits `todowrite` (Magic Context
			// declares it child-eligible) and pi activates an allowed registration itself.
			todo = registry.childTodo?.();
			if (!todo) return;
			try {
				childPi.registerTool(todo.definition);
			} catch {
				// A refused registration must not take the child's session down.
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
		childPi.on("message_end", async (event: any, ctx: any) => {
			try {
				registry.scrubMessage(event?.message);
			} catch {
				/* scrubbing is best effort */
			}
			// The capture rides the hook the bridge already has, which is the one Magic Context's own
			// comment justifies for this path: it catches a todowrite-shaped call **even when pi could not
			// execute it**, and the shape gate was written for it. `tool_execution_start` is deliberately
			// not forwarded — that is where Magic Context's trigger machinery lives, and a child's plan is
			// not a signal for it.
			try {
				todo?.capture(event?.message, ctx);
			} catch {
				/* capture is best effort, exactly as the scrub is */
			}
		});

		childPi.on("session_shutdown", async (_event: unknown, ctx: any) => {
			try {
				const sessionId = ctx?.sessionManager?.getSessionId?.();
				// The shim owns the child's lifecycle, so it clears the child's state — **and its
				// binding**, which is keyed by the child's session file. Clearing the id alone was a
				// silent no-op that a second, id-keyed mark used to paper over
				// (`.scratch/child-surface/` ticket 04).
				if (sessionId)
					registry.clearSession?.(sessionId, ctx?.sessionManager?.getSessionFile?.());
			} catch {
				/* best effort */
			}
		});
	};
}

/** What this owner declares to the bridge. */
export const magicContext: OwnerModule = {
	name: "magic-context",
	// `todowrite` writes nothing itself — Magic Context captures its state from the transcript — so a
	// call routed through a cell would succeed and record nothing. It has to stay a real pi tool.
	nativeOnly: ["todowrite"],
	// Equal to `nativeOnly` today, and kept as its own list so a future divergence is a decision
	// (map ticket 03). `ctx_*` is deliberately absent: after the split, a child reaches those from its
	// cell through the bridge, and `ctx_search`/`ctx_reduce`/`ctx_expand` stay callable there (ticket 04).
	childEligible: ["todowrite"],
	childFactories: (request: ChildRequest) => [shimFor(request.parentSessionFile)],
	bindChild: bind,
	childStatus: statusLine,
};
