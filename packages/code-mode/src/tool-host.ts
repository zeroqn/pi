/**
 * The per-cell `tool` host function: what a cell reaches when it calls a capability that is not
 * one of the kernel's own base names.
 *
 * Two capabilities share the one name, and this module composes them because a cell cannot see the
 * difference:
 *
 *  - **A published owner tool** — what a session's contributors publish for a cell
 *    (`packages/tool-bridge/src/adapter.ts`, `toolHostFn`). That function already exists and its
 *    behaviour is unchanged: `tool()` lists the catalogue, `tool(name, ...)` runs one, and an
 *    unpublished name raises the `NameError` that lists what is published.
 *  - **An MCP tool** — an `mcp__<server>__<tool>` name pi has registered with exposure `codemode`.
 *    It is callable through `ctx.executeTool` (pi's `ExtensionToolContext`, `runner.ts:968-993`)
 *    even though it is never declared to the model, which keeps the model-facing surface exactly
 *    `python` while a cell can still reach the server. Nested dispatch goes through pi's normal
 *    tool pipeline (`agent-session.ts:728-765`), so extension `tool_call` hooks run and usage is
 *    recorded under `parentToolCallId`.
 *
 * **Why only `mcp__` names go through `ctx.executeTool`.** A `tool(...)` call reaches the kernel's
 * read-only/egress guard as the name `tool` — `guarded` asks the policy with `{name, args}`
 * (`src/host.ts`), and the policy cannot see which pi tool would really run. If this route also
 * dispatched native tools (`bash`, `read`, `edit`, `write`) or another extension's tool, a cell
 * could run them *around* the kernel's own guarded host functions (`bash_host`, `read_text`, `py`),
 * which is the one thing the guard exists to prevent. MCP tools are the exception that makes the
 * route worth having: they have no kernel-side host function of their own, and `mcp__` names are
 * pi's own naming for them, so the restriction is checkable from the name alone.
 *
 * Nothing here is contributed and nothing here is a `Contribution` field: the composition happens
 * once per cell, in `kernel.ts`, because the owner `tool` is per-session while the dispatch target
 * is the ctx of the tool call running that cell.
 */
import type { HostFns } from "./journal";

/** The prefix pi gives every tool an MCP server registers (`isMcpToolName`). */
const MCP_PREFIX = "mcp__";

/** A tool name pi reports as callable, from `ctx.tools`/`ctx.getAllTools`-shaped objects. */
function namesOf(tools: unknown): string[] {
	if (!Array.isArray(tools)) return [];
	const names: string[] = [];
	for (const tool of tools) {
		const name = (tool as { name?: unknown } | null)?.name;
		if (typeof name === "string" && name.length > 0) names.push(name);
	}
	return names;
}

/**
 * The names pi reports as callable this cell, or `null` when the ctx carries no registry at all.
 *
 * `ctx.tools` is a **getter** that asserts the runner is active (`runner.ts:972-977`): a throw is
 * read as "no registry", because a surface that cannot list is still allowed to exist — a later
 * call re-reads it — and a throwing getter must not fail the cell before it starts.
 */
function callableNames(ctx: unknown): string[] | null {
	if (ctx === null || ctx === undefined) return null;
	let tools: unknown;
	try {
		tools = (ctx as { tools?: unknown }).tools;
	} catch {
		return null;
	}
	if (!Array.isArray(tools)) return null;
	return namesOf(tools);
}

/** The ctx's dispatcher, if it has one. `ctx.executeTool` is what runs a nested pi call. */
function executeToolOf(ctx: unknown): ((name: string, args: unknown) => Promise<unknown>) | null {
	const fn = (ctx as { executeTool?: unknown } | null | undefined)?.executeTool;
	return typeof fn === "function" ? (fn as (name: string, args: unknown) => Promise<unknown>) : null;
}

/**
 * Whether this ctx can host the route at all: it has a dispatcher, or at least a registry to list.
 * A ctx with neither leaves the contributed map exactly as it was, so a session pi handed no tool
 * context behaves as it did before this existed.
 */
function canDispatch(ctx: unknown): boolean {
	return executeToolOf(ctx) !== null || callableNames(ctx) !== null;
}

function isNameError(error: unknown): boolean {
	return (error as { name?: unknown } | null)?.name === "NameError";
}

/**
 * The parameters a cell passed. Monty delivers a Python host function's keyword arguments as one
 * trailing object and a positional dict as a `Map`, which `plainArgs` has already flattened
 * (`src/host.ts`); nothing else is a parameter object. Matches `toolHostFn`'s own reading, so
 * `tool(name, arg="x")` and `tool(name, {"arg": "x"})` reach the tool the same way.
 */
function paramsOf(value: unknown): unknown {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * An MCP tool's own text, verbatim (the same rule `toolHostFn` keeps: a refusal the tool returns is
 * an answer the model must read, not an exception). `executeTool` answers an
 * `AgentToolCallOutcome` — `{ toolCall, result: { content }, isError }` — while a stubbed or
 * older dispatcher may answer the result itself or a bare string.
 */
