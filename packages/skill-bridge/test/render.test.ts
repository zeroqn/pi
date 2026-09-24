/**
 * The block's shape and its composition (`.scratch/skill-bridge/` ticket 03).
 *
 * pi's formatter is injected rather than resolved, so the block is asserted here rather than only in
 * a live run. The stub mirrors pi's real output, which the sentence replacement depends on.
 *
 * The byte-identity case is the load-bearing one: its expected value and its hash were captured from
 * the *previous* implementation (`rsi/skills-block.ts`) before this module existed, so the move can
 * be seen to have changed nothing rather than assumed to.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { type ProviderListing, type SkillEntry } from "../src/convention";
import { stubFormatter } from "./formatter-stub";
import {
	__setFormatterForTests,
	beforeAgentStartResult,
	blockFor,
	eventSkills,
	eventTools,
	isCodeMode,
} from "../src/render";


/** The fixture the golden was captured with. */
function humanSkill(name: string): SkillEntry {
	return {
		name,
		description: name === "tdd" ? "Test-driven development." : "Chart a map.",
		location: `/home/dev/.pi/agent/skills/${name}/SKILL.md`,
		scope: "user",
		disableModelInvocation: false,
	};
}

function learnedAnswer(name: string): ProviderListing {
	return {
		owner: "rsi",
		entries: [
			{
				name,
				description: "Embed monty.",
				location: `/home/dev/.pi/agent/rsi/skills/general/${name}/SKILL.md`,
				scope: "general",
				disableModelInvocation: false,
			},
		],
	};
}

/** Captured from `rsi/skills-block.ts` before this module replaced it. */
const GOLDEN = [
	"",
	"",
	"The following skills provide specialized instructions for specific tasks.",
	"Use await skill(name) in the Python kernel to load a skill's file when the task matches its description, or read its location with await bash(...).",
	"When a skill file references a relative path, resolve it against the skill directory.",
	"",
	"<available_skills>",
	"  <skill>",
	"    <name>tdd</name>",
	"    <description>Test-driven development.</description>",
	"    <location>/home/dev/.pi/agent/skills/tdd/SKILL.md</location>",
	"  </skill>",
	"  <skill>",
	"    <name>wayfinder</name>",
	"    <description>Chart a map.</description>",
	"    <location>/home/dev/.pi/agent/skills/wayfinder/SKILL.md</location>",
	"  </skill>",
	"  <skill>",
	"    <name>monty-kernel-integration</name>",
	"    <description>Embed monty.</description>",
	"    <location>/home/dev/.pi/agent/rsi/skills/general/monty-kernel-integration/SKILL.md</location>",
	"  </skill>",
	"</available_skills>",
].join("\n");

const GOLDEN_SHA256 = "47fd363b46a707b8f3530090f880e759b5cd820ebfb6ec07edc9574a90ab6db9";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

beforeEach(stubFormatter);

describe("the gate", () => {
	it("is code-mode only when no tool pi recognises as a file reader is active", () => {
		expect(isCodeMode(["python"])).toBe(true);
		expect(isCodeMode(["python", "ctx_search"])).toBe(true);
		expect(isCodeMode(["read"])).toBe(false);
		expect(isCodeMode(["bash"])).toBe(false);
		expect(isCodeMode(["python", "read"])).toBe(false);
	});
});

describe("the event", () => {
	it("reads the active set and the loaded skills off the options", () => {
		const event = {
			systemPrompt: "base",
			systemPromptOptions: {
				selectedTools: ["python"],
				skills: [
					{
						name: "tdd",
						description: "Test-driven development.",
						filePath: "/home/dev/.pi/agent/skills/tdd/SKILL.md",
						baseDir: "/home/dev/.pi/agent/skills/tdd",
						sourceInfo: { source: "local", scope: "user" },
						disableModelInvocation: false,
					},
				],
			},
		};
		expect(eventTools(event)).toEqual(["python"]);
		expect(eventSkills(event)).toEqual([humanSkill("tdd")]);
	});

	it("carries pi's disable-model-invocation flag through, so the formatter can filter on it", () => {
		const event = {
			systemPrompt: "base",
			systemPromptOptions: {
				skills: [
					{
						name: "explicit-only",
						description: "Only by name.",
						filePath: "/home/dev/.pi/agent/skills/explicit-only/SKILL.md",
						disableModelInvocation: true,
					},
				],
			},
		};
		expect(eventSkills(event)[0]?.disableModelInvocation).toBe(true);
	});

	it("drops a malformed entry and tolerates an event with no options", () => {
		expect(
			eventSkills({
				systemPrompt: "base",
				systemPromptOptions: { skills: [null, { description: "no name" }, "nope"] },
			}),
		).toEqual([]);
		expect(eventTools({ systemPrompt: "base" })).toEqual([]);
		expect(eventSkills({ systemPrompt: "base" })).toEqual([]);
	});
});

