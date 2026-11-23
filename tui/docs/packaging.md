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

## Releases: prebuilt artifacts, and how a downstream flake installs them

Building an AOT host needs the canary Bun, a pi checkout and a compile; a user of this client should not
repeat any of that. So each release carries three artifacts per platform, and `nix/manifest.nix` names them
by URL and hash:

| Asset | Contents |
|---|---|
| `pi-aot-<pi version>-<platform>.tar.gz` | `pi`, `package.json`, `theme/`, `assets/`, `export-html/`, `docs/`, `examples/`, `native/`, `photon_rs_bg.wasm`, `LICENSE` |
| `pi-tui-<client version>-<platform>.tar.gz` | `rpi` and the `pi` wrapper beside it |
| `bun-aot` (no asset: `nix/runtime.nix` fetches it) | the canary archive, pinned by hash |

Downstream, with this flake as an input:

```nix
pi-tui.packages.x86_64-linux.pi-aot    # pi, ahead of time: bin/pi, libexec/pi/pi, share/pi
pi-tui.packages.x86_64-linux.rpi-bin   # rpi + the wrapper: bin/{pi,rpi}
pi-tui.packages.x86_64-linux.bun-aot   # the engine, if you want to compile something yourself
```

`pi-aot` installs the executable into `libexec` and the assets into `share`, and its `bin/pi` sets
`PI_PACKAGE_DIR` at the second — the one-artifact rule above, expressed in a store layout. Both are built by
`nix/prebuilt.nix` with `autoPatchelfHook`, so the interpreter is this store's glibc even though the tarball
was compiled elsewhere.

```sh
nix develop --command aot-release --pi /path/to/pi-checkout   # tarballs + this platform's manifest entry
```

`.github/workflows/aot-release.yml` runs that on three runners (`ubuntu-24.04`, `ubuntu-24.04-arm`,
`macos-14`), because `--aot` cannot cross-compile, uploads the tarballs to a release, and commits
`nix/manifest.nix`. The weekly scheduled run only reports: upstream pi's version, and whether the canary
archive moved. Moving the Bun pin is a manual edit with a fresh hash for **every** platform, since the three
archives in `nix/runtime.nix` are one set.

Verified here: `nix build .#bun-aot` (1.4.6, `--aot` present), `aot-release` producing both tarballs and the
manifest entry, then `nix build .#pi-aot .#rpi-bin` from a manifest naming them — `pi-aot/bin/pi --version`
prints `1.6.0`, answers `get_state` over `--mode rpc`, and `rpi-bin/bin/pi --version` reaches the same host
through the wrapper. Not verified: any run on `aarch64` or Darwin (no runner here), and macOS binaries are
unsigned.

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
