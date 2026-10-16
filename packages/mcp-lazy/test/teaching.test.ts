/**
 * The teaching contribution (ticket 03, built by ticket 13): the guideline that lands in `<rules>`, and
 * the conditional that keeps a session with no configured server paying zero.
 */
import { beforeEach, describe, expect, it } from "bun:test";

import { ROUTE_GUIDELINE } from "../src/section";
import { __resetMcpLazyForTests } from "../src/state";
import { sessionAnswer } from "../src/teaching";

function ctx(): unknown {
	return { sessionManager: { getSessionFile: () => undefined }, cwd: "/tmp", isProjectTrusted: () => false };
}

beforeEach(() => {
	__resetMcpLazyForTests();
});

describe("the guideline", () => {
	it("is offered, verbatim, when the session has a configured server", () => {
		const answer = sessionAnswer({ ctx: ctx() }, {
			agentDir: "/tmp/agent",
			readConfig: () => ({ servers: [{ name: "docs-api", config: { command: "npx" } }], errors: [] }),
		});
		expect(answer?.contribution.guidelines).toEqual([ROUTE_GUIDELINE]);
	});

	it("is not offered when the session has no configured server", () => {
		const answer = sessionAnswer({ ctx: ctx() }, {
			agentDir: "/tmp/agent",
			readConfig: () => ({ servers: [], errors: [] }),
		});
		expect(answer).toBeNull();
	});
});
