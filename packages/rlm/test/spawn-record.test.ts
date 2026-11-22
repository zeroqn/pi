/**
 * The spawn record (`.scratch/child-record/`): the one fact about a child that outlives the process
 * that ran it.
 *
 * A child is an in-process `AgentSession` and its record is an in-memory `Map` entry, so a restart
 * resumes with `rlm.list()` empty and no way to name the child whose transcript is still on disk
 * (measured 2026-11-22, `.scratch/kernel-rebuild/`). The spawner therefore writes one `rlm-spawn`
 * entry at the moment the facts exist, and a resumed session rehydrates it as a `gone` child.
 *
 * These cases are the reader (cheap and pi-free), the writer of that entry, and the manager's restore
 * rules: a gone child is nameable and readable, never runnable — no live count, no stop, no send.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { sessionKey } from "../../host-bridge/src/convention";
import { createRlm } from "../index";
import { installFakePi, holdTurn, releaseTurnNow, resetFakeSessions } from "./fake-pi";
import { createChildManager, GONE_REASON, type Notice } from "../src/children";
import type { RlmSessionDeps } from "../src/registration";
import { SPAWN_ENTRY_TYPE, appendSpawnRecord, readSpawnRecords, readSpawnRecordsFrom, type SpawnRecord } from "../src/spawn-record";

installFakePi();
beforeEach(() => {
	holdTurn();
	resetFakeSessions();
});

const record = (over: Partial<SpawnRecord> = {}): SpawnRecord => ({
	child_id: "child-1",
	name: "alpha",
	session_file: "/tmp/earlier/child-1.jsonl",
	model: null,
	depth: 1,
	at: "2026-11-01T00:00:00.000Z",
	parent_session_file: "/tmp/parent.jsonl",
	...over,
});

function harness(maxLive = 8) {
	const notices: Notice[] = [];
	const entries: Array<{ customType: string; data: any }> = [];
	const manager = createChildManager({
		cwd: () => "/tmp/work",
		ownSessionFile: () => "/tmp/parent.jsonl",
		kernelFactoryFor: () => () => {},
		runtime: async () => ({}),
		maxDepth: 2,
		maxLive,
		onChange: () => {},
		staleAfterSeconds: () => 600,
		appendEntry: (customType, data) => entries.push({ customType, data }),
	});
	const spawn = (name = "probe") =>
		manager.spawn({
			prompt: "go",
			name,
			depth: 1,
			spawnCell: "",
			parentSessionFile: "/tmp/parent.jsonl",
			ownerDispatch: (notice) => notices.push(notice),
		});
	return { manager, entries, notices, spawn };
}

describe("the spawn record's entry", () => {
	it("reads one record per spawn entry, oldest first, and skips everything else", () => {
		const entries = [
			{ type: "custom", customType: "rlm-stop", data: { child_id: "child-1" } },
			{ type: "message", message: { role: "user" } },
			{ type: "custom", customType: SPAWN_ENTRY_TYPE, data: record() },
			// A torn or malformed entry must not cost the records behind it.
			{ type: "custom", customType: SPAWN_ENTRY_TYPE, data: { child_id: 7 } },
			{ type: "custom", customType: SPAWN_ENTRY_TYPE, data: record({ child_id: "child-2", name: "beta", session_file: null }) },
		];
		expect(readSpawnRecords(entries).map((entry) => entry.name)).toEqual(["alpha", "beta"]);
		expect(readSpawnRecords(entries)[1]!.session_file).toBeNull();
		// The manager reader is the same rule against a session manager, and answers nothing when it throws.
		expect(readSpawnRecordsFrom({ getEntries: () => entries }).length).toBe(2);
		expect(
			readSpawnRecordsFrom({
				getEntries: () => {
					throw new Error("unreadable");
				},
			}),
		).toEqual([]);
	});

	it("writes through the session's writer, and never fails a spawn over a missing one", () => {
		const written: Array<{ customType: string; data: unknown }> = [];
		appendSpawnRecord((customType, data) => written.push({ customType, data }), record());
		expect(written).toEqual([{ customType: SPAWN_ENTRY_TYPE, data: record() }]);
		expect(() => appendSpawnRecord(undefined, record())).not.toThrow();
		expect(() =>
			appendSpawnRecord(() => {
				throw new Error("transcript is read-only");
			}, record()),
		).not.toThrow();
	});

	it("is written by spawn itself, with the child's id, name and transcript", async () => {
		const { spawn, entries } = harness();
		const handle = await spawn("alpha");
		try {
			expect(entries).toHaveLength(1);
			expect(entries[0]!.customType).toBe(SPAWN_ENTRY_TYPE);
			expect(entries[0]!.data).toMatchObject({
				child_id: handle.child_id,
				name: "alpha",
				session_file: handle.session_file,
				depth: 1,
				parent_session_file: "/tmp/parent.jsonl",
			});
		} finally {
			releaseTurnNow();
		}
	});
});

describe("a resumed session's children", () => {
	it("names them as gone, with the transcript to read and no live count", () => {
		const { manager } = harness();
		manager.restore([record(), record({ child_id: "child-2", name: "beta", depth: 2, parent_session_file: "/tmp/child-1.jsonl" })]);
		const children = manager.list();
		expect(children.map((child) => [child.name, child.status])).toEqual([
			["alpha", "gone"],
			["beta", "gone"],
		]);
		expect(children[0]!.reason).toBe(GONE_REASON);
		expect(children[0]!.session_file).toBe("/tmp/earlier/child-1.jsonl");
		expect(children[1]!.depth).toBe(2);
		// Not running means not occupying one of the live slots: the limit is about work in flight.
		expect(manager.liveCount()).toBe(0);
		expect(manager.staleChildren()).toEqual([]);
	});

	it("is idempotent, so a second session_start in one instance does not double a name", () => {
		const { manager } = harness();
		manager.restore([record()]);
		manager.restore([record()]);
		expect(manager.list()).toHaveLength(1);
	});

	it("lets a spawn through at the live cap, which a gone child never fills", async () => {
		const { manager, spawn } = harness(1);
		manager.restore([record(), record({ child_id: "child-2", name: "beta" })]);
		try {
			const handle = await spawn("gamma");
			expect(handle.status).toBe("running");
			expect(manager.liveCount()).toBe(1);
		} finally {
			releaseTurnNow();
		}
	});

	it("continues the id sequence, so a new child cannot shadow a restored one", async () => {
		const { manager, spawn } = harness();
		manager.restore([record()]);
		try {
			const handle = await spawn("probe");
			expect(handle.child_id).toBe("child-2");
			// Both are selectable on their own ids.
			expect(manager.poll("child-1").status).toBe("gone");
			expect(manager.poll("child-2").status).toBe("running");
		} finally {
			releaseTurnNow();
		}
	});

	it("resolves a reused name to the live child, and keeps the gone one reachable by id", async () => {
		const { manager, spawn } = harness();
		manager.restore([record()]);
		try {
			await spawn("alpha");
			expect(manager.poll("alpha").status).toBe("running");
			expect(manager.poll("child-1").status).toBe("gone");
		} finally {
			releaseTurnNow();
		}
	});

	it("refuses stop and send, naming the transcript instead", async () => {
		const { manager } = harness();
		manager.restore([record()]);
		await expect(manager.stop("alpha")).rejects.toThrow(/is gone .*read its transcript at \/tmp\/earlier\/child-1\.jsonl/);
		await expect(manager.send("alpha", "more")).rejects.toThrow(/nothing to resume; spawn a new child instead/);
		// The record survives a refused verb: it is the only thing left of the child.
		expect(manager.list()).toHaveLength(1);
		expect(manager.list()[0]!.status).toBe("gone");
	});

	it("forgets one on remove, because forgetting is this session's decision", async () => {
		const { manager } = harness();
		manager.restore([record(), record({ child_id: "child-2", name: "beta" })]);
		const removed = await manager.remove("alpha");
		expect(removed.status).toBe("gone");
		expect(manager.list().map((child) => child.name)).toEqual(["beta"]);
	});

	it("joins immediately: a gone child is terminal, and has no answer to give", async () => {
		const { manager } = harness();
		manager.restore([record()]);
		const waited = await manager.wait(["alpha"], 1);
		expect(waited[0]!.status).toBe("gone");
		expect(waited[0]!.answer).toBeUndefined();
	});
});


/**
 * The wiring, not the rule: `restore` above is the manager's; this is the one line in the entry that
 * calls it, with the transcript the session actually has. Driven through `createRlm` and a fake `pi`
 * because that is the only way to reach the entry's own `session_start`.
 */
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

