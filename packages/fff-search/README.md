# fff-search

FFF's index behind a code-mode cell's `grep` and `find`.

A contributor to [`host-bridge`](../host-bridge)'s seam: it takes the one `search` slot code mode's
contract leaves open (`API_VERSION` 3) and answers those two primitives from
[FFF](https://github.com/dmtrKovalenko/fff)'s indexed finder, instead of spawning `rg`/`fd`.

The finder belongs to the [`pi-fff` prebuilt](../pi-fff), which publishes it on
`Symbol.for("pi-fff:finder")` — a process-global, because pi loads each extension entry through its own
jiti instance and an import would be a second index over the same tree.

## Two lanes, and the cell picks one

| a cell writes | matched by | ordered by |
|---|---|---|
| `grep(p)` / `find(g)` | `rg` / `fd` | theirs |
| `grep(p, index=True)` | the index, with rg's matcher (`literal`/`ignore_case`) | code mode: path, then line |
| `grep(p, fuzzy=True)` | FFF's fuzzy matcher | FFF: frecency |

`index=True` is the **fast exact** lane: rg's matcher, from an index that does not walk the tree. Its result
set is rg's *over the paths the index covers* — measured on a dot-free subtree, 7 = 7 matches with nothing
missing and nothing invented, at 20× the speed (`grep` over a large tree: 300 ms warm against rg's 5.7 s).
Over a workspace root it is that set minus the dot-path hits, which is the one thing the flag cannot widen.
(`fuzzy` is the lane for a question that is not exact at all, and implies `index`.)
Neither flag, and `rg`/`fd` answer exactly as they did before this package existed. That is not caution, it
is a measurement: **FFF's index does not cover dot-paths**, while code mode runs `rg`/`fd` with `--hidden`.
A file under `.hidden/` is unreachable by every FFF spelling — fuzzy search, a recursive glob, an explicit
`.hidden/` path — and `grep` finds no content inside it. Since this workspace's maps and notes live in
`.scratch/`, a silent swap would have quietly narrowed the answers that matter most.

What the exact lane cannot reproduce is rg's *arrival order* — that is a walk's, and an index does not
walk — so code mode orders its matches by path then line, as it already orders `find`'s.

## What it declines

Each of these throws, which is how code mode reaches the fallback rather than a failure path:

| decline | why |
|---|---|
| neither flag | the index lane was not asked for |
| no slot | `pi-fff` is not loaded in this process |
| a dot-path in `path` or `glob` (or in `find`'s pattern, which *is* a path glob) | the index cannot see inside it, and "nothing" where rg finds matches is the worst answer |
| `ignore_case` over a pattern with an uppercase letter | the SDK exposes `smartCase` alone, which is case-insensitive only for an all-lowercase pattern |
| a regex the index cannot compile | FFF falls back to literal matching and reports it in `regexFallbackError`; a cell that wrote `a(b` must get rg's loud failure, not an empty set |
| `max_depth` | fd's knob, no FFF equivalent |
| `type` beyond file/directory | the index enumerates those two |
| an exact directory listing, or files *and* directories together | the index's exact matcher (`glob`) enumerates files only, and its directory call is fuzzy |

`path` and a positive `glob` are joined into the one constraint FFF's parser reads (`src` + `*.ts` →
`src/*.ts`); a negated `glob` becomes an exclusion. Paths come back in the form `rg` would have printed —
absolute for an absolute request, relative to the session directory otherwise. A cold index is waited for
at most `INDEX_WAIT_MS` (4 s) and then answered from what is indexed.

## Tests

`bun test` — a fake slot records what the engine asked for; no native library and no index are needed.
