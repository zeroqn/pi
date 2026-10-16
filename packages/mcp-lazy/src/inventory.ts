/**
 * The text `await tool("mcp__<server>")` answers with, and its ranked form (tickets 02 and 15).
 *
 * The inventory is what a cell reads to decide *whether* a server can do a thing: the server's own
 * `instructions` as a heading, then one line per tool (`mcp__<server>__<tool> - <description>`) and the
 * parameter names with the required ones marked. Deliberately **no full JSON schema and no
 * annotations** (ticket 02): schemas are the bulk of an MCP listing and buy the least for that
 * decision, and annotations stay readable from `pi.getAllTools()` for a future guard.
 *
 * The ranked form is ticket 15's: the same per-tool lines, in BM25 score order, behind a header naming
 * the query and the match count — and, when nothing matches, the tool **names** only, because a model
 * that cannot act on a ranked list must still be able to act.
 */
import { Bm25Ranker, buildDocument, type DocumentTool } from "./ranker";

/** The little of pi's `ToolInfo` this module reads. Structural, so a unit test needs no host. */
export type InventoryTool = DocumentTool & {
	name: string;
};

/** pi's default match count for a ranked query (ticket 15). */
export const DEFAULT_QUERY_LIMIT = 10;

/** The tools pi reports for one namespace, in the order the server listed them. */
export function toolsOfNamespace(tools: readonly InventoryTool[], namespace: string): InventoryTool[] {
	const prefix = `${namespace}__`;
	return tools.filter((tool) => typeof tool.name === "string" && tool.name.startsWith(prefix));
}

/** The first tool of a namespace, used to read the server's own `instructions`. */
export function namespaceInstructions(tools: readonly InventoryTool[], namespace: string): string {
	for (const tool of toolsOfNamespace(tools, namespace)) {
		const instructions = tool.namespace?.instructions;
		if (typeof instructions === "string" && instructions.trim()) return instructions.trim();
	}
	return "";
}

/** The parameter names of a tool's schema, with ` (required)` on those the schema requires. */
export function parameterLine(schema: unknown): string {
	if (typeof schema !== "object" || schema === null) return "";
	const record = schema as { properties?: unknown; required?: unknown };
	const properties = record.properties;
	if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return "";
	const required = new Set(
		Array.isArray(record.required) ? record.required.filter((n): n is string => typeof n === "string") : [],
	);
	const names = Object.keys(properties as Record<string, unknown>);
	if (names.length === 0) return "";
	return names.map((name) => (required.has(name) ? `${name} (required)` : name)).join(", ");
}

/** One `name - description` line plus its parameter line. The unit both renderers share. */
export function renderToolLines(tools: readonly InventoryTool[]): string[] {
	const lines: string[] = [];
	for (const tool of tools) {
		const description = typeof tool.description === "string" ? tool.description.trim().replace(/\s+/g, " ") : "";
		lines.push(description ? `- ${tool.name} - ${description}` : `- ${tool.name}`);
		const params = parameterLine(tool.parameters);
		if (params) lines.push(`  params: ${params}`);
	}
	return lines;
}

/** The full inventory: the server's instructions as a heading, then every tool. */
export function inventoryText(namespace: string, tools: readonly InventoryTool[]): string {
	const instructions = namespaceInstructions(tools, namespace);
	const parts: string[] = [];
	if (instructions) parts.push(instructions);
	parts.push(`${tools.length} tool${tools.length === 1 ? "" : "s"}:`);
	parts.push(...renderToolLines(tools));
	return parts.join("\n");
}

/** The ranked form of the inventory (ticket 15). */
export function rankedText(namespace: string, tools: readonly InventoryTool[], query: string, limit?: number): string {
	const documents = tools.map((tool) => buildDocument(tool));
	const wanted = Number.isInteger(limit) && (limit ?? 0) > 0 ? (limit as number) : DEFAULT_QUERY_LIMIT;
	const capped = Math.min(wanted, tools.length);
	const matches = new Bm25Ranker().rank(query, documents, capped);
	if (matches.length === 0) {
		const names = tools.map((tool) => tool.name).join(", ");
		return `No tool matches "${query}". ${tools.length} tool${tools.length === 1 ? "" : "s"} are listed by name: ${names}.`;
	}
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	const matched = matches.map((match) => byName.get(match.name)).filter((tool): tool is InventoryTool => tool !== undefined);
	return [`${matched.length} of ${tools.length} tools match "${query}".`, ...renderToolLines(matched)].join("\n");
}
