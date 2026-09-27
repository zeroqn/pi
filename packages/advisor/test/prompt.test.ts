/** The reviewer's system prompt, and the one sentence the lane change rewrote (ticket 05). */
import { describe, expect, it } from "bun:test";

import { ADVISOR_SYSTEM_PROMPT } from "../src/prompt.ts";

describe("ADVISOR_SYSTEM_PROMPT", () => {
	it("loads the asset from the package root", () => {
		expect(ADVISOR_SYSTEM_PROMPT.length).toBeGreaterThan(200);
		expect(ADVISOR_SYSTEM_PROMPT).toContain("You are an advisor model");
	});

	it("promises a host surface, not pi's tool registry", () => {
		expect(ADVISOR_SYSTEM_PROMPT).toContain("host surface");
		expect(ADVISOR_SYSTEM_PROMPT).not.toContain("full tool inventory");
	});

	it("keeps the three answers and the never-calls-tools contract", () => {
		expect(ADVISOR_SYSTEM_PROMPT).toContain("a plan");
		expect(ADVISOR_SYSTEM_PROMPT).toContain("a correction");
		expect(ADVISOR_SYSTEM_PROMPT).toContain("a stop signal");
		expect(ADVISOR_SYSTEM_PROMPT).toContain("You NEVER call tools.");
	});
});
