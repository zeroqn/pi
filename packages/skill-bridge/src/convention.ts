/**
 * The skill bridge — the contract by which a store offers its skills to a code-mode surface, and the
 * session-scoped record of what that surface can show and a cell can reach.
 *
 * ## The problem
 *
 * pi renders its `<available_skills>` block only when `read` or `bash` is active
 * (`core/system-prompt.js:14`), and a code-mode session's surface is `["python"]`. So pi loads every
 * skill — `~/.pi/agent/skills`, the project's, packages', `--skill` paths — and renders none of them.
 * A learned store has the same problem and one more: it reaches pi's *own* block through
 * `resources_discover`, which fires at session start and on `/reload` only.
 *
 * So the work is split in two, and this package is the first half: the **surface** (the block and the
 * `skill()` / `skills()` call form) belongs to whoever renders it for a code-mode session, and a
 * **provider** supplies skills it owns. The bridge reads pi's own loaded skills itself — they arrive
 * in the `before_agent_start` event — and asks providers for the rest.
 *
 * ## What a provider does (no dependency on this package)
 *
 * Registering is a **duplicated literal**, not an import, for the same reason the tool bridge's is: an
 * entry that cannot resolve a private workspace package must still be able to publish, and the reader
 * must not know providers by name. The two sides agree on a symbol, a shape and a key:
 *
 * ```js
 * const slot = (globalThis[Symbol.for("pi-skill-bridge:providers")] ??= new Map())
 * const forSession = slot.get(sessionKey) ?? new Map()
 * forSession.set("rsi", {
 *   owner: "rsi",
 *   apiVersion: 1,
 *   list: () => [{ name, description, location, scope }],
 *   read: (name) => ({ content, files }),
 * })
 * slot.set(sessionKey, forSession)
 * ```
 *
 * - **Keyed by session, then by owner.** A provider answers for one session — its own store's scope
 *   union, its own cwd — and a re-registration **replaces** rather than appends, because pi's jiti
 *   loader re-imports an entry per session while `globalThis` survives.
 * - **`list()` takes no argument.** The provider owns its scoping; the bridge never passes a scope.
 * - **`read(name)` is the only door to a provider's content.** The bridge never learns a store's
 *   layout, key encoding or payload declaration; `location` crosses as a value, for the block's bash
 *   route.
 * - **A provider is asked per turn**, so a skill written mid-session appears without a `/reload`.
 *
 * ## What the reader guarantees
 *
 * - A provider whose `apiVersion` is not this major is refused whole, with a reason.
 * - A malformed provider is dropped while the others stand.
 * - A malformed **entry** is dropped; the provider's other entries still work.
 * - A provider whose `list()` throws is dropped for that turn; the rest still compose.
 * - The first provider to list a name holds it, and pi's own entries come first (see
 *   {@link composeSkills}).
 * - A session that ends takes its providers with it: `forgetSession` at shutdown, and
 *   {@link pruneProviders} as hygiene for the sessions that never reach a shutdown hook — a child.
 */
import * as fs from "node:fs";
import { resolve } from "node:path";

/** Where providers register. Duplicated as a literal by every provider, on purpose (see above). */
export const PROVIDERS_SYMBOL = Symbol.for("pi-skill-bridge:providers");

/** The provider shape's version. A reader refuses any other major. */
export const API_VERSION = 1;

/** This package's name in code mode's contribution ledger. One spelling, used by the entry. */
export const READER = "pi-skill-bridge";

/** One skill, in the shape `formatSkillsForPrompt` needs plus the provider's own `scope`. */
export type SkillEntry = {
	name: string;
	description: string;
	location: string;
	/** The provider's vocabulary (`"general"`, a project key) — not pi's `sourceInfo.scope`. */
	scope: string;
	/**
	 * pi's "explicit invocation only" flag, carried through so the formatter can filter on it. A
	 * provider that lists a skill advertises it, so the flag defaults to `false`; it exists for the
	 * entries pi loaded.
	 */
	disableModelInvocation?: boolean;
};

/** What `skill(name)` answers with. `files` are the payload files the skill declares. */
export type SkillContent = { content: string; files: string[] };

export type MaybePromise<T> = T | Promise<T>;

/**
 * What a provider publishes. `list` and `read` may be async; every real store reads a local
 * directory synchronously, but nothing here needs them to be.
 */
