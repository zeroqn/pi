import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  isTransientSqliteError2
} from "./index-2qtx0q6h.js";
import {
  managedAuthorityNoteRow
} from "./index-pqhc0k9d.js";

// ../plugin/src/features/magic-context/storage-notes.ts
var NOTE_TYPES = new Set(["session", "smart"]);
var NOTE_STATUSES = new Set(["active", "pending", "ready", "dismissed"]);
var NOTE_CHECK_STATUSES = new Set([
  "uncompiled",
  "compiled",
  "failing",
  "fallback",
  "parked"
]);
var CONDITION_COMPILE_STATUSES = new Set([
  "compiled",
  "plain",
  "refused"
]);
var DEFAULT_SMART_STATUSES = ["pending", "ready"];
function toNullableString(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function toNullableNumber(value) {
  return typeof value === "number" ? value : null;
}
function isNoteRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const candidate = row;
  return typeof candidate.id === "number" && typeof candidate.type === "string" && NOTE_TYPES.has(candidate.type) && typeof candidate.status === "string" && NOTE_STATUSES.has(candidate.status) && typeof candidate.content === "string" && (candidate.session_id === null || typeof candidate.session_id === "string") && (candidate.project_path === null || typeof candidate.project_path === "string") && (candidate.surface_condition === null || typeof candidate.surface_condition === "string") && typeof candidate.created_at === "number" && typeof candidate.updated_at === "number" && (candidate.last_checked_at === null || typeof candidate.last_checked_at === "number") && (candidate.ready_at === null || typeof candidate.ready_at === "number") && (candidate.ready_reason === null || typeof candidate.ready_reason === "string");
}
function toNote(row) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    content: row.content,
    sessionId: toNullableString(row.session_id),
    projectPath: toNullableString(row.project_path),
    surfaceCondition: toNullableString(row.surface_condition),
    compiledProvider: toNullableString(row.compiled_provider),
    compiledConfig: toNullableString(row.compiled_config),
    compiledAt: toNullableNumber(row.compiled_at),
    compileStatus: typeof row.compile_status === "string" && CONDITION_COMPILE_STATUSES.has(row.compile_status) ? row.compile_status : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckedAt: toNullableNumber(row.last_checked_at),
    readyAt: toNullableNumber(row.ready_at),
    readyReason: toNullableString(row.ready_reason),
    anchorOrdinal: toNullableNumber(row.anchor_ordinal),
    compiledCheck: toNullableString(row.compiled_check),
    manifestJson: toNullableString(row.manifest_json),
    checkHash: toNullableString(row.check_hash),
    checkCron: toNullableString(row.check_cron),
    checkVersion: toNullableNumber(row.check_version),
    checkStatus: typeof row.check_status === "string" && NOTE_CHECK_STATUSES.has(row.check_status) ? row.check_status : null,
    checkFailureCount: toNullableNumber(row.check_failure_count) ?? 0,
    checkNetworkFailureCount: toNullableNumber(row.check_network_failure_count) ?? 0,
    checkQuarantinedUntil: toNullableNumber(row.check_quarantined_until),
    checkNextDueAt: toNullableNumber(row.check_next_due_at),
    checkCompiledAt: toNullableNumber(row.check_compiled_at),
    checkFalseSinceAt: toNullableNumber(row.check_false_since_at),
    checkLastLivenessAt: toNullableNumber(row.check_last_liveness_at),
    policyVersion: toNullableNumber(row.policy_version)
  };
}
function noteCheckColumnsExist(db) {
  try {
    const rows = db.prepare("PRAGMA table_info(notes)").all();
    return rows.some((row) => row.name === "compiled_check");
  } catch {
    return false;
  }
}
var PENDING_SESSION_NOTE_PREDICATE = "type = 'session' AND status = 'pending' AND surface_condition IS NOT NULL";
function healPendingSessionNotes(db) {
  let predicate = `${PENDING_SESSION_NOTE_PREDICATE} AND NOT ${managedAuthorityNoteRow("notes")}`;
  let healable;
  try {
    healable = db.prepare(`SELECT 1 FROM notes WHERE ${predicate} LIMIT 1`).get();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("no such table"))
      throw error;
    predicate = PENDING_SESSION_NOTE_PREDICATE;
    healable = db.prepare(`SELECT 1 FROM notes WHERE ${predicate} LIMIT 1`).get();
  }
  if (healable == null)
    return;
  try {
    db.prepare(`UPDATE notes SET status = 'active', surface_condition = NULL WHERE ${predicate}`).run();
  } catch (error) {
    if (!isTransientSqliteError2(error))
      throw error;
  }
}
function getNoteById(db, noteId) {
  healPendingSessionNotes(db);
  const row = db.prepare("SELECT * FROM notes WHERE id = ?").get(noteId);
  return isNoteRow(row) ? toNote(row) : null;
}
function getNoteByIdInScope(db, noteId, scope) {
  const note = getNoteById(db, noteId);
  return note && noteBelongsToScope(note, scope) ? note : null;
}
function noteBelongsToScope(note, scope) {
  if (note.type === "session") {
    return note.sessionId === scope.sessionId;
  }
  return note.projectPath === scope.projectPath;
}
function buildStatusClause(status) {
  if (status === undefined) {
    return null;
  }
  const statuses = Array.isArray(status) ? status : [status];
  if (statuses.length === 0) {
    return null;
  }
  const placeholders = statuses.map(() => "?").join(", ");
  return {
    sql: `status IN (${placeholders})`,
    params: statuses
  };
}
function getNotes(db, options = {}) {
  healPendingSessionNotes(db);
  const clauses = [];
  const params = [];
  if (options.sessionId !== undefined) {
    clauses.push("session_id = ?");
    params.push(options.sessionId);
  }
  if (options.projectPath !== undefined) {
    clauses.push("project_path = ?");
    params.push(options.projectPath);
  }
  if (options.type !== undefined) {
    clauses.push("type = ?");
    params.push(options.type);
  }
  const statusClause = buildStatusClause(options.status);
  if (statusClause) {
    clauses.push(statusClause.sql);
    params.push(...statusClause.params);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
  return db.prepare(`SELECT * FROM notes${where} ORDER BY created_at ASC, id ASC`).all(...params).filter(isNoteRow).map(toNote);
}
function addNote(db, type, options) {
  const now = Date.now();
  const result = type === "session" ? db.prepare("INSERT INTO notes (type, status, content, session_id, created_at, updated_at, harness, anchor_ordinal) VALUES ('session', 'active', ?, ?, ?, ?, ?, ?) RETURNING *").get(options.content, options.sessionId, now, now, getHarness2(), options.anchorOrdinal ?? null) : db.prepare("INSERT INTO notes (type, status, content, session_id, project_path, surface_condition, compiled_provider, compiled_config, compiled_at, compile_status, created_at, updated_at, harness, anchor_ordinal) VALUES ('smart', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *").get(options.content, options.sessionId ?? null, options.projectPath, options.surfaceCondition, options.compiledProvider ?? null, options.compiledConfig ?? null, options.compiledAt ?? null, options.compileStatus ?? null, now, now, getHarness2(), options.anchorOrdinal ?? null);
  if (!isNoteRow(result)) {
    throw new Error("[notes] failed to insert note");
  }
  return toNote(result);
}
function getSessionNotes(db, sessionId) {
  return getNotes(db, { sessionId, type: "session", status: "active" });
}
function getSmartNotes(db, projectPath, status) {
  return getNotes(db, {
    projectPath,
    type: "smart",
    status: status ?? DEFAULT_SMART_STATUSES
  });
}
function getPendingSmartNotes(db, projectPath) {
  return getSmartNotes(db, projectPath, "pending");
}
function getReadySmartNotes(db, projectPath) {
  return getSmartNotes(db, projectPath, "ready");
}
function updateNote(db, noteId, updates, scope) {
  const existing = getNoteByIdInScope(db, noteId, scope);
  if (!existing) {
    return null;
  }
  if (updates.surfaceCondition !== undefined && existing.type !== "smart") {
    return null;
  }
  const now = Date.now();
  const sets = ["updated_at = ?"];
  const params = [now];
  if (updates.content !== undefined) {
    sets.push("content = ?");
    params.push(updates.content);
  }
  if (updates.sessionId !== undefined) {
    sets.push("session_id = ?");
    params.push(updates.sessionId);
  }
  const smartConditionChanged = existing.type === "smart" && updates.surfaceCondition !== undefined && updates.surfaceCondition !== existing.surfaceCondition;
  if (updates.status !== undefined && !smartConditionChanged) {
    sets.push("status = ?");
    params.push(updates.status);
  }
  if (existing.type === "smart") {
    if (updates.projectPath !== undefined) {
      sets.push("project_path = ?");
      params.push(updates.projectPath);
    }
    if (updates.surfaceCondition !== undefined) {
      sets.push("surface_condition = ?");
      params.push(updates.surfaceCondition);
    }
    if (smartConditionChanged) {
      sets.push("status = 'pending'", "last_checked_at = NULL", "ready_at = NULL", "ready_reason = NULL");
      sets.push("compiled_provider = ?", "compiled_config = ?", "compiled_at = ?", "compile_status = ?");
      params.push(updates.compiledProvider ?? null, updates.compiledConfig ?? null, updates.compiledAt ?? null, updates.compileStatus ?? null);
      if (noteCheckColumnsExist(db)) {
        sets.push("compiled_check = NULL", "manifest_json = NULL", "check_hash = NULL", "check_cron = NULL", "check_version = 0", "check_status = 'uncompiled'", "check_failure_count = 0", "check_network_failure_count = 0", "check_quarantined_until = NULL", "check_next_due_at = NULL", "check_compiled_at = NULL", "check_false_since_at = NULL", "check_last_liveness_at = NULL");
      }
    } else {
      if (updates.lastCheckedAt !== undefined) {
        sets.push("last_checked_at = ?");
        params.push(updates.lastCheckedAt);
      }
      if (updates.readyAt !== undefined) {
        sets.push("ready_at = ?");
        params.push(updates.readyAt);
      }
      if (updates.readyReason !== undefined) {
        sets.push("ready_reason = ?");
        params.push(updates.readyReason);
      }
    }
  }
  if (sets.length === 1) {
    return null;
  }
  params.push(noteId);
  const result = db.prepare(`UPDATE notes SET ${sets.join(", ")} WHERE id = ? RETURNING *`).get(...params);
  return isNoteRow(result) ? toNote(result) : null;
}
function dismissNotes(db, noteIds, scope) {
  const now = Date.now();
  return db.transaction(() => noteIds.map((noteId) => {
    const existing = getNoteById(db, noteId);
    if (!existing)
      return { noteId, outcome: "not_found" };
    if (!noteBelongsToScope(existing, scope)) {
      return { noteId, outcome: "not_owned" };
    }
    if (existing.status === "dismissed") {
      return { noteId, outcome: "already_dismissed" };
    }
    const result = db.prepare("UPDATE notes SET status = 'dismissed', updated_at = ? WHERE id = ? AND status != 'dismissed'").run(now, noteId);
    return {
      noteId,
      outcome: result.changes > 0 ? "dismissed" : "already_dismissed"
    };
  })).immediate();
}
function dismissNote(db, noteId, scope) {
  return dismissNotes(db, [noteId], scope)[0]?.outcome === "dismissed";
}
function markNoteReady(db, noteId, reason) {
  const now = Date.now();
  db.prepare("UPDATE notes SET status = 'ready', ready_at = ?, ready_reason = ?, updated_at = ?, last_checked_at = ? WHERE id = ? AND type = 'smart'").run(now, reason ?? null, now, now, noteId);
}
function markNoteChecked(db, noteId) {
  const now = Date.now();
  db.prepare("UPDATE notes SET last_checked_at = ?, updated_at = ? WHERE id = ? AND type = 'smart'").run(now, now, noteId);
}

// ../plugin/src/features/magic-context/storage-primers.ts
var PRIMER_CANDIDATE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
var PRIMER_CANDIDATE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
function normalizePrimerQuestion(question) {
  return question.trim().toLowerCase().replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/\s+/g, " ").replace(/[?.!]+$/g, "").trim();
}
function primerOccurrenceKey(candidate) {
  return [
    candidate.projectPath,
    candidate.harness,
    candidate.sessionId,
    candidate.sourceStartMessageId,
    candidate.sourceEndMessageId
  ].join("\x1F");
}
function primerOccurrenceUtcDay(sourceMessageTime) {
  return new Date(sourceMessageTime).toISOString().slice(0, 10);
}
function vectorBlob(vector) {
  if (!vector)
    return null;
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}
function blobToFloat32Array(value) {
  if (!value)
    return null;
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
function parseCandidateIds(raw) {
  if (!raw)
    return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "number" && Number.isFinite(id)) : [];
  } catch {
    return [];
  }
}
function parsePrimerSourceProvenance(raw) {
  if (raw === null)
    return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed))
      return null;
    const provenance = [];
    for (const value of parsed) {
      if (!value || typeof value !== "object")
        return null;
      const source = value;
      if (typeof source.candidate_id !== "number" || !Number.isFinite(source.candidate_id) || typeof source.project_path !== "string" || typeof source.harness !== "string" || typeof source.session_id !== "string" || source.source_compartment_start !== null && typeof source.source_compartment_start !== "number" || source.source_compartment_end !== null && typeof source.source_compartment_end !== "number" || typeof source.source_start_message_id !== "string" || typeof source.source_end_message_id !== "string") {
        return null;
      }
      provenance.push({
        candidateId: source.candidate_id,
        projectPath: source.project_path,
        harness: source.harness,
        sessionId: source.session_id,
        sourceCompartmentStart: source.source_compartment_start,
        sourceCompartmentEnd: source.source_compartment_end,
        sourceStartMessageId: source.source_start_message_id,
        sourceEndMessageId: source.source_end_message_id
      });
    }
    return provenance;
  } catch {
    return null;
  }
}
function loadPrimerSourceProvenance(db, candidateIds) {
  const ids = [...new Set(candidateIds)].sort((a, b) => a - b);
  if (ids.length === 0)
    return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id, project_path, harness, session_id,
                    source_compartment_start, source_compartment_end,
                    source_start_message_id, source_end_message_id
               FROM primer_candidates
              WHERE id IN (${placeholders})
              ORDER BY id ASC`).all(...ids);
  return rows.map((row) => ({
    candidateId: row.id,
    projectPath: row.project_path,
    harness: row.harness,
    sessionId: row.session_id,
    sourceCompartmentStart: row.source_compartment_start,
    sourceCompartmentEnd: row.source_compartment_end,
    sourceStartMessageId: row.source_start_message_id,
    sourceEndMessageId: row.source_end_message_id
  }));
}
function serializePrimerSourceProvenance(provenance, sourceCandidateIds) {
  if (provenance.length === 0 && sourceCandidateIds.length > 0)
    return null;
  return JSON.stringify(provenance.map((source) => ({
    candidate_id: source.candidateId,
    project_path: source.projectPath,
    harness: source.harness,
    session_id: source.sessionId,
    source_compartment_start: source.sourceCompartmentStart,
    source_compartment_end: source.sourceCompartmentEnd,
    source_start_message_id: source.sourceStartMessageId,
    source_end_message_id: source.sourceEndMessageId
  })));
}
function normalizedCandidateIds(candidateIds) {
  return [...new Set(candidateIds)].sort((a, b) => a - b);
}
function toCandidate(row) {
  return {
    id: row.id,
    projectPath: row.project_path,
    harness: row.harness,
    sessionId: row.session_id,
    question: row.question,
    normalizedQuestion: row.normalized_question,
    sourceCompartmentStart: row.source_compartment_start,
    sourceCompartmentEnd: row.source_compartment_end,
    sourceStartMessageId: row.source_start_message_id,
    sourceEndMessageId: row.source_end_message_id,
    sourceMessageTime: row.source_message_time,
    questionEmbedding: blobToFloat32Array(row.question_embedding),
    questionEmbeddingModelId: row.question_embedding_model_id,
    createdAt: row.created_at
  };
}
function toPrimer(row) {
  const status = row.status === "archived" ? "archived" : "active";
  return {
    id: row.id,
    projectPath: row.project_path,
    question: row.question,
    questionEmbedding: blobToFloat32Array(row.question_embedding),
    questionEmbeddingModelId: row.question_embedding_model_id,
    answer: row.answer,
    status,
    totalSupport: row.total_support,
    lastObservedAt: row.last_observed_at,
    answerRefreshedAt: row.answer_refreshed_at,
    sourceCandidateIds: parseCandidateIds(row.source_candidate_ids),
    sourceProvenance: parsePrimerSourceProvenance(row.source_candidate_provenance),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function insertPrimerCandidates(db, candidates) {
  const ids = [];
  const stmt = db.prepare(`
        INSERT INTO primer_candidates (
            project_path, harness, session_id, question, normalized_question,
            source_compartment_start, source_compartment_end,
            source_start_message_id, source_end_message_id, source_message_time,
            question_embedding, question_embedding_model_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_path, harness, session_id, source_start_message_id, source_end_message_id)
        DO UPDATE SET
            question = excluded.question,
            normalized_question = excluded.normalized_question,
            source_compartment_start = excluded.source_compartment_start,
            source_compartment_end = excluded.source_compartment_end,
            source_message_time = excluded.source_message_time,
            question_embedding = COALESCE(excluded.question_embedding, primer_candidates.question_embedding),
            question_embedding_model_id = COALESCE(excluded.question_embedding_model_id, primer_candidates.question_embedding_model_id),
            created_at = MIN(primer_candidates.created_at, excluded.created_at)
    `);
  const select = db.prepare(`
        SELECT id FROM primer_candidates
        WHERE project_path = ? AND harness = ? AND session_id = ?
          AND source_start_message_id = ? AND source_end_message_id = ?
    `);
  db.transaction(() => {
    for (const candidate of candidates) {
      const question = candidate.question.trim();
      if (!question)
        continue;
      const normalized = candidate.normalizedQuestion ?? normalizePrimerQuestion(question);
      stmt.run(candidate.projectPath, candidate.harness || "opencode", candidate.sessionId, question, normalized, candidate.sourceCompartmentStart ?? null, candidate.sourceCompartmentEnd ?? null, candidate.sourceStartMessageId, candidate.sourceEndMessageId, candidate.sourceMessageTime, vectorBlob(candidate.questionEmbedding), candidate.questionEmbeddingModelId ?? null, candidate.createdAt ?? Date.now());
      const row = select.get(candidate.projectPath, candidate.harness || "opencode", candidate.sessionId, candidate.sourceStartMessageId, candidate.sourceEndMessageId);
      if (typeof row?.id === "number")
        ids.push(row.id);
    }
  }).immediate();
  return ids;
}
function updatePrimerCandidateEmbedding(db, candidateId, vector, modelId) {
  db.prepare("UPDATE primer_candidates SET question_embedding = ?, question_embedding_model_id = ? WHERE id = ?").run(vectorBlob(vector), modelId, candidateId);
}
function getPrimerCandidatesByIds(db, ids) {
  if (ids.length === 0)
    return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM primer_candidates WHERE id IN (${placeholders})`).all(...ids);
  return rows.map(toCandidate);
}
function getPrimerCandidatesForPromotion(db, projectPath, now = Date.now(), ttlMs = PRIMER_CANDIDATE_TTL_MS) {
  const cutoff = now - ttlMs;
  const rows = db.prepare(`SELECT * FROM primer_candidates
             WHERE project_path = ? AND source_message_time >= ?
             ORDER BY project_path ASC, harness ASC, session_id ASC, source_start_message_id ASC, source_end_message_id ASC, id ASC`).all(projectPath, cutoff);
  return rows.map(toCandidate);
}
function countPrimerCandidatesForProject(db, projectPath) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM primer_candidates WHERE project_path = ?").get(projectPath);
  return row?.count ?? 0;
}
function getActivePrimers(db, projectPath) {
  const rows = db.prepare(`SELECT * FROM primers
             WHERE project_path = ? AND status = 'active'
             ORDER BY COALESCE(last_observed_at, created_at) DESC, id ASC`).all(projectPath);
  return rows.map(toPrimer);
}
function createPrimer(db, input) {
  return db.transaction(() => {
    const now = input.now ?? Date.now();
    const sourceCandidateIds = normalizedCandidateIds(input.sourceCandidateIds);
    const sourceProvenance = loadPrimerSourceProvenance(db, sourceCandidateIds);
    const info = db.prepare(`INSERT INTO primers (
                    project_path, question, question_embedding, question_embedding_model_id, answer,
                    status, total_support, last_observed_at, answer_refreshed_at,
                    source_candidate_ids, source_candidate_provenance, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?, ?, ?, ?)`).run(input.projectPath, input.question, vectorBlob(input.questionEmbedding), input.questionEmbeddingModelId ?? null, input.answer ?? "", input.totalSupport, input.lastObservedAt, JSON.stringify(sourceCandidateIds), serializePrimerSourceProvenance(sourceProvenance, sourceCandidateIds), now, now);
    return Number(info.lastInsertRowid);
  }).immediate();
}
function updatePrimerSupport(db, input) {
  db.transaction(() => {
    const sourceCandidateIds = normalizedCandidateIds(input.sourceCandidateIds);
    const allowedIds = new Set(sourceCandidateIds);
    const existingRow = db.prepare("SELECT source_candidate_provenance FROM primers WHERE id = ?").get(input.primerId);
    const provenanceByCandidateId = new Map;
    for (const source of parsePrimerSourceProvenance(existingRow?.source_candidate_provenance ?? null) ?? []) {
      if (allowedIds.has(source.candidateId)) {
        provenanceByCandidateId.set(source.candidateId, source);
      }
    }
    for (const source of loadPrimerSourceProvenance(db, sourceCandidateIds)) {
      provenanceByCandidateId.set(source.candidateId, source);
    }
    const sourceProvenance = [...provenanceByCandidateId.values()].sort((a, b) => a.candidateId - b.candidateId);
    db.prepare(`UPDATE primers
             SET question_embedding = COALESCE(?, question_embedding),
                 question_embedding_model_id = COALESCE(?, question_embedding_model_id),
                 total_support = ?,
                 last_observed_at = ?,
                 source_candidate_ids = ?,
                 source_candidate_provenance = ?,
                 updated_at = ?
             WHERE id = ?`).run(vectorBlob(input.questionEmbedding), input.questionEmbeddingModelId ?? null, input.totalSupport, input.lastObservedAt, JSON.stringify(sourceCandidateIds), serializePrimerSourceProvenance(sourceProvenance, sourceCandidateIds), input.now ?? Date.now(), input.primerId);
  }).immediate();
}
function updatePrimerAnswer(db, primerId, answer, refreshedAt = Date.now()) {
  db.prepare("UPDATE primers SET answer = ?, answer_refreshed_at = ?, updated_at = ? WHERE id = ?").run(answer, refreshedAt, refreshedAt, primerId);
}

export { getNoteByIdInScope, getNotes, addNote, getSessionNotes, getPendingSmartNotes, getReadySmartNotes, updateNote, dismissNotes, dismissNote, markNoteReady, markNoteChecked, PRIMER_CANDIDATE_TTL_MS, PRIMER_CANDIDATE_MAX_AGE_MS, primerOccurrenceKey, primerOccurrenceUtcDay, insertPrimerCandidates, updatePrimerCandidateEmbedding, getPrimerCandidatesByIds, getPrimerCandidatesForPromotion, countPrimerCandidatesForProject, getActivePrimers, createPrimer, updatePrimerSupport, updatePrimerAnswer };
