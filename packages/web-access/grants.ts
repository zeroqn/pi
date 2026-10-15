/**
 * The ssh grant — the routes a session holds a destination by, the project declaration it may read,
 * and the live state the egress policy reads at each call (`.scratch/ssh-grant` ticket 06; ticket 12
 * parts C and D).
 *
 * ## Why this is not in `host.ts`
 *
 * `host.ts` is the pi **entry** and the host-bridge contributor, and both need this state: the entry
 * registers `/ssh-grant` and reads the project file at `session_start`, while the contributor's
 * closure is what the kernel calls. The state lives in a `Symbol.for` process global rather than a
 * module variable, because pi loads an entry through its own jiti instance (`moduleCache: false`) and
 * a module-level `Map` would be written by one instance and read as empty by the other
 * (`host-bridge/src/convention.ts:10-28` measures the same defect).
 *
 * ## The shape (ticket 06 §6, built so ticket 07 part D can extend it)
 *
 * One record per session key, holding `grants` (a route and a `when` per destination key), `denials`
 * (a remembered `No`), the project declaration, and whether the session's code mode can honour a
 * grant at all. The policy reads the record **live** at every call: `composeSession` runs once per
 * session, so a snapshot would freeze the allowlist before any grant existed (map fact 2).
 *
 * Part D adds, around this record and without reshaping it:
 *   - the **writes** — `pi.appendEntry("ssh-grant", …)` on every change and
 *     `appendCustomEntry("ssh-grant-inherited", …)` into a child's own transcript (this module already
 *     *reads* both kinds in {@link readGrantEntries});
 *   - the **child floor** — a `Symbol.for("pi-ssh-grant:floors")` thunk into the spawner's *effective*
 *     state, which {@link childView} resolves for a child and {@link heldKeysOf} judges;
 *   - the **7-day idle window** on restored `ask`/`command` grants and the revoke's propagation.
 * `--revoke` of a project-declared key records the override as a **denial** rather than editing the
 * file: the declaration still stands and still asks, but the denial keeps the key out of `heldKeys`
 * where nobody can be asked, and ticket 07's persisted entry is what makes the override survive a
 * resume (the file is re-read at each session start, so an in-memory filter would be undone).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describeAge } from "./egress";

/** The grant's text rule, re-exported here because this package's tests reach it at this path. */
export { redirectsOrTees } from "./command-rules";

/** The contract version whose egress verdict can allow a call *and* fence its result (ticket 04). */
export const FENCE_API_VERSION = 5;

/** The two entry kinds ticket 07 writes; this module reads them (newest of each kind wins). */
export const SSH_GRANT_ENTRY = "ssh-grant";
export const SSH_GRANT_INHERITED_ENTRY = "ssh-grant-inherited";

/** The third route's file, read once at session start from the walk-up below. */
export const PROJECT_FILE = ".pi/ssh-grant.json";

/** The ask's timeout in **milliseconds** (ticket 05's trap; readonly-mode's `60_000` precedent). */
export const ASK_TIMEOUT_MS = 60_000;

/**
 * The idle window: a restored `ask`/`command` grant older than this is a **declaration, not a grant**
 * (ticket 07 §3). The number is skill-bridge's `PRUNE_AFTER_MS` (`packages/skill-bridge/index.ts:49`)
 * — the repo's existing "how old is too old" constant, reused rather than re-invented.
 */
export const GRANT_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

/** The window in whole days, for the sentences that name it (7). */
export const GRANT_IDLE_DAYS = Math.round(GRANT_IDLE_MS / (24 * 60 * 60 * 1000));

/** Where the per-session records live. A `Symbol.for` because a child's load is a second instance. */
export const RECORDS_KEY = Symbol.for("pi-ssh-grant:records");

/**
 * Where a spawner's **live** floor lives, keyed by the child's resolved session file (ticket 07 §5).
 *
 * A `Symbol.for` for the same reason `RECORDS_KEY` is: a child's load of an entry is a different
 * module instance, so a module-level map would be written by the spawner and read as empty by the
 * child. The value is a **thunk**, never a copy, so a revoke in the spawner reaches the child on its
 * next call and a grant made after a refusal is visible to the retry (ticket 11's escalation).
 */
export const FLOORS_KEY = Symbol.for("pi-ssh-grant:floors");

