/**
 * engine — code mode's `search` slot, answered from FFF's index.
 *
 * ## Two lanes, and the cell picks one
 *
 * | a cell writes | matched by | ordered by |
 * |---|---|---|
 * | `grep(p)` / `find(g)` | rg / fd | theirs |
 * | `grep(p, index=True)` | **the index, with rg's matcher** (`literal`/`ignore_case`) | code mode: path, then line |
 * | `grep(p, fuzzy=True)` | FFF's fuzzy matcher | FFF: frecency |
 *
 * `index` is the fast *exact* lane: rg's matcher, from an index that does not walk the tree. Its result set
 * is rg's **over the paths the index covers** — measured on a dot-free subtree at 7 = 7 matches, 0 missing,
 * 0 extra, and 20× the speed; over the workspace root it is the same minus the dot-path hits, which is the
 * one thing the index cannot see (see below). `fuzzy` is the lane for a question that is not exact at all —
 * a half-remembered name — and implies `index`.
 *
 * Nothing else answers from the index, and the engine **throws** when it is asked something outside those
 * two lanes: code mode catches and rg/fd answer, so the default primitive keeps answering exactly what it
 * answered before this package existed.
 *
 * ## Why the exact lane is a lane and not the default
 *
 * **FFF's index does not cover dot-paths**, while the base's rg/fd are run with `--hidden`. A file under
 * `.hidden/` is unreachable by *every* FFF spelling — fuzzy search, a recursive glob, an explicit `.hidden/`
 * path — and `grep` finds no content inside it (measured, `.scratch/fff-search/tools/hidden-probe.ts`). A
 * silent swap would therefore have narrowed every answer that touched `.scratch/`, `.github/` or `.env`,
 * which in this workspace is where the notes live. So the index is asked for, never assumed — and a caller
 * that asks for it is asking for the index's coverage, which is the one thing the flag cannot widen.
 *
 * ## What it declines, and why each is a measurement
 *
 * - **no lane** — `fuzzy` and `index` both absent.
 * - **no slot** — `pi-fff` is not loaded in this process, so there is no index to answer from.
 * - **a dot-path in `path` or `glob`** (and, for `find`, in the pattern itself, which *is* a path glob) —
 *   the index cannot see inside it, and answering "nothing" where rg finds matches is the worst outcome this
 *   design exists to prevent.
 * - **`ignore_case` over a pattern with an uppercase letter** — the SDK exposes `smartCase` alone, whose
 *   `false` is case-*sensitive* and whose `true` is case-insensitive only for an all-lowercase pattern; an
 *   always-case-insensitive search is not expressible, and answering case-sensitively would be wrong.
 * - **a regex the index cannot compile** — FFF falls back to literal matching and reports it in
 *   `regexFallbackError`; a cell that wrote `a(b` or `(?=x)` must get rg's loud failure, not an empty set.
 * - **`find`'s `max_depth`**, an **fd-only `type`**, and a **pattern matching files *and* directories** —
 *   the index's exact matcher enumerates files only, so answering would silently drop the directories fd
 *   returns.
 */
import { isAbsolute, join, relative as pathRelative, sep } from "node:path";

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

/** The `find` type spellings the index can serve; everything fd knows beyond these declines. */
const FILE_TYPES = new Set(["file", "f"]);
const DIRECTORY_TYPES = new Set(["directory", "dir", "d"]);

