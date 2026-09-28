/**
 * What a cell reached, recorded on the `python` result (wayfinder ticket 03 in zeroqn/pi's
 * `.scratch/one-tool-surface/`).
 *
 * Why a transcript line: a cell's calls are invisible to everyone but code mode — the transcript shows
 * one `python` call and its printed output — so an owner whose capability a cell used cannot tell. Magic
 * Context's note-nudge suppression and its `ctx_reduce` tag consumers both read that, and both were blind
 * to a cell. `details` is where the record goes because pi persists the whole message, so a later pass and
 * a resumed session see the same thing.
 *
 * Runs real monty: the claim is about what the host surface actually served.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import codeMode from "../index";
import { REGISTRY_KEY, type RegistryEntry } from "../src/contract";
import type { Kernel } from "../src/kernel";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) {
	console.warn("skipping the live cell-trace tests: no runnable monty worker — set MONTY_BIN (see README.md)");
}
const maybe = montyReady ? it : it.skip;

type Handler = (event: unknown, ctx: unknown) => unknown;

function fakePi() {
	const handlers = new Map<string, Handler[]>();
	return {
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
		appendEntry() {},
		sendMessage() {},
	};
}

function sessionFileIn(dir: string, id: string): string {
	const file = join(dir, `${id}.jsonl`);
	writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id, timestamp: "", cwd: dir })}\n`);
	return file;
}

const glob = globalThis as Record<symbol, unknown>;
const saved = glob[REGISTRY_KEY];

afterAll(() => {
	if (saved === undefined) delete glob[REGISTRY_KEY];
	else glob[REGISTRY_KEY] = saved;
});

describe("a cell's trace of what it reached", () => {
	let dir: string;

	beforeEach(() => {
		delete glob[REGISTRY_KEY];
		dir = mkdtempSync(join(tmpdir(), "code-mode-cell-calls-"));
	});

	/** A mounted kernel with one owner's capabilities contributed. */
	function session() {
		const pi = fakePi();
		codeMode(pi as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;
		const ctx = { cwd: dir, sessionManager: { getSessionFile: () => sessionFileIn(dir, "trace"), getEntries: () => [] } };
		const handle = entry.mount(pi as never, ctx);
		handle.contribute({
			owner: "magic-context",
			hostFns: {
				tool: async (...args: unknown[]) => `called ${String(args[0])}`,
				zvec_grep_rg: async () => "exact search",
			},
		});
		return handle;
	}

	maybe("records the contributed calls in order, with the bridge's route left unresolved", async () => {
		const handle = session();
		const result = (await (handle.kernel as Kernel).execute(
			{
				code: [
					'await bash("echo hello")',
					'await tool("ctx_note", action="read")',
					'await zvec_grep_rg("needle")',
					'',
				].join("\n"),
			},
			undefined,
			undefined,
		)) as { details?: { cellCalls?: unknown } };

		// `bash` is code mode's own base surface: every cell calls it, and the trace is about the
		// session's capabilities.
		expect(result.details?.cellCalls).toEqual([
			{ host: "tool", args: ["ctx_note", { action: "read" }] },
			{ host: "zvec_grep_rg", args: ["needle"] },
		]);
	});

	maybe("records a call that raised, because it happened", async () => {
		const handle = session();
		const result = (await (handle.kernel as Kernel).execute(
			{ code: 'try:\n    await tool("ctx_absent")\nexcept Exception:\n    pass\n' },
			undefined,
			undefined,
		)) as { details?: { cellCalls?: unknown } };

		expect(result.details?.cellCalls).toEqual([{ host: "tool", args: ["ctx_absent"] }]);
	});

	maybe("reads a Python dict, however monty carried it", async () => {
		const handle = session();
		const result = (await (handle.kernel as Kernel).execute(
			{
				code: [
					'await tool("todowrite", todos=[{"content": "x", "status": "in_progress"}])',
					'await tool({"name": "positional", "action": "read"}, 3)',
					"",
				].join("\n"),
			},
			undefined,
			undefined,
		)) as { details?: { cellCalls?: unknown } };

		// A positional dict arrives as a `Map`, a dict nested in a list is one too, and the kwargs
		// object arrives as a plain object — one cell can produce all three, so all three are read.
		expect(result.details?.cellCalls).toEqual([
			{ host: "tool", args: ["todowrite", { todos: [{ content: "x", status: "in_progress" }] }] },
			{ host: "tool", args: [{ name: "positional", action: "read" }, 3] },
		]);
	});

	maybe("keeps a huge argument out of the transcript line", async () => {
		const handle = session();
		const result = (await (handle.kernel as Kernel).execute(
			{ code: 'await tool("ctx_search", query="x" * 5000)' },
			undefined,
			undefined,
		)) as { details?: { cellCalls?: Array<{ args: unknown[] }> } };

		const args = result.details?.cellCalls?.[0]?.args ?? [];
		const params = args[1] as { query?: string } | undefined;
		expect(typeof params?.query).toBe("string");
		expect((params?.query ?? "").length).toBeLessThanOrEqual(201);
	});
});
