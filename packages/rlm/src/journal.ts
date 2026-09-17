/**
 * The kernel journal (ticket 04): the durable record of what ran, and the replay
 * machinery that rebuilds state from it.
 *
 * Deliberately free of pi and monty imports — this is the part of the design that can
 * be reasoned about, and tested, in isolation.
 */
import { appendFileSync, readFileSync } from "node:fs";

export type HostCallRecord = { name: string; args: unknown[]; result: unknown };
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

export function recordingHost(host: HostFns, record: (name: string, args: unknown[], result: unknown) => void): HostFns {
	const wrapped: HostFns = {};
	for (const [name, fn] of Object.entries(host)) {
		const wrapper = async (...args: unknown[]) => {
			const result = await fn(...args);
			record(name, args, result);
			return result;
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
			return record.result;
		};
		Object.defineProperty(replay, "name", { value: name });
		host[name] = replay;
	}
	return { host, consumed: () => cursor };
}
