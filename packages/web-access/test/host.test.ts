import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHost } from "../host";
import piWebAccess from "../host";
import { CLOSE_MARKER, OPEN_MARKER, PREAMBLE } from "../guard";
import type { WebConfig } from "../config";

/** The fence's inverse, for the assertions that predate it: strip the markers a fenced field carries. */
function plain(text: string): string {
	const prefix = `${OPEN_MARKER}${PREAMBLE}\n`;
	const suffix = `\n${CLOSE_MARKER}`;
	return text.startsWith(prefix) && text.endsWith(suffix) ? text.slice(prefix.length, -suffix.length) : text;
}

const config: WebConfig = {
	path: "(test)",
	raw: null,
	providers: ["duckduckgo", "anysearch"],
	anysearchApiKey: "test-key",
	allowRanges: [],
	domainPolicy: { allow: [], deny: [] },
};

function ddgPage(results: Array<{ title: string; url: string; snippet?: string }>): string {
	return `<html><body>${results
		.map(
			(result) =>
				`<div class="result"><a class="result__a" href="${result.url}">${result.title}</a><a class="result__snippet">${result.snippet ?? ""}</a></div>`,
		)
		.join("")}</body></html>`;
}

const anysearchBody = {
	code: 0,
	message: "success",
	data: { results: [{ title: "Any result", url: "https://any.example/", snippet: "from anysearch", content: "extract" }], metadata: {} },
};

/** A fetch that answers by host, and records every URL it was asked for. */
function router(handlers: Record<string, () => Response>) {
	const calls: Array<{ url: string; maxResults?: number }> = [];
	const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const body = init?.body ? String(init.body) : "";
		calls.push({ url, maxResults: body ? (JSON.parse(body) as { max_results?: number }).max_results : undefined });
		for (const [host, handler] of Object.entries(handlers)) {
			if (url.includes(host)) return handler();
		}
		throw new Error(`no handler for ${url}`);
	}) as unknown as typeof fetch;
	return { impl, calls };
}

function makeHost(handlers: Record<string, () => Response>, sessionFile?: string) {
	const { impl, calls } = router(handlers);
	const host = createHost({ cwd: "/tmp", sessionFile, progress: () => {} }, { config, fetchImpl: impl });
	return { host, calls };
}

describe("web_search's arguments (ticket 04)", () => {
	const { host } = makeHost({});

	it("rejects the wrong types as TypeError", async () => {
		await expect(host.web_search(123)).rejects.toThrow(/query must be a string/);
		await expect(host.web_search("q", "5")).rejects.toThrow(/num_results must be a number/);
		await expect(host.web_search("q", 5, 7)).rejects.toThrow(/provider must be a name or a list/);
		await expect(host.web_search("q", 5, ["duckduckgo", 7])).rejects.toThrow(/provider names must be strings/);
		await expect(host.web_search("q", 5, null, "example.com")).rejects.toThrow(/domain_filter must be a list/);
	});

	it("rejects bad values as ValueError, naming what is wrong", async () => {
		await expect(host.web_search("   ")).rejects.toThrow(/query must not be empty/);
		await expect(host.web_search("q", 5, "google")).rejects.toThrow(/unknown provider "google"/);
		await expect(host.web_search("q", 5, [])).rejects.toThrow(/provider list is empty/);
		await expect(host.web_search("q", 5, null, ["nope"])).rejects.toThrow(/not a hostname/);
	});
});

