/**
 * The side-call: what a cell gets back, and what a fault does.
 *
 * The `completeSimple` it reaches is the host's own facade, taken from the registry's private `runtime`
 * slot — the same seam the port prefers in production — so the whole call is driven without a network.
 */
import type { Api, Model } from "@earendil-works/pi-ai";

import { beforeEach, describe, expect, it } from "bun:test";

import { executeAdvisor } from "../src/execute.ts";
import { setAdvisorEffort, setAdvisorModel, __resetAdvisorStateForTests } from "../src/state.ts";

const advisor = { provider: "anthropic", id: "opus", name: "Opus" } as unknown as Model<Api>;
const executor = { provider: "deepseek", id: "deepseek-flash", name: "Flash" } as unknown as Model<Api>;

interface Call {
	model: unknown;
	options: { systemPrompt: string; messages: { role: string; content: unknown[] }[]; tools: unknown[] };
	requestOptions: Record<string, unknown>;
}

function assistantResponse(text: string, stopReason = "stop"): unknown {
	return {
		role: "assistant",
		content: text.length > 0 ? [{ type: "text", text }] : [],
		stopReason,
		usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
}

/** The branch ticket 04 measured: a user turn and an assistant turn whose `python` call is in flight. */
const BRANCH = [
	{ role: "user", content: [{ type: "text", text: "do the thing" }] },
	{
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "…" },
			{ type: "toolCall", id: "call-1", name: "python", arguments: { code: "await advisor()" } },
		],
	},
];

function makeCtx(input: {
	calls: Call[];
	responses: unknown[];
	auth?: { ok: boolean; apiKey?: string; error?: string };
	withRuntime?: boolean;
	signal?: AbortSignal;
}): unknown {
	const queue = [...input.responses];
	const completeSimple = async (model: unknown, options: Call["options"], requestOptions: Record<string, unknown>) => {
		input.calls.push({ model, options, requestOptions });
		return queue.length > 1 ? queue.shift() : (queue[0] ?? assistantResponse(""));
	};
	const registry: Record<string, unknown> = {
		find: () => advisor,
		getApiKeyAndHeaders: async () => input.auth ?? { ok: true, apiKey: "key", headers: {} },
	};
	if (input.withRuntime !== false) registry["runtime"] = { completeSimple };
	return {
		model: executor,
		thinkingLevel: "high",
		modelRegistry: registry,
		sessionManager: {
			buildSessionContext: () => ({ messages: BRANCH }),
			getSessionFile: () => "/tmp/advisor-exec-session.jsonl",
		},
		signal: input.signal,
	};
}

beforeEach(() => {
	__resetAdvisorStateForTests();
	setAdvisorModel(advisor);
	setAdvisorEffort("high");
});

describe("the value a cell gets", () => {
	it("is the guidance plus the facts about the call", async () => {
		const calls: Call[] = [];
		const value = await executeAdvisor({ ctx: makeCtx({ calls, responses: [assistantResponse("do X")] }) });
		expect(value.text).toBe("do X");
		expect(value.advisor_model).toBe("anthropic:opus");
		expect(value.effort).toBe("high");
		expect(value.stop_reason).toBe("stop");
		expect(value.usage?.totalTokens).toBe(12);
		expect("error" in value).toBe(false);
	});

	it("joins every text part of a split response", async () => {
		const calls: Call[] = [];
		const response = { ...(assistantResponse("") as Record<string, unknown>) };
		response["content"] = [{ type: "text", text: "one" }, { type: "thinking", thinking: "t" }, { type: "text", text: "two" }];
		const value = await executeAdvisor({ ctx: makeCtx({ calls, responses: [response] }) });
		expect(value.text).toBe("one\ntwo");
	});
});

