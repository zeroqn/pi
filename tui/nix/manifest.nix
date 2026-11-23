# What `nix/aot-release.sh` published, per platform. `nix/manifest.nix` is rewritten at each release and the
# revision carrying it is what a downstream flake locks, so the hashes here are immutable for that lock.
#
# Shape — one entry per artifact, with the URL of the release asset and its `nix hash` in SRI form:
#
#   {
#     x86_64-linux = {
#       piAot  = { version = "1.6.0"; url = "https://github.com/<owner>/<repo>/releases/download/<tag>/pi-aot-1.6.0-x86_64-linux.tar.gz"; hash = "sha256-..."; };
#       piTui = { version = "0.1.0"; url = ".../pi-tui-0.1.0-x86_64-linux.tar.gz"; hash = "sha256-..."; };
#     };
#   }
#
# Empty until the first release: `nix build .#pi-aot` then says the artifact is not published yet, which is
# better than a hash that silently matches nothing.
{ }
