/** The picker's filter, carried from upstream (`fuzzy.test.ts`). */
import type { SelectItem } from "@earendil-works/pi-tui";

import { describe, expect, it } from "bun:test";

import { filterItems, fuzzyScore, isBackspace, isPrintable } from "../src/fuzzy.ts";

describe("fuzzyScore", () => {
	it("scores an empty query as a match", () => {
		expect(fuzzyScore("", "anything")).toBe(0);
	});

	it("matches a subsequence and refuses a near miss", () => {
		expect(fuzzyScore("opus", "Claude Opus 4")).not.toBeNull();
		expect(fuzzyScore("xopus", "Claude Opus 4")).toBeNull();
	});

	it("ranks a contiguous run above a scatter", () => {
		const contiguous = fuzzyScore("opus", "opus") ?? -1;
		const scattered = fuzzyScore("opus", "o-p-u-s") ?? -1;
		expect(contiguous).toBeGreaterThan(scattered);
	});

	it("rewards a word-boundary hit", () => {
		const boundary = fuzzyScore("opus", "Claude Opus") ?? -1;
		const inside = fuzzyScore("opus", "xxopus") ?? -1;
		expect(boundary).toBeGreaterThan(inside);
	});
});

describe("filterItems", () => {
	const items: SelectItem[] = [
		{ value: "anthropic/sonnet", label: "Sonnet  (anthropic)" },
		{ value: "anthropic/opus", label: "Opus  (anthropic)" },
	];

	it("returns the items unchanged, by identity, for an empty query", () => {
		expect(filterItems(items, "")).toBe(items);
	});

	it("matches the value as well as the label, so a provider id finds its model", () => {
		expect(filterItems(items, "opus").map((i) => i.value)).toEqual(["anthropic/opus"]);
		expect(filterItems(items, "anthropic")).toHaveLength(2);
	});

	it("drops what does not match", () => {
		expect(filterItems(items, "zzz")).toEqual([]);
	});
});

describe("key classification", () => {
	it("treats DEL and backspace as backspace", () => {
		expect(isBackspace("\u007f")).toBe(true);
		expect(isBackspace("\b")).toBe(true);
		expect(isBackspace("a")).toBe(false);
	});

	it("treats a printable character as printable and a control sequence as not", () => {
		expect(isPrintable("a")).toBe(true);
		expect(isPrintable(" ")).toBe(true);
		expect(isPrintable("\u001b[A")).toBe(false);
		expect(isPrintable("\u007f")).toBe(false);
	});
});
