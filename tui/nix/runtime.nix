# The Bun the AOT host is compiled with.
#
# `bun build --compile --aot` is upstream, but not in a stable release: 1.4.5 (2026-11-19) has no `--aot` and
# no AOT strings in its binary, while the canary does (73 of them in the darwin/arm64 archive, 68 in
# linux/arm64). The `canary` tag is replaced daily, so each archive below is pinned by its hash: a re-fetch
# that returns different bytes fails instead of silently swapping the engine under the compiler.
#
# All three archives are the same canary build (Bun 1.4.6, fetched 2026-11-23) and are moved together. Moving
# them is a deliberate act: the compiler's behaviour is this engine's, so a new pin needs the measurement in
# docs/packaging.md and a hash for every platform, not just the one in front of you.
{
  lib,
  stdenv,
  fetchurl,
  unzip,
  autoPatchelfHook,
}:

let
  version = "1.4.6-canary.20261123";
  archives = {
    x86_64-linux = {
      asset = "bun-linux-x64.zip";
      hash = "sha256-ynLCJ7Dyzw+UgCTpaQKVwBy/yTokWoWpSV/gkCuxjGQ=";
    };
    aarch64-linux = {
      asset = "bun-linux-aarch64.zip";
      hash = "sha256-YD0/K/PFNLjV869oToOgCqHkj+jBBzHkT1fMZ/T56e8=";
    };
    aarch64-darwin = {
      asset = "bun-darwin-aarch64.zip";
      hash = "sha256-PG5a5ifyKs2rwvtjk2TcqNEwJBbUHHdM2nGu5+o9bY8=";
    };
  };
  target = stdenv.hostPlatform.system;
  pick =
    if builtins.hasAttr target archives then
      archives.${target}
    else
      throw "no pinned Bun canary for ${target}; add its archive hash to nix/runtime.nix";
in
# One attrset, passed once: `stdenv.mkDerivation { … } // extra` yields a derivation whose path was already
# computed from the braces, so the extras (the phases below) would be silently dropped.
stdenv.mkDerivation (
  {
    pname = "bun-aot";
    inherit version;

    # The archive is built for glibc and carries /lib64/ld-linux-x86-64.so.2; autoPatchelfHook rewrites that
    # and the rpath to this system's glibc, which is what lets it run here and inside a build.
    src = fetchurl {
      inherit (pick) hash;
      name = pick.asset;
      url = "https://github.com/oven-sh/bun/releases/download/canary/${pick.asset}";
    };

    nativeBuildInputs = [ unzip ] ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

    # A Bun executable is its own runtime: stripping would remove the sections `--compile` appends to.
    dontStrip = true;

    # The zip is unpacked here rather than by `unpackPhase`, which expects a `sourceRoot` and prints its own
    # progress; `install -m` rather than `install -D` because the same recipe runs on Darwin.
    unpackPhase = ''
      runHook preUnpack
      unzip -q "$src"
      runHook postUnpack
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p $out/bin
      install -m755 */bun $out/bin/bun
      runHook postInstall
    '';

    meta = {
      description = "Bun with the ahead-of-time compiler (`bun build --compile --aot`)";
      homepage = "https://github.com/oven-sh/bun";
      mainProgram = "bun";
      platforms = builtins.attrNames archives;
      sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    };
  }
  // lib.optionalAttrs stdenv.hostPlatform.isLinux {
    dontPatchELF = true;
    appendRunpaths = [ ];
  }
)
