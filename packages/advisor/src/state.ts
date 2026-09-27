/**
 * state — the selection the mount gate made, held for the life of the session.
 *
 * Module-level because there is exactly one kernel per session in this process, and the gate runs before
 * any cell can call the host function. Upstream's `advisor/state.ts` verbatim: the persisted form lives in
 * config.ts, the blocklist in policy.ts, and this is only what the session decided to use.
 *
 * Upstream re-read all of this on every `session_start` and could strip/re-add the tool mid-session. Here
 * it is written once, by the gate, and never re-derived — the contribution window closes at the first
 * cell (map ticket 03), which is why `/advisor` says "next session".
 */

import type { Api, Model } from "@earendil-works/pi-ai";

import type { GradedEffort } from "./messages.ts";

let selectedAdvisor: Model<Api> | undefined;
let selectedAdvisorEffort: GradedEffort | undefined;

export function getAdvisorModel(): Model<Api> | undefined {
	return selectedAdvisor;
}

export function setAdvisorModel(model: Model<Api> | undefined): void {
	selectedAdvisor = model;
}

export function getAdvisorEffort(): GradedEffort | undefined {
	return selectedAdvisorEffort;
}

export function setAdvisorEffort(effort: GradedEffort | undefined): void {
	selectedAdvisorEffort = effort;
}

/** Test seam: forget the selection, as a fresh process would. */
export function __resetAdvisorStateForTests(): void {
	selectedAdvisor = undefined;
	selectedAdvisorEffort = undefined;
}