/** Why an answer left the index lane, phrased for the session record when a caller reports it. */
export const DECLINED = {
	noLane: "grep/find answer from the index only when the cell asks for it (index=True for an exact search, fuzzy=True for the engine's own matching)",
	noSlot: "pi-fff is not loaded in this process, so there is no index to answer from",
	dotPath: "the index does not cover dot-paths, so a query that names one is answered by rg/fd",
	maxDepth: "the index has no maximum-depth search, so this is answered by fd",
	type: "the index enumerates files and directories only, so this type is answered by fd",
	directoryExact:
		"the index can enumerate directories only by fuzzy name, so an exact directory listing is answered by fd",
	anyType:
		"files and directories together are exact only on a walk, so this is answered by fd",
	caseInsensitive:
		"the index can be case-insensitive only for an all-lowercase pattern, so this one is answered by rg",
	regexUncompiled: "the index could not compile this pattern as a regular expression, so it is answered by rg, which fails loudly instead",
	outsideRoot: "the finder covering this question does not contain the path it names, so it is answered by fd",
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
		if (!query.index && !query.fuzzy) throw new Error(DECLINED.noLane);
		const mode = query.fuzzy ? "fuzzy" : query.literal ? "plain" : "regex";
		const api = slot();
		const constraint = includeConstraint(query);
		if (namesDotPath(constraint, cwd)) throw new Error(DECLINED.dotPath);
		if (mode !== "fuzzy" && query.ignoreCase && hasUppercase(query.pattern)) {
			throw new Error(DECLINED.caseInsensitive);
		}

		const route = await api.route({
			cwd,
			path: constraint,
			pattern: query.pattern,
			exclude: excludeConstraint(query.glob),
		});
		await settle(route.finder);
		// Both bounds come from the cell's limit: rg's `-m` is per-file and code mode cuts the total, so
		// mirroring the per-file cap is what keeps "how many did I ask for" meaning the same thing.
		const bounds = {
			maxMatchesPerFile: query.limit,
			pageSize: query.limit,
			// Context lines are not part of a `Match` (the base's rg prints them, its parser drops them),
			// so asking for them changes nothing a cell sees — and costs nothing to pass through.
			beforeContext: query.context,
			afterContext: query.context,
		};
		const result = route.finder.grep(
			route.query,
			// `smartCase: false` is FFF's *sensitive*, and the fuzzy lane is left to FFF's own default so
			// that `ignore_case` stays a knob of the exact lane alone.
			mode === "fuzzy" ? { mode, ...bounds } : { mode, smartCase: query.ignoreCase, ...bounds },
		);
		if (!result.ok) throw new Error(`fff grep failed: ${result.error}`);
		if (mode === "regex" && result.value.regexFallbackError) {
			throw new Error(`${DECLINED.regexUncompiled}: ${result.value.regexFallbackError}`);
		}
		return result.value.items.map((item) => ({
			// Trailing space is rg's own trimming; without it the two engines' text differs by whitespace.
			path: displayPath(item.relativePath, route.root, query.path, cwd),
			line: item.lineNumber,
			text: item.lineContent.trimEnd(),
		}));
	}

	async function find(query: KernelFindQuery): Promise<string[]> {
		if (!query.index && !query.fuzzy) throw new Error(DECLINED.noLane);
		const directories = DIRECTORY_TYPES.has(query.type);
		const files = FILE_TYPES.has(query.type);
		// The empty type is fd's "files and directories", which only a walk answers exactly.
		if (!directories && !files && query.type !== "") throw new Error(DECLINED.type);
		if (query.maxDepth > 0) throw new Error(DECLINED.maxDepth);
		// A `find` pattern *is* a path glob, so a dot-path in it is unanswerable here, exactly as one in
		// `path` is — `find(".scratch/*")` must not come back empty from an index that cannot see the
		// directory. `grep`'s pattern is content, so only its constraint is checked.
		if (namesDotPath(query.pattern, cwd) || namesDotPath(query.path, cwd)) {
			throw new Error(DECLINED.dotPath);
		}
		const api = slot();

		const route = await api.route({ cwd, path: query.path, pattern: query.pattern });
		await settle(route.finder);
		const options = { pageSize: query.limit };
		if (query.fuzzy) {
			// The fuzzy lane asks for the engine's own finding, and for the empty type that is FFF's mixed
			// result — files *and* directories, which is the question fd would have been asked.
			const result = directories
				? route.finder.directorySearch(route.query, options)
				: files
					? route.finder.fileSearch(route.query, options)
					: route.finder.mixedSearch(route.query, options);
			if (!result.ok) throw new Error(`fff find failed: ${result.error}`);
			// A directory's trailing `/` is the convention both fd and FFF print, and it survives.
			return result.value.items.map((item) =>
				displayPath(mixedPath(item), route.root, query.path, cwd),
			);
		}

		// The exact lane. The index's glob matcher takes **one** npm-glob pattern, not the space-joined
		// constraint dialect `grep` parses — measured: `glob("src/ *.ts")` and `glob("*.ts !test/")` both
		// answer nothing, while `glob("src/*.ts")` answers, at any depth, which is fd's own `--glob` reach.
		// So the constraint is rebuilt here from the finder's *reported* root, the same rebase the publisher
		// applies for `grep`. `glob` enumerates files only, and the only directory call the index has is
		// fuzzy, so a directory listing (or the empty type, which means files *and* directories) declines
		// rather than answering with a narrower set in silence.
		if (directories) throw new Error(DECLINED.directoryExact);
		if (!files) throw new Error(DECLINED.anyType);
		const glob = [prefixWithin(route.root, query.path, cwd), query.pattern].filter(Boolean).join("/");
		const result = route.finder.glob(glob, options);
		if (!result.ok) throw new Error(`fff find failed: ${result.error}`);
		return result.value.items.map((item) => displayPath(item.relativePath, route.root, query.path, cwd));
	}

	return { grep, find };
}

/** A CSV-ish uppercase test, Unicode-aware so it agrees with the Rust `is_uppercase` FFF is deciding with. */
function hasUppercase(pattern: string): boolean {
	return /\p{Lu}/u.test(pattern);
}

/**
 * `path` and a positive `glob`, as the one path-ish constraint FFF's parser reads.
 *
 * The slot takes one constraint plus exclusions, and a glob *is* a constraint to that parser
 * (`normalizePathConstraint` passes a bare extension glob, a nested recursive glob and a brace set
 * through untouched), so joining keeps `path="src"` + `glob="*.ts"` meaning `src/*.ts` instead of
 * silently dropping half the question. A negated glob is not joined: it is an exclusion, and goes to
 * `exclude` below.
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
 * The requested path, as a prefix under the finder's own root — `""` when the root *is* the path, and the
 * caller's guard when the two do not nest at all.
 *
 * The finder that answers may be rooted above the session (`pi-fff`'s auxiliary pool hands out a covering
 * entry), which is why this is computed against `route.root` rather than the session's `cwd`.
 */
function prefixWithin(root: string, path: string, cwd: string): string {
	const absolute = isAbsolute(path) ? path : join(cwd, path);
	const local = pathRelative(root, absolute);
	if (local === "" || local === ".") return "";
	if (local.startsWith("..") || isAbsolute(local)) throw new Error(DECLINED.outsideRoot);
	return local.split(sep).join("/");
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

/**
 * The path of a mixed-search item, whichever kind it is.
 *
 * `mixedSearch` answers a tagged union (files and directories in one list), and the path is one level in
 * for both kinds — which is the same shape `FileItem` and `DirItem` do not share with each other.
 */
function mixedPath(item: unknown): string {
	const tagged = item as { type?: string; item?: { relativePath?: string }; relativePath?: string };
	return tagged.item?.relativePath ?? tagged.relativePath ?? "";
}