describe("monty's calling convention (found by the first live integration run)", () => {
	it("accepts Python keyword arguments as a trailing object", async () => {
		const { host, calls } = makeHost({ "api.anysearch.com": () => Response.json(anysearchBody) });
		// Exactly what `await web_search("q", num_results=3, provider=["anysearch"])` looks like from JS.
		const byKeyword = await host.web_search("q", { num_results: 3, provider: ["anysearch"] });
		expect(byKeyword.provider).toBe("anysearch");
		expect(calls[0]!.maxResults).toBe(3);
	});

	it("still accepts positionals, and a mix of both", async () => {
		const { host, calls } = makeHost({ "api.anysearch.com": () => Response.json(anysearchBody) });
		await host.web_search("q", 4, ["anysearch"]);
		expect(calls[0]!.maxResults).toBe(4);
		const { host: host2, calls: calls2 } = makeHost({ "api.anysearch.com": () => Response.json(anysearchBody) });
		await host2.web_search("q", { provider: ["anysearch"] });
		expect(calls2[0]!.maxResults).toBe(5);
	});

	it("applies the same convention to fetch_content's mode", async () => {
		const sessionFile = join(mkdtempSync(join(tmpdir(), "pi-web-access-kwargs-")), "session.jsonl");
		const { host } = makeHost({ "example.com": () => new Response("body", { status: 200, headers: { "content-type": "text/plain" } }) }, sessionFile);
		const byKeyword = await host.fetch_content("http://example.com/a.txt", { mode: "raw" });
		expect("bytes" in byKeyword).toBe(true);
		const positional = await host.fetch_content("http://example.com/a.txt", "raw");
		expect("bytes" in positional).toBe(true);
		const defaulted = await host.fetch_content("http://example.com/a.txt");
		expect("chars" in defaulted).toBe(true);
	});
});
describe("provider order and fallback (ticket 04)", () => {
	it("falls through a failing provider and reports it as data, not as an exception", async () => {
		const { host, calls } = makeHost({
			"html.duckduckgo.com": () => new Response("rate limited", { status: 429 }),
			"api.anysearch.com": () => Response.json(anysearchBody),
		});
		const result = await host.web_search("monty python subset");
		expect(result.provider).toBe("anysearch");
		expect(result.results).toHaveLength(1);
		expect(plain(result.results[0]!.content)).toBe("extract");
		expect(result.errors.duckduckgo).toMatch(/HTTP 429/);
		expect(calls.map((call) => call.url.split("/")[2])).toEqual(["html.duckduckgo.com", "api.anysearch.com"]);
	});

	it("honours an explicit provider list and does not call the others", async () => {
		const { host, calls } = makeHost({
			"html.duckduckgo.com": () => new Response(ddgPage([{ title: "DDG", url: "https://ddg.example/" }])),
			"api.anysearch.com": () => Response.json(anysearchBody),
		});
		const result = await host.web_search("q", 5, ["anysearch"]);
		expect(result.provider).toBe("anysearch");
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toContain("api.anysearch.com");
	});

	it("raises RuntimeError only when every provider failed, listing each failure", async () => {
		const { host } = makeHost({
			"html.duckduckgo.com": () => new Response("nope", { status: 500 }),
			"api.anysearch.com": () => new Response("nope", { status: 500 }),
		});
		const error = (await host.web_search("q").catch((caught: unknown) => caught)) as Error;
		expect(error.name).toBe("RuntimeError");
		expect(error.message).toMatch(/every provider failed for "q"/);
		expect(error.message).toMatch(/duckduckgo: .*HTTP 500/);
		expect(error.message).toMatch(/anysearch: .*HTTP 500/);
	});

	it("clamps num_results rather than refusing it, and asks AnySearch for the clamped number", async () => {
		const { host, calls } = makeHost({ "api.anysearch.com": () => Response.json(anysearchBody) });
		await host.web_search("q", 100, ["anysearch"]);
		expect(calls[0]!.maxResults).toBe(20);
		const { host: host2, calls: calls2 } = makeHost({ "api.anysearch.com": () => Response.json(anysearchBody) });
		await host2.web_search("q", 0, ["anysearch"]);
		expect(calls2[0]!.maxResults).toBe(1);
	});
});

describe("domain_filter is applied by us, identically for both providers (ticket 04)", () => {
	const page = ddgPage([
		{ title: "A", url: "https://a.example.com/1" },
		{ title: "B", url: "https://b.example.com/2" },
		{ title: "C", url: "https://other.example/3" },
	]);

	it("keeps only allowed hosts, subdomains included", async () => {
		const { host, calls } = makeHost({ "html.duckduckgo.com": () => new Response(page) });
		const result = await host.web_search("q", 5, null, ["example.com"]);
		expect(result.results.map((entry) => plain(entry.title))).toEqual(["A", "B"]);
		expect(result.errors).toEqual({});
		// Over-fetched, because filtering happens after the provider answers.
		expect(calls[0]!.url).toContain("html.duckduckgo.com");
	});

	it("drops denied hosts, with the - prefix", async () => {
		const { host } = makeHost({ "html.duckduckgo.com": () => new Response(page) });
		const result = await host.web_search("q", 5, null, ["-example.com"]);
		expect(result.results.map((entry) => plain(entry.title))).toEqual(["C"]);
	});

	it("returns a short list rather than an error when nothing survives", async () => {
		const { host } = makeHost({
			"html.duckduckgo.com": () => new Response(page),
			"api.anysearch.com": () => Response.json(anysearchBody),
		});
		const result = await host.web_search("q", 5, null, ["nothing.example"]);
		// both providers were tried, both had nothing that survived, and the answer is empty
		expect(result.results).toEqual([]);
		expect(Object.keys(result.errors).sort()).toEqual(["anysearch", "duckduckgo"]);
		expect(result.errors.duckduckgo).toMatch(/none survived domain_filter/);
	});
});

