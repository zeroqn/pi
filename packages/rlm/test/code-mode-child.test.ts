/**
 * How a spawned child gets a code-mode instance of its own.
 *
 * A spawned child loads no ambient extensions, so it cannot load one through the manifest. The
 * factory travels on the registry entry rlm already binds — rlm still does not import code mode
 * (ADR 0001), it asks the entry — and it is the publisher's own function object, so the child's
 * instance runs in the publisher's module graph and joins the sessions map already published.
 *
 * Everything here degrades: an entry without the member (an older code mode), an absent entry, a
 * member that returns nothing or throws. The cost of all of them is the same and is bounded — the
 * child keeps its kernel, but has no lifecycle of its own, so the kernel is dumped neither at the end
 * of its turns nor at its disposal and is only reaped at a later `session_start` in the parent.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { codeModeChildExtensions, findCodeMode } from "../src/bind";

const KEY = Symbol.for("pi-code-mode:registry");

/** A minimal entry that passes the shape check, with whatever the case under test adds. */
function entry(extra: Record<string, unknown> = {}) {
	return {
		publisher: "pi-code-mode",
		apiVersion: 1,
		sessions: new Map(),
		mount: () => ({}),
		...extra,
	};
}

function publish(value: unknown) {
	(globalThis as Record<symbol, unknown>)[KEY] = value;
}

beforeEach(() => {
	delete (globalThis as Record<symbol, unknown>)[KEY];
});
afterEach(() => {
	delete (globalThis as Record<symbol, unknown>)[KEY];
});

describe("the factory a child's loader is given", () => {
	test("is handed out verbatim", () => {
		const factory = (pi: unknown) => pi;
		publish(entry({ childExtension: () => factory }));
		expect(findCodeMode().status).toBe("found");
		expect(codeModeChildExtensions()).toEqual([factory]);
	});

	test("an entry without the member contributes nothing", () => {
		// An older code mode. The child is then served exactly as it was: mounted through the registry
		// by its spawner, dumped late.
		publish(entry());
		expect(findCodeMode().status).toBe("found");
		expect(codeModeChildExtensions()).toEqual([]);
	});

	test("an absent entry contributes nothing and does not throw", () => {
		expect(findCodeMode().status).toBe("absent");
		expect(codeModeChildExtensions()).toEqual([]);
	});

	test("a member that is not a function, returns nothing, or throws contributes nothing", () => {
		publish(entry({ childExtension: 7 }));
		expect(codeModeChildExtensions()).toEqual([]);

		publish(entry({ childExtension: () => undefined }));
		expect(codeModeChildExtensions()).toEqual([]);

		publish(
			entry({
				childExtension: () => {
					throw new Error("boom");
				},
			}),
		);
		expect(codeModeChildExtensions()).toEqual([]);
	});
});
