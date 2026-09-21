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
 * **The second test is `it.failing`, and that is a finding, not a shortcut.** Rotating does not
 * currently preserve the cell: the rotation fires, the notice lands, and then the resumed session
 * answers a stale pending call —
 *
 *     # kernel reclaimed mid-cell (1x); nothing was lost.
 *     worker reported unknown pending call id 44
 *
 * — and the cell dies there. Measured four ways, all identical: 90 calls (nothing after the
 * rotation) and 95 (work after it); a limit of 100 and of 1000; an in-process contributed host
 * function and real `bash`; and — the point that makes it *not* this split's — the same workload
 * under the pre-split code at `85d9db2`, byte-identical output. So this is a pre-existing defect in
 * a mechanism kernel-budget's map records as "loses nothing": its acceptance file holds the checks
 * and their methods, and no recorded run of this one. When rotation is fixed, this test passes and
 * bun reports it as a failure until the `it.failing` is flipped back to `it` — which is exactly the
 * prompt we want.
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

describe("rotateAtFor", () => {
	it("is the same derivation for any limit, including the real one", () => {
		expect(rotateAtFor(100_000)).toBe(90_000);
		expect(rotateAtFor(100)).toBe(90);
		expect(rotateAtFor(10)).toBe(9);
	});
});

describe.skipIf(!montyReady)("a cell that crosses the reserve", () => {
	it("rotates at exactly the reserve, and says so", async () => {
		const { text, rotations, dir } = await crossTheReserve();
		try {
			expect(rotations.length).toBe(1);
			expect(rotations[0].outcome).toBe("ok");
			expect(rotations[0].at).toBe(RESERVE);
			expect(text).toContain("kernel reclaimed mid-cell (1x); nothing was lost.");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// Expected to fail while the defect above stands; it turns into a reported failure when fixed.
	it.failing("keeps the cell running after the rotation", async () => {
		const { text, dir } = await crossTheReserve();
		try {
			expect(text).toContain("done 94");
			expect(text).toContain("before kept");
			expect(text).toContain("root True");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
