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
 *     state, which {@link heldKeys} consults (today it reads only the record's own grants);
 *   - the **7-day idle window** on restored `ask`/`command` grants and the revoke's propagation.
 * One thing this module does that ticket 07 must carry forward: `--revoke` of a project-declared key
 * removes it from `project.keys` **for this session only** (the file is never edited). The file is
 * re-read at each session start, so persisting that override across a resume has no home in ticket
 * 07's `{grants, denials}` entry shape yet — the build report records the choice rather than guessing
 * it here.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
	checkEgress,
	destinationKeys,
	egressSegments,
	transportRefusal,
	unmatched,
	type EgressSegment,
} from "./egress";
import { REMOTE_OUTPUT_FENCE } from "./guard";

/** The contract version whose egress verdict can allow a call *and* fence its result (ticket 04). */
export const FENCE_API_VERSION = 5;

/** The two entry kinds ticket 07 writes; this module reads them (newest of each kind wins). */
export const SSH_GRANT_ENTRY = "ssh-grant";
export const SSH_GRANT_INHERITED_ENTRY = "ssh-grant-inherited";

/** The third route's file, read once at session start from the walk-up below. */
export const PROJECT_FILE = ".pi/ssh-grant.json";

/** The ask's timeout in **milliseconds** (ticket 05's trap; readonly-mode's `60_000` precedent). */
export const ASK_TIMEOUT_MS = 60_000;

/** Where the per-session records live. A `Symbol.for` because a child's load is a second instance. */
export const RECORDS_KEY = Symbol.for("pi-ssh-grant:records");

export type GrantRoute = "ask" | "command" | "project";

/** One grant: the route that gave it, and when (`ask`/`command` carry `at`; `project` does not). */
export type Grant = { route: GrantRoute; at?: number };

/** What one entry kind carries. Ticket 07's shape: `{grants:[{key,route,at}], denials:[{key,at}]}`. */
export type GrantEntryState = { grants: Map<string, Grant>; denials: Set<string> };

/** A project's declaration: the file's path and the keys it listed. */
export type ProjectDeclaration = { path: string; keys: string[] };

/** Everything one session's egress policy needs to read, live. */
export type SshGrantState = {
	grants: Map<string, Grant>;
	denials: Set<string>;
	project: ProjectDeclaration | null;
	/** Whether the project was trusted, so a no-dialog refusal can say which reason applies. */
	projectTrusted: boolean;
	/** Whether this session's code mode can honour a grant (`/ssh-grant` reports on this). */
	ready: boolean;
	/** Why it cannot, when it cannot. */
	reason?: string;
	/** The child marker ticket 07 wrote, read but **not** applied here — part D owns the floor. */
	inherited: GrantEntryState | null;
};

/** The verdict an egress policy may return, mirrored structurally (host-bridge's `KernelEgressVerdict`). */
export type GrantVerdict =
	| { allow: false; reason: string }
	| { allow: true; fence: { open: string; preamble: string; close: string } }
	| undefined;

/** The session shape a policy decision needs; a contributor builds it once, per session. */
export type GrantSession = {
	/** The session key the record is filed under (the kernel's key, ticket 02). */
	sessionKey: string;
	/** pi's session context: `hasUI`, `ui.confirm`, `signal` and `isProjectTrusted()` are read from it. */
	ctx: unknown;
	/** True when this session was spawned by another (a child has no dialog at all). */
	isChild: boolean;
};

/** The five-family command words whose destination is a host; `sshpass` wraps one. */
const FAMILY = new Set(["ssh", "scp", "sftp", "mosh", "rsync", "sshpass"]);

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
// Reading the entries ticket 07 writes (part C reads them; part D writes them).
// ---------------------------------------------------------------------------

function routeOf(value: unknown): GrantRoute {
	return value === "command" || value === "project" ? value : "ask";
}

function entryStateFrom(data: unknown): GrantEntryState {
	const grants = new Map<string, Grant>();
	const denials = new Set<string>();
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
			const entry = raw as { key?: unknown } | null;
			if (typeof entry?.key === "string" && entry.key.length > 0) denials.add(entry.key);
		}
	}
	return { grants, denials };
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

