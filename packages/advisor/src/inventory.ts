/**
 * inventory — the block the reviewer reads to learn what the executor can actually do.
 *
 * **Why this is not the pi tool list.** Upstream prepended `pi.getAllTools()` — pi's whole *registry* —
 * and the reviewer's system prompt told it to judge tool choice from that. Two facts make it wrong here
 * (tickets 01 Q10, 05): the reviewer never sees the executor's system prompt or the `python` tool's
 * description (the payload is `{systemPrompt: ADVISOR_SYSTEM_PROMPT, messages, tools: []}`), so this block
 * is its **only** account of the executor's capabilities; and in a code-mode session the registered tools
 * are mostly not callable from a cell at all.
 *
 * **What replaces it.** A static preamble the port owns — the executor works inside a Python cell, here
 * are its primitives, here is the honest negative — followed by the host functions this session actually
 * has. Those names come from `pi-host-bridge`'s own session record (`installed`), which is the list the
 * ledger accepted, and it is read **at call time** because host-bridge writes the record only after the
 * contributions land.
 *
 * **The cache is per session** (ticket 05's amendment). The block is part of a payload billed against a
 * prompt cache, so its bytes must not wobble between two calls in one session — upstream's reason, kept
 * with a different key: the record is per session (a child's differs from its spawner's), so the cache is
 * keyed by session key and invalidated by the sorted-name signature. It is a module-level map rather than
 * upstream's `globalThis` slot precisely because nothing else in the process needs to see it, and a
 * `Symbol.for` slot would survive a `/reload` with a stale block in it. The entry prunes it on
 * `session_shutdown`, so a long-lived process does not accumulate one block per session it has served.
 *
 * The seam carries names, not descriptions, per host function (`SessionRecord` is `{mounted, owners,
 * installed, reaches, promptTexts, problems}`) — so a line per name is all the honesty available here, and
 * whether that is enough is the map's Not-yet-specified entry, with the bar run as its trigger.
 */
import type { Message } from "@earendil-works/pi-ai";

import { sessionKey, sessionRecord } from "../../host-bridge/src/convention.ts";

/** The block's heading. `Tools` would be a lie in this lane; `Surface` is what the list is. */
export const SURFACE_TITLE = "## Available Executor Surface";

/**
 * The half that never varies: what a code-mode session *is*. Written for the reviewer, in its register —
 * it is the only place the reviewer learns that the executor is inside a cell.
 */
export const SURFACE_PREAMBLE = `The executor works inside a persistent Python cell. The only tool it calls is \`python\`; everything else it can do is either a kernel primitive or a host function contributed to this session by an extension. Its primitives are \`bash_host\`, \`find\`, \`grep\`, \`read_image\` and the file helpers \`read_text\`, \`write_text\`, \`edit_text\`, \`walk\`. The contributed host functions are listed below.

A tool the host has *registered* is not necessarily callable from a cell, so judge tool choice inside this list — advising a tool that is absent from it is advising something the executor cannot do.`;

interface CachedSurface {
	signature: string;
	message: Message;
}

const CACHE = new Map<string, CachedSurface>();

/** The block's text for a set of contributed names. Sorted, so the bytes are a function of the names. */
export function surfaceBlockText(installed: readonly string[]): string {
	const names = [...installed].sort();
	const list =
		names.length > 0
			? names.map((name) => `- \`${name}\``).join("\n")
			: "_(No host function beyond the primitives is contributed to this session.)_";
	return `${SURFACE_TITLE}\n\n${SURFACE_PREAMBLE}\n\n### Contributed host functions\n\n${list}`;
}

/** The host functions this session's record says landed. An unknown session has none. */
export function installedHostFunctions(ctx: unknown): string[] {
	try {
		return sessionRecord(sessionKey(ctx))?.installed ?? [];
	} catch {
		// A ctx that cannot be keyed has no record to read, which is the no-kernel answer.
		return [];
	}
}

/**
 * The message the reviewer's payload is prepended with, or `undefined` when there is nothing true to say.
 *
 * Today it always answers something: the preamble is true of any session whose kernel can reach this
 * host function at all — a cell exists, or the call could not have been made. `undefined` stays in the
 * signature for the caller's sake (upstream's empty-registry contract), not because a live call reaches it.
 */
export function executorSurfaceMessage(ctx: unknown): Message | undefined {
	const key = (() => {
		try {
			return sessionKey(ctx);
		} catch {
			return undefined;
		}
	})();
	const installed = installedHostFunctions(ctx);
	const signature = [...installed].sort().join("|");
	if (key !== undefined) {
		const cached = CACHE.get(key);
		if (cached && cached.signature === signature) return cached.message;
	}
	const message = {
		role: "user",
		content: [{ type: "text", text: surfaceBlockText(installed) }],
		timestamp: Date.now(),
	} as Message;
	if (key !== undefined) CACHE.set(key, { signature, message });
	return message;
}

/** Drop one session's cached block, on `session_shutdown`. */
export function forgetExecutorSurface(key: string): void {
	CACHE.delete(key);
}

/** Test seam: forget every cached block. */
export function __resetInventoryForTests(): void {
	CACHE.clear();
}

export function __cacheSizeForTests(): number {
	return CACHE.size;
}
