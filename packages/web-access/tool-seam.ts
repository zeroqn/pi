/**
 * The **tool seam**: the same policy, applied to pi's own shell tool (`.scratch/guardrail-blindspots`
 * ticket 03).
 *
 * ## Why this seam exists
 *
 * The egress slot is code mode's. A session with no kernel — or a model that simply calls `bash` instead of
 * writing a cell — runs the same `ssh` command with **nothing** in front of it, and the text comes back
 * unfenced. pi fires `tool_call` **before** a tool executes (`{block, reason}`, `agent-loop.ts:746`) and
 * `tool_result` **after** (`{content, …}`, `runner.ts:1190-1248`), which are the kernel slot's two halves
 * exactly: refuse, and fence.
 *
 * ## What it judges
 *
 * The **shell tools** (`bash`, `powershell` — the only two whose input carries a command), read through
 * `input.command` and nothing else. It must never look for command-shaped text in *arbitrary* input: a
 * `python` tool call is itself a tool call whose source contains the same command, so a content-scanning
 * handler would judge the cell's own call and fence its result a second time (ticket 01's trap 2).
 *
 * A blocked call is an **error result carrying the reason** — so the model reads the same refusal sentence
 * whichever seam refused it, and, because a granted call that *fails* is also an error result, the fence's
 * presence is what tells it the command actually ran.
 *
 * ## The fence
 *
 * Same words as the kernel seam (`REMOTE_OUTPUT_FENCE`), applied to the result's **text block** in place —
 * the kernel's inline shape, so the same remote text reads identically wherever it arrived. Two additions
 * from what this seam alone can see (ticket 03):
 *
 *  - the handler returns `content` **only**, so the runner deletes `structuredContent`
 *    (`runner.ts:1202-1207`) — that field's `output` is the *full* output where the model-facing `content`
 *    is truncated, so carrying it would leave an unfenced copy **larger** than the wrapped one;
 *  - `details`, images and an empty text block are left untouched (the session's own facts, and nothing
 *    came back).
 *
 * The decision is not re-made here: `tool_call` records the fence its verdict named, keyed by the call's
 * id, and `tool_result` applies it. Re-deciding at result time could ask a second time, or answer
 * differently because a grant was revoked mid-call.
 */
import { CLOSE_MARKER, OPEN_MARKER, REMOTE_OUTPUT_FENCE } from "./guard";
import { decide } from "./policy";
import type { Fence } from "./policy";

/** pi's event shapes, structurally — this package does not depend on pi's types. */
type ToolCallEventLike = {
	toolName?: string;
	toolCallId?: string;
	input?: Record<string, unknown>;
	parentToolCallId?: string;
};

type ToolResultEventLike = ToolCallEventLike & {
	content?: { type?: string; text?: string }[];
};

/** The one event pair a session's tool seam is registered on. */
export type ToolSeamPi = {
	on(event: "tool_call", handler: (event: ToolCallEventLike, ctx: unknown) => unknown): void;
	on(event: "tool_result", handler: (event: ToolResultEventLike, ctx: unknown) => unknown): void;
};

/** The tools whose input is a shell command (`types.ts:1256-1265`; `powershell` aliases the same input). */
export const SHELL_TOOLS = new Set(["bash", "powershell"]);

const FENCES_KEY = Symbol.for("pi-ssh-grant:tool-fences");

/**
 * The fences awaiting a result, per session, keyed by tool-call id.
 *
 * Module state is enough: the `tool_call` and the `tool_result` for one call are dispatched by the same
 * runner, so the same module instance sees both. A session that ends between the two leaves an entry
 * behind, which is bounded by the calls in flight and dropped on the next `session_start`.
 */
function pendingFences(): Map<string, Map<string, Fence>> {
	const global = globalThis as { [key: symbol]: unknown };
	let map = global[FENCES_KEY] as Map<string, Map<string, Fence>> | undefined;
	if (map === undefined) {
		map = new Map();
		global[FENCES_KEY] = map;
	}
	return map;
}

/** Drop a session's pending fences: `session_start` begins a new one. */
export function forgetPendingFences(sessionKey: string): void {
	pendingFences().delete(sessionKey);
}

/** Drop every pending fence: for tests, which must not inherit another case's in-flight call. */
export function __resetPendingFencesForTests(): void {
	pendingFences().clear();
}

function sessionKeyOf(ctx: unknown): string | undefined {
	try {
		const manager = (ctx as { sessionManager?: { getSessionFile?: () => unknown; getSessionId?: () => unknown } } | null)
			?.sessionManager;
		const file = manager?.getSessionFile?.();
		if (typeof file === "string" && file.length > 0) return file;
		const id = manager?.getSessionId?.();
		return typeof id === "string" && id.length > 0 ? id : undefined;
	} catch {
		return undefined;
	}
}

