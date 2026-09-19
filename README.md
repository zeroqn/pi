# pi-extensions

My personal [pi](https://github.com/earendil-works/pi-coding-agent) extensions. Mostly mine;
one is a fork.

| Extension | |
| --- | --- |
| [`rlm`](packages/rlm) | Code-mode Python kernel; one tool replaces pi's tool surface. |
| [`rsi`](packages/rsi) | Background loop learns reusable skills from sessions and maintains them. |
| [`web-code`](packages/web-code) | `web_search` and `fetch_content` host functions for the rlm kernel. |
| [`zvec-grep`](packages/zvec-grep) | zvec-grep search and managed ripgrep as native pi tools. |
| [`pi-web-guard`](packages/pi-web-guard) | Fences pi-web-access tool output as untrusted, plus a prompt rule. |
| [`readonly-mode`](packages/readonly-mode) | Query-only mode: removes writer tools, gates bash, injects a prompt. |
| [`magic-context-pi-native`](packages/magic-context-pi-native) | Keeps Magic Context's config in pi's own config tree. |
| [`rpiv-advisor-pi-native`](packages/rpiv-advisor-pi-native) | Keeps rpiv-advisor's config in pi's own config tree. |
| [`magic-context`](vendor/magic-context) | Forked. Cross-session memory and context management for pi. |

The first three compose into one code-mode runtime — rlm replaces the tool surface with a
Python kernel, web-code adds host functions to it, and rsi is reachable from inside a cell
through a `globalThis` registry. The rest are independent.

## Setup

```bash
git clone --recurse-submodules https://github.com/zeroqn/pi.git
cd pi && bun install && bun run check
```

Two things no package manager can supply:

```bash
export MONTY_BIN=/path/to/monty/bin/monty
export RLM_WEB_MODULE="$PWD/packages/web-code/host.ts"
```

- `MONTY_BIN` — rlm's [monty](https://github.com/pydantic/monty) worker is a native binary, not
  the npm dependency of the same name. Without it rlm's kernel cannot start.
- `RLM_WEB_MODULE` — how web-code is joined to the kernel. Nothing is imported; rlm reads the
  module name and calls the `createHost(ctx)` it exports.
- `zvec-grep` needs the `zg` CLI on `PATH` (or `ZVEC_GREP_BIN` pointing at it). The two
  `-pi-native` extensions only relocate another package's config file, so they do nothing
  unless that package is installed.

Install one at a time, or the whole set from the root manifest:

```bash
pi install ./packages/rlm      # one package
pi install .                   # or this repo's root, whose manifest declares all eight
```

## The fork

`vendor/magic-context` is a submodule of
[zeroqn/magic-context](https://github.com/zeroqn/magic-context), branch `pi-agents` —
[cortexkit/magic-context](https://github.com/cortexkit/magic-context) plus four commits that add
the process-global registry rlm's child shim binds to. Rebase onto upstream with:

```bash
git -C vendor/magic-context fetch upstream master
git -C vendor/magic-context rebase FETCH_HEAD
```

It is also installable on its own, without this monorepo:
`pi install git:github.com/zeroqn/magic-context`.

## Licence

MIT. The submodule carries upstream's own MIT licence and copyright.

The package READMEs and source headers reference a private working tree (`.scratch/`, ticket
numbers); it is not public.
