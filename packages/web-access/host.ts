/**
 * `pi-web-access` — the web host functions the rlm kernel can call (map `.scratch/rlm-web/`),
 * plus the untrusted-content guard for what both routes return (`guard.ts`).
 *
 * This file is two things at once, deliberately:
 *
 *   - the **kernel hook**: `RLM_WEB_MODULE=/workspace/pi/extensions/packages/web-access/host.ts`
 *     makes rlm import it at load and call `createHost(ctx)` once per kernel, where the
 *     returned `{ web_search, fetch_content }` join the same host surface as `bash`,
 *     `find`, `grep` and `read_image` (map ticket 03);
 *   - a **pi package entry** whose default export registers the guard, so `pi install` on this
 *     directory loads it. The extension still registers **no** pi-level tools — that was
 *     round 2's decision, and it is what keeps it from colliding with the installed
 *     `pi-web-access`, which already owns `web_search` for non-rlm sessions.
 *
 * Contracts this implements, all of them written down in the map's tickets:
 *   04 — envelopes, argument names, defaults, the error mapping
 *   05 — extraction stack, content types, spill naming, the no-content case
 *   06 — the guard (applied inside `fetchContent`)
 */

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadConfig, providerOrder, DEFAULT_PROVIDERS, type WebConfig, type DomainPolicy } from "./config";
import { asWebError, messageOf, webError } from "./errors";
import { fetchContent, type FetchEnvelope, type FetchMode } from "./fetch";
import { searchAnySearch } from "./providers/anysearch";
import { searchDuckDuckGo } from "./providers/duckduckgo";
import type { SearchResult } from "./providers/types";
import { fenceText, installGuard, SYSTEM_PROMPT_SECTION, type GuardPi } from "./guard";

export const SEARCH_TIMEOUT_MS = 30_000;
export const FETCH_TIMEOUT_MS = 60_000;
export const DEFAULT_NUM_RESULTS = 5;
export const MAX_NUM_RESULTS = 20;

/**
 * The hook's system-prompt rule, under the name rlm looks for.
 *
 * A spawned child loads no ambient extensions, so this package's extension entry never runs there;
 * rlm contributes the host functions to the child's kernel, and reads this export so the child's
 * prompt carries the same rule. Optional by design — an older module without it contributes the
 * functions and no rule, exactly as before.
 */
export const WEB_SYSTEM_PROMPT = SYSTEM_PROMPT_SECTION;

export type HostContext = {
	cwd: string;
	sessionFile?: string;
	progress?: (text: string) => void;
};

export type SearchEnvelope = {
	query: string;
	provider: string | null;
	results: SearchResult[];
	errors: Record<string, string>;
};

/**
 * monty hands a JS host function its arguments as the sandbox wrote them: positionals in
 * order, and **Python keyword arguments as one trailing plain object**
 * (`web_search("q", num_results=3)` arrives as `("q", { num_results: 3 })`). rlm's own host
 * functions unwrap the same convention with `bind()` in `extensions/rlm/src/index.ts`; a
 * hook module has to do it for itself. The first live integration run is what proved it:
 * the unit tests called these functions directly and never saw the convention.
 */
function bindArgs(args: unknown[], names: string[]): Record<string, unknown> {
	const list = [...args];
	let kwargs: Record<string, unknown> = {};
	const last = list[list.length - 1];
	if (last !== null && typeof last === "object" && !Array.isArray(last)) {
		kwargs = list.pop() as Record<string, unknown>;
	}
	const bound: Record<string, unknown> = {};
	names.forEach((name, index) => {
		const positional = list[index];
		bound[name] = positional === undefined || positional === null ? (kwargs[name] ?? null) : positional;
	});
	return bound;
}

function requireQuery(value: unknown): string {
	if (typeof value !== "string") throw webError("TypeError", `web_search: query must be a string, got ${typeof value}`);
	const query = value.trim();
	if (!query) throw webError("ValueError", "web_search: query must not be empty");
	return query;
}

function numResults(value: unknown): number {
	if (value === undefined || value === null) return DEFAULT_NUM_RESULTS;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw webError("TypeError", `web_search: num_results must be a number, got ${typeof value}`);
	}
	return Math.max(1, Math.min(Math.floor(value), MAX_NUM_RESULTS));
}

