/**
 * The kernel's own clock over a cell (2026-10-17) — the hole monty's budget cannot cover.
 *
 * The case: a cell parked in a foreground host call. monty's in-sandbox check runs at **interpreter
 * checkpoints**, and its duration backstop compares a time the worker reports **on each protocol turn**
 * (`monty/docs/resource-limits.md`) — and a worker waiting on our callback makes no turn. Measured
 * before the clock existed, one kernel, same `maxFeedDurationSecs: 2`: a `while True: pass` ended at
 * 2.4s with monty's own `TimeoutError: feed time limit exceeded`, while `await bash("sleep 60")` was
 * still going at **90 seconds**. So the host owes its own callbacks a bound, and this is it: at the
 * cell's budget the cell is ended with a `TimeoutError` naming what it was waiting on, and the call's
 * process group is killed.
 *
 * The error *message* is the proof of which clock fired: monty's says `feed time limit exceeded`, ours
 * says `the cell ran past its feed budget … waiting for bash_host`. Since a declared call bound would
 * also end the call, the test drives the call's own bound up (`foregroundSeconds: 30`) so the only
 * thing that can end this cell at a second is the kernel's clock.
 *
 *   MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty bun test
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BASE_HOST_FNS, createLedger } from "../src/contract";
import { createKernel, MAX_FEED_SECONDS } from "../src/kernel";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) console.warn("skipping the real-kernel cell-clock tests: no runnable monty worker — set MONTY_BIN");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function textOf(result: unknown): string {
	const parts = (result as { content?: Array<{ text?: string }> })?.content ?? [];
	return parts.map((part) => part.text ?? "").join("");
}

/** Whether the process is running: `/proc/<pid>/stat`'s state, since `kill(pid, 0)` passes on a zombie. */
function running(pid: number): boolean {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const state = stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[0];
		return state !== "Z" && state !== "X";
	} catch {
		return false;
	}
}

async function kernelWith(budget: number, foregroundSeconds: number) {
	const dir = mkdtempSync(join(tmpdir(), "cm-clock-"));
	const pidFile = join(dir, "call.pid");
	const sessionFile = join(dir, "clock.jsonl");
	writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "", cwd: dir })}\n`);
	const ctx = { cwd: dir, sessionManager: { getSessionFile: () => sessionFile, getEntries: () => [] } };
	const ledger = createLedger({
		reserved: [...BASE_HOST_FNS],
		base: { description: BASE_DESCRIPTION, snippet: BASE_SNIPPET, guidelines: BASE_GUIDELINES },
	});
	const kernel = createKernel({
		pi: { appendEntry: () => {}, sendMessage: () => {} },
		sessionKey: sessionFile,
		ledger,
		limits: { maxFeedDurationSecs: budget, foregroundSeconds },
	});
	return { dir, ctx, kernel, pidFile, done: () => rmSync(dir, { recursive: true, force: true }) };
}

async function until(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await sleep(50);
	}
	throw new Error("condition not reached in time");
}

describe("the constants", () => {
	it("keeps the cell budget at an hour, so the clock and monty's own limit are one number", () => {
		expect(MAX_FEED_SECONDS).toBe(3600);
	});
});

describe.skipIf(!montyReady)("a cell parked in a foreground call", () => {
	it("is ended by the kernel's own clock, with a message that names what it was waiting on", async () => {
		const h = await kernelWith(1, 30);
		try {
			const started = Date.now();
			const text = textOf(
				await h.kernel.execute(
					{ code: `r = await bash("echo $$ > ${h.pidFile}; sleep 60")\nprint("never reached")` },
					undefined,
					h.ctx,
				),
			);
			const seconds = (Date.now() - started) / 1000;
			// The clock's own sentence, not monty's (`feed time limit exceeded`) and not the generic abort
			// (`aborted while waiting for …`): the model is told *why* its cell is over.
			expect(text).toContain("TimeoutError");
			expect(text).toContain("the cell ran past its feed budget (1s) while waiting for bash_host(...)");
			expect(text).toContain("its process group was killed");
			// At the budget, not at the call's own 30s bound and not never.
			expect(seconds).toBeLessThan(15);
			// And the group really is gone: the sentence above is a fact rather than a claim.
			const pid = Number(readFileSync(h.pidFile, "utf8").trim());
			await until(() => !running(pid), 5000);
			expect(running(pid)).toBe(false);
			// The cell is over, not the session: the clock aborted a signal, and the kernel outlives it.
			expect(textOf(await h.kernel.execute({ code: "print('next cell ran')" }, undefined, h.ctx))).toContain("next cell ran");
		} finally {
			await h.kernel.shutdown();
			h.done();
		}
	});

	it("is not touched at all while the budget has not passed — the abort is what ends it, and it says so", async () => {
		// The control: with a generous budget the parked cell keeps running, so what ended the cell above was
		// the clock and not something else in the stack. It also pins the distinction the clock's reason
		// introduces: an abort that carries no reason keeps the generic message.
		const h = await kernelWith(30, 600);
		const controller = new AbortController();
		try {
			const cell = h.kernel.execute(
				{ code: `r = await bash("echo $$ > ${h.pidFile}; sleep 60")\nprint("never reached")` },
				undefined,
				h.ctx,
				controller.signal,
			);
			await until(() => {
				try {
					return running(Number(readFileSync(h.pidFile, "utf8").trim()));
				} catch {
					return false;
				}
			});
			// Three seconds is well inside a 30s budget: nothing has ended it.
			await sleep(3000);
			const pid = Number(readFileSync(h.pidFile, "utf8").trim());
			expect(running(pid)).toBe(true);
			controller.abort();
			const text = textOf(await cell);
			expect(text).toContain("aborted while waiting for bash_host(...); its process group was killed");
			expect(text).not.toContain("feed budget");
			await until(() => !running(pid), 5000);
		} finally {
			await h.kernel.shutdown();
			h.done();
		}
	});
});
