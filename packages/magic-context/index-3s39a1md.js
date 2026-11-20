import {
  registerExitAbort
} from "./index-8sqebjzk.js";
import {
  log2
} from "./index-tm11k42a.js";
import {
  inRootAsyncContext2,
  getSqliteDatabasePath2
} from "./index-2qtx0q6h.js";
import {
  reuseWorker
} from "./index-wfqysrwq.js";
import {
  createWorkerShutdown
} from "./index-x2n261wp.js";

// ../plugin/src/features/magic-context/compaction-marker-candidates.ts
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
var candidates = new WeakMap;
var pending = new WeakMap;
var workers = new Set;
var missingWorkerWarnings = new Set;
var ownWriteRevisions = new Map;
var exitRegistered = false;
function reportWorkerUnavailable(entry, detail) {
  const key = `${entry.href}\x00${detail}`;
  if (missingWorkerWarnings.has(key))
    return;
  missingWorkerWarnings.add(key);
  const path = entry.protocol === "file:" ? fileURLToPath(entry) : entry.href;
  log2(`[magic-context] [ERROR] compaction-marker: candidate worker unavailable ${path}: ${detail}; marker unchanged, advancement deferred`);
}
var MARKER_CERTIFICATION_SQL = `SELECT
    (SELECT rowid FROM message WHERE id = ?) AS previousRowid,
    (SELECT rowid FROM message ORDER BY rowid DESC LIMIT 1) AS newestRowid,
    (SELECT id FROM message ORDER BY rowid DESC LIMIT 1) AS newestId,
    EXISTS(SELECT 1 FROM message
      WHERE rowid > ? AND +session_id = ? AND json_valid(data)
        AND COALESCE(json_extract(data, '$.summary'), 0) = 1) AS newSummary`;
