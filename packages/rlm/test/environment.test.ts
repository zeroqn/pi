/**
 * `rlm.json`'s gate, driven end-to-end through the entry.
 *
 * What the value *does* is `childPromptFor`'s (children.test.ts). This is the half that decides
 * whether it is honored at all, and it is the half a mistake would hide: a variable that is silently
 * ignored looks exactly like a variable that was never set.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionKey } from "../../host-bridge/src/convention";
import { createRlm } from "../index";
import { capturedLoaderOptions, holdTurn, installFakePi, releaseTurnNow } from "./fake-pi";

installFakePi();

type Notice = { text: string; level: string };

function fakePi() {
	const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
	const entries: Array<{ type: string; payload: unknown }> = [];
	return {
		entries,
		on: (name: string, handler: (event: any, ctx: any) => unknown) => {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		getActiveTools: () => ["python"],
		appendEntry: (type: string, payload: unknown) => entries.push({ type, payload }),
		sendMessage: () => {},
		async emit(name: string, event: any, ctx: any) {
			for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
		},
	};
}

let root: string;
let agent: string;
let project: string;
let saved: string | undefined;

beforeEach(() => {
	// The fake's turn behavior is process-wide (one mock, shared by every test file).
	holdTurn();
	root = mkdtempSync(join(tmpdir(), "rlm-env-"));
	agent = join(root, "agent");
	project = join(root, "project");
	mkdirSync(agent, { recursive: true });
	mkdirSync(join(project, ".pi"), { recursive: true });
	saved = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agent;
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	delete process.env.RLM_CHILD_PROMPT;
	if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = saved;
});

/** A ctx the entry can start on: the agent dir is the environment override, so the config is the test's. */
function ctxFor(notices: Notice[], file: string, projectTrusted = false) {
	return {
		cwd: project,
		isProjectTrusted: () => projectTrusted,
		sessionManager: {
			getSessionFile: () => file,
			getSessionId: () => "env-test",
			getEntries: () => [],
			getHeader: () => undefined,
		},
		ui: {
			notify: (text: string, level = "info") => notices.push({ text, level }),
		},
	};
}

const allows = () => writeFileSync(join(agent, "rlm.json"), JSON.stringify({ allowEnvironmentOverrides: true }));

/** The session's own deps slot — the process-global seam rlm files its manager under (registration.ts). */
function sessionDeps(ctx: unknown) {
	const slot = (globalThis as Record<symbol, unknown>)[Symbol.for("pi-rlm:session-deps")];
	return slot instanceof Map ? (slot as Map<string, { manager?: { spawn: (request: unknown) => Promise<unknown> } }>).get(sessionKey(ctx)) : undefined;
}

/** Spawn one child, and read the prompt the manager actually handed the child's session. */
async function spawnChild(pi: ReturnType<typeof fakePi>, ctx: unknown): Promise<string> {
	const deps = sessionDeps(ctx);
	if (!deps?.manager) throw new Error("the session filed no manager");
	await deps.manager.spawn({ prompt: "go", name: "probe", depth: 1, spawnCell: "", ownerDispatch: () => {} });
	releaseTurnNow();
	await new Promise((resolve) => setTimeout(resolve, 5));
	const options = capturedLoaderOptions.at(-1);
	if (!options) throw new Error("no child was spawned");
	return (options.appendSystemPrompt as string[]).join(" ");
}

describe("RLM_CHILD_PROMPT and rlm.json", () => {
	it("says the override is ignored when rlm.json does not allow it", async () => {
		process.env.RLM_CHILD_PROMPT = "none";
		const notices: Notice[] = [];
		const pi = fakePi();
		createRlm(pi, null);
		await pi.emit("session_start", { reason: "startup" }, ctxFor(notices, "/tmp/rlm-env-off.jsonl"));
		expect(notices).toEqual([
			{
				text: "RLM_CHILD_PROMPT=none is ignored: rlm.json does not allow environment overrides, so children get v2's prompt",
				level: "warning",
			},
		]);
		expect(pi.entries).toContainEqual({
			type: "rlm-environment",
			payload: { variable: "RLM_CHILD_PROMPT", value: "none", honored: false },
		});
	});

	it("says it is in effect when rlm.json allows it", async () => {
		process.env.RLM_CHILD_PROMPT = "none";
		allows();
		const notices: Notice[] = [];
		const pi = fakePi();
		createRlm(pi, null);
		await pi.emit("session_start", { reason: "startup" }, ctxFor(notices, "/tmp/rlm-env-on.jsonl"));
		expect(notices.map((notice) => notice.text)).toEqual([
			"RLM_CHILD_PROMPT=none is in effect: delegated children get the pre-v2 prompt (rlm.json allows environment overrides)",
		]);
		expect(pi.entries).toContainEqual({
			type: "rlm-environment",
			payload: { variable: "RLM_CHILD_PROMPT", value: "none", honored: true },
		});
	});

	it("shapes the spawned child's prompt only when rlm.json allows it", async () => {
		process.env.RLM_CHILD_PROMPT = "none";
		const off = fakePi();
		createRlm(off, null);
		const offCtx = ctxFor([], "/tmp/rlm-env-spawn-off.jsonl");
		await off.emit("session_start", { reason: "startup" }, offCtx);
		expect(await spawnChild(off, offCtx)).toContain("You may delegate with rlm.spawn");

		allows();
		const on = fakePi();
		createRlm(on, null);
		const onCtx = ctxFor([], "/tmp/rlm-env-spawn-on.jsonl");
		await on.emit("session_start", { reason: "startup" }, onCtx);
		const prompt = await spawnChild(on, onCtx);
		expect(prompt).not.toContain("persistent Python kernel");
		expect(prompt).toContain('You are "probe", a delegated child session (depth 1)');
	});

	it("says nothing when the variable is not set", async () => {
		const notices: Notice[] = [];
		const pi = fakePi();
		createRlm(pi, null);
		await pi.emit("session_start", { reason: "startup" }, ctxFor(notices, "/tmp/rlm-env-unset.jsonl"));
		expect(notices).toEqual([]);
		expect(pi.entries.filter((entry) => entry.type === "rlm-environment")).toEqual([]);
	});
});
