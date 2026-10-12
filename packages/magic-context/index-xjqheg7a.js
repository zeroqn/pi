import {
  withPrivilegedWriter2
} from "./index-3cgbv47m.js";
import {
  MEMORY_CATEGORY_ORDER_SQL
} from "./index-135e8hvg.js";
import {
  invalidateProject2,
  invalidateMemory2
} from "./index-yhzhdp3m.js";
import {
  computeNormalizedHash
} from "./index-9x1f96r8.js";

// ../plugin/src/features/magic-context/mural/storage-mural-cues.ts
import { createHash } from "node:crypto";
function computeCueContentHash(content) {
  return createHash("sha256").update(content).digest("hex");
}
var muralCueColumnCache = new WeakMap;
var muralCueRejectionColumnCache = new WeakMap;
function hasMuralCueColumns(db) {
  const cached = muralCueColumnCache.get(db);
  if (cached !== undefined)
    return cached;
  const columns = db.prepare("PRAGMA table_info(memories)").all();
  const present = columns.some((column) => column.name === "mural_cue");
  muralCueColumnCache.set(db, present);
  return present;
}
function hasMuralCueRejectionCountColumn(db) {
  const cached = muralCueRejectionColumnCache.get(db);
  if (cached !== undefined)
    return cached;
  const columns = db.prepare("PRAGMA table_info(memories)").all();
  const present = columns.some((column) => column.name === "mural_cue_rejection_count");
  muralCueRejectionColumnCache.set(db, present);
  return present;
}
function getMuralCueState(db, memoryIds) {
  const out = new Map;
  if (!hasMuralCueColumns(db))
    return out;
  const ids = Array.from(new Set(memoryIds.filter(Number.isInteger)));
  if (ids.length === 0)
    return out;
  const rejectionCountColumn = hasMuralCueRejectionCountColumn(db) ? "COALESCE(mural_cue_rejection_count, 0) AS mural_cue_rejection_count" : "0 AS mural_cue_rejection_count";
  const rows = db.prepare(`SELECT id, mural_cue, mural_cue_hash, ${rejectionCountColumn} FROM memories WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids));
  for (const row of rows) {
    out.set(row.id, {
      cue: row.mural_cue ?? null,
      hash: row.mural_cue_hash ?? null,
      ...row.mural_cue_rejection_count > 0 ? { rejectionCount: row.mural_cue_rejection_count } : {}
    });
  }
  return out;
}
function memoryNeedsCue(state, currentContent) {
  if (!state || state.cue === null || state.hash === null)
    return true;
  return state.hash !== computeCueContentHash(currentContent);
}
function setMuralCue(db, projectPath, id, cue, contentHash) {
  if (!hasMuralCueColumns(db))
    return;
  withPrivilegedWriter2(db, () => {
    const owned = db.prepare("SELECT 1 FROM memories WHERE id = ? AND project_path = ?").get(id, projectPath);
    if (!owned) {
      throw new Error(`Memory ${id} does not belong to project ${projectPath}`);
    }
    const rejectionReset = hasMuralCueRejectionCountColumn(db) ? ", mural_cue_rejection_count = 0" : "";
    db.prepare(`UPDATE memories SET mural_cue = ?, mural_cue_hash = ?, mural_cue_at = ?${rejectionReset} WHERE id = ? AND project_path = ?`).run(cue, contentHash, Date.now(), id, projectPath);
  });
}
function recordMuralCueRejection(db, projectPath, id, contentHash) {
  if (!hasMuralCueColumns(db) || !hasMuralCueRejectionCountColumn(db))
    return 0;
  let count = 0;
  withPrivilegedWriter2(db, () => {
    const owned = db.prepare("SELECT 1 FROM memories WHERE id = ? AND project_path = ?").get(id, projectPath);
    if (!owned) {
      throw new Error(`Memory ${id} does not belong to project ${projectPath}`);
    }
    const row = db.prepare("SELECT mural_cue_hash, mural_cue_rejection_count FROM memories WHERE id = ?").get(id);
    count = row?.mural_cue_hash === contentHash ? (row.mural_cue_rejection_count ?? 0) + 1 : 1;
    db.prepare("UPDATE memories SET mural_cue = NULL, mural_cue_hash = ?, mural_cue_at = ?, mural_cue_rejection_count = ? WHERE id = ? AND project_path = ?").run(contentHash, Date.now(), count, id, projectPath);
  });
  return count;
}

// ../plugin/src/features/magic-context/memory/visibility.ts
var FOREIGN_VISIBLE_SQL = "status IN ('active','permanent') AND (expires_at IS NULL OR expires_at > :now_ms) AND shareable = 1 AND scope IN ('project','ecosystem','universe') AND category IN (SELECT value FROM json_each(:share_categories)) AND project_path IN (SELECT project_path FROM workspace_members WHERE workspace_id = :workspace_id) AND project_path <> :reader_project";

// ../plugin/src/features/magic-context/memory/storage-memory.ts
var COLUMN_MAP2 = {
  id: "id",
  projectPath: "project_path",
  category: "category",
  content: "content",
  normalizedHash: "normalized_hash",
  importance: "importance",
  scope: "scope",
  shareable: "shareable",
  sourceSessionId: "source_session_id",
  sourceType: "source_type",
  seenCount: "seen_count",
  retrievalCount: "retrieval_count",
  firstSeenAt: "first_seen_at",
  createdAt: "created_at",
  updatedAt: "updated_at",
  lastSeenAt: "last_seen_at",
  lastRetrievedAt: "last_retrieved_at",
  status: "status",
  expiresAt: "expires_at",
  verificationStatus: "verification_status",
  verifiedAt: "verified_at",
  supersededByMemoryId: "superseded_by_memory_id",
  mergedFrom: "merged_from",
  metadataJson: "metadata_json"
};
var MEMORY_CATEGORY_LOOKUP = {
  PROJECT_RULES: true,
  ARCHITECTURE: true,
  CONFIG_VALUES: true,
  ARCHITECTURE_DECISIONS: true,
  CONSTRAINTS: true,
  CONFIG_DEFAULTS: true,
  NAMING: true,
  USER_PREFERENCES: true,
  USER_DIRECTIVES: true,
  ENVIRONMENT: true,
  WORKFLOW_RULES: true,
  KNOWN_ISSUES: true
};
var MEMORY_STATUS_LOOKUP = {
  active: true,
  permanent: true,
  archived: true
};
var MEMORY_SCOPE_LOOKUP = {
  project: true,
  ecosystem: true,
  universe: true
};
var MEMORY_SOURCE_TYPE_LOOKUP = {
  historian: true,
  agent: true,
  dreamer: true,
  user: true
};
var VERIFICATION_STATUS_LOOKUP = {
  unverified: true,
  verified: true,
  stale: true,
  flagged: true
};
var insertMemoryStatements = new WeakMap;
var getMemoryByHashStatements = new WeakMap;
var getMemoryByIdStatements = new WeakMap;
var getMemoriesByIdsStatements = new Map;
var activeMemoriesNoExpiryStatements = new WeakMap;
var updateMemorySeenCountStatements = new WeakMap;
var updateMemoryRetrievalCountStatements = new WeakMap;
var updateMemoryStatusStatements = new WeakMap;
var updateArchivedMemoryStatements = new WeakMap;
var updateMemoryVerificationStatements = new WeakMap;
var updateMemoryContentStatements = new WeakMap;
var supersededMemoryStatements = new WeakMap;
var mergeMemoryStatsStatements = new WeakMap;
var deleteMemoryStatements = new WeakMap;
var deleteMemoryEmbeddingStatements = new WeakMap;
var deleteEmbeddingOnContentUpdateStatements = new WeakMap;
var getMemoryCountStatements = new WeakMap;
var getMemoryCountByProjectStatements = new WeakMap;
var getMemoryCountsByStatusStatements = new WeakMap;
var memoriesByProjectStatements = new Map;
var memoryImportanceColumnCache = new WeakMap;
var memoryScopeColumnCache = new WeakMap;
var memoryShareableColumnCache = new WeakMap;
var memoryClassifiedAtColumnCache = new WeakMap;
var memoryVerificationsTableCache = new WeakMap;
function hasMemoryImportanceColumn(db) {
  const cached = memoryImportanceColumnCache.get(db);
  if (cached !== undefined)
    return cached;
  const columns = db.prepare("PRAGMA table_info(memories)").all();
  const hasColumn = columns.some((column) => column.name === "importance");
  memoryImportanceColumnCache.set(db, hasColumn);
  return hasColumn;
}
function hasMemoryScopeColumn(db) {
  const cached = memoryScopeColumnCache.get(db);
  if (cached !== undefined)
    return cached;
  const columns = db.prepare("PRAGMA table_info(memories)").all();
  const hasColumn = columns.some((column) => column.name === "scope");
  memoryScopeColumnCache.set(db, hasColumn);
  return hasColumn;
}
function hasMemoryShareableColumn2(db) {
  const cached = memoryShareableColumnCache.get(db);
  if (cached !== undefined)
    return cached;
  const columns = db.prepare("PRAGMA table_info(memories)").all();
  const hasColumn = columns.some((column) => column.name === "shareable");
  memoryShareableColumnCache.set(db, hasColumn);
  return hasColumn;
}
function hasMemoryClassifiedAtColumn2(db) {
  const cached = memoryClassifiedAtColumnCache.get(db);
  if (cached !== undefined)
    return cached;
  const columns = db.prepare("PRAGMA table_info(memories)").all();
  const hasColumn = columns.some((column) => column.name === "classified_at");
  memoryClassifiedAtColumnCache.set(db, hasColumn);
  return hasColumn;
}
function hasMemoryVerificationsTable(db) {
  const cached = memoryVerificationsTableCache.get(db);
  if (cached !== undefined)
    return cached;
  const hasTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memory_verifications'").get());
  memoryVerificationsTableCache.set(db, hasTable);
  return hasTable;
}
function getUnclassifiedMemoryIds2(db, memoryIds) {
  if (!hasMemoryClassifiedAtColumn2(db))
    return [...memoryIds];
  const ids = Array.from(new Set(memoryIds.filter(Number.isInteger)));
  if (ids.length === 0)
    return [];
  const rows = db.prepare("SELECT id FROM memories WHERE id IN (SELECT value FROM json_each(?)) AND classified_at IS NOT NULL").all(JSON.stringify(ids));
  const classified = new Set(rows.map((r) => r.id));
  return ids.filter((id) => !classified.has(id));
}
function getMemorySelectColumns2(db, tableName = "memories") {
  return Object.entries(COLUMN_MAP2).map(([property, column]) => {
    if (property === "importance" && !hasMemoryImportanceColumn(db)) {
      return "50 AS importance";
    }
    if (property === "importance") {
      return `COALESCE(${tableName}.${column}, 50) AS ${property}`;
    }
    if (property === "scope" && !hasMemoryScopeColumn(db)) {
      return "'project' AS scope";
    }
    if (property === "scope") {
      return `COALESCE(${tableName}.${column}, 'project') AS ${property}`;
    }
    if (property === "shareable" && !hasMemoryShareableColumn2(db)) {
      return "0 AS shareable";
    }
    if (property === "shareable") {
      return `COALESCE(${tableName}.${column}, 0) AS ${property}`;
    }
    return `${tableName}.${column} AS ${property}`;
  }).join(", ");
}
function isMemoryCategory(value) {
  return typeof value === "string" && value in MEMORY_CATEGORY_LOOKUP;
}
function isMemoryStatus(value) {
  return typeof value === "string" && value in MEMORY_STATUS_LOOKUP;
}
function isMemoryScope(value) {
  return typeof value === "string" && value in MEMORY_SCOPE_LOOKUP;
}
function isMemorySourceType(value) {
  return typeof value === "string" && value in MEMORY_SOURCE_TYPE_LOOKUP;
}
function isVerificationStatus(value) {
  return typeof value === "string" && value in VERIFICATION_STATUS_LOOKUP;
}
function isUniqueConstraintError(error) {
  return error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT_UNIQUE";
}
function isNullableString(value) {
  return value === null || typeof value === "string";
}
function isNullableNumber(value) {
  return value === null || typeof value === "number";
}
function isMemoryCountByStatusRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const candidate = row;
  return typeof candidate.id === "number" && isMemoryStatus(candidate.status) && isNullableNumber(candidate.superseded_by_memory_id);
}
function isMemoryRow2(row) {
  if (row === null || typeof row !== "object")
    return false;
  const candidate = row;
  return typeof candidate.id === "number" && typeof candidate.projectPath === "string" && isMemoryCategory(candidate.category) && typeof candidate.content === "string" && typeof candidate.normalizedHash === "string" && typeof candidate.importance === "number" && isMemoryScope(candidate.scope) && typeof candidate.shareable === "number" && isNullableString(candidate.sourceSessionId) && isMemorySourceType(candidate.sourceType) && typeof candidate.seenCount === "number" && typeof candidate.retrievalCount === "number" && typeof candidate.firstSeenAt === "number" && typeof candidate.createdAt === "number" && typeof candidate.updatedAt === "number" && typeof candidate.lastSeenAt === "number" && isNullableNumber(candidate.lastRetrievedAt) && isMemoryStatus(candidate.status) && isNullableNumber(candidate.expiresAt) && isVerificationStatus(candidate.verificationStatus) && isNullableNumber(candidate.verifiedAt) && isNullableNumber(candidate.supersededByMemoryId) && isNullableString(candidate.mergedFrom) && isNullableString(candidate.metadataJson);
}
function toMemory2(row) {
  return {
    id: row.id,
    projectPath: row.projectPath,
    category: row.category,
    content: row.content,
    normalizedHash: row.normalizedHash,
    importance: row.importance,
    scope: row.scope,
    shareable: row.shareable,
    sourceSessionId: row.sourceSessionId,
    sourceType: row.sourceType,
    seenCount: row.seenCount,
    retrievalCount: row.retrievalCount,
    firstSeenAt: row.firstSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSeenAt: row.lastSeenAt,
    lastRetrievedAt: row.lastRetrievedAt,
    status: row.status,
    expiresAt: row.expiresAt,
    verificationStatus: row.verificationStatus,
    verifiedAt: row.verifiedAt,
    supersededByMemoryId: row.supersededByMemoryId,
    mergedFrom: row.mergedFrom,
    metadataJson: row.metadataJson
  };
}
function getInsertMemoryStatement(db) {
  let stmt = insertMemoryStatements.get(db);
  if (!stmt) {
    stmt = hasMemoryImportanceColumn(db) ? db.prepare("INSERT INTO memories (project_path, category, content, normalized_hash, importance, source_session_id, source_type, seen_count, retrieval_count, first_seen_at, created_at, updated_at, last_seen_at, last_retrieved_at, status, expires_at, verification_status, verified_at, superseded_by_memory_id, merged_from, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)") : db.prepare("INSERT INTO memories (project_path, category, content, normalized_hash, source_session_id, source_type, seen_count, retrieval_count, first_seen_at, created_at, updated_at, last_seen_at, last_retrieved_at, status, expires_at, verification_status, verified_at, superseded_by_memory_id, merged_from, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insertMemoryStatements.set(db, stmt);
  }
  return stmt;
}
function getMemoryByHashStatement(db) {
  let stmt = getMemoryByHashStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT ${getMemorySelectColumns2(db)} FROM memories WHERE project_path = ? AND category = ? AND normalized_hash = ?`);
    getMemoryByHashStatements.set(db, stmt);
  }
  return stmt;
}
function getMemoryByIdStatement(db) {
  let stmt = getMemoryByIdStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT ${getMemorySelectColumns2(db)} FROM memories WHERE id = ?`);
    getMemoryByIdStatements.set(db, stmt);
  }
  return stmt;
}
function getMemoriesByIdsStatement(db, idCount) {
  const key = `n${idCount}`;
  let map = getMemoriesByIdsStatements.get(key);
  if (!map) {
    map = new WeakMap;
    getMemoriesByIdsStatements.set(key, map);
  }
  let stmt = map.get(db);
  if (!stmt) {
    const placeholders = new Array(idCount).fill("?").join(", ");
    stmt = db.prepare(`SELECT ${getMemorySelectColumns2(db)} FROM memories WHERE id IN (${placeholders})`);
    map.set(db, stmt);
  }
  return stmt;
}
function getMemoriesByProjectStatement(db, statuses) {
  const key = statuses.join(",");
  let statements = memoriesByProjectStatements.get(key);
  if (!statements) {
    statements = new WeakMap;
    memoriesByProjectStatements.set(key, statements);
  }
  let stmt = statements.get(db);
  if (!stmt) {
    const placeholders = statuses.map(() => "?").join(", ");
    stmt = db.prepare(`SELECT ${getMemorySelectColumns2(db)} FROM memories WHERE project_path = ? AND status IN (${placeholders}) AND (expires_at IS NULL OR expires_at > ?) ORDER BY category ASC, updated_at DESC, id ASC`);
    statements.set(db, stmt);
  }
  return stmt;
}
function getActiveMemoriesNoExpiryStatement(db) {
  let stmt = activeMemoriesNoExpiryStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT ${getMemorySelectColumns2(db)} FROM memories WHERE project_path = ? AND status = 'active' ORDER BY category ASC, updated_at DESC, id ASC`);
    activeMemoriesNoExpiryStatements.set(db, stmt);
  }
  return stmt;
}
function getUpdateMemorySeenCountStatement(db) {
  let stmt = updateMemorySeenCountStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE memories SET seen_count = seen_count + 1, last_seen_at = ?, updated_at = ? WHERE id = ?");
    updateMemorySeenCountStatements.set(db, stmt);
  }
  return stmt;
}
function getUpdateMemoryRetrievalCountStatement(db) {
  let stmt = updateMemoryRetrievalCountStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE memories SET retrieval_count = retrieval_count + 1, last_retrieved_at = ?, updated_at = ? WHERE id = ?");
    updateMemoryRetrievalCountStatements.set(db, stmt);
  }
  return stmt;
}
function getUpdateMemoryStatusStatement(db) {
  let stmt = updateMemoryStatusStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE memories SET status = ?, updated_at = ? WHERE id = ?");
    updateMemoryStatusStatements.set(db, stmt);
  }
  return stmt;
}
function getUpdateArchivedMemoryStatement(db) {
  let stmt = updateArchivedMemoryStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE memories SET status = 'archived', metadata_json = ?, updated_at = ? WHERE id = ?");
    updateArchivedMemoryStatements.set(db, stmt);
  }
  return stmt;
}
function getUpdateMemoryVerificationStatement(db) {
  let stmt = updateMemoryVerificationStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE memories SET verification_status = ?, verified_at = CASE WHEN ? = 'verified' THEN ? ELSE verified_at END, updated_at = ? WHERE id = ?");
    updateMemoryVerificationStatements.set(db, stmt);
  }
  return stmt;
}
function getUpdateMemoryContentStatement(db) {
  let stmt = updateMemoryContentStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE memories SET content = ?, normalized_hash = ?, updated_at = ? WHERE id = ?");
    updateMemoryContentStatements.set(db, stmt);
  }
  return stmt;
}
function getSupersededMemoryStatement(db) {
  let stmt = supersededMemoryStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE memories SET superseded_by_memory_id = ?, status = 'archived', updated_at = ? WHERE id = ?");
    supersededMemoryStatements.set(db, stmt);
  }
  return stmt;
}
function getMergeMemoryStatsStatement(db) {
  let stmt = mergeMemoryStatsStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE memories SET seen_count = ?, retrieval_count = ?, merged_from = ?, status = ?, updated_at = ? WHERE id = ?");
    mergeMemoryStatsStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteMemoryStatement(db) {
  let stmt = deleteMemoryStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM memories WHERE id = ?");
    deleteMemoryStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteMemoryEmbeddingStatement(db) {
  let stmt = deleteMemoryEmbeddingStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM memory_embeddings WHERE memory_id = ?");
    deleteMemoryEmbeddingStatements.set(db, stmt);
  }
  return stmt;
}
function getMemoryCountStatement(db) {
  let stmt = getMemoryCountStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT COUNT(*) AS count FROM memories");
    getMemoryCountStatements.set(db, stmt);
  }
  return stmt;
}
function getMemoryCountByProjectStatement(db) {
  let stmt = getMemoryCountByProjectStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT COUNT(*) AS count FROM memories WHERE project_path = ?");
    getMemoryCountByProjectStatements.set(db, stmt);
  }
  return stmt;
}
function getMemoryCountsByStatusStatement(db) {
  let stmt = getMemoryCountsByStatusStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT id, status, superseded_by_memory_id FROM memories WHERE project_path = ?");
    getMemoryCountsByStatusStatements.set(db, stmt);
  }
  return stmt;
}
function buildInsertMemoryValues(input, normalizedHash, now, includeImportance) {
  const insertValues = [
    input.projectPath,
    input.category,
    input.content,
    normalizedHash
  ];
  if (includeImportance) {
    insertValues.push(input.importance ?? 50);
  }
  insertValues.push(input.sourceSessionId ?? null, input.sourceType ?? "historian", 1, 0, now, now, now, now, null, "active", input.expiresAt ?? null, "unverified", null, null, null, input.metadataJson ?? null);
  return insertValues;
}
function loadInsertedMemory(db, rowid) {
  const inserted = getMemoryById2(db, Number(rowid));
  if (!inserted) {
    throw new Error("Failed to load inserted memory row");
  }
  return inserted;
}

