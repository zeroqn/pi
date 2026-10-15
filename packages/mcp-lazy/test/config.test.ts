/**
 * The `mcp.json` reader (`src/config.ts`).
 *
 * The one thing worth pinning beyond "it parses" is the project-override rule: a project file is how a
 * repository turns a global server off, so an override of `enabled` must survive the merge and a server
 * that is off must not come back out the other side. Everything else here is the never-throws promise,
 * because this runs on `session_start` in every session.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { readMcpConfig } from "../src/config";

let agentDir: string;
let cwd: string;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "mcp-lazy-agent-"));
	cwd = mkdtempSync(join(tmpdir(), "mcp-lazy-cwd-"));
});

afterEach(() => {
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

function globalConfig(value: unknown): void {
	writeFileSync(join(agentDir, "mcp.json"), typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function projectConfig(value: unknown): void {
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "mcp.json"), typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function read(projectTrusted = false) {
	return readMcpConfig({ agentDir, cwd, projectTrusted });
}

describe("the global file", () => {
	it("returns no servers and no errors for a missing file", () => {
		expect(read()).toEqual({ servers: [], errors: [] });
	});

	it("reads standard `mcpServers` entries and leaves the configs raw", () => {
		globalConfig({
			mcpServers: {
				"docs-api": { command: "npx", args: ["-y", "docs-mcp"] },
			},
		});
		expect(read()).toEqual({
			servers: [{ name: "docs-api", config: { command: "npx", args: ["-y", "docs-mcp"] } }],
			errors: [],
		});
	});

	it("drops an `enabled: false` server so it can never be registered", () => {
		globalConfig({
			mcpServers: {
				off: { command: "true", enabled: false },
				on: { command: "true", enabled: true },
			},
		});
		expect(read().servers.map((server) => server.name)).toEqual(["on"]);
	});

	it("treats a file with no `mcpServers` key as no servers, not an error", () => {
		globalConfig({ autoEnableCodemode: true });
		expect(read()).toEqual({ servers: [], errors: [] });
	});
});

describe("the project file", () => {
	it("is ignored when the project is not trusted", () => {
		projectConfig({ mcpServers: { "docs-api": { command: "npx" } } });
		expect(read(false).servers).toEqual([]);
	});

	it("overrides only `enabled`, `exposure` and `toolExposure` of the global server of the same name", () => {
		globalConfig({
			mcpServers: { "docs-api": { command: "npx", args: ["docs"], env: { TOKEN: "x" } } },
		});
		projectConfig({ mcpServers: { "docs-api": { exposure: "direct" } } });
		expect(read(true)).toEqual({
			servers: [
				{
					name: "docs-api",
					config: { command: "npx", args: ["docs"], env: { TOKEN: "x" }, exposure: "direct" },
				},
			],
			errors: [],
		});
	});

	it("lets a project turn a global server off, and keeps the global entry's credentials", () => {
		globalConfig({ mcpServers: { "docs-api": { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } } } });
		projectConfig({ mcpServers: { "docs-api": { enabled: false } } });
		expect(read(true)).toEqual({ servers: [], errors: [] });
	});

	it("reports an override of a server no global file defines", () => {
		projectConfig({ mcpServers: { ghost: { enabled: false } } });
		const { servers, errors } = read(true);
		expect(servers).toEqual([]);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('"ghost"');
	});

	it("reports an override that sets a key beyond the three", () => {
		globalConfig({ mcpServers: { "docs-api": { command: "npx" } } });
		projectConfig({ mcpServers: { "docs-api": { enabled: false, description: "nope" } } });
		const { errors } = read(true);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("override can only set");
	});
});

describe("malformed input never throws", () => {
	it("reports invalid JSON as an error string", () => {
		globalConfig("{ not json");
		const { servers, errors } = read();
		expect(servers).toEqual([]);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain(join(agentDir, "mcp.json"));
	});

	it("reports a non-object `mcpServers`", () => {
		globalConfig({ mcpServers: ["docs"] });
		const { errors } = read();
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('"mcpServers"');
	});

	it("reports a server entry that is not an object", () => {
		globalConfig({ mcpServers: { "docs-api": "npx docs" } });
		const { errors } = read();
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('"docs-api"');
	});
});
