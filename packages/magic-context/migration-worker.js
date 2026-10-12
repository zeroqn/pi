import"./index-0h2mkab2.js";
import {
  setLogLineForwarder2,
  log2
} from "./index-f956htf3.js";
import {
  Database2
} from "./index-3cgbv47m.js";
import"./index-135e8hvg.js";
import {
  runMigrationsWithRetry
} from "./index-jg27bxae.js";
import {
  closeQuietly
} from "./index-gj0r90h9.js";
import"./index-8976mezv.js";
import"./index-dkx0b1kt.js";
import {
  setSqlitePragmaConfig,
  initializeDatabase
} from "./index-8pdxxv7j.js";
import"./index-fapenpch.js";
import"./index-603mt6nm.js";
import"./index-xwgrhenf.js";
import"./index-fp37he9a.js";

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
