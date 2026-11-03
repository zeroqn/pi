import {
  invalidateAutoEmbedSession,
  drainBackgroundBatches
} from "./index-hgd00nas.js";
import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  getDataDir,
  getMagicContextStorageDir,
  log2,
  sessionLog2
} from "./index-gymgz20n.js";
import {
  estimateTokens
} from "./index-3rq8rbt9.js";
import {
  prepareCachedStatement2,
  withSqliteBackgroundWriter2,
  withoutSqliteTransformPass2
} from "./index-2qtx0q6h.js";
import {
  deleteUnmappedMessageFtsRows2
} from "./index-rgvqh5x7.js";
import {
  deleteChunkEmbedBackoffForSession2
} from "./index-6gtz99am.js";
import {
  isPidAlive,
  readProcessStartTime
} from "./index-cx7ctxbc.js";
import {
  MERGED_REASONING_PARTS_PREFIX,
  decodeMergedReasoningParts,
  SESSION_META_SELECT_COLUMNS,
  META_COLUMNS,
  BOOLEAN_META_KEYS,
  NULL_BIND_META_KEYS,
  isSessionMetaRow,
  getDefaultSessionMeta,
  ensureSessionMetaRow,
  toSessionMeta,
  isRustMarkerAdmissionFenced,
  readReplayEnvelope,
  readReplayDocument,
  updateReplayDocument,
  writeReplayDocument,
  parseStrippedPlaceholderState,
  serializeStrippedPlaceholderState,
  THINKING_BINDING_RECOVERY_FROZEN_PREFIX,
  THINKING_BINDING_STRIP_ORDER_END_MARKER,
  COMPACTION_OFF_THINKING_FROZEN_PREFIX,
  parseProcessedImageMarkers,
  serializeProcessedImageMarkers,
  getPendingPiCompactionMarkerState,
  logPiCompactionMarkerClear,
  withReadOnlySessionDb,
  expandToolPart,
  visitRawSessionMessages2,
  readRawSessionMessageById2
} from "./index-6vfy5y6a.js";
import {
  getTableColumnNames,
  tagTombstoneOwnerRange,
  tagTombstoneOwnerKey,
  tagRevisionKey,
  tagIdentityRevisionKey,
  deleteTagIdentityRevisions
} from "./index-3pk2mhaq.js";
import {
  isRecord,
  providerVisibleMessage,
  getTagById2
} from "./index-asxy48qe.js";
import {
  piModelRefToCanonical
} from "./index-ccanzg8p.js";
import {
  BoundedSessionMap
} from "./index-c6wbq66z.js";
import {
  layoutLkgPrefix,
  assembleLkgPrefix
} from "./index-vd4cwnaz.js";
import {
  gaDatabasePath2,
  V2StoreReader2
} from "./index-ea37qn4x.js";
import {
  logSlowWriteTransaction
} from "./index-0wtm7g7f.js";
import {
  ensurePrivateStorageDirectorySync,
  writeStorageFileSync,
  writeStorageFileAtomicSync,
  syncStorageDirectorySync,
  writeStorageFileDurableAtomicSync
} from "./index-81nthk8j.js";

// ../plugin/src/tools/ctx-expand/render.ts
import { createHash as createHash6 } from "node:crypto";

// ../plugin/src/features/magic-context/compartment-lease.ts
var COMPARTMENT_LEASE_TTL_MS = 5 * 60 * 1000;
var COMPARTMENT_LEASE_RENEWAL_MS = 60 * 1000;
function getCompartmentLeaseBlocker(db, sessionId) {
  const row = db.prepare(`SELECT holder_id AS holderId, owner_pid AS ownerPid,
                    acquired_at AS acquiredAt, expires_at AS expiresAt
               FROM compartment_state_lease
              WHERE session_id = ? AND expires_at > ?`).get(sessionId, Date.now());
  return row ?? null;
}
function acquireCompartmentLease(db, sessionId, holderId) {
  const acquiredAt = Date.now();
  const expiresAt = acquiredAt + COMPARTMENT_LEASE_TTL_MS;
  const ownerPid = process.pid;
  const blocker = getCompartmentLeaseBlocker(db, sessionId);
  if (blocker?.ownerPid && isPidAlive(blocker.ownerPid) === "dead") {
    const reclaimed = db.prepare(`DELETE FROM compartment_state_lease
                  WHERE session_id = ? AND holder_id = ? AND owner_pid = ?
                    AND acquired_at = ? AND expires_at = ?`).run(sessionId, blocker.holderId, blocker.ownerPid, blocker.acquiredAt, blocker.expiresAt);
    if (reclaimed.changes === 1) {
      sessionLog2(sessionId, `reclaimed compartment lease from dead owner holder=${blocker.holderId} pid=${blocker.ownerPid}`);
    }
  }
  const result = db.prepare(`INSERT INTO compartment_state_lease
                (session_id, holder_id, owner_pid, acquired_at, expires_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET
                holder_id = excluded.holder_id,
                owner_pid = excluded.owner_pid,
                acquired_at = excluded.acquired_at,
                expires_at = excluded.expires_at
             WHERE compartment_state_lease.holder_id = excluded.holder_id
                OR compartment_state_lease.expires_at <= ?`).run(sessionId, holderId, ownerPid, acquiredAt, expiresAt, acquiredAt);
  if (result.changes !== 1) {
    return null;
  }
  return { sessionId, holderId, acquiredAt, expiresAt, ownerPid };
}
function renewCompartmentLease(db, sessionId, holderId) {
  const now = Date.now();
  const expiresAt = now + COMPARTMENT_LEASE_TTL_MS;
  const result = db.prepare(`UPDATE compartment_state_lease
             SET expires_at = ?, acquired_at = ?
             WHERE session_id = ? AND holder_id = ? AND expires_at > ?`).run(expiresAt, now, sessionId, holderId, now);
  return result.changes === 1;
}
function releaseCompartmentLease(db, sessionId, holderId) {
  db.prepare("DELETE FROM compartment_state_lease WHERE session_id = ? AND holder_id = ?").run(sessionId, holderId);
}
function releaseCompartmentLeaseBestEffort(db, sessionId, holderId, log = sessionLog2) {
  try {
    releaseCompartmentLease(db, sessionId, holderId);
  } catch (err) {
    log(sessionId, `lease release failed (${err instanceof Error ? err.message : String(err)}); row expires on its TTL`);
  }
}
function isCompartmentLeaseHeld(db, sessionId, holderId) {
  const row = db.prepare("SELECT 1 FROM compartment_state_lease WHERE session_id = ? AND holder_id = ? AND expires_at > ?").get(sessionId, holderId, Date.now());
  return row != null;
}

// ../plugin/src/features/magic-context/no-content-compartment.ts
function isNoContentCompartment(row) {
  return [row.title, row.content, row.p1, row.p2, row.p3, row.p4].every((value) => !value);
}
var HAS_COMPARTMENT_CONTENT_SQL = "(title <> '' OR content <> '' OR COALESCE(p1, '') <> '' OR COALESCE(p2, '') <> '' OR COALESCE(p3, '') <> '' OR COALESCE(p4, '') <> '')";

// ../plugin/src/features/magic-context/storage-m0-mutation-log.ts
var M0_MUTATION_TYPES = new Set([
  "compartment_delete",
  "compartment_merge",
  "recomp_boundary_change",
  "compartment_upgrade"
]);
function assertMutationType(mutationType) {
  if (!M0_MUTATION_TYPES.has(mutationType)) {
    throw new Error(`Invalid m0 mutation type: ${mutationType}`);
  }
}
function toM0Mutation(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    mutationType: row.mutation_type,
    targetId: row.target_id,
    queuedAt: row.queued_at
  };
}
function queueM0Mutation(db, input) {
  assertMutationType(input.mutationType);
  const result = db.prepare(`INSERT INTO m0_mutation_log (session_id, mutation_type, target_id, queued_at)
             VALUES (?, ?, ?, ?)`).run(input.sessionId, input.mutationType, input.targetId ?? null, input.queuedAt ?? Date.now());
  const row = getM0Mutation(db, Number(result.lastInsertRowid));
  if (!row) {
    throw new Error("Failed to load queued m0 mutation");
  }
  return row;
}
function getM0Mutation(db, id) {
  const row = db.prepare(`SELECT id, session_id, mutation_type, target_id, queued_at
             FROM m0_mutation_log
             WHERE id = ?`).get(id);
  return row ? toM0Mutation(row) : null;
}
function getMaxM0MutationId(db, sessionId) {
  const row = db.prepare("SELECT MAX(id) AS max_id FROM m0_mutation_log WHERE session_id = ?").get(sessionId);
  return row?.max_id ?? null;
}

// ../plugin/src/features/magic-context/compartment-storage.ts
var insertCompartmentStatements = new WeakMap;
var insertFactStatements = new WeakMap;
function getInsertCompartmentStatement(db) {
  let stmt = insertCompartmentStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("INSERT INTO compartments (session_id, sequence, start_message, end_message, start_message_id, end_message_id, title, content, p1, p2, p3, p4, importance, episode_type, legacy, created_at, harness, start_block_index, end_block_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insertCompartmentStatements.set(db, stmt);
  }
  return stmt;
}
function isStringOrNullish(v) {
  return v === null || v === undefined || typeof v === "string";
}
function isNumberOrNullish(v) {
  return v === null || v === undefined || typeof v === "number";
}
function isCompartmentRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const candidate = row;
  return typeof candidate.id === "number" && typeof candidate.session_id === "string" && typeof candidate.sequence === "number" && typeof candidate.start_message === "number" && typeof candidate.end_message === "number" && typeof candidate.start_message_id === "string" && typeof candidate.end_message_id === "string" && typeof candidate.title === "string" && typeof candidate.content === "string" && isStringOrNullish(candidate.p1) && isStringOrNullish(candidate.p2) && isStringOrNullish(candidate.p3) && isStringOrNullish(candidate.p4) && isNumberOrNullish(candidate.importance) && isStringOrNullish(candidate.episode_type) && isNumberOrNullish(candidate.legacy) && typeof candidate.created_at === "number";
}
function insertCompartmentRows(db, sessionId, compartments, now) {
  const stmt = getInsertCompartmentStatement(db);
  for (const compartment of compartments) {
    const hasTiers = typeof compartment.p1 === "string" && compartment.p1.length > 0;
    stmt.run(sessionId, compartment.sequence, compartment.startMessage, compartment.endMessage, compartment.startMessageId, compartment.endMessageId, compartment.title, compartment.content, compartment.p1 ?? null, compartment.p2 ?? null, compartment.p3 ?? null, compartment.p4 ?? null, typeof compartment.importance === "number" ? compartment.importance : 50, compartment.episodeType ?? null, hasTiers || isNoContentCompartment(compartment) ? 0 : 1, now, getHarness2(), compartment.startBlockIndex ?? null, compartment.endBlockIndex ?? null);
  }
  if (compartments.length > 0)
    invalidateAutoEmbedSession(sessionId);
}
function toCompartment(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    startMessage: row.start_message,
    endMessage: row.end_message,
    startMessageId: row.start_message_id,
    endMessageId: row.end_message_id,
    ...row.start_block_index != null ? { startBlockIndex: row.start_block_index } : {},
    ...row.end_block_index != null ? { endBlockIndex: row.end_block_index } : {},
    title: row.title,
    content: row.content,
    p1: row.p1 ?? null,
    p2: row.p2 ?? null,
    p3: row.p3 ?? null,
    p4: row.p4 ?? null,
    importance: typeof row.importance === "number" ? row.importance : 50,
    episodeType: row.episode_type ?? null,
    legacy: typeof row.legacy === "number" ? row.legacy : 0,
    createdAt: row.created_at,
    rebaseStatus: row.rebase_status === "unresolved" ? "unresolved" : "ok"
  };
}
function getCompartments(db, sessionId) {
  const presentColumns = getTableColumnNames(db, "compartments");
  const columns = [
    "id",
    "session_id",
    "sequence",
    "start_message",
    "end_message",
    "start_message_id",
    "end_message_id",
    "start_block_index",
    "end_block_index",
    "title",
    "content",
    "p1",
    "p2",
    "p3",
    "p4",
    "importance",
    "episode_type",
    "legacy",
    "created_at",
    "rebase_status"
  ].filter((column) => presentColumns.has(column));
  const rows = db.prepare(`SELECT ${columns.length ? columns.join(", ") : "NULL AS id"}
            FROM compartments WHERE session_id = ? ORDER BY sequence ASC`).all(sessionId).filter(isCompartmentRow);
  return rows.map(toCompartment);
}
function getLastCompartmentEndMessage(db, sessionId) {
  const row = db.prepare("SELECT MAX(end_message) as max_end FROM compartments WHERE session_id = ? AND rebase_status != 'unresolved'").get(sessionId);
  return row?.max_end ?? -1;
}
function getLastCompartmentEndMessageId(db, sessionId) {
  const row = db.prepare("SELECT end_message_id FROM compartments WHERE session_id = ? AND rebase_status != 'unresolved' AND end_message_id IS NOT NULL AND end_message_id != '' ORDER BY sequence DESC LIMIT 1").get(sessionId);
  const id = row?.end_message_id;
  return id && id.length > 0 ? id : null;
}
function getCompartmentsByEndMessageId(db, sessionId, endMessageId) {
  const rows = db.prepare("SELECT * FROM compartments WHERE session_id = ? AND end_message_id = ? ORDER BY sequence ASC").all(sessionId, endMessageId).filter(isCompartmentRow);
  return rows.map(toCompartment);
}
function appendCompartments(db, sessionId, compartments) {
  if (compartments.length === 0)
    return;
  const now = Date.now();
  db.transaction(() => {
    insertCompartmentRows(db, sessionId, compartments, now);
  }).immediate();
}
function saveRecompStagingPass(db, sessionId, passNumber, compartments, facts) {
  const now = Date.now();
  db.transaction(() => {
    db.prepare("DELETE FROM recomp_facts WHERE session_id = ?").run(sessionId);
    const compartmentStmt = db.prepare("INSERT OR REPLACE INTO recomp_compartments (session_id, sequence, start_message, end_message, start_message_id, end_message_id, title, content, p1, p2, p3, p4, importance, episode_type, pass_number, created_at, harness, start_block_index, end_block_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const c of compartments) {
      compartmentStmt.run(sessionId, c.sequence, c.startMessage, c.endMessage, c.startMessageId, c.endMessageId, c.title, c.content, c.p1 ?? null, c.p2 ?? null, c.p3 ?? null, c.p4 ?? null, typeof c.importance === "number" ? c.importance : 50, c.episodeType ?? null, passNumber, now, getHarness2(), c.startBlockIndex ?? null, c.endBlockIndex ?? null);
    }
    const factStmt = db.prepare("INSERT INTO recomp_facts (session_id, category, content, pass_number, created_at, harness) VALUES (?, ?, ?, ?, ?, ?)");
    for (const f of facts) {
      factStmt.run(sessionId, f.category, f.content, passNumber, now, getHarness2());
    }
  }).immediate();
}
function getRecompStaging(db, sessionId) {
  const compartmentRows = db.prepare("SELECT * FROM recomp_compartments WHERE session_id = ? ORDER BY sequence ASC").all(sessionId).filter(isRecompCompartmentRow);
  if (compartmentRows.length === 0)
    return null;
  const compartments = compartmentRows.map((row) => ({
    sequence: row.sequence,
    startMessage: row.start_message,
    endMessage: row.end_message,
    startMessageId: row.start_message_id,
    endMessageId: row.end_message_id,
    ...row.start_block_index != null ? { startBlockIndex: row.start_block_index } : {},
    ...row.end_block_index != null ? { endBlockIndex: row.end_block_index } : {},
    title: row.title,
    content: row.content,
    p1: row.p1 ?? null,
    p2: row.p2 ?? null,
    p3: row.p3 ?? null,
    p4: row.p4 ?? null,
    importance: typeof row.importance === "number" ? row.importance : 50,
    episodeType: row.episode_type ?? null
  }));
  const factRows = db.prepare("SELECT category, content FROM recomp_facts WHERE session_id = ?").all(sessionId).filter(isRecompFactRow);
  const maxPass = compartmentRows.reduce((m, r) => Math.max(m, r.pass_number), 0);
  const lastEnd = compartmentRows[compartmentRows.length - 1]?.end_message ?? 0;
  return {
    compartments,
    facts: factRows,
    passCount: maxPass,
    lastEndMessage: lastEnd
  };
}
function clearRecompStaging(db, sessionId) {
  db.transaction(() => {
    db.prepare("DELETE FROM recomp_compartments WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM recomp_facts WHERE session_id = ?").run(sessionId);
    try {
      db.prepare("UPDATE session_meta SET recomp_partial_range_start = 0, recomp_partial_range_end = 0 WHERE session_id = ?").run(sessionId);
    } catch {}
  }).immediate();
}
function getRecompPartialRange(db, sessionId) {
  try {
    const row = db.prepare("SELECT recomp_partial_range_start AS start, recomp_partial_range_end AS end FROM session_meta WHERE session_id = ?").get(sessionId);
    const start = typeof row?.start === "number" ? row.start : 0;
    const end = typeof row?.end === "number" ? row.end : 0;
    if (start <= 0 || end <= 0)
      return null;
    return { start, end };
  } catch {
    return null;
  }
}
function setRecompPartialRange(db, sessionId, range) {
  const start = range ? range.start : 0;
  const end = range ? range.end : 0;
  db.prepare("INSERT OR IGNORE INTO session_meta (session_id) VALUES (?)").run(sessionId);
  db.prepare("UPDATE session_meta SET recomp_partial_range_start = ?, recomp_partial_range_end = ? WHERE session_id = ?").run(start, end, sessionId);
}
function isRecompCompartmentRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const candidate = row;
  return typeof candidate.id === "number" && typeof candidate.session_id === "string" && typeof candidate.sequence === "number" && typeof candidate.start_message === "number" && typeof candidate.end_message === "number" && typeof candidate.start_message_id === "string" && typeof candidate.end_message_id === "string" && typeof candidate.title === "string" && typeof candidate.content === "string" && isStringOrNullish(candidate.p1) && isStringOrNullish(candidate.p2) && isStringOrNullish(candidate.p3) && isStringOrNullish(candidate.p4) && isNumberOrNullish(candidate.importance) && isStringOrNullish(candidate.episode_type) && typeof candidate.pass_number === "number" && typeof candidate.created_at === "number";
}
function isRecompFactRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const candidate = row;
  return typeof candidate.category === "string" && typeof candidate.content === "string";
}
function escapeXmlAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeXmlContent(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function getUncoveredCompartmentEndThrough(db, sessionId, endOrdinal = Number.MAX_SAFE_INTEGER) {
  const end = getUncoveredCompartmentEndsThrough(db, sessionId, endOrdinal)[0];
  return end ? { endMessageId: end.endMessageId, endMessage: end.endMessage } : null;
}
function getUncoveredCompartmentEndsThrough(db, sessionId, endOrdinal = Number.MAX_SAFE_INTEGER, afterOrdinal = -1) {
  const rows = db.prepare(`SELECT k.end_message_id, k.end_message,
                n.start_message_id AS successor_id, n.start_message AS successor_start FROM compartments k
         LEFT JOIN compartments n ON n.session_id = k.session_id AND n.sequence = k.sequence + 1
         WHERE k.session_id = ?1 AND k.end_message <= ?2 AND k.end_message > ?3 AND k.end_block_index IS NOT NULL
           AND NOT COALESCE(n.sequence IS NOT NULL AND (
               (n.start_message_id = k.end_message_id AND n.start_block_index > k.end_block_index)
               OR n.start_message = k.end_message + 1), 0)
         ORDER BY k.sequence`).all(sessionId, endOrdinal, afterOrdinal);
  return rows.map((row) => ({
    endMessageId: row.end_message_id,
    endMessage: row.end_message,
    successorStartMessageId: row.successor_id,
    successorStartMessage: row.successor_start
  }));
}
function isPartialCompartmentEnd(db, sessionId, messageId) {
  return Boolean(db.prepare("SELECT 1 FROM compartments WHERE session_id=? AND end_message_id=? AND end_block_index IS NOT NULL LIMIT 1").get(sessionId, messageId));
}
// ../plugin/src/features/magic-context/project-docs-hash.ts
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
var PROJECT_DOC_FILES = ["ARCHITECTURE.md", "STRUCTURE.md"];
var PROJECT_DOCS_DELIMITER = `

---

`;
var MAX_PROJECT_DOC_BYTES = 256 * 1024;
var docsCache = new Map;
var canonicalReadCountForTests = 0;
function canonicalizeDocContent(raw) {
  return raw.replace(/^\uFEFF/, "").replace(/\r\n/g, `
`).split(`
`).map((line) => line.replace(/[ \t]+$/, "")).join(`
`).replace(/\n+$/, "");
}
function fingerprintFile(filePath) {
  try {
    const stat = lstatSync(filePath);
    const isReadableDoc = stat.isFile() && stat.size <= MAX_PROJECT_DOC_BYTES;
    return {
      exists: isReadableDoc,
      mtimeMs: stat.mtimeMs,
      size: stat.size
    };
  } catch {
    return { exists: false, mtimeMs: 0, size: 0 };
  }
}
function readDirectoryMtimeMs(projectDirectory) {
  try {
    return statSync(projectDirectory).mtimeMs;
  } catch {
    return 0;
  }
}
function fingerprintsEqual(a, b) {
  return a?.exists === b.exists && a.mtimeMs === b.mtimeMs && a.size === b.size;
}
function cacheFilesEqual(cachedFiles, currentFiles) {
  for (const [filePath, current] of currentFiles) {
    if (!fingerprintsEqual(cachedFiles.get(filePath), current)) {
      return false;
    }
  }
  return true;
}
function readCurrentFingerprints(projectDirectory) {
  const files = new Map;
  for (const filename of PROJECT_DOC_FILES) {
    const filePath = path.join(projectDirectory, filename);
    files.set(filePath, fingerprintFile(filePath));
  }
  return { directoryMtimeMs: readDirectoryMtimeMs(projectDirectory), files };
}
function readCanonicalPieces(projectDirectory, files) {
  const hashPieces = [];
  const renderedSections = [];
  for (const filename of PROJECT_DOC_FILES) {
    const filePath = path.join(projectDirectory, filename);
    const fingerprint = files.get(filePath);
    if (!fingerprint?.exists) {
      continue;
    }
    let safeToRead = false;
    try {
      const st = lstatSync(filePath);
      safeToRead = st.isFile() && st.size <= MAX_PROJECT_DOC_BYTES;
    } catch {
      safeToRead = false;
    }
    if (!safeToRead) {
      continue;
    }
    const canonicalContent = canonicalizeDocContent(readFileSync(filePath, "utf8"));
    hashPieces.push(`file:${filename}
${canonicalContent}`);
    renderedSections.push(`<file name="${escapeXmlAttr(filename)}">
${escapeXmlContent(canonicalContent)}
</file>`);
  }
  return { hashPieces, renderedSections };
}
function buildRenderedBlock(renderedSections) {
  if (renderedSections.length === 0) {
    return "";
  }
  return `<project-docs>
${renderedSections.join(`

`)}
</project-docs>`;
}
function hashCanonicalPieces(hashPieces) {
  if (hashPieces.length === 0) {
    return "";
  }
  return createHash("sha256").update(hashPieces.join(PROJECT_DOCS_DELIMITER), "utf8").digest("hex");
}
function readProjectDocsCanonical(projectDirectory) {
  canonicalReadCountForTests += 1;
  const canonicalDirectory = path.resolve(projectDirectory);
  const current = readCurrentFingerprints(canonicalDirectory);
  const cached = docsCache.get(canonicalDirectory);
  if (cached && cacheFilesEqual(cached.files, current.files)) {
    cached.directoryMtimeMs = current.directoryMtimeMs;
    return {
      renderedBlock: cached.cachedRendered,
      canonicalHash: cached.cachedHash
    };
  }
  const { hashPieces, renderedSections } = readCanonicalPieces(canonicalDirectory, current.files);
  const canonicalHash = hashCanonicalPieces(hashPieces);
  const renderedBlock = buildRenderedBlock(renderedSections);
  docsCache.set(canonicalDirectory, {
    directoryMtimeMs: current.directoryMtimeMs,
    files: current.files,
    cachedHash: canonicalHash,
    cachedRendered: renderedBlock
  });
  return { renderedBlock, canonicalHash };
}
// ../plugin/src/hooks/magic-context/lkg-slot.ts
import { createHash as createHash5 } from "node:crypto";

// ../plugin/src/shared/provider-response-completion.ts
function providerResponseFailed(input) {
  if (input.error !== undefined && input.error !== null && input.error !== "")
    return true;
  const finish = typeof input.finish === "string" ? input.finish.trim().toLowerCase() : "";
  return ["error", "failed", "abort", "aborted", "interrupted", "cancelled", "canceled"].includes(finish);
}
function isSuccessfulProviderCompletion(input) {
  if (providerResponseFailed(input))
    return false;
  return typeof input.completedAt === "number" && Number.isFinite(input.completedAt) && input.completedAt > 0 || typeof input.finish === "string" && input.finish.trim().length > 0;
}
// ../plugin/src/features/magic-context/storage-meta-session.ts
import { Buffer as Buffer2 } from "node:buffer";

// ../plugin/src/hooks/magic-context/lkg-recovery-fence.ts
import { createHash as createHash3, randomUUID as randomUUID2 } from "node:crypto";
import { lstatSync as lstatSync2, readdirSync as readdirSync2, readFileSync as readFileSync3, rmdirSync, rmSync as rmSync2 } from "node:fs";
import { basename, dirname, join as join2 } from "node:path";

// ../plugin/src/shared/storage-file-mutex.ts
import { execFileSync } from "node:child_process";
import { createHash as createHash2, randomUUID } from "node:crypto";
import { readdirSync, readFileSync as readFileSync2, rmSync } from "node:fs";
import { join } from "node:path";
var ticketChecksum = (name, ticket) => createHash2("sha256").update(JSON.stringify([name, ticket.choosing, ticket.number, ticket.birth])).digest("hex");
function processBirth(pid) {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync2(`/proc/${pid}/stat`, "utf8");
      const ticks = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
      if (!ticks || !/^\d+$/.test(ticks))
        return null;
      return `${readFileSync2("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${ticks}`;
    } catch {
      return null;
    }
  }
  if (process.platform === "darwin") {
    try {
      return execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
        encoding: "utf8",
        timeout: 1000,
        windowsHide: true,
        env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
        stdio: ["ignore", "pipe", "pipe"]
      }).trim() || null;
    } catch {
      return null;
    }
  }
  const start = readProcessStartTime(pid);
  return start === null ? null : String(start);
}
var pause = new Int32Array(new SharedArrayBuffer(4));
function withStorageFileMutex(directory, work, timeoutMs = 1000) {
  ensurePrivateStorageDirectorySync(directory);
  const name = `${process.pid}-${randomUUID()}.lock`;
  const ownPath = join(directory, name);
  const birth = processBirth(process.pid);
  const ticket = { choosing: true, number: 0, birth, checksum: "" };
  const encodedTicket = () => JSON.stringify({ ...ticket, checksum: ticketChecksum(name, ticket) });
  for (let attempt = 0;; attempt++) {
    try {
      writeStorageFileSync(ownPath, encodedTicket(), { flag: "wx", forcePrivate: true });
      break;
    } catch (error) {
      if (error.code !== "ENOENT" || attempt >= 2)
        throw error;
      ensurePrivateStorageDirectorySync(directory);
    }
  }
  const deadline = performance.now() + timeoutMs;
  const peers = () => {
    const found = [];
    for (const other of readdirSync(directory)) {
      if (other === name || !/^\d+-[\da-f-]+\.lock$/.test(other))
        continue;
      const pid = Number(other.split("-")[0]);
      const otherPath = join(directory, other);
      let value = null;
      try {
        const parsed = JSON.parse(readFileSync2(otherPath, "utf8"));
        if (typeof parsed.choosing === "boolean" && Number.isSafeInteger(parsed.number) && parsed.number >= 0 && (parsed.birth === null || typeof parsed.birth === "string") && parsed.checksum === ticketChecksum(other, parsed))
          value = parsed;
      } catch (error) {
        if (error.code === "ENOENT")
          continue;
      }
      const alive = isPidAlive(pid);
      const actualBirth = alive === "alive" && value?.birth ? processBirth(pid) : null;
      if (alive === "dead" || actualBirth !== null && value?.birth && actualBirth !== value.birth) {
        rmSync(otherPath, { force: true });
        continue;
      }
      found.push([other, value]);
    }
    return found;
  };
  try {
    ticket.number = 1 + Math.max(0, ...peers().map(([, value]) => value?.number ?? 0));
    ticket.choosing = false;
    writeStorageFileAtomicSync(ownPath, encodedTicket(), true);
    while (peers().some(([other, value]) => !value || value.choosing || value.number < ticket.number || value.number === ticket.number && other < name)) {
      if (performance.now() >= deadline)
        throw new Error("Storage safety publication lock is unavailable");
      Atomics.wait(pause, 0, 0, 10);
    }
    const result = work();
    if (result && typeof result.then === "function")
      throw new TypeError("Storage publication mutex requires synchronous work");
    return result;
  } finally {
    rmSync(ownPath, { force: true });
  }
}

