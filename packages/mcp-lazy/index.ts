/**
 * mcp-lazy — MCP servers that connect when a cell names one, and never before.
 *
 * pi's built-in MCP extension reads `mcp.json` on `session_start` and connects every enabled server in
 * the background, whether or not the session will ever call one. A code-mode session's model surface is
 * `python` alone, so those connections are paid for and then sit unused, and the extension's discovery
 * bookkeeping can activate the codemode tool underneath code mode's `["python"]` surface.
 *
 * ## How this replaces the built-in (and why it can)
 *
 * Built-in extensions are `replaceable` (`src/extensions/index.ts:11-13`), and `omitReplacedExtensions`
 * leaves one out when another extension registers the same tool, command or flag name
 * (`src/core/resource-loader.ts:116-150`). This extension registers `/mcp` (because it *is* the MCP
 * extension), so `builtin:mcp` is not loaded: no eager connect, and no codemode activation. The one
 * residue is the startup warning that names this replacement, which the operator silences by disabling
 * the built-in (`"extensions": ["-builtin:mcp"]` in `~/.pi/agent/settings.json`; see the README).
 *
 * ## The two discovery layers (map `.scratch/mcp-discovery/`)
 *
 * Since 2026-10-16 this package is also the discovery layer the map built. It contributes:
 *
 *  1. **An eager line per server** — its own `before_agent_start`, registered *after*
 *     `createMcpExtension(...)(pi)` so its write survives the embedded instance's delete (section
 *     ownership is load order). The section is `configured ∪ registered`, one line each, under pi's
 *     4096-char cap with ticket 14's sacrifice order and ticket 12's fits-checked fill-in; it connects
 *     nothing.
 *  2. **A route** — one publication into tool-bridge's owners slot, so `await tool("mcp__<server>")`
 *     answers that server's inventory (and only that call starts it) and `await tool("mcp__<server>__<tool>")`
 *     falls through to code-mode's existing MCP dispatch.
 *  3. **The teaching** — a `session` contribution whose guideline reaches the `python` tool's `<rules>`,
 *     only when the session has a configured server; ticket 08's whole child answer, since a child's
 *     loader already loads this factory.
 *
 * The model-facing surface is unchanged: no pi tool is registered, and `getActiveTools()` stays
 * `["python"]`.
 *
 * ## Why `loadConfig` returns nothing — and the reader lives here
 *
 * The MCP extension's `registeredServers()` skips a registered server whose name matches *any* entry its
 * `loadConfig` returned, as "overridden" (`src/extensions/mcp/index.ts:344-362`). A `loadConfig` that
 * returned the real config would therefore make every registration this package exists to perform dead
 * on arrival. It returns an empty, codemode-free config, and `src/config.ts` reads the two files itself.
 *
 * ## Why the registrar is a `tool_call` handler
 *
 * The cell's own tool call is the one moment the server names are known. `tool_call` carries
 * `{ toolName, input }`, and this one registers every configured server the cell's `code` names before
 * the call runs — then waits, bounded, until that server's tools appear, so the connection is already
 * in flight when the cell's `tool(...)`/MCP call reaches pi. Handlers run in registration order inside
 * one extension (`src/core/extensions/runner.ts:1249-1267`), which is why the handler is registered
 * *before* `createMcpExtension(...)` is invoked below: the server must be connecting before the MCP
 * extension's own `tool_call` handler looks the tool up.
 */
