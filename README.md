# pi-extensions

My personal [pi](https://github.com/earendil-works/pi-coding-agent) extensions. Three are mine,
one is a fork.

| Extension | |
| --- | --- |
| [`rlm`](packages/rlm) | Code-mode Python kernel; one tool replaces pi's tool surface. |
| [`rsi`](packages/rsi) | Background loop learns reusable skills from sessions and maintains them. |
| [`web-code`](packages/web-code) | `web_search` and `fetch_content` host functions for the rlm kernel. |
| [`magic-context`](vendor/magic-context) | Forked. Cross-session memory and context management for pi. |

## Setup

```bash
git clone --recurse-submodules https://github.com/zeroqn/pi.git
cd pi && bun install && bun run check
```

rlm needs a [monty](https://github.com/pydantic/monty) worker that is not on npm, and the web
functions are wired in by module name:

```bash
export MONTY_BIN=/path/to/monty/bin/monty
export RLM_WEB_MODULE="$PWD/packages/web-code/host.ts"
```

Each extension is installed on its own: `pi install ./packages/rlm`.

## The fork

`vendor/magic-context` is a submodule of
[zeroqn/magic-context](https://github.com/zeroqn/magic-context), branch `pi-agents` —
[cortexkit/magic-context](https://github.com/cortexkit/magic-context) plus four commits. Rebase
onto upstream with:

```bash
git -C vendor/magic-context fetch upstream master
git -C vendor/magic-context rebase FETCH_HEAD
```

## Licence

MIT. The submodule carries upstream's own MIT licence and copyright.

The package READMEs reference a private working tree (`.scratch/`, ticket numbers); it is not
public.
