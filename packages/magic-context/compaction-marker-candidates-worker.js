// ../plugin/src/features/magic-context/compaction-marker-candidates-worker.ts
import { parentPort, workerData } from "node:worker_threads";
var port = parentPort;
if (!port)
  throw new Error("marker candidate worker requires a parent port");
port.postMessage({ kind: "accepted" });
var [{ Database }, { scanMarkerCandidateSnapshot }] = await Promise.all([
  import("./sqlite-3yye76ht.js"),
  import("./compaction-marker-candidates-cd17s4ys.js")
]);
var input = workerData;
var db;
var reply;
try {
  db = new Database(input.path, { readonly: true });
  db.exec("PRAGMA busy_timeout=250");
  reply = { kind: "candidates", snapshot: scanMarkerCandidateSnapshot(db, input.sessionId) };
} catch (error) {
  reply = { kind: "error", error: error instanceof Error ? error.message : String(error) };
} finally {
  db?.close();
}
port.postMessage(reply);
port.close();
