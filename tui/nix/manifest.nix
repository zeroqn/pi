# The AOT release stream: `pi-v<pi version>`, published when pi itself releases.
#
# `nix/manifest.nix` is rewritten at each release and the revision carrying it is what a downstream flake
# locks, so the hashes here are immutable for that lock. `pi-aot` carries the host and the Bun that compiled
# it, because both follow pi's releases; the Rust client has its own file, `nix/manifest-tui.nix`.
#
# Shape — one entry per artifact, with the URL of the release asset and its hash in SRI form:
#
#   {
#     x86_64-linux = {
#       piAot  = { version = "1.6.0"; url = "https://github.com/<owner>/<repo>/releases/download/<tag>/pi-aot-1.6.0-x86_64-linux.tar.gz"; hash = "sha256-..."; };
#       bunAot = { version = "canary-20261123"; url = ".../bun-aot-canary-20261123-x86_64-linux.zip"; hash = "sha256-..."; };
#     };
#   }
#
# Empty until the first release: `nix build .#pi-aot` then says the artifact is not published yet, which is
# better than a hash that silently matches nothing.
{ }