export type GrantRoute = "ask" | "command" | "project";

/** One grant: the route that gave it, and when (`ask`/`command` carry `at`; `project` does not). */
export type Grant = { route: GrantRoute; at?: number };

/** What one entry kind carries. Ticket 07's shape: `{grants:[{key,route,at}], denials:[{key,at}]}`. */
export type GrantEntryState = { grants: Map<string, Grant>; denials: Set<string>; deniedAt?: Map<string, number> };

/** The grants, denials and project a held-key view reads: a record, a floor, or a marker's state. */
export type GrantView = { grants: Map<string, Grant>; denials: Set<string>; project: ProjectDeclaration | null };

/** A project's declaration: the file's path and the keys it listed. */
export type ProjectDeclaration = { path: string; keys: string[] };

/** Everything one session's egress policy needs to read, live. */
export type SshGrantState = {
	grants: Map<string, Grant>;
	denials: Set<string>;
	/** When each denial was made, so the persisted `{key, at}` is honest (denials are never aged). */
	deniedAt: Map<string, number>;
	project: ProjectDeclaration | null;
	/** Whether the project was trusted, so a no-dialog refusal can say which reason applies. */
	projectTrusted: boolean;
	/**
	 * The writer installed by {@link installSshGrant}: `pi.appendEntry(SSH_GRANT_ENTRY, …)`. It is
	 * absent in a session whose host cannot write entries (or in a plain test). Every mutation calls it
	 * through {@link persistGrantState}, which is best-effort: a failed write must not fail the call
	 * that triggered it.
	 */
	persist?: () => void;
	/** Whether this session's code mode can honour a grant (`/ssh-grant` reports on this). */
	ready: boolean;
	/** Why it cannot, when it cannot. */
	reason?: string;
	/** The child marker ticket 07 wrote, read but **not** applied here — part D owns the floor. */
	inherited: GrantEntryState | null;
};

/** The session shape a policy decision needs; a contributor builds it once, per session. */
export type GrantSession = {
	/** The session key the record is filed under (the kernel's key, ticket 02). */
	sessionKey: string;
	/** pi's session context: `hasUI`, `ui.confirm`, `signal` and `isProjectTrusted()` are read from it. */
	ctx: unknown;
	/** True when this session was spawned by another (a child has no dialog at all). */
	isChild: boolean;
};

// ---------------------------------------------------------------------------
// The process global: one record per session key.
// ---------------------------------------------------------------------------

function records(): Map<string, SshGrantState> {
	const holder = globalThis as Record<symbol, unknown>;
	const existing = holder[RECORDS_KEY];
	if (existing instanceof Map) return existing as Map<string, SshGrantState>;
	const created = new Map<string, SshGrantState>();
	holder[RECORDS_KEY] = created;
	return created;
}

/** This session's record, or `undefined` before `session_start` (or `webAccessAnswer`) made one. */
export function grantRecord(sessionKey: string): SshGrantState | undefined {
	return records().get(sessionKey);
}

/** This session's record, created empty if it has none. */
export function ensureGrantRecord(sessionKey: string): SshGrantState {
	const existing = records().get(sessionKey);
	if (existing !== undefined) return existing;
	const created: SshGrantState = {
		grants: new Map(),
		denials: new Set(),
		deniedAt: new Map(),
		project: null,
		projectTrusted: false,
		ready: false,
		reason: "this session has no web-access egress policy yet",
		inherited: null,
	};
	records().set(sessionKey, created);
	return created;
}

/** A session that ends takes its record with it; `globalThis` outlives `/new`, resume and fork. */
export function forgetGrantRecord(sessionKey: string): void {
	records().delete(sessionKey);
}

/** Test seam: forget every record this process holds. */
export function __resetGrantRecordsForTests(): void {
	records().clear();
}

// ---------------------------------------------------------------------------
// The live floor, the marker and the persisted entry (ticket 07 §1, §3, §5).
// ---------------------------------------------------------------------------

/**
 * The floors: a child's session file -> a **live thunk** into its spawner's effective grants.
 *
 * {@link effectiveView} resolves a grandchild too: the thunk bound for a child calls `effectiveView`
 * on its parent, which consults *that* parent's floor first — so an inheritance is a chain of live
 * reads, never a snapshot taken at spawn.
 */
