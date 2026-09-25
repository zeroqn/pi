# pi-tool-bridge — pi tools, callable from inside a cell

A code-mode session drives the model through one tool. Code mode resets pi's active set to
`["python"]`, and pi resolves a tool call against the *active* list — so every other extension's
tools stay registered but unreachable, and Magic Context's `ctx_reduce` answers `Tool ctx_reduce not
found` in exactly the sessions where the model is doing the most work.

This package closes that gap the only way pi allows: by turning another extension's published tools
into **kernel host functions**, which a cell calls by bare name. The model's tool surface stays the
tools a cell cannot stand in for — `python`, plus `ask_user_question` (its whole value is the TUI) and
`todowrite` (its effect is pi's dispatch) — and the tools it was already told about (by the owner's
own system prompt) become reachable again as `await tool("ctx_reduce", drop="3-5")`.

## For an extension that wants to publish its tools

Publishing needs **no dependency on this package**. Write your offer into a slot on `globalThis`,
whose symbol and shape are a documented literal that both sides duplicate:

```js
const slot = (globalThis[Symbol.for("pi-tool-bridge:owners")] ??= new Map())

slot.set("<instance key>", {          // an instance key, not a session key: two instances of one
  owner: "my-extension",             // owner coexist, and each answers only for its own sessions
  apiVersion: 1,
  catalogue(ctx) {                   // *this* session's tools, or [] when you serve no such session
    return myRegistry.toolsFor(ctx).map((tool) => ({
      name: tool.name,               // required
      description: tool.description, // what pi would show
      snippet: tool.promptSnippet,   // the one line a catalogue listing renders
      parameters: tool.parameters,   // a JSON schema; only its property names are read
    }))
  },
  async execute(name, params, ctx) { // your own call path, not pi's dispatcher
    return myRegistry.run(name, params, ctx) // -> { content: [{ type: "text", text }], isError? }
  },
})
```

Four rules, each one load-bearing:

1. **`catalogue(ctx)` and `execute` must agree.** The reader advertises exactly what the catalogue
   returned, so a listed name is a name that works. A name that is advertised but refused is a
   broken promise to the model.
2. **Publish only tools whose effect lives in `execute`.** A tool whose effect pi's dispatch
   produces — the transcript, an overlay, a renderer — must not be published: called from a cell it
   would appear to succeed and do nothing. Magic Context's `todowrite` is the live example: its
   `execute` only prints, and the state is captured from pi's `tool_execution_start` /
   `message_end` events, so it stays a pi tool. Because it is *not* published, the surface rule owes
   it the other half — it keeps it **active**, which is what makes it reachable at all after code
   mode's mount-time reset. An owner declares that set on its own descriptor (`nativeOnly`), and the
   rule receives it as an input.
3. **Publishing is keyed and replaces.** pi's jiti loader re-imports an extension entry per session
   while `globalThis` survives, so a re-import must overwrite its own key rather than append.
4. **`apiVersion` is the only version signal there is.** pi has no extension enumeration, so a
   reader cannot tell *absent* from *old* any other way. A publication whose major differs from the
   reader's is refused whole, with a reason.

## For a session that wants to adopt them (rlm, or anything with a kernel)

```ts
import { installToolBridge, reconcileToolSurface } from "pi-tool-bridge"

