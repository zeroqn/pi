/**
 * The prelude is a frozen surface (`.scratch/skill-bridge/` tickets 01 #13 and 05).
 *
 * Two independent things depend on these four names and nothing else: a dump-restored kernel skips
 * re-feeding the prelude and still calls `skills_host` / `skill_host` by bare name, and a provider's
 * usage evidence can be a `skill_host` name match in code-mode's journal. So the text is pinned here
 * rather than only described — an edit that looked harmless would be a silent break in a restored
 * session.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { SKILL_PRELUDE } from "../src/prelude";

/** Captured at the move from `rsi/prelude-rsi.ts`; the only difference from RSI's text is the two docstrings. */
const GOLDEN = [
	"async def skills():",
	'    """The skills this session\'s providers supply: a list of {name, description, location, scope}."""',
	"    return await skills_host()",
	"",
	"async def skill(name):",
	'    """Load one skill\'s content by name — provider-supplied or one pi loaded. Call skills() for the provider\'s list."""',
	"    return await skill_host(name)",
	"",
].join("\n");

describe("the prelude", () => {
	it("is byte-for-byte the frozen text", () => {
		expect(SKILL_PRELUDE).toBe(GOLDEN);
		expect(createHash("sha256").update(SKILL_PRELUDE, "utf8").digest("hex")).toBe(
			"bc344fc81e8c9abd687f15476b6bc451d7aa6e84aed2c936ac38cef425a87ec4",
		);
	});

	it("defines the two frozen Python names, calling the two frozen host functions", () => {
		expect(SKILL_PRELUDE).toContain("async def skills():");
		expect(SKILL_PRELUDE).toContain("async def skill(name):");
		expect(SKILL_PRELUDE).toContain("await skills_host()");
		expect(SKILL_PRELUDE).toContain("await skill_host(name)");
	});

	it("carries no other definition", () => {
		// The tail is a concatenation, and the other half is rlm's: a second `def` here would be a
		// name in someone else's namespace.
		expect(SKILL_PRELUDE.match(/^async def /gm)?.length).toBe(2);
		expect(SKILL_PRELUDE.match(/^def /gm)).toBeNull();
	});
});
