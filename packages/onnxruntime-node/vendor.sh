#!/usr/bin/env bash
# Re-vendor the `onnxruntime-node` payload from a registry tarball.
#
#   ./vendor.sh /path/to/onnxruntime-node-<version>.tgz
#
# Run this on an upstream bump, then: update `package.json` here and the range in
# `packages/magic-context/package.json` **in the same commit** (they are one value),
# refresh README.md's sha256 block from this script's output, and commit the binding.
#
# Two edits are ours, and both are checked below:
#
#   1. only `dist/*.js`, `dist/*.d.ts` and the linux/x64 binding are kept — not the
#      other platforms' binaries (179 MB), not the 35 MB `libonnxruntime.so.1`, not
#      `script/` (whose `postinstall` fetches 301 MB of CUDA providers from NuGet);
#   2. the binding's library name is renamed to `libonnxrtabi24.so.1` — the ABI shim
#      built by `shell/onnxruntime-shim/`. See README §How the library is found: the
#      shim must NOT be named `libonnxruntime.so.1`, because an `LD_LIBRARY_PATH`
#      entry that answers that SONAME hijacks every other consumer in the
#      environment (`zg`, zvec-grep, died on it: `version 'VERS_1.27.1' not found`).
#      The replacement is a byte substitution of the one 19-byte string in the
#      binding's `.dynstr`, which both `DT_NEEDED` and the version-need's `vn_file`
#      point at, so the file's size and layout are unchanged. (`patchelf
#      --replace-needed` does the same job structurally, at the cost of rewriting
#      the ELF and growing it by 31 KB; the substitution is what we keep, because
#      the diff against upstream stays auditable.)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tarball="${1:?usage: vendor.sh <onnxruntime-node-<version>.tgz>}"
binding_dir="$here/bin/napi-v6/linux/x64"
binding="$binding_dir/onnxruntime_binding.node"

old_name='libonnxruntime.so.1'
new_name='libonnxrtabi24.so.1'
[ "${#old_name}" -eq "${#new_name}" ] || { echo "the two names must be the same length" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
tar -xzf "$tarball" -C "$work"
src="$work/package"

install -d "$here/dist" "$binding_dir"
for f in "$src"/dist/*.js "$src"/dist/*.d.ts; do
  install -m644 "$f" "$here/dist/"
done
install -m644 "$src/bin/napi-v6/linux/x64/onnxruntime_binding.node" "$binding"

python3 - "$binding" "$old_name" "$new_name" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2].encode(), sys.argv[3].encode()
data = open(path, "rb").read()
found = data.count(old)
if found != 1:
    sys.exit(f"expected exactly one {old.decode()} in the binding, found {found}")
open(path, "wb").write(data.replace(old, new))
print(f"renamed {old.decode()} -> {new.decode()} ({found} occurrence)")
PY

readelf -d "$binding" | grep -q "NEEDED.*$new_name" || { echo "NEEDED is not $new_name" >&2; exit 1; }
readelf -V "$binding" | grep -q "File: $new_name" || { echo "the version need does not name $new_name" >&2; exit 1; }

echo
echo "--- sha256 block for README.md ---"
(cd "$here" && find dist bin -type f -exec sha256sum {} + | sort -k2)
echo
echo "--- the binding's needs ---"
readelf -d "$binding" | grep NEEDED
readelf -V "$binding" | sed -n '/Version needs section/,/^$/p' | grep -E 'File: (libonnx|libonnxrt)'
