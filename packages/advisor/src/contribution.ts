/**
 * contribution — what this package offers a session, and the gate that decides whether it exists at all.
 *
 * ## The gate
 *
 * `advisor` is contributed **only** when the persisted `modelKey` resolves to a model in this session's
 * registry *and* the executor is not on `disabledForModels` (ticket 01 Q9). Unconfigured or blocked means
 * no host function, no description, no guidelines — a call is monty's bare `NameError`, which is the rule
 * this workspace holds elsewhere: *a name that exists but cannot work is worse than a name that does not
 * exist*. It is evaluated once, at the `session_start` where `pi-host-bridge` composes, because the
 * contribution window closes at the first cell: `/advisor` therefore changes the **next** session, and
 * says so.
 *
 * The gate reads `ctx` alone — `ctx.model`, `ctx.thinkingLevel` and `ctx.modelRegistry.find(…)` are all
 * populated at the compose moment, measured in ticket 03 for startup, CLI resume/fork, in-session
 * replacement and a spawned child alike. `pi` is not needed and is not passed (the seam does not offer
 * it), which is why this package imports `pi` nowhere but the entry's `registerCommand`.
 *
 * ## The prose
 *
 * Upstream's description, snippet and seven guidelines, rewritten into the cell form (ticket 06): the
 * call is `await advisor()` inside a Python cell, its answer is a dict, and a fault raises. Every
 * obligation the seven carried survives — only the grammar of the call changed, plus one sentence for what
 * comes back. They ride in the contribution, so code mode's ledger puts them into the `python` tool's
 * prompt; no separate host-bridge `systemPrompt` text is contributed, because a second copy would say the
 * same thing twice.
 */
import type { Api, Model } from "@earendil-works/pi-ai";

import { type ContributorAnswer, type SessionInput } from "../../host-bridge/src/convention.ts";
import {
	type AdvisorConfig,
	type GuidanceFields,
	loadConfig,
	modelKey,
	parseModelKey,
	validateGuidanceFields,
} from "./config.ts";
import { createAdvisorHost } from "./host.ts";
import { ADVISOR_HOST_FN, ADVISOR_OWNER, type GradedEffort } from "./messages.ts";
import { isModelBlocked, setDisabledForModels } from "./policy.ts";
import { setAdvisorEffort, setAdvisorModel } from "./state.ts";

/** The prose the model is given, overridable per field from the config's `guidance`. */
export interface AdvisorProse {
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
}

export const DEFAULT_DESCRIPTION =
	"Escalate to a stronger reviewer model for guidance, from inside your Python cell: `await advisor()`. " +
	"When you need stronger judgment — a complex decision, an ambiguous failure, a problem you're circling " +
	"without progress — call it, then resume. It takes NO arguments: the branch you are running in is " +
	"forwarded, so the advisor sees the task, every tool call you've made and every result you've seen. " +
	"It returns a dict: `text` is the guidance, and `advisor_model`, `effort`, `stop_reason` and `usage` " +
	"describe the call. A fault raises rather than returning — a missing API key, a failed call, an empty " +
	"response or an abort is an exception, not advice.";

export const DEFAULT_PROMPT_SNIPPET =
	"Escalate to a stronger reviewer model from a cell when stuck, before substantive work, or before declaring done";

export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	"Call `advisor()` BEFORE substantive work — before writing, before committing to an interpretation, before building on an assumption. Orientation (finding files, fetching a source, seeing what's there) is not substantive work; writing, editing, and declaring an answer are.",
	"Also call `advisor()` when you believe the task is complete. BEFORE this call, make your deliverable durable: write the file, save the result, commit the change. The advisor call takes time; if the session ends during it, a durable result persists and an unwritten one doesn't.",
	"Also call `advisor()` when stuck — errors recurring, approach not converging, results that don't fit — or when considering a change of approach.",
	"On tasks longer than a few steps, call `advisor()` at least once before committing to an approach and once before declaring done. On short reactive tasks where the next action is dictated by tool output you just read, you don't need to keep calling — the advisor adds most of its value on the first call, before the approach crystallizes.",
	"Give the advisor's advice serious weight. If you follow a step and it fails empirically, or you have primary-source evidence that contradicts a specific claim, adapt — a passing self-test is not evidence the advice is wrong, it's evidence your test doesn't check what the advice is checking.",
	"If you've already retrieved data pointing one way and the advisor points another, don't silently switch — surface the conflict in one more `advisor()` call (\"I found X, you suggest Y, which constraint breaks the tie?\"). A reconcile call is cheaper than committing to the wrong branch.",
	"After each `advisor()` result, put the advisor's key guidance into your next visible reply to the user before continuing — quote or paraphrase the plan, correction, or stop signal. The user often cannot see collapsed tool results; do not keep the advisor's words only in silent tool context.",
];

