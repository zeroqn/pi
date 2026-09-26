/**
 * The two search host functions. `grep`: ripgrep when the host has it, GNU grep when it has not,
 * and one shape (`path:line:text`) read back from either — a cell should not be able to tell which
 * engine answered, except through the files that engine's own ignore rules leave out. `find`: fd,
 * with the two knobs the shell `find`s in the journals actually used.
 */
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type GrepQuery, grepArgv, makeHost, parseGrepOutput } from "../src/host";

function query(over: Partial<GrepQuery> = {}): GrepQuery {
	return {
		pattern: "p",
		path: "/w",
		glob: null,
		ignoreCase: false,
		literal: false,
		context: 0,
		limit: 100,
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

describe("find, whose two knobs come from the shell calls it replaces", () => {
	const host = (root: string) => makeHost({ root, attachments: [], extra: {}, background: {} as never });
	// fd's order is its own traversal's and a truncated result is whichever `limit` entries it
	// reached first, so these assertions sort rather than pin an order fd never promised.
	const sorted = (paths: string[]) => paths.slice().sort();

	it("narrows by max_depth and by type, and marks a directory with a trailing slash", async () => {
		const root = mkdtempSync(join(tmpdir(), "code-mode-find-"));
		mkdirSync(join(root, "a", "b"), { recursive: true });
		writeFileSync(join(root, "a", "one.txt"), "");
		writeFileSync(join(root, "a", "b", "two.txt"), "");
		const find = host(root).find;
		expect(sorted(await find("*.txt"))).toEqual([join(root, "a", "b", "two.txt"), join(root, "a", "one.txt")]);
		expect(await find("*.txt", { max_depth: 2 })).toEqual([join(root, "a", "one.txt")]);
		expect(sorted(await find("*", { type: "directory" }))).toEqual([`${join(root, "a")}/`, `${join(root, "a", "b")}/`]);
	});

	it("fails loudly on a type fd does not know, rather than answering with no matches", async () => {
		const root = mkdtempSync(join(tmpdir(), "code-mode-find-bad-"));
		await expect(host(root).find("*", { type: "bogus" })).rejects.toThrow(/find failed/);
	});
});
