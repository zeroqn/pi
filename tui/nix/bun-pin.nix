# The Bun canary this flake pins. GENERATED; do not edit by hand.
#
# Written by `bun-pin-tools.py from-entries` from the manifest of a release: the hashes are the archives
# that release carries, so the pin names bytes that stay downloadable. `nix/runtime.nix` prefers the
# release asset and falls back to this pin's upstream URL, which is what CI needs before a release
# exists.
{
  version = "canary-20261123";
  upstream = "https://github.com/oven-sh/bun/releases/download/canary";

  archives = {
    aarch64-linux = {
      asset = "bun-linux-aarch64.zip";
      hash = "sha256-YD0/K/PFNLjV869oToOgCqHkj+jBBzHkT1fMZ/T56e8=";
      etag = "";
      lastModified = "";
    };
    x86_64-linux = {
      asset = "bun-linux-x64.zip";
      hash = "sha256-3hL0OfncyICCPyTcM8Cin2EkrmAwbScLBqzT6cBZwuo=";
      etag = "";
      lastModified = "";
    };
  };

  # Filled by the release workflow: the run that compiled pi with this pin and passed the gate.
  verified = { run = "gh-dry-run-20261123-1352"; pi = "1.6.0"; };
}
