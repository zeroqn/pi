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
		const replay = replayHost([{ name: "grep", args: [], result: {} }]);
		await expect(replay.host.bash!()).rejects.toThrow(/diverged: expected grep\(\), got bash\(\)/);
		await expect(replayHost([]).host.bash!()).rejects.toThrow(/no recorded call left/);
	});
});