function floors(): Map<string, () => GrantView | undefined> {
	const holder = globalThis as Record<symbol, unknown>;
	const existing = holder[FLOORS_KEY];
	if (existing instanceof Map) return existing as Map<string, () => GrantView | undefined>;
	const created = new Map<string, () => GrantView | undefined>();
	holder[FLOORS_KEY] = created;
	return created;
}

/** Test seam: forget every floor this process holds. */
export function __resetGrantFloorsForTests(): void {
	floors().clear();
}

/**
 * A session's **effective** grants, denials and project: its own record, or its spawner's through a
 * floor. `undefined` means no record and no floor — a child whose marker is the only carrier, or a
 * session before `session_start` made one.
 */
/**
 * The live floor bound for a child session, or `undefined` when this child has none.
 *
 * `policy.ts`'s `childView` reads it: the floor is a **thunk** into the spawner's state, so a revocation
 * propagates to the child's next call (ticket 07 §5).
 */
export function grantFloor(childSessionFile: string): (() => GrantView | undefined) | undefined {
	return floors().get(childSessionFile);
}

export function effectiveView(sessionKey: string): GrantView | undefined {
	const floor = floors().get(sessionKey);
	if (floor !== undefined) return floor();
	const state = records().get(sessionKey);
	if (state === undefined) return undefined;
	return { grants: state.grants, denials: state.denials, project: state.project };
}

/** Bind a child session file to its spawner's live effective state (host-bridge's `bindChild`). */
export function bindGrantFloor(childSessionFile: string, parentSessionFile: string): void {
	let childKey: string;
	let parentKey: string;
	try {
		childKey = resolve(childSessionFile);
		parentKey = resolve(parentSessionFile);
	} catch {
		return;
	}
	floors().set(childKey, () => effectiveView(parentKey));
}

/** The entry data in ticket 07's shape — the exact JSON `readGrantEntries`/`entryStateFrom` read. */
export function serializeGrantState(state: {
	grants: Map<string, Grant>;
	denials: Set<string>;
	deniedAt?: Map<string, number>;
}): {
	grants: { key: string; route: GrantRoute; at?: number }[];
	denials: { key: string; at: number }[];
} {
	const grants = [...state.grants].map(([key, grant]) => ({
		key,
		route: grant.route,
		...(grant.at !== undefined ? { at: grant.at } : {}),
	}));
	const now = Date.now();
	const denials = [...state.denials].map((key) => ({ key, at: state.deniedAt?.get(key) ?? now }));
	return { grants, denials };
}

/**
 * Write this session's state to its transcript (ticket 07 §1). Every mutation calls this.
 *
 * Best-effort by design: the state change *is* the grant, and a transcript that cannot take the entry
 * (no `pi`, a host without `appendEntry`, a disposed ctx) loses only the *resume*, never the call that
 * triggered the write. A failure is swallowed rather than thrown — the policy must not fail a cell
 * because a bookkeeping write did.
 */
export function persistGrantState(state: SshGrantState): void {
	if (state.persist === undefined) return;
	try {
		state.persist();
	} catch {
		/* a failed write must not fail the call that triggered it */
	}
}

// ---------------------------------------------------------------------------
// Reading the entries ticket 07 writes (part C reads them; part D writes them).
// ---------------------------------------------------------------------------

function routeOf(value: unknown): GrantRoute {
	return value === "command" || value === "project" ? value : "ask";
}

function entryStateFrom(data: unknown): GrantEntryState {
	const grants = new Map<string, Grant>();
	const denials = new Set<string>();
	const deniedAt = new Map<string, number>();
	const record = data as { grants?: unknown; denials?: unknown } | null;
	if (Array.isArray(record?.grants)) {
		for (const raw of record.grants) {
			const entry = raw as { key?: unknown; route?: unknown; at?: unknown } | null;
			if (typeof entry?.key === "string" && entry.key.length > 0) {
				grants.set(entry.key, { route: routeOf(entry.route), at: typeof entry.at === "number" ? entry.at : undefined });
			}
		}
	}
	if (Array.isArray(record?.denials)) {
		for (const raw of record.denials) {
			const entry = raw as { key?: unknown; at?: unknown } | null;
			if (typeof entry?.key === "string" && entry.key.length > 0) {
				denials.add(entry.key);
				if (typeof entry.at === "number") deniedAt.set(entry.key, entry.at);
			}
		}
	}
	return { grants, denials, deniedAt };
}

