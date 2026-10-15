# An egress slot for a session's network policy

A code-mode cell can fetch a page with the shell: `await bash("curl https://example.com")`. The text
comes back through the `python` tool result and reaches the model with **no**
`<untrusted_web_content>` marker on it, because pi-web-access never saw it — its fence covers the two
routes it produces (its own host functions' envelopes, and the installed `pi-web-access` pi tools'
`tool_result`) and this is a third route that belongs to nobody. The rule in its system-prompt section
is the only layer that could have covered it, and a rule is what injection defeats.

Prevention is therefore the only control available here. Tagging the text is impossible for the same
reason the fence misses it — nothing in the package is on the path that produces it — so the reachable
lever is to stop the *call* before it runs.

The question "may this call leave the host" had nowhere to be asked. Code mode's `guard` asks a
different question (may this call run, and which mount mode does the cwd get) and is single-owner, and
read-only mode claims it in **every** session, not only when the mode is on: `registerForSession` runs
unconditionally at `session_start`. So a network policy declared through `guard` would be refused
*whole* by the ledger, and the session would never learn that the half it needed was missing.

We therefore gave code mode **one more contract slot**: `Contribution.egress = { before(call) }`,
single-owner in the same all-or-nothing family as `guard`/`provenance`/`onNotice`/`search`, asked
**after** `guard` and before every host call, and answered by the package whose subject is the network
— `pi-web-access`, whose `checkEgress` (`egress.ts`) refuses a `bash` command whose purpose is to
leave and steers the model to `fetch_content`.

## Considered options

- **Let the `guard` slot grow a network half.** No second slot, no version bump, no new concept.
  Declined because it is a slot a package cannot reach: `guard` is single-owner, read-only mode holds
  it every session, and a package cannot be *obeyed* through a slot another package holds. It would
  also merge two questions with two different owners and two different subjects — the disk and the
  network — into one policy object, and make the second subject's rules the first owner's code.
- **Make `guard` a chain**, consulted in order, any refusal winning. The most flexible answer and the
  one with no new concept at all. Rejected as the widest change for a case that needs exactly two
  owners: it rewrites the one-owner rule — the thing that made the guard slot's failure mode legible —
  and every existing declarer's meaning would have to be re-derived from a policy that is no longer
  the only one.
- **A policy inside code mode's own `bash_host`.** Smallest diff, no contract change, no version gate,
  no package boundary crossed. Rejected because it puts a policy in the mechanism: the refusal would
  not be session-configurable, would be invisible to the ledger, and code mode would hold a rule that
  belongs to the web package — while still needing a name list nobody can keep complete.
- **A process-global slot read by `host.ts` at call time.** No contract change and no version bump,
  which is its only advantage: it is a second, undocumented seam that all-or-nothing validation never
  sees, and a malformed policy would surface as a cell-time error rather than a refused contribution
  at mount. This is `0006`'s argument, unchanged.
- **Fencing the shell's output instead of refusing the call.** The shape that would preserve the
  content rather than blocking it, and it is unavailable for a reason worth recording: `bash_host`
  returns raw stdout, code mode does not produce the text and must not learn the web package's marker,
  and a verdict cannot rewrite a result. The fencing has to happen where the text is produced, and for
  a shell fetch there is no such place.
- **Refusing the call with no way past it.** Rejected: an egress refusal that cannot be got around
  stops work rather than protecting it, and the session that needs the page does not stop trying — it
  reaches for the shell by another name. The refusal and the hatch are a pair, and the hatch is in the
  same package so that it fences (see Consequences).

## Consequences

- **`API_VERSION` is 4.** An older code mode refuses `egress` as an unknown field *whole*, which would
  take the contributor's host functions down with it — so web-access reads `handle.apiVersion` before
  contributing the slot, and below 4 it omits the policy and records the reason as a `problem` rather
  than letting the session believe it is guarded. That is the rule the guard slot established, with a
  third member.
- **The refusal has a hatch, and the hatch fences.** `fetch_content(url, via="shell")` runs `curl` on
  the host for the pages the guarded route cannot reach — a server on localhost, an authenticated or
  POST API, a 403, a body nothing can extract — and feeds the body back through the same pipeline, so
  the spill is fenced exactly as the guarded route's is. It skips the address and scheme checks, which
  is the point of it, and keeps the operator's `domainPolicy`, which is a decision rather than a safety
  default. Without the hatch the policy would be a wall; with it, the only route to unfenced network
  text is a route nobody sanctioned.
