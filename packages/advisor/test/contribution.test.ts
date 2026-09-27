/**
 * The gate (tickets 01 Q9, 03): `advisor` exists in a session only when a `modelKey` resolves *and* the
 * executor is not on the blocklist. Unconfigured is not a failure — it is the ordinary "I serve no such
 * session" the seam defines.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Api, Model } from "@earendil-works/pi-ai";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { configPathFor } from "../src/config.ts";
import { advisorAnswer, advisorProse, mountAdvisor } from "../src/contribution.ts";
import { ADVISOR_HOST_FN } from "../src/messages.ts";
import { __resetPolicyForTests } from "../src/policy.ts";
import { __resetAdvisorStateForTests, getAdvisorEffort, getAdvisorModel } from "../src/state.ts";

const opus = { provider: "anthropic", id: "opus", name: "Opus" } as unknown as Model<Api>;
const executor = { provider: "deepseek", id: "deepseek-flash", name: "Flash" } as unknown as Model<Api>;

const REGISTRY: Record<string, Model<Api>> = { "anthropic/opus": opus };

let dir: string;
let prevAgentDir: string | undefined;

function writeConfig(config: unknown): void {
	mkdirSync(join(dir, "extension-configs", "advisor"), { recursive: true });
	writeFileSync(configPathFor(dir), JSON.stringify(config), "utf8");
}

function ctx(overrides: { model?: Model<Api> | undefined; thinkingLevel?: string } = {}): unknown {
	return {
		model: "model" in overrides ? overrides.model : executor,
		thinkingLevel: overrides.thinkingLevel ?? "high",
		modelRegistry: { find: (provider: string, modelId: string) => REGISTRY[`${provider}/${modelId}`] },
		sessionManager: { getSessionFile: () => join(dir, "session.jsonl") },
	};
}

function answer(input: unknown) {
	return advisorAnswer({ ctx: input, sessionKey: "s", isChild: false, cwd: dir, handle: {} } as never);
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "advisor-gate-"));
	prevAgentDir = process.env["PI_CODING_AGENT_DIR"];
	process.env["PI_CODING_AGENT_DIR"] = dir; // agentDir() is what mountAdvisor reads
	__resetPolicyForTests();
	__resetAdvisorStateForTests();
});

afterEach(() => {
	if (prevAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
	else process.env["PI_CODING_AGENT_DIR"] = prevAgentDir;
	rmSync(dir, { recursive: true, force: true });
});

describe("mountAdvisor", () => {
	it("declines an unconfigured session without calling it a problem", () => {
		const outcome = mountAdvisor(ctx());
		expect(outcome.mounted).toBe(false);
		expect(outcome.reason).toBe("no advisor model is configured");
		expect(outcome.problems).toEqual([]);
	});

	it("declines when the key is not a provider/model key, and says so", () => {
		writeConfig({ modelKey: "opus" });
		const outcome = mountAdvisor(ctx());
		expect(outcome.mounted).toBe(false);
		expect(outcome.problems.join("\n")).toContain("expected \"<provider>/<modelId>\"");
	});

	it("declines when the model is not in this session's registry", () => {
		writeConfig({ modelKey: "anthropic/sonnet" });
		const outcome = mountAdvisor(ctx());
		expect(outcome.mounted).toBe(false);
		expect(outcome.problems.join("\n")).toContain("not in this session's model registry");
	});

	it("mounts a configured, unblocked advisor and leaves the selection in state", () => {
		writeConfig({ modelKey: "anthropic/opus", effort: "high" });
		const outcome = mountAdvisor(ctx());
		expect(outcome.mounted).toBe(true);
		expect(outcome.label).toBe("anthropic/opus");
		expect(getAdvisorModel()).toBe(opus);
		expect(getAdvisorEffort()).toBe("high");
	});

	it("declines when the executor is on the blocklist, without a problem", () => {
		writeConfig({ modelKey: "anthropic/opus", disabledForModels: ["deepseek/deepseek-flash"] });
		const outcome = mountAdvisor(ctx());
		expect(outcome.mounted).toBe(false);
		expect(outcome.reason).toContain("disabledForModels");
		expect(outcome.problems).toEqual([]);
		expect(getAdvisorModel()).toBeUndefined();
	});

	it("declines when the executor's level is at or above a minEffort threshold", () => {
		writeConfig({ modelKey: "anthropic/opus", disabledForModels: [{ model: "deepseek/deepseek-flash", minEffort: "high" }] });
		expect(mountAdvisor(ctx({ thinkingLevel: "high" })).mounted).toBe(false);
		expect(mountAdvisor(ctx({ thinkingLevel: "low" })).mounted).toBe(true);
	});

	it("still mounts when the config had a warning, and reports it", () => {
		writeConfig({ modelKey: "anthropic/opus", disabledForModels: [{ model: "x/y", minEffort: "nope" }] });
		const outcome = mountAdvisor(ctx());
		expect(outcome.mounted).toBe(true);
		expect(outcome.problems.join("\n")).toContain("unknown minEffort");
	});

	it("reads the legacy colon form of the key", () => {
		writeConfig({ modelKey: "anthropic:opus" });
		expect(mountAdvisor(ctx()).mounted).toBe(true);
	});
});

describe("advisorAnswer", () => {
	it("answers nothing at all for an unconfigured session", () => {
		expect(answer(ctx())).toBeNull();
	});

	it("carries the gate's problems even when it contributes nothing", () => {
		writeConfig({ modelKey: "anthropic/sonnet" });
		const result = answer(ctx());
		expect(result?.contribution).toBeUndefined();
		expect(result?.problems?.join("\n")).toContain("not in this session's model registry");
	});

	it("contributes the host function, the prose, and the name a cell reaches", () => {
		writeConfig({ modelKey: "anthropic/opus" });
		const result = answer(ctx());
		expect(result?.contribution?.owner).toBe("advisor");
		expect(Object.keys(result?.contribution?.hostFns ?? {})).toEqual([ADVISOR_HOST_FN]);
		expect(result?.contribution?.description).toContain("await advisor()");
		expect(result?.contribution?.guidelines).toHaveLength(7);
		expect(result?.reaches).toEqual([ADVISOR_HOST_FN]);
	});

	it("lets the config override each guidance field independently", () => {
		writeConfig({ modelKey: "anthropic/opus", guidance: { promptSnippet: "mine" } });
		const prose = advisorProse({ guidance: { promptSnippet: "mine" } });
		expect(prose.promptSnippet).toBe("mine");
		expect(answer(ctx())?.contribution?.description).toBe(prose.description);
	});

	it("gives the contribution an apiVersion-bearing owner string, not the package name", () => {
		writeConfig({ modelKey: "anthropic/opus" });
		expect(answer(ctx())?.contribution?.owner).toBe("advisor");
	});
});

describe("advisorProse", () => {
	it("keeps all seven obligations of upstream's guidelines", () => {
		const guidelines = advisorProse().promptGuidelines;
		expect(guidelines).toHaveLength(7);
		expect(guidelines.join("\n")).toContain("BEFORE substantive work");
		expect(guidelines.join("\n")).toContain("before declaring done");
		expect(guidelines.join("\n")).toContain("when stuck");
		expect(guidelines.join("\n")).toContain("surface the conflict");
		expect(guidelines.join("\n")).toContain("next visible reply");
	});

	it("speaks the cell's grammar, not the tool's", () => {
		const prose = advisorProse();
		expect(prose.description).toContain("await advisor()");
		expect(prose.promptGuidelines.join("\n")).not.toContain("Call `advisor` ");
	});
});
