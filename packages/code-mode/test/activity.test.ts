/**
 * `activity()` — what the kernel is waiting on right now (rlm-stop ticket 05).
 *
 * The reader exists so another session can tell a child that is **working** from one that is
 * **wedged**: a child quiet in its transcript may be computing, blocked in one long call, or stuck,
 * and only the kernel knows which. What these tests pin is the part a reader relies on:
 *
 *   - a call in flight is visible, with its name and the bound it declared;
 *   - a *synchronous* host return is not a call at all (monty registers a future only for a thenable,
 *     so counting one would claim a wait the sandbox is not having);
 *   - concurrent calls come back oldest first, because the oldest is the one that may be stuck;
 *   - `cell_running` is about monty **executing**, not about a cell existing;
 *   - the list is empty — and honest — between cells and after shutdown;
 *   - `cell_age_ms` exists at all because `calls` cannot answer for a cell that makes **no** host call
 *     (`.scratch/long-work` ticket 09 — a spin), and `cell_budget_s` is published beside it so a
 *     reader's denominator is the limit that will actually kill the cell.
 *
 * Needs a worker: set `MONTY_BIN` (see README.md).
 */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_HOST_FNS, createLedger } from "../src/contract";
import { MAX_FEED_SECONDS, createKernel } from "../src/kernel";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) {
	console.warn("skipping the real-kernel tests: no runnable monty worker — set MONTY_BIN (see README.md)");
}

/** A gate the test opens by hand, so a host call can be held in flight deterministically. */
function gate() {
	let open: (() => void) | null = null;
	const held = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { held, open: () => open?.() };
}

/** Every call the guard was offered, in order: proof the guard's prologue is really in the path. */
const guarded: string[] = [];

