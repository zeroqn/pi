/**
 * `rlm.json` — what the environment is allowed to change (config.ts).
 *
 * The default is off, and the cases that matter are the two files disagreeing and the project file
 * arriving untrusted: both decide whether `RLM_CHILD_PROMPT` is honored at all.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentDir, loadRlmConfig } from "../src/config";

let root: string;
let agent: string;
let project: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "rlm-config-"));
	agent = join(root, "agent");
	project = join(root, "project");
	mkdirSync(agent, { recursive: true });
	mkdirSync(join(project, ".pi"), { recursive: true });
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	delete process.env.PI_CODING_AGENT_DIR;
});

const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const allows = (input: { cwd?: string; projectTrusted?: boolean } = {}) =>
	loadRlmConfig({ cwd: project, agentDir: agent, ...input }).allowEnvironmentOverrides;

describe("rlm.json", () => {
	it("is off when there is no file, and when the file says nothing usable", () => {
		expect(allows()).toBe(false);
		write(join(agent, "rlm.json"), { something: "else" });
		expect(allows()).toBe(false);
		write(join(agent, "rlm.json"), { allowEnvironmentOverrides: "yes" });
		expect(allows()).toBe(false);
		writeFileSync(join(agent, "rlm.json"), "{ not json");
		expect(allows()).toBe(false);
	});

	it("is on when the global file says so", () => {
		write(join(agent, "rlm.json"), { allowEnvironmentOverrides: true });
		expect(allows()).toBe(true);
	});

	it("ignores the project file unless the project is trusted", () => {
		write(join(agent, "rlm.json"), { allowEnvironmentOverrides: false });
		write(join(project, ".pi", "rlm.json"), { allowEnvironmentOverrides: true });
		expect(allows({ projectTrusted: false })).toBe(false);
		expect(allows({ projectTrusted: true })).toBe(true);
	});

	it("lets a trusted project turn the global answer off", () => {
		write(join(agent, "rlm.json"), { allowEnvironmentOverrides: true });
		write(join(project, ".pi", "rlm.json"), { allowEnvironmentOverrides: false });
		expect(allows({ projectTrusted: true })).toBe(false);
	});

	it("reads the agent directory from PI_CODING_AGENT_DIR, the override pi honors", () => {
		process.env.PI_CODING_AGENT_DIR = agent;
		expect(agentDir()).toBe(agent);
		write(join(agent, "rlm.json"), { allowEnvironmentOverrides: true });
		expect(loadRlmConfig({ cwd: project }).allowEnvironmentOverrides).toBe(true);
	});
});
