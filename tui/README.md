# extensions/tui — the Rust client (work in progress)

A wayfinder effort, not a finished thing. The map is `.scratch/tui-rust/map.md`; the bar is
`.scratch/tui-rust/acceptance.md`.

The client renders pi's transcript itself and drives pi as a headless host over `pi --mode rpc`. **pi is
not patched** — no fork, no per-release delta to re-port. `examples/` is retired as a patch harness;
this package builds the client and AOT-compiles a stock pi behind it (`nix develop && aot-host`).

## What exists

| Path | What it is |
|---|---|
| `crates/pi-rpc` | the wire: the event inventory (hand-written, from pi 1.5.0's types), validation, JSONL framing. `cargo test` here is the drift detector. |
| `crates/pi-tui` | the client: spawns or replays a host, renders the transcript as wrapped lines, owns the terminal and the composer. Frames go through a writer thread (one-frame slot, newest wins), the screen is diffed row by row with scroll regions, and a dropped frame invalidates it. No markdown, no dialogs yet. |
| `tools/harness/` | the measurement harness (Pi-Bolt's `bench/` subset), `record_corpus.py` (records the RPC corpus), `echo_probe.py` (echo latency from outside the client), `smoke_host.py` (end-to-end against a real host). |

Layout for a machine where `pi` is the client: `bin/pi` (wrapper), `bin/rpi` (the client),
`bin/pi-host` (the host). See `docs/packaging.md` and `nix/package.nix`.

`flake.nix` builds the client (`nix build .#rpi`) and gives the shell that builds the host:

```sh
nix develop            # rust, node 22, and nix/runtime.nix's Bun (the one with --aot)
aot-host               # pi's dist, then `bun build --compile --aot` -> results/pi/pi
cargo build --release && rpi   # the client drives the host this shell built
```

Released builds skip all of that: `packages.pi-aot`, `packages.rpi-bin` and `packages.bun-aot` install the
tarballs named in `nix/manifest.nix`, with hashes. `nix/bun-pin.nix` pins the Bun canary the host is
compiled with. `.github/workflows/aot-release.yml` watches upstream, builds, gates and publishes. See
`docs/packaging.md`.

```sh
cargo build --release
BIN=$(cargo metadata --format-version 1 --no-deps | python3 -c 'import json,sys;print(json.load(sys.stdin)["target_directory"]+"/release/rpi")')
./tools/harness/smoke_host.py --binary $BIN      # the client drives a live `pi --mode rpc`
./tools/harness/echo_probe.py --binary $BIN --replay ../../.scratch/tui-rust/fixtures/code.jsonl \
  --pace-ms 2 --repeat 200 --keys 200 --stats /tmp/stats.json
```

`cargo` writes into `CARGO_TARGET_DIR` here, which is not `extensions/tui/target`; take the path from
`cargo metadata` rather than guessing.

## The corpus

```sh
cd tools/harness
python3 record_corpus.py --pi pi --out ../../../../.scratch/tui-rust/fixtures
cd ../.. && cargo test
```

Five fixtures — `text`, `code`, `tool`, `compact`, `dialog` — are the raw stdout of `pi --mode rpc`,
one JSON object per line. Never edit them by hand: re-record. `cargo test` fails on any event type,
field or assistant delta that the inventory does not know, which is how a pi upgrade announces itself.

## Why the recorder is Python and the wire is Rust

The recorder is scaffolding for a data artifact: it needs process control, a scripted model and a
throwaway home, all of which the harness already has, and it must be re-runnable without a build.
`crates/pi-rpc` is what ships inside the client, so it holds only what the client uses — the inventory,
validation and framing — and its tests are the ones that must keep passing.
