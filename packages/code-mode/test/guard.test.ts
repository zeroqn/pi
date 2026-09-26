/**
 * The session's policy for a host call, and for the cwd mount's mode (`readonly-guard` ticket 02).
 *
 * Two halves. The **rules** are tested with no monty at all — the ledger's single-owner slot, what a
 * malformed guard does, and the gate itself, which is a function of two arguments. The **kernel** half
 * runs real monty and asserts the three things a rule cannot: a refusal is a Python `PermissionError`
 * in the sandbox, the callee never runs, and the refusal reaches the journal so a replay raises it
 * rather than re-running the call.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import codeMode from "../index";
import {
	API_VERSION,
	BASE_HOST_FNS,
	REGISTRY_KEY,
	createLedger,
	refusal,
	type Guard,
	type RegistryEntry,
} from "../src/contract";
import { guarded, makeHost } from "../src/host";
import { hostCallError } from "../src/journal";
import type { Kernel } from "../src/kernel";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) {
	console.warn("skipping the live guard tests: no runnable monty worker — set MONTY_BIN (see README.md)");
}
const maybe = montyReady ? it : it.skip;

const BASE = { description: "d", snippet: "s", guidelines: [] as string[] };

function ledger() {
	return createLedger({ reserved: [...BASE_HOST_FNS], base: { ...BASE } });
}

// ---------------------------------------------------------------------------
// The ledger's slot: one declarer, and a malformed guard is a typo.
// ---------------------------------------------------------------------------

describe("the guard slot on a contribution", () => {
	it("is accepted, and readable back off the ledger", () => {
		const l = ledger();
		const guard: Guard = { before: () => undefined, mountMode: () => "read-only" };
		const receipt = l.accept({ owner: "readonly-mode", guard });
		expect(receipt.rejected).toEqual([]);
		expect(receipt.accepted).toContain("guard");
		expect(l.guard()).toBe(guard);
	});

	it("is absent, not undefined-and-throwing, when nobody declares one", () => {
		expect(ledger().guard()).toBeUndefined();
	});

	it("refuses a second declarer whole, in the same shape as the other single-owner slots", () => {
		const l = ledger();
		l.accept({ owner: "first", guard: { before: () => undefined } });
		const receipt = l.accept({ owner: "second", guard: { before: () => undefined } });
		expect(receipt.accepted).toEqual([]);
		expect(receipt.rejected).toEqual([{ name: "guard", reason: "already declared by first" }]);
		expect(l.owners()).toEqual(["first"]);
	});

	it("lets an owner replace its own, so a second session_start costs nothing", () => {
		const l = ledger();
		const first: Guard = { before: () => undefined };
		const second: Guard = { mountMode: () => "read-write" };
		l.accept({ owner: "readonly-mode", guard: first });
		expect(l.accept({ owner: "readonly-mode", guard: second }).rejected).toEqual([]);
		expect(l.guard()).toBe(second);
	});

	it("refuses a guard that is not an object, and a half of one that is not a function", () => {
		for (const [guard, name, reason] of [
			["read-only", "guard", "not an object"],
			[[], "guard", "not an object"],
			[{ before: "yes" }, "guard.before", "not a function"],
			[{ mountMode: 1 }, "guard.mountMode", "not a function"],
		] as const) {
			const receipt = ledger().accept({ owner: "o", guard: guard as never });
			expect(receipt.rejected).toContainEqual({ name, reason });
		}
	});
});

// ---------------------------------------------------------------------------
// The refusal, and the round trip that makes a replay raise it.
// ---------------------------------------------------------------------------

describe("a refusal", () => {
	it("is a PermissionError by name, because monty maps a thrown error by its name", () => {
		const error = refusal("read-only mode: refusing bash_host");
		expect(error.name).toBe("PermissionError");
		expect(error.message).toBe("read-only mode: refusing bash_host");
	});

	it("journals as the same exception, so a replay raises it rather than a RuntimeError", () => {
		expect(hostCallError(refusal("read-only mode: no"))).toEqual({
			name: "PermissionError",
			message: "read-only mode: no",
		});
	});
});

// ---------------------------------------------------------------------------
// The gate: a function of the surface and the guard. No monty.
// ---------------------------------------------------------------------------

describe("the guard's gate", () => {
	const surface = { echoed: async (text: unknown) => `echo:${String(text)}` };

	it("returns the surface unchanged when no guard declares a `before`", () => {
		expect(guarded(surface)).toBe(surface);
		expect(guarded(surface, { mountMode: () => "read-only" })).toBe(surface);
	});

	it("stops the call before the callee runs, and throws the refusal", async () => {
		let ran = 0;
		const gated = guarded(
			{ echoed: async () => (ran += 1) },
			{ before: (call) => ({ allow: false, reason: `read-only mode: refusing ${call.name}` }) },
		);
		expect(gated.echoed?.("x")).rejects.toThrow("read-only mode: refusing echoed");
		expect(ran).toBe(0);
	});

	it("passes through an allow, and through no verdict at all", async () => {
		const select: Guard = { before: (call) => (call.name === "echoed" ? { allow: true } : undefined) };
		const gated = guarded(surface, select);
		expect(await gated.echoed?.("hi")).toBe("echo:hi");
	});

	it("waits for an async verdict", async () => {
		const gated = guarded(surface, { before: async () => ({ allow: false, reason: "later" }) });
		expect(gated.echoed?.("x")).rejects.toThrow("later");
	});

	it("keeps the name monty identifies a host function by", async () => {
		const gated = guarded({ find: async () => [] }, { before: () => undefined });
		expect(Object.keys(gated)).toEqual(["find"]);
		expect(gated.find?.name).toBe("find");
	});

	it("gates code mode's own base functions and a contributed one alike", async () => {
		const seen: string[] = [];
		const host = makeHost({
			root: tmpdir(),
			attachments: [],
			extra: { echoed: async () => "ran" },
			background: {} as never,
			guard: {
				before: (call) => {
					seen.push(call.name);
					return call.name === "find" ? { allow: false, reason: "read-only mode: refusing find" } : undefined;
				},
			},
		});
		expect(Object.keys(host)).toEqual(["bash_host", "find", "grep", "read_image", "echoed"]);
		// A base name the guard refuses never reaches `fd`.
		expect(host.find?.("*.ts")).rejects.toThrow("read-only mode: refusing find");
		expect(await host.echoed?.()).toBe("ran");
		expect(seen).toEqual(["find", "echoed"]);
	});

	it("pins the contract version a supplier has to check before contributing", () => {
		// An older code mode refuses `guard` as an unknown field *whole*, so a package that must be
		// obeyed reads this before contributing. `handle.apiVersion` is where it reads it.
		expect(API_VERSION).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// The kernel: a refusal the model sees, and a call that never happened.
// ---------------------------------------------------------------------------

type Handler = (event: unknown, ctx: unknown) => unknown;

function fakePi() {
	const entries: { type: string; payload: unknown }[] = [];
	const handlers = new Map<string, Handler[]>();
	return {
		entries,
		registered: [] as string[],
		registerTool(tool: { name: string }) {
			if (!this.registered.includes(tool.name)) this.registered.push(tool.name);
		},
		setActiveTools() {},
		getActiveTools: () => ["python"],
		getAllTools: () => [],
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		appendEntry(type: string, payload: unknown) {
			entries.push({ type, payload });
		},
		sendMessage() {},
		async emit(event: string, ctx: unknown) {
			for (const handler of handlers.get(event) ?? []) await handler({ type: event }, ctx);
		},
	};
}

function sessionFileIn(dir: string, id: string): string {
	const file = join(dir, `${id}.jsonl`);
	writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id, timestamp: "", cwd: dir })}\n`);
	return file;
}

function sessionCtx(dir: string, file: string) {
	const ctx = {
		cwd: dir,
		sessionManager: { getSessionFile: () => file, getEntries: () => [] },
	};
	return { ctx, file };
}

function textOf(result: unknown): string {
	const parts = (result as { content?: Array<{ text?: string }> })?.content ?? [];
	return parts.map((part) => part.text ?? "").join("");
}

function journalOf(file: string): Array<{ hostCalls: Array<{ name: string; error?: { name: string; message: string } }> }> {
	const path = `${file}.rlm-journal.jsonl`;
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

const glob = globalThis as Record<symbol, unknown>;
const saved = glob[REGISTRY_KEY];

afterAll(() => {
	if (saved === undefined) delete glob[REGISTRY_KEY];
	else glob[REGISTRY_KEY] = saved;
});

describe("a guarded kernel", () => {
	let dir: string;
	let sentinel: string;

	beforeEach(() => {
		delete glob[REGISTRY_KEY];
		dir = mkdtempSync(join(tmpdir(), "code-mode-guard-"));
		sentinel = join(dir, "sentinel");
	});

	/** A mounted kernel whose session has declared one guard, before the first cell. */
	function mounted(guard: Guard) {
		const pi = fakePi();
		codeMode(pi as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;
		const session = sessionCtx(dir, sessionFileIn(dir, "guard"));
		const handle = entry.mount(pi as never, session.ctx);
		let noted = 0;
		const receipt = handle.contribute({
			owner: "readonly-mode",
			hostFns: { noted: async () => `noted:${(noted += 1)}` },
			guard,
		});
		return { handle, session, receipt, countNoted: () => noted };
	}

	const refuse = (name: string) => ({ allow: false as const, reason: `read-only mode: refusing ${name}` });

	maybe("raises a PermissionError in the sandbox, and the refused call never runs", async () => {
		const refused = (call: { name: string }) => {
			if (call.name === "bash_host") return refuse("bash_host");
			if (call.name === "noted") return refuse("noted");
			return undefined;
		};
		const { handle, session, countNoted } = mounted({ before: refused });

		const uncaught = textOf(
			await (handle.kernel as Kernel).execute(
				{ code: `await bash("touch ${sentinel}")` },
				undefined,
				session.ctx,
			),
		);
		expect(uncaught).toContain("PermissionError");
		expect(uncaught).toContain("read-only mode: refusing bash_host");
		expect(existsSync(sentinel)).toBe(false);

		// Caught, so the cell completes and the refusal reaches the journal — which is what makes a
		// replay raise the same exception instead of running the call.
		const caught = textOf(
			await (handle.kernel as Kernel).execute(
				{ code: 'try:\n    print(await noted())\nexcept Exception as e:\n    print("caught:", e)' },
				undefined,
				session.ctx,
			),
		);
		expect(caught).toContain("caught: read-only mode: refusing noted");
		expect(countNoted()).toBe(0);
		const recorded = journalOf(session.file).flatMap((cell) => cell.hostCalls);
		expect(recorded).toHaveLength(1);
		expect(recorded[0]?.name).toBe("noted");
		expect(recorded[0]?.error).toEqual({ name: "PermissionError", message: "read-only mode: refusing noted" });
	});

	maybe("runs the same cell unchanged when an allow is answered", async () => {
		const { handle, session, countNoted } = mounted({ before: () => ({ allow: true }) });
		const text = textOf(
			await (handle.kernel as Kernel).execute(
				{ code: 'print(await noted())' },
				undefined,
				session.ctx,
			),
		);
		expect(text).toContain("noted:1");
		expect(countNoted()).toBe(1);
	});

	maybe("is exactly as it was with no guard declared", async () => {
		const pi = fakePi();
		codeMode(pi as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;
		const session = sessionCtx(dir, sessionFileIn(dir, "no-guard"));
		const handle = entry.mount(pi as never, session.ctx);
		expect(handle.contribute({ owner: "readonly-mode", guard: undefined }).rejected).toEqual([]);
		const text = textOf(
			await (handle.kernel as Kernel).execute(
				{ code: `print((await bash("echo hi"))["stdout"].strip())` },
				undefined,
				session.ctx,
			),
		);
		expect(text).toContain("hi");
	});
});

