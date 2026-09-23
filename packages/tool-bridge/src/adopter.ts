/**
 * The adopter: read what the owners publish for this session, contribute the bridge to a kernel, and
 * report what happened.
 *
 * This is the half an extension with a kernel calls (wayfinder ticket 06,
 * `.scratch/tool-ownership/`; the bridge itself is `.scratch/tool-bridge/`). An owner publishes its pi
 * tools on the `pi-tool-bridge:owners` slot; a cell reaches them through the one host function the
 * bridge contributes. Without this call the tools stay registered but unreachable in a code-mode
 * session, and the owner's own prompt keeps naming them.
 *
 * Two properties of the package decide the shape of this call, and both are load-bearing:
 *
 *  - **The bridge contributes itself.** It has to see the receipt: the session record the surface rule
 *    reads is written only when the ledger accepted the contribution. So this does not return a
 *    contribution for a caller to submit — it is called once the kernel handle exists, with the
 *    handle's own `contribute`.
 *  - **The window closes at the kernel's first cell**, so this runs in `session_start`, immediately
 *    after the bind, and a session that binds nothing is left alone entirely.
 *
 * Nothing here throws: a bridge that cannot work degrades to "no bridge", which is the state the
 * session was in before, and the reason is recorded rather than lost.
 */
import { type KernelContribute, installToolBridge } from "./adapter";

export type BridgeReport = {
	/** The pi tool names a cell can now call. Empty when nothing was bridged. */
	installed: string[];
	/** One line per drop, for the session's own record — never for the model. */
	problems: string[];
	/** Why nothing was bridged, when nothing was. */
	reason?: string;
};

/**
 * Reads every publication for this session, contributes the bridge, and reports what happened.
 * Called with the bound kernel handle's `contribute` and the session's own `ctx` — the ctx travels
 * into every executor because the tools resolve their own session from it.
 */
export function adoptToolBridge(input: {
	contribute: KernelContribute;
	ctx: unknown;
}): BridgeReport {
	try {
		const result = installToolBridge({
			contribute: input.contribute,
			ctx: input.ctx,
		});
		return {
			installed: result.installed,
			problems: result.problems.map(describe),
			reason: result.reason,
		};
	} catch (error) {
		// The bridge is another package's code running inside a `session_start` handler: a throw
		// here must not take the session's start with it.
		return {
			installed: [],
			problems: [],
			reason: `the bridge threw — ${describeError(error)}`,
		};
	}
}

function describe(problem: { owner: string; reason: string; entry?: string }): string {
	const where = problem.entry === undefined ? "" : ` (entry '${problem.entry}')`;
	return `${problem.owner}: ${problem.reason}${where}`;
}

function describeError(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * The one line a session's own entry carries about the bridge. Deliberately not part of an adopter's
 * `problems` array: that array means "the kernel is unavailable" and notifies the human, while a
 * bridge that installed nothing is a state the session was already in — it is recorded here, where a
 * later reader can tell *present and bridged* from *present and not*.
 */
export function bridgeStatusLine(report: BridgeReport | undefined): string {
	if (!report) {
		return "tool bridge: not reached — no kernel was bound for this session";
	}
	if (report.installed.length > 0) {
		const suffix = report.problems.length > 0 ? `; dropped: ${report.problems.join("; ")}` : "";
		return `tool bridge: a cell can call ${report.installed.join(", ")}${suffix}`;
	}
	return `tool bridge: nothing installed — ${report.reason ?? "no reason given"}`;
}