/**
 * Walk a session's entries backwards and take the newest of each kind (ticket 07 §1).
 *
 * The two kinds are read independently: a child can carry both the declaration it was spawned under
 * and a decision it made itself afterwards. `own` is this session's own grants/denials; `inherited`
 * is the spawner's marker, which part D applies.
 */
export function readGrantEntries(entries: readonly unknown[]): {
	own: GrantEntryState | null;
	inherited: GrantEntryState | null;
} {
	let own: GrantEntryState | null = null;
	let inherited: GrantEntryState | null = null;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index] as { type?: unknown; customType?: unknown; data?: unknown } | null;
		if (entry?.type !== "custom") continue;
		if (entry.customType === SSH_GRANT_ENTRY && own === null) own = entryStateFrom(entry.data);
		if (entry.customType === SSH_GRANT_INHERITED_ENTRY && inherited === null) inherited = entryStateFrom(entry.data);
	}
	return { own, inherited };
}

// ---------------------------------------------------------------------------
// The project file (ticket 06 §2): walk up to the nearest VCS root, read trusted only.
// ---------------------------------------------------------------------------

/**
 * The nearest `.pi/ssh-grant.json` from `cwd` up, stopping at the nearest directory holding `.git`.
 *
 * Stopping at the VCS root is load-bearing rather than tidy: without it a walk from a deep path
 * would eventually find `~/.pi/ssh-grant.json`, a *host* declaration wearing a project's name — the
 * exact scope leak the host-scoped option was rejected for. The nearest file wins, so a monorepo's
 * nested declaration is the one that applies.
 */
export function findProjectFile(cwd: string): string | null {
	let dir: string;
	try {
		dir = resolve(cwd);
	} catch {
		return null;
	}
	for (;;) {
		try {
			if (existsSync(join(dir, PROJECT_FILE))) return join(dir, PROJECT_FILE);
		} catch {
			return null;
		}
		if (existsSync(join(dir, ".git"))) return null;
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/** Parse a `.pi/ssh-grant.json` body: `{"grants": ["dev@build-box"]}` and nothing else. */
export function parseDeclaration(raw: unknown): { keys: string[]; problems: string[] } {
	const problems: string[] = [];
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return { keys: [], problems: [`ssh-grant: ${PROJECT_FILE} must be a JSON object with a "grants" list`] };
	}
	const record = raw as Record<string, unknown>;
	for (const field of Object.keys(record)) {
		if (field !== "grants") problems.push(`ssh-grant: ${PROJECT_FILE} has an unknown field "${field}" (only "grants" is read)`);
	}
	const listed = record.grants;
	if (!Array.isArray(listed)) {
		problems.push(`ssh-grant: ${PROJECT_FILE} has no "grants" list`);
		return { keys: [], problems };
	}
	const keys: string[] = [];
	const seen = new Set<string>();
	listed.forEach((entry, index) => {
		if (typeof entry !== "string" || entry.trim() === "") {
			problems.push(`ssh-grant: grants[${index}] in ${PROJECT_FILE} is not a destination key string`);
			return;
		}
		const key = entry.trim();
		if (seen.has(key)) return;
		seen.add(key);
		keys.push(key);
	});
	return { keys, problems };
}

/** Read and parse one declaration file. A file that cannot be read is one loud problem, not a throw. */
export function readProjectFile(path: string): { keys: string[]; problems: string[] } {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		const why = error instanceof Error ? error.message : String(error);
		return { keys: [], problems: [`ssh-grant: ${path} is not readable JSON — ${why}`] };
	}
	return parseDeclaration(raw);
}

// ---------------------------------------------------------------------------
// The session context readers, defensive because `ctx` is `unknown` here.
// ---------------------------------------------------------------------------

export function hasUi(ctx: unknown): boolean {
	try {
		return (ctx as { hasUI?: unknown } | null)?.hasUI === true;
	} catch {
		return false;
	}
}

function isTrusted(ctx: unknown): boolean {
	try {
		return (ctx as { isProjectTrusted?: () => boolean } | null)?.isProjectTrusted?.() === true;
	} catch {
		return false;
	}
}

