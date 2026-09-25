/**
 * AnySearch — a JSON API. `X-API-Key`, not `Bearer`: the stored key returns
 * `401 invalid_api_key` with `Authorization: Bearer` and `200` with `X-API-Key`, verified
 * before this was written and recorded as map ticket 03's standing preference.
 *
 * Unlike DuckDuckGo it returns a short `content` extract alongside the snippet, so results
 * from this provider are the only ones whose `content` is non-empty.
 */

import { webError } from "../errors";
import type { SearchResult, SearchOptions } from "./types";

export const ANYSEARCH_ENDPOINT = "https://api.anysearch.com/v1/search";

type AnySearchPayload = {
	code?: unknown;
	message?: unknown;
	data?: { results?: unknown; metadata?: unknown };
};

/** Parse and validate a response body. Separate from the request so a recorded payload can
 *  be tested without the network. */
export function parseAnySearch(payload: unknown, limit: number): SearchResult[] {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
		throw webError("OSError", "anysearch: expected a JSON object");
	}
	const envelope = payload as AnySearchPayload;
	if (envelope.code !== 0) {
		throw webError("OSError", `anysearch: code ${String(envelope.code)} — ${String(envelope.message ?? "no message")}`);
	}
	const raw = envelope.data?.results;
	if (!Array.isArray(raw)) throw webError("OSError", "anysearch: expected data.results to be an array");
	const results: SearchResult[] = [];
	for (const entry of raw.slice(0, limit)) {
		if (typeof entry !== "object" || entry === null) throw webError("OSError", "anysearch: result entry was not an object");
		const { title, url, snippet, content } = entry as Record<string, unknown>;
		if (typeof title !== "string" || typeof url !== "string") throw webError("OSError", "anysearch: result needs string title and url");
		if (!url) throw webError("OSError", "anysearch: result url was empty");
		results.push({
			title,
			url,
			snippet: typeof snippet === "string" ? snippet : "",
			content: typeof content === "string" ? content : "",
		});
	}
	return results;
}

export async function searchAnySearch(
	query: string,
	options: SearchOptions & { apiKey: string | null },
): Promise<SearchResult[]> {
	if (!options.apiKey) {
		throw webError("OSError", "anysearch: no anysearchApiKey in web-search.json");
	}
	const deadline = AbortSignal.timeout(options.timeoutMs);
	const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
	let response: Response;
	try {
		response = await (options.fetchImpl ?? fetch)(ANYSEARCH_ENDPOINT, {
			method: "POST",
			headers: { "content-type": "application/json", "x-api-key": options.apiKey },
			body: JSON.stringify({ query, max_results: options.numResults }),
			signal,
		});
	} catch (error) {
		if (deadline.aborted || (error instanceof Error && error.name === "TimeoutError")) {
			throw webError("TimeoutError", `anysearch: timed out after ${options.timeoutMs} ms`);
		}
		throw webError("OSError", `anysearch: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!response.ok) throw webError("OSError", `anysearch: HTTP ${response.status}`);
	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		throw webError("OSError", `anysearch: response was not JSON (${error instanceof Error ? error.message : String(error)})`);
	}
	return parseAnySearch(payload, options.numResults);
}
