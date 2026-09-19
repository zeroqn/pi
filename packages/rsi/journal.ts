/**
 * The code-mode half of the digest (RSI x RLM ticket 04).
 *
 * RSI's digest is built from pi tool calls, and in a code-mode session the only tool is
 * `python`: a session of three cells doing sixty file operations produced an empty digest.
 * What RLM *does* keep is the kernel journal — one record per cell, with the cell's code and
 * every host call with its args and result — written beside the session file as
 * `<sessionFile>.rlm-journal.jsonl`.
 *
 * RSI reads that file **by path** rather than receiving it over the seam (ticket 15), which is
 * what makes a session still learnable after its RLM instance is gone: a resumed session, or a
 * child closed before its pass. It is read defensively — a missing, torn or partial file yields
 * whatever is there and never fails a pass.
 *
 * **What this digest can and cannot claim.** Host calls are exact. Kernel-side file operations
 * (`read_text`, `write_text`, `edit_text`) are *not* host calls — they are prelude helpers
 * running inside monty — so they are invisible here, and the cell's code is the record of
 * intent for them. The digest therefore shows the code rather than pretending to enumerate
 * file changes it cannot see.
 */

import * as fs from "node:fs";

/** The journal RLM writes beside a session file. */
export function journalPathFor(sessionFile: string | undefined): string | undefined {
	return sessionFile && sessionFile.length > 0 ? `${sessionFile}.rlm-journal.jsonl` : undefined;
}

export interface HostCallRecord {
	name: string;
	args: unknown[];
	result: unknown;
}

export interface CellRecord {
	index: number;
	code: string;
	hostCalls: HostCallRecord[];
	durationMs: number;
	at: string;
}

/**
 * Read the journal. Torn lines are skipped rather than discarding the file, and a missing
 * file is simply no records — the same tolerance RLM's own reader applies.
 */
export function readJournal(path: string | undefined): CellRecord[] {
	if (!path) return [];
	let raw: string;
	try {
		raw = fs.readFileSync(path, "utf8");
	} catch {
		return [];
	}
	const records: CellRecord[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const parsed = JSON.parse(line) as CellRecord;
			if (typeof parsed?.index === "number") records.push(parsed);
		} catch {
			// A torn line is a partial write, not a reason to lose the rest.
		}
	}
	return records.sort((a, b) => a.index - b.index);
}

/** What the pre-scan needs to judge size in code-mode (ticket 04's recalibration). */
export interface KernelActivity {
	/** Cells that ran. */
	cells: number;
	/** Host calls the cells made — the evidence, since a cell with none did nothing observable. */
	hostCalls: number;
	/** A host call failed and a later one to the same host function succeeded. */
	errorThenSuccess: boolean;
}

export function kernelActivity(records: readonly CellRecord[]): KernelActivity {
	let cells = 0;
	let hostCalls = 0;
	const failed = new Set<string>();
	let errorThenSuccess = false;
	for (const record of records) {
		const calls = record.hostCalls ?? [];
		hostCalls += calls.length;
		if ((record.code ?? "").trim().length > 0) cells++;
		for (const call of calls) {
			const failedHere = callFailed(call.result);
			if (failedHere) failed.add(call.name);
			else if (failed.has(call.name)) errorThenSuccess = true;
		}
	}
	return { cells, hostCalls, errorThenSuccess };
}

/** True when a host call's result reads as a failure. */
function callFailed(result: unknown): boolean {
	if (typeof result !== "object" || result === null) return false;
	const record = result as { exit_code?: unknown; error?: unknown };
	if (typeof record.exit_code === "number") return record.exit_code !== 0;
	return typeof record.error === "string" && record.error.length > 0;
}

const MAX_LINES_PER_SECTION = 40;
const MAX_CODE_CHARS = 6_000;
const MAX_CODE_PER_CELL = 1_200;

/**
 * The digest sections a journal contributes, or `undefined` when there is nothing to add —
 * which is the signal to leave the pi-tool digest exactly as it was.
 */