function sessionCwd(ctx: unknown): string | undefined {
	try {
		const cwd = (ctx as { cwd?: unknown } | null)?.cwd;
		return typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;
	} catch {
		return undefined;
	}
}

export function signalOf(ctx: unknown): AbortSignal | undefined {
	try {
		const signal = (ctx as { signal?: unknown } | null)?.signal;
		return signal instanceof AbortSignal ? signal : undefined;
	} catch {
		return undefined;
	}
}

export function uiOf(ctx: unknown): { confirm?: unknown; notify?: unknown } | null {
	try {
		const ui = (ctx as { ui?: unknown } | null)?.ui;
		return ui !== null && typeof ui === "object" ? (ui as { confirm?: unknown; notify?: unknown }) : null;
	} catch {
		return null;
	}
}

function notify(ctx: unknown, text: string, kind?: string): void {
	try {
		const ui = uiOf(ctx);
		if (typeof ui?.notify === "function") (ui.notify as (text: string, kind?: string) => void)(text, kind);
	} catch {
		/* a notice must never fail the command or a session start */
	}
}

// ---------------------------------------------------------------------------
// The live grant view the policy reads.
// ---------------------------------------------------------------------------

/** Whether a restored `ask`/`command` grant has outlived the idle window (ticket 07 §3). */
export function isStaleGrant(grant: Grant, now = Date.now()): boolean {
	return grant.route !== "project" && grant.at !== undefined && now - grant.at > GRANT_IDLE_MS;
}

/**
 * The keys a view may reach right now.
 *
 * `ask`/`command` grants count while they are **fresh**; a restored one past the idle window is a
 * declaration, not a grant, so it is left out and the call is refused — or re-asked, where a dialog
 * can appear (the policy handles that). A **project declaration** counts only where nobody can be
 * asked: where a dialog can appear the first use still asks (ticket 06 §2), so the declaration is
 * not silently authoritative there. Project keys carry no age (the file is read fresh each start).
 */
export function heldKeysOf(view: GrantView, dialogCapable: boolean): Set<string> {
	const held = new Set<string>();
	for (const [key, grant] of view.grants) if (!isStaleGrant(grant)) held.add(key);
	if (!dialogCapable && view.project !== null) {
		for (const key of view.project.keys) if (!view.denials.has(key)) held.add(key);
	}
	return held;
}

/** The held-key view of one record; kept for the callers part C built. */
export function heldKeys(state: SshGrantState, dialogCapable: boolean): Set<string> {
	return heldKeysOf(state, dialogCapable);
}

// ---------------------------------------------------------------------------
// The routes: /ssh-grant, and the session-start read.
// ---------------------------------------------------------------------------

function listText(state: SshGrantState): string {
	const lines: string[] = [];
	const seen = new Set<string>();
	for (const [key, grant] of state.grants) {
		const when = grant.at !== undefined ? `, granted ${new Date(grant.at).toISOString()}` : "";
		const stale = isStaleGrant(grant) ? `, stale (${describeAge(grant.at as number)} old — it will re-ask)` : "";
		lines.push(`${key} — route ${grant.route}${when}${stale}${state.denials.has(key) ? ", denied this session" : ""}`);
		seen.add(key);
	}
	for (const key of state.project?.keys ?? []) {
		if (seen.has(key)) continue;
		lines.push(`${key} — route project (declared in ${PROJECT_FILE}; asks on first use)${state.denials.has(key) ? ", denied this session" : ""}`);
		seen.add(key);
	}
	for (const key of state.denials) {
		if (!seen.has(key)) lines.push(`${key} — denied this session`);
	}
	if (lines.length === 0) return `ssh-grant: this session holds no grants, and ${PROJECT_FILE} declares none.`;
	return `ssh-grant: this session holds\n${lines.join("\n")}`;
}

/**
 * `/ssh-grant <key>` grants, `/ssh-grant` lists, `/ssh-grant --revoke <key>` revokes and clears a
 * denial. A session whose policy cannot hold state (no code mode, or a code mode below contract 5)
 * is told so rather than appearing to work (ticket 06 §3).
 */