class ModuleMemoryAuthorityError2 extends Error {
  projectPath;
  code = "MEMORY_MODULE_AUTHORITY";
  constructor(projectPath) {
    super(`memory writes for module-managed project ${projectPath} must use the Rust ctx_memory module facade`);
    this.projectPath = projectPath;
    this.name = "ModuleMemoryAuthorityError";
  }
}
function assertTsMemoryWriteAllowed(db, projectPath) {
  try {
    const managed = db.prepare("SELECT 1 FROM authority_managed WHERE project_path = ? UNION SELECT 1 FROM authority_repair_pending WHERE project_path = ? LIMIT 1").get(projectPath, projectPath);
    if (managed)
      throw new ModuleMemoryAuthorityError2(projectPath);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("no such table"))
      throw error;
  }
}
function assertTsMemoryIdWriteAllowed(db, id) {
  const memory = getMemoryById2(db, id);
  if (memory)
    assertTsMemoryWriteAllowed(db, memory.projectPath);
  return memory;
}
function insertMemory2(db, input) {
  if (input.sourceType === "user") {
    throw new Error(`sourceType "user" is reserved for future dashboard manual entry and cannot be written by agent paths`);
  }
  assertTsMemoryWriteAllowed(db, input.projectPath);
  const now = Date.now();
  const normalizedHash = computeNormalizedHash(input.content);
  const insertValues = buildInsertMemoryValues(input, normalizedHash, now, hasMemoryImportanceColumn(db));
  const result = getInsertMemoryStatement(db).run(...insertValues);
  const insertedResult = result;
  const inserted = loadInsertedMemory(db, insertedResult.lastInsertRowid);
  invalidateProject2(input.projectPath);
  return inserted;
}
function insertMemoryIdempotent2(db, input) {
  try {
    return { memory: insertMemory2(db, input), inserted: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    const normalizedHash = computeNormalizedHash(input.content);
    const existing = getMemoryByHash2(db, input.projectPath, input.category, normalizedHash);
    if (!existing) {
      throw error;
    }
    updateMemorySeenCount2(db, existing.id);
    return {
      memory: getMemoryById2(db, existing.id) ?? existing,
      inserted: false
    };
  }
}
function getMemoryByHash2(db, projectPath, category, normalizedHash) {
  const result = getMemoryByHashStatement(db).get(projectPath, category, normalizedHash);
  if (!isMemoryRow2(result)) {
    return null;
  }
  return toMemory2(result);
}
function getMemoriesByProject2(db, projectPath, statuses = ["active", "permanent"], expiryCutoff = Date.now()) {
  if (statuses.length === 0) {
    return [];
  }
  const rows = getMemoriesByProjectStatement(db, statuses).all(projectPath, ...statuses, expiryCutoff).filter(isMemoryRow2);
  return rows.map(toMemory2);
}
var memoryListStatements = new WeakMap;
function getMemoriesForList2(db, projectPath, categories, limit) {
  if (limit <= 0)
    return [];
  let statement = memoryListStatements.get(db);
  if (!statement) {
    statement = db.prepare(`SELECT ${getMemorySelectColumns2(db)} FROM memories
            WHERE project_path = ? AND status IN ('active', 'permanent')
              AND (expires_at IS NULL OR expires_at > ?)
              AND (? IS NULL OR category IN (SELECT value FROM json_each(?)))
            ORDER BY category ASC, updated_at DESC, id ASC LIMIT ? OFFSET ?`);
    memoryListStatements.set(db, statement);
  }
  const categoryJson = categories === null ? null : JSON.stringify(categories);
  const cutoff = Date.now();
  const pageSize = Math.min(256, limit);
  const result = [];
  for (let offset = 0;result.length < limit; offset += pageSize) {
    const rows = statement.all(projectPath, cutoff, categoryJson, categoryJson, pageSize, offset);
    result.push(...rows.filter(isMemoryRow2).map(toMemory2));
    if (rows.length < pageSize)
      break;
  }
  return result.slice(0, limit);
}
function sqlPlaceholders(values) {
  return values.map(() => "?").join(", ");
}
function uniqueValues(values) {
  return [...new Set(values.filter((value) => value.length > 0))];
}
function buildWorkspaceMemorySqlFilter2(args) {
  if (args.shareCategories === null || args.shareCategories === undefined) {
    return { clause: "", params: [], active: false, predicate: FOREIGN_VISIBLE_SQL };
  }
  const identities = uniqueValues(args.identities);
  const identitySet = new Set(identities);
  const ownSet = new Set(uniqueValues(args.ownIdentities ?? []).filter((identity) => identitySet.has(identity)));
  const foreignIdentities = identities.filter((identity) => !ownSet.has(identity));
  if (foreignIdentities.length === 0) {
    return { clause: "", params: [], active: false, predicate: FOREIGN_VISIBLE_SQL };
  }
  const ownIdentities = identities.filter((identity) => ownSet.has(identity));
  const shareCategories = uniqueValues([...args.shareCategories]);
  const qualifier = args.tableName ? `${args.tableName}.` : "";
  const classification = args.includeClassificationFields === false ? "" : ` AND ${qualifier}shareable = 1 AND ${qualifier}scope IN ('project','ecosystem','universe')`;
  const predicates = [];
  const params = [];
  if (ownIdentities.length > 0) {
    predicates.push(`${qualifier}project_path IN (${sqlPlaceholders(ownIdentities)})`);
    params.push(...ownIdentities);
  }
  if (foreignIdentities.length > 0 && shareCategories.length > 0) {
    predicates.push(`(${qualifier}project_path IN (${sqlPlaceholders(foreignIdentities)}) AND ${qualifier}category IN (${sqlPlaceholders(shareCategories)})${classification})`);
    params.push(...foreignIdentities, ...shareCategories);
  }
  if (predicates.length === 0) {
    return { clause: " AND 0 = 1", params: [], active: true, predicate: FOREIGN_VISIBLE_SQL };
  }
  return {
    clause: ` AND (${predicates.join(" OR ")})`,
    params,
    active: true,
    predicate: FOREIGN_VISIBLE_SQL
  };
}
function getMemoriesByProjects2(db, projectPaths, statuses = ["active", "permanent"], expiryCutoff = Date.now(), ownIdentities, shareCategories) {
  const identities = uniqueValues(projectPaths);
  if (identities.length === 0 || statuses.length === 0)
    return [];
  const identitySet = new Set(identities);
  const ownSet = new Set(uniqueValues(ownIdentities ?? []).filter((identity) => identitySet.has(identity)));
  const foreignIdentities = identities.filter((identity) => !ownSet.has(identity));
  const ownIdentitiesResolved = identities.filter((identity) => ownSet.has(identity));
  if (foreignIdentities.length === 0 || shareCategories === null || shareCategories === undefined) {
    if (identities.length === 1) {
      return getMemoriesByProject2(db, identities[0], statuses, expiryCutoff);
    }
    const rows = db.prepare(`SELECT ${getMemorySelectColumns2(db)}
                   FROM memories
                  WHERE project_path IN (${sqlPlaceholders(identities)})
                    AND status IN (${sqlPlaceholders(statuses)})
                    AND (expires_at IS NULL OR expires_at > ?)
                  ORDER BY category ASC, updated_at DESC, id ASC`).all(...identities, ...statuses, expiryCutoff).filter(isMemoryRow2);
    return rows.map(toMemory2);
  }
  const shareCats = uniqueValues([...shareCategories]);
  const hasClassification = hasMemoryShareableColumn2(db) && hasMemoryScopeColumn(db);
  const predicates = [];
  const params = [];
  if (ownIdentitiesResolved.length > 0) {
    predicates.push(`(project_path IN (${sqlPlaceholders(ownIdentitiesResolved)})
              AND status IN (${sqlPlaceholders(statuses)})
              AND (expires_at IS NULL OR expires_at > ?))`);
    params.push(...ownIdentitiesResolved, ...statuses, expiryCutoff);
  }
  if (foreignIdentities.length > 0 && shareCats.length > 0) {
    const classification = hasClassification ? " AND shareable = 1 AND scope IN ('project','ecosystem','universe')" : "";
    predicates.push(`(project_path IN (${sqlPlaceholders(foreignIdentities)})
              AND status IN ('active','permanent')
              AND (expires_at IS NULL OR expires_at > ?)
              AND category IN (${sqlPlaceholders(shareCats)})${classification})`);
    params.push(...foreignIdentities, expiryCutoff, ...shareCats);
  }
  if (predicates.length === 0)
    return [];
  const rows = db.prepare(`SELECT ${getMemorySelectColumns2(db)}
               FROM memories
              WHERE (${predicates.join(" OR ")})
              ORDER BY category ASC, updated_at DESC, id ASC`).all(...params).filter(isMemoryRow2);
  return rows.map(toMemory2);
}
function getMaxMemoryIdForProjects2(db, projectPaths, ownIdentities, shareCategories, expiryCutoff = Date.now()) {
  const identities = uniqueValues(projectPaths);
  if (identities.length === 0)
    return 0;
  const sharingFilter = buildWorkspaceMemorySqlFilter2({
    identities,
    ownIdentities,
    shareCategories,
    includeClassificationFields: hasMemoryShareableColumn2(db) && hasMemoryScopeColumn(db)
  });
  const row = db.prepare(`SELECT COALESCE(MAX(id), 0) AS max_id
               FROM memories
              WHERE project_path IN (${sqlPlaceholders(identities)})
                AND status IN ('active', 'permanent')
                AND (expires_at IS NULL OR expires_at > ?)${sharingFilter.clause}`).get(...identities, expiryCutoff, ...sharingFilter.params);
  return typeof row?.max_id === "number" ? row.max_id : 0;
}
function readNewMemoriesForM1Union2(db, projectPaths, afterId, expiryCutoff, ownIdentities, shareCategories) {
  const identities = uniqueValues(projectPaths);
  if (identities.length === 0)
    return [];
  const sharingFilter = buildWorkspaceMemorySqlFilter2({
    identities,
    ownIdentities,
    shareCategories,
    includeClassificationFields: hasMemoryShareableColumn2(db) && hasMemoryScopeColumn(db)
  });
  const rows = db.prepare(`SELECT ${getMemorySelectColumns2(db)}
               FROM memories
              WHERE project_path IN (${sqlPlaceholders(identities)})
                AND id > ?
                AND status IN ('active', 'permanent')
                AND (expires_at IS NULL OR expires_at > ?)${sharingFilter.clause}
              ORDER BY ${MEMORY_CATEGORY_ORDER_SQL}, id ASC`).all(...identities, afterId, expiryCutoff, ...sharingFilter.params).filter(isMemoryRow2);
  return rows.map(toMemory2);
}
function getAllActiveMemoriesForMigration2(db, projectPath) {
  const rows = getActiveMemoriesNoExpiryStatement(db).all(projectPath).filter(isMemoryRow2);
  return rows.map(toMemory2);
}
function getMemoryById2(db, id) {
  const result = getMemoryByIdStatement(db).get(id);
  if (!isMemoryRow2(result)) {
    return null;
  }
  return toMemory2(result);
}
function getMemoriesByIds2(db, ids) {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id))));
  if (uniqueIds.length === 0) {
    return [];
  }
  const rows = getMemoriesByIdsStatement(db, uniqueIds.length).all(...uniqueIds).filter(isMemoryRow2);
  return rows.map(toMemory2);
}
function updateMemorySeenCount2(db, id) {
  assertTsMemoryIdWriteAllowed(db, id);
  const now = Date.now();
  getUpdateMemorySeenCountStatement(db).run(now, now, id);
}
function updateMemoryRetrievalCount2(db, id) {
  assertTsMemoryIdWriteAllowed(db, id);
  const now = Date.now();
  getUpdateMemoryRetrievalCountStatement(db).run(now, now, id);
}
function updateMemoryStatus2(db, id, status) {
  assertTsMemoryIdWriteAllowed(db, id);
  getUpdateMemoryStatusStatement(db).run(status, Date.now(), id);
}
function mergeMetadataJson(existing, patch) {
  let base = {};
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed;
      }
    } catch {
      base = {};
    }
  }
  return JSON.stringify({ ...base, ...patch });
}
function updateMemoryVerification2(db, id, verificationStatus) {
  assertTsMemoryIdWriteAllowed(db, id);
  const now = Date.now();
  getUpdateMemoryVerificationStatement(db).run(verificationStatus, verificationStatus, now, now, id);
}
function updateMemoryContent2(db, id, content, normalizedHash) {
  const memory = assertTsMemoryIdWriteAllowed(db, id);
  db.transaction(() => {
    getUpdateMemoryContentStatement(db).run(content, normalizedHash, Date.now(), id);
    if (hasMemoryShareableColumn2(db)) {
      db.prepare("UPDATE memories SET shareable = 0 WHERE id = ?").run(id);
    }
    if (hasMemoryClassifiedAtColumn2(db)) {
      db.prepare("UPDATE memories SET classified_at = NULL WHERE id = ?").run(id);
    }
    if (hasMuralCueColumns(db)) {
      const rejectionReset = hasMuralCueRejectionCountColumn(db) ? ", mural_cue_rejection_count = 0" : "";
      db.prepare(`UPDATE memories SET mural_cue = NULL, mural_cue_hash = NULL, mural_cue_at = NULL${rejectionReset} WHERE id = ?`).run(id);
    }
    if (hasMemoryVerificationsTable(db)) {
      db.prepare("DELETE FROM memory_verifications WHERE memory_id = ?").run(id);
    }
    let stmt = deleteEmbeddingOnContentUpdateStatements.get(db);
    if (!stmt) {
      stmt = db.prepare("DELETE FROM memory_embeddings WHERE memory_id = ?");
      deleteEmbeddingOnContentUpdateStatements.set(db, stmt);
    }
    stmt.run(id);
  }).immediate();
  if (memory) {
    invalidateMemory2(memory.projectPath, id);
  }
}
function normalizeImportance(value) {
  if (!Number.isFinite(value))
    return 50;
  return Math.max(1, Math.min(100, Math.round(value)));
}
function setMemoryClassification2(db, id, classification) {
  const hasImportance = classification.importance !== undefined;
  const hasScope = classification.scope !== undefined;
  const hasShareable = classification.shareable !== undefined;
  if (!hasImportance && !hasScope && !hasShareable) {
    throw new Error("setMemoryClassification requires at least one supplied field");
  }
  const memory = assertTsMemoryIdWriteAllowed(db, id);
  if (!memory)
    return false;
  const assignments = [];
  const values = [];
  if (hasImportance) {
    const next = normalizeImportance(classification.importance);
    if (memory.importance !== next) {
      assignments.push("importance = ?");
      values.push(next);
    }
  }
  if (hasScope) {
    const next = classification.scope;
    if (!isMemoryScope(next)) {
      throw new Error(`invalid memory scope: ${String(next)}`);
    }
    if (memory.scope !== next) {
      assignments.push("scope = ?");
      values.push(next);
    }
  }
  if (hasShareable) {
    const next = classification.shareable ? 1 : 0;
    if ((memory.shareable ? 1 : 0) !== next) {
      assignments.push("shareable = ?");
      values.push(next);
    }
  }
  const fieldChanged = assignments.length > 0;
  if (hasMemoryClassifiedAtColumn2(db)) {
    assignments.push("classified_at = ?");
    values.push(Date.now());
  }
  if (assignments.length === 0)
    return false;
  db.prepare(`UPDATE memories SET ${assignments.join(", ")} WHERE id = ?`).run(...values, id);
  return fieldChanged;
}
function supersededMemory2(db, id, supersededById) {
  assertTsMemoryIdWriteAllowed(db, id);
  getSupersededMemoryStatement(db).run(supersededById, Date.now(), id);
}
function mergeMemoryStats2(db, id, seenCount, retrievalCount, mergedFrom, status) {
  assertTsMemoryIdWriteAllowed(db, id);
  getMergeMemoryStatsStatement(db).run(seenCount, retrievalCount, mergedFrom, status, Date.now(), id);
}
function archiveMemory2(db, id, reason) {
  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    updateMemoryStatus2(db, id, "archived");
    return;
  }
  const memory = assertTsMemoryIdWriteAllowed(db, id);
  if (!memory) {
    return;
  }
  getUpdateArchivedMemoryStatement(db).run(mergeMetadataJson(memory.metadataJson, { archive_reason: trimmedReason }), Date.now(), id);
}
function deleteMemory2(db, id) {
  const memory = assertTsMemoryIdWriteAllowed(db, id);
  db.transaction(() => {
    getDeleteMemoryEmbeddingStatement(db).run(id);
    getDeleteMemoryStatement(db).run(id);
  }).immediate();
  if (memory) {
    invalidateMemory2(memory.projectPath, id);
  }
}
function getMemoryCount2(db, projectPath) {
  const result = projectPath ? getMemoryCountByProjectStatement(db).get(projectPath) : getMemoryCountStatement(db).get();
  if (result === null || typeof result !== "object") {
    return 0;
  }
  const count = result.count;
  return typeof count === "number" ? count : 0;
}
function getMemoryCountsByStatus2(db, projectPath) {
  const rows = getMemoryCountsByStatusStatement(db).all(projectPath).filter(isMemoryCountByStatusRow);
  const counts = {
    total: rows.length,
    active: 0,
    permanent: 0,
    archived: 0,
    merged: 0,
    ids: [],
    archivedIds: [],
    mergedIds: []
  };
  for (const row of rows) {
    counts.ids.push(row.id);
    if (typeof row.superseded_by_memory_id === "number") {
      counts.merged += 1;
      counts.mergedIds.push(row.id);
    } else if (row.status === "active") {
      counts.active += 1;
    } else if (row.status === "permanent") {
      counts.permanent += 1;
    } else {
      counts.archived += 1;
      counts.archivedIds.push(row.id);
    }
  }
  counts.ids.sort((left, right) => left - right);
  counts.archivedIds.sort((left, right) => left - right);
  counts.mergedIds.sort((left, right) => left - right);
  return counts;
}

export { computeCueContentHash, hasMuralCueColumns, getMuralCueState, memoryNeedsCue, setMuralCue, recordMuralCueRejection, COLUMN_MAP2, hasMemoryShareableColumn2, hasMemoryClassifiedAtColumn2, getUnclassifiedMemoryIds2, getMemorySelectColumns2, isMemoryRow2, toMemory2, ModuleMemoryAuthorityError2, insertMemory2, insertMemoryIdempotent2, getMemoryByHash2, getMemoriesByProject2, getMemoriesForList2, buildWorkspaceMemorySqlFilter2, getMemoriesByProjects2, getMaxMemoryIdForProjects2, readNewMemoriesForM1Union2, getAllActiveMemoriesForMigration2, getMemoryById2, getMemoriesByIds2, updateMemorySeenCount2, updateMemoryRetrievalCount2, updateMemoryStatus2, updateMemoryVerification2, updateMemoryContent2, setMemoryClassification2, supersededMemory2, mergeMemoryStats2, archiveMemory2, deleteMemory2, getMemoryCount2, getMemoryCountsByStatus2 };