- **This is a guardrail, not a boundary, and the rule stays the load-bearing half.** `checkEgress`
  reasons about command *text*, so a small script, base64, an interpreter the table does not know or an
  absolute path walks around it. That is read-only mode's own posture for its bash gate, for the same
  reason, and it is why the system-prompt rule was rewritten to name the class — web content is
  untrusted *however it arrived* — rather than a list of tools a hostile page can route around.
- **The refusal's narrowness is a decision, not an omission.** Only commands whose **stdout is external
  content** are refused. Package managers, `docker pull`, `git clone`, the cloud CLIs and the git
  subcommands that move objects are allowed: their stdout is progress and status, what they write to
  disk is a *file* by the time the model reads it, and refusing them breaks ordinary work in a session
  that is not read-only.
- **Read-only mode's `curl` entry now means less than it did.** Its bash gate admits a plain GET to
  stdout on the *disk* question; the egress policy refuses the same command on the network question,
  because a fetch is exactly its subject. The entry stays (its gate is still the one that decides what a
  read-only session may do to the disk) and its comment says what it now does not decide.
- **The model-visible surface moves, so acceptance check 2's web rows are amended.** The contributed
  description and a third contributed guideline are recorded in
  `.scratch/code-mode/acceptance-baseline.md`, with the removed fragment named; the base and
  code-mode+rlm figures the earlier amendments chain through are untouched.
- **Two routes still sit outside every fence, by construction, and the rule is what covers them.** A
  contributed host function returns somebody else's value, and a bridged pi tool's result arrives as
  text through `tool(...)`; in both cases the text is produced outside this package and no verdict can
  rewrite it. Closing either means the producing package fencing what it returns — the rule this package
  follows for its own two routes — so neither is this slot's job, and the rewritten rule names them
  rather than pretending a policy covers them.
- **`pi-host-bridge` mirrors the shape** (`KernelEgress`) rather than importing it, and carries the
  field, on `0006`'s rule that the composition root must not narrow the publisher's contract.
- **The widening budget now has three members.** `guard`, `search` and `egress` are the contract's
  additions; anything further is a ticket against code mode, never a quiet extra field.

## Amendment, 2026-10-15 — the verdict may carry a fence

The decision above is left as written; this records what later work made of two of its own claims.
`docs/adr/0008-an-egress-verdict-may-fence-the-result-it-allows.md` is the decision that adds the
ability, and this points to it rather than restating it.

- **"A verdict cannot rewrite a result" now holds in the narrow form ADR 0008 describes.** The
  `egress` slot's verdict may be `{allow: true, fence}` and code mode wraps the result of **the one
  call the verdict allowed**; the sentence is true as a scope and false as a limit. The field is in
  the tree, `API_VERSION` is **5** (the first Consequences bullet reads 4), and the mirror in
  `pi-host-bridge` carries it. Anything past it is a new decision, never a quiet extra field.
- **The hatch is no longer the refusal's only sanctioned way past.** `fetch_content(url,
  via="shell")` still fences, for the reason the Consequences give — the text is produced inside this
  package — and an **ssh grant** is the second: a human authorises one destination for one session,
  and the granted call is allowed and fenced. The two fence for different reasons, "*this package
  produced the text*" against "*the human authorised this destination and the output is fenced on the
  way back*", which is why the grant's words are this package's too and why it is not a second hatch
  but the refusal's third answer where a human is present.
- **The gate is still a guardrail, not a boundary.** The transport family is now judged by the
  destination keys its text names against a session's live grants, but the posture is unchanged
  (preference 4 of `.scratch/ssh-grant`): a script, base64, an interpreter the table does not know or
  an absolute path still walks around it, `-D` is refused even under a grant, and the system-prompt
  rule stays the load-bearing half. The grant buys a fence, not a hole.

## Amendment, 2026-10-15 — the slot is no longer the only seam

The decision above is left as written; this records what came after it. The `egress` slot is still code
mode's and its contract has not moved (`API_VERSION` 5, ADR 0008). But it is no longer the **only** place
the session's egress policy is enforced: the same policy — the same matcher, the same grants and ask, the
same verdict — is also enforced at pi's own `tool_call`/`tool_result` events, so a session with no code
mode (no kernel, no slot) is guarded too.
`docs/adr/0009-the-coverage-belongs-to-the-policy.md` is the decision that made the coverage a property
of the policy rather than of this slot; a reader of this ADR should read it beside this one. Nothing here
is withdrawn: the slot is one of the policy's two **seams**, and its own shape, version and fail-closed
rules are exactly as the decision above records them.
