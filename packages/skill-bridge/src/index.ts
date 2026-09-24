/**
 * The entry: mount this session's kernel, contribute the call form, render the block.
 *
 * Three handlers, in the order the facts arrive:
 *
 *   - `session_start` — mount and contribute. The contribution window closes at the first cell, and a
 *     cell cannot run before pi finishes awaiting this emission, so this is provably in time.
 *   - `before_agent_start` — render. The block is built from the event's own loaded skills plus the
 *     providers' answers, and `mounted`/`contributed` decide whether and with which sentence.
 *   - `session_shutdown` — forget this session's provider records, and prune the ones whose sessions
 *     are long gone. `globalThis` outlives `/new`, resume and fork, and a **child never reaches a
 *     shutdown hook at all**, which is what makes the pruning load-bearing rather than tidy.
 *
 * Nothing here reads a store. The providers are asked; this package never looks behind one.
 */
import { READER, type ProviderListing, type SkillEntry, forgetSession, listings, pruneProviders, providersFor, sessionKey } from "./convention";
import { type KernelHandle, bindKernel } from "./kernel";
import { eventSkills, beforeAgentStartResult } from "./render";
import { skillHostFns } from "./call";
import { SKILL_PRELUDE } from "./prelude";

/**
 * A week. Pruning is hygiene, not correctness: a record is keyed by session file, so a stale one
 * cannot answer for another session, and the only thing at stake is the memory of a process that has
 * served thousands of sessions. A live session is never near this age — it rewrites its transcript
 * every turn.
 */
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

type ExtensionSurface = {
	on(event: string, handler: (event: any, ctx: any) => unknown): void;
	appendEntry?(customType: string, data: unknown): unknown;
};

export default function skillBridge(pi: ExtensionSurface): void {
	let currentCtx: unknown;
	let handle: KernelHandle | null = null;
	let contributed = false;
	let warned = false;
	let lastLoaded: readonly SkillEntry[] = [];

	/**
	 * pi's loaded skills, as of the last turn. `getSystemPromptOptions` is the live read — the options
	 * are rebuilt every prompt — and the event's own list is the fallback for a pi that does not offer
	 * it.
	 */
	const loadedNow = (): readonly SkillEntry[] => {
		try {
			const options = (currentCtx as { getSystemPromptOptions?: () => unknown })
				?.getSystemPromptOptions?.();
			if (options && typeof options === "object") {
				return eventSkills({ systemPrompt: "", systemPromptOptions: options as never });
			}
		} catch {
			/* fall through to the snapshot */
		}
		return lastLoaded;
	};

	pi.on("session_start", async (_event: unknown, ctx: unknown) => {
		currentCtx = ctx;
		// Hygiene first: a record whose session is long gone must not answer for this one.
		try {
			pruneProviders(PRUNE_AFTER_MS);
		} catch {
			/* pruning must never fail a session start */
		}

		const bind = bindKernel({
			pi,
			ctx,
			contribution: () => ({
				owner: READER,
				hostFns: skillHostFns({ ctx: () => currentCtx, piLoaded: loadedNow }),
				prelude: SKILL_PRELUDE,
			}),
		});
		handle = bind.handle;
		contributed = bind.receipt !== null && bind.receipt.rejected.length === 0;

		// A first failure is loud — recorded durably and told to the human. The model is told nothing:
		// with no call form the block falls back to pi's own sentence, which the kernel's bash makes
		// true, so there is nothing the model needs to know.
		let problem = bind.problem ?? null;
		const refusal = bind.receipt?.rejected?.[0];
		if (!contributed && refusal) {
			problem = `contribution refused whole: ${refusal.name} (${refusal.reason})`;
		}
		if (problem && !warned) {
			warned = true;
			try {
				(ctx as { ui?: { notify?: (text: string, type?: string) => void } })?.ui?.notify?.(
					`skill-bridge: ${problem}`,
					"warning",
				);
			} catch {
				/* a notice must never fail a session start */
			}
		}
		try {
			pi.appendEntry?.("skill-bridge-kernel", {
				mounted: handle !== null,
				contributed,
				problem,
			});
		} catch {
			/* the record is best effort */
		}
	});

	pi.on("before_agent_start", async (event: any, ctx: unknown) => {
		currentCtx = ctx;
		const loaded = eventSkills(event);
		if (loaded.length > 0) lastLoaded = loaded;

		let answers: ProviderListing[] = [];
		try {
			answers = await listings(providersFor(sessionKey(ctx)));
		} catch {
			// A provider registry that cannot be read is a session with no providers, not a prompt that
			// fails to build.
			answers = [];
		}
		return beforeAgentStartResult(event, {
			mounted: handle !== null,
			contributed,
			answers,
		});
	});

	pi.on("session_shutdown", async (_event: unknown, ctx: unknown) => {
		try {
			forgetSession(sessionKey(ctx ?? currentCtx));
		} catch {
			/* the session is going away either way */
		}
		handle = null;
		contributed = false;
		warned = false;
		lastLoaded = [];
	});
}
