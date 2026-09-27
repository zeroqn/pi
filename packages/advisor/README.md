# pi-advisor

The advisor a code-mode cell can consult, as a host function.

```python
r = await advisor()
```

`advisor()` takes **no arguments**. The branch you are running in — the task, every tool call you have
made, every result you have seen, with compaction and branch summaries as the model sees them — is
forwarded to a stronger reviewer model, and the guidance comes back as a dict:

```python
{
    "text":          "Stop. The failing assertion is in the second loop: …",
    "advisor_model": "anthropic:claude-opus-4-7",
    "effort":        "high",
    "stop_reason":   "stop",
    "usage":         {"input": 15234, "output": 512, "totalTokens": 15746, "cost": {…}},
}
```

The reviewer never calls tools, never writes to your transcript, and its answer reaches you only through
this value. **A fault raises** — a missing API key, a failed call, an empty response, an abort — so a
broken advisor can never be mistaken for advice. `await advisor(focus="…")` raises `ValueError`: there are
no arguments to pass, and ignoring one would lose a request you believed you made.

## When it exists at all

`advisor` is contributed to a session **only** when a reviewer is configured *and* the executor is not on
the blocklist. When it is not, the name is not in the kernel at all, and calling it is a plain
`NameError` — never a callable that refuses to work:

- the persisted `modelKey` must resolve in this session's model registry;
- and `disabledForModels` must not cover the executor at its current level.

The decision is made **once, when the session's kernel is mounted**, because a contribution cannot be
added after the first cell. `/advisor` therefore changes the **next** session, and says so when it saves.

## What the reviewer receives

1. `## Available Executor Surface` — what this session's cell can actually call: the kernel's primitives
   (`bash_host`, `find`, `grep`, `read_image`, `read_text`/`write_text`/`edit_text`/`walk`) and the host
   functions the session's contributors landed. Not pi's registered tools, which a cell mostly cannot
   reach. The reviewer never sees your system prompt or the `python` tool's description, so this block is
   its only account of what you can do.
2. The branch, with the tail massaged: the in-flight `python` tool call — the one whose result does not
   exist yet, because it is the call you are inside — is stripped (providers reject orphan toolCalls), and
   a user turn is guaranteed at the end (recent Anthropic models reject an assistant-prefill payload).

## Config

`~/.pi/agent/extension-configs/advisor/advisor.jsonc` — JSONC, optional, and a malformed value is a
warning in the session record rather than a failure:

```jsonc
{
  // The reviewer. "<provider>/<modelId>"; the older "<provider>:<modelId>" is still read.
  "modelKey": "anthropic/claude-opus-4-7",
  // The reasoning level sent to the reviewer. Omit for the model's default.
  "effort": "high",
  // Keep a strong executor clean: block the advisor for these executors. A bare key blocks always;
  // minEffort blocks at that level and above.
  "disabledForModels": ["deepseek/deepseek-flash", { "model": "anthropic/claude-haiku-4-5", "minEffort": "medium" }],
  "guidance": {
    // Override the prose the model is given, per field.
    "description": "…",
    "promptSnippet": "…",
    "promptGuidelines": ["…"]
  }
}
```

`PI_CODING_AGENT_DIR` moves the whole tree if you set it. `/advisor` rewrites only `modelKey` and
`effort`: everything else in the file — a hand-edited `disabledForModels`, a `guidance` override — survives
every save, which is why the picker can be used on a file you maintain by hand.

## The command

`/advisor` opens the picker: a filterable model list, then a reasoning level for reasoning-capable
models, `Esc` at either step keeping the choice made so far. It needs an interactive terminal (a host
function cannot be typed, and a command cannot be called from a cell). The result is persisted; the
running session keeps the reviewer it was mounted with.

## Vendored

Vendored from [`@juicesharp/rpiv-advisor`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-advisor)
**v2.11.0** (MIT — see `LICENSE`, unchanged). The diff base is that package as installed at
`~/.pi/agent/npm/node_modules/@juicesharp/rpiv-advisor`, byte-identical to the mono checkout at
`/workspace/pi/thirdpart-extensions/rpiv-mono/packages/rpiv-advisor` apart from `package.json`'s version.
Upstream is a **reference**, not a subtree: `diff -r` against that path is the way to see what this port
changed.

### Vendored delta

- **`src/execute.ts`** — the side-call, kept whole (the auth preflight, the runtime-facade preference,
  `tools: []`, the one retry on an empty response, the effort snapshot) except that every failure **raises**
  instead of returning an error envelope, and the value is the dict above. The inventory call is gone
  (`getAllTools` → the surface block).
- **`src/context.ts`** — the tail massaging, **by shape instead of by name**: the in-flight call in this
  lane is `python`, not `advisor`, and a turn can invoke the cell more than once, so *every* toolCall in
  the tail assistant message is stripped. The guaranteed user tail is reworded for a cell.
- **`src/inventory.ts`** — `## Available Executor Surface` replaces upstream's `stableStringify`-rendered
  `getAllTools()` dump: a static preamble plus the host functions `pi-host-bridge`'s session record says
  landed, cached per session key so the reviewer's prompt cache stays byte-stable, and pruned on shutdown.
- **`src/contribution.ts`** — new: the mount-time gate, and upstream's description, snippet and seven
  guidelines rewritten into the cell form (the prose is now a contribution rather than a tool's
  `promptGuidelines`).
- **`src/host.ts`** — new: the host function itself, including the `ValueError` for any argument.
- **`src/config.ts`** — reads pi's own config tree with a local JSONC loader; `@juicesharp/rpiv-config` is
  dropped, and with it the XDG path and the `rpiv-advisor-pi-native` symlink that put pi's file there.
  `validateDisabledForModels`, the `modelKey` codec and the write semantics are upstream's.
- **`src/command.ts`** — the picker flow is upstream's; `reconcileAdvisorTool` is gone with the tool, the
  in-memory selection is no longer mutated, and both notifies say "takes effect in the next session".
- **`src/advisor-ui.ts`, `src/fuzzy.ts`, `src/pi-compat.ts`** — carried verbatim (import paths and doc
  comments aside).
- **Deleted** — `advisor/register.ts` (the tool), `advisor/handlers.ts` (the three mid-session handlers),
  `advisor/restore.ts` (its active-set half), and `ship-manifest.test.ts`.
- **Tests** — upstream's suites are the reference, not a transplant: their pi-tool half tests mechanisms
  this port deleted, and the rest are vitest suites over rpiv mocks. What is pinned here is the port's own
  contract — the gate, the payload's legality, the surface block and its cache, the dict, the faults, the
  argument refusal, the config and its write semantics and the blocklist table — in `bun:test`.
