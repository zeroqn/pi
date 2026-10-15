/**
 * The reach scan and the readiness wait: the two pieces of "connect only when a cell names a server"
 * that can be reasoned about without pi (the entry in `../index.ts` is the thin half).
 *
 * ## What "names a server" means
 *
 * A cell reaches an MCP tool by its pi tool name, `mcp__<server>__<tool>`
 * (`src/extensions/mcp/tools.ts:84-93`, `src/core/mcp-servers.ts:155`). Only `-` in the server name is
 * rewritten, to `_`: server `docs-api` owns the namespace `mcp__docs_api`. So the scan tokenizes the
 * cell's source into `[A-Za-z0-9_]+` words and looks for a word beginning with `<namespace>__`. It is
 * *not* a substring test: a word that merely mentions `mcp__` in the middle — `x_mcp__docs__search` is
 * one word, because `_` is a word character — names no server. A false positive here would connect a
 * server for a cell that only printed the name.
 *
 * ## Why the wait is bounded
 *
 * `pi.registerMcpServer()` only records the registration and notifies the runner, whose change listener
 * emits `mcp_servers_change` without awaiting it (`src/core/extensions/runner.ts:464-467`); the MCP
 * extension's own handler then starts the connection. There is no readiness promise and no connected
 * event, so the one honest observable is that `pi.getAllTools()` gains the server's tools. The wait
 * polls for exactly that, and gives up rather than holding the cell: a slow or broken server must cost
 * a warning, never the turn. What it buys is that the server is already connecting before the cell's
 * own call reaches pi's dispatch.
 */
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";

import type { LoadedServer } from "./config";

/** How long to wait for a newly registered server's tools to appear. pi waits 10s at startup. */
export const DEFAULT_TOOL_WAIT_MS = 10_000;

/** How often to re-read `pi.getAllTools()` while waiting. Cheap; only ever one wait at a time. */
export const TOOL_POLL_MS = 25;

/** The namespace pi gives a server's tools: `mcp__<server>` with `-` rewritten to `_`. */
export function mcpNamespace(server: string): string {
	return `mcp__${server.replace(/-/g, "_")}`;
}

/** The little of pi this module touches. Structural, so a test can pass a plain object. */
export type McpRegistrarPi = {
	getAllTools(): readonly { name: string }[];
	registerMcpServer(name: string, config: McpServerConfig): void;
};

/**
 * The configured servers the cell source names, in config order. A server is named when some word of
 * the source begins with its namespace and `__` — i.e. when the cell spells an `mcp__<server>__*` tool
 * name anywhere in its source, including inside a string it would pass to `tool(...)`.
 */
export function serversReachedBy(code: string, servers: readonly { name: string }[]): string[] {
	const words = code.match(/[A-Za-z0-9_]+/g) ?? [];
	const reached: string[] = [];
	for (const server of servers) {
		const prefix = `${mcpNamespace(server.name)}__`;
		if (words.some((word) => word.startsWith(prefix))) reached.push(server.name);
	}
	return reached;
}

/** Sleep, or resolve as soon as `signal` aborts, whichever comes first. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve) => {
		if (!signal) {
			setTimeout(resolve, ms);
			return;
		}
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Poll until a tool whose name begins with `<namespace>__` exists, an abort fires, or the deadline
 * passes. Resolves `true` as soon as one appears, `false` on abort or timeout. `getAllTools()` is the
 * same call the MCP extension itself makes, and a throwing one is treated as "not yet" rather than
 * failing the cell.
 */
export async function waitForTools(
	pi: Pick<McpRegistrarPi, "getAllTools">,
	namespace: string,
	options: { signal?: AbortSignal; timeoutMs?: number; pollMs?: number } = {},
): Promise<boolean> {
	const prefix = `${namespace}__`;
	const present = () => {
		try {
			return pi.getAllTools().some((tool) => tool.name.startsWith(prefix));
		} catch {
			return false;
		}
	};
	if (present()) return true;

	const timeoutMs = options.timeoutMs ?? DEFAULT_TOOL_WAIT_MS;
	const pollMs = options.pollMs ?? TOOL_POLL_MS;
	const deadline = Date.now() + timeoutMs;
	while (!options.signal?.aborted && Date.now() < deadline) {
		await pause(Math.min(pollMs, Math.max(1, deadline - Date.now())), options.signal);
		if (options.signal?.aborted) return false;
		if (present()) return true;
	}
	return false;
}

/** What {@link registerReachedServers} is handed: the pi surface, this session's config and its marks. */
export type RegisterInput = {
	pi: McpRegistrarPi;
	servers: readonly LoadedServer[];
	/** Server names this session already registered, or tried to. Mutated: it is the session's record. */
	registered: Set<string>;
	/** One line for the human — a registration that threw, or a wait that timed out. */
	onProblem: (text: string) => void;
	signal?: AbortSignal;
	/** Overridable for tests. Defaults are the exported constants. */
	timeoutMs?: number;
	pollMs?: number;
};

/**
 * Register every server the cell names that this session has not registered yet, then wait — bounded
 * and abort-aware — until each one's tools appear.
 *
 * A name is added to `registered` **before** the registration is attempted, because both outcomes are
 * terminal for the session: a config `registerMcpServer` rejects is rejected identically on the next
 * cell, and a cell that names many servers must not re-notify about the same one every turn. A
 * registration that threw, and a wait that timed out, each go to `onProblem` and the loop continues;
 * the cell is never failed here, and its own call reports the real error.
 *
 * Returns the names it registered-or-attempted this call, in config order (for tests and records).
 */
export async function registerReachedServers(code: string, input: RegisterInput): Promise<string[]> {
	const reached = serversReachedBy(code, input.servers);
	const handled: string[] = [];
	for (const name of reached) {
		if (input.registered.has(name)) continue;
		input.registered.add(name);
		const server = input.servers.find((candidate) => candidate.name === name);
		if (!server) continue;
		try {
			input.pi.registerMcpServer(name, server.config);
		} catch (error) {
			input.onProblem(
				`mcp-lazy: cannot register MCP server "${name}": ${error instanceof Error ? error.message : String(error)}`,
			);
			handled.push(name);
			continue;
		}
		const ready = await waitForTools(input.pi, mcpNamespace(name), {
			...(input.signal ? { signal: input.signal } : {}),
			...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
			...(input.pollMs === undefined ? {} : { pollMs: input.pollMs }),
		});
		if (!ready) {
			input.onProblem(
				`mcp-lazy: MCP server "${name}" has not connected yet, so its tools are not registered — the call will fail until it does`,
			);
		}
		handled.push(name);
	}
	return handled;
}
