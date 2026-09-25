/**
 * The contributor registry: how an extension that adds to a cell's host surface announces itself, and
 * what host-bridge remembers per session (map ticket 02, `.scratch/host-bridge/`).
 *
 * ## Why registration and not naming
 *
 * Before this, rlm had to *name* every contributor: it imported `skill-bridge`, it read
 * `RLM_WEB_MODULE` to reach web-access, and Magic Context arrived through tool-bridge's own owner
 * list. Registration is what lets the seam grow without the composition root learning a new name each
 * time — a contributor's entry loads once in a process and writes its offer into the slot below.
 *
 * ## What a contributor declares
 *
 * ```js
 * registerContributor({
 *   key: "pi-web-access@1",          // instance key; re-registering under it replaces
 *   owner: "web-access",             // the name receipts, records and the model see
 *   apiVersion: 1,
 *   session: ({ handle, sessionFile, progress }) => ({
 *     contribution: { owner: "web-access", hostFns: createHost({ cwd, sessionFile, progress }), ... },
 *     systemPrompt: WEB_SYSTEM_PROMPT,
 *   }),
 * })
 * ```
 *
 * - **`session(input)` answers for one session**: what to contribute to this kernel, and what system
 *   prompt text this session needs (appended once, deduped by text — a child loads no ambient
 *   extension, so the contributor's own entry is not there to append it). `null` means "I serve no
 *   such session", which is a normal answer rather than a failure.
 * - **The contribution is code mode's shape, not a wider one.** This package must not widen the
 *   publisher's contract (map Notes, standing preference 2); what registration adds is the *when*
 *   (per session, root and child) and the prompt text, not new kernel fields.
 * - **Publishing is keyed and replaces.** pi's jiti loader re-imports an extension entry while
 *   `globalThis` survives, so an appending registration would leave one live offer per import.
 *
 * ## Why the slot is a process-global
 *
 * pi loads each extension entry through its own jiti instance (`moduleCache: false`), so a contributor
 * that imports this module and the entry that reads it hold **two module instances** with two module
 * scopes. Module-level state here would be written by one and read as empty by the other — the exact
 * defect `.scratch/child-surface` ticket 03 measured on the child detector. The slot is therefore a
 * `Symbol.for` key, duplicated by no one (a contributor imports this package; only a package built in
 * another checkout would need the literal), and `apiVersion` rides in it because pi has no version
 * query of its own.
 */
import { resolve } from "node:path";

import type { KernelContribution, KernelHandle } from "./client";

/** Where contributors publish. */
export const CONTRIBUTORS_SYMBOL = Symbol.for("pi-host-bridge:contributors");

/** Where this package keeps what it did for a session, keyed by {@link sessionKey}. */
export const SESSIONS_SYMBOL = Symbol.for("pi-host-bridge:sessions");

/** This package's name in records, entries and the model's instructions. */
export const READER = "pi-host-bridge";

/** The registration shape's version. A contributor older than this build is refused with a reason. */
export const API_VERSION = 1;

/** What a contributor is asked about one session. */
export type SessionInput = {
	/** pi's own context for the session — travels into executors, which resolve their own session from it. */
	ctx: unknown;
	/** The kernel handle's key: the same key code mode mounted under, and the one records are filed by. */
	sessionKey: string;
	handle: KernelHandle;
	/** True when this session was spawned by another. The child notion's own reader supplies it. */
	isChild: boolean;
	cwd: string;
	sessionFile?: string;
	/** The running cell's progress sink, when a cell is in flight. Undefined between cells. */
	progress?: (text: string) => void;
};

/** What a contributor answers for one session. An empty answer is a contributor with nothing to add. */
export type ContributorAnswer = {
	contribution?: KernelContribution;
	/** Appended to this session's system prompt once; host-bridge dedupes by text. */
	systemPrompt?: string;
	/**
	 * What the contributor itself dropped while answering, one line each, for the session's record.
	 *
	 * The composition root cannot see inside an owner's catalogue, so this is how a drop stays loud: it
	 * goes into the same `problems` the seam's own failures go to, in contributor order (ticket 05).
	 */
	problems?: string[];
	/**
	 * pi tool names a cell can reach **because** this contribution landed (ticket 04).
	 *
	 * The value only a contributor knows — it is the catalogue it just published — and the one input
	 * the active-set rule needs that the ledger cannot supply: the receipt reports a contribution's
	 * *fields*, not what a cell can now call. Recorded only when the contribution landed, because a
	 * refused contribution installs nothing (the reason the record is written after the ledger, never
	 * before: a name recorded too early strips a pi tool whose route never appeared).
	 */
	reaches?: string[];
};

