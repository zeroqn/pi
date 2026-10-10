# pi-extensions

My personal [pi](https://github.com/earendil-works/pi-coding-agent) extensions. Mostly mine;
two are forks.

| Extension | |
| --- | --- |
| [`code-mode`](packages/code-mode) | The Python kernel; one tool replaces pi's tool surface. |
| [`rlm`](packages/rlm) | Delegation (children) and the agent-side seams, inside that kernel. |
| [`host-bridge`](packages/host-bridge) | The composition root: the one client of code mode's registry, and what asks each contributor for a session. |
| [`skill-bridge`](packages/skill-bridge) | pi's own skills, and a provider store's, on a code-mode surface — one block, one call form. |
| [`rsi`](packages/rsi) | Background loop learns reusable skills from sessions and maintains them. |
| [`web-access`](packages/web-access) | `web_search`/`fetch_content` host functions for the kernel, plus the untrusted-web-content guard. |
| [`zvec-grep`](packages/zvec-grep) | `zvec_grep_search`/`zvec_grep_rg` host functions for the kernel, plus the `/zg-*` index commands. |
| [`fff-search`](packages/fff-search) | [FFF](https://github.com/dmtrKovalenko/fff)'s index behind a cell's `grep`/`find`, when a cell asks for it (`fuzzy=True`). |
| [`advisor`](packages/advisor) | `advisor()` in a cell: escalate to a stronger reviewer model, ported from rpiv-advisor. `/advisor` picks the model. |
| [`ask-user-question`](packages/ask-user-question) | `ask_user_question()` in a cell: the questionnaire, ported from rpiv-ask-user-question. Root sessions only. |
| [`tool-bridge`](packages/tool-bridge) | Another extension's published pi tools, callable from inside a cell as `await tool(...)`. |
| [`readonly-mode`](packages/readonly-mode) | Query-only mode: removes writer tools, gates bash, injects a prompt. |
| [`magic-context`](packages/magic-context) | Forked. Cross-session memory and context management for pi. **Prebuilt** — see below. |
| [`pi-fff`](packages/pi-fff) | Forked. [FFF](https://github.com/dmtrKovalenko/fff)'s indexed search, with the finder published for a cell's `grep`/`find`. **Prebuilt** — see below. |

Twelve of them compose into one code-mode runtime. `code-mode` owns the kernel and the `python` tool, and
`host-bridge` is the composition root — the one client of code-mode's registry, and what asks each
contributor for a session. `rlm`, `skill-bridge`, `tool-bridge`, `web-access`, `zvec-grep`, `advisor`,
`ask-user-question` and `fff-search` register with it, a contract rather than an import, and each *contributes* the host
functions, prelude lines and sentences it is responsible for; `readonly-mode` registers to contribute the
policy that governs a cell; `rsi` reaches the same client only to hold a kernel handle, and contributes
nothing. `tool-bridge` also carries the reconciler that keeps pi's active set to the tools a cell cannot
stand in for. Uninstall any contributor and the kernel still runs, with fewer names in it; uninstall
`code-mode` and the others say so instead of half-working. The other two — `magic-context` and `pi-fff` —
are independent: they are forks of somebody else's package, and one of them (`pi-fff`) is a *supplier*
rather than a contributor, publishing the finder another package turns into a cell's engine.

## Setup

```bash
git clone --recurse-submodules https://github.com/zeroqn/pi.git
cd pi && bun install && bun run check
```

One thing no package manager can supply:

```bash
export MONTY_BIN=/path/to/monty/bin/monty           # code-mode's worker
```

- `MONTY_BIN` — code-mode's [monty](https://github.com/pydantic/monty) worker is a native binary,
  not the npm dependency of the same name. Without it the kernel cannot start.
- `zvec-grep` needs the `zg` CLI on `PATH` (or `ZVEC_GREP_BIN` pointing at it).

`bun run test` (or `bun run check`) is the test command — it gives each package its own working
directory, which they need: their `mock.module` fakes are process-global. A bare `bun test` at this
root is a different thing, and not a safe one: it collects every `*.test.*` under the working
directory, which includes `vendor/magic-context`'s suite, and a nested `bunfig.toml` is never read
from above, so those tests would run without the preload that keeps them off the live database.
`bunfig.toml` scopes a stray bare run to `packages/`.

Install one at a time, or the whole set from the root manifest:

```bash
pi install ./packages/rlm      # one package
pi install .                   # or this repo's root, whose manifest declares all fourteen
```

## The forks

### magic-context

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

### pi-fff

`vendor/fff` is a submodule of [zeroqn/fff](https://github.com/zeroqn/fff), branch `pi` —
[dmtrKovalenko/fff](https://github.com/dmtrKovalenko/fff) plus two commits: one publishes the process-global
finder slot (`Symbol.for("pi-fff:finder")`) that another package turns into a code-mode session's search
engine, and one adds the `engine-only` mode that registers no pi tool at all. Rebase onto upstream with:

```bash
git -C vendor/fff fetch upstream main
git -C vendor/fff rebase FETCH_HEAD
```

**`packages/pi-fff/` is generated from it**, by
[`.github/workflows/fff.yml`](.github/workflows/fff.yml), for the same reason magic-context's is: a git
install never initialises submodules. The build is one `bun build` bundle with the native SDK left
external, and the workflow refuses to commit a bundle that does not carry the finder slot. Its `version`
is upstream's own rule for a commit that is not a release tag — the patch in `crates/fff-core/Cargo.toml`
bumped, plus the commit, e.g. `0.11.1-nightly.2c45bec` — because a fork carries no tags. Do not edit the
directory by hand.

## Licence

MIT. The submodule carries upstream's own MIT licence and copyright.

The package READMEs and source headers reference a private working tree (`.scratch/`, ticket
numbers); it is not public.
