import { beforeEach, describe, expect, it } from "bun:test";

import { REMOTE_CLOSE_MARKER, REMOTE_OPEN_MARKER } from "../guard";
import { __resetGrantRecordsForTests, ensureGrantRecord } from "../grants";
import { __resetPendingFencesForTests, fenceToolResult, judgeToolCall, shellCommandOf } from "../tool-seam";

/**
 * The tool seam (`.scratch/guardrail-blindspots` ticket 03): the same policy applied to pi's own shell tool.
 *
 * These tests drive the two event handlers directly with pi's event shapes, which is the seam's whole
 * surface: `tool_call` refuses (`{block, reason}`) and, for a granted call, remembers the fence;
 * `tool_result` applies it to the result's text block.
 */

let counter = 0;
function newCtx(granted: string[] = []): { ctx: unknown; key: string } {
	counter += 1;
	const key = `blindspots-tool-${counter}`;
	const state = ensureGrantRecord(key);
	for (const target of granted) state.grants.set(target, { route: "command", at: Date.now() });
	return { ctx: { sessionManager: { getSessionFile: () => key }, isChild: false }, key };
}

const call = (command: string, toolCallId = "call-1") => ({ toolName: "bash", toolCallId, input: { command } });

const result = (text: string, toolCallId = "call-1") => ({
	toolName: "bash",
	toolCallId,
	input: { command: "ssh dev@build-box uptime" },
	content: [{ type: "text", text }],
	structuredContent: { output: text, exit_code: 0 },
	details: { truncation: undefined, fullOutputPath: "/tmp/spill.txt" },
});

beforeEach(() => {
	__resetGrantRecordsForTests();
	__resetPendingFencesForTests();
});

describe("what the seam is allowed to look at (ticket 02 §4, ticket 01's trap 2)", () => {
	it("reads a shell call's command, and only a shell call's", () => {
		expect(shellCommandOf(call("ssh host uptime"))).toBe("ssh host uptime");
		expect(shellCommandOf({ toolName: "powershell", input: { command: "ssh host uptime" } })).toBe("ssh host uptime");
		expect(shellCommandOf({ toolName: "bash", input: {} })).toBeUndefined();
		expect(shellCommandOf({ toolName: "read", input: { path: "/tmp/x" } })).toBeUndefined();
	});

	it("never judges a python call, whose source carries the same command", async () => {
		const { ctx } = newCtx();
		const python = { toolName: "python", toolCallId: "c9", input: { code: 'await bash("ssh dev@build-box uptime")' } };
		expect(shellCommandOf(python)).toBeUndefined();
		expect(await judgeToolCall(python, ctx)).toBeUndefined();
		// ... and no fence was recorded for it, so its result is left alone.
		expect(fenceToolResult({ ...result("Ran it."), toolName: "python", toolCallId: "c9" }, ctx)).toBeUndefined();
	});
});

describe("the refusal half (ticket 03 §3)", () => {
	it("blocks an ungranted transport call with the refusal the model reads", async () => {
		const { ctx } = newCtx();
		const verdict = await judgeToolCall(call("ssh dev@build-box uptime"), ctx);
		expect(verdict?.block).toBe(true);
		expect(verdict?.reason).toContain("dev@build-box");
		expect(verdict?.reason).toContain("holds no grant at all");
	});

	it("blocks a granted call that detaches itself, and a curl, each with its own sentence", async () => {
		const { ctx } = newCtx(["dev@build-box"]);
		expect((await judgeToolCall(call("ssh dev@build-box uptime &"), ctx))?.reason).toContain("detaches itself");
		expect((await judgeToolCall(call("curl -s https://example.com"), ctx))?.reason).toContain("fetch_content(url)");
	});

	it("lets an ordinary command past without a verdict", async () => {
		const { ctx } = newCtx();
		expect(await judgeToolCall(call("ls -la /tmp"), ctx)).toBeUndefined();
		expect(await judgeToolCall(call("git status"), ctx)).toBeUndefined();
	});
});

describe("the fence half (ticket 03 §1, §2)", () => {
	it("wraps a granted call's text block, and returns `content` alone", async () => {
		const { ctx } = newCtx(["dev@build-box"]);
		expect(await judgeToolCall(call("ssh dev@build-box uptime"), ctx)).toBeUndefined();
		const patch = fenceToolResult(result("up 3 days"), ctx);
		expect(patch).toBeDefined();
		expect(Object.keys(patch ?? {})).toEqual(["content"]);
		const text = (patch?.content[0] as { text: string }).text;
		expect(text.startsWith(REMOTE_OPEN_MARKER)).toBe(true);
		expect(text.endsWith(REMOTE_CLOSE_MARKER)).toBe(true);
		expect(text).toContain("up 3 days");
		// The structured copy is *not* returned: its `output` is the fuller, unfenced twin (ticket 03 §1).
		expect((patch as { structuredContent?: unknown }).structuredContent).toBeUndefined();
	});

	it("wraps a failed granted command too, because the fence is what says it ran", async () => {
		const { ctx } = newCtx(["dev@build-box"]);
		await judgeToolCall(call("ssh dev@build-box uptime"), ctx);
		const patch = fenceToolResult(result("command not found\nCommand exited with code 127"), ctx);
		expect((patch?.content[0] as { text: string }).text).toContain("Command exited with code 127");
	});

	it("wraps once, and consumes the record so a second result is untouched", async () => {
		const { ctx } = newCtx(["dev@build-box"]);
		await judgeToolCall(call("ssh dev@build-box uptime"), ctx);
		const first = fenceToolResult(result("up 3 days"), ctx);
		expect(first).toBeDefined();
		expect(fenceToolResult(result("up 3 days"), ctx)).toBeUndefined();
	});

	it("leaves an already-fenced block alone", async () => {
		const { ctx } = newCtx(["dev@build-box"]);
		await judgeToolCall(call("ssh dev@build-box uptime"), ctx);
		const wrapped = `${REMOTE_OPEN_MARKER}[preamble]\nup 3 days\n${REMOTE_CLOSE_MARKER}`;
		expect(fenceToolResult(result(wrapped), ctx)).toBeUndefined();
	});

	it("touches no image, no empty block, and no `details`", async () => {
		const { ctx } = newCtx(["dev@build-box"]);
		await judgeToolCall(call("ssh dev@build-box uptime"), ctx);
		const patch = fenceToolResult(
			{
				...result(""),
				content: [
					{ type: "text", text: "" },
					{ type: "image", text: undefined },
				],
			},
			ctx,
		);
		expect(patch).toBeUndefined();
	});

	it("fences nothing for a call that was allowed as reaching nobody", async () => {
		const { ctx } = newCtx();
		expect(await judgeToolCall(call("ssh -V"), ctx)).toBeUndefined();
		expect(fenceToolResult(result("OpenSSH_10.5p1"), ctx)).toBeUndefined();
	});
});
