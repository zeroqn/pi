/**
 * The base surface is not free text: acceptance check 2 compares an rlm session's `python`
 * tool against recorded hashes, so these constants are pinned here. A change to any of them
 * is a change to what the model sees, and it fails this test on purpose.
 *
 * `.scratch/code-mode/acceptance-baseline.md` holds the same numbers, the three fragments
 * the split removed from the pre-split description, what rlm contributes in their place, and
 * the three amendments since: code mode's own guidelines for searching contents, for finding
 * paths, and for listing a directory. Those are why the second guideline test below pins a
 * *whole-array* hash while the first still pins the pre-split six.
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
		expect(sha(BASE_GUIDELINES.slice(0, 6).join("\n"))).toBe("121aeb851dc4c2420a17bb849ef3baa0d178c9c47aac0c5ac9d52ba29667d01a");
		expect(BASE_GUIDELINES[0]).toStartWith("Use python for work that is stateful");
	});

	// The three deliberate additions since the split: search, then find, then list. They are here
	// rather than in a contribution because they route what code mode owns, and they are pinned
	// because they are what the model reads -- a cell that never sees them reaches for bash.
	it("carries the three added guidelines, the only lines since the split", () => {
		expect(BASE_GUIDELINES.length).toBe(9);
		expect(sha(BASE_GUIDELINES.join("\n"))).toBe("08de9e0ebff33663b6d9ad5deebe9c29e13490a1904798aa558e0187b49b688e");
		expect(BASE_GUIDELINES[6]).toStartWith("In python, search file contents with");
		expect(BASE_GUIDELINES[7]).toStartWith("In python, find paths with");
		expect(BASE_GUIDELINES[8]).toStartWith("In python, list a directory with");
	});
});
