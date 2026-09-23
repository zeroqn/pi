import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { findRsiSeam, rsiBindChild, rsiChildExtensions, rsiStatus } from "../src/rsi-seam";

const KEY = Symbol.for("@earendil/rsi:pi-registry");

function publish(facade: unknown, key: symbol = KEY) {
	(globalThis as Record<symbol, unknown>)[key] = facade;
}

function unpublish() {
	delete (globalThis as Record<symbol, unknown>)[KEY];
}

beforeEach(unpublish);
afterEach(unpublish);

describe("with RSI absent, both calls are inert", () => {
	test("nothing is found, and the status says why", () => {
		expect(findRsiSeam()).toBeNull();
		expect(rsiChildExtensions()).toEqual([]);
		expect(() => rsiBindChild({ sessionFile: "/tmp/s.jsonl" })).not.toThrow();
		expect(rsiStatus()).toContain("no registry");
	});

	test("a differently-named slot is not guessed at", () => {
		// The key is the contract. The old build scanned `Object.getOwnPropertySymbols` for a symbol
		// whose description matched `/rsi/i` — the consumer guessing at the provider's identity on
		// every `session_start`. It is gone, and this is the case that would have found it.
		publish(
			{ childExtension: () => () => {}, bindChild: () => {} },
			Symbol.for("something-else:rsi-ish"),
		);
		expect(findRsiSeam()).toBeNull();
	});
});

describe("with RSI present", () => {
	test("the child factory is handed out verbatim", () => {
		const factory = (pi: unknown) => pi;
		publish({ childExtension: () => factory, bindChild: () => {} });
		expect(rsiChildExtensions()).toEqual([factory]);
		expect(rsiStatus()).toContain("registry found");
	});

	test("a bind carries the session file and nothing of rlm's", () => {
		const seen: unknown[] = [];
		publish({ childExtension: () => () => {}, bindChild: (fact: unknown) => seen.push(fact) });
		rsiBindChild({ sessionFile: "/tmp/s.jsonl" });
		expect(seen).toEqual([{ sessionFile: "/tmp/s.jsonl" }]);
		// The whole payload. A spawn request, a depth or a name crossing here would be rlm's shape
		// leaking into RSI, which is what this effort exists to remove.
		expect(Object.keys(seen[0] as object)).toEqual(["sessionFile"]);
	});

	test("a bind with no session file is passed through as undefined, not dropped", () => {
		const seen: unknown[] = [];
		publish({ childExtension: () => () => {}, bindChild: (fact: unknown) => seen.push(fact) });
		rsiBindChild({});
		expect(seen).toEqual([{ sessionFile: undefined }]);
	});

	test("a facade that is partial or throwing degrades to nothing", () => {
		// An older RSI, whose facade is the six-method one: not this build's shape.
		publish({ skills: () => [] });
		expect(findRsiSeam()).toBeNull();

		publish({ childExtension: () => undefined, bindChild: () => {} });
		expect(rsiChildExtensions()).toEqual([]);

		publish({
			childExtension: () => {
				throw new Error("boom");
			},
			bindChild: () => {},
		});
		expect(rsiChildExtensions()).toEqual([]);

		publish({
			childExtension: () => () => {},
			bindChild: () => {
				throw new Error("boom");
			},
		});
		expect(() => rsiBindChild({})).not.toThrow();
	});
});
