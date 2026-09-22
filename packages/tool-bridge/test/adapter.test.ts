/**
 * The reader (`.scratch/tool-bridge/` tickets 01, 03, 04, 08).
 *
 * Three groups, one per decision: what a session may call, what a cell sees when it calls it, and
 * what happens to pi's active set once a name is reachable from a cell.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import {
	gatherToolBridge,
	installToolBridge,
	reconcileToolSurface,
	renderCatalogue,
	textOfResult,
	toolHostFn,
	type BridgeReceipt,
	type Gathered,
} from "../src/adapter";
import {
	API_VERSION,
	__resetToolBridgeForTests,
	bridgedSession,
	sessionKey,
	type BridgePublication,
	type SlotOwner,
} from "../src/convention";

function fakeCtx(id: string) {
	return {
		sessionManager: {
			getSessionId: () => id,
			getSessionFile: () => `/sessions/${id}.jsonl`,
		},
	};
}

function owner(
	key: string,
	publication: Partial<BridgePublication> & { owner: string },
): SlotOwner {
	return {
		key,
		publication: {
			apiVersion: API_VERSION,
			catalogue: () => [],
			execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
			...publication,
		} as BridgePublication,
	};
}

function searchTool(ownerName = "magic-context", calls: Record<string, unknown>[] = []) {
	return owner(ownerName, {
		owner: ownerName,
		catalogue: () => [
			{
				name: "ctx_search",
				description: "Search memory and messages.",
				snippet: "Search memory and messages",
				parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } } },
			},
			{
				name: "ctx_reduce",
				description: "Drop tagged content.",
				snippet: "Drop tagged content",
				parameters: { type: "object", properties: { drop: { type: "string" } } },
			},
		],
		execute: async (name, params) => {
			calls.push({ name, params });
			return { content: [{ type: "text", text: `${name} says ${JSON.stringify(params)}` }] };
		},
	});
}

const ctx = fakeCtx("bridge-test-session");

describe("gathering, per session", () => {
	beforeEach(() => __resetToolBridgeForTests());

	it("keeps every entry an owner offers, in owner order", () => {
		const gathered = gatherToolBridge(ctx, [searchTool()]);
		expect(gathered.tools.map((tool) => tool.entry.name)).toEqual(["ctx_search", "ctx_reduce"]);
		expect(gathered.problems).toEqual([]);
	});

	it("refuses a publication whose apiVersion is not this major, whole", () => {
		const gathered = gatherToolBridge(ctx, [
			owner("mc", { owner: "magic-context", apiVersion: API_VERSION + 1 }),
		]);
		expect(gathered.tools).toEqual([]);
		expect(gathered.problems[0].reason).toContain("refused whole");
	});

	it("refuses a publication with no executor, whole, and says which part is missing", () => {
		const gathered = gatherToolBridge(ctx, [
			owner("mc", { owner: "magic-context", execute: undefined as never }),
		]);
		expect(gathered.tools).toEqual([]);
		expect(gathered.problems[0].reason).toContain("no catalogue/execute");
	});

	it("refuses a publication that throws while answering, rather than half-reading it", () => {
		const gathered = gatherToolBridge(ctx, [
			owner("mc", {
				owner: "magic-context",
				catalogue: () => {
					throw new Error("database is locked");
				},
			}),
		]);
		expect(gathered.tools).toEqual([]);
		expect(gathered.problems[0].reason).toContain("database is locked");
	});

	it("drops a malformed entry and keeps the owner's other tools", () => {
		const gathered = gatherToolBridge(ctx, [
			owner("mc", {
				owner: "magic-context",
				catalogue: () => [
					{ name: "ctx_search" },
					{ description: "no name at all" } as never,
					{ name: "ctx_bad_params", parameters: "not a schema" } as never,
					{ name: "ctx_reduce" },
				],
			}),
		]);
		expect(gathered.tools.map((tool) => tool.entry.name)).toEqual(["ctx_search", "ctx_reduce"]);
		expect(gathered.problems.map((problem) => problem.entry)).toEqual([
			undefined,
			"ctx_bad_params",
		]);
	});

	it("refuses a second owner that claims a name the first holds", () => {
		const gathered = gatherToolBridge(ctx, [
			searchTool("magic-context"),
			owner("other", { owner: "other-extension", catalogue: () => [{ name: "ctx_search" }, { name: "other_tool" }] }),
		]);
		expect(gathered.tools.map((tool) => tool.entry.name)).toEqual(["ctx_search", "ctx_reduce"]);
		expect(gathered.problems).toHaveLength(1);
		expect(gathered.problems[0].owner).toBe("other-extension");
		// Whole owner, not just the clashing entry: `other_tool` never appears either.
		expect(gathered.problems[0].reason).toContain("refused whole");
	});

	it("refuses an owner that publishes one name twice", () => {
		const gathered = gatherToolBridge(ctx, [
			owner("mc", { owner: "magic-context", catalogue: () => [{ name: "ctx_search" }, { name: "ctx_search" }] }),
		]);
		expect(gathered.tools).toEqual([]);
		expect(gathered.problems[0].reason).toContain("twice");
	});
});

describe("what a cell sees", () => {
	beforeEach(() => __resetToolBridgeForTests());

	function gathered(): Gathered {
		return gatherToolBridge(ctx, [searchTool()]);
	}

	it("lists what is published when called with no name, with parameters", () => {
		const listing = renderCatalogue(gathered());
		expect(listing).toContain("magic-context:");
		expect(listing).toContain("ctx_search — Search memory and messages (params: query, limit)");
		expect(listing).toContain("ctx_reduce — Drop tagged content (params: drop)");
	});

	it("calls the owner's executor with the parameters, whichever form the cell used", async () => {
		const calls: Record<string, unknown>[] = [];
		const host = toolHostFn(gatherToolBridge(ctx, [searchTool("magic-context", calls)]), ctx);
		// monty delivers keyword arguments as one trailing object, so both forms arrive alike.
		const keywords = await host("ctx_search", { query: "wal", limit: 5 });
		const positional = await host("ctx_search", { query: "wal", limit: 5 });
		expect(keywords).toBe(positional);
		expect(calls).toEqual([
			{ name: "ctx_search", params: { query: "wal", limit: 5 } },
			{ name: "ctx_search", params: { query: "wal", limit: 5 } },
		]);
	});

	it("returns a refusal verbatim, as text rather than as a fault", async () => {
		const refusing = owner("mc", {
			owner: "magic-context",
			catalogue: () => [{ name: "ctx_memory" }],
			execute: async () => ({
				content: [{ type: "text", text: "Error: 'content' is required when action is 'write'." }],
				details: undefined,
				isError: true,
			}),
		});
		const host = toolHostFn(gatherToolBridge(ctx, [refusing]), ctx);
		expect(await host("ctx_memory")).toBe(
			"Error: 'content' is required when action is 'write'.",
		);
	});

	it("throws a NameError that names what is published, for a name that is not", async () => {
		const host = toolHostFn(gathered(), ctx);
		let caught: unknown;
		try {
			await host("ctx_typo");
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(Error);
		expect((caught as Error).name).toBe("NameError");
		expect((caught as Error).message).toContain("ctx_typo");
		expect((caught as Error).message).toContain("ctx_search, ctx_reduce");
	});

	it("says so when a tool returns no text at all", () => {
		expect(textOfResult({ content: [{ type: "image", data: "…" }] })).toBe(
			"(no text; the tool returned 1 non-text part)",
		);
		expect(textOfResult({ content: [] })).toBe("");
		expect(textOfResult("already text")).toBe("already text");
	});
});

describe("installing the bridge, and the surface rule", () => {
	beforeEach(() => __resetToolBridgeForTests());

	const accepting = (receipt?: BridgeReceipt) => {
		const contributions: unknown[] = [];
		return {
			contributions,
			contribute: (contribution: unknown) => {
				contributions.push(contribution);
				return receipt ?? { accepted: ["tool"], rejected: [] };
			},
		};
	};

	it("contributes one host function and one instruction line per owner, and records the names", () => {
		const sink = accepting();
		const result = installToolBridge({
			contribute: sink.contribute,
			ctx,
			owners: [searchTool()],
		});
		expect(result.installed).toEqual(["ctx_search", "ctx_reduce"]);
		expect(result.reason).toBeUndefined();

		const contribution = sink.contributions[0] as {
			owner: string;
			hostFns: Record<string, unknown>;
			guidelines: string[];
		};
		expect(contribution.owner).toBe("pi-tool-bridge");
		expect(Object.keys(contribution.hostFns)).toEqual(["tool"]);
		expect(contribution.guidelines).toEqual([
			'Tools published by magic-context are callable from a cell: await tool() lists them, and await tool("ctx_search", query=…) calls one.',
		]);
		expect(bridgedSession(sessionKey(ctx))).toEqual({
			toolNames: ["ctx_search", "ctx_reduce"],
			owners: ["magic-context"],
		});
	});

	it("contributes nothing and records nothing when the ledger refuses the kernel name", () => {
		const sink = accepting({
			accepted: [],
			rejected: [{ name: "tool", reason: "already contributed by pi-rlm" }],
		});
		const result = installToolBridge({ contribute: sink.contribute, ctx, owners: [searchTool()] });
		expect(result.installed).toEqual([]);
		expect(result.reason).toContain("already contributed by pi-rlm");
		expect(bridgedSession(sessionKey(ctx))).toBeUndefined();
	});

	it("does nothing at all when nothing is published", () => {
		const sink = accepting();
		const result = installToolBridge({ contribute: sink.contribute, ctx, owners: [] });
		expect(result.installed).toEqual([]);
		expect(result.reason).toBe("nothing is published");
		expect(sink.contributions).toEqual([]);
	});

	it("strips a bridged pi tool, puts back a native-only one, and does nothing without a record", () => {
		const calls: string[][] = [];
		let active = ["python", "ctx_memory", "ask_user_question"];
		const pi = {
			getActiveTools: () => [...active],
			getAllTools: () => [
				{ name: "python" },
				{ name: "ctx_memory" },
				{ name: "ask_user_question" },
				{ name: "todowrite" },
			],
			setActiveTools: (names: string[]) => {
				calls.push(names);
				active = [...names];
			},
		};

		// No bridge installed for this session: not one call to setActiveTools, because a session
		// with no cell route must keep the pi tool it had.
		expect(reconcileToolSurface(pi, ctx)).toEqual([]);
		expect(calls).toEqual([]);

		const sink = accepting();
		// The fixture publishes `ctx_memory` because that is the name the surface rule exists for:
		// Magic Context re-appends it on `session_start`, so code mode's reset does not remove it.
		installToolBridge({
			contribute: sink.contribute,
			ctx,
			owners: [owner("mc", { owner: "magic-context", catalogue: () => [{ name: "ctx_memory" }] })],
		});
		// `todowrite` was never active — code mode's reset removed it and nothing re-appends it — so
		// the rule is what makes it reachable, and it lands after every name it did not touch.
		expect(reconcileToolSurface(pi, ctx)).toEqual(["ctx_memory"]);
		expect(calls).toEqual([["python", "ask_user_question", "todowrite"]]);

		// Idempotent: with the name gone there is nothing left to strip, so nothing is written.
		expect(reconcileToolSurface(pi, ctx)).toEqual([]);
		expect(calls).toHaveLength(1);
	});

	it("does not activate a native-only tool that is not registered", () => {
		const calls: string[][] = [];
		let active = ["python", "ctx_memory"];
		const pi = {
			getActiveTools: () => [...active],
			// Magic Context absent or `todowrite` disabled: the name is not in the registry, and
			// `setActiveTools` would silently ignore it, so the rule must not claim it either.
			getAllTools: () => [{ name: "python" }, { name: "ctx_memory" }],
			setActiveTools: (names: string[]) => {
				calls.push(names);
				active = [...names];
			},
		};

		const sink = accepting();
		installToolBridge({
			contribute: sink.contribute,
			ctx,
			owners: [owner("mc", { owner: "magic-context", catalogue: () => [{ name: "ctx_memory" }] })],
		});
		expect(reconcileToolSurface(pi, ctx)).toEqual(["ctx_memory"]);
		expect(calls).toEqual([["python"]]);
	});
});