async function harness(extra: Record<string, unknown> = {}, withGuard = false) {
	const dir = mkdtempSync(join(tmpdir(), "cm-activity-"));
	const sessionFile = join(dir, "activity.jsonl");
	writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "", cwd: dir })}\n`);
	const pi = { appendEntry: () => {}, sendMessage: () => {} };
	const ctx = { cwd: dir, sessionManager: { getSessionFile: () => sessionFile, getEntries: () => [] } };
	const ledger = createLedger({
		reserved: [...BASE_HOST_FNS],
		base: { description: BASE_DESCRIPTION, snippet: BASE_SNIPPET, guidelines: BASE_GUIDELINES },
	});
	ledger.accept({ owner: "probe", hostFns: { hold: () => gate().held, ...extra } as any });
	if (withGuard) {
		// A guard is what makes `makeHost` wrap the whole surface in an `async` prologue — the shape that
		// silently lost a declaration written from inside the callee (rlm-stop, 2026-10-09).
		ledger.accept({
			owner: "guard-probe",
			guard: {
				before: async (call: { name: string }) => {
					guarded.push(call.name);
					return { allow: true };
				},
			},
		} as any);
	}
	const kernel = createKernel({ pi, sessionKey: sessionFile, ledger });
	// The mount is what makes ROOT/SCRATCH exist for the prelude; `execute` does it lazily.
	await kernel.startSession(ctx);
	return { kernel, ctx, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe.skipIf(!montyReady)("what the kernel is waiting on (rlm-stop ticket 05)", () => {
	it("reports nothing, and no cell running, before a cell", async () => {
		const { kernel, cleanup } = await harness();
		try {
			expect(kernel.activity()).toEqual({ cell_running: false, calls: [], cell_age_ms: null, cell_budget_s: MAX_FEED_SECONDS });
		} finally {
			await kernel.shutdown();
			cleanup();
		}
	});

	it("shows a call in flight with its name, and clears it when the call settles", async () => {
		const held = gate();
		const { kernel, ctx, cleanup } = await harness({ slow: () => held.held });
		try {
			const cell = kernel.execute({ code: 'r = await slow()\nprint(r)' }, undefined, ctx);
			// The cell is now suspended on the host call; the reader is a pure snapshot of that state.
			await Bun.sleep(150);
			const during = kernel.activity();
			expect(during.cell_running).toBe(true);
			expect(during.calls.map((call) => call.name)).toEqual(["slow"]);
			expect(during.calls[0]!.timeout_s).toBeNull();
			expect(during.calls[0]!.age_ms).toBeGreaterThanOrEqual(0);

			held.open();
			await cell;
			expect(kernel.activity()).toEqual({ cell_running: false, calls: [], cell_age_ms: null, cell_budget_s: MAX_FEED_SECONDS });
		} finally {
			await kernel.shutdown();
			cleanup();
		}
	});

	it("carries the bound and the label a call declared for itself", async () => {
		const { kernel, ctx, cleanup } = await harness();
		try {
			// `bash_host` declares both: its `timeout` and its command's first line. This is the pair a
			// reader needs — an hour inside a call that promised two minutes is not the same fact as an
			// hour inside a call that promised nothing.
			const cell = kernel.execute({ code: 'r = await bash("sleep 9; echo never", timeout=2)' }, undefined, ctx);
			await Bun.sleep(300);
			const during = kernel.activity();
			const call = during.calls.find((entry) => entry.name === "bash_host");
			expect(call).toBeDefined();
			expect(call!.timeout_s).toBe(2);
			expect(call!.detail).toContain("sleep 9");
			expect(call!.age_ms).toBeLessThan(2_000);
			await cell;
		} finally {
			await kernel.shutdown();
			cleanup();
		}
	});

	it("never counts a synchronous return, and orders concurrent calls oldest first", async () => {
		const first = gate();
		const second = gate();
		const { kernel, ctx, cleanup } = await harness({
			first: () => first.held,
			second: () => second.held,
			quick: () => ({ ok: true }),
		});
		try {
			// `asyncio.gather` is monty 1.0's way to hold two host calls at once (`create_task` and
			// `wait_for` do not exist in its subset), and the cell calling `quick` alongside them is what
			// makes the sync case a *during* comparison rather than an accident of ordering.
			const cell = kernel.execute(
				{ code: "import asyncio\nawait asyncio.gather(quick(), first(), second())\nprint('done')" },
				undefined,
				ctx,
			);
			await Bun.sleep(400);
			const during = kernel.activity();
			expect(during.cell_running).toBe(true);
			// Oldest first: the oldest is the one that may be stuck, and `quick` — which returned a plain
			// object, so monty never registered a future for it — is not a call anyone is waiting on.
			expect(during.calls.map((call) => call.name)).toEqual(["first", "second"]);
			first.open();
			second.open();
			await cell;
		} finally {
			await kernel.shutdown();
			cleanup();
		}
	});

	it("keeps a declaration when a guard wraps the surface (rlm-stop, found live 2026-10-09)", async () => {
		guarded.length = 0;
		const { kernel, ctx, cleanup } = await harness({}, true);
		try {
			const cell = kernel.execute({ code: 'r = await bash("sleep 3; echo never", timeout=1)' }, undefined, ctx);
			await Bun.sleep(300);
			const during = kernel.activity();
			const call = during.calls.find((entry) => entry.name === "bash_host");
			expect(call).toBeDefined();
			// The declaration is read from the call's own arguments by the counter, so an `async` prologue
			// in between (the guard's) cannot swallow it. Before that change these were `null`/undefined,
			// and only in a session with a guard — which is every manifest-loaded session.
			expect(call!.timeout_s).toBe(1);
			expect(call!.detail).toContain("sleep 3");
			// And the guard really is in the path: without this the test would pass for the wrong reason.
			expect(guarded).toContain("bash_host");
			await cell;
		} finally {
			await kernel.shutdown();
			cleanup();
		}
	});

	it("sees a cell that makes no host call at all, through its own age", async () => {
		const { kernel, ctx, cleanup } = await harness();
		try {
			// A pure spin: no host call, no sleep — the shape neither `calls` nor the suspension budget
			// can see (05 measured it burning 99.8 % CPU while `activity()` said nothing).
			const code = ["import time", "t = time.time()", "x = 0", "while time.time() - t < 1.5:", "    x += 1", 'print("spun")'].join(
				"\n",
			);
			const cell = kernel.execute({ code }, undefined, ctx);
			await new Promise((resolve) => setTimeout(resolve, 400));
			const during = kernel.activity();
			expect(during.cell_running).toBe(true);
			expect(during.calls).toEqual([]);
			expect(during.cell_age_ms ?? 0).toBeGreaterThan(100);
			expect(during.cell_budget_s).toBe(MAX_FEED_SECONDS);
			await cell;
			// Between cells and after shutdown it is `null`, like the call list: absent is not idle.
			expect(kernel.activity().cell_age_ms).toBeNull();
		} finally {
			await cleanup();
		}
	});

	it("is empty again after shutdown, and does not throw", async () => {
		const { kernel, cleanup } = await harness();
		try {
			await kernel.shutdown();
			expect(kernel.activity()).toEqual({ cell_running: false, calls: [], cell_age_ms: null, cell_budget_s: MAX_FEED_SECONDS });
		} finally {
			cleanup();
		}
	});
});
