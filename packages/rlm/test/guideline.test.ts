/**
 * The guideline is a surface, and it has to be *callable*.
 *
 * Found by the live acceptance run (2026-10-09, `.scratch/rlm-stop/tools/live-run.sh`): a root session read
 * `rlm.list()` without `await`, got a coroutine, and three of its five cells failed before it worked out
 * that the prelude's `_Rlm` methods return a host function's promise. The model recovered — at the cost of
 * a re-run — but the *surface* is what misled it, so the rule lives here.
 *
 * The rule: every `rlm.<method>(` the guideline names must be preceded by `await`. Prose may describe what
 * a call returns; it may not show a call that cannot be made.
 */
import { describe, expect, it } from "bun:test";
import { RLM_GUIDELINES } from "../src/contribution";
import { PRELUDE_TAIL } from "../src/prelude-rlm";

// The guideline is one bullet per decision now; the checks below read the rendered list.
const RLM_GUIDELINE = RLM_GUIDELINES.join("\n");

describe("the guideline's calls (rlm-stop, live acceptance 2026-10-09)", () => {
	it("awaits every rlm method it names", () => {
		const mentions = RLM_GUIDELINE.match(/([\`(]|\s)(await\s+)?rlm\.\w+\(/g) ?? [];
		expect(mentions.length).toBeGreaterThan(0);
		for (const mention of mentions) {
			expect(mention).toMatch(/await\s+rlm\.\w+\($/);
		}
	});

	it("names the same methods the prelude defines, and no others", () => {
		const defined = new Set(PRELUDE_TAIL.match(/def \w+\(self/g)?.map((line) => line.split(" ")[1]!.slice(0, -5)) ?? []);
		expect(defined.size).toBeGreaterThan(0);
		for (const match of RLM_GUIDELINE.matchAll(/rlm\.(\w+)\(/g)) {
			expect(defined.has(match[1]!)).toBe(true);
		}
	});

	/**
	 * Amended 2026-11-22: a journal rebuild restores a handle as the dict the host returned (its
	 * status stale) and a cell killed after `rlm.spawn` returned leaves a child with no handle in
	 * the next kernel. The model was told neither, and had no reason to call `list`.
	 */
	it("says what a rebuild leaves, between the transcript rule and the staleness rule", () => {
		const transcript = RLM_GUIDELINE.indexOf("read an older child's answer from its stored transcript");
		const rebuilt = RLM_GUIDELINE.indexOf("After a kernel rebuild");
		const stale = RLM_GUIDELINE.indexOf("stops making progress is reported stale");
		expect(rebuilt).toBeGreaterThan(transcript);
		expect(rebuilt).toBeLessThan(stale);
		expect(RLM_GUIDELINE).toContain("a handle you kept is a snapshot of what the host returned then");
		expect(RLM_GUIDELINE).toContain("may have left a child whose handle never arrived");
		expect(RLM_GUIDELINE).toContain("list before concluding that a missing handle means a missing child");
	});

	it("keeps both sentences ticket 08 decided, in order, with nothing promised that is absent", () => {
		const stale = RLM_GUIDELINE.indexOf("stops making progress is reported stale");
		const stop = RLM_GUIDELINE.indexOf("ends an unwanted child and everything below it");
		expect(stale).toBeGreaterThan(-1);
		expect(stop).toBeGreaterThan(stale);
		// The fields the staleness sentence promises are the ones the handle carries (`stale`,
		// `idle_seconds`, `waiting_on`, `expectation_seconds`) — promised as *words*, since a sentence that
		// enumerated keys would read like a schema.
		expect(RLM_GUIDELINE).toContain("how long it has been quiet");
		expect(RLM_GUIDELINE).toContain("what it is waiting on");
		expect(RLM_GUIDELINE).toContain("unless it declared how long its work would take");
	});
});
