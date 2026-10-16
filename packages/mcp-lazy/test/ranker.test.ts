/**
 * The ranker (ticket 15): pi's own BM25, copied. These pin the two properties ticket 15 promises — a
 * stable order (determinism, tie included) and the underscore/split behaviour — and the document shape
 * (schema descriptions and instructions are searchable).
 */
import { describe, expect, it } from "bun:test";

import { Bm25Ranker, buildDocument, tokenize } from "../src/ranker";

describe("tokenize", () => {
	it("treats `read_file`, `read-file` and `readFile` as the same terms", () => {
		expect(tokenize("read_file")).toEqual(["read", "file"]);
		expect(tokenize("read-file")).toEqual(["read", "file"]);
		expect(tokenize("readFile")).toEqual(["read", "file"]);
		expect(tokenize("read file")).toEqual(["read", "file"]);
	});
});

describe("buildDocument", () => {
	it("carries the name, the spaced name, the description, schema text and instructions", () => {
		const document = buildDocument({
			name: "mcp__docs_api__read_file",
			description: "Read a file from the docs",
			parameters: {
				type: "object",
				properties: { path: { type: "string", description: "The file path" } },
				required: ["path"],
			},
			namespace: { instructions: "Docs API reference" },
		});
		expect(document.text).toContain("mcp__docs_api__read_file");
		expect(document.text).toContain("read file");
		expect(document.text).toContain("Read a file from the docs");
		expect(document.text).toContain("path");
		expect(document.text).toContain("The file path");
		expect(document.text).toContain("Docs API reference");
	});
});

describe("Bm25Ranker", () => {
	it("ranks a tool whose name matches above one that matches only in a schema description", () => {
		const documents = [
			{ name: "other", text: "other tool with a property described as read file" },
			{ name: "read_file", text: "read_file read file reads a file" },
		];
		const matches = new Bm25Ranker().rank("read file", documents, 5);
		expect(matches.map((match) => match.name)).toEqual(["read_file", "other"]);
	});

	it("is deterministic, including across a tie", () => {
		const documents = [
			{ name: "first", text: "alpha beta" },
			{ name: "second", text: "alpha beta" },
			{ name: "third", text: "alpha beta" },
		];
		const ranker = new Bm25Ranker();
		const a = ranker.rank("alpha", documents, 3);
		const b = ranker.rank("alpha", documents, 3);
		expect(a).toEqual(b);
		expect(a.map((match) => match.name)).toEqual(["first", "second", "third"]);
	});

	it("bounds the result and never errors when the limit is above the match count", () => {
		const documents = Array.from({ length: 40 }, (_, index) => ({
			name: `t${index}`,
			text: "search the docs",
		}));
		const ranker = new Bm25Ranker();
		expect(ranker.rank("search", documents, 5)).toHaveLength(5);
		expect(ranker.rank("search", documents, 999)).toHaveLength(40);
	});
});
