import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  isUserHomeDirectory
} from "./index-hxp6q5f8.js";
import {
  logSlowWriteTransaction
} from "./index-hqw0rt9k.js";

// ../plugin/src/features/magic-context/session-project-storage.ts
var SESSION_CHUNK_REPAIR_BATCH_SIZE = 100;
var upsertSessionProjectStatements = new WeakMap;
var repairSessionChunkProjectStatements = new WeakMap;
var misScopedProjectChunkStatements = new WeakMap;
var MIS_SCOPED_PROJECT_CHUNK_IDS_SQL = `
    SELECT e.id FROM compartment_chunk_embeddings e
    JOIN session_projects sp ON sp.session_id = e.session_id AND sp.harness = e.harness
    WHERE e.project_path = ? AND sp.project_path <> e.project_path
    UNION ALL
    SELECT e.id FROM session_projects sp
    JOIN compartment_chunk_embeddings e ON e.session_id = sp.session_id
    WHERE sp.project_path = ? AND e.harness = sp.harness AND e.project_path <> sp.project_path`;
function getUpsertSessionProjectStatement(db) {
  let stmt = upsertSessionProjectStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`INSERT INTO session_projects (session_id, harness, project_path, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(session_id, harness) DO UPDATE SET
                 project_path = excluded.project_path,
                 updated_at = excluded.updated_at
             WHERE session_projects.project_path <> excluded.project_path`);
    upsertSessionProjectStatements.set(db, stmt);
  }
  return stmt;
}
function getRepairSessionChunkProjectStatement(db) {
  let stmt = repairSessionChunkProjectStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`UPDATE compartment_chunk_embeddings
             SET project_path = ?
             WHERE id IN (
                 SELECT id
                 FROM compartment_chunk_embeddings
                 WHERE session_id = ?
                   AND harness = ?
                   AND project_path <> ?
                 LIMIT ?
             )`);
    repairSessionChunkProjectStatements.set(db, stmt);
  }
  return stmt;
}
function findMisScopedCompartmentChunkEmbeddingIdsForProject(db, projectPath) {
  return db.prepare(`SELECT id FROM (${MIS_SCOPED_PROJECT_CHUNK_IDS_SQL}) LIMIT 25`).all(projectPath, projectPath).map(({ id }) => id);
}
function recordSessionProjectIdentity(db, sessionId, projectPath) {
  if (!sessionId || !projectPath)
    return;
  if (!projectPath.startsWith("git:") && !projectPath.startsWith("dir:") && isUserHomeDirectory(projectPath))
    return;
  const harness = getHarness2();
  const now = Date.now();
  let previousProjectPath;
  db.transaction(() => {
    const existing = db.prepare("SELECT project_path FROM session_projects WHERE session_id = ? AND harness = ?").get(sessionId, harness);
    previousProjectPath = existing?.project_path;
    getUpsertSessionProjectStatement(db).run(sessionId, harness, projectPath, now);
    getRepairSessionChunkProjectStatement(db).run(projectPath, sessionId, harness, projectPath, SESSION_CHUNK_REPAIR_BATCH_SIZE);
  }).immediate();
  return previousProjectPath === projectPath ? undefined : { previousProjectPath, projectPath };
}
function repairMisScopedCompartmentChunkEmbeddingsForProject(db, projectPath, ids = findMisScopedCompartmentChunkEmbeddingIdsForProject(db, projectPath)) {
  if (!projectPath || ids.length === 0)
    return 0;
  return db.prepare(`UPDATE compartment_chunk_embeddings
        SET project_path = (SELECT sp.project_path FROM session_projects sp
            WHERE sp.session_id = compartment_chunk_embeddings.session_id
              AND sp.harness = compartment_chunk_embeddings.harness)
        WHERE id IN (${ids.map(() => "?").join(",")}) AND EXISTS (
            SELECT 1 FROM session_projects sp
            WHERE sp.session_id = compartment_chunk_embeddings.session_id
              AND sp.harness = compartment_chunk_embeddings.harness
              AND sp.project_path <> compartment_chunk_embeddings.project_path
              AND (sp.project_path = ? OR compartment_chunk_embeddings.project_path = ?)
        )`).run(...ids, projectPath, projectPath).changes;
}

