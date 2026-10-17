/**
 * The write-ahead record for **process-owning foreground calls** (2026-10-17).
 *
 * A foreground call is `detached` — its own process group, so the group can be killed as a unit — and
 * it is *turn-owned*: the abort kills it, and the process's own `exit` reaps it. Both of those need a
 * live process, though, and a pi that is SIGKILLed, OOM-killed or crashes runs no code at all: the
 * child is reparented to init and keeps running, holding a machine with nobody left who knows it
 * exists. Measured (`.scratch/bg-lease/REPORT.md`): `sleep 300` under `bash -lc` survives a SIGKILLed
 * parent and is reparented to init.
 *
 * A **background shell** has the same exposure and does not have the same problem, because its handle
 * is journalled with its pid and its pid's start time — which is exactly what lets `restore` probe it
 * in a later session and kill or lease it. A foreground call is journalled only when the cell
 * *returns* (`journalCell` runs after the feed), so a cell killed mid-call leaves no trace of the call
 * or its process: nothing to probe, nothing to end. This file is that missing trace — a start line
 * written immediately after the spawn, a done line when the call returns, and a resolution at the next
 * session's start.
 *
 * Three rules it keeps, each with a reason:
 *
 *  - **A record is a witness, never a promise.** Every read and write here is best-effort: a session
 *    with no session file, or a file that cannot be written, records nothing and the call runs exactly
 *    as it did before. Losing the trace is a smaller failure than failing a call.
 *  - **Only a *verified* stray is killed.** The verdict is `probePid` (`util.ts`) — the same question
 *    `restore` asks about an orphan background shell — and only `live` (pid alive *and* its start time
 *    is the recorded one) is ended. `unverified` is reported and left alone, because the one thing an
 *    unprovable pid must never become is a kill aimed at somebody else's process.
 *  - **A `live` stray is killed rather than leased.** An orphan *background* shell is announced and
 *    left a grace because the model asked for session-owned work and can still read its log; a
 *    foreground call outliving its session is the promise this design does *not* make — "nothing of it
 *    outlives the cell" — and its output died with the pipes, so a lease could buy side effects and
 *    nothing else. It is reported instead, so the model knows what ran and what was ended.
 */
import { appendFileSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { probePid, readPidStart } from "./util";

/** One process a foreground call owns, as it is written down. */
export interface ForegroundRecord {
	pid: number;
	/** Detached, so the child leads its group: the group is the pid, and the kill is `kill(-pid)`. */
	pgid: number;
	pid_start: number | null;
	command: string;
	started_at: string;
}

/** A record from an earlier session that is still open. `live` has been ended; `unverified` has not. */
export interface ForegroundStray {
	record: ForegroundRecord;
	verdict: "live" | "unverified";
}

export interface ForegroundLedger {
	/** Write the start line for a spawned pid, and answer the marker that writes its done line. */
	open(pid: number, command: string): () => void;
	/** Everything still open from an earlier session: probe, kill the verified ones, compact, report. */
	resolve(): ForegroundStray[];
}

export interface ForegroundLedgerOptions {
	/** The file to write, or `""` when this session has nowhere durable to put it (no session file). */
	path: () => string;
}

/**
 * How many appended lines are tolerated before the file is rewritten from memory.
 *
 * A session that makes thousands of calls would otherwise leave two lines each behind for the whole
 * session; the rewrite needs no read, because the only records that must survive it are the ones this
 * process still has open. Bounded, so the file's size is a function of *concurrent* calls and not of
 * the session's length.
 */
const COMPACT_AFTER_LINES = 2000;

export function createForegroundLedger(options: ForegroundLedgerOptions): ForegroundLedger {
	// The identity token is read here rather than injected: `readPidStart` is one function in `util.ts`, and a
	// seam nobody uses is a seam that drifts.
	/** The calls this process has open right now, so a resolution cannot kill its own live work. */
	const active = new Map<number, ForegroundRecord>();
	let appended = 0;

	const append = (line: string): void => {
		const file = options.path();
		if (!file) return;
		try {
			appendFileSync(file, `${line}\n`);
			appended += 1;
			if (appended > COMPACT_AFTER_LINES) rewrite(active);
		} catch {
			// A witness that cannot write is a witness that says nothing; the call runs regardless.
		}
	};

	/** The only records worth keeping: the ones this process still has open. */
	function rewrite(keep: Map<number, ForegroundRecord>): void {
		const file = options.path();
		if (!file) return;
		try {
			const body = [...keep.values()].map((record) => `${JSON.stringify({ t: "start", ...record })}\n`).join("");
			writeFileSync(`${file}.tmp`, body);
			renameSync(`${file}.tmp`, file);
			appended = keep.size;
		} catch {
			try {
				unlinkSync(`${file}.tmp`);
			} catch {
				/* nothing to clean */
			}
		}
	}

	return {
		open(pid: number, command: string): () => void {
			if (pid <= 0) return () => {};
			const record: ForegroundRecord = {
				pid,
				pgid: pid,
				// Read here, at spawn, where the pid is first known: the token the next session's probe
				// compares against, and the only moment it is cheap to read.
				pid_start: readPidStart(pid),
				command: command.slice(0, 200),
				started_at: new Date().toISOString(),
			};
			active.set(pid, record);
			append(JSON.stringify({ t: "start", ...record }));
			return () => {
				if (!active.delete(pid)) return;
				append(JSON.stringify({ t: "done", pid }));
			};
		},

		resolve(): ForegroundStray[] {
			const file = options.path();
			if (!file) return [];
			let lines: string[] = [];
			try {
				lines = readFileSync(file, "utf8").split("\n");
			} catch {
				// No file is the ordinary state of a session that never made a process-owning call.
				return [];
			}
			// Replay in order rather than trusting a set of pids: a done line must cancel the start that
			// preceded it, and a pid reused later in the same file starts a new record.
			const open = new Map<number, ForegroundRecord>();
			for (const line of lines) {
				if (!line) continue;
				let entry: any;
				try {
					entry = JSON.parse(line);
				} catch {
					// A torn last line (a write interrupted by power loss, not by a process death) is skipped:
					// the alternative is refusing to resolve every record behind it.
					continue;
				}
				if (entry?.t === "start" && typeof entry.pid === "number") {
					open.set(entry.pid, {
						pid: entry.pid,
						pgid: typeof entry.pgid === "number" ? entry.pgid : entry.pid,
						pid_start: typeof entry.pid_start === "number" ? entry.pid_start : null,
						command: String(entry.command ?? ""),
						started_at: String(entry.started_at ?? ""),
					});
				} else if (entry?.t === "done" && typeof entry.pid === "number") {
					open.delete(entry.pid);
				}
			}
			const found: ForegroundStray[] = [];
			for (const record of open.values()) {
				// This process's own in-flight calls are not strays: a resumed session in the same process
				// resolves the file while the call it is looking at is still running.
				if (active.has(record.pid)) continue;
				const verdict = probePid(record.pid, record.pid_start);
				if (verdict === "gone") continue;
				if (verdict === "live") killGroup(record.pgid);
				found.push({ record, verdict });
			}
			// Everything unresolved is either ended or reported, so the file is rewritten to hold only what
			// this process still has open — the next session then reads a file about *it*.
			rewrite(active);
			return found;
		},
	};
}

/**
 * End a process group: the group first (the child is detached and leads it), the single pid as a
 * fallback for anything that somehow is not a group leader.
 */
export function killGroup(pgid: number): void {
	try {
		process.kill(-pgid, "SIGKILL");
	} catch {
		try {
			process.kill(pgid, "SIGKILL");
		} catch {
			/* already gone */
		}
	}
}

/**
 * The foreground processes in flight, as kill closures — the in-process half of the same problem
 * (`RunRegistry`'s old job): the process's own `exit` reaps what is still running here
 * (`contract.ts`'s `installExitReaper`), and a mode change or a session end can empty it deliberately.
 */
export type ProcessRegistry = {
	add(kill: () => void): () => void;
	killAll(): void;
};

export function createProcessRegistry(): ProcessRegistry {
	const kills = new Set<() => void>();
	return {
		add(kill) {
			kills.add(kill);
			return () => {
				kills.delete(kill);
			};
		},
		killAll() {
			for (const kill of [...kills]) {
				try {
					kill();
				} catch {
					// One run's failure must not spare the next one's process.
				}
			}
		},
	};
}
