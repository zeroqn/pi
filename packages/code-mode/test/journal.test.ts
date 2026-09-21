/**
 * The journal is ticket 04's durable record: what ran, and the replay machinery that
 * rebuilds state from it. Tested here because it is the part of the design with no pi
 * or monty dependency.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendJournal,
	readJournal,
	recordingHost,
	replayHost,
	restoredLine,
	type CellRecord,
	type HostCallRecord,
} from "../src/journal";

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "rlm-journal-test-"));
}

function cell(index: number, code: string, hostCalls: HostCallRecord[] = []): CellRecord {
	return { index, code, hostCalls, durationMs: 1, at: new Date(0).toISOString() };
}

describe("the journal file", () => {
	it("round-trips cells, including their host-call results", () => {
		const dir = scratch();
		try {
			const path = join(dir, "j.jsonl");
			const first = cell(0, "x = 41", [{ name: "bash", args: ["echo hi"], result: { exit_code: 0 } }]);
			appendJournal(path, first);
			appendJournal(path, cell(1, "x + 1"));
			const records = readJournal(path);
			expect(records.length).toBe(2);
			expect(records[0]!.code).toBe("x = 41");
			expect(records[0]!.hostCalls[0]!.result).toEqual({ exit_code: 0 });
			expect(records[0]!.hostCalls[0]!.args).toEqual(["echo hi"]);
			expect(records[1]!.index).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips a torn line instead of discarding the whole journal", () => {
		const dir = scratch();
		try {
			const path = join(dir, "j.jsonl");
			appendJournal(path, cell(0, "x = 1"));
			// A half-written final line, as a crash mid-append would leave it.
			writeFileSync(path, '{"index":1,"code":"trunc' + String.fromCharCode(10), { flag: "a" });
			appendJournal(path, cell(2, "x = 3"));
			const records = readJournal(path);
			expect(records.map((record) => record.index)).toEqual([0, 2]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns nothing for a session with no journal", () => {
		const dir = scratch();
		try {
			expect(readJournal(join(dir, "absent.jsonl"))).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("what the model is told after a restore", () => {
	it("names the replay when the journal was replayed", () => {
		expect(restoredLine({ cells: 2, hostCalls: 3, partial: false })).toContain("replayed 2 cells and 3 host calls");
	});

	it("names the dump when the fast path was taken", () => {
		const line = restoredLine({ cells: 2, hostCalls: 0, partial: false, note: "restored from a dump taken at cell 2" });
		expect(line).toContain("restored from a dump");
	});

	it("never reports a partial rebuild as a success", () => {
		const line = restoredLine({ cells: 3, hostCalls: 1, partial: true, note: "stopped in cell 1: NameError" });
		expect(line).toContain("partially rebuilt");
		expect(line).toContain("stopped in cell 1");
		expect(line).not.toContain("rebuilt from journal");
	});
});

describe("replay is reconstruction, not re-execution", () => {
	it("serves recorded results in order and never calls through", async () => {
		let called = 0;
		const live = recordingHost(
			{
				bash: async () => {
					called += 1;
					return { exit_code: 0, stdout: "live" };
				},
			},
			() => undefined,
		);
		const calls: HostCallRecord[] = [];
		const recording = recordingHost(live, (name, args, result) => calls.push({ name, args, result }));

		expect(await recording.bash!("echo hi")).toEqual({ exit_code: 0, stdout: "live" });
		expect(called).toBe(1);
		expect(calls).toEqual([{ name: "bash", args: ["echo hi"], result: { exit_code: 0, stdout: "live" } }]);

		// Replaying those calls must not touch the live host again.
		const replay = replayHost(calls);
		expect(await replay.host.bash!()).toEqual({ exit_code: 0, stdout: "live" });
		expect(called).toBe(1);
		expect(replay.consumed()).toBe(1);
	});

	it("stops loudly when the journal and the code disagree", async () => {
		// Both names are present in the journal, so both are served; what diverges is the
		// sequence (the code called bash_host where the journal recorded grep).
		const replay = replayHost([
			{ name: "grep", args: [], result: {} },
			{ name: "bash_host", args: [], result: {} },
		]);
		await expect(replay.host.bash_host!()).rejects.toThrow(/diverged: expected grep\(\), got bash_host\(\)/);
		// A recorded name whose calls are already spent must stop rather than re-run.
		const spent = replayHost([{ name: "bash_host", args: [], result: { exit_code: 0 } }]);
		expect(await spent.host.bash_host!()).toEqual({ exit_code: 0 });
		await expect(spent.host.bash_host!()).rejects.toThrow(/no recorded call left/);
	});
});

describe("host wrappers are named for the sandbox key they serve (ticket 01)", () => {
	it("names every recordingHost wrapper after its key, so a value read stays callable", async () => {
		const recorded: HostCallRecord[] = [];
		const recording = recordingHost(
			{
				bash_host: async () => "out",
				find: async () => ["a"],
				rlm_spawn: async () => ({ child_id: "c1" }),
			},
			(name, args, result) => recorded.push({ name, args, result }),
		);
		// The empty name is what monty turned into '<anonymous>' after a value read (ticket 02).
		expect(recording.bash_host!.name).toBe("bash_host");
		expect(recording.find!.name).toBe("find");
		expect(recording.rlm_spawn!.name).toBe("rlm_spawn");
		// Recording still journals the lookup key exactly as before.
		await recording.bash_host!();
		expect(recorded).toEqual([{ name: "bash_host", args: [], result: "out" }]);
	});

	it("serves every name the journal recorded, named to match its key, with no divergence", async () => {
		const calls: HostCallRecord[] = [
			{ name: "bash_host", args: ["echo hi"], result: "out" },
			{ name: "rlm_spawn", args: ["do a thing"], result: { child_id: "c1" } },
			{ name: "bg_list", args: [], result: [] },
		];
		const replay = replayHost(calls);
		// bash_host is the live key (ticket 02); rlm_spawn/bg_list are delegation/background.
		expect(Object.keys(replay.host).sort()).toEqual(["bash_host", "bg_list", "rlm_spawn"]);
		expect(replay.host.bash_host!.name).toBe("bash_host");
		expect(replay.host.rlm_spawn!.name).toBe("rlm_spawn");
		expect(replay.host.bg_list!.name).toBe("bg_list");
		// Replay the exact sequence the journaling run produced: no throw, all served.
		expect(await replay.host.bash_host!()).toBe("out");
		expect(await replay.host.rlm_spawn!()).toEqual({ child_id: "c1" });
		expect(await replay.host.bg_list!()).toEqual([]);
		expect(replay.consumed()).toBe(3);
	});
});

describe("a host call that raises is journaled and replayed (ticket 11)", () => {
	it("records the failure instead of dropping it", async () => {
		const recorded: HostCallRecord[] = [];
		const host = recordingHost(
			{
				web_search: async () => ({ provider: "duckduckgo" }),
				fetch_content: async (url: string) => {
					const error = new Error(`Blocked internal address for 127.0.0.1: 127.0.0.1`);
					error.name = "ValueError";
					throw error;
				},
			},
			(name, args, result, error) => recorded.push(error ? { name, args, error } : { name, args, result }),
		);
		expect(await host.web_search!("q")).toEqual({ provider: "duckduckgo" });
		await expect(host.fetch_content!("http://127.0.0.1/")).rejects.toThrow(/Blocked internal address/);
		expect(recorded).toEqual([
			{ name: "web_search", args: ["q"], result: { provider: "duckduckgo" } },
			{ name: "fetch_content", args: ["http://127.0.0.1/"], error: { name: "ValueError", message: "Blocked internal address for 127.0.0.1: 127.0.0.1" } },
		]);
	});

	it("replays success / failure / success, reproducing the failure as the same type", async () => {
		const calls: HostCallRecord[] = [
			{ name: "fetch_content", args: ["https://example.com/"], result: { chars: 12 } },
			{ name: "fetch_content", args: ["http://127.0.0.1/"], error: { name: "ValueError", message: "Blocked internal address for 127.0.0.1: 127.0.0.1" } },
			{ name: "bash_host", args: ["echo hi"], result: { exit_code: 0 } },
		];
		const replay = replayHost(calls);
		expect(await replay.host.fetch_content!("https://example.com/")).toEqual({ chars: 12 });
		const caught = (await replay.host.fetch_content!("http://127.0.0.1/").catch((error: unknown) => error)) as Error;
		expect(caught.name).toBe("ValueError");
		expect(caught.message).toBe("Blocked internal address for 127.0.0.1: 127.0.0.1");
		expect(await replay.host.bash_host!("echo hi")).toEqual({ exit_code: 0 });
		expect(replay.consumed()).toBe(3);
	});

	it("survives the journal file round trip", () => {
		const path = join(mkdtempSync(join(tmpdir(), "rlm-journal-errors-")), "journal.jsonl");
		const record: CellRecord = {
			index: 0,
			code: "try: await fetch_content(...)\nexcept ValueError:\n    print(1)",
			hostCalls: [
				{ name: "web_search", args: ["q"], result: { provider: "anysearch" } },
				{ name: "fetch_content", args: ["http://127.0.0.1/"], error: { name: "ValueError", message: "Blocked internal address" } },
			],
			durationMs: 3,
			at: new Date().toISOString(),
		};
		appendJournal(path, record);
		expect(readJournal(path)).toEqual([record]);
	});
});
