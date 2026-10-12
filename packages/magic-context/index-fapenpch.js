// ../plugin/src/shared/sqlite-context-pragmas.ts
function configureContextDatabasePragmas2(db, readonly = false) {
  const [row] = db.prepare(readonly ? "PRAGMA journal_mode" : "PRAGMA journal_mode=WAL").all();
  const mode = row?.journal_mode?.toLowerCase();
  if (mode === "memory" || readonly && mode !== "wal")
    return;
  if (mode !== "wal") {
    throw new Error(`context.db requires WAL before synchronous=NORMAL (got ${mode ?? "unknown"})`);
  }
  db.exec("PRAGMA synchronous=NORMAL");
}

export { configureContextDatabasePragmas2 };
