import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  removeSystemReminders,
  removeNestedBlocks,
  hasMeaningfulUserText2,
  extractTexts2
} from "./index-pefn1gt5.js";
import {
  cleanUserText2
} from "./index-5vqnvjb2.js";
import {
  recordMessageFtsRowid2,
  recordIndexedMessageTime2,
  messageFtsOrdinalRangeIsMapped2,
  deleteUnmappedMessageFtsRows2
} from "./index-ghp32f9m.js";
import {
  logSlowWriteTransaction
} from "./index-1ts77n1b.js";

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

// ../plugin/src/features/magic-context/message-index.ts
import { createHash } from "node:crypto";

// ../plugin/src/shared/search-text.ts
function removeTaskNotifications(text) {
  return removeNestedBlocks(text, ["task", "task_cohort"]);
}
function cleanSearchText(text) {
  return removeNestedBlocks(text, ["system-reminder", "task", "task_cohort"]).replace(/\s+/g, " ").trim();
}
var QUERY_STOP_WORDS = new Set("a an and are as at be been by can could did do does for from how i in is it me my of on or our please should that the their them there these they this to us was we were what when where which who why will with would you your".split(" "));
function terms(text) {
  return [
    ...new Set((text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((term) => !QUERY_STOP_WORDS.has(term)))
  ];
}
function keywordRelevance(query, content) {
  const needles = terms(query);
  if (needles.length === 0)
    return 0;
  const words = new Set(terms(cleanSearchText(content)));
  return 0.8 * needles.filter((term) => words.has(term)).length / needles.length;
}
var CJK_RUN = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u;
var CJK_RUN_SPLIT = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+)/u;
function hintTerms(text) {
  return [
    ...new Set(terms(text).flatMap((term) => term.split(CJK_RUN_SPLIT)).filter((term) => term.length > 0 && !QUERY_STOP_WORDS.has(term)))
  ];
}
function characterBigrams(run) {
  const characters = [...run];
  return characters.length === 1 ? characters : characters.slice(1).map((character, index) => characters[index] + character);
}
function hintKeywordRelevance(query, content) {
  const needles = hintTerms(query);
  if (needles.length === 0)
    return 0;
  const words = new Set(hintTerms(cleanSearchText(content)));
  const runs = [...words].filter((word) => CJK_RUN.test(word));
  const bigrams = new Set(runs.flatMap(characterBigrams));
  let matched = 0;
  for (const needle of needles) {
    if (!CJK_RUN.test(needle)) {
      matched += Number(words.has(needle));
      continue;
    }
    const grams = characterBigrams(needle);
    if ([...needle].length === 1) {
      matched += Number(runs.some((run) => run.includes(needle)));
      continue;
    }
    matched += Math.min(1, grams.filter((gram) => bigrams.has(gram)).length / Math.ceil(grams.length / 2));
  }
  return 0.8 * matched / needles.length;
}
function matchedSearchSnippet(content, query, cap = 220) {
  const text = cleanSearchText(content);
  const needles = new Set(terms(query));
  const matches = [...text.matchAll(/[\p{L}\p{N}_]+/gu)].filter((match) => needles.has(match[0].toLowerCase()));
  if (matches.length === 0)
    return "";
  let bestStart = matches[0].index;
  let bestCoverage = -1;
  for (const match of matches) {
    const start = Math.max(0, match.index - Math.floor(cap / 5));
    const coverage = keywordRelevance(query, text.slice(start, start + cap));
    if (coverage > bestCoverage) {
      bestStart = start;
      bestCoverage = coverage;
    }
  }
  if (bestStart > 0) {
    const boundary = text.indexOf(" ", bestStart);
    if (boundary >= 0 && boundary < matches[matches.length - 1].index)
      bestStart = boundary + 1;
  }
  const passage = text.slice(bestStart, bestStart + cap).trim();
  return `${bestStart > 0 ? "…" : ""}${passage}${bestStart + cap < text.length ? "…" : ""}`;
}

