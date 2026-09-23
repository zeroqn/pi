/**
 * The entry: pi's active set, corrected at session start and before every turn.
 *
 * This exists as an extension only because of **ordering**. Handlers run in load order, and the
 * rule has to win against every other extension that touches the active set — including an owner
 * that re-appends one of its own tools on `session_start`. So the root manifest declares this entry
 * *after* every such extension. Move this line up and the rule silently stops working: nothing
 * fails, the tools simply come back.
 *
 * It runs on **both** `session_start` and `before_agent_start`, and the first is not belt and
 * braces: pi builds the turn's system prompt (its tool list, every active tool's snippet and
 * guidelines) from the active set *before* the `before_agent_start` handlers run. Reconciling only
 * per turn therefore left an owner's session-start append in `selectedTools` for that build, while
 * the request itself carried the corrected set — a prompt that named a tool the request had already
 * stripped, next to a tool list that had the opposite. On `session_start` the record
 * already exists, because the adopter installs it in its own `session_start` handler and this entry
 * is declared after that one too.
 *
 * It changes nothing by itself. The rule reads the session's record, and that record exists only
 * when a cell route was installed for that session (`installToolBridge`). No bridge, no change —
 * which is what keeps a code-mode session without the bridge from losing an owner's session-start
 * re-append of its own tool, its only route to it. In a bridged session it does both halves of the
 * rule: it strips the names a cell can reach, and it puts back the native-only tools the convention
 * forbids publishing (`nativeOnlyTools()` — a tool whose state pi captures from its own dispatch, so
 * a bridged call would record nothing).
 */
import {
	type ActiveToolSurface,
	reconcileChildSurface,
	reconcileToolSurface,
	recordChildSurface,
} from "./adapter";
import { childCeiling, detectsChild } from "./child-seam";
import { forgetSession, sessionKey } from "./convention";
import { nativeOnlyTools } from "./owners";

type PiEntrySurface = ActiveToolSurface & {
	on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
	appendEntry?(customType: string, data: unknown): unknown;
};

export default function toolBridge(pi: PiEntrySurface): void {
	/**
	 * Which rule applies to this session, and the ceiling if it is a child.
	 *
	 * A **resumed** child arrives here rather than through a factory: it loads the ambient manifest, so
	 * nothing injected the child path at spawn time and `createAgentSession`'s registry filter never ran.
	 * This entry is the only handler late enough in the manifest — it is declared last, after one
	 * extension that re-appends one of its own tools at `session_start` and another that re-appends one
	 * at `before_agent_start` — to correct the set before the first turn's prompt is built.
	 *
	 * The ceiling is the declared **fallback**: a resumed child has no spawner to read
	 * (`.scratch/child-surface/` tickets 01 §4 and 03 §5).
	 */
	const reconcile = (event: unknown, ctx: unknown, record: boolean) => {
		if (!detectsChild(ctx)) {
			reconcileToolSurface(pi, ctx, nativeOnlyTools());
			return;
		}
		const ceiling = childCeiling();
		const report = reconcileChildSurface({ pi, ctx, ceiling: ceiling.ceiling });
		// Once, at the session's start: the per-turn pass changes nothing a reader needs a second copy
		// of, and a child's transcript should stay readable.
		if (record) recordChildSurface(pi, ceiling, report);
		void event;
	};
	pi.on("session_start", (event, ctx) => {
		reconcile(event, ctx, true);
		return undefined;
	});
	pi.on("before_agent_start", (event, ctx) => {
		reconcile(event, ctx, false);
		return undefined;
	});
	// `globalThis` outlives `/new`, resume and fork, so a session that ends has to take its
	// record with it; a stale key would keep stripping tools in a session that has no bridge.
	pi.on("session_shutdown", (_event, ctx) => {
		forgetSession(sessionKey(ctx));
		return undefined;
	});
}

export {
	installToolBridge,
	reconcileToolSurface,
	reconcileChildSurface,
	recordChildSurface,
	gatherToolBridge,
} from "./adapter";
export * from "./convention";