/**
 * What a contributor may need to build a child's factories.
 *
 * The shapes are `pi-tool-bridge`'s today (`src/child-seam.ts`); ticket 05 moves that seam here and
 * deletes its copy. Until then this package must not disagree with it, which is why the fields are
 * these rather than invented ones.
 */
export type ChildCeiling = {
	ceiling: string[];
	source: "spawner" | "fallback";
	dropped?: string[];
};

export type ChildRequest = {
	/** The spawning session's file. Provenance: contributors log it, none routes by it. */
	parentSessionFile?: string;
	/** The ceiling the spawner computed for this child, when it computed one. */
	ceiling?: ChildCeiling;
};

/**
 * The vocabulary of "bind a session you did not initialise": which session, its id, its parent, its cwd.
 *
 * `childSessionFile` is the routing key, `childSessionId` the per-session policy key and `cwd` the
 * project key; the parent file is provenance. Moved here verbatim from
 * `pi-tool-bridge/src/child-seam.ts` (ticket 05).
 */
export type ChildBindInput = {
	childSessionFile?: string;
	childSessionId?: string;
	parentSessionFile?: string;
	cwd?: string;
};

export type ContributorRegistration = {
	/** Instance key. Re-registering under the same key replaces the previous offer. */
	key: string;
	/** The name receipts, records and the model see. */
	owner: string;
	apiVersion: number;
	/** What this contributor offers a session; `null` when it serves none. */
	session?: (input: SessionInput) => ContributorAnswer | null;
	/**
	 * Names of this contributor's pi tools that a **child** may hold.
	 *
	 * The ceiling's policy half, supplied per contributor and unioned by host-bridge over
	 * `["python"]` (the kernel's own tool) — so a contributor decides what a child may inherit of
	 * *its* surface, and nothing else has to be taught which owners exist (ticket 04).
	 */
	childEligible?: () => string[];
	/**
	 * The one contributor that gets the **last word on a child's active set** — single owner.
	 *
	 * Its factory is appended after every contributor's `childFactories` (and still before code
	 * mode's own, which the child's lifecycle needs last of all). This exists because a contributor
	 * that corrects pi's active set must run after every contributor that *registers* a tool, and
	 * key order is not a rule: the surface would be silently wrong for whichever contributor's key
	 * happened to sort later. One declarer, and a second is refused rather than silently ordered
	 * (the same severity code mode's ledger gives its single-owner `onNotice` and `provenance`).
	 */
	childSurface?: (request: ChildRequest) => ((pi: unknown) => void) | null;
	/**
	 * Told which session it is now serving — before anything reads what it offers for that session.
	 *
	 * A contributor whose own lookup serves a child from the child's session id or file (rather than
	 * "the one instance in this process") needs this, or a second instance alive in one process leaves
	 * the child bound to nothing. A throw is contained by {@link compose.bindChild}.
	 */
	bindChild?: (input: ChildBindInput) => void;
	/** One line for a session's record: what this contributor provides a child, or why it does not. */
	childStatus?: () => string;
	/**
	 * Entry factories a **spawned child's** loader loads on this contributor's behalf.
	 *
	 * A child loads no ambient extensions, so a contributor that serves one has to hand over a factory
	 * rather than rely on its entry being there. Declaring none is normal: web-access, for instance,
	 * needs none — its host functions reach the child through this package's contribution.
	 */
	childFactories?: (request: ChildRequest) => Array<(pi: unknown) => void>;
};

/** What host-bridge did for one session. Written after the contributions landed, never before. */
export type SessionRecord = {
	mounted: boolean;
	/** Every owner whose contribution reached the ledger. */
	owners: string[];
	/** Every host-function name the ledger accepted. */
	installed: string[];
	/** pi tool names a cell can reach in this session, from the contributions that landed (ticket 04). */
	reaches: string[];
	/**
	 * System-prompt text the contributors asked for, in contributor order (ticket 03).
	 *
	 * It rides in the record rather than in the entry's closure because a `/reload` re-imports the
	 * entry: the instance that appends the text on `before_agent_start` is regularly *not* the instance
	 * that composed the session, and the record is the one thing both can see.
	 */
	promptTexts: string[];
	/** Why the session has no kernel, or why a contribution did not land. */
	problems: string[];
};

export type RegistrationResult = { registered: true } | { registered: false; reason: string };

function slot<T>(key: symbol, create: () => T): T {
	const holder = globalThis as Record<symbol, unknown>;
	const existing = holder[key];
	if (existing !== undefined && existing !== null) return existing as T;
	const created = create();
	holder[key] = created;
	return created;
}

function contributorsSlot(): Map<string, ContributorRegistration> {
	return slot(CONTRIBUTORS_SYMBOL, () => new Map<string, ContributorRegistration>());
}