function isMarkerCandidateBasisCurrent2(db, basis) {
  if (basis.connection !== db || ownWriteRevisions.get(basis.revisionKey) !== basis.ownWriteRevision)
    return false;
  try {
    const current = db.prepare(MARKER_CERTIFICATION_SQL).all(basis.frontier?.id ?? null, basis.frontier?.rowid ?? 0, basis.sessionId)[0];
    if (current.newSummary || basis.frontier && (current.previousRowid !== basis.frontier.rowid || current.newestRowid === null || current.newestRowid < basis.frontier.rowid))
      return false;
    if (current.newestRowid !== null && (!Number.isSafeInteger(current.newestRowid) || current.newestId === null))
      return false;
    basis.frontier = current.newestRowid === null || current.newestId === null ? null : { rowid: current.newestRowid, id: current.newestId };
    return true;
  } catch {
    return false;
  }
}
function invalidateMarkerCandidateBasis2(db, sessionId) {
  candidates.get(db)?.delete(sessionId);
  const path = getSqliteDatabasePath2(db);
  if (!path)
    return;
  const key = `${realpathSync(path)}\x00${sessionId}`;
  const revision = ownWriteRevisions.get(key);
  if (revision !== undefined)
    ownWriteRevisions.set(key, revision + 1);
}
function discardMarkerCandidateBasis2(db, sessionId) {
  candidates.get(db)?.delete(sessionId);
}
function readMarkerCandidateBasis2(db, sessionId, readConnection = db) {
  const basis = candidates.get(db)?.get(sessionId);
  if (basis) {
    const snapshot = readConnection === db ? basis : { ...basis, connection: readConnection };
    if (isMarkerCandidateBasisCurrent2(readConnection, snapshot)) {
      basis.frontier = snapshot.frontier;
      return readConnection === db ? basis : { ...snapshot, connection: db };
    }
  }
  candidates.get(db)?.delete(sessionId);
  return;
}
function prepareMarkerCandidateBasis2(db, sessionId, options = {}) {
  if (readMarkerCandidateBasis2(db, sessionId))
    return Promise.resolve(true);
  const path = getSqliteDatabasePath2(db);
  if (!path || db.inTransaction)
    return Promise.resolve(false);
  const active = pending.get(db) ?? new Map;
  const existing = active.get(sessionId);
  if (existing)
    return existing;
  const revisionKey = `${realpathSync(path)}\x00${sessionId}`;
  const ownWriteRevision = ownWriteRevisions.get(revisionKey) ?? 0;
  ownWriteRevisions.set(revisionKey, ownWriteRevision);
  const entry = options.entry ?? markerWorkerEntry();
  if (entry.protocol === "file:" && !existsSync(fileURLToPath(entry))) {
    reportWorkerUnavailable(entry, "file missing");
    return Promise.resolve(false);
  }
  const preparation = runCandidateWorker(path, sessionId, options.references !== false, options).then((snapshot) => {
    if (!snapshot)
      return false;
    const basis = {
      ...snapshot,
      connection: db,
      sessionId,
      revisionKey,
      ownWriteRevision
    };
    if (!isMarkerCandidateBasisCurrent2(db, basis)) {
      candidates.get(db)?.delete(sessionId);
      log2(`[magic-context] compaction-marker: deferred candidate preparation for ${sessionId}: summary set or frontier changed during discovery; marker unchanged`);
      return false;
    }
    const sessions = candidates.get(db) ?? new Map;
    sessions.set(sessionId, basis);
    candidates.set(db, sessions);
    return true;
  }).finally(() => {
    if (active.get(sessionId) === preparation)
      active.delete(sessionId);
  });
  active.set(sessionId, preparation);
  pending.set(db, active);
  return preparation;
}
function markerWorkerEntry() {
  return new URL(new URL(import.meta.url).pathname.endsWith(".ts") ? "./compaction-marker-candidates-worker.ts" : "./compaction-marker-candidates-worker.js", import.meta.url);
}
function runCandidateWorker(path, sessionId, references, options) {
  if (!exitRegistered) {
    exitRegistered = true;
    const controller = new AbortController;
    controller.signal.addEventListener("abort", () => {
      for (const worker of workers) {
        worker.terminate();
        worker.unref();
      }
    }, { once: true });
    registerExitAbort(controller);
  }
  return new Promise((resolve) => {
    const entry = options.entry ?? markerWorkerEntry();
    let worker;
    let timer;
    let done = false;
    const finish = (snapshot) => {
      if (done)
        return;
      done = true;
      clearTimeout(timer);
      if (!worker) {
        resolve(snapshot);
        return;
      }
      workers.delete(worker);
      const stopped = snapshot ? createWorkerShutdown(worker, "marker-candidates", 1000).close() : worker.terminate();
      worker.unref();
      stopped.then(() => resolve(snapshot), () => resolve(snapshot));
    };
    const deadline = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        reportWorkerUnavailable(entry, "worker deadline exceeded");
        finish();
      }, ms);
      timer.unref?.();
    };
    try {
      const pooled = !options.entry || options.shareWorker === true;
      worker = inRootAsyncContext2(() => pooled ? reuseWorker(entry, { workerData: { path, sessionId, references } }) : new Worker(entry, { workerData: { path, sessionId, references } }));
      workers.add(worker);
      worker.unref();
      if (pooled)
        worker.once("online", () => deadline(options.acceptMs ?? 2000));
      else
        deadline(options.acceptMs ?? 2000);
      worker.on("message", (reply) => {
        if (reply.kind === "accepted")
          deadline(options.resultMs ?? 600000);
        else if (reply.kind === "candidates")
          finish(reply.snapshot);
        else {
          reportWorkerUnavailable(entry, reply.error);
          finish();
        }
      });
      worker.on("error", (error) => {
        reportWorkerUnavailable(entry, error.message);
        finish();
      });
      worker.on("exit", (code) => {
        if (!done)
          reportWorkerUnavailable(entry, `worker exited before replying (${code})`);
        finish();
      });
    } catch (error) {
      reportWorkerUnavailable(entry, error instanceof Error ? error.message : String(error));
      finish();
    }
  });
}
function scanMarkerSummaryCandidates(db, sessionId) {
  const ownsSnapshot = !db.inTransaction;
  if (ownsSnapshot)
    db.exec("BEGIN");
  try {
    return db.prepare(`SELECT id FROM message WHERE session_id=? AND
            CASE WHEN json_valid(data) THEN COALESCE(json_extract(data,'$.summary'),0) ELSE 0 END=1`).all(sessionId).map((row) => row.id);
  } finally {
    if (ownsSnapshot)
      db.exec("ROLLBACK");
  }
}
function scanMarkerCandidateSnapshot2(db, sessionId, references = true) {
  const ownsSnapshot = !db.inTransaction;
  if (ownsSnapshot)
    db.exec("BEGIN");
  try {
    const ids = scanMarkerSummaryCandidates(db, sessionId);
    const frontier = readMarkerFrontier(db, "message");
    if (!references)
      return { ids, frontier };
    return {
      ids,
      frontier,
      references: {
        partIds: readMarkerReferenceRows2(db, sessionId, "part").map((row) => row.id),
        partFrontiers: readMarkerFrontiers2(db, "part")
      }
    };
  } finally {
    if (ownsSnapshot)
      db.exec("ROLLBACK");
  }
}
function readMarkerFrontier(db, table) {
  const frontier = db.prepare(`SELECT rowid,id FROM ${table} ORDER BY rowid DESC LIMIT 1`).all()[0] ?? null;
  if (frontier && !Number.isSafeInteger(frontier.rowid))
    throw new Error(`marker ${table} frontier rowid is not a safe integer`);
  return frontier;
}
var MARKER_FRONTIER_CANDIDATES = 3;
function readMarkerFrontiers2(db, table, count = MARKER_FRONTIER_CANDIDATES) {
  const frontiers = db.prepare(`SELECT rowid,id FROM ${table} ORDER BY rowid DESC LIMIT ?`).all(count);
  if (frontiers.some((frontier) => !Number.isSafeInteger(frontier.rowid)))
    throw new Error(`marker ${table} frontier rowid is not a safe integer`);
  return frontiers;
}
var MARKER_REFERENCE_FRONTIER_SQL = (table) => `SELECT rowid FROM ${table} WHERE id = ?`;
function certifiedMarkerReferenceFloor2(db, table, frontiers) {
  if (frontiers.length === 0)
    return 0;
  const probe = db.prepare(MARKER_REFERENCE_FRONTIER_SQL(table));
  for (const frontier of [...frontiers].sort((a, b) => b.rowid - a.rowid)) {
    const current = probe.all(frontier.id);
    if (current[0]?.rowid === frontier.rowid)
      return frontier.rowid;
  }
  return;
}
var MARKER_TAIL_REFERENCE_COLUMNS = `id,
    CASE WHEN data LIKE '%tail_start_id%' THEN json_extract(data, '$.tail_start_id') END AS direct,
    CASE WHEN data LIKE '%tail_start_id%' THEN json_extract(data, '$.compaction.tail_start_id') END AS nested`;
