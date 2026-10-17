/** The small shared helpers: four one-line coercions, duplicated from the other packages rather
 * than shared (the contract forbids an import between them, ticket 03, C8), and the one answer to
 * "which process is this pid?" that both the background manager's restore and the foreground
 * record's probe have to give the same way.
 */
import { readFileSync } from "node:fs";

export const str = (value: unknown): string => (value === null || value === undefined ? "" : String(value));
export const num = (value: unknown, fallback: number): number => (typeof value === "number" ? value : fallback);
export const bool = (value: unknown): boolean => value === true;
export const errorText = (value: unknown): string => (value instanceof Error ? value.message : String(value));

/**
 * When a pid's process started, in clock ticks since boot — its identity, not its number.
 *
 * Fixed at fork and preserved across `exec`, which is what makes it the right token: a command line
 * is not (measured, 2026-10-17 — `bash -lc "sleep 60"` exec-optimizes into `cmdline = ["sleep","60"]`,
 * so the most common case would have failed a command-line check).
 *
 * Read from `/proc` rather than by shelling out to `ps`, for the same reason the kills use
 * `process.kill`: this runs at spawn and at restore, and a subprocess there would be a process to reap
 * in order to learn about processes. `null` is *cannot say*, never *not the same process*.
 */
export function readPidStart(pid: number): number | null {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		// The comm field is parenthesised and may itself contain spaces and parens, so count fields
		// from the *last* ")" rather than splitting on whitespace from the front.
		const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
		const starttime = Number(fields[19]);
		return Number.isFinite(starttime) ? starttime : null;
	} catch {
		return null;
	}
}

/**
 * What a recorded pid says about the process now — the one probe both ledgers ask.
 *
 * `process.kill(pid, 0)` is the existence probe: it throws `ESRCH` for a pid nothing holds and `EPERM`
 * for one this user does not own, and *both* mean the recorded process is gone, since every process
 * either ledger records is one this user spawned. A live pid is then matched against the start time
 * recorded when it was spawned; a record with no such token (an older one, or another platform) can
 * only ever be `unverified`.
 */
export function probePid(pid: number | null, pidStart: number | null): "gone" | "live" | "unverified" {
	if (pid === null || pid <= 0) return "gone";
	try {
		process.kill(pid, 0);
	} catch {
		return "gone";
	}
	const actual = readPidStart(pid);
	return pidStart !== null && actual !== null && actual === pidStart ? "live" : "unverified";
}
