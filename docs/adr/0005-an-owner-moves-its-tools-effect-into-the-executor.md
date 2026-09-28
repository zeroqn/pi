# 0005 — An owner moves its tool's effect into the executor

Date: 2026-09-28
Status: accepted
Wayfinder: `.scratch/one-tool-surface/` tickets 01, 02 and 05

## Context

`vendor/magic-context` registers a `todowrite` tool, and its effect was never in the tool's own `execute`:
the tool printed a JSON acknowledgement and Magic Context captured the state from pi's *dispatch* — the
`tool_execution_start` event's args and a `message_end` scan of the assistant message — into
`session_meta.last_todo_state`, from which the transform pass injects a synthetic call/result pair.

`pi-tool-bridge` therefore ruled it unpublishable (its ticket 09), on a rule the convention states plainly:
*publish only what `execute` does*. Publishing it as it stood would have given the model a call that appeared
to succeed and recorded nothing. The tool stayed a real pi tool, and a bridged session's surface was
`["python", "todowrite"]`.

Two facts then landed at once. First, a *cell-routed* call is not a dispatched one: pi emits no event by that
name, so any effect wired to dispatch is silently skipped — and this was already true, live, for `ctx_note`'s
note-nudge clearing and `ctx_reduce`'s Channel-1 mark, both of which had no other call site. Second, pi injects
a tool's `snippet` and `promptGuidelines` only while the tool is *active*, so stripping `todowrite` deletes its
four guidelines — and Magic Context's own prompt, which covers the five `ctx_*` tools, never mentioned it.

## Decision

**The effect moves; the rule does not bend.** A tool becomes publishable when its owner's `execute` path
produces what pi's dispatch produced for it:

- the bridge's executor calls the *same* observers the dispatch handlers call — one name-dispatched entry
  point per phase, so the name list exists once — for every published name;
- the owner says the words its tool used to carry, in its own prompt, gated on the fact that matters (the tool
  is no longer in pi's active set), not on the publication policy;
- `nativeOnly` loses its only member, and no exception list, flag or second catalogue is added anywhere.

## Alternatives rejected

- **An exception list in the convention** ("these published names need no observer"): it inverts the rule's
  purpose, which is to make "the cell can do this" a statement about the *tool* and not about a session or a
  special case.
- **A `keepActive` flag on the publication**, letting an owner publish a tool *and* keep its pi surface: two
  routes to one effect, which is the failure the seam exists to remove — and the tool would still not be
  callable from a cell in a session where pi could not activate it.
- **Carrying `snippet`/`guidelines` in the publication** so the reader could inject them: rejected for one tool
  as an unnecessary shape (it is the general form to build when a second owner needs it), and note that the
  publication already carries a `snippet` nobody injects.
- **Leaving `todowrite` a pi tool** and accepting a surface of `["python", "todowrite"]`: the destination of
  `.scratch/one-tool-surface/` is one tool, and the two live failures would have stayed unfixed either way,
  since they are dispatch-keyed for reasons that have nothing to do with `todowrite`.

## Consequences

- Every owner whose tool has a dispatch-side effect must now either move the effect into `execute` or leave the
  tool active — and the second option is only available while no cell can reach it.
- Magic Context's own prompt became load-bearing for a tool's *discipline*, not just its context-management
  behaviour; a future published tool's guidelines need the same treatment.
- The tag half of the same effort had to distinguish two names for one part: `tool` (what the transcript says,
  which the historian and the formatter read) and `tagToolName` (what the tag is filed under, when the content
  is a reduction a cell ran).
