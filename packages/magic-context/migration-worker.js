import"./index-0h2mkab2.js";
import {
  setLogLineForwarder2,
  log2
} from "./index-tm11k42a.js";
import"./index-dnp1jjar.js";
import {
  Database2
} from "./index-2qtx0q6h.js";
import"./index-135e8hvg.js";
import {
  runMigrationsWithRetry
} from "./index-pqhc0k9d.js";
import"./index-jhmz9tgv.js";
import"./index-n0zjvs3h.js";
import"./index-453s1hj6.js";
import {
  setSqlitePragmaConfig2,
  initializeDatabase2
} from "./index-cmhas8we.js";
import"./index-3bb24eb6.js";
import"./index-8sqebjzk.js";
import"./index-wfqysrwq.js";
import"./index-x2n261wp.js";
import"./index-xjhq27z9.js";
import"./index-ghp32f9m.js";
import"./index-pefn1gt5.js";
import {
  closeQuietly
} from "./index-nrzkqte4.js";
import"./index-1ts77n1b.js";
import {
  serveWorkerJobs
} from "./index-nypgv96r.js";

// ../plugin/src/features/magic-context/migration-worker.ts
serveWorkerJobs(async (data, port) => {
  function post(message) {
    port.postMessage(message);
  }
  async function main() {
    setLogLineForwarder2((line) => post({ type: "log", line }));
    setSqlitePragmaConfig2(data.sqlitePragmaConfig);
    post({ type: "ready" });
    let db;
    try {
      db = new Database2(data.dbPath);
      initializeDatabase2(db, data.busyTimeoutMs);
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
  await main();
  port.close();
});
