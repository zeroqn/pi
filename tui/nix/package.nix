# One `pi`, two binaries. See docs/packaging.md for the reasoning and the honest gaps.
{ pkgs, lib, src }:
let
  # The client: plain cargo, no engine work. `Cargo.lock` is committed, so this builds offline.
  client = pkgs.rustPlatform.buildRustPackage {
    pname = "pi-tui";
    version = "0.0.0";
    src = src + "/../../tui";
    cargoLock.lockFile = src + "/../../tui/Cargo.lock";
    doCheck = false; # the tests need the recorded corpus, which is not in the repository
    meta.description = "The Rust terminal client for pi";
  };

  # The fallback host: stock pi on stock Bun. This is the path that must never break (ticket 10), and the
  # one every number in .scratch/tui-rust/results was measured with.
  hostFallback = pkgs.writeShellScriptBin "pi-host" ''
    exec ${pkgs.bun}/bin/bun ${src}/pi/packages/coding-agent/src/cli.ts "$@"
  '';

  # The AOT host needs Pi-Bolt's patched WebKit and Bun pinned by commit, plus a `bytecode.order` profile
  # checked in per `PI_REV` (nix cannot record one; ~87 % of ids survive a minor bump). It buys startup and
  # memory only, so it stays null until someone owns it. Derivation shape:
  #
  #   hostAot = pkgs.stdenvNoCC.mkDerivation {
  #     pname = "pi-host-aot";
  #     src = <patched bun, pinned>;
  #     nativeBuildInputs = [ patched-webkit ];
  #     buildPhase = ''
  #       BUN_JSC_useJIT=0 BUN_STATIC_HEAP=1 BUN_AOT=1 \
  #       BUN_JSC_useAOTLoopSplitting=1 BUN_JSC_useImmutableIntrinsics=1 \
  #       bun build --compile --bytecode --bytecode-order profiles/${PI_REV}.order \
  #         ${src}/pi/packages/coding-agent/src/cli.ts --outfile pi-host
  #     '';
  #   };
  hostAot = null;
in
{
  inherit client hostFallback hostAot;

  default = pkgs.symlinkJoin {
    name = "pi-with-rust-tui";
    paths = [ client hostFallback ];
    postBuild = ''
      # `pi` is the wrapper: the client takes the name, the host lives beside it as `pi-host`.
      install -Dm755 ${src}/../../tui/bin/pi $out/bin/pi
    '';
  };
}