export function advisorProse(config: AdvisorConfig = {}): AdvisorProse {
	const guidance: GuidanceFields = config.guidance ?? {};
	return {
		description: guidance.description ?? DEFAULT_DESCRIPTION,
		promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
	};
}

export interface MountOutcome {
	mounted: boolean;
	/** The reviewer's colon-joined label, when one was mounted. */
	label?: string;
	effort?: GradedEffort;
	/** Why there is no advisor, in one line — for the session record and for a human reading it. */
	reason: string;
	problems: string[];
	prose: AdvisorProse;
}

/**
 * Decide, once, whether this session gets an advisor — and leave the selection in `state.ts` for the call.
 *
 * Never throws: an unreadable config is a warning, an unresolvable model is a reason, and the session
 * keeps running either way.
 */
export function mountAdvisor(ctx: unknown): MountOutcome {
	// A fresh decision replaces the previous one wholesale: this runs once per session, and a stale
	// selection from an earlier session in the same process must not survive into this one.
	setAdvisorModel(undefined);
	setAdvisorEffort(undefined);
	setDisabledForModels([]);

	const { config, warnings } = loadConfig();
	const problems = [...warnings];
	const prose = advisorProse(config);
	setDisabledForModels(config.disabledForModels ?? []);

	if (!config.modelKey) {
		return { mounted: false, reason: "no advisor model is configured", problems, prose };
	}
	const parsed = parseModelKey(config.modelKey);
	if (!parsed) {
		problems.push(
			`advisor: ignoring modelKey "${config.modelKey}" (expected "<provider>/<modelId>", the legacy ":<modelId>" form is also read)`,
		);
		return { mounted: false, reason: `modelKey "${config.modelKey}" is not a provider/model key`, problems, prose };
	}

	const session = ctx as {
		model?: Model<Api>;
		thinkingLevel?: string;
		modelRegistry?: { find?: (provider: string, modelId: string) => Model<Api> | undefined };
	} | null;
	let model: Model<Api> | undefined;
	try {
		model = session?.modelRegistry?.find?.(parsed.provider, parsed.modelId);
	} catch {
		model = undefined; // a disposed or unusual ctx has no registry to ask
	}
	if (!model) {
		problems.push(`advisor: modelKey "${config.modelKey}" is not in this session's model registry`);
		return { mounted: false, reason: `model ${config.modelKey} is not available`, problems, prose };
	}

	setAdvisorModel(model);
	setAdvisorEffort(config.effort);

	let executor: Model<Api> | undefined;
	let level: string | undefined;
	try {
		executor = session?.model;
		level = session?.thinkingLevel;
	} catch {
		executor = undefined;
		level = undefined;
	}
	if (isModelBlocked(executor, level)) {
		setAdvisorModel(undefined);
		return {
			mounted: false,
			reason: `the executor (${executor ? modelKey(executor) : "unknown"}) is blocked at ${
				level ?? "unknown"
			} by disabledForModels`,
			problems,
			prose,
		};
	}

	return { mounted: true, label: modelKey(model), effort: config.effort, reason: "configured and unblocked", problems, prose };
}

/**
 * This package's answer for one session.
 *
 * A session the gate declines gets **no contribution at all** — but its problems are still reported, so a
 * broken config is loud in the session record even when the advisor is absent. A session with nothing to
 * say returns `null`, which is the seam's ordinary "I serve no such session".
 *
 * `reaches` names `advisor` on purpose: it is the capability a cell reaches through this contribution, and
 * in a code-mode session pi-tool-bridge's rule reads that name as "a cell can call this, do not offer it as
 * a pi tool" — the same declaration that kept a still-installed `@juicesharp/rpiv-advisor` from running its
 * own tool lane beside this one while both were present. That package is retired now; the declaration
 * stays because it is the honest description of the capability, and it is what would strip a re-installed
 * one.
 */
export function advisorAnswer(input: SessionInput): ContributorAnswer | null {
	const outcome = mountAdvisor(input.ctx);
	if (!outcome.mounted) return outcome.problems.length > 0 ? { problems: outcome.problems } : null;
	return {
		contribution: {
			owner: ADVISOR_OWNER,
			hostFns: { [ADVISOR_HOST_FN]: createAdvisorHost({ ctx: input.ctx, progress: input.progress }) },
			description: outcome.prose.description,
			snippet: outcome.prose.promptSnippet,
			guidelines: outcome.prose.promptGuidelines,
		},
		reaches: [ADVISOR_HOST_FN],
		problems: outcome.problems,
	};
}
