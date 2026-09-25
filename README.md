# pi-extensions

My personal [pi](https://github.com/earendil-works/pi-coding-agent) extensions. Mostly mine;
one is a fork.

| Extension | |
| --- | --- |
| [`code-mode`](packages/code-mode) | The Python kernel; one tool replaces pi's tool surface. |
| [`rlm`](packages/rlm) | Delegation (children) and the agent-side seams, inside that kernel. |
| [`rsi`](packages/rsi) | Background loop learns reusable skills from sessions and maintains them. |
| [`web-access`](packages/web-access) | `web_search`/`fetch_content` host functions for the kernel, plus the untrusted-web-content guard. |
| [`zvec-grep`](packages/zvec-grep) | zvec-grep search and managed ripgrep as native pi tools. |
| [`tool-bridge`](packages/tool-bridge) | Another extension's published pi tools, callable from inside a cell as `await tool(...)`. |
| [`readonly-mode`](packages/readonly-mode) | Query-only mode: removes writer tools, gates bash, injects a prompt. |
| [`rpiv-advisor-pi-native`](packages/rpiv-advisor-pi-native) | Keeps rpiv-advisor's config in pi's own config tree. |
| [`magic-context`](packages/magic-context) | Forked. Cross-session memory and context management for pi. **Prebuilt** — see below. |

The first four compose into one code-mode runtime. `code-mode` owns the kernel and the `python`
tool; `rlm`, `web-access` and `rsi` reach it through a process-global registry — a contract, not an
import — and each *contributes* the host functions and sentences it is responsible for. `tool-bridge`
is a leaf of the same kind: it contributes one host function, `tool`, through which an owner's
published tools are callable by name, plus the reconciler that keeps pi's active set to the tools a
cell cannot stand in for. Uninstall any of the three and the kernel still runs, with fewer names in
it; uninstall `code-mode` and the others say so instead of half-working. The rest are independent.

## Setup

```bash
git clone --recurse-submodules https://github.com/zeroqn/pi.git
cd pi && bun install && bun run check
```

Two things no package manager can supply:

```bash
export MONTY_BIN=/path/to/monty/bin/monty           # code-mode's worker
export RLM_WEB_MODULE="$PWD/packages/web-access/host.ts"   # web-access -> kernel
```

- `MONTY_BIN` — code-mode's [monty](https://github.com/pydantic/monty) worker is a native binary,
  not the npm dependency of the same name. Without it the kernel cannot start.
- `RLM_WEB_MODULE` — how web-access is joined to the kernel. Nothing is imported; rlm reads the
  module name, resolves it once so the tool description only promises what exists, and contributes
  the `createHost(ctx)` it exports per kernel.
- `zvec-grep` needs the `zg` CLI on `PATH` (or `ZVEC_GREP_BIN` pointing at it). The two
  `-pi-native` extensions only relocate another package's config file, so they do nothing
  unless that package is installed.

Install one at a time, or the whole set from the root manifest:

```bash
pi install ./packages/rlm      # one package
pi install .                   # or this repo's root, whose manifest declares all ten
```

## The fork

`vendor/magic-context` is a submodule of
[zeroqn/magic-context](https://github.com/zeroqn/magic-context), branch `pi-agents` —
[cortexkit/magic-context](https://github.com/cortexkit/magic-context) plus five commits. The
important one publishes the process-global registry rlm's child shim binds to. Rebase onto
upstream with:

```bash
git -C vendor/magic-context fetch upstream master
git -C vendor/magic-context rebase FETCH_HEAD
```

**`packages/magic-context/` is generated from it.** A git install never initialises submodules, so
the built plugin has to live somewhere git actually delivers — CI
([`.github/workflows/magic-context.yml`](.github/workflows/magic-context.yml)) rebuilds it from the
submodule and commits the result. Do not edit it by hand. It is not installable on its own: the fork
ships source, not a build.

## Licence

MIT. The submodule carries upstream's own MIT licence and copyright.

The package READMEs and source headers reference a private working tree (`.scratch/`, ticket
numbers); it is not public.
