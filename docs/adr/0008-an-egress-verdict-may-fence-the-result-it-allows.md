# An egress verdict may fence the result it allows

A host call the egress policy stops could only be stopped. ADR 0007 recorded the missing ability in as
many words — "a verdict cannot rewrite a result" — and that is why the only hatch that fences,
`fetch_content(url, via="shell")`, fences *inside* the package that produces the text, and why an egress
policy could refuse a shell fetch but never tag one. The ssh grant makes the gap concrete: a granted
connection's output is external text — a remote `ls`, `git`, `journalctl` — and it is not a web page, so
the web pipeline that fences the hatch cannot carry it either. Leaving it unfenced would hand the model
the injection surface the whole fence exists to close, at the exact call a human just approved.

We therefore gave the **egress verdict** a fenced allowance:
`EgressVerdict = GuardVerdict | {allow: true, fence: Fence}`, with `Fence = {open, preamble, close}`. The
egress owner supplies the words (web-access's `REMOTE_OUTPUT_FENCE`), code mode supplies the act
(`applyFence` in `guarded()`, applied to one call's result), and `API_VERSION` becomes **5**. It is
deliberately surprising — egress is the slot that answers *whether* a call may run, and a fenced verdict
says *how its answer comes back* — and it is a contract two packages hold, mirrored in `pi-host-bridge`'s
`KernelEgress`, so changing it later is not cheap.

The fence is the price of the grant. Where the fence cannot reach, the grant does not apply:
`background=True` (the text arrives later through `bg_*` reads this policy never saw), a redirect or tee
(the text lands on disk), and a code mode below 5 are all refused rather than allowed unfenced. And only
the granted call changes shape: with no fence returned, `guarded()` returns the callee's result
byte-identical, and ordinary `ls`/`grep`/`npm`/`git` output must not move — a measured check, not a hope.

## Considered options

- **Let `fetch_content(url, via="shell")` stay the only hatch that fences.** No contract change at all,
  and it is the answer ADR 0007 already recorded. Rejected because it reaches a *page* through the web
  pipeline: the errand a grant answers is a shell on a host the human named, and no fetch route produces
  `ssh build-box 'systemctl status'`. That output arrives through `bash_host`, which is exactly the route
  no fence reaches today.
- **Fence every `bash` result.** The widest coverage and no verdict change: wrap a shell's text fields
  unconditionally. Rejected because it is the fence pretending to be a boundary — it would claim text
  that came from nowhere external, change the shape of every session's ordinary shell work, and make "a
  granted call is the only call whose result changes" unmeasurable. The class rule already covers the
  honest half (a shell fetch, a spill); the fence's job is not to guess which shell text came from
  outside.
- **A second policy slot** (an "egress result" or a result-rewriting policy beside `egress`). Rejected
  for the reason ADR 0007 refused to make `guard` a chain: `guard`/`search`/`egress` are the widening
  budget's three members, and one-question-per-slot is what makes a slot's failure mode legible. The
  fence belongs to the verdict that allowed the call, not to a second declarer that would have to be
  told about it.
- **A post-call `after(call, result)` half on the egress slot.** The most flexible shape — a policy
  could then rewrite any result — and rejected precisely for that. `before` must decide before the callee
  runs, and an `after` that can rewrite a result would let a policy touch calls it did not allow and
  blur whether the callee ran. The narrow, deliberate form of ADR 0007's "a verdict cannot rewrite a
  result" is *the allowance rewrites the result of the call it allowed*, and nothing else.

## Consequences

- **`API_VERSION` is 5**, mirrored in `pi-host-bridge` (`KernelFence`, `KernelEgressVerdict`) on the rule
  that the composition root must not narrow the publisher's contract. `GuardVerdict` and
  `KernelGuardVerdict` are untouched: "may this call run" and "is its answer external text" stay two
  questions.
- **The ledger does not change.** Its validation walks a slot's declared *halves*; the fence is a
  verdict, not a slot field, so the unknown-key rule never sees it.
- **Below 5 the session keeps the guard and loses the grant.** Web-access contributes the v4 policy,
  offers no route to a grant (no ask, no `/ssh-grant`), refuses every otherwise-grantable target with a
  reason naming the code mode's version, and adds a loud `problems` sentence. The fence's own two host
  functions are never given up with it.
- **Only the granted call changes shape.** `guarded()` applies the fence to the result's text fields
  (`stdout`/`stderr`, each when non-empty; a plain string result; an empty one is not wrapped) and
  touches nothing numeric. With no fence returned, the result is byte-identical to today's and the
  surface is returned unchanged, not copied.
- **A granted call is journaled as a success carrying the fenced value** and replays from the journal
  without re-executing, so a resume neither re-asks nor re-connects. A refusal stays journaled as an
  error and replays as one.
- **The routes the fence cannot reach are refused on the granted target only** — `background=True`, a
  redirect or tee, a code mode below 5 — each with a reason that says why. A *truncated* granted result
  still spills its raw combined output to disk unfenced; that is the class rule's recorded residual, not
  this verdict's job.
- **The cell is not told its text is fenced.** No flag, no wrapper object: a fence is markers in text,
  and a cell that could tell would be one more thing to get wrong.
- **The implementation lands separately.** The decision is `.scratch/ssh-grant` ticket 04; the code is
  ticket 12, and until it lands the field does not exist in the tree — `packages/code-mode/src/contract.ts`
  still reads `API_VERSION = 4`, and code mode has no fence descriptor and no `applyFence`. This ADR
  records a decision, not shipped behaviour, and ADR 0007's "a verdict cannot rewrite a result" sentence
  is amended when the field does.

## Amendment, 2026-10-15 — the fence has a second applier

The decision above is left as written. Its sentence "code mode supplies the act (`applyFence` in
`guarded()`)" is now one of two: the same `REMOTE_OUTPUT_FENCE` is applied at pi's own **tool seam** by
`fenceToolResult` (`web-access/tool-seam.ts`) when the model calls the `bash`/`powershell` tool directly.
The words are still this package's, and now two seams perform the act. The contract this ADR records
(`EgressVerdict`'s fenced allowance, `API_VERSION` 5) is unchanged, and the field it decided is in the
tree — the last Consequences bullet's "does not exist in the tree" is no longer true.
`docs/adr/0009-the-coverage-belongs-to-the-policy.md` is the decision that gave the policy its second
seam.
