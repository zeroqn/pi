# code mode — the Python kernel for pi

A persistent Python kernel, backed by [monty](https://github.com/pydantic/monty), that replaces
pi's built-in tool surface with a single tool named `python`.

This package is the **kernel**: the pool and its checkouts, the mounts, the prelude, the host
functions the sandbox reaches the host with, the journal, the dump, the mid-cell rotation that
survives monty's suspension budget, and the tool itself. Nothing here knows about children,
notices or learned skills — those arrive from other packages through the contract below.

It stands alone. `packages/rlm` adds delegation and the agent-side seams on top, and is the usual
way to run it; `packages/web-access` adds web host functions the same way.

## The surface it owns

- **One `python` tool**, built-ins disabled at mount, tool executions serialised behind a FIFO
  queue (pi runs a batch in parallel; one monty session cannot be fed twice at once).
- **The workspace mounted read-write at its real path**, so `bash` output and sandbox paths agree.
- **`SCRATCH`**: a second read-write mount at `<sessionFile>.scratch`, mirrored at its real host
  path, created lazily, never deleted during a session (a journal replay re-reads it).
- **The prelude's base half**: `ROOT`/`SCRATCH` and the file helpers (`read_text`, `write_text`,
  `edit_text`, `walk`, `read_json`, `write_json`, `exists`, `mkdirp`, all sync), plus `BgHandle`
  and `bash`. The delegation half is contributed — see below.
- **Host functions**: `bash_host`, `find`, `grep`, `read_image` — async, all awaited — and the
  background handles behind `await bash(cmd, background=True)`: `bg_poll`, `bg_read`, `bg_kill`,
  `bg_list`, cap 8 live, one notice per finished handle, killed at shutdown with the record kept
  and restored read-only after a resume (never re-executed).
- **Progress updates** for long host calls, so a slow cell is not opaque.
- **Journal-and-replay durability** (`.scratch/rlm-extension/` ticket 04): successful cells are
  journaled to `<sessionFile>.rlm-journal.jsonl` (code plus every host-call result) with a
  metadata-only `rlm-cell` entry in the transcript; a resumed or forked session rebuilds by
  replaying them as **one composite feed over `overlay` mounts with host calls served from the
  journal** — so replay cannot write to the host and does not re-run shell commands. The result
  reports itself honestly, and a partial rebuild says which cell stopped it.
- **A dump fast path**: a matching `<sessionFile>.rlm-dump.bin` (written at `agent_end` and
  shutdown) restores the kernel directly, gated on the client version, the journal's cell count,
  and a `schema` field. A missing `schema` reads as `1` — every dump written before the code-mode
  split still loads, because the split changed no byte of what monty dumps. A stale dump is
  ignored silently and replay runs instead.
