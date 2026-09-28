/**
 * engine — code mode's `search` slot, answered from FFF's index.
 *
 * ## Which questions it answers
 *
 * Only the ones a cell *asked the index for*: `fuzzy=True` on `grep`/`find` (`.scratch/fff-search`
 * ticket 06, decision B). Everything else **throws**, which is not a failure path but the design — code
 * mode catches and rg/fd answer, so the default primitive keeps answering exactly what it answered
 * before this package existed.
 *
 * The reason is measured, not cautious: **FFF's index does not cover dot-paths**, while the base's rg/fd
 * are run with `--hidden`. A file under `.hidden/` is unreachable by *every* FFF spelling — fuzzy search,
 * a recursive glob, an explicit `.hidden/` path — and `grep` finds no content inside it. So FFF and rg do
 * not answer the same question, and the difference is silent — which is the one thing a swap must not be.
 * A cell that wants the index's speed says so; a cell that wants the old answer set says nothing.
 *
 * ## What the flag selects
 *
 * FFF's own matching and ordering, as the slot's contract says: `grep` runs in FFF's `fuzzy` mode with
 * FFF's frecency order (code mode then does not re-sort a `fuzzy` answer), and `find` uses FFF's fuzzy
 * file/directory search. `literal` and `ignore_case` are the rg/fd lane's knobs — they select a matcher,
 * and the FFF lane's matcher is FFF's. (Measured: the SDK exposes only `smartCase`, whose `false` is
 * *case-sensitive* and `true` is smart-case, so an always-case-insensitive plain search is not
 * expressible in that lane at all.)
 *
 * ## What it declines
 *
 * - no `fuzzy` — the lane was not asked for;
 * - no slot — `pi-fff` is not loaded in this process;
 * - a path or glob constraint that names a **dot-path** — the index cannot see inside it, and answering
 *   "nothing" where rg would answer with matches is the worst outcome this whole design is avoiding;
 * - `find`'s `max_depth`, and any `type` but file/directory — fd's own knobs, with no FFF equivalent.
 */
import { isAbsolute, join, relative as pathRelative } from "node:path";

import type {
	KernelFindQuery,
	KernelGrepQuery,
	KernelMatch,
	KernelSearchEngine,
} from "../../host-bridge/src/client.ts";

import { readFinderSlot, type SlotApi, type SlotFinder } from "./slot.ts";

/**
 * How long an answer waits for a cold index.
 *
 * `waitForIndexReady` resolves on timeout as well, so this is a ceiling rather than a promise: a cell
 * blocks at most this, and answers from whatever is indexed. Deliberately far below the extension's own
 * 15 s scan timeout — a cell is not a picker, and a partial answer with a second route to the same
 * question (rg) beats a long wait.
 */
export const INDEX_WAIT_MS = 4000;

/** The `find` type spellings FFF can enumerate; everything fd knows beyond these declines. */
const FILE_TYPES = new Set(["", "file", "f"]);
const DIRECTORY_TYPES = new Set(["directory", "dir", "d"]);

/** Why an answer left the index lane, phrased for the session record when a caller reports it. */
export const DECLINED = {
	notAsked: "grep/find answer from the index only when the cell asks for it (fuzzy=True)",
	noSlot: "pi-fff is not loaded in this process, so there is no index to answer from",
	dotPath: "the index does not cover dot-paths, so a query that names one is answered by rg/fd",
	maxDepth: "the index has no maximum-depth search, so this is answered by fd",
	type: "the index enumerates files and directories only, so this type is answered by fd",
} as const;

export type EngineInput = {
	/** The session's directory: every question is asked relative to it, as the primitives ask rg/fd. */
	cwd: string;
	/** Test seam. Defaults to the process-global slot. */
	readSlot?: () => SlotApi | null;
};

/**
 * The engine code mode's `search` slot takes.
 *
 * Every question goes through `route`, so the publisher — never this package — decides which finder
 * answers: its own `cwd` reuses the warm one, and anything else is a pool entry.
 */
