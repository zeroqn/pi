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
 */
export const BASE_DESCRIPTION =
	"Run Python in a persistent kernel. Variables, imports and definitions survive between calls. The workspace root is available as the constant ROOT, and SCRATCH names a directory for temporary files that sits outside the repository and survives a resume. There is no working directory (os.getcwd and os.chdir are absent), so use ROOT + '/path' or the read_text/write_text/edit_text/walk helpers, which resolve relative paths against ROOT. The kernel is a sandboxed subset of Python 3.14 (monty): there are no third-party packages, no generators, no class inheritance, no decorators such as @property, no match statements, and none of enum, time, hashlib, random, shutil, subprocess or urllib. Everything host-side is async and must be awaited: await bash(...), await find(...), await grep(...), await read_image(...). For real CPython or any library, shell out: await bash(\"python3 -c '...'\"). Reading many files is slow through the kernel \u2014 each file operation is a separate host call \u2014 so prefer await bash(\"...\") for bulk reads. Variables, background handles live in the kernel, not in the transcript, and are unaffected when the transcript is compacted. await bash(...) blocks until the command finishes; pass background=True to get a handle instead \u2014 h.poll(), h.output(), h.kill(), and await bg_list() \u2014 and end the turn, because you are notified when it finishes. Output is truncated to 2000 lines or 50KB, whichever comes first; when that happens the full output is written to a file and its path is reported.";

export const BASE_SNIPPET =
	"Run Python in a persistent kernel with host-bridged shell, search, image reads";

export const BASE_GUIDELINES = [
	"Use python for work that is stateful, multi-step or data-shaped \u2014 parsing, transforming, searching, summarising \u2014 instead of chaining many small tool calls.",
	"In python, every host call is awaited: await bash(...), await find(...), await grep(...), await read_image(...), await rlm.spawn(...), await agent_message.send(...). A host call without await returns an unfinished object, not a result.",
	"In python, a host call's result exists only in Python until you print or return it \u2014 `await bash(...)` on its own puts nothing in your context. Print the value you mean to read, or it is invisible to you even though the call succeeded.",
	"In python, use read_text, write_text, edit_text and walk for file work; they are plain Python and need no await.",
	"In python there are no third-party imports and no generators, inheritance or decorators. When you need real CPython or a library, use await bash(\"python3 ...\").",
	"In python, bulk file reads are faster through await bash(...) than through the kernel's own open(): each file operation is a separate host call. Use Python loops for logic over files, not for reading many of them.",];
