/**
 * The background lease (`.scratch/bg-lease/REPORT.md`), driven at seconds instead of an hour.
 *
 * The case: a session backgrounded a benchmark whose own script blocked in a bare `wait` behind the
 * spinner processes it had started, and nothing bounded it. A background handle is deliberately
 * untouched by an abort — that is what makes it session-owned — and `shutdownAll` runs only at
 * `session_shutdown`, so an open session with no turn coming had no way to end the shell and no notice
 * was ever due, because a notice is raised when a handle **finishes**. Eighteen hours of a machine
 * later, the fix is a bound the kernel applies itself: announce at the soft bound *while the handle
 * runs*, and kill it only if nobody grants more time in the grace that follows.
 *
 * These tests hold the **model-visible** half to account — the sentence, the countdown it names, and
 * the verdict when nobody answers — because the failure was the model's own reading of a quiet handle.
 * `background.test.ts` drives the timers directly; this one drives what the model sees.
 *
 *   MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty bun test
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BASE_HOST_FNS, createLedger } from "../src/contract";
import { LEASE_GRACE_SECONDS, SOFT_BOUND_SECONDS } from "../src/background";
import { createKernel } from "../src/kernel";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) console.warn("skipping the real-kernel lease tests: no runnable monty worker — set MONTY_BIN");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function textOf(result: unknown): string {
	const parts = (result as { content?: Array<{ text?: string }> })?.content ?? [];
	return parts.map((part) => part.text ?? "").join("");
}

async function kernelWithLease(soft: number, grace: number, entries?: any[]) {
	const dir = mkdtempSync(join(tmpdir(), "cm-lease-"));
	const sessionFile = join(dir, "lease.jsonl");
	writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "", cwd: dir })}\n`);
	// What reaches the model: the kernel raises the notice and `pi.sendMessage` is how a session with no
	// rlm listens. rlm's own dispatcher (`index.ts`) uses the same call with the same options.
	const sent: Array<{ content: string; customType?: string; options: Record<string, unknown> }> = [];
	/** What the kernel wrote to the transcript — the record a *later* session reads back (`restore`). */
	const appended: any[] = [];
	const pi = {
		appendEntry: (customType: string, data: any) => appended.push({ type: "custom", customType, data }),
		sendMessage: (message: { content?: string; customType?: string }, options: Record<string, unknown>) =>
			sent.push({ content: message?.content ?? "", customType: message?.customType, options }),
	};
	const ctx = { cwd: dir, sessionManager: { getSessionFile: () => sessionFile, getEntries: () => entries ?? [] } };
	const ledger = createLedger({
		reserved: [...BASE_HOST_FNS],
		base: { description: BASE_DESCRIPTION, snippet: BASE_SNIPPET, guidelines: BASE_GUIDELINES },
	});
	const kernel = createKernel({
		pi,
		sessionKey: sessionFile,
		ledger,
		limits: { softBoundSeconds: soft, leaseGraceSeconds: grace },
	});
	return { dir, ctx, kernel, sent, appended };
}

async function until(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await sleep(50);
	}
	throw new Error("condition not reached in time");
}

describe("the lease's constants", () => {
	it("are an hour and ten minutes, stated once", () => {
		expect(SOFT_BOUND_SECONDS).toBe(3600);
		expect(LEASE_GRACE_SECONDS).toBe(600);
	});
});

