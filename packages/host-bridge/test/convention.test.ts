/**
 * The registry's rules: what a registration must be, how the slot behaves, the session key — including
 * that it is the *same* key code mode's mounter derives — and what a session record is worth.
 *
 * The agreement test imports code mode's own `createSessionKeys` on purpose. This package may not
 * import code mode at runtime (ADR 0001: a second module instance), but a test comparing two pure
 * functions is exactly where that risk belongs: a handle's `sessionKey` and a record filed under
 * `sessionKey(ctx)` must be one string, or the composition and its readers silently stop matching.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createSessionKeys } from "../../code-mode/src/contract";
import {
	API_VERSION,
	type SessionRecord,
	__resetHostBridgeForTests,
	detectsChild,
	setChildDetector,
	contributors,
	forgetSession,
	pruneSessions,
	recordSession,
	registerContributor,
	sessionKey,
	sessionRecord,
} from "../src/convention";

beforeEach(() => {
	__resetHostBridgeForTests();
});

function registration(overrides: Record<string, unknown> = {}) {
	return { key: "k", owner: "o", apiVersion: API_VERSION, ...overrides };
}

describe("registerContributor", () => {
	test("refuses a malformed registration with a reason, and throws nothing", () => {
		expect(registerContributor(null)).toEqual({
			registered: false,
			reason: "the registration is not an object",
		});
		expect(registerContributor(registration({ key: "" }))).toEqual({
			registered: false,
			reason: "the registration has no instance key",
		});
		expect(registerContributor(registration({ owner: "" }))).toEqual({
			registered: false,
			reason: '"k" has no owner name',
		});
		expect(registerContributor(registration({ apiVersion: undefined }))).toEqual({
			registered: false,
			reason: '"k" has no numeric apiVersion',
		});
		expect(registerContributor(registration({ apiVersion: 0 }))).toEqual({
			registered: false,
			reason: `"k" speaks version 0, and this build needs ${API_VERSION}`,
		});
		expect(registerContributor(registration({ session: "not a function" }))).toEqual({
			registered: false,
			reason: '"k" has a session that is not a function',
		});
		expect(registerContributor(registration({ childFactories: "not a function" }))).toEqual({
			registered: false,
			reason: '"k" has childFactories that are not a function',
		});
		expect(registerContributor(registration({ childEligible: "not a function" }))).toEqual({
			registered: false,
			reason: '"k" has childEligible that is not a function',
		});
		expect(registerContributor(registration({ childSurface: "not a function" }))).toEqual({
			registered: false,
			reason: '"k" has childSurface that is not a function',
		});
		expect(contributors()).toEqual([]);
	});

	test("takes a well-formed registration, including one with nothing to offer", () => {
		expect(registerContributor(registration())).toEqual({ registered: true });
		expect(contributors().map((entry) => entry.key)).toEqual(["k"]);
	});

	test("replaces under the same instance key, because pi re-imports an entry", () => {
		registerContributor(registration({ owner: "first" }));
		registerContributor(registration({ owner: "second" }));
		expect(contributors().map((entry) => entry.owner)).toEqual(["second"]);
	});

	test("reads registrations in key order, not insertion order", () => {
		registerContributor(registration({ key: "zulu", owner: "z" }));
		registerContributor(registration({ key: "alpha", owner: "a" }));
		expect(contributors().map((entry) => entry.key)).toEqual(["alpha", "zulu"]);
	});
});

describe("sessionKey", () => {
	test("keys by the session file, absolutely, and agrees across ctx objects", () => {
		const sessionManager = { getSessionFile: () => "/sessions/a.jsonl" };
		// pi hands out a fresh ctx per call, so ctx identity is not the identity of the session.
		expect(sessionKey({ sessionManager })).toBe(sessionKey({ sessionManager }));
		// Absolute, so two spellings of one file cannot become two sessions.
		const relative = sessionKey({ sessionManager: { getSessionFile: () => "relative/a.jsonl" } });
		expect(relative).toEndWith("/relative/a.jsonl");
		expect(relative.startsWith("/")).toBe(true);
	});

	test("keys an unpersisted session on the manager's identity, one key per manager", () => {
		const manager = { getSessionId: () => "u-1" };
		const other = { getSessionId: () => "u-2" };
		const first = sessionKey({ sessionManager: manager });
		expect(first).toStartWith("unpersisted#");
		expect(sessionKey({ sessionManager: manager })).toBe(first);
		expect(sessionKey({ sessionManager: other })).not.toBe(first);
	});

	test("survives a ctx whose every property throws, which is what a disposed ctx does", () => {
		// A shutdown handler is a caller (`forgetSession(sessionKey(ctx))`), and a disposed ctx throws on
		// every property read — `sessionManager` included. The key is its own, so it matches no record.
		const disposed = new Proxy({}, { get: () => { throw new Error("session is gone"); } });
		expect(sessionKey(disposed)).toStartWith("unpersisted#");
		expect(sessionKey(disposed)).toBe(sessionKey(disposed));
		expect(sessionKey(undefined)).toStartWith("unpersisted#");
		expect(sessionKey(null)).toStartWith("unpersisted#");
	});

	test("derives the key code mode's own mounter derives", () => {
		const persisted = { sessionManager: { getSessionFile: () => "/sessions/b.jsonl" } };
		const unpersisted = { sessionManager: { getSessionId: () => "u-3" } };
		const keys = createSessionKeys();
		expect(sessionKey(persisted)).toBe(keys.of(persisted));
		expect(sessionKey(unpersisted)).toBe(keys.of(unpersisted));
	});
});

describe("session records", () => {
	const record: SessionRecord = {
		mounted: true,
		owners: ["rlm", "rlm", "web-access"],
		installed: ["web_search", "web_search"],
		reaches: ["ctx_search", "ctx_search"],
		promptTexts: ["be careful", "be careful", "   "],
		problems: [],
	};

	test("normalises names so a reader sees each once, and reads back by key", () => {
		recordSession("a", record);
		expect(sessionRecord("a")).toEqual({
			mounted: true,
			owners: ["rlm", "web-access"],
			installed: ["web_search"],
			reaches: ["ctx_search"],
			promptTexts: ["be careful"],
			problems: [],
		});
		expect(sessionRecord("b")).toBeUndefined();
	});

	test("forgets one session, whatever the reason", () => {
		recordSession("a", record);
		forgetSession("a");
		expect(sessionRecord("a")).toBeUndefined();
	});

	test("prunes by the caller's predicate, and keeps a record a throwing predicate names", () => {
		recordSession("a", record);
		recordSession("b", { ...record, mounted: false });
		expect(pruneSessions((key) => key === "a")).toEqual(["a"]);
		expect(sessionRecord("a")).toBeUndefined();
		expect(sessionRecord("b")).toBeDefined();
		expect(
			pruneSessions(() => {
				throw new Error("cannot tell");
			}),
		).toEqual([]);
		expect(sessionRecord("b")).toBeDefined();
	});
});

describe("the child detector (ticket 03)", () => {
	test("answers false until rlm installs one, and contains a throwing detector", () => {
		expect(detectsChild({})).toBe(false);
		setChildDetector((ctx) => (ctx as { child?: boolean }).child === true);
		expect(detectsChild({ child: true })).toBe(true);
		expect(detectsChild({})).toBe(false);
		setChildDetector(() => {
			throw new Error("cannot tell");
		});
		expect(detectsChild({ child: true })).toBe(false);
	});
});

describe("the single-owner childSurface slot (ticket 04)", () => {
	test("lets one contributor hold the last word, and refuses a second with the reason", () => {
		expect(registerContributor(registration({ key: "pi-tool-bridge", childSurface: () => null }))).toEqual({
			registered: true,
		});
		expect(
			registerContributor(registration({ key: "pi-web-access", childSurface: () => null })),
		).toEqual({
			registered: false,
			reason:
				'"pi-web-access" cannot hold childSurface — "pi-tool-bridge" already does (one contributor gets the last word on a child\'s active set)',
		});
		expect(contributors().map((entry) => entry.key)).toEqual(["pi-tool-bridge"]);
	});

	test("lets the holder replace its own claim, and lets another contributor register without one", () => {
		registerContributor(registration({ key: "pi-tool-bridge", childSurface: () => null }));
		expect(registerContributor(registration({ key: "pi-tool-bridge", childSurface: () => null }))).toEqual({
			registered: true,
		});
		expect(registerContributor(registration({ key: "pi-web-access", owner: "web-access" }))).toEqual({
			registered: true,
		});
		expect(contributors().map((entry) => entry.key)).toEqual(["pi-tool-bridge", "pi-web-access"]);
	});
});
