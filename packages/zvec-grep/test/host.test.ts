import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RG_TIMEOUT_MS, SEARCH_TIMEOUT_MS, type Exec, createZgCli, spawnExec } from "../src/cli.ts";
import { createZvecGrepHost } from "../src/host.ts";

/**
 * `ZVEC_GREP_PI_WORKSPACE` is pinned for every test in this file: the default-root cases then resolve
 * against a scratch directory instead of reading whatever a machine happens to have configured.
 */
const ENV_KEYS = ["ZVEC_GREP_PI_ROOTS", "ZVEC_GREP_PI_WORKSPACE", "ZVEC_GREP_EMBEDDING"] as const;
const saved = new Map<string, string | undefined>();
let workspace = "";
const dirs: string[] = [];

beforeEach(() => {
	for (const key of ENV_KEYS) {
		saved.set(key, process.env[key]);
		delete process.env[key];
	}
	workspace = mkdtempSync(join(tmpdir(), "zvec-ws-"));
	dirs.push(workspace);
	process.env.ZVEC_GREP_PI_WORKSPACE = workspace;
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = saved.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Reply = { stdout?: string; stderr?: string; code?: number };

function harness(
	options: {
		style?: "legacy" | "modern";
		reply?: Reply;
		perRoot?: Record<string, Reply>;
		signal?: () => AbortSignal | undefined;
	} = {},
) {
	const calls: Array<{ args: string[]; cwd: string; timeout: number; signal?: AbortSignal }> = [];
	const exec: Exec = async (_command, args, execOptions) => {
		if (args[0] === "--version") return { stdout: "zvec-grep 0.2.0", stderr: "", code: 0 };
		calls.push({ args, cwd: execOptions.cwd, timeout: execOptions.timeout, signal: execOptions.signal });
		const reply = options.perRoot?.[execOptions.cwd] ?? options.reply ?? {};
		return { stdout: reply.stdout ?? "", stderr: reply.stderr ?? "", code: reply.code ?? 0 };
	};
	const cli = createZgCli({ exec, env: { ZVEC_GREP_CLI_STYLE: options.style ?? "legacy" } });
	const progress: string[] = [];
	const host = createZvecGrepHost({
		cwd: "/session/dir",
		cli,
		progress: (text) => progress.push(text),
		...(options.signal ? { signal: options.signal } : {}),
	});
	return { calls, host, progress };
}

/** The error a call raised, so its Python name can be asserted (monty maps by `.name`). */
async function raised(call: () => Promise<unknown>): Promise<Error> {
	try {
		await call();
	} catch (error) {
		return error as Error;
	}
	throw new Error("expected the call to raise");
}

describe("the boundary", () => {
	test("the names are the tool names, because monty binds by `.name`", () => {
		const { host } = harness();
		expect(Object.keys(host).sort()).toEqual(["zvec_grep_rg", "zvec_grep_search"]);
		expect(host.zvec_grep_search.name).toBe("zvec_grep_search");
		expect(host.zvec_grep_rg.name).toBe("zvec_grep_rg");
	});
});

describe("zvec_grep_search", () => {
	test("keyword arguments become the legacy argv, run in the workspace, and come back as text", async () => {
		const { calls, host, progress } = harness({ reply: { stdout: "1. src/a.ts:12 auth\n" } });
		const text = await host.zvec_grep_search({ query: "where is auth", limit: 7 } as never);
		expect(text).toBe("1. src/a.ts:12 auth");
		expect(calls).toEqual([
			{ args: ["query", "--limit", "7", "where is auth"], cwd: workspace, timeout: SEARCH_TIMEOUT_MS },
		]);
		expect(progress).toEqual(["Searching the indexed workspace…"]);
	});

	test("the modern generation has no `query` subcommand", async () => {
		const { calls, host } = harness({ style: "modern" });
		await host.zvec_grep_search({ query: "x" } as never);
		expect(calls[0]!.args).toEqual(["x"]);
	});

	test("a bare positional is the query", async () => {
		const { calls, host } = harness();
		await host.zvec_grep_search("where is auth" as never);
		expect(calls[0]!.args).toEqual(["query", "where is auth"]);
	});

	test("every query group is passed through, in the order the flags expect", async () => {
		const { calls, host } = harness();
		await host.zvec_grep_search({
			queries: ["a", "b"],
			fts: ["AuthService"],
			vector: ["token refresh"],
			fuse: true,
			limit: 3,
			globs: ["src/**"],
			file_types: ["ts"],
			symbol_type: "function",
			prefer_symbol: true,
			modified_after: "2026-01-01",
			preview: "short",
			refresh: "off",
			mode: "direct",
		} as never);
		expect(calls[0]!.args).toEqual([
			"query",
			"--hybrid", "a", "--hybrid", "b",
			"--fts", "AuthService",
			"--vector", "token refresh",
			"--fuse",
			"--limit", "3",
			"-g", "src/**",
			"-t", "ts",
			"--symbol-type", "function",
			"--prefer-symbol",
			"--modified-after", "2026-01-01",
			"--preview", "short",
			"--refresh", "off",
			"--mode", "direct",
		]);
	});

	test("the tool's camelCase spelling is accepted as an alias", async () => {
		const { calls, host } = harness();
		await host.zvec_grep_search({ query: "x", fileTypes: ["ts"], preferSymbol: true } as never);
		await host.zvec_grep_search({ query: "x", file_types: ["ts"], prefer_symbol: true } as never);
		expect(calls[0]!.args).toEqual(calls[1]!.args);
		expect(calls[0]!.args).toEqual(["query", "-t", "ts", "--prefer-symbol", "x"]);
	});

	test("roots fan out, in the caller's order, and say which root each result came from", async () => {
		const { calls, host } = harness({
			perRoot: { "/a": { stdout: "hit-a" }, "/b": { stderr: "no index", code: 2 } },
		});
		const text = await host.zvec_grep_search({ query: "x", roots: ["/a", "/b"] } as never);
		expect(calls.map((call) => call.cwd)).toEqual(["/a", "/b"]);
		expect(text).toBe("### /a\nhit-a\n\n### /b\nzvec-grep search failed (exit 2).\nno index");
	});

	test("a partial failure is text; a total failure raises RuntimeError", async () => {
		const partial = harness({ perRoot: { "/a": { stdout: "hit-a" }, "/b": { stderr: "no index", code: 2 } } });
		expect(typeof (await partial.host.zvec_grep_search({ query: "x", roots: ["/a", "/b"] } as never))).toBe("string");

		const total = harness({ reply: { stderr: "no index", code: 2 } });
		const error = await raised(() => total.host.zvec_grep_search({ query: "x" } as never));
		expect(error.name).toBe("RuntimeError");
		expect(error.message).toContain("no index");
	});

	test("an empty success comes back as text, not as an error", async () => {
		const { host } = harness({ reply: { stdout: "" } });
		expect(await host.zvec_grep_search({ query: "x" } as never)).toBe("(no results)");
	});
});

describe("zvec_grep_rg", () => {
	test("the command is tokenized, never shelled, and the head bound is honoured", async () => {
		const { calls, host } = harness({ reply: { stdout: "l1\nl2\nl3\nl4" } });
		const text = await host.zvec_grep_rg("rg -n -F loadTheme -g '*.ts' src | head -2" as never);
		expect(calls).toEqual([
			{
				args: ["query", "--rg", "-n", "-F", "loadTheme", "-g", "*.ts", "src"],
				cwd: workspace,
				timeout: RG_TIMEOUT_MS,
			},
		]);
		expect(text).toBe("l1\nl2");
	});

	test("a command that is only a pipe is refused", async () => {
		const { host } = harness();
		const error = await raised(() => host.zvec_grep_rg("| head -5" as never));
		expect(error.name).toBe("ValueError");
	});

	test("no command at all is refused", async () => {
		const { host } = harness();
		expect((await raised(() => host.zvec_grep_rg({} as never))).name).toBe("ValueError");
	});
});

describe("what the boundary refuses", () => {
	test("an unknown parameter is a ValueError that names it", async () => {
		const { host } = harness();
		const error = await raised(() => host.zvec_grep_search({ query: "x", limit: 3, queryGroup: "y" } as never));
		expect(error.name).toBe("ValueError");
		expect(error.message).toBe('zvec_grep_search: unknown parameter "queryGroup"');
	});

	test("a wrong type is a TypeError, and nothing runs", async () => {
		const { calls, host } = harness();
		const error = await raised(() => host.zvec_grep_search({ query: "x", limit: "7" } as never));
		expect(error.name).toBe("TypeError");
		expect(error.message).toContain('"limit" must be a finite number');
		expect(calls).toHaveLength(0);
	});

	test("an enum value outside the set is a ValueError that lists the set", async () => {
		const { host } = harness();
		const error = await raised(() => host.zvec_grep_search({ query: "x", preview: "medium" } as never));
		expect(error.name).toBe("ValueError");
		expect(error.message).toBe('zvec_grep_search: "preview" must be one of none, short, full');
	});

	test("a dict from the cell is a wrong type, not a silent drop", async () => {
		// monty maps a Python dict to a JS `Map`, which is why ask-user-question needs `fromMonty`.
		// Nothing here takes a dict, so the boundary refuses one instead of reading it wrong.
		const { host } = harness();
		const error = await raised(() =>
			host.zvec_grep_search({ query: new Map([["a", "b"]]) } as never),
		);
		expect(error.name).toBe("TypeError");
	});

	test("two positionals are refused", async () => {
		const { host } = harness();
		expect((await raised(() => host.zvec_grep_search("a", "b" as never))).name).toBe("ValueError");
	});

	test("a search with no query at all is refused before anything runs", async () => {
		const { calls, host } = harness();
		const error = await raised(() => host.zvec_grep_search({ limit: 5 } as never));
		expect(error.name).toBe("ValueError");
		expect(error.message).toContain("at least one of query, queries, fts or vector");
		expect(calls).toHaveLength(0);
	});
});


describe("the run's signal (long-work ticket 08)", () => {
	test("hands the executor the run's signal, and nothing when the kernel publishes none", async () => {
		// The kernel's reader, as a session's handle answers it. `undefined` is the honest answer between
		// cells, and a contributor must not read it as "never aborted".
		const controller = new AbortController();
		const withSignal = harness({ signal: () => controller.signal, reply: { stdout: "hit" } });
		await withSignal.host.zvec_grep_rg({ command: "rg -n -F hit" });
		expect(withSignal.calls[0]?.signal).toBe(controller.signal);

		const without = harness({ reply: { stdout: "hit" } });
		await without.host.zvec_grep_rg({ command: "rg -n -F hit" });
		expect(without.calls[0]?.signal).toBeUndefined();
	});

	test("the executor the extension ships kills the process group at the abort", async () => {
		// `spawnExec` is the extension's own executor — the call `pi.exec` makes, without pi — so this is
		// the real thing rather than a fake: a shell that would outlive the turn, killed by the signal a
		// handler hands it. `timeout: 0` is the unbounded case, so the abort is the only thing that can
		// kill it.
		const dir = mkdtempSync(join(tmpdir(), "zvec-sig-"));
		dirs.push(dir);
		const pidFile = join(dir, "pid");
		const controller = new AbortController();
		const running = spawnExec("bash", ["-lc", `echo $$ >> ${pidFile}; sleep 60`], {
			cwd: dir,
			timeout: 0,
			signal: controller.signal,
		});
		let pid = 0;
		for (let waited = 0; waited < 300 && pid === 0; waited += 10) {
			try {
				pid = Number(readFileSync(pidFile, "utf8").trim().split("\n")[0]);
			} catch {
				/* not written yet */
			}
			if (!Number.isFinite(pid)) pid = 0;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(pid).toBeGreaterThan(0);
		controller.abort();
		await running;
		// The kill is a signal (SIGTERM, escalating to SIGKILL after five seconds), so the process is
		// reaped a moment after it is sent.
		const alive = () => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		};
		for (let waited = 0; waited < 3000 && alive(); waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
		expect(alive()).toBe(false);
	});
});
