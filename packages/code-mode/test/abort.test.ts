/**
 * The abort gate (rlm-wait ticket 06): pi hands the tool a `signal`, code mode stops dropping it,
 * and an aborted turn ends the cell instead of letting it wait out whatever it was waiting for.
 *
 * Two halves, for the same reason `prelude.test.ts` has two: the gate's own semantics are cheap and
 * need no worker, and the *cell's* behaviour — a `KeyboardInterrupt` the cell can only swallow with
 * `BaseException`, a namespace that survives, and a journal that does not record the aborted cell —
 * is only true if monty really raises it.
 *
 * `.scratch/long-work/issues/01-the-aborts-kill.md` split the old single rule in two, and this file
 * carries both halves: a **spawning** call (`bash`, `find`, `grep`) is killed, group and all — which is
 * `run()`'s own business, so it is tested against `run()` directly, by pid — while a **promise** (a
 * join, a child, a background handle) is still *abandoned, not cancelled*, exactly as before.
 *
 *   MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty bun test
 */
import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BASE_HOST_FNS, REGISTRY_KEY, type RegistryEntry, createLedger } from "../src/contract";
import codeMode from "../index";
import { abortable } from "../src/host";
import { run } from "../src/output";
import { createKernel } from "../src/kernel";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const workerPath = process.env.MONTY_BIN && existsSync(process.env.MONTY_BIN) ? process.env.MONTY_BIN : null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) console.warn("skipping the real-kernel abort tests: no runnable monty worker — set MONTY_BIN");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("abortable", () => {
	it("returns the surface unchanged when the call carried no signal", () => {
		const host = { ping: async () => 1 };
		expect(abortable(host, undefined)).toBe(host);
	});

	it("refuses a call offered after the abort, naming the function", async () => {
		const controller = new AbortController();
		controller.abort();
		const host = abortable({ ping: async () => 1 }, controller.signal);
		const error = await host.ping!().then(
			() => null,
			(thrown: Error) => thrown,
		);
		expect(error?.name).toBe("KeyboardInterrupt");
		expect(error?.message).toContain("this cell was aborted");
		expect(error?.message).toContain("ping");
	});

	it("rejects a call already in flight, and leaves a promise-shaped call abandoned — not cancelled", async () => {
		const controller = new AbortController();
		let finished = false;
		const host = abortable(
			{
				slow: async () => {
					await sleep(50);
					finished = true;
					return "late";
				},
			},
			controller.signal,
		);
		const call = host.slow!();
		await sleep(5);
		controller.abort();
		const error = await call.then(
			() => null,
			(thrown: Error) => thrown,
		);
		expect(error?.name).toBe("KeyboardInterrupt");
		expect(error?.message).toBe("aborted while waiting for slow(...)");
		// A *promise* keeps the old rule (rlm-wait ticket 06): it is abandoned, not cancelled, and runs
		// to its end unwatched. Only a call that spawns a process is killed — the half below.
		await sleep(80);
		expect(finished).toBe(true);
	});

	it("keeps every function's name, because monty binds by it", () => {
		const host = abortable({ ping: async () => 1, grep: async () => 2 }, new AbortController().signal);
		expect(Object.keys(host).sort()).toEqual(["grep", "ping"]);
		for (const [name, fn] of Object.entries(host)) expect(fn.name).toBe(name);
	});
});

