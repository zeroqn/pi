/*
 * libonnxrtabi24.so.1 — a one-symbol ABI shim.
 *
 * Home: extensions/tui/nix/onnxruntime-shim/ (ported from shell/onnxruntime-shim/ so the
 * ahead-of-time pi host this flake builds and installs carries it). The host runs the canary
 * Bun this flake pins, which is >= 1.4, so Magic Context's resolver takes the *native*
 * embeddings path and the vendored binding below is the one that loads.
 *
 * Why: the npm binding `onnxruntime-node@1.24.3` (onnxruntime_binding.node) takes
 * exactly ONE symbol from the ORT shared library it is linked against:
 *
 *     $ readelf --dyn-syms onnxruntime_binding.node | grep libonnx
 *     ... UND OrtGetApiBase@VERS_1.24.3
 *
 * A `NEEDED` entry plus `RUNPATH $ORIGIN/` means the loader resolves that versioned
 * symbol from whichever library it finds first — and this workspace does not ship
 * the npm package's own copy. A nixpkgs ONNX Runtime 1.27.1 exports
 * `OrtGetApiBase@@VERS_1.27.1`, so the loader refuses before ORT's own
 * append-only `OrtApi` negotiation can happen:
 *
 *     version `VERS_1.24.3' not found (required by .../onnxruntime_binding.node)
 *
 * This shim carries that version node itself and forwards the call to the real
 * library, dlopen'ed by absolute store path. Everything after the handshake goes
 * through the returned `OrtApi` v1..27 struct, whose first 24 slots are the ones the
 * binding was compiled against (`ort_api_1_to_27`, append-only by contract).
 *
 * The file is named `libonnxrtabi24.so.1`, NOT `libonnxruntime.so.1`, and the
 * vendored binding asks for that name rather than for the real library's
 * (`extensions/packages/onnxruntime-node/vendor.sh` makes the one-byte-substitution
 * that does it). This is not cosmetic either: `LD_LIBRARY_PATH` outranks a binary's
 * own `RUNPATH`, so any file *named* `libonnxruntime.so.1` on it becomes the ONNX
 * Runtime for every process — and a shim can only define the one version node it was
 * built for. `zg` (zvec-grep) needs `OrtGetApiBase@VERS_1.27.1` and died the day
 * this shim was on the path under the old name:
 *
 *     zg: .../onnxruntime-shim-.../lib/libonnxruntime.so.1: version `VERS_1.27.1' not found (required by zg)
 *
 * Under its own name the shim answers for the binding alone, and every other
 * consumer resolves the real library through its own `RUNPATH` again.
 *
 * Build: nix/onnxruntime-shim/default.nix in this flake (the SONAME is load-bearing, see
 * .scratch/mc-payload/research/03-does-the-swap-run.md):
 *
 *   gcc -shared -fPIC -O2 \
 *       -DDEFAULT_REAL_LIB='"${pkgs.onnxruntime}/lib/libonnxruntime.so.1"' \
 *       -o libonnxrtabi24.so.1 shim.c \
 *       -Wl,--version-script=VERS_1.24.3.map \
 *       -Wl,-soname,libonnxrtabi24.so.1 -ldl
 *
 * The real library is named by the environment, first non-empty wins:
 *
 *   1. ORT_SHIM_REAL_LIB      — an exact file. The test knob, and the escape hatch.
 *   2. ONNXRUNTIME_LIB_PATH   — a *directory*; the shim appends
 *                               `/libonnxruntime.so.1`. This is the human's knob,
 *                               defaulted by the devShell, so a 1.26.0 pair or a
 *                               future ONNX Runtime can be swapped in without
 *                               rebuilding the shim.
 *   3. DEFAULT_REAL_LIB       — the pinned nixpkgs store path baked in at build time,
 *                               which is also the store reference that keeps that
 *                               library alive in the closure.
 *
 * Contract:
 *   - on a missing/unloadable real library: prints one clear `[ort-shim]` line to
 *     stderr and _exit(1) — a diagnosable failure, not a SIGSEGV from a NULL
 *     OrtApiBase;
 *   - a self-reference is refused the same way rather than absorbed, so
 *     ONNXRUNTIME_LIB_PATH can never silently mean "the pinned default";
 *   - ORT_SHIM_DEBUG=1 prints the dlopen handle and probes the real library's
 *     OrtApiBase::GetApi(24) — the API level the npm 1.24.3 binding asks for, and
 *     the handshake .scratch/mc-payload/research/01-a-matching-pair.md measured.
 *     (`OrtGetVersionString` is not an exported symbol; the version lives only
 *     inside the OrtApi struct, so it is not probed here.)
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#ifndef DEFAULT_REAL_LIB
#define DEFAULT_REAL_LIB \
  "/nix/store/x46rnziynpalr4phm6yh0x46s42xq5kw-onnxruntime-1.27.1/lib/libonnxruntime.so.1"
#endif

#define SHIM_TAG "[ort-shim]"

/* ONNXRUNTIME_LIB_PATH names a directory; this is the leaf the loader asks for. */
#define SHIM_LIB_LEAF "/libonnxruntime.so.1"

