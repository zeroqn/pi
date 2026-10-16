# onnxruntime-node (vendored, this host only)

This is **not** the published `onnxruntime-node` package. It is a hand-authored
**workspace member** of this repo whose whole purpose is to satisfy the bare
specifier `onnxruntime-node` from
`packages/magic-context` — the fork's Transformers chunk calls
`requireFromHere("onnxruntime-node")` (`transformers.node-4ydajnhd.js:7815`) — with a
payload that fits on one machine and links against the ONNX Runtime this workspace
already ships (`pkgs.onnxruntime`, 1.27.1) instead of the npm package's own 35 MB
`libonnxruntime.so.1`, its 179 MB of Windows/macOS/arm64 binaries and its 301 MB of
CUDA/TensorRT providers.

`packages/magic-context/package.json` asks for it by **path** —
`optionalDependencies: { "onnxruntime-node": "file:../onnxruntime-node" }` — so the
dependency names this directory and cannot be satisfied by the registry package.
(npm materializes that as a symlink and records `"link": true`; bun hardlinks it into
`node_modules/.bun/onnxruntime-node@file+packages+onnxruntime-node/`, so under bun a
file *replaced* here rather than edited in place needs a `bun install` to reach the
installed copy.) Until 2026-10-16 this was a version range, `1.24.3`, and the link then
depended on this member's `version` equalling it — which is why the tests below assert
what resolution *yields*, not what the manifest says: a range that stops matching
silently installs the 86 MB registry tarball instead.

`test/vendored.test.ts` is that guard — it asserts byte-identity with the files listed
below, no `postinstall`, no library/provider/`script` artifacts anywhere, a payload
under 1 MB, and no registry form of the name in `bun.lock`. It runs as part of the
repo's `bun run test` (and therefore in CI), so the invariants above are enforced
rather than documented.

## Provenance

The bytes were extracted from the tarball npm itself downloaded on 2026-10-16, which
sat in the local cache at

```
/home/dev/.npm/_cacache/content-v2/sha512/24/7e/fe7336dcf002c0f35f6f95381c57e436d78ffe56319e0470e35fcd7e6420f43c254220518536d4f4578b171bfd495f2a4a3e049c41c0778a3fe19376274e
```

(that path *is* the sha512 of its contents, so npm's own garbage collection can and
did evict it — re-fetch the URL below and check it against the integrity to get the
bytes back). Registry
metadata, copied verbatim from the packument the same cache holds for
`https://registry.npmjs.org/onnxruntime-node` (`versions["1.24.3"].dist`):

| field | value |
|---|---|
| tarball | `https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-1.24.3.tgz` |
| `integrity` | `sha512-JH7+czbc8ALA819vlTgcV+Q214/+VjGeBHDjX81+ZCD0PCVCIFGFNtT0V4sXG/1JXypKPgScQcB3ij/hk3YnTg==` |
| `shasum` (sha1) | `ec8da99c335aa5ea95559a3ac1ae915a89541d5e` |
| `unpackedSize` | `220344078` |
| `fileCount` | `42` |

Verified, not assumed: the cached tarball is **85,987,774 B** and re-hashing it gives
the same `sha512-JH7+cz…` value above, the same path and the same sha1, so the
tarball and the metadata agree. (`sha256` of the tarball:
`aa1bb5fa261ea68de05dd53efbba210cd7adf2d2850f4c3a201054c74cc78040`.)

## What is vendored, and its sha256

```
4d0332b6697214eca5563f6175a96316de8d2fc154fc7f9c7220c8811732c165  bin/napi-v6/linux/x64/onnxruntime_binding.node   384040 B  (patched: see below)
23e65ad2c30827e0f2bfe2aadc2987b76d4619ae5e25aad36674ce618ed3df6d  dist/backend.d.ts                                  506 B
2fb40405c5dad7aa88dcf1071ea4b8a0e49a3ad59def0a3f23b5dda8ff273d3e  dist/backend.js                                   6242 B
5df69ea31983e5b6fcd0b297c736ff7a84ea3d92629f8feb347c8bf1d13da91b  dist/binding.d.ts                                1564 B
65be03f9a10c7ad773c22185a94f0b80835cd40ddcdc2acd63c1fbe96f94cbb8  dist/binding.js                                  1507 B
d2498ae6d465fecfa80a535e99ad9bbabcfafac73f6b420f29651ec9d50b98fa  dist/index.d.ts                                     87 B
019eb02133b94b1f7fdf2d89eb93b590ce1288d271f7b280647fb3978e6391fa  dist/index.js                                     1602 B
ffe525fbec3346d1e2addf2d792d8e355a26dd08df664d7617015f21dea0a534  dist/version.d.ts                                   41 B
57b5a3c4addffc9e4da0c12119e13114ef40e413231571049eacedc5361ab91b  dist/version.js                                    361 B
```

