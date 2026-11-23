# Installations of the release artifacts: one tarball per platform, described by nix/manifest.nix, uploaded
# to a GitHub release by `.github/workflows/aot-release.yml`. Nothing is compiled here.
#
# A platform's tarball holds what must sit together: for pi, the executable and the assets it reads from its
# own directory; for the client, `rpi` and the `pi` wrapper. The Bun archive is a zip, because `--compile`
# appends to a Bun executable and that is what a rebuild needs.
{
  lib,
  stdenv,
  stdenvNoCC,
  fetchurl,
  unzip,
  autoPatchelfHook,
  glibc,
  libxcb,
}:

let
  # The AOT executable needs glibc at run time, and its interpreter is rewritten for this store.
  commonAttrs = { url, hash }: {
    src = fetchurl { inherit url hash; };
    # The release tarball holds several top-level entries (the executable and the assets beside it), so it
    # is unpacked by hand rather than by `unpackPhase`, which wants one directory.
    dontUnpack = true;
    nativeBuildInputs = [ autoPatchelfHook ];
    # glibc for the executable, libgcc_s for the Rust client, libxcb for the X11 helper among pi's assets.
    buildInputs = [
      glibc
      stdenv.cc.cc.lib
      libxcb
    ];
    # A Bun executable is its own runtime: the `.bun` payload and the compiled code must not be touched.
    dontStrip = true;
    dontPatchShebangs = true;
  };
in
{
  # `pi`, ahead of time: the executable into `libexec`, everything it reads into `share`, and a `bin/pi`
  # that points `PI_PACKAGE_DIR` at the second (pi's own escape hatch, config.ts:417-432).
  mkPiAot =
    { url, hash, version }:
    stdenvNoCC.mkDerivation (
      commonAttrs { inherit url hash; }
      // {
        pname = "pi-aot";
        inherit version;

        installPhase = ''
          runHook preInstall
          mkdir -p unpacked $out/libexec/pi $out/share/pi
          tar -xf "$src" -C unpacked
          cd unpacked
          install -Dm755 ./pi $out/libexec/pi/pi
          for asset in package.json theme assets export-html docs examples native photon_rs_bg.wasm; do
            [ -e "./$asset" ] && cp -R "./$asset" $out/share/pi/
          done
          mkdir -p $out/bin
          # A quoted delimiter: an unquoted one would expand `"$@"` here, at build time.
          cat > $out/bin/pi <<'WRAPPER'
#!/bin/sh
export PI_PACKAGE_DIR="@out@/share/pi"
exec "@out@/libexec/pi/pi" "$@"
WRAPPER
          substituteInPlace $out/bin/pi --subst-var out
          chmod +x $out/bin/pi
          runHook postInstall
        '';

        meta = {
          description = "pi ${version}, compiled ahead of time";
          homepage = "https://github.com/earendil-works/pi";
          license = lib.licenses.mit;
          mainProgram = "pi";
        };
      }
    );

  # The Bun the host was compiled with, carried on our release page so that a downstream build does not
  # depend on oven-sh's movable `canary` tag. `runtime.nix` prefers this entry once it exists.
  mkBunAot =
    { url, hash, version }:
    stdenvNoCC.mkDerivation (
      commonAttrs { inherit url hash; }
      // {
        pname = "bun-aot";
        inherit version;

        nativeBuildInputs = [
          autoPatchelfHook
          unzip
        ];

        # `commonAttrs` sets `dontUnpack`, which skips the unpack phase outright, so the archive is opened here
        # — the same shape as the two tarballs above.
        installPhase = ''
          runHook preInstall
          mkdir -p unpacked $out/bin
          unzip -q "$src" -d unpacked
          install -m755 unpacked/*/bun $out/bin/bun
          runHook postInstall
        '';

        meta = {
          description = "Bun ${version} with the ahead-of-time compiler";
          homepage = "https://github.com/oven-sh/bun";
          mainProgram = "bun";
        };
      }
    );

  # The Rust client with its `pi` wrapper: `bin/pi` resolves `rpi` beside it.
  mkPiTui =
    { url, hash, version }:
    stdenvNoCC.mkDerivation (
      commonAttrs { inherit url hash; }
      // {
        pname = "pi-tui";
        inherit version;

        installPhase = ''
          runHook preInstall
          mkdir -p unpacked $out/bin
          tar -xf "$src" -C unpacked
          cd unpacked
          install -Dm755 ./rpi $out/bin/rpi
          install -Dm755 ./pi $out/bin/pi
          runHook postInstall
        '';

        meta = {
          description = "The Rust terminal client for pi, and the `pi` wrapper that starts it";
          homepage = "https://github.com/earendil-works/pi";
          license = lib.licenses.mit;
          mainProgram = "pi";
        };
      }
    );
}