- **Mid-cell rotation** (`.scratch/kernel-budget/`): monty's per-checkout suspension budget is
  spent per host round-trip, so a long cell would eventually die on its first call. The drive loop
  uses `feedStart` + `resumeAuto` and rotates to a fresh checkout at 90 % of the budget, carrying
  the suspended frame with it — `# kernel reclaimed mid-cell (1x); nothing was lost.` A suspension
  whose only work is pending async host calls (monty's `FutureSnapshot`) cannot be dumped and
  re-loaded, so rotation defers to the next suspension that can be; 90 % is a floor, not a ceiling,
  and the tenth held back absorbs the deferral.

## The contribution contract

Two packages in one process meet through a registry, never through an import: pi gives every
extension entry its own module graph (`core/extensions/loader.js:416`, `moduleCache: false`), and a
child session loads no ambient extensions at all. The whole contract is `src/contract.ts`, and
`docs/adr/0001-code-mode-registry-seam.md` records why.

Published **at module load**, first publisher wins:

```ts
// globalThis[Symbol.for("pi-code-mode:registry")]
{
  publisher: "pi-code-mode",
  apiVersion: 1,                       // the contract's version, not the package's
  sessions: Map<string, KernelHandle>, // one kernel per session key
  mount(pi, ctx): KernelHandle,        // idempotent by session key
}
```

- **`mount` is idempotent.** `mounts` counts the calls, and every call past the first leaves a
  `code-mode-mount` trace: pi will happily host two kernels behind one session and never say a
  word, so the rule lives here and this is its observable. The session key is the absolute session
  file, or — for an unpersisted session — the session manager's identity.
- **`handle.contribute({ owner, hostFns, prelude, description, snippet, guidelines, onHostCall,
  onNotice, provenance })`** returns `{ owner, accepted, rejected }`, and validation is
  **all-or-nothing**: one rejected name means nothing from that call is applied, because a prelude
  line whose host function was rejected is a `NameError` at call time. A contribution is idempotent
  per owner, and the tool's description, snippet and guidelines are recomposed — by re-registering
  the same tool name, which replaces silently within one extension — in owner order, so the
  composed surface is deterministic.
- **The window closes at the kernel.** The prelude is fed once, at the first cell; a contribution
  after that is refused whole with `kernel already started`.
- **Two observer hooks, first owner wins**: `onHostCall(name, args)` — called by the base host
  functions that opt in (today `bash_host`) so a package can see every command without owning the
  function — and `onNotice(notice)`, which is how a finished background handle reaches rlm's notice
  machinery. With no owner for a notice, code mode holds it until no cell is running and sends it
  itself.
- **`provenance(ctx, own)`** asks the contributor which journals to replay and which scratch to seed
  from. With no contributor the rule is the trivial one — this session's own journal, no seeding —
  because a code-mode-only resume that silently started empty is the failure that rule exists to
  prevent.
- **`apiVersion` is the only version signal there is.** pi exposes no extension enumeration and no
  version query, so a consumer cannot tell *absent* from *old* from *inert* any other way.

### Publishing *pi tools*, not host functions

A contributor that wants the model to reach an **existing pi tool** from a cell has a different
route: `pi-tool-bridge` (`packages/tool-bridge/`) reads publications from a `globalThis` slot
(`Symbol.for("pi-tool-bridge:owners")`), turns them into one contributed host function named `tool`,
and records which pi tools a cell can now call — so its own entry can strip those names from pi's
active set. The kernel is not involved in any of that beyond accepting the contribution; code mode
learns nothing about Magic Context, which is the point. See `packages/tool-bridge/README.md` for the
publisher contract, and `.scratch/tool-bridge/` for the decisions.

## Run it

```bash
cd /workspace/pi
MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty \
pi -ne -e /workspace/pi/extensions/packages/code-mode/index.ts -nbt \
   --session-dir /tmp/cm-sessions -p "your task"
```

Add `-e /workspace/pi/extensions/packages/host-bridge/index.ts` — the composition root, and the only
way a contributor's host functions reach a kernel — then the contributors themselves:
`-e /workspace/pi/extensions/packages/rlm/index.ts` for delegation and
`-e /workspace/pi/extensions/packages/web-access/host.ts` for web host functions.

Environment overrides: `RLM_FD` (find backend), `RLM_SHELL`. `grep` takes none: it is **ripgrep
when `rg` is on `PATH`, GNU `grep` when it is not**, so a host without ripgrep still searches — with
that engine's own ignore rules, which is the whole reason to prefer ripgrep. `MONTY_BIN` is only
needed on a host without `/lib64/ld-linux-x86-64.so.2` — NixOS, musl; the flake's `.#monty-bin` is
the published worker patched for Nix (do **not** use `.#monty`, the local checkout at protocol 3).

## Tests

```bash
cd /workspace/pi/extensions/packages/code-mode
bun test        # 120 tests, 0 fail
```

The monty-backed tests skip themselves without a worker, so the suite is runnable anywhere. The
journal, background, render, prelude, replay, contract, monty-binding and surface suites each name
the decision they pin — `test/contract.test.ts`'s last block is acceptance check 10, the five
contract violations that must fail a test rather than reach a session.

## Known limitations

- **A one-shot run cannot outlive a child it spawns.** Inherent to `pi -p`, not to the kernel.
- **monty hands a Python dict back as a JS `Map`.** `JSON.stringify(new Map())` is `{}`, so the
  `# => ...` line is rendered by `src/render.ts`, which converts Maps, Sets and BigInts. Without it,
  a cell ending in `await bash(...)` would report an empty object.
- **A dump is a fast path, never the truth.** Gated on client version, cell count and `schema`; a
  stale dump is ignored and replay takes over.
- **A partial rebuild is never dumped.** If replay stopped early, the kernel is marked incomplete and
  the next resume replays again rather than trusting a dump that would look complete.
- **A rotation lands at the first *dumpable* suspension at or past 90 %**, not exactly at 90 %: a
  `FutureSnapshot` cannot be restored from a dump (its pending promises lived in the old worker), so
  the loop answers it and rotates on the next suspension. The reserve is never crossed without a
  rotation; it is only ever a few suspensions later.
- **The compiled pi binary cannot resolve the napi addon on its own.** `src/monty.ts` points
  `NAPI_RS_NATIVE_LIBRARY_PATH` at the platform `.node`, searching both a hoisted
  `node_modules/@pydantic/monty-*` and bun's store — without the store case, every *spawned* pi
  process failed to start a kernel at all.
