/**
 * The ledger: `index.json` inside the learned store.
 *
 * It holds mutable per-skill state (usage counts, last-used, pin, lifecycle
 * state) plus the last pass timestamp. Durable identity lives in each SKILL.md
 * frontmatter instead, so a missing or corrupt ledger is a less-informed view,
 * never a loss of the library.
 *
 * Phase 1 is a stub: read, write and create the file atomically. The
 * `.ledger.lock` mutation path and the telemetry counters arrive in phase 2.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const LEDGER_SCHEMA_VERSION = 1;
export const LEDGER_FILE_NAME = "index.json";

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

export interface Ledger {
	schema_version: number;
	last_pass_at: string | null;
	skills: Record<string, LedgerEntry>;
}

export interface ReadLedgerResult {
	ledger: Ledger;
	warning?: string;
}

export function emptyLedger(): Ledger {
	return { schema_version: LEDGER_SCHEMA_VERSION, last_pass_at: null, skills: {} };
}

export function ledgerPath(root: string): string {
	return path.join(root, LEDGER_FILE_NAME);
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
		const skills = typeof parsed.skills === "object" && parsed.skills !== null && !Array.isArray(parsed.skills) ? parsed.skills : {};
		return {
			ledger: {
				schema_version: typeof parsed.schema_version === "number" ? parsed.schema_version : LEDGER_SCHEMA_VERSION,
				last_pass_at: typeof parsed.last_pass_at === "string" ? parsed.last_pass_at : null,
				skills,
			},
		};
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
