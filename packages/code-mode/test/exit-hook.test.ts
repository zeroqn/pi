/**
 * The process-exit reaper (2026-10-17): what ends a background shell when pi itself goes away.
 *
 * A background shell is **detached**, so it outlives pi — which is the point of the group kill and the
 * reason nothing else ends it. The abort deliberately leaves it (it is session-owned), a read-only mode
 * change kills it, `session_shutdown` kills it, and a later session reaps a kernel whose session is
 * gone. What is left is the process *ending* with shells still running: `diag-wait-issue-20261017.tar.gz`
 * shows the shape of the cost when nothing reaps (two shells, eighteen hours, twenty cores).
 *
 * Two halves are tested, for the same reason `lease.test.ts` splits the same way: the bookkeeping
 * (`reapBackgrounds` over a map of fake handles, and the once-per-process install) needs no worker, and
 * the property that makes it work at all — that the kill has already happened by the time
 * `killBackgrounds()` returns its promise — needs a real shell.
 *
 *   MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty bun test
 */
import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BASE_HOST_FNS, createLedger, installExitReaper, reapProcesses, type KernelHandle } from "../src/contract";
import { createKernel } from "../src/kernel";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) console.warn("skipping the real-kernel exit-hook test: no runnable monty worker — set MONTY_BIN");

function textOf(result: unknown): string {
	const parts = (result as { content?: Array<{ text?: string }> })?.content ?? [];
	return parts.map((part) => part.text ?? "").join("");
}

async function until(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("condition not reached in time");
}

/**
 * Whether the process is actually *running*: `/proc/<pid>/stat`'s state field, not a signal probe. A
 * SIGKILLed child of this process stays a zombie until it is reaped, and `process.kill(pid, 0)` succeeds
 * on a zombie — so `expect(() => kill(pid, 0)).toThrow()` passes or fails on timing rather than on facts.
 */
function running(pid: number): boolean {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const state = stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[0];
		return state !== "Z" && state !== "X";
	} catch {
		return false;
	}
}

async function until(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("condition not reached in time");
}

function textOf(result: unknown): string {
	const parts = (result as { content?: Array<{ text?: string }> })?.content ?? [];
	return parts.map((part) => part.text ?? "").join("");
}

function fakeHandle(kill: () => unknown): KernelHandle {
	// Only the two members the reaper can reach are needed; the rest of the contract is not this test's
	// business, and `KernelHandle` is structural.
	return { killBackgrounds: kill } as unknown as KernelHandle;
}

describe("reaping every session's shells at the process's exit", () => {
	it("kills the running shells of every mounted kernel, and keeps going past a failure", () => {
		const called: string[] = [];
		const sessions = new Map<string, KernelHandle>([
			["a", fakeHandle(() => called.push("a"))],
			// A session whose kill throws must not spare the ones after it: the process is not coming back
			// to try again.
			[
				"b",
				fakeHandle(() => {
					throw new Error("this session's kernel is already gone");
				}),
			],
			// An older code mode answers no `killBackgrounds` at all, which the contract allows.
			["c", {} as unknown as KernelHandle],
			["d", fakeHandle(() => called.push("d"))],
		]);
		expect(() => reapProcesses(sessions)).not.toThrow();
		expect(called).toEqual(["a", "d"]);
	});

	it("installs at most one exit listener per process, whichever instance asks first", () => {
		// Whether *this* call is the one that installs depends on what else has run in this process: a
		// test file that imports the entry (`abort.test.ts` does) installs it at module load, because the
		// entry is where the process-level hook belongs. So the property asserted is the one that must hold
		// either way — the second call adds nothing, and this helper can never be the source of two.
		const before = process.listenerCount("exit");
		installExitReaper(new Map<string, KernelHandle>([["a", fakeHandle(() => {})]]));
		const afterFirst = process.listenerCount("exit");
		// A `/reload` re-imports the entry and a child instance joins it: both call this, and neither may
		// add a second listener.
		installExitReaper(new Map());
		const afterSecond = process.listenerCount("exit");
		expect(afterSecond).toBe(afterFirst);
		expect(afterFirst - before).toBeLessThanOrEqual(1);
	});
});

