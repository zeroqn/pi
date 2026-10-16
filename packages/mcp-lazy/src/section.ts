/**
 * The eager layer's text: the `mcp_servers` section, its intro, and the guideline that teaches the
 * route (wayfinder map `.scratch/mcp-discovery/`, tickets 01, 03, 12 and 14).
 *
 * Everything here is pure — no pi, no filesystem, no session — because the rules are the interesting
 * part and a unit test should not need a host to pin them:
 *
 *  - **The line** (01): `- mcp__<server>: <one-liner>`, no reach label, alphabetical by namespace. A
 *    server with no one-liner is its bare namespace and no colon.
 *  - **The cap** (01/14): pi's own numbers — 4096 chars of *inner* text, per-server summary
 *    `min(250, floor((4096 - size(kept)) / kept) - 2)`. Descriptions are sacrificed before names: when
 *    the budget reaches zero every line is bare, and above N = 224 even bare names stop fitting and the
 *    tail is omitted behind 14's own line.
 *  - **Truncation** (14): ours, not pi's word- and URL-blind `truncate` — cut at whitespace, never
 *    inside a token that looks like a URL (kept whole or dropped whole), `…` as the ellipsis, and a
 *    summary that truncates to nothing loses its colon (`- mcp__x`, never `- mcp__x:`).
 *  - **The fill-in and its fits-check** (12): a line with a config description never changes; a server
 *    with no description may gain the first line of its own `instructions` once it connects, but only
 *    if the whole section still fits with every other line unchanged. Once ticket 14's sacrifice has
 *    engaged (a config description dropped or cut), no further fill-in is accepted, because an update
 *    must never delete text the model has already read.
 */

/** pi's cap, on the inner text (`packages/coding-agent/src/extensions/mcp/index.ts:158-163`). */
export const MAX_SERVERS_SECTION_CHARS = 4096;
/** pi's own per-server summary budget (`index.ts:158`). */
export const MAX_SERVER_DESCRIPTION_CHARS = 250;
/** pi's own name for exactly this content. mcp-lazy is its single writer. */
export const MCP_SERVERS_SECTION = "mcp_servers";

/** Ticket 03's section intro, verbatim. */
export const SECTION_INTRO = "MCP servers this session may reach; none is started until a cell calls it.";

/** Ticket 03's guideline, verbatim. It lands in the `python` tool's `<rules>`. */
export const ROUTE_GUIDELINE =
	'await tool() lists the MCP servers this session may reach; await tool("mcp__<server>") shows what one offers and is what starts it.';

/** Ticket 14's omission line. `K` is the number of servers not shown. */
export function omissionLine(count: number): string {
	return count > 0 ? [`- ... ${count} more servers; call tool() to list them all`].join("\n") : "";
}

/** `mcp__<server>` with `-` rewritten to `_`, exactly pi's rule (`core/mcp-servers.ts:155`). */
export function mcpNamespace(server: string): string {
	return `mcp__${server.replace(/-/g, "_")}`;
}

/** The first non-empty line of `text`, trimmed. `""` when there is none. */
export function firstLine(text: string | undefined): string {
	if (typeof text !== "string") return "";
	return (text.split("\n", 1)[0] ?? "").trim();
}

/** Whether a whitespace token is a URL, so the truncator must not cut inside it. */
function isUrlToken(token: string): boolean {
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(token);
}

/**
 * Shorten `text` to at most `max` characters **without cutting inside a word**, and never inside a
 * URL token (14's correction of pi's `truncate`, which was measured mid-word and mid-URL).
 *
 * Tokens are added while they fit; the first token that does not is dropped whole (a URL) or, when it
 * is the only token and not a URL, cut at the character budget so a one-word summary is not lost.
 * The result ends with `…`; an empty result means the summary was not worth a colon, and the caller
 * renders the bare head.
 */
export function truncateSummary(text: string, max: number): string {
	if (text.length <= max) return text;
	if (max <= 1) return "";
	const budget = max - 1;
	const re = /\S+/g;
	let end = 0;
	let kept = false;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		const tokenEnd = match.index + match[0].length;
		if (tokenEnd <= budget) {
			end = tokenEnd;
			kept = true;
			continue;
		}
		if (!kept) {
			// The first token alone is longer than the budget. A URL is dropped whole (nothing kept);
			// any other word is cut at the character budget so the line says something.
			return isUrlToken(match[0]) ? "" : `${text.slice(0, budget)}…`;
		}
		break;
	}
	if (!kept) return "";
	const keptText = text.slice(0, end).replace(/\s+$/, "");
	return keptText === "" ? "" : `${keptText}…`;
}

