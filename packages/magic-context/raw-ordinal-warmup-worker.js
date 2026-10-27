import {
  exitOnWorkerClose
} from "./index-54wmg4rj.js";

// ../plugin/src/hooks/magic-context/raw-ordinal-warmup-worker.ts
import { parentPort, workerData } from "node:worker_threads";
if (!parentPort)
  throw new Error("raw ordinal warm-up worker requires a parent port");
var port = parentPort;
var input = workerData;
port.postMessage({ kind: "accepted" });
var openConnections = new Set;
var { closePort } = exitOnWorkerClose(port, () => {
  for (const connection of openConnections) {
    try {
      connection.close();
    } catch {}
  }
});
main().catch((error) => {
  setTimeout(() => {
    throw error;
  });
});
async function main() {
  const [
    { Database, registerSqliteDiagnosticSink },
    { readRawSessionMessageIdsAtOrdinalsFromDb, scanRawSessionSummaryRows },
    { getHarness, setHarness },
    { log }
  ] = await Promise.all([
    import("./sqlite-v89bj0yy.js"),
    import("./read-session-raw-napqv76k.js"),
    import("./harness-9872e0ym.js"),
    import("./logger-shetp43v.js")
  ]);
  setHarness(input.harness ?? "opencode");
  registerSqliteDiagnosticSink(log, getHarness);
  let db;
  let reply;
  try {
    if (input.openCancellation && Atomics.load(new Int32Array(input.openCancellation), 0) !== 0) {
      throw new Error("warm-up owner closed before database open");
    }
    db = input.indexMessage || input.orphanSweep || input.ftsRowidBackfill ? new Database(input.path) : new Database(input.path, { readonly: true });
    openConnections.add(db);
    db.exec("PRAGMA busy_timeout = 250");
    if (input.ftsRowidBackfill) {
      const { runMessageFtsRowidMapBackfill } = await import("./message-fts-rowid-map-1tb3qjtc.js");
      db.exec("PRAGMA busy_timeout = 0");
      await runMessageFtsRowidMapBackfill(db);
      reply = { kind: "fts-rowid-backfill" };
    } else if (input.searchArchive) {
      const { renderSearchArchive } = await import("./search-archive-qa1sf8hc.js");
      const { readRawSessionMessageIdOrdinalsForRangeFromDb } = await import("./read-session-raw-napqv76k.js");
      const archive = input.searchArchive;
      let raw;
      try {
        reply = {
          kind: "search-archive",
          text: renderSearchArchive(db, input.sessionId, archive.start, archive.end, archive.tokenBudget, archive.archiveOnly, () => {
            if (!archive.rawPath)
              return new Map(archive.rawIds);
            raw = new Database(archive.rawPath, { readonly: true });
            openConnections.add(raw);
            raw.exec("PRAGMA busy_timeout = 250");
            return readRawSessionMessageIdOrdinalsForRangeFromDb(raw, input.sessionId, archive.start, archive.end);
          })
        };
      } finally {
        if (raw)
          openConnections.delete(raw);
        raw?.close();
      }
    } else if (input.exactOrdinalIds) {
      reply = {
        kind: "exact-ordinal-ids",
        ids: readRawSessionMessageIdsAtOrdinalsFromDb(db, input.sessionId, input.exactOrdinalIds)
      };
    } else if (input.orphanSweep) {
      const [
        { setHarness },
        { sweepOrphanedOpenCodeMessageIndexesCooperatively },
        { configureContextDatabasePragmas }
      ] = await Promise.all([
        import("./harness-9872e0ym.js"),
        import("./message-index-fedjhja5.js"),
        import("./sqlite-context-pragmas-gcgch6qz.js")
      ]);
      setHarness(input.harness ?? "opencode");
      configureContextDatabasePragmas(db);
      const sourcePath = input.orphanSweep.sourcePath;
      reply = {
        kind: "orphan-sweep",
        result: await sweepOrphanedOpenCodeMessageIndexesCooperatively(db, () => {
          if (!sourcePath)
            return null;
          const source = new Database(sourcePath, { readonly: true });
          openConnections.add(source);
          return source;
        }, input.orphanSweep.options)
      };
    } else if (input.indexMessage) {
      const { setHarness } = await import("./harness-9872e0ym.js");
      setHarness(input.harness ?? "opencode");
      const [{ indexMessageInShortChunks }, { configureContextDatabasePragmas }] = await Promise.all([
        import("./message-index-bounded-yj7s7cwz.js"),
        import("./sqlite-context-pragmas-gcgch6qz.js")
      ]);
      configureContextDatabasePragmas(db);
      const writer = db;
      const message = input.indexMessage;
      const cancellation = input.indexCancellation ? new Int32Array(input.indexCancellation) : undefined;
      const result = await indexMessageInShortChunks(writer, input.sessionId, message, input, () => !cancellation || Atomics.load(cancellation, 0) === 0);
      reply = {
        kind: "indexed",
        inserted: result.inserted,
        measurements: result.measurements
      };
    } else if (input.tagRatio !== undefined) {
      const { scanTagOwnerSummary, scanTagOwnerDelta } = await import("./storage-tags-r48vxthe.js");
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
    const sqliteError = error;
    reply = {
      kind: "error",
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      code: typeof sqliteError?.code === "string" ? sqliteError.code : undefined,
      errcode: typeof sqliteError?.errcode === "number" ? sqliteError.errcode : undefined
    };
  } finally {
    if (db)
      openConnections.delete(db);
    db?.close();
  }
  port.postMessage(reply);
  closePort();
}