function sessionsSlot(): Map<string, SessionRecord> {
	return slot(SESSIONS_SYMBOL, () => new Map<string, SessionRecord>());
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate at registration rather than at read time: one reason, where the publisher can see it.
 *
 * A malformed registration is **dropped, not fatal** — the process keeps loading, the other
 * contributors still work, and the reason is returned so a caller can record it. Nothing here throws.
 */
export function registerContributor(registration: unknown): RegistrationResult {
	if (!isRecord(registration)) {
		return { registered: false, reason: "the registration is not an object" };
	}
	const key = registration.key;
	if (typeof key !== "string" || key.length === 0) {
		return { registered: false, reason: "the registration has no instance key" };
	}
	const owner = registration.owner;
	if (typeof owner !== "string" || owner.length === 0) {
		return { registered: false, reason: `"${key}" has no owner name` };
	}
	if (typeof registration.apiVersion !== "number") {
		return { registered: false, reason: `"${key}" has no numeric apiVersion` };
	}
	if (registration.apiVersion < API_VERSION) {
		return {
			registered: false,
			reason: `"${key}" speaks version ${registration.apiVersion}, and this build needs ${API_VERSION}`,
		};
	}
	if (registration.session !== undefined && typeof registration.session !== "function") {
		return { registered: false, reason: `"${key}" has a session that is not a function` };
	}
	if (registration.childFactories !== undefined && typeof registration.childFactories !== "function") {
		return { registered: false, reason: `"${key}" has childFactories that are not a function` };
	}
	if (registration.childEligible !== undefined && typeof registration.childEligible !== "function") {
		return { registered: false, reason: `"${key}" has childEligible that is not a function` };
	}
	if (registration.childSurface !== undefined && typeof registration.childSurface !== "function") {
		return { registered: false, reason: `"${key}" has childSurface that is not a function` };
	}
	if (registration.bindChild !== undefined && typeof registration.bindChild !== "function") {
		return { registered: false, reason: `"${key}" has bindChild that is not a function` };
	}
	if (registration.childStatus !== undefined && typeof registration.childStatus !== "function") {
		return { registered: false, reason: `"${key}" has childStatus that is not a function` };
	}
	if (registration.childSurface !== undefined) {
		for (const [otherKey, other] of contributorsSlot()) {
			if (otherKey === key || other.childSurface === undefined) continue;
			return {
				registered: false,
				reason: `"${key}" cannot hold childSurface — "${otherKey}" already does (one contributor gets the last word on a child's active set)`,
			};
		}
	}
	contributorsSlot().set(key, registration as unknown as ContributorRegistration);
	return { registered: true };
}

/**
 * Every live registration, in a stable order.
 *
 * Sorted by instance key rather than insertion order, because insertion order is a function of which
 * session pi happened to load first — and the model's instructions, the kernel's prelude tail and the
 * guidelines must read the same twice.
 */
export function contributors(): ContributorRegistration[] {
	return [...contributorsSlot().entries()]
		.map(([key, registration]) => ({ key, registration }))
		.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
		.map((entry) => entry.registration);
}

/**
 * The session key, taken from `ctx.sessionManager` and never from the `ctx` object: pi hands out a
 * fresh context per call, so ctx identity is not stable across two handlers in one bind. An
 * unpersisted session keys on the session manager's identity instead, so it stays shareable in-process.
 *
 * **This is the workspace's one derivation** (ticket 02). It was `pi-tool-bridge`'s, and the rule it
 * was written under still holds: two readers of "this session has a cell route to these names" must
 * key their records identically. Code mode derives the same key for its mounter from the same two
 * facts — a resolved session file, or the manager's identity — which is what makes a handle's
 * `sessionKey` and a record written under this function the same string
 * (`test/convention.test.ts` pins the agreement).
 */
export function sessionKey(ctx: unknown): string {
	const anyCtx = ctx as
		| { sessionManager?: { getSessionFile?: () => string | undefined } }
		| null
		| undefined;
	let file: string | undefined;
	try {
		file = anyCtx?.sessionManager?.getSessionFile?.();
	} catch {
		// A disposed ctx throws on every property. No key is right for it; a fresh one is harmless,
		// because nothing was ever recorded under it.
		file = undefined;
	}
	if (typeof file === "string" && file.length > 0) return absolute(file);
	// The session manager is the identity to key on — pi hands out a fresh ctx per call, so two ctx
	// objects for one session must agree — but reading it is exactly what a *disposed* ctx throws on,
	// and a shutdown handler is one of the callers (`forgetSession(sessionKey(ctx))`). A manager that
	// cannot be read therefore falls back to the ctx object itself, which needs no property access: a
	// disposed ctx gets a key of its own that matches no record, which is the harmless answer. (The
	// copy of this function this one replaces threw here; `test/convention.test.ts` pins the fix.)
	const anchor: object = readableManager(anyCtx) ?? (isObject(ctx) ? ctx : {});
	const keys = unpersistedKeys();
	let key = keys.get(anchor);
	if (key === undefined) {
		nextUnpersisted += 1;
		key = `unpersisted#${nextUnpersisted}`;
		keys.set(anchor, key);
	}
	return key;
}

function isObject(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}

/** The ctx's session manager, or `null` — never a throw, whatever the ctx is or has become. */
function readableManager(ctx: { sessionManager?: unknown } | null | undefined): object | null {
	try {
		const manager = ctx?.sessionManager;
		return isObject(manager) ? manager : null;
	} catch {
		return null;
	}
}

let nextUnpersisted = 0;
let unpersistedStore: WeakMap<object, string> | undefined;

function unpersistedKeys(): WeakMap<object, string> {
	if (!unpersistedStore) unpersistedStore = new WeakMap();
	return unpersistedStore;
}

/** Absolute, so two spellings of one session file cannot become two sessions. */
function absolute(file: string): string {
	try {
		return resolve(file);
	} catch {
		return file;
	}
}

/** Records what host-bridge did for a session. Deduped, so a reader sees names once. */
export function recordSession(key: string, record: SessionRecord): void {
	sessionsSlot().set(key, {
		mounted: record.mounted === true,
		owners: [...new Set(record.owners)],
		installed: [...new Set(record.installed)],
		reaches: [...new Set(record.reaches ?? [])],
		promptTexts: [...new Set((record.promptTexts ?? []).filter((text) => text.trim().length > 0))],
		problems: [...record.problems],
	});
}

export function sessionRecord(key: string): SessionRecord | undefined {
	return sessionsSlot().get(key);
}

/**
 * Clears one session's record. `globalThis` outlives `/new`, resume and fork, so a session that ends
 * must take its record with it — a stale key would keep answering for a session that has no kernel.
 */
export function forgetSession(key: string): void {
	sessionsSlot().delete(key);
}

/**
 * Drops the records a caller says are gone, and reports which.
 *
 * The **predicate is the caller's**, deliberately: a child never reaches a shutdown hook, so something
 * has to decide what "gone" means (skill-bridge prunes by session-file mtime), and that is policy this
 * package does not own.
 */
export function pruneSessions(isStale: (key: string, record: SessionRecord) => boolean): string[] {
	const dropped: string[] = [];
	for (const [key, record] of [...sessionsSlot().entries()]) {
		let stale = false;
		try {
			stale = isStale(key, record) === true;
		} catch {
			stale = false;
		}
		if (stale && sessionsSlot().delete(key)) dropped.push(key);
	}
	return dropped;
}

/**
 * Where the child detector lives: a process-global, like every other slot here (and for the same
 * reason — pi gives each entry its own jiti instance of a shared module, so a module-level variable
 * would be written by one and read as `undefined` by the other).
 *
 * **rlm installs it**, because only rlm knows what a child session looks like (its own provenance
 * record); this package would otherwise have to learn rlm's marker vocabulary. No detector installed
 * means no child is detected and the root answer stands, which is a state the session was already in.
 */
const DETECTOR_SYMBOL = Symbol.for("pi-host-bridge:child-detector");

type DetectorSlot = { current?: (ctx: unknown) => boolean };

function detectorSlot(): DetectorSlot {
	const holder = globalThis as Record<symbol, unknown>;
	const existing = holder[DETECTOR_SYMBOL];
	if (existing !== null && typeof existing === "object") return existing as DetectorSlot;
	const created: DetectorSlot = {};
	holder[DETECTOR_SYMBOL] = created;
	return created;
}

export function setChildDetector(detector: (ctx: unknown) => boolean): void {
	detectorSlot().current = detector;
}

/** A detector that throws must not take a session's start with it: an undetected child degrades to the root answer. */
export function detectsChild(ctx: unknown): boolean {
	const detector = detectorSlot().current;
	if (!detector) return false;
	try {
		return detector(ctx) === true;
	} catch {
		return false;
	}
}

/** Test seam: forget the installed detector, wherever it was installed from. */
export function __clearChildDetectorForTests(): void {
	detectorSlot().current = undefined;
}

/** Test seam: forget every registration and every record this process holds. */
export function __resetHostBridgeForTests(): void {
	contributorsSlot().clear();
	sessionsSlot().clear();
	detectorSlot().current = undefined;
	nextUnpersisted = 0;
	unpersistedStore = undefined;
}
