/**
 * The engine's lanes, its mapping table, and every question it refuses.
 *
 * A fake slot stands in for `pi-fff`: what matters here is what the engine *asks* and what it answers
 * with, not the native index behind it (the fork's own suite covers that, and `tools/` in
 * `.scratch/fff-search` measured the real one).
 */
import { describe, expect, it } from "bun:test";

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

function grepQuery(over: Partial<KernelGrepQuery> = {}): KernelGrepQuery {
	return {
		pattern: "needle",
		path: CWD,
		glob: null,
		ignoreCase: false,
		literal: false,
		context: 0,
		limit: 100,
		index: true,
		fuzzy: false,
		...over,
	};
}

function findQuery(over: Partial<KernelFindQuery> = {}): KernelFindQuery {
	return {
		pattern: "*.ts",
		path: CWD,
		limit: 1000,
		maxDepth: 0,
		type: "file",
		index: true,
		fuzzy: false,
		...over,
	};
}

type Call = { call: string; query: string; options: Record<string, unknown> };

function harness(options: { fails?: string; waitThrows?: boolean; root?: string } = {}) {
	const calls: Call[] = [];
	const routes: Array<Record<string, unknown>> = [];
	const waits: number[] = [];
	const items: Record<string, unknown[]> = {
		grep: [{ relativePath: "src/a.ts", lineNumber: 7, lineContent: "  needle  " }],
		glob: [{ relativePath: "src/a.ts" }],
		fileSearch: [{ relativePath: "src/a.ts" }],
		directorySearch: [{ relativePath: "src/" }, { relativePath: "src/deep/" }],
		mixedSearch: [
			{ type: "file", item: { relativePath: "src/a.ts" } },
			{ type: "directory", item: { relativePath: "src/" } },
		],
	};
	const root = options.root ?? CWD;
	const method =
		<T>(kind: string) =>
		(query: string, opts: Record<string, unknown>): SlotResult<T> => {
			calls.push({ call: kind, query, options: opts });
			if (options.fails) return { ok: false, error: options.fails };
			return { ok: true, value: { items: items[kind] as T[] } };
		};
	const finder: SlotFinder = {
		grep: method<SlotGrepItem>("grep"),
		glob: method<SlotPathItem>("glob"),
		fileSearch: method<SlotPathItem>("fileSearch"),
		directorySearch: method<SlotPathItem>("directorySearch"),
		mixedSearch: method<unknown>("mixedSearch"),
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
			return { finder, query, root };
		},
	};
	return { api, calls, routes, waits, engine: createSearchEngine({ cwd: CWD, readSlot: () => api }) };
}

describe("the slot reader", () => {
	it("takes the published shape and refuses anything else whole", () => {
		const good = { apiVersion: 1, activeCwd: () => CWD, route: async () => ({}) };
		expect(readFinderSlot({ [FINDER_SLOT]: good })).toBe(good as never);
		expect(readFinderSlot({ [FINDER_SLOT]: { ...good, apiVersion: 2 } })).toBeNull();
		expect(readFinderSlot({ [FINDER_SLOT]: { apiVersion: 1 } })).toBeNull();
		expect(readFinderSlot({})).toBeNull();
	});
});

describe("the index is asked for, never assumed", () => {
	it("declines both primitives when the cell asked for neither lane", async () => {
		const h = harness();
		await expect(h.engine.grep(grepQuery({ index: false }))).rejects.toThrow(DECLINED.noLane);
		await expect(h.engine.find(findQuery({ index: false }))).rejects.toThrow(DECLINED.noLane);
		expect(h.calls).toEqual([]);
	});

	it("declines when no finder is published in this process", async () => {
		const engine = createSearchEngine({ cwd: CWD, readSlot: () => null });
		await expect(engine.grep(grepQuery())).rejects.toThrow(DECLINED.noSlot);
		await expect(engine.find(findQuery())).rejects.toThrow(DECLINED.noSlot);
	});
});

