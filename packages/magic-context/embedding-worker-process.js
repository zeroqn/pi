import"./index-0h2mkab2.js";
import {
  log2
} from "./index-x3dcnxh0.js";

// ../plugin/src/features/magic-context/memory/embedding-worker-process.ts
import { Worker } from "node:worker_threads";
var worker;
process.on("message", (message) => {
  if (message.entry && !worker) {
    worker = new Worker(new URL(message.entry), { workerData: message.data });
    worker.on("message", (reply) => {
      const wire = {
        ...reply,
        vectors: reply.vectors?.map((vector) => vector === null ? null : Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString("base64"))
      };
      if (process.connected)
        process.send?.(wire);
    });
    worker.on("error", (error) => {
      log2("[magic-context] embedding worker failed:", error);
      process.exit(1);
    });
    worker.on("exit", (code) => process.exit(code));
  } else {
    worker?.postMessage(message);
  }
});
process.on("disconnect", () => process.exit(0));