// ../plugin/src/hooks/magic-context/lkg-recovery-fence.ts
class LkgRecoveryFenceError extends Error {
  constructor(message) {
    super(message);
    this.name = "LkgRecoveryFenceError";
  }
}
var platform = process.platform;
var observer;
var knownFences = new BoundedSessionMap(1000);
var ioObserver;
var cacheKey = (sessionId) => `${getMagicContextStorageDir()}\x00${getHarness2()}\x00${sessionId}`;
function remember(sessionId, value) {
  knownFences.set(cacheKey(sessionId), value);
  return value;
}
function known(sessionId) {
  const prior = knownFences.get(cacheKey(sessionId));
  if (prior)
    return prior;
  const record = read(sessionId);
  if (record)
    return remember(sessionId, { state: record.state, record });
  try {
    lstatSync2(lkgRecoveryFencePath(sessionId));
  } catch (error) {
    if (error.code === "ENOENT")
      return remember(sessionId, { state: "clean", record: null });
  }
  return remember(sessionId, { state: "invalid", record: null });
}
function clearLkgFenceProcessState(sessionId) {
  if (sessionId)
    knownFences.delete(cacheKey(sessionId));
  else
    knownFences.clear();
}
var durableFencesSupported = () => platform !== "win32";
var hash = (value) => createHash3("sha256").update(value).digest("hex");
function lkgRecoveryFencePath(sessionId) {
  return join2(getMagicContextStorageDir(), "lkg-recovery-fences", `${hash(sessionId)}.json`);
}
function metadata(slot) {
  return [
    slot.inputIdSeq,
    slot.inputContentDigests,
    slot.inputContentSignatures ?? null,
    slot.piOutputEntryIds ?? null,
    slot.lastInputMessageId,
    slot.modelKey,
    slot.providerKey
  ];
}
function representationKey(slot) {
  return createHash3("sha256").update(slot.jsonPrefix).update(JSON.stringify(metadata(slot))).digest("hex");
}
function lkgRecoverySlotKey(slot) {
  return hash(JSON.stringify([
    representationKey(slot),
    slot.capturedAt,
    slot.rowVersion ?? null,
    slot.captureSequence ?? null
  ]));
}
function payload(record) {
  return [
    record.version,
    record.sessionId,
    record.host,
    record.modelKey,
    record.providerKey,
    record.slotKey,
    record.servedDigest,
    record.revision,
    record.state
  ];
}
function publishRecord(record) {
  ioObserver?.("write");
  try {
    if (record.state === "clean")
      observer?.("clean");
    writeStorageFileDurableAtomicSync(lkgRecoveryFencePath(record.sessionId), JSON.stringify({ ...record, checksum: hash(JSON.stringify(payload(record))) }), () => observer?.("temp-synced"));
    if (record.state === "dirty")
      observer?.("dirty");
    remember(record.sessionId, {
      state: record.state,
      record: { ...record, checksum: hash(JSON.stringify(payload(record))) }
    });
  } catch (error) {
    const visible = read(record.sessionId);
    if (record.state === "clean" && visible?.state === "clean" && visible.revision === record.revision && visible.slotKey === record.slotKey) {
      const dirty = { ...record, state: "dirty" };
      writeStorageFileDurableAtomicSync(lkgRecoveryFencePath(record.sessionId), JSON.stringify({ ...dirty, checksum: hash(JSON.stringify(payload(dirty))) }));
    }
    remember(record.sessionId, { state: "invalid", record: null });
    throw error;
  }
}
function read(sessionId) {
  ioObserver?.("read");
  try {
    const path = lkgRecoveryFencePath(sessionId);
    const stat = lstatSync2(path);
    const directory = lstatSync2(dirname(path));
    if (!stat.isFile() || stat.size > 4096 || !directory.isDirectory() || directory.isSymbolicLink() || process.platform !== "win32" && ((stat.mode & 63) !== 0 || (directory.mode & 63) !== 0 || process.getuid && stat.uid !== process.getuid()))
      return null;
    const value = JSON.parse(readFileSync3(path, "utf8"));
    if (value.version !== 1 || value.sessionId !== sessionId || value.host !== getHarness2() || value.modelKey !== null && typeof value.modelKey !== "string" || value.providerKey !== null && typeof value.providerKey !== "string" || !/^[a-f0-9]{64}$/.test(value.slotKey) || !/^[a-f0-9]{64}$/.test(value.servedDigest) || typeof value.revision !== "string" || !["clean", "dirty"].includes(value.state) || value.checksum !== hash(JSON.stringify(payload(value))))
      return null;
    return value;
  } catch {
    return null;
  }
}
function publish(sessionId, slot, state, revision) {
  const record = {
    version: 1,
    sessionId,
    host: getHarness2(),
    modelKey: slot.modelKey,
    providerKey: slot.providerKey,
    slotKey: lkgRecoverySlotKey(slot),
    servedDigest: hash(slot.jsonPrefix),
    revision,
    state
  };
  publishRecord(record);
}
function locked(sessionId, work) {
  ioObserver?.("mutex");
  return withStorageFileMutex(`${lkgRecoveryFencePath(sessionId)}.locks`, () => {
    const path = lkgRecoveryFencePath(sessionId);
    for (const name of readdirSync2(dirname(path))) {
      if (name.startsWith(`${basename(path)}.`) && name.endsWith(".tmp"))
        rmSync2(join2(dirname(path), name), { force: true });
    }
    return work();
  });
}
function hasCleanLkgRecoveryFence(sessionId, _slot) {
  if (!durableFencesSupported())
    return false;
  const state = known(sessionId);
  return state.state === "clean";
}
function lkgFenceRequiresRebuild(sessionId, slot, processLocalProof) {
  return !processLocalProof && (durableFencesSupported() ? !hasCleanLkgRecoveryFence(sessionId, slot) : true);
}
function lkgRecoveryFenceUnclean(sessionId) {
  return durableFencesSupported() && known(sessionId).state !== "clean";
}
function ownsLkgDirtyFence(sessionId, revision) {
  if (!durableFencesSupported())
    return revision === "process-local";
  const record = known(sessionId).record;
  return revision !== undefined && record?.state === "dirty" && record.revision === revision;
}
function invalidateCleanLkgRecoveryFence(sessionId, load, ownRevision) {
  if (!durableFencesSupported())
    return "process-local";
  const prior = known(sessionId);
  if (prior.state === "dirty")
    return prior.record?.revision === ownRevision ? ownRevision : undefined;
  return locked(sessionId, () => {
    const slot = load() ?? {
      jsonPrefix: "",
      inputIdSeq: [],
      inputContentDigests: [],
      lastInputMessageId: "",
      modelKey: null,
      providerKey: null,
      capturedAt: 0
    };
    const record = read(sessionId);
    if (record?.state !== "dirty") {
      const revision = randomUUID2();
      publish(sessionId, slot, "dirty", revision);
      return revision;
    }
    return record?.state === "dirty" && record.revision === ownRevision ? ownRevision : undefined;
  });
}
function markLkgRecoveryDirty(args) {
  if (!durableFencesSupported()) {
    if (!args.processLocalProof)
      throw new LkgRecoveryFenceError("Restart replay requires a healthy rebuild on Windows");
    return "process-local";
  }
  const state = known(args.sessionId);
  if (state.state === "dirty" && args.processLocalProof && state.record && state.record.revision === args.ownDirtyRevision)
    return state.record.revision;
  if (state.state === "invalid")
    throw new LkgRecoveryFenceError("No clean durable recovery certificate");
  return locked(args.sessionId, () => {
    const slot = args.slot;
    const before = read(args.sessionId);
    if (before?.state === "dirty") {
      if (!args.processLocalProof || before.revision !== args.ownDirtyRevision)
        throw new LkgRecoveryFenceError(`Recovery superseded this process's last-good request (local=${args.processLocalProof}, owned=${before.revision === args.ownDirtyRevision})`);
      return before.revision;
    }
    if (before && before.state !== "clean")
      throw new LkgRecoveryFenceError("No clean durable recovery certificate");
    const revision = randomUUID2();
    publish(args.sessionId, slot, "dirty", revision);
    return revision;
  });
}
function commitLkgWithRecoveryFence(args) {
  if (!durableFencesSupported())
    return args.commit();
  const state = known(args.sessionId);
  if (state.state === "clean" && !args.requiredRevision && !args.retainDirtyRevision) {
    const committed = args.commit();
    if (committed) {
      observer?.("committed");
      remember(args.sessionId, { state: "clean", record: null });
    }
    return committed;
  }
  if (state.state === "invalid" && !args.rebuild)
    throw new LkgRecoveryFenceError("Unproven prior request requires a prefix rebuild");
  return locked(args.sessionId, () => {
    const before = read(args.sessionId);
    if (args.requiredRevision && before?.revision !== args.requiredRevision)
      throw new LkgRecoveryFenceError("A later publisher superseded the rollback snapshot");
    const ownsDirty = before?.state === "dirty" && (before.revision === args.retainDirtyRevision || before.revision === args.ownDirtyRevision);
    if (before?.state === "dirty" && !ownsDirty && !args.rebuild)
      throw new LkgRecoveryFenceError("A concurrent recovery requires a declared prefix rebuild");
    if (before?.state !== "dirty" && state.state === "invalid")
      publish(args.sessionId, args.load() ?? args.slot, "dirty", randomUUID2());
    if (!args.commit())
      return false;
    observer?.("committed");
    const saved = args.load();
    if (!saved || representationKey(saved) !== representationKey(args.slot))
      throw new LkgRecoveryFenceError("Last-good commit did not match its certificate");
    if (args.retainDirtyRevision || args.cleanDigest !== undefined && hash(saved.jsonPrefix) !== args.cleanDigest)
      return true;
    const dirty = read(args.sessionId);
    if (dirty?.state === "dirty")
      publish(args.sessionId, saved, "clean", dirty.revision);
    else
      remember(args.sessionId, { state: "clean", record: null });
    return true;
  });
}
function clearLkgRecoveryFence(sessionId, remove, shouldClear) {
  if (!durableFencesSupported())
    return remove?.();
  const path = lkgRecoveryFencePath(sessionId);
  const missing = (file) => {
    try {
      lstatSync2(file);
      return false;
    } catch (error) {
      return error.code === "ENOENT";
    }
  };
  if (!remove && !shouldClear && missing(path) && missing(`${path}.locks`)) {
    clearLkgFenceProcessState(sessionId);
    return;
  }
  try {
    return locked(sessionId, () => {
      const result = remove?.();
      if (shouldClear && !shouldClear(result))
        return result;
      rmSync2(lkgRecoveryFencePath(sessionId), { force: true });
      syncStorageDirectorySync(dirname(lkgRecoveryFencePath(sessionId)));
      clearLkgFenceProcessState(sessionId);
      return result;
    });
  } finally {
    try {
      rmdirSync(`${path}.locks`);
    } catch {}
  }
}

// ../plugin/src/shared/auto-search-lifecycle.ts
var pending = new Map;
var unpublishedNoHints = new Map;
function rememberUnpublishedAutoSearchNoHint(sessionId, messageId, reason) {
  let messages = unpublishedNoHints.get(sessionId);
  if (!messages) {
    messages = new Map;
    unpublishedNoHints.set(sessionId, messages);
  }
  if (!messages.has(messageId))
    messages.set(messageId, reason);
}
function getUnpublishedAutoSearchNoHint(sessionId, messageId) {
  return unpublishedNoHints.get(sessionId)?.get(messageId);
}
function forgetUnpublishedAutoSearchNoHint(sessionId, messageId) {
  const messages = unpublishedNoHints.get(sessionId);
  messages?.delete(messageId);
  if (messages?.size === 0)
    unpublishedNoHints.delete(sessionId);
}
function clearUnpublishedAutoSearchNoHints(sessionId) {
  if (sessionId === undefined)
    unpublishedNoHints.clear();
  else
    unpublishedNoHints.delete(sessionId);
}
function registerAutoSearchWork(sessionId) {
  const controller = new AbortController;
  const work = pending.get(sessionId) ?? new Set;
  pending.set(sessionId, work);
  work.add(controller);
  return {
    signal: controller.signal,
    done: () => {
      work.delete(controller);
      if (pending.get(sessionId) === work && work.size === 0)
        pending.delete(sessionId);
    }
  };
}
function cancelAutoSearchWork(sessionId) {
  for (const [id, work] of pending) {
    if (sessionId !== undefined && id !== sessionId)
      continue;
    pending.delete(id);
    for (const controller of work)
      controller.abort();
  }
}

// ../plugin/src/features/magic-context/resolve-subagent-fallback.ts
function resolveIsSubagentFromOpenCodeDb(sessionId) {
  try {
    return withReadOnlySessionDb((openCodeDb) => {
      const row = openCodeDb.prepare("SELECT parent_id FROM session WHERE id = ?").get(sessionId);
      if (!row)
        return null;
      return typeof row.parent_id === "string" && row.parent_id.length > 0;
    });
  } catch (error) {
    log2(`[magic-context] resolveIsSubagentFromOpenCodeDb failed for ${sessionId}:`, error);
    return null;
  }
}
function resolveIsSubagentFromOpenCode2Db(sessionId) {
  let reader;
  try {
    reader = new V2StoreReader2(gaDatabasePath2(getDataDir(), process.env.OPENCODE_CHANNEL ?? "latest"));
    return reader.isSubagent(sessionId);
  } catch (error) {
    log2(`[magic-context] resolveIsSubagentFromOpenCode2Db failed for ${sessionId}:`, error);
    return null;
  } finally {
    reader?.close();
  }
}

