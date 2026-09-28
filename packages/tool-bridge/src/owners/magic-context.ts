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
 *   - forwards `context`, `session_before_compact`, `message_end` and `session_shutdown`.
 *
 * It **registers no tool of its own** — not the three `ctx_*` proxies it used to (`child-surface` ticket
 * 03 §4) and not `todowrite` (`one-tool-surface` ticket 06). A child reaches every one of them from its
 * own cell through the tool bridge, whose generated line states how: two routes to one effect was the
 * thing this whole seam exists to remove, and each removed route also meant a child holding tools the
 * bridge could not offer in a session with no kernel.
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
	return "magic-context: registry found — children are context-managed by the parent's instance and reach its tools, todos included, from their own cell through the bridge";
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

			// Nothing is registered for the child (`.scratch/one-tool-surface/` ticket 06): the child's
			// tools are its *cell's*, as they are for a root, so the shim's job is the binding and the
			// forwarding below and nothing more. The one tool it used to register — `todowrite` — is
			// published now, and `tool("todowrite", …)` reaches the same definition with the same
			// capture behind it (`observePiToolCallStart`), which is why the duplicate route is gone.
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
	// No native-only tool any more (`.scratch/one-tool-surface/` ticket 05): `todowrite` was the only
	// member, and it stopped qualifying when its effect moved into the bridge's executor — the owner's
	// `execute` now runs the same observers pi's dispatch runs for it. The declaration stays on the type,
	// because "must this stay a real pi tool?" is still a question an owner can only answer about its own
	// tool (the mechanism is tested in `test/adapter.test.ts` with a fixture).
	// Nothing is declared child-eligible any more (`.scratch/one-tool-surface/` ticket 06): a child holds
	// no tool of its own, and reaches every one of them — `ctx_*` and `todowrite` alike — from its cell
	// through the bridge. The list stays on the type, because "may a child hold this?" is still a question
	// an owner may have to answer.
	childFactories: (request: ChildRequest) => [shimFor(request.parentSessionFile)],
	bindChild: bind,
	childStatus: statusLine,
};
