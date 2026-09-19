/**
 * The `# => value` line. The Map case is the one that bites: monty hands a Python dict
 * back as a JS `Map`, and stringifying that without help yields `{}` — a silent wrong
 * answer, which the acceptance criteria treat as disqualifying.
 */
import { describe, expect, it } from "bun:test";
import { renderValue } from "../src/render";

describe("rendering a cell's value", () => {
	it("renders a dict the way the kernel hands it back", () => {
		const asMontyHandsIt = new Map<string, unknown>([
			["exit_code", 0],
			["stdout", "hi"],
		]);
		expect(renderValue(asMontyHandsIt)).toBe('{"exit_code":0,"stdout":"hi"}');
	});

	it("renders nested containers and sets", () => {
		expect(renderValue(new Map([["rows", [new Map([["n", 1]])]]]))).toBe('{"rows":[{"n":1}]}');
		expect(renderValue(new Set([1, 2]))).toBe("[1,2]");
	});

	it("renders the ordinary JSON cases", () => {
		expect(renderValue(42)).toBe("42");
		expect(renderValue("text")).toBe('"text"');
		expect(renderValue([1, "two", null])).toBe('[1,"two",null]');
		expect(renderValue(null)).toBe("null");
	});

	it("falls back rather than throwing when JSON cannot express the value", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(renderValue(cyclic)).toBe("[object Object]");
		expect(renderValue(10n)).toBe('"10n"');
	});
});