describe("fetch_content's arguments and scratch (tickets 04 and 05)", () => {
	it("validates url and mode", async () => {
		const { host } = makeHost({});
		await expect(host.fetch_content(7)).rejects.toThrow(/url must be a string/);
		await expect(host.fetch_content("  ")).rejects.toThrow(/url must not be empty/);
		await expect(host.fetch_content("http://example.com/", "text")).rejects.toThrow(/mode must be "markdown" or "raw"/);
	});

	it("spills under the kernel's own scratch, which is what the sandbox mounts", async () => {
		const sessionFile = join(mkdtempSync(join(tmpdir(), "pi-web-access-session-")), "session.jsonl");
		const { host } = makeHost({ "example.com": () => new Response("<html><body><p>hello</p></body></html>", { status: 200, headers: { "content-type": "text/html" } }) }, sessionFile);
		const result = await host.fetch_content("http://example.com/page", "raw");
		if (!("bytes" in result)) throw new Error("expected a raw envelope");
		expect(result.path.startsWith(`${sessionFile}.scratch/web/`)).toBe(true);
	});
});

describe("the kernel route's fence (web-access's own output)", () => {
	it("fences a search result's title, snippet and content, and the error strings", async () => {
		const { host } = makeHost({
			"html.duckduckgo.com": () => new Response("rate limited", { status: 429 }),
			"api.anysearch.com": () => Response.json(anysearchBody),
		});
		const result = await host.web_search("q");
		expect(result.results[0]!.content.startsWith(OPEN_MARKER)).toBe(true);
		expect(result.results[0]!.snippet.startsWith(OPEN_MARKER)).toBe(true);
		expect(result.results[0]!.title.startsWith(OPEN_MARKER)).toBe(true);
		expect(plain(result.results[0]!.content)).toBe("extract");
		expect(result.errors.duckduckgo!.startsWith(OPEN_MARKER)).toBe(true);
		// The caller's own text is not fenced.
		expect(result.query).toBe("q");
	});

	it("fences a fetched page's title and head, leaving path and counts intact", async () => {
		const sessionFile = join(mkdtempSync(join(tmpdir(), "pi-web-access-fence-")), "session.jsonl");
		const { host } = makeHost(
			{
				"example.com": () =>
					new Response("<html><head><title>Hi</title></head><body><p>hello</p></body></html>", {
						status: 200,
						headers: { "content-type": "text/html" },
					}),
			},
			sessionFile,
		);
		const result = await host.fetch_content("http://example.com/page");
		if (!("head" in result)) throw new Error("expected a markdown envelope");
		expect(result.head.startsWith(OPEN_MARKER)).toBe(true);
		expect(result.head).toContain("hello");
		expect(result.title.startsWith(OPEN_MARKER)).toBe(true);
		expect(result.chars).toBeGreaterThan(0);
		expect(result.path.endsWith(".md")).toBe(true);
	});

	it("leaves a raw fetch envelope alone (its bytes carry no text field)", async () => {
		const sessionFile = join(mkdtempSync(join(tmpdir(), "pi-web-access-raw-")), "session.jsonl");
		const { host } = makeHost(
			{ "example.com": () => new Response("body", { status: 200, headers: { "content-type": "text/plain" } }) },
			sessionFile,
		);
		const result = await host.fetch_content("http://example.com/a.txt", "raw");
		if (!("bytes" in result)) throw new Error("expected a raw envelope");
		expect(result.bytes).toBe(4);
		expect(JSON.stringify(result)).not.toContain(OPEN_MARKER);
	});
});

describe("pi install loads the guard too", () => {
	it("registers both guard layers on the extension api", () => {
		const events: string[] = [];
		piWebAccess({ on: (event: string) => events.push(event) } as never);
		expect(events).toEqual(["before_agent_start", "tool_result"]);
	});
});