describe("the payload the reviewer receives", () => {
	it("is the surface block, then the branch with the in-flight call stripped and a user tail", async () => {
		const calls: Call[] = [];
		await executeAdvisor({ ctx: makeCtx({ calls, responses: [assistantResponse("ok")] }) });
		const messages = calls[0]?.options.messages ?? [];
		expect(messages[0]?.role).toBe("user");
		expect(JSON.stringify(messages[0])).toContain("## Available Executor Surface");
		expect(messages.at(-1)?.role).toBe("user");
		expect(JSON.stringify(messages.at(-1))).toContain("inside a Python cell");
		// The in-flight call is gone; its thinking part survived.
		const assistant = messages.find((m) => m.role === "assistant");
		expect(JSON.stringify(assistant)).not.toContain("toolCall");
		expect(JSON.stringify(assistant)).toContain("thinking");
	});

	it("sends no tools, and the reviewer's own system prompt", async () => {
		const calls: Call[] = [];
		await executeAdvisor({ ctx: makeCtx({ calls, responses: [assistantResponse("ok")] }) });
		expect(calls[0]?.options.tools).toEqual([]);
		expect(calls[0]?.options.systemPrompt).toContain("You are an advisor model");
	});

	it("sends the snapped effort as the reasoning level", async () => {
		const calls: Call[] = [];
		await executeAdvisor({ ctx: makeCtx({ calls, responses: [assistantResponse("ok")] }) });
		expect(calls[0]?.requestOptions["reasoning"]).toBe("high");
	});

	it("carries the session's abort signal", async () => {
		const calls: Call[] = [];
		const controller = new AbortController();
		await executeAdvisor({ ctx: makeCtx({ calls, responses: [assistantResponse("ok")], signal: controller.signal }) });
		expect(calls[0]?.requestOptions["signal"]).toBe(controller.signal);
	});
});

describe("the progress sink", () => {
	it("says what is being consulted, once", async () => {
		const calls: Call[] = [];
		const seen: string[] = [];
		await executeAdvisor({ ctx: makeCtx({ calls, responses: [assistantResponse("ok")] }), progress: (text) => seen.push(text) });
		expect(seen).toEqual(["Consulting advisor (anthropic:opus, high)…"]);
	});
});

describe("faults raise, they never return", () => {
	it("raises when no advisor was selected for the session", async () => {
		__resetAdvisorStateForTests();
		await expect(executeAdvisor({ ctx: makeCtx({ calls: [], responses: [] }) })).rejects.toThrow(/No advisor model/);
	});

	it("raises when the reviewer has no credentials", async () => {
		const ctx = makeCtx({ calls: [], responses: [], auth: { ok: false, error: "no key configured" } });
		await expect(executeAdvisor({ ctx })).rejects.toThrow(/is misconfigured: no key configured/);
	});

	it("raises when a keyless host has no runtime facade to fall back on", async () => {
		const ctx = makeCtx({ calls: [], responses: [], auth: { ok: true }, withRuntime: false });
		const error = await executeAdvisor({ ctx }).catch((e: Error) => e);
		expect((error as Error).name).toBe("RuntimeError");
		expect((error as Error).message).toContain("has no API key available");
	});

	it("raises on an aborted call rather than returning the abort text as advice", async () => {
		const ctx = makeCtx({ calls: [], responses: [assistantResponse("", "aborted")] });
		const error = await executeAdvisor({ ctx }).catch((e: Error) => e);
		expect((error as Error).name).toBe("RuntimeError");
		expect((error as Error).message).toContain("cancelled before it completed");
	});

	it("raises on a provider error", async () => {
		const response = { ...(assistantResponse("", "error") as Record<string, unknown>), errorMessage: "rate limited" };
		const ctx = makeCtx({ calls: [], responses: [response] });
		await expect(executeAdvisor({ ctx })).rejects.toThrow(/Advisor call failed: rate limited/);
	});

	it("retries an empty response exactly once, then raises", async () => {
		const calls: Call[] = [];
		const ctx = makeCtx({ calls, responses: [assistantResponse(""), assistantResponse("")] });
		await expect(executeAdvisor({ ctx })).rejects.toThrow(/no text content/);
		expect(calls).toHaveLength(2);
	});

	it("takes the retry's text when the second attempt answers", async () => {
		const calls: Call[] = [];
		const ctx = makeCtx({ calls, responses: [assistantResponse(""), assistantResponse("second time")] });
		const value = await executeAdvisor({ ctx });
		expect(value.text).toBe("second time");
		expect(calls).toHaveLength(2);
	});

	it("raises a RuntimeError when the call throws", async () => {
		const ctx = {
			model: executor,
			modelRegistry: {
				getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "key" }),
				runtime: {
					completeSimple: async () => {
						throw new Error("socket closed");
					},
				},
			},
			sessionManager: { buildSessionContext: () => ({ messages: BRANCH }) },
		};
		const error = await executeAdvisor({ ctx }).catch((e: Error) => e);
		expect((error as Error).name).toBe("RuntimeError");
		expect((error as Error).message).toContain("socket closed");
	});
});