export function buildJournalDigest(records: readonly CellRecord[]): string | undefined {
	if (records.length === 0) return undefined;

	const commands: string[] = [];
	const errors: string[] = [];
	const byName = new Map<string, number>();
	const skillsConsulted = new Set<string>();
	let totalMs = 0;

	for (const record of records) {
		totalMs += typeof record.durationMs === "number" ? record.durationMs : 0;
		for (const call of record.hostCalls ?? []) {
			byName.set(call.name, (byName.get(call.name) ?? 0) + 1);
			if (call.name === "bash_host") {
				const command = call.args?.[0];
				if (typeof command === "string" && command.trim().length > 0) commands.push(command);
				const failure = bashFailure(call.result);
				if (failure) errors.push(`bash: ${failure}`);
			}
			if (call.name === "skill_host") {
				const name = call.args?.[0];
				if (typeof name === "string" && name.length > 0) skillsConsulted.add(name);
			}
		}
	}

	const activity = kernelActivity(records);
	const sections: string[] = [
		`Kernel cells: ${activity.cells} (${(totalMs / 1000).toFixed(1)}s)`,
		`Kernel host calls: ${activity.hostCalls}` +
			(byName.size > 0 ? ` — ${[...byName.entries()].map(([name, count]) => `${name} ${count}`).join(", ")}` : ""),
	];

	if (commands.length > 0) sections.push(...bullets("Commands run in the kernel", commands));
	if (skillsConsulted.size > 0) sections.push(...bullets("Learned skills consulted", [...skillsConsulted]));
	if (errors.length > 0) sections.push(...bullets("Kernel errors", errors));

	// The code is the record of intent for everything the journal cannot see — above all the
	// prelude's file helpers, which run inside monty and reach the host as nothing at all.
	const code = boundedCode(records);
	if (code) {
		sections.push(
			"## Cells as run (the record of intent for in-kernel file writes)",
			"The kernel's own `read_text`/`write_text`/`edit_text` helpers are pure Python inside the",
			"sandbox, so they do not appear as host calls. These are the cells that ran:",
			"```python",
			code,
			"```",
		);
	}
	return sections.join("\n");
}

function boundedCode(records: readonly CellRecord[]): string {
	const blocks: string[] = [];
	let used = 0;
	for (const record of records) {
		const code = (record.code ?? "").trim();
		if (code.length === 0) continue;
		const clipped = code.length > MAX_CODE_PER_CELL ? `${code.slice(0, MAX_CODE_PER_CELL)}\n# ...(cell truncated)` : code;
		if (used + clipped.length > MAX_CODE_CHARS) {
			blocks.push(`# ...and ${records.length - blocks.length} more cell(s), omitted for length`);
			break;
		}
		used += clipped.length;
		blocks.push(`# cell ${record.index}\n${clipped}`);
	}
	return blocks.join("\n\n");
}

/** A bash result that failed, as a one-line reason. */
function bashFailure(result: unknown): string | undefined {
	if (typeof result !== "object" || result === null) return undefined;
	const record = result as { exit_code?: unknown; stderr?: unknown; stdout?: unknown };
	const code = record.exit_code;
	if (typeof code !== "number" || code === 0) return undefined;
	const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
	const detail = stderr.length > 0 ? stderr : typeof record.stdout === "string" ? record.stdout.trim() : "";
	return `exit ${code}${detail ? `: ${excerpt(detail)}` : ""}`;
}

function bullets(heading: string, items: readonly string[]): string[] {
	const shown = items.slice(0, MAX_LINES_PER_SECTION).map((item) => `- ${excerpt(item)}`);
	if (items.length > MAX_LINES_PER_SECTION) shown.push(`- ...and ${items.length - MAX_LINES_PER_SECTION} more`);
	return [`## ${heading}`, ...shown];
}

function excerpt(text: string): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	return collapsed.length > 200 ? `${collapsed.slice(0, 197)}...` : collapsed;
}
