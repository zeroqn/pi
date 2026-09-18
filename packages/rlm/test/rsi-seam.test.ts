import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
	findRsiSeam,
	reportCapability,
	reportHostCall,
	reportUsage,
	rsiChildFactory,
	rsiStatus,
	seamSkill,
	seamSkills,
} from "../src/rsi-seam";

const KEY = Symbol.for("@earendil/rsi:pi-registry");

interface Recorded {
	usage: Array<{ kind: string; target: string }>;
	hostCalls: string[];
	facts: Array<{ sessionFile?: string; canWrite: boolean }>;
}

function publish(overrides: Record<string, unknown> = {}): Recorded {
	const recorded: Recorded = { usage: [], hostCalls: [], facts: [] };
	(globalThis as Record<symbol, unknown>)[KEY] = {
		skills: () => [{ name: "seeded", description: "d", location: "/x/SKILL.md", scope: "general" }],
		skill: (name: string) => (name === "seeded" ? { content: "body", files: ["scripts/x.sh"] } : undefined),
		noteUsage: (usage: { kind: string; target: string }) => recorded.usage.push(usage),
		noteHostCall: (call: { command: string }) => recorded.hostCalls.push(call.command),
		capability: (fact: { sessionFile?: string; canWrite: boolean }) => recorded.facts.push(fact),
		...overrides,
	};
	return recorded;
}

beforeEach(() => {
	delete (globalThis as Record<symbol, unknown>)[KEY];
});
afterEach(() => {
	delete (globalThis as Record<symbol, unknown>)[KEY];
});

describe("with RSI absent, every call is inert", () => {
	test("reads return empty and reports do nothing", () => {
		expect(findRsiSeam()).toBeNull();
		expect(seamSkills({})).toEqual([]);
		expect(seamSkill("seeded", {})).toBeUndefined();
		expect(() => reportUsage({ kind: "skill", target: "seeded", caller: {} })).not.toThrow();
		expect(() => reportHostCall("cat /x", {})).not.toThrow();
		expect(() => reportCapability({ canWrite: true })).not.toThrow();
		expect(rsiChildFactory({})).toEqual([]);
	});

	test("the status line says so rather than staying silent", () => {
		expect(rsiStatus()).toContain("no registry");
		expect(rsiStatus()).toContain("degradation, not failure");
	});
});

describe("with RSI present", () => {
	test("skills() and skill(name) read through the facade", () => {
		publish();
		expect(seamSkills({ sessionFile: "s.jsonl" })).toHaveLength(1);
		expect(seamSkill("seeded", {})?.content).toBe("body");
		expect(seamSkill("absent", {})).toBeUndefined();
		expect(rsiStatus()).toContain("1 learned skill(s)");
	});

	test("a consultation is reported, and a bash call is offered for matching", () => {
		const recorded = publish();
		reportUsage({ kind: "skill", target: "seeded", caller: { sessionFile: "s.jsonl" } });
		reportHostCall("cat /home/x/SKILL.md", { sessionFile: "s.jsonl" });
		expect(recorded.usage).toEqual([{ kind: "skill", target: "seeded", sessionFile: "s.jsonl" }]);
		expect(recorded.hostCalls).toEqual(["cat /home/x/SKILL.md"]);
	});

	test("a capability fact carries the session file, so a child's is its own", () => {
		const recorded = publish();
		reportCapability({ sessionFile: "child.jsonl", canWrite: true, reason: "kernel" });
		expect(recorded.facts[0]?.sessionFile).toBe("child.jsonl");
	});

	test("a facade that throws is contained: a report must never fail a cell", () => {
		publish({
			skills: () => {
				throw new Error("store exploded");
			},
			noteUsage: () => {
				throw new Error("ledger exploded");
			},
		});
		expect(seamSkills({})).toEqual([]);
		expect(() => reportUsage({ kind: "skill", target: "x", caller: {} })).not.toThrow();
	});

	test("an older RSI without the optional methods still serves reads", () => {
		publish({ noteUsage: undefined, noteHostCall: undefined, capability: undefined, childFactory: undefined });
		expect(seamSkills({})).toHaveLength(1);
		expect(() => reportUsage({ kind: "skill", target: "seeded", caller: {} })).not.toThrow();
		expect(rsiChildFactory({})).toEqual([]);
	});

	test("a child factory is only handed over when RSI offers one", () => {
		const factory = () => {};
		publish({ childFactory: () => factory });
		expect(rsiChildFactory({ name: "c1" })).toEqual([factory]);

		publish({ childFactory: () => "not a function" });
		expect(rsiChildFactory({})).toEqual([]);
	});

	test("a half-shaped slot is not mistaken for the seam", () => {
		(globalThis as Record<symbol, unknown>)[KEY] = { skills: () => [] };
		expect(findRsiSeam()).toBeNull();
	});
});
