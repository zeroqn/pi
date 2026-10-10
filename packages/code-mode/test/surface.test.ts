/**
 * The base surface is not free text: acceptance check 2 compares an rlm session's `python`
 * tool against recorded hashes, so these constants are pinned here. A change to any of them
 * is a change to what the model sees, and it fails this test on purpose.
 *
 * `.scratch/code-mode/acceptance-baseline.md` holds the same numbers, the three fragments
 * the split removed from the pre-split description, what rlm contributes in their place, and
 * the amendments since: code mode's own guidelines for searching contents, for finding
 * paths, and for listing a directory, then the rename of `find`'s first parameter from `glob`
 * to `pattern` — the name the host function actually binds. Those are why the second
 * guideline test below pins a *whole-array* hash while the first pins the six as of the
 * monty-1.0 amendment, which corrected the description's capability and working-directory
 * clauses and guideline 5's "no generators, inheritance or decorators", and the
 * background-handle amendment of 2026-09-29 — `h.poll()`, `h.output()` and `h.kill()` are host
 * calls and return coroutines, so the description that showed them unawaited taught a model to
 * print `<coroutine external_future(N)>` where a status belongs (measured live, `.scratch/mc-0441`
 * check 14; the package's own `test/prelude.test.ts` always awaited them). Then the data-plane amendment of 2026-09-29 — the description and the fifth guideline said reading many
 * files was *slow* through the kernel and to prefer `await bash("...")`, which was measured on monty 0.0.23
 * (48 ms/file) and is false on 1.0.0 (2.03 ms/file in-process, 2.08 ms/file live) — see
 * `.scratch/code-mode/datapath-1.0.md`. Then the os-subset amendment of 2026-09-29: the description
 * advertises `os` and `pathlib` as present modules with no intra-module caveat, so a cell's first
 * move on a tree is `os.path.isdir`/`os.walk` — both absent from monty's curated `os` (measured
 * live) — and guideline 9 now names them and the replacements. That is a post-split line, so only
 * the whole-array hash moved. Then the await-terminology amendment of 2026-09-30: the description
 * called a file read "one host call each", so a model wrote `await read_text(...)` and learned the
 * truth from `TypeError: 'str' object can't be awaited` (measured live, this session). A read and
 * `os.listdir`/`os.stat` are served by the workspace mount, which no journal records as a host call
 * — the same fact `rsi/src/journal.ts` states — so the surface now says *host function* for the
 * awaited family and mount read for the others. The description, the first six and the whole-array
 * hash move; the snippet does not. Then the pre-import amendment, also on 2026-09-30: the modules the
 * description lists are not bound in a cell until imported (the prelude imports only `os` and `json`),
 * so a description that listed them bare invited `pathlib.Path(ROOT)` and its `NameError` - the
 * description carries the caveat now, and only its hash moves. Then the scratch-destination amendment,
 * also on 2026-09-30: the description named SCRATCH but never told a cell to use it, so a cell that
 * needed a temp path wrote `/tmp/cang-msg.txt` and met the PermissionError the surface never warned
 * about. The clause joins the paragraph that introduces ROOT and SCRATCH, and only the description's
 * hash and length move — guidelines and snippet keep both. Then the await-in-a-plain-def amendment,
 * also on 2026-09-30: a live session defined `def sh(cmd): out = await bash(cmd); return
 * out["stdout"]` — accepted by monty, executed at call time, so the helper returned a `str` — and
 * only the *next* cell failed, at its own caret, with `TypeError: 'str' object can't be awaited`
 * where a model had aimed the `await`. Monty resolves `await` in any scope (a `lambda`, a
 * comprehension and a class body do the same thing, measured), CPython rejects the source at
 * compile time, and monty's own type checker computes that diagnostic and filters it out wholesale
 * (`crates/monty-type-checking/src/type_check.rs`, pending astral-sh/ty#2599). Guideline 5 gained
 * the rule — a helper that awaits a host function must be `async def` — so the first-six and
 * whole-array hashes move, and the description and snippet keep both. Then the tree-guidance
 * amendment, also on 2026-09-30: the os-subset clause was there and a live session still wrote
 * `for dp, dn, fn in os.walk('/workspace')` and reached for `bash("find ...")` when it failed, because
 * the same guideline that named the missing `os.walk` called `walk(path)` "not for a large tree" and
 * priced `bash("ls a b c d e")` as cheaper than five `os.listdir` calls -- the surface's own tree advice
 * pointed at the shell. Guideline 9 now leads with `await find(...)` and `walk(path)` and their costs,
 * names the idioms it replaces (`os.walk`'s loop, `os.path.join`/`isdir`/`getsize`) and keeps bash for
 * what the mount cannot see; the description's list of what monty lacks gains `os.path` and `os.walk`.
 * Guideline 9 is not among the first six, so the first-six hash holds; the description's and the
 * whole-array hash move, and the snippet keeps both of its numbers. Then the same amendment's second iteration,
 * also on 2026-09-30: that rewrite was measured and did not separate the arms (6/12 against 3/12, p = 0.40), and the
 * name it did not stop was `os.path.isdir` -- which it answered with `os.stat(p).st_size` and `exists(path)`, the
 * right facts in the wrong shape. `pathlib.Path` is the like-for-like monty already ships (`is_dir()`, `is_file()`,
 * `exists()`, `.stat().st_size`, `iterdir()`, `/`; no `rglob`/`glob`/`parents`/`home()`), so guideline 9 leads with it
 * and names what it cannot do. The description's clause carries the mapping too, so its hash and length and the
 * whole-array hash move a second time; the first six and the snippet hold. Then the bound amendment of
 * 2026-10-10 -- the tenth guideline, decided in `.scratch/long-work/issues/02-what-the-model-is-told.md`
 * and amended there by 03: a foreground `bash` waits forever unless a `timeout=` is passed, an
 * interrupted turn kills the call's process group, and work whose duration cannot be stated belongs in
 * the background (where `h.poll()` reports `age_ms` against `timeout_s`). It is the one clause on this
 * surface that describes what the *kernel* does rather than what a cell should write, which is why it
 * had to land after the abort's kill did (01) -- a surface sentence describing behaviour the kernel
 * does not have is a lie the model acts on, and this file has that failure in its history
 * (`<coroutine external_future(N)>`, the background-handle amendment of 2026-09-29). Only the
 * whole-array hash and the length move; the first six, the description and the snippet keep theirs.
 */
