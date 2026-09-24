/**
 * The entry's wiring (`.scratch/skill-bridge/` ticket 04): mount, contribute, render, forget.
 *
 * Driven in-process with a fake pi and a fake code-mode registry, because the questions here are about
 * *which facts reach which handler* — whether the contribution carries the call form, whether the
 * block follows the receipt, whether the host functions answer for the session that asked. A live run
 * settles none of those more sharply.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	API_VERSION,
	PROVIDERS_SYMBOL,
	READER,
	__resetSkillBridgeForTests,
	providerOwners,
	registerProvider,
	type SkillProvider,
} from "../src/convention";
import { SKILL_PRELUDE } from "../src/prelude";
import { stubFormatter } from "./formatter-stub";
import skillBridge from "../src/index";

const REGISTRY_KEY = Symbol.for("pi-code-mode:registry");
/** Recreated per test: a shared directory would be gone after the first one's cleanup. */
let dir = "";

type Contribution = {
	owner: string;
	hostFns?: Record<string, (...args: unknown[]) => Promise<unknown>>;
	prelude?: string;
};

type Harness = {
	pi: { on: (event: string, handler: (event: any, ctx: any) => unknown) => void; appendEntry: (type: string, data: unknown) => void };
	entries: { customType: string; data: unknown }[];
	notices: string[];
	contributions: Contribution[];
	mounts: number;
	sessionFile: string;
	ctx: { sessionManager: { getSessionFile: () => string }; getSystemPromptOptions: () => unknown; ui: { notify: (text: string, type?: string) => void } };
	loaded: { skills: unknown[] };
	fire: (event: string, payload?: unknown) => Promise<unknown>;
};

