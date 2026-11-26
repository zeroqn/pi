# The Bun canary this flake pins. GENERATED; do not edit by hand.
#
# Written by `bun-pin-tools.py from-entries` from the manifest of a release: the hashes are the archives
# that release carries, so the pin names bytes that stay downloadable. `nix/runtime.nix` prefers the
# release asset and falls back to this pin's upstream URL, which is what CI needs before a release
# exists.
{
  version = "canary-20261126";
  upstream = "https://github.com/oven-sh/bun/releases/download/canary";

  archives = {
    x86_64-linux = {
      asset = "bun-linux-x64.zip";
      hash = "sha256-eKKdLzzTlEJEVGaa3PJPwHTj/etk6ytaoHdSD1WmzZA=";
      etag = "";
      lastModified = "";
    };
  };

  # Filled by the release workflow: the run that compiled pi with this pin and passed the gate.
  verified = { run = "gh-pi-v1.6.1"; pi = "1.6.1"; };
}
