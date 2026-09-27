import { describe, expect, test } from "bun:test";
import {
	MAX_OUTPUT_CHARS,
	RG_TIMEOUT_MS,
	SEARCH_TIMEOUT_MS,
	type Exec,
	boundOutput,
	buildRgArgs,
	buildSearchArgs,
	createZgCli,
	formatRootResults,
	lastNonEmptyLine,
	parseIndexArgs,
	runAcrossRoots,
	serverAction,
	spawnExec,
	styleForVersion,
	tokenizeRgCommand,
} from "../src/cli.ts";

/** A `zg` that answers `--version` and records everything it was asked to do. */
function fakeZg(options: { version?: string; stdout?: string; stderr?: string; code?: number } = {}) {
	const all: Array<{ args: string[]; cwd: string; timeout: number }> = [];
	const exec: Exec = async (_command, args, execOptions) => {
		all.push({ args, cwd: execOptions.cwd, timeout: execOptions.timeout });
		if (args[0] === "--version") {
			return { stdout: options.version ?? "zvec-grep 0.2.0", stderr: "", code: 0 };
		}
		return { stdout: options.stdout ?? "", stderr: options.stderr ?? "", code: options.code ?? 0 };
	};
	return { all, exec, runs: () => all.filter((call) => call.args[0] !== "--version") };
}

describe("styleForVersion", () => {
	test("0.2.1 is the first modern CLI", () => {
		expect(styleForVersion("zvec-grep 0.2.0")).toBe("legacy");
		expect(styleForVersion("zvec-grep 0.2.1")).toBe("modern");
		expect(styleForVersion("0.2.2")).toBe("modern");
		expect(styleForVersion("0.3.0")).toBe("modern");
		expect(styleForVersion("1.0.0")).toBe("modern");
		expect(styleForVersion("no version here")).toBe("modern");
	});
});

describe("argv", () => {
	test("the legacy generation keeps the `query` subcommand", () => {
		expect(buildSearchArgs("legacy", { query: "where is auth" })).toEqual(["query", "where is auth"]);
		expect(buildSearchArgs("modern", { query: "where is auth" })).toEqual(["where is auth"]);
	});

	test("every search parameter becomes its flag", () => {
		const args = buildSearchArgs("modern", {
			queries: ["a", "b"],
			fts: ["AuthService"],
			vector: ["token refresh"],
			fuse: true,
			limit: 7,
			globs: ["src/**", "!**/*.test.ts"],
			iglobs: ["*.TS"],
			fileTypes: ["ts"],
			excludedFileTypes: ["json"],
			symbolType: "function",
			preferSymbol: true,
			modifiedAfter: "2026-01-01",
			modifiedBefore: "2026-02-01",
			preview: "short",
			refresh: "off",
			mode: "direct",
		});
		expect(args).toEqual([
			"--hybrid", "a", "--hybrid", "b",
			"--fts", "AuthService",
			"--vector", "token refresh",
			"--fuse",
			"--limit", "7",
			"-g", "src/**", "-g", "!**/*.test.ts",
			"--iglob", "*.TS",
			"-t", "ts",
			"-T", "json",
			"--symbol-type", "function",
			"--prefer-symbol",
			"--modified-after", "2026-01-01",
			"--modified-before", "2026-02-01",
			"--preview", "short",
			"--refresh", "off",
			"--mode", "direct",
		]);
	});

	test("a query beginning with - is escaped, and stays last", () => {
		expect(buildSearchArgs("modern", { query: "--weird", limit: 3 })).toEqual([
			"--limit", "3", "--", "--weird",
		]);
	});

	test("managed rg carries the generation's selector", () => {
		expect(buildRgArgs("legacy", ["-n", "x"])).toEqual(["query", "--rg", "-n", "x"]);
		expect(buildRgArgs("modern", ["-n", "x"])).toEqual(["--rg", "-n", "x"]);
	});
});

describe("tokenizeRgCommand", () => {
	test("quotes survive and the leading selector is dropped", () => {
		expect(tokenizeRgCommand("rg -n -F 'loadTheme' -g '*.ts' src").args).toEqual([
			"-n", "-F", "loadTheme", "-g", "*.ts", "src",
		]);
		expect(tokenizeRgCommand("zg --rg -n x").args).toEqual(["-n", "x"]);
		expect(tokenizeRgCommand('rg "two words"').args).toEqual(["two words"]);
		expect(tokenizeRgCommand("").args).toEqual([]);
	});

	test("a trailing pipe into head becomes a bound, not an argument", () => {
		expect(tokenizeRgCommand("rg -n x | head -20")).toEqual({ args: ["-n", "x"], head: 20 });
		expect(tokenizeRgCommand("rg -n x | head -n 5").head).toBe(5);
		expect(tokenizeRgCommand("rg -n x | head -n5").head).toBe(5);
		expect(tokenizeRgCommand("rg -n x | head 5").head).toBe(5);
		expect(tokenizeRgCommand("rg -n x | head").head).toBeUndefined();
	});
});

describe("boundOutput", () => {
	test("head slices lines, and the character bound is the last word", () => {
		expect(boundOutput("a\nb\nc", 2)).toBe("a\nb");
		const long = "x".repeat(MAX_OUTPUT_CHARS + 50);
		const bounded = boundOutput(long);
		expect(bounded.length).toBeGreaterThan(MAX_OUTPUT_CHARS);
		expect(bounded.endsWith(`characters]`)).toBe(true);
		expect(bounded.startsWith("x".repeat(100))).toBe(true);
	});
});

