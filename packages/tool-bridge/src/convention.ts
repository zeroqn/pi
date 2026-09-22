/**
 * The tool bridge — the contract by which an extension offers its pi tools to a code-mode
 * kernel, and the session-scoped record of what that kernel can actually call.
 *
 * ## The problem
 *
 * A code-mode session drives the model through one tool: code mode resets pi's active set to
 * `["python"]`, and pi resolves a tool call against the active list. Every other extension's
 * tools stay registered but unreachable, so Magic Context's `ctx_reduce` answers "Tool
 * ctx_reduce not found" in exactly the sessions where the model is doing the most work. Host
 * functions are the way in — a contributed host function is callable from a cell by bare
 * name, which is how rlm's delegation vocabulary already reaches the kernel.
 *
 * ## What a publisher does (no dependency on this package)
 *
 * Publishing is a **duplicated literal**, not an import: an owner writes its offer into the
 * slot below. A vendor bundle built in another checkout cannot resolve a private workspace
 * package, and the reader must not know owners by name — so the two sides agree on a symbol
 * and a shape instead:
 *
 * ```js
 * const slot = (globalThis[Symbol.for("pi-tool-bridge:owners")] ??= new Map())
 * slot.set("<instance key>", {
 *   owner: "my-extension",
 *   apiVersion: 1,
 *   catalogue: (ctx) => [{ name, description, snippet, parameters }],
 *   execute: (name, params, ctx) => result,
 * })
 * ```
 *
 * - **`catalogue(ctx)` answers for one session**: the tools *this* session may call, or `[]`
 *   when the owner serves no such session. It must be the same set `execute` accepts — the
 *   reader advertises what the catalogue returned and nothing else, so a listed name is a
 *   name that works.
 * - **`execute(name, params, ctx)`** runs the owner's own call path and returns a result
 *   shaped like pi's (`{ content: [{ type: "text", text }], isError? }`).
 * - **Publish only tools whose effect lives in `execute`.** A tool whose effect pi's dispatch
 *   produces — the transcript, an overlay, a renderer — must not be published: called from a
 *   cell it would appear to succeed and do nothing. Magic Context's `todowrite` is the live
 *   example, and it stays a pi tool.
 *
 * Publishing is **keyed by instance and replaces**: pi's jiti loader re-imports an extension
 * entry per session while `globalThis` survives, so an appending publish would leave one live
 * publication per import. Two owners, or two instances of one owner, coexist under different
 * keys, and each answers only for the sessions it serves.
 *
 * ## What the reader guarantees
 *
 * - A publication whose `apiVersion` is not this major is refused whole, with a reason.
 * - A malformed *entry* is dropped; the owner's other entries still work.
 * - The first owner to publish a tool name holds it. A second owner claiming that name is
 *   refused whole, so names are never qualified and a cell always writes
 *   `tool("ctx_search", query="…")`.
 * - Nothing here touches pi's active set. That is the surface rule in `adapter.ts`, and it
 *   strips a name only when a cell route for it was actually installed.
 */
import { resolve } from "node:path";

/**
 * Where owners publish. Duplicated as a literal by every publisher, on purpose (see above).
 */
export const OWNERS_SYMBOL = Symbol.for("pi-tool-bridge:owners");

/** The session records this package keeps: which pi tool names a cell can call, per session. */
export const SESSIONS_SYMBOL = Symbol.for("pi-tool-bridge:sessions");

/** The publication shape's version. A reader refuses any other major. */
export const API_VERSION = 1;

/** This package's name in the contribution ledger and in the model's instructions. */
export const READER = "pi-tool-bridge";

/** One tool as a reader needs to describe it. Every field but `name` is optional. */
export type BridgeToolEntry = {
	name: string;
	/** The text pi would show for this tool. */
	description?: string;
	/** The one line a catalogue listing renders. Falls back to `description`. */
	snippet?: string;
	/** The published parameter schema; only its property names are read. */
	parameters?: unknown;
};

export type BridgePublication = {
	owner: string;
	apiVersion: number;
	catalogue: (ctx: unknown) => BridgeToolEntry[];
	execute: (
		name: string,
		params: Record<string, unknown>,
		ctx: unknown,
	) => Promise<unknown>;
};

export type SlotOwner = { key: string; publication: BridgePublication };

/** What a session's kernel can call, and who published it. Written only on a real install. */
export type BridgedSession = { toolNames: string[]; owners: string[] };

function ownersSlot(): Map<string, BridgePublication> {
	const holder = globalThis as Record<symbol, unknown>;
	const existing = holder[OWNERS_SYMBOL];
	if (existing instanceof Map) {
		return existing as Map<string, BridgePublication>;
	}
	const created = new Map<string, BridgePublication>();
	holder[OWNERS_SYMBOL] = created;
	return created;
}

function sessionsSlot(): Map<string, BridgedSession> {
	const holder = globalThis as Record<symbol, unknown>;
	const existing = holder[SESSIONS_SYMBOL];
	if (existing instanceof Map) return existing as Map<string, BridgedSession>;
	const created = new Map<string, BridgedSession>();
	holder[SESSIONS_SYMBOL] = created;
	return created;
}

/**
 * Every live publication, in a stable order so a test (and a session's instructions) read the
 * same catalogue twice. Sorted by instance key rather than insertion order, because insertion
 * order is a function of which session pi happened to load first.
 */
export function publications(): SlotOwner[] {
	return [...ownersSlot().entries()]
		.map(([key, publication]) => ({ key, publication }))
		.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * The session key, taken from `ctx.sessionManager` and never from the `ctx` object: pi hands
 * out a fresh context per call, so ctx identity is not stable across two handlers in one bind.
 * An unpersisted session keys on the session manager's identity instead.
 *
 * The adopter and the surface rule must both use *this* function. They are the two halves of
 * one fact — "this session has a cell route to these names" — and a second derivation would
 * silently stop matching.
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
 * Records that this session's kernel can call these names. Called by the adopter **after** the
 * contribution was accepted — the surface rule strips a pi tool only when a cell route exists,
 * and a record written before acceptance would strip a tool whose route never appeared.
 */
export function recordBridged(key: string, record: BridgedSession): void {
	sessionsSlot().set(key, {
		toolNames: [...new Set(record.toolNames)],
		owners: [...new Set(record.owners)],
	});
}

export function bridgedSession(key: string): BridgedSession | undefined {
	return sessionsSlot().get(key);
}

/** Clears one session's record. `globalThis` outlives `/new`, resume and fork, so a session
 * that ends must take its record with it. */
export function forgetSession(key: string): void {
	sessionsSlot().delete(key);
}

/** Test seam: forget every record and drop every publication this process holds. */
export function __resetToolBridgeForTests(): void {
	ownersSlot().clear();
	sessionsSlot().clear();
	nextUnpersisted = 0;
	unpersistedStore = undefined;
}
