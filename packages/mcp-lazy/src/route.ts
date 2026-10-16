/**
 * The route a cell calls: mcp-lazy's one publication into tool-bridge's owners slot
 * (wayfinder ticket 02, built by ticket 13).
 *
 * The owner is **tool-bridge's `tool`**, not a new host function: publishing here means
 * `await tool("mcp__<server>")` answers that server's inventory — and only that call connects it —
 * while `await tool("mcp__<server>__<tool>")` is not in the catalogue, so tool-bridge raises
 * `NameError` and code-mode's existing MCP dispatch takes it. Nothing in code mode changes.
 *
 * The publication is a **documented literal**, duplicated (a vendor bundle could not resolve a private
 * workspace package): `globalThis[Symbol.for("pi-tool-bridge:owners")]` is a `Map` of
 * `{owner, apiVersion, catalogue(ctx), execute(name, params, ctx)}`. It is keyed by instance and
 * replaces, and everything it holds is resolved per session from the `ctx` it is handed — never from
 * module state, which pi's per-entry jiti instances and the root/child pair would both break.
 */
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";

import { type BridgePublication, type BridgeToolEntry } from "../../tool-bridge/src/convention";
import { type McpConfigRead } from "./config";
import { type InventoryTool, inventoryText, rankedText, toolsOfNamespace } from "./inventory";
import {
	DEFAULT_TOOL_WAIT_MS,
	exposureNotice,
	hasReachableTool,
	mcpNamespace,
	rewriteDisclosedExposure,
	waitForTools,
} from "./registrar";
import { type SessionState, type StatePi, ensureServers, lastPi, noticeOnce, stateFor } from "./state";

/** tool-bridge's owners slot, as a literal both sides agree on. */
const OWNERS_SYMBOL = Symbol.for("pi-tool-bridge:owners");
/** tool-bridge's publication version. */
const BRIDGE_API_VERSION = 1;
/** This package's instance key in the slot. One owner, one key. */
export const PUBLICATION_KEY = "pi-mcp-lazy";

export type RouteDeps = {
	/** The agent directory whose `mcp.json` is read. */
	agentDir: string;
	readConfig?: (options: { agentDir: string; cwd?: string; projectTrusted?: boolean }) => McpConfigRead;
	/** Ticket 02's bound: a named server may connect for this long. */
	connectTimeoutMs?: number;
	pollMs?: number;
};

type KnownServer = { name: string; config: McpServerConfig; configured: boolean };

function safeTools(pi: StatePi | undefined): InventoryTool[] {
	try {
		return (pi?.getAllTools?.() ?? []) as InventoryTool[];
	} catch {
		return [];
	}
}

function safeRegistered(pi: StatePi | undefined): { name: string; config: unknown }[] {
	try {
		return pi?.getMcpServers?.() ?? [];
	} catch {
		return [];
	}
}

function signalOf(ctx: unknown): AbortSignal | undefined {
	try {
		const signal = (ctx as { signal?: unknown } | null)?.signal;
		return signal instanceof AbortSignal ? signal : undefined;
	} catch {
		return undefined;
	}
}

function nameError(name: string, catalogue: readonly string[]): Error {
	const published =
		catalogue.length > 0
			? `Published MCP servers: ${catalogue.join(", ")}.`
			: "No MCP server is configured in this session.";
	const error = new Error(`no MCP server named '${name}'. ${published}`);
	error.name = "NameError";
	return error;
}

/** The one-liner of a server: its config description's first line, else its own instructions once it connected. */
function oneLiner(config: McpServerConfig, tools: readonly InventoryTool[]): string {
	const description = (config as { description?: unknown }).description;
	if (typeof description === "string" && description.trim()) return (description.split("\n", 1)[0] ?? "").trim();
	for (const tool of tools) {
		const instructions = tool.namespace?.instructions;
		if (typeof instructions === "string" && instructions.trim()) return (instructions.split("\n", 1)[0] ?? "").trim();
	}
	return "";
}

/**
 * Every server this session may name: the configured ones plus the ones another extension registered.
 *
 * A config that leaves no reachable tool is left out (ticket 17's `hidden` decision): naming it would
 * invite a call that can only answer "no tools", and `hidden` is the human asking for exactly that. Both
 * layers use this one function, so they always name the same set.
 */
function knownServers(state: SessionState, pi: StatePi | undefined): KnownServer[] {
	const known = new Map<string, KnownServer>();
	for (const server of state.servers ?? []) {
		if (!hasReachableTool(server.config)) continue;
		known.set(server.name, { name: server.name, config: server.config, configured: true });
	}
	for (const server of safeRegistered(pi)) {
		if (known.has(server.name)) continue;
		if (!hasReachableTool(server.config as McpServerConfig)) continue;
		known.set(server.name, { name: server.name, config: server.config as McpServerConfig, configured: false });
	}
	return [...known.values()];
}

