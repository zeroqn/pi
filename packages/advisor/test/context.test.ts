/**
 * The branch massaging, re-derived for this lane by ticket 04's live measurement:
 *
 *   mid-cell the branch ends on the assistant message carrying the in-flight `python` toolCall(s);
 *   a resolved result is a `role: "toolResult"` message with a message-level `toolCallId`;
 *   the assistant message keeps its `thinking`/`text` parts, so the strip does not empty it.
 */
import type { Message } from "@earendil-works/pi-ai";

import { describe, expect, it } from "bun:test";

import { ensureUserTailForAdvisor, stripInflightToolCalls } from "../src/context.ts";

function user(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 0 } as Message;
}

function assistant(parts: unknown[]): Message {
	return { role: "assistant", content: parts, timestamp: 0 } as unknown as Message;
}

function toolCall(id: string, name = "python"): unknown {
	return { type: "toolCall", id, name, arguments: {} };
}

function toolResult(id: string): Message {
	return { role: "toolResult", toolCallId: id, toolName: "python", content: [{ type: "text", text: "out" }] } as unknown as Message;
}

describe("stripInflightToolCalls", () => {
	it("returns the array unchanged when there is nothing to strip", () => {
		const messages = [user("hi")];
		expect(stripInflightToolCalls(messages)).toBe(messages);
	});

	it("returns the array unchanged when the tail is not an assistant message", () => {
		const messages = [user("q"), toolResult("c1")];
		expect(stripInflightToolCalls(messages)).toBe(messages);
	});

	it("returns the array unchanged when the tail's calls all have results", () => {
		const messages = [assistant([toolCall("c1")]), toolResult("c1")];
		expect(stripInflightToolCalls(messages)).toBe(messages);
	});

	it("strips the in-flight call whatever it is named — the name is this lane's, not the advisor's", () => {
		const messages = [user("q"), assistant([{ type: "text", text: "thinking out loud" }, toolCall("c1", "python")])];
		const stripped = stripInflightToolCalls(messages);
		expect(stripped).not.toBe(messages);
		expect((stripped[1] as { content: unknown[] }).content).toEqual([{ type: "text", text: "thinking out loud" }]);
	});

	it("strips every unfulfilled call, because a turn may invoke the cell more than once", () => {
		const messages = [assistant([{ type: "thinking", thinking: "…" }, toolCall("c1"), toolCall("c2")])];
		const stripped = stripInflightToolCalls(messages);
		expect((stripped[0] as { content: unknown[] }).content).toEqual([{ type: "thinking", thinking: "…" }]);
	});

	it("drops a message that stripping leaves empty", () => {
		const messages = [user("q"), assistant([toolCall("c1")])];
		expect(stripInflightToolCalls(messages)).toEqual([user("q")]);
	});

	it("does not touch an earlier turn's calls — only the tail is in flight", () => {
		const messages = [assistant([toolCall("old")]), toolResult("old"), user("next"), assistant([toolCall("live")])];
		const stripped = stripInflightToolCalls(messages);
		expect((stripped[0] as { content: { id?: string }[] }).content.map((c) => c.id)).toEqual(["old"]);
		// The tail carried nothing but its in-flight call, so the message itself is gone.
		expect(stripped).toHaveLength(3);
	});
});

describe("ensureUserTailForAdvisor", () => {
	it("appends one user turn when the tail is an assistant message", () => {
		const messages = [assistant([{ type: "text", text: "plan?" }])];
		const tailed = ensureUserTailForAdvisor(messages);
		expect(tailed).toHaveLength(2);
		expect((tailed[1] as { role: string }).role).toBe("user");
		expect(JSON.stringify(tailed[1])).toContain("inside a Python cell");
	});

	it("leaves a user tail alone, by identity", () => {
		const messages = [user("q")];
		expect(ensureUserTailForAdvisor(messages)).toBe(messages);
	});

	it("leaves an empty list alone", () => {
		const messages: Message[] = [];
		expect(ensureUserTailForAdvisor(messages)).toBe(messages);
	});
});
