/**
 * The entry: pi's root manifest loads this file, and a spawned child's loader is handed this package's
 * factory (map ticket 03, `.scratch/host-bridge/`).
 *
 * It is deliberately thin — {@link installHandlers} is the whole of it, and it lives in `./compose` so
 * that the same three handlers serve the root session and a child. What this file adds is the *name*:
 * `packages/host-bridge/src/index.ts` is the manifest entry, declared **immediately before
 * `magic-context`** so that a contributor's system-prompt text lands where web-access's own entry puts
 * it today (Magic Context *composes from* the incoming prompt, `vendor/.../pi-plugin/src/index.ts:2217`,
 * so an earlier append survives it), while `pi-tool-bridge` keeps the **last** slot its surface rule
 * needs.
 *
 * Nothing here reads a store, executes a tool, or touches pi's active set. Those are a contributor's
 * business and `pi-tool-bridge`'s rule respectively; this package only decides who writes into a
 * session's host surface, and which session gets which.
 */
import { type BridgeSurface, installHandlers } from "./compose";

export default function hostBridge(pi: BridgeSurface): void {
	installHandlers(pi, {});
}

export {
	type BridgeSurface,
	type ComposeOutcome,
	type ChildCeiling,
	type ChildRequest,
	appendPromptTexts,
	childFactories,
	composeSession,
	installHandlers,
} from "./compose";
export * from "./client";
export * from "./convention";
