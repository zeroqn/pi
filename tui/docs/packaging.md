# Packaging: one `pi`, two binaries

Ticket 10 of the `tui-rust` map. The target is a machine where typing `pi` starts the Rust client, and the
host it drives is a stock pi build.

## The layout

```
bin/pi        the wrapper: takes the `pi` name
bin/rpi       the Rust client
bin/pi-host   the host (stock pi; `--mode rpc` reads it)
```

`bin/pi` resolves the client as `PI_TUI_CLIENT` -> `rpi` beside it -> `rpi` on PATH, and the host as
`PI_TUI_HOST` -> `pi-host` beside it -> `pi-host` on PATH -> `pi` on PATH. Nothing in the wrapper is
load-bearing: a machine with only the stock pi still works, because the client speaks `--mode rpc` to
whatever answers.

The client resolves the same host on its own when the wrapper is not in front of it: `--pi 'CMD ARGS'`,
else `PI_TUI_HOST`, else `pi` on PATH. That is how a `nix develop` shell points a bare `rpi` at the host
it just built, without a wrapper and without baking a store path into the client.

## Releases: two streams, gated and attested

Building an AOT host needs the canary Bun, a pi checkout and a compile; a user of this client should not
repeat any of that. So each release carries artifacts per platform, named by URL and hash in one of two
manifests. The two are separate on purpose: the client changes far more often than pi does, so a pi release
must neither wait for it nor drag a half-finished client into a pi version.

| Stream | Tag | Assets per platform | Manifest |
|---|---|---|---|
| the agent | `pi-v<pi version>` | `pi-aot-<pi>-<platform>.tar.gz` (the host and its assets), `bun-aot-<pin>-<platform>.zip` (the engine it was compiled with) | `nix/manifest.nix` |
| the client | `tui-v<client version>` | `pi-tui-<client>-<platform>.tar.gz` (`rpi` and the `pi` wrapper) | `nix/manifest-tui.nix` |

`tui-release.yml` runs on **dispatch only** — the client is under heavy development, so nothing is built on
a push. A dispatch always builds both Linux legs and runs the client's `cargo test`; it publishes
`tui-v<version>` (from `tui/Cargo.toml`) when `publish` is checked. `aot-release.yml` publishes the agent
when pi's own release version changes, on a daily schedule.

Downstream, with this repository as an input (`extensions/` is the repository root, so the flake is in the
`tui` subdirectory):

```nix
inputs.pi-tui = {
  url = "github:zeroqn/pi?dir=tui";
  inputs.nixpkgs.follows = "nixpkgs";
};

# then, for the platform you build on:
pi-tui.packages.x86_64-linux.pi-aot    # pi, ahead of time: bin/pi, libexec/pi/pi, share/pi
pi-tui.packages.x86_64-linux.rpi-bin   # rpi + the wrapper, from the client's own release
pi-tui.packages.x86_64-linux.bun-aot   # the Bun the host was compiled with
```

An attribute exists **only for a platform that manifest carries**, so a downstream lock taken before a
release has `rpi` and `bun-aot` but no prebuilt host. `pi-aot` installs the executable in `libexec` and the
assets in `share`, and its `bin/pi` sets `PI_PACKAGE_DIR` at the second — the one-artifact rule as a store
layout. Everything installed from a release goes through `nix/prebuilt.nix`, which patches the interpreter
for this store.

`pi-aot`'s `bin/pi` also exports `ONNXRUNTIME_LIB_PATH` and a `LD_LIBRARY_PATH` entry carrying
`packages.onnxruntime-shim`, so a consumer of this flake's host gets Magic Context's native embeddings
without a dev shell: the host embeds the canary Bun above (>= 1.4), the plugin takes the `native` path, and
what it loads is the binding `../packages/onnxruntime-node` ships. Both exports have to be in the launching
process — glibc reads `LD_LIBRARY_PATH` before any JavaScript runs — and the shim is a reference of the
output, so installing the host installs the shim. `nix/onnxruntime-check.sh` is the gate: it builds vectors
from the plugin's own transformers chunk on the shell's Bun and, with `--host`, inside the host's own
process with the outer environment stripped.

