import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeResultUrl, parseDuckDuckGo, searchDuckDuckGo } from "../providers/duckduckgo";
import { parseAnySearch, searchAnySearch } from "../providers/anysearch";

/** Recorded from the live endpoint before the parser was written (34 KB, first page). */
const ddgFixture = readFileSync(join(import.meta.dir, "fixtures", "duckduckgo.html"), "utf8");

const ddgSnippetHtml = `
<html><body>
  <div class="result result--ad"><a class="result__a" href="https://ads.example/">Buy something</a></div>
  <div class="result">
    <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone&amp;rut=abc">First result</a>
    <a class="result__snippet">The first snippet.</a>
  </div>
  <div class="result">
    <a class="result__a" href="https://two.example/page">Second result</a>
    <a class="result__snippet">The second snippet.</a>
  </div>
  <div class="result"><a class="result__a" href="https://three.example/">Third</a></div>
</body></html>`;

describe("DuckDuckGo parsing (ticket 07's fixtures)", () => {
	it("reads the shape a live response actually has", () => {
		const { results, parseable } = parseDuckDuckGo(ddgFixture, 5);
		expect(parseable).toBeGreaterThanOrEqual(5);
		expect(results).toHaveLength(5);
		for (const result of results) {
			expect(result.title.length).toBeGreaterThan(0);
			expect(result.url).toMatch(/^https?:\/\//);
			expect(result.url).not.toContain("duckduckgo.com");
			expect(result.content).toBe("");
		}
		expect(results[0]!.snippet.length).toBeGreaterThan(0);
	});

	it("decodes the uddg redirect, skips ads, and honours the limit", () => {
		const { results, parseable } = parseDuckDuckGo(ddgSnippetHtml, 2);
		expect(parseable).toBe(3);
		expect(results).toHaveLength(2);
		expect(results[0]!.url).toBe("https://example.com/one");
		expect(results[0]!.title).toBe("First result");
		expect(results[1]!.url).toBe("https://two.example/page");
		expect(results.map((result) => result.title)).not.toContain("Buy something");
		expect(decodeResultUrl("javascript:alert(1)")).toBeNull();
	});

	it("fails when the page shape changes, rather than returning an empty list", async () => {
		const fetchImpl = (async () => new Response("<html><body>nothing here</body></html>", { status: 200 })) as unknown as typeof fetch;
		await expect(searchDuckDuckGo("q", { numResults: 5, timeoutMs: 1_000, fetchImpl })).rejects.toThrow(/no parseable results/);
	});

	it("maps HTTP failures and timeouts to the contract's types", async () => {
		const notOk = (async () => new Response("blocked", { status: 429 })) as unknown as typeof fetch;
		const httpError = (await searchDuckDuckGo("q", { numResults: 5, timeoutMs: 1_000, fetchImpl: notOk }).catch((error: unknown) => error)) as Error;
		expect(httpError.name).toBe("OSError");
		expect(httpError.message).toMatch(/HTTP 429/);

		const timingOut = (async () => {
			throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
		}) as unknown as typeof fetch;
		const timedOut = (await searchDuckDuckGo("q", { numResults: 5, timeoutMs: 1_000, fetchImpl: timingOut }).catch((error: unknown) => error)) as Error;
		expect(timedOut.name).toBe("TimeoutError");
	});
});

describe("AnySearch parsing (ticket 03: X-API-Key, not Bearer)", () => {
	const payload = {
		code: 0,
		message: "success",
		data: {
			results: [
				{ title: "One", url: "https://one.example/", snippet: "s1", content: "short extract" },
				{ title: "Two", url: "https://two.example/", snippet: "s2" },
			],
			metadata: { total_results: 2, search_time_ms: 1660 },
		},
	};

	it("keeps the content extract, defaulting it to an empty string", () => {
		const results = parseAnySearch(payload, 5);
		expect(results).toHaveLength(2);
		expect(results[0]).toEqual({ title: "One", url: "https://one.example/", snippet: "s1", content: "short extract" });
		expect(results[1]!.content).toBe("");
	});

	it("fails loudly on a bad envelope rather than returning junk", () => {
		expect(() => parseAnySearch({ code: -1, message: "Invalid API key" }, 5)).toThrow(/code -1 — Invalid API key/);
		expect(() => parseAnySearch({ code: 0, data: {} }, 5)).toThrow(/data.results to be an array/);
		expect(() => parseAnySearch({ code: 0, data: { results: [{ title: "x" }] } }, 5)).toThrow(/string title and url/);
		expect(() => parseAnySearch([], 5)).toThrow(/expected a JSON object/);
	});

	it("sends the key as X-API-Key", async () => {
		let seen: { url: string; headers: Headers } | null = null;
		const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
			seen = { url: String(input), headers: new Headers(init?.headers) };
			return Response.json(payload);
		}) as unknown as typeof fetch;
		const results = await searchAnySearch("q", { numResults: 5, timeoutMs: 1_000, apiKey: "secret-key", fetchImpl });
		expect(results).toHaveLength(2);
		expect(seen!.url).toBe("https://api.anysearch.com/v1/search");
		expect(seen!.headers.get("x-api-key")).toBe("secret-key");
		expect(seen!.headers.get("authorization")).toBeNull();
	});

	it("reports a missing key as a provider failure the caller can record", async () => {
		const error = (await searchAnySearch("q", { numResults: 5, timeoutMs: 1_000, apiKey: null }).catch((caught: unknown) => caught)) as Error;
		expect(error.name).toBe("OSError");
		expect(error.message).toMatch(/no anysearchApiKey in web-search\.json/);
	});
});
