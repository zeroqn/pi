/**
 * The `mcp.json` reader this package needs because the MCP extension must be handed an **empty**
 * config (see `../index.ts` and the README): `createMcpExtension`'s own `registeredServers()` skips a
 * server registered with `pi.registerMcpServer()` whose name matches *any* entry its `loadConfig`
 * returned, as "overridden" (`packages/coding-agent/src/extensions/mcp/index.ts:344-362`). Handing it
 * the real config would therefore make every dynamic registration it is meant to serve dead on
 * arrival, so this reads the same two files and hands the configs over itself, only once a cell names
 * one.
 *
 * The files are pi's own (`src/extensions/mcp/config.ts:145-158`): `<agentDir>/mcp.json`, and — only
 * when the project is trusted — `<cwd>/.pi/mcp.json`. A project entry that defines no server of its
 * own (`command`/`url`/`type` all absent) overrides only `enabled`, `exposure` and `toolExposure` of the
 * global server of the same name, so a repository can turn a server off without restating the
 * credentials the global entry holds.
 *
 * Deliberately **not** reimplemented here: config validation and `${VAR}` / `!command` expansion.
 * `pi.registerMcpServer()` validates the config and the transport resolves the values when it is
 * created (`src/core/extensions/loader.ts:471-489`, `src/extensions/mcp/runtime.ts`), so this hands
 * over raw parsed JSON. A malformed config is reported by `registerMcpServer`, not guessed at twice.
 *
 * Never throws. A missing file is a first run, and unreadable or malformed content is an error string;
 * a session whose `mcp.json` has a stray comma in it must still start and still run cells.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { McpServerConfig } from "@earendil-works/pi-coding-agent";

/** One server the config defines, in the shape `pi.registerMcpServer()` takes. */
export type LoadedServer = { name: string; config: McpServerConfig };

export type McpConfigRead = {
	servers: LoadedServer[];
	/** One line per file that could not be read, or per entry that could not be merged. */
	errors: string[];
};

/** The three keys a project entry may override on a global server (pi's own `OVERRIDE_KEYS`). */
const OVERRIDE_KEYS = ["enabled", "exposure", "toolExposure"] as const;

/** pi's `CONFIG_DIR_NAME`; duplicated as a literal so this module stays free of a runtime pi import. */
const PROJECT_DIR = ".pi";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a project entry is an override of a global server rather than a server definition. */
function isOverride(value: Record<string, unknown>): boolean {
	return value.command === undefined && value.url === undefined && value.type === undefined;
}

type State = { servers: Map<string, LoadedServer>; errors: string[] };

function readFile(path: string, scope: "global" | "project", state: State): void {
	if (!existsSync(path)) return;
	let parsed: unknown;
	try {
		// pi 1.4.0 strips a BOM before parsing its own `mcp.json` (`utils/text.ts` `stripBom`), so a file
		// written by PowerShell or a Windows editor loads there; this reader must not be the one place
		// where the same file is reported malformed.
		parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
	} catch (error) {
		state.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	if (!isRecord(parsed) || (parsed.mcpServers !== undefined && !isRecord(parsed.mcpServers))) {
		state.errors.push(`${path}: expected an object with an "mcpServers" object`);
		return;
	}
	for (const [name, value] of Object.entries(parsed.mcpServers ?? {})) {
		if (!isRecord(value)) {
			state.errors.push(`${path}: server "${name}" must be an object`);
			continue;
		}
		if (scope === "project" && isOverride(value)) {
			const base = state.servers.get(name);
			const extra = Object.keys(value).filter(
				(key) => !(OVERRIDE_KEYS as readonly string[]).includes(key),
			);
			if (!base) {
				state.errors.push(
					`${path}: server "${name}" needs "command" or "url", or a global server to override`,
				);
			} else if (extra.length > 0) {
				state.errors.push(
					`${path}: server "${name}": an override can only set ${OVERRIDE_KEYS.join(", ")}`,
				);
			} else {
				state.servers.set(name, { name, config: { ...base.config, ...value } as unknown as McpServerConfig });
			}
			continue;
		}
		state.servers.set(name, { name, config: value as unknown as McpServerConfig });
	}
}

/**
 * Read the global `mcp.json` and, when the project is trusted and names one, the project's, merging
 * project overrides and dropping every `enabled: false` server — a disabled server is never registered,
 * so it never connects. A missing file is no servers and no error.
 */
export function readMcpConfig(options: {
	agentDir: string;
	cwd?: string;
	projectTrusted?: boolean;
}): McpConfigRead {
	const state: State = { servers: new Map(), errors: [] };
	readFile(join(options.agentDir, "mcp.json"), "global", state);
	if (options.projectTrusted === true && typeof options.cwd === "string" && options.cwd.length > 0) {
		readFile(join(options.cwd, PROJECT_DIR, "mcp.json"), "project", state);
	}
	return {
		servers: [...state.servers.values()].filter((server) => server.config.enabled !== false),
		errors: state.errors,
	};
}
