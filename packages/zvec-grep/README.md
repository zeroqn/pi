# zvec-grep

[zvec-grep](https://github.com/) (`zg`) inside a code-mode cell: ranked search over the workspace's
index, and exhaustive managed ripgrep, as two host functions. No pi tool — code mode's mount narrows a
session's tool surface to `python`, so a capability a cell cannot reach is a capability nobody has.

```python
hits  = await zvec_grep_search(query="where is auth validated", limit=7)
lines = await zvec_grep_rg("rg -n -F loadTheme -g '*.ts' src | head -40")
```

## The two functions

| | |
| --- | --- |
| `zvec_grep_search` | **The index.** `query` for one hybrid (lexical + semantic) query, or `queries` / `fts` (ranked lexical) / `vector` (semantic only) for several, with `fuse` to fuse them into one list. Narrows by `globs`, `iglobs`, `file_types`, `excluded_file_types`, `symbol_type`, `prefer_symbol`, `modified_after`, `modified_before`; caps with `limit`; controls the source display with `preview`. Needs a built index. |
| `zvec_grep_rg` | **The files.** `zg`'s managed ripgrep — bundled, `.git/**` and `.zvec-grep/**` excluded, no index, and the fallback when the index is missing. `command` is the ripgrep command you would otherwise run; it is **tokenized, never shelled**. A trailing `| head -N` bounds the output. |

Both take `root` (an absolute workspace root; defaults to the session's directory) or `roots=[…]` to fan
out over several workspaces in one call, each run in its own directory.

`refresh` (`off` / `wait` / `background`) and `mode` (`direct` / `server` / `auto`) are passed straight
to `zg`, whose defaults differ per mode — in server mode a stale index is refreshed in the background.

## The boundary

- **Arguments are snake_case** (`file_types`, `symbol_type`, `prefer_symbol`, `modified_after`, …). The
  old camelCase spellings still bind, and either spelling of a name twice in one call is a `ValueError`.
- **An unknown parameter raises `ValueError` before anything runs**, and a wrong type raises
  `TypeError`. A misspelled argument is meant to be loud — it would otherwise be silently dropped, and
  the caller would believe it did something.
- **The return is text** — what `zg` printed, bounded at 80 000 characters, with a `### <root>` header
  per root when more than one ran.
- **A partial failure is text** that names the roots that failed, with their exit codes. Only when
  **every** root fails does the call raise `RuntimeError`.
- The names the cell sees are exactly `zvec_grep_search` and `zvec_grep_rg`: the functions are
  contributed to the kernel by name, and monty binds by `.name`.

## Commands

The six commands stay pi commands — a human types them, and a host function cannot be typed:

| | |
| --- | --- |
| `/zg-enable [--rebuild] [--root <path>] [model]` | Build/update the workspace index and start the shared daemon. |
| `/zg-index [--rebuild] [--drop] [--root <path>] [model]` | The index alone. `--drop` asks first. |
| `/zg-index-all [--rebuild] [model]` | Strategy B: one index per configured root. |
| `/zg-status` | `zg status` for this workspace. |
| `/zg-status-all [<scan-root>]` | Every indexed workspace under a root, with how long ago each was indexed. |
| `/zg-server [on\|off\|status]` | The shared daemon. |

The footer's status line says whose it is: `zg: index ready`, `zg: indexing <root>…`,
`zg: no index — run /zg-index`, `zg: index ready · server on`, `zg: setup incomplete`, … Set
`ZVEC_GREP_PI_STATUS=0` to switch it off.

## Setup

`zg` must be on `PATH`, or `ZVEC_GREP_BIN` must point at it. A search needs an index: `/zg-index` (or
`/zg-enable`) builds one.

Both CLI generations are detected from `zg --version` — `0.2.1` and later use `zg <query>` / `zg --rg`,
`0.2.0` and earlier use `zg query` / `zg query --rg` — and `ZVEC_GREP_CLI_STYLE=modern|legacy` skips the
probe.

| Variable | |
| --- | --- |
| `ZVEC_GREP_BIN` | The binary. Default `zg`. |
| `ZVEC_GREP_CLI_STYLE` | `modern` or `legacy`, skipping detection. |
| `ZVEC_GREP_PI_WORKSPACE` | Strategy A: the one parent workspace root every search uses (fused ranking across the repos inside it). |
| `ZVEC_GREP_PI_ROOTS` | Strategy B: comma- or newline-separated roots, each with its own index. |
| `ZVEC_GREP_EMBEDDING` | The embedding model for a new index. |
| `ZVEC_GREP_PI_STATUS` | `0` disables the footer status. |

A config file may carry the same three settings: `~/.pi/agent/zvec-grep.json` first, then
`<cwd>/.pi/zvec-grep.json`, the project's scalars winning. A nested git repository is only indexed if
its workspace manifest carries `include: ["**"]`, which this extension seeds before the first index.

## Read-only mode

Both names are **exempt**: `/readonly` permits them inside a cell, and the mode's own prompt says so.

`zvec_grep_rg` writes nothing at all, in any mode. `zvec_grep_search` is not itself read-only, and its
exemption says so: **every indexed query writes** a lock directory and a 6–12-byte last-accessed stamp
inside `<root>/.zvec-grep/`, which no flag turns off, and with the shared daemon up a stale index is
rewritten in the background (which briefly excludes a concurrent read with `ENGINE.LOCK.BUSY`). The
ground for the exemption is that `.zvec-grep/` is the index's own bookkeeping and never the workspace's
content. Measured, not assumed — `.scratch/zvec-grep/tools/zg-writes/`.

## Where the code is

| | |
| --- | --- |
| `index.ts` | The entry: the host-bridge registration and the contribution's prose, the six commands, the footer. |
| `src/cli.ts` | The spawned process, the CLI generation, argv, the command tokenizer, output bounding, the per-root fan-out. |
| `src/config.ts` | Roots and the workspace root, the manifest seeding. |
| `src/host.ts` | The two host functions and their boundary. |

`createZgCli` takes its executor as a parameter, so the whole call path is drivable with no `zg`
installed: `bun test` runs 57 cases, and only the three that test the runner itself spawn anything.
