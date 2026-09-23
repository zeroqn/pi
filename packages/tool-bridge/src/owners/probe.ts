/**
 * The acceptance instrument (`.scratch/child-surface/` ticket 07).
 *
 * The bar has to measure what a child was *actually* offered. A child loads no ambient extensions, so
 * the owner seam is the only route in — and the child's own `rlm-child-surface` entry is written by the
 * code under test, which makes it evidence of a kind but not an independent one. This owner supplies the
 * independent half: it reads `getActiveTools()` and `getAllTools()` from pi's own api at
 * `before_agent_start` and appends them to the child's transcript, so "a child's surface is exactly
 * `[python, todowrite]`" can be *equality* rather than "it called those two".
 *
 * It is present in the owner list only when `PI_TOOL_BRIDGE_PROBE` is set — an env-gated seam of the same
 * kind as `__resetToolBridgeForTests`, so it ships inert and nothing that is not measuring pays for it.
 * It publishes nothing, binds nothing, and contributes no child factory when the variable is unset.
 */
import type { ChildRequest } from "../child-seam";
import type { OwnerModule } from "./index";

/** What the probe writes into the child's own transcript. */
export type ChildProbeEntry = {
	/** pi's active set, as pi reports it. */
	active: string[];
	/** Every tool in pi's registry — the equality half: a spawned child's registry is the ceiling. */
	registered: string[];
	/** The child's own session id, so a reader can tie the entry to the session it describes. */
	session?: string;
};

function probeFactory() {
	return (childPi: any): void => {
		childPi.on("before_agent_start", (_event: unknown, ctx: any) => {
			try {
				const entry: ChildProbeEntry = {
					active: childPi.getActiveTools?.() ?? [],
					registered: (childPi.getAllTools?.() ?? []).map((tool: { name: string }) => tool.name),
					session: ctx?.sessionManager?.getSessionId?.(),
				};
				childPi.appendEntry?.("rlm-child-probe", entry);
			} catch {
				// An instrument must never take a session down, and a probe that cannot write is a probe
				// that reports nothing rather than a session that fails.
			}
			return undefined;
		});
	};
}

export const probe: OwnerModule = {
	name: "probe",
	childFactories: (_request: ChildRequest) => [probeFactory()],
	childStatus: () =>
		"probe: active — a child's surface is appended to its own transcript as rlm-child-probe",
};
