// ../plugin/src/features/magic-context/message-fts-session-filter.ts
var MESSAGE_FTS_SESSION_FILTER_SQL = `+message_history_fts.rowid IN (
    SELECT fts_rowid FROM message_fts_rowid_map WHERE session_id = ?1
) AND `;
var coverageCaches = new WeakMap;
var coverageScansOnThisThread = 0;
function getCoverageCache(db) {
  let cache = coverageCaches.get(db);
  if (!cache) {
    cache = {
      pin: db.prepare("SELECT fts_rowid FROM message_fts_rowid_map LIMIT 1"),
      stamp: db.prepare("SELECT total_changes() AS changes, data_version AS version FROM pragma_data_version"),
      missing: db.prepare(`SELECT DISTINCT session_id AS sessionId
                FROM message_history_fts WHERE rowid IN (
                    SELECT id FROM message_history_fts_docsize
                    EXCEPT SELECT fts_rowid FROM message_fts_rowid_map
                )`)
    };
    coverageCaches.set(db, cache);
  }
  return cache;
}
function withMessageFtsSessionFilter(db, sessionId, read) {
  let cacheable = false;
  try {
    const transaction = db;
    cacheable = transaction.inTransaction === false || transaction.isTransaction === false;
    if (!cacheable)
      coverageCaches.delete(db);
  } catch {
    coverageCaches.delete(db);
  }
  return db.transaction(() => {
    let sessionFirst = false;
    try {
      const cache = getCoverageCache(db);
      cache.pin.get();
      const stamp = cache.stamp.get();
      let incomplete = cache.incompleteSessions;
      if (!cacheable || !incomplete || cache.version !== stamp.version || cache.changes !== stamp.changes) {
        coverageScansOnThisThread += 1;
        const rows = cache.missing.all();
        incomplete = new Set(rows.map((row) => row.sessionId));
        if (cacheable) {
          cache.version = stamp.version;
          cache.changes = stamp.changes;
          cache.incompleteSessions = incomplete;
        }
      }
      sessionFirst = !incomplete.has(sessionId);
    } catch {
      coverageCaches.delete(db);
    }
    return read(sessionFirst);
  }).deferred();
}

export { MESSAGE_FTS_SESSION_FILTER_SQL, withMessageFtsSessionFilter };
