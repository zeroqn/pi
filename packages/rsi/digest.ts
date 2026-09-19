/**
 * The deterministic session digest (spec §4.2, ticket 05).
 *
 * Built from raw entries, model-free, so it is ground truth the reviewer cannot
 * hallucinate. It is prepended to the rendered transcript inside the
 * `<session_transcript>` block; the transcript carries the nuance, the digest
 * carries the facts.
 */

import type { ScanMessage } from "./prescan.ts";

export interface DigestOptions {
	/** Best-effort `git diff --stat` for the working tree, when available. */
	gitStat?: string;
}

const CHANGED_TOOLS = new Set(["edit", "write", "apply_patch", "ast_grep_replace", "ast_grep_rewrite"]);
const MAX_LINES_PER_SECTION = 40;

export function buildDigest(messages: readonly ScanMessage[], options: DigestOptions = {}): string {
	const changed = new Set<string>();
	const read = new Set<string>();
	const commands: string[] = [];
	const errors: string[] = [];
	const outcomes = new Map<string, { ok: number; error: number }>();
	let toolCalls = 0;

	for (const message of messages) {
		for (const call of message.toolCalls ?? []) {
			toolCalls++;
			const target = pathOf(call.input);
			if (CHANGED_TOOLS.has(call.name) && target) changed.add(target);
			else if (call.name === "read" && target) read.add(target);
			if (call.name === "bash" && typeof call.input.command === "string") commands.push(call.input.command);
		}

		const result = message.toolResult;
		if (!result) continue;
		const tally = outcomes.get(result.toolName) ?? { ok: 0, error: 0 };
		if (result.isError) {
			tally.error++;
			errors.push(`${result.toolName}: ${excerpt(result.text ?? "")}`);
		} else {
			tally.ok++;
		}
		outcomes.set(result.toolName, tally);
	}

	const sections: string[] = [
		`Tool calls: ${toolCalls}`,
	];

	if (changed.size > 0) sections.push(...bullets("Files changed", [...changed]));
	if (read.size > 0) sections.push(...bullets("Files read", [...read]));
	if (commands.length > 0) sections.push(...bullets("Commands run", commands));
	if (errors.length > 0) sections.push(...bullets("Errors", errors));
	if (outcomes.size > 0) {
		const lines = [...outcomes.entries()].map(([tool, tally]) => `${tool}: ${tally.ok} ok, ${tally.error} error`);
		sections.push(...bullets("Outcomes", lines));
	}
	if (options.gitStat && options.gitStat.trim().length > 0) {
		sections.push("## git diff --stat", "```", options.gitStat.trim(), "```");
	}

	return sections.join("\n");
}

function bullets(heading: string, items: readonly string[]): string[] {
	const shown = items.slice(0, MAX_LINES_PER_SECTION).map((item) => `- ${item}`);
	if (items.length > MAX_LINES_PER_SECTION) shown.push(`- ...and ${items.length - MAX_LINES_PER_SECTION} more`);
	return [`## ${heading}`, ...shown];
}

function pathOf(input: Record<string, unknown>): string | undefined {
	for (const key of ["path", "file_path", "filePath"]) {
		const value = input[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

function excerpt(text: string): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	const firstLine = collapsed.split(/(?<=[.!?])\s/)[0] ?? collapsed;
	return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}
