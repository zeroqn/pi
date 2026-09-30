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
 * The names, and the message shapes, are measured against monty 1.0.0, not assumed. `os` has `mkdir`,
 * `makedirs`, `rmdir`, `remove`, `unlink`, `stat`, `getcwd`, `chdir`, `listdir`, `getenv`, `environ`,
 * `rename`, `replace`, `fspath`, `urandom` and the POSIX constants, and lacks `path`, `walk`, `getsize`,
 * `isdir`, `isfile`, `islink`, `scandir`, `symlink`, `readlink`, `lstat`, `chmod`, `utime`, `access`,
 * `removedirs`, `renames` and `pathsep`. `pathlib.Path` has `is_dir`, `is_file`, `exists`, `stat`,
 * `iterdir`, `joinpath`, `parent`, `name`, `as_posix`, `resolve`, `with_suffix`, `is_symlink`,
 * `read_text` and lacks `PurePath`, `home`, `rglob`, `glob`, `parents`, `relative_to`, `is_relative_to`,
 * `lstat`, `match` and `samefile`.
 *
 * The `NameError` case is the same event one step earlier — a cell that writes the replacement without
 * importing it. Measured over the 48 runs of the two A/B pairs behind this file: 27 module/pathlib
 * `AttributeError`s, every one on a name in the two sets below, and five `NameError: name 'Path' is not
 * defined`, which those sets cannot see, because a name that was never bound has no object to be missing
 * from.
 */

/** Names monty's curated `os` does not have. */
const OS_MISSING = new Set([
	"path",
	"walk",
	"getsize",
	"isdir",
	"isfile",
	"islink",
	"scandir",
	"symlink",
	"readlink",
	"lstat",
	"chmod",
	"utime",
	"access",
	"removedirs",
	"renames",
	"pathsep",
]);

/** Names monty's `pathlib.Path` does not have. */
const PATH_MISSING = new Set([
	"rglob",
	"glob",
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
	"# monty's `os` is a curated subset — no `os.path`, no `os.walk`. A tree is `walk(path)` or\n" +
	"# `await find(...)`; a path test is `Path(p).is_dir()` / `.is_file()` / `.stat().st_size` after\n" +
	"# `import pathlib`, while `os.listdir(dir)` and `os.stat(path)` do exist.";

const PATH_REMEDY =
	"# monty's `pathlib` is partial: `rglob`, `glob`, `parents` and `relative_to` do not exist.\n" +
	"# A tree is `walk(path)` or `await find(...)`, and a path relative to a root is a slice:\n" +
	"# `p[len(root):].lstrip('/')`.";

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
