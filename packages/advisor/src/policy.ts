/**
 * policy — the `disabledForModels` blocklist, and the predicate the mount gate asks.
 *
 * Upstream asked this twice: once at `session_start`, and again on every `model_select` /
 * `thinking_level_select` to strip or re-add the tool. Here it is asked **once**, by the gate (map
 * ticket 03): the contribution window closes at the first cell, so a mid-session executor change cannot
 * be acted on, and the arithmetic below is all that survives of the live half.
 */

import type { Api, Model } from "@earendil-works/pi-ai";

import { modelKey, parseModelKey, type DisabledForModelsEntry } from "./config.ts";
import { EFFORT_ORDINAL, type GradedEffort } from "./messages.ts";

let disabledForModelsCache: DisabledForModelsEntry[] = [];

export function setDisabledForModels(models: DisabledForModelsEntry[]): void {
	disabledForModelsCache = models;
}

export function getDisabledForModels(): readonly DisabledForModelsEntry[] {
	return disabledForModelsCache;
}

/**
 * Normalise a stored blocklist entry's model key to the canonical slash form. Tolerates legacy colon-form
 * persisted lists so `disabledForModels: ["anthropic:sonnet"]` keeps blocking after the slash migration
 * without a re-save. Pass-through for already-canonical values and for malformed input.
 */
function canonicalKey(entry: string): string {
	const parsed = parseModelKey(entry);
	return parsed ? `${parsed.provider}/${parsed.modelId}` : entry;
}

/**
 * True when `model` is on the blocklist at the executor's current thinking level.
 *
 * Fail-soft ranking contract: an executor level that is unset, "off", or unknown to EFFORT_ORDINAL ranks
 * −1, below every `minEffort` threshold, so such levels never block — and a threshold the ordinal cannot
 * rank is skipped rather than compared, which would otherwise let two −1s match.
 */
export function isModelBlocked(model: Model<Api> | undefined, thinkingLevel?: string): boolean {
	if (!model) return false;
	const key = modelKey(model);
	for (const entry of disabledForModelsCache) {
		if (typeof entry === "string") {
			if (canonicalKey(entry) === key) return true;
		} else {
			if (canonicalKey(entry.model) !== key) continue;
			if (entry.minEffort === undefined) return true;
			const thresholdOrdinal = EFFORT_ORDINAL.indexOf(entry.minEffort);
			if (thresholdOrdinal === -1) continue;
			const executorOrdinal = EFFORT_ORDINAL.indexOf(thinkingLevel as GradedEffort);
			if (executorOrdinal >= thresholdOrdinal) return true;
		}
	}
	return false;
}

/** Test seam: forget the blocklist. */
export function __resetPolicyForTests(): void {
	disabledForModelsCache = [];
}
