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
		expect(sha(BASE_GUIDELINES.join("\n"))).toBe("121aeb851dc4c2420a17bb849ef3baa0d178c9c47aac0c5ac9d52ba29667d01a");
		expect(BASE_GUIDELINES[0]).toStartWith("Use python for work that is stateful");
	});
});
