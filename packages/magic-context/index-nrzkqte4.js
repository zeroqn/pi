// ../plugin/src/shared/sqlite-helpers.ts
function closeQuietly(db) {
  if (!db)
    return;
  try {
    db.close();
  } catch {}
}
function isKnownAutocommit(db) {
  const state = db;
  try {
    return state.inTransaction === false || state.isTransaction === false;
  } catch {
    return false;
  }
}

export { closeQuietly, isKnownAutocommit };
