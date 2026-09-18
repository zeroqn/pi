import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
	beforeAgentStartResult,
	isCodeMode,
	skillsBlockFor,
	visibleSkills,
	__setFormatterForTests,
} from "../src/skills-block";

/**
 * pi's formatter is injected rather than resolved, so the block's shape is asserted here
 * rather than only in a live run. The stub mirrors pi's real output, which the module's
 * sentence replacement depends on.
 */
function stubFormatter() {
	__setFormatterForTests((skills, tool) => {
		const lines = [
			"",
			"",
			"The following skills provide specialized instructions for specific tasks.",
			`Use ${tool} to load a skill's file when the task matches its description.`,
			"When a skill file references a relative path, resolve it against the skill directory.",
			"",
			"<available_skills>",
		];
		for (const skill of skills as Array<{ name: string; description: string; filePath: string }>) {
			lines.push("  <skill>", `    <name>${skill.name}</name>`, `    <description>${skill.description}</description>`, `    <location>${skill.filePath}</location>`, "  </skill>");
		}
		lines.push("</available_skills>");
		return lines.join("\n");
	});
}

const KEY = Symbol.for("@earendil/rsi:pi-registry");

function humanSkill(name: string) {
	return {
		name,
		description: `${name} description`,
		filePath: `/home/dev/.pi/agent/skills/${name}/SKILL.md`,
		baseDir: `/home/dev/.pi/agent/skills/${name}`,
		sourceInfo: { source: "global" },
		disableModelInvocation: false,
	};
}

function publishLearned(skills: Array<{ name: string; description?: string; location?: string }>) {
	(globalThis as Record<symbol, unknown>)[KEY] = {
		skills: () =>
			skills.map((s) => ({
				name: s.name,
				description: s.description ?? `${s.name} description`,
				location: s.location ?? `/home/dev/.pi/agent/rsi/skills/general/${s.name}/SKILL.md`,
				scope: "general",
			})),
		skill: () => undefined,
	};
}

beforeEach(() => {
	delete (globalThis as Record<symbol, unknown>)[KEY];
	stubFormatter();
});
afterEach(() => {
	delete (globalThis as Record<symbol, unknown>)[KEY];
});

describe("isCodeMode", () => {
	test("is true only when no tool pi recognises as a file reader is active", () => {
		expect(isCodeMode(["python"])).toBe(true);
		expect(isCodeMode(["python", "ctx_search"])).toBe(true);
		expect(isCodeMode(["read"])).toBe(false);
		expect(isCodeMode(["bash"])).toBe(false);
		expect(isCodeMode(["python", "read"])).toBe(false);
	});
});

describe("visibleSkills", () => {
	test("carries the human tier even with RSI absent", () => {
		const skills = visibleSkills({ human: [humanSkill("wayfinder")], caller: {} });
		expect(skills.map((s) => s.name)).toEqual(["wayfinder"]);
	});

	test("adds the learned store, shaped for pi's formatter", () => {
		publishLearned([{ name: "learned-one" }]);
		const skills = visibleSkills({ human: [], caller: {} });
		expect(skills).toHaveLength(1);
		expect(skills[0]?.filePath).toBe("/home/dev/.pi/agent/rsi/skills/general/learned-one/SKILL.md");
		expect(skills[0]?.baseDir).toBe("/home/dev/.pi/agent/rsi/skills/general/learned-one");
		expect(skills[0]?.disableModelInvocation).toBe(false);
	});

	test("a human skill wins a name collision, as pi resolves them first-wins", () => {
		publishLearned([{ name: "shared", description: "LEARNED" }]);
		const skills = visibleSkills({ human: [humanSkill("shared")], caller: {} });
		expect(skills).toHaveLength(1);
		expect(skills[0]?.description).toBe("shared description");
	});
});

describe("skillsBlockFor", () => {
	test("renders nothing when there is nothing to show", async () => {
		expect(await skillsBlockFor({ human: [], caller: {} })).toBeUndefined();
	});

	test("uses pi's XML shape and replaces the read-tool sentence", async () => {
		const block = await skillsBlockFor({ human: [humanSkill("wayfinder")], caller: {} });
		expect(block ?? "").toContain("<available_skills>");
		expect(block ?? "").toContain("<name>wayfinder</name>");
		expect(block ?? "").toContain("<location>/home/dev/.pi/agent/skills/wayfinder/SKILL.md</location>");
		expect(block ?? "").toContain("await skill(name)");
		expect(block ?? "").not.toContain("Use bash to load a skill's file");
	});
});

describe("beforeAgentStartResult", () => {
	test("returns undefined in a session that is not code-mode", async () => {
		const result = await beforeAgentStartResult(
			{ systemPrompt: "base", systemPromptOptions: { selectedTools: ["read", "bash"], skills: [humanSkill("x")] } },
			{},
		);
		expect(result).toBeUndefined();
	});

	test("returns undefined in code-mode with nothing to show, so pi's prompt is untouched", async () => {
		const result = await beforeAgentStartResult(
			{ systemPrompt: "base", systemPromptOptions: { selectedTools: ["python"], skills: [] } },
			{},
		);
		expect(result).toBeUndefined();
	});

	test("appends the block to pi's prompt in code-mode", async () => {
		const result = await beforeAgentStartResult(
			{ systemPrompt: "base prompt", systemPromptOptions: { selectedTools: ["python"], skills: [humanSkill("wayfinder")] } },
			{},
		);
		expect(result?.systemPrompt.startsWith("base prompt")).toBe(true);
		expect(result?.systemPrompt).toContain("<name>wayfinder</name>");
	});

	test("returns undefined when pi's formatter cannot be reached", async () => {
		__setFormatterForTests(null);
		const result = await beforeAgentStartResult(
			{ systemPrompt: "base", systemPromptOptions: { selectedTools: ["python"], skills: [humanSkill("x")] } },
			{},
		);
		expect(result).toBeUndefined();
		stubFormatter();
	});

	test("tolerates an event with no options at all", async () => {
		expect(await beforeAgentStartResult({ systemPrompt: "base" }, {})).toBeUndefined();
	});
});
