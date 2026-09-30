/**
 * The base surface: what the `python` tool says about code mode when nobody has
 * contributed anything.
 *
 * **This is the pre-split text minus three enumerated rlm fragments** (acceptance check 2,
 * amended by decision (D) on 2026-09-21). They had to go because they sat mid-sentence,
 * where an appended contribution cannot reach:
 *
 *  1. ", await rlm.spawn(...), await agent_message.send(...)"
 *  2. "child handles and "
 *  3. " await rlm.spawn(...) delegates a task to a child session and returns a handle immediately: it never returns the answer, which arrives later as a message."
 *
 * Delegation is still taught to the model - by rlm's contribution, whose guideline is
 * already last in the array and whose snippet connector closes the snippet back up, so
 * both compose to the pre-split bytes exactly. The before/after, with a hash per string,
 * is `.scratch/code-mode/acceptance-baseline.md`; `test/surface.test.ts` pins these three
 * constants to it.
 *
 * **Since 2026-09-29 it is no longer the pre-split text verbatim.** The monty-1.0 amendment
 * (`.scratch/code-mode/acceptance-baseline.md`) corrected the description's
 * working-directory clause and its capability sentence, and guideline 5, against
 * `@pydantic/monty` 1.0.0: a working directory exists (`os.getcwd()`/`os.chdir()`),
 * `time` (with `time.sleep`), `random`, `datetime` and the rest of the sandbox's standard
 * modules are present, and only a decorator on a *method* is still rejected. The
 * measurement is `.scratch/code-mode/tools/probe-monty-1.0.ts`. The six-guideline hash now
 * dates from that amendment, not from the split.
 *
 * **And since 2026-09-30 the awaited family has one name.** The description said "Everything
 * host-side is async and must be awaited" and then priced a file read as "one host call each",
 * and guidelines 1 and 2 said "host call" - so a model wrote `await read_text(...)` and learned
 * the truth from `TypeError: 'str' object can't be awaited` (measured live). A read, `os.listdir`
 * and `os.stat` are served by the workspace mount, which the journal records as no host call at
 * all (the same fact `rsi/src/journal.ts` states); the surface now says **host function** for the
 * awaited family and mount read for the others. The description, the first six guidelines and the
 * whole nine-line array all move, and the baseline records the numbers.
 *
 * **And the modules it lists are not pre-imported.** The same day, the description's "Its standard
 * modules are ..." was read as *bound*, and the first cell written against it was
 * `p = pathlib.Path(ROOT)`, which fails with `NameError: name 'pathlib' is not defined` - the
 * prelude imports only `os` and `json` (`src/prelude.ts`), and rlm's, skill-bridge's and the other
 * prelude halves add no import of their own. The list now carries the caveat. Only the description
 * moves: no guideline claimed pre-importation, so `BASE_GUIDELINES` (first six and the whole nine)
 * and `BASE_SNIPPET` keep their hashes.
 *
 * **And the description now says where a throwaway file goes.** It introduced SCRATCH as "a
 * directory for temporary files" and never told a cell to use it, while the only positive
 * statement of the boundary - guideline 9's "Only ROOT and SCRATCH are mounted" - sits inside a
 * sentence about listing directories whose stated remedy teaches the opposite lesson: /tmp is
 * reachable through `bash`. A cell that needed a temp path wrote `/tmp/cang-msg.txt` and met the
 * PermissionError the description never warned about (measured live, 2026-09-30). The clause
 * joins the paragraph that introduces ROOT and SCRATCH, so only the description moves and this
 * is the second one-hash amendment in a row.
 *
 * **And one clause for `await` inside a plain `def`.** Monty resolves `await` in any scope - module
 * level, a plain `def`, a `lambda`, a comprehension, a class body - and only `async def` decides
 * whether a call returns a coroutine. So `def sh(cmd): out = await bash(cmd); return out["stdout"]`
 * is accepted, runs the command at call time and returns a `str`: the definition cell reports
 * nothing, and the next cell fails at its own caret with `TypeError: 'str' object can't be awaited`
 * (measured live, both halves). CPython rejects that source at compile time (`SyntaxError: 'await'
 * outside async function`), and monty's own `ty`-backed type checker computes exactly that
 * diagnostic and then filters it out wholesale (`crates/monty-type-checking/src/type_check.rs`,
 * pending astral-sh/ty#2599, because a cell's legitimate module-level `await` raises the same
 * message) - so nothing in the pipeline told the model its helper was synchronous. Guideline 5
 * carries the rule now: a helper that awaits a host function must be `async def`. That line is one
 * of the pinned six, so the first-six and whole-array hashes move; the description and the snippet
 * keep both.
 *
 * **And the tree question had no primitive in it.** The os-subset amendment named `os.walk`'s absence and
 * then sent the model elsewhere: `walk(path)` was "the recursive form, so it is not for a large tree", and
 * the same guideline closed by pricing `bash("ls a b c d e")` as cheaper than five `os.listdir` calls.
 * So a model that had just learned there is no `os.walk` had nothing to reach for and reached for the
 * shell - measured live on 2026-09-30, after the clause shipped: a cell wrote
 * `for dp, dn, fn in os.walk('/workspace')`, met the bare `AttributeError`, and the model's own thinking
 * was *"monty python subset. Let me use bash find instead."*, whose next cell ran
 * `bash("ls ... && find ... -type f ...")` with the exclusions hand-written. Guideline 9 now leads
 * with `await find(...)` and `walk(path)` and what each costs, names the idioms it replaces - `os.walk`'s
 * `dirpath, dirnames, filenames` loop and `os.path.join`/`isdir`/`getsize` - and confines bash to what the
 * mount cannot see (`~/.pi`, `/nix`, `/tmp`, a sibling repo). The description's list of what monty lacks
 * gains `os.path` and `os.walk`, so only it and the whole-array hash move; the first six and the snippet
 * keep theirs. Wording is the lever taken here; the failure site is the next one - `kernel.ts` turns
 * monty's traceback into model-visible text, so a remedy appended there would arrive with the failure
 * rather than before it. The population this aims at is measured in `.scratch/code-mode/acceptance-baseline.md`.
 *
 * **And the first rewrite was measured, not assumed.** Twelve runs a side of the same one-cell tree task (the harness
 * above) put 6/12 on the old text against 3/12 on that rewrite - Fisher's exact two-sided p = 0.40, so the wording did
 * not separate the arms - and the name that survived was `os.path.isdir`, which that rewrite answered with
 * `os.stat(p).st_size` and `exists(path)`: the right facts in the wrong shape. Monty ships a like-for-like one, and the
 * guideline had never named it. Measured live in a cell: `pathlib.Path` gives `is_dir()`, `is_file()`, `exists()`,
 * `stat()`, `iterdir()`, `parent`, `parts`, `name`, `suffix`, `with_suffix()`, `joinpath` and `/`, `as_posix()`,
 * `resolve()`, `absolute()`, `is_absolute()`, `is_symlink()`, `cwd()`, `read_text()` and `read_bytes()` - and not
 * `rglob()`, `glob()`, `parents`, `relative_to()`, `is_relative_to()`, `home()`, `lstat()`, `match()`, `samefile()` or
 * `PurePath`. So the guideline now leads with the idiom a hand already writes (`os.path.isdir(p)` -> `Path(p).is_dir()`),
 * and names what pathlib itself cannot do, because `rglob` is the other recursive idiom that would dead-end here. The
 * description's clause carries the same mapping, and its hash and the whole-array hash move again.
 */