// ../plugin/src/features/magic-context/git-commits/sweep-coordinator.ts
var GIT_SWEEP_COOLDOWN_MS = 10 * 60 * 1000;
var GIT_SWEEP_LEASE_TTL_MS = 5 * 60 * 1000;
var GIT_SWEEP_NON_INDEXABLE_REPROBE_MS = 24 * 60 * 60 * 1000;
var GIT_SWEEP_LEASE_RENEWAL_MS = 60 * 1000;
function runImmediate(db, body) {
  db.exec("BEGIN IMMEDIATE");
  const transactionStartedAt = performance.now();
  let committed = false;
  try {
    const result = body();
    db.exec("COMMIT");
    committed = true;
    logSlowWriteTransaction("git_sweep_lease", transactionStartedAt);
    return result;
  } finally {
    if (!committed) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
  }
}
function rowToState(row) {
  return {
    projectPath: row.project_path,
    leaseHolder: row.lease_holder,
    leaseExpiresAt: row.lease_expires_at,
    lastSweptAt: row.last_swept_at
  };
}
function getGitSweepCoordinatorState(db, projectPath) {
  const row = db.prepare(`SELECT project_path, lease_holder, lease_expires_at, last_swept_at
             FROM git_sweep_coordinator
             WHERE project_path = ?`).get(projectPath);
  return row ? rowToState(row) : null;
}
function acquireGitSweepLease(db, projectPath, holderId, options = {}) {
  const cooldownMs = options.cooldownMs ?? GIT_SWEEP_COOLDOWN_MS;
  const leaseTtlMs = options.leaseTtlMs ?? GIT_SWEEP_LEASE_TTL_MS;
  return runImmediate(db, () => {
    const now = Date.now();
    const row = getGitSweepCoordinatorState(db, projectPath);
    if (row?.leaseHolder && row.leaseExpiresAt !== null && row.leaseExpiresAt > now) {
      return {
        acquired: false,
        projectPath,
        reason: "lease_active",
        leaseHolder: row.leaseHolder,
        leaseExpiresAt: row.leaseExpiresAt,
        lastSweptAt: row.lastSweptAt,
        nextAllowedAt: null
      };
    }
    if (!options.ignoreCooldown && row?.lastSweptAt !== null && row?.lastSweptAt !== undefined) {
      const nextAllowedAt = row.lastSweptAt + cooldownMs;
      if (nextAllowedAt > now) {
        return {
          acquired: false,
          projectPath,
          reason: "cooldown_active",
          leaseHolder: row.leaseHolder,
          leaseExpiresAt: row.leaseExpiresAt,
          lastSweptAt: row.lastSweptAt,
          nextAllowedAt
        };
      }
    }
    const leaseExpiresAt = now + leaseTtlMs;
    db.prepare(`INSERT INTO git_sweep_coordinator (
                 project_path,
                 lease_holder,
                 lease_expires_at,
                 last_swept_at
             ) VALUES (?, ?, ?, NULL)
             ON CONFLICT(project_path) DO UPDATE SET
                 lease_holder = excluded.lease_holder,
                 lease_expires_at = excluded.lease_expires_at`).run(projectPath, holderId, leaseExpiresAt);
    return {
      acquired: true,
      projectPath,
      holderId,
      acquiredAt: now,
      leaseExpiresAt
    };
  });
}
function renewGitSweepLease(db, projectPath, holderId, leaseTtlMs = GIT_SWEEP_LEASE_TTL_MS) {
  return runImmediate(db, () => {
    const now = Date.now();
    const leaseExpiresAt = now + leaseTtlMs;
    const result = db.prepare(`UPDATE git_sweep_coordinator
                 SET lease_expires_at = ?
                 WHERE project_path = ?
                   AND lease_holder = ?
                   AND lease_expires_at > ?`).run(leaseExpiresAt, projectPath, holderId, now);
    return result.changes === 1;
  });
}
function markGitSweepSuccessAndRelease(db, projectPath, holderId) {
  return runImmediate(db, () => {
    const now = Date.now();
    const result = db.prepare(`UPDATE git_sweep_coordinator
                 SET lease_holder = NULL,
                     lease_expires_at = NULL,
                     last_swept_at = ?
                 WHERE project_path = ?
                   AND lease_holder = ?
                   AND lease_expires_at > ?`).run(now, projectPath, holderId, now);
    return result.changes === 1;
  });
}
function parkGitSweepNonIndexable(db, projectPath, holderId, reprobeMs = GIT_SWEEP_NON_INDEXABLE_REPROBE_MS) {
  return runImmediate(db, () => {
    const now = Date.now();
    const sweptAt = now + reprobeMs - GIT_SWEEP_COOLDOWN_MS;
    const result = db.prepare(`UPDATE git_sweep_coordinator
                 SET lease_holder = NULL,
                     lease_expires_at = NULL,
                     last_swept_at = ?
                 WHERE project_path = ?
                   AND lease_holder = ?
                   AND lease_expires_at > ?`).run(sweptAt, projectPath, holderId, now);
    return result.changes === 1;
  });
}
function releaseGitSweepLease(db, projectPath, holderId) {
  runImmediate(db, () => {
    db.prepare(`UPDATE git_sweep_coordinator
             SET lease_holder = NULL,
                 lease_expires_at = NULL
             WHERE project_path = ?
               AND lease_holder = ?`).run(projectPath, holderId);
  });
}

export { findMisScopedCompartmentChunkEmbeddingIdsForProject, recordSessionProjectIdentity, repairMisScopedCompartmentChunkEmbeddingsForProject, GIT_SWEEP_LEASE_RENEWAL_MS, acquireGitSweepLease, renewGitSweepLease, markGitSweepSuccessAndRelease, parkGitSweepNonIndexable, releaseGitSweepLease };