// ../plugin/src/features/magic-context/session-activity.ts
var PREFIX = "retrospective_activity:";
var INTERVAL_MS = 15000;
var pending2 = new WeakMap;
function sessionActivityKey(sessionId) {
  return `${PREFIX}${sessionId}`;
}
function deleteSessionActivity(db, sessionIds) {
  if (sessionIds.length === 0)
    return;
  const sessions = pending2.get(db);
  for (const sessionId of sessionIds) {
    const state = sessions?.get(sessionId);
    if (state?.timer)
      clearTimeout(state.timer);
    sessions?.delete(sessionId);
  }
  const placeholders = sessionIds.map(() => "?").join(", ");
  db.prepare(`DELETE FROM schema_migrations_meta WHERE key IN (${placeholders})`).run(...sessionIds.map(sessionActivityKey));
  deleteTagIdentityRevisions(db, sessionIds);
}
function readSessionActivity(db, sessionId) {
  const row = db.prepare("SELECT value FROM schema_migrations_meta WHERE key = ?").get(sessionActivityKey(sessionId));
  const time = Number(row?.value);
  return row && Number.isFinite(time) ? time : undefined;
}
function advanceSessionActivity(db, sessionId, time) {
  if (!sessionId || !Number.isFinite(time) || time <= 0)
    return;
  db.prepare(`INSERT INTO schema_migrations_meta (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = CAST(MAX(CAST(value AS INTEGER), CAST(excluded.value AS INTEGER)) AS TEXT)`).run(sessionActivityKey(sessionId), String(Math.floor(time)));
}
function observeSessionActivity(db, sessionId, time = Date.now()) {
  if (!sessionId || !Number.isFinite(time) || time <= 0)
    return;
  let sessions = pending2.get(db);
  if (!sessions) {
    sessions = new Map;
    pending2.set(db, sessions);
  }
  const current = sessions.get(sessionId);
  if (!current || time - current.lastWrite >= INTERVAL_MS) {
    if (current?.timer)
      clearTimeout(current.timer);
    advanceSessionActivity(db, sessionId, Math.max(time, current?.latest ?? 0));
    sessions.set(sessionId, { lastWrite: time, latest: time });
    return;
  }
  current.latest = Math.max(current.latest, time);
  if (!current.timer) {
    current.timer = setTimeout(() => {
      current.timer = undefined;
      try {
        advanceSessionActivity(db, sessionId, current.latest);
        current.lastWrite = Date.now();
      } catch {
        sessions.delete(sessionId);
      }
    }, Math.max(1, INTERVAL_MS - (time - current.lastWrite)));
    current.timer.unref?.();
  }
}
async function backfillSessionActivity(db, harness, latestTime) {
  const completedKey = `retrospective_activity_backfill:${harness}:v1`;
  if (db.prepare("SELECT 1 FROM schema_migrations_meta WHERE key = ?").get(completedKey))
    return;
  let cursor = "";
  while (true) {
    const rows = db.prepare(`SELECT session_id FROM session_projects
            WHERE harness = ? AND session_id > ? ORDER BY session_id LIMIT 100`).all(harness, cursor);
    if (rows.length === 0)
      break;
    for (const row of rows) {
      const time = await latestTime(row.session_id);
      if (time !== undefined)
        advanceSessionActivity(db, row.session_id, time);
    }
    cursor = rows[rows.length - 1].session_id;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  db.prepare("INSERT OR IGNORE INTO schema_migrations_meta (key, value) VALUES (?, 'completed')").run(completedKey);
}

// ../plugin/src/features/magic-context/storage-session-tables.ts
var SESSION_SCOPED_TABLES = [
  { table: "pending_ops", harnessScoped: true },
  { table: "source_contents", harnessScoped: true },
  { table: "tool_owner_backfill_state" },
  { table: "tags", harnessScoped: true },
  { table: "session_meta", harnessScoped: true },
  {
    table: "temporal_decisions",
    extraPredicate: "NOT EXISTS (SELECT 1 FROM session_meta AS remaining WHERE remaining.session_id = temporal_decisions.session_id)"
  },
  {
    table: "session_replay_decisions",
    extraPredicate: "NOT EXISTS (SELECT 1 FROM session_meta AS remaining WHERE remaining.session_id = session_replay_decisions.session_id)"
  },
  { table: "session_projects", harnessScoped: true },
  { table: "compartment_chunk_embeddings", harnessScoped: true },
  { table: "compartments", harnessScoped: true },
  {
    table: "compartment_history_versions",
    extraPredicate: "NOT EXISTS (SELECT 1 FROM compartments AS remaining WHERE remaining.session_id = compartment_history_versions.session_id)"
  },
  { table: "compression_depth", harnessScoped: true },
  { table: "session_facts", harnessScoped: true },
  { table: "compartment_state_lease" },
  { table: "notes", harnessScoped: true, extraPredicate: "type = 'session'" },
  { table: "recomp_compartments", harnessScoped: true },
  { table: "recomp_facts", harnessScoped: true },
  { table: "user_memory_candidates" },
  { table: "primer_candidates", harnessScoped: true },
  { table: "m0_mutation_log" },
  { table: "compartment_events", harnessScoped: true },
  { table: "subagent_invocations", harnessScoped: true },
  { table: "historian_runs", harnessScoped: true },
  { table: "plugin_messages" },
  { table: "transform_decisions", harnessScoped: true },
  { table: "synapse_batch_ledger" },
  { table: "embedding_measurement_corpus" },
  { table: "pending_session_cleanup", harnessScoped: true },
  { table: "message_history_fts" },
  { table: "message_fts_rowid_map" },
  { table: "message_history_source", harnessScoped: true },
  { table: "message_history_index", harnessScoped: true },
  { table: "lkg_slots" },
  { table: "lkg_slot_chunks" }
];
var cleanupStatements = new WeakMap;
function cleanupStatement(db, sql) {
  let cache = cleanupStatements.get(db);
  if (!cache) {
    cache = new Map;
    cleanupStatements.set(db, cache);
  }
  let statement = cache.get(sql);
  if (!statement) {
    if (cache.size >= 256)
      cache.clear();
    statement = prepareCachedStatement2(db, sql);
    cache.set(sql, statement);
  }
  return statement;
}
function deleteSessionScopedRows(db, sessionIds, harness, options = {}) {
  if (sessionIds.length === 0)
    return 0;
  let deletableSessionIds = [...sessionIds];
  if (options.rustModuleCleanupAcknowledged !== true) {
    const placeholders = sessionIds.map(() => "?").join(", ");
    const harnessPredicate = harness === undefined ? "" : " AND harness = ?";
    const protectedRows = cleanupStatement(db, `SELECT session_id
                 FROM pending_session_cleanup
                 WHERE session_id IN (${placeholders})
                   AND harness LIKE '%:rust'${harnessPredicate}`).all(...sessionIds, ...harness === undefined ? [] : [`${harness}:rust`]);
    const protectedSessionIds = new Set(protectedRows.map((row) => row.session_id));
    deletableSessionIds = sessionIds.filter((sessionId) => !protectedSessionIds.has(sessionId));
  }
  if (deletableSessionIds.length === 0)
    return 0;
  const placeholders = deletableSessionIds.map(() => "?").join(", ");
  const harnessTables = SESSION_SCOPED_TABLES.filter((definition) => definition.harnessScoped);
  if (options.preserveTagRevisionTombstones) {
    const owners = cleanupStatement(db, harnessTables.map((definition) => `SELECT session_id, harness FROM ${definition.table} WHERE session_id IN (${placeholders})${definition.extraPredicate ? ` AND ${definition.extraPredicate}` : ""}`).join(" UNION ")).all(...harnessTables.flatMap(() => deletableSessionIds));
    const record = cleanupStatement(db, "INSERT OR IGNORE INTO schema_migrations_meta (key, value) VALUES (?, ?)");
    for (const owner of owners)
      record.run(tagTombstoneOwnerKey(owner.session_id, owner.harness), owner.harness);
    const fallback = cleanupStatement(db, `INSERT INTO schema_migrations_meta (key, value)
            SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM schema_migrations_meta WHERE key >= ? AND key < ?)`);
    for (const id of deletableSessionIds)
      fallback.run(tagTombstoneOwnerKey(id, getHarness2()), getHarness2(), ...tagTombstoneOwnerRange(id));
  }
  for (const sessionId of deletableSessionIds)
    deleteChunkEmbedBackoffForSession2(db, sessionId);
  for (const definition of SESSION_SCOPED_TABLES) {
    if (definition.table === "message_history_fts") {
      cleanupStatement(db, `DELETE FROM message_history_fts
                 WHERE rowid IN (
                     SELECT fts_rowid
                     FROM message_fts_rowid_map
                     WHERE session_id IN (${placeholders})
                 )`).run(...deletableSessionIds);
      deleteUnmappedMessageFtsRows2(db, deletableSessionIds);
      continue;
    }
    const predicates = [`session_id IN (${placeholders})`];
    if (definition.extraPredicate)
      predicates.push(definition.extraPredicate);
    const bindHarness = harness !== undefined && definition.harnessScoped === true;
    if (bindHarness)
      predicates.push("harness = ?");
    const statement = cleanupStatement(db, `DELETE FROM ${definition.table} WHERE ${predicates.join(" AND ")}`);
    if (bindHarness)
      statement.run(...deletableSessionIds, harness);
    else
      statement.run(...deletableSessionIds);
  }
  deleteSessionActivity(db, deletableSessionIds);
  if (!options.preserveTagRevisionTombstones) {
    const retireOwner = cleanupStatement(db, harness === undefined ? "DELETE FROM schema_migrations_meta WHERE key >= ? AND key < ?" : "DELETE FROM schema_migrations_meta WHERE key = ?");
    const survivingRows = harnessTables.map((definition) => `EXISTS (SELECT 1 FROM ${definition.table} WHERE session_id = ?${definition.extraPredicate ? ` AND ${definition.extraPredicate}` : ""})`).join(" OR ");
    const retire = cleanupStatement(db, `DELETE FROM schema_migrations_meta WHERE key IN (?, ?)
            AND NOT (${survivingRows})
            AND NOT EXISTS (SELECT 1 FROM schema_migrations_meta AS owners WHERE owners.key >= ? AND owners.key < ?)`);
    for (const id of deletableSessionIds) {
      if (harness === undefined)
        retireOwner.run(...tagTombstoneOwnerRange(id));
      else
        retireOwner.run(tagTombstoneOwnerKey(id, harness));
      retire.run(tagIdentityRevisionKey(id), tagRevisionKey(id), ...harnessTables.map(() => id), ...tagTombstoneOwnerRange(id));
    }
  }
  if (!options.deferRecoveryFenceCleanup)
    for (const sessionId of deletableSessionIds)
      clearLkgRecoveryFence(sessionId);
  return deletableSessionIds.length;
}

// ../plugin/src/features/magic-context/storage-meta-session.ts
var SESSION_META_FALLBACK_SELECTS = {
  cache_ttl: "'5m' AS cache_ttl",
  last_nudge_band: "'' AS last_nudge_band",
  last_transform_error: "'' AS last_transform_error",
  system_prompt_hash: "'' AS system_prompt_hash",
  last_todo_state: "'' AS last_todo_state",
  tool_reclaim_watermark: "0 AS tool_reclaim_watermark",
  cached_m0_bytes: "NULL AS cached_m0_bytes",
  cached_m0_mural_data_url: "NULL AS cached_m0_mural_data_url",
  cached_m0_mural_hash: "NULL AS cached_m0_mural_hash",
  cached_m1_bytes: "NULL AS cached_m1_bytes",
  cached_m0_project_memory_epoch: "NULL AS cached_m0_project_memory_epoch",
  cached_m0_project_user_profile_version: "NULL AS cached_m0_project_user_profile_version",
  cached_m0_max_compartment_seq: "NULL AS cached_m0_max_compartment_seq",
  cached_m0_max_memory_id: "NULL AS cached_m0_max_memory_id",
  cached_m0_max_mutation_id: "NULL AS cached_m0_max_mutation_id",
  cached_m0_max_memory_mutation_id: "NULL AS cached_m0_max_memory_mutation_id",
  cached_m0_project_docs_hash: "NULL AS cached_m0_project_docs_hash",
  cached_m0_materialized_at: "NULL AS cached_m0_materialized_at",
  cached_m0_session_facts_version: "NULL AS cached_m0_session_facts_version",
  cached_m0_upgrade_state: "NULL AS cached_m0_upgrade_state",
  cached_m0_system_hash: "NULL AS cached_m0_system_hash",
  cached_m0_tool_set_hash: "NULL AS cached_m0_tool_set_hash",
  cached_m0_model_key: "NULL AS cached_m0_model_key",
  cached_m0_project_identity: "NULL AS cached_m0_project_identity",
  last_observed_model_key: "NULL AS last_observed_model_key",
  upgrade_reminded_at: "NULL AS upgrade_reminded_at",
  upgrade_reminder_last_sent_at: "NULL AS upgrade_reminder_last_sent_at",
  upgrade_reminder_count: "0 AS upgrade_reminder_count"
};
var sessionMetaSelectColumnsCache = new WeakMap;
function getSessionMetaSelectColumns(db) {
  const cached = sessionMetaSelectColumnsCache.get(db);
  if (cached !== undefined)
    return cached;
  const existingColumns = new Set(db.prepare("PRAGMA table_info(session_meta)").all().map((column) => column.name));
  const projection = SESSION_META_SELECT_COLUMNS.map((column) => {
    if (existingColumns.has(column))
      return column;
    return SESSION_META_FALLBACK_SELECTS[column] ?? `0 AS ${column}`;
  }).join(", ");
  sessionMetaSelectColumnsCache.set(db, projection);
  return projection;
}
function findSessionMeta(db, sessionId) {
  const result = db.prepare(`SELECT ${getSessionMetaSelectColumns(db)} FROM session_meta WHERE session_id = ?`).get(sessionId);
  return isSessionMetaRow(result) ? toSessionMeta(result) : undefined;
}
function readSessionMeta(db, sessionId) {
  return findSessionMeta(db, sessionId) ?? getDefaultSessionMeta(sessionId);
}
var parentReadRetries = new WeakMap;
var PARENT_READ_ATTEMPTS = 5;
var PARENT_READ_COOLDOWN_MS = 30000;
function getOrCreateSessionMeta(db, sessionId) {
  const existing = findSessionMeta(db, sessionId);
  const harness = getHarness2();
  if (existing) {
    if (harness !== "opencode2")
      return existing;
    const row = db.prepare("SELECT is_subagent FROM session_meta WHERE session_id = ?").get(sessionId);
    if (row.is_subagent !== null)
      return existing;
  }
  const defaults = existing ?? getDefaultSessionMeta(sessionId);
  let retries = parentReadRetries.get(db);
  if (harness === "opencode2") {
    if (!retries) {
      retries = new BoundedSessionMap(1000);
      parentReadRetries.set(db, retries);
    }
    const retry = retries.get(sessionId);
    if (retry && retry.attempts >= PARENT_READ_ATTEMPTS && Date.now() - retry.at < PARENT_READ_COOLDOWN_MS)
      return defaults;
  }
  const fallbackSubagent = harness === "opencode" ? resolveIsSubagentFromOpenCodeDb(sessionId) : harness === "opencode2" ? resolveIsSubagentFromOpenCode2Db(sessionId) : null;
  if (fallbackSubagent === true) {
    defaults.isSubagent = true;
  }
  if (harness === "opencode2") {
    if (fallbackSubagent === null) {
      const previous = retries?.get(sessionId);
      const attempts = previous && Date.now() - previous.at < PARENT_READ_COOLDOWN_MS ? previous.attempts + 1 : 1;
      retries?.set(sessionId, { attempts, at: Date.now() });
      ensureSessionMetaRow(db, sessionId, null);
      return defaults;
    }
    retries?.delete(sessionId);
    ensureSessionMetaRow(db, sessionId, fallbackSubagent);
    db.prepare("UPDATE session_meta SET is_subagent = ? WHERE session_id = ? AND is_subagent IS NULL").run(fallbackSubagent ? 1 : 0, sessionId);
    return defaults;
  }
  ensureSessionMetaRow(db, sessionId);
  if (harness === "opencode" && fallbackSubagent === true) {
    db.prepare("UPDATE session_meta SET is_subagent = 1 WHERE session_id = ?").run(sessionId);
  }
  return defaults;
}
function updateSessionMeta(db, sessionId, updates) {
  const setClauses = [];
  const values = [];
  for (const [key, column] of Object.entries(META_COLUMNS)) {
    const value = updates[key];
    if (value === undefined)
      continue;
    if (value === null) {
      setClauses.push(`${column} = ?`);
      values.push(NULL_BIND_META_KEYS.has(key) ? null : "");
    } else if ((key === "cachedM0Bytes" || key === "cachedM1Bytes") && value instanceof Uint8Array) {
      setClauses.push(`${column} = ?`);
      values.push(Buffer2.from(value.buffer, value.byteOffset, value.byteLength));
    } else if (BOOLEAN_META_KEYS.has(key)) {
      setClauses.push(`${column} = ?`);
      values.push(value ? 1 : 0);
    } else if (typeof value === "string" || typeof value === "number") {
      setClauses.push(`${column} = ?`);
      values.push(key === "lastObservedModelKey" && typeof value === "string" ? piModelRefToCanonical(value) : value);
    }
  }
  if (setClauses.length === 0) {
    return;
  }
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare(`UPDATE session_meta SET ${setClauses.join(", ")} WHERE session_id = ?`).run(...values, sessionId);
  }).immediate();
}
function advanceToolReclaimWatermark(db, sessionId, maxTagNumber) {
  if (maxTagNumber <= 0)
    return;
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET tool_reclaim_watermark = MAX(COALESCE(tool_reclaim_watermark, 0), ?) WHERE session_id = ?").run(maxTagNumber, sessionId);
  }).immediate();
}
function rustCleanupHarness() {
  return `${getHarness2()}:rust`;
}
function retryPendingSessionCleanups(db, limit = 200) {
  const rows = db.prepare(`SELECT session_id
             FROM pending_session_cleanup
             WHERE harness NOT LIKE '%:rust'
             ORDER BY requested_at ASC, session_id ASC
             LIMIT ?`).all(Math.max(1, Math.floor(limit)));
  const failedSessionIds = [];
  let cleared = 0;
  for (const row of rows) {
    try {
      withoutSqliteTransformPass2(() => withSqliteBackgroundWriter2(() => {
        db.prepare("UPDATE pending_session_cleanup SET last_attempt_at = ? WHERE session_id = ?").run(Date.now(), row.session_id);
        clearSession(db, row.session_id, false, true);
      }));
      cleared += 1;
    } catch {
      failedSessionIds.push(row.session_id);
    }
  }
  return { attempted: rows.length, cleared, failedSessionIds };
}
async function retryPendingRustSessionCleanupsForProject(db, projectPath, deleteSession, limit = 200) {
  const harness = getHarness2();
  const rows = db.prepare(`SELECT pending.session_id
             FROM pending_session_cleanup pending
             JOIN session_projects projects
               ON projects.session_id = pending.session_id
              AND projects.harness = ?
             WHERE pending.harness = ?
               AND projects.project_path = ?
             ORDER BY pending.requested_at ASC, pending.session_id ASC
             LIMIT ?`).all(harness, rustCleanupHarness(), projectPath, Math.max(1, Math.floor(limit)));
  const failedSessionIds = [];
  let cleared = 0;
  for (const row of rows) {
    try {
      withoutSqliteTransformPass2(() => withSqliteBackgroundWriter2(() => db.prepare("UPDATE pending_session_cleanup SET last_attempt_at = ? WHERE session_id = ?").run(Date.now(), row.session_id)));
      await deleteSession(row.session_id);
      clearSession(db, row.session_id, true, true);
      cleared += 1;
    } catch {
      failedSessionIds.push(row.session_id);
    }
  }
  return { attempted: rows.length, cleared, failedSessionIds };
}
function clearSession(db, sessionId, rustModuleCleanupAcknowledged = false, permanentlyDeleted = false) {
  cancelAutoSearchWork(sessionId);
  let transactionStartedAt = 0;
  let clearedMarker = null;
  let eligibleSessions = 0;
  withoutSqliteTransformPass2(() => withSqliteBackgroundWriter2(() => db.transaction(() => {
    transactionStartedAt = performance.now();
    clearedMarker = getPendingPiCompactionMarkerState(db, sessionId);
    eligibleSessions = deleteSessionScopedRows(db, [sessionId], undefined, {
      rustModuleCleanupAcknowledged,
      preserveTagRevisionTombstones: !permanentlyDeleted,
      deferRecoveryFenceCleanup: true
    });
  }).immediate()));
  if (eligibleSessions > 0)
    clearLkgRecoveryFence(sessionId);
  if (clearedMarker)
    logPiCompactionMarkerClear(sessionId, clearedMarker, "session-reset");
  clearUnpublishedAutoSearchNoHints(sessionId);
  logSlowWriteTransaction("clear-session", transactionStartedAt);
}
// ../plugin/src/hooks/magic-context/pending-materialization.ts
var origins = new WeakMap;
var causes = new WeakMap;
function requestPendingMaterialization(sessions, sessionId, origin) {
  let reasons = origins.get(sessions);
  if (!reasons)
    origins.set(sessions, reasons = new Map);
  let sessionCauses = causes.get(sessions);
  if (!sessionCauses)
    causes.set(sessions, sessionCauses = new Map);
  let pendingCauses = sessionCauses.get(sessionId);
  if (!sessions.has(sessionId) || !pendingCauses) {
    pendingCauses = new Set;
    sessionCauses.set(sessionId, pendingCauses);
  }
  pendingCauses.add(origin);
  if (!sessions.has(sessionId) || !reasons.has(sessionId) || origin === "fit_retry")
    reasons.set(sessionId, origin);
  sessions.add(sessionId);
}
function pendingMaterializationOrigin(sessions, sessionId) {
  return sessions.has(sessionId) ? origins.get(sessions)?.get(sessionId) ?? "pending_materialization" : "pending_materialization";
}
function hasPendingMaterializationOrigin(sessions, sessionId, origin) {
  return sessions.has(sessionId) && causes.get(sessions)?.get(sessionId)?.has(origin) === true;
}
function clearPendingMaterialization(sessions, sessionId) {
  sessions.delete(sessionId);
  origins.get(sessions)?.delete(sessionId);
  causes.get(sessions)?.delete(sessionId);
}
function hasOnlySystemHashMaterialization(sessions, sessionId) {
  const pendingCauses = causes.get(sessions)?.get(sessionId);
  return sessions.has(sessionId) && pendingCauses?.size === 1 && pendingCauses.has("system_hash");
}

// ../plugin/src/hooks/magic-context/system-prompt-delivery.ts
var pending3 = new BoundedSessionMap(1000);
var retiredRequests = new WeakSet;
var heldRequests = new WeakSet;
var refreshOwners = new BoundedSessionMap(1000);
function recordSystemRefreshOwnership(sessionId, hash, ownsHistoryRefresh, history, materialization) {
  const previous = refreshOwners.get(sessionId);
  const inherited = previous?.ownsHistoryRefresh === true && previous.history === history && history?.has(sessionId) === true && materialization !== undefined && hasOnlySystemHashMaterialization(materialization, sessionId);
  refreshOwners.set(sessionId, {
    hash,
    ownsHistoryRefresh: ownsHistoryRefresh || inherited,
    history
  });
}
function preparation(sessionId, request) {
  if (retiredRequests.has(request))
    return;
  const previous = pending3.get(sessionId);
  if (previous?.request === request)
    return previous;
  const next = { request, held: false };
  pending3.set(sessionId, next);
  return next;
}
function recordSystemPromptForRequest(sessionId, request, hash, db, ownsHistoryRefresh, history, materialization) {
  if (!request || !hash)
    return;
  if (ownsHistoryRefresh !== undefined)
    recordSystemRefreshOwnership(sessionId, hash, ownsHistoryRefresh, history, materialization);
  const previous = pending3.get(sessionId);
  if (previous?.request === request && previous.held && previous.hash && previous.hash !== hash) {
    retirePendingSystemPromptDelivery(sessionId);
    return;
  }
  const saved = preparation(sessionId, request);
  if (!saved)
    return;
  const owner = refreshOwners.get(sessionId);
  Object.assign(saved, {
    hash,
    db,
    ownsHistoryRefresh: owner?.hash === hash && owner.ownsHistoryRefresh
  });
}
function recordHeldHeadForRequest(sessionId, request, deferRefresh) {
  const saved = request && preparation(sessionId, request);
  if (saved) {
    heldRequests.add(saved.request);
    Object.assign(saved, { held: true, deferRefresh });
  }
}
function bindSystemPromptResponse(sessionId, request, response) {
  const saved = pending3.get(sessionId);
  if (!saved || saved.request !== request || request?.kind !== "v2" || !response.responseId || response.responseId === request.previousResponseId || response.modelKey !== request.modelKey || !Number.isFinite(response.createdAt) || response.createdAt <= request.startedAt)
    return;
  if (saved.response && saved.response.id !== response.responseId)
    return;
  saved.response = { id: response.responseId, createdAt: response.createdAt };
}
function acknowledgeSystemPromptDelivery(args) {
  const saved = pending3.get(args.sessionId);
  if (!saved || saved.request !== args.request || !args.responseId)
    return;
  const request = saved.request;
  if (request.modelKey !== args.modelKey)
    return;
  if (request.kind === "v1") {
    if (args.v2 || request.responseId !== args.responseId)
      return;
  } else if (!args.v2 || request.previousResponseId === args.responseId || args.createdAt === undefined || !Number.isFinite(args.createdAt) || args.createdAt <= request.startedAt || saved.response?.id !== args.responseId || saved.response.createdAt !== args.createdAt)
    return;
  if (providerResponseFailed(args)) {
    retirePendingSystemPromptDelivery(args.sessionId);
    return;
  }
  if (!isSuccessfulProviderCompletion(args))
    return;
  retirePendingSystemPromptDelivery(args.sessionId);
  if (saved.held && saved.hash && saved.db) {
    try {
      updateSessionMeta(saved.db, args.sessionId, { cachedM0SystemHash: saved.hash });
      saved.deferRefresh?.(saved.ownsHistoryRefresh === true);
      refreshOwners.delete(args.sessionId);
    } catch (error) {
      sessionLog2(args.sessionId, "system delivery acknowledgement failed (keeping pending work):", error);
    }
  }
}
function deferDeliveredSystemRefresh(deps, sessionId, ownsHistoryRefresh) {
  if (!hasOnlySystemHashMaterialization(deps.pendingMaterializationSessions, sessionId))
    return;
  clearPendingMaterialization(deps.pendingMaterializationSessions, sessionId);
  (deps.deferredMaterializationSessions ??= new Set).add(sessionId);
  if (ownsHistoryRefresh && deps.historyRefreshSessions.delete(sessionId)) {
    (deps.deferredHistoryRefreshSessions ??= new Set).add(sessionId);
  }
}
function clearSystemPromptDelivery(sessionId) {
  retirePendingSystemPromptDelivery(sessionId);
  refreshOwners.delete(sessionId);
}
function retirePendingSystemPromptDelivery(sessionId) {
  const saved = pending3.get(sessionId);
  if (saved)
    retiredRequests.add(saved.request);
  pending3.delete(sessionId);
}

