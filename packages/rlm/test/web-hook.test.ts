import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	instantiateWebHook,
	resolveWebHook,
	webDescriptionSuffix,
	webPromptGuidelines,
} from "../src/web-hook";

/**
 * The hook's two moments (map ticket 03): load time decides what the description may
 * promise, kernel start decides what the sandbox actually gets. Both are pure enough
 * to test against a module written on the spot.
 */
function moduleFile(source: string): string {
	const dir = mkdtempSync(join(tmpdir(), "rlm-web-hook-"));
	const file = join(dir, "host.ts");
	writeFileSync(file, source);
	return file;
}

const GOOD = `
export function createHost(ctx: any) {
	return {
		web_search: async (query: string) => ({ query, provider: "stub", results: [], errors: {} }),
		fetch_content: async (url: string) => ({ url, path: "/tmp/stub.md", chars: 0, head: "" }),
	};
}
`;

describe("resolving the hook at load time (ticket 03)", () => {
	it("is silent and absent when RLM_WEB_MODULE is unset or blank", async () => {
		expect(await resolveWebHook({})).toEqual({ status: "none" });
		expect(await resolveWebHook({ RLM_WEB_MODULE: "   " })).toEqual({ status: "none" });
		// Nothing is promised to the model either.
		expect(webDescriptionSuffix({ status: "none" })).toBe("");
		expect(webPromptGuidelines({ status: "none" })).toEqual([]);
	});

	it("loads a module that exports createHost, and lets the description promise it", async () => {
		const file = moduleFile(GOOD);
		const plan = await resolveWebHook({ RLM_WEB_MODULE: file });
		expect(plan.status).toBe("loaded");
		if (plan.status === "loaded") expect(plan.module).toBe(file);
		expect(webDescriptionSuffix(plan)).toContain("web_search");
		expect(webDescriptionSuffix(plan)).toContain("fetch_content");
		expect(webPromptGuidelines(plan).length).toBe(2);
	});

	it("reports a module that throws on import, and promises nothing", async () => {
		const file = moduleFile('throw new Error("boom on import");\n');
		const plan = await resolveWebHook({ RLM_WEB_MODULE: file });
		expect(plan.status).toBe("error");
		if (plan.status === "error") expect(plan.reason).toContain("boom on import");
		expect(webDescriptionSuffix(plan)).toBe("");
		expect(webPromptGuidelines(plan)).toEqual([]);
	});

	it("reports a module with no createHost export", async () => {
		const file = moduleFile("export const other = 1;\n");
		const plan = await resolveWebHook({ RLM_WEB_MODULE: file });
		expect(plan.status).toBe("error");
		if (plan.status === "error") expect(plan.reason).toContain("does not export createHost()");
	});

	it("reports a path that does not exist, without throwing", async () => {
		const plan = await resolveWebHook({ RLM_WEB_MODULE: "/nonexistent/host.ts" });
		expect(plan.status).toBe("error");
		if (plan.status === "error") expect(plan.reason).toContain("import failed");
	});
});

describe("instantiating the hook at kernel start (ticket 03)", () => {
	it("injects exactly the two contract names", async () => {
		const plan = await resolveWebHook({ RLM_WEB_MODULE: moduleFile(GOOD) });
		const web = instantiateWebHook(plan, { cwd: "/w" });
		expect(web.status).toBe("injected");
		if (web.status === "injected") {
			expect(Object.keys(web.fns).sort()).toEqual(["fetch_content", "web_search"]);
			expect(web.names).toEqual(["web_search", "fetch_content"]);
		}
	});

	it("passes the kernel's context through, including a live progress forwarder", async () => {
		const file = moduleFile(`
export function createHost(ctx: any) {
	ctx.progress?.("from the module");
	return { web_search: async () => ctx.cwd, fetch_content: async () => ctx.sessionFile };
}
`);
		const plan = await resolveWebHook({ RLM_WEB_MODULE: file });
		const seen: string[] = [];
		const web = instantiateWebHook(plan, { cwd: "/the-cwd", sessionFile: "/the/session.jsonl", progress: (t) => seen.push(t) });
		expect(web.status).toBe("injected");
		expect(seen).toEqual(["from the module"]);
		if (web.status === "injected") {
			expect(await (web.fns.web_search as () => Promise<string>)()).toBe("/the-cwd");
			expect(await (web.fns.fetch_content as () => Promise<string>)()).toBe("/the/session.jsonl");
		}
	});

	it("refuses a missing name, an extra name, and a non-function", async () => {
		const cases: Array<[string, string]> = [
			["only web_search", "export function createHost() { return { web_search: async () => 1 }; }"],
			["extra name", "export function createHost() { return { web_search: async () => 1, fetch_content: async () => 2, fetch_image: async () => 3 }; }"],
			["not a function", "export function createHost() { return { web_search: 1, fetch_content: async () => 2 }; }"],
			["not an object", "export function createHost() { return null; }"],
			["factory throws", 'export function createHost() { throw new Error("no config"); }'],
		];
		for (const [label, source] of cases) {
			const plan = await resolveWebHook({ RLM_WEB_MODULE: moduleFile(source) });
			const web = instantiateWebHook(plan, { cwd: "/w" });
			expect(`${label}: ${web.status}`).toBe(`${label}: error`);
			if (web.status === "error") expect(web.reason.length).toBeGreaterThan(0);
		}
	});
});