function hasUi(ctx: unknown): boolean {
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

function signalOf(ctx: unknown): AbortSignal | undefined {
	try {
		const signal = (ctx as { signal?: unknown } | null)?.signal;
		return signal instanceof AbortSignal ? signal : undefined;
	} catch {
		return undefined;
	}
}

function uiOf(ctx: unknown): { confirm?: unknown; notify?: unknown } | null {
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

/**
 * The keys this session may reach right now.
 *
 * `ask`/`command` grants always count. A **project declaration** counts only where nobody can be
 * asked: where a dialog can appear the first use still asks (ticket 06 §2), so the declaration is
 * not silently authoritative there.
 *
 * Part D replaces the `state.grants` read here with the spawner's live floor for a child.
 */
export function heldKeys(state: SshGrantState, dialogCapable: boolean): Set<string> {
	const held = new Set(state.grants.keys());
	if (!dialogCapable && state.project !== null) {
		for (const key of state.project.keys) if (!state.denials.has(key)) held.add(key);
	}
	return held;
}

/** Whether this segment is one the transport matcher judges (so `checkEgress` must not). */
function isFamilySegment(segment: EgressSegment): boolean {
	if (FAMILY.has(segment.command)) return true;
	const reading = destinationKeys(segment.text);
	return reading.keys.length > 0 || reading.refused !== undefined;
}

/** The command's non-transport text: what `checkEgress` still judges on its own terms. */
function nonFamilyText(command: string): string {
	return egressSegments(command)
		.filter((segment) => !isFamilySegment(segment))
		.map((segment) => segment.text)
		.join("\n");
}

/** The command text with comments stripped, so a `# /dev/tcp/...` comment cannot be mistaken for one. */
function strippedText(command: string): string {
	return egressSegments(command)
		.map((segment) => segment.text)
		.join("\n");
}

const SOCKET_REDIRECT = /\/dev\/(tcp|udp)\//;

const BACKGROUND_REFUSAL =
	"web-access: that command is granted for this session, but a `background=True` invocation returns a handle, not the output — the remote text would reach the cell later through calls this policy did not produce, so the fence cannot wrap it. Run it in the foreground.";

const REDIRECT_REFUSAL =
	"web-access: that command is granted for this session, but its output is redirected or teed: the text would land on the host's disk, where read_text returns it unfenced. A granted command's output comes back to the cell or it does not run — run it without the redirect.";

/** Whether the command sends the granted output somewhere other than the cell. */
export function redirectsOrTees(command: string): boolean {
	if (egressSegments(command).some((segment) => segment.command === "tee")) return true;
	// One unquoted `>` is enough: `> file`, `>> file`, `>| file`, `2> file`. A `>&N` duplication
	// (`2>&1`) still returns the output to the cell and is not a file redirect.
	let quote: string | null = null;
	for (let index = 0; index < command.length; index += 1) {
		const ch = command[index];
		if (quote !== null) {
			if (ch === "\\" && quote === '"') index += 1;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (ch === "\\") {
			index += 1;
			continue;
		}
		if (ch === ">") {
			const next = command[index + 1];
			if (next === "&") {
				const after = command[index + 2];
				if (after !== undefined && (after === "-" || (after >= "0" && after <= "9"))) continue;
			}
			return true;
		}
	}
	return false;
}

/** A granted invocation's verdict: fenced if the result comes back, refused if it cannot. */
function grantedVerdict(command: string, background: boolean): GrantVerdict {
	if (background) return { allow: false, reason: BACKGROUND_REFUSAL };
	if (redirectsOrTees(command)) return { allow: false, reason: REDIRECT_REFUSAL };
	return { allow: true, fence: REMOTE_OUTPUT_FENCE };
}

/** The refusal for a target this code mode cannot grant (below contract 5), naming the version. */
function versionRefusal(command: string, keys: readonly string[], version: number): string {
	return `web-access: ${command} reaches ${keys.join(", ")}, and this session cannot grant it: its code mode speaks contract version ${version}, and a grant needs ${FENCE_API_VERSION} (a verdict that fences what comes back). Fetch a page with await fetch_content(url); for a host, no route exists in this session.`;
}

/** Ask one question, with the literal command and every key it would grant. Any non-answer is a no. */
async function askForGrant(
	ctx: unknown,
	command: string,
	keys: readonly string[],
	declared: readonly string[],
): Promise<boolean> {
	const ui = uiOf(ctx);
	if (ui === null || typeof ui.confirm !== "function") return false;
	const title = `Reach ${keys.join(", ")} for this session?`;
	const declaredNote = declared.length > 0 ? `\n\nDeclared in ${PROJECT_FILE}: ${declared.join(", ")}.` : "";
	const body = `The session is asking to run, in a cell:\n\n${command}\n\nThis grants: ${keys.join(", ")}${declaredNote}`;
	try {
		const yes = await (ui.confirm as (title: string, body: string, opts: { timeout: number; signal?: AbortSignal }) => Promise<boolean>)(
			title,
			body,
			{ timeout: ASK_TIMEOUT_MS, signal: signalOf(ctx) },
		);
		return yes === true;
	} catch {
		return false;
	}
}

function declineOrRefusal(session: GrantSession, command: string, keys: readonly string[], held: Set<string>, declined: boolean): string {
	const state = ensureGrantRecord(session.sessionKey);
	return transportRefusal({
		command,
		keys,
		comparison: unmatched(keys, held),
		hasUI: hasUi(session.ctx),
		isChild: session.isChild,
		projectTrusted: state.projectTrusted,
		declined,
	});
}

/**
 * Decide one `bash_host` call.
 *
 * Everything `checkEgress` refuses stays refused, except the transport family, which is judged by
 * `destinationKeys` against this session's live grants. `canFence` is the caller's
 * `apiVersion >= 5`: below it the transport family is refused with a reason naming the version,
 * because a grant that cannot be fenced must not be offered (ticket 04 §6).
 */
export async function grantVerdict(
	command: string,
	background: boolean,
	session: GrantSession,
	canFence: boolean,
	codeModeVersion: number,
): Promise<GrantVerdict> {
	// 1. Everything the present gate refuses, except the family — so a command combining a granted
	//    ssh with a curl is still refused for the curl.
	const whole = checkEgress(command);
	if (!whole.ok) {
		const restVerdict = checkEgress(nonFamilyText(command));
		if (!restVerdict.ok) return { allow: false, reason: restVerdict.reason };
		// The refusal came from a family segment, or from a raw socket inside one; tell them apart.
		if (SOCKET_REDIRECT.test(strippedText(command))) return { allow: false, reason: whole.reason };
	}

	// 2. The transport family, through the matcher.
	const reading = destinationKeys(command);
	if (reading.refused !== undefined) return { allow: false, reason: reading.refused };
	if (reading.keys.length === 0) return undefined; // reaches nobody: `ssh -V`, a local `rsync -e ssh`.

	const state = ensureGrantRecord(session.sessionKey);
	if (!canFence) return { allow: false, reason: versionRefusal(command, reading.keys, codeModeVersion) };

	// 3. Compare against the live grants. A dialog-capable session does not let a project declaration
	//    stand in for a human's answer; where nobody can be asked, it is what applies.
	const dialogCapable = hasUi(session.ctx) && !session.isChild;
	const held = heldKeys(state, dialogCapable);
	const comparison = unmatched(reading.keys, held);
	const unheld = [...comparison.missing, ...comparison.unmatched];
	if (unheld.length === 0) return grantedVerdict(command, background);

	// 4. A no is remembered for the session; without it the next cell asks again, which reads as the
	//    tool not listening (ticket 06 §4).
	const denied = unheld.some((key) => state.denials.has(key));
	if (dialogCapable && !denied) {
		const declared = reading.keys.filter((key) => state.project !== null && state.project.keys.includes(key));
		const yes = await askForGrant(session.ctx, command, reading.keys, declared);
		if (yes === true) {
			const at = Date.now();
			for (const key of reading.keys) {
				state.grants.set(key, { route: "ask", at });
				state.denials.delete(key);
			}
			return grantedVerdict(command, background);
		}
		for (const key of unheld) state.denials.add(key);
		return { allow: false, reason: declineOrRefusal(session, command, reading.keys, held, true) };
	}
	return { allow: false, reason: declineOrRefusal(session, command, reading.keys, held, denied) };
}

// ---------------------------------------------------------------------------
// The routes: /ssh-grant, and the session-start read.
// ---------------------------------------------------------------------------

function listText(state: SshGrantState): string {
	const lines: string[] = [];
	const seen = new Set<string>();
	for (const [key, grant] of state.grants) {
		const when = grant.at !== undefined ? `, granted ${new Date(grant.at).toISOString()}` : "";
		lines.push(`${key} — route ${grant.route}${when}${state.denials.has(key) ? ", denied this session" : ""}`);
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
		const declared = state.project !== null && state.project.keys.includes(key);
		if (declared) {
			// A declaration is not a grant, so there is nothing to delete: the session's override is a
			// **denial**, which is what keeps the key out of `heldKeys` where nobody can be asked, and
			// what ticket 07's entry persists. Filtering `state.project.keys` in memory instead would
			// have lost the revoke at the next session start, when the file is read again.
			state.denials.add(key);
		} else {
			state.denials.delete(key);
		}
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
export function restoreGrantSession(ctx: unknown, keyOf: (ctx: unknown) => string): SshGrantState {
	const key = keyOf(ctx);
	const state = ensureGrantRecord(key);
	const restored = readGrantEntries(getEntries(ctx));
	if (restored.own !== null) {
		state.grants = restored.own.grants;
		state.denials = restored.own.denials;
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
};

/**
 * Register the `/ssh-grant` command and the session-start restore on pi's extension api. Called by
 * `host.ts`'s default export; each part is offered only when the surface has it, so an older host
 * loses the route rather than throwing at load (a throwing factory is a process kill).
 */
export function installSshGrant(pi: unknown, keyOf: (ctx: unknown) => string): void {
	const surface = pi as SshGrantPi;
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
			restoreGrantSession(ctx, keyOf);
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
