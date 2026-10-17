/**
 * The write-ahead record for process-owning foreground calls (2026-10-17, route 1 of
 * `.scratch/bg-lease/REPORT.md`).
 *
 * The case: a foreground call is `detached`, its reapers are the abort and the process's own `exit`, and
 * a pi that is SIGKILLed runs neither — measured, `sleep 300` under `bash -lc` survives and is
 * reparented to init. A background handle survives that too and is *recoverable*, because it is
 * journalled with its pid and its pid's start time; a foreground call is journalled only when the cell
 * returns, so a cell killed mid-call leaves nothing to find. This file is what closes that gap, and
 * these tests hold its three rules: a record is a witness (never a promise), only a **verified** stray
 * is killed, and a stray is killed rather than leased.
 *
 *   MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty bun test
 */
import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BASE_HOST_FNS, createLedger } from "../src/contract";
import { createForegroundLedger } from "../src/foreground";
import { createKernel } from "../src/kernel";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";
import { readPidStart } from "../src/util";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) console.warn("skipping the real-kernel foreground-record tests: no runnable monty worker — set MONTY_BIN");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function textOf(result: unknown): string {
	const parts = (result as { content?: Array<{ text?: string }> })?.content ?? [];
	return parts.map((part) => part.text ?? "").join("");
}

/** Running, honestly: `/proc/<pid>/stat`'s state, since `kill(pid, 0)` passes for a zombie. */
function running(pid: number): boolean {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const state = stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[0];
		return state !== "Z" && state !== "X";
	} catch {
		return false;
	}
}

async function until(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await sleep(50);
	}
	throw new Error("condition not reached in time");
}

/** A real detached process with its own group, exactly as `run()` spawns one. */
function spawnDetached(command: string): number {
	const child = spawn("/bin/bash", ["-lc", command], { detached: true, stdio: "ignore" });
	child.unref();
	return child.pid!;
}

