/**
 * The two host functions a code-mode cell calls (`.scratch/zvec-grep` ticket 01, Q8/Q9).
 *
 *     hits = await zvec_grep_search(query="where is auth validated", limit=7)
 *     lines = await zvec_grep_rg("rg -n -F loadTheme -g '*.ts' src | head -40")
 *
 * Three things about the boundary are worth stating where they are enforced, because each is a decision:
 *
 *  - **Text in, text out.** `zg` has no machine format (`--human` and "agent markdown" are its two
 *    renderings), so the return is what it printed, bounded, with the multi-root headers. A *partial*
 *    failure is text that names the roots that failed; only a total failure raises, and it raises
 *    `RuntimeError` — monty maps a thrown JS error onto a Python exception by `.name`.
 *  - **The validation moves here.** The old tools carried a typebox schema; a host function carries
 *    none, so an unknown key is a `ValueError` and a wrong type a `TypeError`, both *before* `zg` runs.
 *    A caller who passed a misspelled parameter believes it did something, which is the failure worth
 *    refusing rather than dropping.
 *  - **snake_case is the taught spelling; camelCase is accepted.** The tool's schema was camelCase
 *    (`fileTypes`, `preferSymbol`), the repo's other host functions are snake_case
 *    (`web_search(query, num_results, provider, domain_filter)`), and the tools were never callable in
 *    a live session — so the cell's spelling is the Python one and the old one still works.
 *
 * Nothing here reads `pi`: the extension reaches the host through `createZgCli`'s executor, which is
 * `spawn` and nothing else.
 */
import {
	RG_TIMEOUT_MS,
	SEARCH_TIMEOUT_MS,
	buildRgArgs,
	buildSearchArgs,
	createZgCli,
	formatRootResults,
	runAcrossRoots,
	tokenizeRgCommand,
	type SearchParams,
	type ZgCli,
} from "./cli.ts";
import { resolveTargetRoots } from "./config.ts";

export type ZvecGrepHostContext = {
	/** The session's directory: what `root` defaults to, and where the config's project source is read. */
	cwd: string;
	/** The running cell's progress sink, when there is one. */
	progress?: (text: string) => void;
	/** Test seam: the CLI, with an injected executor. */
	cli?: ZgCli;
	/**
	 * The **run's** own signal, read at call time from the session's kernel handle
	 * (`.scratch/long-work` ticket 08).
	 *
	 * A `zg` search is a foreground process the model is waiting on, so it is the run's work: when the
	 * turn is aborted, the executor kills the process group rather than leaving a search running for a
	 * cell nobody is watching. `spawnExec` has honoured a signal since it was written — it just had no
	 * way to be handed one: a contributor's host function is given no `pi`, which is why this package
	 * spawns for itself (`index.ts`).
	 *
	 * A thunk rather than a value because the signal belongs to the *call*, not to the session: the
	 * handle answers `undefined` between cells.
	 */
	signal?: () => AbortSignal | undefined;
};

type Kind = "string" | "strings" | "boolean" | "number" | "one-of";

/** One parameter: the cell's spelling, the old tool's spelling, and what shape survives validation. */
type Spec = { python: string; argv: string; alias?: string; kind: Kind; values?: readonly string[] };

const SEARCH_SPECS: readonly Spec[] = [
	{ python: "query", argv: "query", kind: "string" },
	{ python: "queries", argv: "queries", kind: "strings" },
	{ python: "fts", argv: "fts", kind: "strings" },
	{ python: "vector", argv: "vector", kind: "strings" },
	{ python: "fuse", argv: "fuse", kind: "boolean" },
	{ python: "limit", argv: "limit", kind: "number" },
	{ python: "globs", argv: "globs", kind: "strings" },
	{ python: "iglobs", argv: "iglobs", kind: "strings" },
	{ python: "file_types", argv: "fileTypes", alias: "fileTypes", kind: "strings" },
	{ python: "excluded_file_types", argv: "excludedFileTypes", alias: "excludedFileTypes", kind: "strings" },
	{
		python: "symbol_type",
		argv: "symbolType",
		alias: "symbolType",
		kind: "one-of",
		values: ["module", "class", "interface", "function", "value", "alias"],
	},
	{ python: "prefer_symbol", argv: "preferSymbol", alias: "preferSymbol", kind: "boolean" },
	{ python: "modified_after", argv: "modifiedAfter", alias: "modifiedAfter", kind: "string" },
	{ python: "modified_before", argv: "modifiedBefore", alias: "modifiedBefore", kind: "string" },
	{ python: "preview", argv: "preview", kind: "one-of", values: ["none", "short", "full"] },
	{ python: "refresh", argv: "refresh", kind: "one-of", values: ["background", "wait", "off"] },
	{ python: "mode", argv: "mode", kind: "one-of", values: ["direct", "server", "auto"] },
	{ python: "roots", argv: "roots", kind: "strings" },
	{ python: "root", argv: "root", kind: "string" },
];

const RG_SPECS: readonly Spec[] = [
	{ python: "command", argv: "command", kind: "string" },
	{ python: "roots", argv: "roots", kind: "strings" },
	{ python: "root", argv: "root", kind: "string" },
];

function fail(name: "TypeError" | "ValueError" | "RuntimeError", message: string): Error {
	const error = new Error(message);
	error.name = name;
	return error;
}

