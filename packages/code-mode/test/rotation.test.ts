/**
 * Rotation, driven at 100 suspensions instead of 100 000.
 *
 * The acceptance run crosses the reserve for real (`rlm-rotation {"outcome":"ok","at":90000}`, in
 * seconds, with a fast host function), and kernel-budget's ticket 03 settled that the limit is a
 * constant with no environment override. What a twenty-minute run cannot do is assert the
 * rotation's *outcomes* cheaply — which is what these two tests are for: `createKernel`'s `limits`
 * option is a test seam (production passes nothing, and `rotateAtFor` is the same derivation the
 * constant is built from, so a retune of the reserve moves both).
 *
 * **A rotation must land on a suspension that can be dumped.** A `FutureSnapshot` — every sandbox
 * task blocked on an async host call — cannot be restored by `loadSnapshot`: its pending promises
 * lived in the old worker, so the resumed session's next call died on
 * `worker reported unknown pending call id N`. The kernel therefore rotates at the first suspension
 * *at or past* the reserve that it can prove leaves no host promise outstanding, so the reserve is a
 * floor rather than an exact landing point.
 *
 * Skipping `FutureSnapshot` alone is not enough, which is what the last two tests pin: a
 * *concurrent* cell suspends on one task's host call while another task's promise is still in
 * flight, and that suspension is a plain `FunctionSnapshot`. Whether the chain is clean is decided
 * by `newHostChain` in `kernel.ts`; here it is only observable as *where* the rotation fired.
 * The first two tests run the sequential crossing (trigger, then survival); the last two run the
 * concurrent one (the deferral, then every reserve phase it can land on).
 */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_HOST_FNS, createLedger } from "../src/contract";
import { createKernel, rotateAtFor } from "../src/kernel";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) {
	console.warn("skipping the real-kernel tests: no runnable monty worker — set MONTY_BIN (see README.md)");
}

const LIMIT = 100;
const RESERVE = rotateAtFor(LIMIT);
/** One call more than the reserve, so the rotation lands with the cell still running. */
const CALLS = RESERVE + 5;

function textOf(result: unknown): string {
	const parts = (result as { content?: Array<{ text?: string }> })?.content ?? [];
	return parts.map((part) => part.text ?? "").join("");
}

async function crossTheReserve(limit = LIMIT, calls = CALLS) {
	const dir = mkdtempSync(join(tmpdir(), "cm-rotation-"));
	const sessionFile = join(dir, "rotation.jsonl");
	writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "", cwd: dir })}\n`);
	const entries: Array<{ type: string; data: any }> = [];
	const pi = {
		appendEntry: (type: string, data: unknown) => entries.push({ type, data }),
		sendMessage: () => {},
	};
	const ctx = { cwd: dir, sessionManager: { getSessionFile: () => sessionFile, getEntries: () => [] } };
	const ledger = createLedger({
		reserved: [...BASE_HOST_FNS],
		base: { description: BASE_DESCRIPTION, snippet: BASE_SNIPPET, guidelines: BASE_GUIDELINES },
	});
	// A contributed host function: the kernel's own cheap suspension, so the reserve is crossed in
	// milliseconds rather than in 90 000 process spawns.
	ledger.accept({ owner: "probe", hostFns: { ping: async () => ({ ok: true }) } });
	const kernel = createKernel({ pi, sessionKey: sessionFile, ledger, limits: { maxSuspensions: limit } });
	const code = `before = "kept"\nfor i in range(${calls}):\n    await ping()\nprint("done", i)\nprint("before", before)\nprint("root", len(ROOT) > 0)`;
	const text = textOf(await kernel.execute({ code }, undefined, ctx));
	await kernel.shutdown();
	return { text, rotations: entries.filter((entry) => entry.type === "rlm-rotation").map((entry) => entry.data), dir };
}

/**
 * The crossing for a **concurrent** cell. `asyncio.gather` puts two host calls in flight at once,
 * so the cycle suspends `FunctionSnapshot -> FunctionSnapshot -> FutureSnapshot`: the middle one is
 * a plain suspension that still has the *first* task's promise outstanding. Rotating there is what
 * the `FutureSnapshot` guard alone let through, and the resumed session died on it.
 *
 * `limit` decides which of the three phases the reserve lands on, which is why the tests below
 * sweep it: 99/103/106 used to break the cell, 100/104/107 were lucky.
 */
async function crossTheReserveConcurrently(limit: number) {
	const dir = mkdtempSync(join(tmpdir(), "cm-concurrent-"));
	const sessionFile = join(dir, "rotation.jsonl");
	writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "", cwd: dir })}\n`);
	const entries: Array<{ type: string; data: any }> = [];
	const pi = {
		appendEntry: (type: string, data: unknown) => entries.push({ type, data }),
		sendMessage: () => {},
	};
	const ctx = { cwd: dir, sessionManager: { getSessionFile: () => sessionFile, getEntries: () => [] } };
	const ledger = createLedger({
		reserved: [...BASE_HOST_FNS],
		base: { description: BASE_DESCRIPTION, snippet: BASE_SNIPPET, guidelines: BASE_GUIDELINES },
	});
	ledger.accept({ owner: "probe", hostFns: { ping: async () => ({ ok: true }) } });
	const kernel = createKernel({ pi, sessionKey: sessionFile, ledger, limits: { maxSuspensions: limit } });
	const code = `import asyncio\nfor i in range(45):\n    await asyncio.gather(ping(), ping())\nprint("done", i)`;
	const text = textOf(await kernel.execute({ code }, undefined, ctx));
	// A kernel left poisoned by a bad rotation fails this one too, with the same error text.
	const next = textOf(await kernel.execute({ code: "1+1" }, undefined, ctx));
	await kernel.shutdown();
	return {
		text,
		next,
		rotations: entries.filter((entry) => entry.type === "rlm-rotation").map((entry) => entry.data),
		dir,
	};
}

