/**
 * What rlm contributes to a kernel it does not own (map ticket 01 §4, ticket 03 C4/C5/C9).
 *
 * The three halves that matter, and why each is shaped the way it is:
 *
 *  - **The prelude tail** (`prelude-rlm.ts`): `_Rlm`, `agent_message`, `find_models`. Appended to
 *    code mode's base prelude, and contributed in the same call as the host functions it names —
 *    all-or-nothing, so a cell can never see a name whose host function was rejected. RSI
 *    contributes the `skills`/`skill` half of that tail, which composes after this one.
 *  - **The snippet connector and the delegation guideline.** Code mode's base snippet ends
 *    where rlm's phrase begins (`" and delegation"`), and guideline 7 is verbatim the entry
 *    it has always been, already last in the array — which is why the composed surface is
 *    byte-identical to the pre-split one for both (decision (D) removed only description
 *    fragments that sat mid-sentence; `.scratch/code-mode/acceptance-baseline.md`).
 *  - **Provenance.** Which journals this session replays and which scratch to seed from is
 *    rlm's rule (v1 ticket 13), so rlm answers and code mode reads.
 */
import type { KernelContribution } from "../../host-bridge/src/client";
import { journalSourceOf } from "./children";
import { PRELUDE_TAIL } from "./prelude-rlm";

/** The snippet's last words, verbatim: code mode's half stops where these begin. */
export const SNIPPET_CONNECTOR = " and delegation";

/**
 * Guideline 7 of the pre-split array, plus the join sentence (amended 2026-09-29, `.scratch/rlm-wait`
 * ticket 05: every promise in that last sentence is a decision that map made — it blocks the cell, it
 * defaults to 180 seconds, it returns status/tokens/the final answer, and the children it read stop
 * notifying). The base surface's own hashes do not move: this is rlm's contribution, and
 * `test/surface.test.ts` pins the base's three. What moves is the composed rlm guideline hash in
 * `.scratch/code-mode/acceptance-baseline.md`.
 *
 * A third sentence was added 2026-09-30 (same map, a live two-run probe: a resumed session has no
 * children at all, so `rlm.wait` on an older child's name refuses — `.scratch/rlm-wait/answer-correctness.md`).
 * It states the session scope and the transcript fallback rather than leaving the model to discover
 * the refusal.
 */
export const RLM_GUIDELINE =
	"Use await rlm.spawn(name=..., prompt=...) for work worth doing in parallel or in a cleaner context, then end the turn: the child's answer arrives as a message, and rlm.poll(id) reads its status. Use await rlm.wait(names, timeout=180) when the next step needs every child's answer before it can start: it blocks this cell until they are done (or the timeout fires) and returns each child's status, tokens and final answer, and those children stop notifying you. rlm.list() shows the children and their tokens; rlm.tree_cost() totals what the whole tree has spent. Children belong to the session that spawned them, so a resumed or forked session has none: read an older child's answer from its stored transcript. rlm.stop(id, reason=...) ends an unwanted child and everything below it, releasing the session and keeping its record and transcript; rlm.remove(id) forgets the record.";

export type ProvenanceInputs = {
	startReason?: string;
	previousSessionFile?: string;
	parentSessionFile?: string;
	isChild: boolean;
};

export function rlmContribution(options: {
	owner?: string;
	/** The delegation surface, bound to this session (root manager or the child's context). */
	hostFns: Record<string, (...args: unknown[]) => Promise<unknown>>;
	/** Notices are rlm's machinery; code mode raises them (ticket 03, C2). */
	onNotice: (notice: { key: string; content: string; customType?: string; cancelled?: () => boolean }) => void;
	provenance: ProvenanceInputs;
}): KernelContribution {
	return {
		owner: options.owner ?? "rlm",
		// The delegation surface, and nothing else. The learned-skill host functions and their
		// prelude lines are RSI's own contribution now (map ticket 04), and `onHostCall` — which
		// existed only to feed RSI — is gone from the contract with it.
		hostFns: options.hostFns,
		prelude: PRELUDE_TAIL,
		snippet: SNIPPET_CONNECTOR,
		guidelines: [RLM_GUIDELINE],
		onNotice: options.onNotice,
		provenance: (_ctx: unknown, own: { sessionFile?: string; firstIndex?: number }) => {
			const source = journalSourceOf({
				ownSessionFile: own?.sessionFile,
				ownFirstIndex: own?.firstIndex,
				startReason: options.provenance.startReason,
				previousSessionFile: options.provenance.previousSessionFile,
				parentSessionFile: options.provenance.parentSessionFile,
				isChild: options.provenance.isChild,
			});
			if (!source) return { journals: [] };
			return { journals: source.files, seedScratchFrom: source.seedFrom };
		},
	};
}
