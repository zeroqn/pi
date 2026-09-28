/**
 * The argument rule, at the two ends that matter: `bind` itself, and `rlm.spawn` — a delegating call
 * whose misspelled keyword used to be dropped (`rlm.spawn(promtp="…", name="kid")` spawned with an
 * empty prompt, and the child then reported nothing to explain why).
 *
 * The rule is code mode's, in its own copy of `bind` (the contract forbids an import between the two
 * packages): an unknown keyword, a surplus positional and one name given twice are refused as a
 * `ValueError`, which is `.name` monty maps onto the Python exception.
 */
import { describe, expect, it } from "bun:test";
import { delegationHostFns } from "../src/delegation";
import { bind } from "../src/host-util";

/** `bind` is synchronous, so a refusal is caught rather than awaited. */
function refusal(run: () => unknown): Error {
	try {
		run();
	} catch (error) {
		return error as Error;
	}
	throw new Error("expected a refusal");
}

describe("bind", () => {
	it("keeps the positional and keyword forms of one call, and refuses a name given twice", () => {
		expect(bind(["a", { name: "b" }], ["prompt", "name"], "rlm.spawn")).toEqual({ prompt: "a", name: "b" });
		const twice = refusal(() => bind(["a", { prompt: "b" }], ["prompt", "name"], "rlm.spawn"));
		expect(twice.name).toBe("ValueError");
		expect(twice.message).toContain('rlm.spawn: "prompt" was given twice');
	});

	it("refuses a keyword the call does not have, and a surplus positional", () => {
		const typo = refusal(() => bind([{ promtp: "x" }], ["prompt", "name"], "rlm.spawn"));
		expect(typo.name).toBe("ValueError");
		expect(typo.message).toContain('rlm.spawn has no parameter "promtp"');
		// The message names what it does take, so the next call can be written from the failure alone.
		expect(typo.message).toContain("prompt, name");
		const surplus = refusal(() => bind(["a", "b", "c"], ["prompt", "name"], "rlm.spawn"));
		expect(surplus.message).toContain("rlm.spawn takes at most 2 positional arguments");
	});
});

describe("rlm.spawn, whose keywords the child manager never sees when one is misspelled", () => {
	const spawns: { name?: string; prompt?: string }[] = [];
	const host = delegationHostFns({
		manager: {
			spawn: async (request: { name?: string; prompt?: string }) => {
				spawns.push(request);
				return {} as never;
			},
			poll: () => null,
			list: () => [],
			remove: () => null,
			send: () => null,
			treeCost: () => 0,
		},
		childContext: null,
		ownDepth: 0,
		sessionFile: () => undefined,
		currentCell: () => "cell-1",
		ownSurface: () => ["python"],
	});

	it("refuses the typo before the manager is reached, and spawns on the right spelling", async () => {
		await expect(host.rlm_spawn({ promtp: "do the thing", name: "kid" })).rejects.toThrow(
			/rlm\.spawn has no parameter "promtp"/,
		);
		expect(spawns).toEqual([]);
		await host.rlm_spawn({ prompt: "do the thing", name: "kid" });
		expect(spawns).toHaveLength(1);
		expect(spawns[0]?.name).toBe("kid");
	});
});
