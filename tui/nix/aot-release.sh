#!/usr/bin/env bash
# Builds the release artifacts for this platform and prints the `nix/manifest.nix` entries for them.
#
# Usage: aot-release.sh [--pi DIR] [--stage DIR] [--from DIR] [--commit]
#   --pi DIR      the pi tree the host is built from (default: $PI_REPO, else ../pi)
#   --stage DIR   where the tarballs are written (default: $PI_TUI_OUT/../release, i.e. results/release)
#   --from DIR    package this AOT build instead of compiling (a previous aot-host output)
# Environment:
#   RELEASE_URL   where the assets will be served from (default: the OWNER/REPO placeholder)
#   MANIFEST_OUT  write this platform's manifest.nix entry to the file (the workflow reads it)
#
# What goes in a tarball is what must sit together at run time, not everything the build wrote:
#   pi-aot-<pi version>-<platform>.tar.gz    pi, package.json, theme/, assets/, export-html/, docs/,
#                                            examples/, native/, photon_rs_bg.wasm, LICENSE
#   pi-tui-<client version>-<platform>.tar.gz  rpi and the `pi` wrapper beside it
#
# On a NixOS host the tarball's interpreter is not there: install it through the flake (`packages.pi-aot`),
# which patches it, rather than unpacking the tarball by hand.
set -euo pipefail

PI_DIR="${PI_REPO:-}"
STAGE=""
FROM=""

while [ $# -gt 0 ]; do
	case "$1" in
	--pi) PI_DIR="$2"; shift ;;
	--stage) STAGE="$2"; shift ;;
	--from) FROM="$2"; shift ;;
	-h | --help) sed -n '2,20p' "$0"; exit 0 ;;
	*) echo "aot-release: unknown option $1" >&2; exit 2 ;;
	esac
	shift
done

die() { echo "aot-release: $*" >&2; exit 1; }
# The source tree, not the store: inside `nix develop` this script runs from $out/bin. The dev shell's
# working directory is the flake's, so $PWD is the tree; PI_TUI_SRC names one elsewhere.
ROOT="${PI_TUI_SRC:-$PWD}"
[ -f "$ROOT/Cargo.toml" ] || die "no flake tree at $ROOT (run from extensions/tui, or set PI_TUI_SRC)"
platform() {
	case "$(uname -s)-$(uname -m)" in
	Linux-x86_64) echo x86_64-linux ;;
	Linux-aarch64 | Linux-arm64) echo aarch64-linux ;;
	Darwin-arm64 | Darwin-aarch64) echo aarch64-darwin ;;
	*) die "no release artifact for $(uname -s) $(uname -m)" ;;
	esac
}
PLATFORM="$(platform)"
STAGE="${STAGE:-$PWD/results/release}"
mkdir -p "$STAGE"
echo "==> platform $PLATFORM, staging into $STAGE"

# --- the client ---------------------------------------------------------------------------------------
CLIENT_VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' "$ROOT/Cargo.toml" | head -1)"
[ -n "$CLIENT_VERSION" ] || CLIENT_VERSION=0.0.0
echo "==> rpi $CLIENT_VERSION (cargo build --release)"
 (cd "$ROOT" && cargo build --release --quiet -p pi-tui)
RPI_BIN="$(cd "$ROOT" && cargo metadata --format-version 1 --no-deps --quiet |
	python3 -c 'import json,sys;print(json.load(sys.stdin)["target_directory"])')/release/rpi"
[ -x "$RPI_BIN" ] || die "no rpi at $RPI_BIN"
TUI_TGZ="$STAGE/pi-tui-$CLIENT_VERSION-$PLATFORM.tar.gz"
rm -rf "$STAGE/tui" && mkdir -p "$STAGE/tui"
install -m755 "$RPI_BIN" "$STAGE/tui/rpi"
install -m755 "$ROOT/bin/pi" "$STAGE/tui/pi"
tar -C "$STAGE/tui" -czf "$TUI_TGZ" .

# --- the host -----------------------------------------------------------------------------------------
if [ -n "$FROM" ]; then
	HOST_DIR="$FROM"
else
	[ -f "$PI_DIR/packages/coding-agent/package.json" ] || die "no pi tree at '$PI_DIR' (pass --pi DIR)"
	HOST_DIR="$STAGE/host"
	rm -rf "$HOST_DIR"
	AOT_HOST="$(command -v aot-host || echo "$ROOT/nix/aot-host.sh")"
	[ -x "$AOT_HOST" ] || die "no aot-host (run from nix develop)"
	PI_DIR="$PI_DIR" PI_TUI_OUT="$HOST_DIR" "$AOT_HOST" --pi "$PI_DIR" --out "$HOST_DIR"
fi
PI_VERSION="$(node -p "require('$HOST_DIR/package.json').version")"
[ -n "$PI_VERSION" ] || die "no package.json in $HOST_DIR"
PI_TGZ="$STAGE/pi-aot-$PI_VERSION-$PLATFORM.tar.gz"
rm -rf "$STAGE/host-tar" && mkdir -p "$STAGE/host-tar"
install -m755 "$HOST_DIR/pi" "$STAGE/host-tar/pi"
for asset in package.json theme assets export-html docs examples native photon_rs_bg.wasm; do
	[ -e "$HOST_DIR/$asset" ] && cp -R "$HOST_DIR/$asset" "$STAGE/host-tar/"
done
if [ -f "$PI_DIR/LICENSE" ]; then cp "$PI_DIR/LICENSE" "$STAGE/host-tar/"; fi
tar -C "$STAGE/host-tar" -czf "$PI_TGZ" .

# --- what a manifest entry needs ----------------------------------------------------------------------
hash_of() {
	if command -v nix >/dev/null 2>&1; then
		nix hash file --sri "$1"
	else
		echo "sha256-$(openssl dgst -sha256 -binary "$1" | base64)" | tr -d '\n'
	fi
}
# The release page URL is what a manifest entry points at. In CI the workflow passes RELEASE_URL; locally
# the placeholder says what has to be filled in.
RELEASE_URL="${RELEASE_URL:-https://github.com/OWNER/REPO/releases/download/RELEASE_TAG}"
ENTRY="$(
	cat <<MANIFEST
  $PLATFORM = {
    piAot = {
      version = "$PI_VERSION";
      url = "$RELEASE_URL/$(basename "$PI_TGZ")";
      hash = "$(hash_of "$PI_TGZ")";
    };
    piTui = {
      version = "$CLIENT_VERSION";
      url = "$RELEASE_URL/$(basename "$TUI_TGZ")";
      hash = "$(hash_of "$TUI_TGZ")";
    };
  };
MANIFEST
)"

echo
echo "==> artifacts"
ls -la "$PI_TGZ" "$TUI_TGZ"
echo
if [ -n "$MANIFEST_OUT" ]; then
	printf '%s\n' "$ENTRY" >"$MANIFEST_OUT"
	echo "==> manifest entry written to $MANIFEST_OUT"
fi
printf '%s\n' "$ENTRY"
echo
echo "  sha256sum for people who do not use Nix:"
(cd "$STAGE" && sha256sum "$(basename "$PI_TGZ")" "$(basename "$TUI_TGZ")" 2>/dev/null) || true
