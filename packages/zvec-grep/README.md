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

## The shared daemon

`zg` has a resident daemon (`zg --server run`), and this extension uses it by default: at session
start it asks `zg --server status --check-ready` and, when nothing answers, runs `zg --server on`.
Nothing else is needed to share one — the daemon is keyed by its *home* (`ZVEC_GREP_HOME`, else
`~/.zvec-grep`), not by session, so the second, third and tenth pi on the machine find the first one's
PID and reuse it. `start_server` closes the check/spawn race itself with a cross-process claim ("the
winner alone may spawn; waiters re-check state after the claim is released and reuse the ready
daemon"), so simultaneous session starts converge on one process.

What that buys: one engine and one loaded model per workspace instead of one per call, background
refresh of a stale index, and an index build that other sessions can join. What it costs: ~120 ms per
session start when a daemon answers, ~360 ms cold. `ZVEC_GREP_PI_SERVER=0` keeps the extension out of
it entirely.

The daemon is one process per machine because the address is fixed at `127.0.0.1:7999`: a *second*
`ZVEC_GREP_HOME` cannot start its own while the first holds the port, and the status line says so
(`daemon unreachable (Error: server address 127.0.0.1:7999 is already in use)`). `/zg-status` prints the
daemon's own answer underneath the workspace's.

## A missing index is repaired, not reported

A search in a workspace with no usable index does not fail. The call starts the build and returns what
happened:

```
zvec-grep: no usable index for /ws — nothing is indexed there yet, so nothing was searched.
A build just started in the background: `zg --index` (zg's default model for a new index, pid 4242).
It does the work behind this session (in the shared daemon when one is running) and keeps going after
this turn: do not start it again.
Retry this search in about a minute; meanwhile `await zvec_grep_rg(...)` gives exact matches with no
index at all.
```

- The build is a **detached** child: own process group, no pipe, `unref`'d, and deliberately not tied to
  the run's abort signal — an aborted turn must not cancel indexing. With a daemon up the child posts
  `/admin/index` and the *daemon* does the work, so a second session asking for the same root **joins**
  the job instead of starting a rival one (`IndexJobScheduler::submit`, per-root writer serialization).
- One build per root per session: a second search while it runs answers "a build started 12s ago in this
  session is still running".
- An index written by another `zg` version (`This index is incompatible with the current version of
  zg`) is **rebuilt** rather than built, and the note says so.
- A failure that is not about the index still raises `RuntimeError`, as before.
- No model is named: `zg` picks its default for a new index (`local/potion-code-16m-v2`, 31 MiB).
  `ZVEC_GREP_EMBEDDING` or a `model` in the config file overrides it. `ZVEC_GREP_PI_AUTOINDEX=0` turns
  the whole behaviour off, leaving the explicit `/zg-index`.

## ## The boundary

- **Arguments are snake_case** (`file_types`, `symbol_type`, `prefer_symbol`, `modified_after`, …). The
  old camelCase spellings still bind, and either spelling of a name twice in one call is a `ValueError`.
- **An unknown parameter raises `ValueError` before anything runs**, and a wrong type raises
  `TypeError`. A misspelled argument is meant to be loud — it would otherwise be silently dropped, and
  the caller would believe it did something.
- **The return is text** — what `zg` printed, bounded at 80 000 characters, with a `### <root>` header
  per root when more than one ran.
- **A partial failure is text** that names the roots that failed, with their exit codes. Only when
  **every** root fails does the call raise `RuntimeError`.
- **`excluded_file_types` needs a filter the Rust `zg` cannot build.** The pinned zvec release — the
  storage engine both generations ship — rejects the `NOT LIKE` clause the CLI derives from `-T`, which
  upstream's own test states as a fact (`zg-engine/src/storage/fragments/tests.rs`,
  `the pinned zvec release does not parse NOT LIKE`). A search carrying it fails on the Rust binary, and
  the failure says so instead of echoing the storage engine's SQL: pass the exclusion as a negated glob,
  `globs=["!*.ts"]`, which that engine does support. The `0.2.0` node CLI's `-T` works as it always did.
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

The footer's status line says whose it is, and what the daemon is doing: `zg: index ready · daemon on
(PID 1234)`, `zg: no index — run /zg-index · daemon on (PID 1234), started here`, `zg: index ready ·
daemon unreachable (…)`, `zg: indexing <root>…`, `zg: setup incomplete`, … Set `ZVEC_GREP_PI_STATUS=0`
to switch it off.

## Setup

`zg` must be on `PATH`, or `ZVEC_GREP_BIN` must point at it. A search needs an index; the first search
in an unindexed workspace starts its build (see above), and `/zg-index` (or `/zg-enable`) builds one
deliberately.

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
| `ZVEC_GREP_PI_SERVER` | `0` stops the extension starting or reusing the shared daemon. |
| `ZVEC_GREP_PI_AUTOINDEX` | `0` stops a search from starting a missing index's build. |

A config file may carry the same three settings: `~/.pi/agent/zvec-grep.json` first, then
`<cwd>/.pi/zvec-grep.json`, the project's scalars winning.

A nested git repository is only indexed if the workspace manifest carries `include: ["**"]`, which this
extension seeds before the first index — that generation skips nested repositories without it.

The seed is the **node** generation's manifest shape, and the two generations do not read each other's:
the Rust `zg` answers `unsupported index version … rebuild the index with …` and then refuses both to
index and to search. So `/zg-index`, `/zg-index-all` and `/zg-enable` run through `indexWorkspace`
(`src/cli.ts`), which hears that refusal, drops the seed — nothing is indexed behind an unbuilt manifest,
and a manifest that carries an `indexVersion` or a Rust `storageGeneration` is never touched — and runs
the index again. The Rust engine needs no seed at all: it indexes nested repositories by default.

`/zg-status-all` reads whichever manifest it finds for the workspace name, the last-index time and the
embedding model (`embedding.model` on the node manifest, `embeddings[0].model.name` on the Rust one).

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
| `src/cli.ts` | The spawned process, the CLI generation, argv, the command tokenizer, output bounding, the per-root fan-out, the index retry, the daemon handshake, the detached index build. |
| `src/config.ts` | Roots and the workspace root, the workspace manifest (seeded, dropped again, read back for `/zg-status-all`). |
| `src/host.ts` | The two host functions, their boundary, and the index-on-demand note. |

`createZgCli` takes its executor as a parameter, so the whole call path is drivable with no `zg`
installed: `bun test` runs 90 cases, and only the three that test the runner itself spawn anything.
