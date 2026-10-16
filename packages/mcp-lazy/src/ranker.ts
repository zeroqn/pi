/**
 * The ranker behind `await tool("mcp__<server>", query="…")` (wayfinder ticket 15).
 *
 * **Copied, not invented** — pi's own `tool-search` BM25 (`pi/packages/coding-agent/src/extensions/
 * tool-search/tool.ts`), so a query over one MCP inventory ranks the way a built-in `tool_search`
 * call would. The pieces and the lines they come from:
 *
 *  - `STOP_WORDS` (tool.ts:38-62) and `stem` (tool.ts:64-71) — the naive singular form.
 *  - `tokenize` (tool.ts:73-83) — camelCase-aware, lowercased, split on non-alphanumerics, stop words
 *    dropped, then stemmed.
 *  - `schemaText` (tool.ts:89-102) — every schema `description` and property name, recursively.
 *  - `createToolSearchDocument` (tool.ts:104-119) — name, `_`→space name, description, schema text,
 *    then the namespace's name/description/instructions.
 *  - `Bm25Ranker` (tool.ts:121-159) — Okapi BM25, `k1 = 1.2`, `b = 0.75`, the usual IDF, a stable sort
 *    by descending score (`Array.prototype.sort` is stable, so a tie keeps document order).
 *
 * One deliberate difference, from ticket 15: the name part turns **both** `_` and `-` into spaces, so
 * `read-file` and `read_file` rank the same. Everything else is pi's.
 */

/** pi's stop words, verbatim (tool.ts:38-62). */
const STOP_WORDS: ReadonlySet<string> = new Set([
	"a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on",
	"or", "that", "the", "this", "to", "with",
]);

/** pi's naive singular form, verbatim (tool.ts:64-71). */
function stem(term: string): string {
	if (term.length > 4 && term.endsWith("ies")) return `${term.slice(0, -3)}y`;
	if (term.length > 4 && /(ches|shes|sses|xes|zes)$/.test(term)) return term.slice(0, -2);
	if (term.length > 3 && term.endsWith("s") && !term.endsWith("ss")) return term.slice(0, -1);
	return term;
}

/** pi's tokenizer, verbatim (tool.ts:73-83). */
export function tokenize(text: string): string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((term) => term.length > 0 && !STOP_WORDS.has(term))
		.map(stem);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** pi's `schemaText`, verbatim (tool.ts:89-102). */
function schemaText(schema: unknown, parts: string[]): void {
	if (!isObject(schema)) return;
	if (typeof schema.description === "string") parts.push(schema.description);
	if (isObject(schema.properties)) {
		for (const [name, property] of Object.entries(schema.properties)) {
			parts.push(name);
			schemaText(property, parts);
		}
	}
	schemaText(schema.items, parts);
	for (const key of ["anyOf", "oneOf", "allOf"]) {
		const variants = schema[key];
		if (Array.isArray(variants)) for (const variant of variants) schemaText(variant, parts);
	}
}

/** What the ranker sees of a tool: the name it answers by, and the concatenated search text. */
export type RankDocument = { name: string; text: string };

/** The namespace fields pi's document builder reads (tool.ts:104-119). */
export type DocumentNamespace = {
	name?: string;
	description?: string;
	instructions?: string;
};

/** The tool fields the document needs. Structurally `ToolInfo`'s useful half. */
export type DocumentTool = {
	name: string;
	description?: string;
	parameters?: unknown;
	namespace?: DocumentNamespace;
};

/** pi's `createToolSearchDocument` (tool.ts:104-119), with `-` also turned into a space in the name. */
export function buildDocument(tool: DocumentTool): RankDocument {
	const parts: string[] = [tool.name, tool.name.replace(/[_-]/g, " "), tool.description ?? ""];
	schemaText(tool.parameters, parts);
	const namespace = tool.namespace;
	if (namespace) {
		parts.push(namespace.name ?? "", namespace.description ?? "", namespace.instructions ?? "");
	}
	return { name: tool.name, text: parts.filter((part) => part.trim()).join(" ") };
}

export type RankMatch = { name: string; score: number };

/**
 * Okapi BM25 with pi's parameters (tool.ts:121-159). Ties keep document order because the sort is
 * stable, which is the determinism ticket 15's first test asserts.
 */
export class Bm25Ranker {
	private readonly k1: number;
	private readonly b: number;

	constructor(options: { k1?: number; b?: number } = {}) {
		this.k1 = options.k1 ?? 1.2;
		this.b = options.b ?? 0.75;
	}

	rank(query: string, documents: readonly RankDocument[], limit: number): RankMatch[] {
		const queryTerms = [...new Set(tokenize(query))];
		if (queryTerms.length === 0 || documents.length === 0 || limit <= 0) return [];
		const termCounts = documents.map((document) => {
			const counts = new Map<string, number>();
			for (const term of tokenize(document.text)) counts.set(term, (counts.get(term) ?? 0) + 1);
			return counts;
		});
		const lengths = termCounts.map((counts) => [...counts.values()].reduce((sum, count) => sum + count, 0));
		const averageLength = lengths.reduce((sum, length) => sum + length, 0) / documents.length || 1;
		const idf = new Map(
			queryTerms.map((term) => {
				const frequency = termCounts.filter((counts) => counts.has(term)).length;
				return [term, Math.log(1 + (documents.length - frequency + 0.5) / (frequency + 0.5))] as const;
			}),
		);
		const matches: RankMatch[] = [];
		documents.forEach((document, index) => {
			let score = 0;
			for (const term of queryTerms) {
				const count = termCounts[index].get(term);
				if (!count) continue;
				const norm = this.k1 * (1 - this.b + (this.b * lengths[index]) / averageLength);
				score += (idf.get(term) ?? 0) * ((count * (this.k1 + 1)) / (count + norm));
			}
			if (score > 0) matches.push({ name: document.name, score });
		});
		return matches.sort((a, b) => b.score - a.score).slice(0, limit);
	}
}
