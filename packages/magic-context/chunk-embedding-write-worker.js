import {
  setHarness2
} from "./index-0h2mkab2.js";
import {
  Database2
} from "./index-2qtx0q6h.js";
import {
  configureContextDatabasePragmas2
} from "./index-fapenpch.js";
import {
  isWorkerCloseMessage,
  exitOnWorkerClose
} from "./index-x2n261wp.js";
import"./index-svzkk03s.js";
import"./index-tm11k42a.js";
import"./index-dnp1jjar.js";
import"./index-tfa7vbsa.js";
import"./index-8sqebjzk.js";
import"./index-wfqysrwq.js";
import"./index-xjhq27z9.js";
import"./index-ghp32f9m.js";
import {
  replaceCompartmentChunkEmbeddings2,
  recordChunkEmbedBackoff2,
  loadUnembeddedSessionChunkCandidates2,
  countUnembeddedSessionCompartments2
} from "./index-02pkcpgf.js";
import {
  recordSessionProjectIdentity,
  acquireGitSweepLease,
  renewGitSweepLease,
  releaseGitSweepLease
} from "./index-79xfn84y.js";
import"./index-453s1hj6.js";
import {
  LATEST_SUPPORTED_VERSION,
  enforceSchemaFence
} from "./index-vmk9bj7r.js";
import"./index-3bb24eb6.js";
import"./index-nat56e33.js";
import"./index-j8s9qn84.js";
import"./index-135e8hvg.js";
import"./index-n0zjvs3h.js";
import"./index-1ts77n1b.js";
import {
  serveWorkerJobs
} from "./index-nypgv96r.js";

// ../plugin/src/features/magic-context/chunk-embedding-write-worker.ts
serveWorkerJobs((workerData, port) => {
  setHarness2(workerData.harness);
  const db = new Database2(workerData.path);
  if (!enforceSchemaFence(db, workerData.path, LATEST_SUPPORTED_VERSION)) {
    db.close();
    throw new Error("chunk embedding writer rejected an unsupported store schema");
  }
  const timeout = Math.max(0, Math.floor(workerData.timeout));
  db.exec(`PRAGMA busy_timeout=${timeout}; PRAGMA foreign_keys=ON`);
  configureContextDatabasePragmas2(db);
  exitOnWorkerClose(port, () => db.close(), false);
  port.on("message", (input) => {
    if (isWorkerCloseMessage(input))
      return;
    try {
      let value;
      switch (input.kind) {
        case "replace":
          replaceCompartmentChunkEmbeddings2(db, input.rows, input.sourceKey);
          break;
        case "project":
          recordSessionProjectIdentity(db, input.session, input.project);
          break;
        case "count":
          value = countUnembeddedSessionCompartments2(db, input.project, input.session, input.model, input.tokens);
          break;
        case "candidates":
          value = loadUnembeddedSessionChunkCandidates2(db, input.project, input.session, input.model, input.limit, input.excluded, input.tokens, true);
          break;
        case "backoff":
          recordChunkEmbedBackoff2(db, input.candidate, input.project, input.model);
          break;
        case "acquire":
          value = acquireGitSweepLease(db, input.project, input.holder, {
            ignoreCooldown: true
          });
          break;
        case "renew":
          value = renewGitSweepLease(db, input.project, input.holder);
          break;
        case "release":
          releaseGitSweepLease(db, input.project, input.holder);
          break;
      }
      port.postMessage({ value });
    } catch (error) {
      port.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}, false);
