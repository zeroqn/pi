/**
 * The feed budget (`.scratch/long-work/issues/07-what-ends-a-cell.md`), driven at seconds instead of
 * an hour.
 *
 * A cell that makes no host call is invisible to everything else the kernel owns: `MAX_SUSPENSIONS`
 * counts suspensions, rotation needs one to snapshot at, and `activity()` can only say `cell_running`.
 * 05 measured that a spin burns (99.8 % CPU, 4.7 GB) while a sleep loop merely waits — and that monty
 * was already built for this: `maxFeedDurationSecs` raises a **catchable** `TimeoutError` inside the
 * cell, while the pool's `feedDurationLimitGrace` (left at its one-second default) kills the worker
 * when the in-sandbox checkpoint cannot fire.
 *
 * The two tests below split the decision exactly where it was made: a **spin is stopped**, a **sleeper
 * is not**. The second is not an oversight to be "fixed" later — the clock runs only while sandboxed
 * code executes, `maxTotalSleepSecs` is deliberately unset, and a sleeper's problem is visibility.
 *
 *   MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty bun test
 */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_HOST_FNS, createLedger } from "../src/contract";
import { CHECKOUT_LIMITS, MAX_FEED_SECONDS, createKernel, rebuildNote } from "../src/kernel";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) {
	console.warn("skipping the real-kernel feed-budget tests: no runnable monty worker — set MONTY_BIN");
}

function textOf(result: unknown): string {
	const parts = (result as { content?: Array<{ text?: string }> })?.content ?? [];
	return parts.map((part) => part.text ?? "").join("");
}

async function kernelWithFeedBudget(seconds: number) {
	const dir = mkdtempSync(join(tmpdir(), "cm-feed-"));
	const sessionFile = join(dir, "feed.jsonl");
	writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "", cwd: dir })}\n`);
	const pi = { appendEntry: () => {}, sendMessage: () => {} };
	const ctx = { cwd: dir, sessionManager: { getSessionFile: () => sessionFile, getEntries: () => [] } };
	const ledger = createLedger({
		reserved: [...BASE_HOST_FNS],
		base: { description: BASE_DESCRIPTION, snippet: BASE_SNIPPET, guidelines: BASE_GUIDELINES },
	});
	const kernel = createKernel({ pi, sessionKey: sessionFile, ledger, limits: { maxFeedDurationSecs: seconds } });
	return { dir, ctx, kernel };
}

describe("the constants", () => {
	it("states the budget once, so the checkout cannot drift from it", () => {
		expect(MAX_FEED_SECONDS).toBe(3600);
		expect(CHECKOUT_LIMITS.maxFeedDurationSecs).toBe(MAX_FEED_SECONDS);
	});

	it("tells a timed-out worker apart from a protocol error", () => {
		expect(rebuildNote(true)).toContain("feed budget");
		expect(rebuildNote(true)).not.toContain("protocol error");
		expect(rebuildNote(false)).toContain("protocol error");
		expect(rebuildNote(false)).not.toContain("feed budget");
	});
});

describe.skipIf(!montyReady)("a cell that makes no host call", () => {
	it("is stopped at the budget, with an error the cell could have caught, and the kernel survives", async () => {
		const { dir, ctx, kernel } = await kernelWithFeedBudget(2);
		try {
			// No host call and no sleep: nothing but the interpreter, which is the shape neither the
			// suspension budget nor rotation can see.
			const code = [
				'kept = "survives"',
				"import time",
				"t = time.time()",
				"x = 0",
				"while time.time() - t < 30:",
				"    x += 1",
				'print("never", x)',
			].join("\n");
			const text = textOf(await kernel.execute({ code }, undefined, ctx));
			expect(text).toContain("TimeoutError");
			expect(text).toContain("feed time limit exceeded");
			expect(text).not.toContain("never");

			// The in-sandbox layer, not the host one: the worker is alive, and what was bound before
			// the cell is still bound after it.
			const next = textOf(await kernel.execute({ code: 'print("kept", kept)' }, undefined, ctx));
			expect(next).toContain("kept survives");
		} finally {
			await kernel.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("leaves a sleep loop alone, because the clock does not run while the interpreter is parked", async () => {
		const { dir, ctx, kernel } = await kernelWithFeedBudget(1);
		try {
			// Three seconds of sleep against a one-second execution budget. This is the non-goal stated
			// as a test: bounding it would need `maxTotalSleepSecs`, cumulative and uncatchable.
			const code = ['import time', "for i in range(3):", "    time.sleep(1)", 'print("slept", i)'].join("\n");
			const text = textOf(await kernel.execute({ code }, undefined, ctx));
			expect(text).toContain("slept 2");
			expect(text).not.toContain("TimeoutError");
		} finally {
			await kernel.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
