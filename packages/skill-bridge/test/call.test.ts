/**
 * The call form (`.scratch/skill-bridge/` ticket 05): `skills()` from the providers, `skill(name)`
 * from either tier, and the rule that a provider's store is never read by this package.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	API_VERSION,
	__resetSkillBridgeForTests,
	registerProvider,
	type SkillEntry,
	type SkillProvider,
} from "../src/convention";
import { skillHostFns, stripFrontmatter } from "../src/call";
import { eventSkills } from "../src/render";

const dir = mkdtempSync(join(tmpdir(), "skill-bridge-call-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function skillFile(name: string, frontmatter: string, body: string): string {
	const path = join(dir, `${name}.md`);
	writeFileSync(path, `---\n${frontmatter}\n---\n\n${body}\n`);
	return path;
}

const TDD = skillFile("tdd", 'name: tdd\ndescription: Test-driven development.', "# TDD\n\nRed, green, refactor.");
const EXPLICIT = skillFile("explicit-only", "name: explicit-only\ndisable-model-invocation: true", "# Only by name");

function humanEntry(name: string, location: string): SkillEntry {
	return { name, description: `${name} description`, location, scope: "user", disableModelInvocation: false };
}

function fakeCtx(file: string) {
	return { sessionManager: { getSessionFile: () => file } };
}

/** A session whose providers are already registered, with pi's loaded skills in hand. */
function depsFor(input: { sessionFile: string; piLoaded: SkillEntry[] }) {
	return {
		ctx: () => fakeCtx(input.sessionFile),
		piLoaded: () => input.piLoaded,
	};
}

function provider(owner: string, entries: SkillEntry[], read: SkillProvider["read"]): SkillProvider {
	return { owner, apiVersion: API_VERSION, list: () => entries, read };
}

beforeEach(() => {
	__resetSkillBridgeForTests();
});

describe("skills()", () => {
	it("lists the providers' entries, first-wins by name, and nothing pi loaded", async () => {
		const learned: SkillEntry = {
			name: "monty-kernel-integration",
			description: "Embed monty.",
			location: "/store/skills/general/monty/SKILL.md",
			scope: "general",
		};
		registerProvider({
			sessionKey: "/sessions/a.jsonl",
			provider: provider("rsi", [learned], () => undefined),
		});
		const fns = skillHostFns(
			depsFor({ sessionFile: "/sessions/a.jsonl", piLoaded: [humanEntry("tdd", TDD)] }),
		);
		expect(await fns.skills_host()).toEqual([
			{
				name: "monty-kernel-integration",
				description: "Embed monty.",
				location: "/store/skills/general/monty/SKILL.md",
				scope: "general",
			},
		]);
	});

	it("is empty when no provider serves this session", async () => {
		registerProvider({
			sessionKey: "/sessions/other.jsonl",
			provider: provider("rsi", [humanEntry("x", "/store/x/SKILL.md")], () => undefined),
		});
		const fns = skillHostFns(depsFor({ sessionFile: "/sessions/a.jsonl", piLoaded: [] }));
		expect(await fns.skills_host()).toEqual([]);
	});
});

describe("skill(name)", () => {
	it("requires a name", async () => {
		const fns = skillHostFns(depsFor({ sessionFile: "/sessions/a.jsonl", piLoaded: [] }));
		await expect(fns.skill_host()).rejects.toThrow("skill(name) requires a name");
		await expect(fns.skill_host("  ")).rejects.toThrow("skill(name) requires a name");
	});

	it("names the catalogue when the name is unknown", async () => {
		const fns = skillHostFns(depsFor({ sessionFile: "/sessions/a.jsonl", piLoaded: [] }));
		await expect(fns.skill_host("nope")).rejects.toThrow('no skill named "nope"');
		await expect(fns.skill_host("nope")).rejects.toThrow("call skills()");
	});

	it("reads a pi-loaded skill from its file, without its frontmatter", async () => {
		const fns = skillHostFns(
			depsFor({ sessionFile: "/sessions/a.jsonl", piLoaded: [humanEntry("tdd", TDD)] }),
		);
		const found = await fns.skill_host("tdd");
		expect(found.content).toBe("# TDD\n\nRed, green, refactor.");
		expect(found.content).not.toContain("name: tdd");
		expect(found.files).toEqual([]);
	});

	it("resolves a skill pi will not advertise", async () => {
		// pi's flag means "not in the prompt", not "unreachable": /skill:name can load it, so a
		// by-name call from a cell can too.
		const loaded = eventSkills({
			systemPrompt: "base",
			systemPromptOptions: {
				skills: [
					{
						name: "explicit-only",
						description: "Only by name.",
						filePath: EXPLICIT,
						disableModelInvocation: true,
					},
				],
			},
		});
		const fns = skillHostFns(depsFor({ sessionFile: "/sessions/a.jsonl", piLoaded: loaded }));
		expect((await fns.skill_host("explicit-only")).content).toBe("# Only by name");
	});

	it("routes a provider-claimed name through the provider, files and all", async () => {
		const learned: SkillEntry = {
			name: "monty-kernel-integration",
			description: "Embed monty.",
			location: "/store/skills/general/monty/SKILL.md",
			scope: "general",
		};
		registerProvider({
			sessionKey: "/sessions/a.jsonl",
			provider: provider("rsi", [learned], (name) => ({
				content: `body of ${name}`,
				files: ["references/api.md"],
			})),
		});
		const fns = skillHostFns(
			depsFor({ sessionFile: "/sessions/a.jsonl", piLoaded: [] }),
		);
		expect(await fns.skill_host("monty-kernel-integration")).toEqual({
			content: "body of monty-kernel-integration",
			files: ["references/api.md"],
		});
	});

	it("never reads a provider's file, even when the provider cannot answer", async () => {
		// The entry's location is a real, readable file. If this package fell back to it, the call
		// would succeed — and the store's layout would have leaked into the bridge.
		const claimed: SkillEntry = {
			name: "tdd",
			description: "claimed",
			location: TDD,
			scope: "general",
		};
		registerProvider({
			sessionKey: "/sessions/a.jsonl",
			provider: provider("rsi", [claimed], () => undefined),
		});
		const fns = skillHostFns(
			depsFor({ sessionFile: "/sessions/a.jsonl", piLoaded: [humanEntry("tdd", TDD)] }),
		);
		await expect(fns.skill_host("tdd")).rejects.toThrow("supplied by rsi, which could not read it");
	});

	it("does not answer with another session's provider", async () => {
		registerProvider({
			sessionKey: "/sessions/other.jsonl",
			provider: provider(
				"rsi",
				[humanEntry("elsewhere", "/store/elsewhere/SKILL.md")],
				() => ({ content: "not yours", files: [] }),
			),
		});
		const fns = skillHostFns(depsFor({ sessionFile: "/sessions/a.jsonl", piLoaded: [] }));
		await expect(fns.skill_host("elsewhere")).rejects.toThrow('no skill named "elsewhere"');
	});
});

describe("frontmatter", () => {
	it("strips a leading block, and leaves a file without one alone", () => {
		expect(stripFrontmatter("---\nname: x\n---\n\nbody")).toBe("body");
		expect(stripFrontmatter("# plain\n\ntext")).toBe("# plain\n\ntext");
		expect(stripFrontmatter("---\nunterminated")).toBe("---\nunterminated");
	});
});
