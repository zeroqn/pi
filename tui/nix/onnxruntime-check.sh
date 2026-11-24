#!/usr/bin/env bash
# Proves Magic Context's local embeddings run NATIVELY through the ONNX Runtime ABI shim this flake ships:
# the vendored binding resolves as the workspace member, loads through `libonnxrtabi24.so.1` to the nixpkgs
# ONNX Runtime, and the fork's own transformers chunk returns real 384-dimension vectors.
#
# Usage: onnxruntime-check [--host DIR] [--models DIR] [--repo DIR]
#   --host DIR     a `.#pi-aot` installation (a `bin/pi`, or a bare `pi` + package.json beside it). Adds the
#                  host leg: the same proof inside that host's own process, loaded as an extension, which
#                  proves the runtime Magic Context actually runs on — its embedded Bun, the mapped shim,
#                  the resolved member — with the proof transcript written to a file
#   --models DIR   the Xenova model cache (default: $MAGIC_CONTEXT_STORAGE_DIR/models, else the plugin's own
#                  ~/.local/share/cortexkit/magic-context/models)
#   --repo DIR     the extensions repository root (default: $PI_TUI_EXTENSIONS, else .. of this checkout)
# Environment:
#   PI_TUI_RUNTIME the Bun the first leg runs on (default: `bun` on PATH; the dev shell points it at
#                  nix/runtime.nix). The host leg needs nothing from it — it uses the host's own Bun, which an
#                  AOT executable embeds and does NOT expose as a command line (`BUN_BE_BUN` answers "this
#                  executable doesn't include the Bun command line"), hence the extension route.
#
# The environment must carry the shim for the first leg: the dev shell exports LD_LIBRARY_PATH and
# ONNXRUNTIME_LIB_PATH, and a `.#pi-aot` `bin/pi` exports both itself. Nothing here sets them — a missing
# shim is the loud failure this checks for, not something to paper over.
set -euo pipefail

HOST=""
MODELS="${MAGIC_CONTEXT_STORAGE_DIR:+$MAGIC_CONTEXT_STORAGE_DIR/models}"
MODELS="${MODELS:-${XDG_DATA_HOME:-$HOME/.local/share}/cortexkit/magic-context/models}"
EXT="${PI_TUI_EXTENSIONS:-}"
BUN="${PI_TUI_RUNTIME:-bun}"

while [ $# -gt 0 ]; do
	case "$1" in
	--host) HOST="$2"; shift ;;
	--models) MODELS="$2"; shift ;;
	--repo) EXT="$2"; shift ;;
	*) echo "onnxruntime-check: unknown option $1" >&2; exit 2 ;;
	esac
	shift
done

die() { echo "onnxruntime-check: FAIL $*" >&2; exit 1; }
pass() { echo "==> ok: $*"; }

[ -n "$EXT" ] || EXT="$(cd "$PWD/.." 2>/dev/null && pwd || true)"
MEMBER="$EXT/packages/onnxruntime-node"
MC="$EXT/packages/magic-context"
[ -d "$MEMBER" ] || die "no onnxruntime-node member at $MEMBER (pass --repo DIR)"
[ -d "$MC" ] || die "no magic-context package at $MC"

# The chunk the plugin's `native` runtime dynamically imports (`embedding-local.ts`). One file; a fork rebuild
# that leaves the old hash behind is what "two" would mean.
CHUNKS="$(ls "$MC"/transformers.node-*.js 2>/dev/null || true)"
[ "$(printf '%s\n' "$CHUNKS" | grep -c .)" = 1 ] ||
	die "expected one transformers.node-*.js in $MC, found: $(printf '%s' "$CHUNKS" | tr '\n' ' ')"
CHUNK="$CHUNKS"
MODEL="$MODELS/Xenova/all-MiniLM-L6-v2"
[ -d "$MODEL" ] || die "no Xenova/all-MiniLM-L6-v2 under $MODELS (pass --models DIR)"

# 1. The two file-level facts the seam rests on. Neither is a version check the real library could satisfy:
# the binding asks for THIS name, and the shim defines THIS version node.
BINDING="$MEMBER/bin/napi-v6/linux/x64/onnxruntime_binding.node"
[ -f "$BINDING" ] || die "no binding at $BINDING"
readelf -d "$BINDING" | grep -q 'NEEDED.*libonnxrtabi24.so.1' ||
	die "the binding's NEEDED is not libonnxrtabi24.so.1 (run packages/onnxruntime-node/vendor.sh)"
