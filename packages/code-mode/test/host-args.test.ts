/**
 * What a host function receives (wayfinder ticket 03's live follow-up in zeroqn/pi's
 * `.scratch/one-tool-surface/`).
 *
 * Monty carries a Python `dict` as a `Map`: positionally, and nested inside a `list` even when the call
 * itself is keyword-shaped. A host that reads fields — Magic Context's `todowrite` capture does, and its
 * shape gate is right to reject anything that is not a todo — therefore saw nothing, and a cell's call
 * recorded no state. A live session found it; these tests pin the boundary that fixes it.
 *
 * Real monty, because the shape is monty's to decide.
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
	console.warn("skipping the live host-argument tests: no runnable monty worker — set MONTY_BIN (see README.md)");
}
const maybe = montyReady ? it : it.skip;

const glob = globalThis as Record<symbol, unknown>;
const saved = glob[REGISTRY_KEY];

afterAll(() => {
	if (saved === undefined) delete glob[REGISTRY_KEY];
	else glob[REGISTRY_KEY] = saved;
});

describe("a host function's arguments", () => {
	let dir: string;
	let seen: unknown[][] = [];

	beforeEach(() => {
		delete glob[REGISTRY_KEY];
		seen = [];
		dir = mkdtempSync(join(tmpdir(), "code-mode-host-args-"));
	});

	function session() {
		const handlers = new Map<string, Function[]>();
		const pi = {
			registerTool() {},
			setActiveTools() {},
			getActiveTools: () => ["python"],
			getAllTools: () => [],
			on(event: string, handler: Function) {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
			},
			appendEntry() {},
			sendMessage() {},
		};
		codeMode(pi as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;
		const file = join(dir, "session.jsonl");
		writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id: "s", timestamp: "", cwd: dir })}\n`);
		const handle = entry.mount(pi as never, {
			cwd: dir,
			sessionManager: { getSessionFile: () => file, getEntries: () => [] },
		} as never);
		handle.contribute({
			owner: "probe",
			hostFns: {
				probe_fn: async (...args: unknown[]) => {
					seen.push(args);
					return "ok";
				},
			},
		});
		return handle;
	}

	maybe("carries a Python dict as a plain object, positionally and by name", async () => {
		const handle = session();
		await (handle.kernel as Kernel).execute(
			{
				code: [
					'await probe_fn({"action": "read", "count": 2})',
					'await probe_fn(action="read", count=2)',
					"",
				].join("\n"),
			},
			undefined,
			undefined,
		);

		expect(seen[0]).toEqual([{ action: "read", count: 2 }]);
		expect(seen[0][0]).not.toBeInstanceOf(Map);
		// The trailing kwargs object was never a `Map`; it must survive the conversion unchanged.
		expect(seen[1]).toEqual([{ action: "read", count: 2 }]);
	});

	maybe("carries a dict nested in a list with its fields intact", async () => {
		const handle = session();
		await (handle.kernel as Kernel).execute(
			{
				code: 'await probe_fn(todos=[{"content": "verify", "status": "in_progress"}, {"content": "ship", "status": "pending"}])\n',
			},
			undefined,
			undefined,
		);

		// The shape Magic Context's capture requires: `Object.entries(todo)` has to see the fields.
		expect(seen[0]).toEqual([
			{
				todos: [
					{ content: "verify", status: "in_progress" },
					{ content: "ship", status: "pending" },
				],
			},
		]);
		const params = seen[0][0] as { todos: Array<Record<string, unknown>> };
		expect(Object.keys(params.todos[0])).toEqual(["content", "status"]);
	});

	maybe("leaves primitives, None and deeply nested structures alone", async () => {
		const handle = session();
		await (handle.kernel as Kernel).execute(
			{ code: 'await probe_fn("text", 7, True, None)\n' },
			undefined,
			undefined,
		);
		expect(seen[0]).toEqual(["text", 7, true, null]);
	});
});