// ---------------------------------------------------------------------------
// The mount's mode, per feed: the other half of what a guard answers.
// ---------------------------------------------------------------------------

describe("a session's cwd mount", () => {
	let dir: string;
	let sentinel: string;

	beforeEach(() => {
		delete glob[REGISTRY_KEY];
		dir = mkdtempSync(join(tmpdir(), "code-mode-mount-"));
		sentinel = join(dir, "sentinel");
	});

	function session() {
		const pi = fakePi();
		codeMode(pi as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;
		const made = sessionCtx(dir, sessionFileIn(dir, "mount"));
		const handle = entry.mount(pi as never, made.ctx);
		return { handle, made };
	}

	/** One cell's answer, with `guard` contributed before the kernel starts. */
	async function cell(handle: { contribute: (c: unknown) => unknown; kernel: unknown }, made: { ctx: unknown }, code: string) {
		return textOf(await (handle.kernel as Kernel).execute({ code }, undefined, made.ctx));
	}

	maybe("is read-only when the guard says so: the write is refused and the host file never appears", async () => {
		const { handle, made } = session();
		writeFileSync(join(dir, "readable.txt"), "on disk");
		handle.contribute({ owner: "readonly-mode", guard: { mountMode: () => "read-only" } });

		const refused = await cell(handle, made, `write_text(${JSON.stringify(sentinel)}, "x")`);
		expect(refused).toContain("[Errno 30]");
		expect(refused).toContain("Read-only file system");
		expect(existsSync(sentinel)).toBe(false);

		// The same mount still reads: a read-only workspace is a workspace, not a broken one.
		expect(await cell(handle, made, `print(read_text("readable.txt").strip())`)).toContain("on disk");
	});

	maybe("is read-write with no guard at all, which is what every session had before", async () => {
		const { handle, made } = session();
		handle.contribute({ owner: "readonly-mode" });
		expect(await cell(handle, made, `write_text("written.txt", "x")`)).toContain("# => 1");
		expect(readFileSync(join(dir, "written.txt"), "utf8")).toBe("x");
	});

	maybe("follows a mode that changes between cells, and costs the kernel nothing", async () => {
		let mode: string = "read-write";
		const { handle, made } = session();
		handle.contribute({ owner: "readonly-mode", guard: { mountMode: () => mode as never } });

		// The kernel is created by this first cell, so the mode below is a *change*, not the start.
		expect(await cell(handle, made, "value = 41\nwrite_text(\"first.txt\", \"x\")")).toContain("# => 1");
		expect(existsSync(join(dir, "first.txt"))).toBe(true);

		mode = "read-only";
		const refused = await cell(handle, made, `write_text(${JSON.stringify(sentinel)}, "x")`);
		expect(refused).toContain("Read-only file system");
		expect(existsSync(sentinel)).toBe(false);
		// No rebuild, no replay: the same kernel, with everything the first cell defined.
		expect(await cell(handle, made, "print(value + 1)")).toContain("42");

		// And back again — the mode is an answer, not a state the kernel freezes on.
		mode = "read-write";
		expect(await cell(handle, made, `write_text(${JSON.stringify(sentinel)}, "x")`)).toContain("# => 1");
		expect(readFileSync(sentinel, "utf8")).toBe("x");
	});

	maybe("refuses the cell rather than downgrading when the workspace cannot be mounted that way", async () => {
		let mode: string = "read-write";
		const { handle, made } = session();
		handle.contribute({ owner: "readonly-mode", guard: { mountMode: () => mode as never } });
		expect(await cell(handle, made, "print('first')")).toContain("first");

		// An unknown mode is monty's own constructor refusing, which is the only way to reach this
		// path deterministically: it stands in for "the read-only mount could not be made".
		mode = "nonsense";
		const refused = await cell(handle, made, "print('second')");
		expect(refused).toContain("refused this cell");
		expect(refused).toContain("invalid mount mode");
		expect(refused).not.toContain("second");
	});

	maybe("fails the *start* when the first cell is the one that cannot get its mount", async () => {
		const { handle, made } = session();
		handle.contribute({ owner: "readonly-mode", guard: { mountMode: () => "nonsense" as never } });
		// A kernel that never started is the pinned "does not cache a failed start" contract, so this
		// rejects rather than answering — and the next cell is what retries.
		expect((handle.kernel as Kernel).execute({ code: "1+1" }, undefined, made.ctx)).rejects.toThrow("invalid mount mode");
	});
});

// ---------------------------------------------------------------------------
// The mode change's other half (ticket 10): a background shell is a host process, so the mount cannot
// reach it. These use a **real** shell and a **real** canary: the proof is that the file never appears,
// not that a status field says "killed".
// ---------------------------------------------------------------------------

describe("a mode change and the shells the mount cannot reach", () => {
	let dir: string;

	beforeEach(() => {
		delete glob[REGISTRY_KEY];
		dir = mkdtempSync(join(tmpdir(), "code-mode-bg-"));
	});

	/** A session whose guard answers a mode this test can flip, before the kernel starts. */
	function session(mode: string) {
		const pi = fakePi();
		codeMode(pi as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;
		const made = sessionCtx(dir, sessionFileIn(dir, "bg"));
		const handle = entry.mount(pi as never, made.ctx);
		const state = { mode };
		handle.contribute({ owner: "readonly-mode", guard: { mountMode: () => state.mode as never } });
		return { pi, handle, made, state };
	}

	const cell = async (handle: { kernel: unknown }, made: { ctx: unknown }, code: string) =>
		textOf(await (handle.kernel as Kernel).execute({ code }, undefined, made.ctx));

	const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	maybe("kills the shells a change into read-only makes unsafe, and says so", async () => {
		const { handle, made, state } = session("read-write");
		const canary = join(dir, "bg-canary");
		// A real shell on the real filesystem: the mount is irrelevant to it, which is why this exists.
		await cell(handle, made, `await bash("sleep 2 && touch ${canary}", background=True)`);

		state.mode = "read-only";
		const next = await cell(handle, made, "print('next')");
		expect(next).toContain("read-only mode turned on");
		expect(next).toContain("1 background shell(s)");

		// Long enough for the sleep to have finished and written, had it survived the group kill.
		await settle(3000);
		expect(existsSync(canary)).toBe(false);
	});

	maybe("does not kill anything when the mode turns off again", async () => {
		const { handle, made, state } = session("read-only");
		const canary = join(dir, "bg-kept");
		await cell(handle, made, `await bash("sleep 1 && touch ${canary}", background=True)`);

		// A relaxation has nothing to kill, and must not surprise anyone by killing their shells.
		state.mode = "read-write";
		const next = await cell(handle, made, "print('next')");
		expect(next).not.toContain("read-only mode turned on");

		await settle(2000);
		expect(existsSync(canary)).toBe(true);
	});

	maybe("says nothing at all when the mode never changes", async () => {
		const { handle, made } = session("read-write");
		await cell(handle, made, "x = 1");
		expect(await cell(handle, made, "print('quiet')")).not.toContain("background shell");
	});

	maybe("hands a policy the shells it is holding, and stops exactly the ones it names", async () => {
		const { handle, made } = session("read-write");
		const canaryA = join(dir, "accessor-a");
		const canaryB = join(dir, "accessor-b");
		// Two real shells, so the id filter has something to leave alone.
		await cell(handle, made, `await bash("sleep 2 && touch ${canaryA}", background=True)`);
		await cell(handle, made, `await bash("sleep 2 && touch ${canaryB}", background=True)`);

		const kernel = handle.kernel as Kernel;
		const running = kernel.backgrounds?.().filter((entry) => entry.status === "running") ?? [];
		expect(running).toHaveLength(2);
		// Enough to name one to a human, and nothing more.
		expect(Object.keys(running[0] ?? {}).sort()).toEqual(["command", "id", "started_at", "status"]);
		expect(running[0]?.command).toContain("sleep 2");

		const first = running[0]?.id ?? "";
		expect(await kernel.killBackgrounds?.([first])).toEqual([first]);
		expect(kernel.backgrounds?.().filter((entry) => entry.status === "running")).toHaveLength(1);

		await settle(3000);
		expect(existsSync(canaryA)).toBe(false);
		expect(existsSync(canaryB)).toBe(true);
	});
});
