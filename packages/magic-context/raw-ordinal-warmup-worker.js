import {
  exitOnWorkerClose
} from "./index-x2n261wp.js";
import {
  serveWorkerJobs
} from "./index-nypgv96r.js";

// ../plugin/src/hooks/magic-context/raw-ordinal-warmup-worker.ts
serveWorkerJobs(async (input, port) => {
  port.postMessage({ kind: "accepted" });
  const openConnections = new Set;
  const { closePort } = exitOnWorkerClose(port, () => {
    for (const connection of openConnections) {
      try {
        connection.close();
      } catch {}
    }
  });
  await main();
  async function main() {
    if (input.v2ArchiveReader) {
      const { serveV2ArchiveReads } = await import("./v2-archive-reader-69p1qk4f.js");
      await serveV2ArchiveReads(port, openConnections);
      return;
    }
    const [
      { Database, registerSqliteDiagnosticSink },
      { readRawSessionMessageIdsAtOrdinalsFromDb, scanRawSessionSummaryRows },
      { getHarness, setHarness },
      { log }
    ] = await Promise.all([
      import("./sqlite-v89bj0yy.js"),
      import("./read-session-raw-0tytrjye.js"),
      import("./harness-9872e0ym.js"),
      import("./logger-93cnqyh0.js")
    ]);
    setHarness(input.harness ?? "opencode");
    registerSqliteDiagnosticSink(log, getHarness);
    let db;
    let reply;
    try {
      if (input.openCancellation && Atomics.load(new Int32Array(input.openCancellation), 0) !== 0) {
        throw new Error("warm-up owner closed before database open");
      }
      db = input.indexMessage || input.ftsRowidBackfill ? new Database(input.path) : new Database(input.path, { readonly: true });
      openConnections.add(db);
      db.exec("PRAGMA busy_timeout = 250");
      if (input.ftsRowidBackfill) {
        const { runMessageFtsRowidMapBackfill } = await import("./message-fts-rowid-map-dtbragnt.js");
        db.exec("PRAGMA busy_timeout = 0");
        await runMessageFtsRowidMapBackfill(db);
        reply = { kind: "fts-rowid-backfill" };
      } else if (input.searchArchive) {
        const { renderSearchArchive } = await import("./search-archive-g004g81m.js");
        const { readRawSessionMessageIdOrdinalsForRangeFromDb } = await import("./read-session-raw-0tytrjye.js");
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
      } else if (input.indexMessage) {
        const { setHarness } = await import("./harness-9872e0ym.js");
        setHarness(input.harness ?? "opencode");
        const [{ indexMessageInShortChunks }, { configureContextDatabasePragmas }] = await Promise.all([
          import("./message-index-bounded-kvjwhj8n.js"),
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
        const { scanTagOwnerSummary, scanTagOwnerDelta } = await import("./storage-tags-3a8af5qc.js");
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
});
