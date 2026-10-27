import {
  setHarness2
} from "./index-0h2mkab2.js";
import {
  log2
} from "./index-fgs78jyd.js";
import"./index-ccanzg8p.js";
import"./index-gwxaz0z5.js";
import"./index-my0dn413.js";
import"./index-2qtx0q6h.js";
import {
  resolveLocalEmbeddingWorkerRuntime,
  getLocalEmbeddingNativeMemoryStats,
  LocalEmbeddingProvider
} from "./index-0pt8z7am.js";
import {
  setStoragePrivatePermissionEnforcement
} from "./index-81nthk8j.js";

// ../plugin/src/features/magic-context/memory/embedding-worker.ts
import { parentPort, workerData } from "node:worker_threads";
setHarness2(workerData.harness);
setStoragePrivatePermissionEnforcement(workerData.enforcePrivateStoragePermissions !== false);
var unsafeNative = workerData.runtimePreference === "native" && resolveLocalEmbeddingWorkerRuntime("native") === "wasm";
if (unsafeNative)
  log2("[magic-context] native embedding worker teardown is unsafe on this Bun version; using WASM. Upgrade the host to Bun >=1.4.0 for native inference.");
var provider = new LocalEmbeddingProvider(workerData.model, workerData.maxInputTokens, workerData.dtype, unsafeNative ? "wasm" : workerData.runtimePreference);
var queue = Promise.resolve();
parentPort?.on("message", (request) => {
  queue = queue.then(async () => {
    try {
      const loaded = await provider.initialize();
      let vectors;
      if (loaded && request.texts) {
        vectors = [];
        for (let offset = 0;offset < request.texts.length; offset += 2) {
          vectors.push(...await provider.embedBatch(request.texts.slice(offset, offset + 2)));
        }
      }
      parentPort?.postMessage({
        id: request.id,
        loaded,
        vectors,
        failure: provider.getLastFailureReason(),
        stats: getLocalEmbeddingNativeMemoryStats()
      }, vectors?.flatMap((vector) => vector ? [vector.buffer] : []) ?? []);
    } catch (error) {
      parentPort?.postMessage({ id: request.id, loaded: false, error: String(error) });
    }
  });
});
