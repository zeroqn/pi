# The Bun the AOT host is compiled with.
#
# `bun build --compile --aot` is upstream, but not in a stable release: 1.4.5 (2026-11-19) has no `--aot` and no
# AOT strings in its binary, while the canary does. The canary tag moves every day, so the hash below pins the
# archive this flake was written against: a re-fetch that returns different bytes fails instead of silently
# swapping the engine under the compiler.
{ lib, stdenv, fetchurl, unzip, autoPatchelfHook }:

let
  version = "1.4.6-canary.20261123";
in
stdenv.mkDerivation {
  pname = "bun-aot";
  inherit version;

  src = fetchurl {
    name = "bun-linux-x64.zip";
    url = "https://github.com/oven-sh/bun/releases/download/canary/bun-linux-x64.zip";
    # The `canary` tag is replaced daily, so this pins the bytes rather than the name: fetched 2026-11-23,
    # Bun 1.4.6. Re-pinning is a deliberate act (read `--aot`'s notes, rebuild, re-measure).
    hash = "sha256-ynLCJ7Dyzw+UgCTpaQKVwBy/yTokWoWpSV/gkCuxjGQ=";
    # The archive is built for glibc and carries /lib64/ld-linux-x86-64.so.2; autoPatchelfHook rewrites that
    # and the rpath to this system's glibc, which is what lets it run here and inside a build.
  };

  nativeBuildInputs = [ unzip autoPatchelfHook ];

  # A Bun executable is its own runtime: stripping would remove the sections `--compile` appends to.
  dontStrip = true;
  dontPatchELF = true;
  appendRunpaths = [ ];

  unpackPhase = ''
    runHook preUnpack
    unzip -q "$src"
    runHook postUnpack
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 bun-linux-x64/bun $out/bin/bun
    runHook postInstall
  '';

  meta = {
    description = "Bun with the ahead-of-time compiler (`bun build --compile --aot`)";
    homepage = "https://github.com/oven-sh/bun";
    mainProgram = "bun";
    platforms = [ "x86_64-linux" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
