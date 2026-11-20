import {
  serveWorkerJobs
} from "./index-nypgv96r.js";

// ../plugin/src/features/magic-context/compaction-marker-candidates-worker.ts
serveWorkerJobs(async (input, port) => {
  port.postMessage({ kind: "accepted" });
  const [{ Database }, { scanMarkerCandidateSnapshot }] = await Promise.all([
    import("./sqlite-v89bj0yy.js"),
    import("./compaction-marker-candidates-nxaamfej.js")
  ]);
  let db;
  let reply;
  try {
    db = new Database(input.path, { readonly: true });
    db.exec("PRAGMA busy_timeout=250");
    reply = {
      kind: "candidates",
      snapshot: scanMarkerCandidateSnapshot(db, input.sessionId, input.references !== false)
    };
  } catch (error) {
    reply = { kind: "error", error: error instanceof Error ? error.message : String(error) };
  } finally {
    db?.close();
  }
  port.postMessage(reply);
  port.close();
});
