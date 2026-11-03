import"./index-0h2mkab2.js";
import {
  setLogLineForwarder2,
  log2
} from "./index-gymgz20n.js";
import"./index-dnp1jjar.js";
import {
  Database2
} from "./index-2qtx0q6h.js";
import"./index-135e8hvg.js";
import {
  runMigrationsWithRetry
} from "./index-vd4cwnaz.js";
import"./index-3pk2mhaq.js";
import"./index-n0zjvs3h.js";
import"./index-6pk49fc3.js";
import {
  setSqlitePragmaConfig,
  initializeDatabase
} from "./index-cx7ctxbc.js";
import"./index-fapenpch.js";
import"./index-3bb24eb6.js";
import"./index-399p688g.js";
import"./index-54wmg4rj.js";
import"./index-mkh1cm5k.js";
import"./index-rgvqh5x7.js";
import"./index-3rq8rbt9.js";
import"./index-c6wbq66z.js";
import {
  closeQuietly
} from "./index-nrzkqte4.js";
import"./index-0wtm7g7f.js";

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
