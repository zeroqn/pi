#!/usr/bin/env bash
# Moves nix/bun-pin.nix to the current Bun canary, or reports whether it moved.
#
# Usage: bun-pin-update.sh [--check] [--platform SYSTEM]
#   --check             do not write: exit 0 when the pin matches the bytes upstream serves, 10 when not
#   --platform SYSTEM   which archive to check (default: this machine's)
#
# Why a hash and not an HTTP validator: Bun's `canary` assets are replaced without their `etag` changing.
# Measured 2026-11-23: the etag stayed `0x8DF4944D676335D` while the archive's sha256 moved from
# `sha256-ynLCJ7Dy…` to `sha256-3hL0Ofnc…`, which is what made a `--check` that trusted the etag lie and let
# a stale pin reach a build. So `--check` downloads one archive and hashes it, and the write path downloads
# all of them. The etag is still recorded, as what upstream claims, never as the pin.
#
# `nix develop` cannot start when the pin is stale (the shell builds bun-aot), so this script needs no
# shell: bash, curl, python3 and — when it writes — nix for `nix hash file`.
set -euo pipefail

ROOT="${PI_TUI_SRC:-$PWD}"
PIN="$ROOT/nix/bun-pin.nix"
CHECK=0
PLATFORM=""

while [ $# -gt 0 ]; do
	case "$1" in
	--check) CHECK=1 ;;
	--platform) PLATFORM="$2"; shift ;;
	-h | --help) sed -n '2,18p' "$0"; exit 0 ;;
	*) echo "bun-pin-update: unknown option $1" >&2; exit 2 ;;
	esac
	shift
done

die() { echo "bun-pin-update: $*" >&2; exit 1; }
[ -f "$PIN" ] || die "no $PIN (run from extensions/tui, or set PI_TUI_SRC)"

if [ -z "$PLATFORM" ]; then
	case "$(uname -s)-$(uname -m)" in
	Linux-x86_64) PLATFORM=x86_64-linux ;;
	Linux-aarch64 | Linux-arm64) PLATFORM=aarch64-linux ;;
	Darwin-arm64 | Darwin-aarch64) PLATFORM=aarch64-darwin ;;
	*) die "no pinned archive for $(uname -s) $(uname -m)" ;;
	esac
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# `system<TAB>asset<TAB>etag<TAB>lastModified<TAB>hash` for every archive the pin holds.
python3 - "$PIN" >"$tmp/pin.tsv" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
for block in re.finditer(
    r"    (\S+) = \{\n"
    r'      asset = "(.+)";\n'
    r'      hash = "(.+)";\n'
    r'      etag = "(.+)";\n'
    r'      lastModified = "(.+)";\n',
    text,
):
    system, asset, hash, etag, modified = block.groups()
    print("\t".join([system, asset, hash, etag, modified]))
PY
[ -s "$tmp/pin.tsv" ] || die "no archives parsed from $PIN"
upstream="$(sed -n 's/^  upstream = "\(.*\)";$/\1/p' "$PIN")"
[ -n "$upstream" ] || die "no upstream URL in $PIN"

hash_of() {
	if command -v nix >/dev/null 2>&1; then
		nix hash file --sri "$1"
	else
		printf 'sha256-%s\n' "$(openssl dgst -sha256 -binary "$1" | base64 | tr -d '\n')"
	fi
}

# The last-modified upstream reports, which is how the pin names the build it holds.
modified_of() {
	curl -fsSIL -o "$tmp/headers" "$upstream/$1" 2>/dev/null || return 0
	sed -n 's/^last-modified: *//Ip' "$tmp/headers" | tr -d '\r' | head -1
}

if [ "$CHECK" = 1 ]; then
	pinned="$(awk -F'\t' -v p="$PLATFORM" '$1 == p { print $3 }' "$tmp/pin.tsv")"
	asset="$(awk -F'\t' -v p="$PLATFORM" '$1 == p { print $2 }' "$tmp/pin.tsv")"
	[ -n "$asset" ] || die "no archive for $PLATFORM in $PIN"
	body="$tmp/check.zip"
	curl -fsSL -o "$body" "$upstream/$asset" || die "cannot download $asset"
	actual="$(hash_of "$body")"
	if [ "$actual" = "$pinned" ]; then
		echo "==> $PLATFORM $asset matches the pin ($pinned)"
		exit 0
	fi
	echo "==> $PLATFORM $asset moved: pin $pinned, upstream $actual"
	exit 10
fi

: >"$tmp/out.tsv"
while IFS=$'\t' read -r system asset etag _modified _hash; do
	body="$tmp/$asset"
	curl -fsSL -o "$body" "$upstream/$asset" || die "cannot download $asset"
	hash="$(hash_of "$body")"
	modified="$(modified_of "$asset")"
	[ -n "$modified" ] || modified="$(date -u '+%a, %d %b %Y %H:%M:%S GMT')"
	printf '%s\t%s\t%s\t%s\t%s\n' "$system" "$asset" "$etag" "$modified" "$hash" >>"$tmp/out.tsv"
	rm -f "$body"
	echo "==> $system $asset $hash"
done <"$tmp/pin.tsv"

python3 - "$PIN" "$tmp/out.tsv" <<'PY'
import email.utils, sys

pin, tsv = sys.argv[1], sys.argv[2]
rows = [line.rstrip("\n").split("\t") for line in open(tsv) if line.strip()]
stamp = max(email.utils.parsedate_to_datetime(row[3]) for row in rows).strftime("%Y%m%d")

body = open(pin).read()
head = body[: body.index("{")].rstrip() + "\n"
out = [
    "{",
    '  version = "canary-%s";' % stamp,
    '  upstream = "https://github.com/oven-sh/bun/releases/download/canary";',
    "",
    "  archives = {",
]
for system, asset, etag, modified, hash in sorted(rows):
    out += [
        "    %s = {" % system,
        '      asset = "%s";' % asset,
        '      hash = "%s";' % hash,
        '      etag = "%s";' % etag,
        '      lastModified = "%s";' % modified,
        "    };",
    ]
out += [
    "  };",
    "",
    "  # Filled by the release workflow: the run that compiled pi with this pin and passed the gate.",
    '  verified = { run = "unverified"; pi = ""; };',
    "}",
]
open(pin, "w").write(head + "\n".join(out) + "\n")
print("==> wrote %s (canary-%s)" % (pin, stamp))
PY
