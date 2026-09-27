/**
 * The reviewer's surface block (ticket 05): what a cell can call, not what the host has registered.
 *
 * The session record the block reads is `pi-host-bridge`'s own, written here through the seam's real
 * writer — the test drives the contract rather than a copy of it.
 */
import { beforeEach, describe, expect, it } from "bun:test";

import { recordSession, sessionKey } from "../../host-bridge/src/convention.ts";
import {
	__cacheSizeForTests,
	__resetInventoryForTests,
	executorSurfaceMessage,
	forgetExecutorSurface,
	installedHostFunctions,
	surfaceBlockText,
} from "../src/inventory.ts";

function ctxFor(sessionFile: string): unknown {
	return { sessionManager: { getSessionFile: () => sessionFile } };
}

function record(ctx: unknown, installed: string[]): void {
	recordSession(sessionKey(ctx), {
		mounted: true,
		owners: ["test-owner"],
		installed,
		reaches: [],
		promptTexts: [],
		problems: [],
	});
}

beforeEach(() => {
	__resetInventoryForTests();
});

describe("surfaceBlockText", () => {
	it("names the block after the surface, not after tools", () => {
		expect(surfaceBlockText([])).toContain("## Available Executor Surface");
	});

	it("says the executor is in a cell and lists its primitives", () => {
		const text = surfaceBlockText([]);
		expect(text).toContain("persistent Python cell");
		expect(text).toContain("`bash_host`");
		expect(text).toContain("`read_text`");
		expect(text).toContain("not necessarily callable from a cell");
	});

	it("lists the contributed names sorted, one line each", () => {
		const text = surfaceBlockText(["zvec_grep_search", "advisor", "zvec_grep_rg"]);
		const lines = text.split("### Contributed host functions")[1]?.trim().split("\n");
		expect(lines).toEqual(["- `advisor`", "- `zvec_grep_rg`", "- `zvec_grep_search`"]);
	});

	it("says so out loud when nothing beyond the primitives is contributed", () => {
		expect(surfaceBlockText([])).toContain("No host function beyond the primitives");
	});
});

describe("installedHostFunctions", () => {
	it("answers what the session's record says landed", () => {
		const ctx = ctxFor("/tmp/advisor-inv-a.jsonl");
		record(ctx, ["advisor", "web_search"]);
		expect(installedHostFunctions(ctx).sort()).toEqual(["advisor", "web_search"]);
	});

	it("answers nothing for a session with no record", () => {
		expect(installedHostFunctions(ctxFor("/tmp/advisor-inv-none.jsonl"))).toEqual([]);
	});

	it("answers nothing for a ctx that cannot be keyed", () => {
		expect(installedHostFunctions({ sessionManager: { getSessionFile: () => undefined } })).toEqual([]);
	});
});

describe("executorSurfaceMessage", () => {
	it("is a user message carrying the block", () => {
		const ctx = ctxFor("/tmp/advisor-inv-b.jsonl");
		record(ctx, ["advisor"]);
		const message = executorSurfaceMessage(ctx);
		expect((message as { role: string }).role).toBe("user");
		expect(JSON.stringify(message)).toContain("- `advisor`");
	});

	it("is the same message object twice in a session — the payload must not wobble", () => {
		const ctx = ctxFor("/tmp/advisor-inv-c.jsonl");
		record(ctx, ["advisor"]);
		expect(executorSurfaceMessage(ctx)).toBe(executorSurfaceMessage(ctx));
	});

	it("keys the cache per session, so a child's block is its own", () => {
		const parent = ctxFor("/tmp/advisor-inv-parent.jsonl");
		const child = ctxFor("/tmp/advisor-inv-child.jsonl");
		record(parent, ["advisor", "rlm_spawn"]);
		record(child, ["advisor"]);
		const parentText = JSON.stringify(executorSurfaceMessage(parent));
		const childText = JSON.stringify(executorSurfaceMessage(child));
		expect(parentText).toContain("rlm_spawn");
		expect(childText).not.toContain("rlm_spawn");
	});

	it("rebuilds when the record changes under a live session key", () => {
		const ctx = ctxFor("/tmp/advisor-inv-d.jsonl");
		record(ctx, ["advisor"]);
		const before = JSON.stringify(executorSurfaceMessage(ctx));
		record(ctx, ["advisor", "fetch_content"]);
		const after = JSON.stringify(executorSurfaceMessage(ctx));
		expect(before).not.toContain("fetch_content");
		expect(after).toContain("fetch_content");
	});

	it("forgets one session's block on shutdown", () => {
		const ctx = ctxFor("/tmp/advisor-inv-e.jsonl");
		record(ctx, ["advisor"]);
		executorSurfaceMessage(ctx);
		expect(__cacheSizeForTests()).toBe(1);
		forgetExecutorSurface(sessionKey(ctx));
		expect(__cacheSizeForTests()).toBe(0);
	});
});
