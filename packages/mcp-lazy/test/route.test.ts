/**
 * The route (tickets 02, 15): the owners-slot publication, its catalogue, its inventory and its ranked
 * form. `readConfig` is injected, so no session and no `mcp.json` are needed — the rules are what these
 * tests pin: listing never connects, a named server connects exactly once, failures answer as text, and
 * only an unknown name raises `NameError`.
 */
import { beforeEach, describe, expect, it } from "bun:test";

import { createPublication } from "../src/route";
import { __resetMcpLazyForTests, notePi } from "../src/state";

const DOCS = { name: "docs-api", config: { command: "npx", args: ["docs"], description: "Test docs server" } };
const OTHER = { name: "other", config: { command: "npx", description: "Other server" } };

type Any = Record<string, any>;

function makeCtx(): Any {
	return {
		sessionManager: { getSessionFile: () => undefined },
		cwd: "/tmp/mcp-lazy-test",
		isProjectTrusted: () => false,
		signal: undefined,
		ui: { notices: [] as string[], notify(text: string) { this.notices.push(text); } },
	};
}

function makeDeps(servers: Any[], extra: Any = {}): Any {
	return {
		agentDir: "/tmp/agent",
		readConfig: () => ({ servers, errors: [] }),
		...extra,
	};
}

function toolFor(server: string, tool: string, description: string, parameters?: unknown): Any {
	const namespace = `mcp__${server.replace(/-/g, "_")}`;
	return {
		name: `${namespace}__${tool}`,
		description,
		...(parameters ? { parameters } : {}),
		namespace: { name: namespace, instructions: "Test docs server instructions." },
	};
}

function makePi(onRegister?: (name: string, config: Any) => Any[]): Any {
	const tools: Any[] = [];
	const registered: Any[] = [];
	return {
		tools,
		registered,
		getAllTools: () => tools.slice(),
		getMcpServers: () => [],
		registerMcpServer(name: string, config: Any) {
			registered.push({ name, config });
			for (const tool of onRegister?.(name, config) ?? []) tools.push(tool);
		},
	};
}

beforeEach(() => {
	__resetMcpLazyForTests();
});

describe("catalogue", () => {
	it("lists one entry per configured server with its one-liner and connects nothing", () => {
		const pi = makePi();
		notePi(pi);
		const entries = createPublication(makeDeps([DOCS, OTHER])).catalogue(makeCtx());
		expect(entries.map((entry) => entry.name)).toEqual(["mcp__docs_api", "mcp__other"]);
		expect(entries[0].snippet).toBe("Test docs server");
		expect(pi.registered).toEqual([]);
	});

	it("includes a server another extension registered this session", () => {
		const pi = makePi();
		pi.getMcpServers = () => [{ name: "extra", config: { command: "true", description: "Extra" } }];
		notePi(pi);
		const entries = createPublication(makeDeps([DOCS])).catalogue(makeCtx());
		expect(entries.map((entry) => entry.name)).toEqual(["mcp__docs_api", "mcp__extra"]);
	});

	it("skips a server whose namespace is already a callable pi tool name, and says so once", () => {
		const pi = makePi();
		pi.tools.push({ name: "mcp__a__b" });
		notePi(pi);
		const ctx = makeCtx();
		const entries = createPublication(
			makeDeps([
				{ name: "a", config: { command: "true" } },
				{ name: "a__b", config: { command: "true" } },
			]),
		).catalogue(ctx);
		expect(entries.map((entry) => entry.name)).toEqual(["mcp__a"]);
		expect(ctx.ui.notices.filter((n: string) => n.includes("mcp__a__b"))).toHaveLength(1);
	});
});

