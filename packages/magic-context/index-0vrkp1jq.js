import {
  log2
} from "./index-x3dcnxh0.js";

// ../plugin/src/shared/write-transaction-timing.ts
var SLOW_WRITE_TRANSACTION_THRESHOLD_MS = 1000;
function logSlowWriteTransaction(site, startedAt, thresholdMs = SLOW_WRITE_TRANSACTION_THRESHOLD_MS, completedAtMs = performance.now(), steps) {
  try {
    const durationMs = completedAtMs - startedAt;
    if (durationMs < thresholdMs)
      return;
    const detail = steps ? Object.entries(steps).map(([name, ms]) => `${name}=${ms.toFixed(1)}ms`).join(" ") : "";
    log2(`[magic-context] slow write transaction: site=${site} held=${durationMs.toFixed(1)}ms${detail ? ` ${detail}` : ""}`);
  } catch {}
}

class WriteTransactionSteps {
  durations = {};
  last = performance.now();
  mark(name) {
    const now = performance.now();
    this.durations[name] = now - this.last;
    this.last = now;
  }
  reset() {
    this.last = performance.now();
  }
}

export { logSlowWriteTransaction, WriteTransactionSteps };
