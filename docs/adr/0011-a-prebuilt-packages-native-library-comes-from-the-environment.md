# A prebuilt package's native library comes from the environment, not from npm

Magic Context ships local embeddings: `@huggingface/transformers` running an ONNX model through a native
addon. Its npm package, `onnxruntime-node`, is 86 MB as a tarball and 220 MB unpacked, of which exactly
**one file** is ever loaded here — a 384 KB napi binding for this platform, `bin/napi-v6/linux/x64/
onnxruntime_binding.node` — beside 35 MB of `libonnxruntime.so.1` and 179 MB of Windows, macOS and arm64
binaries. Its `postinstall` fetches a further 301 MB of CUDA/TensorRT execution providers from NuGet, on
every install, and nothing in this workspace asks for one: the plugin registers no provider and the
binding runs CPU-only (measured: the providers load only when a session explicitly asks for `cuda`).
`packages/magic-context` is a prebuilt of the fork and is delivered by a `git install`, which only ever
runs `git clone` and an installer — so whatever those dependencies weigh, they weigh on every host, every
time pi updates.

Meanwhile the *library* could not simply be taken from this workspace's nixpkgs: the binding asks the
loader for `OrtGetApiBase@VERS_1.24.3` while nixpkgs' ONNX Runtime exports `OrtGetApiBase@@VERS_1.27.1`,
and `VERS_` is generated from the release tag (`cmake/onnxruntime.cmake` → `gen_def.py`), so the version
node is exact and the loader refuses a mismatch before ORT's own append-only `OrtApi` negotiation can
happen. No pair of (nixpkgs version, npm binding version) exists for the versions this workspace pins:
nixpkgs carries 1.27.1 on `nixos-unstable` and `master`, npm published 1.26.0/1.27.0/1.29.0 but no
1.27.1 — and `pkgs.onnxruntime` is load-bearing for `zvec-grep`'s `ort` `api-27` feature, so it cannot be
moved to chase a binding.

**The decision, in three parts.**

- **A tracked workspace member carries the payload.** `packages/onnxruntime-node/` is a member of this
  repo, named and versioned like the package it replaces, holding the npm dist and the binding and
  nothing else. The fork's transformers chunk imports the *bare specifier*
  (`requireFromHere("onnxruntime-node")`), so the name is the contract, and the member's size (428 KB) is
  the payload that a registry install would have multiplied by 500. It is deliberately **not** published
  — the prebuilt itself is `private` — and `packages/magic-context/package.json` now asks for it by
  **path** (`file:../onnxruntime-node`), so the link is recorded rather than inferred from a version a
  range happens to satisfy.
- **An ABI shim supplies the version node.** `shell/onnxruntime-shim` builds `libonnxrtabi24.so.1`: one
  exported function, `OrtGetApiBase@@VERS_1.24.3`, forwarding to the pinned nixpkgs library by absolute
  store path (which is also what keeps that library in the shim's closure). It is named after the
  *binding's* ABI, not after the library it stands in for, and the vendored binding's `DT_NEEDED` was
  renamed to match by one 19-byte substitution in its `.dynstr`. That naming is load-bearing, and was
  learned the hard way: `LD_LIBRARY_PATH` outranks a binary's own `RUNPATH`, so a file *named*
  `libonnxruntime.so.1` on that path becomes the ONNX Runtime for every process in the environment —
  `zg` (zvec-grep), which needs `VERS_1.27.1`, died with `version 'VERS_1.27.1' not found` the first time
  the shim went on the path. A stand-in may only answer for the requester that knows its name.
- **The environment names the seams, and the environment is a devshell.** `LD_LIBRARY_PATH` carries the
  shim's directory (glibc reads it at program start, and under node there is no in-process preload);
  `ONNXRUNTIME_LIB_PATH` names the *real* library's directory, so a different ONNX Runtime can be swapped
  in without rebuilding the shim (its self-reference is refused, not absorbed, or the variable would
  silently mean the pin); `ONNXRUNTIME_NODE_INSTALL=skip` makes the published package's 301 MB
  postinstall a no-op should one ever land.

**What this buys, and what it costs.** The install drops from 513 MB to 440 KB for this dependency, no
installer on any host fetches a CUDA provider, and the ONNX Runtime version becomes the repository's pin
instead of npm's — with `packages/onnxruntime-node/test/vendored.test.ts` enforcing, on every `bun run
test` and in CI, that what a consumer resolves is byte-identical to the member, has no `postinstall`, and
brings no library, provider or `script/` artifact. The costs are three: a vendored binary that must be
re-extracted on a bump (`packages/onnxruntime-node/vendor.sh` re-applies the rename and checks it), a
shim whose version node must move with the binding, and a dependency that only resolves inside this
workspace — a published shape for `pi-magic-context-prebuilt` would need the registry dependency back.

**Alternatives.** *Keep the npm dependency* and accept the size — rejected: the postinstall's 301 MB
arrives on every HEAD-moving update, and the update path (`git fetch` → `reset --hard` → `clean -fdx` →
`npm install`) wipes any post-hoc pruning. *Point the loader at nixpkgs directly* — rejected: impossible,
by the version node above. *Pin a second nixpkgs input at the revision carrying 1.26.0 (revision
`59f622ab228d`, substitutable) and take npm 1.26.0's binding* — the one exact pair in existence; rejected
because it costs a 266 MB download to obtain one 384 KB file whose `VERS_1.26.0` is still unverified, next
to a load-bearing pin it must not disturb. *Build the napi addon in Nix against `pkgs.onnxruntime`* —
rejected: ~400 KB of provenance over the vendored binding, at the price of a C++ addon build coupled to
the pin; it comes back only if the vendored route fails. *Run the wasm runtime instead of a native one* —
not a choice this package can make: `dist/` omits all three `transformers*.js` bundles (push protection
reads a model class name as a Mistral key), so no local path loads from the prebuilt at all today; see
`packages/magic-context/README.md` and the repair routes recorded there.

**What it does not cover.** The native path is only taken on a runtime that is not bun < 1.4 (the fork
guards a teardown panic) or under node, so the flake's own node `.#pi` is where this work is exercised —
pi's own bun binary is built by upstream on 1.3.14, and no release moves that. `onnxruntime-web` (130 MB),
`sharp` + `@img/sharp-libvips-linux-x64` (~19 MB) and `ai-tokenizer` (31 MB) are still registry
dependencies with the same shape of question open.

Cross-references: `../GLOSSARY.md` § The seam between packages (vendored member, ABI shim); the packaging
README at `packages/magic-context/README.md`; `packages/onnxruntime-node/README.md` (provenance and the
byte-level edits).

Built by wayfinder map `.scratch/mc-payload/` (extensions commits `8fe8170`, `1837818`, `3e7d817`; shell
commits `ea03770`, `1960a5e`, `b4ae8a7`), findings in `.scratch/mc-payload/research/`, acceptance on
ticket 07 of that map.
