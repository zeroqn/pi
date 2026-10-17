/**
 * The bound a **foreground** `bash` gets when its caller declared none (2026-10-17).
 *
 * The tenth guideline said *"a foreground `bash` waits forever unless you pass `timeout=`"*, and that
 * was true: nothing else bounded the call. monty's feed budget does not reach a cell parked in a host
 * call (see `cell-clock.test.ts`, measured at 90s against a 2s budget), and the model cannot act while
 * it is blocked inside the call — so the one shape where the *automatic* answer is the only answer gets
 * `DEFAULT_FOREGROUND_SECONDS`, with two remedies in the error it produces.
 *
 * Ten minutes in production, one second here: the harness drives the seam
 * (`limits.foregroundSeconds`), the same way the lease's clocks are driven.
 *
 *   MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty bun test
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BASE_HOST_FNS, createLedger } from "../src/contract";
import { DEFAULT_FOREGROUND_SECONDS, hostDeclarers } from "../src/host";
import { createKernel } from "../src/kernel";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) console.warn("skipping the real-kernel foreground-bound tests: no runnable monty worker — set MONTY_BIN");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function textOf(result: unknown): string {
	const parts = (result as { content?: Array<{ text?: string }> })?.content ?? [];
	return parts.map((part) => part.text ?? "").join("");
}

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

async function harness(foregroundSeconds = 1) {
	const dir = mkdtempSync(join(tmpdir(), "cm-fg-"));
	const pidFile = join(dir, "call.pid");
	const sessionFile = join(dir, "fg.jsonl");
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
		limits: { foregroundSeconds, maxFeedDurationSecs: 3600 },
	});
	return { dir, ctx, kernel, pidFile, done: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("the default bound, stated once", () => {
	it("is ten minutes", () => {
		expect(DEFAULT_FOREGROUND_SECONDS).toBe(600);
	});

	it("is what the activity reader publishes for a call that declared nothing", () => {
		// The footer prints `run: <command> <age>/<bound>` (`long-work` 04), and the denominator has to be
		// the bound the call will really be killed at — an undeclared foreground call has one now.
		const declare = hostDeclarers(600).bash_host;
		expect(declare?.([{ command: "nix build", timeout: null, background: false }])?.timeout_s).toBe(600);
		expect(declare?.([{ command: "nix build", timeout: 1200, background: false }])?.timeout_s).toBe(1200);
		// A background call declares nothing here: its bound belongs to the handle (`timeout_s`/`lease_s`).
		expect(declare?.([{ command: "nix build", timeout: null, background: true }])?.timeout_s).toBeNull();
	});
});

describe.skipIf(!montyReady)("a foreground bash call that declared no timeout", () => {
	it("is killed at the default, told why, and its process group dies with it", async () => {
		const h = await harness(1);
		try {
			const started = Date.now();
			const text = textOf(
				await h.kernel.execute(
					{ code: `r = await bash("echo $$ > ${h.pidFile}; sleep 60")\nprint("exit_code:", r["exit_code"], "killed:", r["killed"])\nprint("note:", r["note"])` },
					undefined,
					h.ctx,
				),
			);
			const seconds = (Date.now() - started) / 1000;
			expect(seconds).toBeLessThan(15);
			// The call comes back *killed* with no exit code — the same shape a declared bound produces —
			// and the note is the remedy, because a model that has just lost its build needs the lesson.
			expect(text).toContain("exit_code: None killed: True");
			expect(text).toContain("1s is the default bound for a foreground bash call");
			expect(text).toContain("pass timeout=N for work you know takes longer, or run it with background=True");
			const pid = Number(readFileSync(h.pidFile, "utf8").trim());
			await until(() => !running(pid), 5000);
			expect(running(pid)).toBe(false);
		} finally {
			await h.kernel.shutdown();
			h.done();
		}
	});

	it("says nothing about a default when the caller declared the bound itself", async () => {
		const h = await harness(30);
		try {
			const text = textOf(
				await h.kernel.execute(
					{ code: `r = await bash("echo $$ > ${h.pidFile}; sleep 60", timeout=1)\nprint("killed:", r["killed"], "note:", r["note"])` },
					undefined,
					h.ctx,
				),
			);
			// The caller's own bound is the caller's own business: killed, and no note about a default.
			expect(text).toContain("killed: True note: None");
		} finally {
			await h.kernel.shutdown();
			h.done();
		}
	});

	it("is a default and not a ceiling: a declared bound is what the call gets", async () => {
		const h = await harness(1);
		try {
			// Three seconds of sleep against a one-second default: the declared bound is the one that runs,
			// which is the remedy the note above teaches and the reason the default is safe.
			const text = textOf(
				await h.kernel.execute(
					{ code: `r = await bash("sleep 3; echo survived", timeout=20)\nprint(r["stdout"].strip(), r["killed"])` },
					undefined,
					h.ctx,
				),
			);
			expect(text).toContain("survived False");
		} finally {
			await h.kernel.shutdown();
			h.done();
		}
	});
});
