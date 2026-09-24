/**
 * The contract a provider obeys (`.scratch/skill-bridge/` ticket 02).
 *
 * The first test is the one that matters most: it registers a provider the way an *owner* would — by
 * hand, through the symbol literal, importing nothing but the symbol from this package — because that
 * is the whole point of a rendezvous instead of a dependency.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	API_VERSION,
	PROVIDERS_SYMBOL,
	READER,
	__resetSkillBridgeForTests,
	composeSkills,
	forgetSession,
	listings,
	pruneProviders,
	providerFor,
	providerOwners,
	providersFor,
	refusalFor,
	registerProvider,
	sessionKey,
	type SkillEntry,
	type SkillProvider,
} from "../src/convention";

const SKILL: SkillEntry = {
	name: "monty-kernel-integration",
	description: "Embed monty as a sandboxed Python kernel.",
	location: "/store/skills/general/monty-kernel-integration/SKILL.md",
	scope: "general",
	disableModelInvocation: false,
};

function fakeCtx(id: string, file?: string) {
	return {
		sessionManager: {
			getSessionId: () => id,
			getSessionFile: () => file ?? `/sessions/${id}.jsonl`,
		},
	};
}

function provider(owner: string, entries: SkillEntry[] = [SKILL]): SkillProvider {
	return {
		owner,
		apiVersion: API_VERSION,
		list: () => entries,
		read: (name) => ({ content: `${owner}:${name}`, files: [] }),
	};
}

/** Register the way an owner with no dependency on this package would. */
function publishByLiteral(key: string, value: unknown): void {
	const holder = globalThis as Record<symbol, unknown>;
	const existing = holder[PROVIDERS_SYMBOL];
	const slot = existing instanceof Map ? (existing as Map<string, Map<string, unknown>>) : new Map();
	if (!(existing instanceof Map)) holder[PROVIDERS_SYMBOL] = slot;
	const forSession = slot.get(key) ?? new Map<string, unknown>();
	const owner = (value as { owner?: string })?.owner ?? "anonymous";
	forSession.set(owner, value);
	slot.set(key, forSession);
}

beforeEach(() => {
	__resetSkillBridgeForTests();
});

describe("the providers slot", () => {
	it("reads a provider registered by hand, through the symbol", () => {
		publishByLiteral("/sessions/a.jsonl", provider("rsi"));
		const providers = providersFor("/sessions/a.jsonl");
		expect(providers).toHaveLength(1);
		expect(providers[0]?.owner).toBe("rsi");
		expect(READER).toBe("pi-skill-bridge");
	});

	it("replaces rather than appends when one owner registers twice", () => {
		expect(registerProvider({ sessionKey: "k", provider: provider("rsi", []) }).accepted).toBe(true);
		expect(registerProvider({ sessionKey: "k", provider: provider("rsi", [SKILL]) }).accepted).toBe(true);
		expect(providerOwners("k")).toEqual(["rsi"]);
		expect(providersFor("k")[0]?.list()).toHaveLength(1);
	});

	it("refuses an apiVersion it does not speak, with a reason, and keeps the others", () => {
		registerProvider({ sessionKey: "k", provider: provider("good") });
		const receipt = registerProvider({
			sessionKey: "k",
			provider: { ...provider("old"), apiVersion: 0 },
		});
		expect(receipt.accepted).toBe(false);
		expect(receipt.problem).toBe("apiVersion 0 is not 1");
		expect(providerOwners("k")).toEqual(["good"]);
	});

	it("refuses a malformed provider without displacing a good one", () => {
		registerProvider({ sessionKey: "k", provider: provider("good") });
		for (const bad of [
			null,
			"rsi",
			{ owner: "", apiVersion: API_VERSION, list: () => [], read: () => undefined },
			{ owner: "no-list", apiVersion: API_VERSION, read: () => undefined },
			{ owner: "no-read", apiVersion: API_VERSION, list: () => [] },
		]) {
			const receipt = registerProvider({ sessionKey: "k", provider: bad });
			expect(receipt.accepted).toBe(false);
			expect(receipt.problem).toBeTruthy();
		}
		expect(providerOwners("k")).toEqual(["good"]);
	});

	it("filters a malformed literal out at read time too", () => {
		publishByLiteral("k", provider("good"));
		publishByLiteral("k", { owner: "bad", apiVersion: API_VERSION, list: () => [] });
		expect(providerOwners("k")).toEqual(["good", "bad"]);
		expect(providersFor("k").map((p) => p.owner)).toEqual(["good"]);
		expect(refusalFor(provider("good"))).toBeUndefined();
	});

	it("isolates sessions", () => {
		registerProvider({ sessionKey: "a", provider: provider("rsi") });
		registerProvider({ sessionKey: "b", provider: provider("other") });
		expect(providerOwners("a")).toEqual(["rsi"]);
		expect(providerOwners("b")).toEqual(["other"]);
		forgetSession("a");
		expect(providerOwners("a")).toEqual([]);
		expect(providerOwners("b")).toEqual(["other"]);
	});
});

