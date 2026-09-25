/**
 * DuckDuckGo — an HTML scrape of `html.duckduckgo.com`, the same endpoint and selectors
 * upstream `pi-web-access` uses (verified from a cell before this was written: 200 with 10
 * parsed `.result__a` anchors). No credential, so it is the default first provider.
 *
 * Results carry `title`, `url` and `snippet`; `content` is always `""` because DuckDuckGo
 * returns no page text (map ticket 04: every result dict has all four keys regardless).
 */

import { parseHTML } from "linkedom";
import { webError } from "../errors";
import type { SearchResult } from "./types";

export const DDG_ENDPOINT = "https://html.duckduckgo.com/html/";

export function decodeResultUrl(href: string): string | null {
	try {
		const link = new URL(href, DDG_ENDPOINT);
		const destination = link.searchParams.get("uddg") ?? link.href;
		const url = new URL(destination);
		return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
	} catch {
		return null;
	}
}

/** Parse a saved response. Kept separate from the request so it can be tested against a
 *  recorded fixture with no network. */
export function parseDuckDuckGo(html: string, limit: number): { results: SearchResult[]; parseable: number } {
	const { document } = parseHTML(html);
	const results: SearchResult[] = [];
	let parseable = 0;
	for (const container of document.querySelectorAll(".result")) {
		if (container.classList?.contains("result--ad")) continue;
		const anchor = container.querySelector(".result__a");
		const title = anchor?.textContent?.trim() ?? "";
		const href = anchor?.getAttribute("href")?.trim() ?? "";
		const url = href ? decodeResultUrl(href) : null;
		if (!title || !url) continue;
		parseable += 1;
		if (results.length >= limit) continue;
		results.push({ title, url, snippet: container.querySelector(".result__snippet")?.textContent?.trim() ?? "", content: "" });
	}
	return { results: results.slice(0, limit), parseable };
}

export async function searchDuckDuckGo(
	query: string,
	options: { numResults: number; timeoutMs: number; signal?: AbortSignal; fetchImpl?: typeof fetch },
): Promise<SearchResult[]> {
	const url = new URL(DDG_ENDPOINT);
	url.searchParams.set("q", query);
	const deadline = AbortSignal.timeout(options.timeoutMs);
	const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
	let response: Response;
	try {
		response = await (options.fetchImpl ?? fetch)(url, {
			headers: {
				accept: "text/html",
				"user-agent": "Mozilla/5.0 (compatible; pi-web-access/0.1; +https://github.com/pydantic/monty)",
			},
			signal,
		});
	} catch (error) {
		if (deadline.aborted || (error instanceof Error && error.name === "TimeoutError")) {
			throw webError("TimeoutError", `duckduckgo: timed out after ${options.timeoutMs} ms`);
		}
		throw webError("OSError", `duckduckgo: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!response.ok) throw webError("OSError", `duckduckgo: HTTP ${response.status}`);
	const { results, parseable } = parseDuckDuckGo(await response.text(), options.numResults);
	if (parseable === 0) throw webError("OSError", "duckduckgo: no parseable results (the page shape changed, or the request was blocked)");
	return results;
}