export type SkillProvider = {
	owner: string;
	apiVersion: number;
	list: () => MaybePromise<readonly SkillEntry[]>;
	read: (name: string) => MaybePromise<SkillContent | undefined>;
};

/** What {@link registerProvider} answers. A refusal carries the reason a human can read. */
export type ProviderReceipt = { accepted: boolean; problem?: string };

/** One provider's answer for a turn, or the reason it was dropped for that turn. */
export type ProviderListing = { owner: string; entries: SkillEntry[] } | { owner: string; problem: string };

/** How a composed entry is *read* — through the provider that claims it, or from the file it names. */
export type SkillRoute = { kind: "provider"; owner: string } | { kind: "path" };

/** One surviving entry, with the route that reads it. Display order and route are separate facts. */
export type ComposedSkill = { entry: SkillEntry; route: SkillRoute };

type SessionProviders = Map<string, unknown>;

function slot(): Map<string, SessionProviders> {
	const holder = globalThis as Record<symbol, unknown>;
	const existing = holder[PROVIDERS_SYMBOL];
	if (existing instanceof Map) return existing as Map<string, SessionProviders>;
	const created = new Map<string, SessionProviders>();
	holder[PROVIDERS_SYMBOL] = created;
	return created;
}

function providersIn(key: string): SessionProviders {
	const existing = slot().get(key);
	if (existing instanceof Map) return existing;
	const created: SessionProviders = new Map();
	slot().set(key, created);
	return created;
}

/**
 * The session key, taken from `ctx.sessionManager` and never from the `ctx` object: pi hands out a
 * fresh context per call, so ctx identity is not stable across two handlers in one bind. An
 * unpersisted session keys on the session manager's identity instead.
 *
 * A provider and this package must both use *this* function — they are the two halves of one fact,
 * and a second derivation would silently stop matching.
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
		file = undefined;
	}
	if (typeof file === "string" && file.length > 0) return resolve(file);
	const anchor: object =
		(anyCtx?.sessionManager as object | undefined) ?? (ctx as object | undefined) ?? {};
	const keys = unpersistedKeys();
	let key = keys.get(anchor);
	if (key === undefined) {
		nextUnpersisted += 1;
		key = `unpersisted#${nextUnpersisted}`;
		keys.set(anchor, key);
	}
	return key;
}

let nextUnpersisted = 0;
let unpersistedStore: WeakMap<object, string> | undefined;

function unpersistedKeys(): WeakMap<object, string> {
	if (!unpersistedStore) unpersistedStore = new WeakMap();
	return unpersistedStore;
}

/**
 * Why this value cannot be a provider, or `undefined` when it can. One function, used at
 * registration and again at read time: a literal written straight into the slot never passed
 * registration.
 */
export function refusalFor(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null) return "not an object";
	const provider = value as Partial<SkillProvider>;
	if (typeof provider.owner !== "string" || provider.owner.trim().length === 0) {
		return "no owner name";
	}
	if (provider.apiVersion !== API_VERSION) {
		return `apiVersion ${String(provider.apiVersion)} is not ${API_VERSION}`;
	}
	if (typeof provider.list !== "function") return "no list()";
	if (typeof provider.read !== "function") return "no read(name)";
	return undefined;
}

/**
 * Register one provider for one session, replacing any earlier registration by the same owner.
 * A refusal stores nothing, so a malformed provider cannot displace a good one.
 */
export function registerProvider(input: { sessionKey: string; provider: unknown }): ProviderReceipt {
	const problem = refusalFor(input.provider);
	if (problem) return { accepted: false, problem };
	const provider = input.provider as SkillProvider;
	providersIn(input.sessionKey).set(provider.owner, provider);
	return { accepted: true };
}

/** The providers serving one session, in registration order, with malformed ones filtered out. */
export function providersFor(key: string): SkillProvider[] {
	const out: SkillProvider[] = [];
	for (const value of providersIn(key).values()) {
		if (refusalFor(value) === undefined) out.push(value as SkillProvider);
	}
	return out;
}

/** The owner names serving one session, in registration order. */
export function providerOwners(key: string): string[] {
	return [...providersIn(key).keys()];
}