// once per session, inside `session_start`, before the kernel's first cell
const result = installToolBridge({ contribute: handle.contribute, ctx })
// -> { installed: ["ctx_search", "ctx_reduce"], problems: [{ owner, reason, entry? }], reason? }
```

`installToolBridge` gathers the publications for this session, builds **one** contribution (a single
host function named `tool`, plus one instruction line per publishing owner), hands it to the kernel,
and — only if the ledger accepted it — records which names became reachable for
`sessionKey(ctx)`. That record is the whole input to the surface rule, so a session whose bridge was
refused or absent keeps the pi tools it had.

The entry (`index.ts`) is what applies the rule, and **its position in the manifest is part of
the mechanism**: it must be declared *after* every owner whose tools it strips. Handlers run in load
order, and Magic Context — which re-appends `ctx_memory` on `session_start` — is last in this
workspace's list. Move the entry up and the rule silently stops working.

`reconcileToolSurface(pi, ctx, nativeOnly)` is exported for the case the entry cannot cover: ambient
extensions are not loaded in a child session, so a child's kernel owner calls it from its own factory.
The native-only set is an input, composed from the owners by `nativeOnlyTools()`, so the reader itself
stays owner-agnostic.

The rule has **two directions**, and a bridged session gets both: a name a cell can reach is stripped,
and a native-only tool (`nativeOnlyTools()`, today `todowrite`) is put back if it is registered and not
already active. A session with no bridge record is left exactly as it was, so nothing here can take a
tool away from a session that has no cell route to it.

`adoptToolBridge` (`src/adopter.ts`) is the adopter's whole call: read the publications for this
session, contribute the bridge to the kernel handle, and report what happened — including the case
where the ledger refused it, which leaves pi's active set untouched.

## For an owner that serves a child session

A child loads no ambient extensions, so an owner that wants to serve one injects an extension factory
into it instead. That is this package's other half, and it is deliberately generic: `src/child-seam.ts`
exports `childFactories(request)`, `bindChild(input)` and `childStatus()`, and knows only that an owner
may declare four hooks. The owners themselves live in `src/owners/` — the one place in the package that
names an extension.

## A child's surface (`.scratch/child-surface/`)

A child is offered **a subset of what its spawner is offered**, and reaches the rest from its own cell.
Three pieces, all in this package:

- **The ceiling.** `childCeiling(parentSurface)` narrows the spawning session's live `getActiveTools()`
  to `["python", ...childEligibleTools()]` — code mode's own tool, named once in the seam, plus whatever
  each owner declares in `OwnerModule.childEligible`. A name no owner declares (`ask_user_question`, for
  instance, which needs a UI a child does not have) can never reach a child. With no spawner to read — a
  resumed child — the declared list itself stands in, and the child's own record says `source:
  "fallback"`.
- **The hard half.** rlm passes that ceiling to `createAgentSession({ tools })`, which pi turns into
  `allowedToolNames` and applies to the **registry**: nothing outside the ceiling is merely inactive in
  a spawned child, it is unregistered, pi's own builtins included. `setActiveToolsByName` can then only
  ever produce a subset.
- **The soft half.** `childSurfaceFactory` — appended **last** by `childFactories`, because handlers run
  in registration order — reconciles a child's active set in three directions: keep only what the
  ceiling and the registry allow, strip what the child's own cell can reach, and put back a ceiling name
  the mount dropped. It runs at `session_start` and again at `before_agent_start`, and writes what it
  did to the child's own transcript as `rlm-child-surface` (`surface`, `ceiling`, `source`, `dropped`,
  `deactivated`, `restored`) — which is what tells a *narrowed* child from a *broken* one.

A **resumed** child takes the ambient-manifest path instead, so `createAgentSession`'s filter never runs
for it. It is reconciled by this package's **entry**, which rlm teaches to recognise a child by
installing its own reader (`setChildDetector`) rather than making this package learn rlm's marker
vocabulary. The entry is declared last in the manifest, which is what makes it late enough to correct
the set before the first turn's prompt is built.

`PI_TOOL_BRIDGE_PROBE=1` adds one more entry to the owner list: a probe whose child factory appends
`getActiveTools()` and `getAllTools()` to the child's transcript. It is the acceptance bar's *independent*
half — a child's own entry is written by the code under test — and it is inert unless the variable is
set.

## What the model sees

- **One instruction line per publishing owner**, generated from the catalogue that was actually
  contributed, so it cannot name a tool the session does not have. It names every published tool,
  says that none of them is a pi tool or a bare name in a cell, and gives one worked example:
  `magic-context publishes ctx_search, ctx_memory, ctx_note, ctx_expand, ctx_reduce. None of them is
  a pi tool or a bare name in a cell — call one as await tool("ctx_search", query=…); await tool()
  lists them all.`
- **`await tool()`** lists everything published, grouped by owner, with parameter names.
- **`await tool("ctx_reduce", drop="3-5")`** runs one and returns **the tool's own text**, verbatim.
  A refusal (`isError: true`) is text the model reads, not an exception.
- **An unpublished name throws a `NameError`** whose message lists what *is* published — the one
  failure a model can repair without help.
- **An executor that threw crosses into the sandbox as a Python exception**, and the kernel journals
  it, so a cell's `try/except` behaves the same way after a journal replay.

## What the reader refuses, and how loudly

Every drop is reported with a reason (`problems` from `installToolBridge`) rather than swallowed:

| What arrived | What happens |
| --- | --- |
| Wrong `apiVersion` major, no `catalogue`/`execute`, a `catalogue(ctx)` that throws or returns a non-array | the owner is refused **whole** |
| An entry with no name, or with a `parameters` value that is not a schema object | that **entry** is dropped; the owner's others still work |
| A name another owner already holds, or the same name twice from one owner | the owner is refused **whole**; names are never qualified, so a cell always writes `tool("ctx_search", …)` |
| Nothing published at all | nothing is contributed, nothing is recorded, and pi's active set is untouched |

## Files

- `src/convention.ts` — the symbols, the types, the slot, the session record and `sessionKey`.
- `src/adapter.ts` — gathering, the `tool` host function, `installToolBridge`, and the surface rule.
- `src/adopter.ts` — `adoptToolBridge` and `bridgeStatusLine`: what an extension with a kernel calls.
- `src/child-seam.ts` — the generic child seam: the hooks an adopter calls, over `ChildRequest` and
  `ChildBindInput`, plus the child's *policy*: `childCeiling` and the `setChildDetector` reader.
- `src/owners/` — **the only place that names an owner**. `index.ts` holds the `OwnerModule` list,
  `nativeOnlyTools()` and `childEligibleTools()`; `magic-context.ts` is the first owner's child shim;
  `probe.ts` is the env-gated acceptance instrument.
- `index.ts` — the entry: the surface rule at `session_start` and `before_agent_start` — the child's
  when a detector recognises one — and the `session_shutdown` cleanup.
- `test/` — the rules, testable with no pi, no kernel and no monty (the surface is typed
  structurally, so nothing here imports pi). `child-seam.test.ts` also pins that every file in `src/`
  outside `owners/` names no owner.

The decisions behind all of this are in the host repo's wayfinder map, `.scratch/tool-bridge/`
(tickets 01-11), with the acceptance bar in its `acceptance.md`.
