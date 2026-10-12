import {
  removeSystemReminders,
  hasMeaningfulUserText2,
  extractTexts2
} from "./index-xwgrhenf.js";
import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  withSqliteBackgroundWriter2,
  withoutSqliteTransformPass2
} from "./index-3cgbv47m.js";
import {
  closeQuietly,
  deleteTagIdentityRevisions
} from "./index-gj0r90h9.js";
import {
  cleanUserText2
} from "./index-6ck7trd8.js";
import {
  recordMessageFtsRowid,
  recordIndexedMessageTime,
  messageFtsOrdinalRangeIsMapped,
  deleteUnmappedMessageFtsRows
} from "./index-603mt6nm.js";
import {
  deleteChunkEmbedBackoffForSession
} from "./index-zmyrvs22.js";
import {
  logSlowWriteTransaction
} from "./index-fp37he9a.js";

// ../plugin/src/features/magic-context/message-index.ts
import { createHash } from "node:crypto";

// ../plugin/src/features/magic-context/compression-depth-storage.ts
var incrementDepthStatements = new WeakMap;
var totalDepthStatements = new WeakMap;
var maxDepthStatements = new WeakMap;
var clearDepthStatements = new WeakMap;
function getClearDepthStatement(db) {
  let stmt = clearDepthStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM compression_depth WHERE session_id = ?");
    clearDepthStatements.set(db, stmt);
  }
  return stmt;
}
function clearCompressionDepth(db, sessionId) {
  getClearDepthStatement(db).run(sessionId);
}
function clearCompressionDepthRange(db, sessionId, startOrdinal, endOrdinal) {
  if (endOrdinal < startOrdinal) {
    return;
  }
  db.prepare("DELETE FROM compression_depth WHERE session_id = ? AND message_ordinal BETWEEN ? AND ?").run(sessionId, startOrdinal, endOrdinal);
}

