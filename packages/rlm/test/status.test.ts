/**
 * The footer line, driven end-to-end through the entry.
 *
 * Two things have to hold for the indicator to be worth reading: rlm renders it at the turn boundary
 * from the composition root's record (the kernel's state), and the manager's change signal re-renders
 * it mid-turn (how many children are working) — so a child spawned from a cell shows up while it
 * works and drops off when it finishes.
 *
 * The entry is driven in-process with a fake `pi` and a fake ctx because the footer is reachable no
 * other way: `setStatus` is interactive-only, and print mode's UI (what a headless run and a child
 * get) is a no-op.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { recordSession, type SessionRecord, sessionKey } from "../../host-bridge/src/convention";
import { createRlm } from "../index";
import type { RlmSessionDeps } from "../src/registration";
import { holdTurn, installFakePi, releaseTurnNow } from "./fake-pi";

installFakePi();

/** What the composition root would have recorded for a session. */
function record(file: string, mounted: boolean, problems: string[] = []): void {
	const ctx = { sessionManager: { getSessionFile: () => file } };
	recordSession(sessionKey(ctx), {
		mounted,
		owners: [],
		installed: [],
		reaches: [],
		promptTexts: [],
		problems,
	} satisfies SessionRecord);
}

/** The session's own deps slot — the process-global seam rlm files its manager under (registration.ts). */
function sessionDeps(ctx: unknown): RlmSessionDeps | undefined {
	const slot = (globalThis as Record<symbol, unknown>)[Symbol.for("pi-rlm:session-deps")];
	return slot instanceof Map ? (slot as Map<string, RlmSessionDeps>).get(sessionKey(ctx)) : undefined;
}

function fakeCtx(statuses: Array<[string, string]>, file: string) {
	return {
		cwd: "/tmp/work",
		sessionManager: {
			getSessionFile: () => file,
			getSessionId: () => "status-test",
			getEntries: () => [],
			getHeader: () => undefined,
		},
		ui: {
			setStatus: (key: string, text: string) => {
				statuses.push([key, text]);
			},
		},
	};
}

function fakePi() {
	const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
	return {
		on: (name: string, handler: (event: any, ctx: any) => unknown) => {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		getActiveTools: () => ["python"],
		appendEntry: () => {},
		sendMessage: () => {},
		async emit(name: string, event: any, ctx: any) {
			for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
		},
	};
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(() => {
	// The fake's turn behavior is process-wide (one mock, shared by every test file), so this test
	// states its own rather than trusting the default to have survived the file that ran before it.
	holdTurn();
});

describe("the footer line", () => {
	it("names the kernel at the turn boundary, counts a working child, and drops it when it finishes", async () => {
		const statuses: Array<[string, string]> = [];
		const ctx = fakeCtx(statuses, "/tmp/rlm-status.jsonl");
		record("/tmp/rlm-status.jsonl", true);

		const pi = fakePi();
		createRlm(pi, null);
		await pi.emit("session_start", { reason: "startup" }, ctx);
		await pi.emit("before_agent_start", { systemPrompt: "" }, ctx);
		expect(statuses.at(-1)).toEqual(["rlm", "rlm: code-mode (monty)"]);

		const deps = sessionDeps(ctx);
		if (!deps?.manager) throw new Error("the session filed no manager");
		await deps.manager.spawn({
			prompt: "go",
			name: "probe",
			depth: 1,
			spawnCell: "",
			ownerDispatch: () => {},
		});
		expect(statuses.at(-1)).toEqual(["rlm", "rlm: code-mode (monty) ch: 1 running"]);

		releaseTurnNow();
		await settle();
		expect(statuses.at(-1)).toEqual(["rlm", "rlm: code-mode (monty)"]);

		await pi.emit("session_shutdown", { reason: "quit" }, ctx);
	});

	it("says so when there is no kernel, and nothing at all when there is no record", async () => {
		const statuses: Array<[string, string]> = [];
		const ctx = fakeCtx(statuses, "/tmp/rlm-status-nokernel.jsonl");
		record("/tmp/rlm-status-nokernel.jsonl", false, ["monty did not load"]);

		const pi = fakePi();
		createRlm(pi, null);
		await pi.emit("before_agent_start", { systemPrompt: "" }, ctx);
		expect(statuses).toEqual([["rlm", "rlm: kernel unavailable"]]);

		// A session the composition root has not recorded yet has no kernel state to report, so the
		// footer keeps whatever the other extensions put there.
		const unrecorded = fakeCtx(statuses, "/tmp/rlm-status-unrecorded.jsonl");
		await pi.emit("before_agent_start", { systemPrompt: "" }, unrecorded);
		expect(statuses).toHaveLength(1);
	});
});