### What watches upstream, and what may publish

`.github/workflows/aot-release.yml` runs on a daily schedule and on dispatch. It watches **pi's releases
only**:

| Upstream event | Behaviour |
|---|---|
| a new pi release | published as `pi-v<version>`, with the AOT host and the Bun archive that host was compiled with |
| a platform whose leg failed | the other platforms still publish; `nix/manifest.nix` names only the ones that passed |
| nothing new | the run reports where the Bun pin stands and stops |
| Bun's canary moves | nothing on its own schedule: Bun moves when a pi release is built, and travels inside that release |

That is deliberate. Upstream's `canary` assets are replaced daily and their old URLs stop working, so a pin
that named oven-sh's tag would rot between releases. Each release therefore re-pins, downloads the archive
it verifies by hash, and uploads it as `bun-aot-<pin version>-<platform>.zip`; `nix/runtime.nix` prefers that
release asset once `nix/manifest.nix` carries it, and falls back to the upstream pin only before a release
exists. Releases are kept, because they are the pi versions we follow and because they hold our own copy of
the engine.

The pin is a generated file: `nix/bun-pin.nix` records each archive's content hash, plus upstream's
`etag`/`last-modified` as what upstream claims. `nix/runtime.nix` is hand-written and reads it.

**The hash is the pin, never the etag.** Measured 2026-11-23: Bun replaced a `canary` asset without changing
its etag, so a check that trusted the etag passed a stale pin straight into a build, which then failed with
`hash mismatch in fixed-output derivation`. `bun-pin-update.sh --check` therefore downloads this platform's
archive (about 78 MB) and hashes it. That also means `--check` needs no dev shell, which matters because the
shell itself builds `bun-aot` and cannot start while the pin is stale:

```sh
nix/bun-pin-update.sh --check    # exit 0 current, 10 moved; plain bash, no `nix develop`
nix/bun-pin-update.sh            # rewrite the pin from what upstream serves now
bun-pin-tools.py from-entries …  # the pin a release publishes: its own archives, not upstream's
```

If `nix develop` fails with a hash mismatch, the canary moved: run `nix/bun-pin-update.sh` and retry.

### Nothing publishes unless both gates pass

1. `nix/aot-smoke.sh` — the executable reports the version of the manifest beside it, answers `get_state`
   over `--mode rpc`, and the client starts under a pty.
2. `tools/harness/smoke_host.py --host <aot pi>` — the client spawns that host, a fake model answers, and
   the answer is painted. Verified locally: `ok: 'Done' rendered from a live RPC host (3796 bytes, 39
   frames)`.

A failing gate fails the run, and the pin, the manifest and the release page stay as they were. The manifest
commit lands only after all three platforms passed, because it is what downstream flakes lock.

### Attestation

- **The artifacts we build** get GitHub build provenance: `gh attestation verify <asset> --repo <owner>/<repo>`.
- **The Bun canary** is not built here, so no build provenance of ours could be honest about it. Instead the
  pin file is attested with a custom predicate (`.../attestation/bun-pin/v1`) that records the upstream URL,
  the etag and the hash of each archive the release was compiled with. The hash is what a downstream build
  actually enforces; the attestation records the claim.

Lean on the hash, not the attestation, for the canary: our signature says "these are the bytes our release
used", and only the pin's hash says which bytes those are.

## What each invocation means

| Invocation | Goes to | Why |
|---|---|---|
| `pi` (no args) | client, which spawns `host --mode rpc` | an interactive turn is the client's |
| `pi -p "..."` | **host**, unchanged | print mode produces text, not a screen; the client refuses a non-TTY |
| `pi --version` | **host** | the version is the host's, not the client's (verified: prints `1.5.0`) |
| `pi auth`, `login`, `update`, `mcp`, `config` | **host** | subcommands are host concerns |
| `pi --mode rpc` | **host** | another RPC client is already the client; the wrapper must not nest |
| `PI_TUI_CLIENT=... pi` | that binary | an explicit override, e.g. from a nix build |
| `PI_TUI_HOST=... pi` | that host | the fallback switch, without a rebuild |

The passthrough list is a `case` on `$1`; anything else reaches the client, which hands unknown arguments
to the host, so an unlisted subcommand still works.

