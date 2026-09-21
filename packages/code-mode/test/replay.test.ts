/**
 * The replay path, driven through a real kernel — the two behaviours ticket 04's Q1 decided:
 * a code-mode-only resume replays **its own journal** (provenance falls back to the trivial
 * rule when no contributor answers), and a cell that names something the kernel does not have
 * stops the rebuild, says which cell and which name, and **never dumps the partial kernel**.
 *
 * The journal is written by hand here because that is exactly what a pre-split session's
 * journal is: records the split's code did not produce, with a host call from a name code mode
 * does not own. `MONTY_BIN` is needed, as for the other real-kernel tests.
 */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_HOST_FNS, createLedger } from "../src/contract";
import { appendJournal, type CellRecord } from "../src/journal";
import { createKernel } from "../src/kernel";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) {
	console.warn("skipping the real-kernel tests: no runnable monty worker — set MONTY_BIN (see README.md)");
}

function harness() {
	const dir = mkdtempSync(join(tmpdir(), "cm-replay-"));
	const sessionFile = join(dir, "resume.jsonl");
	writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "", cwd: dir })}\n`);
	const pi = { appendEntry: () => {}, sendMessage: () => {} };
	const ctx = {
		cwd: dir,
		sessionManager: { getSessionFile: () => sessionFile, getEntries: () => [] },
	};
	const kernel = () =>
		createKernel({
			pi,
			sessionKey: sessionFile,
			ledger: createLedger({
				reserved: [...BASE_HOST_FNS],
				base: { description: BASE_DESCRIPTION, snippet: BASE_SNIPPET, guidelines: BASE_GUIDELINES },
			}),
		});
	const cell = (index: number, code: string, hostCalls: CellRecord["hostCalls"] = []): CellRecord => ({
		index,
		code,
		hostCalls,
		durationMs: 1,
		at: new Date(0).toISOString(),
	});
	return {
		dir,
		sessionFile,
		ctx,
		kernel,
		cell,
		journal: sessionFile + ".rlm-journal.jsonl",
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

function textOf(result: unknown): string {
	const parts = (result as { content?: Array<{ text?: string }> })?.content ?? [];
	return parts.map((part) => part.text ?? "").join("");
}

describe.skipIf(!montyReady)("replaying a session's own journal with no contributor (ticket 04, Q1)", () => {
	it("rebuilds the state a journaled cell defined, and says it did", async () => {
		const h = harness();
		try {
			appendJournal(h.journal, h.cell(0, "x = 41"));
			const kernel = h.kernel();
			const result = await kernel.execute({ code: "print(x + 1)" }, undefined, h.ctx);
			const text = textOf(result);
			expect(text).toContain("# kernel ");
			expect(text).toContain("42");
			await kernel.shutdown();
		} finally {
			h.cleanup();
		}
	});

	it("stops at a name it does not have, names the cell, and writes no dump", async () => {
		const h = harness();
		try {
			appendJournal(h.journal, h.cell(0, "y = 1"));
			appendJournal(
				h.journal,
				h.cell(1, 'h = await rlm.spawn(name="probe", prompt="hi")', [
					{ name: "rlm_spawn", args: ["hi", "probe"], result: { child_id: "child-1" } },
				]),
			);
			const kernel = h.kernel();
			const text = textOf(await kernel.execute({ code: "print(\"after\")" }, undefined, h.ctx));
			expect(text).toContain("partially rebuilt");
			expect(text).toContain("NameError: name 'rlm' is not defined");
			expect(text).toContain("cell 1");
			// The guard that matters: a kernel rebuilt only in part is never frozen into a dump.
			await kernel.shutdown();
			expect(existsSync(h.sessionFile + ".rlm-dump.bin")).toBe(false);
		} finally {
			h.cleanup();
		}
	});
});