pass "the binding asks for libonnxrtabi24.so.1"

SHIM="$(printf '%s' "${LD_LIBRARY_PATH:-}" | tr ':' '\n' | while read -r d; do
	[ -f "$d/libonnxrtabi24.so.1" ] && { echo "$d"; break; }
done)"
[ -n "$SHIM" ] || die "no libonnxrtabi24.so.1 on LD_LIBRARY_PATH (enter the dev shell, or run a pi-aot bin/pi)"
readelf -V "$SHIM/libonnxrtabi24.so.1" | grep -q 'Name: VERS_1.24.3' ||
	die "$SHIM/libonnxrtabi24.so.1 does not define VERS_1.24.3"
pass "the shim at $SHIM defines VERS_1.24.3"

# 2. The proof itself, shared by both legs. `log` is the only dependency, so the same body reports on stdout
# under a plain Bun and to a file inside the host.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cat >"$WORK/body.mjs" <<'JS'
export async function proof(log) {
	const chunk = process.env.PROOF_CHUNK;
	const modelDir = process.env.PROOF_MODEL;
	const dtype = process.env.PROOF_DTYPE ?? "fp32";

	// Resolution first: a chunk that resolves a registry package beside the fork's own tree would prove
	// nothing about this swap (the bundled library answers through its own $ORIGIN).
	const { createRequire } = await import("node:module");
	const requireHere = createRequire(chunk);
	const resolved = requireHere.resolve("onnxruntime-node");
	log("[proof] onnxruntime-node -> " + resolved);
	// The member itself, or bun's hardlink of it (`onnxruntime-node@file+packages+onnxruntime-node`) — never
	// the registry package, whose bun-store name carries a version (`onnxruntime-node@1.`).
	if (
		!resolved.includes("/packages/onnxruntime-node/") &&
		!resolved.includes("onnxruntime-node@file+packages+onnxruntime-node")
	)
		throw new Error("resolved elsewhere: " + resolved);
	if (resolved.includes("onnxruntime-node@1."))
		throw new Error("resolved the registry package: " + resolved);

	const ort = requireHere("onnxruntime-node");
	log("[proof] backend " + JSON.stringify(ort.listSupportedBackends()) +
		" | versions " + JSON.stringify(ort.env.versions));
	log("[proof] bun " + (process.versions.bun ?? "<none>") + " node " + process.versions.node);

	const tf = await import(chunk);
	// embedding-local.ts: the pipeline the native path creates, and its default dtype.
	const pipe = await tf.pipeline("feature-extraction", modelDir, { dtype });
	if (typeof pipe !== "function") throw new Error("no feature-extraction pipeline in " + chunk);

	const texts = [
		"The quick brown fox jumps over the lazy dog.",
		"A fast auburn fox vaults above a sleepy canine.",
		"SELECT * FROM users WHERE id = 42;",
	];
	const embs = [];
	for (const t of texts) {
		const out = await pipe(t, { pooling: "mean", normalize: true });
		embs.push(out.data);
		log(`[proof] "${t.slice(0, 28)}.." dims=${JSON.stringify(out.dims)}`);
	}
	if (embs[0].length !== 384) throw new Error("the vector is not 384-dimensional");
	const dot = (x, y) => {
		let s = 0;
		for (let i = 0; i < x.length; i++) s += x[i] * y[i];
		return s;
	};
	const near = dot(embs[0], embs[1]);
	const far = dot(embs[0], embs[2]);
	log(`[proof] cos(paraphrase)=${near.toFixed(6)} cos(unrelated)=${far.toFixed(6)}`);
	if (!(near > far)) throw new Error("a paraphrase must be nearer than an unrelated sentence");

	// Whichever process this is, the loader opened the shim and the shim opened the pinned library.
	const maps = (await import("node:fs")).readFileSync("/proc/self/maps", "utf8").split("\n");
	for (const needle of ["libonnxrtabi24.so.1", "libonnxruntime.so.1"]) {
		const line = maps.find((l) => l.includes(needle));
		if (!line) throw new Error(needle + " is not mapped into this process");
		log("[maps] " + line.trim().replace(/^[^/]*/, ""));
	}
	log("[proof] OK");
}
JS

