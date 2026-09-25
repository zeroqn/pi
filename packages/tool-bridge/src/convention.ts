/**
 * The tool bridge's publication convention — how an owner offers its pi tools, and where the reader
 * finds them (wayfinder map `.scratch/tool-bridge/`).
 *
 * ## What a publisher does (no dependency on this package)
 *
 * Publishing is a **duplicated literal**, not an import: an owner writes its offer into the slot
 * below. A vendor bundle built in another checkout cannot resolve a private workspace package, and the
 * reader must not know owners by name — so the two sides agree on a symbol and a shape instead:
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
 * - **`catalogue(ctx)` answers for one session**: the tools *this* session may call, or `[]` when the
 *   owner serves no such session. It must be the same set `execute` accepts.
 * - **`execute(name, params, ctx)`** runs the owner's own call path and returns pi's result shape.
 * - **Publish only tools whose effect lives in `execute`.** A tool whose state pi captures from its
 *   own dispatch must not be published: called from a cell it would appear to succeed and do nothing.
 *
 * Publishing is **keyed by instance and replaces**: pi's jiti loader re-imports an extension entry per
 * session while `globalThis` survives, so an appending publish would leave one publication per import.
 *
 * ## What moved out of this package (`.scratch/host-bridge` ticket 05)
 *
 * The session **record** — which pi tool names a cell can reach — is `pi-host-bridge`'s now, because
 * that package owns the composition and is what sees the ledger's receipt before it records anything.
 * This package reads it (`sessionRecord(sessionKey(ctx))?.reaches`) and writes nothing.
 */
import { resolve } from "node:path";

/**
 * Where owners publish. Duplicated as a literal by every publisher, on purpose (see above).
 */
export const OWNERS_SYMBOL = Symbol.for("pi-tool-bridge:owners");

/** The publication shape's version. A reader refuses any other major. */
export const API_VERSION = 1;

/** This package's name in the ledger, in the model's instructions and in the session's record. */
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
 * The session key — **one derivation for the workspace**, owned by `pi-host-bridge`
 * (`.scratch/host-bridge/` ticket 02).
 *
 * The rule this function was written under still holds: the adopter and the surface rule are two
 * halves of one fact — "this session has a cell route to these names" — so they must key their records
 * identically. The derivation now has to be shared with the composition root and code mode's client as
 * well, so it moved to the package that owns both and this re-export keeps every existing reader on
 * the same function.
 */
export { sessionKey } from "../../host-bridge/src/convention";

/**
 * Test seam: drop every publication this process holds.
 *
 * The session records are `pi-host-bridge`'s now (`__resetHostBridgeForTests`), which is why a test
 * that needs both calls both.
 */
export function __resetToolBridgeForTests(): void {
	ownersSlot().clear();
}