// ../plugin/src/hooks/magic-context/lkg-measured-request.ts
var requests = new BoundedSessionMap(1000);
var claimedRequests = new WeakSet;
var captures = new BoundedSessionMap(1000);
function clearCapturedLkgMeasurement(sessionId) {
  captures.delete(sessionId);
}

// ../plugin/src/hooks/magic-context/lkg-persist.ts
import { createHash as createHash4 } from "node:crypto";
function parseStringArray(value) {
  if (typeof value !== "string")
    return null;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed))
    return null;
  const result = [];
  for (const entry of parsed) {
    if (typeof entry !== "string" || entry.length === 0)
      return null;
    result.push(entry);
  }
  return result;
}
function parseNullableString(value) {
  if (value === null || value === undefined)
    return null;
  return typeof value === "string" ? value : undefined;
}
function parseNullableInteger(value) {
  if (value === null || value === undefined)
    return;
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}
function parsePersistedLkgSlot(row) {
  if (!row || typeof row !== "object")
    return;
  const record = row;
  const jsonPrefix = record.json_prefix;
  const lastInputMessageId = record.last_input_message_id;
  const capturedAt = record.captured_at;
  let inputIdsRaw = record.input_id_seq;
  let piOutputEntryIds;
  if (typeof inputIdsRaw === "string") {
    try {
      const metadata = JSON.parse(inputIdsRaw);
      if (metadata && !Array.isArray(metadata) && metadata.version === 1 && Array.isArray(metadata.piOutputEntryIds)) {
        if (!metadata.piOutputEntryIds.every((id) => id === null || typeof id === "string" && id.length > 0))
          return;
        piOutputEntryIds = metadata.piOutputEntryIds;
        inputIdsRaw = JSON.stringify(metadata.inputIds);
      }
    } catch {
      return;
    }
  }
  const inputIdSeq = parseStringArray(inputIdsRaw);
  const inputContentDigests = parseStringArray(record.input_content_digests);
  const modelKey = parseNullableString(record.model_key);
  const providerKey = parseNullableString(record.provider_key);
  if (typeof jsonPrefix !== "string" || typeof lastInputMessageId !== "string" || lastInputMessageId.length === 0 || typeof capturedAt !== "number" || !Number.isFinite(capturedAt) || inputIdSeq === null || inputContentDigests === null || inputContentDigests.length !== inputIdSeq.length || modelKey === undefined || providerKey === undefined) {
    return;
  }
  if (piOutputEntryIds) {
    try {
      const output = JSON.parse(jsonPrefix);
      const inputs = new Set(inputIdSeq);
      if (!Array.isArray(output) || output.length !== piOutputEntryIds.length || piOutputEntryIds.some((id) => id !== null && !inputs.has(id)))
        return;
    } catch {
      return;
    }
  }
  let inputContentSignatures;
  if (record.input_content_signatures !== null && record.input_content_signatures !== undefined) {
    const parsed = parseStringArray(record.input_content_signatures);
    if (parsed === null || parsed.length !== inputIdSeq.length)
      return;
    inputContentSignatures = parsed;
  }
  const slot = {
    jsonPrefix,
    inputIdSeq,
    inputContentDigests,
    lastInputMessageId,
    modelKey,
    providerKey,
    capturedAt
  };
  if (inputContentSignatures)
    slot.inputContentSignatures = inputContentSignatures;
  if (piOutputEntryIds)
    slot.piOutputEntryIds = piOutputEntryIds;
  const rowVersion = parseNullableInteger(record.row_version);
  if (rowVersion !== undefined)
    slot.rowVersion = rowVersion;
  const captureSequence = parseNullableInteger(record.capture_sequence);
  if (captureSequence !== undefined)
    slot.captureSequence = captureSequence;
  return slot;
}
var persistedFingerprints = new WeakMap;
var PERSISTED_FINGERPRINT_MAX_SESSIONS = 1000;
function rememberFingerprint(db, sessionId, fingerprint) {
  let saved = persistedFingerprints.get(db);
  if (!saved) {
    saved = new Map;
    persistedFingerprints.set(db, saved);
  }
  saved.delete(sessionId);
  if (saved.size >= PERSISTED_FINGERPRINT_MAX_SESSIONS) {
    const oldest = saved.keys().next().value;
    if (oldest !== undefined)
      saved.delete(oldest);
  }
  saved.set(sessionId, fingerprint);
}
function slotFingerprint(slot) {
  return createHash4("sha256").update(JSON.stringify([
    slot.jsonPrefix,
    slot.inputIdSeq,
    slot.inputContentDigests,
    slot.inputContentSignatures,
    slot.piOutputEntryIds,
    slot.lastInputMessageId,
    slot.modelKey,
    slot.providerKey,
    slot.rowVersion,
    slot.captureSequence
  ])).digest("hex");
}
function persistLkgSlot(db, sessionId, slot, publishMetadata) {
  const fingerprint = slotFingerprint(slot);
  if (!publishMetadata && persistedFingerprints.get(db)?.get(sessionId) === fingerprint) {
    const durable = loadPersistedLkgSlot(db, sessionId);
    if (durable && slotFingerprint(durable) === fingerprint)
      return true;
  }
  const layout = layoutLkgPrefix(slot.jsonPrefix);
  try {
    const inputIdSeq = JSON.stringify(slot.piOutputEntryIds ? { version: 1, inputIds: slot.inputIdSeq, piOutputEntryIds: slot.piOutputEntryIds } : slot.inputIdSeq);
    const inputContentDigests = JSON.stringify(slot.inputContentDigests);
    const inputContentSignatures = slot.inputContentSignatures ? JSON.stringify(slot.inputContentSignatures) : null;
    db.transaction(() => {
      const storedHashes = new Map;
      for (const row of db.prepare("SELECT chunk, hash FROM lkg_slot_chunks WHERE session_id = ?").all(sessionId)) {
        storedHashes.set(row.chunk, row.hash);
      }
      const upsertChunk = db.prepare(`INSERT INTO lkg_slot_chunks (session_id, chunk, hash, body) VALUES (?, ?, ?, ?)
                ON CONFLICT(session_id, chunk) DO UPDATE SET hash = excluded.hash, body = excluded.body`);
      for (let index = 0;index < layout.chunks.length; index += 1) {
        if (storedHashes.get(index) === layout.chunkHashes[index])
          continue;
        upsertChunk.run(sessionId, index, layout.chunkHashes[index], layout.chunks[index]);
      }
      db.prepare("DELETE FROM lkg_slot_chunks WHERE session_id = ? AND chunk >= ?").run(sessionId, layout.chunks.length);
      db.prepare(`INSERT INTO lkg_slots (
                    session_id, json_prefix_chars, json_prefix_chunks, json_prefix_hash,
                    input_id_seq, input_content_digests, input_content_signatures,
                    last_input_message_id, model_key, provider_key,
                    captured_at, row_version, capture_sequence
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    json_prefix_chars = excluded.json_prefix_chars,
                    json_prefix_chunks = excluded.json_prefix_chunks,
                    json_prefix_hash = excluded.json_prefix_hash,
                    input_id_seq = excluded.input_id_seq,
                    input_content_digests = excluded.input_content_digests,
                    input_content_signatures = excluded.input_content_signatures,
                    last_input_message_id = excluded.last_input_message_id,
                    model_key = excluded.model_key,
                    provider_key = excluded.provider_key,
                    captured_at = excluded.captured_at,
                    row_version = excluded.row_version,
                    capture_sequence = excluded.capture_sequence`).run(sessionId, layout.chars, layout.chunks.length, layout.hash, inputIdSeq, inputContentDigests, inputContentSignatures, slot.lastInputMessageId, slot.modelKey, slot.providerKey, slot.capturedAt, slot.rowVersion ?? null, slot.captureSequence ?? null);
      publishMetadata?.();
    }).immediate();
    rememberFingerprint(db, sessionId, fingerprint);
    return true;
  } catch (error) {
    if (!publishMetadata)
      sessionLog2(sessionId, "LKG snapshot persistence failed (in-memory slot retained):", error);
    return false;
  }
}
function saveLkgSlotToDb(db, sessionId, slot, publishMetadata, fence = {}) {
  return commitLkgWithRecoveryFence({
    sessionId,
    slot,
    ...fence,
    load: () => loadPersistedLkgSlot(db, sessionId, true),
    commit: () => persistLkgSlot(db, sessionId, slot, publishMetadata)
  });
}
function clearPersistedLkgSlot(db, sessionId) {
  try {
    clearPersistedLkgSlotStrict(db, sessionId);
  } catch (error) {
    sessionLog2(sessionId, "LKG snapshot durable clear failed:", error);
  }
}
function clearPersistedLkgSlotStrict(db, sessionId) {
  clearLkgRecoveryFence(sessionId, () => db.transaction(() => {
    db.prepare("DELETE FROM lkg_slot_chunks WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM lkg_slots WHERE session_id = ?").run(sessionId);
  }).immediate());
  persistedFingerprints.get(db)?.delete(sessionId);
}
function loadPersistedLkgSlot(db, sessionId, forPublication = false) {
  const rustHost = getHarness2() === "opencode" || getHarness2() === "opencode2";
  if (rustHost && !forPublication && isRustMarkerAdmissionFenced(db, sessionId))
    return;
  let row;
  let chunkRows;
  try {
    ({ row, chunkRows } = db.transaction(() => {
      const slotRow = db.prepare("SELECT * FROM lkg_slots WHERE session_id = ?").get(sessionId);
      if (!slotRow)
        return { row: undefined, chunkRows: [] };
      const slices = db.prepare("SELECT chunk, hash, body FROM lkg_slot_chunks WHERE session_id = ? ORDER BY chunk").all(sessionId);
      return { row: slotRow, chunkRows: slices };
    }).deferred());
  } catch (error) {
    sessionLog2(sessionId, "LKG snapshot durable load failed:", error);
    return;
  }
  if (!row)
    return;
  const prefix = assembleLkgPrefix({
    chars: row.json_prefix_chars,
    chunks: row.json_prefix_chunks,
    hash: row.json_prefix_hash
  }, chunkRows);
  const slot = prefix ? parsePersistedLkgSlot({ ...row, json_prefix: prefix.jsonPrefix }) : undefined;
  if (!prefix || !slot) {
    if (!prefix)
      sessionLog2(sessionId, "LKG snapshot slices failed verification; slot cleared");
    clearPersistedLkgSlot(db, sessionId);
    return;
  }
  return slot;
}
function pruneStaleLkgSlotsBatch(db, now) {
  const previousTimeout = db.prepare("PRAGMA busy_timeout").get();
  const cutoff = now - 7 * 24 * 60 * 60 * 1000;
  const stale = `captured_at < ? AND NOT EXISTS (
        SELECT 1 FROM session_projects sp
        WHERE sp.session_id = lkg_slots.session_id AND sp.updated_at >= ?
    )`;
  const slot = db.prepare(`SELECT session_id FROM lkg_slots WHERE ${stale} LIMIT 1`).get(cutoff, cutoff);
  const chunks = db.prepare(`SELECT rowid FROM lkg_slot_chunks c WHERE
        session_id = ? OR NOT EXISTS (SELECT 1 FROM lkg_slots s WHERE s.session_id = c.session_id)
        LIMIT 25`).all(slot?.session_id ?? "");
  if (!slot && chunks.length === 0)
    return { slots: 0, chunks: 0 };
  try {
    db.exec("PRAGMA busy_timeout = 0");
    let transactionStartedAt = 0;
    const remove = () => db.transaction(() => {
      transactionStartedAt = performance.now();
      const removed = slot ? db.prepare(`DELETE FROM lkg_slots WHERE session_id = ? AND ${stale}`).run(slot.session_id, cutoff, cutoff).changes : 0;
      const removeChunk = db.prepare(`DELETE FROM lkg_slot_chunks WHERE rowid = ? AND NOT EXISTS (
                SELECT 1 FROM lkg_slots s WHERE s.session_id = lkg_slot_chunks.session_id
            )`);
      let removedChunks = 0;
      for (const { rowid } of chunks)
        removedChunks += removeChunk.run(rowid).changes;
      return { slots: removed, chunks: removedChunks };
    }).immediate();
    const changes = slot ? clearLkgRecoveryFence(slot.session_id, remove, (result) => !!result?.slots) ?? {
      slots: 0,
      chunks: 0
    } : remove();
    logSlowWriteTransaction("lkg_stale_gc", transactionStartedAt);
    if (changes.slots && slot) {
      persistedFingerprints.get(db)?.delete(slot.session_id);
    }
    return changes;
  } finally {
    db.exec(`PRAGMA busy_timeout = ${Number(previousTimeout.timeout) || 0}`);
  }
}
async function drainStaleLkgSlots(db, now = Date.now(), budgetMs = 2000) {
  let removed = 0;
  await drainBackgroundBatches(() => {
    const batch = pruneStaleLkgSlotsBatch(db, now);
    removed += batch.slots;
    return batch.slots + batch.chunks > 0;
  }, { budgetMs });
  return removed;
}
function createDbLkgPersistence(db) {
  return {
    load: (sessionId) => loadPersistedLkgSlot(db, sessionId),
    clear: (sessionId) => clearPersistedLkgSlot(db, sessionId)
  };
}

