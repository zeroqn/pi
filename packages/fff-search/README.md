# fff-search

FFF's index behind a code-mode cell's `grep` and `find`.

A contributor to [`host-bridge`](../host-bridge)'s seam: it takes the one `search` slot code mode's
contract leaves open (`API_VERSION` 3) and answers those two primitives from
[FFF](https://github.com/dmtrKovalenko/fff)'s indexed finder, instead of spawning `rg`/`fd`.

The finder belongs to the [`pi-fff` prebuilt](../pi-fff), which publishes it on
`Symbol.for("pi-fff:finder")` — a process-global, because pi loads each extension entry through its own
jiti instance and an import would be a second index over the same tree.

## Only when asked

`fuzzy=True` routes a call to the index; without it, `rg`/`fd` answer exactly as they did before this
package existed. That is not caution, it is a measurement: **FFF's index does not cover dot-paths**, while
code mode runs `rg`/`fd` with `--hidden`. A file under `.hidden/` is unreachable by every FFF spelling —
fuzzy search, `glob("**/h.ts")`, an explicit `.hidden/*.ts` — and `grep` finds no content inside it. Since
this workspace's maps and notes live in `.scratch/`, a silent swap would have quietly narrowed the
answers that matter most.

So the flag selects FFF's own matching and ordering (its `fuzzy` grep mode, its frecency order, its fuzzy
file and directory search), and everything else — a rename sweep, an audit, a search inside a
dot-directory — stays on `rg`/`fd`.

## What it declines

Each of these throws, which is how code mode reaches the fallback rather than a failure path:

| decline | why |
|---|---|
| no `fuzzy=True` | the index lane was not asked for |
| no slot | `pi-fff` is not loaded in this process |
| a dot-path in `path` or `glob` | the index cannot see inside it, and "nothing" where rg finds matches is the worst answer |
| `max_depth` | fd's knob, no FFF equivalent |
| `type` beyond file/directory | FFF enumerates those two |

`path` and a positive `glob` are joined into the one constraint FFF's parser reads (`src` + `*.ts` →
`src/*.ts`); a negated `glob` becomes an exclusion. Paths come back in the form `rg` would have printed —
absolute for an absolute request, relative to the session directory otherwise. A cold index is waited for
at most `INDEX_WAIT_MS` (4 s) and then answered from what is indexed.

## Tests

`bun test` — a fake slot records what the engine asked for; no native library and no index are needed.