function lines(file: string): any[] {
	try {
		return readFileSync(file, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	} catch {
		return [];
	}
}

function ledgerAt(dir: string, name = "records.fg") {
	const file = join(dir, name);
	return { file, ledger: createForegroundLedger({ path: () => file }) };
}

describe("the record itself", () => {
	it("writes a start line at spawn and a done line when the call returns", () => {
		const dir = mkdtempSync(join(tmpdir(), "fg-rec-"));
		try {
			const { file, ledger } = ledgerAt(dir);
			// Nothing to record for a pid that never existed.
			expect(ledger.open(-1, "nonsense")).toBeInstanceOf(Function);
			ledger.open(-1, "nonsense")();
			expect(existsSync(file)).toBe(false);

			const done = ledger.open(4321, "nix build .#foo");
			const written = lines(file);
			expect(written.length).toBe(1);
			expect(written[0].t).toBe("start");
			expect(written[0].pid).toBe(4321);
			expect(written[0].pgid).toBe(4321);
			expect(written[0].command).toBe("nix build .#foo");
			// The identity token is read at spawn: without it, no later session could ever verify a pid.
			expect(typeof written[0].pid_start === "number" || written[0].pid_start === null).toBe(true);
			expect(written[0].started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

			done();
			expect(lines(file).map((entry) => entry.t)).toEqual(["start", "done"]);
			// A second `done` is not written: the marker is idempotent, so a `cleanup` reached twice cannot
			// unbalance the file.
			done();
			expect(lines(file).length).toBe(2);
			// And a resolved pair is not a stray.
			expect(ledger.resolve()).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reports a verified stray as live, and ends its group", async () => {
		const dir = mkdtempSync(join(tmpdir(), "fg-live-"));
		const pid = spawnDetached("sleep 60");
		try {
			const { file, ledger } = ledgerAt(dir);
			// What a SIGKILLed session leaves behind: a start line, no done line, and a live process.
			writeFileSync(
				file,
				`${JSON.stringify({ t: "start", pid, pgid: pid, pid_start: readPidStart(pid), command: "sleep 60", started_at: new Date().toISOString() })}\n`,
			);
			expect(running(pid)).toBe(true);
			const strays = ledger.resolve();
			expect(strays.length).toBe(1);
			expect(strays[0]!.verdict).toBe("live");
			expect(strays[0]!.record.command).toBe("sleep 60");
			await until(() => !running(pid));
			// Resolved work is not carried forward.
			expect(readFileSync(file, "utf8")).toBe("");
		} finally {
			if (running(pid)) {
				try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
			}
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reports an unprovable pid and never kills it — the whole point of the token", async () => {
		const dir = mkdtempSync(join(tmpdir(), "fg-unver-"));
		const pid = spawnDetached("sleep 60");
		try {
			const { file, ledger } = ledgerAt(dir);
			const record = { t: "start", pid, pgid: pid, command: "sleep 60", started_at: "2026-10-17T00:00:00.000Z" };
			// A start time that is not this process's: the pid was reused, and whatever wears it now is
			// somebody else's. A missing token is the same verdict — a record from before the field existed.
			appendFileSync(file, `${JSON.stringify({ ...record, pid_start: 1 })}\n`);
			appendFileSync(file, `${JSON.stringify({ ...record, pid: spawnDetached("sleep 60") })}\n`);
			const strays = ledger.resolve();
			expect(strays.map((stray) => stray.verdict)).toEqual(["unverified", "unverified"]);
			// Not killed — and the record is not carried forward either, because it has been reported.
			await sleep(300);
			for (const stray of strays) expect(running(stray.record.pid)).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("leaves a call this process still has open alone, and keeps its record", async () => {
		const dir = mkdtempSync(join(tmpdir(), "fg-active-"));
		const pid = spawnDetached("sleep 60");
		try {
			const { file, ledger } = ledgerAt(dir);
			ledger.open(pid, "sleep 60");
			// A resumed session in the same process resolves the file while its own call is running: that
			// call is not a stray, and the rewrite must not lose the record the eventual `done` cancels.
			expect(ledger.resolve()).toEqual([]);
			expect(running(pid)).toBe(true);
			expect(lines(file).length).toBe(1);
			expect(lines(file)[0].pid).toBe(pid);
		} finally {
			if (running(pid)) {
				try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
			}
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("skips a torn last line and still resolves the records behind it", async () => {
		const dir = mkdtempSync(join(tmpdir(), "fg-torn-"));
		const pid = spawnDetached("sleep 60");
		try {
			const { file, ledger } = ledgerAt(dir);
			writeFileSync(
				file,
				`${JSON.stringify({ t: "start", pid, pgid: pid, pid_start: readPidStart(pid), command: "sleep 60", started_at: "" })}\n{"t":"start","pid":999`,
			);
			const strays = ledger.resolve();
			expect(strays.length).toBe(1);
			expect(strays[0]!.verdict).toBe("live");
			await until(() => !running(pid));
		} finally {
			if (running(pid)) {
				try { process.kill(-pid, "SIGKILL"); } catch { /* gone */ }
			}
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("is a witness that cannot fail a call: no path, no file, no throw", () => {
		const ledger = createForegroundLedger({ path: () => "" });
		const done = ledger.open(1234, "anything");
		done();
		expect(ledger.resolve()).toEqual([]);
		const dir = mkdtempSync(join(tmpdir(), "fg-bad-"));
		try {
			// A path under a directory that does not exist: the write fails, the call does not.
			const broken = createForegroundLedger({ path: () => join(dir, "missing", "records.fg") });
			const finish = broken.open(1234, "anything");
			finish();
			expect(broken.resolve()).toEqual([]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe.skipIf(!montyReady)("a session that finds a call an earlier one was running", () => {
	async function kernelOn(sessionFile: string, dir: string, entries?: any[]) {
		const ctx = { cwd: dir, sessionManager: { getSessionFile: () => sessionFile, getEntries: () => entries ?? [] } };
		const ledger = createLedger({
			reserved: [...BASE_HOST_FNS],
			base: { description: BASE_DESCRIPTION, snippet: BASE_SNIPPET, guidelines: BASE_GUIDELINES },
		});
		const sent: string[] = [];
		const kernel = createKernel({
			pi: { appendEntry: () => {}, sendMessage: (m: any) => sent.push(String(m?.content ?? "")) },
			sessionKey: sessionFile,
			ledger,
		});
		return { ctx, kernel, sent };
	}

	it("ends the process group at the next kernel's start, and says so", async () => {
		const dir = mkdtempSync(join(tmpdir(), "fg-session-"));
		const sessionFile = join(dir, "session.jsonl");
		const recordFile = `${sessionFile}.rlm-journal.jsonl.fg`;
		const pidFile = join(dir, "call.pid");
		writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "", cwd: dir })}\n`);
		const first = await kernelOn(sessionFile, dir);
		const second = await kernelOn(sessionFile, dir);
		let cell: Promise<unknown> | null = null;
		try {
			// A call in flight. `$$` is the shell's own pid, which is the group leader `run()` spawned.
			cell = first.kernel.execute({ code: `r = await bash("echo $$ > ${pidFile}; sleep 60")\nprint("killed:", r["killed"])` }, undefined, first.ctx);
			await until(() => existsSync(pidFile) && existsSync(recordFile));
			const pid = Number(readFileSync(pidFile, "utf8").trim());
			// The write-ahead property: the record is on disk *while the call is still running*, with no
			// done line — which is exactly the state a SIGKILLed pi leaves.
			await until(() => lines(recordFile).some((entry) => entry.t === "start" && entry.pid === pid));
			expect(lines(recordFile).some((entry) => entry.t === "done")).toBe(false);
			expect(running(pid)).toBe(true);

			// The next session's kernel starts on the same file — the crash survivor's view.
			const looked = textOf(await second.kernel.execute({ code: "print('new session cell')" }, undefined, second.ctx));
			expect(looked).toContain("new session cell");
			await until(() => !running(pid));
			expect(second.sent.some((message) => message.includes("an earlier session was running this in the foreground"))).toBe(true);
			expect(second.sent.some((message) => message.includes(`pid ${pid}`))).toBe(true);
			// And the first session's cell ends rather than hanging on a phantom. It reports `killed: false`,
			// which is honest for *this* process: the kill came from the next session's ledger, by pid, so
			// A's own `run()` sees the child exit rather than its own signal. In the case this exists for,
			// A's process is the one that died, and nobody reads its cell at all.
			expect(textOf(await cell)).toContain("killed:");
		} finally {
			if (cell) await cell;
			await first.kernel.shutdown();
			await second.kernel.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("says nothing about a call that returned, and nothing in a fresh session", async () => {
		const dir = mkdtempSync(join(tmpdir(), "fg-clean-"));
		const sessionFile = join(dir, "session.jsonl");
		const recordFile = `${sessionFile}.rlm-journal.jsonl.fg`;
		writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "", cwd: dir })}\n`);
		const first = await kernelOn(sessionFile, dir);
		const second = await kernelOn(sessionFile, dir);
		try {
			// A call that finished: a start line and a done line, and no live process.
			const text = textOf(await first.kernel.execute({ code: 'r = await bash("echo finished")\nprint(r["stdout"].strip())' }, undefined, first.ctx));
			expect(text).toContain("finished");
			expect(lines(recordFile).map((entry) => entry.t)).toEqual(["start", "done"]);
			const looked = textOf(await second.kernel.execute({ code: "print('quiet')" }, undefined, second.ctx));
			expect(looked).toContain("quiet");
			expect(second.sent).toEqual([]);
		} finally {
			await first.kernel.shutdown();
			await second.kernel.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
