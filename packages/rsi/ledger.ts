/**
 * The ledger: `index.json` inside the learned store.
 *
 * It holds mutable per-skill state (usage counts, last-used, pin, lifecycle
 * state) plus the last pass timestamp. Durable identity lives in each SKILL.md
 * frontmatter instead, so a missing or corrupt ledger is a less-informed view,
 * never a loss of the library.
 *
 * Every mutation takes `rsi/.ledger.lock` — deliberately not the pass `.lock`,
 * so a minutes-long pass never blocks recording — and replaces the file via a
 * temp sibling and an atomic rename. The lock is held for milliseconds.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export const LEDGER_SCHEMA_VERSION = 1;
export const LEDGER_FILE_NAME = "index.json";
export const LEDGER_LOCK_FILE_NAME = ".ledger.lock";

/** How long to wait for a contended ledger lock before dropping the mutation. */
const LOCK_TIMEOUT_MS = 2_000;
/** A lock file older than this is presumed abandoned and reclaimed. */
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 20;

export interface LedgerEntry {
	first_seen_at?: string;
	last_used_at?: string;
	use_count?: number;
	read_count?: number;
	patch_count?: number;
	pinned?: boolean;
	state?: "active" | "archived";
	scope?: string;
}

/** The counters `/rsi status` opens with, so it can show a since-last-look delta. */
export interface StatusCounts {
	skills: number;
	uses: number;
	neverUsed: number;
}

export interface Ledger {
	schema_version: number;
	/**
	 * The **tree-wide floor**: the last time *any* pass ran, whatever session ran it. Kept from
	 * the single-learner design and now doing a different job — it caps how often a whole tree of
	 * sessions can fork reviewers, so ten children finishing together cannot spend ten forks in a
	 * minute (RSI x RLM ticket 12).
	 */
	last_pass_at: string | null;
	/**
	 * Each session's own interval stamp, keyed by session file. A session's pass no longer
	 * consumes another session's interval — which as shipped it did, throttling a tree of N
	 * learners to one pass per interval in total.
	 *
	 * `last_counted_at` is the **counting cursor** and a separate field on purpose: it is advanced
	 * by the settle-time pull rather than by a pass, so counting is independent of the interval
	 * clock and of a pass's rollback (RSI, one-way map ticket 11).
	 */
	sessions?: Record<string, { last_pass_at?: string; last_counted_at?: string }>;
	skills: Record<string, LedgerEntry>;
	last_status_at?: string;
	last_status?: StatusCounts;
	/** Last consolidation pass, for the curator's own cadence. */
	last_curate_at?: string;
}

export interface ReadLedgerResult {
	ledger: Ledger;
	warning?: string;
}

export type UsageKind = "read" | "expansion";

export interface UsageRecord {
	skill: string;
	/** `"general"` or a project key; a mirror of the authoritative frontmatter. */
	scope: string;
	kind: UsageKind;
	/** Injectable clock for tests. */
	at?: string;
}

export function emptyLedger(): Ledger {
	return { schema_version: LEDGER_SCHEMA_VERSION, last_pass_at: null, skills: {} };
}

export function ledgerPath(root: string): string {
	return path.join(root, LEDGER_FILE_NAME);
}

export function ledgerLockPath(root: string): string {
	return path.join(root, LEDGER_LOCK_FILE_NAME);
}

/** Read the ledger; missing is empty and corrupt is empty-with-a-warning. */
export function readLedger(root: string): ReadLedgerResult {
	const file = ledgerPath(root);
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch {
		return { ledger: emptyLedger() };
	}
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			throw new Error("expected a JSON object");
		}
		const ledger: Ledger = {
			schema_version: typeof parsed.schema_version === "number" ? parsed.schema_version : LEDGER_SCHEMA_VERSION,
			last_pass_at: typeof parsed.last_pass_at === "string" ? parsed.last_pass_at : null,
			skills: isPlainObject(parsed.skills) ? (parsed.skills as Record<string, LedgerEntry>) : {},
		};
		if (typeof parsed.last_status_at === "string") ledger.last_status_at = parsed.last_status_at;
		if (isStatusCounts(parsed.last_status)) ledger.last_status = parsed.last_status;
		if (typeof parsed.last_curate_at === "string") ledger.last_curate_at = parsed.last_curate_at;
		if (isPlainObject(parsed.sessions)) ledger.sessions = parsed.sessions as Ledger["sessions"];
		return { ledger };
	} catch (error) {
		return {
			ledger: emptyLedger(),
			warning: `rsi: ignoring corrupt ledger ${file} (${error instanceof Error ? error.message : String(error)})`,
		};
	}
}

