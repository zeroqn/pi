/**
 * The teaching contribution (wayfinder ticket 03, built by ticket 13).
 *
 * A `session` answer carrying one guideline — which lands in the `python` tool's `<rules>` — and only
 * when the session has at least one **configured** server. With no server the session pays zero: the
 * contribution is `null`, exactly as it was before this package taught anything.
 *
 * The config is read *here*, not from a `session_start` handler, because the composition root (and its
 * contributor order) may ask before that handler has run: `pi-mcp-lazy` sorts before `pi-tool-bridge`,
 * but nothing should depend on that. The read is cached per session, so the factory's own
 * `session_start` sees the same list rather than reading `mcp.json` twice.
 */
import { ROUTE_GUIDELINE } from "./section";
import { type ConfigReadDeps, ensureServers, stateFor } from "./state";

export type TeachingInput = { ctx: unknown; sessionKey?: string };

export type TeachingAnswer = {
	contribution: { owner: string; guidelines: string[] };
};

/** The contribution `mcp-lazy` offers one session, or `null` when it has no configured server. */
export function sessionAnswer(input: TeachingInput, deps: ConfigReadDeps): TeachingAnswer | null {
	const state = stateFor(input.ctx);
	ensureServers(state, input.ctx, deps);
	if ((state.servers?.length ?? 0) === 0) return null;
	return { contribution: { owner: "mcp-lazy", guidelines: [ROUTE_GUIDELINE] } };
}
