/**
 * The entry: what pi loads, and what a session gets.
 *
 * This package registers **no pi tool**. It is a `pi-host-bridge` contributor — the shape
 * `pi-web-access`, `pi-ask-user-question` and `pi-zvec-grep` established — whose offer is one host
 * function a code-mode cell can call: `await advisor()`. The `/advisor` command is registered from the
 * factory, because it is a human-facing command and the gate cannot help with that.
 *
 * Registration happens at **module load**, not from the factory: pi loads each extension entry through its
 * own jiti instance, so the factory may never run in the process that composes a session, while the
 * process-global slot host-bridge reads is written either way.
 *
 * The session answer is `contribution.ts` — the gate, the prose and the host function — and the only thing
 * this file adds to it is the cache sweep: the reviewer's surface block is cached per session key for
 * prompt-cache stability (ticket 05), and `globalThis` outlives `/new`, resume and fork, so a session that
 * ends takes its block with it.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	API_VERSION,
	registerContributor,
	type ContributorAnswer,
	type SessionInput,
	sessionKey,
} from "../host-bridge/src/convention.ts";
import { registerAdvisorCommand } from "./src/command.ts";
import { advisorAnswer } from "./src/contribution.ts";
import { forgetExecutorSurface } from "./src/inventory.ts";
import { ADVISOR_OWNER } from "./src/messages.ts";

/** This package's registration, exported so a test can drive it without a process. */
export const advisorRegistration = {
	key: "pi-advisor",
	owner: ADVISOR_OWNER,
	apiVersion: API_VERSION,
	session: (input: SessionInput): ContributorAnswer | null => advisorAnswer(input),
};

registerContributor(advisorRegistration);

export default function advisor(pi: ExtensionAPI): void {
	registerAdvisorCommand(pi);

	pi.on("session_shutdown", async (_event: unknown, ctx: unknown) => {
		try {
			forgetExecutorSurface(sessionKey(ctx));
		} catch {
			/* a session that cannot be keyed has no cached block */
		}
		return undefined;
	});
}
