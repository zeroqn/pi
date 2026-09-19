/**
 * The code-mode skills block (RSI x RLM ticket 16, amended while building it).
 *
 * pi renders its `<available_skills>` block only when `read` or `bash` is active — the gate
 * is a name check on the active tool set — and RLM's code-mode surface is `["python"]`. So a
 * code-mode session is told about *no* skills at all: not the learned store, and not the
 * human tier pi had already loaded. This module builds the block RLM appends instead.
 *
 * Two things the original design could not know, both measured against pi 0.85.1:
 *
 *   - `buildSystemPrompt` is **not** exported (only `formatSkillsForPrompt` is), so there is
 *     no faithful way to rebuild pi's prompt with `read` added. The block is appended to
 *     `event.systemPrompt` instead, rendered by pi's own formatter so it cannot drift from
 *     the Agent Skills standard.
 *   - `event.systemPromptOptions.skills` already carries the human tier, which pi also
 *     refuses to render in code-mode. The block therefore carries **both tiers**, deduped by
 *     name with pi's first-wins rule.
 *
 * With nothing to show the function returns `undefined`, so pi's prompt is left exactly as it
 * was — which is what makes "an empty store is byte-identical" true rather than aspirational.
 */

import { seamSkills, type SeamCaller } from "./rsi-seam";

/**
 * pi's formatter, reached the way every other pi API in this extension is: through a
 * variable specifier at call time. An extension must not bundle pi, and a static import
 * would also break the unit tests, which run without pi installed.
 */
const PI_CODING_AGENT = "@earendil-works/pi-coding-agent";
let formatterPromise: Promise<((skills: unknown[], tool: string) => string) | null> | null = null;

function loadFormatter(): Promise<((skills: unknown[], tool: string) => string) | null> {
	formatterPromise ??= import(PI_CODING_AGENT)
		.then((pi: { formatSkillsForPrompt?: (skills: unknown[], tool: string) => string }) =>
			typeof pi.formatSkillsForPrompt === "function" ? pi.formatSkillsForPrompt : null,
		)
		.catch(() => null);
	return formatterPromise;
}

/**
 * Test seam, matching the convention the sibling modules already use. Without it the
 * rendering assertions would have to skip wherever pi is not resolvable, and the shape of
 * the block is the one thing this module exists to get right.
 */
export function __setFormatterForTests(format: ((skills: unknown[], tool: string) => string) | null): void {
	formatterPromise = Promise.resolve(format);
}

/** The shape `formatSkillsForPrompt` expects, narrowed to what this module supplies. */
interface PromptSkill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	sourceInfo: unknown;
	disableModelInvocation: boolean;
}

/**
 * pi's own sentence is "Use the read tool to load a skill's file", which is false in
 * code-mode. This replaces it with the mechanism that actually exists here, and keeps the
 * location meaningful: a bash-capable kernel can genuinely `cat` it, which is RSI's counted
 * backstop rather than decoration.
 */
const SENTENCE =
	"Use await skill(name) in the Python kernel to load a skill's file when the task matches its description, or read its location with await bash(...).";

/** True when the session's surface is code-mode: no tool that pi recognises as a file reader. */
export function isCodeMode(activeTools: readonly string[]): boolean {
	return !activeTools.includes("read") && !activeTools.includes("bash");
}

/**
 * The skills a code-mode session should be told about: the human tier pi loaded (from the
 * event, free) plus the learned store (from the seam), first-wins by name so a learned skill
 * never shadows a human one — the same order pi resolves them in.
 */
export function visibleSkills(input: {
	human: readonly PromptSkill[];
	caller: SeamCaller;
}): PromptSkill[] {
	const seen = new Set<string>();
	const out: PromptSkill[] = [];
	for (const skill of input.human) {
		if (!skill || typeof skill.name !== "string" || seen.has(skill.name)) continue;
		seen.add(skill.name);
		out.push(skill);
	}
	for (const skill of seamSkills(input.caller)) {
		if (!skill || typeof skill.name !== "string" || seen.has(skill.name)) continue;
		seen.add(skill.name);
		out.push({
			name: skill.name,
			description: skill.description,
			filePath: skill.location,
			baseDir: skill.location.replace(/\/SKILL\.md$/, ""),
			sourceInfo: { source: "rsi", scope: skill.scope },
			disableModelInvocation: false,
		});
	}
	return out;
}

/**
 * The block to append, or `undefined` when there is nothing to say. pi's formatter writes
 * its own read-tool sentence, so the returned block is that text with the sentence replaced.
 */
export async function skillsBlockFor(input: {
	human: readonly PromptSkill[];
	caller: SeamCaller;
}): Promise<string | undefined> {
	const skills = visibleSkills(input);
	if (skills.length === 0) return undefined;
	const format = await loadFormatter();
	if (!format) return undefined;
	const rendered = format(skills, "bash");
	if (!rendered) return undefined;
	return rendered.replace(
		"Use bash to load a skill's file when the task matches its description.",
		SENTENCE,
	);
}

/** What the event's options carry that this module needs, without importing pi's types. */
export interface PromptEventLike {
	systemPrompt: string;
	systemPromptOptions?: { skills?: unknown; selectedTools?: unknown };
}

/**
 * The `before_agent_start` result, or `undefined` to leave pi's prompt untouched. Returning
 * `undefined` in every non-code-mode session is deliberate: RLM must not alter a prompt it
 * has nothing to add to.
 */
export async function beforeAgentStartResult(
	event: PromptEventLike,
	caller: SeamCaller,
): Promise<{ systemPrompt: string } | undefined> {
	const tools = Array.isArray(event.systemPromptOptions?.selectedTools)
		? (event.systemPromptOptions?.selectedTools as string[])
		: [];
	if (!isCodeMode(tools)) return undefined;

	const human = Array.isArray(event.systemPromptOptions?.skills)
		? (event.systemPromptOptions?.skills as PromptSkill[])
		: [];
	const block = await skillsBlockFor({ human, caller });
	if (!block) return undefined;
	return { systemPrompt: `${event.systemPrompt}${block}` };
}
