/**
 * Reviewing pending proposals: the operator side of observe-only (spec §4.8).
 *
 * A proposal is a decision waiting for a human. Applying one performs the same
 * store operation the pass would have performed, through the same validation
 * (name uniqueness, pins, payload paths), and then removes the proposal.
 * Discarding simply removes it — a proposal is scratch, not library content.
 *
 * Pure apart from the store and the ledger lock, so the apply/discard logic is
 * tested without a terminal; `index.ts` supplies the select/confirm dialogs.
 */

import { ensureSkillEntry, setSkillState } from "./ledger.ts";
import type { PendingProposal, SkillStore } from "./store.ts";

export interface ApplyResult {
	ok: boolean;
	message: string;
}

/** A human-readable rendering shown before the apply/discard confirmation. */
export function formatProposal(proposal: PendingProposal): string {
	const { record, input } = proposal;
	const lines = [`[${record.kind}] ${record.name}`];
	if (record.scope) lines.push(`scope: ${record.scope}`);
	if (record.mode) lines.push(`written in: ${record.mode} mode`);
	if (record.reason) lines.push(`reason: ${record.reason}`);
	if (input) {
		lines.push("", `description: ${input.description}`, "", input.body.length > 1500 ? `${input.body.slice(0, 1500)}\n...` : input.body);
		if (input.files && input.files.length > 0) lines.push("", `files: ${input.files.map((file) => file.path).join(", ")}`);
	}
	return lines.join("\n");
}

/** Apply a proposal through the store, then remove it. */
export async function applyProposal(store: SkillStore, proposal: PendingProposal): Promise<ApplyResult> {
	const { record, input } = proposal;
	try {
		if (record.kind === "archive") {
			const result = store.archive(record.name);
			if (!result.ok) return { ok: false, message: result.reason };
			await setSkillState(store.root, record.name, "archived");
			store.removeProposal(proposal.dir);
			return { ok: true, message: `archived ${record.name}` };
		}

		if (record.kind === "promotion") {
			const scope = record.scope && record.scope !== "general" ? { project: record.scope } : "general";
			const result = store.moveToScope(record.name, scope);
			if (!result.ok) return { ok: false, message: result.reason };
			store.removeProposal(proposal.dir);
			return { ok: true, message: `promoted ${record.name} to ${record.scope ?? "general"}` };
		}

		if (!input) return { ok: false, message: "proposal carries no content to apply" };
		const existing = store.findByName(record.name);
		const result = existing
			? store.patch(record.name, { description: input.description, body: input.body, files: input.files })
			: store.create(input);
		if (!result.ok) return { ok: false, message: result.reason };
		if (!existing) {
			await ensureSkillEntry(store.root, { name: record.name, scope: input.scope === "general" ? "general" : input.scope.project });
		}
		store.removeProposal(proposal.dir);
		return { ok: true, message: existing ? `applied the proposed patch to ${record.name}` : `created ${record.name}` };
	} catch (error) {
		return { ok: false, message: error instanceof Error ? error.message : String(error) };
	}
}

/** Remove a pending proposal without applying it. */
export function discardProposal(store: SkillStore, proposal: PendingProposal): void {
	store.removeProposal(proposal.dir);
}