describe("listing", () => {
	it("drops a provider whose list() throws, and reports it, while the others answer", async () => {
		const answers = await listings([
			provider("first", [SKILL]),
			{
				owner: "broken",
				apiVersion: API_VERSION,
				list: () => {
					throw new Error("store unavailable");
				},
				read: () => undefined,
			},
			provider("last", []),
		]);
		expect(answers).toEqual([
			{ owner: "first", entries: [SKILL] },
			{ owner: "broken", problem: "store unavailable" },
			{ owner: "last", entries: [] },
		]);
	});

	it("drops a malformed entry while the provider's other entries stand", async () => {
		const answers = await listings([
			{
				...provider("rsi"),
				list: () => [SKILL, { name: "  " }, { name: "sparse" }, null as unknown as SkillEntry],
			},
		]);
		expect(answers).toEqual([
			{
				owner: "rsi",
				entries: [
					SKILL,
					{ name: "sparse", description: "", location: "", scope: "", disableModelInvocation: false },
				],
			},
		]);
	});

	it("awaits an async provider", async () => {
		const answers = await listings([
			{ ...provider("async"), list: async () => [SKILL] },
		]);
		expect(answers).toEqual([{ owner: "async", entries: [SKILL] }]);
	});
});

describe("composition", () => {
	const human: SkillEntry = {
		name: "tdd",
		description: "Test-driven development.",
		location: "/home/dev/.pi/agent/skills/tdd/SKILL.md",
		scope: "user",
	};

	it("puts pi's entries first, then providers, deduped first-wins by name", () => {
		const answers = [
			{ owner: "rsi" as const, entries: [SKILL, { ...SKILL, name: "other", description: "later" }] },
		];
		const composed = composeSkills([human, { ...SKILL, description: "pi's copy" }], answers);
		expect(composed.map((c) => c.entry.name)).toEqual([human.name, SKILL.name, "other"]);
		expect(composed[1]?.entry.description).toBe("pi's copy");
	});

	it("routes a provider-claimed name through the provider, whatever the display position", () => {
		const composed = composeSkills([human, SKILL], [{ owner: "rsi", entries: [SKILL] }]);
		expect(composed[1]?.route).toEqual({ kind: "provider", owner: "rsi" });
		expect(composed[0]?.route).toEqual({ kind: "path" });
	});

	it("routes an unclaimed name to the file it names", () => {
		const composed = composeSkills([human], [{ owner: "rsi", entries: [SKILL] }]);
		expect(composed[0]?.route).toEqual({ kind: "path" });
		expect(providerFor([{ owner: "rsi", entries: [SKILL] }], SKILL.name)).toBe("rsi");
		expect(providerFor([{ owner: "rsi", entries: [SKILL] }], human.name)).toBeUndefined();
	});

	it("ignores a dropped provider when composing", () => {
		const composed = composeSkills([human], [{ owner: "broken", problem: "boom" }]);
		expect(composed.map((c) => c.entry.name)).toEqual([human.name]);
	});
});

describe("session keys", () => {
	it("uses the session file, resolved", () => {
		expect(sessionKey(fakeCtx("a", "sessions/a.jsonl"))).toBe(
			join(process.cwd(), "sessions/a.jsonl"),
		);
	});

	it("keys an unpersisted session on its manager's identity", () => {
		// Stability is per session manager, not per call: pi hands out a fresh `ctx` per handler,
		// so the anchor is the manager, and a different manager is a different session.
		const manager = {};
		const ctx = { sessionManager: manager };
		const first = sessionKey(ctx);
		expect(first.startsWith("unpersisted#")).toBe(true);
		expect(sessionKey({ sessionManager: manager })).toBe(first);
		expect(sessionKey({ sessionManager: {} })).not.toBe(first);
	});
});

describe("pruning", () => {
	it("drops a stale record and keeps a fresh one", () => {
		const dir = mkdtempSync(join(tmpdir(), "skill-bridge-"));
		try {
			const stale = join(dir, "stale.jsonl");
			const fresh = join(dir, "fresh.jsonl");
			writeFileSync(stale, "{}\n");
			writeFileSync(fresh, "{}\n");
			const old = new Date(Date.now() - 60 * 60 * 1000);
			utimesSync(stale, old, old);

			registerProvider({ sessionKey: stale, provider: provider("stale") });
			registerProvider({ sessionKey: fresh, provider: provider("fresh") });
			expect(pruneProviders(30 * 60 * 1000)).toBe(1);
			expect(providerOwners(stale)).toEqual([]);
			expect(providerOwners(fresh)).toEqual(["fresh"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("drops a record whose session file is gone", () => {
		registerProvider({ sessionKey: "/sessions/vanished.jsonl", provider: provider("gone") });
		expect(pruneProviders(30 * 60 * 1000)).toBe(1);
		expect(providerOwners("/sessions/vanished.jsonl")).toEqual([]);
	});

	it("leaves an unpersisted key alone", () => {
		registerProvider({ sessionKey: "unpersisted#1", provider: provider("memory") });
		expect(pruneProviders(0)).toBe(0);
		expect(providerOwners("unpersisted#1")).toEqual(["memory"]);
	});
});
