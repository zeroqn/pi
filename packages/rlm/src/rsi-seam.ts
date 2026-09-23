/**
 * The RLM side of the RSI seam — which is now one thing: how RSI reaches a child session.
 *
 * rlm spawns children, so rlm is what must inject RSI into a spawned child's loader and tell RSI
 * that a session *is* a child. Everything else the two used to say to each other went where the
 * knowledge belongs (wayfinder map `.scratch/rsi-oneway`): the learned store is RSI's own
 * contribution to code mode's ledger, the skills block is RSI's own `before_agent_start`, usage is
 * counted from the journal RSI already reads, and the write capability is the kernel handle RSI
 * holds.
 *
 * **RSI's shapes stop here.** rlm fills in an RSI-shaped interface at the call site — no spawn
 * request, no descriptor crosses it — and the only literal the two share is the `Symbol.for` key,
 * which is the agreed contract.
 *
 * The shape is the process-global one every seam here uses, for the same reason: pi's jiti loader
 * re-imports modules per session (`moduleCache: false`), so module-level state does not survive
 * across sessions in one process. Resolution happens at call time, so an RSI that appears later is
 * found and an RSI that is absent is a degradation rather than a failure.
 *
 * **With RSI absent both functions are inert** and a child runs exactly as it did before: no
 * factory, no bind, no error.
 */

const REGISTRY_KEY = Symbol.for("@earendil/rsi:pi-registry");

/** The child interface, in RSI's vocabulary. Deliberately the whole of what this build calls. */
interface RsiFacade {
	childExtension?(): ((pi: unknown) => void) | undefined;
	bindChild?(fact: { sessionFile?: string }): void;
}

/**
 * Finds RSI's facade.
 *
 * The key above is the agreed contract; the shape check is what turns "something is on that slot"
 * into a facade this build can call. There is deliberately **no fallback scan** over
 * `Object.getOwnPropertySymbols` looking for a symbol whose description matches `/rsi/i` — that was
 * the consumer guessing at the provider's identity on every `session_start`, and the key already
 * answers the question.
 */
export function findRsiSeam(): RsiFacade | null {
	const direct = (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
	return isFacade(direct) ? direct : null;
}

function isFacade(value: unknown): value is RsiFacade {
	if (!value || typeof value !== "object") return false;
	const shaped = value as RsiFacade;
	return typeof shaped.childExtension === "function" && typeof shaped.bindChild === "function";
}

/** Logged once per session, so a missing RSI is visible without being noisy. */
export function rsiStatus(): string {
	const facade = findRsiSeam();
	if (!facade) return "rsi: no registry — a child runs without it (degradation, not failure)";
	return "rsi: registry found — a child is served by it";
}

/**
 * The extension factories a spawned child's loader is given, or `[]` when RSI is absent or too old.
 *
 * The factory takes no argument. Every field the old descriptor carried was unread, and the child
 * signal now arrives through {@link rsiBindChild} for a spawned child and a resumed one alike.
 */
export function rsiChildExtensions(): Array<(pi: unknown) => void> {
	const facade = findRsiSeam();
	if (!facade?.childExtension) return [];
	try {
		const factory = facade.childExtension();
		return typeof factory === "function" ? [factory] : [];
	} catch {
		return [];
	}
}

/**
 * Tells RSI that a session is a child.
 *
 * Called for a spawned child and a resumed one alike, because rlm is what computes `isChild`
 * (`childContext !== null || readChildProvenance(...) !== null`). Best effort: a seam that throws
 * must not fail a session's start, and a child whose bind is lost is served as a root rather than
 * not at all.
 */
export function rsiBindChild(input: { sessionFile?: string }): void {
	const facade = findRsiSeam();
	if (!facade?.bindChild) return;
	try {
		facade.bindChild({ sessionFile: input.sessionFile });
	} catch {
		/* see above */
	}
}
