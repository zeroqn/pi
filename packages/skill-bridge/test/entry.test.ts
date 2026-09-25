/**
 * The entry's wiring (`.scratch/skill-bridge/` ticket 04, re-homed by `.scratch/host-bridge` ticket 08).
 *
 * The mount and the contribution belong to `pi-host-bridge` now, so this file drives **both halves**:
 * `compose()` is the composition root asking this package for the session (`composeSession`), and
 * `fire(...)` is this package's own handlers. What is asserted is still the same three facts — the
 * contribution carries the call form, the block follows the *record* the ledger produced, and the host
 * functions answer for the session that asked — plus the one the seam's wiring made necessary: two
 * delivery paths to one surface still install the block once.
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
import { composeSession } from "../../host-bridge/src/compose";
import {
	__resetHostBridgeForTests,
	registerContributor,
	sessionRecord,
	sessionKey,
} from "../../host-bridge/src/convention";
import { SKILL_PRELUDE } from "../src/prelude";
import { stubFormatter } from "./formatter-stub";
import skillBridge, { __resetBridgeStateForTests, skillBridgeRegistration } from "../index";

const REGISTRY_KEY = Symbol.for("pi-code-mode:registry");
/** Recreated per test: a shared directory would be gone after the first one's cleanup. */
let dir = "";

type Contribution = {
	owner: string;
	hostFns?: Record<string, (...args: unknown[]) => Promise<unknown>>;
	prelude?: string;
};

type Harness = {
	entries: { customType: string; data: unknown }[];
	notices: string[];
	contributions: Contribution[];
	sessionFile: string;
	ctx: {
		sessionManager: { getSessionFile: () => string };
		getSystemPromptOptions: () => unknown;
		ui: { notify: (text: string, type?: string) => void };
	};
	loaded: { skills: unknown[] };
	/** The composition root's half: ask this package for the session, and write the record. */
	compose: () => Promise<void>;
	/** This package's own handlers, run the way pi runs them. */
	fire: (event: string, payload?: unknown) => Promise<unknown>;
	handlersFor: (event: string) => number;
};