/** One server the section can list: its name and the two possible one-liners. */
export type SectionEntry = {
	name: string;
	/** The config `description`'s first line; `""` when the config has none. */
	base: string;
	/** The first line of the server's own `instructions`; `""` before it connects or when it sends none. */
	fill: string;
};

export type RenderResult = {
	text: string;
	kept: number;
	omitted: number;
	perServer: number;
	/** True when every line is the full one-liner the caller asked for (no drop, no truncation). */
	complete: boolean;
};

/**
 * Render the section for one turn. `oneLiners` aligns with `entries` (both are sorted here by
 * namespace, so the caller does not have to), and an empty one-liner renders the bare head.
 */
export function renderSection(entries: readonly SectionEntry[], oneLiners: readonly string[]): RenderResult {
	const rows = entries
		.map((entry, index) => ({ entry, oneLiner: oneLiners[index] ?? "" }))
		.sort((a, b) => {
			const an = mcpNamespace(a.entry.name);
			const bn = mcpNamespace(b.entry.name);
			return an < bn ? -1 : an > bn ? 1 : 0;
		});
	const total = rows.length;
	if (total === 0) return { text: "", kept: 0, omitted: 0, perServer: 0, complete: true };
	const heads = rows.map((row) => `- ${mcpNamespace(row.entry.name)}`);
	const omission = (count: number) => (count > 0 ? [omissionLine(count)] : []);
	// pi's own cap algorithm (`index.ts:207-219`), with our omission line: find the largest `kept`
	// whose bare heads plus the omission line fit, then spend what is left on summaries.
	const size = (kept: number) => [SECTION_INTRO, ...heads.slice(0, kept), ...omission(total - kept)].join("\n").length;
	let kept = total;
	while (kept > 0 && size(kept) > MAX_SERVERS_SECTION_CHARS) kept--;
	const perServer =
		kept === 0
			? 0
			: Math.min(MAX_SERVER_DESCRIPTION_CHARS, Math.floor((MAX_SERVERS_SECTION_CHARS - size(kept)) / kept) - 2);
	let truncated = false;
	const lines = rows.slice(0, kept).map((row, index) => {
		const wanted = row.oneLiner;
		const summary = perServer > 0 ? truncateSummary(wanted, perServer) : "";
		if (summary !== wanted) truncated = true;
		return summary ? `${heads[index]}: ${summary}` : heads[index];
	});
	const text = [SECTION_INTRO, ...lines, ...omission(total - kept)].join("\n");
	return { text, kept, omitted: total - kept, perServer, complete: kept === total && !truncated };
}

/**
 * The fits-check (ticket 12). `accepted` is the per-session set of servers whose fill-in the model has
 * already read; `capEngaged` records that ticket 14's sacrifice has run, after which no fill-in is ever
 * accepted again.
 *
 * The live list is a constant per session (config is read once), so the invariant this keeps is
 * monotone: a fill-in is accepted only when the section with *every* wanted fill-in still renders
 * complete, and once accepted it stays (the config half never changes). That is exactly "the whole
 * section still fits with every other line unchanged".
 */
export function sectionText(
	entries: readonly SectionEntry[],
	state: { acceptedFills: Set<string>; capEngaged: boolean },
): string {
	const accepted = new Set(state.acceptedFills);
	// Fill extra lines in only while the whole section stays complete. Candidates are tried in
	// namespace order so the result does not depend on how the caller ordered the list, and a fill
	// that would push the section over is skipped rather than costing the ones already read.
	if (!state.capEngaged) {
		const candidates = entries
			.filter((entry) => !entry.base && entry.fill && !accepted.has(entry.name))
			.map((entry) => entry.name)
			.sort((a, b) => (mcpNamespace(a) < mcpNamespace(b) ? -1 : mcpNamespace(a) > mcpNamespace(b) ? 1 : 0));
		for (const name of candidates) {
			const trial = new Set(accepted);
			trial.add(name);
			const oneLiners = entries.map((entry) => (entry.base ? entry.base : trial.has(entry.name) ? entry.fill : ""));
			if (renderSection(entries, oneLiners).complete) accepted.add(name);
		}
	}
	const oneLiners = entries.map((entry) => (entry.base ? entry.base : accepted.has(entry.name) ? entry.fill : ""));
	const rendered = renderSection(entries, oneLiners);
	state.acceptedFills = accepted;
	if (!rendered.complete) state.capEngaged = true;
	return rendered.text;
}