/** Install a fake code-mode, drive the entry, and keep everything it produced. */
function harness(input: { receipt?: (contribution: Contribution) => unknown; withCodeMode?: boolean } = {}): Harness {
	const contributions: Contribution[] = [];
	const notices: string[] = [];
	let mounts = 0;
	const entries: { customType: string; data: unknown }[] = [];
	const sessionFile = join(dir, `${Math.random().toString(36).slice(2)}.jsonl`);
	writeFileSync(sessionFile, "{}\n");
	const loaded = { skills: [] as unknown[] };

	if (input.withCodeMode !== false) {
		(globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = {
			publisher: "pi-code-mode",
			apiVersion: API_VERSION,
			sessions: new Map(),
			mount: () => {
				mounts += 1;
				return {
					publisher: "pi-code-mode",
					apiVersion: API_VERSION,
					sessionKey: sessionFile,
					contribute: (contribution: Contribution) => {
						contributions.push(contribution);
						return input.receipt
							? input.receipt(contribution)
							: { owner: contribution.owner, accepted: Object.keys(contribution.hostFns ?? {}), rejected: [] };
					},
				};
			},
		};
	} else {
		delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
	}

	const handlers = new Map<string, (event: any, ctx: any) => unknown>();
	const ctx = {
		sessionManager: { getSessionFile: () => sessionFile },
		getSystemPromptOptions: () => ({ selectedTools: ["python"], skills: loaded.skills }),
		ui: { notify: (text: string) => notices.push(text) },
	};
	const pi = {
		on: (event: string, handler: (event: any, ctx: any) => unknown) => handlers.set(event, handler),
		appendEntry: (customType: string, data: unknown) => entries.push({ customType, data }),
	};
	skillBridge(pi);
	return {
		pi,
		entries,
		notices,
		contributions,
		get mounts() {
			return mounts;
		},
		sessionFile,
		ctx,
		loaded,
		fire: async (event: string, payload: unknown = {}) =>
			handlers.get(event)?.(payload, ctx),
	} as Harness;
}


function humanSkill(name: string, path: string) {
	return {
		name,
		description: `${name} description`,
		filePath: path,
		baseDir: dir,
		sourceInfo: { source: "local", scope: "user" },
		disableModelInvocation: false,
	};
}

function skillFile(name: string): string {
	const path = join(dir, `${name}.md`);
	writeFileSync(path, `---\nname: ${name}\n---\n\n# ${name}\n`);
	return path;
}

beforeEach(() => {
	__resetSkillBridgeForTests();
	// Never depend on pi being resolvable — or on another suite having installed a stub. `formatterPromise`
	// is process-wide module state, so an order-dependent suite is a suite that passes by accident.
	stubFormatter();
	dir = mkdtempSync(join(tmpdir(), "skill-bridge-entry-"));
});

afterEach(() => {
	delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
	rmSync(dir, { recursive: true, force: true });
});

describe("session_start", () => {
	it("mounts, contributes the call form under its own name, and records it", async () => {
		const h = harness();
		await h.fire("session_start");

		expect(h.mounts).toBe(1);
		expect(h.contributions).toHaveLength(1);
		const contribution = h.contributions[0];
		expect(contribution?.owner).toBe(READER);
		expect(Object.keys(contribution?.hostFns ?? {}).sort()).toEqual(["skill_host", "skills_host"]);
		expect(contribution?.prelude).toBe(SKILL_PRELUDE);
		expect(h.entries).toEqual([
			{ customType: "skill-bridge-kernel", data: { mounted: true, contributed: true, problem: null } },
		]);
	});

	it("is loud once to the human and silent to the model when the contribution is refused", async () => {
		const h = harness({
			receipt: (contribution) => ({
				owner: contribution.owner,
				accepted: [],
				rejected: [{ name: "skill_host", reason: "name already taken" }],
			}),
		});
		await h.fire("session_start");
		expect(h.notices).toEqual([
			"skill-bridge: contribution refused whole: skill_host (name already taken)",
		]);
		expect(h.entries[0]?.data).toMatchObject({ mounted: true, contributed: false });
	});

	it("degrades inertly with no code mode at all, and still starts", async () => {
		const h = harness({ withCodeMode: false });
		await h.fire("session_start");
		expect(h.mounts).toBe(0);
		expect(h.contributions).toEqual([]);
		expect(h.entries[0]?.data).toMatchObject({ mounted: false, contributed: false });
		expect(String((h.entries[0]?.data as { problem?: string })?.problem)).toContain(
			"code mode is not present on the registry",
		);
	});
});

describe("before_agent_start", () => {
	it("renders both tiers with the call-form sentence once the contribution landed", async () => {
		const h = harness();
		await h.fire("session_start");
		h.loaded.skills = [humanSkill("tdd", skillFile("tdd"))];
		registerProvider({
			sessionKey: h.sessionFile,
			provider: {
				owner: "rsi",
				apiVersion: API_VERSION,
				list: () => [
					{ name: "learned-one", description: "learned", location: "/store/learned-one/SKILL.md", scope: "general" },
				],
				read: () => ({ content: "body", files: [] }),
			},
		});

		const result = (await h.fire("before_agent_start", {
			systemPrompt: "base",
			systemPromptOptions: { selectedTools: ["python"], skills: h.loaded.skills },
		})) as { systemPrompt: string };

		expect(result.systemPrompt.startsWith("base")).toBe(true);
		expect(result.systemPrompt).toContain("<name>tdd</name>");
		expect(result.systemPrompt).toContain("<name>learned-one</name>");
		expect(result.systemPrompt).toContain("await skill(name)");
	});

	it("falls back to pi's bash sentence when the contribution was refused", async () => {
		const h = harness({
			receipt: (contribution) => ({
				owner: contribution.owner,
				accepted: [],
				rejected: [{ name: "skills_host", reason: "taken" }],
			}),
		});
		await h.fire("session_start");
		const result = (await h.fire("before_agent_start", {
			systemPrompt: "base",
			systemPromptOptions: {
				selectedTools: ["python"],
				skills: [humanSkill("tdd", skillFile("tdd"))],
			},
		})) as { systemPrompt: string };
		expect(result.systemPrompt).toContain("Use bash to load a skill's file");
		expect(result.systemPrompt).not.toContain("await skill(name)");
	});

	it("renders nothing when no kernel was mounted", async () => {
		const h = harness({ withCodeMode: false });
		await h.fire("session_start");
		const result = await h.fire("before_agent_start", {
			systemPrompt: "base",
			systemPromptOptions: { selectedTools: ["python"], skills: [humanSkill("tdd", skillFile("tdd"))] },
		});
		expect(result).toBeUndefined();
	});
});

describe("the contributed host functions", () => {
	it("answer for the session that mounted them, both tiers", async () => {
		const h = harness();
		await h.fire("session_start");
		const tdd = skillFile("tdd");
		h.loaded.skills = [humanSkill("tdd", tdd)];
		registerProvider({
			sessionKey: h.sessionFile,
			provider: {
				owner: "rsi",
				apiVersion: API_VERSION,
				list: () => [
					{ name: "learned-one", description: "learned", location: "/store/learned-one/SKILL.md", scope: "general" },
				],
				read: () => ({ content: "learned body", files: ["references/x.md"] }),
			},
		});

		const hostFns = h.contributions[0]?.hostFns ?? {};
		expect(await hostFns.skills_host?.()).toEqual([
			{ name: "learned-one", description: "learned", location: "/store/learned-one/SKILL.md", scope: "general" },
		]);
		// The live read: `getSystemPromptOptions` is what the call form consults, so a skill pi loaded
		// is answerable without the entry having seen a turn yet.
		expect(await hostFns.skill_host?.("tdd")).toEqual({ content: "# tdd", files: [] });
		expect(await hostFns.skill_host?.("learned-one")).toEqual({
			content: "learned body",
			files: ["references/x.md"],
		});
	});
});

describe("session_shutdown", () => {
	it("forgets this session's providers and leaves another session's alone", async () => {
		const h = harness();
		await h.fire("session_start");
		const provider: SkillProvider = {
			owner: "rsi",
			apiVersion: API_VERSION,
			list: () => [],
			read: () => undefined,
		};
		registerProvider({ sessionKey: h.sessionFile, provider });
		registerProvider({ sessionKey: join(dir, "other.jsonl"), provider });
		expect(providerOwners(h.sessionFile)).toEqual(["rsi"]);

		await h.fire("session_shutdown");
		expect(providerOwners(h.sessionFile)).toEqual([]);
		expect(providerOwners(join(dir, "other.jsonl"))).toEqual(["rsi"]);
	});
});

describe("two instances in one process", () => {
	it("serve their own sessions, which is what makes the bridge safe to inject into a child", async () => {
		// A spawned child gets its own instance of this entry in the parent's process (rlm injects the
		// factory). Nothing may leak between them: not the mounted handle, not the provider answers.
		// Each instance is created and started in turn: the registry slot is process-global (as code
		// mode's really is), so the second harness's fake would otherwise answer the first's mount.
		const root = harness();
		await root.fire("session_start");
		const child = harness();
		await child.fire("session_start");
		expect(root.mounts).toBe(1);
		expect(child.mounts).toBe(1);

		registerProvider({
			sessionKey: root.sessionFile,
			provider: {
				owner: "rsi",
				apiVersion: API_VERSION,
				list: () => [
					{ name: "root-only", description: "root", location: "/store/root/SKILL.md", scope: "general" },
				],
				read: () => ({ content: "root", files: [] }),
			},
		});

		const childResult = (await child.fire("before_agent_start", {
			systemPrompt: "child",
			systemPromptOptions: { selectedTools: ["python"], skills: [humanSkill("tdd", skillFile("tdd"))] },
		})) as { systemPrompt: string };
		expect(childResult.systemPrompt).toContain("<name>tdd</name>");
		expect(childResult.systemPrompt).not.toContain("root-only");

		const childFns = child.contributions[0]?.hostFns ?? {};
		await expect(childFns.skill_host?.("root-only")).rejects.toThrow('no skill named "root-only"');
	});
});