export const BASE_DESCRIPTION =
	"Run Python in a persistent kernel. Variables, imports and definitions survive between calls. The workspace root is available as the constant ROOT, and SCRATCH names a directory for temporary files that sits outside the repository and survives a resume: put throwaway files there rather than under /tmp, since ROOT and SCRATCH are the only directories the sandbox mounts and any other path raises PermissionError. The sandbox's working directory starts at ROOT and os.getcwd()/os.chdir() work on it; use ROOT + '/path' or the read_text/write_text/edit_text/walk helpers, which resolve relative paths against ROOT. The kernel is a sandboxed subset of Python 3.14 (monty): there are no third-party packages, no generator functions, no class inheritance, no decorators on methods (so no @property/@staticmethod), no match statements, and none of enum, hashlib, shutil, subprocess or urllib; monty's `os` is a curated subset — no `os.path`, no `os.walk` — so a path test is `Path(p).is_dir()` after `import pathlib` and a tree is `walk(path)` or `await find(...)`. Its standard modules are asyncio, base64, binascii, collections, copy, dataclasses, datetime, functools, itertools, json, math, os, pathlib, random, re, sys, time, typing and unicodedata, of which only os and json are pre-imported \u2014 import any other when the cell needs it (e.g. import pathlib): a cell sleeps in-kernel with time.sleep(...) or await asyncio.sleep(...), and uses random, datetime and math, with no bash needed. Every host function is async and must be awaited: await bash(...), await find(...), await grep(...), await read_image(...); read_text/write_text/edit_text/walk are not host functions \u2014 they are plain Python over the workspace mount and are never awaited. For real CPython or any library, shell out: await bash(\"python3 -c '...'\"). Reading a file through the kernel costs about 2 ms, one mount read each, never a host function call: a few thousand files is seconds and belongs in Python when the data is wanted in the kernel, while a shell pipeline wins when the shell's own tools do the work \u2014 counting, filtering or streaming \u2014 or when the count runs to tens of thousands. Variables, background handles live in the kernel, not in the transcript, and are unaffected when the transcript is compacted. await bash(...) blocks until the command finishes; pass background=True to get a handle instead \u2014 await h.poll(), await h.output(), await h.kill(), and await bg_list() \u2014 and end the turn, because you are notified when it finishes. Output is truncated to 2000 lines or 50KB, whichever comes first; when that happens the full output is written to a file and its path is reported.";

