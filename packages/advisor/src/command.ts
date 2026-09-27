/**
 * command — the `/advisor` slash command: model picker → effort picker → persist → say what changes when.
 *
 * Upstream's flow, with the tool lane removed and one sentence added. The flow is unchanged because a human
 * is still the one configuring an advisor: interactive guard → `buildModelItems` → no-advisor branch →
 * model lookup → `buildEffortItems` → persist. What changed:
 *
 *  - **Nothing reconciles a tool.** Upstream's `applyDisable`/`applyEnable` also stripped or re-added the
 *    `advisor` pi tool; there is no such tool here.
 *  - **The change is persisted, not applied.** The contribution window closes at the mount (tickets 01 Q9,
 *    03), so a selection made now is the *next* session's advisor — and the notify says so rather than
 *    leaving the user to wonder why `await advisor()` still refuses (or still works).
 *  - **Nothing mutates the in-memory selection.** The running session keeps the reviewer it was mounted
 *    with; clearing `state.ts` here would break a working session's advisor without giving the new one
 *    anything until it restarts.
 *
 * The apply helpers persist **before** they notify, so a save failure can never be reported as success.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SelectItem } from "@earendil-works/pi-tui";

import { showAdvisorPicker, showEffortPicker } from "./advisor-ui.ts";
import { loadConfig, modelKey, parseModelKey, saveAdvisorConfig } from "./config.ts";
import {
	CHECKMARK,
	DEFAULT_EFFORT,
	EFFORT_ORDINAL,
	errSelectionNotFound,
	type GradedEffort,
	MSG_ADVISOR_DISABLED,
	MSG_EFFORT_NOT_SET,
	MSG_NEXT_SESSION,
	MSG_PERSIST_FAILED,
	MSG_REQUIRES_INTERACTIVE,
	msgAdvisorEnabled,
	msgAdvisorEnabledInactive,
	NO_ADVISOR_VALUE,
	OFF_VALUE,
	RECOMMENDED_EFFORT_SUFFIX,
} from "./messages.ts";
import { isModelBlocked } from "./policy.ts";
import { getAdvisorEffort, getAdvisorModel } from "./state.ts";

/** The persisted key in its canonical slash form, or undefined — what the picker marks as current. */
function persistedKey(): string | undefined {
	const raw = loadConfig().config.modelKey;
	if (!raw) return undefined;
	const parsed = parseModelKey(raw);
	return parsed ? `${parsed.provider}/${parsed.modelId}` : raw;
}

function buildModelItems(availableModels: Model<Api>[], currentKey: string | undefined): SelectItem[] {
	const items: SelectItem[] = availableModels.map((m) => {
		const key = modelKey(m);
		const check = key === currentKey ? CHECKMARK : "";
		return { value: key, label: `${m.name}  (${m.provider})${check}` };
	});
	items.push({
		value: NO_ADVISOR_VALUE,
		label: currentKey === undefined ? `No advisor${CHECKMARK}` : "No advisor",
	});
	return items;
}

function buildEffortItems(picked: Model<Api>): SelectItem[] {
	// Intersect with EFFORT_ORDINAL (which excludes "off") so the picker can never offer — hence
	// saveAdvisorConfig can never persist — a level that minEffort blocklist comparisons don't rank.
	const levels = getSupportedThinkingLevels(picked).filter((level): level is GradedEffort =>
		EFFORT_ORDINAL.includes(level as GradedEffort),
	);
	return [
		// "off (no reasoning sent)" ≠ /rpiv-models' "off (disable reasoning)": this row sends NO reasoning
		// option; that one persists thinking:"off".
		{ value: OFF_VALUE, label: "off (no reasoning sent)" },
		...levels.map((level) => ({
			value: level,
			label: level === DEFAULT_EFFORT ? `${level}${RECOMMENDED_EFFORT_SUFFIX}` : level,
		})),
	];
}

function applyDisable(ctx: ExtensionContext): void {
	if (!saveAdvisorConfig(undefined, undefined)) {
		ctx.ui.notify(MSG_PERSIST_FAILED, "error");
		return;
	}
	ctx.ui.notify(`${MSG_ADVISOR_DISABLED}${MSG_NEXT_SESSION}`, "info");
}

function applyEnable(ctx: ExtensionContext, picked: Model<Api>, effort: GradedEffort | undefined): void {
	if (!saveAdvisorConfig(modelKey(picked), effort)) {
		ctx.ui.notify(MSG_PERSIST_FAILED, "error");
		return;
	}
	// The blocklist is this session's business only in that it predicts the next one: the executor's model
	// and level now are what the next mount will read, so the notify can say whether it will be inactive.
	const blocked = isModelBlocked(ctx.model, ctx.thinkingLevel);
	const label = modelKey(picked);
	ctx.ui.notify(
		`${blocked ? msgAdvisorEnabledInactive(label, effort) : msgAdvisorEnabled(label, effort)}${MSG_NEXT_SESSION}`,
		"info",
	);
}

export function registerAdvisorCommand(pi: ExtensionAPI): void {
	pi.registerCommand("advisor", {
		description: "Configure the advisor model a code-mode cell can consult",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify(MSG_REQUIRES_INTERACTIVE, "error");
				return;
			}

			const availableModels = ctx.modelRegistry.getAvailable();
			const currentKey = persistedKey();
			const mounted = getAdvisorModel();
			// The mounted reviewer is the current selection even when the persisted key is unreadable: it is
			// what a cell is actually talking to.
			const selectionKey = mounted ? modelKey(mounted) : currentKey;

			const choice = await showAdvisorPicker(ctx, buildModelItems(availableModels, selectionKey));
			if (!choice) return;

			if (choice === NO_ADVISOR_VALUE) {
				applyDisable(ctx);
				return;
			}

			const picked = availableModels.find((m) => modelKey(m) === choice);
			if (!picked) {
				ctx.ui.notify(errSelectionNotFound(choice), "error");
				return;
			}

			// Effort picker — only for reasoning-capable models
			let effortChoice: GradedEffort | undefined;
			if (picked.reasoning) {
				const effortResult = await showEffortPicker(
					ctx,
					buildEffortItems(picked),
					getAdvisorEffort(),
					DEFAULT_EFFORT,
				);
				if (!effortResult) {
					// Esc at the effort step keeps the model selection — cancelling one step never discards
					// prior choices (the invariant shared with the /rpiv-models stepper). The divergence is
					// deliberate: here the enable proceeds and PERSISTS with no explicit effort (model default),
					// announced by this notify before the write.
					ctx.ui.notify(MSG_EFFORT_NOT_SET, "info");
				} else {
					effortChoice = effortResult === OFF_VALUE ? undefined : (effortResult as GradedEffort);
				}
			}

			applyEnable(ctx, picked, effortChoice);
		},
	});
}