describe("inventory", () => {
	it("answers the details of one named server and starts it exactly once", async () => {
		const pi = makePi((name) =>
			name === "docs-api"
				? [toolFor("docs-api", "search", "Search the docs", { type: "object", properties: { query: { type: "string" } }, required: ["query"] })]
				: [],
		);
		notePi(pi);
		const publication = createPublication(makeDeps([DOCS]));
		const text = await publication.execute("mcp__docs_api", {}, makeCtx());
		expect(text).toContain("Test docs server instructions.");
		expect(text).toContain("1 tool:");
		expect(text).toContain("- mcp__docs_api__search - Search the docs");
		expect(text).toContain("params: query (required)");
		expect(pi.registered.map((entry: Any) => entry.name)).toEqual(["docs-api"]);
	});

	it("answers a text sentence, and stays registered, when the server never connects", async () => {
		const pi = makePi();
		notePi(pi);
		const publication = createPublication(makeDeps([DOCS], { connectTimeoutMs: 20, pollMs: 5 }));
		const text = await publication.execute("mcp__docs_api", {}, makeCtx());
		expect(text).toContain('"docs-api"');
		expect(text).toContain("did not answer");
		expect(pi.registered.map((entry: Any) => entry.name)).toEqual(["docs-api"]);
	});

	it("raises NameError only for an unknown name", async () => {
		const pi = makePi();
		notePi(pi);
		const publication = createPublication(makeDeps([DOCS]));
		let error: unknown;
		try {
			await publication.execute("mcp__ghost", {}, makeCtx());
		} catch (caught) {
			error = caught;
		}
		expect((error as Error | undefined)?.name).toBe("NameError");
	});

	it("rewrites a `direct` exposure to codemode and warns once", async () => {
		const pi = makePi((name) => (name === "docs-api" ? [toolFor("docs-api", "search", "Search")] : []));
		notePi(pi);
		const ctx = makeCtx();
		const direct = { name: "docs-api", config: { command: "npx", exposure: "direct" } };
		await createPublication(makeDeps([direct])).execute("mcp__docs_api", {}, ctx);
		expect(pi.registered[0].config.exposure).toBe("codemode");
		expect(ctx.ui.notices.filter((n: string) => n.includes("direct"))).toHaveLength(1);
	});
});

describe("the ranked form (ticket 15)", () => {
	function docsTools(): Any[] {
		const tools: Any[] = [];
		for (let i = 0; i < 39; i++) tools.push(toolFor("docs-api", `doc_${i}`, "Search the docs."));
		tools.push(
			toolFor("docs-api", "read_file", "Read a file from the docs", {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
			}),
		);
		return tools;
	}

	async function connected() {
		const pi = makePi((name) => (name === "docs-api" ? docsTools() : []));
		notePi(pi);
		return createPublication(makeDeps([DOCS]));
	}

	it("returns a shorter ranked list containing the tool a human would expect", async () => {
		const publication = await connected();
		const text = await publication.execute("mcp__docs_api", { query: "read file" }, makeCtx());
		expect(text).toContain("mcp__docs_api__read_file");
		expect(text.split("\n").length).toBeLessThan(40);
	});

	it("bounds the result by `limit` and reports the subset in the header", async () => {
		const publication = await connected();
		const text = await publication.execute("mcp__docs_api", { query: "search", limit: 5 }, makeCtx());
		expect(text.startsWith('5 of 40 tools match "search".')).toBe(true);
		expect(text.split("\n").filter((line) => line.startsWith("- mcp__docs_api__"))).toHaveLength(5);
	});

	it("accepts a limit above the match count", async () => {
		const publication = await connected();
		const text = await publication.execute("mcp__docs_api", { query: "search", limit: 999 }, makeCtx());
		expect(text.startsWith('39 of 40 tools match "search".')).toBe(true);
	});

	it("answers a no-match query with the names only", async () => {
		const publication = await connected();
		const text = await publication.execute("mcp__docs_api", { query: "rotate the moon" }, makeCtx());
		expect(text.startsWith('No tool matches "rotate the moon". 40 tools are listed by name:')).toBe(true);
		expect(text).toContain("mcp__docs_api__read_file");
	});

	it("returns the full inventory for no query, or an empty one", async () => {
		const publication = await connected();
		const ctx = makeCtx();
		const full = await publication.execute("mcp__docs_api", {}, ctx);
		const blank = await publication.execute("mcp__docs_api", { query: "   " }, ctx);
		expect(blank).toBe(full);
	});
});
