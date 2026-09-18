import assert from "node:assert/strict";
import { test } from "node:test";
import { scanMessages, toScanMessages } from "../prescan.ts";

const assistant = (toolCalls) => ({ role: "assistant", toolCalls });
const result = (toolName, isError) => ({ role: "toolResult", toolResult: { toolName, isError } });

// ---------------------------------------------------------------------------
// The four cheap signals, from ticket 05. Any one admits the session; none
// means no pass and no tokens spent.
// ---------------------------------------------------------------------------

test("a user correction or preference trips the gate", () => {
	for (const text of [
		"no, that's wrong — use the other API",
		"from now on always run the tests first",
		"remember this: the deploy script needs NODE_ENV",
		"that didn't work",
		"please don't reformat unrelated files",
	]) {
		const signal = scanMessages([{ role: "user", text }]);
		assert.equal(signal.learnable, true, text);
	}
});

test("an error followed by a successful retry trips the gate", () => {
	const signal = scanMessages([assistant([{ name: "edit", input: {} }]), result("edit", true), result("edit", false)]);
	assert.equal(signal.learnable, true);
	assert.ok(signal.reasons.some((reason) => /retry/.test(reason)));
});

test("a success without a preceding error of the same tool does not", () => {
	assert.equal(scanMessages([result("edit", false), result("read", false)]).learnable, false);
});

test("a repeated command or workflow shape trips the gate", () => {
	const repeated = scanMessages([
		assistant([{ name: "bash", input: { command: "npm test -- --watch" } }]),
		assistant([{ name: "bash", input: { command: "npm test -- --silent" } }]),
	]);
	assert.equal(repeated.learnable, true);
	assert.ok(repeated.reasons.some((reason) => /repeated/.test(reason)));

	const sameTarget = scanMessages([
		assistant([{ name: "read", input: { path: "/a/b.ts" } }]),
		assistant([{ name: "read", input: { path: "/a/b.ts" } }]),
	]);
	assert.equal(sameTarget.learnable, true);
});

test("size alone trips the gate at five tool calls", () => {
	const calls = Array.from({ length: 5 }, (_, i) => assistant([{ name: "read", input: { path: `/f${i}.ts` } }]));
	const signal = scanMessages(calls);
	assert.equal(signal.learnable, true);
	assert.ok(signal.reasons.some((reason) => /5 tool calls/.test(reason)));
});

test("a quiet session with no signals is not learnable", () => {
	const signal = scanMessages([
		{ role: "user", text: "what does this function do?" },
		assistant([{ name: "read", input: { path: "/src/a.ts" } }]),
		result("read", false),
	]);
	assert.equal(signal.learnable, false);
	assert.deepEqual(signal.reasons, []);
});

// ---------------------------------------------------------------------------
// toScanMessages — reduce raw session entries; non-message entries are ignored.
// ---------------------------------------------------------------------------

test("toScanMessages reads user text, assistant tool calls and tool results", () => {
	const entries = [
		{ type: "model_change", id: "x" },
		{ type: "message", id: "1", message: { role: "user", content: "hello there" } },
		{
			type: "message",
			id: "2",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "working" }, { type: "toolCall", name: "bash", arguments: { command: "ls -la" } }],
			},
		},
		{ type: "message", id: "3", message: { role: "toolResult", toolName: "bash", isError: false, content: [] } },
	];

	const messages = toScanMessages(entries);
	assert.equal(messages.length, 3);
	assert.equal(messages[0].text, "hello there");
	assert.equal(messages[1].toolCalls[0].name, "bash");
	assert.equal(messages[1].toolCalls[0].input.command, "ls -la");
	assert.equal(messages[2].toolResult.toolName, "bash");
	assert.equal(messages[2].toolResult.isError, false);
});

test("toScanMessages ignores malformed and empty entries", () => {
	assert.deepEqual(toScanMessages([null, "x", { type: "message" }, { type: "message", message: { role: "assistant", content: [] } }]), []);
});

// ---------------------------------------------------------------------------
// The code-mode signal (RSI x RLM ticket 04): `["python"]` alone never reaches the
// pi-tool size threshold, so the kernel journal supplies equivalent evidence.
// ---------------------------------------------------------------------------

test("kernel host calls reach the size threshold where pi tool calls cannot", () => {
	const messages = [{ role: "user", text: "do the thing" }];
	assert.equal(scanMessages(messages).learnable, false, "no signal without a kernel");
	assert.equal(scanMessages(messages, { cells: 1, hostCalls: 3, errorThenSuccess: false }).learnable, false, "three calls is under the bar");
	const five = scanMessages(messages, { cells: 1, hostCalls: 5, errorThenSuccess: false });
	assert.equal(five.learnable, true);
	assert.deepEqual(five.reasons, ["5 kernel host calls"]);
});

test("a child with no host calls is admitted to nothing", () => {
	// Ticket 13: a cell that made no host call did nothing observable, so it is not evidence.
	const messages = [{ role: "user", text: "delegate something" }];
	assert.equal(scanMessages(messages, { cells: 3, hostCalls: 0, errorThenSuccess: false }).learnable, false);
});

test("a kernel error followed by a success is a signal on its own", () => {
	const signal = scanMessages([{ role: "user", text: "try it" }], { cells: 2, hostCalls: 2, errorThenSuccess: true });
	assert.equal(signal.learnable, true);
	assert.deepEqual(signal.reasons, ["a kernel error followed by a successful call"]);
});

test("the kernel signal adds to the pi-tool signals rather than replacing them", () => {
	const signal = scanMessages([{ role: "user", text: "remember this" }], { cells: 1, hostCalls: 9, errorThenSuccess: false });
	assert.equal(signal.learnable, true);
	assert.deepEqual(signal.reasons, ["a user correction or preference", "9 kernel host calls"]);
});