## The host: upstream `bun build --compile --aot`

No patched engine and no fork. Bun's ahead-of-time compiler (`src/aot` in Bun, `Source/JavaScriptCore/aot/`
in oven-sh/WebKit) is reachable as `bun build --compile --aot`:

```sh
nix develop && aot-host          # == nix/aot-host.sh: pi's dist, then the compile
```

Three facts decide the shape of it, all measured:

- **Canary only.** Released Bun 1.4.5 (2026-11-19) has no `--aot` and no AOT strings in its binary; the
  canary has the full flag set (`--aot`, `--explain`, `--aot-harden`, `--aot-order`, `--aot-allow-code-from-disk`,
  `--compile-in-place`, `--obfuscate`). `nix/runtime.nix` therefore pins the canary archive **by hash**, not
  by the moving tag.
- **`--aot-allow-code-from-disk` is required.** Without it the executable refuses to load any extension
  (`Cannot load 'node:dns/promises': it isn't in this executable`); with it, magic-context, rlm and code-mode
  load from disk and the code-mode kernel mounts.
- **The output carries `/lib64/ld-linux-x86-64.so.2`** whatever Bun's own interpreter is, so a NixOS host
  needs `patchelf --set-interpreter`/`--set-rpath`; `aot-host` copies the runtime's own patched values.

**The executable and what it reads beside itself are one artifact.** pi's version is a run-time read of
`dirname(execPath)/package.json` (`packages/coding-agent/src/config.ts:417-607`), and a missing file is
swallowed: the binary prints `0.0.0` instead of failing. `package.json`, `theme/`, `assets/`,
`export-html/`, `docs/`, `examples/`, the photon wasm and the native prebuilts therefore stay in the
executable's own directory, and `aot-host` refuses to finish if `--version` disagrees with the sidecar it
staged. `PI_PACKAGE_DIR` is pi's own escape hatch for moving that directory; a compiled-in version would
need a pi patch, which is the one delta this package does not take.

Measured on pi 1.6.0, same tree, warm `pi --version`:

| Host | executable | `pi --version` |
|---|---|---|
| `--aot --splitting` | 219 MB | 37-51 ms |
| `--bytecode` | 195 MB | 92-109 ms |

No training profile is used. The receiver that would record one is Bun's own `--aot-record-order` /
`--aot-order`, which is a later step, not a blocker.

## The client's own startup budget

C-8 in `acceptance.md`: client + host <= 250 ms with the bytecode host, <= 100 ms with an AOT host, and the
client's own share <= 60 ms. The client loads a theme file, a syntax set and a `OnceLock`; the highlight
bench measured 37-98 ms wall including process start.

## Verified, and not verified

**Verified**

- `nix build .#rpi`: `$out/bin` holds `rpi`, `pi-tui -> rpi`, and the `pi` wrapper.
- `nix develop`: `$PI_TUI_RUNTIME --version` is Bun 1.4.6 and its `--compile --help` lists `--aot`.
- `aot-host` in that shell: pi 1.6.0's `dist`, the AOT compile (2,333 modules, 4.8 s), assets staged, the
  interpreter patched — `results/pi/pi --version` prints `1.6.0`, and three runs took 36-55 ms.
- The link: `PI_TUI_HOST=results/pi/pi $out/bin/pi --version` printed `1.6.0` (wrapper → host), and
  `rpi --once` under a pty entered the alternate screen and painted frames against that AOT host.
- `bin/pi --replay ...` refuses a non-TTY with 0 bytes on stdout and one line on stderr; `bin/pi --help`
  prints pi's own help.
- The AOT executable on its own: `pi -ne --mode rpc` answers `get_state`.

**Not verified, said plainly**

- A full interactive turn on a real terminal, with a model answering, through the wrapper.
- `nix build` inside `extensions/` (a git tree) with these files untracked: Nix only sees tracked files,
  so the files must be committed first. The build was verified from a copy outside git.
- A recorded startup profile (`--aot-record-order`); the numbers above are without one.
- `aarch64` and `darwin`: `nix/runtime.nix` pins the x86-64-linux archive only.