function resolveProviders(value: unknown, configured: string[]): string[] {
	const known = [...DEFAULT_PROVIDERS];
	if (value === undefined || value === null) return providerOrder(configured);
	const requested = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
	if (!requested) throw webError("TypeError", `web_search: provider must be a name or a list of names, got ${typeof value}`);
	if (requested.length === 0) throw webError("ValueError", "web_search: provider list is empty");
	for (const name of requested) {
		if (typeof name !== "string") throw webError("TypeError", "web_search: provider names must be strings");
		if (!(known as string[]).includes(name)) {
			throw webError("ValueError", `web_search: unknown provider "${name}" (available: ${known.join(", ")})`);
		}
	}
	return requested.map((name) => String(name));
}

type DomainFilter = DomainPolicy;

function domainFilter(value: unknown): DomainFilter {
	if (value === undefined || value === null) return { allow: [], deny: [] };
	if (!Array.isArray(value)) throw webError("TypeError", "web_search: domain_filter must be a list of hostnames");
	const filter: DomainFilter = { allow: [], deny: [] };
	value.forEach((raw, index) => {
		if (typeof raw !== "string") throw webError("TypeError", `web_search: domain_filter[${index}] must be a string`);
		const deny = raw.trim().startsWith("-");
		const host = raw.trim().replace(/^-/, "").replace(/^https?:\/\//, "").split("/")[0]!.replace(/^\.+|\.+$/g, "").toLowerCase();
		if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(host)) {
			throw webError("ValueError", `web_search: domain_filter entry "${raw}" is not a hostname`);
		}
		(deny ? filter.deny : filter.allow).push(host);
	});
	return filter;
}

function matchesFilter(url: string, filter: DomainFilter): boolean {
	if (filter.allow.length === 0 && filter.deny.length === 0) return true;
	let hostname: string;
	try {
		hostname = new URL(url).hostname.toLowerCase();
	} catch {
		return false;
	}
	const matches = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
	if (filter.allow.length > 0 && !filter.allow.some(matches)) return false;
	return !filter.deny.some(matches);
}

/**
 * Fence every free-text field of a search envelope — result titles, snippets and extracts, and the
 * per-provider error strings (an upstream error body is attacker-influenced text too). `url`
 * (routing), `query` (the caller's own text) and `provider` are left intact.
 */
function fenceSearchEnvelope(envelope: SearchEnvelope): SearchEnvelope {
	return {
		...envelope,
		results: envelope.results.map((result) => ({
			...result,
			title: fenceText(result.title),
			snippet: fenceText(result.snippet),
			content: fenceText(result.content),
		})),
		errors: Object.fromEntries(Object.entries(envelope.errors).map(([name, why]) => [name, fenceText(why)])),
	};
}

/** Fence the free-text fields of a fetch envelope: the raw envelope has none (the bytes are on
 *  disk), the markdown one has `title` and `head`. The spilled *file* is fenced by `fetchContent`
 *  itself, so a cell that reads or greps it sees the markers too. */
function fenceFetchEnvelope(envelope: FetchEnvelope): FetchEnvelope {
	if (!("head" in envelope)) return envelope;
	return { ...envelope, title: fenceText(envelope.title), head: fenceText(envelope.head) };
}

