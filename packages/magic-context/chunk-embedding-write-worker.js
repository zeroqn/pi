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
} from "./index-54wmg4rj.js";
import"./index-my0dn413.js";
import"./index-fgs78jyd.js";
import"./index-gwxaz0z5.js";
import"./index-399p688g.js";
import"./index-8hmqdav2.js";
import"./index-8a2wvrda.js";
import {
  replaceCompartmentChunkEmbeddings2,
  recordChunkEmbedBackoff2,
  loadUnembeddedSessionChunkCandidates2,
  countUnembeddedSessionCompartments2
} from "./index-wb2t932e.js";
import {
  recordSessionProjectIdentity,
  acquireGitSweepLease,
  renewGitSweepLease,
  releaseGitSweepLease
} from "./index-j3pz3a1b.js";
import"./index-hxp6q5f8.js";
import"./index-n4wyxcgr.js";
import {
  LATEST_SUPPORTED_VERSION,
  enforceSchemaFence
} from "./index-j0t5pwjg.js";
import"./index-0dr64gsy.js";
import"./index-w1avzkdt.js";
import"./index-135e8hvg.js";
import"./index-23t8ryqw.js";
import"./index-hqw0rt9k.js";

// ../plugin/src/features/magic-context/chunk-embedding-write-worker.ts
import { parentPort, workerData } from "node:worker_threads";
var port = parentPort;
if (!port)
  throw new Error("chunk embedding writer requires a parent port");
setHarness2(workerData.harness);
var db = new Database2(workerData.path);
if (!enforceSchemaFence(db, workerData.path, LATEST_SUPPORTED_VERSION)) {
  db.close();
  throw new Error("chunk embedding writer rejected an unsupported store schema");
}
var timeout = Math.max(0, Math.floor(workerData.timeout));
db.exec(`PRAGMA busy_timeout=${timeout}; PRAGMA foreign_keys=ON`);
configureContextDatabasePragmas2(db);
exitOnWorkerClose(port, () => db.close());
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