/**
 * The publication itself. `catalogue` never connects anything (the two-layer split is the whole point);
 * `execute` connects exactly the one server it was asked about.
 */
export function createPublication(deps: RouteDeps): BridgePublication {
	const timeoutMs = deps.connectTimeoutMs ?? DEFAULT_TOOL_WAIT_MS;

	function prepare(state: SessionState, ctx: unknown): StatePi | undefined {
		ensureServers(state, ctx, { agentDir: deps.agentDir, ...(deps.readConfig ? { readConfig: deps.readConfig } : {}) });
		return state.pi ?? lastPi();
	}

	return {
		owner: "mcp-lazy",
		apiVersion: BRIDGE_API_VERSION,
		catalogue(ctx: unknown): BridgeToolEntry[] {
			const state = stateFor(ctx);
			const pi = prepare(state, ctx);
			const tools = safeTools(pi);
			const entries: BridgeToolEntry[] = [];
			for (const server of knownServers(state, pi)) {
				const namespace = mcpNamespace(server.name);
				// The collision guard (ticket 02, accepted): a namespace that is already a callable pi
				// tool name would shadow that tool, because a published owner wins. Skip the namespace
				// entry (one notice) and let code-mode's MCP route dispatch the real tool.
				if (tools.some((tool) => tool.name === namespace)) {
					noticeOnce(
						state,
						ctx,
						`mcp-lazy: MCP server "${server.name}" is not listed: its namespace "${namespace}" is already a callable tool name.`,
					);
					continue;
				}
				const snippet = oneLiner(server.config, toolsOfNamespace(tools, namespace));
				entries.push(snippet ? { name: namespace, snippet } : { name: namespace });
			}
			return entries;
		},
		async execute(name: string, params: Record<string, unknown>, ctx: unknown): Promise<string> {
			const state = stateFor(ctx);
			const pi = prepare(state, ctx);
			const known = knownServers(state, pi);
			const catalogue = known.map((server) => mcpNamespace(server.name));
			const server = known.find((candidate) => mcpNamespace(candidate.name) === name);
			if (!server) throw nameError(name, catalogue);
			if (!pi) return `mcp-lazy: MCP server "${server.name}" cannot be reached from this session.`;

			if (server.configured && !state.registered.has(server.name)) {
				state.registered.add(server.name);
				const prepared = rewriteDisclosedExposure(server.config);
				if (prepared.changed) noticeOnce(state, ctx, exposureNotice(server.name, prepared.tools));
				try {
					pi.registerMcpServer?.(server.name, prepared.config);
				} catch (error) {
					return `mcp-lazy: MCP server "${server.name}" could not be registered: ${error instanceof Error ? error.message : String(error)}`;
				}
			}

			const namespace = mcpNamespace(server.name);
			const signal = signalOf(ctx);
			const ready = await waitForTools(pi as { getAllTools(): readonly { name: string }[] }, namespace, {
				...(signal ? { signal } : {}),
				timeoutMs,
				...(deps.pollMs === undefined ? {} : { pollMs: deps.pollMs }),
			});
			const tools = toolsOfNamespace(safeTools(pi), namespace);
			if (tools.length === 0) {
				return ready
					? `mcp-lazy: MCP server "${server.name}" connected but reports no tools.`
					: `mcp-lazy: MCP server "${server.name}" did not answer within ${Math.round(timeoutMs / 1000)}s; it stays registered and may still connect. Try again.`;
			}
			const queryValue = params?.query;
			const query = typeof queryValue === "string" ? queryValue : "";
			if (query.trim() === "") return inventoryText(namespace, tools);
			const limitValue = params?.limit;
			return rankedText(namespace, tools, query, typeof limitValue === "number" ? limitValue : undefined);
		},
	};
}

/** Publish (or republish) this instance's offer. Idempotent: a re-import replaces the same key. */
export function publishMcpRoute(deps: RouteDeps): BridgePublication {
	const holder = globalThis as Record<symbol, unknown>;
	const existing = holder[OWNERS_SYMBOL];
	const slot =
		existing instanceof Map ? (existing as Map<string, BridgePublication>) : new Map<string, BridgePublication>();
	if (!(existing instanceof Map)) holder[OWNERS_SYMBOL] = slot;
	const publication = createPublication(deps);
	slot.set(PUBLICATION_KEY, publication);
	return publication;
}
