/**
 * The entry: pi's active set, corrected at session start and before every turn.
 *
 * This exists as an extension only because of **ordering**. Handlers run in load order, and the
 * rule has to win against every other extension that touches the active set — including Magic
 * Context, which re-appends `ctx_memory` on `session_start`. So the root manifest declares this
 * entry *after* it. Move this line up and the rule silently stops working: nothing fails, the
 * tools simply come back.
 *
 * It runs on **both** `session_start` and `before_agent_start`, and the first is not belt and
 * braces: pi builds the turn's system prompt (its tool list, every active tool's snippet and
 * guidelines) from the active set *before* the `before_agent_start` handlers run. Reconciling only
 * per turn therefore left Magic Context's session-start append in `selectedTools` for that build,
 * while the request itself carried the corrected set — a prompt that named `ctx_memory` and omitted
 * `todowrite`'s guidelines, next to a tool list that had the opposite. On `session_start` the record
 * already exists, because the adopter installs it in its own `session_start` handler and this entry
 * is declared after that one too.
 *
 * It changes nothing by itself. The rule reads the session's record, and that record exists only
 * when a cell route was installed for that session (`installToolBridge`). No bridge, no change —
 * which is what keeps a code-mode session without the bridge from losing Magic Context's
 * `ctx_memory` re-append, its only route to memory. In a bridged session it does both halves of
 * the rule: it strips the names a cell can reach, and it puts back the native-only tools the
 * convention forbids publishing (`NATIVE_ONLY_TOOLS` — today `todowrite`, whose state Magic
 * Context captures from pi's dispatch, so a bridged call would record nothing).
 */
import { type ActiveToolSurface, reconcileToolSurface } from "./adapter";
import { forgetSession, sessionKey } from "./convention";

type PiEntrySurface = ActiveToolSurface & {
	on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
};

export default function toolBridge(pi: PiEntrySurface): void {
	const reconcile = (_event: unknown, ctx: unknown) => {
		reconcileToolSurface(pi, ctx);
		return undefined;
	};
	pi.on("session_start", reconcile);
	pi.on("before_agent_start", reconcile);
	// `globalThis` outlives `/new`, resume and fork, so a session that ends has to take its
	// record with it; a stale key would keep stripping tools in a session that has no bridge.
	pi.on("session_shutdown", (_event, ctx) => {
		forgetSession(sessionKey(ctx));
		return undefined;
	});
}

export { installToolBridge, reconcileToolSurface, gatherToolBridge } from "./adapter";
export * from "./convention";
