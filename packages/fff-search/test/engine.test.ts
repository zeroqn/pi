/**
 * The engine's mapping table, and every question it refuses.
 *
 * A fake slot stands in for `pi-fff`: what matters here is what the engine *asks* and what it answers
 * with, not the native index behind it (the fork's own suite covers that, and `tools/` in
 * `.scratch/fff-search` measured the real one).
 */
import { describe, expect, it } from "bun:test";
import { isAbsolute } from "node:path";

import type { KernelFindQuery, KernelGrepQuery } from "../../host-bridge/src/client.ts";
import { DECLINED, INDEX_WAIT_MS, createSearchEngine, namesDotPath } from "../src/engine.ts";
import {
	FINDER_SLOT,
	readFinderSlot,
	type SlotApi,
	type SlotFinder,
	type SlotGrepItem,
	type SlotPathItem,
	type SlotResult,
} from "../src/slot.ts";

const CWD = "/root";

function grepQuery(overrides: Partial<KernelGrepQuery> = {}): KernelGrepQuery {
	return {
		pattern: "needle",
		path: CWD,
		glob: null,
		ignoreCase: false,
		literal: false,
		context: 0,
		limit: 100,
		fuzzy: true,
		...overrides,
	};
}

function findQuery(overrides: Partial<KernelFindQuery> = {}): KernelFindQuery {
	return { pattern: "*.ts", path: CWD, limit: 1000, maxDepth: 0, type: "", fuzzy: true, ...overrides };
}

type Call = { call: string; query: string; options: Record<string, unknown> };

function harness(options: { fails?: string; waitThrows?: boolean } = {}) {
	const calls: Call[] = [];
	const routes: Array<Record<string, unknown>> = [];
	const waits: number[] = [];
	const items: Record<string, unknown[]> = {
		grep: [{ relativePath: "src/a.ts", lineNumber: 7, lineContent: "  needle  " }],
		fileSearch: [{ relativePath: "src/a.ts" }],
		directorySearch: [{ relativePath: "src/" }, { relativePath: "src/deep/" }],
	};
	const method =
		<T>(kind: string) =>
		(query: string, opts: Record<string, unknown>): SlotResult<T> => {
			calls.push({ call: kind, query, options: opts });
			if (options.fails) return { ok: false, error: options.fails };
			return { ok: true, value: { items: items[kind] as T[] } };
		};
	const finder: SlotFinder = {
		grep: method<SlotGrepItem>("grep"),
		fileSearch: method<SlotPathItem>("fileSearch"),
		directorySearch: method<SlotPathItem>("directorySearch"),
		waitForIndexReady: async (ms?: number) => {
			waits.push(ms ?? 0);
			if (options.waitThrows) throw new Error("index never became ready");
			return { ok: true, value: true };
		},
	};
	const api: SlotApi = {
		apiVersion: 1,
		activeCwd: () => CWD,
		route: async (input) => {
			routes.push({ ...input });
			// The publisher's own job is building the query; the engine's is passing it on untouched.
			const query = [input.path, ...(input.exclude ? [input.exclude] : []), input.pattern]
				.filter((part) => typeof part === "string" && part.length > 0)
				.join(" ");
			return { finder, query, root: CWD };
		},
	};
	return { api, calls, routes, waits, engine: createSearchEngine({ cwd: CWD, readSlot: () => api }) };
}

describe("the slot reader", () => {
	it("takes the published shape and refuses anything else whole", () => {
		const good = { apiVersion: 1, activeCwd: () => CWD, route: async () => ({}) };
		expect(readFinderSlot({ [FINDER_SLOT]: good })).toBe(good as never);
		// A version this build does not know is refused rather than half-read.
		expect(readFinderSlot({ [FINDER_SLOT]: { ...good, apiVersion: 2 } })).toBeNull();
		expect(readFinderSlot({ [FINDER_SLOT]: { apiVersion: 1 } })).toBeNull();
		expect(readFinderSlot({})).toBeNull();
	});
});

describe("the index lane is asked for", () => {
	it("declines both primitives when the cell did not ask for the index", async () => {
		const h = harness();
		await expect(h.engine.grep(grepQuery({ fuzzy: false }))).rejects.toThrow(DECLINED.notAsked);
		await expect(h.engine.find(findQuery({ fuzzy: false }))).rejects.toThrow(DECLINED.notAsked);
		expect(h.calls).toEqual([]);
	});

	it("declines when no finder is published in this process", async () => {
		const engine = createSearchEngine({ cwd: CWD, readSlot: () => null });
		await expect(engine.grep(grepQuery())).rejects.toThrow(DECLINED.noSlot);
	});
});

