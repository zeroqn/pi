# rsi — learned skills for pi

A background loop learns reusable skills from sessions and maintains them over time, in an
agent-owned store surfaced to pi only by this extension's `resources_discover` handler.

Nothing here is model-visible until it is learned. The store *is* the feature: skills are written
by a learning pass, deduplicated by name within a scope, staged through atomic writes, and
retired when they go unused.

## What it does

- **Learns.** After a session goes quiet, a pass reads a reduced transcript and writes reusable
  skills into the store, scoped either to a project or globally.
- **Maintains.** A curator pass consolidates and retires: skills past the disuse window are
  archived deterministically before a model sees anything, and curation is **root-only** — a
  child session never curates, since with a tree of independent learners every instance would
  otherwise see it as due at once.
- **Surfaces.** Skills reach pi through `resources_discover`, so they appear wherever pi renders
  skills — no separate mechanism, no tool registration.
- **Governs.** Skill names are unique within a scope, every write is staged and atomic, and
  `assertInside` is the single trust boundary: a scope key, skill name or payload path that
  resolves outside the store is rejected rather than sanitised.

## Operator surface

```
/rsi review                     review observed proposals
/rsi pin · unpin                exempt a skill from the disuse window
/rsi archive · restore · discard
/rsi promote                    widen a project skill to global scope
/rsi observe · write            dry-run vs. real writes
/rsi off · on
```

## Configuration

`<agentDir>/extension-configs/rsi/rsi.jsonc` — JSON with comments and trailing commas. Only the
knobs in `config.ts` are read; an unreadable or invalid value is reported as a warning and falls
back to its default rather than failing the extension.

The rate limits are worth knowing about, because they are what keeps a tree of learners from
stampeding:

| Knob | Meaning |
| --- | --- |
| `minIntervalMinutes` | How often *this session* may run a learner pass. |
| `treeFloorMinutes` | How often *any* session may run one — the tree-wide floor. Set below the per-session interval, because it is a rate limit rather than an interval. |
| `childQuietMinutes` | Shorter than `quietMinutes`: a child lives for one delegated task, so a five-minute wait would outlive it. |
| `disuseWeeks` | The retirement window. |
| `maxActiveSkills` | Above this, curation is due. |

## The seam

rsi publishes a facade on `globalThis` under `Symbol.for("@earendil/rsi:pi-registry")`. This is
what lets **rlm** reach learned skills from inside a Python cell, where neither half of pi's
normal mechanism works: pi renders no `<available_skills>` block unless `read` or `bash` is
active, and the store sits outside the kernel's mounts so `open()` cannot see it.

The seam is deliberately one-way in its policy: rlm reports *facts* (a skill was read, a host
call ran, this session can write) and rsi does the matching, resolving and per-turn dedupe. With
rsi absent every function on the rlm side is inert — a degradation, not a failure.

## Tests

```bash
bun run test        # node --test, 229 tests
bun run typecheck
```
