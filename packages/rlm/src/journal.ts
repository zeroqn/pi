/**
 * The kernel journal (ticket 04): the durable record of what ran, and the replay
 * machinery that rebuilds state from it.
 *
 * Deliberately free of pi and monty imports — this is the part of the design that can
 * be reasoned about, and tested, in isolation.
 */
import { appendFileSync, readFileSync } from "node:fs";

/** A host call whose failure is replayed as the same Python exception (ticket 11). */
export type HostCallError = { name: string; message: string };
export type HostCallRecord = { name: string; args: unknown[]; result?: unknown; error?: HostCallError };
export type CellRecord = { index: number; code: string; hostCalls: HostCallRecord[]; durationMs: number; at: string };
export type HostFns = Record<string, (...args: unknown[]) => Promise<unknown>>;
export type RestoreReport = { cells: number; hostCalls: number; partial: boolean; note?: string };

export function appendJournal(path: string, record: CellRecord): void {
	try {
		appendFileSync(path, `${JSON.stringify(record)}\n`);
	} catch {
		// A failed journal write must never fail the cell that succeeded.
	}
}

export function readJournal(path: string): CellRecord[] {
	const records: CellRecord[] = [];
	try {
		for (const line of readFileSync(path, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				records.push(JSON.parse(line) as CellRecord);
			} catch {
				// A torn line is skipped rather than discarding the whole journal.
			}
		}
	} catch {
		// No journal for this session.
	}
	return records;
}

/**
 * The cells to replay, from one or more **session files**, in order.
 *
 * One session is the ordinary case. Two happen when a fork's own journal is a *fragment*:
 * a fork's cells are indexed against the history it inherited, so a fork that has run one
 * cell holds a single record at index 2 — replaying that alone would lose everything it
 * inherited (ticket 13). The parent's prefix (every record below the fragment's first
 * index) is replayed first, then the fragment.
 */
export function readJournals(sessionFiles: string[]): CellRecord[] {
	const lists = sessionFiles.map((file) => readJournal(`${file}.rlm-journal.jsonl`));
	const records: CellRecord[] = [];
	for (let index = 0; index < lists.length; index += 1) {
		const limit = lists[index + 1]?.[0]?.index ?? Number.POSITIVE_INFINITY;
		for (const record of lists[index] ?? []) {
			if (record.index < limit) records.push(record);
		}
	}
	return records;
}

/** What the model is told after a restore. Silence is the failure mode here. */
export function restoredLine(report: RestoreReport): string {
	if (report.partial) {
		return `# kernel partially rebuilt: ${report.note ?? "replay stopped"}; everything defined after that point is missing.`;
	}
	// A dump restore has no host calls to report, so the note is the honest message.
	if (report.note) {
		return `# kernel ${report.note}; values derived from file reads reflect the filesystem as of now.`;
	}
	return `# kernel rebuilt from journal: replayed ${report.cells} cells and ${report.hostCalls} host calls; values derived from file reads reflect the filesystem as of now.`;
}

/** The exception type name monty maps onto a Python exception, with its fallback. */
export function hostCallError(error: unknown): HostCallError {
	if (error instanceof Error) return { name: error.name || "Error", message: error.message };
	// monty only maps a JS error by `.name` (dist/session.js), and a thrown non-error has
	// none, so RuntimeError is what the sandbox saw; record that rather than the value.
	return { name: "RuntimeError", message: String(error) };
}

export function recordingHost(
	host: HostFns,
	record: (name: string, args: unknown[], result: unknown, error?: HostCallError) => void,
): HostFns {
	const wrapped: HostFns = {};
	for (const [name, fn] of Object.entries(host)) {
		const wrapper = async (...args: unknown[]) => {
			// A call that throws is recorded too, and still rethrown: replay re-runs the cell,
			// so a missing record would leave the replay host one call ahead of the code and
			// stop the rebuild (ticket 11).
			try {
				const result = await fn(...args);
				record(name, args, result);
				return result;
			} catch (error) {
				record(name, args, undefined, hostCallError(error));
				throw error;
			}
		};
		// monty identifies a host function by its JS `.name` once the sandbox has read it as a
		// value (ticket 02): an anonymous wrapper binds as the literal '<anonymous>' and every
		// later call through the binding fails with NameError. The sandbox name is the key, so
		// give the wrapper that name (function `.name` is configurable).
		Object.defineProperty(wrapper, "name", { value: name });
		wrapped[name] = wrapper;
	}
	return wrapped;
}

/**
 * Serves recorded host-call results in order. Replay re-executes the same cells,
 * so calls arrive in the same sequence; a mismatch means the journal and the code
 * disagree, which must stop the replay rather than quietly diverge.
 */
export function replayHost(calls: HostCallRecord[]): {
	host: HostFns;
	consumed: () => number;
} {
	let cursor = 0;
	const host: HostFns = {};
	// Serve every name the journal actually recorded (bash_host, bg_list, rlm_spawn, ...), not
	// a hardcoded guess. Each wrapper is named to match its key so that a value read in a
	// replayable cell (h = find) binds under the same name the journal can answer.
	for (const name of new Set(calls.map((call) => call.name))) {
		const replay = async () => {
			const record = calls[cursor];
			if (!record) throw new Error(`journal replay diverged: ${name}() with no recorded call left`);
			if (record.name !== name) throw new Error(`journal replay diverged: expected ${record.name}(), got ${name}()`);
			cursor += 1;
			if (record.error) {
				// Throw the recorded type, so the cell's own try/except behaves as it did live.
				const error = new Error(record.error.message);
				error.name = record.error.name;
				throw error;
			}
			return record.result;
		};
		Object.defineProperty(replay, "name", { value: name });
		host[name] = replay;
	}
	return { host, consumed: () => cursor };
}