typedef const void *(*ort_get_api_base_fn)(void);

/* The one entry point this object exports (defined below; declared here because the
 * self-reference check in `open_real` compares against it). */
const void *OrtGetApiBase(void);

/* OrtApiBase is a single-member struct whose only member is GetApi(uint32_t):
 * `const OrtApi*(ORT_API_CALL* GetApi)(uint32_t version)`.  The v1..27 OrtApi it
 * returns is append-only, so GetApi(24) is the exact call the 1.24.3 binding makes. */
typedef struct {
  const void *(*GetApi)(unsigned int version);
} ort_api_base;

static int shim_debug(void) {
  const char *d = getenv("ORT_SHIM_DEBUG");
  return d && *d && d[0] != '0';
}

static void fail(const char *what, const char *detail) {
  fprintf(stderr,
          SHIM_TAG " FATAL: %s: %s\n"
          SHIM_TAG " the shim could not reach the real ONNX Runtime library; set "
          "ORT_SHIM_REAL_LIB to an absolute file, or ONNXRUNTIME_LIB_PATH to the "
          "directory holding " SHIM_LIB_LEAF "\n",
          what, detail ? detail : "(no detail)");
  fflush(stderr);
  _exit(1);
}

/* Resolved once, on the first OrtGetApiBase() call. */
static ort_get_api_base_fn real_get_api_base = 0;

/* Open the real library, or die trying.
 *
 * The self-reference check is the one piece of this file that is not just glue.
 * `ONNXRUNTIME_LIB_PATH` names the directory holding the *real* `libonnxruntime.so.1`,
 * and pointing it at this shim would pin the answer to `DEFAULT_REAL_LIB` — silently
 * defeating the variable's only purpose, which is to swap in a different ONNX Runtime.
 * It is refused instead.  `dlopen` of an already-loaded object returns its handle and
 * `dlsym` then hands back our own `OrtGetApiBase`, so forwarding would recurse until
 * the stack is gone (measured: SIGSEGV, exit 139); comparing the symbol is the exact
 * test. */
static void *open_real(const char *path) {
  void *handle = dlopen(path, RTLD_NOW | RTLD_GLOBAL);
  if (!handle) {
    fail(path, dlerror());
  }
  void *sym = dlsym(handle, "OrtGetApiBase");
  if (!sym) {
    fail("dlsym(\"OrtGetApiBase\") in the real library", dlerror());
  }
  if (sym == (void *)OrtGetApiBase) {
    fail(path,
         "this is the shim itself; ONNXRUNTIME_LIB_PATH must name the directory "
         "holding the real libonnxruntime.so.1");
  }
  return handle;
}

static void resolve_real(void) {
  char joined[4096];
  const char *path;
  const char *exact = getenv("ORT_SHIM_REAL_LIB");
  const char *dir = getenv("ONNXRUNTIME_LIB_PATH");

  if (exact && *exact) {
    path = exact;
  } else if (dir && *dir) {
    int n = snprintf(joined, sizeof(joined), "%s" SHIM_LIB_LEAF, dir);
    if (n < 0 || (size_t)n >= sizeof(joined)) {
      fail("ONNXRUNTIME_LIB_PATH is too long to join", dir);
    }
    path = joined;
  } else {
    path = DEFAULT_REAL_LIB;
  }

  void *handle = open_real(path);
  void *sym = dlsym(handle, "OrtGetApiBase");
  real_get_api_base = (ort_get_api_base_fn)sym;
  if (shim_debug()) {
    const ort_api_base *base = (const ort_api_base *)real_get_api_base();
    const void *api24 = base ? base->GetApi(24) : 0;
    fprintf(stderr, SHIM_TAG " dlopen handle=%p path=%s\n", handle, path);
    fprintf(stderr, SHIM_TAG " real OrtGetApiBase=%p -> OrtApiBase=%p GetApi(24)=%p\n",
            (void *)real_get_api_base, (void *)base, api24);
    fflush(stderr);
  }
}

/* The single versioned entry point the npm binding requires. */
const void *OrtGetApiBase(void) {
  if (!real_get_api_base) resolve_real();
  const void *api_base = real_get_api_base();
  if (shim_debug()) {
    fprintf(stderr, SHIM_TAG " OrtGetApiBase() -> %p\n", api_base);
    fflush(stderr);
  }
  return api_base;
}
