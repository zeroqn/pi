import {
  log
} from "./index-59dmj4zs.js";

// ../plugin/src/shared/write-transaction-timing.ts
var SLOW_WRITE_TRANSACTION_THRESHOLD_MS = 1000;
function logSlowWriteTransaction(site, startedAt, thresholdMs = SLOW_WRITE_TRANSACTION_THRESHOLD_MS, completedAtMs = performance.now()) {
  try {
    const durationMs = completedAtMs - startedAt;
    if (durationMs < thresholdMs)
      return;
    log(`[magic-context] slow write transaction: site=${site} held=${durationMs.toFixed(1)}ms`);
  } catch {}
}

export { logSlowWriteTransaction };