/** Install a fake code-mode, install the block, and keep everything either half produced. */
function harness(input: { receipt?: (contribution: Contribution) => unknown; withCodeMode?: boolean } = {}): Harness {
	const contributions: Contribution[] = [];
	const notices: string[] = [];
	const entries: { customType: string; data: unknown }[] = [];
	const sessionFile = join(dir, `${Math.random().toString(36).slice(2)}.jsonl`);
	writeFileSync(sessionFile, "{}\n");
	const loaded = { skills: [] as unknown[] };

	if (input.withCodeMode !== false) {
		(globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = {
			publisher: "pi-code-mode",
			apiVersion: API_VERSION,
			sessions: new Map(),
			mount: () => ({
				publisher: "pi-code-mode",
				apiVersion: API_VERSION,
				sessionKey: sessionFile,
				problems: async () => [],
				contribute: (contribution: Contribution) => {
					contributions.push(contribution);
					return input.receipt
						? input.receipt(contribution)
						: { owner: contribution.owner, accepted: Object.keys(contribution.hostFns ?? {}), rejected: [] };
				},
			}),
		};
	} else {
		delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
	}

	const handlers = new Map<string, ((event: any, ctx: any) => unknown)[]>();
	const ctx = {
		sessionManager: { getSessionFile: () => sessionFile },
		getSystemPromptOptions: () => ({ selectedTools: ["python"], skills: loaded.skills }),
		ui: { notify: (text: string) => notices.push(text) },
	};
	const pi = {
		on: (event: string, handler: (event: any, ctx: any) => unknown) =>
			handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		appendEntry: (customType: string, data: unknown) => entries.push({ customType, data }),
	};
	skillBridge(pi);

	return {
		entries,
		notices,
		contributions,
		sessionFile,
		ctx,
		loaded,
		compose: async () => {
			await composeSession({ pi, ctx });
		},
		fire: async (event: string, payload: unknown = {}) => {
			let result: unknown;
			for (const handler of handlers.get(event) ?? []) {
				const one = await handler(payload, ctx);
				if (one !== undefined) result = one;
			}
			return result;
		},
		handlersFor: (event: string) => (handlers.get(event) ?? []).length,
	};
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

function rsiProvider(listed = true): SkillProvider {
	return {
		owner: "rsi",
		apiVersion: API_VERSION,
		list: () =>
			listed
				? [{ name: "learned-one", description: "learned", location: "/store/learned-one/SKILL.md", scope: "general" }]
				: [],
		read: () => ({ content: "learned body", files: ["references/x.md"] }),
	};
}

beforeEach(() => {
	__resetSkillBridgeForTests();
	__resetBridgeStateForTests();
	__resetHostBridgeForTests();
	// The seam's reset drops registrations, and this package's is made at module load.
	registerContributor(skillBridgeRegistration);
	// Never depend on pi being resolvable — or on another suite having installed a stub. `formatterPromise`
	// is process-wide module state, so an order-dependent suite is a suite that passes by accident.
	stubFormatter();
	dir = mkdtempSync(join(tmpdir(), "skill-bridge-entry-"));
});

afterEach(() => {
	delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
	rmSync(dir, { recursive: true, force: true });
});

describe("the composition", () => {
	it("contributes the call form under its own name, and the record says so", async () => {
		const h = harness();
		await h.compose();

		expect(h.contributions).toHaveLength(1);
		const contribution = h.contributions[0];
		expect(contribution?.owner).toBe(READER);
		expect(Object.keys(contribution?.hostFns ?? {}).sort()).toEqual(["skill_host", "skills_host"]);
		expect(contribution?.prelude).toBe(SKILL_PRELUDE);
		expect(sessionRecord(sessionKey(h.ctx))?.installed).toContain("skills_host");

		// The durable entry is this package's own, written on the first turn because the record is the
		// composition root's and exists by then.
		await h.fire("before_agent_start", { systemPrompt: "base", systemPromptOptions: { selectedTools: ["python"], skills: [] } });
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
		await h.compose();
		expect(sessionRecord(sessionKey(h.ctx))?.mounted).toBe(true);
		expect(sessionRecord(sessionKey(h.ctx))?.installed).toEqual([]);

		await h.fire("before_agent_start", { systemPrompt: "base", systemPromptOptions: { selectedTools: ["python"], skills: [] } });
		expect(h.notices).toHaveLength(1);
		expect(h.notices[0]).toContain("skill_host");
		expect(h.entries[0]?.data).toMatchObject({ mounted: true, contributed: false });

		// Once per session, not once per turn.
		await h.fire("before_agent_start", { systemPrompt: "base", systemPromptOptions: { selectedTools: ["python"], skills: [] } });
		expect(h.notices).toHaveLength(1);
	});

	it("degrades inertly with no code mode at all, and still starts", async () => {
		const h = harness({ withCodeMode: false });
		await h.compose();
		expect(h.contributions).toEqual([]);

		await h.fire("before_agent_start", { systemPrompt: "base", systemPromptOptions: { selectedTools: ["python"], skills: [] } });
		expect(h.entries[0]?.data).toMatchObject({ mounted: false, contributed: false });
		expect(String((h.entries[0]?.data as { problem?: string })?.problem)).toContain(
			"code mode is not present on the registry",
		);
	});
});

describe("before_agent_start", () => {
	it("renders both tiers with the call-form sentence once the contribution landed", async () => {
		const h = harness();
		await h.compose();
		h.loaded.skills = [humanSkill("tdd", skillFile("tdd"))];
		registerProvider({ sessionKey: sessionKey(h.ctx), provider: rsiProvider() });

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
		await h.compose();
		const result = (await h.fire("before_agent_start", {
			systemPrompt: "base",
			systemPromptOptions: { selectedTools: ["python"], skills: [humanSkill("tdd", skillFile("tdd"))] },
		})) as { systemPrompt: string };
		expect(result.systemPrompt).toContain("Use bash to load a skill's file");
		expect(result.systemPrompt).not.toContain("await skill(name)");
	});

	it("renders nothing when no kernel was mounted", async () => {
		const h = harness({ withCodeMode: false });
		await h.compose();
		const result = await h.fire("before_agent_start", {
			systemPrompt: "base",
			systemPromptOptions: { selectedTools: ["python"], skills: [humanSkill("tdd", skillFile("tdd"))] },
		});
		expect(result).toBeUndefined();
	});
});

describe("the contributed host functions", () => {
	it("answer for the session that was composed, both tiers", async () => {
		const h = harness();
		await h.compose();
		await h.fire("session_start");
		const tdd = skillFile("tdd");
		h.loaded.skills = [humanSkill("tdd", tdd)];
		registerProvider({ sessionKey: sessionKey(h.ctx), provider: rsiProvider() });

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
		const first = harness();
		const second = harness();
		registerProvider({ sessionKey: sessionKey(first.ctx), provider: rsiProvider() });
		registerProvider({ sessionKey: sessionKey(second.ctx), provider: rsiProvider() });
		expect(providerOwners(sessionKey(first.ctx))).toEqual(["rsi"]);

		await first.fire("session_shutdown");
		expect(providerOwners(sessionKey(first.ctx))).toEqual([]);
		expect(providerOwners(sessionKey(second.ctx))).toEqual(["rsi"]);
		expect((globalThis as Record<symbol, unknown>)[PROVIDERS_SYMBOL]).toBeInstanceOf(Map);
	});
});

describe("two surfaces in one process", () => {
	it("serve their own sessions, which is what makes the bridge safe to inject into a child", async () => {
		// Each harness's fake registry is the process's one registered slot, so each is composed while
		// its own is installed.
		const first = harness();
		await first.compose();
		const second = harness();
		await second.compose();

		// Each surface's own host functions resolve *its* session, even though the registration is one
		// module-level object: the ctx is keyed by session, not captured per surface.
		registerProvider({ sessionKey: sessionKey(first.ctx), provider: rsiProvider() });
		registerProvider({ sessionKey: sessionKey(second.ctx), provider: rsiProvider(false) });
		await first.fire("session_start");
		await second.fire("session_start");

		expect(await first.contributions[0]?.hostFns?.skills_host?.()).toHaveLength(1);
		expect(await second.contributions[0]?.hostFns?.skills_host?.()).toHaveLength(0);
	});

	it("installs the block once per surface, even when two paths deliver it", async () => {
		// rlm names this package in a child *and* the seam carries it as a contributor. Installing twice
		// would append the block twice: the fold hands each handler the previous prompt.
		const handlers = new Map<string, unknown[]>();
		const pi = {
			on: (event: string, handler: unknown) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
			appendEntry: () => undefined,
		};
		skillBridge(pi);
		skillBridge(pi);
		expect(handlers.get("before_agent_start")).toHaveLength(1);
		expect(handlers.get("session_start")).toHaveLength(1);
		// A *different* surface is a different session's, and gets its own.
		skillBridge({ on: (event: string, handler: unknown) => handlers.set(event, [...(handlers.get(event) ?? []), handler]) });
		expect(handlers.get("before_agent_start")).toHaveLength(2);
	});
});