function coerce(fn: string, spec: Spec, value: unknown, from: string): unknown {
	if (value === undefined || value === null) return undefined;
	switch (spec.kind) {
		case "string":
			if (typeof value !== "string") throw fail("TypeError", `${fn}: "${from}" must be a string`);
			return value;
		case "strings": {
			if (!Array.isArray(value)) throw fail("TypeError", `${fn}: "${from}" must be a list of strings`);
			return value.map((entry) => {
				if (typeof entry !== "string") throw fail("TypeError", `${fn}: "${from}" must be a list of strings`);
				return entry;
			});
		}
		case "boolean":
			if (typeof value !== "boolean") throw fail("TypeError", `${fn}: "${from}" must be a boolean`);
			return value;
		case "number":
			if (typeof value !== "number" || !Number.isFinite(value))
				throw fail("TypeError", `${fn}: "${from}" must be a finite number`);
			return value;
		case "one-of":
			if (typeof value !== "string" || !spec.values?.includes(value))
				throw fail("ValueError", `${fn}: "${from}" must be one of ${(spec.values ?? []).join(", ")}`);
			return value;
	}
}

/**
 * Bind what monty handed over: the positionals, and Python's keyword arguments as one trailing plain
 * object (its *values* converted per monty's table — a dict would arrive as a `Map`, which cannot be a
 * value here, so it fails validation like any other wrong type).
 */
function bind(args: unknown[], fn: string, specs: readonly Spec[], primary: string): Record<string, unknown> {
	const list = [...args];
	let kwargs: Record<string, unknown> = {};
	const last = list[list.length - 1];
	if (last !== null && typeof last === "object" && !Array.isArray(last) && !Buffer.isBuffer(last)) {
		kwargs = list.pop() as Record<string, unknown>;
	}
	if (list.length > 1) {
		throw fail("ValueError", `${fn} takes at most one positional argument (the ${primary}), got ${list.length}`);
	}
	const byName = new Map<string, Spec>();
	for (const spec of specs) {
		byName.set(spec.python, spec);
		if (spec.alias) byName.set(spec.alias, spec);
	}
	const out: Record<string, unknown> = {};
	const take = (spec: Spec, value: unknown, from: string): void => {
		if (out[spec.python] !== undefined) {
			throw fail("ValueError", `${fn}: "${from}" and "${spec.python}" are the same parameter`);
		}
		out[spec.python] = coerce(fn, spec, value, from);
	};
	// A positional call puts its one argument on the primary parameter — `web_search("q", …)` is the
	// same shape, and `zvec_grep_search("where is auth validated")` should not need the name.
	if (list.length === 1) take(byName.get(primary)!, list[0], primary);
	for (const [key, value] of Object.entries(kwargs)) {
		const spec = byName.get(key);
		if (!spec) throw fail("ValueError", `${fn}: unknown parameter "${key}"`);
		take(spec, value, key);
	}
	return out;
}

/** The bound record, in the terms `buildSearchArgs` reads — `roots`/`root` are not `zg` flags. */
function searchParams(bound: Record<string, unknown>): SearchParams {
	const params: Record<string, unknown> = {};
	for (const spec of SEARCH_SPECS) {
		if (spec.python === "root" || spec.python === "roots") continue;
		const value = bound[spec.python];
		if (value !== undefined) params[spec.argv] = value;
	}
	return params as SearchParams;
}

function hasQuery(params: SearchParams): boolean {
	return Boolean(
		params.query ||
			(params.queries?.length ?? 0) > 0 ||
			(params.fts?.length ?? 0) > 0 ||
			(params.vector?.length ?? 0) > 0,
	);
}

export function createZvecGrepHost(context: ZvecGrepHostContext): {
	zvec_grep_search: (...args: unknown[]) => Promise<string>;
	zvec_grep_rg: (...args: unknown[]) => Promise<string>;
} {
	const cli = context.cli ?? createZgCli();

	async function zvec_grep_search(...args: unknown[]): Promise<string> {
		const bound = bind(args, "zvec_grep_search", SEARCH_SPECS, "query");
		const params = searchParams(bound);
		if (!hasQuery(params)) {
			throw fail("ValueError", "zvec_grep_search needs at least one of query, queries, fts or vector");
		}
		const roots = resolveTargetRoots(context.cwd, bound.roots as string[] | undefined, bound.root as string | undefined);
		const style = await cli.style(context.cwd);
		const argv = buildSearchArgs(style, params);
		context.progress?.(roots.length > 1 ? `Searching ${roots.length} workspaces…` : "Searching the indexed workspace…");
		// The bound is this host function's own; the signal is the run's, and killing the group is
		// `spawnExec`'s job (it escalates SIGTERM to SIGKILL after five seconds, as pi's exec does).
		const outcomes = await runAcrossRoots(cli, roots, argv, context.signal?.(), SEARCH_TIMEOUT_MS);
		const { text, failed } = formatRootResults("zvec-grep search", outcomes, { header: roots.length > 1 });
		if (failed === outcomes.length) throw fail("RuntimeError", text);
		return text;
	}

	async function zvec_grep_rg(...args: unknown[]): Promise<string> {
		const bound = bind(args, "zvec_grep_rg", RG_SPECS, "command");
		const command = bound.command as string | undefined;
		const { args: rgArgs, head } = tokenizeRgCommand(command ?? "");
		if (rgArgs.length === 0) throw fail("ValueError", "zvec_grep_rg needs a ripgrep command");
		const roots = resolveTargetRoots(context.cwd, bound.roots as string[] | undefined, bound.root as string | undefined);
		const style = await cli.style(context.cwd);
		const argv = buildRgArgs(style, rgArgs);
		const outcomes = await runAcrossRoots(cli, roots, argv, context.signal?.(), RG_TIMEOUT_MS);
		const { text, failed } = formatRootResults("zvec-grep rg", outcomes, { header: roots.length > 1, head });
		if (failed === outcomes.length) throw fail("RuntimeError", text);
		return text;
	}

	return { zvec_grep_search, zvec_grep_rg };
}
