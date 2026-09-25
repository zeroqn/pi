# One guard slot for a session's policy

Read-only mode had no way into a cell. Its two layers reason about *names and text* — the writer tools
removed from the active set, a `tool_call` veto, and a shell-command allowlist — and a code-mode session
offers the model exactly one tool (`python`), so neither layer ever saw the work: a cell could call
`write_text`, `open(..., "w")`, or `await bash(...)` and change the workspace while the prompt promised
it was frozen. Two of those three are not tool calls at all, so no name rule could ever have caught them.

We therefore gave code mode **one** contract slot through which a session's policy is asked:
`Contribution.guard = { before(call), mountMode() }`, single-owner in the same all-or-nothing family as
`onNotice`/`provenance`. `before` is asked before **every** host call — code mode's own base functions
and every contributor's — and `mountMode` says which mode the session's workspace mount gets, resolved
per feed. A refusal is a `PermissionError` raised before the callee runs, which is what monty's own
read-only mount raises too. Code mode learns about **guards**, never about read-only.

## Considered options

- **A narrow `readOnly` field plus a gate on `bash_host`.** It fits the immediate need and is smaller,
  but it leaves the `tool(...)` route — the one path that launders another package's pi tool past the
  veto — to a second seam, and it teaches code mode a policy notion ("read-only") rather than a mechanism.
- **Blocking the `python` tool while the mode is on.** Fail-closed, no contract change at all, and it
  costs the mode its usefulness: a cell is also how you *read*.
- **Letting an extension declare its own exemption**, so the list maintains itself. Rejected: read-only
  mode is an allowlist precisely so that nothing is permitted without a person deciding it, and a
  self-declaring extension is an extension that silently allows itself. The list is hand-edited, carries a
  reason per entry, and a missing entry is a refusal that names the fix.
- **A route-declaration field**, so the guard would be handed the *capability* behind `tool("ctx_search")`
  rather than the call's own name. Rejected as a second widening for one route: the shape of a route is
  the policy's to read, and the alternative was another field on the publisher's contract.
- **An observer instead of a decider.** `onHostCall` had been exactly that and was deleted for having no
  claimant (`../rsi-oneway` ticket 09). Watching a call is the journal's job; the guard's job is to decide.

## Consequences

- **A policy must be obeyed, not merely offered.** Validation is all-or-nothing, so an older code mode
  refuses `guard` whole and the session never learns — it would show the read-only prompt over a writable
  workspace. `API_VERSION` is therefore **2**, and a supplier reads `handle.apiVersion` before
  contributing and fails closed below it. The floor is the cell: no guard, no `python`.
- **A mode change costs the kernel nothing.** The mount was already a per-feed option, so the answer is
  read per cell; the kernel, its variables, its imports and its journal survive a toggle.
- **Every host call is in the policy's path**, which makes the guard a hot path and a place where a
  mistake is a hole: it must be cheap, it must not deadlock the host chain, and it must not see calls that
  cannot change the workspace (`os`, monty's own).
- **The refusal is journaled like any other call error**, so a replay re-raises it instead of running the
  call — the property that keeps a rebuilt kernel honest.
- **The exemption list is a maintenance surface.** A contributor added later is invisible in a read-only
  session until somebody writes its names down, and a listed name nothing contributes keeps a *name*
  permitted for whoever takes it next. Both directions are reported once per session, off the seam's own
  record of what landed.
- **A child inherits through `bindChild`, as a live floor** rather than a copy: `enabled || floor(child)`,
  where the floor is the spawner's *effective* answer, so a child can never be wider than the session that
  spawned it and a grandchild chains through a child.
- **The mode's boundary is the next cell**, for the mount, the shell gate and the live shells alike: a
  change *into* read-only kills the background shells a mount cannot reach, because killing them *instantly*
  would be stricter than the mount while a running cell keeps writing under it.
- **The widening budget is spent.** `guard` is the contract's one addition; anything further is a new
  ticket against code mode, never a quiet extra field.
