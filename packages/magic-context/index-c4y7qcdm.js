import {
  getTokenEstimatorFingerprint,
  estimateTokens
} from "./index-vaah9fbg.js";
import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  log2
} from "./index-x3dcnxh0.js";
import {
  isSynapseEmbeddingTruncated
} from "./index-xkf1qyj1.js";
import {
  messageFtsOrdinalRangeIsMapped
} from "./index-j36vpt39.js";

// ../plugin/src/features/magic-context/compartment-chunk-embedding.ts
import { createHash } from "node:crypto";

// ../plugin/src/features/magic-context/recursive-text-splitter.ts
var DEFAULT_SEPARATORS = [`

`, `
`, " ", ""];
function splitOnSeparator(text, separator) {
  const splits = separator ? text.split(separator) : text.split("");
  return splits.filter((s) => s !== "");
}
function mergeSplits(splits, separator, chunkSize, lengthFunction) {
  const docs = [];
  const currentDoc = [];
  let total = 0;
  const joinDocs = (docsToJoin) => {
    const joined = docsToJoin.join(separator).trim();
    return joined === "" ? null : joined;
  };
  for (const d of splits) {
    const len = lengthFunction(d);
    if (total + len + currentDoc.length * separator.length > chunkSize) {
      if (currentDoc.length > 0) {
        const doc = joinDocs(currentDoc);
        if (doc !== null)
          docs.push(doc);
        while (total > 0 && currentDoc.length > 0) {
          total -= lengthFunction(currentDoc[0]);
          currentDoc.shift();
        }
      }
    }
    currentDoc.push(d);
    total += len;
  }
  const doc = joinDocs(currentDoc);
  if (doc !== null)
    docs.push(doc);
  return docs;
}
function splitTextRecursive(text, separators, chunkSize, lengthFunction) {
  const finalChunks = [];
  let separator = separators[separators.length - 1];
  let newSeparators;
  for (let i = 0;i < separators.length; i += 1) {
    const s = separators[i];
    if (s === "") {
      separator = s;
      break;
    }
    if (text.includes(s)) {
      separator = s;
      newSeparators = separators.slice(i + 1);
      break;
    }
  }
  const splits = splitOnSeparator(text, separator);
  let goodSplits = [];
  for (const s of splits) {
    if (lengthFunction(s) < chunkSize) {
      goodSplits.push(s);
    } else {
      if (goodSplits.length) {
        finalChunks.push(...mergeSplits(goodSplits, separator, chunkSize, lengthFunction));
        goodSplits = [];
      }
      if (!newSeparators) {
        finalChunks.push(s);
      } else {
        finalChunks.push(...splitTextRecursive(s, newSeparators, chunkSize, lengthFunction));
      }
    }
  }
  if (goodSplits.length) {
    finalChunks.push(...mergeSplits(goodSplits, separator, chunkSize, lengthFunction));
  }
  return finalChunks;
}
function recursiveCharacterSplit(text, options) {
  const chunkSize = options.chunkSize;
  const lengthFunction = options.lengthFunction ?? ((t) => t.length);
  const separators = options.separators ?? DEFAULT_SEPARATORS;
  if (text.length === 0)
    return [];
  return splitTextRecursive(text, separators, chunkSize, lengthFunction);
}

// ../plugin/src/features/magic-context/compartment-chunk-embedding.ts
var DEFAULT_COMPARTMENT_CHUNK_MAX_INPUT_TOKENS = 512;
var CHUNK_WINDOW_SAFETY_RATIO = 0.9;
var MESSAGE_FTS_CHUNK_LOAD_SQL = `SELECT map.message_ordinal AS messageOrdinal, fts.role, fts.content
 FROM message_fts_rowid_map AS map
 CROSS JOIN message_history_fts AS fts
   ON fts.rowid = map.fts_rowid
 WHERE map.session_id = ?
   AND map.message_ordinal BETWEEN ? AND ?
   AND fts.role IN ('user', 'assistant')
 ORDER BY map.message_ordinal ASC`;
