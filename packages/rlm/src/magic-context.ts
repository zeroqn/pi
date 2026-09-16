/**
 * The RLM side of the Magic Context seam — tickets 07 and 16.
 *
 * Ticket 07 decided RLM children are context-managed by Magic Context, and ticket 16
 * chose seam (B): MC publishes a registry of live Pi instances on `globalThis`, and
 * RLM injects a **thin shim** into each child that forwards the child's context and
 * compaction events to its parent's MC instance. MC's own extension factory still
 * never runs in a child, so ticket 07's structural isolation is intact.
 *
 * Until that registry exists — the MC-side work is specified in
 * `.scratch/rlm-extension/mc-reduced-mode-spec.md` — every function here is a no-op
 * and children fall back to pi's native compaction. That is a **degradation, not a
 * failure**: RLM must run correctly with Magic Context absent, old, or missing the
 * registry entirely.
 */

const REGISTRY_KEY = Symbol.for("@cortexkit/magic-context:pi-registry");

interface MagicContextRegistry {
	transformContext(event: unknown, ctx: unknown): Promise<{ messages: unknown[] } | undefined>;
	compact(ctx: unknown): Promise<{ cancel: true } | undefined>;
	scrubMessage(message: unknown): void;
	bindChild(input: { childSessionFile?: string; parentSessionFile?: string; cwd?: string }): void;
	clearSession?(sessionId: string): void;
}

/**
 * Finds the registry. The exact key is part of the interface MC agrees to; the
 * fallback scan exists so a differently-named registry with the right shape still
 * works rather than silently degrading.
 */
export function findMagicContextRegistry(): MagicContextRegistry | null {
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
export function magicContextStatus(): string {
	return findMagicContextRegistry()
		? "magic-context: registry found — children are context-managed by the parent's instance"
		: "magic-context: no registry — children fall back to pi's native compaction (degradation, not failure)";
}

/**
 * The shim injected into a child. Registered as an extension factory, so it runs in
 * the child's own session where its `ctx` is authentic.
 */
export function magicContextChildShim(parentSessionFile: string | undefined) {
	return (childPi: any): void => {
		const registry = findMagicContextRegistry();
		if (!registry) return;

		childPi.on("session_start", async (_event: unknown, ctx: any) => {
			try {
				const childSessionFile = ctx?.sessionManager?.getSessionFile?.();
				// Explicit binding: the parent already knows it is spawning, and the
				// header is not enough — a /fork also carries `parentSession` (ticket 04).
				// `cwd` lets MC pick the right project when several are open in one process.
				registry.bindChild({ childSessionFile, parentSessionFile, cwd: ctx?.cwd });
			} catch {
				/* never fail a child because MC refused a binding */
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
				// The child's own ctx travels with the call: MC's compaction needs it, and
				// this ctx is authentic because the shim runs inside the child's session.
				return await registry.compact(ctx);
			} catch {
				/* a failed compaction must not strand the child */
				return undefined;
			}
		});

		// Ticket 16: the transform tags messages, so the tags must be scrubbed before the
		// child's own transcript persists them, exactly as MC does for a normal session.
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
