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
| `crates/pi-tui` | the client: spawns or replays a host, renders the transcript as wrapped lines, owns the terminal and the composer. Frames go through a writer thread (one-frame slot, newest wins), the screen is diffed row by row with scroll regions, and a dropped frame invalidates it. Markdown is typeset (headings, fences with syntax colour, lists, tables), dialogs and the pickers are pi's, and the composer sits in pi's editor box above the session footer (cwd, tokens, context budget, cost, model). |
| `tools/harness/` | the measurement harness (Pi-Bolt's `bench/` subset), `record_corpus.py` (records the RPC corpus), `echo_probe.py` (echo latency from outside the client), `smoke_host.py` (end-to-end against a real host). |
| `nix/onnxruntime-shim/` | the `libonnxrtabi24.so.1` ABI shim Magic Context's native embeddings are loaded through, built against this flake's `onnxruntime` (ported from `shell/onnxruntime-shim/`); `nix/onnxruntime-check.sh` is its gate. |

Layout for a machine where `pi` is the client: `bin/pi` (wrapper), `bin/rpi` (the client),
`bin/pi-host` (the host). See `docs/packaging.md` and `nix/package.nix`.

`flake.nix` builds the client (`nix build .#rpi`) and gives the shell that builds the host:

```sh
nix develop            # rust, node 22, and nix/runtime.nix's Bun (the one with --aot)
aot-host               # pi's dist, then `bun build --compile --aot` -> results/pi/pi
cargo build --release && rpi   # the client drives the host this shell built
```

Run `rpi` **in that shell**: it is an interactive terminal client, and the shell is where it finds both
`PI_TUI_HOST` and the binary you built. Scripted and non-interactive callers go through a shell of their
own — `nix develop --command bash -c 'rpi …'`. Plain `nix develop --command rpi …` runs the client as
nix's own child process, where its terminal reader gets no usable input and it exits after its first frame.

The shell also exports what Magic Context's local embeddings need — `LD_LIBRARY_PATH` carrying the shim and
`ONNXRUNTIME_LIB_PATH` naming the nixpkgs ONNX Runtime it forwards to — and `.#pi-aot`'s `bin/pi` exports
both itself, so installing the host installs the shim with it. Both are `x86_64-linux` only, because the
binding they load is vendored for `linux/x64` alone (`packages/onnxruntime-node`).
`onnxruntime-check --host $PI_TUI_OUT/pi` proves the seam end to end: a 384-dimension embedding from the
plugin's own chunk, on the shell's Bun and inside the host's own process.

Released builds skip all of that: `packages.pi-aot` and `packages.bun-aot` come from the agent's stream
(`nix/manifest.nix`, tag `pi-v<pi version>`), and `packages.rpi-bin` from the client's own stream
(`nix/manifest-tui.nix`, tag `tui-v<client version>`). `nix/bun-pin.nix` pins the Bun canary the host is
compiled with. See `docs/packaging.md`.

```sh
cargo build --release && rpi                      # `rpi` is on PATH inside the shell
./tools/harness/smoke_host.py --binary "$(command -v rpi)"   # the client drives a live `pi --mode rpc`
./tools/harness/echo_probe.py --binary $BIN --replay ../../.scratch/tui-rust/fixtures/code.jsonl \
  --pace-ms 2 --repeat 200 --keys 200 --stats /tmp/stats.json
```

The shell puts an `rpi` on `PATH` that runs the client you built: `cargo build --release` in this
directory, then plain `rpi`. It finds the binary in `./target` (or one and two directories up, so
`nix develop --command rpi` works from `nix/` and `tools/harness/` too) and honours `CARGO_TARGET_DIR`
first if you set one. Nothing has to be copied or found by hand.

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
