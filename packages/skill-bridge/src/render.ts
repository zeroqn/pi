/**
 * The code-mode skills block — the one place outside pi that renders one.
 *
 * pi renders its `<available_skills>` block only when `read` or `bash` is active — the gate is a name
 * check on the active tool set — and a code-mode surface is `["python"]`. So a code-mode session is
 * told about *no* skills at all: not a store's, and not the ones pi had already loaded. This module
 * builds the block the bridge appends instead.
 *
 * Two things measured against pi 0.85.1 shape it:
 *
 *   - `buildSystemPrompt` is **not** exported (only `formatSkillsForPrompt` is), so there is no
 *     faithful way to rebuild pi's prompt with `read` added. The block is appended to
 *     `event.systemPrompt` instead, rendered by pi's own formatter so it cannot drift from the Agent
 *     Skills standard.
 *   - `event.systemPromptOptions.skills` already carries everything pi loaded, which pi also refuses
 *     to render here. The block therefore carries **both tiers**, composed by `./convention`
 *     (`composeSkills`: pi's entries first, then each provider's, first-wins by name).
 *
 * With nothing to show the function returns `undefined`, so pi's prompt is left exactly as it was —
 * which is what makes "an empty store is byte-identical" true rather than aspirational.
 *
 * The caller decides *whether* to render (a kernel was mounted, and the surface is code-mode); this
 * module decides *what*. That split is what keeps the sentence honest: it tells the model to call
 * `skill(name)`, which exists only when the contribution was accepted — and when it was not, the
 * block falls back to pi's own bash sentence, which the kernel's `bash` host function does make true.
 */
import { dirname } from "node:path";
import { type ProviderListing, READER, type SkillEntry, composeSkills } from "./convention";

/**
 * pi's formatter, reached the way every other pi API in this package is: through a variable specifier
 * at call time. An extension must not bundle pi, and a static import would also break the unit tests,
 * which run without pi installed.
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
 * Test seam, matching the convention the sibling packages already use. Without it the rendering
 * assertions would have to skip wherever pi is not resolvable, and the shape of the block is the one
 * thing this module exists to get right.
 */
export function __setFormatterForTests(format: ((skills: unknown[], tool: string) => string) | null): void {
	formatterPromise = Promise.resolve(format);
}

/** The shape `formatSkillsForPrompt` expects, narrowed to what this module supplies. */
export interface PromptSkill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	sourceInfo: unknown;
	disableModelInvocation: boolean;
}

/**
 * pi's own sentence is "Use the read tool to load a skill's file", which is false here. This replaces
 * it with the mechanisms that actually exist, and keeps the location meaningful: a bash-capable kernel
 * can genuinely `cat` it, which is the counted backstop rather than decoration.
 */
export const SENTENCE =
	"Use await skill(name) in the Python kernel to load a skill's file when the task matches its description, or read its location with await bash(...).";

/** pi's sentence, verbatim: what the formatter writes and what the fallback leaves in place. */
export const PI_BASH_SENTENCE = "Use bash to load a skill's file when the task matches its description.";

/** True when the session's surface is code-mode: no tool that pi recognises as a file reader. */
export function isCodeMode(activeTools: readonly string[]): boolean {
	return !activeTools.includes("read") && !activeTools.includes("bash");
}

/** What the event's options carry that this module needs, without importing pi's types. */
export interface PromptEventLike {
	systemPrompt: string;
	systemPromptOptions?: { skills?: unknown; selectedTools?: unknown };
}

/** The session's current active tool set, as the event reports it. */
export function eventTools(event: PromptEventLike): string[] {
	return Array.isArray(event.systemPromptOptions?.selectedTools)
		? (event.systemPromptOptions?.selectedTools as string[])
		: [];
}

function scopeOf(sourceInfo: unknown): string {
	if (typeof sourceInfo !== "object" || sourceInfo === null) return "";
	const scope = (sourceInfo as { scope?: unknown }).scope;
	return typeof scope === "string" ? scope : "";
}

/**
 * Everything pi loaded but will not render in this session, in the shape the composition speaks.
 *
 * `disableModelInvocation` is carried through rather than dropped: pi's formatter filters on it, and
 * an entry that lost the flag would be advertised against its author's instruction.
 */
export function eventSkills(event: PromptEventLike): SkillEntry[] {
	const raw = event.systemPromptOptions?.skills;
	if (!Array.isArray(raw)) return [];
	const out: SkillEntry[] = [];
	for (const value of raw) {
		if (typeof value !== "object" || value === null) continue;
		const skill = value as Partial<PromptSkill>;
		if (typeof skill.name !== "string" || skill.name.trim().length === 0) continue;
		out.push({
			name: skill.name,
			description: typeof skill.description === "string" ? skill.description : "",
			location: typeof skill.filePath === "string" ? skill.filePath : "",
			scope: scopeOf(skill.sourceInfo),
			disableModelInvocation: skill.disableModelInvocation === true,
		});
	}
	return out;
}

/** One composed entry in the shape pi's formatter reads. `baseDir` is what a relative path resolves against. */
function toPromptSkill(entry: SkillEntry): PromptSkill {
	return {
		name: entry.name,
		description: entry.description,
		filePath: entry.location,
		baseDir: entry.location.length > 0 ? dirname(entry.location) : "",
		sourceInfo: { source: READER, scope: entry.scope },
		disableModelInvocation: entry.disableModelInvocation === true,
	};
}

/**
 * The block to append, or `undefined` when there is nothing to say.
 *
 * pi's formatter writes its own read-tool sentence; when the contribution was accepted the sentence
 * is replaced with the call form that exists, and when it was not it is left alone, because then
 * `skill(name)` does not exist and bash is the only route that does.
 */
export async function blockFor(input: {
	piLoaded: readonly SkillEntry[];
	answers: readonly ProviderListing[];
	contributed: boolean;
}): Promise<string | undefined> {
	const composed = composeSkills(input.piLoaded, input.answers);
	if (composed.length === 0) return undefined;
	const format = await loadFormatter();
	if (!format) return undefined;
	const rendered = format(
		composed.map((composed) => toPromptSkill(composed.entry)),
		"bash",
	);
	if (!rendered) return undefined;
	return input.contributed ? rendered.replace(PI_BASH_SENTENCE, SENTENCE) : rendered;
}

/**
 * The `before_agent_start` result, or `undefined` to leave pi's prompt untouched.
 *
 * `mounted` is the caller's answer to "is there a kernel at all": with no kernel there is no `bash`
 * either, so neither sentence would be true and the block is not rendered. `contributed` is the
 * narrower fact — the call form is in that kernel — and it decides only which sentence is written.
 * Returning `undefined` in every other session is deliberate: the bridge must not alter a prompt it
 * has nothing to add to.
 */
export async function beforeAgentStartResult(
	event: PromptEventLike,
	input: { mounted: boolean; contributed: boolean; answers: readonly ProviderListing[] },
): Promise<{ systemPrompt: string } | undefined> {
	if (!input.mounted) return undefined;
	if (!isCodeMode(eventTools(event))) return undefined;
	const block = await blockFor({
		piLoaded: eventSkills(event),
		answers: input.answers,
		contributed: input.contributed,
	});
	if (!block) return undefined;
	return { systemPrompt: `${event.systemPrompt}${block}` };
}
