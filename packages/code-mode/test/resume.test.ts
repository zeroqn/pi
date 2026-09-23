/**
 * Resume: a dump must never wedge the session it is restored into.
 *
 * Two defects are pinned here, both found by resuming a session whose dump was written while a
 * cell was still in flight (`session.dump()` on a *suspended* monty session):
 *
 *   1. `loadSession` refuses such a dump **and poisons the session it was attempted on** (monty's
 *      `failedLoad` releases the worker). The journal fallback then fed that same corpse, so the
 *      error escaped `startKernel` — and since `ensureKernel` caches `starting`, every later
 *      `python` call rejected with `this dump is a suspended snapshot — use loadSnapshot() to
 *      resume it` until pi restarted.
 *   2. Nothing stopped that dump from being written in the first place.
 *
 * The third test pins the retry: a failed start must not be cached, or one transient failure costs
 * the whole session.
 */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE_HOST_FNS, createLedger } from "../src/contract";
import { createKernel } from "../src/kernel";
import { loadMonty } from "../src/monty";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) {
	console.warn("skipping the real-kernel tests: no runnable monty worker — set MONTY_BIN (see README.md)");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function textOf(result: unknown): string {
	const parts = (result as { content?: Array<{ text?: string }> })?.content ?? [];
	return parts.map((part) => part.text ?? "").join("");
}

/** A session file, so the journal, dump and scratch all get real paths beside it. */
function sessionFileIn(dir: string, id: string): string {
	const sessionFile = join(dir, `${id}.jsonl`);
	writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id, timestamp: "", cwd: dir })}\n`);
	return sessionFile;
}

function mountKernel(dir: string, sessionFile: string) {
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
	// `ping` is the kernel's cheapest suspension; `slow` keeps a cell suspended long enough to
	// quit on top of it, which is the only way a dump can catch a session mid-feed.
	ledger.accept({
		owner: "probe",
		hostFns: {
			ping: async () => ({ ok: true }),
			slow: async () => {
				await sleep(600);
				return 1;
			},
		},
	});
	return { entries, ctx, kernel: createKernel({ pi, sessionKey: sessionFile, ledger }) };
}

/** Never throws: an `execute` that rejects is a result here, because rejecting is the symptom. */
async function attempt(kernel: ReturnType<typeof mountKernel>["kernel"], ctx: unknown, code: string) {
	try {
		return { text: textOf(await kernel.execute({ code }, undefined, ctx)) };
	} catch (error) {
		return { threw: error instanceof Error ? error.message : String(error) };
	}
}

/** The bytes a dump taken mid-cell used to leave behind: a suspended snapshot, never resumed. */
async function suspendedDump(): Promise<Uint8Array> {
	const monty = await loadMonty();
	const pool = await monty.Monty.create();
	const session = await pool.checkout({});
	try {
		await session.feedStart("value = 1\nawait ping()", { externalLookup: { ping: async () => 1 } });
		return (await session.dump()) as Uint8Array;
	} finally {
		try {
			await session.close();
		} catch {
			/* the pool releases the worker either way */
		}
		await pool.close();
	}
}

describe.skipIf(!montyReady)("resume", () => {
	it("never writes a dump for a cell that is still in flight", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cm-resume-"));
		const sessionFile = sessionFileIn(dir, "midcell");
		try {
			const a = mountKernel(dir, sessionFile);
			await a.kernel.startSession(a.ctx);
			await a.kernel.execute({ code: "kept = 41\nprint(kept)" }, undefined, a.ctx);
			await a.kernel.endTurn();
			const clean = readFileSync(`${sessionFile}.rlm-dump.bin.json`, "utf8");

			// Quitting (or `/resume`, or Ctrl-C) on top of a running cell: `session_shutdown`
			// dumps whatever the kernel holds, and mid-cell that is a suspended session.
			const inflight = a.kernel.execute({ code: "print('two')\nawait slow()" }, undefined, a.ctx);
			await sleep(300);
			await a.kernel.shutdown();
			await inflight.catch(() => {});

			expect(existsSync(`${sessionFile}.rlm-dump.bin`)).toBe(true);
			expect(readFileSync(`${sessionFile}.rlm-dump.bin.json`, "utf8")).toBe(clean);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("recovers from a dump that is a suspended snapshot", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cm-resume-"));
		const sessionFile = sessionFileIn(dir, "suspended");
		try {
			const a = mountKernel(dir, sessionFile);
			await a.kernel.startSession(a.ctx);
			await a.kernel.execute({ code: "kept = 41\nprint(kept)" }, undefined, a.ctx);
			await a.kernel.shutdown();

			// Plant what the guard above now prevents: a suspended snapshot under a sidecar whose
			// `cells` matches the journal, so the fast path accepts it and monty then refuses it.
			writeFileSync(`${sessionFile}.rlm-dump.bin`, await suspendedDump());

			const b = mountKernel(dir, sessionFile);
			await b.kernel.startSession(b.ctx);
			const first = await attempt(b.kernel, b.ctx, "1+1");
			const second = await attempt(b.kernel, b.ctx, "2+2");

			expect(first.threw).toBeUndefined();
			expect(first.text).toContain("replayed 1 cells");
			// The defect's signature: the *second* cell must not rethrow the first failure.
			expect(second.threw).toBeUndefined();
			expect(second.text).toContain("# => 4");
			expect(b.entries.filter((entry) => entry.type === "rlm-dump")).toHaveLength(1);
			await b.kernel.shutdown();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not cache a failed start", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cm-resume-"));
		const sessionFile = sessionFileIn(dir, "blocked");
		try {
			// A *file* where the kernel's scratch directory belongs: `mkdirSync` throws EEXIST, so
			// `startKernel` fails for a reason that has nothing to do with the dump.
			writeFileSync(`${sessionFile}.scratch`, "not a directory");
			const a = mountKernel(dir, sessionFile);
			await a.kernel.startSession(a.ctx);
			const blocked = await attempt(a.kernel, a.ctx, "1+1");
			expect(blocked.threw).toBeDefined();

			rmSync(`${sessionFile}.scratch`, { force: true });
			const retried = await attempt(a.kernel, a.ctx, "1+1");
			expect(retried.threw).toBeUndefined();
			expect(retried.text).toContain("# => 2");
			await a.kernel.shutdown();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