describe("createZgCli", () => {
	test("the binary comes from ZVEC_GREP_BIN, and the style override skips the probe", async () => {
		const { all, exec } = fakeZg();
		const cli = createZgCli({ exec, env: { ZVEC_GREP_BIN: "/custom/zg", ZVEC_GREP_CLI_STYLE: "legacy" } });
		expect(cli.binary).toBe("/custom/zg");
		expect(await cli.style("/tmp")).toBe("legacy");
		expect(all).toHaveLength(0);
	});

	test("the probe answers once for the life of the instance", async () => {
		const { all, exec } = fakeZg({ version: "zvec-grep 0.2.0" });
		const cli = createZgCli({ exec, env: {} });
		expect(await cli.style("/tmp")).toBe("legacy");
		expect(await cli.style("/other")).toBe("legacy");
		expect(all.filter((call) => call.args[0] === "--version")).toHaveLength(1);
	});

	test("a probe that cannot run is modern", async () => {
		const exec: Exec = async () => {
			throw new Error("no zg here");
		};
		expect(await createZgCli({ exec, env: {} }).style("/tmp")).toBe("modern");
	});

	test("run passes the cwd and the timeout through", async () => {
		const { exec, runs } = fakeZg();
		await createZgCli({ exec, env: { ZVEC_GREP_CLI_STYLE: "modern" } }).run(["--status"], {
			cwd: "/work",
			timeout: 1234,
		});
		expect(runs()).toEqual([{ args: ["--status"], cwd: "/work", timeout: 1234 }]);
	});
});

describe("runAcrossRoots / formatRootResults", () => {
	test("one run per root, in order, each in its own cwd", async () => {
		const { exec, runs } = fakeZg({ stdout: "hit" });
		const cli = createZgCli({ exec, env: { ZVEC_GREP_CLI_STYLE: "modern" } });
		const outcomes = await runAcrossRoots(cli, ["/a", "/b"], ["--rg", "x"], undefined, RG_TIMEOUT_MS);
		expect(runs()).toEqual([
			{ args: ["--rg", "x"], cwd: "/a", timeout: RG_TIMEOUT_MS },
			{ args: ["--rg", "x"], cwd: "/b", timeout: RG_TIMEOUT_MS },
		]);
		expect(outcomes.map((outcome) => outcome.root)).toEqual(["/a", "/b"]);
	});

	test("a partial failure is text; a total failure is counted", async () => {
		const partial = formatRootResults(
			"zvec-grep search",
			[
				{ root: "/a", result: { stdout: "hit\n", stderr: "", code: 0 } },
				{ root: "/b", result: { stdout: "", stderr: "no index", code: 3 } },
			],
			{ header: true },
		);
		expect(partial.failed).toBe(1);
		expect(partial.text).toBe("### /a\nhit\n\n### /b\nzvec-grep search failed (exit 3).\nno index");

		const total = formatRootResults(
			"zvec-grep rg",
			[{ root: "/a", result: { stdout: "", stderr: "boom", code: 1 } }],
			{ header: false },
		);
		expect(total.failed).toBe(1);
		expect(total.text).toBe("zvec-grep rg failed (exit 1).\nboom");
	});

	test("an empty success is a result, not an error", () => {
		const { text, failed } = formatRootResults(
			"zvec-grep search",
			[{ root: "/a", result: { stdout: "   ", stderr: "", code: 0 } }],
			{ header: false },
		);
		expect(failed).toBe(0);
		expect(text).toBe("(no results)");
	});
});

describe("commands", () => {
	test("parseIndexArgs reads the flags it documents", () => {
		expect(parseIndexArgs("--rebuild --root /w local/potion")).toEqual({
			rebuild: true,
			drop: false,
			root: "/w",
			model: "local/potion",
		});
		expect(parseIndexArgs("--drop")).toEqual({ rebuild: false, drop: true, root: undefined, model: undefined });
		expect(parseIndexArgs("")).toEqual({ rebuild: false, drop: false, root: undefined, model: undefined });
	});

	test("serverAction follows the generation", async () => {
		const { exec, runs } = fakeZg();
		const cli = createZgCli({ exec, env: { ZVEC_GREP_CLI_STYLE: "legacy" } });
		await serverAction(cli, "legacy", "on", "/work");
		await serverAction(cli, "modern", "off", "/work");
		expect(runs().map((call) => call.args)).toEqual([["server", "on"], ["--server", "off"]]);
	});

	test("lastNonEmptyLine ignores trailing blank lines", () => {
		expect(lastNonEmptyLine("a\n\n  \nb\n\n")).toBe("b");
		expect(lastNonEmptyLine("")).toBe("");
	});
});

describe("spawnExec", () => {
	test("captures stdout and the exit code", async () => {
		const result = await spawnExec(
			process.execPath,
			["-e", "process.stdout.write('hello'); process.exit(3)"],
			{ cwd: process.cwd(), timeout: 20_000 },
		);
		expect(result.stdout).toBe("hello");
		expect(result.code).toBe(3);
	});

	test("a missing binary is a failure with the reason in stderr", async () => {
		const result = await spawnExec("/nonexistent/zg-does-not-exist", [], {
			cwd: process.cwd(),
			timeout: 5_000,
		});
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("/nonexistent/zg-does-not-exist");
	});

	test("a timeout is a failure, not a short success", async () => {
		const result = await spawnExec(
			process.execPath,
			["-e", "setTimeout(() => {}, 60000)"],
			{ cwd: process.cwd(), timeout: 300 },
		);
		expect(result.code).not.toBe(0);
	});

	test("the search and rg timeouts are the ones the old tools used", () => {
		expect(SEARCH_TIMEOUT_MS).toBe(10 * 60 * 1000);
		expect(RG_TIMEOUT_MS).toBe(2 * 60 * 1000);
	});
});
