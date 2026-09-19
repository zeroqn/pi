# pi-extensions

Four [pi](https://github.com/earendil-works/pi-coding-agent) extensions that compose into one
code-mode agent runtime: a persistent Python kernel, a learned-skill store, web host functions,
and child-session context management.

Individually each is a normal pi package. Together they form a system in which the model's whole
tool surface is a single Python kernel, and the kernel's reach into the host is the extension
seam.

```
pi
 └── rlm                    one `python` tool replaces the built-in tool surface
      ├── host functions     bash · find · grep · read_image · read_text · write_text · …
      ├── RLM_WEB_MODULE ──────────► pi-web-code     web_search · fetch_content
      ├── globalThis ──────────────► rsi             learned skills, reachable from inside a cell
      └── globalThis ──────────────► magic-context   a delegated child gets its parent's context
```

The three arrows are runtime seams, not imports. `rlm` never imports the other packages: it
looks for a `globalThis` registry by symbol, or reads a module name from an environment
variable. **Each seam degrades silently to "absent"** — every package here runs correctly with
the others missing, which is why they can be installed in any combination.

## Packages

| Path | Package | What it does |
| --- | --- | --- |
| `packages/rlm` | `@rlm/pi-python-kernel` | Replaces pi's tool surface with one persistent Python kernel backed by [monty](https://github.com/pydantic/monty). Mounts the workspace read-write at its real path plus a per-session `SCRATCH`; serves `bash`, `find`, `grep` and `read_image` as async host functions; journals every successful cell so a resumed or forked session rebuilds the kernel by replay, never by re-running shell commands; delegates to child sessions via `rlm.spawn(...)`. |
| `packages/rsi` | `rsi` | Learns reusable skills from sessions in a background pass and maintains them over time in an agent-owned store, surfaced to pi through `resources_discover`. Root-only curation, per-session and tree-wide rate limits, a pass lock, and an operator surface (`/rsi review`, pin/unpin, archive/restore, promote, observe/write). |
| `packages/web-code` | `pi-web-code` | `web_search` and `fetch_content` host functions for the rlm kernel, over DuckDuckGo and AnySearch. Registers no pi-level tools — it is a kernel hook, so it never collides with an agent-facing web tool. Shares `pi-web-access`'s config file read-only. |
| `vendor/magic-context` | `@cortexkit/pi-magic-context` | **Git submodule** — a fork of [cortexkit/magic-context](https://github.com/cortexkit/magic-context) carrying the `pi-agents` branch, which publishes the process-global registry rlm's child shim binds to. MIT, © Ufuk Altinok. |

## Prerequisites

- **bun** ≥ 1.4 — the workspace package manager.
- **pi** `@earendil-works/pi-coding-agent` ≥ 0.80.2 — the host these extend.
- **A monty binary** for rlm. `@pydantic/monty` is pinned at `0.0.23` as a dependency, but the
  worker is a native executable rlm invokes by path:

  ```bash
  export MONTY_BIN=/path/to/monty/bin/monty
  ```

  At `session_start` rlm verifies the binding loads, that `MONTY_BIN` exists, and that the client
  and worker versions agree — loudly, once. Without it, rlm's kernel tests skip and the kernel
  cannot start; the other packages are unaffected.

## Quickstart

```bash
git clone --recurse-submodules https://github.com/zeroqn/pi.git
cd pi
bun install

bun run check           # 372 tests, then typecheck, across the three workspace packages
```

`bun run test` runs the tests alone; `bun run check` adds the typechecks. Keep both green — the
rsi typecheck is what catches a name used but never imported, which the tests do not.

Then install the packages you want into pi:

```bash
pi install ./packages/rlm
pi install ./packages/rsi
pi install ./packages/web-code
```

Wire the web functions into the kernel by naming the module (rlm does not know what the
functions do — it only knows the contract):

```bash
export RLM_WEB_MODULE="$PWD/packages/web-code/host.ts"
```

### The submodule

`vendor/magic-context` is vendored rather than absorbed because upstream is large and active,
and our delta is small. If you cloned without `--recurse-submodules`:

```bash
git submodule update --init --recursive
```

To carry our 4 commits onto a newer upstream:

```bash
git -C vendor/magic-context fetch https://github.com/cortexkit/magic-context master
git -C vendor/magic-context rebase FETCH_HEAD
git -C vendor/magic-context push origin pi-agents
git add vendor/magic-context && git commit -m "chore(magic-context): bump upstream"
```

## Configuration

Each package reads its own config, following the same convention — `<agentDir>/extension-configs/<name>/`:

| Package | File |
| --- | --- |
| rsi | `extension-configs/rsi/rsi.jsonc` |
| pi-web-code | the `web-search.json` file `pi-web-access` also uses |
| rlm | environment: `MONTY_BIN`, `RLM_WEB_MODULE`, `RLM_FD`, `RLM_ZG`, `RLM_SHELL`, `RLM_CHILD_PROMPT` |

## Licence

MIT. `vendor/magic-context` is a submodule and carries upstream's own MIT licence and copyright.

## Notes on the prose

Several per-package READMEs and source headers still reference the private working tree these
were developed in (`.scratch/`, `map ticket NN`, absolute `/workspace` paths). Those references
are development history, not instructions; the tickets are not public.