cat >"$WORK/run.mjs" <<'JS'
import { proof } from "./body.mjs";
await proof((line) => console.log(line));
JS

# The host leg's carrier: pi imports this at startup, so the proof runs in the host's own process and the
# transcript lands in a file instead of on the RPC stream.
cat >"$WORK/ext.mjs" <<'JS'
import { appendFileSync } from "node:fs";
const out = process.env.PROOF_OUT;
const log = (line) => appendFileSync(out, line + "\n");
try {
	const { proof } = await import("./body.mjs");
	await proof(log);
} catch (error) {
	log("[proof] FAIL " + ((error && error.stack) || error));
	process.exit(1);
}
process.exit(0);
JS

export PROOF_CHUNK="$CHUNK" PROOF_MODEL="$MODEL" ORT_SHIM_DEBUG=1

# 3. The first leg: the flake's Bun, the shim's own debug line naming the library it dlopen'ed.
"$BUN" "$WORK/run.mjs" || die "the proof failed on $("$BUN" --version)"
pass "a 384-dimension embedding through the shim, on $("$BUN" --version)"

# 4. `zg` shares the environment: an LD_LIBRARY_PATH entry named libonnxruntime.so.1 once hijacked it
# (`version 'VERS_1.27.1' not found`). Under its own name the shim answers for this binding alone.
if command -v zg >/dev/null 2>&1; then
	zg --version >/dev/null || die "zg broke with the shim on LD_LIBRARY_PATH"
	pass "zg still runs in the same environment"
fi

# 5. The host leg: the same proof inside the host the extension actually runs on. `env -u` strips both exports
# from the outer environment, so only the host's own `bin/pi` wrapper can supply them — which is exactly what
# `nix/prebuilt.nix` makes it do. An AOT executable embeds its Bun and exposes no command line, so the proof
# enters as an extension rather than as `BUN_BE_BUN=1 … -e`.
if [ -n "$HOST" ]; then
	case "$HOST" in /*) ;; *) HOST="$PWD/$HOST" ;; esac
	if [ -x "$HOST/bin/pi" ]; then
		HOSTPI="$HOST/bin/pi"
	elif [ -x "$HOST/pi" ]; then
		HOSTPI="$HOST/pi"
	else
		die "no pi executable in $HOST"
	fi
	rm -f "$WORK/host-proof.txt"
	env -u LD_LIBRARY_PATH -u ONNXRUNTIME_LIB_PATH \
		PROOF_OUT="$WORK/host-proof.txt" PROOF_CHUNK="$CHUNK" PROOF_MODEL="$MODEL" ORT_SHIM_DEBUG=1 \
		"$HOSTPI" -ne -e "$WORK/ext.mjs" --mode rpc </dev/null >/dev/null 2>"$WORK/host-stderr" ||
		die "the host leg exited non-zero: $(tail -3 "$WORK/host-stderr" | tr '\n' ' ')"
	[ -f "$WORK/host-proof.txt" ] || die "the host never ran the proof: $(tail -3 "$WORK/host-stderr")"
	grep -q '^\[proof\] OK$' "$WORK/host-proof.txt" || die "the host leg failed: $(tr '\n' '|' <"$WORK/host-proof.txt")"
	BUNVER="$(sed -n 's/^\[proof\] bun \([0-9][^ ]*\) .*/\1/p' "$WORK/host-proof.txt")"
	# Magic Context's resolver gate (embedding-local.ts, BUN_NAPI_TEARDOWN_FIX_VERSION = [1, 4, 0]): below
	# this the plugin returns "wasm" even when asked for "native", and this shim is never consulted.
	case "$BUNVER" in
	1.[0-3].*) die "the host embeds Bun $BUNVER, below Magic Context's native floor 1.4.0" ;;
	esac
	[ -n "$BUNVER" ] || die "no embedded Bun version in the host proof"
	sed -n '/^\[proof\] cos/s/^/    /p' "$WORK/host-proof.txt"
	sed -n '/^\[maps\] /s/^/    /p' "$WORK/host-proof.txt"
	pass "the host (Bun $BUNVER) computes the embedding through its wrapper's exports"
fi

pass "Magic Context's native embeddings are wired"