// ../plugin/src/hooks/magic-context/openai-compat-adjacency.ts
function assertOpenAiCompatAdjacency(messages) {
  const violations = [];
  for (let i = 0;i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.tool_calls || msg.tool_calls.length === 0) {
      continue;
    }
    const expectedIds = msg.tool_calls.map((tc) => tc.id);
    const expectedSet = new Set(expectedIds);
    const collected = new Map;
    let j = i + 1;
    while (j < messages.length && messages[j].role === "tool") {
      const toolMsg = messages[j];
      const id = toolMsg.tool_call_id;
      if (!id) {
        violations.push({
          index: i,
          kind: "unmatched_tool_call_id",
          detail: `tool message at index ${j} missing tool_call_id`
        });
      } else if (!expectedSet.has(id)) {
        violations.push({
          index: i,
          kind: "unmatched_tool_call_id",
          toolCallId: id,
          assistantToolCallIds: expectedIds,
          detail: `tool message at index ${j} references unexpected id ${id}`
        });
      } else {
        collected.set(id, j);
      }
      j++;
    }
    const followingRoles = messages.slice(i + 1, Math.min(messages.length, i + 4)).map((m) => m.role);
    const missing = expectedIds.filter((id) => !collected.has(id));
    if (missing.length > 0) {
      violations.push({
        index: i,
        kind: "missing_tool_messages",
        assistantToolCallIds: expectedIds,
        followingRoles,
        detail: missing.length === expectedIds.length ? `assistant at index ${i} has tool_calls but next messages are not contiguous tool role (following: ${followingRoles.join(", ") || "none"})` : `assistant at index ${i} missing tool results for: ${missing.join(", ")}`
      });
      if (j < messages.length && messages[j].role !== "tool") {
        const last = violations[violations.length - 1];
        last.detail += `; blocked by ${messages.slice(i + 1, j + 1).map((m, off) => `${m.role}[${i + 1 + off}]`).join(", ")}`;
      }
    }
  }
  for (let i = 0;i < messages.length; i++) {
    if (messages[i].role !== "tool")
      continue;
    const id = messages[i].tool_call_id ?? "";
    if (!id)
      continue;
    let found = false;
    for (let k = i - 1;k >= 0; k--) {
      const prev = messages[k];
      if (prev.role === "assistant" && prev.tool_calls?.some((tc) => tc.id === id)) {
        const between = messages.slice(k + 1, i);
        if (between.every((m) => m.role === "tool")) {
          found = true;
        }
        break;
      }
      if (prev.role === "assistant" || prev.role === "user")
        break;
    }
    if (!found) {
      violations.push({
        index: i,
        kind: "orphan_tool_message",
        toolCallId: id,
        detail: `tool message at index ${i} is not immediately after its assistant tool_calls`
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

// ../plugin/src/hooks/magic-context/lkg-replay.ts
function canonicalLkgModelKeys(modelKey, providerKey) {
  const canonicalModelKey = modelKey ? piModelRefToCanonical(modelKey) : null;
  const slash = canonicalModelKey?.indexOf("/") ?? -1;
  return {
    modelKey: canonicalModelKey,
    providerKey: slash > 0 && canonicalModelKey ? canonicalModelKey.slice(0, slash) : providerKey
  };
}
function recordValue(info, key) {
  return info && typeof info === "object" ? info[key] : undefined;
}
function messageInfo(message) {
  if (message.info && typeof message.info === "object")
    return message.info;
  return message;
}
function messageParts(message) {
  return Array.isArray(message.parts) ? message.parts : [];
}
function messageRole(message) {
  const infoRole = recordValue(messageInfo(message), "role");
  if (typeof infoRole === "string")
    return infoRole;
  const role = recordValue(message, "role");
  return typeof role === "string" ? role : undefined;
}
function messageId(message) {
  const id = recordValue(messageInfo(message), "id") ?? recordValue(message, "id");
  return typeof id === "string" && id.length > 0 ? id : null;
}
function entryIdsAreValid(slot, entryIds) {
  if (slot.inputIdSeq.length === 0 || entryIds.length < slot.inputIdSeq.length)
    return false;
  if (slot.inputIdSeq[slot.inputIdSeq.length - 1] !== slot.lastInputMessageId)
    return false;
  const seen = new Set;
  for (const id of entryIds) {
    if (!id || seen.has(id))
      return false;
    seen.add(id);
  }
  if (entryIds.indexOf(slot.lastInputMessageId) !== slot.inputIdSeq.length - 1)
    return false;
  for (let index = 0;index < slot.inputIdSeq.length; index += 1) {
    if (entryIds[index] !== slot.inputIdSeq[index])
      return false;
  }
  return true;
}
function entryContentIsValid(slot, entry) {
  return entry.entryContentDigests.length >= slot.inputContentDigests.length && slot.inputContentDigests.every((digest, index) => isLegacyLkgDigest(digest) ? entry.entryLegacyContentDigests?.[index] === digest : entry.entryContentDigests[index] === digest);
}
function partCallIds(message) {
  const ids = [];
  for (const rawPart of messageParts(message)) {
    if (!rawPart || typeof rawPart !== "object")
      continue;
    const part = rawPart;
    if (part.type !== "tool" && part.type !== "tool_use")
      continue;
    const callId = part.callID ?? part.callId ?? part.id;
    if (typeof callId === "string" && callId.length > 0)
      ids.push(callId);
  }
  return ids;
}
function partResultIds(message) {
  const ids = [];
  for (const rawPart of messageParts(message)) {
    if (!rawPart || typeof rawPart !== "object")
      continue;
    const part = rawPart;
    if (part.type !== "tool_result" && part.type !== "tool-result")
      continue;
    const callId = part.tool_call_id ?? part.tool_use_id ?? part.callID ?? part.callId;
    if (typeof callId === "string" && callId.length > 0)
      ids.push(callId);
  }
  return ids;
}
function partIsReasoning(part) {
  return Boolean(part && typeof part === "object" && part.type === "reasoning");
}
function partIsAnthropicThinking(part) {
  if (!part || typeof part !== "object")
    return false;
  const type = part.type;
  return type === "thinking" || type === "reasoning" || type === "redacted_thinking";
}
function partEndsAnthropicAssistantRun(part) {
  if (!part || typeof part !== "object")
    return false;
  const value = part;
  if (value.type !== "tool" || value.providerExecuted === true || !value.state || typeof value.state !== "object") {
    return false;
  }
  const status = value.state.status;
  return status === "completed" || status === "error";
}
function partIsOpenCodeStepMetadata(part) {
  if (!part || typeof part !== "object")
    return false;
  const type = part.type;
  return type === "step-start" || type === "step-finish";
}
function validateAnthropicReasoningRuns(messages) {
  let index = 0;
  while (index < messages.length) {
    if (messageRole(messages[index]) !== "assistant") {
      index += 1;
      continue;
    }
    let firstMessageInRun = null;
    let sawOtherContent = false;
    while (index < messages.length && messageRole(messages[index]) === "assistant") {
      for (const part of messageParts(messages[index])) {
        if (partEndsAnthropicAssistantRun(part)) {
          firstMessageInRun = null;
          sawOtherContent = false;
        } else if (!partIsOpenCodeStepMetadata(part)) {
          if (firstMessageInRun === null)
            firstMessageInRun = index;
          if (partIsAnthropicThinking(part)) {
            if (sawOtherContent || index !== firstMessageInRun)
              return false;
          } else {
            sawOtherContent = true;
          }
        }
      }
      index += 1;
    }
  }
  return true;
}
function validateLkgSeamBoundary(prefix, tail) {
  const last = prefix[prefix.length - 1];
  const first = tail[0];
  if (!last || !first)
    return true;
  const lastCalls = partCallIds(last);
  if (lastCalls.length === 0)
    return true;
  const firstCalls = new Set([...partCallIds(first), ...partResultIds(first)]);
  if (messageRole(first) === "tool" || lastCalls.some((callId) => firstCalls.has(callId)))
    return false;
  return !messageParts(last).some((part) => {
    if (!part || typeof part !== "object")
      return false;
    const value = part;
    if (value.type !== "tool")
      return false;
    const state = value.state;
    return !state || typeof state !== "object" || state.status !== "completed";
  });
}
function validateLkgSeam(prefix, tail, providerKey) {
  const all = [...prefix, ...tail];
  const ids = new Set;
  const calls = new Set;
  const results = new Set;
  for (const message of all) {
    const id = messageId(message);
    if (id !== null) {
      if (ids.has(id))
        return false;
      ids.add(id);
    }
    for (const callId of partCallIds(message)) {
      if (calls.has(callId))
        return false;
      calls.add(callId);
    }
    for (const callId of partResultIds(message)) {
      if (results.has(callId))
        return false;
      results.add(callId);
    }
    if (messageRole(message) !== "assistant" && messageParts(message).some(partIsReasoning))
      return false;
    if (providerKey !== "anthropic" && messageParts(message).some((part) => {
      if (!part || typeof part !== "object")
        return false;
      const value = part;
      return (value.type === "text" || value.type === "reasoning") && value.text === "";
    }))
      return false;
  }
  if (!validateLkgSeamBoundary(prefix, tail))
    return false;
  const wireCandidates = all.map((message) => message);
  if (wireCandidates.every((message) => typeof message.role === "string")) {
    const adjacency = assertOpenAiCompatAdjacency(wireCandidates);
    if (!adjacency.ok)
      return false;
    const wireCallIds = new Set;
    for (const wireMessage of wireCandidates) {
      for (const call of wireMessage.tool_calls ?? []) {
        if (wireCallIds.has(call.id))
          return false;
        wireCallIds.add(call.id);
      }
    }
  }
  return true;
}
function replayLkg(args) {
  const slot = getSlot(args.sessionId);
  if (!slot)
    return { ok: false, reason: "lkg_invalidated_reshape" };
  const requestedModelKeys = canonicalLkgModelKeys(args.modelKey, args.providerKey);
  const capturedModelKeys = canonicalLkgModelKeys(slot.modelKey, slot.providerKey);
  if (capturedModelKeys.modelKey !== requestedModelKeys.modelKey || capturedModelKeys.providerKey !== requestedModelKeys.providerKey) {
    dropSlot(args.sessionId, "lkg_model_mismatch");
    return { ok: false, reason: "lkg_model_mismatch" };
  }
  const entry = args.entry ?? noteEntry(args.sessionId, args.messages);
  if (!entry || entry.anchorIndex !== slot.inputIdSeq.length - 1 || !entryIdsAreValid(slot, entry.entryInputIds)) {
    dropSlot(args.sessionId, "lkg_invalidated_reshape");
    return { ok: false, reason: "lkg_invalidated_reshape" };
  }
  if (!entryContentIsValid(slot, entry)) {
    dropSlot(args.sessionId, "lkg_content_mismatch");
    return { ok: false, reason: "lkg_content_mismatch" };
  }
  let prefix;
  try {
    const parsed = JSON.parse(slot.jsonPrefix);
    if (!Array.isArray(parsed))
      throw new Error("prefix is not an array");
    prefix = parsed;
  } catch {
    dropSlot(args.sessionId, "lkg_seam_invalid");
    return { ok: false, reason: "lkg_seam_invalid" };
  }
  const replayed = [...prefix, ...entry.pristineTail];
  args.prepareReplay?.(replayed);
  if (!args.skipSeamValidation) {
    if (!validateLkgSeamBoundary(prefix, entry.pristineTail)) {
      dropSlot(args.sessionId, "lkg_unsafe_seam");
      return { ok: false, reason: "lkg_unsafe_seam" };
    }
    if (!validateLkgSeam(prefix, entry.pristineTail, requestedModelKeys.providerKey)) {
      dropSlot(args.sessionId, "lkg_seam_invalid");
      return { ok: false, reason: "lkg_seam_invalid" };
    }
  }
  if (requestedModelKeys.providerKey === "anthropic" && !validateAnthropicReasoningRuns(replayed)) {
    dropSlot(args.sessionId, "lkg_anthropic_reasoning_run_invalid");
    return { ok: false, reason: "lkg_anthropic_reasoning_run_invalid" };
  }
  return { ok: true, messages: replayed };
}

// ../plugin/src/hooks/magic-context/lkg-recovery-prefix.ts
var sessions = new BoundedSessionMap(1000);
function clearLkgRecoverySession(sessionId) {
  sessions.delete(sessionId);
  clearLkgFenceProcessState(sessionId);
}
function noteLkgCapturedPrefix(sessionId) {
  if (!sessions.has(sessionId))
    sessions.set(sessionId, {});
}

// ../plugin/src/hooks/magic-context/lkg-slot.ts
var POSITIONAL_SYSTEM_KEY = "\x00mc-system:";
function lkgInputIdentity(id, role, index) {
  if (typeof id === "string" && id.length > 0)
    return id.startsWith(POSITIONAL_SYSTEM_KEY) ? null : id;
  return role === "system" ? `${POSITIONAL_SYSTEM_KEY}${index}` : null;
}
var LKG_SINGLE_SLOT_BYTES = 72 * 1024 * 1024;
var LKG_TOTAL_BYTES = 160 * 1024 * 1024;
var LKG_METADATA_BYTES = 256;

class MagicContextLkgHeapHolder {
  entries = new Map;
}
var lkgHeapHolder = new MagicContextLkgHeapHolder;
var totalBytes = 0;
var hydrationPassBySession = new BoundedSessionMap(1000);
var hydrationAttemptBySession = new BoundedSessionMap(1000);
var persistenceBackend;
function registerLkgPersistence(backend) {
  persistenceBackend = backend;
  hydrationPassBySession.clear();
  hydrationAttemptBySession.clear();
}
function slotBytes(slot) {
  const digestBytes = slot.inputContentDigests.reduce((total, digest) => total + 2 * digest.length, 0);
  const ownershipBytes = slot.piOutputEntryIds?.reduce((total, id) => total + (id?.length ?? 0) * 2 + 8, 0) ?? 0;
  return 2 * slot.jsonPrefix.length + digestBytes + ownershipBytes + LKG_METADATA_BYTES;
}
var LKG_SNAPSHOT_ARRAY = Symbol("array");
var LKG_SNAPSHOT_OBJECT = Symbol("object");
var LKG_SNAPSHOT_KEY = Symbol("key");
var LKG_SNAPSHOT_STRING = Symbol("string");
var LKG_SNAPSHOT_NUMBER = Symbol("number");
var LKG_SNAPSHOT_BOOLEAN = Symbol("boolean");
var LKG_SNAPSHOT_NULL = Symbol("null");
var LKG_SNAPSHOT_UNDEFINED = Symbol("undefined");
var FNV1A_32_OFFSET = 2166136261;
var FNV1A_32_PRIME = 16777619;
function updateFnv1a32(hash, value) {
  let next = hash;
  for (let index = 0;index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, FNV1A_32_PRIME) >>> 0;
  }
  return next;
}
function isSnapshotObjectChild(value) {
  return value !== undefined && typeof value !== "function" && typeof value !== "symbol";
}
function contentSnapshotValue(value) {
  if (!value || typeof value !== "object")
    return value;
  return withoutEmptyUserDiffSummary(providerVisibleMessage(value));
}
function withoutEmptyUserDiffSummary(value) {
  if (!value || typeof value !== "object")
    return value;
  const message = value;
  const info = message.info;
  const summary = info?.summary;
  if (!Array.isArray(message.parts) || info?.role !== "user" || summary === null || typeof summary !== "object" || Array.isArray(summary) || Object.keys(summary).length !== 1 || !Array.isArray(summary.diffs) || summary.diffs.length !== 0)
    return value;
  return {
    ...message,
    info: Object.fromEntries(Object.entries(info).filter(([key]) => key !== "summary"))
  };
}
function signatureForFields(fields) {
  let hash = FNV1A_32_OFFSET;
  for (const field of fields) {
    const value = typeof field === "symbol" ? field.description ?? "" : String(field);
    hash = updateFnv1a32(hash, `${typeof field}:${value.length}:`);
    hash = updateFnv1a32(hash, value);
    hash = updateFnv1a32(hash, "\x00");
  }
  return hash.toString(16).padStart(8, "0");
}
function lkgContentFields(value) {
  return flattenContentFields(contentSnapshotValue(value));
}
function flattenContentFields(snapshot) {
  const fields = [];
  const seen = new WeakSet;
  const visit = (child) => {
    if (child === null)
      fields.push(LKG_SNAPSHOT_NULL);
    else if (typeof child === "string")
      fields.push(LKG_SNAPSHOT_STRING, child);
    else if (typeof child === "number")
      fields.push(LKG_SNAPSHOT_NUMBER, child);
    else if (typeof child === "boolean")
      fields.push(LKG_SNAPSHOT_BOOLEAN, child);
    else if (child === undefined || typeof child === "function" || typeof child === "symbol") {
      fields.push(LKG_SNAPSHOT_UNDEFINED);
    } else if (Array.isArray(child)) {
      if (seen.has(child))
        throw new Error("cyclic message");
      seen.add(child);
      fields.push(LKG_SNAPSHOT_ARRAY, child.length);
      for (const item of child)
        visit(item);
      seen.delete(child);
    } else if (typeof child === "object") {
      if (seen.has(child))
        throw new Error("cyclic message");
      seen.add(child);
      const entries = Object.entries(child).filter(([, entry]) => entry !== undefined && typeof entry !== "function" && typeof entry !== "symbol");
      fields.push(LKG_SNAPSHOT_OBJECT, entries.length);
      for (const [key, entry] of entries) {
        fields.push(LKG_SNAPSHOT_KEY, key);
        visit(entry);
      }
      seen.delete(child);
    } else
      fields.push(LKG_SNAPSHOT_UNDEFINED);
  };
  try {
    visit(snapshot);
    return fields;
  } catch {
    return null;
  }
}
var DIGEST_TAG_STRING = 1;
var DIGEST_TAG_NUMBER = 2;
var DIGEST_TAG_TRUE = 3;
var DIGEST_TAG_FALSE = 4;
var DIGEST_TAG_OTHER_SYMBOL = 5;
var DIGEST_SYMBOL_TAGS = new Map([
  [LKG_SNAPSHOT_ARRAY, 16],
  [LKG_SNAPSHOT_OBJECT, 17],
  [LKG_SNAPSHOT_KEY, 18],
  [LKG_SNAPSHOT_STRING, 19],
  [LKG_SNAPSHOT_NUMBER, 20],
  [LKG_SNAPSHOT_BOOLEAN, 21],
  [LKG_SNAPSHOT_NULL, 22],
  [LKG_SNAPSHOT_UNDEFINED, 23]
]);
var DIGEST_CHUNK_BYTES = 64 * 1024;
var digestChunk;
function lkgContentDigestFromFields(fields) {
  lkgDigestsComputed += 1;
  const hash = createHash5("sha256");
  digestChunk ??= Buffer.allocUnsafe(DIGEST_CHUNK_BYTES);
  const chunk = digestChunk;
  let offset = 0;
  const room = (bytes) => {
    if (offset + bytes <= chunk.length)
      return;
    hash.update(chunk.subarray(0, offset));
    offset = 0;
  };
  const writeString = (tag, value) => {
    const bytes = value.length * 2;
    room(5);
    chunk[offset] = tag;
    chunk.writeUInt32LE(value.length, offset + 1);
    offset += 5;
    if (bytes <= chunk.length - offset) {
      chunk.write(value, offset, bytes, "utf16le");
      offset += bytes;
      return;
    }
    hash.update(chunk.subarray(0, offset));
    offset = 0;
    hash.update(Buffer.from(value, "utf16le"));
  };
  for (const field of fields) {
    if (typeof field === "string") {
      writeString(DIGEST_TAG_STRING, field);
    } else if (typeof field === "number") {
      room(9);
      chunk[offset] = DIGEST_TAG_NUMBER;
      chunk.writeDoubleLE(field, offset + 1);
      offset += 9;
    } else if (typeof field === "boolean") {
      room(1);
      chunk[offset] = field ? DIGEST_TAG_TRUE : DIGEST_TAG_FALSE;
      offset += 1;
    } else {
      const tag = DIGEST_SYMBOL_TAGS.get(field);
      if (tag === undefined) {
        writeString(DIGEST_TAG_OTHER_SYMBOL, field.description ?? "");
      } else {
        room(1);
        chunk[offset] = tag;
        offset += 1;
      }
    }
  }
  if (offset > 0)
    hash.update(chunk.subarray(0, offset));
  return LKG_DIGEST_FORMAT_PREFIX + hash.digest("base64url");
}
var LKG_DIGEST_FORMAT_PREFIX = "2.";
function isLegacyLkgDigest(digest) {
  return !digest.startsWith(LKG_DIGEST_FORMAT_PREFIX);
}
function legacyLkgDigestFromFields(fields) {
  lkgDigestsComputed += 1;
  let key = "";
  for (const field of fields) {
    const value = typeof field === "symbol" ? field.description ?? "" : String(field);
    key += `${typeof field}:${value.length}:${value}\x00`;
  }
  return createHash5("sha256").update(key).digest("base64url");
}
function legacyLkgContentDigest(message) {
  const fields = flattenContentFields(withoutEmptyUserDiffSummary(message));
  return fields ? legacyLkgDigestFromFields(fields) : null;
}
function lkgFieldsMatchDigest(fields, stored) {
  if (stored === undefined)
    return false;
  return isLegacyLkgDigest(stored) ? legacyLkgDigestFromFields(fields) === stored : lkgContentDigestFromFields(fields) === stored;
}
var digestMemo = new Map;
var DIGEST_MEMO_MAX_BYTES = 16 * 1024 * 1024;
function equalContentFields(left, right) {
  if (left === right)
    return true;
  if (left.length !== right.length)
    return false;
  for (let index = 0;index < left.length; index += 1) {
    if (!Object.is(left[index], right[index]))
      return false;
  }
  return true;
}
function exactReusablePrefix(current, prior) {
  if (!prior)
    return 0;
  let prefix = 0;
  while (prefix < current.length && prefix < prior.length && current[prefix]?.id === prior[prefix]?.id && equalContentFields(current[prefix]?.fields ?? [], prior[prefix]?.fields ?? [])) {
    prefix += 1;
  }
  return prefix;
}
function incrementalLkgContentDigests(entries, prior) {
  const aligned = prior !== undefined && prior.ids.length === prior.signatures.length && prior.signatures.length === prior.digests.length;
  let reusedPrefix = 0;
  if (aligned && prior) {
    while (reusedPrefix < entries.length && reusedPrefix < prior.ids.length && entries[reusedPrefix]?.id === prior.ids[reusedPrefix] && entries[reusedPrefix]?.signature === prior.signatures[reusedPrefix] && !isLegacyLkgDigest(prior.digests[reusedPrefix] ?? "")) {
      reusedPrefix += 1;
    }
  }
  const digests = [];
  if (aligned && prior) {
    for (let index = 0;index < reusedPrefix; index += 1) {
      digests.push(prior.digests[index]);
    }
  }
  for (let index = reusedPrefix;index < entries.length; index += 1) {
    digests.push(lkgContentDigestFromFields(entries[index]?.fields ?? []));
  }
  return { digests, reusedPrefix };
}
function touch(sessionId, entry) {
  lkgHeapHolder.entries.delete(sessionId);
  lkgHeapHolder.entries.set(sessionId, entry);
}
function lkgSlotRejection(sessionId, slot) {
  if (slot.inputContentDigests.length !== slot.inputIdSeq.length)
    return `digest_count=${slot.inputContentDigests.length} inputs=${slot.inputIdSeq.length}`;
  const emptyDigest = slot.inputContentDigests.findIndex((digest) => digest.length === 0);
  if (emptyDigest >= 0)
    return `empty_digest_at=${emptyDigest}`;
  if (slot.inputContentSignatures !== undefined) {
    if (slot.inputContentSignatures.length !== slot.inputIdSeq.length)
      return `signature_count=${slot.inputContentSignatures.length} inputs=${slot.inputIdSeq.length}`;
    const emptySignature = slot.inputContentSignatures.findIndex((signature) => signature.length === 0);
    if (emptySignature >= 0)
      return `empty_signature_at=${emptySignature}`;
  }
  const bytes = slotBytes(slot);
  if (bytes > LKG_SINGLE_SLOT_BYTES)
    return `slot_bytes=${bytes}`;
  const prior = lkgHeapHolder.entries.get(sessionId);
  if (prior?.slot.rowVersion !== undefined && slot.rowVersion !== undefined && (slot.rowVersion < prior.slot.rowVersion || slot.rowVersion === prior.slot.rowVersion && (slot.captureSequence ?? 0) < (prior.slot.captureSequence ?? 0))) {
    return `stale row_version=${slot.rowVersion}/${prior.slot.rowVersion} capture_sequence=${slot.captureSequence ?? 0}/${prior.slot.captureSequence ?? 0}`;
  }
  return null;
}
function captureSlot(sessionId, slot) {
  if (lkgSlotRejection(sessionId, slot) !== null)
    return false;
  const bytes = slotBytes(slot);
  const prior = lkgHeapHolder.entries.get(sessionId);
  if (prior)
    totalBytes -= prior.bytes;
  lkgHeapHolder.entries.delete(sessionId);
  while (totalBytes + bytes > LKG_TOTAL_BYTES) {
    const oldest = lkgHeapHolder.entries.keys().next().value;
    if (oldest === undefined)
      break;
    const evicted = lkgHeapHolder.entries.get(oldest);
    lkgHeapHolder.entries.delete(oldest);
    if (evicted)
      totalBytes -= evicted.bytes;
  }
  if (totalBytes + bytes > LKG_TOTAL_BYTES) {
    if (prior) {
      lkgHeapHolder.entries.set(sessionId, prior);
      totalBytes += prior.bytes;
    }
    return false;
  }
  const entry = {
    slot: {
      ...slot,
      ...slot.piOutputEntryIds ? { piOutputEntryIds: [...slot.piOutputEntryIds] } : {},
      inputIdSeq: [...slot.inputIdSeq],
      inputContentDigests: [...slot.inputContentDigests],
      inputContentSignatures: slot.inputContentSignatures ? [...slot.inputContentSignatures] : undefined
    },
    bytes
  };
  lkgHeapHolder.entries.set(sessionId, entry);
  totalBytes += bytes;
  hydrationAttemptBySession.delete(sessionId);
  noteLkgCapturedPrefix(sessionId);
  return true;
}
function installHydratedSlot(sessionId, slot) {
  const bytes = slotBytes(slot);
  if (bytes > LKG_SINGLE_SLOT_BYTES)
    return false;
  const prior = lkgHeapHolder.entries.get(sessionId);
  if (prior)
    totalBytes -= prior.bytes;
  lkgHeapHolder.entries.delete(sessionId);
  while (totalBytes + bytes > LKG_TOTAL_BYTES) {
    const oldest = lkgHeapHolder.entries.keys().next().value;
    if (oldest === undefined)
      break;
    const evicted = lkgHeapHolder.entries.get(oldest);
    lkgHeapHolder.entries.delete(oldest);
    if (evicted)
      totalBytes -= evicted.bytes;
  }
  if (totalBytes + bytes > LKG_TOTAL_BYTES) {
    if (prior) {
      lkgHeapHolder.entries.set(sessionId, prior);
      totalBytes += prior.bytes;
    }
    return false;
  }
  const entry = {
    slot: {
      ...slot,
      ...slot.piOutputEntryIds ? { piOutputEntryIds: [...slot.piOutputEntryIds] } : {},
      inputIdSeq: [...slot.inputIdSeq],
      inputContentDigests: [...slot.inputContentDigests],
      inputContentSignatures: slot.inputContentSignatures ? [...slot.inputContentSignatures] : undefined
    },
    bytes
  };
  lkgHeapHolder.entries.set(sessionId, entry);
  totalBytes += bytes;
  return true;
}
function hydrateSlotFromPersistence(sessionId) {
  const backend = persistenceBackend;
  if (!backend)
    return;
  let loaded;
  try {
    loaded = backend.load(sessionId);
  } catch (error) {
    sessionLog2(sessionId, "LKG durable hydration failed:", error);
    return;
  }
  if (!loaded)
    return;
  if (!installHydratedSlot(sessionId, loaded))
    return;
  sessionLog2(sessionId, "lkg_hydrated_from_disk");
  const entry = lkgHeapHolder.entries.get(sessionId);
  return entry ? copySlotForRead(entry.slot) : undefined;
}
function copySlotForRead(slot) {
  return {
    ...slot,
    ...slot.piOutputEntryIds ? { piOutputEntryIds: [...slot.piOutputEntryIds] } : {},
    inputIdSeq: [...slot.inputIdSeq],
    inputContentDigests: [...slot.inputContentDigests],
    inputContentSignatures: slot.inputContentSignatures ? [...slot.inputContentSignatures] : undefined
  };
}
function getInMemorySlot(sessionId) {
  const entry = lkgHeapHolder.entries.get(sessionId);
  return entry ? copySlotForRead(entry.slot) : undefined;
}
function getSlot(sessionId) {
  const entry = lkgHeapHolder.entries.get(sessionId);
  if (!entry) {
    const pass = hydrationPassBySession.peek(sessionId);
    if (pass !== undefined) {
      if (hydrationAttemptBySession.peek(sessionId) === pass)
        return;
      hydrationAttemptBySession.set(sessionId, pass);
    }
    return hydrateSlotFromPersistence(sessionId);
  }
  touch(sessionId, entry);
  return copySlotForRead(entry.slot);
}
function forgetInMemorySlot(sessionId) {
  clearLkgRecoverySession(sessionId);
  const entry = lkgHeapHolder.entries.get(sessionId);
  if (entry) {
    lkgHeapHolder.entries.delete(sessionId);
    totalBytes -= entry.bytes;
  }
}
function dropSlot(sessionId, _reason) {
  clearCapturedLkgMeasurement(sessionId);
  forgetInMemorySlot(sessionId);
  const backend = persistenceBackend;
  if (!backend)
    return;
  try {
    backend.clear(sessionId);
  } catch (error) {
    sessionLog2(sessionId, "LKG durable clear failed:", error);
  }
  const pass = hydrationPassBySession.peek(sessionId);
  if (pass !== undefined)
    hydrationAttemptBySession.set(sessionId, pass);
}
function noteEntry(sessionId, input) {
  const slot = getSlot(sessionId);
  if (!slot)
    return null;
  const messages = input;
  const entryInputIds = messages.map((message, index) => lkgInputIdentity(message.info?.id, message.info?.role, index) ?? "");
  const anchorIndex = entryInputIds.indexOf(slot.lastInputMessageId);
  if (anchorIndex < 0)
    return null;
  const digests = sharedLkgEntryDigests.digests(sessionId, messages).digests;
  const entryContentDigests = [];
  for (let index = 0;index <= anchorIndex; index += 1) {
    const digest = digests[index];
    if (digest === null || digest === undefined)
      return null;
    entryContentDigests.push(digest);
  }
  const pristineTail = structuredClone(messages.slice(anchorIndex + 1));
  const entryLegacyContentDigests = slot.inputContentDigests.some(isLegacyLkgDigest) ? messages.slice(0, anchorIndex + 1).map((message) => legacyLkgContentDigest(message)) : undefined;
  return {
    pristineTail,
    entryInputIds,
    entryContentDigests,
    ...entryLegacyContentDigests ? { entryLegacyContentDigests } : {},
    anchorIndex
  };
}
function contentMatchesFields(value, fields) {
  let cursor = 0;
  const visit = (child) => {
    if (child === null)
      return fields[cursor++] === LKG_SNAPSHOT_NULL;
    switch (typeof child) {
      case "string": {
        if (fields[cursor] !== LKG_SNAPSHOT_STRING)
          return false;
        const prior = fields[cursor + 1];
        if (typeof prior !== "string" || prior.length !== child.length)
          return false;
        if (prior !== child)
          return false;
        lkgEntryWork.comparedChars += child.length;
        fields[cursor + 1] = child;
        cursor += 2;
        return true;
      }
      case "number":
        if (fields[cursor] !== LKG_SNAPSHOT_NUMBER)
          return false;
        if (!Object.is(fields[cursor + 1], child))
          return false;
        cursor += 2;
        return true;
      case "boolean":
        if (fields[cursor] !== LKG_SNAPSHOT_BOOLEAN || fields[cursor + 1] !== child) {
          return false;
        }
        cursor += 2;
        return true;
      case "object": {
        if (Array.isArray(child)) {
          if (fields[cursor] !== LKG_SNAPSHOT_ARRAY)
            return false;
          if (fields[cursor + 1] !== child.length)
            return false;
          cursor += 2;
          for (const item of child) {
            if (!visit(item))
              return false;
          }
          return true;
        }
        if (fields[cursor] !== LKG_SNAPSHOT_OBJECT)
          return false;
        const keys = Object.keys(child);
        let entryCount = 0;
        for (const key of keys) {
          if (isSnapshotObjectChild(child[key])) {
            entryCount += 1;
          }
        }
        if (fields[cursor + 1] !== entryCount)
          return false;
        cursor += 2;
        for (const key of keys) {
          const entry = child[key];
          if (!isSnapshotObjectChild(entry))
            continue;
          if (fields[cursor] !== LKG_SNAPSHOT_KEY || fields[cursor + 1] !== key) {
            return false;
          }
          cursor += 2;
          if (!visit(entry))
            return false;
        }
        return true;
      }
      default:
        return fields[cursor++] === LKG_SNAPSHOT_UNDEFINED;
    }
  };
  try {
    return visit(contentSnapshotValue(value)) && cursor === fields.length;
  } catch {
    return false;
  } finally {
    lkgEntryWork.comparedFields += Math.min(cursor, fields.length);
  }
}
var lkgEntryWork = {
  flattenedMessages: 0,
  flattenedChars: 0,
  hashedMessages: 0,
  comparedMessages: 0,
  comparedFields: 0,
  comparedChars: 0
};
function lkgEntryBytes(id, fields) {
  let bytes = id.length * 2 + 166;
  for (const field of fields) {
    bytes += 16;
    if (typeof field === "string")
      bytes += field.length * 2;
  }
  return bytes;
}

class LkgEntryDigestCache {
  limits;
  sessions = new Map;
  totalBytes = 0;
  constructor(limits) {
    this.limits = limits;
  }
  digests(sessionId, messages) {
    const prior = this.sessions.get(sessionId);
    const sessionCount = this.sessions.size + (prior ? 0 : 1);
    const share = Math.min(this.limits.sessionMaxBytes, Math.floor(this.limits.totalMaxBytes / Math.min(sessionCount, this.limits.maxSessions)));
    const retained = new Map;
    const digests = [];
    let reused = 0;
    let size = 0;
    for (const message of messages) {
      const rawId = message.info?.id;
      const id = typeof rawId === "string" ? rawId : "";
      let entry = prior?.entries.get(id);
      if (entry)
        lkgEntryWork.comparedMessages += 1;
      if (entry && contentMatchesFields(message, entry.fields)) {
        reused += 1;
      } else {
        entry = undefined;
        const fields = lkgContentFields(message);
        lkgEntryWork.flattenedMessages += 1;
        if (fields) {
          for (const field of fields) {
            if (typeof field === "string")
              lkgEntryWork.flattenedChars += field.length;
          }
          lkgEntryWork.hashedMessages += 1;
          entry = {
            fields,
            digest: lkgContentDigestFromFields(fields),
            bytes: lkgEntryBytes(id, fields)
          };
        }
      }
      digests.push(entry?.digest ?? null);
      if (!entry || retained.has(id) || size + entry.bytes > share)
        continue;
      retained.set(id, entry);
      size += entry.bytes;
    }
    this.store(sessionId, retained, size, share);
    return { digests, stats: { reused, retained: retained.size, retainedBytes: size } };
  }
  store(sessionId, entries, bytes, share) {
    const prior = this.sessions.get(sessionId);
    if (prior) {
      this.totalBytes -= prior.bytes;
      this.sessions.delete(sessionId);
    }
    if (entries.size === 0)
      return;
    while (this.sessions.size >= this.limits.maxSessions) {
      const oldest = this.sessions.entries().next().value;
      if (!oldest)
        break;
      this.totalBytes -= oldest[1].bytes;
      this.sessions.delete(oldest[0]);
    }
    for (const other of this.sessions.values()) {
      if (other.bytes <= share)
        continue;
      let kept = 0;
      for (const [id, entry] of other.entries) {
        if (kept + entry.bytes > share)
          other.entries.delete(id);
        else
          kept += entry.bytes;
      }
      this.totalBytes -= other.bytes - kept;
      other.bytes = kept;
    }
    while (this.totalBytes + bytes > this.limits.totalMaxBytes) {
      const oldest = this.sessions.entries().next().value;
      if (!oldest)
        break;
      this.totalBytes -= oldest[1].bytes;
      this.sessions.delete(oldest[0]);
    }
    this.sessions.set(sessionId, { entries, bytes });
    this.totalBytes += bytes;
  }
  stats() {
    return {
      totalBytes: this.totalBytes,
      sessions: [...this.sessions].map(([sessionId, session]) => ({
        sessionId,
        bytes: session.bytes
      }))
    };
  }
  clear() {
    this.sessions.clear();
    this.totalBytes = 0;
  }
}
var LKG_ENTRY_CACHE_TOTAL_BYTES = 256 * 1024 * 1024;
var LKG_ENTRY_CACHE_SESSION_BYTES = 128 * 1024 * 1024;
var LKG_ENTRY_CACHE_MAX_SESSIONS = 16;
var sharedLkgEntryDigests = new LkgEntryDigestCache({
  sessionMaxBytes: LKG_ENTRY_CACHE_SESSION_BYTES,
  totalMaxBytes: LKG_ENTRY_CACHE_TOTAL_BYTES,
  maxSessions: LKG_ENTRY_CACHE_MAX_SESSIONS
});
var lkgDigestsComputed = 0;

// ../plugin/src/hooks/magic-context/tool-sweep-policy.ts
var TOOL_SWEEP_SCOPED_MARKER = "@tool-sweep-scoped";
var RESERVED_LEDGER_CONTROL_ENTRIES = [
  TOOL_SWEEP_SCOPED_MARKER,
  THINKING_BINDING_STRIP_ORDER_END_MARKER
];
function isReservedLedgerControlEntry(entry) {
  return RESERVED_LEDGER_CONTROL_ENTRIES.includes(entry);
}

// ../plugin/src/features/magic-context/pi-content-decisions.ts
var PREFIX2 = "pi-content-replay-v1:";
var PI_CONTENT_DECISION_LIMIT = 4096;
var PI_IDENTITY_RECURRENCE_ALLOWANCE = 64;
function encodePiContentDecision(kind, messageId) {
  return PREFIX2 + JSON.stringify([kind, messageId]);
}
function decodePiContentDecision(value) {
  if (!value.startsWith(PREFIX2))
    return null;
  try {
    const pair = JSON.parse(value.slice(PREFIX2.length));
    if (Array.isArray(pair) && pair.length === 2 && (pair[0] === "reminder-strip" || pair[0] === "seam-temporal-strip" || pair[0] === "tag-identity-repair-once" || pair[0] === "tag-identity-repair-pending" || pair[0] === "tag-identity-rebuild-failed" || pair[0] === "tag-identity-recurring") && typeof pair[1] === "string" && pair[1].length > 0)
      return [pair[0], pair[1]];
  } catch {}
  return null;
}
function readEntries(raw) {
  if (!raw)
    return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new Error("Invalid persisted Pi content decision set");
  }
  return parsed;
}
function getPiContentDecisions(db, sessionId) {
  const row = db.prepare("SELECT merged_reasoning_stripped_ids AS decisions FROM session_meta WHERE session_id = ?").get(sessionId);
  return new Set(readEntries(row?.decisions ?? null).filter((value) => decodePiContentDecision(value) !== null));
}
function freezePiContentDecision(db, sessionId, kind, messageId) {
  try {
    ensureSessionMetaRow(db, sessionId);
    const entry = encodePiContentDecision(kind, messageId);
    return db.transaction(() => {
      for (let attempt = 0;attempt < 5; attempt++) {
        const row = db.prepare("SELECT merged_reasoning_stripped_ids AS decisions FROM session_meta WHERE session_id = ?").get(sessionId);
        const current = readEntries(row.decisions);
        if (current.includes(entry))
          return true;
        const ownsTag = db.prepare("SELECT 1 FROM tags WHERE session_id = ? AND message_id = ? LIMIT 1");
        const ownsMessage = db.prepare("SELECT 1 FROM tags WHERE session_id = ? AND message_id >= ? AND message_id < ? LIMIT 1");
        const kept = current.filter((value) => {
          const decision = decodePiContentDecision(value);
          return !decision || decision[0] === "tag-identity-repair-once" || decision[0] === "tag-identity-repair-pending" || decision[0] === "tag-identity-rebuild-failed" || decision[0] === "tag-identity-recurring" || !!(decision[0] === "seam-temporal-strip" ? ownsMessage.get(sessionId, `${decision[1]}:p`, `${decision[1]}:q`) : ownsTag.get(sessionId, decision[1]));
        });
        const limit = kind === "tag-identity-recurring" ? PI_CONTENT_DECISION_LIMIT + PI_IDENTITY_RECURRENCE_ALLOWANCE : PI_CONTENT_DECISION_LIMIT;
        if (kept.filter((value) => decodePiContentDecision(value) !== null).length >= limit)
          return false;
        kept.push(entry);
        const result = db.prepare("UPDATE session_meta SET merged_reasoning_stripped_ids = ? WHERE session_id = ? AND merged_reasoning_stripped_ids IS ?").run(JSON.stringify(kept), sessionId, row.decisions);
        if (result.changes > 0)
          return true;
      }
      return false;
    }).immediate();
  } catch (error) {
    if (/database (?:table )?is locked|sqlite_(busy|locked)/i.test(String(error)))
      return false;
    throw error;
  }
}

// ../plugin/src/features/magic-context/storage-native-replay.ts
var NATIVE_TOOL_INPUTS = "native tool inputs";
var NATIVE_REASONING_IDS = "native reasoning ids";
var nativeWriteBarriers = new WeakMap;
function withNativeReplayWriteBarrier(db, sessionId, beforeWrite, edit) {
  let sessions = nativeWriteBarriers.get(db);
  if (!sessions) {
    sessions = new Map;
    nativeWriteBarriers.set(db, sessions);
  }
  const prior = sessions.get(sessionId);
  sessions.set(sessionId, beforeWrite);
  try {
    return edit();
  } finally {
    if (prior)
      sessions.set(sessionId, prior);
    else
      sessions.delete(sessionId);
  }
}
function invalidPersistedReplayState(lane, sessionId) {
  return new Error(`invalid persisted ${lane} state for session ${sessionId}`);
}
function assertNonEmptyId(value, lane, sessionId) {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidPersistedReplayState(lane, sessionId);
  }
}
function assertSerializedToolInput(value, sessionId) {
  if (typeof value !== "string") {
    throw invalidPersistedReplayState(NATIVE_TOOL_INPUTS, sessionId);
  }
  try {
    if (!isRecord(JSON.parse(value))) {
      throw new SyntaxError("native tool input must be an object");
    }
  } catch {
    throw invalidPersistedReplayState(NATIVE_TOOL_INPUTS, sessionId);
  }
}
function parseNativeToolInputs(value, sessionId) {
  if (!isRecord(value)) {
    throw invalidPersistedReplayState(NATIVE_TOOL_INPUTS, sessionId);
  }
  const inputs = new Map;
  for (const [id, input] of Object.entries(value)) {
    assertNonEmptyId(id, NATIVE_TOOL_INPUTS, sessionId);
    assertSerializedToolInput(input, sessionId);
    inputs.set(id, input);
  }
  return inputs;
}
function parseNativeReasoningIds(value, sessionId) {
  if (!Array.isArray(value)) {
    throw invalidPersistedReplayState(NATIVE_REASONING_IDS, sessionId);
  }
  const ids = new Set;
  for (const id of value) {
    assertNonEmptyId(id, NATIVE_REASONING_IDS, sessionId);
    ids.add(id);
  }
  return ids;
}
function parseNativeReplayState(doc, sessionId) {
  const native = doc.piNative;
  if (native === undefined) {
    return { toolInputs: new Map, reasoningIds: new Set };
  }
  if (!isRecord(native)) {
    throw invalidPersistedReplayState("native replay", sessionId);
  }
  return {
    toolInputs: parseNativeToolInputs(native.toolInputs, sessionId),
    reasoningIds: parseNativeReasoningIds(native.reasoningIds, sessionId)
  };
}
function replaceNativeReplayState(doc, state, sessionId) {
  const prior = doc.piNative;
  let preserved = {};
  if (prior !== undefined) {
    if (!isRecord(prior)) {
      throw invalidPersistedReplayState("native replay", sessionId);
    }
    preserved = prior;
  }
  doc.version = 2;
  doc.piNative = {
    ...preserved,
    toolInputs: Object.fromEntries(state.toolInputs),
    reasoningIds: [...state.reasoningIds]
  };
}
function getNativeReplayState(db, sessionId) {
  return parseNativeReplayState(readReplayEnvelope(db, sessionId), sessionId);
}
function saveNativeToolInputs(db, sessionId, inputs) {
  const requested = new Map;
  for (const [id, input] of inputs) {
    assertNonEmptyId(id, NATIVE_TOOL_INPUTS, sessionId);
    assertSerializedToolInput(input, sessionId);
    requested.set(id, input);
  }
  if (requested.size === 0)
    return;
  nativeWriteBarriers.get(db)?.get(sessionId)?.();
  const persisted = updateReplayDocument(db, sessionId, (doc) => {
    const current = parseNativeReplayState(doc, sessionId);
    let changed = false;
    for (const [id, input] of requested) {
      if (current.toolInputs.get(id) === input)
        continue;
      current.toolInputs.set(id, input);
      changed = true;
    }
    if (!changed)
      return false;
    replaceNativeReplayState(doc, current, sessionId);
    return true;
  });
  if (!persisted) {
    throw new Error(`failed to persist native replay state for session ${sessionId}`);
  }
}
function addNativeReasoningIds(db, sessionId, ids) {
  const requested = new Set;
  for (const id of ids) {
    assertNonEmptyId(id, NATIVE_REASONING_IDS, sessionId);
    requested.add(id);
  }
  if (requested.size === 0)
    return;
  nativeWriteBarriers.get(db)?.get(sessionId)?.();
  const persisted = updateReplayDocument(db, sessionId, (doc) => {
    const current = parseNativeReplayState(doc, sessionId);
    let changed = false;
    for (const id of requested) {
      if (current.reasoningIds.has(id))
        continue;
      current.reasoningIds.add(id);
      changed = true;
    }
    if (!changed)
      return false;
    replaceNativeReplayState(doc, current, sessionId);
    return true;
  });
  if (!persisted) {
    throw new Error(`failed to persist native replay state for session ${sessionId}`);
  }
}

// ../plugin/src/features/magic-context/storage-clone.ts
function clonePiContentDecisions(raw, filter) {
  if (!raw)
    return null;
  let entries;
  try {
    entries = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(entries))
    return null;
  const copied = [];
  for (const entry of entries) {
    if (typeof entry !== "string")
      continue;
    if (isReservedLedgerControlEntry(entry)) {
      copied.push(entry);
      continue;
    }
    const decision = decodePiContentDecision(entry);
    if (decision) {
      const [kind, id] = decision;
      const root = kind === "reminder-strip" ? id.replace(/:p\d+$/, "") : id;
      if (!filter.includeMessageId(root))
        continue;
      copied.push(encodePiContentDecision(kind, `${mapMessageId(filter, root)}${id.slice(root.length)}`));
      continue;
    }
    const mergedParts = decodeMergedReasoningParts(entry);
    if (mergedParts) {
      const [messageId, parts] = mergedParts;
      if (!filter.includeMessageId(messageId))
        continue;
      const mappedParts = parts.map((part) => typeof part === "string" ? mapMessageId(filter, part) ?? part : part);
      copied.push(`${MERGED_REASONING_PARTS_PREFIX}${JSON.stringify([
        mapMessageId(filter, messageId) ?? messageId,
        mappedParts
      ])}`);
      continue;
    }
    const thinkingPrefix = [
      THINKING_BINDING_RECOVERY_FROZEN_PREFIX,
      COMPACTION_OFF_THINKING_FROZEN_PREFIX
    ].find((prefix) => entry.startsWith(prefix));
    if (thinkingPrefix) {
      const messageId = entry.slice(thinkingPrefix.length);
      if (messageId.length === 0 || !filter.includeMessageId(messageId))
        continue;
      copied.push(`${thinkingPrefix}${mapMessageId(filter, messageId) ?? messageId}`);
      continue;
    }
    if (entry.startsWith(MERGED_REASONING_PARTS_PREFIX) || entry.startsWith("pi-content-replay-"))
      continue;
    if (entry.length === 0 || !filter.includeMessageId(entry))
      continue;
    copied.push(mapMessageId(filter, entry) ?? entry);
  }
  return copied.length ? JSON.stringify(copied) : null;
}
function runImmediate(db, body) {
  db.exec("BEGIN IMMEDIATE");
  const transactionStartedAt = performance.now();
  let committed = false;
  try {
    const result = body();
    db.exec("COMMIT");
    committed = true;
    logSlowWriteTransaction("storage_clone_copy", transactionStartedAt);
    return result;
  } finally {
    if (!committed) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
  }
}
function countRows(db, table, sessionId) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ?`).get(sessionId);
  return typeof row?.count === "number" ? row.count : 0;
}
function mapMessageId(filter, messageId) {
  if (messageId === null)
    return null;
  return filter.mapMessageId?.(messageId) ?? messageId;
}
function tableExists(db, table) {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return row !== null && row !== undefined;
}
function insertDynamicRow(db, table, row) {
  const names = Object.keys(row);
  const quoted = names.map((name) => `"${name.replaceAll('"', '""')}"`);
  const placeholders = names.map(() => "?").join(", ");
  db.prepare(`INSERT INTO "${table.replaceAll('"', '""')}" (${quoted.join(", ")}) VALUES (${placeholders})`).run(...names.map((name) => row[name]));
}
function anchoredMessageId(blockId) {
  const separator = blockId.lastIndexOf("#");
  return separator > 0 ? blockId.slice(0, separator) : blockId;
}
function copyPiSessionNotesAndFacts(db, sourceSessionId, destinationSessionId, filter) {
  let notesCopied = 0;
  if (tableExists(db, "notes")) {
    const sourceNotes = db.prepare("SELECT * FROM notes WHERE session_id = ? AND type = 'session' ORDER BY id ASC").all(sourceSessionId);
    for (const source of sourceNotes) {
      const row = {
        ...source,
        session_id: destinationSessionId
      };
      delete row.id;
      const blockId = typeof source.anchor_block_id === "string" ? source.anchor_block_id : "";
      if (blockId) {
        const sourceMessageId = anchoredMessageId(blockId);
        if (!filter.includeMessageId(sourceMessageId))
          continue;
        const mappedMessageId = mapMessageId(filter, sourceMessageId) ?? sourceMessageId;
        row.anchor_block_id = `${mappedMessageId}${blockId.slice(sourceMessageId.length)}`;
        const mappedOrdinal = filter.resolveBoundaryOrdinal(sourceMessageId);
        if (mappedOrdinal === undefined)
          continue;
        if ("anchor_ordinal" in row)
          row.anchor_ordinal = mappedOrdinal;
      } else if (typeof source.anchor_ordinal === "number" && filter.mapOrdinal) {
        const mappedOrdinal = filter.mapOrdinal(source.anchor_ordinal);
        if (mappedOrdinal === undefined)
          continue;
        row.anchor_ordinal = mappedOrdinal;
      }
      insertDynamicRow(db, "notes", row);
      notesCopied += 1;
    }
  }
  let factsCopied = 0;
  if (tableExists(db, "session_facts")) {
    const sourceFacts = db.prepare("SELECT * FROM session_facts WHERE session_id = ? ORDER BY id ASC").all(sourceSessionId);
    for (const source of sourceFacts) {
      const row = {
        ...source,
        session_id: destinationSessionId
      };
      delete row.id;
      insertDynamicRow(db, "session_facts", row);
      factsCopied += 1;
    }
  }
  return { notesCopied, factsCopied };
}
function filterIdBlob(raw, filter) {
  if (!raw)
    return "";
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value))
      return "";
    const filtered = value.filter((id) => typeof id === "string" && filter.includeMessageId(id)).map((id) => mapMessageId(filter, id));
    return filtered.length > 0 ? JSON.stringify(filtered) : "";
  } catch {
    return "";
  }
}
function filterProcessedImageBlob(raw, filter) {
  return serializeProcessedImageMarkers(new Map([...parseProcessedImageMarkers(raw)].filter(([id]) => filter.includeMessageId(id)).map(([id, marker]) => [mapMessageId(filter, id) ?? id, marker])));
}
function filterStrippedPlaceholderBlob(raw, filter) {
  const state = parseStrippedPlaceholderState(raw);
  const keep = (ids) => ids.filter((id) => filter.includeMessageId(id)).map((id) => mapMessageId(filter, id) ?? id);
  const ids = keep(state.ids);
  const copied = new Set(ids);
  return serializeStrippedPlaceholderState({
    ids,
    hiddenSeamIds: keep(state.hiddenSeamIds).filter((id) => copied.has(id))
  });
}
function filterNativeToolInputs(inputs, copiedToolCallIds, filter) {
  const filtered = new Map;
  for (const [sourceId, serializedInput] of inputs) {
    if (!copiedToolCallIds.has(sourceId))
      continue;
    const destinationId = mapMessageId(filter, sourceId);
    if (destinationId === null)
      continue;
    const existing = filtered.get(destinationId);
    if (existing !== undefined && existing !== serializedInput) {
      throw new Error(`native tool input clone collision for ${destinationId}`);
    }
    filtered.set(destinationId, serializedInput);
  }
  return Object.fromEntries(filtered);
}
function filterNativeReasoningIds(ids, filter) {
  const filtered = new Set;
  for (const sourceId of ids) {
    if (!filter.includeMessageId(sourceId))
      continue;
    const destinationId = mapMessageId(filter, sourceId);
    if (destinationId !== null)
      filtered.add(destinationId);
  }
  return [...filtered];
}
function cloneReplayDocument(db, sourceSessionId, copiedToolCallIds, filter) {
  const document = readReplayDocument(db, sourceSessionId);
  const trailingBlank = new Map;
  for (const [sourceId, decision] of Object.entries(document.trailingBlank)) {
    if (!filter.includeMessageId(sourceId))
      continue;
    const destinationId = mapMessageId(filter, sourceId);
    if (destinationId === null)
      continue;
    const existing = trailingBlank.get(destinationId);
    if (existing !== undefined && existing !== decision) {
      throw new Error(`trailing blank clone collision for ${destinationId}`);
    }
    trailingBlank.set(destinationId, decision);
  }
  document.trailingBlank = Object.fromEntries(trailingBlank);
  if (document.version === 1 || document.piNative === undefined)
    return document;
  const nativeReplay = getNativeReplayState(db, sourceSessionId);
  return {
    ...document,
    piNative: {
      ...document.piNative,
      toolInputs: filterNativeToolInputs(nativeReplay.toolInputs, copiedToolCallIds, filter),
      reasoningIds: filterNativeReasoningIds(nativeReplay.reasoningIds, filter)
    }
  };
}
var TAG_ID_QUERY_CHUNK_SIZE = 900;
function selectRowsByTagIds(db, sqlPrefix, sessionId, tagIds) {
  const rows = [];
  for (let start = 0;start < tagIds.length; start += TAG_ID_QUERY_CHUNK_SIZE) {
    const chunk = tagIds.slice(start, start + TAG_ID_QUERY_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    rows.push(...db.prepare(`${sqlPrefix} (${placeholders})`).all(sessionId, ...chunk));
  }
  return rows;
}
function clampWatermark(value, maxCopiedTag) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    return 0;
  return Math.min(Math.floor(value), maxCopiedTag);
}
function copySessionStateForClone(db, sourceSessionId, destinationSessionId, filter) {
  let clearedMarker = null;
  const result = runImmediate(db, () => {
    const hasTemporalDecisions = tableExists(db, "temporal_decisions");
    if (filter.requireEmptyDestinationMeta === true && countRows(db, "session_meta", destinationSessionId) > 0 || countRows(db, "compartments", destinationSessionId) > 0 || countRows(db, "tags", destinationSessionId) > 0 || hasTemporalDecisions && countRows(db, "temporal_decisions", destinationSessionId) > 0 || filter.copySessionNotesAndFacts === true && (tableExists(db, "notes") && countRows(db, "notes", destinationSessionId) > 0 || tableExists(db, "session_facts") && countRows(db, "session_facts", destinationSessionId) > 0)) {
      return {
        kind: "destination-not-empty",
        compartmentsCopied: 0,
        tagsCopied: 0,
        pendingOpsCopied: 0,
        notesCopied: 0,
        factsCopied: 0,
        pendingMarkerMigrated: false
      };
    }
    const compartmentColumns = db.prepare("PRAGMA table_info(compartments)").all();
    const hasBlockIndices = ["start_block_index", "end_block_index"].every((name) => compartmentColumns.some((column) => column.name === name));
    const blockProjection = hasBlockIndices ? "start_block_index, end_block_index" : "NULL AS start_block_index, NULL AS end_block_index";
    const sourceCompartments = db.prepare(`SELECT sequence, start_message, end_message, start_message_id, end_message_id,
                        title, content, p1, p2, p3, p4, importance, episode_type, legacy,
                        created_at, harness, ${blockProjection}
                   FROM compartments WHERE session_id = ? ORDER BY sequence ASC`).all(sourceSessionId);
    const insertCompartment = db.prepare(`INSERT INTO compartments
                (session_id, sequence, start_message, end_message, start_message_id,
                 end_message_id, title, content, p1, p2, p3, p4, importance,
                 episode_type, legacy, created_at, harness${hasBlockIndices ? ", start_block_index, end_block_index" : ""})
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${hasBlockIndices ? ", ?, ?" : ""})`);
    const copiedCompartments = [];
    for (const row of sourceCompartments) {
      const startMessage = filter.resolveBoundaryOrdinal(row.start_message_id);
      const endMessage = filter.resolveBoundaryOrdinal(row.end_message_id);
      if (startMessage === undefined || endMessage === undefined)
        continue;
      insertCompartment.run(destinationSessionId, row.sequence, startMessage, endMessage, mapMessageId(filter, row.start_message_id), mapMessageId(filter, row.end_message_id), row.title, row.content, row.p1, row.p2, row.p3, row.p4, row.importance, row.episode_type, row.legacy, row.created_at, row.harness, ...hasBlockIndices ? [row.start_block_index, row.end_block_index] : []);
      copiedCompartments.push({
        sequence: row.sequence,
        startMessage,
        endMessage,
        startMessageId: mapMessageId(filter, row.start_message_id) ?? row.start_message_id,
        endMessageId: mapMessageId(filter, row.end_message_id) ?? row.end_message_id
      });
    }
    const sourceTags = db.prepare(`SELECT id, message_id, type, status, byte_size, tag_number, harness,
                        entry_fingerprint, token_count, input_token_count,
                        reasoning_token_count, reasoning_byte_size, drop_mode, tool_name,
                        input_byte_size, caveman_depth, tool_owner_message_id
                   FROM tags WHERE session_id = ? ORDER BY tag_number ASC`).all(sourceSessionId);
    const insertTag = db.prepare(`INSERT INTO tags
                (session_id, message_id, type, status, byte_size, tag_number, harness,
                 entry_fingerprint, token_count, input_token_count, reasoning_token_count,
                 reasoning_byte_size, drop_mode, tool_name, input_byte_size,
                 caveman_depth, tool_owner_message_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const copiedTagNumbers = [];
    const copiedTagIds = new Map;
    const copiedToolCallIds = new Set;
    for (const row of sourceTags) {
      if (!filter.includeTag({
        messageId: row.message_id,
        type: row.type,
        tagNumber: row.tag_number,
        toolOwnerMessageId: row.tool_owner_message_id
      })) {
        continue;
      }
      const insertResult = insertTag.run(destinationSessionId, mapMessageId(filter, row.message_id), row.type, row.status, row.byte_size, row.tag_number, row.harness, row.entry_fingerprint, row.token_count, row.input_token_count, row.reasoning_token_count, row.reasoning_byte_size, row.drop_mode, row.tool_name, row.input_byte_size, row.caveman_depth, mapMessageId(filter, row.tool_owner_message_id));
      const insertedTagId = Number(insertResult.lastInsertRowid);
      if (!Number.isSafeInteger(insertedTagId) || insertedTagId <= 0) {
        throw new Error(`failed to obtain destination tag id for tag ${row.tag_number}`);
      }
      const sourceTagId = filter.mapTagId ? row.id : row.tag_number;
      const destinationTagId = filter.mapTagId ? filter.mapTagId(sourceTagId, insertedTagId) : sourceTagId;
      copiedTagIds.set(sourceTagId, destinationTagId);
      copiedTagNumbers.push(row.tag_number);
      if (row.type === "tool")
        copiedToolCallIds.add(row.message_id);
    }
    if (copiedTagNumbers.length > 0) {
      const sourceContents = selectRowsByTagIds(db, `SELECT tag_id, content, created_at, harness
                   FROM source_contents
                  WHERE session_id = ? AND tag_id IN`, sourceSessionId, [...copiedTagIds.keys()]);
      const insertSourceContent = db.prepare("INSERT INTO source_contents (tag_id, session_id, content, created_at, harness) VALUES (?, ?, ?, ?, ?)");
      for (const row of sourceContents) {
        const destinationTagId = copiedTagIds.get(row.tag_id);
        if (destinationTagId === undefined)
          continue;
        insertSourceContent.run(destinationTagId, destinationSessionId, row.content, row.created_at, row.harness);
      }
      const pendingOps = selectRowsByTagIds(db, `SELECT id, tag_id, operation, queued_at, harness
                   FROM pending_ops
                  WHERE session_id = ? AND tag_id IN`, sourceSessionId, copiedTagNumbers).sort((a, b) => a.id - b.id);
      const insertPendingOp = db.prepare("INSERT INTO pending_ops (session_id, tag_id, operation, queued_at, harness) VALUES (?, ?, ?, ?, ?)");
      for (const row of pendingOps) {
        insertPendingOp.run(destinationSessionId, row.tag_id, row.operation, row.queued_at, row.harness);
      }
    }
    if (hasTemporalDecisions) {
      const temporalRows = db.prepare("SELECT message_id,marker FROM temporal_decisions WHERE session_id=?").all(sourceSessionId);
      const insertTemporal = db.prepare("INSERT INTO temporal_decisions(session_id,message_id,marker) VALUES (?,?,?)");
      for (const row of temporalRows) {
        if (filter.includeMessageId(row.message_id))
          insertTemporal.run(destinationSessionId, mapMessageId(filter, row.message_id), row.marker);
      }
    }
    const inherited = filter.copySessionNotesAndFacts === true ? copyPiSessionNotesAndFacts(db, sourceSessionId, destinationSessionId, filter) : { notesCopied: 0, factsCopied: 0 };
    const meta = db.prepare(`SELECT cleared_reasoning_through_tag, tool_reclaim_watermark,
                        pi_stable_id_scheme, stripped_placeholder_ids,
                        stale_reduce_stripped_ids, processed_image_stripped_ids, merged_reasoning_stripped_ids,
                        pending_pi_compaction_marker_state, last_todo_state,
                        todo_synthetic_call_id, todo_synthetic_anchor_message_id,
                        todo_synthetic_state_json
                   FROM session_meta WHERE session_id = ?`).get(sourceSessionId);
    const maxCopiedTag = copiedTagNumbers.reduce((max, value) => Math.max(max, value), 0);
    const pendingMarker = filter.selectPendingPiMarker(meta?.pending_pi_compaction_marker_state ?? null, copiedCompartments);
    if (pendingMarker === null)
      clearedMarker = getPendingPiCompactionMarkerState(db, destinationSessionId);
    const todoAnchor = meta?.todo_synthetic_anchor_message_id ?? "";
    const migrateTodo = todoAnchor.length > 0 && filter.includeMessageId(todoAnchor);
    db.prepare(`INSERT INTO session_meta
                (session_id, harness, counter, cleared_reasoning_through_tag,
                 tool_reclaim_watermark, pi_stable_id_scheme, stripped_placeholder_ids,
                 stale_reduce_stripped_ids, processed_image_stripped_ids, merged_reasoning_stripped_ids,
                 pending_pi_compaction_marker_state, last_todo_state,
                 todo_synthetic_call_id, todo_synthetic_anchor_message_id,
                 todo_synthetic_state_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET
                harness = excluded.harness,
                counter = excluded.counter,
                cleared_reasoning_through_tag = excluded.cleared_reasoning_through_tag,
                tool_reclaim_watermark = excluded.tool_reclaim_watermark,
                pi_stable_id_scheme = excluded.pi_stable_id_scheme,
                stripped_placeholder_ids = excluded.stripped_placeholder_ids,
                stale_reduce_stripped_ids = excluded.stale_reduce_stripped_ids,
                 processed_image_stripped_ids = excluded.processed_image_stripped_ids,
                 merged_reasoning_stripped_ids = excluded.merged_reasoning_stripped_ids,
                pending_pi_compaction_marker_state = excluded.pending_pi_compaction_marker_state,
                last_todo_state = excluded.last_todo_state,
                todo_synthetic_call_id = excluded.todo_synthetic_call_id,
                todo_synthetic_anchor_message_id = excluded.todo_synthetic_anchor_message_id,
                todo_synthetic_state_json = excluded.todo_synthetic_state_json,
                cached_m0_bytes = NULL,
                cached_m1_bytes = NULL`).run(destinationSessionId, getHarness2(), maxCopiedTag, clampWatermark(meta?.cleared_reasoning_through_tag ?? null, maxCopiedTag), clampWatermark(meta?.tool_reclaim_watermark ?? null, maxCopiedTag), typeof meta?.pi_stable_id_scheme === "number" && Number.isFinite(meta.pi_stable_id_scheme) ? meta.pi_stable_id_scheme : null, filterStrippedPlaceholderBlob(meta?.stripped_placeholder_ids ?? null, filter), filterIdBlob(meta?.stale_reduce_stripped_ids ?? null, filter), filterProcessedImageBlob(meta?.processed_image_stripped_ids ?? null, filter), clonePiContentDecisions(meta?.merged_reasoning_stripped_ids ?? null, filter), pendingMarker, migrateTodo ? meta?.last_todo_state ?? "" : "", migrateTodo ? meta?.todo_synthetic_call_id ?? "" : "", migrateTodo ? mapMessageId(filter, todoAnchor) ?? "" : "", migrateTodo ? meta?.todo_synthetic_state_json ?? "" : "");
    const metaColumnRows = db.prepare("PRAGMA table_info(session_meta)").all();
    const metaColumns = new Set(metaColumnRows.map((column) => column.name));
    if (metaColumns.has("trailing_blank_decisions")) {
      const replayDocument = cloneReplayDocument(db, sourceSessionId, copiedToolCallIds, filter);
      writeReplayDocument(db, destinationSessionId, replayDocument);
    }
    const pendingOpsRow = db.prepare("SELECT COUNT(*) AS count FROM pending_ops WHERE session_id = ?").get(destinationSessionId);
    return {
      kind: "migrated",
      compartmentsCopied: copiedCompartments.length,
      tagsCopied: copiedTagNumbers.length,
      pendingOpsCopied: typeof pendingOpsRow?.count === "number" ? pendingOpsRow.count : 0,
      notesCopied: inherited.notesCopied,
      factsCopied: inherited.factsCopied,
      pendingMarkerMigrated: pendingMarker !== null
    };
  });
  if (clearedMarker)
    logPiCompactionMarkerClear(destinationSessionId, clearedMarker, "clone-replaced");
  return result;
}
// ../plugin/src/features/magic-context/historian-failure-reason.ts
var MAX_HISTORIAN_FAILURE_REASON_LENGTH = 512;
var KNOWN_PROVIDER_ERROR_TYPES = [
  "authentication_error",
  "context_length_exceeded",
  "insufficient_quota",
  "invalid_api_key",
  "invalid_request_error",
  "model_not_found",
  "overloaded_error",
  "permission_error",
  "rate_limit_error",
  "server_error",
  "content_filter"
];
function capHistorianFailureReason(reason, fallback = "provider_error") {
  const value = typeof reason === "string" && reason.trim() ? reason : fallback;
  return value.slice(0, MAX_HISTORIAN_FAILURE_REASON_LENGTH);
}
function externalHistorianFailureReason(error, prefix = "provider_error") {
  const record = typeof error === "object" && error !== null ? error : undefined;
  const message = typeof error === "string" ? error : typeof record?.message === "string" ? record.message : String(error ?? "");
  const normalized = message.toLowerCase();
  const dataRecord = typeof record?.data === "object" && record.data !== null ? record.data : undefined;
  const statusValue = record?.statusCode ?? record?.status ?? record?.status_code ?? dataRecord?.statusCode ?? dataRecord?.status ?? dataRecord?.status_code;
  const structuredStatus = typeof statusValue === "number" || typeof statusValue === "string" ? /^[1-5]\d{2}$/.exec(String(statusValue))?.[0] : undefined;
  const status = structuredStatus ?? /(?:\bhttp(?:\s+status)?|\bstatus(?:\s+code)?|\bapi\s+error|\berror)\s*[(:= ]+([1-5]\d{2})\b/i.exec(message)?.[1];
  const structuredTypes = [record?.type, dataRecord?.type].filter((value) => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/.test(value));
  const structuredType = [record?.type, record?.code, dataRecord?.type, dataRecord?.code].filter((value) => typeof value === "string").join(" ").toLowerCase();
  const providerType = KNOWN_PROVIDER_ERROR_TYPES.find((value) => normalized.includes(value) || structuredType.includes(value)) ?? (structuredTypes[0]?.toLowerCase() || (/model not found|unknown model|model does not exist/.test(normalized) ? "model_not_found" : undefined));
  const structuredCode = record?.code ?? dataRecord?.code;
  const safeCode = typeof structuredCode === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/.test(structuredCode) ? structuredCode : /\b(?:code|error code)\s*[:= ]\s*([A-Za-z][A-Za-z0-9_.-]{0,39})\b/i.exec(message)?.[1];
  const nameField = typeof record?.name === "string" ? record.name : undefined;
  const className = nameField && nameField !== "Error" ? nameField : error?.constructor?.name;
  const safeClass = className && className !== "Error" && /^[A-Za-z][A-Za-z0-9]{0,39}(?:Error|Exception)$/.test(className) ? `class_${className}` : undefined;
  const detail = [
    status ? `http_${status}` : undefined,
    providerType,
    safeCode ? `code_${safeCode}` : undefined,
    safeClass
  ].filter((part) => part !== undefined);
  return capHistorianFailureReason(`${prefix}${detail.length > 0 ? `:${detail.join(":")}` : ""}`);
}
function subprocessExitHistorianFailureReason(exitCode, stderr) {
  const code = typeof exitCode === "number" && Number.isInteger(exitCode) ? String(exitCode) : typeof exitCode === "string" && /^-?\d{1,6}$/.test(exitCode) ? exitCode : "unknown";
  const firstLine = typeof stderr === "string" ? stderr.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "" : "";
  const escapeCharacter = String.fromCharCode(27);
  const plainLine = firstLine.replace(new RegExp(`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`, "g"), "").split("").filter((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  }).join("").replace(/\s+/g, " ").trim();
  const launcherError = /^(?:Error: Failed to load extension\b|Error: Unknown option\b|Unknown option\b|error: unrecognized option\b|Error: Cannot find module\b)/i.test(plainLine);
  return capHistorianFailureReason(`subprocess_exit:${code}${launcherError ? `:${plainLine}` : ""}`);
}

// ../plugin/src/features/magic-context/storage-historian-runs.ts
function countHistorianRuns(db, sessionId) {
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM historian_runs WHERE session_id = ?").get(sessionId);
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}
function recordHistorianRun(db, input) {
  try {
    const failureReason = input.failureReason == null ? input.status === "failed" ? "provider_error" : null : capHistorianFailureReason(input.failureReason, input.status === "failed" ? "provider_error" : "");
    const result = db.prepare(`INSERT INTO historian_runs (
                    session_id, harness, subagent_invocation_id, run_kind, status,
                    failure_reason, chunk_start_ordinal, chunk_end_ordinal, unprocessed_from,
                    compartments_produced, compartment_id_min, compartment_id_max,
                    facts_emitted, facts_by_category_json, events_emitted,
                    importance_min, importance_max, importance_avg,
                    discarded_last, legacy, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.sessionId, input.harness, input.subagentInvocationId ?? null, input.runKind, input.status, failureReason, input.chunkStartOrdinal ?? null, input.chunkEndOrdinal ?? null, input.unprocessedFrom ?? null, input.compartmentsProduced ?? 0, input.compartmentIdMin ?? null, input.compartmentIdMax ?? null, input.factsEmitted ?? 0, JSON.stringify({
      ...input.factsByCategory ?? {},
      facts_promoted: input.factsPromoted ?? 0,
      events_published: input.eventsPublished ?? 0
    }), input.eventsEmitted ?? 0, input.importanceMin ?? null, input.importanceMax ?? null, input.importanceAvg ?? null, input.discardedLast ? 1 : 0, input.legacy ? 1 : 0, Date.now());
    return Number(result.lastInsertRowid);
  } catch {
    return null;
  }
}
function summarizeImportance(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0)
    return { min: null, max: null, avg: null };
  let min = nums[0];
  let max = nums[0];
  let sum = 0;
  for (const v of nums) {
    if (v < min)
      min = v;
    if (v > max)
      max = v;
    sum += v;
  }
  return { min, max, avg: sum / nums.length };
}
function tallyFactsByCategory(facts) {
  const out = {};
  for (const f of facts) {
    const cat = (f.category ?? "UNKNOWN").trim() || "UNKNOWN";
    out[cat] = (out[cat] ?? 0) + 1;
  }
  return out;
}
// ../plugin/src/features/magic-context/storage-memory-mutation-log.ts
var MEMORY_MUTATION_TYPES = new Set(["archive", "delete", "update", "superseded"]);
var MEMORY_VISIBILITY_MUTATION_CATEGORY = "__mc_visibility__";
var MAX_MEMORY_REPLACEMENT_DEPTH = 8;
var TERMINAL_MUTATION_TYPES = new Set(["archive", "delete", "superseded"]);
function isTerminalMutation(row) {
  return TERMINAL_MUTATION_TYPES.has(row.mutationType);
}
function assertMemoryMutationType(mutationType) {
  if (!MEMORY_MUTATION_TYPES.has(mutationType)) {
    throw new Error(`Invalid memory mutation type: ${mutationType}`);
  }
}
function toMemoryMutation(row) {
  return {
    id: row.id,
    projectPath: row.project_path,
    mutationType: row.mutation_type,
    targetMemoryId: row.target_memory_id,
    supersededById: row.superseded_by_id,
    category: row.category,
    newContent: row.new_content,
    visibilityChanged: row.category === MEMORY_VISIBILITY_MUTATION_CATEGORY,
    queuedAt: row.queued_at
  };
}
function queueMemoryMutation(db, input) {
  assertMemoryMutationType(input.mutationType);
  const result = db.prepare(`INSERT INTO memory_mutation_log
                (project_path, mutation_type, target_memory_id, superseded_by_id, category, new_content, queued_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`).run(input.projectPath, input.mutationType, input.targetMemoryId, input.supersededById ?? null, input.category ?? null, input.newContent ?? null, input.queuedAt ?? Date.now());
  const row = getMemoryMutation(db, Number(result.lastInsertRowid));
  if (!row) {
    throw new Error("Failed to load queued memory mutation");
  }
  return row;
}
function getMemoryMutation(db, id) {
  const row = db.prepare(`SELECT id, project_path, mutation_type, target_memory_id,
                    superseded_by_id, category, new_content, queued_at
               FROM memory_mutation_log
              WHERE id = ?`).get(id);
  return row ? toMemoryMutation(row) : null;
}
function uniqueProjectPaths(projectPaths) {
  return [...new Set(projectPaths.filter((path) => path.length > 0))];
}
function placeholders(values) {
  return values.map(() => "?").join(", ");
}
function coalesceMutations(rows) {
  const chosenByTarget = new Map;
  for (const dbRow of rows) {
    const candidate = toMemoryMutation(dbRow);
    const current = chosenByTarget.get(candidate.targetMemoryId);
    if (!current) {
      chosenByTarget.set(candidate.targetMemoryId, candidate);
      continue;
    }
    const visibilityChanged = current.visibilityChanged || candidate.visibilityChanged;
    const currentTerminal = isTerminalMutation(current);
    const candidateTerminal = isTerminalMutation(candidate);
    if (currentTerminal && !candidateTerminal) {
      chosenByTarget.set(candidate.targetMemoryId, { ...current, visibilityChanged });
      continue;
    }
    chosenByTarget.set(candidate.targetMemoryId, { ...candidate, visibilityChanged });
  }
  return [...chosenByTarget.values()].sort((left, right) => left.id - right.id);
}
function getMemoryMutationsForRenderByIdentitySet(db, projectPaths, afterId, renderedMemoryIds) {
  const identities = uniqueProjectPaths(projectPaths);
  if (identities.length === 0)
    return [];
  const cursor = afterId ?? 0;
  const visibilityTargets = db.prepare(`SELECT DISTINCT target_memory_id
               FROM memory_mutation_log
              WHERE project_path IN (${placeholders(identities)})
                AND id > ?
                AND category = ?`).all(...identities, cursor, MEMORY_VISIBILITY_MUTATION_CATEGORY);
  const requestedTargets = new Set(renderedMemoryIds);
  for (const row of visibilityTargets)
    requestedTargets.add(row.target_memory_id);
  if (requestedTargets.size === 0)
    return [];
  const queried = new Set;
  let frontier = [...requestedTargets].sort((left, right) => left - right);
  const loaded = [];
  for (let depth = 0;depth <= MAX_MEMORY_REPLACEMENT_DEPTH; depth += 1) {
    frontier = frontier.filter((target) => {
      if (queried.has(target))
        return false;
      queried.add(target);
      return true;
    });
    if (frontier.length === 0)
      break;
    const batch = db.prepare(`SELECT id, project_path, mutation_type, target_memory_id,
                        superseded_by_id, category, new_content, queued_at
                   FROM memory_mutation_log
                  WHERE project_path IN (${placeholders(identities)})
                    AND id > ?
                    AND target_memory_id IN (${placeholders(frontier)})
                  ORDER BY id ASC`).all(...identities, cursor, ...frontier);
    loaded.push(...batch);
    frontier = coalesceMutations(batch).filter((mutation) => mutation.mutationType === "superseded").flatMap((mutation) => mutation.supersededById === null ? [] : [mutation.supersededById]);
  }
  const byTarget = new Map(coalesceMutations(loaded).map((mutation) => [mutation.targetMemoryId, mutation]));
  const resolved = [];
  for (const target of [...requestedTargets].sort((left, right) => left - right)) {
    const mutation = byTarget.get(target);
    if (!mutation)
      continue;
    if (mutation.mutationType !== "superseded") {
      resolved.push(mutation);
      continue;
    }
    let terminal = mutation.supersededById;
    const visited = new Set([target]);
    let depth = 0;
    while (terminal !== null) {
      if (visited.has(terminal)) {
        terminal = null;
        break;
      }
      visited.add(terminal);
      const next = byTarget.get(terminal);
      if (next?.mutationType !== "superseded")
        break;
      if (depth >= MAX_MEMORY_REPLACEMENT_DEPTH - 1) {
        terminal = null;
        break;
      }
      terminal = next.supersededById;
      depth += 1;
    }
    resolved.push({ ...mutation, supersededById: terminal });
  }
  return resolved.sort((left, right) => left.id - right.id);
}
function getMemoryMutationsForRender(db, projectPath, afterId, renderedMemoryIds) {
  return getMemoryMutationsForRenderByIdentitySet(db, [projectPath], afterId, renderedMemoryIds);
}
function getMemoryMutationsForRenderByProjects(db, projectPaths, afterId, renderedMemoryIds) {
  return getMemoryMutationsForRenderByIdentitySet(db, projectPaths, afterId, renderedMemoryIds);
}
function getMaxMemoryMutationId(db, projectPath) {
  const row = db.prepare("SELECT MAX(id) AS max_id FROM memory_mutation_log WHERE project_path = ?").get(projectPath);
  return row?.max_id ?? null;
}
function getMaxMemoryMutationIdForProjects(db, projectPaths) {
  const identities = uniqueProjectPaths(projectPaths);
  if (identities.length === 0)
    return null;
  if (identities.length === 1)
    return getMaxMemoryMutationId(db, identities[0]);
  const row = db.prepare(`SELECT MAX(id) AS max_id
               FROM memory_mutation_log
              WHERE project_path IN (${placeholders(identities)})`).get(...identities);
  return row?.max_id ?? null;
}
// ../plugin/src/features/magic-context/storage-project-state.ts
var GLOBAL_USER_PROFILE_PROJECT_PATH = "__global__";
function toProjectState(row) {
  return {
    projectPath: row.project_path,
    projectMemoryEpoch: row.project_memory_epoch,
    projectUserProfileVersion: row.project_user_profile_version,
    updatedAt: row.updated_at
  };
}
var getProjectStateStatements = new WeakMap;
function getProjectState(db, projectPath) {
  let statement = getProjectStateStatements.get(db);
  if (!statement) {
    statement = db.prepare(`SELECT project_path, project_memory_epoch, project_user_profile_version, updated_at
             FROM project_state
             WHERE project_path = ?`);
    getProjectStateStatements.set(db, statement);
  }
  const row = statement.get(projectPath);
  return row ? toProjectState(row) : null;
}
function bumpProjectUserProfileVersion(db, projectPath = GLOBAL_USER_PROFILE_PROJECT_PATH, now = Date.now()) {
  db.prepare(`INSERT INTO project_state
            (project_path, project_memory_epoch, project_user_profile_version, updated_at)
         VALUES (?, 0, 1, ?)
         ON CONFLICT(project_path) DO UPDATE SET
            project_user_profile_version = project_user_profile_version + 1,
            updated_at = excluded.updated_at`).run(projectPath, now);
  const state = getProjectState(db, projectPath);
  if (!state) {
    throw new Error(`Failed to bump project user profile version for ${projectPath}`);
  }
  return state;
}
// ../plugin/src/features/magic-context/storage-source.ts
var sourceReadStatements = new WeakMap;
function isSourceContentRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.tag_id === "number" && typeof r.content === "string";
}
function saveSourceContent(db, sessionId, tagId, content) {
  db.prepare("INSERT OR IGNORE INTO source_contents (tag_id, session_id, content, created_at, harness) VALUES (?, ?, ?, ?, ?)").run(tagId, sessionId, content, Date.now(), getHarness2());
}
function getSourceContents(db, sessionId, tagIds) {
  if (tagIds.length === 0) {
    return new Map;
  }
  let statement = sourceReadStatements.get(db);
  if (!statement) {
    statement = db.prepare("SELECT tag_id, content FROM source_contents WHERE session_id = ? AND tag_id IN (SELECT value FROM json_each(?))");
    sourceReadStatements.set(db, statement);
  }
  const rows = statement.all(sessionId, JSON.stringify(tagIds)).filter(isSourceContentRow);
  const sources = new Map;
  for (const row of rows) {
    sources.set(row.tag_id, row.content);
  }
  return sources;
}
// ../plugin/src/features/magic-context/storage-subagent-invocations.ts
function clampToken(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
function recordSubagentInvocation(db, input) {
  const result = db.prepare(`INSERT INTO subagent_invocations (
                session_id, harness, subagent, task, provider_id, model_id,
                started_at, ended_at, status,
                input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                error, parent_invocation_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.sessionId, input.harness, input.subagent, input.task ?? null, input.providerId ?? null, input.modelId ?? null, input.startedAt, input.endedAt, input.status, clampToken(input.inputTokens), clampToken(input.outputTokens), clampToken(input.cacheReadTokens), clampToken(input.cacheWriteTokens), input.error ?? null, input.parentInvocationId ?? null);
  return Number(result.lastInsertRowid);
}
function getLatestHistorianInvocationId(db, sessionId) {
  try {
    const row = db.prepare(`SELECT id FROM subagent_invocations
                 WHERE session_id = ? AND subagent = 'historian'
                 ORDER BY id DESC LIMIT 1`).get(sessionId);
    return typeof row?.id === "number" ? row.id : null;
  } catch {
    return null;
  }
}
// ../plugin/src/features/magic-context/storage-v22-backfill-failures.ts
var ERROR_CLASSES = new Set([
  "not_git_repo",
  "git_missing",
  "git_timeout",
  "permission_denied",
  "unknown"
]);
// ../plugin/src/tools/ctx-expand/render.ts
function recoveryParts(sessionId, message, attachments) {
  return attachments ? [...message.parts, ...attachments(sessionId, message.id)] : message.parts;
}
function attachmentNotice(part) {
  const field = (value) => typeof value === "string" ? value.trim().replace(/[\r\n]+/g, " ") : "";
  const source = isRecord2(part.source) ? part.source : {};
  const location = [part.url, part.path, source.uri, source.url, source.path].map(field).find((value) => value && !/^(data|blob):/i.test(value));
  const name = field(part.filename) || field(part.name);
  const mime = field(part.mime) || field(part.mimeType) || field(part.mediaType);
  return `[file]${name ? ` ${name}` : ""}${mime ? ` (${mime})` : ""}` + `${location ? ` — stored location: ${location}` : ""}` + "; content not recovered. If needed, ask the user to attach it again.";
}
function isRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function roleLabel(role) {
  if (role === "assistant")
    return "A (assistant)";
  if (role === "user")
    return "U (user)";
  return role;
}
function verboseRoleLabel(msg) {
  if (msg.role === "user" && msg.parts.length > 0 && msg.parts.every((part) => {
    if (!isRecord2(part))
      return false;
    if (part.type === "tool_result")
      return true;
    return part.type === "tool" && asToolPart(part)?.output != null;
  }))
    return "tool results";
  return roleLabel(msg.role);
}
function truncate(value, max) {
  const t = value.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}
function keyArg(input) {
  if (!input)
    return "";
  for (const k of ["filePath", "path", "pattern", "query", "symbol", "module", "action"]) {
    const v = input[k];
    if (typeof v === "string" && v.length > 0)
      return truncate(v, 60);
  }
  if (typeof input.description === "string")
    return truncate(input.description, 60);
  return "";
}
function asToolPart(part) {
  const type = typeof part.type === "string" ? part.type : "";
  if (type === "tool") {
    const state = isRecord2(part.state) ? part.state : null;
    const output = state && typeof state.output === "string" ? state.output : state && state.output != null ? JSON.stringify(state.output) : null;
    const metadata = state && isRecord2(state.metadata) ? state.metadata : null;
    const title = state && typeof state.title === "string" && state.title || metadata && typeof metadata.title === "string" && metadata.title || null;
    return {
      name: typeof part.tool === "string" ? part.tool : "tool",
      callId: typeof part.callID === "string" ? part.callID : "",
      title,
      input: state && isRecord2(state.input) ? state.input : null,
      output
    };
  }
  if (type === "tool_use") {
    return {
      name: typeof part.name === "string" ? part.name : "tool",
      callId: typeof part.id === "string" ? part.id : "",
      title: null,
      input: isRecord2(part.input) ? part.input : null,
      output: null
    };
  }
  if (type === "tool_result") {
    const content = part.content;
    const output = typeof content === "string" ? content : content != null ? JSON.stringify(content) : null;
    return {
      name: "tool_result",
      callId: typeof part.tool_use_id === "string" ? part.tool_use_id : "",
      title: null,
      input: null,
      output
    };
  }
  return null;
}
function textOf(part) {
  if (part.type === "text" && typeof part.text === "string")
    return part.text;
  return null;
}
function reasoningOf(part) {
  if ((part.type === "reasoning" || part.type === "thinking") && typeof part.text === "string") {
    return part.text;
  }
  return null;
}
function renderPartPreview(part, expandTools) {
  if (!isRecord2(part))
    return null;
  const expansion = expandToolPart(part, expandTools, true);
  if (expansion !== null)
    return `    • tool ${part.tool}: ${expansion}`;
  const text = textOf(part);
  if (text !== null) {
    const t = truncate(text, 200);
    return t.length > 0 ? `    • ${t}` : null;
  }
  const tool = asToolPart(part);
  if (tool) {
    const arg = keyArg(tool.input);
    const head = arg ? `${tool.name}(${arg})` : tool.name;
    return tool.output !== null ? `    • tool ${head} → output ~${estimateTokens(tool.output)} tok` : `    • tool ${head}`;
  }
  const reasoning = reasoningOf(part);
  if (reasoning !== null)
    return `    • [reasoning] ${truncate(reasoning, 120)}`;
  const type = typeof part.type === "string" ? part.type : "part";
  if (type === "file" || type === "image")
    return `    • ${attachmentNotice(part)}`;
  if (type === "step-start" || type === "step-finish")
    return null;
  return `    • [${type}]`;
}
function renderPartFull(part) {
  if (!isRecord2(part))
    return null;
  const text = textOf(part);
  if (text !== null) {
    return text.trim().length > 0 ? `  [text]
${text}` : null;
  }
  const tool = asToolPart(part);
  if (tool) {
    const lines = [];
    const idSuffix = tool.callId ? ` #${tool.callId}` : "";
    lines.push(`  [tool: ${tool.name}${idSuffix}]`);
    if (tool.title && tool.title.trim().length > 0) {
      lines.push(`  description: ${tool.title.trim()}`);
    }
    if (tool.input)
      lines.push(`  input: ${JSON.stringify(tool.input)}`);
    if (tool.output !== null)
      lines.push(`  output:
${tool.output}`);
    return lines.join(`
`);
  }
  const type = typeof part.type === "string" ? part.type : "part";
  if (type === "file" || type === "image")
    return `  ${attachmentNotice(part)}`;
  return null;
}
function renderMessageByOrdinal2(sessionId, ordinal, attachments) {
  const found = [];
  visitRawSessionMessages2(sessionId, ordinal, ordinal, (m) => {
    if (m.ordinal === ordinal)
      found.push(m);
    return false;
  });
  const msg = found[0];
  if (!msg) {
    return `No message at ordinal ${ordinal} in this session's stored history — it was deleted ` + `(session prune/revert) or the ordinal is wrong, so it can't be recovered. ` + `Re-run the tool if you still need the data.`;
  }
  const rendered = recoveryParts(sessionId, msg, attachments).map(renderPartFull).filter((l) => l !== null);
  const lines = [`[${msg.ordinal}] ${roleLabel(msg.role)} — full recovery:`, ""];
  if (rendered.length === 0) {
    lines.push("  (no recoverable content — message had only structural/reasoning parts)");
  } else {
    lines.push(...rendered);
  }
  return lines.join(`
`);
}
function renderVerboseRange2(sessionId, start, end, tokenBudget, expandTools, attachments) {
  const out = [];
  let usedTokens = 0;
  let lastOrdinal = start - 1;
  let truncated = false;
  visitRawSessionMessages2(sessionId, start, end, (msg) => {
    const header = `[${msg.ordinal}] ${verboseRoleLabel(msg)}`;
    const partLines = recoveryParts(sessionId, msg, attachments).map((part) => renderPartPreview(part, expandTools)).filter((l) => l !== null);
    const block = partLines.length > 0 ? `${header}
${partLines.join(`
`)}` : header;
    const blockTokens = estimateTokens(block);
    if (usedTokens + blockTokens > tokenBudget && out.length > 0) {
      truncated = true;
      return false;
    }
    out.push(block);
    usedTokens += blockTokens;
    lastOrdinal = msg.ordinal;
    return true;
  });
  return { text: out.join(`

`), lastOrdinal, truncated };
}
function renderVerboseRangeForTool2(sessionId, start, end, tokenBudget, expandTools, attachments) {
  const v = renderVerboseRange2(sessionId, start, end, tokenBudget, expandTools, attachments);
  if (!v.text) {
    return `No messages found in range ${start}-${end}. The range may be outside this session's history.`;
  }
  const out = [
    `Messages ${start}-${v.lastOrdinal} (verbose). Recover any one in full with ctx_expand(message=<ordinal>):`,
    "",
    v.text
  ];
  if (v.truncated) {
    out.push("", `Truncated at message ${v.lastOrdinal} (budget: ~${tokenBudget} tokens). Call again with start=${v.lastOrdinal + 1} end=${end} verbose=true for more.`);
  }
  return out.join(`
`);
}
function renderItemByTag2(db, sessionId, number, textIndexDomain = "part", attachments) {
  const tag = getTagById2(db, sessionId, number);
  if (!tag)
    return `no tag ${number} in this session; if ${number} came from a <session-history> heading or a ctx_search hit, it is an ordinal: use message=${number}`;
  if (tag.type === "tool") {
    const owner = tag.toolOwnerMessageId;
    if (!owner)
      return `Tag ${number}'s tool owner is unknown; its original call cannot be resolved safely.`;
    const message = readRawSessionMessageById2(sessionId, owner);
    if (!message)
      return `Tag ${number}'s original tool owner is no longer in stored history.`;
    const parts = message?.parts.filter((part) => isRecord2(part) && asToolPart(part)?.callId === tag.messageId) ?? [];
    if (!parts.some((part) => isRecord2(part) && asToolPart(part)?.output !== null)) {
      visitRawSessionMessages2(sessionId, message.ordinal + 1, Number.MAX_SAFE_INTEGER, (candidate) => {
        const matching = candidate.parts.filter((part) => isRecord2(part) && asToolPart(part)?.callId === tag.messageId);
        if (matching.some((part) => isRecord2(part) && part.type === "tool_use"))
          return false;
        parts.push(...matching);
        return matching.length === 0;
      });
    }
    const rendered = parts.map(renderPartFull).filter((part) => part !== null);
    return rendered.length ? rendered.join(`
`) : `Tag ${number}'s original tool call is no longer in stored history.`;
  }
  const scoped = /^(.*):(?:p|file)(\d+)$/.exec(tag.messageId);
  const derived = /^(.*):mc-text-v1:([a-f0-9]+):([a-f0-9]+):o(\d+)$/.exec(tag.messageId);
  const owner = scoped?.[1] ?? derived?.[1] ?? tag.messageId;
  const message = readRawSessionMessageById2(sessionId, owner);
  if (!message)
    return `Tag ${number}'s original text is no longer in stored history.`;
  const index = scoped ? Number(scoped[2]) : 0;
  const attached = attachments?.(sessionId, message.id) ?? [];
  const parts = [...message.parts, ...attached];
  const piText = parts.filter((part) => isRecord2(part) && part.type === "text");
  const part = tag.type === "file" ? attached.find((part) => isRecord2(part) && part.partIndex === index) ?? message.parts[index] : parts[index];
  const matching = derived ? piText.filter((part) => isRecord2(part) && typeof part.text === "string" && createHash6("sha256").update(part.text).digest("hex") === derived[3]) : [];
  const selected = derived ? matching[Number(derived[4])] : textIndexDomain === "text" && tag.type !== "file" ? piText[index] : part;
  return selected ? renderPartFull(selected) ?? "" : `Tag ${number}'s original text part is no longer in stored history.`;
}

export { LkgRecoveryFenceError, clearLkgFenceProcessState, lkgFenceRequiresRebuild, lkgRecoveryFenceUnclean, ownsLkgDirtyFence, invalidateCleanLkgRecoveryFence, markLkgRecoveryDirty, rememberUnpublishedAutoSearchNoHint, getUnpublishedAutoSearchNoHint, forgetUnpublishedAutoSearchNoHint, registerAutoSearchWork, cancelAutoSearchWork, readSessionActivity, observeSessionActivity, backfillSessionActivity, readSessionMeta, getOrCreateSessionMeta, updateSessionMeta, advanceToolReclaimWatermark, retryPendingSessionCleanups, retryPendingRustSessionCleanupsForProject, COMPARTMENT_LEASE_RENEWAL_MS, acquireCompartmentLease, renewCompartmentLease, releaseCompartmentLease, releaseCompartmentLeaseBestEffort, isCompartmentLeaseHeld, isNoContentCompartment, HAS_COMPARTMENT_CONTENT_SQL, queueM0Mutation, getMaxM0MutationId, getCompartments, getLastCompartmentEndMessage, getLastCompartmentEndMessageId, getCompartmentsByEndMessageId, appendCompartments, saveRecompStagingPass, getRecompStaging, clearRecompStaging, getRecompPartialRange, setRecompPartialRange, escapeXmlAttr, escapeXmlContent, getUncoveredCompartmentEndThrough, getUncoveredCompartmentEndsThrough, isPartialCompartmentEnd, readProjectDocsCanonical, providerResponseFailed, isSuccessfulProviderCompletion, requestPendingMaterialization, pendingMaterializationOrigin, hasPendingMaterializationOrigin, clearPendingMaterialization, recordSystemRefreshOwnership, recordSystemPromptForRequest, recordHeldHeadForRequest, bindSystemPromptResponse, acknowledgeSystemPromptDelivery, deferDeliveredSystemRefresh, clearSystemPromptDelivery, saveLkgSlotToDb, loadPersistedLkgSlot, drainStaleLkgSlots, createDbLkgPersistence, replayLkg, registerLkgPersistence, LKG_SNAPSHOT_ARRAY, LKG_SNAPSHOT_OBJECT, LKG_SNAPSHOT_KEY, LKG_SNAPSHOT_STRING, LKG_SNAPSHOT_NUMBER, LKG_SNAPSHOT_BOOLEAN, LKG_SNAPSHOT_NULL, LKG_SNAPSHOT_UNDEFINED, contentSnapshotValue, signatureForFields, lkgContentFields, lkgContentDigestFromFields, isLegacyLkgDigest, legacyLkgDigestFromFields, lkgFieldsMatchDigest, exactReusablePrefix, incrementalLkgContentDigests, lkgSlotRejection, captureSlot, getInMemorySlot, getSlot, dropSlot, TOOL_SWEEP_SCOPED_MARKER, encodePiContentDecision, decodePiContentDecision, getPiContentDecisions, freezePiContentDecision, withNativeReplayWriteBarrier, getNativeReplayState, saveNativeToolInputs, addNativeReasoningIds, copySessionStateForClone, externalHistorianFailureReason, subprocessExitHistorianFailureReason, countHistorianRuns, recordHistorianRun, summarizeImportance, tallyFactsByCategory, queueMemoryMutation, getMemoryMutationsForRender, getMemoryMutationsForRenderByProjects, getMaxMemoryMutationId, getMaxMemoryMutationIdForProjects, GLOBAL_USER_PROFILE_PROJECT_PATH, getProjectState, bumpProjectUserProfileVersion, saveSourceContent, getSourceContents, recordSubagentInvocation, getLatestHistorianInvocationId, renderMessageByOrdinal2, renderVerboseRange2, renderVerboseRangeForTool2, renderItemByTag2 };