That is the whole package: `dist/` (compiled JS plus the type declarations, the four
`*.js.map` sourcemaps left behind) and one native artifact.

Every file above is byte-identical to the tarball **except the binding**, which is
patched in one place: its library name, `libonnxruntime.so.1`, is renamed to
`libonnxrtabi24.so.1` — the name of the ABI shim in `shell/onnxruntime-shim/` (see
[How the library is found](#how-the-library-is-found) for why the shim cannot use the
real library's name). The substitution is the one occurrence of that 19-byte string
in the binding's `.dynstr`, which both `DT_NEEDED` and the version need's `vn_file`
point at, so the file's size and layout are unchanged; `vendor.sh` re-applies it and
checks the result. `readelf -d` shows it:

```
 0x0000000000000001 (NEEDED)             Shared library: [libonnxrtabi24.so.1]
```

Deliberately **not** vendored:

* `libonnxruntime.so.1` (35,164,376 B in the tarball) — the library comes from the
  `onnxruntime-shim` flake output (`shell/onnxruntime-shim/`) through `LD_LIBRARY_PATH`,
  see below;
* `bin/napi-v6/{darwin,win32}/*` and `bin/napi-v6/linux/arm64/*` (179 MB) — this host
  is linux/x64;
* `script/*`, and with it the `postinstall: node ./script/install` upstream runs to
  fetch the CUDA/TensorRT providers from NuGet. `scripts` is absent from
  `package.json` here, so `npm install` performs no download;
* `lib/*.ts` (the TypeScript sources).

`package.json` is upstream's manifest minus `scripts` and minus the `os` gate (which
would be the only field objecting to an unusual host), with `dependencies` reduced to
the one entry the JS actually requires — `onnxruntime-common: 1.24.3`. `adm-zip` and
`global-agent` went the way of `script/install.js`, their only consumer.

## How the library is found

The binding's `NEEDED` is `libonnxrtabi24.so.1` with `RUNPATH $ORIGIN/`
(= `bin/napi-v6/linux/x64/`, where nothing sits), so the loader falls through to
`LD_LIBRARY_PATH`. That must name `shell/onnxruntime-shim`'s output directory: its
single file is `libonnxrtabi24.so.1`, which carries that SONAME and defines
`OrtGetApiBase@@VERS_1.24.3`, forwarding the call to the real nixpkgs 1.27.1 library
by absolute store path. The devShell in `shell/flake.nix` puts that directory on
`LD_LIBRARY_PATH` and defaults `ONNXRUNTIME_LIB_PATH` to the *real* library's
directory — the shim's own override for which ONNX Runtime it forwards to.

`LD_LIBRARY_PATH` has to be set by whatever launches pi: glibc snapshots it at
program start, so an in-process write is too late.

**Why the shim's name is ours, and not `libonnxruntime.so.1`.** An `LD_LIBRARY_PATH`
entry outranks a binary's own `RUNPATH`, so a file *named* `libonnxruntime.so.1` on
that path becomes the ONNX Runtime for every process in the environment. The shim only
defines `VERS_1.24.3`, while `zg` (zvec-grep) links the real library and asks for
`OrtGetApiBase@VERS_1.27.1` — it died with

```
zg: /nix/store/…-onnxruntime-shim-…/lib/libonnxruntime.so.1: version `VERS_1.27.1' not found (required by zg)
```

the first time the shim was on the path under its old name. Renaming the shim (and the
binding's request for it, above) keeps it answering for this binding alone: nothing
else asks for `libonnxrtabi24.so.1`, so `zg` and every other consumer resolve the real
library through its own `RUNPATH` again. The same naming freedom is why the shim can
carry a version node — `VERS_1.24.3` — that no released ONNX Runtime ever had.

## Bumping

Re-extract the tarball for the new version with `./vendor.sh <tarball>` (it applies
the library rename and checks the result), diff the `dist/` tree, update the sha256
block above from the script's output, and bump this `version` — the manifest's `file:`
spec needs no change with it, and the guard's byte-identity check is what proves the
new bytes are the ones being loaded (run `bun install` first under bun).
A version bump that moves the ORT release also moves `VERS_…`, which is what
`shell/onnxruntime-shim/VERS_1.24.3.map` names — but the shim's version node only has
to satisfy *this binding*, so it follows this package, not the shim's forward target.
