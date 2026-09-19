/**
 * What a learning pass produced: the tally the pass reports, the single
 * notification line, and the audit report (spec §4.8, invariant 7).
 *
 * Pure so the wording is tested rather than improvised at the call site.
 */

import type { ContentHit } from "./content-scan.ts";

export interface PassTally {
	created: number;
	proposed: number;
	patched: number;
	archived: number;
	hardHits: ContentHit[];
	error?: string;
}

export interface PassNotification {
	line: string;
	type: "info" | "warning" | "error";
}

export function emptyTally(): PassTally {
	return { created: 0, proposed: 0, patched: 0, archived: 0, hardHits: [] };
}

export function tallyChanged(tally: PassTally): number {
	return tally.created + tally.proposed + tally.patched + tally.archived;
}

/**
 * One line when a pass changed something, nothing when it found nothing, and an
 * immediate line for a hard scan hit or a failure.
 */
export function formatPassNotification(tally: PassTally): PassNotification | undefined {
	if (tally.error) return { line: `rsi: pass failed (${tally.error})`, type: "error" };

	if (tally.hardHits.length > 0) {
		const labels = [...new Set(tally.hardHits.map((hit) => hit.label))].join(", ");
		return { line: `rsi: content scan rejected ${tally.hardHits.length} item(s): ${labels}`, type: "error" };
	}

	const parts: string[] = [];
	if (tally.created > 0) parts.push(`+${tally.created} skill${tally.created === 1 ? "" : "s"}`);
	if (tally.proposed > 0) parts.push(`${tally.proposed} proposal${tally.proposed === 1 ? "" : "s"}`);
	if (tally.patched > 0) parts.push(`${tally.patched} patched`);
	if (tally.archived > 0) parts.push(`${tally.archived} archived`);
	if (parts.length === 0) return undefined;

	return { line: `rsi: ${parts.join(", ")}`, type: "info" };
}

export interface ReportMeta {
	at: string;
	reason: "settled" | "learn";
	scope: string;
	mode: "observe" | "write";
	model?: string;
	reportDir?: string;
}

export function buildReport(tally: PassTally, meta: ReportMeta): string {
	const lines = [
		"# RSI pass report",
		"",
		`- at: ${meta.at}`,
		`- trigger: ${meta.reason}`,
		`- scope: ${meta.scope}`,
		`- mode: ${meta.mode}`,
		`- model: ${meta.model ?? "(session default)"}`,
		"",
		"## Tool actions",
		"",
		`- created: ${tally.created}`,
		`- proposed: ${tally.proposed}`,
		`- patched: ${tally.patched}`,
		`- archived: ${tally.archived}`,
	];
	if (tally.hardHits.length > 0) {
		lines.push("", "## Content scan hits", "");
		for (const hit of tally.hardHits) lines.push(`- ${hit.kind} ${hit.label} in ${hit.path}: "${hit.excerpt}"`);
	}
	if (tally.error) lines.push("", "## Error", "", `- ${tally.error}`);
	lines.push("");
	return lines.join("\n");
}