describe("grep's exact lane", () => {
	it("asks for the matcher the cell's own flags name, and for rg's case behaviour", async () => {
		const h = harness();
		const matches = await h.engine.grep(grepQuery({ limit: 25, context: 2 }));

		expect(h.calls).toEqual([
			{
				call: "grep",
				query: "/root needle",
				options: {
					mode: "regex",
					smartCase: false,
					maxMatchesPerFile: 25,
					pageSize: 25,
					beforeContext: 2,
					afterContext: 2,
				},
			},
		]);
		expect(matches).toEqual([{ path: "/root/src/a.ts", line: 7, text: "  needle" }]);
	});

	it("uses the literal matcher for `literal`, and the cell's case flag for `ignore_case`", async () => {
		const h = harness();
		await h.engine.grep(grepQuery({ literal: true }));
		expect(h.calls[0]?.options.mode).toBe("plain");
		expect(h.calls[0]?.options.smartCase).toBe(false);

		// An all-lowercase pattern is where smart-case *is* case-insensitive, so this is exact.
		await h.engine.grep(grepQuery({ ignoreCase: true, pattern: "needle" }));
		expect(h.calls[1]?.options.smartCase).toBe(true);
	});

	it("declines an explicit case-insensitive search the index cannot express", async () => {
		const h = harness();
		await expect(h.engine.grep(grepQuery({ ignoreCase: true, pattern: "Needle" }))).rejects.toThrow(
			DECLINED.caseInsensitive,
		);
		expect(h.calls).toEqual([]);
	});

	it("declines a regex the index could not compile, rather than answering with a substring search", async () => {
		const h = harness();
		const engine = createSearchEngine({
			cwd: CWD,
			readSlot: () => ({
				...h.api,
				route: async () => ({
					finder: {
						grep: () => ({
							ok: true as const,
							value: { items: [], regexFallbackError: "unclosed group at position 2" },
						}),
						glob: () => ({ ok: true as const, value: { items: [] } }),
						fileSearch: () => ({ ok: true as const, value: { items: [] } }),
						directorySearch: () => ({ ok: true as const, value: { items: [] } }),
						mixedSearch: () => ({ ok: true as const, value: { items: [] } }),
					},
					query: "a(b",
					root: CWD,
				}),
			}),
		});
		await expect(engine.grep(grepQuery({ pattern: "a(b" }))).rejects.toThrow(DECLINED.regexUncompiled);
	});

	it("answers a relative request with paths relative to the session directory, and joins a glob", async () => {
		const h = harness();
		const matches = await h.engine.grep(grepQuery({ path: "src", glob: "*.ts" }));
		expect(h.routes[0]?.path).toBe("src/*.ts");
		expect(matches[0]?.path).toBe("src/a.ts");

		await h.engine.grep(grepQuery({ glob: "!test/" }));
		expect(h.routes[1]?.path).toBe(CWD);
		expect(h.routes[1]?.exclude).toBe("test/");
	});
});

describe("grep's fuzzy lane", () => {
	it("asks for FFF's own matcher and leaves the case flags to it", async () => {
		const h = harness();
		await h.engine.grep(grepQuery({ fuzzy: true, literal: true, ignoreCase: true }));
		expect(h.calls[0]?.options.mode).toBe("fuzzy");
		expect("smartCase" in (h.calls[0]?.options ?? {})).toBe(false);
	});

	it("is reachable without `index`: fuzzy implies the index", async () => {
		const h = harness();
		await h.engine.grep(grepQuery({ index: false, fuzzy: true }));
		expect(h.calls).toHaveLength(1);
	});
});

