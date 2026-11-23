#!/usr/bin/env bash
# Builds this platform's AOT release artifacts: pi, compiled ahead of time, and the Bun that compiled it.
#
# Usage: aot-release.sh [--pi DIR] [--stage DIR] [--from DIR]
#   --pi DIR      the pi tree the host is built from (default: $PI_REPO, else ../pi)
#   --stage DIR   where the artifacts are written (default: $ROOT/results/release)
#   --from DIR    package this AOT build instead of compiling (a previous aot-host output)
# Environment:
#   RELEASE_URL   where the assets will be served from (default: the OWNER/REPO placeholder)
#   MANIFEST_OUT  write this platform's entry for nix/manifest.nix to that file
#
# Two artifacts, one release stream (tag `pi-v<pi version>`), because both follow pi's releases:
#   pi-aot-<pi version>-<platform>.tar.gz    pi, package.json, theme/, assets/, export-html/, docs/,
#                                            examples/, native/, photon_rs_bg.wasm, LICENSE
#   bun-aot-<pin version>-<platform>.zip      the Bun archive that host was compiled with, hash-checked
#
# The Rust client is its own stream: `tui-release.sh`, tag `tui-v<client version>`.
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
	-h | --help) sed -n '2,18p' "$0"; exit 0 ;;
	*) echo "aot-release: unknown option $1" >&2; exit 2 ;;
	esac
	shift
done

die() { echo "aot-release: $*" >&2; exit 1; }
# The source tree, not the store: inside `nix develop` this script runs from $out/bin. The dev shell's
# working directory is the flake's, so $PWD is the tree; PI_TUI_SRC names one elsewhere.
ROOT="${PI_TUI_SRC:-$PWD}"
[ -f "$ROOT/Cargo.toml" ] || die "no flake tree at $ROOT (run from extensions/tui, or set PI_TUI_SRC)"
case "$(uname -s)-$(uname -m)" in
Linux-x86_64) PLATFORM=x86_64-linux ;;
Linux-aarch64 | Linux-arm64) PLATFORM=aarch64-linux ;;
Darwin-arm64 | Darwin-aarch64) PLATFORM=aarch64-darwin ;;
*) die "no release artifact for $(uname -s) $(uname -m)" ;;
esac
STAGE="${STAGE:-$ROOT/results/release}"
mkdir -p "$STAGE"
echo "==> $PLATFORM, staging into $STAGE"

hash_of() {
	if command -v nix >/dev/null 2>&1; then
		nix hash file --sri "$1"
	else
		echo "sha256-$(openssl dgst -sha256 -binary "$1" | base64 | tr -d '\n')"
	fi
}

# --- pi, ahead of time --------------------------------------------------------------------------------
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
[ -f "$PI_DIR/LICENSE" ] && cp "$PI_DIR/LICENSE" "$STAGE/host-tar/"
tar -C "$STAGE/host-tar" -czf "$PI_TGZ" .

# --- the Bun that compiled it -------------------------------------------------------------------------
# Upstream's canary assets are replaced daily and their old URLs stop working, so the release carries a copy.
BUN_VERSION="$(sed -n 's/^  version = "\(.*\)";$/\1/p' "$ROOT/nix/bun-pin.nix")"
read -r BUN_ASSET BUN_HASH <<<"$(python3 "$ROOT/nix/bun-pin-tools.py" asset "$PLATFORM")"
[ -n "$BUN_ASSET" ] || die "no Bun archive for $PLATFORM in nix/bun-pin.nix"
BUN_UPSTREAM="$(sed -n 's/^  upstream = "\(.*\)";$/\1/p' "$ROOT/nix/bun-pin.nix")"
BUN_ZIP="$STAGE/bun-aot-$BUN_VERSION-$PLATFORM.zip"
if [ ! -f "$BUN_ZIP" ]; then
	echo "==> staging Bun $BUN_VERSION ($BUN_ASSET)"
	curl -fsSL -o "$BUN_ZIP" "$BUN_UPSTREAM/$BUN_ASSET" || die "cannot download $BUN_ASSET"
fi
[ "$(hash_of "$BUN_ZIP")" = "$BUN_HASH" ] ||
	die "the Bun archive staged does not match the pin: $(hash_of "$BUN_ZIP") vs $BUN_HASH"

# --- the manifest entry -------------------------------------------------------------------------------
RELEASE_URL="${RELEASE_URL:-https://github.com/OWNER/REPO/releases/download/RELEASE_TAG}"
ENTRY="$(
	cat <<MANIFEST
  $PLATFORM = {
    piAot = {
      version = "$PI_VERSION";
      url = "$RELEASE_URL/$(basename "$PI_TGZ")";
      hash = "$(hash_of "$PI_TGZ")";
    };
    bunAot = {
      version = "$BUN_VERSION";
      url = "$RELEASE_URL/$(basename "$BUN_ZIP")";
      hash = "$BUN_HASH";
    };
  };
MANIFEST
)"

echo
echo "==> artifacts"
ls -la "$PI_TGZ" "$BUN_ZIP"
echo
if [ -n "${MANIFEST_OUT:-}" ]; then
	printf '%s\n' "$ENTRY" >"$MANIFEST_OUT"
	echo "==> manifest entry written to $MANIFEST_OUT"
fi
printf '%s\n' "$ENTRY"
echo
echo "  sha256sum for people who do not use Nix:"
(cd "$STAGE" && sha256sum "$(basename "$PI_TGZ")" "$(basename "$BUN_ZIP")" 2>/dev/null) || true
