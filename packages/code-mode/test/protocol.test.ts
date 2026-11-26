/**
 * The preflight's protocol rule: a range test, not a name match.
 *
 * The kernel refuses a cell when `MONTY_BIN` names a worker that cannot serve this client's
 * protocol. It used to compare release *strings* (`reported.includes(client)`), which is wrong
 * in the direction the betas moved: monty's handshake is a range (1.6.0 serves 7-8,
 * 1.7.0-beta.1 serves 7-9), so a 1.6.0 client drives the beta's worker while the string test
 * called that a mismatch and refused every cell.
 *
 * Pure: the table's numbers and the containment rule, no worker, no pool.
 */
import { describe, expect, it } from "bun:test";
import { MONTY_PROTOCOLS, protocolProblem } from "../src/kernel";

describe("the worker protocol rule", () => {
	it("accepts every pair inside the worker's range", () => {
		// The pair the devShell runs today, and the one the string test refused.
		expect(protocolProblem("1.6.0", "monty-runtime 1.7.0")).toBeNull();
		expect(protocolProblem("1.6.0", "monty-runtime 1.7.0-beta.1")).toBeNull();
		expect(protocolProblem("1.6.0", "monty-runtime 1.6.0")).toBeNull();
		// A 1.7.0-beta.1 client against its own worker, and a 1.5.0 client against it: the
		// range is what matters in both directions, so 9-in-7..9 and 7-in-7..9 both hold.
		expect(protocolProblem("1.7.0-beta.1", "monty-runtime 1.7.0-beta.1")).toBeNull();
		expect(protocolProblem("1.5.0", "monty-runtime 1.7.0-beta.1")).toBeNull();
	});

	it("refuses a worker whose range excludes the client's protocol, and names both", () => {
		const tooOld = protocolProblem("1.6.0", "monty-runtime 1.4.0");
		expect(tooOld).toContain("speaks protocol 8");
		expect(tooOld).toContain("serves 5 to 6");
		expect(tooOld).toContain("MONTY_BIN");
		// The reverse direction: a client whose protocol is *above* the worker's ceiling. 1.7.0's
		// client speaks 9 and 1.5.0's worker stops at 7, so that pair is refused too.
		expect(protocolProblem("1.7.0-beta.1", "monty-runtime 1.5.0")).toContain("serves 7 to 7");
		expect(protocolProblem("1.5.0", "monty-runtime 0.9.0")).toBeNull(); // unlisted -> handshake speaks
	});

	it("defers to the handshake for anything it has not been told about", () => {
		expect(protocolProblem(null, "monty-runtime 1.6.0")).toBeNull();
		expect(protocolProblem("1.6.0", "monty-runtime 9.9.9")).toBeNull();
		expect(protocolProblem("1.6.0", "some-other-binary 1.6.0")).toBeNull();
		expect(protocolProblem("9.9.9", "monty-runtime 1.6.0")).toBeNull();
	});

	it("reads the release out of the worker's own line, prefix or none", () => {
		expect(protocolProblem("1.6.0", "  monty-runtime 1.6.0\n")).toBeNull();
		expect(protocolProblem("1.6.0", "1.6.0")).toBeNull();
	});

	it("carries the five releases the workspace has pinned, with the measured numbers", () => {
		// monty-proto at each tag: 1.4.0 -> 6/5, 1.5.0 -> 7/7, 1.6.0 -> 8/7, 1.7.0-beta.1 -> 9/7,
		// and 1.7.0 -> 9/7 (the release the flake now pins).
		expect(MONTY_PROTOCOLS["1.4.0"]).toEqual({ speaks: 6, serves: 5 });
		expect(MONTY_PROTOCOLS["1.5.0"]).toEqual({ speaks: 7, serves: 7 });
		expect(MONTY_PROTOCOLS["1.6.0"]).toEqual({ speaks: 8, serves: 7 });
		expect(MONTY_PROTOCOLS["1.7.0"]).toEqual({ speaks: 9, serves: 7 });
		expect(MONTY_PROTOCOLS["1.7.0-beta.1"]).toEqual({ speaks: 9, serves: 7 });
	});
});