function textOf(answer: unknown): string {
	if (typeof answer === "string") return answer;
	const holder = answer as { result?: { content?: unknown }; content?: unknown } | null;
	const content = holder?.result?.content ?? holder?.content;
	const parts: string[] = [];
	let nonText = 0;
	if (Array.isArray(content)) {
		for (const part of content) {
			if (typeof part === "string") {
				parts.push(part);
				continue;
			}
			const text = (part as { text?: unknown } | null)?.text;
			if (typeof text === "string") parts.push(text);
			else nonText += 1;
		}
	}
	if (parts.length > 0) return parts.join("\n");
	return nonText > 0
		? `(no text; the tool returned ${nonText} non-text part${nonText === 1 ? "" : "s"})`
		: "";
}

/** Sets the Python exception name monty maps a thrown error by (`@pydantic/monty` `jsErrorParts`). */
function named(error: Error, name: string): Error {
	error.name = name;
	return error;
}

/**
 * The listing: the owner catalogue when one is published, then the MCP names pi reports. The owner
 * text is returned **unchanged** when there are no MCP names, so a session without MCP tools keeps
 * the exact listing text it had before this route existed.
 */
async function renderListing(published: HostFns[string] | undefined, mcp: string[]): Promise<string> {
	const owner = published ? String(await published()) : "";
	if (mcp.length === 0) return owner || "No tools are callable for this session.";
	const section = `MCP tools (call as await tool("<name>", ...)):\n${mcp.map((name) => `  ${name}`).join("\n")}`;
	return owner ? `${owner}\n${section}` : section;
}

/**
 * A name pi would happily run, but not through this route. A `NameError` for the same reason
 * `toolHostFn` uses one — monty maps it to a catchable Python exception and the message is the one
 * the model is holding — with the mechanism spelled out, because "no such tool" would be a lie.
 */
function refusedThroughToolPath(name: string): Error {
	return named(
		new Error(
			`tool("${name}") is refused: tool() dispatches only MCP tools (names starting "${MCP_PREFIX}"), ` +
				"which have no kernel-side host function of their own. A native pi tool cannot be reached " +
				"through tool() because the call reaches the kernel's read-only/egress guard as tool(...) — " +
				"the guard cannot see which tool would really run, so routing native tools here would be a way " +
				"around the kernel's own guarded host functions (bash_host, read_text, ...). Use those instead.",
		),
		"NameError",
	);
}

/**
 * The unknown-name `NameError`. When an owner published a `tool`, its own message already names the
 * owner's tools, so it is reused and the MCP names appended; a session with no owner catalogue gets
 * a message naming the MCP tools alone.
 */
function unknownTool(name: string, mcp: string[], ownerError: unknown): Error {
	// With no MCP names there is nothing to add, so the owner's own `NameError` is re-thrown
	// unchanged: a session without MCP tools must fail a name exactly as it did before this route.
	if (ownerError instanceof Error && mcp.length === 0) return ownerError;
	const ownerMessage = ownerError instanceof Error ? ownerError.message : null;
	const callable = mcp.length > 0 ? `Callable MCP tools in this session: ${mcp.join(", ")}.` : "No tools are callable for this session.";
	const message = ownerMessage === null ? `no tool named '${name}'. ${callable}` : `${ownerMessage} ${callable}`;
	return named(new Error(message), "NameError");
}

/**
 * The contributed map with the one `tool` host function composed in.
 *
 * The owner `tool` (when contributors published one) is called **first** for a named call, which is
 * what makes a published name win. Code mode cannot see an owner's catalogue — `tool-bridge`
 * gathers it per session and only its closure holds it — so "is this name published?" is asked by
 * calling and reading the `NameError` an unpublished name produces. Only that error falls through;
 * any other fault is the tool's own and is re-raised untouched.
 */
export function withToolDispatch(contributed: HostFns, ctx: unknown): HostFns {
	if (!canDispatch(ctx)) return contributed;
	const published = contributed.tool;
	const callable = callableNames(ctx) ?? [];
	const mcp = callable.filter((name) => name.startsWith(MCP_PREFIX));
	const executeTool = executeToolOf(ctx);

	const tool = async (...args: unknown[]): Promise<unknown> => {
		if (args.length === 0) return renderListing(published, mcp);
		const requested = args[0];
		if (typeof requested !== "string" || requested.length === 0) {
			throw new TypeError(
				`tool() takes a tool name: await tool() lists what is callable, await tool("<name>", ...) calls one. Got ${typeof requested}.`,
			);
		}

		// A published owner tool wins, and keeps its own behaviour (including the arguments it
		// receives: the whole arg list is passed through, exactly as before).
		let ownerError: unknown;
		if (published) {
			try {
				return await published(...args);
			} catch (error) {
				if (!isNameError(error)) throw error;
				ownerError = error;
			}
		}

		// The MCP route, and only it: `mcp__` names are pi's own for MCP tools, and the restriction
		// is what keeps a native tool from bypassing the kernel's guarded host functions.
		if (requested.startsWith(MCP_PREFIX)) {
			if (executeTool && mcp.includes(requested)) return textOf(await executeTool(requested, paramsOf(args[1])));
			// An `mcp__` name pi does not report: the ordinary unknown-name answer, never the
			// native refusal (the name says it is an MCP tool; it just is not one this ctx has).
			throw unknownTool(requested, mcp, ownerError);
		}
		// A callable name that is not an MCP tool is the refusal this route's restriction exists
		// for; anything else keeps the existing unknown-name behaviour.
		if (callable.includes(requested)) throw refusedThroughToolPath(requested);
		throw unknownTool(requested, mcp, ownerError);
	};

	return { ...contributed, tool };
}
