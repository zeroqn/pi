/**
 * The reach scan and the registrar (`src/registrar.ts`), on a fake pi.
 *
 * Two claims matter. The scan must not connect a server for a cell that only *mentions* an MCP name —
 * `x_mcp__docs_api__search` is a single word, because `_` is a word character, and a substring test
 * would wrongly match it. And the registrar must register each reached server exactly once per session,
 * including when the registration throws or the wait times out, because both are terminal for the
 * session and neither may fail the cell.
 */
import { describe, expect, it } from "bun:test";

import type { LoadedServer } from "../src/config";
import {
	mcpNamespace,
	registerReachedServers,
	serversReachedBy,
	waitForTools,
} from "../src/registrar";

const DOCS: LoadedServer = { name: "docs-api", config: { command: "npx", args: ["docs"] } };
const WEB: LoadedServer = { name: "web", config: { url: "https://example.com/mcp" } };

describe("the reach scan", () => {
	it("finds a dashed server name through its underscore namespace", () => {
		expect(serversReachedBy('await tool("mcp__docs_api__search", q="x")', [DOCS])).toEqual(["docs-api"]);
	});

	it("finds the namespace inside a tool name that has a dot after it", () => {
		expect(serversReachedBy("mcp__docs_api__search.v2", [DOCS])).toEqual(["docs-api"]);
	});

	it("does not confuse a server with the prefix of another server's namespace", () => {
		const docs: LoadedServer = { name: "docs", config: { command: "npx" } };
		expect(serversReachedBy("mcp__docs_api__search", [docs, DOCS])).toEqual(["docs-api"]);
	});

	it("returns nothing for a cell that names no server", () => {
		expect(serversReachedBy('print("mcp is nice")', [DOCS, WEB])).toEqual([]);
	});

	it("ignores a word that merely contains `mcp__`", () => {
		expect(serversReachedBy("x_mcp__docs_api__search", [DOCS])).toEqual([]);
		expect(serversReachedBy("notmcp__docs_api__search = 1", [DOCS])).toEqual([]);
	});

	it("reports each named server once, in config order", () => {
		expect(serversReachedBy("mcp__docs_api__a mcp__web__b mcp__docs_api__c", [DOCS, WEB])).toEqual([
			"docs-api",
			"web",
		]);
	});
});

describe("mcpNamespace", () => {
	it("is pi's rule: every dash becomes an underscore", () => {
		expect(mcpNamespace("docs-api")).toBe("mcp__docs_api");
		expect(mcpNamespace("docs_api")).toBe("mcp__docs_api");
	});
});

/** A pi whose tool list the test drives, and whose registrations it records. */
function fakePi(initial: string[] = []) {
	const tools = initial.map((name) => ({ name }));
	const calls: { name: string; config: unknown }[] = [];
	return {
		calls,
		tools,
		getAllTools: () => [...tools],
		registerMcpServer(name: string, config: unknown) {
			calls.push({ name, config });
		},
	};
}

describe("waitForTools", () => {
	it("resolves immediately when a tool of the namespace already exists", async () => {
		const pi = fakePi(["mcp__docs_api__search"]);
		expect(await waitForTools(pi, "mcp__docs_api", { timeoutMs: 50, pollMs: 5 })).toBe(true);
	});

	it("resolves once the tools appear", async () => {
		const pi = fakePi();
		setTimeout(() => pi.tools.push({ name: "mcp__docs_api__search" }), 15);
		expect(await waitForTools(pi, "mcp__docs_api", { timeoutMs: 500, pollMs: 5 })).toBe(true);
	});

	it("gives up at the deadline", async () => {
		const pi = fakePi();
		expect(await waitForTools(pi, "mcp__docs_api", { timeoutMs: 30, pollMs: 5 })).toBe(false);
	});

	it("gives up on an aborted signal", async () => {
		const pi = fakePi();
		const controller = new AbortController();
		controller.abort();
		expect(await waitForTools(pi, "mcp__docs_api", { signal: controller.signal, timeoutMs: 500 })).toBe(false);
	});
});

describe("registerReachedServers", () => {
	it("registers each reached server once and waits for its tools", async () => {
		const pi = fakePi();
		setTimeout(() => pi.tools.push({ name: "mcp__docs_api__search" }), 10);
		const problems: string[] = [];
		const registered = new Set<string>();
		const handled = await registerReachedServers('tool("mcp__docs_api__search")', {
			pi,
			servers: [DOCS, WEB],
			registered,
			onProblem: (text) => problems.push(text),
			timeoutMs: 500,
			pollMs: 5,
		});
		expect(handled).toEqual(["docs-api"]);
		expect(pi.calls.map((call) => call.name)).toEqual(["docs-api"]);
		expect(pi.calls[0]?.config).toEqual(DOCS.config);
		expect(problems).toEqual([]);
	});

	it("does not register a server this session already registered", async () => {
		const pi = fakePi();
		const registered = new Set<string>(["docs-api"]);
		await registerReachedServers('tool("mcp__docs_api__search")', {
			pi,
			servers: [DOCS],
			registered,
			onProblem: () => {},
			timeoutMs: 50,
			pollMs: 5,
		});
		expect(pi.calls).toEqual([]);
	});

	it("does not register the same server twice across two cells", async () => {
		const pi = fakePi();
		const registered = new Set<string>();
		const input = { pi, servers: [DOCS], registered, onProblem: () => {}, timeoutMs: 20, pollMs: 5 };
		await registerReachedServers('tool("mcp__docs_api__search")', input);
		await registerReachedServers('tool("mcp__docs_api__search", other=1)', input);
		expect(pi.calls.map((call) => call.name)).toEqual(["docs-api"]);
	});

	it("notifies on a timeout and keeps going", async () => {
		const pi = fakePi();
		const problems: string[] = [];
		const handled = await registerReachedServers('tool("mcp__docs_api__search")', {
			pi,
			servers: [DOCS],
			registered: new Set<string>(),
			onProblem: (text) => problems.push(text),
			timeoutMs: 20,
			pollMs: 5,
		});
		expect(handled).toEqual(["docs-api"]);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("docs-api");
	});

	it("notifies when the registration throws, without waiting", async () => {
		const pi = fakePi();
		pi.registerMcpServer = () => {
			throw new Error("Invalid MCP server");
		};
		const problems: string[] = [];
		const handled = await registerReachedServers('tool("mcp__docs_api__search")', {
			pi,
			servers: [DOCS],
			registered: new Set<string>(),
			onProblem: (text) => problems.push(text),
			timeoutMs: 500,
		});
		expect(handled).toEqual(["docs-api"]);
		expect(problems).toHaveLength(1);
		expect(problems[0]).toContain("Invalid MCP server");
	});

	it("registers nothing for a cell that names no server", async () => {
		const pi = fakePi();
		const handled = await registerReachedServers('print("hello")', {
			pi,
			servers: [DOCS, WEB],
			registered: new Set<string>(),
			onProblem: () => {},
		});
		expect(handled).toEqual([]);
		expect(pi.calls).toEqual([]);
	});
});