// ../plugin/src/features/magic-context/session-activity.ts
var PREFIX = "retrospective_activity:";
var INTERVAL_MS = 15000;
var pending = new WeakMap;
function sessionActivityKey(sessionId) {
  return `${PREFIX}${sessionId}`;
}
function deleteSessionActivity(db, sessionIds) {
  if (sessionIds.length === 0)
    return;
  const sessions = pending.get(db);
  for (const sessionId of sessionIds) {
    const state = sessions?.get(sessionId);
    if (state?.timer)
      clearTimeout(state.timer);
    sessions?.delete(sessionId);
  }
  const placeholders = sessionIds.map(() => "?").join(", ");
  db.prepare(`DELETE FROM schema_migrations_meta WHERE key IN (${placeholders})`).run(...sessionIds.map(sessionActivityKey));
  deleteTagIdentityRevisions(db, sessionIds);
}
function readSessionActivity(db, sessionId) {
  const row = db.prepare("SELECT value FROM schema_migrations_meta WHERE key = ?").get(sessionActivityKey(sessionId));
  const time = Number(row?.value);
  return row && Number.isFinite(time) ? time : undefined;
}
function advanceSessionActivity(db, sessionId, time) {
  if (!sessionId || !Number.isFinite(time) || time <= 0)
    return;
  db.prepare(`INSERT INTO schema_migrations_meta (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = CAST(MAX(CAST(value AS INTEGER), CAST(excluded.value AS INTEGER)) AS TEXT)`).run(sessionActivityKey(sessionId), String(Math.floor(time)));
}
function observeSessionActivity(db, sessionId, time = Date.now()) {
  if (!sessionId || !Number.isFinite(time) || time <= 0)
    return;
  let sessions = pending.get(db);
  if (!sessions) {
    sessions = new Map;
    pending.set(db, sessions);
  }
  const current = sessions.get(sessionId);
  if (!current || time - current.lastWrite >= INTERVAL_MS) {
    if (current?.timer)
      clearTimeout(current.timer);
    advanceSessionActivity(db, sessionId, Math.max(time, current?.latest ?? 0));
    sessions.set(sessionId, { lastWrite: time, latest: time });
    return;
  }
  current.latest = Math.max(current.latest, time);
  if (!current.timer) {
    current.timer = setTimeout(() => {
      current.timer = undefined;
      try {
        advanceSessionActivity(db, sessionId, current.latest);
        current.lastWrite = Date.now();
      } catch {
        sessions.delete(sessionId);
      }
    }, Math.max(1, INTERVAL_MS - (time - current.lastWrite)));
    current.timer.unref?.();
  }
}
async function backfillSessionActivity(db, harness, latestTime) {
  const completedKey = `retrospective_activity_backfill:${harness}:v1`;
  if (db.prepare("SELECT 1 FROM schema_migrations_meta WHERE key = ?").get(completedKey))
    return;
  let cursor = "";
  while (true) {
    const rows = db.prepare(`SELECT session_id FROM session_projects
            WHERE harness = ? AND session_id > ? ORDER BY session_id LIMIT 100`).all(harness, cursor);
    if (rows.length === 0)
      break;
    for (const row of rows) {
      const time = await latestTime(row.session_id);
      if (time !== undefined)
        advanceSessionActivity(db, row.session_id, time);
    }
    cursor = rows[rows.length - 1].session_id;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  db.prepare("INSERT OR IGNORE INTO schema_migrations_meta (key, value) VALUES (?, 'completed')").run(completedKey);
}

// ../plugin/src/features/magic-context/storage-session-tables.ts
var SESSION_SCOPED_TABLES = [
  { table: "pending_ops", harnessScoped: true },
  { table: "source_contents", harnessScoped: true },
  { table: "tool_owner_backfill_state" },
  { table: "tags", harnessScoped: true },
  { table: "session_meta", harnessScoped: true },
  {
    table: "temporal_decisions",
    extraPredicate: "NOT EXISTS (SELECT 1 FROM session_meta AS remaining WHERE remaining.session_id = temporal_decisions.session_id)"
  },
  {
    table: "session_replay_decisions",
    extraPredicate: "NOT EXISTS (SELECT 1 FROM session_meta AS remaining WHERE remaining.session_id = session_replay_decisions.session_id)"
  },
  { table: "session_projects", harnessScoped: true },
  { table: "compartment_chunk_embeddings", harnessScoped: true },
  { table: "compartments", harnessScoped: true },
  {
    table: "compartment_history_versions",
    extraPredicate: "NOT EXISTS (SELECT 1 FROM compartments AS remaining WHERE remaining.session_id = compartment_history_versions.session_id)"
  },
  { table: "compression_depth", harnessScoped: true },
  { table: "session_facts", harnessScoped: true },
  { table: "compartment_state_lease" },
  { table: "notes", harnessScoped: true, extraPredicate: "type = 'session'" },
  { table: "recomp_compartments", harnessScoped: true },
  { table: "recomp_facts", harnessScoped: true },
  { table: "user_memory_candidates" },
  { table: "primer_candidates", harnessScoped: true },
  { table: "m0_mutation_log" },
  { table: "compartment_events", harnessScoped: true },
  { table: "subagent_invocations", harnessScoped: true },
  { table: "historian_runs", harnessScoped: true },
  { table: "plugin_messages" },
  { table: "transform_decisions", harnessScoped: true },
  { table: "synapse_batch_ledger" },
  { table: "embedding_measurement_corpus" },
  { table: "pending_session_cleanup", harnessScoped: true },
  { table: "message_history_fts" },
  { table: "message_fts_rowid_map" },
  { table: "message_history_source", harnessScoped: true },
  { table: "message_history_index", harnessScoped: true },
  { table: "lkg_slots" },
  { table: "lkg_slot_chunks" }
];
function deleteSessionScopedRows(db, sessionIds, harness, options = {}) {
  if (sessionIds.length === 0)
    return 0;
  let deletableSessionIds = [...sessionIds];
  if (options.rustModuleCleanupAcknowledged !== true) {
    const placeholders = sessionIds.map(() => "?").join(", ");
    const harnessPredicate = harness === undefined ? "" : " AND harness = ?";
    const protectedRows = db.prepare(`SELECT session_id
                 FROM pending_session_cleanup
                 WHERE session_id IN (${placeholders})
                   AND harness LIKE '%:rust'${harnessPredicate}`).all(...sessionIds, ...harness === undefined ? [] : [`${harness}:rust`]);
    const protectedSessionIds = new Set(protectedRows.map((row) => row.session_id));
    deletableSessionIds = sessionIds.filter((sessionId) => !protectedSessionIds.has(sessionId));
  }
  if (deletableSessionIds.length === 0)
    return 0;
  const placeholders = deletableSessionIds.map(() => "?").join(", ");
  for (const sessionId of deletableSessionIds)
    deleteChunkEmbedBackoffForSession(db, sessionId);
  for (const definition of SESSION_SCOPED_TABLES) {
    if (definition.table === "message_history_fts") {
      db.prepare(`DELETE FROM message_history_fts
                 WHERE rowid IN (
                     SELECT fts_rowid
                     FROM message_fts_rowid_map
                     WHERE session_id IN (${placeholders})
                 )`).run(...deletableSessionIds);
      deleteUnmappedMessageFtsRows(db, deletableSessionIds);
      continue;
    }
    const predicates = [`session_id IN (${placeholders})`];
    if (definition.extraPredicate)
      predicates.push(definition.extraPredicate);
    const bindHarness = harness !== undefined && definition.harnessScoped === true;
    if (bindHarness)
      predicates.push("harness = ?");
    const statement = db.prepare(`DELETE FROM ${definition.table} WHERE ${predicates.join(" AND ")}`);
    if (bindHarness)
      statement.run(...deletableSessionIds, harness);
    else
      statement.run(...deletableSessionIds);
  }
  deleteSessionActivity(db, deletableSessionIds);
  return deletableSessionIds.length;
}

// ../plugin/src/features/magic-context/message-index.ts
var MESSAGE_HISTORY_ORPHAN_SWEEP_BATCH_SIZE = 200;
var MESSAGE_HISTORY_ORPHAN_SAFETY_AGE_MS = 24 * 60 * 60 * 1000;
var MESSAGE_HISTORY_ORPHAN_SWEEP_COOLDOWN_MS = 10 * 60 * 1000;
var MESSAGE_HISTORY_ORPHAN_UNAVAILABLE_REPROBE_MS = 24 * 60 * 60 * 1000;
var lastIndexedStatements = new WeakMap;
var insertMessageStatements = new WeakMap;
var upsertProgressStatements = new WeakMap;
var upsertDirtyFloorStatements = new WeakMap;
var deleteFtsStatements = new WeakMap;
var deleteFtsRangeStatements = new WeakMap;
var deleteIndexStatements = new WeakMap;
var countIndexedMessageStatements = new WeakMap;
var getMessageSourceStatements = new WeakMap;
var upsertMessageSourceStatements = new WeakMap;
var deleteMessageSourceStatements = new WeakMap;
var deleteMessageSourceRangeStatements = new WeakMap;
var deleteMessageFtsStatements = new WeakMap;
var deleteFtsMapStatements = new WeakMap;
var deleteFtsMapRangeStatements = new WeakMap;
var deleteMessageFtsMapStatements = new WeakMap;
var MESSAGE_INDEX_MAX_FTS_BYTES = 64 * 1024;
var skipStatements = new WeakMap;
function skipStatement(db, sql) {
  const statements = skipStatements.get(db) ?? new Map;
  skipStatements.set(db, statements);
  let statement = statements.get(sql);
  if (!statement) {
    statement = db.prepare(sql);
    statements.set(sql, statement);
  }
  return statement;
}
var messageIndexSkipKey = (sessionId, messageId) => `message_index_skip:${JSON.stringify([sessionId, messageId])}`;
function normalizeIndexText(text) {
  return text.replace(/\s+/g, " ").trim();
}
function getLastIndexedStatement(db) {
  let stmt = lastIndexedStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT last_indexed_ordinal, dirty_floor_ordinal FROM message_history_index WHERE session_id = ?");
    lastIndexedStatements.set(db, stmt);
  }
  return stmt;
}
function getInsertMessageStatement(db) {
  let stmt = insertMessageStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("INSERT INTO message_history_fts (session_id, message_ordinal, message_id, role, content) VALUES (?, ?, ?, ?, ?)");
    insertMessageStatements.set(db, stmt);
  }
  return stmt;
}
function getUpsertProgressStatement(db) {
  let stmt = upsertProgressStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("INSERT INTO message_history_index (session_id, last_indexed_ordinal, dirty_floor_ordinal, updated_at, harness) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET last_indexed_ordinal = excluded.last_indexed_ordinal, dirty_floor_ordinal = excluded.dirty_floor_ordinal, updated_at = excluded.updated_at");
    upsertProgressStatements.set(db, stmt);
  }
  return stmt;
}
function getUpsertDirtyFloorStatement(db) {
  let stmt = upsertDirtyFloorStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("INSERT INTO message_history_index (session_id, last_indexed_ordinal, dirty_floor_ordinal, updated_at, harness) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET last_indexed_ordinal = MAX(message_history_index.last_indexed_ordinal, excluded.last_indexed_ordinal), dirty_floor_ordinal = CASE WHEN message_history_index.dirty_floor_ordinal <= 0 THEN excluded.dirty_floor_ordinal WHEN excluded.dirty_floor_ordinal <= 0 THEN message_history_index.dirty_floor_ordinal ELSE MIN(message_history_index.dirty_floor_ordinal, excluded.dirty_floor_ordinal) END, updated_at = excluded.updated_at");
    upsertDirtyFloorStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteFtsRangeStatement(db) {
  let stmt = deleteFtsRangeStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`DELETE FROM message_history_fts
             WHERE rowid IN (
                 SELECT fts_rowid
                 FROM message_fts_rowid_map
                 WHERE session_id = ? AND message_ordinal BETWEEN ? AND ?
             )`);
    deleteFtsRangeStatements.set(db, stmt);
  }
  return stmt;
}
function getCountIndexedMessageStatement(db) {
  let stmt = countIndexedMessageStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT COUNT(*) AS count
             FROM message_history_source AS source
             JOIN message_fts_rowid_map AS map
               ON map.session_id = source.session_id
              AND map.message_ordinal = source.message_ordinal
             WHERE source.session_id = ? AND source.message_id = ?`);
    countIndexedMessageStatements.set(db, stmt);
  }
  return stmt;
}
function getMessageSourceStatement(db) {
  let stmt = getMessageSourceStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT message_ordinal, source_version, normalized_content_hash, role FROM message_history_source WHERE session_id = ? AND message_id = ?");
    getMessageSourceStatements.set(db, stmt);
  }
  return stmt;
}
function getUpsertMessageSourceStatement(db) {
  let stmt = upsertMessageSourceStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`INSERT INTO message_history_source (
                 session_id, message_id, message_ordinal, source_version,
                 normalized_content_hash, role, harness, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_id, message_id) DO UPDATE SET
                 message_ordinal = excluded.message_ordinal,
                 source_version = excluded.source_version,
                 normalized_content_hash = excluded.normalized_content_hash,
                 role = excluded.role,
                 harness = excluded.harness,
                 updated_at = excluded.updated_at`);
    upsertMessageSourceStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteMessageSourceRangeStatement(db) {
  let stmt = deleteMessageSourceRangeStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM message_history_source WHERE session_id = ? AND message_ordinal BETWEEN ? AND ?");
    deleteMessageSourceRangeStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteMessageFtsStatement(db) {
  let stmt = deleteMessageFtsStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`DELETE FROM message_history_fts
             WHERE rowid IN (
                 SELECT map.fts_rowid
                 FROM message_history_source AS source
                 JOIN message_fts_rowid_map AS map
                   ON map.session_id = source.session_id
                  AND map.message_ordinal = source.message_ordinal
                 WHERE source.session_id = ? AND source.message_id = ?
             )`);
    deleteMessageFtsStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteFtsMapRangeStatement(db) {
  let stmt = deleteFtsMapRangeStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM message_fts_rowid_map WHERE session_id = ? AND message_ordinal BETWEEN ? AND ?");
    deleteFtsMapRangeStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteMessageFtsMapStatement(db) {
  let stmt = deleteMessageFtsMapStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`DELETE FROM message_fts_rowid_map
             WHERE session_id = ?
               AND message_ordinal = (
                   SELECT message_ordinal
                   FROM message_history_source
                   WHERE session_id = ? AND message_id = ?
               )`);
    deleteMessageFtsMapStatements.set(db, stmt);
  }
  return stmt;
}
function insertMessageFtsRow(db, sessionId, messageOrdinal, messageId, role, content, messageTimeMs) {
  const result = getInsertMessageStatement(db).run(sessionId, messageOrdinal, messageId, role, content);
  recordMessageFtsRowid(db, sessionId, messageOrdinal, result.lastInsertRowid, messageTimeMs ?? null);
}
function normalizeSourceVersion(version) {
  if (typeof version === "number")
    return `number:${version}`;
  if (typeof version === "string")
    return `string:${version}`;
  return "null";
}
function toMessageIndexSource(message) {
  const content = getIndexableContent(message.role, message.parts);
  return {
    id: message.id,
    ordinal: message.ordinal,
    role: message.role,
    createdAt: message.createdAt,
    sourceVersion: normalizeSourceVersion(message.version),
    contentHash: createHash("sha256").update(content).digest("hex"),
    content
  };
}
function getMessageSourceSnapshot(message) {
  return toMessageIndexSource(message);
}
function getMessageIndexSourceIdentity(message) {
  const source = getMessageSourceSnapshot(message);
  return JSON.stringify([
    source.ordinal,
    source.sourceVersion,
    source.contentHash,
    source.role,
    message.createdAt ?? null
  ]);
}
function isMessageIndexSourceCurrent(db, sessionId, message) {
  const source = getMessageSourceSnapshot(message);
  return isIndexSourceCurrent(db, sessionId, source);
}
function isIndexSourceCurrent(db, sessionId, source) {
  const row = getMessageSourceStatement(db).get(sessionId, source.id);
  return row?.message_ordinal === source.ordinal && row.source_version === source.sourceVersion && row.normalized_content_hash === source.contentHash && row.role === source.role;
}
function writeMessageSource(db, sessionId, source, now) {
  getUpsertMessageSourceStatement(db).run(sessionId, source.id, source.ordinal, source.sourceVersion, source.contentHash, source.role, getHarness2(), now);
  const bytes = Buffer.byteLength(source.content);
  if (source.ftsSkippedBytes !== undefined || bytes > MESSAGE_INDEX_MAX_FTS_BYTES) {
    skipStatement(db, "INSERT INTO schema_migrations_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(messageIndexSkipKey(sessionId, source.id), JSON.stringify({
      reason: "oversized",
      bytes: source.ftsSkippedBytes ?? bytes,
      contentHash: source.contentHash,
      ordinal: source.ordinal,
      complete: true
    }));
    return "";
  }
  skipStatement(db, "DELETE FROM schema_migrations_meta WHERE key=?").run(messageIndexSkipKey(sessionId, source.id));
  return source.content;
}
function getLastIndexedOrdinal(db, sessionId) {
  const row = getLastIndexedStatement(db).get(sessionId);
  return typeof row?.last_indexed_ordinal === "number" ? row.last_indexed_ordinal : 0;
}
function getIndexedMessageCorpusSize(db, sessionId, maxOrdinal) {
  const watermark = getLastIndexedOrdinal(db, sessionId);
  return maxOrdinal === null ? watermark : Math.min(watermark, Math.max(0, maxOrdinal));
}
function getDirtyIndexFloor(db, sessionId) {
  const row = getLastIndexedStatement(db).get(sessionId);
  return typeof row?.dirty_floor_ordinal === "number" && row.dirty_floor_ordinal > 0 ? row.dirty_floor_ordinal : null;
}
function markMessageIndexDirty(db, sessionId, floorOrdinal) {
  const dirtyFloor = Math.max(1, Math.floor(floorOrdinal));
  getUpsertDirtyFloorStatement(db).run(sessionId, getLastIndexedOrdinal(db, sessionId), dirtyFloor, Date.now(), getHarness2());
}
function isMessageAlreadyIndexed(db, sessionId, messageId) {
  const row = getCountIndexedMessageStatement(db).get(sessionId, messageId);
  return (typeof row?.count === "number" ? row.count : 0) > 0;
}
function setIndexProgress(db, sessionId, watermark, dirtyFloor, now) {
  getUpsertProgressStatement(db).run(sessionId, Math.max(0, Math.floor(watermark)), dirtyFloor ?? 0, now, getHarness2());
}
function getMessageIndexReconciliationStartOrdinal(db, sessionId) {
  const watermark = getLastIndexedOrdinal(db, sessionId);
  const dirtyFloor = getDirtyIndexFloor(db, sessionId);
  return dirtyFloor === null ? watermark : Math.min(watermark, dirtyFloor - 1);
}
function isMessageIndexReconciledThrough(db, sessionId, finalWatermark) {
  const dirtyFloor = getDirtyIndexFloor(db, sessionId);
  return getLastIndexedOrdinal(db, sessionId) >= finalWatermark && dirtyFloor === null;
}
function getIndexableContent(role, parts) {
  if (role === "user") {
    if (!hasMeaningfulUserText2(parts)) {
      return "";
    }
    return extractTexts2(parts).map(cleanUserText2).map(normalizeIndexText).filter((text) => text.length > 0).join(" / ");
  }
  if (role === "assistant") {
    return extractTexts2(parts).map(removeSystemReminders).map(normalizeIndexText).filter((text) => text.length > 0).join(" / ");
  }
  return "";
}
function indexSingleMessageInTransaction(db, sessionId, message, now, dirtyFloorBeforeAttempt, source) {
  const currentWatermark = getLastIndexedOrdinal(db, sessionId);
  const dirtyFloor = getDirtyIndexFloor(db, sessionId);
  if (message.ordinal <= currentWatermark) {
    if (isIndexSourceCurrent(db, sessionId, source)) {
      recordIndexedMessageTime(db, sessionId, message.ordinal, message.createdAt);
      return false;
    }
    if (!messageFtsOrdinalRangeIsMapped(db, sessionId, message.ordinal, message.ordinal)) {
      return false;
    }
    getDeleteMessageFtsStatement(db).run(sessionId, message.id);
    getDeleteMessageFtsMapStatement(db).run(sessionId, sessionId, message.id);
    const content = writeMessageSource(db, sessionId, source, now);
    if (content.length > 0 && (message.role === "user" || message.role === "assistant")) {
      insertMessageFtsRow(db, sessionId, message.ordinal, message.id, message.role, content, message.createdAt);
    }
    setIndexProgress(db, sessionId, currentWatermark, dirtyFloorBeforeAttempt === message.ordinal ? null : dirtyFloorBeforeAttempt, now);
    return true;
  }
  if (message.ordinal !== currentWatermark + 1 || dirtyFloor !== null && dirtyFloor !== message.ordinal) {
    return false;
  }
  const content = writeMessageSource(db, sessionId, source, now);
  let inserted = false;
  if (content.length > 0 && (message.role === "user" || message.role === "assistant") && !isMessageAlreadyIndexed(db, sessionId, message.id)) {
    insertMessageFtsRow(db, sessionId, message.ordinal, message.id, message.role, content, message.createdAt);
    inserted = true;
  }
  setIndexProgress(db, sessionId, message.ordinal, dirtyFloorBeforeAttempt === message.ordinal ? null : dirtyFloorBeforeAttempt, now);
  return inserted;
}
function indexSingleMessage(db, sessionId, message, shouldCommit = () => true, preparedSource) {
  if (!shouldCommit())
    return false;
  const source = preparedSource ?? getMessageSourceSnapshot(message);
  const currentWatermark = getLastIndexedOrdinal(db, sessionId);
  if (message.ordinal <= currentWatermark && isIndexSourceCurrent(db, sessionId, source)) {
    recordIndexedMessageTime(db, sessionId, message.ordinal, message.createdAt);
    return false;
  }
  const dirtyFloorBeforeAttempt = getDirtyIndexFloor(db, sessionId);
  markMessageIndexDirty(db, sessionId, Math.min(message.ordinal, currentWatermark + 1));
  db.exec("BEGIN IMMEDIATE");
  const transactionStartedAt = performance.now();
  let committed = false;
  try {
    const result = indexSingleMessageInTransaction(db, sessionId, message, Date.now(), dirtyFloorBeforeAttempt, source);
    if (!shouldCommit())
      return false;
    db.exec("COMMIT");
    committed = true;
    logSlowWriteTransaction("message_index_incremental", transactionStartedAt);
    return result;
  } finally {
    if (!committed) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
  }
}
function indexMessagesAfterOrdinal(db, sessionId, messages, _lastIndexedOrdinal, finalWatermark = messages.length) {
  return indexItemsAfterOrdinal(db, sessionId, messages, finalWatermark, toMessageIndexSource);
}
function indexItemsAfterOrdinal(db, sessionId, items, finalWatermark, toSource) {
  const now = Date.now();
  let inserted = 0;
  const sources = new Map(items.map((item) => [item.ordinal, toSource(item)]));
  db.exec("BEGIN IMMEDIATE");
  const transactionStartedAt = performance.now();
  let committed = false;
  try {
    const currentWatermark = getLastIndexedOrdinal(db, sessionId);
    const dirtyFloor = getDirtyIndexFloor(db, sessionId);
    const effectiveWatermark = dirtyFloor === null ? currentWatermark : Math.min(currentWatermark, Math.max(0, dirtyFloor - 1));
    if (dirtyFloor !== null && dirtyFloor <= currentWatermark && !messageFtsOrdinalRangeIsMapped(db, sessionId, dirtyFloor, Math.min(currentWatermark, finalWatermark))) {
      db.exec("COMMIT");
      committed = true;
      logSlowWriteTransaction("message_index_reconcile", transactionStartedAt);
      return 0;
    }
    if (dirtyFloor !== null && dirtyFloor <= finalWatermark) {
      getDeleteFtsRangeStatement(db).run(sessionId, dirtyFloor, finalWatermark);
      getDeleteFtsMapRangeStatement(db).run(sessionId, dirtyFloor, finalWatermark);
      getDeleteMessageSourceRangeStatement(db).run(sessionId, dirtyFloor, finalWatermark);
    }
    const itemsByOrdinal = new Map;
    for (const item of items) {
      if (item.ordinal > effectiveWatermark && item.ordinal <= finalWatermark) {
        itemsByOrdinal.set(item.ordinal, item);
      }
    }
    let coveredWatermark = effectiveWatermark;
    while (coveredWatermark < finalWatermark && itemsByOrdinal.has(coveredWatermark + 1)) {
      coveredWatermark += 1;
    }
    for (let ordinal = effectiveWatermark + 1;ordinal <= coveredWatermark; ordinal++) {
      const item = itemsByOrdinal.get(ordinal);
      if (!item)
        continue;
      const message = sources.get(ordinal);
      if (!message)
        continue;
      const content = writeMessageSource(db, sessionId, message, now);
      if (content.length === 0 || message.role !== "user" && message.role !== "assistant" || isMessageAlreadyIndexed(db, sessionId, message.id)) {
        continue;
      }
      insertMessageFtsRow(db, sessionId, message.ordinal, message.id, message.role, content, message.createdAt);
      inserted += 1;
    }
    const missingFloor = coveredWatermark < finalWatermark ? coveredWatermark + 1 : null;
    const preservedFloor = dirtyFloor !== null && dirtyFloor > finalWatermark ? dirtyFloor : null;
    const nextDirtyFloor = missingFloor === null ? preservedFloor : preservedFloor === null ? missingFloor : Math.min(missingFloor, preservedFloor);
    setIndexProgress(db, sessionId, coveredWatermark, nextDirtyFloor, now);
    db.exec("COMMIT");
    committed = true;
    logSlowWriteTransaction("message_index_reconcile", transactionStartedAt);
  } finally {
    if (!committed) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
  }
  return inserted;
}
function harnessSupportsOpenCodeOrphanSweep(harness) {
  return harness === "opencode";
}
function getMessageHistoryOrphanSweepState(db, harness) {
  return db.prepare("SELECT cursor_session_id, last_swept_at FROM message_history_orphan_sweep WHERE harness = ?").get(harness) ?? {};
}
function persistMessageHistoryOrphanSweepState(db, cursor, lastSweptAt, harness) {
  db.prepare(`INSERT INTO message_history_orphan_sweep (harness, cursor_session_id, last_swept_at)
          VALUES (?, ?, ?)
         ON CONFLICT(harness) DO UPDATE SET
             cursor_session_id = excluded.cursor_session_id,
             last_swept_at = excluded.last_swept_at`).run(harness, cursor, lastSweptAt);
}
function getOpenCodeSessionScopedCandidateSourceSql(harness) {
  return SESSION_SCOPED_TABLES.filter((definition) => definition.harnessScoped === true).map((definition) => {
    const predicates = ["session_id IS NOT NULL", `harness = '${harness}'`];
    if (definition.extraPredicate)
      predicates.push(definition.extraPredicate);
    return `SELECT session_id FROM ${definition.table} WHERE ${predicates.join(" AND ")}`;
  }).join(`
UNION
`);
}
function sweepOrphanedOpenCodeMessageIndexesInBackground(db, openReadableOpenCodeDb, options = {}) {
  const now = options.now ?? Date.now();
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? MESSAGE_HISTORY_ORPHAN_SWEEP_BATCH_SIZE));
  const safetyAgeMs = Math.max(0, options.safetyAgeMs ?? MESSAGE_HISTORY_ORPHAN_SAFETY_AGE_MS);
  const cooldownMs = Math.max(0, options.cooldownMs ?? MESSAGE_HISTORY_ORPHAN_SWEEP_COOLDOWN_MS);
  const unavailableReprobeMs = Math.max(cooldownMs, options.unavailableReprobeMs ?? MESSAGE_HISTORY_ORPHAN_UNAVAILABLE_REPROBE_MS);
  const harness = getHarness2();
  const state = getMessageHistoryOrphanSweepState(db, harness);
  const cursor = typeof state.cursor_session_id === "string" ? state.cursor_session_id : "";
  if (typeof state.last_swept_at === "number" && state.last_swept_at + cooldownMs > now) {
    return { status: "cooldown", scanned: 0, deleted: 0, cursor };
  }
  if (!harnessSupportsOpenCodeOrphanSweep(harness)) {
    persistMessageHistoryOrphanSweepState(db, cursor, now + unavailableReprobeMs - cooldownMs, harness);
    if (harness === "opencode2") {
      return {
        status: "unavailable",
        scanned: 0,
        deleted: 0,
        cursor,
        reason: "OpenCode 2 keeps its sessions in session_v2, which this sweep does not read"
      };
    }
    return { status: "unavailable", scanned: 0, deleted: 0, cursor };
  }
  let openCodeDb = null;
  try {
    openCodeDb = openReadableOpenCodeDb();
  } catch {
    openCodeDb = null;
  }
  if (!openCodeDb) {
    persistMessageHistoryOrphanSweepState(db, cursor, now + unavailableReprobeMs - cooldownMs, harness);
    return { status: "source_unavailable", scanned: 0, deleted: 0, cursor };
  }
  try {
    const cutoff = now - safetyAgeMs;
    const candidateSourceSql = getOpenCodeSessionScopedCandidateSourceSql(harness);
    const candidates = db.prepare(`SELECT session_id
                 FROM (${candidateSourceSql}) AS session_candidates
                 WHERE session_id > ?
                   AND NOT EXISTS (
                       SELECT 1
                       FROM message_history_index
                       WHERE message_history_index.session_id = session_candidates.session_id
                          AND message_history_index.harness = '${harness}'
                         AND message_history_index.updated_at > ?
                   )
                 ORDER BY session_id ASC
                 LIMIT ?`).all(cursor, cutoff, batchSize);
    const sessionExists = openCodeDb.prepare("SELECT 1 FROM session WHERE id = ? LIMIT 1");
    const missingSessionIds = candidates.filter((candidate) => !sessionExists.get(candidate.session_id)).map((candidate) => candidate.session_id);
    const nextCursor = candidates.length < batchSize ? "" : candidates[candidates.length - 1]?.session_id ?? cursor;
    const completedAt = candidates.length < batchSize ? now : null;
    db.exec("BEGIN IMMEDIATE");
    const transactionStartedAt = performance.now();
    let committed = false;
    let deleted = 0;
    try {
      const stillEligible = db.prepare(`SELECT 1
                 FROM (${candidateSourceSql}) AS session_candidates
                 WHERE session_id = ?
                   AND NOT EXISTS (
                       SELECT 1
                       FROM message_history_index
                       WHERE message_history_index.session_id = session_candidates.session_id
                          AND message_history_index.harness = '${harness}'
                         AND message_history_index.updated_at > ?
                   )
                 LIMIT 1`);
      const eligibleSessionIds = missingSessionIds.filter((sessionId) => stillEligible.get(sessionId, cutoff));
      deleted = deleteSessionScopedRows(db, eligibleSessionIds, harness);
      persistMessageHistoryOrphanSweepState(db, nextCursor, completedAt, harness);
      db.exec("COMMIT");
      committed = true;
      logSlowWriteTransaction("message_index_orphan_sweep", transactionStartedAt);
    } finally {
      if (!committed) {
        try {
          db.exec("ROLLBACK");
        } catch {}
      }
    }
    return {
      status: "swept",
      scanned: candidates.length,
      deleted,
      cursor: nextCursor
    };
  } finally {
    closeQuietly(openCodeDb);
  }
}
function sweepOrphanedOpenCodeMessageIndexes(db, openReadableOpenCodeDb, options = {}) {
  return withoutSqliteTransformPass2(() => withSqliteBackgroundWriter2(() => sweepOrphanedOpenCodeMessageIndexesInBackground(db, openReadableOpenCodeDb, options)));
}

export { readSessionActivity, observeSessionActivity, backfillSessionActivity, deleteSessionScopedRows, clearCompressionDepth, clearCompressionDepthRange, MESSAGE_INDEX_MAX_FTS_BYTES, messageIndexSkipKey, getMessageIndexSourceIdentity, isMessageIndexSourceCurrent, getLastIndexedOrdinal, getIndexedMessageCorpusSize, markMessageIndexDirty, getMessageIndexReconciliationStartOrdinal, isMessageIndexReconciledThrough, getIndexableContent, indexSingleMessage, indexMessagesAfterOrdinal, sweepOrphanedOpenCodeMessageIndexes };
