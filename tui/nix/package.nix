# The Rust client, rpi, and the `pi` wrapper that pairs it with a host. See docs/packaging.md.
#
# The host is not built here: it is `nix/aot-host.sh` in the dev shell (or any `pi` on PATH). A machine that has
# only this package still works if a `pi` or `pi-host` is on PATH, because the client speaks `--mode rpc` to
# whatever answers.
{ lib, rustPlatform, src }:

rustPlatform.buildRustPackage {
  pname = "pi-tui";
  version = "0.0.0";

  inherit src;

  cargoLock.lockFile = src + "/Cargo.lock";
  # The crate tests read a recorded corpus that is not in the repository.
  doCheck = false;

  # `pi` is the wrapper: it takes the name, and the client lives beside it as `rpi`.
  postInstall = ''
    install -Dm755 ${src}/bin/pi $out/bin/pi
    # The client's own binary is `rpi`; keep the old name working for a build already installed under it.
    ln -s rpi $out/bin/pi-tui
  '';

  meta = {
    description = "The Rust terminal client for pi, and the `pi` wrapper that starts it";
    homepage = "https://github.com/earendil-works/pi";
    license = lib.licenses.mit;
    mainProgram = "pi";
  };
}
