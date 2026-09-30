/**
 * What a cell is told when it names something this sandbox does not have (`src/remedy.ts`).
 *
 * The unit cases pin the map; the live ones pin the *event*, because the matcher is keyed on the message
 * monty actually renders (`'module' object has no attribute 'walk'`) and that string is the worker's, not
 * this repo's. Runs real monty, and checks the kernel survives the failure it answers.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import codeMode from "../index";
import { REGISTRY_KEY, type RegistryEntry } from "../src/contract";
import type { Kernel } from "../src/kernel";
import { remedyFor } from "../src/remedy";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) {
	console.warn("skipping the live remedy tests: no runnable monty worker — set MONTY_BIN (see README.md)");
}
const maybe = montyReady ? it : it.skip;

describe("the name map", () => {
	it("answers the os subset with the like-for-like replacement, in either message shape", () => {
		for (const name of ["path", "walk", "getsize", "isdir", "isfile", "islink", "scandir", "symlink"]) {
			// The traceback shape (what the kernel actually matches on) and the `getattr` shape.
			for (const message of [`module 'os' has no attribute '${name}'`, `'module' object has no attribute '${name}'`]) {
				const remedy = remedyFor("AttributeError", message);
				expect(remedy).toContain("walk(path)");
				expect(remedy).toContain("Path(p).is_dir()");
			}
		}
	});

	it("answers pathlib's own holes with the slice, class methods included", () => {
		for (const name of ["rglob", "glob", "parents", "relative_to", "home"]) {
			expect(remedyFor("AttributeError", `'PosixPath' object has no attribute '${name}'`)).toContain("p[len(root):]");
		}
		expect(remedyFor("AttributeError", "type object 'PosixPath' has no attribute 'home'")).toContain("walk(path)");
	});

	it("stays quiet for anything else", () => {
		// A name monty's `os` *does* have, a missing attribute on a non-module, a pathlib name that
		// exists, another exception type, and a message in a shape this has not seen.
		expect(remedyFor("AttributeError", "'module' object has no attribute 'join'")).toBeNull();
		expect(remedyFor("AttributeError", "'module' object has no attribute 'mkdir'")).toBeNull();
		expect(remedyFor("AttributeError", "'str' object has no attribute 'walk'")).toBeNull();
		expect(remedyFor("AttributeError", "'PosixPath' object has no attribute 'is_dir'")).toBeNull();
		expect(remedyFor("ValueError", "'module' object has no attribute 'walk'")).toBeNull();
		expect(remedyFor("AttributeError", "no attribute in this shape")).toBeNull();
	});
});

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

describe("a cell that names one of them", () => {
	let dir: string;

	beforeEach(() => {
		delete glob[REGISTRY_KEY];
		dir = mkdtempSync(join(tmpdir(), "code-mode-remedy-"));
	});

	function session() {
		const pi = fakePi();
		codeMode(pi as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;
		const ctx = { cwd: dir, sessionManager: { getSessionFile: () => sessionFileIn(dir, "remedy"), getEntries: () => [] } };
		return entry.mount(pi as never, ctx);
	}

	maybe("carries the remedy under the traceback, and the kernel survives it", async () => {
		const handle = session();
		const failed = textOf(
			await (handle.kernel as Kernel).execute({ code: "import os\nfor dp, dn, fn in os.walk(ROOT):\n    pass\n" }, undefined, undefined),
		);
		expect(failed).toContain("AttributeError");
		expect(failed).toContain("# monty's `os` is a curated subset");
		expect(failed).toContain("walk(path)");

		// The session is not poisoned: the next cell runs, and it is the fix the remedy named.
		const fixed = textOf(await (handle.kernel as Kernel).execute({ code: "print(len(walk(ROOT)) > 0)" }, undefined, undefined));
		expect(fixed).toContain("True");
		expect(fixed).not.toContain("curated subset");
	});

	maybe("carries pathlib's own hole with it, and says nothing for an ordinary error", async () => {
		const handle = session();
		const relative = textOf(
			await (handle.kernel as Kernel).execute(
				{ code: "import pathlib\nrel = pathlib.Path(ROOT).relative_to('/workspace')\n" },
				undefined,
				undefined,
			),
		);
		expect(relative).toContain("AttributeError");
		expect(relative).toContain("p[len(root):]");

		const ordinary = textOf(await (handle.kernel as Kernel).execute({ code: "1 + 'a'\n" }, undefined, undefined));
		expect(ordinary).toContain("TypeError");
		expect(ordinary).not.toContain("# monty's");
	});
});
