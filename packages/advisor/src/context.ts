/**
 * context — the branch massaging the reviewer's payload gets before it is sent.
 *
 * Two rules, and both are load-bearing rather than tidy-ups:
 *
 *  1. **Strip the in-flight tool calls.** The message that invoked the cell is in the branch with no
 *     toolResult yet, and providers reject a payload carrying an orphan `toolCall`. Upstream stripped by
 *     name — its own `advisor` call. Here the in-flight call is `python` (ticket 04 measured it), and the
 *     strip is **by shape**: any toolCall in the tail assistant message with no matching toolResult
 *     anywhere after it, whatever it is named. Plural on purpose: a turn may invoke the cell more than
 *     once, and ticket 04 measured *both* of those calls unfulfilled while either cell runs, because pi
 *     appends the toolResults only after the turn's calls finish.
 *  2. **Guarantee a user tail.** After the strip the tail is still `assistant` — the same assistant
 *     message carries its `thinking` and `text` parts, so it does not empty out — and recent Anthropic
 *     models reject an assistant-prefill payload outright. The nudge is what makes the request legal.
 *
 * Ticket 04 also measured the *shape* of a resolved result — a message `{role: "toolResult", toolCallId}`
 * whose content is text, not a `toolResult` part. That fact is not read by the rule below (see the note
 * there): it describes what a reader of the branch will see, not something the strip has to test for.
 */
import type { Message } from "@earendil-works/pi-ai";

import { MSG_ADVISOR_NUDGE } from "./messages.ts";

/** A content part, reduced to what the rule reads: its type and, for a toolCall, its id. */
type Part = { type?: string; id?: unknown };
type MaybeAssistant = { role?: string; content?: unknown };

function partsOf(message: unknown): Part[] {
	const content = (message as { content?: unknown })?.content;
	return Array.isArray(content) ? (content as Part[]) : [];
}

/**
 * Drop the tail assistant message's toolCalls — all of them.
 *
 * **Why there is no "has a result" test.** The tail is by construction the last message, so nothing
 * follows it, and a toolCall whose result existed would mean the result is the last message instead. Every
 * toolCall in the tail assistant message is therefore in flight, and the rule needs no set arithmetic. (For
 * a reader comparing this with ticket 04's probe output: a *resolved* result appears earlier in the branch
 * as its own `{role: "toolResult", toolCallId}` message, which is why the earlier turn's calls are
 * untouched — they are not in the tail.)
 *
 * Returns the input array unchanged when there is nothing to strip, so a caller can tell "already legal"
 * from "stripped" by identity. A message that stripping leaves empty is dropped entirely: an assistant turn
 * with no content is not a turn, and an empty content array is rejected by every provider.
 */
export function stripInflightToolCalls(messages: Message[]): Message[] {
	if (messages.length === 0) return messages;
	const lastIndex = messages.length - 1;
	const last = messages[lastIndex] as MaybeAssistant;
	if (last?.role !== "assistant") return messages;

	const content = partsOf(last);
	if (!content.some((part) => part.type === "toolCall")) return messages;

	const filtered = content.filter((part) => part.type !== "toolCall");
	if (filtered.length === 0) return messages.slice(0, -1);
	return [...messages.slice(0, -1), { ...(last as Message), content: filtered } as Message];
}

/** Append the minimal user-role turn when the payload would otherwise end on an assistant message. */
export function ensureUserTailForAdvisor(messages: Message[]): Message[] {
	if (messages.length === 0) return messages;
	const last = messages[messages.length - 1] as MaybeAssistant;
	if (last?.role !== "assistant") return messages;
	const nudge = {
		role: "user",
		content: [{ type: "text", text: MSG_ADVISOR_NUDGE }],
		timestamp: Date.now(),
	} as Message;
	return [...messages, nudge];
}
