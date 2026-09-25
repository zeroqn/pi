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