describe("the block", () => {
	it("is byte-identical to the implementation it replaced", async () => {
		const block = await blockFor({
			piLoaded: [humanSkill("tdd"), humanSkill("wayfinder")],
			answers: [learnedAnswer("monty-kernel-integration")],
			contributed: true,
		});
		expect(block).toBe(GOLDEN);
		expect(sha(block ?? "")).toBe(GOLDEN_SHA256);
	});

	it("renders nothing when there is nothing to show", async () => {
		expect(await blockFor({ piLoaded: [], answers: [], contributed: true })).toBeUndefined();
		expect(await blockFor({ piLoaded: [], answers: [], contributed: false })).toBeUndefined();
	});

	it("uses pi's XML shape and the call-form sentence when the contribution landed", async () => {
		const block = await blockFor({
			piLoaded: [humanSkill("tdd")],
			answers: [],
			contributed: true,
		});
		expect(block).toContain("<available_skills>");
		expect(block).toContain("<name>tdd</name>");
		expect(block).toContain("<location>/home/dev/.pi/agent/skills/tdd/SKILL.md</location>");
		expect(block).toContain("await skill(name)");
		expect(block).not.toContain("Use bash to load a skill's file");
	});

	it("leaves pi's bash sentence when the contribution did not land", async () => {
		// Then `skill(name)` does not exist, and bash is the only route that does.
		const block = await blockFor({
			piLoaded: [humanSkill("tdd")],
			answers: [learnedAnswer("monty-kernel-integration")],
			contributed: false,
		});
		expect(block).toContain("Use bash to load a skill's file");
		expect(block).not.toContain("await skill(name)");
		// The provider's entry is still shown: a refused contribution costs the call form, not the
		// skills.
		expect(block).toContain("<name>monty-kernel-integration</name>");
	});

	it("returns undefined when pi's formatter cannot be reached", async () => {
		__setFormatterForTests(null);
		expect(await blockFor({ piLoaded: [humanSkill("tdd")], answers: [], contributed: true })).toBeUndefined();
		stubFormatter();
	});
});

describe("the before_agent_start result", () => {
	const codeMode = (skills: unknown[]) => ({
		systemPrompt: "base prompt",
		systemPromptOptions: { selectedTools: ["python"], skills },
	});

	it("returns undefined without a mounted kernel, because neither sentence would be true", async () => {
		const result = await beforeAgentStartResult(codeMode([humanSkill("tdd")]), {
			mounted: false,
			contributed: false,
			answers: [],
		});
		expect(result).toBeUndefined();
	});

	it("returns undefined in a session pi renders itself", async () => {
		const result = await beforeAgentStartResult(
			{ systemPrompt: "base", systemPromptOptions: { selectedTools: ["read", "bash"], skills: [humanSkill("tdd")] } },
			{ mounted: true, contributed: true, answers: [] },
		);
		expect(result).toBeUndefined();
	});

	it("returns undefined in code-mode with nothing to show, so pi's prompt is untouched", async () => {
		expect(
			await beforeAgentStartResult(codeMode([]), { mounted: true, contributed: true, answers: [] }),
		).toBeUndefined();
	});

	it("appends both tiers to pi's prompt", async () => {
		const result = await beforeAgentStartResult(codeMode([humanSkill("tdd")]), {
			mounted: true,
			contributed: true,
			answers: [learnedAnswer("monty-kernel-integration")],
		});
		expect(result?.systemPrompt.startsWith("base prompt")).toBe(true);
		expect(result?.systemPrompt).toContain("<name>tdd</name>");
		expect(result?.systemPrompt).toContain("<name>monty-kernel-integration</name>");
	});

	it("appends to whatever the prompt already holds", async () => {
		// The chaining invariant: another handler may have appended before this one, so the block is
		// added to `event.systemPrompt` rather than replacing it.
		const result = await beforeAgentStartResult(
			{ systemPrompt: "base\n\n## Code mode is unavailable\nno kernel", systemPromptOptions: { selectedTools: ["python"], skills: [humanSkill("tdd")] } },
			{ mounted: true, contributed: true, answers: [] },
		);
		expect(result?.systemPrompt.startsWith("base\n\n## Code mode is unavailable")).toBe(true);
		expect(result?.systemPrompt).toContain("<available_skills>");
	});

	it("tolerates an event with no options at all", async () => {
		expect(
			await beforeAgentStartResult({ systemPrompt: "base" }, { mounted: true, contributed: true, answers: [] }),
		).toBeUndefined();
	});
});
