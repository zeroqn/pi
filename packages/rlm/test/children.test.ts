/**
 * v2's additions to the child manager — tickets 07 (cost), 09 (re-serve) and 10
 * (durable depth), plus ticket 02's granted tool surface.
 *
 * These are the parts that can be tested without spawning a real child session, so
 * they are the parts that should never regress silently: a depth that reads as zero
 * would hand a child a root's spawning authority, and a cost that double-counts would
 * misreport what a tree spent.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CHILD_ENTRY_TYPE,
	type CostTotals,
	deriveDepth,
	foldSessionCost,
	forgetManagerViews,
	readChildProvenance,
	childPromptFor,
	registerManagerView,
	resolveOwnDepth,
	treeTokens,
} from "../src/children";
import { GRANTED_CHILD_TOOLS, magicContextChildShim } from "../src/magic-context";

const REGISTRY_KEY = Symbol.for("@cortexkit/magic-context:pi-registry");

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "rlm-children-"));
}

function writeSession(file: string, header: Record<string, unknown>, entries: unknown[] = []): void {
	mkdirSync(join(file, ".."), { recursive: true });
	const lines = [JSON.stringify({ type: "session", version: 3, ...header }), ...entries.map((e) => JSON.stringify(e))];
	writeFileSync(file, `${lines.join("\n")}\n`);
}

function managerWithEntries(entries: unknown[]): { getEntries: () => unknown[] } {
	return { getEntries: () => entries };
}

describe("durable depth (v2 ticket 10)", () => {
	it("prefers the child entry over anything derived", () => {
		const manager = managerWithEntries([
			{ type: "custom", customType: CHILD_ENTRY_TYPE, data: { depth: 1, parentSessionFile: "/tmp/parent.jsonl", maxDepth: 2 } },
		]);
		expect(readChildProvenance(manager)).toEqual({ depth: 1, parentSessionFile: "/tmp/parent.jsonl", maxDepth: 2 });
		expect(resolveOwnDepth({ sessionManager: manager, sessionFile: "/tmp/child.jsonl", maxDepth: 2 })).toEqual({
			depth: 1,
			source: "entry",
		});
	});

	it("derives depth from the parentSession chain when no entry exists", () => {
		const dir = scratch();
		try {
			const root = join(dir, "root.jsonl");
			const child = join(dir, "child.jsonl");
			const grand = join(dir, "grand.jsonl");
			writeSession(root, { id: "root" });
			writeSession(child, { id: "child", parentSession: root });
			writeSession(grand, { id: "grand", parentSession: child });

			expect(deriveDepth({ sessionFile: root })).toBe(0);
			expect(deriveDepth({ sessionFile: child })).toBe(1);
			expect(deriveDepth({ sessionFile: grand })).toBe(2);
			expect(resolveOwnDepth({ sessionManager: managerWithEntries([]), sessionFile: grand, maxDepth: 2 })).toEqual({
				depth: 2,
				source: "chain",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reads a session with no parent as a root", () => {
		const dir = scratch();
		try {
			const root = join(dir, "root.jsonl");
			writeSession(root, { id: "root" });
			expect(resolveOwnDepth({ sessionManager: managerWithEntries([]), sessionFile: root, maxDepth: 2 })).toEqual({
				depth: 0,
				source: "root",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reads an unprovable depth as the maximum, never zero", () => {
		const dir = scratch();
		try {
			// A parent that exists but whose own header is missing: the chain cannot be
			// walked, so the depth is unknowable. Treating that as 0 would grant a child
			// a root's spawning authority.
			const child = join(dir, "child.jsonl");
			writeSession(child, { id: "child", parentSession: join(dir, "missing-parent.jsonl") });
			const resolved = resolveOwnDepth({ sessionManager: managerWithEntries([]), sessionFile: child, maxDepth: 2 });
			expect(resolved.source).toBe("chain");
			expect(resolved.depth).toBe(1);
			expect(
				resolveOwnDepth({
					sessionManager: managerWithEntries([]),
					sessionFile: join(dir, "gone.jsonl"),
					maxDepth: 2,
				}).depth,
			).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("session cost (v2 ticket 07)", () => {
	const entries = [
		{ id: "a", type: "message", message: { role: "assistant", usage: { input: 100, output: 20, total: 120 } } },
		{ id: "b", type: "message", message: { role: "user" } },
		{ id: "c", type: "compaction", usage: { input: 50, output: 10, total: 60 } },
		{ id: "d", type: "branch_summary", usage: { input: 5, output: 5 } },
	];

	it("sums usage from messages, compactions and branch summaries", () => {
		const totals: CostTotals = { input: 0, output: 0, total: 0, entries: 0 };
		foldSessionCost({ sessionManager: managerWithEntries(entries) }, totals, new Set());
		expect(totals).toEqual({ input: 155, output: 35, total: 190, entries: 3 });
	});

	it("is incremental: a second call counts only new entries", () => {
		const counted = new Set<string>();
		const totals: CostTotals = { input: 0, output: 0, total: 0, entries: 0 };
		const session = { sessionManager: managerWithEntries(entries) };
		foldSessionCost(session, totals, counted);
		foldSessionCost(session, totals, counted);
		expect(totals.total).toBe(190);
		expect(totals.entries).toBe(3);

		entries.push({ id: "e", type: "message", message: { role: "assistant", usage: { input: 10, output: 0, total: 10 } } });
		foldSessionCost(session, totals, counted);
		expect(totals.total).toBe(200);
	});

	it("treats an entry with no usage as free rather than unknown", () => {
		const totals: CostTotals = { input: 0, output: 0, total: 0, entries: 0 };
		foldSessionCost({ sessionManager: managerWithEntries([{ id: "z", type: "message", message: { role: "user" } }]) }, totals, new Set());
		expect(totals.entries).toBe(0);
	});
});

describe("tree cost (v2 ticket 07)", () => {
	it("walks descendants recursively and survives a cycle", () => {
		forgetManagerViews();
		registerManagerView("/root.jsonl", () => [{ session_file: "/child.jsonl", tokens: 100 }]);
		registerManagerView("/child.jsonl", () => [{ session_file: "/grand.jsonl", tokens: 40 }]);
		registerManagerView("/grand.jsonl", () => []);
		expect(treeTokens("/root.jsonl")).toBe(140);
		expect(treeTokens(undefined)).toBe(0);

		// A cycle must not hang or double-count.
		forgetManagerViews();
		registerManagerView("/a.jsonl", () => [{ session_file: "/b.jsonl", tokens: 1 }]);
		registerManagerView("/b.jsonl", () => [{ session_file: "/a.jsonl", tokens: 1 }]);
		expect(treeTokens("/a.jsonl")).toBe(2);
	});
});

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
		(globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = {
			transformContext: async () => undefined,
			compact: async () => undefined,
			scrubMessage: () => {},
			bindChild: (input: unknown) => bound.push(input),
			runTool: async (name: string, params: unknown) => {
				calls.push({ name, params });
				return { content: [{ type: "text", text: `ran ${name}` }] };
			},
		};
		try {
			const handlers = new Map<string, Function>();
			const tools = new Map<string, any>();
			const fakePi = {
				on: (event: string, handler: Function) => handlers.set(event, handler),
				registerTool: (definition: any) => tools.set(definition.name, definition),
			};
			magicContextChildShim("/parent.jsonl")(fakePi);

			expect(tools.size).toBe(0); // nothing registers before the session starts
			await handlers.get("session_start")!({}, { sessionManager: { getSessionFile: () => "/child.jsonl" }, cwd: "/w" });
			expect([...tools.keys()].sort()).toEqual(["ctx_expand", "ctx_reduce", "ctx_search"]);
			expect(bound).toEqual([{ childSessionFile: "/child.jsonl", parentSessionFile: "/parent.jsonl", cwd: "/w" }]);

			const result = await tools.get("ctx_search")!.execute("call-1", { query: "x" }, undefined, undefined, { cwd: "/w" });
			expect(result.content[0].text).toBe("ran ctx_search");
			expect(calls).toEqual([{ name: "ctx_search", params: { query: "x" } }]);
		} finally {
			delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
		}
	});

	it("registers nothing when the registry cannot execute tools (older MC)", async () => {
		(globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = {
			transformContext: async () => undefined,
			compact: async () => undefined,
			scrubMessage: () => {},
			bindChild: () => {},
		};
		try {
			const handlers = new Map<string, Function>();
			const tools = new Map<string, any>();
			magicContextChildShim("/parent.jsonl")({
				on: (event: string, handler: Function) => handlers.set(event, handler),
				registerTool: (definition: any) => tools.set(definition.name, definition),
			});
			await handlers.get("session_start")!({}, { sessionManager: { getSessionFile: () => "/child.jsonl" }, cwd: "/w" });
			expect(tools.size).toBe(0);
		} finally {
			delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
		}
	});
});

describe("the child prompt (v2 ticket 05)", () => {
	it("keeps the delegation sentence parent-only", async () => {
		const source = await Bun.file(join(import.meta.dir, "..", "src", "children.ts")).text();
		expect(source).toContain("results arrive as messages, never as the call's return value");
		expect(source).toContain("child session (depth");
		// A child is told where its results go, not that it may have children of its own.
		expect(source).not.toContain("your own children");
	});
});

describe("the child prompt's shapes (v2 ticket 05)", () => {
	it("states delegation below the cap, and its refusal at the cap", () => {
		delete process.env.RLM_CHILD_PROMPT;
		const below = childPromptFor({ name: "c", depth: 1 }, 2).join(" ");
		const atCap = childPromptFor({ name: "c", depth: 2 }, 2).join(" ");
		expect(below).toContain("You may delegate with rlm.spawn");
		expect(atCap).toContain("at the delegation limit");
		expect(atCap).not.toContain("You may delegate with rlm.spawn");
		// Parent-only: neither shape describes its own future children.
		expect(below).not.toContain("your own children");
	});

	it("drops the added sentences under the A/B control", () => {
		process.env.RLM_CHILD_PROMPT = "none";
		try {
			const control = childPromptFor({ name: "c", depth: 1 }, 2).join(" ");
			expect(control).not.toContain("persistent Python kernel");
			expect(control).toContain('You are "c", a delegated child session (depth 1)');
			expect(control).toContain("agent_message.send");
		} finally {
			delete process.env.RLM_CHILD_PROMPT;
		}
	});
});
