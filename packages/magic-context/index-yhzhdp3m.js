// ../plugin/src/features/magic-context/memory/storage-memory-embeddings.ts
var saveEmbeddingStatements = new WeakMap;
var saveEmbeddingIfHashMatchesStatements = new WeakMap;
var loadAllEmbeddingsStatements = new WeakMap;
var deleteEmbeddingStatements = new WeakMap;
var getStoredModelIdStatements = new WeakMap;
var clearAllEmbeddingsStatements = new WeakMap;
var clearModelEmbeddingsStatements = new WeakMap;
function isEmbeddingBlob(value) {
  return value instanceof Uint8Array || value instanceof ArrayBuffer;
}
function isEmbeddingRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const candidate = row;
  return typeof candidate.memoryId === "number" && isEmbeddingBlob(candidate.embedding) && (candidate.modelId === null || typeof candidate.modelId === "string");
}
function toFloat32Array(blob) {
  if (blob instanceof Uint8Array) {
    const buffer = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
    return new Float32Array(buffer);
  }
  return new Float32Array(blob.slice(0));
}
function getSaveEmbeddingStatement(db) {
  let stmt = saveEmbeddingStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("INSERT INTO memory_embeddings (memory_id, embedding, model_id) VALUES (?, ?, ?) ON CONFLICT(memory_id, model_id) DO UPDATE SET embedding = excluded.embedding");
    saveEmbeddingStatements.set(db, stmt);
  }
  return stmt;
}
function getSaveEmbeddingIfHashMatchesStatement(db) {
  let stmt = saveEmbeddingIfHashMatchesStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("INSERT INTO memory_embeddings (memory_id, embedding, model_id) SELECT ?, ?, ? FROM memories WHERE id = ? AND normalized_hash = ? ON CONFLICT(memory_id, model_id) DO UPDATE SET embedding = excluded.embedding");
    saveEmbeddingIfHashMatchesStatements.set(db, stmt);
  }
  return stmt;
}
function getLoadAllEmbeddingsStatement(db) {
  let stmt = loadAllEmbeddingsStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT memory_embeddings.memory_id AS memoryId, memory_embeddings.embedding AS embedding, memory_embeddings.model_id AS modelId FROM memory_embeddings INNER JOIN memories ON memories.id = memory_embeddings.memory_id WHERE memories.project_path = ? AND memory_embeddings.model_id = ? ORDER BY memory_embeddings.memory_id ASC");
    loadAllEmbeddingsStatements.set(db, stmt);
  }
  return stmt;
}
function saveEmbedding(db, memoryId, embedding, modelId) {
  const blob = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  getSaveEmbeddingStatement(db).run(memoryId, blob, modelId);
}
function saveEmbeddingIfHashMatches(db, memoryId, embedding, modelId, normalizedHash) {
  const blob = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  return getSaveEmbeddingIfHashMatchesStatement(db).run(memoryId, blob, modelId, memoryId, normalizedHash).changes > 0;
}
function loadAllEmbeddings(db, projectPath, modelId) {
  const rows = getLoadAllEmbeddingsStatement(db).all(projectPath, modelId).filter(isEmbeddingRow);
  const embeddings = new Map;
  for (const row of rows) {
    embeddings.set(row.memoryId, {
      embedding: toFloat32Array(row.embedding),
      modelId: row.modelId
    });
  }
  return embeddings;
}
function getMemoryEmbedCoverage(db, projectPath, modelId) {
  const row = db.prepare(`SELECT
               COUNT(*) AS total,
               SUM(CASE WHEN EXISTS (
                   SELECT 1 FROM memory_embeddings e
                   WHERE e.memory_id = m.id AND e.model_id = ?
               ) THEN 1 ELSE 0 END) AS embedded
             FROM memories m
             WHERE m.project_path = ? AND m.status = 'active'`).get(modelId, projectPath);
  return {
    total: typeof row?.total === "number" ? row.total : 0,
    embedded: typeof row?.embedded === "number" ? row.embedded : 0
  };
}

// ../plugin/src/features/magic-context/memory/embedding-cache.ts
var DEFAULT_EMBEDDING_CACHE_TTL_MS = 60000;
var projectEmbeddingCache = new Map;
var embeddingCacheTtlMs = DEFAULT_EMBEDDING_CACHE_TTL_MS;
function cacheKey(projectPath, modelId) {
  return `${projectPath}\x00${modelId}`;
}
function getValidCacheEntry(projectPath, modelId) {
  const entry = projectEmbeddingCache.get(cacheKey(projectPath, modelId));
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    projectEmbeddingCache.delete(cacheKey(projectPath, modelId));
    return null;
  }
  return entry;
}
function getProjectEmbeddings2(db, projectPath, modelId) {
  const cached = getValidCacheEntry(projectPath, modelId);
  if (cached) {
    return cached.embeddings;
  }
  const embeddings = loadAllEmbeddings(db, projectPath, modelId);
  projectEmbeddingCache.set(cacheKey(projectPath, modelId), {
    embeddings,
    expiresAt: Date.now() + embeddingCacheTtlMs
  });
  return embeddings;
}
function peekProjectEmbeddings2(projectPath, modelId) {
  return getValidCacheEntry(projectPath, modelId)?.embeddings ?? null;
}
function invalidateProject2(projectPath) {
  for (const key of projectEmbeddingCache.keys()) {
    if (key.startsWith(`${projectPath}\x00`)) {
      projectEmbeddingCache.delete(key);
    }
  }
}
function invalidateMemory2(projectPath, memoryId) {
  for (const key of projectEmbeddingCache.keys()) {
    if (!key.startsWith(`${projectPath}\x00`))
      continue;
    const entry = projectEmbeddingCache.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      projectEmbeddingCache.delete(key);
      continue;
    }
    entry.embeddings.delete(memoryId);
  }
}
function resetEmbeddingCacheForTests2() {
  projectEmbeddingCache.clear();
  embeddingCacheTtlMs = DEFAULT_EMBEDDING_CACHE_TTL_MS;
}
function setEmbeddingCacheTtlForTests2(ttlMs) {
  embeddingCacheTtlMs = Math.max(0, Math.floor(ttlMs));
}

export { saveEmbedding, saveEmbeddingIfHashMatches, getMemoryEmbedCoverage, getProjectEmbeddings2, peekProjectEmbeddings2, invalidateProject2, invalidateMemory2, resetEmbeddingCacheForTests2, setEmbeddingCacheTtlForTests2 };
