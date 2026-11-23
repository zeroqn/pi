# The Bun the AOT host is compiled with: the canary archive.
#
# Two sources, one shape. When a release of ours carries the archive (`manifest.nix`'s `bunAot`), that URL is
# used: it is ours, it does not move, and it is the bytes a released host was compiled with. Otherwise the
# upstream canary URL from nix/bun-pin.nix is used, which is what CI and a developer need *before* a release
# exists. Upstream's canary assets are replaced daily and their old URLs stop working, which is why a release
# copies the archive beside the host instead of pointing at oven-sh's tag.
#
# The pin file is generated (`nix/bun-pin-update.sh`); this file is hand-written and does not change.
{ lib, stdenv, fetchurl, unzip, autoPatchelfHook }:
let
  pin = import ./bun-pin.nix;
  manifest = import ./manifest.nix;
  target = stdenv.hostPlatform.system;
  archive =
    if builtins.hasAttr target pin.archives then
      pin.archives.${target}
    else
      throw "no pinned Bun canary for ${target}; add its archive to nix/bun-pin.nix";
  released = (manifest.${target} or { }).bunAot or null;
  source =
    if released != null then
      {
        inherit (released) url;
        hash = released.hash;
        name = archive.asset;
        version = released.version;
      }
    else
      {
        url = "${pin.upstream}/${archive.asset}";
        inherit (archive) hash;
        name = archive.asset;
        version = pin.version;
      };
in
# One attrset, passed once: `stdenv.mkDerivation { … } // extra` yields a derivation whose path was already
# computed from the braces, so the extras (the phases below) would be silently dropped.
stdenv.mkDerivation (
  {
    pname = "bun-aot";
    inherit (source) version;

    # Linux archives are built for glibc and carry /lib64/ld-linux-x86-64.so.2; autoPatchelfHook rewrites
    # that and the rpath to this system's glibc, which is what lets it run here and inside a build.
    src = fetchurl {
      inherit (source) url hash name;
    };

    nativeBuildInputs = [ unzip ] ++ lib.optionals stdenv.hostPlatform.isLinux [ autoPatchelfHook ];

    # A Bun executable is its own runtime: stripping would remove the sections `--compile` appends to.
    dontStrip = true;

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
      platforms = builtins.attrNames pin.archives;
      sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
    };
  }
  // lib.optionalAttrs stdenv.hostPlatform.isLinux {
    dontPatchELF = true;
    appendRunpaths = [ ];
  }
)
