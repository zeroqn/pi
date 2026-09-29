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
 * clauses and guideline 5's "no generators, inheritance or decorators", and the
 * background-handle amendment of 2026-09-29 — `h.poll()`, `h.output()` and `h.kill()` are host
 * calls and return coroutines, so the description that showed them unawaited taught a model to
 * print `<coroutine external_future(N)>` where a status belongs (measured live, `.scratch/mc-0441`
 * check 14; the package's own `test/prelude.test.ts` always awaited them). Then the data-plane amendment of 2026-09-29 — the description and the fifth guideline said reading many
 * files was *slow* through the kernel and to prefer `await bash("...")`, which was measured on monty 0.0.23
 * (48 ms/file) and is false on 1.0.0 (2.03 ms/file in-process, 2.08 ms/file live) — see
 * `.scratch/code-mode/datapath-1.0.md`. Then the os-subset amendment of 2026-09-29: the description
 * advertises `os` and `pathlib` as present modules with no intra-module caveat, so a cell's first
 * move on a tree is `os.path.isdir`/`os.walk` — both absent from monty's curated `os` (measured
 * live) — and guideline 9 now names them and the replacements. That is a post-split line, so only
 * the whole-array hash moved.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("the base surface (acceptance check 2)", () => {
	it("keeps the pre-split description, minus the three rlm fragments, corrected for monty 1.0", () => {
		expect(sha(BASE_DESCRIPTION)).toBe("c1c17e4b434e82c101250b8e45fa868cea91884b82f645215df68f7ca0a4c860");
		expect(BASE_DESCRIPTION).not.toContain("rlm.spawn");
		expect(BASE_DESCRIPTION).not.toContain("agent_message");
	});

	it("keeps the pre-split snippet, ending where rlm's connector begins", () => {
		expect(BASE_SNIPPET).toBe("Run Python in a persistent kernel with host-bridged shell, search, image reads");
	});

	it("keeps the first six guidelines, in order (as of the monty-1.0 amendment)", () => {
		expect(sha(BASE_GUIDELINES.slice(0, 6).join("\n"))).toBe("1a28fd779b188959175357a459bb8ef778d574b14f0e8e8e4763283bfded61f3");
		expect(BASE_GUIDELINES[0]).toStartWith("Use python for work that is stateful");
	});

	// The three deliberate additions since the split: search, then find, then list. They are here
	// rather than in a contribution because they route what code mode owns, and they are pinned
	// because they are what the model reads -- a cell that never sees them reaches for bash.
	it("carries the three added guidelines, the only lines since the split", () => {
		expect(BASE_GUIDELINES.length).toBe(9);
		expect(sha(BASE_GUIDELINES.join("\n"))).toBe("0db2a51a4da9e705a10ef03d47449fd2098123e7dd78b02690b437552b8d3917");
		expect(BASE_GUIDELINES[6]).toStartWith("In python, search file contents with");
		expect(BASE_GUIDELINES[7]).toStartWith("In python, find paths with");
		expect(BASE_GUIDELINES[8]).toStartWith("In python, list a directory with");
	});
});
