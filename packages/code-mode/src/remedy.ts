/**
 * What a cell is told when it reaches for a name this sandbox does not have.
 *
 * The surface (`surface.ts`) teaches the replacement ahead of time, and the measurement behind this file
 * says why that is not enough: after guideline 9 was rewritten to lead with the like-for-like mapping
 * (`os.path.isdir(p)` is `Path(p).is_dir()`), every first cell in the A/B reached for `Path(...)` — and
 * the one run that still failed did it on `os.path.relpath`, then on `Path(p).relative_to(root)`, a hole
 * in the replacement the prose had not listed. A curated subset has an open-ended set of holes, so prose
 * cannot close them; but a model naming one is a fixed, recognizable event — the worker renders it as an
 * `AttributeError` whose message carries the attribute *and* the kind of object it was missing from — so
 * the remedy can arrive once, in the result the model is already reading.
 *
 * The names, and the message shapes, are measured against monty 1.4.0, not assumed
 * (`.scratch/toolchain-1.4.0/monty-delta.md` §2.2-2.3 for the upstream docs, `.scratch/toolchain-1.4.0/probe/`
 * for the calls). At 1.4.0 `os` has `mkdir`, `makedirs`, `rmdir`, `remove`, `unlink`, `stat`, `getcwd`,
 * `chdir`, `listdir`, `scandir`, `walk`, `rename`, `replace`, `fspath`, `urandom`, `path` and the POSIX
 * constants including `pathsep`, and lacks `lstat`, `chmod`, `utime`, `access`, `symlink`, `readlink`,
 * `removedirs`, `renames` and `link`. `os.environ` and `os.getenv` exist but
 * raise `RuntimeError: 'os.environ' is not supported in this environment`, which is a different event and
 * gets no remedy. `pathlib.Path` has `is_dir`, `is_file`, `exists`, `stat`, `iterdir`, `joinpath`, `parent`,
 * `name`, `suffix`, `parts`, `as_posix`, `resolve`, `absolute`, `with_suffix`, `is_symlink`, `read_text`,
 * `glob` and `rglob`, and lacks `parents`, `relative_to`, `is_relative_to`, `home`, `lstat`, `match` and
 * `samefile`. Two names left these tables when the pin moved from 1.1.0: `os.walk`/`os.path`/`os.scandir`
 * and `Path.rglob`/`Path.glob` arrived, and the remedy for `os.path`'s own members now points at
 * `os.path`, not only at `Path` (`docs/limitations/os.md`, `docs/limitations/pathlib.md`).
 */

/** Names monty's curated `os` does not have. */
const OS_MISSING = new Set([
	// Present at monty 1.4.0 and therefore not here any more: `path`, `walk`, `scandir` and `pathsep`
	// (`docs/limitations/os.md`; measured). What remains is absent at 1.4.0, and `getsize`/`isdir`/
	// `isfile`/`islink` are `os.path` members a cell reaches for on `os` itself.
	"getsize",
	"isdir",
	"isfile",
	"islink",
	"symlink",
	"readlink",
	"lstat",
	"chmod",
	"utime",
	"access",
	"removedirs",
	"renames",
]);

/** Names monty's `pathlib.Path` does not have. */
const PATH_MISSING = new Set([
	// `rglob` and `glob` arrived at monty 1.2.0 and are gone from this set; `parents`, `relative_to`,
	// `home`, `match` and `samefile` are still absent at 1.4.0 (`docs/limitations/pathlib.md`).
	"parents",
	"relative_to",
	"is_relative_to",
	"home",
	"lstat",
	"match",
	"samefile",
]);

/** Names a cell reaches for without having imported where they come from. */
const NEEDS_IMPORT = new Set(["Path", "pathlib"]);

const OS_REMEDY =
	"# monty's `os` is a curated subset: `os.path`, `os.walk`, `os.scandir` and `os.listdir` exist,\n" +
	"# but `os.lstat`, `os.chmod`, `os.utime`, `os.symlink`, `os.readlink` and `os.access` do not.\n" +
	"# Sizes and path tests are `os.path.getsize(p)` / `os.path.isdir(p)` / `os.path.exists(p)`;\n" +
	"# a tree is `os.walk(root)` or `Path(root).rglob('*')` (one host call per subtree).";

const PATH_REMEDY =
	"# monty's `pathlib` is partial: `glob`, `rglob`, `iterdir`, `walk` and `read_text` exist, but\n" +
	"# `parents`, `relative_to`, `home` and `match` do not. A path relative to a root is\n" +
	"# `os.path.relpath(p, root)`; a tree is `os.walk(root)` or `Path(root).rglob('*')`.";

const IMPORT_REMEDY =
	"# `Path` is `pathlib.Path`, and only `os` and `json` are pre-imported: `import pathlib` first\n" +
	"# (then `Path(...)`, or write `pathlib.Path(...)`).";

/**
 * The remedy for a failure, or `null` when the failure is not one of these events. Keyed on the kind of
 * object as well as the name, because a `walk` missing from an unrelated module is not this event.
 */
export function remedyFor(typeName: string, message: string): string | null {
	if (typeName === "NameError") {
		const unbound = /name '([A-Za-z_][A-Za-z0-9_]*)' is not defined/.exec(message);
		if (unbound !== null && NEEDS_IMPORT.has(unbound[1] ?? "")) return IMPORT_REMEDY;
		return null;
	}
	if (typeName !== "AttributeError") return null;
	const missing = /no attribute '([A-Za-z_][A-Za-z0-9_]*)'/.exec(message);
	if (missing === null) return null;
	const name = missing[1] ?? "";
	// A missing attribute on a module arrives in two shapes: the worker renders the traceback with
	// CPython 3.12's wording (`module 'os' has no attribute 'walk'`), while a `getattr` inside a cell
	// gives the older `'module' object has no attribute 'walk'` — measured, both, in the same kernel.
	const fromModule = message.startsWith("'module' object") || /^module '[^']*' has no attribute/.test(message);
	const fromPath = message.startsWith("'PosixPath' object") || message.startsWith("type object 'PosixPath'");
	if (fromPath && PATH_MISSING.has(name)) return PATH_REMEDY;
	if (fromModule && OS_MISSING.has(name)) return OS_REMEDY;
	return null;
}
