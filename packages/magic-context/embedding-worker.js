import {
  setHarness2
} from "./index-0h2mkab2.js";
import {
  log2,
  flushLogger2
} from "./index-tm11k42a.js";
import"./index-dnp1jjar.js";
import {
  setStoragePrivatePermissionEnforcement
} from "./index-8x8wtn3t.js";
import"./index-vcegxfwg.js";
import"./index-5rcjs14a.js";
import"./index-pefn1gt5.js";
import"./index-2qtx0q6h.js";
import {
  serveEmbeddingWorker,
  resolveLocalEmbeddingWorkerRuntime,
  getLocalEmbeddingNativeMemoryStats,
  LocalEmbeddingProvider
} from "./index-ggyrh6mr.js";

// ../plugin/src/features/magic-context/memory/embedding-worker.ts
import { parentPort, workerData } from "node:worker_threads";
setHarness2(workerData.harness);
setStoragePrivatePermissionEnforcement(workerData.enforcePrivateStoragePermissions !== false);
var unsafeNative = workerData.runtimePreference === "native" && resolveLocalEmbeddingWorkerRuntime("native") === "wasm";
if (unsafeNative)
  log2("[magic-context] native embedding worker teardown is unsafe on this Bun version; using WASM. Upgrade the host to Bun >=1.4.0 for native inference.");
var provider = new LocalEmbeddingProvider(workerData.model, workerData.maxInputTokens, workerData.dtype, unsafeNative ? "wasm" : workerData.runtimePreference);
if (parentPort)
  serveEmbeddingWorker(parentPort, provider, {
    batchSize: 2,
    stats: getLocalEmbeddingNativeMemoryStats,
    exit: () => {
      flushLogger2();
      process.exit(0);
    }
  });