var loadFtsRowsStatements = new WeakMap;
var searchPoolCompartmentStatements = new WeakMap;
var existingHashStatements = new WeakMap;
var existingHashByProjectStatements = new WeakMap;
var deleteByCompartmentStatements = new WeakMap;
var insertEmbeddingStatements = new WeakMap;
var renumberEmbeddingWindowStatements = new WeakMap;
var searchRowsStatements = new WeakMap;
var searchRowsByModelStatements = new WeakMap;
var datedSearchRowsByModelStatements = new WeakMap;
var searchPoolProbeStatements = new WeakMap;
var backfillCandidateStatements = new WeakMap;
var shadowBackfillCandidateStatements = new WeakMap;
var DECODED_SEARCH_POOL_CACHE_MAX_BYTES = 256 * 1024 * 1024;
var decodedSearchPools = new WeakMap;
var decodedSearchPoolLru = new Map;
var decodedSearchPoolBytes = 0;
function getLoadFtsRowsStatement(db) {
  let stmt = loadFtsRowsStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(MESSAGE_FTS_CHUNK_LOAD_SQL);
    loadFtsRowsStatements.set(db, stmt);
  }
  return stmt;
}
function getExistingHashStatement(db, scopedToProject) {
  const map = scopedToProject ? existingHashByProjectStatements : existingHashStatements;
  let stmt = map.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT window_index AS windowIndex, chunk_hash AS chunkHash
             FROM compartment_chunk_embeddings
             WHERE compartment_id = ?
               AND model_id = ?
               ${scopedToProject ? "AND project_path = ?" : ""}
             ORDER BY window_index ASC`);
    map.set(db, stmt);
  }
  return stmt;
}
function getDeleteByCompartmentStatement(db) {
  let stmt = deleteByCompartmentStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM compartment_chunk_embeddings WHERE compartment_id = ? AND model_id = ?");
    deleteByCompartmentStatements.set(db, stmt);
  }
  return stmt;
}
function getInsertEmbeddingStatement(db) {
  let stmt = insertEmbeddingStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`INSERT INTO compartment_chunk_embeddings (
                compartment_id, session_id, project_path, harness, window_index,
                start_ordinal, end_ordinal, chunk_hash, model_id, dims, vector, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertEmbeddingStatements.set(db, stmt);
  }
  return stmt;
}
function getRenumberEmbeddingWindowStatement(db) {
  let stmt = renumberEmbeddingWindowStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`UPDATE compartment_chunk_embeddings
             SET window_index = ?
             WHERE compartment_id = ?
               AND model_id = ?
               AND project_path = ?
               AND window_index = ?`);
    renumberEmbeddingWindowStatements.set(db, stmt);
  }
  return stmt;
}
function getSearchPoolProbeStatement(db) {
  let stmt = searchPoolProbeStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT COUNT(*) AS rowCount, MAX(id) AS maxRowId
             FROM compartment_chunk_embeddings
             WHERE session_id = ? AND project_path = ? AND model_id = ?`);
    searchPoolProbeStatements.set(db, stmt);
  }
  return stmt;
}
function getSearchPoolCompartmentStatement(db) {
  let stmt = searchPoolCompartmentStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT id, title, start_message AS startOrdinal, end_message AS endOrdinal
             FROM compartments
             WHERE id IN (
                 SELECT compartment_id FROM compartment_chunk_embeddings
                 WHERE session_id = ? AND project_path = ? AND model_id = ?
             )`);
    searchPoolCompartmentStatements.set(db, stmt);
  }
  return stmt;
}
function refreshPoolCompartmentFields(db, sessionId, projectPath, modelId, rows) {
  const current = new Map;
  for (const row of getSearchPoolCompartmentStatement(db).all(sessionId, projectPath, modelId)) {
    current.set(row.id, row);
  }
  let missing = false;
  for (const row of rows) {
    const compartment = current.get(row.compartmentId);
    if (!compartment) {
      missing = true;
      continue;
    }
    row.title = compartment.title;
    row.startOrdinal = compartment.startOrdinal;
    row.endOrdinal = compartment.endOrdinal;
  }
  return missing ? rows.filter((row) => current.has(row.compartmentId)) : rows;
}
function getSearchRowsStatement(db, withModel) {
  const map = withModel ? searchRowsByModelStatements : searchRowsStatements;
  let stmt = map.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT e.compartment_id AS compartmentId,
                    e.session_id AS sessionId,
                    c.title AS title,
                    c.start_message AS compartmentStart,
                    c.end_message AS compartmentEnd,
                    e.window_index AS windowIndex,
                    e.start_ordinal AS windowStart,
                    e.end_ordinal AS windowEnd,
                    e.chunk_hash AS chunkHash,
                    e.model_id AS modelId,
                    e.dims AS dims,
                    e.vector AS vector
             FROM compartment_chunk_embeddings e
             JOIN compartments c ON c.id = e.compartment_id
             WHERE e.session_id = ?
               AND e.project_path = ?
               ${withModel ? "AND e.model_id = ?" : ""}
             ORDER BY e.compartment_id ASC, e.window_index ASC`);
    map.set(db, stmt);
  }
  return stmt;
}
function getDatedSearchRowsByModelStatement(db) {
  let statement = datedSearchRowsByModelStatements.get(db);
  if (!statement) {
    statement = db.prepare(`SELECT e.compartment_id AS compartmentId,
                    e.session_id AS sessionId,
                    c.title AS title,
                    c.start_message AS compartmentStart,
                    c.end_message AS compartmentEnd,
                    e.window_index AS windowIndex,
                    e.start_ordinal AS windowStart,
                    e.end_ordinal AS windowEnd,
                    e.chunk_hash AS chunkHash,
                    e.model_id AS modelId,
                    e.dims AS dims,
                    e.vector AS vector
               FROM compartment_chunk_embeddings e
               JOIN compartments c ON c.id = e.compartment_id
               JOIN message_fts_rowid_map AS start_map
                 ON start_map.session_id = c.session_id
                AND start_map.message_ordinal = c.start_message
               JOIN message_fts_rowid_map AS end_map
                 ON end_map.session_id = c.session_id
                AND end_map.message_ordinal = c.end_message
              WHERE e.session_id = ?
                AND e.project_path = ?
                AND e.model_id = ?
                AND start_map.message_time_ms <= ?
                AND end_map.message_time_ms >= ?
              ORDER BY e.compartment_id ASC, e.window_index ASC`);
    datedSearchRowsByModelStatements.set(db, statement);
  }
  return statement;
}
function getBackfillCandidateStatement(db) {
  let stmt = backfillCandidateStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT c.id AS id,
                    c.session_id AS sessionId,
                    c.start_message AS startMessage,
                    c.end_message AS endMessage,
                    c.title AS title
             FROM compartments c
             JOIN session_projects sp
               ON sp.session_id = c.session_id
              AND sp.harness = c.harness
              AND sp.project_path = ?
             WHERE c.start_message IS NOT NULL
               AND c.end_message IS NOT NULL
             ORDER BY c.created_at DESC, c.id DESC`);
    backfillCandidateStatements.set(db, stmt);
  }
  return stmt;
}
function getShadowBackfillCandidateStatement(db) {
  let stmt = shadowBackfillCandidateStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT c.id AS id,
                    c.session_id AS sessionId,
                    c.start_message AS startMessage,
                    c.end_message AS endMessage,
                    c.title AS title
             FROM compartments c
             JOIN session_projects sp
               ON sp.session_id = c.session_id
              AND sp.harness = c.harness
              AND sp.project_path = ?
             WHERE c.start_message IS NOT NULL
               AND c.end_message IS NOT NULL
               AND EXISTS (
                   SELECT 1
                   FROM compartment_chunk_embeddings primary_chunks
                   WHERE primary_chunks.compartment_id = c.id
                     AND primary_chunks.project_path = ?
                     AND primary_chunks.model_id = ?
               )
             ORDER BY c.created_at DESC, c.id DESC`);
    shadowBackfillCandidateStatements.set(db, stmt);
  }
  return stmt;
}
function searchPoolKey(sessionId, projectPath, modelId) {
  return JSON.stringify([sessionId, projectPath, modelId]);
}
function getDecodedSearchPool(db) {
  let pool = decodedSearchPools.get(db);
  if (!pool) {
    pool = new Map;
    decodedSearchPools.set(db, pool);
  }
  return pool;
}
function removeDecodedSearchPoolEntry(entry) {
  if (entry.pool.get(entry.key) === entry) {
    entry.pool.delete(entry.key);
  }
  if (decodedSearchPoolLru.delete(entry)) {
    decodedSearchPoolBytes -= entry.byteSize;
  }
}
function touchDecodedSearchPoolEntry(entry) {
  decodedSearchPoolLru.delete(entry);
  decodedSearchPoolLru.set(entry, true);
}
function estimateDecodedSearchPoolBytes(rows) {
  let bytes = 0;
  for (const row of rows) {
    bytes += row.vector.byteLength + 256 + 2 * (row.sessionId.length + row.title.length + row.chunkHash.length + row.modelId.length);
  }
  return bytes;
}
function cacheDecodedSearchPool(pool, key, rowCount, maxRowId, rows) {
  const existing = pool.get(key);
  if (existing)
    removeDecodedSearchPoolEntry(existing);
  const entry = {
    pool,
    key,
    rowCount,
    maxRowId,
    rows,
    byteSize: estimateDecodedSearchPoolBytes(rows)
  };
  pool.set(key, entry);
  decodedSearchPoolLru.set(entry, true);
  decodedSearchPoolBytes += entry.byteSize;
  while (decodedSearchPoolBytes > DECODED_SEARCH_POOL_CACHE_MAX_BYTES) {
    const oldest = decodedSearchPoolLru.keys().next().value;
    if (!oldest)
      break;
    removeDecodedSearchPoolEntry(oldest);
  }
}
function invalidateDecodedSearchPools(db, predicate) {
  const pool = decodedSearchPools.get(db);
  if (!pool)
    return;
  for (const [key, entry] of [...pool.entries()]) {
    const parsed = JSON.parse(key);
    if (predicate(parsed))
      removeDecodedSearchPoolEntry(entry);
  }
}
function isFinitePositiveInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function normalizeCompartmentChunkMaxInputTokens(value) {
  if (!isFinitePositiveInteger(value)) {
    return DEFAULT_COMPARTMENT_CHUNK_MAX_INPUT_TOKENS;
  }
  return Math.max(1, Math.floor(value));
}
function normalizeContent(text) {
  return text.replace(/\s+/g, " ").trim();
}
function formatOrdinalRange(start, end) {
  return start === end ? `[${start}]` : `[${start}-${end}]`;
}
function rolePrefix(role) {
  if (role === "user")
    return "U";
  if (role === "assistant")
    return "A";
  return null;
}
function parseOrdinal(value) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function parseCanonicalLineRange(line) {
  const match = /^\[(\d+)(?:-(\d+))?\]\s+[UA]:/.exec(line.trim());
  if (!match)
    return null;
  const start = Number.parseInt(match[1], 10);
  const end = match[2] ? Number.parseInt(match[2], 10) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end))
    return null;
  return { start, end };
}
function assertOrdinalRangeWithinCompartment(rangeStart, rangeEnd, compartmentStart, compartmentEnd) {
  if (rangeStart < compartmentStart || rangeEnd > compartmentEnd || rangeEnd < rangeStart) {
    throw new RangeError(`Canonical chunk range ${rangeStart}-${rangeEnd} lies outside compartment ${compartmentStart}-${compartmentEnd}`);
  }
}
function hashChunkText(text) {
  return createHash("sha256").update(text).digest("hex");
}
function vectorBlob(vector) {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}
function toFloat32Array(blob) {
  if (blob instanceof Uint8Array) {
    const buffer = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
    return new Float32Array(buffer);
  }
  return new Float32Array(blob.slice(0));
}
function buildCanonicalChunkTextFromFts(db, sessionId, startOrdinal, endOrdinal) {
  if (endOrdinal < startOrdinal)
    return "";
  if (!messageFtsOrdinalRangeIsMapped(db, sessionId, startOrdinal, endOrdinal))
    return null;
  const rows = getLoadFtsRowsStatement(db).all(sessionId, startOrdinal, endOrdinal).map((row) => row);
  const lines = [];
  let current = null;
  const flush = () => {
    if (!current || current.parts.length === 0)
      return;
    lines.push(`${formatOrdinalRange(current.start, current.end)} ${current.role}: ${current.parts.join(" / ")}`);
    current = null;
  };
  for (const row of rows) {
    const ordinal = parseOrdinal(row.messageOrdinal);
    const prefix = rolePrefix(row.role);
    const content = typeof row.content === "string" ? normalizeContent(row.content) : "";
    if (ordinal === null || prefix === null || content.length === 0)
      continue;
    if (current && current.role === prefix) {
      current.end = ordinal;
      current.parts.push(content);
      continue;
    }
    flush();
    current = { role: prefix, start: ordinal, end: ordinal, parts: [content] };
  }
  flush();
  return lines.join(`
`);
}
function buildCompartmentSummaryFallbackText(db, compartmentId) {
  const row = db.prepare("SELECT title, p1, content FROM compartments WHERE id = ?").get(compartmentId);
  if (!row)
    return "";
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const p1 = typeof row.p1 === "string" ? row.p1.trim() : "";
  const body = p1.length > 0 ? p1 : typeof row.content === "string" ? row.content.trim() : "";
  return [title, body].filter((s) => s.length > 0).join(`
`);
}
function canonicalizeInMemoryChunkTextForEmbedding(chunkText, startOrdinal, endOrdinal) {
  const lines = [];
  for (const rawLine of chunkText.split(/\r?\n/)) {
    const line = rawLine.trim();
    const match = /^(\[(\d+)(?:-(\d+))?\]\s+[UA]:)\s*(.*)$/.exec(line);
    if (!match)
      continue;
    const lineStart = Number.parseInt(match[2], 10);
    const lineEnd = match[3] ? Number.parseInt(match[3], 10) : lineStart;
    if (startOrdinal != null && lineEnd < startOrdinal)
      continue;
    if (endOrdinal != null && lineStart > endOrdinal)
      continue;
    const rawParts = match[4].split(" / ").map((part) => normalizeContent(part)).filter((part) => part.length > 0);
    const ordinalSpan = lineEnd - lineStart + 1;
    const roleLabel = match[1].slice(match[1].indexOf("]") + 2);
    if (ordinalSpan === rawParts.length) {
      const retained = rawParts.map((part, index) => ({ ordinal: lineStart + index, part })).filter(({ ordinal, part }) => {
        if (part.startsWith("TC:"))
          return false;
        if (startOrdinal != null && ordinal < startOrdinal)
          return false;
        if (endOrdinal != null && ordinal > endOrdinal)
          return false;
        return true;
      });
      if (retained.length === 0)
        continue;
      const retainedStart = retained[0].ordinal;
      const retainedEnd = retained[retained.length - 1].ordinal;
      lines.push(`${formatOrdinalRange(retainedStart, retainedEnd)} ${roleLabel} ${retained.map(({ part }) => part).join(" / ")}`);
      continue;
    }
    const clipsRequestedRange = startOrdinal != null && lineStart < startOrdinal || endOrdinal != null && lineEnd > endOrdinal;
    if (clipsRequestedRange) {
      return "";
    }
    const parts = rawParts.filter((part) => !part.startsWith("TC:"));
    if (parts.length === 0)
      continue;
    lines.push(`${match[1]} ${parts.join(" / ")}`);
  }
  return lines.join(`
`);
}
function chunkCanonicalText(canonicalText, startOrdinal, endOrdinal, maxInputTokens) {
  const lines = canonicalText.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0 || endOrdinal < startOrdinal)
    return [];
  for (const line of lines) {
    const range = parseCanonicalLineRange(line);
    if (range) {
      assertOrdinalRangeWithinCompartment(range.start, range.end, startOrdinal, endOrdinal);
    }
  }
  const normalizedMax = normalizeCompartmentChunkMaxInputTokens(maxInputTokens);
  const effectiveMax = Math.max(1, Math.floor(normalizedMax * CHUNK_WINDOW_SAFETY_RATIO));
  const fullText = lines.join(`
`);
  if (estimateTokens(fullText) <= effectiveMax) {
    return [
      {
        windowIndex: 0,
        startOrdinal,
        endOrdinal,
        text: fullText,
        chunkHash: hashChunkText(fullText)
      }
    ];
  }
  const windows = [];
  let currentLines = [];
  let currentStart = null;
  let currentEnd = null;
  let currentTokens = 0;
  const flush = () => {
    if (currentLines.length === 0 || currentStart === null || currentEnd === null)
      return;
    const text = currentLines.join(`
`);
    assertOrdinalRangeWithinCompartment(currentStart, currentEnd, startOrdinal, endOrdinal);
    windows.push({
      windowIndex: windows.length,
      startOrdinal: currentStart,
      endOrdinal: currentEnd,
      text,
      chunkHash: hashChunkText(text)
    });
    currentLines = [];
    currentStart = null;
    currentEnd = null;
    currentTokens = 0;
  };
  for (const line of lines) {
    const range = parseCanonicalLineRange(line);
    const lineStart = range?.start ?? startOrdinal;
    const lineEnd = range?.end ?? lineStart;
    const lineTokens = estimateTokens(line);
    if (lineTokens > effectiveMax) {
      flush();
      for (const slice of splitOversizedLine(line, effectiveMax)) {
        assertOrdinalRangeWithinCompartment(lineStart, lineEnd, startOrdinal, endOrdinal);
        windows.push({
          windowIndex: windows.length,
          startOrdinal: lineStart,
          endOrdinal: lineEnd,
          text: slice,
          chunkHash: hashChunkText(slice)
        });
      }
      continue;
    }
    if (currentLines.length > 0 && currentTokens + lineTokens > effectiveMax) {
      flush();
    }
    if (currentLines.length === 0) {
      currentStart = lineStart;
    }
    currentLines.push(line);
    currentEnd = lineEnd;
    currentTokens += lineTokens;
  }
  flush();
  return windows;
}
function splitOversizedLine(line, effectiveMax) {
  let slices = [];
  try {
    slices = recursiveCharacterSplit(line, {
      chunkSize: effectiveMax,
      lengthFunction: estimateTokens
    });
  } catch (error) {
    log2("[magic-context] recursiveCharacterSplit failed; using char-budget fallback:", error);
    slices = [];
  }
  if (slices.length === 0) {
    slices = charBudgetSplit(line, effectiveMax);
  }
  const safe = [];
  const pushChecked = (slice) => {
    if (estimateTokens(slice) > effectiveMax && slice.length > 1) {
      safe.push(...charBudgetSplit(slice, effectiveMax));
      return;
    }
    safe.push(slice);
  };
  for (const slice of slices) {
    if (estimateTokens(slice) <= effectiveMax) {
      safe.push(slice);
    } else {
      for (const sub of charBudgetSplit(slice, effectiveMax))
        pushChecked(sub);
    }
  }
  return safe.filter((s) => s.length > 0);
}
function charBudgetSplit(text, effectiveMax) {
  const totalTokens = Math.max(1, estimateTokens(text));
  const charsPerToken = Math.max(1, Math.floor(text.length / totalTokens));
  const sliceChars = Math.max(1, effectiveMax * charsPerToken);
  const out = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(text.length, pos + sliceChars);
    let slice = text.slice(pos, end);
    while (slice.length > 1 && estimateTokens(slice) > effectiveMax) {
      end = pos + Math.max(1, Math.floor((end - pos) / 2));
      slice = text.slice(pos, end);
    }
    out.push(slice);
    pos = end;
  }
  return out;
}
function getExistingChunkHashes(db, compartmentId, modelId, projectPath) {
  const scoped = typeof projectPath === "string" && projectPath.length > 0;
  const rows = scoped ? getExistingHashStatement(db, true).all(compartmentId, modelId, projectPath) : getExistingHashStatement(db, false).all(compartmentId, modelId);
  return new Map(rows.filter((row) => typeof row.windowIndex === "number" && typeof row.chunkHash === "string").map((row) => [row.windowIndex, row.chunkHash]));
}
function chunkEmbeddingWindowsAreCurrent(db, compartmentId, modelId, windows, projectPath) {
  const existing = getExistingChunkHashes(db, compartmentId, modelId, projectPath);
  if (existing.size !== windows.length)
    return false;
  return windows.every((window) => existing.get(window.windowIndex) === window.chunkHash);
}
function replaceCompartmentChunkEmbeddings(db, rows, windowSourceKey) {
  if (rows.length === 0 || rows.some((row) => isSynapseEmbeddingTruncated(row.vector)))
    return;
  const compartmentId = rows[0].compartmentId;
  const modelId = rows[0].modelId;
  const now = Date.now();
  db.transaction(() => {
    getDeleteByCompartmentStatement(db).run(compartmentId, modelId);
    const insert = getInsertEmbeddingStatement(db);
    for (const row of rows) {
      insert.run(row.compartmentId, row.sessionId, row.projectPath, getHarness2(), row.window.windowIndex, row.window.startOrdinal, row.window.endOrdinal, row.window.chunkHash, row.modelId, row.vector.length, vectorBlob(row.vector), row.createdAt ?? now);
    }
    if (windowSourceKey) {
      recordChunkWindowSource(db, compartmentId, windowSourceKey, rows.map((row) => [row.window.windowIndex, row.window.chunkHash]));
    }
  }).immediate();
  invalidateDecodedSearchPools(db, ([sessionId, projectPath, cachedModelId]) => sessionId === rows[0].sessionId && projectPath === rows[0].projectPath && cachedModelId === modelId);
}
function loadCompartmentChunkEmbeddingsForSearch(db, sessionId, projectPath, modelId, dateRange = null) {
  if (!modelId) {
    throw new Error("loadCompartmentChunkEmbeddingsForSearch requires a current model id");
  }
  if (dateRange !== null) {
    const rows = getDatedSearchRowsByModelStatement(db).all(sessionId, projectPath, modelId, dateRange.to, dateRange.from);
    return rows.filter((row) => typeof row.compartmentId === "number" && typeof row.sessionId === "string" && typeof row.title === "string" && typeof row.compartmentStart === "number" && typeof row.compartmentEnd === "number" && typeof row.windowIndex === "number" && typeof row.windowStart === "number" && typeof row.windowEnd === "number" && typeof row.chunkHash === "string" && typeof row.modelId === "string" && typeof row.dims === "number" && (row.vector instanceof Uint8Array || row.vector instanceof ArrayBuffer)).map((row) => ({
      compartmentId: row.compartmentId,
      sessionId: row.sessionId,
      title: row.title,
      startOrdinal: row.compartmentStart,
      endOrdinal: row.compartmentEnd,
      windowIndex: row.windowIndex,
      windowStartOrdinal: row.windowStart,
      windowEndOrdinal: row.windowEnd,
      chunkHash: row.chunkHash,
      modelId: row.modelId,
      dims: row.dims,
      vector: toFloat32Array(row.vector)
    }));
  }
  const key = searchPoolKey(sessionId, projectPath, modelId);
  const pool = getDecodedSearchPool(db);
  const probe = getSearchPoolProbeStatement(db).get(sessionId, projectPath, modelId);
  const rowCount = typeof probe?.rowCount === "number" ? probe.rowCount : 0;
  const maxRowId = typeof probe?.maxRowId === "number" ? probe.maxRowId : 0;
  const cached = pool.get(key);
  if (cached && cached.rowCount === rowCount && cached.maxRowId === maxRowId) {
    touchDecodedSearchPoolEntry(cached);
    return refreshPoolCompartmentFields(db, sessionId, projectPath, modelId, cached.rows);
  }
  if (cached)
    removeDecodedSearchPoolEntry(cached);
  const rows = getSearchRowsStatement(db, true).all(sessionId, projectPath, modelId);
  const decodedRows = rows.filter((row) => typeof row.compartmentId === "number" && typeof row.sessionId === "string" && typeof row.title === "string" && typeof row.compartmentStart === "number" && typeof row.compartmentEnd === "number" && typeof row.windowIndex === "number" && typeof row.windowStart === "number" && typeof row.windowEnd === "number" && typeof row.chunkHash === "string" && typeof row.modelId === "string" && typeof row.dims === "number" && (row.vector instanceof Uint8Array || row.vector instanceof ArrayBuffer)).map((row) => ({
    compartmentId: row.compartmentId,
    sessionId: row.sessionId,
    title: row.title,
    startOrdinal: row.compartmentStart,
    endOrdinal: row.compartmentEnd,
    windowIndex: row.windowIndex,
    windowStartOrdinal: row.windowStart,
    windowEndOrdinal: row.windowEnd,
    chunkHash: row.chunkHash,
    modelId: row.modelId,
    dims: row.dims,
    vector: toFloat32Array(row.vector)
  }));
  cacheDecodedSearchPool(pool, key, rowCount, maxRowId, decodedRows);
  return decodedRows;
}
function loadUnembeddedShadowChunkCandidates(db, projectPath, primaryModelId, shadowModelId, limit, shadowMaxInputTokens) {
  const rows = getShadowBackfillCandidateStatement(db).all(projectPath, projectPath, primaryModelId);
  return selectHashIncompleteChunkCandidates(db, projectPath, shadowModelId, mapBackfillCandidateRows(rows), Math.max(1, limit), shadowMaxInputTokens);
}
async function loadUnembeddedCompartmentChunkCandidatesPolite(db, projectPath, modelId, limit, maxInputTokens = DEFAULT_COMPARTMENT_CHUNK_MAX_INPUT_TOKENS, leaseHeldRenumber = false) {
  const rows = getBackfillCandidateStatement(db).all(projectPath);
  const candidates = mapBackfillCandidateRows(rows);
  const missing = [];
  const stale = [];
  let sliceStarted = performance.now();
  for (const candidate of candidates) {
    const classification = classifyChunkCoverageDefect(db, projectPath, modelId, candidate, maxInputTokens);
    if (classification.defect === "missing")
      missing.push(candidate);
    else if (classification.defect === "stale")
      stale.push(candidate);
    else if (leaseHeldRenumber) {
      applyLeaseHeldCoverageRepair(db, candidate, projectPath, modelId, classification);
    }
    sliceStarted = await yieldCoverageSlice(sliceStarted);
  }
  return [...missing, ...stale].slice(0, Math.max(1, limit));
}
function mapBackfillCandidateRows(rows) {
  return rows.filter((row) => {
    if (row === null || typeof row !== "object")
      return false;
    const candidate = row;
    return typeof candidate.id === "number" && typeof candidate.sessionId === "string" && typeof candidate.startMessage === "number" && typeof candidate.endMessage === "number" && typeof candidate.title === "string";
  }).map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    startMessage: row.startMessage,
    endMessage: row.endMessage,
    title: row.title
  }));
}
var CHUNKER_VERSION = 1;
var BACKOFF_PREFIX = "chunk_embed_backoff:";
function backoffKey(compartmentId) {
  return `${BACKOFF_PREFIX}${compartmentId}`;
}
function deleteChunkEmbedBackoffForSession(db, sessionId) {
  db.prepare(`DELETE FROM schema_migrations_meta WHERE key IN (
        SELECT ? || id FROM compartments WHERE session_id = ?
        UNION ALL
        SELECT ? || id FROM compartments WHERE session_id = ?
    )`).run(BACKOFF_PREFIX, sessionId, WINDOW_SOURCE_PREFIX, sessionId);
}
function recordChunkEmbedBackoff(db, candidate, projectPath, modelId) {
  const mapped = buildCanonicalChunkTextFromFts(db, candidate.sessionId, candidate.startMessage, candidate.endMessage);
  if (mapped === null)
    return;
  const text = mapped || buildCompartmentSummaryFallbackText(db, candidate.id);
  const hash = createHash("sha256").update(text).digest("hex");
  const key = backoffKey(candidate.id);
  const prior = db.prepare("SELECT value FROM schema_migrations_meta WHERE key = ?").get(key);
  let retries = 0;
  try {
    const value = JSON.parse(prior?.value ?? "null");
    if (value?.hash === hash && value.project === projectPath && value.model === modelId) {
      retries = Math.max(0, Math.min(12, value.retries ?? 0));
    }
  } catch {}
  db.prepare(`INSERT INTO schema_migrations_meta (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify({
    hash,
    project: projectPath,
    model: modelId,
    retries: retries + 1,
    retryAt: Date.now() + Math.min(86400000, 60000 * 2 ** retries)
  }));
}
function chunkEmbedBackoffActive(db, candidate, projectPath, modelId, text) {
  const row = db.prepare("SELECT value FROM schema_migrations_meta WHERE key = ?").get(backoffKey(candidate.id));
  if (!row)
    return false;
  try {
    const value = JSON.parse(row.value);
    return value.project === projectPath && value.model === modelId && value.hash === createHash("sha256").update(text).digest("hex") && value.retryAt > Date.now();
  } catch {
    return false;
  }
}
var WINDOW_SOURCE_PREFIX = "chunk_embed_windows:";
var WINDOW_SOURCE_RECORD_LIMIT = 4;
var windowSourceReadStatements = new WeakMap;
var windowSourceWriteStatements = new WeakMap;
function windowSourceMetaKey(compartmentId) {
  return `${WINDOW_SOURCE_PREFIX}${compartmentId}`;
}
function windowSourceKeyFromTextHash(textHash, startOrdinal, endOrdinal, maxInputTokens) {
  return hashChunkText(JSON.stringify([
    CHUNKER_VERSION,
    getTokenEstimatorFingerprint(),
    normalizeCompartmentChunkMaxInputTokens(maxInputTokens),
    startOrdinal,
    endOrdinal,
    textHash
  ]));
}
function chunkWindowSourceKey(canonicalText, startOrdinal, endOrdinal, maxInputTokens) {
  return windowSourceKeyFromTextHash(hashChunkText(canonicalText), startOrdinal, endOrdinal, maxInputTokens);
}
function windowSetDigest(windows) {
  const sorted = [...windows].sort((a, b) => a[0] - b[0]);
  return hashChunkText(sorted.map(([index, hash]) => `${index}:${hash}`).join(`
`));
}
function readChunkWindowSources(db, compartmentId) {
  let stmt = windowSourceReadStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT value FROM schema_migrations_meta WHERE key = ?");
    windowSourceReadStatements.set(db, stmt);
  }
  const row = stmt.get(windowSourceMetaKey(compartmentId));
  if (typeof row?.value !== "string")
    return [];
  try {
    const parsed = JSON.parse(row.value);
    if (!Array.isArray(parsed))
      return [];
    return parsed.filter((entry) => entry !== null && typeof entry === "object" && typeof entry.source === "string" && typeof entry.windows === "string");
  } catch {
    return [];
  }
}
function recordChunkWindowSource(db, compartmentId, sourceKey, windows) {
  const record = {
    source: sourceKey,
    windows: windowSetDigest(windows)
  };
  const kept = readChunkWindowSources(db, compartmentId).filter((entry) => entry.source !== sourceKey);
  let stmt = windowSourceWriteStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`INSERT INTO schema_migrations_meta (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    windowSourceWriteStatements.set(db, stmt);
  }
  stmt.run(windowSourceMetaKey(compartmentId), JSON.stringify([record, ...kept].slice(0, WINDOW_SOURCE_RECORD_LIMIT)));
}
function storedWindowsMatchRecordedSource(db, compartmentId, sourceKey, existing) {
  const record = readChunkWindowSources(db, compartmentId).find((entry) => entry.source === sourceKey);
  return record !== undefined && record.windows === windowSetDigest(existing);
}
var COVERAGE_MEMO_LIMIT = 2048;
var cachedCoverageWindows = new Map;
function memoizedCoverageWindows(candidate, canonicalText, sourceKey, modelId, maxInputTokens) {
  const key = JSON.stringify([candidate.id, sourceKey, modelId]);
  const cached = cachedCoverageWindows.get(key);
  if (cached) {
    cachedCoverageWindows.delete(key);
    cachedCoverageWindows.set(key, cached);
    return cached;
  }
  const windows = chunkCanonicalText(canonicalText, candidate.startMessage, candidate.endMessage, maxInputTokens);
  cachedCoverageWindows.set(key, windows);
  if (cachedCoverageWindows.size > COVERAGE_MEMO_LIMIT) {
    const oldest = cachedCoverageWindows.keys().next().value;
    if (oldest !== undefined)
      cachedCoverageWindows.delete(oldest);
  }
  return windows;
}
async function yieldCoverageSlice(started) {
  if (performance.now() - started < 35)
    return started;
  await new Promise((resolve) => setTimeout(resolve, 0));
  return performance.now();
}
function renumberOneBasedChunkWindows(db, candidate, projectPath, modelId, windows, sourceKey) {
  const update = getRenumberEmbeddingWindowStatement(db);
  db.transaction(() => {
    for (const window of windows) {
      const result = update.run(window.windowIndex, candidate.id, modelId, projectPath, window.windowIndex + 1);
      if (result.changes !== 1) {
        throw new Error(`Failed to renumber compartment ${candidate.id} window ${window.windowIndex + 1}`);
      }
    }
    if (sourceKey) {
      recordChunkWindowSource(db, candidate.id, sourceKey, windows.map((window) => [window.windowIndex, window.chunkHash]));
    }
  }).immediate();
  invalidateDecodedSearchPools(db, ([sessionId, cachedProjectPath, cachedModelId]) => sessionId === candidate.sessionId && cachedProjectPath === projectPath && cachedModelId === modelId);
}
function classifyChunkCoverageDefect(db, projectPath, modelId, candidate, maxInputTokens) {
  const mappedText = buildCanonicalChunkTextFromFts(db, candidate.sessionId, candidate.startMessage, candidate.endMessage);
  if (mappedText === null)
    return { defect: "deferred", windows: [] };
  const canonicalText = mappedText || buildCompartmentSummaryFallbackText(db, candidate.id);
  if (!canonicalText || chunkEmbedBackoffActive(db, candidate, projectPath, modelId, canonicalText)) {
    return { defect: "deferred", windows: [] };
  }
  const sourceKey = chunkWindowSourceKey(canonicalText, candidate.startMessage, candidate.endMessage, maxInputTokens);
  const existing = getExistingChunkHashes(db, candidate.id, modelId, projectPath);
  if (storedWindowsMatchRecordedSource(db, candidate.id, sourceKey, existing)) {
    return { defect: null, windows: [], sourceKey, confirmedByRecord: true };
  }
  const windows = memoizedCoverageWindows(candidate, canonicalText, sourceKey, modelId, maxInputTokens);
  const isMatchingOneBasedSet = windows.length > 0 && existing.size === windows.length && windows.every((window) => existing.get(window.windowIndex + 1) === window.chunkHash);
  if (isMatchingOneBasedSet)
    return { defect: "renumber", windows, sourceKey };
  const expectedWindowIndexes = new Set(windows.map((window) => window.windowIndex));
  if ([...existing.keys()].some((windowIndex) => !expectedWindowIndexes.has(windowIndex))) {
    return { defect: "stale", windows, sourceKey };
  }
  if (windows.some((window) => !existing.has(window.windowIndex))) {
    return { defect: "missing", windows, sourceKey };
  }
  if (existing.size !== windows.length || windows.some((window) => existing.get(window.windowIndex) !== window.chunkHash)) {
    return { defect: "stale", windows, sourceKey };
  }
  return { defect: null, windows, sourceKey };
}
function applyLeaseHeldCoverageRepair(db, candidate, projectPath, modelId, classification) {
  const { defect, windows, sourceKey, confirmedByRecord } = classification;
  if (defect === "renumber") {
    renumberOneBasedChunkWindows(db, candidate, projectPath, modelId, windows, sourceKey);
  } else if (defect === null && !confirmedByRecord && sourceKey) {
    db.transaction(() => {
      recordChunkWindowSource(db, candidate.id, sourceKey, windows.map((window) => [window.windowIndex, window.chunkHash]));
    }).immediate();
  }
}
function selectHashIncompleteChunkCandidates(db, projectPath, modelId, candidates, limit, maxInputTokens, leaseHeldRenumber = false) {
  const missing = [];
  const stale = [];
  for (const candidate of candidates) {
    const classification = classifyChunkCoverageDefect(db, projectPath, modelId, candidate, maxInputTokens);
    if (classification.defect === "missing")
      missing.push(candidate);
    else if (classification.defect === "stale")
      stale.push(candidate);
    else if (leaseHeldRenumber) {
      applyLeaseHeldCoverageRepair(db, candidate, projectPath, modelId, classification);
    }
  }
  return [...missing, ...stale].slice(0, limit);
}
var sessionBackfillCandidateStatements = new WeakMap;
async function loadUnembeddedSessionChunkCandidatesPolite(db, projectPath, sessionId, modelId, limit, excludeIds = [], maxInputTokens = DEFAULT_COMPARTMENT_CHUNK_MAX_INPUT_TOKENS, leaseHeldRenumber = false) {
  const excluded = new Set(excludeIds);
  const missing = [];
  const stale = [];
  let started = performance.now();
  for (const candidate of getSessionBackfillRows(db, projectPath, sessionId)) {
    if (excluded.has(candidate.id))
      continue;
    const classification = classifyChunkCoverageDefect(db, projectPath, modelId, candidate, maxInputTokens);
    if (classification.defect === "missing")
      missing.push(candidate);
    else if (classification.defect === "stale")
      stale.push(candidate);
    else if (leaseHeldRenumber) {
      applyLeaseHeldCoverageRepair(db, candidate, projectPath, modelId, classification);
    }
    started = await yieldCoverageSlice(started);
  }
  return [...missing, ...stale].slice(0, Math.max(1, limit));
}
function countSessionCompartmentEmbedCoverage(db, projectPath, sessionId, modelId, maxInputTokens = DEFAULT_COMPARTMENT_CHUNK_MAX_INPUT_TOKENS) {
  const candidates = getSessionBackfillRows(db, projectPath, sessionId);
  let embedded = 0;
  for (const candidate of candidates) {
    const { defect } = classifyChunkCoverageDefect(db, projectPath, modelId, candidate, maxInputTokens);
    if (defect === null || defect === "renumber")
      embedded += 1;
  }
  return { embedded, total: candidates.length };
}
function getSessionBackfillRows(db, projectPath, sessionId) {
  const rows = db.prepare(`SELECT c.id AS id,
                    c.session_id AS sessionId,
                    c.start_message AS startMessage,
                    c.end_message AS endMessage,
                    c.title AS title
             FROM compartments c
             JOIN session_projects sp
               ON sp.session_id = c.session_id
              AND sp.harness = c.harness
              AND sp.project_path = ?
             WHERE c.session_id = ?
               AND c.start_message IS NOT NULL
               AND c.end_message IS NOT NULL
             ORDER BY c.start_message ASC, c.id ASC`).all(projectPath, sessionId);
  return mapBackfillCandidateRows(rows);
}
async function countSessionCompartmentEmbedCoveragePolite(db, projectPath, sessionId, modelId, maxInputTokens = DEFAULT_COMPARTMENT_CHUNK_MAX_INPUT_TOKENS) {
  const candidates = getSessionBackfillRows(db, projectPath, sessionId);
  let embedded = 0;
  let started = performance.now();
  for (const candidate of candidates) {
    const { defect } = classifyChunkCoverageDefect(db, projectPath, modelId, candidate, maxInputTokens);
    if (defect === null || defect === "renumber")
      embedded++;
    started = await yieldCoverageSlice(started);
  }
  return { embedded, total: candidates.length };
}
async function countUnembeddedSessionCompartmentsPolite(db, projectPath, sessionId, modelId, maxInputTokens = DEFAULT_COMPARTMENT_CHUNK_MAX_INPUT_TOKENS) {
  const candidates = getSessionBackfillRows(db, projectPath, sessionId);
  let count = 0;
  let started = performance.now();
  for (const candidate of candidates) {
    const { defect } = classifyChunkCoverageDefect(db, projectPath, modelId, candidate, maxInputTokens);
    if (defect === "missing" || defect === "stale")
      count++;
    started = await yieldCoverageSlice(started);
  }
  return count;
}

export { CHUNK_WINDOW_SAFETY_RATIO, normalizeCompartmentChunkMaxInputTokens, buildCanonicalChunkTextFromFts, buildCompartmentSummaryFallbackText, canonicalizeInMemoryChunkTextForEmbedding, chunkCanonicalText, chunkEmbeddingWindowsAreCurrent, replaceCompartmentChunkEmbeddings, loadCompartmentChunkEmbeddingsForSearch, loadUnembeddedShadowChunkCandidates, loadUnembeddedCompartmentChunkCandidatesPolite, deleteChunkEmbedBackoffForSession, recordChunkEmbedBackoff, chunkWindowSourceKey, loadUnembeddedSessionChunkCandidatesPolite, countSessionCompartmentEmbedCoverage, countSessionCompartmentEmbedCoveragePolite, countUnembeddedSessionCompartmentsPolite };
