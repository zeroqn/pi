{ lib, stdenv, onnxruntime }:

# `libonnxrtabi24.so.1` for the vendored `onnxruntime-node` binding in
# `extensions/packages/onnxruntime-node`. That binding takes exactly one versioned
# symbol from its ORT shared library — `OrtGetApiBase@VERS_1.24.3` — and the
# nixpkgs ONNX Runtime this workspace already pins exports
# `OrtGetApiBase@@VERS_1.27.1`, so the loader refuses it before ORT's own
# append-only `OrtApi` negotiation can happen. This shim defines the old version
# node and forwards the call. `shim.c`'s header carries the whole argument, and
# `.scratch/mc-payload/research/01-a-matching-pair.md` the measurement.
#
# Home: `extensions/tui/nix/onnxruntime-shim/`, ported from `shell/onnxruntime-shim/` so the
# ahead-of-time pi host this flake builds and installs carries it: the host embeds the canary
# Bun this flake pins (>= 1.4), Magic Context's resolver therefore takes the *native* path, and
# what it loads is the binding `extensions/packages/onnxruntime-node` ships. Two consumers
# export the environment it needs — this flake's dev shell, and the `.#pi-aot` wrapper.
#
# The file is named after the *binding's* ABI, not after the library it stands in
# for, and both halves of that name are deliberate: a file named
# `libonnxruntime.so.1` on `LD_LIBRARY_PATH` outranks every other binary's `RUNPATH`,
# so it becomes the ONNX Runtime for the whole environment — `zg` died on it
# (`version 'VERS_1.27.1' not found (required by zg)`) because a shim can only
# define the version node it was built for. The vendored binding therefore asks for
# `libonnxrtabi24.so.1` (one byte-substitution in its `.dynstr`, applied by
# `extensions/packages/onnxruntime-node/vendor.sh`), a name nothing else wants.
#
# The real library's store path is baked in as `DEFAULT_REAL_LIB`, which is also what
# makes it a reference of this output: the pinned nixpkgs ONNX Runtime cannot be
# garbage-collected while the shim is around. `onnxruntime` is in `buildInputs` so the
# build can reach that path at all — a store path interpolated into `buildPhase` is a
# string there, not an input.
stdenv.mkDerivation {
  pname = "onnxruntime-shim";
  # The version node this defines, i.e. the version of the npm binding it serves —
  # not the version of the library it forwards to. A binding bump moves this and the
  # `--version-script` file together.
  version = "1.24.3";

  # The tree is flat (`shim.c` + the version script), so unpacking copies it to a
  # directory named after this one and `unpackPhase` finds it as the source root.
  src = ./.;

  buildInputs = [ onnxruntime ];

  # `-Wl,-soname,libonnxrtabi24.so.1` is load-bearing, not cosmetic: it is the name
  # the loader remembers this object under, so it is what the binding's
  # `NEEDED libonnxrtabi24.so.1` has to match. The `--version-script` is what gives
  # `OrtGetApiBase` the `VERS_1.24.3` node the binding's version need asks for.
  buildPhase = ''
    runHook preBuild
    gcc -shared -fPIC -O2 \
      -DDEFAULT_REAL_LIB='"${onnxruntime}/lib/libonnxruntime.so.1"' \
      -o libonnxrtabi24.so.1 \
      shim.c \
      -Wl,--version-script=VERS_1.24.3.map \
      -Wl,-soname,libonnxrtabi24.so.1 \
      -ldl
    runHook postBuild
  '';

  # `$out/lib`, because that is the directory the loader is fed: the dev shell prepends
  # it to `LD_LIBRARY_PATH` and `nix/prebuilt.nix`'s `bin/pi` wrapper for `.#pi-aot` does
  # the same, so the host and this repo's extensions inherit it. `ONNXRUNTIME_LIB_PATH`
  # names the *other* directory — the pinned library's, which this shim forwards to —
  # and both of those set it as well.
  installPhase = ''
    runHook preInstall
    install -Dm755 libonnxrtabi24.so.1 $out/lib/libonnxrtabi24.so.1
    runHook postInstall
  '';

  # One platform, because that is the one the binding is vendored for: `../packages/onnxruntime-node`
  # ships `bin/napi-v6/linux/x64` and nothing else, so no other host asks for this name. This is a
  # declaration the flake reads (`hasShim` in `../../flake.nix`) rather than a build limit — evaluating
  # the derivation on another platform is a nixpkgs refusal, before any attribute of it can be asked.
  meta = {
    description = "OrtGetApiBase@@VERS_1.24.3 ABI shim over nixpkgs' ONNX Runtime";
    platforms = [ "x86_64-linux" ];
  };
}
