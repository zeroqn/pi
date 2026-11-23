# The client release stream: `tui-v<client version>`, published when `Cargo.toml`'s version changes.
#
# Separate from `nix/manifest.nix` on purpose: the client is under active development, and a pi release must
# not have to wait for it, nor drag a half-finished client into a pi version's release.
#
# Shape:
#
#   {
#     x86_64-linux = {
#       piTui = { version = "0.1.0"; url = "https://github.com/<owner>/<repo>/releases/download/<tag>/pi-tui-0.1.0-x86_64-linux.tar.gz"; hash = "sha256-..."; };
#     };
#   }
#
# Empty until the first client release; `nix build .#rpi-bin` then says so.
{ }