function readMarkerReferenceRows2(db, sessionId, table, afterRowid) {
  return db.prepare(`SELECT ${MARKER_TAIL_REFERENCE_COLUMNS} FROM ${table}
             WHERE ${afterRowid === undefined ? "session_id = ?" : "rowid > ? AND +session_id = ?"}
             AND ${table === "part" ? "data LIKE '%compaction%' AND json_valid(data) AND json_extract(data, '$.type') = 'compaction'" : "(data LIKE '%compaction%' OR data LIKE '%tail_start_id%') AND json_valid(data) AND (json_type(data, '$.compaction') IS NOT NULL OR json_type(data, '$.tail_start_id') IS NOT NULL)"}`).all(...afterRowid === undefined ? [sessionId] : [afterRowid, sessionId]);
}
function readKnownMarkerReferenceRows2(db, sessionId, table, ids) {
  const byId = db.prepare(`SELECT ${MARKER_TAIL_REFERENCE_COLUMNS} FROM ${table} WHERE id = ? AND session_id = ?`);
  return ids.flatMap((id) => byId.all(id, sessionId));
}

export { isMarkerCandidateBasisCurrent2, invalidateMarkerCandidateBasis2, discardMarkerCandidateBasis2, readMarkerCandidateBasis2, prepareMarkerCandidateBasis2, scanMarkerCandidateSnapshot2, readMarkerFrontiers2, certifiedMarkerReferenceFloor2, readMarkerReferenceRows2, readKnownMarkerReferenceRows2 };
