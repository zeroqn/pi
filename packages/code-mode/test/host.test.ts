/**
 * The two search host functions. `grep`: ripgrep when the host has it, GNU grep when it has not,
 * and one shape (`path:line:text`) read back from either — a cell should not be able to tell which
 * engine answered, except through the files that engine's own ignore rules leave out. `find`: fd
 * when the host has it, GNU find when it has not, with the two knobs the shell `find`s in the
 * journals actually used — one list of paths read back from either, a directory marked the same way.
 *
 * The argv of both engines is pinned here, because the live call below can only exercise the one
 * this host has: CI has neither fd nor ripgrep, and a dev box's fd comes from `RLM_FD`.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FindQuery, type GrepQuery, findArgv, grepArgv, makeHost, parseFindOutput, parseGrepOutput } from "../src/host";

function query(over: Partial<GrepQuery> = {}): GrepQuery {
	return {
		pattern: "p",
		path: "/w",
		glob: null,
		ignoreCase: false,
		literal: false,
		context: 0,
		limit: 100,
		fuzzy: false,
		...over,
	};
}

describe("the grep backend's flags", () => {
	it("reads one shape from either engine, and skips a context line", () => {
		expect(parseGrepOutput("src/a.ts:12:const x = 1;\nsrc/a.ts-13-a line of context\n")).toEqual([
			{ path: "src/a.ts", line: 12, text: "const x = 1;" },
		]);
	});

	it("asks ripgrep for hidden files, a file name it cannot omit, and its own glob flag", () => {
		expect(grepArgv("rg", query({ glob: "*.md", ignoreCase: true, literal: true, context: 2, limit: 5 }))).toEqual([
			"--hidden",
			"--with-filename",
			"--line-number",
			"--no-heading",
			"--color=never",
			"-i",
			"-F",
			"--glob",
			"*.md",
			"-C",
			"2",
			"-m",
			"5",
			"--",
			"p",
			"/w",
		]);
	});

	it("asks GNU grep recursively, with a glob as --include or --exclude", () => {
		expect(grepArgv("grep", query({ glob: "!*.lock" }))).toEqual([
			"-r",
			"-n",
			"-H",
			"--color=never",
			"--exclude=*.lock",
			"-m",
			"100",
			"-e",
			"p",
			"/w",
		]);
	});
});

describe("a real grep call, whichever engine this host has", () => {
	const host = (root: string) => makeHost({ root, attachments: [], extra: {}, background: {} as never });

	it("returns path, line and text, and an empty list when nothing matches", async () => {
		const root = mkdtempSync(join(tmpdir(), "code-mode-grep-"));
		writeFileSync(join(root, "a.txt"), "first\nsecond has the NEEDLE\n");
		const grep = host(root).grep;
		expect(await grep("NEEDLE", { literal: true })).toEqual([
			{ path: join(root, "a.txt"), line: 2, text: "second has the NEEDLE" },
		]);
		// Exit 1 with nothing on stdout is how both engines say "no matches". It is an empty list,
		// never an error and never a sentinel line a cell could mistake for a hit.
		expect(await grep("NOTHING-ANYWHERE-9f3c", { literal: true })).toEqual([]);
	});
});

describe("find's two engines, whose flags are not each other's", () => {
	function findQuery(over: Partial<FindQuery> = {}): FindQuery {
		return { pattern: "*.txt", path: "/w", limit: 1000, maxDepth: 0, type: "", fuzzy: false, ...over };
	}

	it("asks fd for a glob, hidden files, and its two knobs by name", () => {
		expect(findArgv("fd", findQuery({ limit: 5, maxDepth: 2, type: "directory" }))).toEqual([
			"--glob",
			"--color=never",
			"--hidden",
			"--no-require-git",
			"--max-results",
			"5",
			"--max-depth",
			"2",
			"--type",
			"directory",
			"--",
			"*.txt",
			"/w",
		]);
	});

	it("tells fd when the pattern names a path, and writes the depth into the glob", () => {
		expect(findArgv("fd", findQuery({ pattern: "src/*.ts" }))).toEqual([
			"--glob",
			"--color=never",
			"--hidden",
			"--no-require-git",
			"--max-results",
			"1000",
			"--full-path",
			"--",
			"**/src/*.ts",
			"/w",
		]);
	});

	it("asks GNU find for a depth, a letter instead of the type's name, and the type it prints", () => {
		expect(findArgv("find", findQuery({ maxDepth: 2, type: "directory" }))).toEqual([
			"/w",
			"-mindepth",
			"1",
			"-maxdepth",
			"2",
			"-type",
			"d",
			"-name",
			"*.txt",
			"-printf",
			"%y %p\\n",
		]);
	});

	it("matches the whole path with -path, whose `*` already crosses separators", () => {
		expect(findArgv("find", findQuery({ pattern: "src/*.ts" }))).toEqual([
			"/w",
			"-mindepth",
			"1",
			"-path",
			"**/src/*.ts",
			"-printf",
			"%y %p\\n",
		]);
	});

	it("maps fd's type names onto find's own letters and primaries, and leaves the rest to -type", () => {
		const tail = ["-name", "*.txt", "-printf", "%y %p\\n"];
		expect(findArgv("find", findQuery({ type: "x" }))).toEqual(["/w", "-mindepth", "1", "-executable", ...tail]);
		expect(findArgv("find", findQuery({ type: "block-device" }))).toEqual(["/w", "-mindepth", "1", "-type", "b", ...tail]);
		expect(findArgv("find", findQuery({ type: "empty" }))).toEqual(["/w", "-mindepth", "1", "-empty", ...tail]);
		expect(findArgv("find", findQuery({ type: "bogus" }))).toEqual(["/w", "-mindepth", "1", "-type", "bogus", ...tail]);
	});

	it("turns an empty pattern into the glob that matches everything, which the engines spell alike", () => {
		expect(findArgv("fd", findQuery({ pattern: "" })).slice(-2)).toEqual(["*", "/w"]);
		expect(findArgv("find", findQuery({ pattern: "" }))).toEqual(["/w", "-mindepth", "1", "-name", "*", "-printf", "%y %p\\n"]);
	});

	it("gives a directory a trailing slash whichever engine printed it", () => {
		expect(parseFindOutput("fd", "/w/a/\n/w/a/one.txt\n")).toEqual(["/w/a/", "/w/a/one.txt"]);
		expect(parseFindOutput("find", "d /w/a\nf /w/a/one.txt\n")).toEqual(["/w/a/", "/w/a/one.txt"]);
	});
});

describe("find, whose two knobs come from the shell calls it replaces", () => {
	const host = (root: string) => makeHost({ root, attachments: [], extra: {}, background: {} as never });

	// These assert order rather than sorting the expectation: that is the point of the sort in the
	// host function. Note the residual -- a run that hit `limit` is still whichever entries fd
	// stopped after, so the sort makes a *result* repeatable, not a truncated *set*.
	it("narrows by max_depth and by type, marks a directory with a trailing slash, and sorts", async () => {
		const root = mkdtempSync(join(tmpdir(), "code-mode-find-"));
		mkdirSync(join(root, "a", "b"), { recursive: true });
		writeFileSync(join(root, "a", "one.txt"), "");
		writeFileSync(join(root, "a", "b", "two.txt"), "");
		const find = host(root).find;
		// `a/b/two.txt` sorts before `a/one.txt`, and it is the deeper one: the sort is lexical over
		// the whole path, not a traversal order that happens to look sorted.
		expect(await find("*.txt")).toEqual([join(root, "a", "b", "two.txt"), join(root, "a", "one.txt")]);
		expect(await find("*.txt", { max_depth: 2 })).toEqual([join(root, "a", "one.txt")]);
		expect(await find("*", { type: "directory" })).toEqual([`${join(root, "a")}/`, `${join(root, "a", "b")}/`]);
	});

	it("fails loudly on a type fd does not know, rather than answering with no matches", async () => {
		const root = mkdtempSync(join(tmpdir(), "code-mode-find-bad-"));
		await expect(host(root).find("*", { type: "bogus" })).rejects.toThrow(/find failed/);
	});
});

describe("the session's engine, when one was contributed (fff-search ticket 05)", () => {
	const dir = () => mkdtempSync(join(tmpdir(), "code-mode-engine-"));
	const engineHost = (root: string, engine: unknown, guard?: unknown) =>
		makeHost({
			root,
			attachments: [],
			extra: {},
			background: {} as never,
			engine: engine as never,
			guard: guard as never,
		});

	it("answers grep from the engine, with the cell's question normalized and the cut made here", async () => {
		const root = dir();
		const seen: GrepQuery[] = [];
		const host = engineHost(root, {
			grep: async (query: GrepQuery) => {
				seen.push(query);
				return [0, 1, 2, 3, 4].map((i) => ({ path: `/w/${i}`, line: i + 1, text: "hit" }));
			},
			find: async () => [],
		});
		expect(
			await host.grep("needle", { glob: "*.ts", ignore_case: true, literal: true, context: 2, limit: 3, fuzzy: true }),
		).toEqual([0, 1, 2].map((i) => ({ path: `/w/${i}`, line: i + 1, text: "hit" })));
		// The engine is handed the *cell's* question in normalized form, `fuzzy` included: it never
		// sees argv, and it does not own the cut.
		expect(seen).toEqual([
			{
				pattern: "needle",
				path: root,
				glob: "*.ts",
				ignoreCase: true,
				literal: true,
				context: 2,
				limit: 3,
				fuzzy: true,
			},
		]);
	});

	it("sorts a parity find here, and leaves a fuzzy find in the engine's own order", async () => {
		const root = dir();
		const host = engineHost(root, { grep: async () => [], find: async () => ["/w/b", "/w/a"] });
		// The sort is the parity half and therefore the primitive's: sorting a ranked answer would
		// throw away the reason to ask for one, which is what `fuzzy` is for.
		expect(await host.find("*", { limit: 1 })).toEqual(["/w/a"]);
		expect(await host.find("*", { limit: 1, fuzzy: true })).toEqual(["/w/b"]);
	});

	it("falls back to the host's own engines when the engine throws", async () => {
		const root = dir();
		writeFileSync(join(root, "a.txt"), "first\nsecond has the NEEDLE\n");
		const host = engineHost(root, {
			grep: async () => {
				throw new Error("the index is gone");
			},
			find: async () => {
				throw new Error("the index is gone");
			},
		});
		// Q4a: a throw from the engine is not a cell's failure, and the answer is the same shape.
		expect(await host.grep("NEEDLE", { literal: true })).toEqual([
			{ path: join(root, "a.txt"), line: 2, text: "second has the NEEDLE" },
		]);
		expect(await host.find("*.txt")).toEqual([join(root, "a.txt")]);
	});

	it("asks the guard first, so a refusal is never papered over by the fallback", async () => {
		const root = dir();
		let ran = 0;
		const host = engineHost(
			root,
			{
				grep: async () => {
					ran += 1;
					throw new Error("unreachable: the guard refused");
				},
				find: async () => [],
			},
			{ before: () => ({ allow: false, reason: "read-only mode: refusing grep" }) },
		);
		await expect(host.grep("x")).rejects.toThrow(/refusing grep/);
		expect(ran).toBe(0);
	});
});
