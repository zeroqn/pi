#!/usr/bin/env bash
# Moves nix/bun-pin.nix to the current Bun canary, or reports whether it moved.
#
# Usage: bun-pin-update.sh [--check]
#   --check    do not write: exit 0 when the pin is current, 10 when it is not (the watch workflow's test)
# Environment:
#   PI_TUI_SRC   the flake tree (default: $PWD, which is it inside `nix develop`)
#
# It compares upstream's HTTP validators (etag) first, so an unchanged canary costs one HEAD request per
# archive and no download. A moved canary is downloaded, hashed, and recorded with its validators.
set -euo pipefail

ROOT="${PI_TUI_SRC:-$PWD}"
PIN="$ROOT/nix/bun-pin.nix"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

die() { echo "bun-pin-update: $*" >&2; exit 1; }
[ -f "$PIN" ] || die "no $PIN (run from extensions/tui, or set PI_TUI_SRC)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# `system<TAB>asset<TAB>etag<TAB>lastModified<TAB>hash` for every archive the pin holds: one place lists the
# platforms, so adding one to the pin starts watching it.
python3 - "$PIN" >"$tmp/pin.tsv" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
for block in re.finditer(
    r"    (\S+) = {\n"
    r"      asset = \"(.+)\";\n"
    r"      hash = \"(.+)\";\n"
    r"      etag = \"(.+)\";\n"
    r"      lastModified = \"(.+)\";\n",
    text,
):
    system, asset, hash, etag, modified = block.groups()
    print("\t".join([system, asset, etag, modified, hash]))
PY
[ -s "$tmp/pin.tsv" ] || die "no archives parsed from $PIN"

upstream="$(sed -n 's/^  upstream = "\(.*\)";$/\1/p' "$PIN")"
[ -n "$upstream" ] || die "no upstream URL in $PIN"

moved=0
: >"$tmp/out.tsv"
while IFS=$'\t' read -r system asset old_etag old_modified old_hash; do
	headers="$tmp/$asset.headers"
	curl -fsSIL -o "$headers" "$upstream/$asset" || die "cannot reach $upstream/$asset"
	etag="$(sed -n 's/^etag: *//Ip' "$headers" | tr -d '\r"' | head -1)"
	modified="$(sed -n 's/^last-modified: *//Ip' "$headers" | tr -d '\r' | head -1)"
	[ -n "$etag" ] || die "no etag for $asset ($upstream/$asset)"
	hash="$old_hash"
	if [ "$etag" != "$old_etag" ]; then
		moved=1
		echo "==> $system $asset moved: etag $old_etag -> $etag"
		body="$tmp/$asset"
		curl -fsSL -o "$body" "$upstream/$asset" || die "cannot download $asset"
		if command -v nix >/dev/null 2>&1; then
			hash="$(nix hash file --sri "$body")"
		else
			hash="sha256-$(openssl dgst -sha256 -binary "$body" | base64 | tr -d '\n')"
		fi
		rm -f "$body"
	else
		echo "==> $system $asset unchanged ($etag)"
	fi
	printf '%s\t%s\t%s\t%s\t%s\n' "$system" "$asset" "$etag" "$modified" "$hash" >>"$tmp/out.tsv"
done <"$tmp/pin.tsv"

if [ "$moved" = 0 ]; then
	echo "==> the pin is current"
	exit 0
fi
if [ "$CHECK" = 1 ]; then
	echo "==> the pin is stale; run without --check to move it"
	exit 10
fi

python3 - "$PIN" "$tmp/out.tsv" <<'PY'
import datetime, email.utils, sys

pin, tsv = sys.argv[1], sys.argv[2]
rows = [line.rstrip("\n").split("\t") for line in open(tsv) if line.strip()]
dates = [email.utils.parsedate_to_datetime(row[3]) for row in rows]
stamp = max(dates).strftime("%Y%m%d") if dates else "unknown"

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