export function createSearchEngine(input: EngineInput): KernelSearchEngine {
	const read = input.readSlot ?? (() => readFinderSlot());
	const cwd = input.cwd;

	function slot(): SlotApi {
		const api = read();
		if (!api) throw new Error(DECLINED.noSlot);
		return api;
	}

	/** A bounded wait for a cold index; a failure to become ready is not a failure to answer. */
	async function settle(finder: SlotFinder): Promise<void> {
		try {
			await finder.waitForIndexReady?.(INDEX_WAIT_MS);
		} catch {
			/* whatever is indexed answers */
		}
	}

	async function grep(query: KernelGrepQuery): Promise<KernelMatch[]> {
		if (!query.fuzzy) throw new Error(DECLINED.notAsked);
		const api = slot();
		const constraint = includeConstraint(query);
		if (namesDotPath(constraint, cwd)) throw new Error(DECLINED.dotPath);

		const route = await api.route({
			cwd,
			path: constraint,
			pattern: query.pattern,
			exclude: excludeConstraint(query.glob),
		});
		await settle(route.finder);
		const result = route.finder.grep(route.query, {
			mode: "fuzzy",
			// Both bounds come from the cell's limit: rg's `-m` is per-file and code mode cuts the total,
			// so mirroring the per-file cap is what keeps "how many did I ask for" meaning the same thing.
			maxMatchesPerFile: query.limit,
			pageSize: query.limit,
			// Context lines are not part of a `Match` (the base's rg prints them, its parser drops them),
			// so asking for them changes nothing a cell sees — and costs nothing to pass through.
			beforeContext: query.context,
			afterContext: query.context,
		});
		if (!result.ok) throw new Error(`fff grep failed: ${result.error}`);
		return result.value.items.map((item) => ({
			// Trailing space is rg's own trimming; without it the two engines' text differs by whitespace.
			path: displayPath(item.relativePath, route.root, query.path, cwd),
			line: item.lineNumber,
			text: item.lineContent.trimEnd(),
		}));
	}

	async function find(query: KernelFindQuery): Promise<string[]> {
		if (!query.fuzzy) throw new Error(DECLINED.notAsked);
		if (query.maxDepth > 0) throw new Error(DECLINED.maxDepth);
		const directories = DIRECTORY_TYPES.has(query.type);
		if (!directories && !FILE_TYPES.has(query.type)) throw new Error(DECLINED.type);
		const api = slot();
		if (namesDotPath(query.path, cwd)) throw new Error(DECLINED.dotPath);

		const route = await api.route({ cwd, path: query.path, pattern: query.pattern });
		await settle(route.finder);
		const options = { pageSize: query.limit };
		const result = directories
			? route.finder.directorySearch(route.query, options)
			: route.finder.fileSearch(route.query, options);
		if (!result.ok) throw new Error(`fff find failed: ${result.error}`);
		// A directory's trailing `/` is the convention both fd and FFF print, and it survives.
		return result.value.items.map((item) =>
			displayPath(item.relativePath, route.root, query.path, cwd),
		);
	}

	return { grep, find };
}

/**
 * `path` and a positive `glob`, as the one path-ish constraint FFF's parser reads.
 *
 * The slot takes one constraint plus exclusions, and a glob *is* a constraint to that parser
 * (`normalizePathConstraint` passes a bare extension glob, a nested recursive glob and a brace set
 * through untouched), so joining
 * keeps `path="src"` + `glob="*.ts"` meaning `src/*.ts` instead of silently dropping half the question.
 * A negated glob is not joined: it is an exclusion, and goes to `exclude` below.
 */
function includeConstraint(query: KernelGrepQuery): string {
	const glob = query.glob;
	if (!glob || glob.startsWith("!")) return query.path;
	if (!query.path || query.path === ".") return glob;
	return join(query.path, glob);
}

/** rg's negated `--glob` is FFF's `!constraint`; a positive one was joined into the path above. */
function excludeConstraint(glob: string | null): string | undefined {
	return glob && glob.startsWith("!") ? glob.slice(1) : undefined;
}

/**
 * Does this constraint name a dot-path?
 *
 * The one question the index cannot answer: FFF was built as an interactive file picker and skips
 * dot-entries, so `.scratch/`, `.github/` and `.env` are invisible to it in every spelling. An absolute
 * constraint is reduced against the session directory first, so a workspace that merely *lives* under a
 * dot-directory (pi's own agent directory, say) is not mistaken for a query about one.
 */
export function namesDotPath(constraint: string, cwd: string): boolean {
	const local = isAbsolute(constraint) ? insideCwd(constraint, cwd) : constraint;
	return local
		.split(/[\\/]/)
		.some((segment) => segment.startsWith(".") && segment !== "." && segment !== "..");
}

/** A constraint as the session directory sees it; an absolute one outside it is kept as it is. */
function insideCwd(constraint: string, cwd: string): string {
	const local = pathRelative(cwd, constraint);
	return isAbsolute(local) ? constraint : local;
}

/**
 * The path a cell reads, in the form rg would have printed.
 *
 * The base runs rg with `cwd` set to the session directory and the requested path as it was given, so an
 * absolute request answers with absolute paths and a relative one with paths relative to the session
 * directory — a question about `../other` comes back as `../other/x.ts`. Matching that here is what
 * keeps a cell from telling the two engines apart by the shape of the answer.
 */
function displayPath(relativePath: string, root: string, requested: string, cwd: string): string {
	const joined = join(root, relativePath);
	// `join` keeps one trailing separator of its own, so a directory's `/` is added only when it is
	// missing — otherwise it would be doubled.
	const absolute = relativePath.endsWith("/") && !joined.endsWith("/") ? `${joined}/` : joined;
	return isAbsolute(requested) ? absolute : pathRelative(cwd, absolute);
}
