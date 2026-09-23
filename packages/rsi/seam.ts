/**
 * RSI's facade — the seam rlm reaches RSI through, and the only one.
 *
 * It used to be six methods wide: `skills`/`skill` so rlm could render the skills block, the
 * `noteUsage`/`noteHostCall` pushes so rlm could report what a cell consulted, the `capability`
 * fact so rlm could tell RSI a code-mode session can write, and a `childFactory`. All of those
 * moved to where the knowledge belongs (wayfinder map `.scratch/rsi-oneway`): the skills surface is
 * RSI's own contribution to code mode's ledger, the block is RSI's own `before_agent_start`, the
 * write capability is the kernel handle RSI holds, and usage is pulled from the journal at settle
 * time. What is left is the one thing only rlm can answer — how a child session is built.
 *
 * The shape is Magic Context's, for the same reason: pi's jiti loader re-imports modules per
 * session (`moduleCache: false`), so module-level state does not survive across sessions within one
 * process. One `Symbol.for` slot holds a **facade of methods, never state**; instances register
 * into a module-level set; the facade serves by the caller's session file.
 *
 * Two rules the design settled and this file must keep:
 *   - **Process-wide reads.** Every instance builds the same child factory, so it answers correctly
 *     even when the caller is a grandchild whose parent instance is gone. Only the child *fact*
 *     resolves to a particular session.
 *   - **Resolvable, never released.** A child session never emits `session_shutdown`, so nothing may
 *     depend on a release hook. Registrations are dropped only as hygiene, by session-file mtime,
 *     which cannot take a live session down.
 *
 * Degradation is symmetric: with RSI absent the lookup misses and rlm's child path contributes
 * nothing; with rlm absent nothing calls in, and RSI serves code mode on its own.
 */

import * as fs from "node:fs";

export const RSI_REGISTRY_KEY = Symbol.for("@earendil/rsi:pi-registry");

/** What an instance offers a child session: one factory, and nothing else. */
export interface RsiSeamWork {
	/** The factory a spawned child's loader is given. */
	childExtension(): (pi: unknown) => void;
}

/**
 * The facade other extensions consume — two members, both about children, both in RSI's own
 * vocabulary. Nothing an RLM type names crosses this wire.
 */
export interface RsiSeam {
	/**
	 * The factory rlm spreads into a spawned child's loader. Process-wide, like the store: every
	 * instance builds the same one, and a grandchild resolves the same facade.
	 */
	childExtension(): ((pi: unknown) => void) | undefined;
	/**
	 * The child signal, for a spawned child and a resumed one alike.
	 *
	 * **The method name is the signal**: a bind only ever means "this session is a child", so there
	 * is no flag to carry and no un-bind to express — a session's child-ness cannot change.
	 * `sessionFile` is the routing key, and it is optional because pi allows an in-memory session.
	 */
	bindChild(fact: { sessionFile?: string }): void;
}

interface Registration {
	work: RsiSeamWork;
	/**
	 * This instance's own session file; the key the facade serves by. A getter rather than a value,
	 * because the facade is published at load time — before any `session_start` handler of any
	 * extension has run — while the session file is only known later.
	 */
	sessionFile: () => string | undefined;
	/**
	 * Session keys bound as children, on whichever instance took the bind.
	 *
	 * A **set of keys**, and that is what makes the bind order-proof: rlm's `session_start` runs
	 * before RSI's (the manifest loads rlm first), so at bind time `resolve()` cannot find RSI's
	 * instance — `currentCtx` is still unset — and the write falls back to the publishing
	 * registration. The read scans every registration, so where the write landed does not matter.
	 */
	children: Set<string>;
	registeredAt: number;
}

/** Live instances, in registration order. Insertion order is what a fallback resolves to. */
const registrations = new Set<Registration>();

/** The key a session with no file is served under, so a session-less caller is still served. */
const NO_FILE = "(no session file)";

function keyFor(sessionFile: string | undefined): string {
	return sessionFile && sessionFile.length > 0 ? sessionFile : NO_FILE;
}

/**
 * The instance that owns this caller, or the single one when there is only one. `undefined` when
 * several are registered and none owns the caller — only session-scoped facts care.
 */
function resolve(caller: { sessionFile?: string } | undefined): Registration | undefined {
	const file = caller?.sessionFile;
	if (file && file.length > 0) {
		for (const registration of registrations) {
			if (registration.sessionFile() === file) return registration;
		}
	}
	return registrations.size === 1 ? [...registrations][0] : undefined;
}

/**
 * Any live instance, for a process-wide read. Every instance builds the same child factory, so
 * which one answers is immaterial — which is what makes a grandchild work.
 */
