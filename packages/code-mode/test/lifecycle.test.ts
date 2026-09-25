/**
 * A kernel whose session is gone is dumped and closed by the next session in the process.
 *
 * Two shapes of the same defect, and both are why this file exists:
 *
 *   - a **child**'s kernel is mounted through the registry by the instance that published it, and a
 *     child loads no code-mode entry of its own (`rlm/src/children.ts` lists the child's factories) —
 *     so when RLM disposes the child, no handler on that child's runner can reach the kernel;
 *   - a `/new` (and a `/reload`) re-imports this entry, so the kernels the outgoing instance mounted
 *     are left behind in a local map that dies with it.
 *
 * Either way the kernel belongs to the *session*: the shared registry map is the one object every
 * instance can see it through, and `session_start` is the first moment such a session is provably
 * dead — pi tears the outgoing session down before it builds the incoming one, and RLM disposes every
 * descendant of the parent it is leaving. Liveness, not the absence of a key, is the test: a finished
 * child is still resumable, so its kernel must be left exactly as it is.
 *
 * Real monty, but only one cell: a dump exists after a cell has been journaled, and the dump's
 * existence is the proof that `shutdown()` ran — `dumpKernel` is called from `endTurn` and `shutdown`
 * only, and this test never fires `agent_end`.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REGISTRY_KEY, type RegistryEntry } from "../src/contract";
import codeMode from "../index";
import type { Kernel } from "../src/kernel";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) {
	console.warn("skipping the cell-running reap test: no runnable monty worker — set MONTY_BIN (see README.md)");
}
const maybe = montyReady ? it : it.skip;

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

/** A session file, so the journal, dump and scratch all get real paths beside it. */
function sessionFileIn(dir: string, id: string): string {
	const file = join(dir, `${id}.jsonl`);
	writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id, timestamp: "", cwd: dir })}\n`);
	return file;
}

/**
 * A ctx whose session can be ended the way pi ends one: the runner is invalidated, and from then on
 * *every* property of the ctx throws. `sessionIsAlive` is what tells that apart from an idle session.
 */
function sessionCtx(dir: string, file: string) {
	const state = { alive: true };
	const ctx = {
		cwd: dir,
		get sessionManager() {
			if (!state.alive) throw new Error("This extension ctx is stale after session replacement or reload.");
			return { getSessionFile: () => file, getEntries: () => [] };
		},
	} as unknown;
	return { state, ctx, file };
}

function textOf(result: unknown): string {
	const parts = (result as { content?: Array<{ text?: string }> })?.content ?? [];
	return parts.map((part) => part.text ?? "").join("");
}

const glob = globalThis as Record<symbol, unknown>;
const saved = glob[REGISTRY_KEY];

afterAll(() => {
	if (saved === undefined) delete glob[REGISTRY_KEY];
	else glob[REGISTRY_KEY] = saved;
});

describe("a session that is gone", () => {
	let dir: string;

	beforeEach(() => {
		delete glob[REGISTRY_KEY];
		dir = mkdtempSync(join(tmpdir(), "code-mode-reap-"));
	});

	maybe("is dumped and closed by the next session_start, in the shared map's terms", async () => {
		const spawner = fakePi();
		codeMode(spawner as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;

		const gone = sessionCtx(dir, sessionFileIn(dir, "child-gone"));
		const handle = entry.mount(spawner as never, gone.ctx);
		expect(textOf(await (handle.kernel as Kernel).execute({ code: "x = 1\nprint(x)" }, undefined, gone.ctx))).toContain("1");
		expect(existsSync(`${gone.file}.rlm-dump.bin`)).toBe(false);

		// The child is disposed — the way RLM disposes one — so its ctx is gone from here on.
		gone.state.alive = false;

		const next = fakePi();
		codeMode(next as never);
		await next.emit("session_start", sessionCtx(dir, sessionFileIn(dir, "next")).ctx);

		expect(next.entries.filter((record) => record.type === "code-mode-reaped")).toEqual([
			{ type: "code-mode-reaped", payload: { sessionKey: gone.file } },
		]);
		expect(entry.sessions.has(gone.file)).toBe(false);
		expect(existsSync(`${gone.file}.rlm-dump.bin`)).toBe(true);
	});

	it("leaves an idle session's kernel alone — a finished child is resumable", async () => {
		const spawner = fakePi();
		codeMode(spawner as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;

		const idle = sessionCtx(dir, sessionFileIn(dir, "child-idle"));
		const handle = entry.mount(spawner as never, idle.ctx);
		const closed: string[] = [];
		(handle.kernel as { shutdown: () => Promise<void> }).shutdown = async () => {
			closed.push(idle.file);
		};

		const next = fakePi();
		codeMode(next as never);
		await next.emit("session_start", sessionCtx(dir, sessionFileIn(dir, "next")).ctx);

		expect(closed).toEqual([]);
		expect(next.entries.filter((record) => record.type === "code-mode-reaped")).toEqual([]);
		expect(entry.sessions.has(idle.file)).toBe(true);
	});

	afterAll(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});
});
