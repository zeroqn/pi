/**
 * The entry (`.scratch/tool-bridge/` ticket 03; its `session_start` half added after the fact).
 *
 * `reconcileToolSurface` is tested on its own in `adapter.test.ts`; what this file pins is *when*
 * the entry calls it. `session_start` matters because pi builds the turn's system prompt — tool
 * list, snippets, guidelines — from the active set before the `before_agent_start` handlers run:
 * Magic Context appends `ctx_memory` on `session_start`, so a rule that only ran per turn still
 * left that name in the prompt pi built for the first turn, and left `todowrite`'s guidelines out
 * of it, while the request itself carried the corrected set.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { __resetToolBridgeForTests, recordBridged, sessionKey } from "../src/convention";
import toolBridge from "../src/index";

function ctxFor(id: string) {
	return {
		sessionManager: {
			getSessionId: () => id,
			getSessionFile: () => `/sessions/${id}.jsonl`,
		},
	};
}

/** A pi whose active set and handlers are visible to the test, and a bridged record for `ctx`. */
function surface(active: string[], ctx: unknown) {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	const pi = {
		on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
			handlers.set(name, handler);
		},
		getActiveTools: () => [...active],
		getAllTools: () => [
			{ name: "python" },
			{ name: "ctx_memory" },
			{ name: "todowrite" },
		],
		setActiveTools(names: string[]) {
			active.splice(0, active.length, ...names);
		},
	};
	toolBridge(pi);
	recordBridged(sessionKey(ctx), { toolNames: ["ctx_memory"], owners: ["magic-context"] });
	return { active, handlers };
}

describe("the entry's two moments", () => {
	beforeEach(() => __resetToolBridgeForTests());

	it("strips at session_start, before the first turn's prompt is built", () => {
		const ctx = ctxFor("session-start");
		const { active, handlers } = surface(["python", "ctx_memory"], ctx);
		handlers.get("session_start")?.({}, ctx);
		expect(active).toEqual(["python", "todowrite"]);
	});

	it("still reconciles before each turn", () => {
		const ctx = ctxFor("per-turn");
		const { active, handlers } = surface(["python", "ctx_memory"], ctx);
		handlers.get("before_agent_start")?.({}, ctx);
		expect(active).toEqual(["python", "todowrite"]);
	});

	it("leaves a session with no record exactly as it was", () => {
		const ctx = ctxFor("unbridged");
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const active = ["python", "ctx_memory"];
		toolBridge({
			on(name, handler) {
				handlers.set(name, handler);
			},
			getActiveTools: () => [...active],
			getAllTools: () => [{ name: "python" }, { name: "ctx_memory" }, { name: "todowrite" }],
			setActiveTools(names: string[]) {
				active.splice(0, active.length, ...names);
			},
		});
		handlers.get("session_start")?.({}, ctx);
		expect(active).toEqual(["python", "ctx_memory"]);
	});
});
