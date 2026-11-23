#!/usr/bin/env bash
# Builds this platform's client artifacts: rpi and the `pi` wrapper beside it.
#
# Usage: tui-release.sh [--stage DIR] [--from BIN] [--version V]
#   --stage DIR   where the tarball is written (default: $ROOT/results/release-tui)
#   --from BIN    package this rpi binary instead of building (a store path or a target/release/rpi)
#   --version V   override the version (default: the workspace version in Cargo.toml)
# Environment:
#   RELEASE_URL   where the asset will be served from (default: the OWNER/REPO placeholder)
#   MANIFEST_OUT  write this platform's entry for nix/manifest-tui.nix to that file
#
# One artifact, its own release stream (tag `tui-v<client version>`): the client changes far more often
# than pi or Bun, so it is versioned and released on its own, and a pi release never waits for it.
#
#   pi-tui-<client version>-<platform>.tar.gz    rpi and the `pi` wrapper beside it
set -euo pipefail

STAGE=""
FROM=""
CLIENT_VERSION=""

while [ $# -gt 0 ]; do
	case "$1" in
	--stage) STAGE="$2"; shift ;;
	--from) FROM="$2"; shift ;;
	--version) CLIENT_VERSION="$2"; shift ;;
	-h | --help) sed -n '2,16p' "$0"; exit 0 ;;
	*) echo "tui-release: unknown option $1" >&2; exit 2 ;;
	esac
	shift
done

die() { echo "tui-release: $*" >&2; exit 1; }
ROOT="${PI_TUI_SRC:-$PWD}"
[ -f "$ROOT/Cargo.toml" ] || die "no flake tree at $ROOT (run from extensions/tui, or set PI_TUI_SRC)"
case "$(uname -s)-$(uname -m)" in
Linux-x86_64) PLATFORM=x86_64-linux ;;
Linux-aarch64 | Linux-arm64) PLATFORM=aarch64-linux ;;
Darwin-arm64 | Darwin-aarch64) PLATFORM=aarch64-darwin ;;
*) die "no release artifact for $(uname -s) $(uname -m)" ;;
esac
STAGE="${STAGE:-$ROOT/results/release-tui}"
mkdir -p "$STAGE"

if [ -z "$CLIENT_VERSION" ]; then
	CLIENT_VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' "$ROOT/Cargo.toml" | head -1)"
fi
[ -n "$CLIENT_VERSION" ] || die "no version in $ROOT/Cargo.toml (pass --version)"

if [ -n "$FROM" ]; then
	RPI_BIN="$FROM"
else
	echo "==> rpi $CLIENT_VERSION (cargo build --release)"
	(cd "$ROOT" && cargo build --release --quiet -p pi-tui)
	RPI_BIN="$(cd "$ROOT" && cargo metadata --format-version 1 --no-deps --quiet |
		python3 -c 'import json,sys;print(json.load(sys.stdin)["target_directory"])')/release/rpi"
fi
[ -x "$RPI_BIN" ] || die "no rpi at $RPI_BIN"

TUI_TGZ="$STAGE/pi-tui-$CLIENT_VERSION-$PLATFORM.tar.gz"
rm -rf "$STAGE/tui" && mkdir -p "$STAGE/tui"
install -m755 "$RPI_BIN" "$STAGE/tui/rpi"
install -m755 "$ROOT/bin/pi" "$STAGE/tui/pi"
tar -C "$STAGE/tui" -czf "$TUI_TGZ" .

hash_of() {
	if command -v nix >/dev/null 2>&1; then
		nix hash file --sri "$1"
	else
		echo "sha256-$(openssl dgst -sha256 -binary "$1" | base64 | tr -d '\n')"
	fi
}
RELEASE_URL="${RELEASE_URL:-https://github.com/OWNER/REPO/releases/download/RELEASE_TAG}"
ENTRY="$(
	cat <<MANIFEST
  $PLATFORM = {
    piTui = {
      version = "$CLIENT_VERSION";
      url = "$RELEASE_URL/$(basename "$TUI_TGZ")";
      hash = "$(hash_of "$TUI_TGZ")";
    };
  };
MANIFEST
)"

echo
echo "==> artifact"
ls -la "$TUI_TGZ"
echo
if [ -n "${MANIFEST_OUT:-}" ]; then
	printf '%s\n' "$ENTRY" >"$MANIFEST_OUT"
	echo "==> manifest entry written to $MANIFEST_OUT"
fi
printf '%s\n' "$ENTRY"