describe("rotateAtFor", () => {
	it("is the same derivation for any limit, including the real one", () => {
		expect(rotateAtFor(100_000)).toBe(90_000);
		expect(rotateAtFor(100)).toBe(90);
		expect(rotateAtFor(10)).toBe(9);
	});
});

describe.skipIf(!montyReady)("a cell that crosses the reserve", () => {
	it("rotates at the reserve, or the first dumpable suspension past it", async () => {
		const { text, rotations, dir } = await crossTheReserve();
		try {
			// This workload is long enough to cross the reserve twice, so the count is a lower
			// bound; what matters is that every attempt succeeded and that the trigger is never
			// below the reserve. The first suspension at the reserve is a FutureSnapshot (async
			// host call), so the first rotation defers to the next suspension.
			expect(rotations.length).toBeGreaterThanOrEqual(1);
			expect(rotations.every((rotation) => rotation.outcome === "ok")).toBe(true);
			expect(rotations[0].at).toBeGreaterThanOrEqual(RESERVE);
			expect(text).toMatch(/kernel reclaimed mid-cell \(\d+x\); nothing was lost\./);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps the cell running after the rotation", async () => {
		const { text, dir } = await crossTheReserve();
		try {
			expect(text).toContain("done 94");
			expect(text).toContain("before kept");
			expect(text).toContain("root True");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("defers past a suspension another task's promise makes unsafe", async () => {
		// Reserve 89 is the *middle* suspension of a gather cycle: the first task's promise is
		// still undelivered, so the chain cannot prove itself clean. 90 is the `resolveFutures`
		// pass, and 91 is the first suspension that is safe.
		const { text, next, rotations, dir } = await crossTheReserveConcurrently(99);
		try {
			expect(text).toContain("done 44");
			expect(rotations.length).toBeGreaterThanOrEqual(1);
			expect(rotations.every((rotation) => rotation.outcome === "ok")).toBe(true);
			expect(rotations[0].at).toBe(91);
			expect(next).toContain("# => 2");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("survives every reserve phase a concurrent cell can land on", async () => {
		// Before the chain accounting these three killed the cell (and then every cell after it,
		// on `worker reported unknown pending call id N`); 100/104/107 were the safe phases.
		for (const limit of [99, 103, 106]) {
			const { text, next, dir } = await crossTheReserveConcurrently(limit);
			try {
				expect(text).toContain("done 44");
				expect(next).toContain("# => 2");
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		}
	});
});
