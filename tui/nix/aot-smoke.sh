#!/usr/bin/env bash
# The gate a release build must pass: this pi can answer its own protocol, and the client can start it.
#
# Usage: aot-smoke.sh --host DIR [--client BIN] [--expect VERSION]
#   --host DIR        where `pi` sits: a release directory (`pi` + `package.json`) or a store installation
#                     (`bin/pi` + `share/pi/package.json`)
#   --client BIN      an `rpi`; adds the pty check
#   --expect VERSION  required `pi --version`; defaults to the version in the manifest beside it
#
# Cheap by design: a failing compiler, a missing asset or a broken wire answers these in seconds, and the
# release workflow runs them on every platform before it publishes.
set -euo pipefail

HOST=""
CLIENT=""
EXPECT=""
while [ $# -gt 0 ]; do
	case "$1" in
	--host) HOST="$2"; shift ;;
	--client) CLIENT="$2"; shift ;;
	--expect) EXPECT="$2"; shift ;;
	*) echo "aot-smoke: unknown option $1" >&2; exit 2 ;;
	esac
	shift
done

die() { echo "aot-smoke: FAIL $*" >&2; exit 1; }
pass() { echo "==> ok: $*"; }
[ -n "$HOST" ] || die "--host is required"

# Absolute, because the checks below run from /tmp so a stray ~/.pi or a local package.json cannot change
# what is being tested.
case "$HOST" in /*) ;; *) HOST="$PWD/$HOST" ;; esac

# Two layouts, one script: a release directory stages `pi` beside its assets; a store installation has a
# `bin/pi` wrapper that sets `PI_PACKAGE_DIR` and an executable in `libexec`.
if [ -x "$HOST/bin/pi" ]; then
	PI="$HOST/bin/pi"
	MANIFEST="$HOST/share/pi/package.json"
elif [ -x "$HOST/pi" ]; then
	PI="$HOST/pi"
	MANIFEST="$HOST/package.json"
	export PI_PACKAGE_DIR="$HOST"
else
	die "no pi executable in $HOST"
fi
[ -f "$MANIFEST" ] || die "no package.json for $PI (looked for $MANIFEST)"

if [ -z "$EXPECT" ]; then
	EXPECT="$(python3 -c "import json;print(json.load(open('$MANIFEST'))['version'])" 2>/dev/null || true)"
fi
[ -n "$EXPECT" ] || die "no expected version in $MANIFEST"

# 1. The one-artifact rule: the executable reports the version of the manifest beside it.
actual="$(cd /tmp && "$PI" --version)"
[ "$actual" = "$EXPECT" ] || die "pi --version reported '$actual', the manifest says '$EXPECT'"
pass "pi --version = $EXPECT"

# 2. The wire the client speaks, with extension discovery off so a runner's own ~/.pi cannot change it.
response="$(
	cd /tmp && printf '{"id":"smoke","type":"get_state"}\n' |
		"$PI" -ne --mode rpc 2>/dev/null | head -1
)"
case "$response" in
*'"type":"response"'*'"command":"get_state"'*'"success":true'*) ;;
*) die "get_state over --mode rpc answered '$response'" ;;
esac
pass "get_state over --mode rpc"

# 3. The client starts at all, under a pty (it refuses a non-TTY). `script` has two spellings.
if [ -n "$CLIENT" ]; then
	case "$CLIENT" in /*) ;; *) CLIENT="$PWD/$CLIENT" ;; esac
	[ -x "$CLIENT" ] || die "$CLIENT is not executable"
	if command -v script >/dev/null 2>&1; then
		out="$(mktemp)"
		case "$(uname -s)" in
		Darwin) script -q "$out" "$CLIENT" --help >/dev/null 2>&1 || true ;;
		*) script -qec "$CLIENT --help" "$out" >/dev/null 2>&1 || true ;;
		esac
		grep -q -- '--pi' "$out" || die "the client did not start under a pty"
		rm -f "$out"
		pass "the client starts under a pty"
	else
		echo "==> skip: no 'script', so no pty check"
	fi
fi

pass "the release build is usable"
