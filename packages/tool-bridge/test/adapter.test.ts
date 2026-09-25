/**
 * The reader (`.scratch/tool-bridge/` tickets 01, 03, 04, 08).
 *
 * Three groups, one per decision: what a session may call, what a cell sees when it calls it, and
 * what happens to pi's active set once a name is reachable from a cell.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import {
	gatherToolBridge,
	reconcileChildSurface,
	reconcileToolSurface,
	renderCatalogue,
	textOfResult,
	toolHostFn,
	type Gathered,
} from "../src/adapter";
import {
	API_VERSION,
	__resetToolBridgeForTests,
	type BridgePublication,
	type SlotOwner,
} from "../src/convention";
import {
	__resetHostBridgeForTests,
	recordSession,
	sessionKey,
} from "../../host-bridge/src/convention";
import { toolBridgeAnswer } from "../src/registration";

/**
 * The native-only set the entry hands the surface rule. A literal here, not the owner's declaration:
 * the rule takes it as an input, and this file tests the rule rather than who declares what.
 */
const NATIVE_ONLY = ["todowrite"];

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

/** Write owners into the live slot, the way an owner's own bundle would. */
function publish(owners: SlotOwner[]): void {
	const slot = ((globalThis as Record<symbol, unknown>)[
		Symbol.for("pi-tool-bridge:owners")
	] ??= new Map()) as Map<string, BridgePublication>;
	for (const entry of owners) slot.set(entry.key, entry.publication);
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

describe("the contribution, and the surface rule", () => {
	beforeEach(() => {
		__resetToolBridgeForTests();
		__resetHostBridgeForTests();
	});

	/** The answer, driven the way the composition root drives it — through the live slot. */
	const answer = (owners: SlotOwner[]) => {
		publish(owners);
		return toolBridgeAnswer({ ctx } as never);
	};

	/** The session record is `pi-host-bridge`'s: the composition root writes it after the ledger, and
	 *  this rule only reads it. */
	const record = (reaches: string[]) =>
		recordSession(sessionKey(ctx), {
			mounted: true,
			owners: ["magic-context"],
			installed: ["tool"],
			reaches,
			promptTexts: [],
			problems: [],
		});

	it("answers one host function and one instruction line per owner, and names what a cell can reach", () => {
		const a = answer([searchTool()]);
		expect(a?.reaches).toEqual(["ctx_search", "ctx_reduce"]);
		const contribution = a?.contribution as {
			owner: string;
			hostFns: Record<string, unknown>;
			guidelines: string[];
		};
		expect(contribution.owner).toBe("pi-tool-bridge");
		expect(Object.keys(contribution.hostFns)).toEqual(["tool"]);
		expect(contribution.guidelines).toEqual([
			'magic-context publishes ctx_search, ctx_reduce. None of them is a pi tool or a bare name in a cell — call one as await tool("ctx_search", query=…); await tool() lists them all.',
		]);
	});

	it("names every published tool, and keeps the example runnable when a tool has no parameters", () => {
		const a = answer([owner("mc", { owner: "magic-context", catalogue: () => [{ name: "ctx_memory" }] })]);
		const contribution = a?.contribution as { guidelines: string[] };
		expect(contribution.guidelines).toEqual([
			'magic-context publishes ctx_memory. None of them is a pi tool or a bare name in a cell — call one as await tool("ctx_memory"); await tool() lists them all.',
		]);
	});

	it("answers nothing at all when nothing is published", () => {
		expect(answer([])).toBeNull();
	});

	it("casts what it dropped into the session's problems, and still offers the rest", () => {
		const a = answer([
			owner("mc", {
				owner: "magic-context",
				catalogue: () => [
					{ name: "ctx_search" },
					{ name: "" },
					{ name: "ctx_reduce", parameters: "not a schema" as never },
				],
			}),
		]);
		expect(a?.reaches).toEqual(["ctx_search"]);
		expect(a?.problems).toEqual([
			"magic-context: a catalogue entry without a name was dropped",
			"magic-context: entry 'ctx_reduce' has a parameters value that is not a schema object — entry dropped",
		]);
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

		// No record for this session: not one call to setActiveTools, because a session with no cell
		// route must keep the pi tool it had.
		expect(reconcileToolSurface(pi, ctx, NATIVE_ONLY)).toEqual([]);
		expect(calls).toEqual([]);

		// The fixture records `ctx_memory` because that is the name the surface rule exists for: Magic
		// Context re-appends it on `session_start`, so code mode's reset does not remove it.
		record(["ctx_memory"]);
		// `todowrite` was never active — code mode's reset removed it and nothing re-appends it — so
		// the rule is what makes it reachable, and it lands after every name it did not touch.
		expect(reconcileToolSurface(pi, ctx, NATIVE_ONLY)).toEqual(["ctx_memory"]);
		expect(calls).toEqual([["python", "ask_user_question", "todowrite"]]);

		// Idempotent: with the name gone there is nothing left to strip, so nothing is written.
		expect(reconcileToolSurface(pi, ctx, NATIVE_ONLY)).toEqual([]);
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

		record(["ctx_memory"]);
		expect(reconcileToolSurface(pi, ctx, NATIVE_ONLY)).toEqual(["ctx_memory"]);
		expect(calls).toEqual([["python"]]);
	});
});

describe("the child's surface (child-surface ticket 03 §6)", () => {
	beforeEach(() => __resetToolBridgeForTests());

	/** A child's pi: an ambient-shaped registry of `registered`, currently offering `active`. */
	function childPi(registered: string[], active: string[]) {
		const state = [...active];
		const writes: string[][] = [];
		return {
			state,
			writes,
			pi: {
				getActiveTools: () => [...state],
				getAllTools: () => registered.map((name) => ({ name })),
				setActiveTools(names: string[]) {
					writes.push([...names]);
					state.splice(0, state.length, ...names);
				},
			},
		};
	}

	it("keeps only what the ceiling and the registry both allow", () => {
		const ctx = fakeCtx("child-keep");
		const { pi, state } = childPi(
			["read", "bash", "python", "todowrite"],
			["read", "bash", "python", "ctx_memory"],
		);
		const report = reconcileChildSurface({ pi, ctx, ceiling: ["python", "todowrite"] });
		// The resumed-child direction: a spawned child's registry was already filtered by pi.
		expect(state).toEqual(["python", "todowrite"]);
		expect(report.surface).toEqual(["python", "todowrite"]);
		expect(report.deactivated).toEqual(["read", "bash", "ctx_memory"]);
		expect(report.restored).toEqual(["todowrite"]);
	});

	it("strips what the child's own cell can reach, even inside the ceiling", () => {
		const ctx = fakeCtx("child-strip");
		recordSession(sessionKey(ctx), {
			mounted: true,
			owners: ["magic-context"],
			installed: ["tool"],
			reaches: ["todowrite"],
			promptTexts: [],
			problems: [],
		});
		const { pi, state } = childPi(["python", "todowrite"], ["python", "todowrite"]);
		const report = reconcileChildSurface({ pi, ctx, ceiling: ["python", "todowrite"] });
		// A name a cell can call is not a pi tool in that session — the root's direction, and it outranks
		// the ceiling: a route exists, so the tool goes.
		expect(state).toEqual(["python"]);
		expect(report.deactivated).toEqual(["todowrite"]);
		expect(report.restored).toEqual([]);
	});

	it("does not activate a ceiling name nothing registered", () => {
		const ctx = fakeCtx("child-unregistered");
		const { pi, state } = childPi(["python"], ["python"]);
		const report = reconcileChildSurface({ pi, ctx, ceiling: ["python", "todowrite"] });
		expect(state).toEqual(["python"]);
		expect(report.restored).toEqual([]);
	});

	it("writes nothing when the surface is already right", () => {
		const ctx = fakeCtx("child-noop");
		const { pi, writes } = childPi(["python", "todowrite"], ["python", "todowrite"]);
		reconcileChildSurface({ pi, ctx, ceiling: ["python", "todowrite"] });
		expect(writes).toEqual([]);
	});

	it("narrows to nothing when the ceiling is empty, and says what it removed", () => {
		const ctx = fakeCtx("child-empty-ceiling");
		const { pi, state } = childPi(["python", "todowrite"], ["python", "todowrite"]);
		const report = reconcileChildSurface({ pi, ctx, ceiling: [] });
		expect(state).toEqual([]);
		expect(report.deactivated).toEqual(["python", "todowrite"]);
	});
});