async function kernelWithHangingPing(limit?: number) {
	const dir = mkdtempSync(join(tmpdir(), "cm-abort-"));
	const sessionFile = join(dir, "abort.jsonl");
	writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "", cwd: dir })}\n`);
	const pi = { appendEntry: () => {}, sendMessage: () => {} };
	const ctx = { cwd: dir, sessionManager: { getSessionFile: () => sessionFile, getEntries: () => [] } };
	const ledger = createLedger({
		reserved: [...BASE_HOST_FNS],
		base: { description: BASE_DESCRIPTION, snippet: BASE_SNIPPET, guidelines: BASE_GUIDELINES },
	});
	// A host call that never answers on its own: the cell is aborted while it waits. `state.inFlight`
	// is how the test knows the call is really on the wire, rather than guessing with a sleep long
	// enough to cover monty's worker starting.
	const state = { inFlight: false };
	ledger.accept({
		owner: "probe",
		hostFns: {
			hang: () => {
				state.inFlight = true;
				return new Promise(() => {});
			},
		},
	});
	const kernel = createKernel({ pi, sessionKey: sessionFile, ledger, ...(limit ? { limits: { maxSuspensions: limit } } : {}) });
	return { dir, sessionFile, ctx, kernel, state };
}

/** Aborts once the cell's host call is on the wire, so the case is in-flight rather than a race. */
async function abortWhileWaiting(controller: AbortController, state: { inFlight: boolean }) {
	for (let waited = 0; waited < 200 && !state.inFlight; waited += 10) await sleep(10);
	controller.abort();
}

function textOf(result: any): string {
	return ((result?.content ?? []) as Array<{ text?: string }>).map((part) => part.text ?? "").join("");
}

describe.skipIf(!montyReady)("a cell aborted at a host call", () => {
	it("ends in a KeyboardInterrupt naming the call, marks the result failed, and is not journaled", async () => {
		const { dir, sessionFile, ctx, kernel, state } = await kernelWithHangingPing();
		try {
			const controller = new AbortController();
			const running = kernel.execute(
				{ code: 'kept = "survives"\nprint("before")\nawait hang()\nprint("never")' },
				undefined,
				ctx,
				controller.signal,
			);
			await abortWhileWaiting(controller, state);
			const result: any = await running;
			const text = textOf(result);
			expect(text).toContain("KeyboardInterrupt");
			expect(text).toContain("aborted while waiting for hang(...)");
			expect(text).not.toContain("never");
			expect(result.details.failed).toBe(true);
			// The aborted cell is a failed cell, and a failed cell is not journaled (`kernel.ts`,
			// `if (!failure) journalCell(...)`): a replay of this session must not reproduce it.
			const journal = `${sessionFile}.rlm-journal.jsonl`;
			expect(existsSync(journal) ? readFileSync(journal, "utf8").trim() : "").toBe("");

			// The kernel survives the abort, namespace and all.
			const next = textOf(await kernel.execute({ code: 'print("kept", kept)' }, undefined, ctx));
			expect(next).toContain("kept survives");
		} finally {
			await kernel.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses every later host call in that cell, so only a BaseException can continue", async () => {
		const { dir, ctx, kernel, state } = await kernelWithHangingPing();
		try {
			const controller = new AbortController();
			const code = [
				'first = None\ntry:\n    await hang()\nexcept Exception as e:\n    first = "Exception"\nexcept BaseException as e:\n    first = type(e).__name__',
				'print("first", first)',
				'second = None\ntry:\n    await hang()\nexcept BaseException as e:\n    second = type(e).__name__',
				'print("second", second)',
			].join("\n");
			const running = kernel.execute({ code }, undefined, ctx, controller.signal);
			await abortWhileWaiting(controller, state);
			const text = textOf(await running);
			// `except Exception` must not catch it -- that is what makes the abort an ending rather than
			// a signal -- and the call it makes afterwards is refused with the same exception.
			expect(text).toContain("first KeyboardInterrupt");
			expect(text).toContain("second KeyboardInterrupt");
		} finally {
			await kernel.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("leaves a background handle started before the abort usable after it", async () => {
		const { dir, ctx, kernel, state } = await kernelWithHangingPing();
		try {
			const controller = new AbortController();
			const code = 'h = await bash("sleep 30", background=True)\nprint("started", h["id"])\nawait hang()';
			const running = kernel.execute({ code }, undefined, ctx, controller.signal);
			await abortWhileWaiting(controller, state);
			await sleep(50);
			await running;
			const text = textOf(await kernel.execute({ code: 'rows = await bg_list()\nprint("handles", len(rows))\nawait bg_kill(rows[0]["id"])' }, undefined, ctx));
			expect(text).toContain("handles 1");
		} finally {
			await kernel.shutdown();
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

/**
 * The last link: the *tool*, not `kernel.execute`. `test/lifecycle.test.ts` drives the kernel handle
 * directly, which is right for what it tests and skips exactly the line this map added — pi's third
 * tool argument reaching `kernel.execute`. Driven through the registry entry the way pi mounts it, so
 * a refactor that drops the argument again fails here rather than in a session.
 */
describe.skipIf(!montyReady)("the python tool's own wiring", () => {
	it("hands pi's signal to the kernel, so an abort reaches the cell", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cm-abort-tool-"));
		const sessionFile = join(dir, "wiring.jsonl");
		writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "w", timestamp: "", cwd: dir })}\n`);
		const glob = globalThis as Record<symbol, unknown>;
		const saved = glob[REGISTRY_KEY];
		delete glob[REGISTRY_KEY];
		try {
			let registered: any = null;
			const ctx = { cwd: dir, sessionManager: { getSessionFile: () => sessionFile, getEntries: () => [] } };
			const pi = {
				registerTool: (tool: unknown) => {
					registered = tool;
				},
				setActiveTools() {},
				getActiveTools: () => ["python"],
				getAllTools: () => [],
				on() {},
				appendEntry() {},
				sendMessage() {},
			};
			codeMode(pi as never);
			const entry = glob[REGISTRY_KEY] as RegistryEntry;
			const handle: any = entry.mount(pi as never, ctx);
			for (let waited = 0; waited < 200 && !registered; waited += 10) await sleep(10);
			expect(registered?.name).toBe("python");

			const controller = new AbortController();
			const running = registered.execute(
				"call-1",
				{ code: 'kept = 7\nprint("before")\nawait bash("sleep 3")' },
				controller.signal,
				undefined,
				ctx,
			);
			await sleep(600);
			controller.abort();
			const text = textOf(await running);
			expect(text).toContain("KeyboardInterrupt");
			// The name is the *host function* the prelude's `bash()` awaits — the gate sits on the host
			// surface, which is the only place a call can be refused, and the traceback above it names
			// the prelude frame that called it.
			expect(text).toContain("aborted while waiting for bash_host(...)");
			expect(text).toContain("bash_host(command, timeout, background)");
			// The kernel survives the abort and keeps what was bound before it.
			expect(textOf(await registered.execute("call-2", { code: "print('kept', kept)" }, undefined, undefined, ctx))).toContain(
				"kept 7",
			);
			await handle.kernel.shutdown();
		} finally {
			if (saved === undefined) delete glob[REGISTRY_KEY];
			else glob[REGISTRY_KEY] = saved;
			rmSync(dir, { recursive: true, force: true });
		}
	});
});