/** The session's own deps slot — the process-global seam rlm files its manager under (`registration.ts`). */
function sessionDeps(ctx: unknown): RlmSessionDeps | undefined {
	const slot = (globalThis as Record<symbol, unknown>)[Symbol.for("pi-rlm:session-deps")];
	return slot instanceof Map ? (slot as Map<string, RlmSessionDeps>).get(sessionKey(ctx)) : undefined;
}

describe("the entry's own session_start", () => {
	it("restores this transcript's spawn records for a resumed session", async () => {
		const transcript = [{ type: "custom", customType: SPAWN_ENTRY_TYPE, data: record() }];
		const file = "/tmp/spawn-record-resume.jsonl";
		const ctx = {
			cwd: "/tmp/work",
			sessionManager: {
				getSessionFile: () => file,
				getSessionId: () => "spawn-record-test",
				getEntries: () => transcript,
				getHeader: () => undefined,
			},
		};
		const pi = fakePi();
		createRlm(pi, null);
		await pi.emit("session_start", { reason: "resume" }, ctx);

		const manager = sessionDeps(ctx)?.manager;
		if (!manager) throw new Error("the session filed no manager");
		expect(manager.list().map((child) => [child.name, child.status])).toEqual([["alpha", "gone"]]);
		await pi.emit("session_shutdown", { reason: "quit" }, ctx);
	});
});