export async function sshGrantCommand(args: string, ctx: unknown, sessionKey: string): Promise<void> {
	const state = ensureGrantRecord(sessionKey);
	if (!state.ready) {
		notify(ctx, `ssh-grant: this session cannot hold a grant — ${state.reason ?? "it has no egress policy"}.`, "warning");
		return;
	}
	const tokens = args.trim().split(/\s+/).filter((token) => token !== "");
	if (tokens.length === 0) {
		notify(ctx, listText(state));
		return;
	}
	if (tokens[0] === "--revoke") {
		const key = tokens[1];
		if (key === undefined) {
			notify(ctx, "ssh-grant: --revoke needs a destination key, e.g. /ssh-grant --revoke dev@build-box", "warning");
			return;
		}
		state.grants.delete(key);
		state.deniedAt.delete(key);
		const declared = state.project !== null && state.project.keys.includes(key);
		if (declared) {
			// A declaration is not a grant, so there is nothing to delete: the session's override is a
			// **denial**, which is what keeps the key out of `heldKeys` where nobody can be asked, and
			// what ticket 07's entry persists. Filtering `state.project.keys` in memory instead would
			// have lost the revoke at the next session start, when the file is read again.
			state.denials.add(key);
			state.deniedAt.set(key, Date.now());
		} else {
			state.denials.delete(key);
		}
		persistGrantState(state);
		notify(
			ctx,
			`ssh-grant: revoked ${key} for this session${
				declared ? ` (its ${PROJECT_FILE} declaration stands and still asks; it will not apply again this session)` : ""
			}.`,
		);
		return;
	}
	if (tokens[0].startsWith("--")) {
		notify(ctx, "ssh-grant: usage: /ssh-grant <key> | /ssh-grant | /ssh-grant --revoke <key>", "warning");
		return;
	}
	const key = tokens[0];
	state.grants.set(key, { route: "command", at: Date.now() });
	state.denials.delete(key);
	state.deniedAt.delete(key);
	persistGrantState(state);
	notify(ctx, `ssh-grant: granted ${key} for this session.`);
}

/**
 * The session-start read: restore the entries ticket 07 wrote, then read the project declaration
 * (trusted projects only, once) and print what was found (ticket 06 §2, ticket 07 §2).
 *
 * It runs in `session_start`, and web-access is declared **before** `host-bridge` in the root
 * manifest, so the record holds this session's answer before the kernel is composed with it. That
 * order is a requirement now, not a coincidence.
 */
export function restoreGrantSession(
	ctx: unknown,
	keyOf: (ctx: unknown) => string,
	appender?: (data: { grants: { key: string; route: GrantRoute; at?: number }[]; denials: { key: string; at: number }[] }) => void,
): SshGrantState {
	const key = keyOf(ctx);
	const state = ensureGrantRecord(key);
	// The persist hook: the policy path has no `pi`, so `installSshGrant` hands the writer down here,
	// and every mutation calls the hook (ticket 07 §1). Re-installed on each restore, reading the live
	// state through the closure's `state` reference.
	if (appender !== undefined) state.persist = () => appender(serializeGrantState(state));
	const restored = readGrantEntries(getEntries(ctx));
	if (restored.own !== null) {
		state.grants = restored.own.grants;
		state.denials = restored.own.denials;
		state.deniedAt = restored.own.deniedAt ?? new Map();
	}
	state.inherited = restored.inherited;
	const trusted = isTrusted(ctx);
	state.projectTrusted = trusted;
	if (!trusted) return state;
	const cwd = sessionCwd(ctx);
	if (cwd === undefined) return state;
	const file = findProjectFile(cwd);
	if (file === null) return state;
	const { keys, problems } = readProjectFile(file);
	state.project = { path: file, keys };
	if (keys.length > 0) {
		notify(ctx, `ssh-grant: trusted project ${file} declares ${keys.length} target(s): ${keys.join(", ")} — route project.`);
	}
	for (const problem of problems) notify(ctx, problem, "warning");
	return state;
}

/**
 * Prepare a **child** session's record for `webAccessAnswer`: the marker into its own transcript, the
 * floor it will read live, and its own project declaration (ticket 07 §3, §5).
 *
 * The marker is written from the spawner's floor when one is live, so a later resume in a process
 * with no spawner still knows what the child held. A child's own project file is read for **its** cwd,
 * trusted only — the one route a child can reach a target by without a dialog.
 */
