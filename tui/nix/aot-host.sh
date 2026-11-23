#!/usr/bin/env bash
# Builds the AOT pi host: the `pi --mode rpc` child that the Rust client drives.
#
# Usage: aot-host [--pi DIR] [--out DIR] [--compile-only]
#   --pi DIR        the pi tree (default: $PI_REPO, else ../pi beside this checkout)
#   --out DIR       where the executable and its assets go (default: $PI_TUI_OUT, else ./results/pi)
#   --compile-only  skip `npm run build:offline` (for iterating on the compile step alone)
# Environment:
#   PI_TUI_RUNTIME  the Bun with `--aot` (default: `bun` on PATH; the dev shell points it at nix/runtime.nix)
#
# The compile is `bun build --compile --aot`, upstream Bun's own ahead-of-time compiler: no patched engine, no
# training profile. Measured on pi 1.6.0: 219 MB, `pi --version` 37-51 ms against 92-109 ms for `--bytecode`.
set -euo pipefail

PI_DIR="${PI_REPO:-}"
OUT="${PI_TUI_OUT:-$PWD/results/pi}"
BUN="${PI_TUI_RUNTIME:-bun}"
BUILD=1

while [ $# -gt 0 ]; do
	case "$1" in
	--pi) PI_DIR="$2"; shift ;;
	--out) OUT="$2"; shift ;;
	--compile-only) BUILD=0 ;;
	-h | --help) sed -n '2,16p' "$0"; exit 0 ;;
	*) echo "aot-host: unknown option $1" >&2; exit 2 ;;
	esac
	shift
done

die() { echo "aot-host: $*" >&2; exit 1; }
[ -n "$PI_DIR" ] || PI_DIR="$(cd "$PWD/../../pi" 2>/dev/null && pwd || true)"
[ -f "$PI_DIR/packages/coding-agent/package.json" ] || die "no pi tree at '$PI_DIR' (pass --pi DIR or set PI_REPO)"
command -v npm >/dev/null 2>&1 || die "npm is required"
"$BUN" --version >/dev/null 2>&1 || die "'$BUN' does not run (set PI_TUI_RUNTIME)"
# The AOT compiler is in Bun's canary builds only: a released Bun fails here, so say which one is in use.
"$BUN" build --compile --help 2>&1 | grep -q -- '--aot' ||
	die "$("$BUN" --version) has no 'bun build --compile --aot'; point PI_TUI_RUNTIME at nix/runtime.nix's Bun"

DATA="$PI_DIR/packages/ai/src/providers/data"
if [ "$BUILD" = 1 ]; then
	# The generated model data is gitignored: `build:offline` refuses to build without it.
	if [ ! -d "$DATA" ]; then
		echo "==> model data missing: npm run hydrate:model-data (fetches models.dev, OpenRouter, the gateways)"
		(cd "$PI_DIR" && npm run hydrate:model-data >/dev/null) || die "hydrate:model-data failed"
	fi
	echo "==> building pi's dist (npm run build:offline)"
	(cd "$PI_DIR" && npm run build:offline >/dev/null) || die "build:offline failed"
fi
[ -f "$PI_DIR/packages/coding-agent/dist/bun/cli.js" ] ||
	die "no dist/bun/cli.js in $PI_DIR: run without --compile-only first"

echo "==> compiling ahead of time with Bun $("$BUN" --version)"
mkdir -p "$OUT"
(cd "$PI_DIR/packages/coding-agent" && "$BUN" build --compile --aot --splitting --format=esm \
	--no-compile-autoload-bunfig --no-compile-autoload-dotenv --compile-autoload-package-json \
	--aot-allow-code-from-disk \
	./dist/bun/cli.js ./src/utils/image-resize-worker.ts ./src/extensions/codemode/worker.ts \
	--outfile "$OUT/pi")

echo "==> staging what the executable reads beside itself"
(cd "$PI_DIR/packages/coding-agent" && npm run --silent copy-binary-assets >/dev/null) ||
	die "copy-binary-assets failed"
DIST="$PI_DIR/packages/coding-agent/dist"
for asset in package.json README.md CHANGELOG.md docs examples theme assets export-html photon_rs_bg.wasm; do
	[ -e "$DIST/$asset" ] && cp -R "$DIST/$asset" "$OUT/"
done
# The client's own platform helpers, when this tree has them built (optional: --aot-allow-code-from-disk
# loads them at run time).
case "$(uname -s)" in
Linux) os=linux ;;
Darwin) os=darwin ;;
*) os=none ;;
esac
case "$(uname -m)" in
x86_64 | amd64) arch=x64 ;;
arm64 | aarch64) arch=arm64 ;;
*) arch=none ;;
esac
PREBUILTS="$PI_DIR/packages/tui/native/$os/prebuilds/$os-$arch"
[ -d "$PREBUILTS" ] && { mkdir -p "$OUT/native/$os/prebuilds"; cp -R "$PREBUILTS" "$OUT/native/$os/prebuilds/"; }

# The compiled executable carries /lib64/ld-linux-x86-64.so.2 whatever Bun's own interpreter is, which a
# NixOS host does not have. Give it the runtime's own patched interpreter and rpath instead.
if command -v patchelf >/dev/null 2>&1; then
	interp="$(patchelf --print-interpreter "$BUN" 2>/dev/null || true)"
	rpath="$(patchelf --print-rpath "$BUN" 2>/dev/null || true)"
	if [ -n "$interp" ] && [ -e "$interp" ]; then
		patchelf --set-interpreter "$interp" ${rpath:+--set-rpath "$rpath"} "$OUT/pi"
	fi
fi

"$OUT/pi" --version >/dev/null 2>&1 || die "$OUT/pi does not start (a non-NixOS host without patchelf needs /lib64)"
echo "==> $OUT/pi ($(du -h "$OUT/pi" | cut -f1)), pi $("$OUT/pi" --version)"
# Startup, three runs, as the client pays it: the executable is a child process either way.
for _ in 1 2 3; do
	start=$(date +%s%N)
	"$OUT/pi" --version >/dev/null
	echo "    $(( ($(date +%s%N) - start) / 1000000 )) ms"
done
