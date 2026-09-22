/**
 * The entry: pi's active set, corrected per turn.
 *
 * This exists as an extension only because of **ordering**. The reconciler runs on
 * `before_agent_start`, handlers run in load order, and the rule has to win against every other
 * extension that touches the active set — including Magic Context, which re-appends `ctx_memory`
 * on `session_start` and is declared last in this workspace. So the root manifest declares this
 * entry *after* it. Move this line up and the rule silently stops working: nothing fails, the
 * tools simply come back.
 *
 * It strips nothing by itself. The rule reads the session's record, and that record exists only
 * when a cell route was installed for that session (`installToolBridge`). No bridge, no change —
 * which is what keeps a code-mode session without the bridge from losing Magic Context's
 * `ctx_memory` re-append, its only route to memory.
 */
import { type ActiveToolSurface, reconcileToolSurface } from "./adapter";
import { forgetSession, sessionKey } from "./convention";

type PiEntrySurface = ActiveToolSurface & {
	on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
};

export default function toolBridge(pi: PiEntrySurface): void {
	pi.on("before_agent_start", (_event, ctx) => {
		reconcileToolSurface(pi, ctx);
		return undefined;
	});
	// `globalThis` outlives `/new`, resume and fork, so a session that ends has to take its
	// record with it; a stale key would keep stripping tools in a session that has no bridge.
	pi.on("session_shutdown", (_event, ctx) => {
		forgetSession(sessionKey(ctx));
		return undefined;
	});
}

export { installToolBridge, reconcileToolSurface, gatherToolBridge } from "./adapter";
export * from "./convention";