import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "../src/surface";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("the base surface (acceptance check 2)", () => {
	it("keeps the pre-split description, minus the three rlm fragments, corrected for monty 1.0", () => {
		expect(sha(BASE_DESCRIPTION)).toBe("acb8ff8d77b85137766be3264f3eb42ed74a4485f6a84ec2f80803c2441ea161");
		expect(BASE_DESCRIPTION).toContain("put throwaway files there rather than under /tmp");
		expect(BASE_DESCRIPTION).not.toContain("rlm.spawn");
		expect(BASE_DESCRIPTION).not.toContain("agent_message");
	});

	it("keeps the pre-split snippet, ending where rlm's connector begins", () => {
		expect(BASE_SNIPPET).toBe("Run Python in a persistent kernel with host-bridged shell, search, image reads");
	});

	it("keeps the first six guidelines, in order (as of the await-in-a-plain-def amendment)", () => {
		expect(sha(BASE_GUIDELINES.slice(0, 6).join("\n"))).toBe("c20d63bc26b42749e2cc588ffccfcd9a0e54a3dd64766541a670a13eefe02228");
		expect(BASE_GUIDELINES[0]).toStartWith("Use python for work that is stateful");
	});

	// The four deliberate additions since the split: search, find, list, and -- since
	// `.scratch/long-work` -- bounding what you cannot predict. They are here rather than in a
	// contribution because they route what code mode owns, and they are pinned because they are what
	// the model reads: a cell that never sees them reaches for bash, or waits forever for a command
	// that had no business being in the foreground.
	it("carries the four added guidelines, the only lines since the split", () => {
		expect(BASE_GUIDELINES.length).toBe(10);
		expect(sha(BASE_GUIDELINES.join("\n"))).toBe("3b5019c574894bfc40e56239ca2ee40b290efa3eb6d3ed9cc50267d2f683545b");
		expect(BASE_GUIDELINES[6]).toStartWith("In python, search file contents with");
		expect(BASE_GUIDELINES[7]).toStartWith("In python, find paths with");
		expect(BASE_GUIDELINES[8]).toStartWith("In python, path tests come from `pathlib`");
		expect(BASE_GUIDELINES[9]).toStartWith("In python, bound what you cannot predict");
	});
});
