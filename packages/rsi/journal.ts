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
import * as path from "node:path";
import { bashReadCandidates } from "./telemetry.ts";

/** The journal RLM writes beside a session file. */
export function journalPathFor(sessionFile: string | undefined): string | undefined {
	return sessionFile && sessionFile.length > 0 ? `${sessionFile}.rlm-journal.jsonl` : undefined;
}

export interface HostCallRecord {
	name: string;
	args: unknown[];
	/** The call's answer. Absent when the call threw — the journal writes `error` instead. */
	result?: unknown;
	/** A throw from the host function (`{ name, message }`), as RLM records it. */
	error?: unknown;
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
			const failedHere = callFailed(call);
			if (failedHere) failed.add(call.name);
			else if (failed.has(call.name)) errorThenSuccess = true;
		}
	}
	return { cells, hostCalls, errorThenSuccess };
}

/**
 * True when a host call failed. A throwing host function is recorded with `error` *instead of*
 * `result` (`{"name":"skill_host","args":["grilling"],"error":{"name":"Error","message":"…"}}`),
 * so reading `result` alone misses it entirely — which is why this takes the whole record, not
 * just its result. A `result` that reads as a failure (bash's exit code, a tool's own `{ error }`)
 * still counts; a refusal returned as an ordinary `Error: …` string is an answer, not a failure.
 */
function callFailed(call: HostCallRecord): boolean {
	if (call.error !== undefined && call.error !== null) return true;
	const result = call.result;
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
	const bridged: string[] = [];
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
			if (call.name === "tool") {
				const name = toolName(call);
				bridged.push(bridgedCall(name, call.args?.[1]));
				const failure = toolFailure(name, call);
				if (failure) errors.push(`tool: ${failure}`);
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
	if (bridged.length > 0) sections.push(...bullets("Bridged pi tools called", bridged));
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

/** The pi tool a bridged `tool(...)` call reached — `args[0]` — when it named one. */
function toolName(call: HostCallRecord): string | undefined {
	const name = call.args?.[0];
	return typeof name === "string" && name.length > 0 ? name : undefined;
}

/**
 * One bullet for a bridged call: the pi tool reached, then monty's single trailing kwargs object
 * as compact JSON (`tool("ctx_reduce", drop="…")` and `tool("ctx_reduce", {"drop": "…"})` arrive
 * the same way). A name-only call has no second argument and renders as the name alone; the
 * no-argument catalogue call, `await tool()`, renders as `tool()`.
 */
function bridgedCall(name: string | undefined, kwargs: unknown): string {
	const args = isPlainObject(kwargs) ? ` ${JSON.stringify(kwargs)}` : "";
	return `${name ?? "tool()"}${args}`;
}

/**
 * A bridged call that failed, as a one-line reason — or `undefined` when it did not. A throw is
 * recorded as `error` and renders as "threw"; a refusal is an ordinary `result` string starting
 * `Error: ` (by design — `tool-bridge/src/adapter.ts:274-278`) and renders as "answered with an
 * error". The wording stops there deliberately: a tool whose own answer happens to begin with
 * `Error: ` is indistinguishable from a refusal, so the digest must not claim one.
 */
function toolFailure(name: string | undefined, call: HostCallRecord): string | undefined {
	const who = name ?? "tool()";
	if (call.error !== undefined && call.error !== null) {
		return `${who} threw — ${excerpt(errorMessage(call.error))}`;
	}
	const result = call.result;
	if (typeof result === "string" && result.startsWith("Error: ")) {
		return `${who} answered with an error: ${excerpt(result)}`;
	}
	return undefined;
}

/** `{ name, message }` as RLM writes it; anything else stringified. */
function errorMessage(error: unknown): string {
	if (isPlainObject(error)) {
		const message = error.message;
		if (typeof message === "string" && message.length > 0) return message;
	}
	return String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

/** One observation a kernel cell made about a learned skill, in the order the cell recorded it. */
export type JournalConsultation = {
	/** `"skill"` is a `skill(name)` call; `"read"` is a command that reads a skill's file. */
	kind: "skill" | "read";
	/** The skill's name for `"skill"`, or an absolute path for `"read"`. */
	value: string;
};

/**
 * The consultations in cells newer than a cursor, in recorded order.
 *
 * The **order** is what makes this reproduce the live push it replaced. The old path fed the
 * tracker one observation at a time as the cell ran, and the tracker deduped by skill name per turn;
 * pi starts one turn per cell, so a cell's `hostCalls` in recorded order *is* that window, in that
 * order. The caller feeds these to the same tracker, which resolves paths and names and dedupes.
 *
 * Two things the caller must know: a `"read"` value is already absolute (the command's
 * path-looking tokens are resolved against `cwd`, exactly as a `bash` tool call's are), and a cell
 * that died is not in the journal at all, so its consultations are not counted.
 */
export function consultationsSince(
	records: readonly CellRecord[],
	since: string | null,
	cwd: string,
): JournalConsultation[] {
	const out: JournalConsultation[] = [];
	for (const record of records) {
		if (since && !((record.at ?? "") > since)) continue;
		for (const call of record.hostCalls ?? []) {
			if (call.name === "skill_host") {
				const name = call.args?.[0];
				if (typeof name === "string" && name.length > 0) out.push({ kind: "skill", value: name });
				continue;
			}
			if (call.name === "bash_host") {
				const command = call.args?.[0];
				if (typeof command !== "string") continue;
				for (const candidate of bashReadCandidates(command)) {
					if (candidate.length === 0) continue;
					out.push({ kind: "read", value: path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate) });
				}
			}
		}
	}
	return out;
}