/** Clears one session's providers. `globalThis` outlives `/new`, resume and fork. */
export function forgetSession(key: string): void {
	slot().delete(key);
}

/**
 * Drop provider records whose session file has not been written for longer than `maxAgeMs`.
 * Hygiene, not correctness: a child session never reaches a shutdown hook, so this is what stops a
 * dead child's provider answering a later session's lookups. A file that is gone is dropped too.
 */
export function pruneProviders(maxAgeMs: number): number {
	const now = Date.now();
	let removed = 0;
	for (const key of [...slot().keys()]) {
		if (key.startsWith("unpersisted#")) continue;
		let mtime: number;
		try {
			mtime = fs.statSync(key).mtimeMs;
		} catch {
			slot().delete(key);
			removed += 1;
			continue;
		}
		if (now - mtime > maxAgeMs) {
			slot().delete(key);
			removed += 1;
		}
	}
	return removed;
}

/** One entry, or `undefined` when it is malformed. Fields other than the name are defaulted. */
function entryOf(value: unknown): SkillEntry | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const entry = value as Partial<SkillEntry>;
	if (typeof entry.name !== "string" || entry.name.trim().length === 0) return undefined;
	const text = (field: unknown): string => (typeof field === "string" ? field : "");
	return {
		name: entry.name,
		description: text(entry.description),
		location: text(entry.location),
		scope: text(entry.scope),
		disableModelInvocation: entry.disableModelInvocation === true,
	};
}

/**
 * Ask every provider for its skills. One provider's fault is one provider's: a throw is reported
 * with its owner and the others still answer, and a malformed entry is dropped while the provider's
 * other entries stand.
 */
export async function listings(
	providers: readonly SkillProvider[],
): Promise<ProviderListing[]> {
	const answers: ProviderListing[] = [];
	for (const provider of providers) {
		let raw: unknown;
		try {
			raw = await provider.list();
		} catch (error) {
			answers.push({ owner: provider.owner, problem: errorText(error) });
			continue;
		}
		const entries: SkillEntry[] = [];
		for (const value of Array.isArray(raw) ? raw : []) {
			const entry = entryOf(value);
			if (entry) entries.push(entry);
		}
		answers.push({ owner: provider.owner, entries });
	}
	return answers;
}

/**
 * The composition: **pi's own entries first**, then each provider's in registration order, deduped
 * first-wins by name. Order is what the block renders; the **route** is separate and
 * provider-first, because only the provider knows how to read its own skill properly (the declared
 * payload files are its answer, not a file scan).
 *
 * The two can only disagree on a name a provider claims *and* pi loaded — the same file, reached two
 * ways — which is why the route prefers the provider while the order keeps the earlier position.
 */
export function composeSkills(
	piLoaded: readonly SkillEntry[],
	answers: readonly ProviderListing[],
): ComposedSkill[] {
	const claimedBy = new Map<string, string>();
	for (const answer of answers) {
		if (!("entries" in answer)) continue;
		for (const entry of answer.entries) {
			if (!claimedBy.has(entry.name)) claimedBy.set(entry.name, answer.owner);
		}
	}

	const seen = new Set<string>();
	const out: ComposedSkill[] = [];
	const add = (entry: SkillEntry) => {
		if (seen.has(entry.name)) return;
		seen.add(entry.name);
		const owner = claimedBy.get(entry.name);
		out.push({
			entry,
			route: owner === undefined ? { kind: "path" } : { kind: "provider", owner },
		});
	};
	for (const entry of piLoaded) {
		const parsed = entryOf(entry);
		if (parsed) add(parsed);
	}
	for (const answer of answers) {
		if (!("entries" in answer)) continue;
		for (const entry of answer.entries) add(entry);
	}
	return out;
}

/** The provider that claims a name, for `skill(name)`'s read route. */
export function providerFor(
	answers: readonly ProviderListing[],
	name: string,
): string | undefined {
	for (const answer of answers) {
		if (!("entries" in answer)) continue;
		if (answer.entries.some((entry) => entry.name === name)) return answer.owner;
	}
	return undefined;
}

function errorText(error: unknown): string {
	return String((error as Error)?.message ?? error);
}

/** Test seam: forget every provider this process holds. */
export function __resetSkillBridgeForTests(): void {
	slot().clear();
	nextUnpersisted = 0;
	unpersistedStore = undefined;
}