export function composeChildGrants(ctx: unknown, sessionKey: string, cwd: string): void {
	const state = ensureGrantRecord(sessionKey);
	// The child's own load of this entry never ran (a spawned child loads no ambient extension), so a
	// resumed child reads its marker here; `restoreGrantSession` may already have set it.
	if (state.inherited === null) state.inherited = readGrantEntries(getEntries(ctx)).inherited ?? null;
	const floor = floors().get(sessionKey);
	if (floor !== undefined) {
		const view = floor();
		if (view !== undefined) writeInherited(ctx, view);
	}
	const trusted = isTrusted(ctx);
	state.projectTrusted = trusted;
	if (state.project === null && trusted) {
		const file = findProjectFile(cwd);
		if (file !== null) {
			const { keys, problems } = readProjectFile(file);
			state.project = { path: file, keys };
			for (const problem of problems) notify(ctx, problem, "warning");
		}
	}
}

/**
 * Write an inherited-grant marker into a **child's own** transcript (ticket 07 §3).
 *
 * `ctx` is the child's ctx — the correction `../readonly-limits` ticket 02 records, and the same ctx
 * readonly-mode writes through (`index.ts:542-550`). The marker carries the grant keys **with their
 * routes and `at`** and the denials, so a resume in a later process can honour or refuse each exactly
 * as the live floor did. Best effort: a marker is a convenience for a later resume, never a
 * precondition for the mount that asked for it.
 */
function writeInherited(ctx: unknown, view: GrantView): void {
	try {
		const manager = (ctx as { sessionManager?: { appendCustomEntry?: (type: string, data?: unknown) => string } } | null)
			?.sessionManager;
		manager?.appendCustomEntry?.(SSH_GRANT_INHERITED_ENTRY, serializeGrantState(view));
	} catch {
		/* a marker is a convenience for a later resume, never a precondition */
	}
}

function getEntries(ctx: unknown): readonly unknown[] {
	try {
		const entries = (ctx as { sessionManager?: { getEntries?: () => unknown } } | null)?.sessionManager?.getEntries?.();
		return Array.isArray(entries) ? entries : [];
	} catch {
		return [];
	}
}

/** The pi surface this module registers on. Structural, so a test can pass a stub. */
export type SshGrantPi = {
	on?: (event: "session_start" | "session_shutdown", handler: (event: unknown, ctx: unknown) => unknown) => void;
	registerCommand?: (
		name: string,
		options: { description?: string; handler: (args: string, ctx: unknown) => Promise<void> | void },
	) => void;
	/** Writes a session entry; ticket 07's persistence. Missing on a host that cannot hold one. */
	appendEntry?: (customType: string, data: unknown) => unknown;
};

/**
 * Register the `/ssh-grant` command and the session-start restore on pi's extension api. Called by
 * `host.ts`'s default export; each part is offered only when the surface has it, so an older host
 * loses the route rather than throwing at load (a throwing factory is a process kill).
 */
export function installSshGrant(pi: unknown, keyOf: (ctx: unknown) => string): void {
	const surface = pi as SshGrantPi;
	// The writer the policy path cannot reach: the ask's yes and a denial happen inside the egress
	// closure, which has no `pi`, so `restoreGrantSession` installs this on the record and every
	// mutation calls it (ticket 07 §1). A host without `appendEntry` leaves the hook undefined and
	// persistence a no-op — state changes for the live session; only a resume loses it.
	const appender =
		typeof surface.appendEntry === "function"
			? (data: { grants: { key: string; route: GrantRoute; at?: number }[]; denials: { key: string; at: number }[] }) => {
					surface.appendEntry?.(SSH_GRANT_ENTRY, data);
				}
			: undefined;
	if (typeof surface.registerCommand === "function") {
		surface.registerCommand("ssh-grant", {
			description: "Grant, list, or revoke a session's ssh/transport destination grants",
			handler: async (args, ctx) => {
				await sshGrantCommand(args, ctx, keyOf(ctx));
			},
		});
	}
	if (typeof surface.on === "function") {
		surface.on("session_start", (_event, ctx) => {
			restoreGrantSession(ctx, keyOf, appender);
			return undefined;
		});
		surface.on("session_shutdown", (_event, ctx) => {
			try {
				forgetGrantRecord(keyOf(ctx));
			} catch {
				/* a session that cannot be keyed has no record to forget */
			}
			return undefined;
		});
	}
}
