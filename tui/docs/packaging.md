# Packaging: one `pi`, two binaries

Ticket 10 of the `tui-rust` map. The target is a machine where typing `pi` starts the Rust client, and the
host it drives is a stock pi build.

## The layout

```
bin/pi        the wrapper: takes the `pi` name
bin/pi-tui    the Rust client
bin/pi-host   the host (stock pi; `--mode rpc` reads it)
```

`bin/pi` resolves the client as `PI_TUI_CLIENT` -> `pi-tui` beside it -> `pi-tui` on PATH, and the host as
`PI_TUI_HOST` -> `pi-host` beside it -> `pi-host` on PATH -> `pi` on PATH. Nothing in the wrapper is
load-bearing: a machine with only the stock pi still works, because the client speaks `--mode rpc` to
whatever answers.

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

## Two hosts, one switch

- **Fallback (`hostFallback`)**: stock pi on stock Bun. This is the path that must never break, and the one
  every number in `.scratch/tui-rust/results` was measured with.
- **AOT (`hostAot`)**: needs **Pi-Bolt's patched WebKit and Bun**, pinned by commit (`sources.json`), plus a
  `bytecode.order` profile **checked in per `PI_REV`** — nix cannot record one, and only ~87 % of function
  ids survive a minor bump. It buys **startup and memory** (38 vs 116 ms launch, 11 vs 72 ms `--version`);
  steady state is parity. Being third-party and per-release maintenance, it stays `null` in
  `nix/package.nix` until someone owns it, and the derivation's shape is written out there as a comment.

**The recorder problem.** Pi-Bolt's trainer types into *pi's own TUI* to record the profile. Behind the Rust
client that TUI is gone, so the trainer must drive the host directly. The two honest options are (a) record
against a stock pi build and reuse the profile, or (b) re-point the trainer at `--mode rpc`. Neither is
done; this is the cost of Q11's "no fork".

## The client's own startup budget

C-8 in `acceptance.md`: client + host <= 250 ms with the bytecode host, <= 100 ms with an AOT host, and the
client's own share <= 60 ms. The client loads a theme file, a syntax set and a `OnceLock`; the highlight
bench measured 37-98 ms wall including process start.

## Verified, and not verified

**Verified in this session**

- `bin/pi --version` exec'd the host and printed `1.5.0`.
- `bin/pi --replay ...` reached the client, which refused a non-TTY with 0 bytes on stdout and one line on
  stderr.
- `bin/pi --help` printed pi's own help (the wrapper hands `--help` to the host; that text is the more
  useful one for a person who asks what `pi` does).

**Not verified, said plainly**

- `nix build` of `nix/package.nix`: written to be readable and to fail loudly, not run.
- The AOT host: needs the patched engine and a recorded profile; `hostAot` is `null`.
- A full turn through `bin/pi` on a real terminal: the wrapper path was exercised with `--replay` and
  `--version`, and the client's own host path by `tools/harness/smoke_host.py`, but not the two together
  behind the wrapper on a TTY.