describe("grep in the index lane", () => {
	it("asks for FFF's own matching, bounded by the cell's limit", async () => {
		const h = harness();
		const matches = await h.engine.grep(grepQuery({ limit: 25, context: 2 }));

		expect(h.calls).toEqual([
			{
				call: "grep",
				query: "/root needle",
				options: { mode: "fuzzy", maxMatchesPerFile: 25, pageSize: 25, beforeContext: 2, afterContext: 2 },
			},
		]);
		// An absolute request answers with absolute paths, as the base's rg would have printed them.
		expect(matches).toEqual([{ path: "/root/src/a.ts", line: 7, text: "  needle" }]);
	});

	it("answers a relative request with paths relative to the session directory", async () => {
		const h = harness();
		const matches = await h.engine.grep(grepQuery({ path: "src" }));

		expect(h.routes[0]?.path).toBe("src");
		expect(matches[0]?.path).toBe("src/a.ts");
	});

	it("joins a positive glob into the path constraint, and passes a negated one as an exclusion", async () => {
		const h = harness();
		await h.engine.grep(grepQuery({ path: "src", glob: "*.ts" }));
		expect(h.routes[0]?.path).toBe("src/*.ts");
		expect(h.routes[0]?.exclude).toBeUndefined();

		await h.engine.grep(grepQuery({ glob: "!test/" }));
		expect(h.routes[1]?.path).toBe(CWD);
		expect(h.routes[1]?.exclude).toBe("test/");
	});

	it("declines a query that names a dot-path, where the index is blind", async () => {
		const h = harness();
		await expect(h.engine.grep(grepQuery({ path: ".scratch" }))).rejects.toThrow(DECLINED.dotPath);
		await expect(h.engine.grep(grepQuery({ path: `${CWD}/.github` }))).rejects.toThrow(DECLINED.dotPath);
		expect(h.calls).toEqual([]);
	});

	it("passes an exclusion through even when it names a dot-path: excluding what the index cannot see changes nothing", async () => {
		const h = harness();
		await h.engine.grep(grepQuery({ path: "src", glob: "!.scratch/" }));
		expect(h.routes[0]?.exclude).toBe(".scratch/");
	});

	it("does not mistake a workspace that merely lives under a dot-directory", () => {
		// pi's own agent directory is full of dot-segments; a session rooted there is not a query about one.
		const cwd = "/home/dev/.pi/agent/git/github.com/zeroqn/pi";
		expect(namesDotPath(cwd, cwd)).toBe(false);
		expect(namesDotPath(`${cwd}/packages/fff-search`, cwd)).toBe(false);
		expect(namesDotPath(`${cwd}/.scratch`, cwd)).toBe(true);
	});

	it("turns a failed FFF call into a decline, so code mode can fall back", async () => {
		const h = harness({ fails: "no index" });
		await expect(h.engine.grep(grepQuery())).rejects.toThrow("fff grep failed: no index");
	});

	it("waits for a cold index, bounded, and answers anyway when it never becomes ready", async () => {
		const h = harness({ waitThrows: true });
		expect(await h.engine.grep(grepQuery())).toHaveLength(1);
		expect(h.waits).toEqual([INDEX_WAIT_MS]);
	});
});

describe("find in the index lane", () => {
	it("uses FFF's fuzzy file search for files and directory search for directories", async () => {
		const h = harness();
		expect(await h.engine.find(findQuery({ type: "file" }))).toEqual(["/root/src/a.ts"]);
		expect(h.calls[0]?.call).toBe("fileSearch");
		expect(h.calls[0]?.options).toEqual({ pageSize: 1000 });

		// A directory keeps the trailing `/` both engines print, and the absolute form survives the join.
		expect(await h.engine.find(findQuery({ type: "directory" }))).toEqual([
			"/root/src/",
			"/root/src/deep/",
		]);
		expect(h.calls[1]?.call).toBe("directorySearch");
	});

	it("declines fd's knobs, which the index has no equivalent for", async () => {
		const h = harness();
		await expect(h.engine.find(findQuery({ type: "symlink" }))).rejects.toThrow(DECLINED.type);
		await expect(h.engine.find(findQuery({ maxDepth: 2 }))).rejects.toThrow(DECLINED.maxDepth);
		await expect(h.engine.find(findQuery({ path: ".github" }))).rejects.toThrow(DECLINED.dotPath);
		expect(h.calls).toEqual([]);
	});
});
