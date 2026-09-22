/**
 * rlm's adoption of the tool bridge (wayfinder ticket 06) — the boundary, not the bridge's own
 * rules: what this session records, what a session with nothing published looks like, and that a
 * refused contribution leaves pi's active set alone.
 *
 * The publications and the kernel handle are fakes, which is the point: the adoption has to work
 * against a *structural* handle, and a real kernel would test monty rather than this call.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { reconcileToolSurface } from "../../tool-bridge/src/adapter";
import {
	__resetToolBridgeForTests,
	bridgedSession,
	sessionKey,
	type BridgePublication,
} from "../../tool-bridge/src/convention";
import { adoptToolBridge, bridgeStatusLine } from "../src/tool-bridge";

const OWNERS = Symbol.for("pi-tool-bridge:owners");

function ctx(id: string) {
	return {
		cwd: "/w",
		sessionManager: {
			getSessionId: () => id,
			getSessionFile: () => `/sessions/${id}.jsonl`,
		},
	};
}

/** What an owner publishes: one tool, answered per session. */
function publish(key: string, owner: string, names: string[]): void {
	const slot = (globalThis as Record<symbol, unknown>)[OWNERS] as
		| Map<string, BridgePublication>
		| undefined;
	const target = slot ?? new Map<string, BridgePublication>();
	if (!slot) (globalThis as Record<symbol, unknown>)[OWNERS] = target;
	target.set(key, {
		owner,
		apiVersion: 1,
		catalogue: () => names.map((name) => ({ name })),
		execute: async () => ({ content: [{ type: "text", text: `${name} says ok` }] }),
	});
}

/** A kernel handle's `contribute`, recording what it was handed. */
function handle(accepted: string[] = ["tool"]) {
	const contributions: unknown[] = [];
	return {
		contributions,
		contribute: (contribution: unknown) => {
			contributions.push(contribution);
			return { owner: "pi-tool-bridge", accepted, rejected: [] };
		},
	};
}

describe("adopting the bridge in a session", () => {
	beforeEach(() => __resetToolBridgeForTests());

	it("records the names a cell can call, and hands the kernel one host function", () => {
		publish("mc", "magic-context", ["ctx_search", "ctx_reduce"]);
		const kernel = handle();
		const session = ctx("adopt-one");
		const report = adoptToolBridge({ contribute: kernel.contribute, ctx: session });

		expect(report.installed).toEqual(["ctx_search", "ctx_reduce"]);
		expect(report.reason).toBeUndefined();
		expect(kernel.contributions).toHaveLength(1);
		expect(Object.keys((kernel.contributions[0] as { hostFns: object }).hostFns)).toEqual(["tool"]);
		expect(bridgedSession(sessionKey(session))?.toolNames).toEqual(["ctx_search", "ctx_reduce"]);
		expect(bridgeStatusLine(report)).toBe("tool bridge: a cell can call ctx_search, ctx_reduce");
	});

	it("installs nothing, and records nothing, when no owner has published", () => {
		const kernel = handle();
		const session = ctx("adopt-none");
		const report = adoptToolBridge({ contribute: kernel.contribute, ctx: session });

		expect(report.installed).toEqual([]);
		expect(report.reason).toBe("nothing is published");
		expect(kernel.contributions).toEqual([]);
		expect(bridgedSession(sessionKey(session))).toBeUndefined();
		expect(bridgeStatusLine(report)).toBe("tool bridge: nothing installed — nothing is published");
	});

	it("keeps pi's active set untouched when the kernel refuses the contribution", () => {
		publish("mc", "magic-context", ["ctx_memory"]);
		const session = ctx("adopt-refused");
		let active = ["python", "ctx_memory", "ask_user_question"];
		const pi = {
			getActiveTools: () => [...active],
			setActiveTools: (names: string[]) => {
				active = [...names];
			},
		};

		const report = adoptToolBridge({ contribute: handle([]).contribute, ctx: session });
		expect(report.installed).toEqual([]);
		expect(report.reason).toContain("was not accepted");
		expect(bridgedSession(sessionKey(session))).toBeUndefined();
		// Nothing was recorded, so the surface rule has nothing to strip: ctx_memory stays a pi tool,
		// which is the only route this session would otherwise have.
		expect(reconcileToolSurface(pi, session)).toEqual([]);
		expect(active).toContain("ctx_memory");
	});

	it("names what it dropped, and still records what worked", () => {
		publish("mc", "magic-context", ["ctx_search"]);
		// A second owner on a name the first holds: refused whole (ticket 04), reported here.
		publish("other", "other-extension", ["ctx_search", "other_tool"]);
		const session = ctx("adopt-partial");
		const report = adoptToolBridge({ contribute: handle().contribute, ctx: session });

		expect(report.installed).toEqual(["ctx_search"]);
		expect(report.problems).toEqual([
			"other-extension: publishes 'ctx_search', which magic-context already holds — refused whole",
		]);
		expect(bridgeStatusLine(report)).toContain("dropped: other-extension:");
	});
});