describe.skipIf(!montyReady)("the kill an exit handler has to be able to make", () => {
	it("has already happened by the time killBackgrounds() returns its promise", async () => {
		// The property the whole file rests on: `process.on("exit", …)` cannot await, so the signal has to
		// go out synchronously *inside* a function typed as async — a later edit putting an `await` in
		// front of it would leave every shell alive, because the process is gone by then.
		const dir = mkdtempSync(join(tmpdir(), "cm-exit-hook-"));
		const sessionFile = join(dir, "exit.jsonl");
		writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "", cwd: dir })}\n`);
		const entries: any[] = [];
		const pi = { appendEntry: (type: string, data: any) => entries.push({ type, data }), sendMessage: () => {} };
		const ctx = { cwd: dir, sessionManager: { getSessionFile: () => sessionFile, getEntries: () => [] } };
		const ledger = createLedger({
			reserved: [...BASE_HOST_FNS],
			base: { description: BASE_DESCRIPTION, snippet: BASE_SNIPPET, guidelines: BASE_GUIDELINES },
		});
		const kernel = createKernel({ pi, sessionKey: sessionFile, ledger });
		try {
			expect(textOf(await kernel.execute({ code: 'h = await bash("sleep 30", background=True)\nprint(h.id)' }, undefined, ctx))).toContain("bg-1");
			const record = entries.find((entry) => entry.type === "rlm-bg")?.data;
			const pid = record.pid as number;
			expect(() => process.kill(pid, 0)).not.toThrow();

			// Not awaited: the exit handler could not await it either. The *verdict* is what can be read
			// synchronously — `finish` ran and wrote the record before the promise was returned. (The pid
			// itself survives a moment as a zombie until this process reaps it, so the death below is
			// asserted as a bounded fact rather than an instantaneous one.)
			void kernel.killBackgrounds!();
			expect(kernel.backgrounds!().find((handle) => handle.id === "bg-1")?.status).toBe("killed");
			await until(() => {
				try {
					process.kill(pid, 0);
					return false;
				} catch {
					return true;
				}
			}, 4000);
		} finally {
			await kernel.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("the exit reaper and a foreground call in flight", () => {
	it("kills the process group a cell is waiting on, which has no record for a later session to probe", async () => {
		// The measured gap: a foreground call is `detached`, its only reaper is the abort, and a SIGKILLed
		// pi sends none — so `sleep 300` under `bash -lc` survives and is reparented to init. Unlike a
		// background shell, a leaked foreground call has **no record**: a call writes its journal entry only
		// when the cell returns, so nothing a later session reads could find it either.
		const dir = mkdtempSync(join(tmpdir(), "cm-exit-fg-"));
		const pidFile = join(dir, "call.pid");
		const sessionFile = join(dir, "fg.jsonl");
		writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "", cwd: dir })}\n`);
		const ctx = { cwd: dir, sessionManager: { getSessionFile: () => sessionFile, getEntries: () => [] } };
		const ledger = createLedger({
			reserved: [...BASE_HOST_FNS],
			base: { description: BASE_DESCRIPTION, snippet: BASE_SNIPPET, guidelines: BASE_GUIDELINES },
		});
		const kernel = createKernel({ pi: { appendEntry: () => {}, sendMessage: () => {} }, sessionKey: sessionFile, ledger });
		try {
			// The cell is left in flight — exactly what a reaper meets.
			const cell = kernel.execute({ code: `r = await bash("echo $$ > ${pidFile}; sleep 60")\nprint("killed:", r["killed"])` }, undefined, ctx);
			await until(() => existsSync(pidFile), 20_000);
			const pid = Number(readFileSync(pidFile, "utf8").trim());
			expect(pid).toBeGreaterThan(0);
			expect(running(pid)).toBe(true);

			// What the process's own `exit` handler calls, with the real kernel standing in for the handle
			// the sessions map holds.
			reapProcesses(new Map([["session", kernel as unknown as KernelHandle]]));
			// The signal takes an instant and `kill(pid, 0)` answers *true* for a zombie, so the honest
			// question is the process's state — the trap this repo has already paid for twice.
			await until(() => !running(pid), 4000);
			expect(running(pid)).toBe(false);

			// And the cell is honest about it: the call came back killed, because `run()` resolves on a kill
			// rather than pretending the command returned.
			const text = textOf(await cell);
			expect(text).toContain("killed: True");
		} finally {
			await kernel.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