import {
	type ExtensionAPI,
	type ExtensionContext,
	type McpServerConfig,
	createMcpExtension,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";

import {
	API_VERSION,
	type ContributorRegistration,
	registerContributor,
} from "../host-bridge/src/convention";
import { type InventoryTool, namespaceInstructions, toolsOfNamespace } from "./src/inventory";
import { hasReachableTool, registerReachedServers } from "./src/registrar";
import { PUBLICATION_KEY, publishMcpRoute } from "./src/route";
import { MCP_SERVERS_SECTION, type SectionEntry, firstLine, mcpNamespace, sectionText } from "./src/section";
import { ensureServers, forgetSession, notePi, noticeOnce, stateFor } from "./src/state";
import { sessionAnswer } from "./src/teaching";

/** This package's instance key in host-bridge's contributor registry. Re-registering under it replaces. */
const KEY = "pi-mcp-lazy";

/** The section's intro, duplicated in the README's example. Ticket 03's S1. */
export { SECTION_INTRO, ROUTE_GUIDELINE } from "./src/section";

/**
 * Published at module load, like every contributor: a spawned child loads no ambient extensions, so its
 * composition is served by the registrations this process already holds (`host-bridge/src/compose.ts`,
 * `childFactories`).
 *
 * Declaring `session` is ticket 08's whole child answer: a child already loads this factory, so the
 * child gets the guideline, the route and (from the factory) the section with no child-specific code.
 * `childEligible` stays undeclared — this package holds no pi tool for a child's ceiling to carry.
 */
export const mcpLazyRegistration: ContributorRegistration = {
	key: KEY,
	owner: "mcp-lazy",
	apiVersion: API_VERSION,
	session: (input) => sessionAnswer({ ctx: input.ctx }, { agentDir: getAgentDir() }),
	childFactories: () => [(pi: unknown) => mcpLazy(pi as ExtensionAPI)],
};

registerContributor(mcpLazyRegistration);

/** The factory, on the root manifest's entry or the child loader's factory list. */
export default function mcpLazy(pi: ExtensionAPI): void {
	const agentDir = getAgentDir();
	const deps = { agentDir };
	// The route must exist before tool-bridge gathers the owners' catalogues. A factory runs at load
	// (before any session_start), so publishing here is in time for every session this instance serves.
	notePi(pi);
	publishMcpRoute(deps);

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		const state = stateFor(ctx, pi);
		ensureServers(state, ctx, deps);
		for (const error of state.configErrors) noticeOnce(state, ctx, `mcp-lazy: ${error}`);
		return undefined;
	});

	// Registered before the MCP extension's own handlers (see the file comment): inside one extension
	// the handlers run in registration order, so this one runs first.
	pi.on("tool_call", async (event, ctx: ExtensionContext) => {
		if (event.toolName !== "python") return undefined;
		const code = (event.input as { code?: unknown }).code;
		if (typeof code !== "string") return undefined;
		const state = stateFor(ctx, pi);
		ensureServers(state, ctx, deps);
		await registerReachedServers(code, {
			pi,
			servers: state.servers ?? [],
			registered: state.registered,
			signal: ctx.signal,
			onProblem: (text) => noticeOnce(state, ctx, text),
		});
		return undefined;
	});

	createMcpExtension({
		loadConfig: () => ({ servers: [], errors: [], autoEnableCodemode: false }),
	})(pi);

	// **After** the embedded instance: section ownership is load order, and the embedded handler deletes
	// `mcp_servers` in the same turn when its own (empty) list has nothing to say (map Fact 5).
	pi.on("before_agent_start", (event, ctx: ExtensionContext) => {
		writeServersSection(pi, ctx, event);
		return undefined;
	});

	pi.on("session_shutdown", (_event, ctx: ExtensionContext) => {
		forgetSession(ctx);
		return undefined;
	});
}

/**
 * One entry of the section: the config's description, and the server's own instructions as the fill-in.
 *
 * A config that leaves no reachable tool is omitted here as well (ticket 17), so the section and the
 * catalogue name exactly the same set.
 */
function sectionEntries(pi: ExtensionAPI, ctx: ExtensionContext): SectionEntry[] {
	const state = stateFor(ctx, pi);
	ensureServers(state, ctx, { agentDir: getAgentDir() });
	const tools = pi.getAllTools() as InventoryTool[];
	const configs = new Map<string, { description?: unknown }>();
	for (const server of state.servers ?? []) {
		if (hasReachableTool(server.config)) configs.set(server.name, server.config as { description?: unknown });
	}
	for (const server of pi.getMcpServers?.() ?? []) {
		if (configs.has(server.name)) continue;
		if (!hasReachableTool(server.config as McpServerConfig)) continue;
		configs.set(server.name, server.config as { description?: unknown });
	}
	const entries: SectionEntry[] = [];
	for (const [name, config] of [...configs.entries()].sort((a, b) => {
		const an = mcpNamespace(a[0]);
		const bn = mcpNamespace(b[0]);
		return an < bn ? -1 : an > bn ? 1 : 0;
	})) {
		const namespace = mcpNamespace(name);
		const base = firstLine(typeof config.description === "string" ? config.description : "");
		const fill = base ? "" : namespaceInstructions(toolsOfNamespace(tools, namespace), namespace);
		entries.push({ name, base, fill });
	}
	return entries;
}

/** Write (or clear) `mcp_servers`. mcp-lazy is its single writer. */
function writeServersSection(pi: ExtensionAPI, ctx: ExtensionContext, event: unknown): void {
	const sections = (event as { systemPromptOptions?: { sections?: Record<string, string> } } | undefined)
		?.systemPromptOptions?.sections;
	if (!sections || typeof sections !== "object") return;
	const state = stateFor(ctx, pi);
	const entries = sectionEntries(pi, ctx);
	if (entries.length === 0) {
		delete sections[MCP_SERVERS_SECTION];
		return;
	}
	const text = sectionText(entries, state);
	if (text) sections[MCP_SERVERS_SECTION] = text;
	else delete sections[MCP_SERVERS_SECTION];
}

/** Exported for the rare caller that wants the publication key without importing the route. */
export { PUBLICATION_KEY };
