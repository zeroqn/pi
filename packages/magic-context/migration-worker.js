import"./index-0h2mkab2.js";
import {
  setLogLineForwarder2,
  log2
} from "./index-fgs78jyd.js";
import {
  Database2
} from "./index-2qtx0q6h.js";
import"./index-135e8hvg.js";
import {
  runMigrationsWithRetry
} from "./index-0dr64gsy.js";
import {
  closeQuietly
} from "./index-w1avzkdt.js";
import"./index-23t8ryqw.js";
import"./index-hxp6q5f8.js";
import"./index-n4wyxcgr.js";
import"./index-fapenpch.js";
import {
  setSqlitePragmaConfig,
  initializeDatabase
} from "./index-j0t5pwjg.js";
import"./index-399p688g.js";
import"./index-54wmg4rj.js";
import"./index-8hmqdav2.js";
import"./index-8a2wvrda.js";
import"./index-my0dn413.js";
import"./index-hqw0rt9k.js";

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