export function createHost(ctx: HostContext, deps: HostDeps = {}) {
	const config: WebConfig = deps.config ?? loadConfig();
	const scratchDir = ctx.sessionFile ? `${ctx.sessionFile}.scratch` : `${tmpdir()}/pi-web-access`;
	mkdirSync(scratchDir, { recursive: true });

	async function runProvider(name: string, query: string, limit: number, signal?: AbortSignal): Promise<SearchResult[]> {
		const options = { numResults: limit, timeoutMs: SEARCH_TIMEOUT_MS, signal, fetchImpl: deps.fetchImpl };
		if (name === "duckduckgo") return await searchDuckDuckGo(query, options);
		if (name === "anysearch") return await searchAnySearch(query, { ...options, apiKey: config.anysearchApiKey });
		throw webError("ValueError", `unknown provider "${name}"`);
	}

	/**
	 * One query per call — several angles are a Python loop, which is the point of code
	 * mode. Providers are tried **in order** and the first that yields something wins; a
	 * per-provider failure is data in `errors`, and only "every provider failed" raises.
	 */
	async function web_search(...args: unknown[]): Promise<SearchEnvelope> {
		try {
			const bound = bindArgs(args, ["query", "num_results", "provider", "domain_filter"]);
			const query = requireQuery(bound.query);
			const limit = numResults(bound.num_results);
			const order = resolveProviders(bound.provider, config.providers);
			const filter = domainFilter(bound.domain_filter);
			const filtering = filter.allow.length > 0 || filter.deny.length > 0;
			// Domain filtering is client-side and identical for both providers, so ask for
			// more than we need and keep the first `limit` survivors (ticket 04).
			const ask = filtering ? MAX_NUM_RESULTS : limit;
			const errors: Record<string, string> = {};
			let empty: { provider: string; results: SearchResult[] } | null = null;

			for (const name of order) {
				ctx.progress?.(`web_search: ${name} — ${query.slice(0, 80)}`);
				try {
					const found = await runProvider(name, query, ask);
					const kept = found.filter((result) => matchesFilter(result.url, filter)).slice(0, limit);
					if (kept.length > 0) {
						ctx.progress?.(`web_search: ${name} answered with ${kept.length}`);
						return fenceSearchEnvelope({ query, provider: name, results: kept, errors });
					}
					errors[name] = found.length === 0 ? "no results" : `${found.length} results, none survived domain_filter`;
					empty ??= { provider: name, results: kept };
				} catch (error) {
					errors[name] = messageOf(error);
					ctx.progress?.(`web_search: ${name} failed — ${messageOf(error).slice(0, 100)}`);
				}
			}
			// Nothing anywhere: an empty success is a result, not an error (ticket 04).
			if (empty) return fenceSearchEnvelope({ query, provider: empty.provider, results: empty.results, errors });
			throw webError(
				"RuntimeError",
				`every provider failed for "${query}": ${Object.entries(errors).map(([name, why]) => `${name}: ${why}`).join("; ")}`,
			);
		} catch (error) {
			throw asWebError(error, "RuntimeError", "web_search failed");
		}
	}

	/** One URL per call; the model loops. `raw` writes the bytes and returns a path,
	 *  `markdown` writes extracted text and returns it with a head (tickets 04, 05). */
	async function fetch_content(...args: unknown[]): Promise<FetchEnvelope> {
		try {
			const bound = bindArgs(args, ["url", "mode"]);
			const rawUrl = bound.url;
			const rawMode = bound.mode ?? "markdown";
			if (typeof rawUrl !== "string") throw webError("TypeError", `fetch_content: url must be a string, got ${typeof rawUrl}`);
			const url = rawUrl.trim();
			if (!url) throw webError("ValueError", "fetch_content: url must not be empty");
			if (rawMode !== "markdown" && rawMode !== "raw") {
				throw webError("ValueError", `fetch_content: mode must be "markdown" or "raw", got ${JSON.stringify(rawMode)}`);
			}
			return fenceFetchEnvelope(
				await fetchContent(url, {
					mode: rawMode as FetchMode,
					scratchDir,
					timeoutMs: FETCH_TIMEOUT_MS,
					guard: { allowRanges: config.allowRanges, domainPolicy: config.domainPolicy },
					progress: ctx.progress,
					fetchImpl: deps.fetchImpl,
				}),
			);
		} catch (error) {
			throw asWebError(error, "RuntimeError", "fetch_content failed");
		}
	}

	return { web_search, fetch_content };
}

/**
 * Test seams. `fetchImpl` drives provider responses and fetches without a network;
 * `config` replaces the shared `web-search.json`, which is read once per kernel.
 */
export type HostDeps = { fetchImpl?: typeof fetch; config?: WebConfig };

/** `pi install` loads this file as an extension: the default export registers the guard and
 *  nothing else. No pi-level tools — the capability is the kernel's (round 2). */
export default function piWebAccess(pi: GuardPi): void {
	installGuard(pi);
}