/** Replace the ledger via a temp sibling and an atomic rename. */
export function writeLedger(root: string, ledger: Ledger): void {
	fs.mkdirSync(root, { recursive: true });
	const file = ledgerPath(root);
	const temp = path.join(root, `.index.json.${process.pid}.${Date.now()}.tmp`);
	fs.writeFileSync(temp, `${JSON.stringify(ledger, null, 2)}\n`);
	fs.renameSync(temp, file);
}

/** Create an empty ledger when none exists. Returns true when it wrote one. */
export function ensureLedger(root: string): boolean {
	if (fs.existsSync(ledgerPath(root))) return false;
	writeLedger(root, emptyLedger());
	return true;
}

/**
 * Run `fn` with the ledger lock held. Exclusive-create is the lock; a stale
 * file (older than {@link LOCK_STALE_MS}) is reclaimed. Returns `undefined`
 * rather than throwing when the lock cannot be taken in time: losing one usage
 * count is better than surfacing an error from a background observation.
 */
export async function withLedgerLock<T>(root: string, fn: () => T): Promise<T | undefined> {
	fs.mkdirSync(root, { recursive: true });
	const lockPath = ledgerLockPath(root);
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	let attempt = 0;

	for (;;) {
		if (attempt > 0 && Date.now() >= deadline) return undefined;
		attempt++;

		let fd: number | undefined;
		try {
			fd = fs.openSync(lockPath, "wx");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		if (fd !== undefined) {
			try {
				fs.writeSync(fd, `${process.pid} ${Date.now()}\n`);
				return fn();
			} finally {
				fs.closeSync(fd);
				removeQuietly(lockPath);
			}
		}

		const stale = isStaleLock(lockPath);
		if (stale === true) {
			removeQuietly(lockPath);
			continue;
		}
		if (stale === undefined) continue; // the lock vanished; retry at once
		await sleep(LOCK_RETRY_MS);
	}
}

/**
 * Record one usage observation. A read moves both counters; a `/skill:name`
 * expansion moves only `use_count`. Every use resets the disuse clock.
 */
/** Fold one consultation into the ledger's counters. Shared, so the two writers cannot drift. */
function applyUsage(ledger: Ledger, usage: UsageRecord, at: string): void {
	const entry = ledger.skills[usage.skill] ?? {};
	entry.first_seen_at ??= at;
	entry.last_used_at = at;
	entry.use_count = (entry.use_count ?? 0) + 1;
	if (usage.kind === "read") entry.read_count = (entry.read_count ?? 0) + 1;
	entry.scope = usage.scope;
	entry.state ??= "active";
	ledger.skills[usage.skill] = entry;
}

export async function recordUsage(root: string, usage: UsageRecord): Promise<boolean> {
	const written = await withLedgerLock(root, () => {
		const { ledger } = readLedger(root);
		applyUsage(ledger, usage, usage.at ?? new Date().toISOString());
		writeLedger(root, ledger);
		return true;
	});
	return written ?? false;
}

/** This session's counting cursor, or `null` when it has never counted anything. */
export function sessionCountedAt(ledger: Ledger, sessionFile: string | undefined): string | null {
	if (!sessionFile) return null;
	return ledger.sessions?.[sessionFile]?.last_counted_at ?? null;
}

/**
 * Record one turn's consultations **and** advance the session's cursor, in a single locked write.
 *
 * One write rather than two, and that is the whole of the idempotency: there is no window in which
 * the counts are durable and the cursor is not, so a crash between them cannot double-count. The
 * cursor is advanced whenever the caller has seen cells, even when they consulted nothing — a cell
 * already read must not be read again next turn.
 */
export async function recordCountedUsage(
	root: string,
	input: { sessionFile?: string; at: string; usages: readonly UsageRecord[] },
): Promise<boolean> {
	const written = await withLedgerLock(root, () => {
		const { ledger } = readLedger(root);
		for (const usage of input.usages) applyUsage(ledger, usage, usage.at ?? input.at);
		if (input.sessionFile) {
			const sessions = ledger.sessions ?? (ledger.sessions = {});
			const entry = sessions[input.sessionFile] ?? (sessions[input.sessionFile] = {});
			entry.last_counted_at = input.at;
		}
		writeLedger(root, ledger);
		return true;
	});
	return written ?? false;
}

/**
 * Record that a skill exists without counting a use: called when the learner
 * publishes one, so the ledger knows it before it is ever read.
 */
export async function ensureSkillEntry(root: string, entry: { name: string; scope: string; at?: string }): Promise<boolean> {
	const written = await withLedgerLock(root, () => {
		const { ledger } = readLedger(root);
		const existing = ledger.skills[entry.name] ?? {};
		existing.first_seen_at ??= entry.at ?? new Date().toISOString();
		existing.scope = entry.scope;
		existing.state ??= "active";
		ledger.skills[entry.name] = existing;
		writeLedger(root, ledger);
		return true;
	});
	return written ?? false;
}

/** Mark a skill active or archived in the ledger after a store move. */
export async function setSkillState(root: string, name: string, state: "active" | "archived"): Promise<boolean> {
	const written = await withLedgerLock(root, () => {
		const { ledger } = readLedger(root);
		const entry = ledger.skills[name] ?? {};
		entry.state = state;
		ledger.skills[name] = entry;
		writeLedger(root, ledger);
		return true;
	});
	return written ?? false;
}

export interface StatusSnapshot {
	previous?: StatusCounts;
	lastStatusAt?: string;
}

/** Advance the curator's cadence clock, or roll it back after a pass that did nothing. */
export async function setLastCurateAt(root: string, at: string | null): Promise<boolean> {
	const written = await withLedgerLock(root, () => {
		const { ledger } = readLedger(root);
		if (at === null) delete ledger.last_curate_at;
		else ledger.last_curate_at = at;
		writeLedger(root, ledger);
		return true;
	});
	return written ?? false;
}

/**
 * Advance the interval clock at the start of a pass, or roll it back when a
 * pass errored without doing any work so the next settle can retry.
 */
export async function setLastPassAt(root: string, at: string | null): Promise<boolean> {
	const written = await withLedgerLock(root, () => {
		const { ledger } = readLedger(root);
		ledger.last_pass_at = at;
		writeLedger(root, ledger);
		return true;
	});
	return written ?? false;
}

/** This session's own interval stamp, or `null` when it has never run a pass. */
export function sessionPassAt(ledger: Ledger, sessionFile: string | undefined): string | null {
	if (!sessionFile) return null;
	return ledger.sessions?.[sessionFile]?.last_pass_at ?? null;
}

/**
 * Advance this session's interval stamp, or roll it back after a pass that errored without
 * doing any work so the session can retry (RSI x RLM ticket 12). The tree-wide floor is
 * deliberately **not** rolled back: a pass did run, and the floor records that fact.
 */
export async function setSessionPassAt(root: string, sessionFile: string | undefined, at: string | null): Promise<boolean> {
	if (!sessionFile) return false;
	const written = await withLedgerLock(root, () => {
		const { ledger } = readLedger(root);
		const sessions = ledger.sessions ?? (ledger.sessions = {});
		const entry = sessions[sessionFile] ?? (sessions[sessionFile] = {});
		if (at === null) delete entry.last_pass_at;
		else entry.last_pass_at = at;
		writeLedger(root, ledger);
		return true;
	});
	return written ?? false;
}

/**
 * Store the counters just shown and return the previous look, so `/rsi status`
 * can open with a delta. Returns `undefined` when the lock was not available.
 */
export async function takeStatusSnapshot(root: string, current: StatusCounts, at?: string): Promise<StatusSnapshot | undefined> {
	return withLedgerLock(root, () => {
		const { ledger } = readLedger(root);
		const previous = ledger.last_status;
		const lastStatusAt = ledger.last_status_at;
		ledger.last_status = current;
		ledger.last_status_at = at ?? new Date().toISOString();
		writeLedger(root, ledger);
		return { previous, lastStatusAt };
	});
}

function isStaleLock(lockPath: string): boolean | undefined {
	try {
		return Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS;
	} catch {
		// The lock disappeared between the failed create and the stat.
		return undefined;
	}
}

function removeQuietly(target: string): void {
	try {
		fs.unlinkSync(target);
	} catch {
		// Already gone, or not ours to remove.
	}
}

function isStatusCounts(value: unknown): value is StatusCounts {
	return (
		isPlainObject(value) &&
		typeof value.skills === "number" &&
		typeof value.uses === "number" &&
		typeof value.neverUsed === "number"
	);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
