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

/**
 * The degraded path (`ctx.mode` declared and not "tui"): one `select` over the same rows, no component.
 *
 * pi's RPC mode ignores `custom`, so a picker built on it renders nothing there — silently, which is why
 * the branch exists and why it is pinned. What it may not do: fabricate a selection out of an answer it
 * did not offer, and keep the rich path on a host that declares no mode at all.
 */
function dialogCtx(mode: string | undefined, answer?: string | null) {
	const seen: { title: string; options: string[] }[] = [];
	const ctx = {
		mode,
		ui: {
			custom: () => {
				throw new Error("custom must not be used on a non-terminal host");
			},
			select: (title: string, options: string[]) => {
				seen.push({ title, options });
				return Promise.resolve(answer === undefined ? options[options.length - 1] : answer);
			},
		},
	} as unknown as ExtensionContext;
	return { ctx, seen };
}

describe("the advisor picker on a host without components", () => {
	it("asks one select with the same rows when the mode is rpc", async () => {
		const h = dialogCtx("rpc");
		const items = [
			{ value: "anthropic/opus", label: "Opus  (anthropic)" },
			{ value: "openai/gpt", label: "GPT  (openai)" },
		];
		expect(await showAdvisorPicker(h.ctx, items)).toBe("openai/gpt");
		expect(h.seen).toHaveLength(1);
		expect(h.seen[0]!.options).toEqual(["Opus  (anthropic)", "GPT  (openai)"]);
		expect(h.seen[0]!.title).toContain("type-to-filter is not available");
		expect(h.seen[0]!.title).toContain("Advisor Tool");
	});

	it("treats an answer it did not offer as a dismissal", async () => {
		const h = dialogCtx("rpc", "something typed");
		expect(await showAdvisorPicker(h.ctx, [{ value: "x", label: "x" }])).toBeNull();
	});

	it("keeps the component path when the host declares no mode", async () => {
		const h = recordingCtx();
		await showAdvisorPicker(h.ctx, [{ value: "x", label: "x" }]);
		expect(h.calls()).toBe(1);
	});

	it("degrades the effort picker the same way", async () => {
		const h = dialogCtx("rpc");
		expect(await showEffortPicker(h.ctx, [{ value: "high", label: "high" }], undefined, "high")).toBe("high");
		expect(h.seen[0]!.title).toContain("Reasoning Level");
	});
});
