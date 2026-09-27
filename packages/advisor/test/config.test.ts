import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
	agentDir,
	configPathFor,
	loadConfig,
	modelKey,
	parseModelKey,
	saveAdvisorConfig,
	stripJsonc,
	validateDisabledForModels,
	validateGuidanceFields,
} from "../src/config.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "advisor-config-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function write(raw: string): void {
	const file = configPathFor(dir);
	mkdirSync(join(dir, "extension-configs", "advisor"), { recursive: true });
	writeFileSync(file, raw, "utf8");
}

describe("configPathFor", () => {
	it("puts the file in pi's own extension-configs tree under the package name", () => {
		expect(configPathFor("/agent")).toBe("/agent/extension-configs/advisor/advisor.jsonc");
	});
});

describe("agentDir", () => {
	it("honours PI_CODING_AGENT_DIR, the variable pi itself honours", () => {
		const before = process.env["PI_CODING_AGENT_DIR"];
		process.env["PI_CODING_AGENT_DIR"] = "  /tmp/agent-dir  ";
		try {
			expect(agentDir()).toBe("/tmp/agent-dir");
		} finally {
			if (before === undefined) delete process.env["PI_CODING_AGENT_DIR"];
			else process.env["PI_CODING_AGENT_DIR"] = before;
		}
	});
});

describe("the modelKey codec", () => {
	it("emits the canonical slash form", () => {
		expect(modelKey({ provider: "anthropic", id: "opus" })).toBe("anthropic/opus");
	});

	it("reads the slash form", () => {
		expect(parseModelKey("anthropic/opus")).toEqual({ provider: "anthropic", modelId: "opus" });
	});

	it("still reads the legacy colon form, so a stale file keeps working", () => {
		expect(parseModelKey("anthropic:opus")).toEqual({ provider: "anthropic", modelId: "opus" });
	});

	it("prefers the slash when both appear", () => {
		expect(parseModelKey("provider:foo/bar")).toEqual({ provider: "provider:foo", modelId: "bar" });
	});

	it("refuses a key with no separator or a leading one", () => {
		expect(parseModelKey("opus")).toBeUndefined();
		expect(parseModelKey("/opus")).toBeUndefined();
		expect(parseModelKey(":opus")).toBeUndefined();
	});
});

describe("stripJsonc", () => {
	it("strips line comments, block comments and trailing commas", () => {
		const parsed = JSON.parse(
			stripJsonc(`{
				// the reviewer
				"modelKey": "anthropic/opus", /* inline */
				"disabledForModels": ["a/b",],
			}`),
		);
		expect(parsed).toEqual({ modelKey: "anthropic/opus", disabledForModels: ["a/b"] });
	});

	it("leaves `//` and `,}` inside a string alone", () => {
		const text = `{"modelKey": "http://x/y", "guidance": {"promptSnippet": "a,}"}}`;
		expect(JSON.parse(stripJsonc(text))).toEqual({ modelKey: "http://x/y", guidance: { promptSnippet: "a,}" } });
	});
});

describe("validateGuidanceFields", () => {
	it("keeps the fields that are the right shape and drops the rest per field", () => {
		expect(
			validateGuidanceFields({
				description: "  ",
				promptSnippet: "use it",
				promptGuidelines: ["a", "", "b"],
				extra: 1,
			}),
		).toEqual({ promptSnippet: "use it", promptGuidelines: ["a", "b"] });
	});

	it("returns nothing for a non-object", () => {
		expect(validateGuidanceFields("guidance")).toEqual({});
		expect(validateGuidanceFields(null)).toEqual({});
		expect(validateGuidanceFields(["a"])).toEqual({});
	});
});

describe("validateDisabledForModels", () => {
	it("keeps strings and {model, minEffort}, and warns about an unrankable threshold", () => {
		const warnings: string[] = [];
		const entries = validateDisabledForModels(
			["anthropic/opus", { model: "anthropic/sonnet" }, { model: "x/y", minEffort: "nope" }, 7, "  "],
			warnings,
		);
		// A whitespace-only string survives, by upstream's rule (`entry.length > 0`): it can never match a
		// model key, and "the shape is a string" is all this validator promises.
		expect(entries).toEqual(["anthropic/opus", { model: "anthropic/sonnet" }, "  "]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("unknown minEffort");
	});

	it("returns nothing for a non-array", () => {
		expect(validateDisabledForModels("anthropic/opus")).toEqual([]);
	});
});

describe("loadConfig", () => {
	it("answers the defaults for a missing file, without a warning", () => {
		const { config, warnings } = loadConfig(dir);
		expect(config).toEqual({});
		expect(warnings).toEqual([]);
	});

	it("reads every key", () => {
		write(
			JSON.stringify({
				modelKey: "anthropic/opus",
				effort: "high",
				guidance: { promptSnippet: "s" },
				disabledForModels: ["anthropic/sonnet"],
			}),
		);
		expect(loadConfig(dir).config).toEqual({
			modelKey: "anthropic/opus",
			effort: "high",
			guidance: { promptSnippet: "s" },
			disabledForModels: ["anthropic/sonnet"],
		});
	});

	it("treats malformed JSON as a warning plus the defaults, never a throw", () => {
		write("{not json");
		const { config, warnings } = loadConfig(dir);
		expect(config).toEqual({});
		expect(warnings.join("\n")).toContain("invalid JSONC");
	});

	it("drops an unrankable effort with a warning rather than sending it as reasoning", () => {
		write(JSON.stringify({ modelKey: "a/b", effort: "enormous" }));
		const { config, warnings } = loadConfig(dir);
		expect(config.effort).toBeUndefined();
		expect(config.modelKey).toBe("a/b");
		expect(warnings.join("\n")).toContain("ignoring effort");
	});

	it("keeps 'model present, effort absent' as a first-class state", () => {
		write(JSON.stringify({ modelKey: "a/b" }));
		const { config, warnings } = loadConfig(dir);
		expect(config.modelKey).toBe("a/b");
		expect(config.effort).toBeUndefined();
		expect(warnings).toEqual([]);
	});
});

describe("saveAdvisorConfig", () => {
	it("rewrites only modelKey and effort, so hand-edited keys survive", () => {
		write(JSON.stringify({ disabledForModels: ["a/b"], guidance: { description: "keep me" } }));
		expect(saveAdvisorConfig("anthropic/opus", "high", dir)).toBe(true);
		const saved = JSON.parse(readFileSync(configPathFor(dir), "utf8"));
		expect(saved).toEqual({
			disabledForModels: ["a/b"],
			guidance: { description: "keep me" },
			modelKey: "anthropic/opus",
			effort: "high",
		});
	});

	it("deletes a cleared field rather than writing null", () => {
		write(JSON.stringify({ modelKey: "a/b", effort: "low", guidance: { description: "keep me" } }));
		expect(saveAdvisorConfig(undefined, undefined, dir)).toBe(true);
		const saved = JSON.parse(readFileSync(configPathFor(dir), "utf8"));
		expect(saved).toEqual({ guidance: { description: "keep me" } });
		expect("modelKey" in saved).toBe(false);
		expect("effort" in saved).toBe(false);
	});

	it("creates the file 0600", () => {
		expect(saveAdvisorConfig("a/b", undefined, dir)).toBe(true);
		const mode = Bun.file(configPathFor(dir)).stat().then((s) => s.mode & 0o777);
		expect(mode).resolves.toBe(0o600);
	});
});
