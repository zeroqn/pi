import {
  withSqliteBackgroundWriter2,
  withoutSqliteTransformPass2
} from "./index-7ptxvfc5.js";
import {
  logSlowWriteTransaction
} from "./index-0vrkp1jq.js";

// ../plugin/src/features/magic-context/message-fts-rowid-map.ts
import { createHash } from "node:crypto";
var MESSAGE_FTS_ROWID_MAP_BACKFILL_BATCH_SIZE = 100;
var BACKFILL_STATE_ID = 1;
var EMPTY_INDEX_CONTENT_HASH = createHash("sha256").update("").digest("hex");
var upsertMapStatements = new WeakMap;
var rangeReadyStatements = new WeakMap;
var updateTimeStatements = new WeakMap;
var activeBackfills = new WeakMap;
function getUpsertMapStatement(db) {
  let statement = upsertMapStatements.get(db);
  if (!statement) {
    statement = db.prepare(`INSERT INTO message_fts_rowid_map
                 (session_id, message_ordinal, fts_rowid, message_time_ms)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(session_id, message_ordinal) DO UPDATE SET
                 fts_rowid = excluded.fts_rowid,
                 message_time_ms = COALESCE(
                     excluded.message_time_ms,
                     message_fts_rowid_map.message_time_ms
                 )`);
    upsertMapStatements.set(db, statement);
  }
  return statement;
}
function getBackfillState(db) {
  const row = db.prepare(`SELECT watermark_rowid AS watermarkRowid, completed
             FROM message_fts_rowid_map_backfill_state
             WHERE id = ?`).get(BACKFILL_STATE_ID);
  return {
    processed: 0,
    watermarkRowid: typeof row?.watermarkRowid === "number" && Number.isSafeInteger(row.watermarkRowid) ? row.watermarkRowid : 0,
    completed: row?.completed === 1
  };
}
function recordMessageFtsRowid(db, sessionId, messageOrdinal, ftsRowid, messageTimeMs = null) {
  const numericRowid = Number(ftsRowid);
  if (!Number.isSafeInteger(numericRowid) || numericRowid <= 0) {
    throw new Error(`invalid message FTS rowid: ${String(ftsRowid)}`);
  }
  const normalizedTime = typeof messageTimeMs === "number" && Number.isSafeInteger(messageTimeMs) && messageTimeMs >= 0 ? messageTimeMs : null;
  getUpsertMapStatement(db).run(sessionId, messageOrdinal, numericRowid, normalizedTime);
}
function recordIndexedMessageTime(db, sessionId, messageOrdinal, messageTimeMs) {
  if (typeof messageTimeMs !== "number" || !Number.isSafeInteger(messageTimeMs) || messageTimeMs < 0) {
    return;
  }
  let statement = updateTimeStatements.get(db);
  if (!statement) {
    statement = db.prepare(`UPDATE message_fts_rowid_map
                SET message_time_ms = ?
              WHERE session_id = ? AND message_ordinal = ?
                AND message_time_ms IS NULL`);
    updateTimeStatements.set(db, statement);
  }
  statement.run(messageTimeMs, sessionId, messageOrdinal);
}
function backfillMessageFtsRowidMapBatch(db, batchSize = MESSAGE_FTS_ROWID_MAP_BACKFILL_BATCH_SIZE) {
  const boundedBatchSize = Number.isFinite(batchSize) ? Math.min(MESSAGE_FTS_ROWID_MAP_BACKFILL_BATCH_SIZE, Math.max(1, Math.floor(batchSize))) : MESSAGE_FTS_ROWID_MAP_BACKFILL_BATCH_SIZE;
  let progress = {
    processed: 0,
    watermarkRowid: 0,
    completed: false
  };
  let transactionStartedAt = 0;
  db.transaction(() => {
    transactionStartedAt = performance.now();
    db.prepare(`INSERT OR IGNORE INTO message_fts_rowid_map_backfill_state
            (id, watermark_rowid, completed) VALUES (?, 0, 0)`).run(BACKFILL_STATE_ID);
    const state = getBackfillState(db);
    if (state.completed) {
      progress = state;
      return;
    }
    const rows = db.prepare(`SELECT rowid AS ftsRowid,
            session_id AS sessionId, message_ordinal AS messageOrdinal
            FROM message_history_fts WHERE rowid > ? ORDER BY rowid ASC LIMIT ?`).all(state.watermarkRowid, boundedBatchSize);
    let watermarkRowid = state.watermarkRowid;
    for (const row of rows) {
      const ftsRowid = Number(row.ftsRowid);
      const messageOrdinal = Number(row.messageOrdinal);
      if (Number.isSafeInteger(ftsRowid) && ftsRowid > watermarkRowid) {
        watermarkRowid = ftsRowid;
      }
      if (typeof row.sessionId === "string" && Number.isSafeInteger(messageOrdinal) && messageOrdinal >= 0 && Number.isSafeInteger(ftsRowid) && ftsRowid > 0) {
        recordMessageFtsRowid(db, row.sessionId, messageOrdinal, ftsRowid);
      }
    }
    const completed = rows.length < boundedBatchSize;
    db.prepare(`UPDATE message_fts_rowid_map_backfill_state
             SET watermark_rowid = ?, completed = ?, updated_at = ?
             WHERE id = ?`).run(watermarkRowid, completed ? 1 : 0, Date.now(), BACKFILL_STATE_ID);
    progress = {
      processed: rows.length,
      watermarkRowid,
      completed
    };
  }).immediate();
  logSlowWriteTransaction("message_fts_rowid_backfill", transactionStartedAt);
  return progress;
}
async function runMessageFtsRowidMapBackfill(db) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (;; ) {
    const progress = backfillMessageFtsRowidMapBatch(db);
    if (progress.completed)
      return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
function startMessageFtsRowidMapBackfill(db) {
  const active = activeBackfills.get(db);
  if (active)
    return active;
  const run = withoutSqliteTransformPass2(() => withSqliteBackgroundWriter2(() => runMessageFtsRowidMapBackfill(db))).finally(() => {
    activeBackfills.delete(db);
  });
  activeBackfills.set(db, run);
  return run;
}
function messageFtsOrdinalRangeIsMapped(db, sessionId, startOrdinal, endOrdinal) {
  if (endOrdinal < startOrdinal)
    return true;
  if (getBackfillState(db).completed)
    return true;
  let statement = rangeReadyStatements.get(db);
  if (!statement) {
    statement = db.prepare(`SELECT COUNT(DISTINCT source.message_ordinal) AS sourceOrdinalCount,
                    COUNT(DISTINCT CASE
                        WHEN source.role IN ('user', 'assistant')
                         AND source.normalized_content_hash != ?
                        THEN source.message_ordinal
                    END) AS expectedMapCount,
                    COUNT(DISTINCT CASE
                        WHEN source.role IN ('user', 'assistant')
                         AND source.normalized_content_hash != ?
                         AND map.fts_rowid IS NOT NULL
                        THEN source.message_ordinal
                    END) AS mappedCount
             FROM message_history_source AS source
             LEFT JOIN message_fts_rowid_map AS map
               ON map.session_id = source.session_id
              AND map.message_ordinal = source.message_ordinal
             WHERE source.session_id = ?
               AND source.message_ordinal BETWEEN ? AND ?`);
    rangeReadyStatements.set(db, statement);
  }
  const row = statement.get(EMPTY_INDEX_CONTENT_HASH, EMPTY_INDEX_CONTENT_HASH, sessionId, startOrdinal, endOrdinal);
  const ordinalCount = endOrdinal - startOrdinal + 1;
  return row?.sourceOrdinalCount === ordinalCount && row.expectedMapCount === row.mappedCount;
}
function deleteUnmappedMessageFtsRows(db, sessionIds) {
  if (sessionIds.length === 0)
    return;
  const state = getBackfillState(db);
  if (state.completed)
    return;
  const placeholders = sessionIds.map(() => "?").join(", ");
  db.prepare(`DELETE FROM message_history_fts
         WHERE rowid > ? AND session_id IN (${placeholders})`).run(state.watermarkRowid, ...sessionIds);
}

// ../plugin/src/shared/project-directory-key.ts
import path from "node:path";
function projectDirectoryKey(directory) {
  const slashed = directory.replaceAll("\\", "/").replace(/^\/\/\?\/UNC\//i, "//").replace(/^\/\/\?\//, "");
  if (/^[a-z]:\//i.test(slashed) || slashed.startsWith("//")) {
    return path.win32.normalize(slashed).replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  }
  return path.resolve(directory);
}
function sameProjectDirectory(a, b) {
  if (a.length === 0 || b.length === 0)
    return false;
  return projectDirectoryKey(a) === projectDirectoryKey(b);
}

export { projectDirectoryKey, sameProjectDirectory, recordMessageFtsRowid, recordIndexedMessageTime, startMessageFtsRowidMapBackfill, messageFtsOrdinalRangeIsMapped, deleteUnmappedMessageFtsRows };
