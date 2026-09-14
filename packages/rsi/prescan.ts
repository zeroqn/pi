/**
 * The model-free pre-scan that decides whether a session is worth a learner
 * pass. It screens sessions so no tokens are spent deciding; the content-level
 * refusal list is phase 4's.
 *
 * Four signals, from ticket 05: a user correction or preference, an error
 * followed by a successful retry, a repeated command or workflow, and sheer
 * size (dirge's "5+ tool calls"). The one signal it cannot see cheaply — "a
 * consulted skill turned out wrong" — is the accepted blind spot; `/rsi learn`
 * recovers it.
 */

export interface ScanToolCall {
	name: string;
	input: Record<string, unknown>;
}

export interface ScanToolResult {
	toolName: string;
	isError: boolean;
	/** Result text, kept for the digest's error excerpts. */
	text?: string;
}

/** A session message reduced to what the scan needs, so it is testable alone. */
export interface ScanMessage {
	role: string;
	text?: string;
	toolCalls?: ScanToolCall[];
	toolResult?: ScanToolResult;
}

export interface ScanSignal {
	learnable: boolean;
	reasons: string[];
}

/** Candidate signals, checked case-insensitively against user text. */
const CORRECTION_MARKERS =
	/\b(?:remember (?:this|that)|from now on|next time|don'?t do|do not do|stop doing|instead of|i said|not what i|that'?s wrong|still (?:not|broken|failing)|didn'?t work|does not work|doesn'?t work|you should have|why did you|i want you to|make sure|please don'?t)\b/i;

/** dirge's in-session complexity trigger. */
const SIZE_TOOL_CALLS = 5;

export function scanMessages(messages: readonly ScanMessage[]): ScanSignal {
	const reasons: string[] = [];

	if (messages.some((message) => message.role === "user" && typeof message.text === "string" && CORRECTION_MARKERS.test(message.text))) {
		reasons.push("a user correction or preference");
	}
	if (hasErrorThenSuccess(messages)) reasons.push("an error followed by a successful retry");
	if (hasRepeatedShape(messages)) reasons.push("a repeated command or workflow");

	const calls = countToolCalls(messages);
	if (calls >= SIZE_TOOL_CALLS) reasons.push(`${calls} tool calls`);

	return { learnable: reasons.length > 0, reasons };
}

/** Reduce raw session entries into scan messages, ignoring non-message entries. */
export function toScanMessages(entries: readonly unknown[]): ScanMessage[] {
	const messages: ScanMessage[] = [];
	for (const entry of entries) {
		if (!isRecord(entry) || entry.type !== "message") continue;
		const message = entry.message;
		if (!isRecord(message)) continue;
		const role = typeof message.role === "string" ? message.role : "";

		if (role === "user") {
			const text = textOf(message.content);
			if (text.length > 0) messages.push({ role, text });
			continue;
		}
		if (role === "assistant") {
			const text = textOf(message.content);
			const toolCalls = toolCallsOf(message.content);
			if (text.length > 0 || toolCalls.length > 0) messages.push({ role, text, toolCalls });
			continue;
		}
		if (role === "toolResult") {
			messages.push({
				role,
				toolResult: {
					toolName: typeof message.toolName === "string" ? message.toolName : "",
					isError: message.isError === true,
					text: textOf(message.content),
				},
			});
		}
	}
	return messages;
}

function hasErrorThenSuccess(messages: readonly ScanMessage[]): boolean {
	const errored = new Set<string>();
	for (const message of messages) {
		const result = message.toolResult;
		if (!result) continue;
		if (result.isError) {
			errored.add(result.toolName);
		} else if (errored.has(result.toolName)) {
			return true;
		}
	}
	return false;
}

function hasRepeatedShape(messages: readonly ScanMessage[]): boolean {
	const counts = new Map<string, number>();
	for (const message of messages) {
		for (const call of message.toolCalls ?? []) {
			const shape = callShape(call);
			const next = (counts.get(shape) ?? 0) + 1;
			if (next >= 2) return true;
			counts.set(shape, next);
		}
	}
	return false;
}

function countToolCalls(messages: readonly ScanMessage[]): number {
	let total = 0;
	for (const message of messages) total += message.toolCalls?.length ?? 0;
	return total;
}

/** Two bash calls with the same leading words, or two calls to the same target. */
function callShape(call: ScanToolCall): string {
	if (call.name === "bash" && typeof call.input.command === "string") {
		return `bash:${call.input.command.trim().split(/\s+/).slice(0, 2).join(" ")}`;
	}
	const target = call.input.path ?? call.input.pattern ?? call.input.query;
	return typeof target === "string" ? `${call.name}:${target}` : call.name;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } => isRecord(block) && block.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

function toolCallsOf(content: unknown): ScanToolCall[] {
	if (!Array.isArray(content)) return [];
	return content
		.filter((block): block is { name: unknown; arguments: unknown } => isRecord(block) && block.type === "toolCall")
		.map((block) => ({
			name: typeof block.name === "string" ? block.name : "",
			input: isRecord(block.arguments) ? block.arguments : {},
		}));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
