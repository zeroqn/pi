/**
 * The pure half of the eager layer: the line shape, the cap and its sacrifice order, the truncator, and
 * ticket 12's fits-check. No host, no filesystem — the rules are what these tests pin.
 */
import { describe, expect, it } from "bun:test";

import {
	MAX_SERVERS_SECTION_CHARS,
	SECTION_INTRO,
	type SectionEntry,
	omissionLine,
	renderSection,
	sectionText,
	truncateSummary,
} from "../src/section";

const DOCS: SectionEntry = { name: "docs-api", base: "Test docs server", fill: "" };
const SENTRY: SectionEntry = { name: "sentry", base: "Error tracking and issue lookup", fill: "" };

function servers(n: number, base = ""): SectionEntry[] {
	const out: SectionEntry[] = [];
	for (let i = 1; i <= n; i++) out.push({ name: `server-${String(i).padStart(3, "0")}`, base, fill: "" });
	return out;
}

describe("the line", () => {
	it("renders ticket 03's measured two-server section byte for byte", () => {
		const { text } = renderSection([DOCS, SENTRY], [DOCS.base, SENTRY.base]);
		expect(text).toBe(
			[
				"MCP servers this session may reach; none is started until a cell calls it.",
				"- mcp__docs_api: Test docs server",
				"- mcp__sentry: Error tracking and issue lookup",
			].join("\n"),
		);
		expect(text.length).toBe(155);
	});

	it("sorts alphabetically by namespace, not by the order it was handed", () => {
		const { text } = renderSection([SENTRY, DOCS], [SENTRY.base, DOCS.base]);
		const lines = text.split("\n");
		expect(lines[1]).toBe("- mcp__docs_api: Test docs server");
		expect(lines[2]).toBe("- mcp__sentry: Error tracking and issue lookup");
	});

	it("leaves a server with no one-liner as its bare namespace, with no colon", () => {
		const { text } = renderSection([{ name: "docs-api", base: "", fill: "" }], [""]);
		expect(text).toBe(`${SECTION_INTRO}\n- mcp__docs_api`);
	});
});

describe("truncateSummary", () => {
	it("drops a URL whole rather than cutting inside it", () => {
		expect(
			truncateSummary("Search docs at https://docs.example.com/mcp/v2/reference and read the API guide", 20),
		).toBe("Search docs at…");
	});

	it("never leaves a lone URL as a summary", () => {
		expect(truncateSummary("https://example.com/very/long/path", 10)).toBe("");
	});

	it("cuts at whitespace and marks the cut with an ellipsis", () => {
		expect(truncateSummary("a very long summary here", 12)).toBe("a very long…");
	});

	it("returns a short text unchanged", () => {
		expect(truncateSummary("short", 20)).toBe("short");
	});
});

describe("the cap", () => {
	it("keeps every name at N = 200 when bare (3 674 chars, well under 4096)", () => {
		const { text, kept, omitted, complete } = renderSection(servers(200), servers(200).map(() => ""));
		expect(kept).toBe(200);
		expect(omitted).toBe(0);
		expect(complete).toBe(true);
		expect(text.length).toBeLessThanOrEqual(MAX_SERVERS_SECTION_CHARS);
		expect(text.split("\n").length - 1).toBe(200);
	});

	it("drops descriptions wholesale from N = 183 and never loses a name", () => {
		const long = "Search docs at https://docs.example.com/mcp/v2/reference and read the API guide";
		const entries = servers(183, long);
		const { text, kept, omitted } = renderSection(entries, entries.map((entry) => entry.base));
		expect(kept).toBe(183);
		expect(omitted).toBe(0);
		expect(text.length).toBeLessThanOrEqual(MAX_SERVERS_SECTION_CHARS);
		const lines = text.split("\n").slice(1);
		expect(lines).toHaveLength(183);
		for (const line of lines) {
			expect(line).toMatch(/^- mcp__server_\d{3}$/);
		}
	});

	it("omits the tail above N = 224 behind ticket 14's own line", () => {
		const entries = servers(224);
		const { text, kept, omitted } = renderSection(entries, entries.map(() => ""));
		expect(omitted).toBe(224 - kept);
		expect(omitted).toBeGreaterThan(0);
		expect(text).toContain(omissionLine(omitted));
		expect(text.length).toBeLessThanOrEqual(MAX_SERVERS_SECTION_CHARS);
	});
});

describe("ticket 12's fits-check", () => {
	it("accepts a fill-in when the whole section still fits", () => {
		const entries: SectionEntry[] = [
			{ name: "docs-api", base: "Test docs server", fill: "" },
			{ name: "sentry", base: "", fill: "Sentry error tracking" },
		];
		const state = { acceptedFills: new Set<string>(), capEngaged: false };
		const text = sectionText(entries, state);
		expect(text).toContain("- mcp__sentry: Sentry error tracking");
		expect(state.acceptedFills.has("sentry")).toBe(true);
	});

	it("rejects a fill-in that would truncate the section, and leaves that server bare", () => {
		const entries: SectionEntry[] = [
			{ name: "docs-api", base: "", fill: "Docs API" },
			{ name: "huge", base: "", fill: "x".repeat(8000) },
		];
		const state = { acceptedFills: new Set<string>(), capEngaged: false };
		const text = sectionText(entries, state);
		expect(text).toContain("- mcp__docs_api: Docs API");
		expect(text.split("\n").includes("- mcp__huge")).toBe(true);
		expect(state.acceptedFills.has("huge")).toBe(false);
	});
});
