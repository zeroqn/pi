/**
 * The child seam and its first owner (wayfinder ticket 05, `.scratch/tool-ownership/`).
 *
 * The three tests under "the granted tool surface" moved here from `packages/rlm/test/children.test.ts`
 * when the owner module did — the shim is the bridge's now, so its tests are the bridge's. The last two
 * describe blocks are ticket 02's decisions: the owner list is unique, and the owner-agnostic files name
 * no owner.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { bindChild, childFactories, childStatus } from "../src/child-seam";
import { OWNERS, nativeOnlyTools } from "../src/owners";
import { GRANTED_CHILD_TOOLS, magicContext } from "../src/owners/magic-context";

const REGISTRY_KEY = Symbol.for("@cortexkit/magic-context:pi-registry");

/**
 * The files that must stay owner-agnostic, and the strings that would betray an owner.
 *
 * Ticket 06 adds `adapter.ts`, `convention.ts` and `index.ts` here as it rewrites the Magic Context
 * examples in their comments; until then they name the owner, so listing them would fail this suite.
 */
const GENERIC_FILES = ["child-seam.ts"];
const OWNER_PATTERNS = [/\bmagic/i, /cortexkit/i, /\bctx_/];

/** A registry that answers the shape the owner looks for, with per-test overrides. */
function installRegistry(overrides: Record<string, unknown> = {}): void {
	(globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = {
		transformContext: async () => undefined,
		compact: async () => undefined,
		scrubMessage: () => {},
		bindChild: () => {},
		...overrides,
	};
}

function clearRegistry(): void {
	delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
}

/** The child's own `pi`, recording what a factory registers and which handlers it installs. */
function childSurface(): { pi: any; handlers: Map<string, Function>; tools: Map<string, any> } {
	const handlers = new Map<string, Function>();
	const tools = new Map<string, any>();
	const pi = {
		on: (event: string, handler: Function) => handlers.set(event, handler),
		registerTool: (definition: any) => tools.set(definition.name, definition),
	};
	return { pi, handlers, tools };
}

/** Every factory a child is given, applied to a recording `pi`. */
function applyFactories(pi: any): void {
	for (const factory of childFactories({ parentSessionFile: "/parent.jsonl" })) factory(pi);
}

describe("the granted tool surface (v2 ticket 02)", () => {
	it("is exactly the three tools, and never the withheld ones", () => {
		expect([...GRANTED_CHILD_TOOLS].sort()).toEqual(["ctx_expand", "ctx_reduce", "ctx_search"]);
		for (const withheld of ["ctx_memory", "ctx_note", "todowrite", "todo_view"]) {
			expect(GRANTED_CHILD_TOOLS).not.toContain(withheld);
		}
	});

	it("registers the proxies and routes them through runTool", async () => {
		const calls: Array<{ name: string; params: unknown }> = [];
		const bound: unknown[] = [];
		installRegistry({
			bindChild: (input: unknown) => bound.push(input),
			runTool: async (name: string, params: unknown) => {
				calls.push({ name, params });
				return { content: [{ type: "text", text: `ran ${name}` }] };
			},
		});
		try {
			const { pi, handlers, tools } = childSurface();
			applyFactories(pi);

			expect(tools.size).toBe(0); // nothing registers before the session starts
			await handlers.get("session_start")!({}, { sessionManager: { getSessionFile: () => "/child.jsonl" }, cwd: "/w" });
			expect([...tools.keys()].sort()).toEqual(["ctx_expand", "ctx_reduce", "ctx_search"]);
			expect(bound).toEqual([{ childSessionFile: "/child.jsonl", parentSessionFile: "/parent.jsonl", cwd: "/w" }]);

			const result = await tools.get("ctx_search")!.execute("call-1", { query: "x" }, undefined, undefined, { cwd: "/w" });
			expect(result.content[0].text).toBe("ran ctx_search");
			expect(calls).toEqual([{ name: "ctx_search", params: { query: "x" } }]);
		} finally {
			clearRegistry();
		}
	});

	it("registers nothing when the registry cannot execute tools (older MC)", async () => {
		installRegistry(); // no runTool
		try {
			const { pi, handlers, tools } = childSurface();
			applyFactories(pi);
			await handlers.get("session_start")!({}, { sessionManager: { getSessionFile: () => "/child.jsonl" }, cwd: "/w" });
			expect(tools.size).toBe(0);
			// The degradation is reported rather than silent: the status line names the missing executor.
			expect(childStatus()).toContain("no runTool");
		} finally {
			clearRegistry();
		}
	});
});

describe("degradation is loud and inert (ticket 02)", () => {
	it("keeps a no-op factory and reports the absence when there is no registry", () => {
		clearRegistry();
		const { pi, handlers, tools } = childSurface();
		applyFactories(pi);
		expect(handlers.size).toBe(0); // the factory no-ops rather than registering handlers
		expect(tools.size).toBe(0);
		expect(childStatus()).toContain("no registry");
		expect(() => bindChild({ childSessionFile: "/child.jsonl" })).not.toThrow();
	});

	it("contains a throwing owner, so one bind cannot stop another", () => {
		installRegistry({
			bindChild: () => {
				throw new Error("boom");
			},
		});
		try {
			expect(() => bindChild({ childSessionFile: "/child.jsonl" })).not.toThrow();
		} finally {
			clearRegistry();
		}
	});
});

describe("the owner list (ticket 02)", () => {
	it("has one entry per owner, with unique names", () => {
		const names = OWNERS.map((owner) => owner.name);
		expect(new Set(names).size).toBe(names.length);
		expect(names).toContain("magic-context");
	});

	it("unions native-only names without duplicates", () => {
		const names = nativeOnlyTools();
		expect(names).toContain("todowrite");
		expect(new Set(names).size).toBe(names.length);
		expect(magicContext.nativeOnly).toEqual(["todowrite"]);
	});

	it("names no owner in the owner-agnostic files", () => {
		const offenders: string[] = [];
		for (const file of GENERIC_FILES) {
			const lines = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8").split("\n");
			lines.forEach((line, index) => {
				if (OWNER_PATTERNS.some((pattern) => pattern.test(line))) {
					offenders.push(`${file}:${index + 1}: ${line.trim()}`);
				}
			});
		}
		expect(offenders).toEqual([]);
	});
});