describe.skipIf(!montyReady)("a background shell with no declared bound", () => {
	it("is announced while it is still running, and a grant through the prelude keeps it alive", async () => {
		const { dir, ctx, kernel, sent } = await kernelWithLease(1, 2);
		try {
			expect(textOf(await kernel.execute({ code: 'h = await bash("sleep 30", background=True)\nprint("started", h.id)' }, undefined, ctx))).toContain("started bg-1");
			// The manager's timer raises it, not the cell: this is the notice a session with no turn
			// coming still gets, and it carries a deadline rather than imposing one.
			await until(() => sent.length === 1);
			expect(sent[0]!.content).toContain("bg-1");
			expect(sent[0]!.content).toContain("still running 1s with no declared bound");
			expect(sent[0]!.content).toContain('bg_extend("bg-1", seconds)');
			expect(sent[0]!.content).toContain("killed in 2s if you do neither");
			expect(sent[0]!.content).toContain("command: sleep 30");
			expect(sent[0]!.options).toMatchObject({ deliverAs: "steer", triggerTurn: true });
			// Still running at the moment it is announced, with the countdown readable — the two facts
			// the model needs to judge with, rather than infer.
			// `bg_poll` answers a dict, so this is the model's own reading, not an object's.
			const judged = textOf(await kernel.execute({ code: 'h2 = await bg_poll("bg-1")\nprint(h2["status"], h2["timeout_s"], h2["lease_s"])' }, undefined, ctx));
			expect(judged).toContain("running None ");
			// The grant becomes the bound, through the surface the model actually has.
			const granted = textOf(await kernel.execute({ code: 'h3 = await h.extend(30)\nprint(h3["status"], h3["timeout_s"], h3["lease_s"])' }, undefined, ctx));
			expect(granted).toContain("running 30 None");
			// Past the moment the unattended kill would have landed: it did not.
			await sleep(2500);
			expect(textOf(await kernel.execute({ code: 'print((await bg_poll("bg-1"))["status"])' }, undefined, ctx))).toContain("running");
			await kernel.execute({ code: 'await bg_kill("bg-1")' }, undefined, ctx);
		} finally {
			await kernel.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("is killed when nobody judges it, and the reason says exactly that", async () => {
		const { dir, ctx, kernel, sent } = await kernelWithLease(1, 1);
		try {
			await kernel.execute({ code: 'h = await bash("sleep 30", background=True)' }, undefined, ctx);
			await until(() => sent.length >= 1);
			// One cell does the waiting: the sandbox parks in `time.sleep`, which the feed budget does not
			// charge, and reads the outcome the way the model would.
			const settled = textOf(
				await kernel.execute(
					{
						code: [
							"import time",
							's = "running"',
							"for i in range(40):",
							'    s = (await bg_poll("bg-1"))["status"]',
							'    if s != "running":',
							"        break",
							"    time.sleep(0.2)",
							'print(s, (await bg_poll("bg-1"))["reason"])',
						].join("\n"),
					},
					undefined,
					ctx,
				),
			);
			expect(settled).toContain("killed unattended: no bound was declared and none was granted within 1s of the 1s soft bound");
			// The lease ends the handle the ordinary way, so a completion notice is raised — and *dropped*,
			// because the cell read the handle before the turn ended and the read rule withdraws it. That is
			// the whole of what the model sees: one announcement, then its own reading.
			await sleep(300);
			expect(sent.length).toBe(1);
			expect(sent[0]!.content).toContain("still running");
		} finally {
			await kernel.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("announces an orphan a previous session left running, and kills it unless it is kept", async () => {
		// The incident's own shape, one session later: the shell is still alive, its session is not, and
		// nobody is left to notice. The first kernel stands in for the session that died; the second mounts
		// on what it wrote, which is exactly what a resume does (`startSession`).
		const first = await kernelWithLease(3600, 600);
		const second = await kernelWithLease(1, 1, first.appended);
		try {
			const started = textOf(await first.kernel.execute({ code: 'h = await bash("sleep 30", background=True)\nprint(h.id, (await h.poll())["pid_start"] is not None)' }, undefined, first.ctx));
			expect(started).toContain("bg-1 True");
			const record = first.appended.find((entry) => entry.customType === "rlm-bg")?.data;
			expect(record.status).toBe("running");
			const pid = record.pid as number;
			const alive = () => {
				try {
					process.kill(pid, 0);
					return true;
				} catch {
					return false;
				}
			};
			expect(alive()).toBe(true);
			// The resume: the second kernel reads the first one's transcript entries.
			await second.kernel.startSession(second.ctx);
			// Truthfully still running — not "killed", which is what a resumed session used to report.
			expect(textOf(await second.kernel.execute({ code: 'print((await bg_poll("bg-1"))["status"])' }, undefined, second.ctx))).toContain("running");
			// Announced at once, and named as what it is.
			await until(() => second.sent.length === 1, 5000);
			expect(second.sent[0]!.content).toContain("an earlier session started this shell");
			expect(second.sent[0]!.content).toContain(`(pid ${pid})`);
			expect(second.sent[0]!.content).toContain("its output is not readable here");
			expect(second.sent[0]!.content).toContain('bg_extend("bg-1", seconds)');
			expect(second.sent[0]!.content).toContain("killed in 1s");
			// Unjudged: the process really is stopped, and the verdict names its provenance.
			await until(() => !alive(), 8000);
			const settled = textOf(await second.kernel.execute({ code: 'print((await bg_poll("bg-1"))["status"], (await bg_poll("bg-1"))["reason"])' }, undefined, second.ctx));
			expect(settled).toContain("killed unattended: an earlier session started it");
		} finally {
			await first.kernel.shutdown();
			await second.kernel.shutdown();
			rmSync(first.dir, { recursive: true, force: true });
			rmSync(second.dir, { recursive: true, force: true });
		}
	});

	it("keeps an orphan the model grants more time to", async () => {
		// The other half of the judgement: a shell the human *wanted* to survive a restart is kept by one
		// call, exactly as an undeclared one is.
		const first = await kernelWithLease(3600, 600);
		const second = await kernelWithLease(1, 1, first.appended);
		try {
			await first.kernel.execute({ code: 'h = await bash("sleep 30", background=True)' }, undefined, first.ctx);
			const record = first.appended.find((entry) => entry.customType === "rlm-bg")?.data;
			const pid = record.pid as number;
			await second.kernel.startSession(second.ctx);
			await until(() => second.sent.length === 1, 5000);
			const kept = textOf(await second.kernel.execute({ code: 'print((await bg_extend("bg-1", 30))["timeout_s"])' }, undefined, second.ctx));
			expect(kept).toContain("30");
			await sleep(2500);
			// Alive past the moment the grace would have killed it.
			expect(() => process.kill(pid, 0)).not.toThrow();
			expect(textOf(await second.kernel.execute({ code: 'print((await bg_poll("bg-1"))["status"])' }, undefined, second.ctx))).toContain("running");
		} finally {
			await first.kernel.shutdown();
			await second.kernel.shutdown();
			rmSync(first.dir, { recursive: true, force: true });
			rmSync(second.dir, { recursive: true, force: true });
		}
	});

	it("leaves a declared bound alone: no announcement, and its own hard kill", async () => {
		const { dir, ctx, kernel, sent } = await kernelWithLease(1, 1);
		try {
			await kernel.execute({ code: 'h = await bash("sleep 30", timeout=1, background=True)' }, undefined, ctx);
			await sleep(2000);
			// The caller made a promise; the lease is only for a shell that declared nothing. Its own
			// completion notice still arrives — that is the finish notice, not an announcement.
			expect(sent.filter((message) => message.content.includes("no declared bound")).length).toBe(0);
			const settled = textOf(await kernel.execute({ code: 'print((await bg_poll("bg-1"))["status"], (await bg_poll("bg-1"))["reason"])' }, undefined, ctx));
			expect(settled).toContain("timeout timed out after 1s");
		} finally {
			await kernel.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
