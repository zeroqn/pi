# The coverage belongs to the policy, not the seam it was born in

The egress policy was built into code mode. ADR 0007 gave the network question its own contract slot,
`Contribution.egress`; ADR 0008 let a verdict allow a call and fence its result, so a cell's `ssh` is
refused, asked about, or granted and wrapped. That protected the **kernel seam** and nothing else. `pi`'s
own `bash` tool is a pi tool the model can call directly, and in a session with no code mode — no kernel,
no `egress` slot — it was covered by nobody: a model that runs `ssh build-box …` there gets remote text
back with no marker on it. ADR 0007 scoped that route away deliberately, and it is the hole this map
exists to close.

pi's event seam closes it. `tool_call` fires **before** a tool executes and may return `{block, reason}`;
`tool_result` fires **after** and may replace `content`. Those are the kernel slot's two halves —
**refuse** and **fence** — in pi's own vocabulary. So the reachable lever is a **second seam**, and the
question this decision settles is what a second seam means for the *policy*: whether the guardrail's
coverage is a property of the seam it grew up in, or of the policy itself.

We decided it is the **policy's**. The matcher (`egress.ts`) and the session's grants, denials and ask
(`grants.ts`) were already seam-free — the decision reads a command's text and the session's record, and
never a kernel — so the unit moved to `web-access/policy.ts` and answers a **seam-neutral verdict**:

    CallVerdict = { kind: "allow" } | { kind: "fence", fence } | { kind: "refuse", reason }

Each seam translates that into its own vocabulary and performs the act itself: the kernel seam's
`guarded()` refuses with the reason and `applyFence` wraps the call's text fields; the tool seam's
`judgeToolCall` returns `{block: true, reason}` and `fenceToolResult` wraps the result's text block. The
union is the point: *allowed and fenced* is one kind, so neither seam can treat a fenced allowance as a
plain allow, and neither can grow a rule the other does not share. It is **hard to reverse** now, because
both seams import the one type and the kernel adapter's own suite pins its translation; it is **surprising
without this context**, because egress is the policy of leaving the host and one of its seams is not the
kernel at all; and it was a **real trade-off**, taken against the three options below.

The **fence is the price of the grant at both seams**. ADR 0008 recorded the rule for the kernel — where
the fence cannot reach, the grant does not apply. That rule is a property of the grant, not of the slot,
so the tool seam grants a target only because it can fence the result it allows, and refuses under a grant
exactly what cannot be wrapped: `-t`/`-tt` (an interactive session has no result) and an unquoted trailing
`&` (a connection that outlives the call whose result the fence wraps). A seam that cannot fence does not
grant; the tool seam can, so it grants the same targets the kernel seam does, through the same store and
the same ask.

## Considered options

- **A second, independent tool-seam policy.** Its own matcher and its own grant list, so the two seams
  could be reasoned about separately. Rejected for the failure the repo has already paid for: two
  allowlists that disagree. `/readonly`'s bash gate and the network gate answer the same `ssh` call
  differently today, and that is a recorded disagreement on one gate, not a model to copy. One store, one
  ask, one verdict is what keeps "may this destination be reached" a single answer.
- **A wall-only tool seam** — refuse the transport at the tool seam, no grant there; the kernel keeps the
  only route to an allowance. The smallest change, and defensible because the tool seam's job is only to
  stop the unfenced leak. Rejected because it makes the same command allowed in a cell and refused from the
  tool, which is the drift the union exists to prevent, and because a refusal with no route is the wall ADR
  0007 rejected: a session that needs the host does not stop, it reaches for another spelling.
- **Leave the tool seam uncovered and document it as accepted.** The honest form of doing nothing: ADR 0007
  deliberately scoped the slot to the kernel, and a note could say so. Rejected because a session with no
  code mode has *no other guard*, and because the guardrail's own claim is class-shaped — "external text is
  data, however it arrived" — which is false precisely in the session where the model can still fetch a
  page. The rule would have been amended to its own exception, at the cost of the one property that made it
  hard to route around.
- **A per-seam grant record and a per-seam ask.** The other half of the first option, and rejected for the
  same reason: a human who says no has said no for the session, and a second store would let the tool seam
  ask again for a target the kernel already declined.

## Consequences

- **The kernel seam does not move.** `Contribution.egress`'s contract is unchanged (`API_VERSION` stays
  **5**), and the adapter is only the translation `toEgressVerdict` (where `allow` becomes *no verdict at
  all*, exactly what the slot answered before), the version gate and the `problems` channel. The adapter's
  existing suite passes with **one** edited assertion — the entry now registers the seam's two events — and
  that invariance is the proof the extraction changed no behaviour.
- **The tool seam needs no contract.** Nothing there can degrade: a pi extension is loaded or it is not, so
  there is no version to negotiate and no `problems` channel to report through. Its visible surface is the
  **status line** (`ctx.ui.setStatus`), and its refusals are error results the model reads.
- **One policy, one store, one ask.** The tool seam consumes the same matcher, the same grant record and the
  same `ctx.ui.confirm` dialog as the kernel seam. The dialog says which seam is asking — *in a cell* or *as
  a shell command* — and a *No* is remembered for the session, not for the seam. A grant is held per session
  across both seams.
- **It judges shell tool calls, never "text that looks like a command".** Only `bash` and `powershell` are
  read, through `input.command`. A `python` tool call is itself a tool call whose source contains the
  command, so a content-scanning handler would judge the cell's own call and **nest** the kernel's markers;
  there is no double guard, because a cell's host call spawns the shell inside code mode and never fires
  `tool_call`/`tool_result`.
- **Coverage is now two seams, and it is still not a boundary.** The policy governs the *command text* a
  cell's host calls carry and the *command text* pi's shell tool carries, in every session, including
  sessions with a kernel (gating only the kernel-less ones would leave the more capable sessions unguarded).
  It does not govern: a tool that reaches the network with no shell command (an MCP server, a provider SDK,
  a future fetch tool), a shell tool whose backend is `BashOperations` over SSH (no command text exists for
  either seam to read), or the human's own `!` command (`user_bash` never enters the tool pipeline). Those
  are named in `web-access`'s README and in the map's fog, not silently assumed.
- **A granted shell call's result changes shape, and only that call's.** `fenceToolResult` wraps each
  non-empty text block whole and returns **`content` only**, which makes the runner delete
  `structuredContent` — its `output` is the *fuller* output where the model-facing `content` is truncated,
  so carrying it would leave an unfenced copy larger than the wrapped one. A blocked call wraps nothing; an
  ordinary `ls`/`git status` is byte-identical.
