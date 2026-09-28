/**
 * The shell host commands run in. There is no override variable to test — the point of the module is
 * that a host with no shell is a *preflight problem*, so the two cases pinned here are "this host has
 * one" and "this one does not".
 */
import { describe, expect, it } from "bun:test";
import { SHELL, shellProblem } from "../src/shell";

describe("the shell host commands run in", () => {
	it("resolves to a shell this host has, and reports no problem for it", () => {
		expect(SHELL.length).toBeGreaterThan(0);
		expect(shellProblem()).toBeNull();
	});

	it("names the missing shell, for the preflight to report before the first cell", () => {
		const problem = shellProblem("/nonexistent/bash");
		expect(problem).toContain("no shell to run host commands in");
		expect(problem).toContain("/nonexistent/bash");
	});
});
