// ../plugin/src/hooks/magic-context/raw-ordinal-warmup-worker.ts
import { parentPort, workerData } from "node:worker_threads";
var port = parentPort;
if (!port)
  throw new Error("raw ordinal warm-up worker requires a parent port");
var input = workerData;
port.postMessage({ kind: "accepted" });
var [{ Database }, { scanRawSessionSummaryRows }] = await Promise.all([
  import("./sqlite-3yye76ht.js"),
  import("./read-session-raw-npx3920c.js")
]);
var db;
var reply;
try {
  db = input.indexMessage ? new Database(input.path) : new Database(input.path, { readonly: true });
  db.exec("PRAGMA busy_timeout = 250");
  if (input.indexMessage) {
    const { setHarness } = await import("./harness-9872e0ym.js");
    setHarness(input.harness ?? "opencode");
    const [
      { indexMessageInShortChunks },
      { configureContextDatabasePragmas },
      { registerSqliteDiagnosticSink }
    ] = await Promise.all([
      import("./message-index-bounded-7ew2ye8s.js"),
      import("./sqlite-context-pragmas-gcgch6qz.js"),
      import("./sqlite-3yye76ht.js")
    ]);
    const { log } = await import("./logger-j6tecd1h.js");
    registerSqliteDiagnosticSink(log);
    configureContextDatabasePragmas(db);
    const writer = db;
    const message = input.indexMessage;
    const cancellation = input.indexCancellation ? new Int32Array(input.indexCancellation) : undefined;
    const result = await indexMessageInShortChunks(writer, input.sessionId, message, input, () => !cancellation || Atomics.load(cancellation, 0) === 0);
    reply = { kind: "indexed", inserted: result.inserted, measurements: result.measurements };
  } else if (input.tagRatio !== undefined) {
    const { scanTagOwnerSummary, scanTagOwnerDelta } = await import("./storage-tags-4w8sfwfa.js");
    const delta = input.tagState ? scanTagOwnerDelta(db, input.sessionId, input.tagState) : null;
    if (delta)
      reply = { kind: "tag-delta", delta };
    else
      reply = {
        kind: "tag-summary",
        summary: scanTagOwnerSummary(db, input.sessionId, input.tagRatio, input.tagRatios)
      };
  } else {
    const scan = scanRawSessionSummaryRows(db, input.sessionId, input.previous);
    reply = { kind: "scan", scan };
  }
} catch (error) {
  reply = {
    kind: "error",
    error: error instanceof Error ? error.stack ?? error.message : String(error)
  };
} finally {
  db?.close();
}
port.postMessage(reply);
port.close();
