/**
 * slot — the finder `pi-fff` publishes for another entry in this process.
 *
 * pi loads each extension entry through its own jiti instance (`moduleCache: false`), so this is a
 * `Symbol.for` rendezvous with the literal duplicated on both sides, never an import: an import would be
 * a second module instance, a second index and a second watcher over the same tree. The publish side
 * writes the same key at its `session_start` (fork commit `927521b`, `zeroqn/fff#pi`).
 *
 * Read at **call time**, never captured: pi re-imports an entry while `globalThis` survives, and the
 * finder belongs to a session — a captured one would answer after its session ended, from an index that
 * no longer exists.
 */
export const FINDER_SLOT = Symbol.for("pi-fff:finder");

/** The slot shape this package reads. Refused whole on any other major: a route that changed is worse than none. */
export const REQUIRED_FINDER_API_VERSION = 1;

/** One item of `grep`'s answer, as far as this package reads it. */
export type SlotGrepItem = {
	relativePath: string;
	lineNumber: number;
	lineContent: string;
};

/** One item of `glob`/`fileSearch`/`directorySearch`: `relativePath`, with a directory's trailing `/`. */
export type SlotPathItem = { relativePath: string };

/** FFF's answer envelope: `ok` is a discriminant, and a failure carries the reason. */
export type SlotResult<T> =
	| { ok: true; value: { items: T[]; regexFallbackError?: string } }
	| { ok: false; error: string };

/** The calls this engine makes, narrowed to what it uses. */
export type SlotFinder = {
	grep(query: string, options: Record<string, unknown>): SlotResult<SlotGrepItem>;
	/** FFF's own glob matcher — a plain pattern, not the constraint dialect `grep` parses (see `engine.ts`). */
	glob(query: string, options: Record<string, unknown>): SlotResult<SlotPathItem>;
	fileSearch(query: string, options: Record<string, unknown>): SlotResult<SlotPathItem>;
	directorySearch(query: string, options: Record<string, unknown>): SlotResult<SlotPathItem>;
	/** Files and directories in one list, each tagged; FFF's own shape, so the engine reads a union. */
	mixedSearch(query: string, options: Record<string, unknown>): SlotResult<unknown>;
	/**
	 * Resolves on timeout too, so the result says whether the index *became* ready rather than whether the
	 * wait ended — and this engine ignores it either way, answering from whatever is indexed.
	 */
	waitForIndexReady?(timeoutMs?: number): Promise<unknown>;
};

/** What one question is answered from: the covering finder, its root, and the FFF query for the question. */
export type SlotRoute = { finder: SlotFinder; query: string; root: string };

/** What `pi-fff` publishes. */
export type SlotApi = {
	apiVersion: number;
	activeCwd: () => string;
	/**
	 * The finder covering a root, and the query for one question.
	 *
	 * The publisher owns the choice: its own `cwd` answers from the finder it already holds, and anything
	 * else — another session's cwd, or a `path` that leaves this one — goes through its auxiliary pool
	 * rather than destroying and rescanning the session's index.
	 */
	route: (input: {
		cwd: string;
		path?: string;
		pattern: string;
		exclude?: string | string[];
	}) => Promise<SlotRoute>;
};

/**
 * The live slot, or `null` when there is none to read.
 *
 * `null` is not an error: it is the ordinary state of a process where `pi-fff` is not installed (or has
 * removed its finder on session shutdown), and it is what makes the engine decline rather than answer
 * from nothing.
 */
export function readFinderSlot(glob: Record<symbol, unknown> = globalThis as unknown as Record<symbol, unknown>): SlotApi | null {
	const api = glob[FINDER_SLOT] as SlotApi | null | undefined;
	if (!api || typeof api !== "object") return null;
	if (api.apiVersion !== REQUIRED_FINDER_API_VERSION) return null;
	if (typeof api.route !== "function") return null;
	return api;
}
