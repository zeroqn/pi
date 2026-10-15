/**
 * The `tool()` host function's MCP half (`src/tool-host.ts`).
 *
 * The route exists so a cell can call an `mcp__*` tool pi registered with exposure `codemode` — a
 * tool the model never sees — without a kernel-side host function for every server. These tests pin
 * the dispatcher alone, with a spy for `ctx.executeTool` and a fake owner `tool` standing in for
 * `tool-bridge`, because what matters here is the composition: a published name still wins, an
 * `mcp__` name reaches `executeTool`, and a native pi tool is refused rather than routed around the
 * kernel's guard.
 */
import { describe, expect, it } from "bun:test";
import { type HostFns } from "../src/journal";
import { withToolDispatch } from "../src/tool-host";

/** A ctx shaped like pi's `ExtensionToolContext`: a callable `tools` getter and an `executeTool`. */
function fakeCtx(names: string[]) {
	const calls: Array<[string, unknown]> = [];
	const ctx = {
		get tools() {
			return names.map((name) => ({ name }));
		},
		async executeTool(name: string, args: unknown) {
			calls.push([name, args]);
			return { toolCall: { name }, result: { content: [{ type: "text", text: `ran ${name}` }] }, isError: false };
		},
	};
	return { ctx, calls };
}

const CATALOGUE = "probe:\n  ctx_note — a note (params: action)";

/** A stand-in for `tool-bridge`'s `toolHostFn`: lists its catalogue, runs published names, and
 *  raises the `NameError` an unpublished name gets. */
function ownerTool(published: string[]) {
	const calls: unknown[][] = [];
	const fn = async (...args: unknown[]): Promise<unknown> => {
		calls.push(args);
		if (args.length === 0) return CATALOGUE;
		const name = String(args[0]);
		if (!published.includes(name)) {
			const error = new Error(`no tool named '${name}'. Published in this session: ${published.join(", ")}.`);
			error.name = "NameError";
			throw error;
		}
		return `owner ran ${name}`;
	};
	return { fn: fn as HostFns[string], calls };
}

async function caught(fn: () => Promise<unknown>): Promise<Error> {
	try {
		await fn();
	} catch (error) {
		return error as Error;
	}
	throw new Error("expected a rejection");
}

describe("the per-cell tool() route", () => {
	it("does not exist when the ctx carries neither a dispatcher nor a registry", () => {
		const contributed: HostFns = { tool: async () => "owner" };
		expect(withToolDispatch(contributed, undefined)).toBe(contributed);
		expect(withToolDispatch({}, {})).toEqual({});
	});

	it("exists with no ledger `tool` at all when the ctx can dispatch", async () => {
		const { ctx } = fakeCtx(["mcp__docs__search"]);
		const host = withToolDispatch({}, ctx);
		expect(typeof host.tool).toBe("function");
		expect(await host.tool("mcp__docs__search")).toBe("ran mcp__docs__search");
	});

	it("lists the published catalogue and the callable MCP names together", async () => {
		const { ctx } = fakeCtx(["python", "mcp__docs__search", "mcp__fs__read"]);
		const { fn } = ownerTool(["ctx_note"]);
		const text = String(await withToolDispatch({ tool: fn }, ctx).tool());
		expect(text).toContain("ctx_note");
		expect(text).toContain("mcp__docs__search");
		expect(text).toContain("mcp__fs__read");
		// The MCP names are only the mcp ones: `python` is callable but not an MCP tool.
		expect(text).not.toContain("python");
	});

	it("keeps the owner's listing text unchanged when there are no MCP names", async () => {
		const { ctx } = fakeCtx(["python"]);
		const { fn } = ownerTool(["ctx_note"]);
		expect(await withToolDispatch({ tool: fn }, ctx).tool()).toBe(CATALOGUE);
	});
});

