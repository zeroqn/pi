import {
  withSqliteBackgroundWriter2,
  withoutSqliteTransformPass2,
  isTransientSqliteError2
} from "./index-2qtx0q6h.js";

// ../plugin/src/hooks/magic-context/embed-session-state.ts
var embedPauseBySession = new Set;
var embedRunStateBySession = new Map;
var activeEmbeddingSessions = new Map;
var autoEmbedAttemptedBySession = new Set;
var autoEmbedIdentityBySession = new Map;
var autoEmbedRetryAfterBySession = new Map;
function invalidateAutoEmbedSession(sessionId) {
  autoEmbedAttemptedBySession.delete(sessionId);
  autoEmbedIdentityBySession.delete(sessionId);
  autoEmbedRetryAfterBySession.delete(sessionId);
}
function getEmbedDrainUiStatus(sessionId, progress) {
  if (embedPauseBySession.has(sessionId)) {
    return { status: "paused" };
  }
  const activeRun = embedRunStateBySession.get(sessionId);
  if (activeRun && !activeRun.signal.aborted || progress?.kind === "embed" && progress.phase === "recomp") {
    return { status: "running" };
  }
  if (progress?.kind === "embed" && (progress.phase === "failed" || progress.phase === "skipped") && progress.message) {
    if (/provider/i.test(progress.message)) {
      return { status: "stopped", detail: progress.message };
    }
  }
  return { status: "idle" };
}

// ../plugin/src/shared/background-batch-drain.ts
async function drainBackgroundBatches(step, options = {}) {
  const now = options.now ?? (() => performance.now());
  const deadline = now() + (options.budgetMs ?? 2000);
  const yieldFn = options.yieldFn ?? (() => new Promise((resolve) => setTimeout(resolve, 0)));
  let batches = 0;
  while (now() < deadline) {
    try {
      if (!withoutSqliteTransformPass2(() => withSqliteBackgroundWriter2(step)))
        break;
    } catch (error) {
      if (isTransientSqliteError2(error))
        break;
      throw error;
    }
    batches++;
    await yieldFn();
  }
  return batches;
}

// ../plugin/src/features/magic-context/storage-embedding-measurements.ts
import { createHash } from "node:crypto";
function normalizedQueryHash(query) {
  const normalized = query.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}
var MEASUREMENT_CORPUS_SESSION_ROW_CAP = 2000;
function recordEmbeddingMeasurement(db, input, cap = MEASUREMENT_CORPUS_SESSION_ROW_CAP) {
  const queryTextHash = normalizedQueryHash(input.queryText);
  const dedupKey = queryTextHash;
  const result = db.prepare(`INSERT OR IGNORE INTO embedding_measurement_corpus
            (session_id, project_path, dedup_key, cohort_key, query_text_hash,
             primary_result_ids_json, shadow_result_ids_json, primary_latency_ms, shadow_latency_ms,
             primary_failed, shadow_failed, primary_model_id, shadow_model_id,
             primary_fingerprint, shadow_fingerprint, primary_epoch, shadow_epoch,
             corpus_hash, coverage_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.sessionId, input.projectPath, dedupKey, input.cohortKey, queryTextHash, JSON.stringify(input.primaryResultIds.slice(0, 10)), JSON.stringify(input.shadowResultIds.slice(0, 10)), input.primaryLatencyMs, input.shadowLatencyMs, input.primaryFailed ? 1 : 0, input.shadowFailed ? 1 : 0, input.primaryModelId, input.shadowModelId, input.primaryFingerprint, input.shadowFingerprint, input.primaryEpoch, input.shadowEpoch, input.corpusHash, JSON.stringify(input.coverage), Date.now());
  if (result.changes > 0) {
    const rowCount = db.prepare("SELECT COUNT(*) AS count FROM embedding_measurement_corpus WHERE session_id = ?").get(input.sessionId).count;
    const overflow = rowCount - cap;
    if (overflow > 0) {
      db.prepare(`DELETE FROM embedding_measurement_corpus
                  WHERE session_id = ?
                    AND id IN (
                        SELECT id FROM embedding_measurement_corpus
                        WHERE session_id = ?
                        ORDER BY id ASC
                        LIMIT ?
                    )`).run(input.sessionId, input.sessionId, overflow);
    }
  }
  return result.changes > 0;
}
function beginSynapseBatchLedger(db, input, now = Date.now()) {
  db.prepare(`INSERT INTO synapse_batch_ledger
            (session_id, project_path, scope, manifest_json, request_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(session_id, request_key) DO UPDATE SET
            manifest_json = excluded.manifest_json,
            updated_at = excluded.updated_at`).run(input.sessionId, input.projectPath, input.scope, JSON.stringify(input.manifest), input.requestKey, now, now);
}
function finishSynapseBatchLedger(db, sessionId, requestKey, status, now = Date.now()) {
  db.prepare("UPDATE synapse_batch_ledger SET status = ?, updated_at = ? WHERE session_id = ? AND request_key = ?").run(status, now, sessionId, requestKey);
}
var SYNAPSE_BATCH_LEDGER_TTL_MS = 14 * 24 * 60 * 60 * 1000;
function pruneSynapseBatchLedgerForProject(db, projectIdentity, ttlMs = SYNAPSE_BATCH_LEDGER_TTL_MS) {
  const ledgerTable = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'synapse_batch_ledger'").get();
  if (!ledgerTable)
    return 0;
  const shadow = `shadow:${projectIdentity}`;
  const cutoff = Date.now() - ttlMs;
  const predicate = "session_id IN (?, ?) AND updated_at < ?";
  if (!db.prepare(`SELECT 1 FROM synapse_batch_ledger WHERE ${predicate} LIMIT 1`).get(projectIdentity, shadow, cutoff))
    return 0;
  return db.prepare(`DELETE FROM synapse_batch_ledger WHERE ${predicate}`).run(projectIdentity, shadow, cutoff).changes;
}

export { embedPauseBySession, embedRunStateBySession, activeEmbeddingSessions, autoEmbedAttemptedBySession, autoEmbedIdentityBySession, autoEmbedRetryAfterBySession, invalidateAutoEmbedSession, getEmbedDrainUiStatus, drainBackgroundBatches, recordEmbeddingMeasurement, beginSynapseBatchLedger, finishSynapseBatchLedger, pruneSynapseBatchLedgerForProject };
