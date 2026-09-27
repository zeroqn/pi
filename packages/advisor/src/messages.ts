/**
 * messages — the advisor's vocabulary: its name, the effort ordinal, the two picker sentinels, and every
 * string the user, the model or the reviewer can be shown. Pure declarations, consumed across `src/`.
 *
 * Ported from rpiv-advisor's `advisor/messages.ts` with three changes the lane forced, each marked below:
 * the tool identity is the **host function's** name (nothing registers a pi tool), the user-tail nudge is
 * reworded for a cell (ticket 04), and the enable/disable strings carry the mount-time gate's one
 * surprise — the next session, not this one (tickets 01 Q9, 03).
 */

import type { ThinkingLevel } from "@earendil-works/pi-ai";

/** The host function's name, and the name every receipt, string and guideline uses. */
export const ADVISOR_HOST_FN = "advisor";
/** The owner string this package registers under. */
export const ADVISOR_OWNER = "advisor";
export const TOOL_LABEL = "Advisor";

// Selector sentinels — double-underscore form is collision-proof against real provider:id keys
export const NO_ADVISOR_VALUE = "__no_advisor__";
export const OFF_VALUE = "__off__";

// Effort levels. GradedEffort is the ordinal's domain: the graded levels only, never "off" — an "off"
// element would corrupt the indexOf ranking that minEffort thresholds compare against. Today pi-ai's
// ThinkingLevel already excludes "off" (the Exclude is a defensive no-op); the alias keeps that exclusion
// structural if the upstream universe ever re-widens.
export type GradedEffort = Exclude<ThinkingLevel, "off">;
export const EFFORT_ORDINAL: readonly GradedEffort[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
export const DEFAULT_EFFORT: GradedEffort = "high";
export const RECOMMENDED_EFFORT_SUFFIX = "  (recommended)";

// UI — labels used by the command flow; panel prose/titles live in advisor-ui.ts
export const CHECKMARK = " ✓";

// Messages (static)
export const MSG_ADVISOR_DISABLED = "Advisor disabled";
export const MSG_REQUIRES_INTERACTIVE = "/advisor requires interactive mode";
/**
 * The guaranteed user tail (ticket 04). Upstream's `Please advise on the executor's situation above.`
 * assumed the executor *is* the conversation; here the executor is inside a cell, and the tail exists
 * because stripping the in-flight call leaves an assistant turn a provider would reject as prefill.
 */
export const MSG_ADVISOR_NUDGE = "The executor is inside a Python cell; advise on its situation above.";
export const MSG_EFFORT_NOT_SET = "Effort not set — advisor uses the model default";
export const MSG_PERSIST_FAILED = "Failed to save advisor selection — selection not persisted";
/** Appended by `/advisor` because the contribution window closes at the mount (tickets 01 Q9, 03). */
export const MSG_NEXT_SESSION = " — takes effect in the next session";

// Errors — raised, never returned (ticket 01 Q8). The class is the error's `.name`: monty maps a thrown
// JS error onto a Python exception by that name, so `advisor()` raises `RuntimeError` and a bad call
// raises `ValueError`.
export const ERR_NO_MODEL = "No advisor model is configured. The user can enable one with the /advisor command.";
export const ERR_CALL_ABORTED = "Advisor call was cancelled before it completed.";
export const ERR_EMPTY_RESPONSE = "Advisor returned no text content.";
export const ERR_EMPTY_RESPONSE_DETAIL = "empty response";
export const ERR_ABORTED_DETAIL = "aborted";
export const ERR_UNKNOWN = "unknown error";

// Errors/messages (parameterized)
export const errUnknownArgument = (fn: string, keys: string[]) =>
	`${fn}() takes no arguments, and got: ${keys.join(", ")}`;
export const errMisconfigured = (label: string, err: string) => `Advisor (${label}) is misconfigured: ${err}`;
export const errNoApiKey = (label: string) => `Advisor (${label}) has no API key available.`;
export const errNoApiKeyDetail = (provider: string) => `no API key for ${provider}`;
export const errCallFailed = (err: string | undefined) => `Advisor call failed: ${err ?? ERR_UNKNOWN}`;
export const errCallThrew = (msg: string) => `Advisor call threw: ${msg}`;
export const errSelectionNotFound = (choice: string) => `Advisor selection not found: ${choice}`;
export const errModelUnavailable = (key: string) =>
	`Previously configured advisor model ${key} is no longer available`;
export const msgAdvisorEnabled = (label: string, effort: ThinkingLevel | undefined) =>
	`Advisor: ${label}${effort ? `, ${effort}` : ""}`;
export const msgAdvisorEnabledInactive = (label: string, effort: ThinkingLevel | undefined) =>
	`Advisor: ${label}${effort ? `, ${effort}` : ""} (inactive for current executor)`;
export const msgConsulting = (label: string, effort: ThinkingLevel | undefined) =>
	`Consulting advisor (${label}${effort ? `, ${effort}` : ""})…`;
