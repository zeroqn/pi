/**
 * What rlm contributes to a kernel it does not own (map ticket 01 §4, ticket 03 C4/C5/C9).
 *
 * The three halves that matter, and why each is shaped the way it is:
 *
 *  - **The prelude tail** (`prelude-rlm.ts`): `_Rlm`, `agent_message`, `find_models`,
 *    `skills`/`skill`. Appended to code mode's base prelude, and contributed in the same call
 *    as the host functions it names — all-or-nothing, so a cell can never see a name whose
 *    host function was rejected.
 *  - **The snippet connector and the delegation guideline.** Code mode's base snippet ends
 *    where rlm's phrase begins (`" and delegation"`), and guideline 7 is verbatim the entry
 *    it has always been, already last in the array — which is why the composed surface is
 *    byte-identical to the pre-split one for both (decision (D) removed only description
 *    fragments that sat mid-sentence; `.scratch/code-mode/acceptance-baseline.md`).
 *  - **Provenance.** Which journals this session replays and which scratch to seed from is
 *    rlm's rule (v1 ticket 13), so rlm answers and code mode reads.
 */
import { journalSourceOf } from "./children";
import type { CodeModeContribution } from "./bind";
import { PRELUDE_TAIL } from "./prelude-rlm";
import { instantiateWebHook, webDescriptionSuffix, webPromptGuidelines } from "./web-hook";
import type { WebPlan } from "./web-hook";
import { seamSkill, seamSkills, reportUsage } from "./rsi-seam";
import { str } from "./util";

/** The snippet's last words, verbatim: code mode's half stops where these begin. */
export const SNIPPET_CONNECTOR = " and delegation";

/** Guideline 7 of the pre-split array, verbatim (see the baseline's hashes). */
export const RLM_GUIDELINE =
	"Use await rlm.spawn(name=..., prompt=...) for work worth doing in parallel or in a cleaner context, then end the turn: the child's answer arrives as a message, and rlm.poll(id) reads its status. rlm.list() shows the children and their tokens; rlm.tree_cost() totals what the whole tree has spent.";

export type SeamCaller = () => { sessionFile?: string; cwd?: string };

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
	/** Every report the seam makes carries this identity; it is a closure, per session, and
	 * deliberately not a module-level ref (ticket 03, C6). */
	caller: SeamCaller;
	/** The observer hook: `bash_host` reports every command, and RSI's counted backstop owns
	 * the matching (ticket 03, C1). */
	onHostCall: (name: string, args: unknown[]) => void;
	/** Notices are rlm's machinery; code mode raises them (ticket 03, C2). */
	onNotice: (notice: { key: string; content: string; customType?: string; cancelled?: () => boolean }) => void;
	provenance: ProvenanceInputs;
}): CodeModeContribution {
	return {
		owner: options.owner ?? "rlm",
		hostFns: {
			...options.hostFns,
			// The learned-skill seam (RSI x RLM tickets 02, 15). The prelude's `skills()` and
			// `skill(name)` call these by name, so the suffix is part of the contract.
			async skills_host() {
				return seamSkills(options.caller());
			},
			async skill_host(...args: unknown[]) {
				const wanted = str(args[0]).trim();
				if (!wanted) throw new Error("skill(name) requires a name");
				const found = seamSkill(wanted, options.caller());
				if (!found) throw new Error(`no learned skill named "${wanted}" — call skills() for the ones this session can see`);
				reportUsage({ kind: "skill", target: wanted, caller: options.caller() });
				return { content: found.content, files: found.files };
			},
		},
		prelude: PRELUDE_TAIL,
		snippet: SNIPPET_CONNECTOR,
		guidelines: [RLM_GUIDELINE],
		onHostCall: options.onHostCall,
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

/**
 * web-code, as a contribution of its own. rlm resolves the module once at load (so the
 * description can promise exactly what exists) and instantiates it per kernel — a child's
 * fetches spill into the child's own scratch — then hands the functions over, which is the
 * whole of the coupling: nothing is imported between the two extensions.
 */
export function webCodeContribution(options: {
	hook: WebPlan;
	cwd: string;
	sessionFile?: string;
	progress: (text: string) => void;
}): { contribution: CodeModeContribution | null; reason?: string } {
	const instantiated = instantiateWebHook(options.hook, {
		cwd: options.cwd,
		sessionFile: options.sessionFile,
		progress: options.progress,
	});
	// Unset is silent and normal; configured-but-broken is recorded (ticket 03's web rules).
	if (instantiated.status === "none") return { contribution: null };
	if (instantiated.status === "error") return { contribution: null, reason: instantiated.reason };
	return {
		contribution: {
			owner: "web-code",
			hostFns: instantiated.fns as Record<string, (...args: unknown[]) => Promise<unknown>>,
			description: webDescriptionSuffix(options.hook),
			guidelines: webPromptGuidelines(options.hook),
		},
	};
}
