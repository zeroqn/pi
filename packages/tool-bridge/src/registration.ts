/**
 * The registration: what `pi-tool-bridge` offers a session, and what it offers a child
 * (`.scratch/host-bridge/` ticket 05).
 *
 * Before this, the package *was* half of a seam: rlm called its adopter, which gathered the owners'
 * publications, handed the kernel a `tool` host function and wrote the record itself. Now the
 * composition root does the mounting, the contributing and the recording, and this module is what it
 * asks — one offer per session, plus the four child facts the seam needs from whichever package knows
 * them:
 *
 *   - **`session(input)`** gathers for that session and answers with the contribution. `reaches` is the
 *     catalogue's names, which is the one thing only the owner's own reader knows, and host-bridge
 *     records it **only if the ledger accepted the contribution** — the reason the record can be
 *     trusted by the surface rule.
 *   - **`childEligible`** is the owners' own list (`.scratch/child-surface`), the ceiling's policy half.
 *   - **`childFactories`** are the owners' factories; the surface rule is *not* among them, because it
 *     is declared as `childSurface` so the seam gives it the last word among contributors.
 *   - **`bindChild` / `childStatus`** are the owners' dispatch and status, contained by the seam.
 *
 * Everything here is contained: a gather that throws, an owner that throws, a status that throws —
 * each costs its own contribution or its own line and never the session.
 */
import { gatherToolBridge, renderCatalogue, bridgeGuidelines, toolHostFn } from "./adapter";
import { type ChildBindInput, type ChildRequest, type ContributorAnswer, type ContributorRegistration, type SessionInput } from "../../host-bridge/src/convention";
import { API_VERSION as HOST_API_VERSION } from "../../host-bridge/src/convention";
import { childSurfaceFactory } from "./adapter";
import { READER } from "./convention";
import { OWNERS, childEligibleTools } from "./owners";

/** This package's instance key in the composition root's registry. */
const KEY = "pi-tool-bridge";

/**
 * What this session may call, in one answer.
 *
 * `null` when no owner offers a usable tool: a contribution whose only content would be an empty
 * catalogue is worse than none, because it would put `tool()` in the kernel without a name to call.
 */
export function toolBridgeAnswer(input: SessionInput): ContributorAnswer | null {
	const gathered = gatherToolBridge(input.ctx);
	if (gathered.tools.length === 0) return null;
	return {
		contribution: {
			owner: READER,
			hostFns: { tool: toolHostFn(gathered, input.ctx) },
			guidelines: bridgeGuidelines(gathered),
		},
		reaches: gathered.tools.map((tool) => tool.entry.name),
		// The composition root cannot see inside an owner's catalogue, so a drop is loud only because
		// it is reported here: these join the seam's own problems in the session's record.
		problems: gathered.problems.map((problem) => `${problem.owner}: ${problem.reason}`),
	};
}

/**
 * Every owner's child status, joined; a throwing owner contributes a line saying so.
 *
 * **Not** the seam's `childStatus`: that one asks the contributors, and asking it from here would call
 * back into this function (the recursion a live run found as a stack overflow rather than as a wrong
 * status line).
 */
function ownersChildStatus(): string {
	const lines: string[] = [];
	for (const owner of OWNERS) {
		if (!owner.childStatus) continue;
		try {
			const line = owner.childStatus();
			if (line) lines.push(line);
		} catch (error) {
			lines.push(
				`${owner.name}: status threw — ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return lines.join("; ");
}

/** Every owner's child bind, in declaration order. One owner cannot stop another's. */
function ownersBindChild(input: ChildBindInput): void {
	for (const owner of OWNERS) {
		if (!owner.bindChild) continue;
		try {
			owner.bindChild(input);
		} catch {
			/* one owner cannot stop another's bind */
		}
	}
}

/** The registration the entry publishes at module load. */
export const toolBridgeRegistration: ContributorRegistration = {
	key: KEY,
	owner: READER,
	apiVersion: HOST_API_VERSION,
	session: (input) => toolBridgeAnswer(input),
	childEligible: () => childEligibleTools(),
	childFactories: (request: ChildRequest) => {
		const factories: Array<(pi: any) => void> = [];
		for (const owner of OWNERS) {
			if (!owner.childFactories) continue;
			factories.push(...owner.childFactories(request));
		}
		return factories;
	},
	// The surface rule's turn, after every contributor that registers a tool, and before code mode's own.
	childSurface: (request: ChildRequest) => childSurfaceFactory(request),
	bindChild: (input: ChildBindInput) => ownersBindChild(input),
	childStatus: () => ownersChildStatus(),
};

/** Kept for the entry and for tests: the catalogue is what `tool()` lists. */
export { renderCatalogue };