function any(): Registration | undefined {
	return registrations.values().next().value;
}

/**
 * Drop registrations whose session file has not been written for longer than `maxAgeMs`. Hygiene,
 * not correctness: a session that is doing anything keeps a fresh mtime, and a session that is not
 * is already served by any other instance. Returns how many went.
 */
export function pruneRegistrations(maxAgeMs: number): number {
	const now = Date.now();
	let removed = 0;
	for (const registration of [...registrations]) {
		const file = registration.sessionFile();
		if (!file || file.length === 0) continue;
		let mtime: number;
		try {
			mtime = fs.statSync(file).mtimeMs;
		} catch {
			// The file is gone; nothing can be waiting on this registration's facts.
			registrations.delete(registration);
			removed++;
			continue;
		}
		if (now - mtime > maxAgeMs) {
			registrations.delete(registration);
			removed++;
		}
	}
	return removed;
}

/**
 * Publish an instance and return the function that withdraws it. Idempotent, because shutdown paths
 * can run more than once.
 */
export function registerRsiSeam(options: {
	work: RsiSeamWork;
	/**
	 * This instance's session file, or a getter for it. A getter lets the facade be published at
	 * load time — which is what makes the seam exist before any extension's `session_start` handler
	 * runs, whatever order the extensions were loaded in — while the session file is only known once
	 * the session starts.
	 */
	sessionFile?: string | (() => string | undefined);
}): () => void {
	const sessionFile =
		typeof options.sessionFile === "function" ? options.sessionFile : () => options.sessionFile as string | undefined;
	const registration: Registration = {
		work: options.work,
		sessionFile,
		children: new Set(),
		registeredAt: Date.now(),
	};
	registrations.add(registration);

	const facade: RsiSeam = {
		// Process-wide, like the store: any instance can hand out the child factory, because every
		// instance would build the same one. A grandchild resolves the same facade.
		childExtension: () => any()?.work.childExtension?.(),
		bindChild: (fact) => {
			// The fact belongs to the session it names, on the instance that owns that session — a
			// child's own instance, never its parent's. Falling back to this registration matters at
			// load time, when no session file is known yet.
			const owner = resolve({ sessionFile: fact.sessionFile }) ?? registration;
			owner.children.add(keyFor(fact.sessionFile));
		},
	};

	(globalThis as Record<symbol, unknown>)[RSI_REGISTRY_KEY] = facade;

	return () => {
		registrations.delete(registration);
		if (registrations.size === 0) delete (globalThis as Record<symbol, unknown>)[RSI_REGISTRY_KEY];
	};
}

/**
 * The published facade, or `undefined` when no RSI instance is live.
 *
 * The shape check is anchored on the two child members, which are the whole of what rlm may call.
 * There is deliberately **no fallback scan** over `Object.getOwnPropertySymbols` looking for a
 * symbol whose description matches `/rsi/i`: the `Symbol.for` key above *is* the agreed contract,
 * and a scan is the consumer guessing at the provider's identity on every `session_start`.
 */
export function findRsiSeam(): RsiSeam | undefined {
	const candidate = (globalThis as Record<symbol, unknown>)[RSI_REGISTRY_KEY];
	if (!candidate) return undefined;
	const shaped = candidate as Partial<RsiSeam>;
	return typeof shaped.childExtension === "function" && typeof shaped.bindChild === "function"
		? (candidate as RsiSeam)
		: undefined;
}

/**
 * Whether a session was bound as a child.
 *
 * Read lazily, at pass and settle time, by the three places that used to consult a spawn-time
 * descriptor. Before any bind the answer is `false`, which is correct by construction: a session RSI
 * reaches without a bind is not a child — a spawned child is built by `childExtension()` and bound
 * in the same `session_start`, and a resumed child is bound by rlm.
 */
export function isChildSession(sessionFile: string | undefined): boolean {
	const key = keyFor(sessionFile);
	for (const registration of registrations) if (registration.children.has(key)) return true;
	return false;
}

/** One line for the session log, so a missing seam is visible rather than mysterious. */
export function rsiSeamStatus(): string {
	if (registrations.size === 0) return "rsi seam: no instance published";
	return `rsi seam: ${registrations.size} instance(s) published`;
}

/** Test seam: the number of live registrations. */
export function __seamSizeForTests(): number {
	return registrations.size;
}

/** Test seam: forget every registration, so one test cannot leak into the next. */
export function __resetSeamForTests(): void {
	registrations.clear();
	delete (globalThis as Record<symbol, unknown>)[RSI_REGISTRY_KEY];
}