/**
 * The other half of the split (`.scratch/long-work/issues/01-the-aborts-kill.md`): a foreground call
 * that *spawns* is turn-owned, and the run's abort kills its process group. Driven against `run()`
 * rather than through a cell, because the kill is a property of the process — and measured by pid,
 * because a record that says the work ended while the process lives is not a pass.
 */
describe("run() and the run's signal", () => {
	const alive = (pid: number) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	};
	async function pidFrom(file: string): Promise<number> {
		for (let waited = 0; waited < 300; waited += 10) {
			try {
				const pid = Number(readFileSync(file, "utf8").trim());
				if (Number.isFinite(pid) && pid > 0) return pid;
			} catch {
				/* not written yet */
			}
			await sleep(10);
		}
		return 0;
	}

	it("kills the shell and its child at the abort, and reports killed", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cm-run-kill-"));
		const pidFile = join(dir, "pids");
		try {
			const controller = new AbortController();
			// The shell records its own pid and its background child's, then waits: two processes in
			// one group, which is the shape the incident left behind.
			const running = run("bash", ["-lc", `echo $$ >> ${pidFile}; sleep 30 & echo $! >> ${pidFile}; wait`], {
				signal: controller.signal,
			});
			// Wait for both lines: the shell's pid, then its child's.
			let lines: string[] = [];
			for (let waited = 0; waited < 300; waited += 10) {
				try {
					lines = readFileSync(pidFile, "utf8").trim().split("\n");
				} catch {
					lines = [];
				}
				if (lines.length >= 2) break;
				await sleep(10);
			}
			const pids = lines.map(Number).filter((n) => n > 0);
			expect(pids.length).toBeGreaterThanOrEqual(2);
			for (const pid of pids) expect(alive(pid)).toBe(true);

			controller.abort();
			const result = await running;
			expect(result.killed).toBe(true);
			// The kill is a signal, so the group is reaped a moment after it is sent.
			await sleep(100);
			for (const pid of pids) expect(alive(pid)).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("does not wait for a descendant that inherited the pipe", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cm-run-pipe-"));
		const pidFile = join(dir, "gr");
		try {
			const started = Date.now();
			// The shell exits at once and leaves its child holding stdout. Without the exit-then-idle
			// rule the promise would wait for that pipe to close (`close` never fires) — the same hang
			// the abort exists to end.
			const result = await run("bash", ["-lc", `sleep 5 & echo $! >> ${pidFile}; echo started`]);
			expect(result.stdout).toContain("started");
			expect(Date.now() - started).toBeLessThan(2000);
			// Tidy the descendant the fixture deliberately left running.
			const pid = await pidFrom(pidFile);
			if (pid > 0) {
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					/* already gone */
				}
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("never spawns for a signal that was already aborted", async () => {
		const controller = new AbortController();
		controller.abort();
		const result = await run("bash", ["-lc", "echo should-not-run"], { signal: controller.signal });
		expect(result).toEqual({ stdout: "", stderr: "", exitCode: null, killed: true });
	});
});