export const BASE_SNIPPET =
	"Run Python in a persistent kernel with host-bridged shell, search, image reads";

export const BASE_GUIDELINES = [
	"Use python for work that is stateful, multi-step or data-shaped \u2014 parsing, transforming, searching, summarising \u2014 instead of chaining many small tool calls.",
	"In python, every host function is awaited: await bash(...), await find(...), await grep(...), await read_image(...), await rlm.spawn(...), await agent_message.send(...). A host function without await returns an unfinished object, not a result. The file helpers (read_text, write_text, edit_text, walk) are plain Python over the workspace mount, not host functions: never await them.",
	"In python, a host function's result exists only in Python until you print or return it \u2014 `await bash(...)` on its own puts nothing in your context. Print the value you mean to read, or it is invisible to you even though the call succeeded.",
	"In python, use read_text, write_text, edit_text and walk for file work; they are plain Python over the workspace mount, not host functions, and need no await.",
	"In python there are no third-party imports, no generator functions and no class inheritance; decorators work on functions and classes but not on methods (so no @property); a helper that awaits a host function must be `async def`: monty accepts `await` in a plain `def` and resolves it at call time, returning the plain value, so the caller's `await` fails with `TypeError`. When you need real CPython or a library, use await bash(\"python3 ...\").",
	"In python, reading a file through the kernel costs about 2 ms (one mount read each), so a few thousand files is seconds: read in Python when the data is wanted in the kernel, and use await bash(...) when the shell's own tools do the work (counting, filtering, streaming a tree) or the file count runs to tens of thousands.",
	"In python, search file contents with `await grep(pattern, path=..., glob=..., literal=...)` rather than `bash(\"grep ...\")`: it is ripgrep when the host has it, so it honours `.gitignore` and returns `{path, line, text}` records you can index. Keep shell grep for what it cannot do \u2014 a pipe into `grep -v`, a `grep -l` file list, `xargs`.",
	"In python, find paths with `await find(pattern, path=..., max_depth=..., type=\"file\")` rather than `bash(\"find ...\")`: it is fd when the host has it, so it skips what `.gitignore` skips, needs no `2>/dev/null | head`, and gives a directory a trailing `/`; GNU find without it, which skips nothing. Shell out for what it cannot answer \u2014 `-newer`/`-size` predicates, `-exec`, and the sizes and times `ls -la` prints.",
	"In python, path tests come from `pathlib`: after `import pathlib`, `Path(p).is_dir()`, `is_file()`, `exists()` and `.stat().st_size` work, and so do `parent`, `name`, `iterdir()` and `Path(a) / 'b'` — but not `rglob`, `glob`, `parents` or `home()`. `os.path` does not exist at all (monty's `os` is a curated subset), so `os.path.isdir(p)` is `Path(p).is_dir()`, `os.path.getsize(p)` is `Path(p).stat().st_size` and `os.path.join(a, b)` is `Path(a) / b`. `os.walk` does not exist either: a tree is `walk(path)` — whole paths, one mount read per entry, about 2 ms each — or `await find(...)`: fd, one host call, honouring `.gitignore`. One directory is `os.listdir(dir)` plus one `os.stat(path)` per entry. `bash(\"find ...\")` is GNU find, which skips nothing — it walks `.git` and `node_modules` too — and bash is for what the mount cannot see: `~/.pi`, `/nix`, `/tmp` and a sibling repo raise PermissionError. One bash command is one host function call however much it does.",
];
