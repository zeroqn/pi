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
	createMcpExtension,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";

import {
	API_VERSION,
	type ContributorRegistration,
	registerContributor,
} from "../host-bridge/src/convention";
import { type LoadedServer, readMcpConfig } from "./src/config";
import { registerReachedServers } from "./src/registrar";

/** This package's instance key in host-bridge's contributor registry. Re-registering under it replaces. */
const KEY = "pi-mcp-lazy";

/**
 * Published at module load, like every contributor: a spawned child loads no ambient extensions, so its
 * composition is served by the registrations this process already holds (`host-bridge/src/compose.ts`,
 * `childFactories`).
 *
 * **`childFactories` is the only field this package needs**, and it is the whole point of registering:
 * a child's loader loads the kernel and every contributor's own factories, so without it a child would
 * never load this entry and a cell in a child could not connect an MCP server at all. Declaring
 * `session`/`hostFns`/`childEligible` would be wrong as well as unnecessary — this package contributes
 * nothing to the kernel's surface (a cell does not call a server *through* a host function) and holds
 * no pi tool of its own, so there is nothing to contribute, nothing to declare child-eligible, and no
 * system-prompt text to write. What a child needs is exactly what a root session needs: the registrar,
 * and a replacement MCP extension instance on its own `pi`.
 */
export const mcpLazyRegistration: ContributorRegistration = {
	key: KEY,
	owner: "mcp-lazy",
	apiVersion: API_VERSION,
	childFactories: () => [(pi: unknown) => mcpLazy(pi as ExtensionAPI)],
};

registerContributor(mcpLazyRegistration);

/** The factory, on the root manifest's entry or the child loader's factory list. */
export default function mcpLazy(pi: ExtensionAPI): void {
	/** This session's config, read once on `session_start`; a session's `mcp.json` does not change under it. */
	let servers: LoadedServer[] = [];
	/** Servers this session has registered (or tried to), so a later cell does not register them again. */
	const registered = new Set<string>();

	pi.on("session_start", (_event, ctx: ExtensionContext) => {
		registered.clear();
		const read = readMcpConfig({
			agentDir: getAgentDir(),
			cwd: ctx.cwd,
			projectTrusted: ctx.isProjectTrusted(),
		});
		servers = read.servers;
		for (const error of read.errors) notify(ctx, `mcp-lazy: ${error}`);
		return undefined;
	});

	// Registered before the MCP extension's own handlers (see the file comment): inside one extension
	// the handlers run in registration order, so this one runs first.
	pi.on("tool_call", async (event, ctx: ExtensionContext) => {
		if (event.toolName !== "python") return undefined;
		const code = (event.input as { code?: unknown }).code;
		if (typeof code !== "string") return undefined;
		await registerReachedServers(code, {
			pi,
			servers,
			registered,
			signal: ctx.signal,
			onProblem: (text) => notify(ctx, text),
		});
		return undefined;
	});

	createMcpExtension({
		loadConfig: () => ({ servers: [], errors: [], autoEnableCodemode: false }),
	})(pi);
}

/** A notice the human reads; a disposed or UI-less ctx must never fail the cell it was reporting about. */
function notify(ctx: ExtensionContext, text: string): void {
	try {
		ctx.ui.notify(text, "warning");
	} catch {
		/* best effort by definition */
	}
}

