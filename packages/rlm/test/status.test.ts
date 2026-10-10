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
import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { recordSession, type SessionRecord, sessionKey } from "../../host-bridge/src/convention";
import { createRlm } from "../index";
import type { RlmSessionDeps } from "../src/registration";
import { holdTurn, installFakePi, releaseTurnNow, setChildEntries } from "./fake-pi";

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

	it("surfaces the tree's tokens from the same function rlm.tree_cost answers with", async () => {
		const statuses: Array<[string, string]> = [];
		const ctx = fakeCtx(statuses, "/tmp/rlm-status-cost.jsonl");
		record("/tmp/rlm-status-cost.jsonl", true);
		setChildEntries([
			{
				id: "a",
				type: "message",
				message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 141_000, output: 400, total: 141_400 } },
			},
		]);

		const pi = fakePi();
		createRlm(pi, null);
		await pi.emit("session_start", { reason: "startup" }, ctx);
		const deps = sessionDeps(ctx);
		if (!deps?.manager) throw new Error("the session filed no manager");
		await deps.manager.spawn({ prompt: "go", name: "probe", depth: 1, spawnCell: "", ownerDispatch: () => {} });
		releaseTurnNow();
		await settle();

		expect(statuses.at(-1)).toEqual(["rlm", "rlm: code-mode (monty) · 141k tok"]);
		// One function, two readers: the footer cannot disagree with `rlm.tree_cost()`.
		expect(deps.manager.treeCost()).toBe(141_400);
		await pi.emit("session_shutdown", { reason: "quit" }, ctx);
	});

	it("repaints when a run ends, so a stale clause does not outlive the cell by a tick", async () => {
		// The live E1 run measured this gap (`.scratch/long-work` ticket 04): six seconds after Esc the
		// line still read `run: bash -c 'echo $$ …' 20s`, because nothing repainted at the *end* of a cell
		// — only on the next 30 s tick. `agent_end` is that moment.
		const statuses: Array<[string, string]> = [];
		const ctx = fakeCtx(statuses, "/tmp/rlm-status-end.jsonl");
		record("/tmp/rlm-status-end.jsonl", true);
		const pi = fakePi();
		createRlm(pi, null);
		await pi.emit("session_start", { reason: "startup" }, ctx);
		await pi.emit("before_agent_start", { systemPrompt: "" }, ctx);
		expect(statuses.at(-1)).toEqual(["rlm", "rlm: code-mode (monty)"]);

		// A run ends with nothing changed: repaint-on-change means no write at all.
		const before = statuses.length;
		await pi.emit("agent_end", {}, ctx);
		expect(statuses.length).toBe(before);

		// The state did move during the run: the end of it is when the line catches up.
		record("/tmp/rlm-status-end.jsonl", false, ["monty has gone"]);
		await pi.emit("agent_end", {}, ctx);
		expect(statuses.at(-1)).toEqual(["rlm", "rlm: kernel unavailable"]);
		await pi.emit("session_shutdown", { reason: "quit" }, ctx);
	});

	it("arms the heartbeat at the turn boundary, because the root's own work gives no other signal", async () => {
		// The live defect this pins (`.scratch/long-work` ticket 04, found by E1 on 2026-10-10): the tick
		// was armed only from the manager's change signal, so a session that spawns no child never armed
		// it — and the tick is the only thing that repaints a footer *during* a cell, which is exactly
		// when the new clauses exist. The E1 run showed `rlm: code-mode (monty)` through a foreground call
		// of a minute, not one clause.
		const statuses: Array<[string, string]> = [];
		const ctx = fakeCtx(statuses, "/tmp/rlm-status-tick.jsonl");
		record("/tmp/rlm-status-tick.jsonl", true);
		const spy = spyOn(globalThis, "setInterval");
		const pi = fakePi();
		createRlm(pi, null);
		try {
			await pi.emit("session_start", { reason: "startup" }, ctx);
			// Nothing in flight yet, and the count already repaints on every turn boundary — so arming
			// waits for the boundary rather than happening at session start.
			expect(spy).not.toHaveBeenCalled();
			await pi.emit("before_agent_start", { systemPrompt: "" }, ctx);
			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy.mock.calls[0]?.[1]).toBe(30_000);
			// A second boundary does not arm a second interval.
			await pi.emit("before_agent_start", { systemPrompt: "" }, ctx);
			expect(spy).toHaveBeenCalledTimes(1);
			await pi.emit("session_shutdown", { reason: "quit" }, ctx);
		} finally {
			spy.mockRestore();
		}
	});

	it("arms nothing at all without a UI, where a repaint is a no-op anyway", async () => {
		const statuses: Array<[string, string]> = [];
		const ctx = fakeCtx(statuses, "/tmp/rlm-status-headless.jsonl");
		delete (ctx as { ui?: unknown }).ui;
		record("/tmp/rlm-status-headless.jsonl", true);
		const spy = spyOn(globalThis, "setInterval");
		const pi = fakePi();
		createRlm(pi, null);
		try {
			await pi.emit("session_start", { reason: "startup" }, ctx);
			await pi.emit("before_agent_start", { systemPrompt: "" }, ctx);
			expect(spy).not.toHaveBeenCalled();
			await pi.emit("session_shutdown", { reason: "quit" }, ctx);
		} finally {
			spy.mockRestore();
		}
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
