/**
 * execute — the reviewer side-call: read this session's branch, prepend the surface block, ask the
 * reviewer, and answer the cell.
 *
 * Upstream returned a tool envelope whose *text* carried every failure. The lane change makes failures
 * exceptions (ticket 01 Q8): a fault is raised out of the cell, so a model cannot read "Advisor (x) has
 * no API key" as if it were advice. What comes back as a value is exactly the reviewer's guidance plus the
 * facts about the call — `text`, `advisor_model`, `effort`, `stop_reason`, `usage` (ticket 06, which is
 * also where `error` was dropped: nothing can set it once faults raise).
 *
 * Everything else is upstream's, deliberately: the auth preflight, the runtime-facade preference (it is
 * what applies credential-derived request fields), `tools: []`, the single retry on an empty response,
 * and `effort` snapshotted once at entry so the reported level always matches the `reasoning` actually
 * sent — even if `/advisor` rewrites the file during the await window.
 */

import type { AssistantMessage, Message, ThinkingLevel, Usage } from "@earendil-works/pi-ai";
import { convertToLlm } from "@earendil-works/pi-coding-agent";

import { ensureUserTailForAdvisor, stripInflightToolCalls } from "./context.ts";
import { fail } from "./errors.ts";
import { executorSurfaceMessage } from "./inventory.ts";
import {
	ERR_ABORTED_DETAIL,
	ERR_CALL_ABORTED,
	ERR_EMPTY_RESPONSE,
	ERR_NO_MODEL,
	errCallFailed,
	errCallThrew,
	errMisconfigured,
	errNoApiKey,
	msgConsulting,
} from "./messages.ts";
import { getRuntimeCompleteSimple, loadCompleteSimple } from "./pi-compat.ts";
import { ADVISOR_SYSTEM_PROMPT } from "./prompt.ts";
import { getAdvisorEffort, getAdvisorModel } from "./state.ts";

/** What a cell gets back. Snake_case, because that is the vocabulary a cell is written in. */
export interface AdvisorValue {
	text: string;
	/** The reviewer's identity, colon-joined (`provider:model`) — upstream's label, not the config's key. */
	advisor_model: string;
	effort: ThinkingLevel | undefined;
	stop_reason: string;
	usage: Usage | null;
}

/** Extract the reviewer's text: every `text` part, joined and trimmed. Thinking parts are ignored. */
function advisorTextFromResponse(response: AssistantMessage): string {
	return response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();
}

export async function executeAdvisor(input: {
	ctx: unknown;
	/** The running cell's progress sink, when there is one. Answers only while a cell is in flight. */
	progress?: (text: string) => void;
}): Promise<AdvisorValue> {
	const ctx = input.ctx as {
		modelRegistry?: {
			find?: (provider: string, modelId: string) => unknown;
			getApiKeyAndHeaders?: (model: unknown) => Promise<{ ok: boolean; apiKey?: string; headers?: unknown; error?: string }>;
		};
		sessionManager?: { buildSessionContext?: () => { messages: unknown[] } };
		signal?: AbortSignal;
	} | null;

	// Snapshotted once: every branch below and the API call itself use this same value, so a save made
	// during the await window cannot desync what was sent as `reasoning` from what is reported.
	const effort = getAdvisorEffort();
	const advisor = getAdvisorModel();
	if (!advisor) throw fail("RuntimeError", ERR_NO_MODEL);
	const advisorLabel = `${advisor.provider}:${advisor.id}`;

	const registry = ctx?.modelRegistry;
	if (!registry?.getApiKeyAndHeaders) {
		throw fail("RuntimeError", errMisconfigured(advisorLabel, "this session exposes no model registry"));
	}
	const auth = await registry.getApiKeyAndHeaders(advisor);
	if (!auth.ok) throw fail("RuntimeError", errMisconfigured(advisorLabel, auth.error ?? "unknown auth failure"));
	const runtimeCompleteSimple = getRuntimeCompleteSimple(registry);
	if (!auth.apiKey && !runtimeCompleteSimple) {
		throw fail("RuntimeError", errNoApiKey(advisorLabel));
	}

	// Read the branch live: the advisor runs mid-turn, so any snapshot taken earlier is a turn stale. The
	// session manager's method is the free `buildSessionContext(entries, leafId)` the ticket-04 probe
	// pinned as identical.
	const session = ctx?.sessionManager?.buildSessionContext?.();
	const sessionMessages = (Array.isArray(session?.messages) ? session.messages : []) as Parameters<
		typeof convertToLlm
	>[0];
	const branch = ensureUserTailForAdvisor(stripInflightToolCalls(convertToLlm(sessionMessages)));
	const surface = executorSurfaceMessage(ctx);
	const messages: Message[] = surface ? [surface, ...branch] : branch;

	input.progress?.(msgConsulting(advisorLabel, effort));

	let signal: AbortSignal | undefined;
	try {
		signal = ctx?.signal;
	} catch {
		signal = undefined; // a disposed ctx throws on every getter; an unsignalled call beats no call
	}

	try {
		const completeSimple = runtimeCompleteSimple ?? (await loadCompleteSimple());
		const requestOptions = runtimeCompleteSimple
			? { signal, reasoning: effort }
			: { apiKey: auth.apiKey, headers: auth.headers, signal, reasoning: effort };

		// One dispatch point, reused by the retry, so attempt 2 cannot diverge from attempt 1. `tools: []`
		// reaffirms "never calls tools" even though the branch carries toolCall/toolResult blocks.
		const callAdvisor = (): Promise<AssistantMessage> =>
			completeSimple(advisor, { systemPrompt: ADVISOR_SYSTEM_PROMPT, messages, tools: [] }, requestOptions as never);

		const terminal = (response: AssistantMessage): never | undefined => {
			if (response.stopReason === "aborted") throw fail("RuntimeError", ERR_CALL_ABORTED);
			if (response.stopReason === "error") throw fail("RuntimeError", errCallFailed(response.errorMessage));
			return undefined;
		};

		let response = await callAdvisor();
		terminal(response);

		let text = advisorTextFromResponse(response);
		if (!text) {
			// Exactly one retry, with identical inputs: a persistent-empty provider must not hot-loop.
			response = await callAdvisor();
			terminal(response);
			text = advisorTextFromResponse(response);
			if (!text) throw fail("RuntimeError", ERR_EMPTY_RESPONSE);
		}

		return {
			text,
			advisor_model: advisorLabel,
			effort,
			stop_reason: response.stopReason,
			usage: response.usage ?? null,
		};
	} catch (error) {
		if ((error as { name?: string })?.name === "RuntimeError") throw error; // already ours
		const message = error instanceof Error ? error.message : String(error);
		throw fail("RuntimeError", errCallThrew(message));
	}
}