describe("find's exact lane", () => {
	it("uses the index's glob matcher, with the constraint rebuilt from the finder's own root", async () => {
		const h = harness();
		expect(await h.engine.find(findQuery())).toEqual(["/root/src/a.ts"]);
		expect(h.calls[0]?.call).toBe("glob");
		expect(h.calls[0]?.query).toBe("*.ts");
		expect(h.calls[0]?.options).toEqual({ pageSize: 1000 });

		await h.engine.find(findQuery({ path: "src", pattern: "*.ts" }));
		expect(h.calls[1]?.query).toBe("src/*.ts");
	});

	it("rebases onto a finder rooted above the session, which is what the auxiliary pool hands out", async () => {
		const h = harness({ root: "/" });
		await h.engine.find(findQuery({ path: "/root/src", pattern: "*.ts" }));
		expect(h.calls[0]?.query).toBe("root/src/*.ts");
	});

	it("declines a path the covering finder does not contain", async () => {
		const h = harness({ root: "/root/src" });
		await expect(h.engine.find(findQuery({ path: "/elsewhere" }))).rejects.toThrow(DECLINED.outsideRoot);
		expect(h.calls).toEqual([]);
	});

	it("declines what the exact matcher cannot enumerate: directories, and both kinds at once", async () => {
		const h = harness();
		await expect(h.engine.find(findQuery({ type: "directory" }))).rejects.toThrow(DECLINED.directoryExact);
		await expect(h.engine.find(findQuery({ type: "" }))).rejects.toThrow(DECLINED.anyType);
		await expect(h.engine.find(findQuery({ maxDepth: 2 }))).rejects.toThrow(DECLINED.maxDepth);
		await expect(h.engine.find(findQuery({ type: "symlink" }))).rejects.toThrow(DECLINED.type);
		expect(h.calls).toEqual([]);
	});
});

describe("find's fuzzy lane", () => {
	it("uses the call the cell's type names, and the mixed one for files *and* directories", async () => {
		const h = harness();
		expect(await h.engine.find(findQuery({ fuzzy: true, type: "file" }))).toEqual(["/root/src/a.ts"]);
		expect(h.calls[0]?.call).toBe("fileSearch");

		expect(await h.engine.find(findQuery({ fuzzy: true, type: "directory" }))).toEqual([
			"/root/src/",
			"/root/src/deep/",
		]);
		expect(h.calls[1]?.call).toBe("directorySearch");

		expect(await h.engine.find(findQuery({ fuzzy: true, type: "" }))).toEqual([
			"/root/src/a.ts",
			"/root/src/",
		]);
		expect(h.calls[2]?.call).toBe("mixedSearch");
	});
});

describe("the dot-path guard", () => {
	it("declines a constraint that names one, where the index is blind", async () => {
		const h = harness();
		await expect(h.engine.grep(grepQuery({ path: ".scratch" }))).rejects.toThrow(DECLINED.dotPath);
		await expect(h.engine.grep(grepQuery({ path: `${CWD}/.github` }))).rejects.toThrow(DECLINED.dotPath);
		expect(h.calls).toEqual([]);
	});

	it("declines a find whose *pattern* names one: a find pattern is a path glob", async () => {
		const h = harness();
		await expect(h.engine.find(findQuery({ pattern: ".scratch/*" }))).rejects.toThrow(DECLINED.dotPath);
		await expect(h.engine.find(findQuery({ pattern: ".env*", fuzzy: true }))).rejects.toThrow(
			DECLINED.dotPath,
		);
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
});

describe("failures and the cold index", () => {
	it("turns a failed FFF call into a decline, so code mode can fall back", async () => {
		const h = harness({ fails: "no index" });
		await expect(h.engine.grep(grepQuery())).rejects.toThrow("fff grep failed: no index");
		await expect(h.engine.find(findQuery())).rejects.toThrow("fff find failed: no index");
	});

	it("waits for a cold index, bounded, and answers anyway when it never becomes ready", async () => {
		const h = harness({ waitThrows: true });
		expect(await h.engine.grep(grepQuery())).toHaveLength(1);
		expect(h.waits).toEqual([INDEX_WAIT_MS]);
	});
});
