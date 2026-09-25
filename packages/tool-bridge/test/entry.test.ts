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
import { __clearChildDetectorForTests, setChildDetector } from "../../host-bridge/src/convention";
import { __resetHostBridgeForTests, recordSession, registerContributor, sessionKey } from "../../host-bridge/src/convention";
import { __resetToolBridgeForTests } from "../src/convention";
import { toolBridgeRegistration } from "../src/registration";
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
	recordSession(sessionKey(ctx), {
		mounted: true,
		owners: ["magic-context"],
		installed: ["tool"],
		reaches: ["ctx_memory"],
		promptTexts: [],
		problems: [],
	});
	return { active, handlers };
}

describe("the entry's two moments", () => {
	beforeEach(() => {
		__resetToolBridgeForTests();
		__resetHostBridgeForTests();
		// The seam's own reset drops registrations too, and this package's is made at module load.
		registerContributor(toolBridgeRegistration);
	});

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

describe("a resumed child (child-surface ticket 03 §5)", () => {
	beforeEach(() => {
		__resetToolBridgeForTests();
		__resetHostBridgeForTests();
		registerContributor(toolBridgeRegistration);
		__clearChildDetectorForTests();
	});

	/**
	 * A child opened on its own loads the ambient manifest, so `createAgentSession`'s registry filter
	 * never ran: its active set is a root's — the builtins, every published tool, and whatever an ambient
	 * extension re-appended — and only *this* entry is late enough in the manifest to correct it before
	 * the first turn's prompt is built. Its ceiling is the declared fallback, because there is no spawner
	 * to read.
	 */
	function resumed(active: string[]) {
		const entries: Array<{ customType: string; data: unknown }> = [];
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const pi = {
			on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
				handlers.set(name, handler);
			},
			appendEntry(customType: string, data: unknown) {
				entries.push({ customType, data });
			},
			getActiveTools: () => [...active],
			getAllTools: () => [
				{ name: "read" },
				{ name: "bash" },
				{ name: "python" },
				{ name: "ctx_memory" },
				{ name: "todowrite" },
			],
			setActiveTools(names: string[]) {
				active.splice(0, active.length, ...names);
			},
		};
		toolBridge(pi);
		return { active, handlers, entries };
	}

	it("narrows an ambient registry to the fallback ceiling, and records where it came from", () => {
		const ctx = ctxFor("resumed-child");
		setChildDetector((c: any) => c?.sessionManager?.getSessionId?.() === "resumed-child");
		const { active, handlers, entries } = resumed([
			"read",
			"bash",
			"edit",
			"write",
			"python",
			"ctx_memory",
			"ctx_note",
		]);
		handlers.get("session_start")?.({}, ctx);

		// Direction 1 of the child's reconcile — keep only ceiling ∩ registered — which no other check
		// reaches: a spawned child's registry was already filtered by pi at construction.
		expect(active).toEqual(["python", "todowrite"]);
		expect(entries).toEqual([
			{
				customType: "rlm-child-surface",
				data: {
					surface: ["python", "todowrite"],
					ceiling: ["python", "todowrite"],
					source: "fallback",
					deactivated: ["read", "bash", "edit", "write", "ctx_memory", "ctx_note"],
					restored: ["todowrite"],
				},
			},
		]);
	});

	it("leaves a root session to the root's rule", () => {
		const ctx = ctxFor("root");
		setChildDetector(() => false);
		const { active, handlers, entries } = resumed(["python", "ctx_memory"]);
		recordSession(sessionKey(ctx), {
		mounted: true,
		owners: ["magic-context"],
		installed: ["tool"],
		reaches: ["ctx_memory"],
		promptTexts: [],
		problems: [],
	});
		handlers.get("session_start")?.({}, ctx);
		expect(active).toEqual(["python", "todowrite"]);
		expect(entries).toEqual([]);
	});
});

