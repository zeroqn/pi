import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
	beforeAgentStartResult,
	isCodeMode,
	skillsBlockFor,
	visibleSkills,
	__setFormatterForTests,
} from "../skills-block.ts";

/**
 * pi's formatter is injected rather than resolved, so the block's shape is asserted here rather
 * than only in a live run. The stub mirrors pi's real output, which the module's sentence
 * replacement depends on.
 *
 * Moved here from rlm's suite with the module (map ticket 08): the block is RSI's own now, and
 * the shape of it is the one thing this module exists to get right.
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
		for (const skill of skills) {
			lines.push(
				"  <skill>",
				`    <name>${skill.name}</name>`,
				`    <description>${skill.description}</description>`,
				`    <location>${skill.filePath}</location>`,
				"  </skill>",
			);
		}
		lines.push("</available_skills>");
		return lines.join("\n");
	});
}

function humanSkill(name) {
	return {
		name,
		description: `${name} description`,
		filePath: `/home/dev/.pi/agent/skills/${name}/SKILL.md`,
		baseDir: `/home/dev/.pi/agent/skills/${name}`,
		sourceInfo: { source: "global" },
		disableModelInvocation: false,
	};
}

function learnedSkill(name) {
	return {
		name,
		description: `${name} description`,
		filePath: `/home/dev/.pi/agent/rsi/skills/general/${name}/SKILL.md`,
		baseDir: `/home/dev/.pi/agent/rsi/skills/general/${name}`,
		sourceInfo: { source: "rsi", scope: "general" },
		disableModelInvocation: false,
	};
}

beforeEach(stubFormatter);

test("isCodeMode is true only when no tool pi recognises as a file reader is active", () => {
	assert.equal(isCodeMode(["python"]), true);
	assert.equal(isCodeMode(["python", "ctx_search"]), true);
	assert.equal(isCodeMode(["read"]), false);
	assert.equal(isCodeMode(["bash"]), false);
	assert.equal(isCodeMode(["python", "read"]), false);
});

test("visibleSkills carries the human tier on its own", () => {
	const skills = visibleSkills({ human: [humanSkill("wayfinder")], learned: [] });
	assert.deepEqual(
		skills.map((s) => s.name),
		["wayfinder"],
	);
});

test("visibleSkills adds the learned store after the human tier", () => {
	const skills = visibleSkills({ human: [humanSkill("wayfinder")], learned: [learnedSkill("learned-one")] });
	assert.deepEqual(
		skills.map((s) => s.name),
		["wayfinder", "learned-one"],
	);
	assert.equal(skills[1]?.baseDir, "/home/dev/.pi/agent/rsi/skills/general/learned-one");
	assert.equal(skills[1]?.disableModelInvocation, false);
});

test("a human skill wins a name collision, as pi resolves them first-wins", () => {
	const learned = { ...learnedSkill("shared"), description: "LEARNED" };
	const skills = visibleSkills({ human: [humanSkill("shared")], learned: [learned] });
	assert.equal(skills.length, 1);
	assert.equal(skills[0]?.description, "shared description");
});

test("skillsBlockFor renders nothing when there is nothing to show", async () => {
	assert.equal(await skillsBlockFor({ human: [], learned: [] }), undefined);
});

test("skillsBlockFor uses pi's XML shape and replaces the read-tool sentence", async () => {
	const block = await skillsBlockFor({ human: [humanSkill("wayfinder")], learned: [] });
	assert.ok((block ?? "").includes("<available_skills>"));
	assert.ok((block ?? "").includes("<name>wayfinder</name>"));
	assert.ok((block ?? "").includes("<location>/home/dev/.pi/agent/skills/wayfinder/SKILL.md</location>"));
	assert.ok((block ?? "").includes("await skill(name)"));
	assert.ok(!(block ?? "").includes("Use bash to load a skill's file"));
});

test("beforeAgentStartResult returns undefined in a session that is not code-mode", async () => {
	const result = await beforeAgentStartResult(
		{ systemPrompt: "base", systemPromptOptions: { selectedTools: ["read", "bash"], skills: [humanSkill("x")] } },
		{ contributed: true, learned: [] },
	);
	assert.equal(result, undefined);
});

test("beforeAgentStartResult returns undefined when RSI did not contribute", async () => {
	// The sentence tells the model to call `skill(name)`, which exists only when RSI's contribution
	// was accepted (map ticket 08). A session whose contribution was refused must not be told to.
	const result = await beforeAgentStartResult(
		{ systemPrompt: "base", systemPromptOptions: { selectedTools: ["python"], skills: [humanSkill("x")] } },
		{ contributed: false, learned: [learnedSkill("learned-one")] },
	);
	assert.equal(result, undefined);
});

test("beforeAgentStartResult returns undefined in code-mode with nothing to show, so pi's prompt is untouched", async () => {
	const result = await beforeAgentStartResult(
		{ systemPrompt: "base", systemPromptOptions: { selectedTools: ["python"], skills: [] } },
		{ contributed: true, learned: [] },
	);
	assert.equal(result, undefined);
});

test("beforeAgentStartResult appends the block to pi's prompt in code-mode", async () => {
	const result = await beforeAgentStartResult(
		{ systemPrompt: "base prompt", systemPromptOptions: { selectedTools: ["python"], skills: [humanSkill("wayfinder")] } },
		{ contributed: true, learned: [learnedSkill("learned-one")] },
	);
	assert.equal(result?.systemPrompt.startsWith("base prompt"), true);
	assert.ok(result?.systemPrompt.includes("<name>wayfinder</name>"));
	assert.ok(result?.systemPrompt.includes("<name>learned-one</name>"));
});

test("beforeAgentStartResult appends to whatever the prompt already holds", async () => {
	// The chaining invariant (map tickets 01 and 08): rlm's handler runs first and appends its own
	// line, so RSI must rebuild on `event.systemPrompt` rather than replace it.
	const result = await beforeAgentStartResult(
		{ systemPrompt: "base\n\n## Code mode is unavailable\nno kernel", systemPromptOptions: { selectedTools: ["python"], skills: [humanSkill("x")] } },
		{ contributed: true, learned: [] },
	);
	assert.equal(result?.systemPrompt.startsWith("base\n\n## Code mode is unavailable"), true);
	assert.ok(result?.systemPrompt.includes("<available_skills>"));
});

test("beforeAgentStartResult returns undefined when pi's formatter cannot be reached", async () => {
	__setFormatterForTests(null);
	const result = await beforeAgentStartResult(
		{ systemPrompt: "base", systemPromptOptions: { selectedTools: ["python"], skills: [humanSkill("x")] } },
		{ contributed: true, learned: [] },
	);
	assert.equal(result, undefined);
	stubFormatter();
});

test("beforeAgentStartResult tolerates an event with no options at all", async () => {
	assert.equal(await beforeAgentStartResult({ systemPrompt: "base" }, { contributed: true, learned: [] }), undefined);
});