function isChildOf(ctx: unknown): boolean {
	try {
		return (ctx as { isChild?: unknown } | null)?.isChild === true;
	} catch {
		return false;
	}
}

/** The command text a shell call carries, or `undefined` when this is not a shell call at all. */
export function shellCommandOf(event: ToolCallEventLike): string | undefined {
	if (typeof event.toolName !== "string" || !SHELL_TOOLS.has(event.toolName)) return undefined;
	const command = event.input?.command;
	return typeof command === "string" && command.length > 0 ? command : undefined;
}

/**
 * Judge one `tool_call`. Returns the block pi should apply, or `undefined` to let the call run.
 *
 * The verdict's `fence` is remembered for the result; `allow` and `refuse` remember nothing.
 */
export async function judgeToolCall(
	event: ToolCallEventLike,
	ctx: unknown,
): Promise<{ block: true; reason: string } | undefined> {
	const command = shellCommandOf(event);
	if (command === undefined) return undefined;
	const key = sessionKeyOf(ctx);
	if (key === undefined) return undefined;
	// The tool seam always fences: it performs the wrap itself, in `tool_result` below.
	const verdict = await decide(command, false, { sessionKey: key, ctx, isChild: isChildOf(ctx) }, true, FENCE_VERSION);
	if (verdict.kind === "allow") return undefined;
	if (verdict.kind === "refuse") return { block: true, reason: verdict.reason };
	if (typeof event.toolCallId === "string") {
		const session = pendingFences().get(key) ?? new Map<string, Fence>();
		session.set(event.toolCallId, verdict.fence);
		pendingFences().set(key, session);
	}
	return undefined;
}

/** The contract version this seam needs: 5 is where a verdict may allow *and* fence (ADR 0008). */
const FENCE_VERSION = 5;

/**
 * Apply the fence a granted call earned. Returns a `content` patch, or `undefined` when there is nothing to
 * wrap — an ungranted call, a non-shell tool, an empty result, or a block already carrying the wrapper.
 *
 * `content` alone is returned on purpose: replacing it without `structuredContent` is what makes the runner
 * **delete** the structured copy (`runner.ts:1202-1207`), which is the unfenced, *fuller* twin of the text
 * wrapped here (ticket 03 §1).
 */
export function fenceToolResult(
	event: ToolResultEventLike,
	ctx: unknown,
): { content: { type: string; text: string }[] } | undefined {
	const command = shellCommandOf(event);
	if (command === undefined) return undefined;
	const key = sessionKeyOf(ctx);
	if (key === undefined || typeof event.toolCallId !== "string") return undefined;
	const session = pendingFences().get(key);
	const fence = session?.get(event.toolCallId);
	if (fence === undefined || session === undefined) return undefined;
	session.delete(event.toolCallId);
	if (session.size === 0 && pendingFences().get(key)?.size === 0) pendingFences().delete(key);

	const content = event.content;
	if (!Array.isArray(content) || content.length === 0) return undefined;
	let changed = false;
	const wrapped = content.map((block) => {
		if (block.type !== "text" || typeof block.text !== "string") return block;
		if (block.text.trim() === "") return block;
		if (alreadyFenced(block.text)) return block;
		changed = true;
		return { ...block, type: "text", text: `${fence.open}${fence.preamble}\n${block.text}\n${fence.close}` };
	});
	return changed ? { content: wrapped as { type: string; text: string }[] } : undefined;
}

/**
 * Whether a value is already wrapped in this package's remote fence.
 *
 * `fenceText`'s rule is to **always wrap** — an idempotency check on the marker alone would be a bypass,
 * since remote text can forge it — so re-entry is handled here, by recognising the exact wrapper, and only
 * where re-entry can happen: a cell's result already carrying the kernel seam's wrap.
 */
function alreadyFenced(text: string): boolean {
	return text.startsWith(REMOTE_OUTPUT_FENCE.open) && text.endsWith(REMOTE_OUTPUT_FENCE.close);
}

/**
 * Register the seam on a pi extension api. Called from `host.ts`'s default export, beside the guard and the
 * `/ssh-grant` route.
 */
export function installToolSeam(pi: ToolSeamPi): void {
	pi.on("tool_call", async (event, ctx) => judgeToolCall(event, ctx));
	pi.on("tool_result", async (event, ctx) => fenceToolResult(event, ctx));
}

/** The markers, re-exported so a test can assert the wrapper without reaching into `guard.ts`. */
export const REMOTE_MARKERS = { open: REMOTE_OUTPUT_FENCE.open, close: CLOSE_MARKER, open_web: OPEN_MARKER } as const;