describe("tool(name, ...)", () => {
	it("dispatches an mcp__ name through ctx.executeTool with the parameters", async () => {
		const { ctx, calls } = fakeCtx(["mcp__docs__search"]);
		const host = withToolDispatch({}, ctx);
		expect(await host.tool("mcp__docs__search", { query: "hello" })).toBe("ran mcp__docs__search");
		expect(calls).toEqual([["mcp__docs__search", { query: "hello" }]]);
	});

	it("hands executeTool an empty object when the cell passed no parameters", async () => {
		const { ctx, calls } = fakeCtx(["mcp__docs__search"]);
		await withToolDispatch({}, ctx).tool("mcp__docs__search");
		expect(calls).toEqual([["mcp__docs__search", {}]]);
	});

	it("lets a published owner name win over the MCP route", async () => {
		const { ctx, calls } = fakeCtx(["mcp__docs__search"]);
		const { fn, calls: ownerCalls } = ownerTool(["ctx_note"]);
		const host = withToolDispatch({ tool: fn }, ctx);
		expect(await host.tool("ctx_note", { action: "read" })).toBe("owner ran ctx_note");
		expect(ownerCalls).toEqual([["ctx_note", { action: "read" }]]);
		expect(calls).toEqual([]);
	});

	it("still dispatches an mcp__ name when an owner tool is published but does not hold it", async () => {
		const { ctx, calls } = fakeCtx(["mcp__docs__search"]);
		const { fn } = ownerTool(["ctx_note"]);
		expect(await withToolDispatch({ tool: fn }, ctx).tool("mcp__docs__search", { query: "x" })).toBe("ran mcp__docs__search");
		expect(calls).toEqual([["mcp__docs__search", { query: "x" }]]);
	});

	it("refuses a callable native name with the reason, without calling executeTool", async () => {
		const { ctx, calls } = fakeCtx(["bash", "mcp__docs__search"]);
		const error = await caught(() => withToolDispatch({}, ctx).tool("bash"));
		expect(error.name).toBe("NameError");
		expect(error.message).toContain("bash");
		expect(error.message).toContain("only MCP tools");
		expect(error.message).toContain("guarded host functions");
		expect(calls).toEqual([]);
	});

	it("answers an mcp__ name this ctx does not report with the unknown-name error, not the native refusal", async () => {
		const { ctx } = fakeCtx(["python"]);
		const error = await caught(() => withToolDispatch({}, ctx).tool("mcp__gone__tool"));
		expect(error.name).toBe("NameError");
		expect(error.message).toContain("no tool named 'mcp__gone__tool'");
		expect(error.message).not.toContain("only MCP tools");
	});

	it("names what is callable when the name is not an MCP tool and no owner published it", async () => {
		const { ctx } = fakeCtx(["mcp__docs__search"]);
		const error = await caught(() => withToolDispatch({}, ctx).tool("nope"));
		expect(error.name).toBe("NameError");
		expect(error.message).toContain("no tool named 'nope'");
		expect(error.message).toContain("mcp__docs__search");
	});

	it("appends the MCP names to the owner's own unknown-name error", async () => {
		const { ctx } = fakeCtx(["mcp__docs__search"]);
		const { fn } = ownerTool(["ctx_note"]);
		const error = await caught(() => withToolDispatch({ tool: fn }, ctx).tool("nope"));
		expect(error.name).toBe("NameError");
		expect(error.message).toContain("ctx_note");
		expect(error.message).toContain("mcp__docs__search");
	});

	it("re-throws the owner's unknown-name error unchanged when there are no MCP names", async () => {
		const { ctx } = fakeCtx(["python"]);
		const { fn } = ownerTool(["ctx_note"]);
		const error = await caught(() => withToolDispatch({ tool: fn }, ctx).tool("nope"));
		expect(error.name).toBe("NameError");
		expect(error.message).toBe("no tool named 'nope'. Published in this session: ctx_note.");
	});

	it("leaves a fault from the owner's executor alone rather than retrying it as unknown", async () => {
		const { ctx, calls } = fakeCtx(["mcp__docs__search"]);
		const fault = new Error("executor exploded");
		const host = withToolDispatch(
			{
				tool: async () => {
					throw fault;
				},
			},
			ctx,
		);
		const error = await caught(() => host.tool("todos", {}));
		expect(error).toBe(fault);
		expect(calls).toEqual([]);
	});

	it("refuses a non-string name the way the owner tool does", async () => {
		const { ctx } = fakeCtx(["mcp__docs__search"]);
		const error = await caught(() => withToolDispatch({}, ctx).tool(7));
		expect(error).toBeInstanceOf(TypeError);
	});
});