// ../plugin/src/features/magic-context/message-index.ts
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
function deleteMessageIndexSkips(db, sessionId, messageId) {
  if (messageId !== undefined) {
    skipStatement(db, "DELETE FROM schema_migrations_meta WHERE key=?").run(messageIndexSkipKey(sessionId, messageId));
  } else {
    const prefix = `message_index_skip:${JSON.stringify([sessionId]).slice(0, -1)},`;
    skipStatement(db, "DELETE FROM schema_migrations_meta WHERE substr(key,1,length(?))=?").run(prefix, prefix);
  }
}
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
function getDeleteFtsStatement(db) {
  let stmt = deleteFtsStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`DELETE FROM message_history_fts
             WHERE rowid IN (
                 SELECT fts_rowid FROM message_fts_rowid_map WHERE session_id = ?
             )`);
    deleteFtsStatements.set(db, stmt);
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
function getDeleteIndexStatement(db) {
  let stmt = deleteIndexStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM message_history_index WHERE session_id = ?");
    deleteIndexStatements.set(db, stmt);
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
function getDeleteMessageSourceStatement(db) {
  let stmt = deleteMessageSourceStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM message_history_source WHERE session_id = ?");
    deleteMessageSourceStatements.set(db, stmt);
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
function getDeleteFtsMapStatement(db) {
  let stmt = deleteFtsMapStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM message_fts_rowid_map WHERE session_id = ?");
    deleteFtsMapStatements.set(db, stmt);
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
  recordMessageFtsRowid2(db, sessionId, messageOrdinal, result.lastInsertRowid, messageTimeMs ?? null);
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
function clearIndexedMessagesInTransaction(db, sessionId) {
  deleteMessageIndexSkips(db, sessionId);
  getDeleteFtsStatement(db).run(sessionId);
  deleteUnmappedMessageFtsRows2(db, [sessionId]);
  getDeleteFtsMapStatement(db).run(sessionId);
  getDeleteMessageSourceStatement(db).run(sessionId);
  getDeleteIndexStatement(db).run(sessionId);
  clearCompressionDepth(db, sessionId);
}
function clearIndexedMessages(db, sessionId) {
  let transactionStartedAt = 0;
  db.transaction(() => {
    transactionStartedAt = performance.now();
    clearIndexedMessagesInTransaction(db, sessionId);
  }).immediate();
  logSlowWriteTransaction("message_index_clear", transactionStartedAt);
}
function getIndexableContent(role, parts) {
  if (role === "user") {
    if (!hasMeaningfulUserText2(parts)) {
      return "";
    }
    return extractTexts2(parts).map(removeTaskNotifications).map(cleanUserText2).map(normalizeIndexText).filter((text) => text.length > 0).join(" / ");
  }
  if (role === "assistant") {
    return extractTexts2(parts).map(removeTaskNotifications).map(removeSystemReminders).map(normalizeIndexText).filter((text) => text.length > 0).join(" / ");
  }
  return "";
}
function indexSingleMessageInTransaction(db, sessionId, message, now, dirtyFloorBeforeAttempt, source) {
  const currentWatermark = getLastIndexedOrdinal(db, sessionId);
  const dirtyFloor = getDirtyIndexFloor(db, sessionId);
  if (message.ordinal <= currentWatermark) {
    if (isIndexSourceCurrent(db, sessionId, source)) {
      recordIndexedMessageTime2(db, sessionId, message.ordinal, message.createdAt);
      return false;
    }
    if (!messageFtsOrdinalRangeIsMapped2(db, sessionId, message.ordinal, message.ordinal)) {
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
    recordIndexedMessageTime2(db, sessionId, message.ordinal, message.createdAt);
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
    if (dirtyFloor !== null && dirtyFloor <= currentWatermark && !messageFtsOrdinalRangeIsMapped2(db, sessionId, dirtyFloor, Math.min(currentWatermark, finalWatermark))) {
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

export { clearCompressionDepth, clearCompressionDepthRange, cleanSearchText, hintKeywordRelevance, matchedSearchSnippet, MESSAGE_INDEX_MAX_FTS_BYTES, messageIndexSkipKey, getMessageIndexSourceIdentity, isMessageIndexSourceCurrent, getLastIndexedOrdinal, getIndexedMessageCorpusSize, markMessageIndexDirty, getMessageIndexReconciliationStartOrdinal, isMessageIndexReconciledThrough, clearIndexedMessages, getIndexableContent, indexSingleMessage, indexMessagesAfterOrdinal };
