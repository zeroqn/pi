/**
 * The base surface is not free text: acceptance check 2 compares an rlm session's `python`
 * tool against recorded hashes, so these constants are pinned here. A change to any of them
 * is a change to what the model sees, and it fails this test on purpose.
 *
 * `.scratch/code-mode/acceptance-baseline.md` holds the same numbers, the three fragments
 * the split removed from the pre-split description, what rlm contributes in their place, and
 * the amendments since: code mode's own guidelines for searching contents, for finding
 * paths, and for listing a directory, then the rename of `find`'s first parameter from `glob`
 * to `pattern` — the name the host function actually binds. Those are why the second
 * guideline test below pins a *whole-array* hash while the first pins the six as of the
 * monty-1.0 amendment, which corrected the description's capability and working-directory
 * clauses and guideline 5's "no generators, inheritance or decorators".
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("the base surface (acceptance check 2)", () => {
	it("keeps the pre-split description, minus the three rlm fragments, corrected for monty 1.0", () => {
		expect(sha(BASE_DESCRIPTION)).toBe("f4d054cb8ddc70767735221ee8a37631acffa1b61a7542861ddc0868e5d9a179");
		expect(BASE_DESCRIPTION).not.toContain("rlm.spawn");
		expect(BASE_DESCRIPTION).not.toContain("agent_message");
	});

	it("keeps the pre-split snippet, ending where rlm's connector begins", () => {
		expect(BASE_SNIPPET).toBe("Run Python in a persistent kernel with host-bridged shell, search, image reads");
	});

	it("keeps the first six guidelines, in order (as of the monty-1.0 amendment)", () => {
		expect(sha(BASE_GUIDELINES.slice(0, 6).join("\n"))).toBe("60b6fbfc45add00c0d1b9c0b8118203db74e1efc55c8e9ea6dd14ff4a3912085");
		expect(BASE_GUIDELINES[0]).toStartWith("Use python for work that is stateful");
	});

	// The three deliberate additions since the split: search, then find, then list. They are here
	// rather than in a contribution because they route what code mode owns, and they are pinned
	// because they are what the model reads -- a cell that never sees them reaches for bash.
	it("carries the three added guidelines, the only lines since the split", () => {
		expect(BASE_GUIDELINES.length).toBe(9);
		expect(sha(BASE_GUIDELINES.join("\n"))).toBe("a724eb3229dcac244a45ceed3534afa2b0b45d23c4708e13435f20de2a371218");
		expect(BASE_GUIDELINES[6]).toStartWith("In python, search file contents with");
		expect(BASE_GUIDELINES[7]).toStartWith("In python, find paths with");
		expect(BASE_GUIDELINES[8]).toStartWith("In python, list a directory with");
	});
});
