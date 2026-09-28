# An engine slot for a session's search

A cell's `grep` and `find` are not searches, they are **engines**: two module-level probes pick
ripgrep over GNU grep and fd over GNU find when the extension loads, and every later call shells out to
whichever won. That was the right shape while a subprocess was the only option — it is one name the
model already uses, and the two engines print the same shape back. It became the wrong shape the moment
an in-process, pre-indexed engine existed: FFF answers the same questions from a warm index with
frecency ranking and no subprocess, and the only way to reach it was a *different* tool name, which
would leave the model choosing between two routes for one effect and leave the primitives as they were.

The names could not simply be taken. `grep` and `find` are in `BASE_HOST_FNS`, and a contribution that
took them would own the fallback too — the guarantee that a cell's search still works when the new
engine is not there.

We therefore gave code mode **one more contract slot**: `Contribution.search = { grep(query),
find(query) }`, single-owner in the same all-or-nothing family as `guard`/`provenance`/`onNotice`. The
two primitives ask it first and keep rg/fd as their fallback; the engine is handed the *normalized*
question (`GrepQuery`/`FindQuery`) and answers in the primitives' own shapes (`Match[]`/`string[]`), so
nothing a cell sees distinguishes the engines. Code mode learns about **engines**, never about FFF.

## Considered options

- **Two new host functions (`ffgrep`/`fffind`), the `zvec-grep` precedent.** Smallest change and no
  contract widening, and it is what the search engines before this one did. Declined because the point
  is that the *existing* route improves: a model that must choose between `grep` and `ffgrep` will keep
  choosing the one it already knows, and the effort would end with two routes to one effect.
- **Un-reserving the two names**, so a contribution named `grep` wins over the base. Rejected: with the
  base function gone the contributor *is* the primitive, so the fallback becomes its problem, and the
  reservation that keeps a session's search working at all is exactly what would be given up.
- **A process-global engine slot** read by `host.ts` at call time. No contract change and no version
  bump, which is its only advantage: it is a second, undocumented seam that the ledger's all-or-nothing
  validation never sees, and a malformed engine would surface as a cell-time `TypeError` rather than a
  refused contribution at mount.
- **A slot that takes the cell's raw arguments** (or a pre-rendered query string), so the contributor
  owns everything. Rejected: it moves the cell's contract into the contributor, and every consumer of
  `grep` would then differ in what a limit, a glob or an empty result means. The engine translates; code
  mode keeps the contract.
- **An engine that also owns the sort.** Rejected as parity's opposite: a ranked answer is a *better*
  answer, and it is still not the one a cell wrote code against. Ranking is what `fuzzy=True` is for.

## Consequences

- **`API_VERSION` is 3.** An older code mode refuses `search` as an unknown field *whole*, so a supplier
  reads `handle.apiVersion` before contributing and fails closed below 3 — the rule the guard slot
  already established, now with a second member.
- **No new host-function names.** The slot backs names that already exist, so read-only mode's exemption
  list is untouched and every contribution name it lists still means what it meant.
- **A partial engine is refused whole.** Both halves are required, because an engine with only `grep`
  would leave `find` quietly on fd while the session believed the swap had happened.
- **The fallback is code mode's, not the engine's.** Absent or throwing, both primitives run rg/fd; the
  sort and the limit stay here too, except for a `fuzzy` call, whose whole point is the engine's own
  ordering. An engine failure is therefore silent in the result — which is a decision the acceptance bar
  has to measure rather than assume, and a visibility question the map keeps open.
- **A cell can never tell which engine answered**, which is the property that makes a swap safe and the
  reason "parity" is a claim to be measured against rg/fd rather than asserted.
- **`pi-host-bridge` mirrors the shape** (`KernelSearchEngine`) rather than importing it, and carries
  the field: the composition root must not *narrow* the publisher's contract, which is the mirror of the
  rule that it must not widen it.
- **The widening budget now has two members.** `guard` and `search` are the contract's additions;
  anything further is a ticket against code mode, never a quiet extra field.
