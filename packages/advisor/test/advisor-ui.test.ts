/**
 * What the `/advisor` picker declares to the terminal.
 *
 * pi 1.5.0 added `ctx.ui.custom()`'s `blocked` option (OSC 7501 program status), and the picker uses it so
 * a parked run reads as "blocked on a question" rather than as a stall. The message may only be the session
 * name, a dialog title or an error's first line, so this pins the two titles — and pins that the option
 * reaches `custom()` at all, which is the half a fake context can check without drawing anything.
 */
import { describe, expect, it } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { showAdvisorPicker, showEffortPicker } from "../src/advisor-ui.ts";

/** A ctx whose `custom()` records its options and never builds the panel: the subject is the declaration. */
function recordingCtx(): { ctx: ExtensionContext; options: () => unknown; calls: () => number } {
	let seen: unknown;
	let calls = 0;
	const ctx = {
		ui: {
			custom: (_factory: unknown, options?: unknown) => {
				calls += 1;
				seen = options;
				return Promise.resolve(null);
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, options: () => seen, calls: () => calls };
}

describe("the advisor picker's terminal status", () => {
	it("declares a question, named by the model panel's title", async () => {
		const h = recordingCtx();
		expect(await showAdvisorPicker(h.ctx, [{ value: "x", label: "x" }])).toBeNull();
		expect(h.calls()).toBe(1);
		expect(h.options()).toEqual({ blocked: { kind: "question", message: "Advisor Tool" } });
	});

	it("declares a question, named by the effort panel's title", async () => {
		const h = recordingCtx();
		expect(await showEffortPicker(h.ctx, [{ value: "high", label: "high" }], undefined, "high")).toBeNull();
		expect(h.calls()).toBe(1);
		expect(h.options()).toEqual({ blocked: { kind: "question", message: "Reasoning Level" } });
	});
});
