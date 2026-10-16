import"./index-0h2mkab2.js";
import {
  setLogLineForwarder2,
  log2
} from "./index-x3dcnxh0.js";
import {
  Database2
} from "./index-3cgbv47m.js";
import"./index-135e8hvg.js";
import {
  runMigrationsWithRetry
} from "./index-krhpcm6f.js";
import {
  closeQuietly
} from "./index-nmsb3x01.js";
import"./index-8976mezv.js";
import"./index-fgabebe5.js";
import"./index-kgd6t63g.js";
import"./index-fapenpch.js";
import {
  setSqlitePragmaConfig,
  initializeDatabase
} from "./index-35sd5btx.js";
import"./index-knxngpvf.js";
import"./index-vaah9fbg.js";
import"./index-0vrkp1jq.js";

// ../plugin/src/features/magic-context/migration-worker.ts
import { parentPort, workerData } from "node:worker_threads";
function post(message) {
  parentPort?.postMessage(message);
}
async function main() {
  const data = workerData;
  setLogLineForwarder2((line) => post({ type: "log", line }));
  setSqlitePragmaConfig(data.sqlitePragmaConfig);
  post({ type: "ready" });
  let db;
  try {
    db = new Database2(data.dbPath);
    initializeDatabase(db, data.busyTimeoutMs);
    await runMigrationsWithRetry(db, {
      sleep: async (delayMs) => {
        post({ type: "lock-wait", waiting: true });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        post({ type: "lock-wait", waiting: false });
      }
    });
    const finished = db;
    db = undefined;
    finished.close();
    log2(`[migrations] migration worker connection closed: ${data.dbPath}`);
    post({ type: "done" });
  } catch (error) {
    post({
      type: "failed",
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    if (db)
      closeQuietly(db);
    setLogLineForwarder2(null);
  }
}
main();
