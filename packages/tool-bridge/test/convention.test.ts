/**
 * The contract a publisher obeys (`.scratch/tool-bridge/` tickets 04 and 08).
 *
 * The test that matters most here is the first one: it writes a publication the way an *owner*
 * would — by hand, through the symbol literal, importing nothing but the symbol from this package
 * — because that is the whole point of publishing by convention instead of by dependency.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import {
	API_VERSION,
	OWNERS_SYMBOL,
	SESSIONS_SYMBOL,
	__resetToolBridgeForTests,
	bridgedSession,
	forgetSession,
	publications,
	recordBridged,
	sessionKey,
	type BridgePublication,
} from "../src/convention";

function fakeCtx(id: string, file?: string) {
	return {
		sessionManager: {
			getSessionId: () => id,
			getSessionFile: () => file ?? `/sessions/${id}.jsonl`,
		},
	};
}

function publish(key: string, owner: string, names: string[] = ["ctx_search"]): void {
	const slot = (globalThis as Record<symbol, unknown>)[OWNERS_SYMBOL] as
		| Map<string, BridgePublication>
		| undefined;
	const target = slot ?? new Map<string, BridgePublication>();
	if (!slot) (globalThis as Record<symbol, unknown>)[OWNERS_SYMBOL] = target;
	target.set(key, {
		owner,
		apiVersion: API_VERSION,
		catalogue: () => names.map((name) => ({ name })),
		execute: async () => ({ content: [{ type: "text", text: `${owner} ok` }] }),
	});
}

describe("the owners slot", () => {
	beforeEach(() => __resetToolBridgeForTests());

	it("is found by an owner that only duplicates the symbol literal", () => {
		// Exactly what a publisher writes: no import of this package's types, no function call.
		const literal = Symbol.for("pi-tool-bridge:owners");
		const slot = ((globalThis as Record<symbol, unknown>)[literal] ??= new Map());
		(slot as Map<string, unknown>).set("by-hand", {
			owner: "some-extension",
			apiVersion: 1,
			catalogue: () => [{ name: "some_tool" }],
			execute: async () => undefined,
		});

		const live = publications();
		expect(live).toHaveLength(1);
		expect(live[0].publication.owner).toBe("some-extension");
	});

	it("lists owners in a stable order, whatever order they published in", () => {
		publish("b", "second");
		publish("a", "first");
		expect(publications().map((entry) => entry.key)).toEqual(["a", "b"]);
	});

	it("replaces a publication for the same instance key", () => {
		publish("instance", "old", ["ctx_search"]);
		publish("instance", "new", ["ctx_reduce"]);
		const live = publications();
		expect(live).toHaveLength(1);
		expect(live[0].publication.owner).toBe("new");
		expect(live[0].publication.catalogue(fakeCtx("s")).map((entry) => entry.name)).toEqual([
			"ctx_reduce",
		]);
	});
});

describe("the session key (the derivation itself is pi-host-bridge's)", () => {
	beforeEach(() => __resetToolBridgeForTests());

	it("keys a session by its file, absolutely, and keeps two unpersisted sessions apart", () => {
		expect(sessionKey(fakeCtx("s", "sessions/one.jsonl")).endsWith("sessions/one.jsonl")).toBe(true);
		expect(sessionKey(fakeCtx("s", "sessions/one.jsonl"))).toBe(
			sessionKey(fakeCtx("s", "sessions/one.jsonl")),
		);
		const unpersisted = { sessionManager: { getSessionId: () => "u" } };
		expect(sessionKey(unpersisted)).toStartWith("unpersisted#");
		expect(sessionKey(unpersisted)).toBe(sessionKey(unpersisted));
		expect(sessionKey({ sessionManager: { getSessionId: () => "v" } })).not.toBe(
			sessionKey(unpersisted),
		);
	});

});
