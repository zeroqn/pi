/**
 * The base surface is not free text: acceptance check 2 compares an rlm session's `python`
 * tool against recorded hashes, so these constants are pinned here. A change to any of them
 * is a change to what the model sees, and it fails this test on purpose.
 *
 * `.scratch/code-mode/acceptance-baseline.md` holds the same numbers, the three fragments
 * the split removed from the pre-split description, and what rlm contributes in their place.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("the base surface (acceptance check 2)", () => {
	it("keeps the pre-split description, minus the three enumerated rlm fragments", () => {
		expect(sha(BASE_DESCRIPTION)).toBe("d7976fc147d51fda3979f4d22bdea0eccab1ea7f2b1e26b90eba857ecae3d28d");
		expect(BASE_DESCRIPTION).not.toContain("rlm.spawn");
		expect(BASE_DESCRIPTION).not.toContain("agent_message");
	});

	it("keeps the pre-split snippet, ending where rlm's connector begins", () => {
		expect(BASE_SNIPPET).toBe("Run Python in a persistent kernel with host-bridged shell, search, image reads");
	});

	it("keeps the first six pre-split guidelines, in order", () => {
		expect(BASE_GUIDELINES.length).toBe(6);
		expect(sha(JSON.stringify(BASE_GUIDELINES))).toBe("abd00a3be369b09ccf2ca5b9ec4929b30c17c1f8cb0cf08ffcda7f3fd392a4f4");
		expect(BASE_GUIDELINES[0]).toStartWith("Use python for work that is stateful");
	});
});
