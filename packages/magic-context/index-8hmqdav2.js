import {
  inRootAsyncContext2,
  getSqliteDatabasePath2,
  releaseIndexOwner2
} from "./index-2qtx0q6h.js";
import {
  registerExitAbort
} from "./index-399p688g.js";
import {
  log2
} from "./index-fgs78jyd.js";
import {
  createWorkerShutdown
} from "./index-54wmg4rj.js";

// ../plugin/src/hooks/magic-context/read-session-raw.ts
import { isMainThread } from "node:worker_threads";

// ../plugin/src/hooks/magic-context/raw-ordinal-warmup.ts
import { Worker } from "node:worker_threads";
var ACCEPT_TIMEOUT_MS = 2000;
var RESULT_TIMEOUT_MS = 10 * 60000;
var WARMUP_CLOSE_DEADLINE_MS = 2000;
var FAILURE_BACKOFF_MS = 5 * 60000;
var inFlight = new Map;
var connectionIds = new WeakMap;
var nextConnectionId = 0;
var failedAt = new Map;
var activeWorkers = new Map;
var failures = new Map;
var exitHookRegistered = false;
function stopRawSessionOrdinalWarmups() {
  for (const stop of [...activeWorkers.values()])
    stop("stopped");
}
function defaultEntry() {
  return new URL(new URL(import.meta.url).pathname.endsWith(".ts") ? "./raw-ordinal-warmup-worker.ts" : "./raw-ordinal-warmup-worker.js", import.meta.url);
}
function ensureExitHook() {
  if (exitHookRegistered)
    return;
  exitHookRegistered = true;
  const controller = new AbortController;
  controller.signal.addEventListener("abort", stopRawSessionOrdinalWarmups, { once: true });
  registerExitAbort(controller);
}
function runSessionWarmupWorker(input, options) {
  ensureExitHook();
  return new Promise((resolve) => {
    const openCancellation = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    let worker;
    let shutdown;
    let deadline;
    let settled = false;
    const finish = (result) => {
      if (settled)
        return;
      settled = true;
      Atomics.store(openCancellation, 0, 1);
      clearTimeout(deadline);
      options.signal?.removeEventListener("abort", abort);
      if (worker) {
        activeWorkers.delete(worker);
        const stopped = shutdown?.close() ?? worker.terminate();
        worker.unref();
        stopped.finally(() => {
          releaseIndexOwner2(input);
          resolve(result);
        });
        return;
      }
      releaseIndexOwner2(input);
      resolve(result);
    };
    const arm = (failure, ms) => {
      clearTimeout(deadline);
      deadline = setTimeout(() => finish({ failure, detail: `no reply within ${ms} ms` }), ms);
      deadline.unref?.();
    };
    const abort = () => finish({ failure: "stopped", detail: "stopped" });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      worker = inRootAsyncContext2(() => new Worker(options.entry ?? defaultEntry(), {
        workerData: { ...input, openCancellation: openCancellation.buffer }
      }));
      shutdown = createWorkerShutdown(worker, "raw-ordinal-warmup", WARMUP_CLOSE_DEADLINE_MS);
    } catch (error) {
      finish({ failure: "start-failed", detail: String(error) });
      return;
    }
    worker.unref();
    activeWorkers.set(worker, (failure) => finish({ failure, detail: "stopped" }));
    arm("not-accepted", options.acceptMs ?? ACCEPT_TIMEOUT_MS);
    worker.on("message", (reply) => {
      if (reply.kind === "accepted")
        arm("no-result", options.resultMs ?? RESULT_TIMEOUT_MS);
      else if (reply.kind === "scan")
        finish({ scan: reply.scan });
      else if (reply.kind === "tag-summary")
        finish({ summary: reply.summary });
      else if (reply.kind === "tag-delta")
        finish({ delta: reply.delta });
      else if (reply.kind === "indexed")
        finish({ inserted: reply.inserted, measurements: reply.measurements });
      else if (reply.kind === "orphan-sweep")
        finish({ orphanSweep: reply.result });
      else if (reply.kind === "exact-ordinal-ids")
        finish({ exactOrdinalIds: reply.ids });
      else if (reply.kind === "search-archive")
        finish({ searchArchive: reply.text });
      else if (reply.kind === "fts-rowid-backfill")
        finish({ ftsRowidBackfill: true });
      else
        finish({
          failure: "worker-error",
          detail: reply.error,
          code: reply.code,
          errcode: reply.errcode
        });
    });
    worker.on("error", (error) => finish({ failure: "worker-error", detail: String(error) }));
    worker.on("exit", (code) => finish({ failure: "exited", detail: `exit code ${code}` }));
  });
}
function prewarmRawSessionOrdinalsForDb(db, sessionId, options = {}) {
  if (isRawSessionSummaryWarm2(db, sessionId))
    return Promise.resolve("warm");
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'message' AND type IN ('table', 'view')").get())
    return Promise.resolve("warm");
  const path = getSqliteDatabasePath2(db);
  if (!path) {
    countRawSessionMessageOrdinalsFromDb2(db, sessionId);
    return Promise.resolve("warm");
  }
  let connectionId = connectionIds.get(db);
  if (connectionId === undefined) {
    connectionId = ++nextConnectionId;
    connectionIds.set(db, connectionId);
  }
  const key = `${path}\x00${sessionId}\x00${connectionId}`;
  let shared = inFlight.get(key);
  if (!shared) {
    const failed = failedAt.get(key);
    if (failed !== undefined && Date.now() - failed < FAILURE_BACKOFF_MS)
      return Promise.resolve("failed");
    const epoch = getRawSessionSummaryEpoch2(sessionId);
    const started = performance.now();
    const result = runSessionWarmupWorker({ path, sessionId, previous: rawOrdinalSummarySeed2(db, sessionId) }, options).then((outcome) => {
      if ("failure" in outcome)
        recordFailure(key, sessionId, outcome.failure, outcome.detail);
      return outcome;
    }).finally(() => {
      if (inFlight.get(key) === scan)
        inFlight.delete(key);
    });
    const scan = { epoch, started, result };
    inFlight.set(key, scan);
    shared = scan;
  }
  const awaited = shared;
  return awaited.result.then((result) => {
    if (!("scan" in result))
      return "failed";
    try {
      if (installRawSessionSummaryScan2(db, sessionId, result.scan, awaited.epoch, true)) {
        failedAt.delete(key);
        log2(`[magic-context] canonical ordinals of ${sessionId} warmed off-thread (${result.scan.sessionRows} messages, ${Math.round(performance.now() - awaited.started)} ms)`);
        return "warm";
      }
    } catch {}
    recordFailure(key, sessionId, "superseded", `session removed during scan: epoch=${awaited.epoch}/${getRawSessionSummaryEpoch2(sessionId)}`);
    return "failed";
  });
}
function recordFailure(key, sessionId, failure, detail) {
  failures.set(failure, (failures.get(failure) ?? 0) + 1);
  if (failure !== "superseded")
    failedAt.set(key, Date.now());
  log2(`[magic-context] WARN canonical ordinal warm-up failed for ${sessionId} (${failure}: ${detail}); counts remain bounded and callers must defer or retry`);
}

// ../plugin/src/hooks/magic-context/read-session-raw.ts
function areRustHistorianSyntheticParts2(parts) {
  const contentParts = parts.filter((part) => part === null || typeof part !== "object" || part.type !== "compaction");
  return contentParts.length > 0 && contentParts.every((part) => part !== null && typeof part === "object" && (part.synthetic === true || part.syntheticTodoMarker === true));
}
function isStrictGapHealingMessage2(message) {
  if (message.storeType === "synthetic")
    return true;
  let sawTool = false;
  for (const part of message.parts) {
    if (!part || typeof part !== "object" || Array.isArray(part))
      return false;
    const record = part;
    const type = typeof record.type === "string" ? record.type : "";
    if (type === "tool" || type === "tool_use" || type === "tool_result") {
      sawTool = true;
      continue;
    }
    const text = typeof record.text === "string" ? record.text : typeof record.content === "string" ? record.content : "";
    if (text.trim().length > 0 || type.length > 0)
      return false;
  }
  return sawTool;
}
var RAW_MESSAGE_PARTS_BY_ID_SQL = "SELECT message_id, data, time_updated FROM part WHERE +session_id = ? AND likelihood(message_id = ?, 0.000001) ORDER BY time_created ASC, id ASC";
function isRawMessageRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const candidate = row;
  return typeof candidate.id === "string" && typeof candidate.data === "string";
}
function isRawPartRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const candidate = row;
  return typeof candidate.message_id === "string" && typeof candidate.data === "string";
}
function parseJsonRecord(value) {
  try {
    const parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function isRawCompactionSummaryInfo(info) {
  if (info === null || typeof info !== "object" || Array.isArray(info))
    return false;
  const candidate = info;
  return candidate.summary === true && candidate.finish === "stop";
}
var RAW_METADATA_KEEP_CHARS = 16384;
var RAW_METADATA_KEPT_KEYS = [
  "description",
  "title",
  "userAnswer",
  "answers",
  "answer",
  "selectedOptions",
  "customInput",
  "results"
];
var RAW_PART_DATA_SQL = `CASE
    WHEN json_valid(data) = 1
     AND json_type(data, '$.state.metadata') = 'object'
     AND COALESCE(json_extract(data, '$.state.status'), '') <> 'error'
     AND length(json_extract(data, '$.state.metadata')) > ${RAW_METADATA_KEEP_CHARS}
    THEN json_set(data, '$.state.metadata', json_patch('{}', json_object(${RAW_METADATA_KEPT_KEYS.map((key) => `'${key}', json_extract(data, '$.state.metadata.${key}')`).join(", ")})))
    ELSE data
END`;
function parseJsonUnknown(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
function attachRawPartVersion(value, timeUpdated) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return value;
  if (typeof timeUpdated !== "number")
    return value;
  try {
    Object.defineProperty(value, "__magicContextPartUpdatedAt", {
      value: timeUpdated,
      enumerable: false,
      configurable: true
    });
  } catch {}
  return value;
}
function readRawSessionMessagesFromDb2(db, sessionId) {
  const messageRows = db.prepare("SELECT id, data, time_created, time_updated FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC").all(sessionId).filter(isRawMessageRow);
  const partsByMessageId = new Map;
  const partMessageBatchSize = 128;
  for (let offset = 0;offset < messageRows.length; offset += partMessageBatchSize) {
    const messageIds = messageRows.slice(offset, offset + partMessageBatchSize).map((row) => row.id);
    if (messageIds.length === 0)
      continue;
    const placeholders = messageIds.map(() => "?").join(", ");
    const partRows = db.prepare(`SELECT message_id, ${RAW_PART_DATA_SQL} AS data, time_updated
                 FROM part
                 WHERE +session_id = ?
                   AND likelihood(message_id IN (${placeholders}), 0.000001)
                 ORDER BY message_id ASC, time_created ASC, id ASC`).all(sessionId, ...messageIds).filter(isRawPartRow);
    for (const part of partRows) {
      const list = partsByMessageId.get(part.message_id) ?? [];
      list.push(attachRawPartVersion(parseJsonUnknown(part.data), part.time_updated));
      partsByMessageId.set(part.message_id, list);
    }
  }
  const filtered = messageRows.filter((row) => !isRawCompactionSummaryInfo(parseJsonRecord(row.data)));
  return filtered.flatMap((row, index) => {
    const info = parseJsonRecord(row.data);
    if (!info)
      return [];
    const role = typeof info.role === "string" ? info.role : "unknown";
    return {
      ordinal: index + 1,
      id: row.id,
      role,
      parts: partsByMessageId.get(row.id) ?? [],
      createdAt: row.time_created ?? null,
      version: row.time_updated ?? null
    };
  });
}
function readRawSessionMessagePageFromDb2(db, sessionId, afterOrdinal, limit, finalWatermark = Number.MAX_SAFE_INTEGER, after) {
  const messageRows = readRawMessagePageRows(db, sessionId, afterOrdinal, limit, finalWatermark, after);
  if (messageRows.length === 0)
    return [];
  const placeholders = messageRows.map(() => "?").join(", ");
  const partRows = db.prepare(`SELECT message_id, ${RAW_PART_DATA_SQL} AS data, time_updated
             FROM part
             WHERE +session_id = ?
               AND likelihood(message_id IN (${placeholders}), 0.000001)
             ORDER BY message_id ASC, time_created ASC, id ASC`).all(sessionId, ...messageRows.map((row) => row.id)).filter(isRawPartRow);
  return assembleRawMessagePage(messageRows, partRows);
}
function readRawMessagePageRows(db, sessionId, afterOrdinal, limit, finalWatermark, after) {
  const remaining = Math.max(0, Math.floor(finalWatermark) - Math.floor(afterOrdinal));
  const pageSize = Math.min(Math.max(1, Math.floor(limit)), remaining);
  if (pageSize === 0)
    return [];
  return withReadSnapshot(db, () => {
    const ordinal = Math.max(0, Math.floor(afterOrdinal));
    const points = currentOrdinalCheckpoints(db, sessionId)?.scan.checkpoints ?? [];
    let low = 0;
    let high = points.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (points[middle].ordinal <= ordinal)
        low = middle + 1;
      else
        high = middle;
    }
    const floor = points[low - 1];
    const useFloor = floor && (!after || compareOrdinalKeys(floor, after) > 0);
    const anchor = useFloor ? floor : after;
    const skip = anchor === after && after ? 0 : ordinal - (floor?.ordinal ?? 0);
    if (skip > ORDINAL_LOOKUP_LIMIT) {
      prewarmRawSessionOrdinalsForDb(db, sessionId);
      throw new RawOrdinalsNotReady2;
    }
    const rawLimit = skip + pageSize + ORDINAL_LOOKUP_LIMIT;
    const rows = db.prepare(`SELECT id, data, time_created, time_updated, ${EXCLUDED_ROW_SQL} AS excluded
                FROM message WHERE id IN (
                    SELECT id FROM message WHERE session_id = ?
                    ${anchor ? "AND (time_created, id) > (?, ?)" : ""}
                    ORDER BY time_created, id LIMIT ?)
                ORDER BY time_created, id`).all(sessionId, ...anchor ? [anchor.timeCreated, anchor.id] : [], rawLimit);
    rawMessagePageRowsVisited += rows.length;
    const eligible = rows.filter((row) => row.excluded !== 1);
    if (eligible.length <= skip && rows.length === rawLimit) {
      prewarmRawSessionOrdinalsForDb(db, sessionId);
      throw new RawOrdinalsNotReady2;
    }
    return eligible.slice(skip, skip + pageSize).filter(isRawMessageRow).map((row, index) => ({
      ...row,
      ordinal: ordinal + index + 1
    }));
  });
}
var rawMessagePageRowsVisited = 0;
function assembleRawMessagePage(messageRows, partRows) {
  const partsByMessageId = new Map;
  for (const part of partRows) {
    const list = partsByMessageId.get(part.message_id) ?? [];
    list.push(attachRawPartVersion(parseJsonUnknown(part.data), part.time_updated));
    partsByMessageId.set(part.message_id, list);
  }
  return messageRows.map((row) => {
    const info = parseJsonRecord(row.data);
    return {
      ordinal: row.ordinal,
      id: row.id,
      role: typeof info?.role === "string" ? info.role : "unknown",
      parts: partsByMessageId.get(row.id) ?? [],
      createdAt: row.time_created ?? null,
      version: row.time_updated ?? null
    };
  });
}
var RAW_SUMMARY_TEXT_MAX_CHARS2 = 8192;
var RAW_SUMMARY_ARG_MAX_CHARS = 512;
var RAW_SUMMARY_TOOL_INPUT_KEYS = [
  "description",
  "filePath",
  "path",
  "pattern",
  "query",
  "symbol",
  "module",
  "action"
];
function summaryStringField(jsonPath) {
  return `CASE WHEN json_type(data, '${jsonPath}') = 'text' THEN substr(json_extract(data, '${jsonPath}'), 1, ${RAW_SUMMARY_ARG_MAX_CHARS}) END`;
}
var RAW_SUMMARY_PART_DATA_SQL = `CASE
    WHEN json_extract(data, '$.type') = 'text'
        THEN json_set(data, '$.text', substr(json_extract(data, '$.text'), 1, ${RAW_SUMMARY_TEXT_MAX_CHARS2}))
    ELSE json_object(
        'type', 'tool',
        'tool', ${summaryStringField("$.tool")},
        'callID', ${summaryStringField("$.callID")},
        'state', json_object(
            'status', ${summaryStringField("$.state.status")},
            'input', json_object(${RAW_SUMMARY_TOOL_INPUT_KEYS.map((key) => `'${key}', ${summaryStringField(`$.state.input.${key}`)}`).join(", ")}),
            'metadata', json_object('description', ${summaryStringField("$.state.metadata.description")})
        )
    )
END`;
function readRawSessionMessageSummaryPageFromDb2(db, sessionId, afterOrdinal, limit, finalWatermark = Number.MAX_SAFE_INTEGER, after) {
  const messageRows = readRawMessagePageRows(db, sessionId, afterOrdinal, limit, finalWatermark, after);
  if (messageRows.length === 0)
    return [];
  const placeholders = messageRows.map(() => "?").join(", ");
  const partRows = db.prepare(`SELECT message_id, ${RAW_SUMMARY_PART_DATA_SQL} AS data, time_updated
             FROM part
             WHERE +session_id = ?
               AND likelihood(message_id IN (${placeholders}), 0.000001)
               AND json_valid(data) = 1
               AND json_extract(data, '$.type') IN ('text', 'tool')
             ORDER BY message_id ASC, time_created ASC, id ASC`).all(sessionId, ...messageRows.map((row) => row.id)).filter(isRawPartRow);
  return assembleRawMessagePage(messageRows, partRows);
}
function countRawSessionMessageOrdinalsFromDb2(db, sessionId) {
  const indexed = countCanonicalOrdinalsIndexed(db, sessionId, null, null);
  if (indexed !== null)
    return indexed;
  const row = db.prepare(`SELECT COUNT(*) AS count
             FROM message
             WHERE session_id = ?
               AND NOT (
                   CASE WHEN json_valid(data) = 1
                        THEN COALESCE(json_extract(data, '$.summary'), 0)
                        ELSE 0 END = 1
                   AND CASE WHEN json_valid(data) = 1
                            THEN COALESCE(json_extract(data, '$.finish'), '')
                            ELSE '' END = 'stop'
               )`).get(sessionId);
  return typeof row?.count === "number" ? row.count : 0;
}
var exactOrdinalScansOnThisThread = 0;
function readRawSessionMessageIdOrdinalsForRangeFromDb2(db, sessionId, fromOrdinal, toOrdinal) {
  const from = Math.max(1, Math.floor(fromOrdinal));
  const to = Math.floor(toOrdinal);
  if (to < from)
    return new Map;
  exactOrdinalScansOnThisThread += 1;
  const rows = db.prepare(`
        SELECT id, data FROM message WHERE session_id = ?
          AND CASE WHEN json_valid(data) THEN NOT (
            COALESCE(json_type(data, '$.summary'), '') = 'true'
            AND COALESCE(json_extract(data, '$.finish'), '') = 'stop'
          ) ELSE 1 END
        ORDER BY time_created, id LIMIT ? OFFSET ?
    `).all(sessionId, to - from + 1, from - 1).filter(isRawMessageRow);
  const result = new Map;
  for (const [index, row] of rows.entries()) {
    if (parseJsonRecord(row.data))
      result.set(row.id, from + index);
  }
  return result;
}
function readRawSessionMessageIdsAtOrdinalsFromDb2(db, sessionId, ordinals) {
  return withReadSnapshot(db, () => ordinals.map((ordinal) => [
    ordinal,
    readRawSessionMessageIdOrdinalsForRangeFromDb2(db, sessionId, ordinal, ordinal).keys().next().value ?? null
  ]));
}
function readRawSessionMessageOrdinalPageFromDb2(db, sessionId, after, limit) {
  const pageSize = Math.max(1, Math.floor(limit));
  const rows = (after ? db.prepare(`SELECT id, data, time_created
                       FROM message
                       WHERE session_id = ?
                         AND (time_created, id) > (?, ?)
                       ORDER BY time_created ASC, id ASC
                       LIMIT ?`).all(sessionId, after.timeCreated, after.id, pageSize) : db.prepare(`SELECT id, data, time_created
                       FROM message
                       WHERE session_id = ?
                       ORDER BY time_created ASC, id ASC
                       LIMIT ?`).all(sessionId, pageSize)).filter(isRawMessageRow);
  return rows.flatMap((row) => {
    if (typeof row.time_created !== "number")
      return [];
    const info = parseJsonRecord(row.data);
    return {
      id: row.id,
      timeCreated: row.time_created,
      contributesOrdinal: !isRawCompactionSummaryInfo(info),
      hasValidInfo: info !== null
    };
  });
}
function countStoredRawSessionMessagesFromDb2(db, sessionId) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM message WHERE session_id = ?").get(sessionId);
  return typeof row?.count === "number" ? row.count : 0;
}
function isAnchorRow(row) {
  return row !== null && typeof row === "object" && typeof row.time_created === "number" && typeof row.id === "string";
}
function readRawSessionTailFromDb2(db, sessionId, baseOrdinal, anchorMessageId) {
  const anchorRow = db.prepare("SELECT time_created, id, data FROM message WHERE id = ? AND session_id = ?").get(anchorMessageId, sessionId);
  if (!isAnchorRow(anchorRow))
    return null;
  const anchorInfo = parseJsonRecord(anchorRow.data ?? "");
  if (anchorInfo?.summary === true && anchorInfo?.finish === "stop")
    return null;
  const messageRows = db.prepare(`SELECT id, data, time_created, time_updated FROM message
             WHERE session_id = ?
               AND (time_created > ? OR (time_created = ? AND id >= ?))
             ORDER BY time_created ASC, id ASC`).all(sessionId, anchorRow.time_created, anchorRow.time_created, anchorRow.id).filter(isRawMessageRow);
  const filtered = messageRows.filter((row) => {
    const info = parseJsonRecord(row.data);
    return !(info?.summary === true && info?.finish === "stop");
  });
  const ids = filtered.map((row) => row.id);
  const partsByMessageId = new Map;
  if (ids.length > 0) {
    const CHUNK = 800;
    for (let i = 0;i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const placeholders = slice.map(() => "?").join(",");
      const partRows = db.prepare(`SELECT message_id, ${RAW_PART_DATA_SQL} AS data, time_updated FROM part WHERE +session_id = ? AND likelihood(message_id IN (${placeholders}), 0.000001) ORDER BY time_created ASC, id ASC`).all(sessionId, ...slice).filter(isRawPartRow);
      for (const part of partRows) {
        const list = partsByMessageId.get(part.message_id) ?? [];
        list.push(attachRawPartVersion(parseJsonUnknown(part.data), part.time_updated));
        partsByMessageId.set(part.message_id, list);
      }
    }
  }
  const messages = [];
  let ord = baseOrdinal;
  for (const row of filtered) {
    const info = parseJsonRecord(row.data);
    if (!info) {
      ord += 1;
      continue;
    }
    messages.push({
      ordinal: ord,
      id: row.id,
      role: typeof info.role === "string" ? info.role : "unknown",
      parts: partsByMessageId.get(row.id) ?? [],
      createdAt: row.time_created ?? null,
      version: row.time_updated ?? null
    });
    ord += 1;
  }
  return { messages, absoluteMessageCount: Math.max(0, ord - 1) };
}
function buildInMemoryTailRawMessages2(args) {
  const { messages, lastCompartmentEnd, anchorMessageId } = args;
  const filtered = messages.filter((m) => !(m.summary === true && m.finish === "stop"));
  if (filtered.length === 0)
    return null;
  let startIndex = 0;
  let baseOrdinal;
  let anchorFound = false;
  if (anchorMessageId) {
    const anchorIndex = filtered.findIndex((m) => m.id === anchorMessageId);
    if (anchorIndex >= 0) {
      anchorFound = true;
      startIndex = anchorIndex;
      baseOrdinal = lastCompartmentEnd;
    } else {
      baseOrdinal = Math.max(1, lastCompartmentEnd + 1);
    }
  } else {
    baseOrdinal = Math.max(1, lastCompartmentEnd + 1);
  }
  const out = [];
  let ord = baseOrdinal;
  for (let i = startIndex;i < filtered.length; i += 1) {
    const m = filtered[i];
    if (!m.id || typeof m.id !== "string") {
      ord += 1;
      continue;
    }
    out.push({
      ordinal: ord,
      id: m.id,
      role: typeof m.role === "string" ? m.role : "unknown",
      parts: m.parts ?? [],
      version: null
    });
    ord += 1;
  }
  return { messages: out, absoluteMessageCount: Math.max(0, ord - 1), anchorFound };
}
function readRawSessionMessagePartsByIdFromDb2(db, sessionId, messageId, onQuery) {
  onQuery?.();
  const row = db.prepare("SELECT id, data, time_created, time_updated FROM message WHERE session_id = ? AND id = ?").get(sessionId, messageId);
  if (!row || !isRawMessageRow(row) || typeof row.time_created !== "number")
    return null;
  const info = parseJsonRecord(row.data);
  if (!info || isRawCompactionSummaryInfo(info))
    return null;
  onQuery?.();
  const partRows = db.prepare(RAW_MESSAGE_PARTS_BY_ID_SQL).all(sessionId, messageId).filter(isRawPartRow);
  return {
    id: row.id,
    role: typeof info.role === "string" ? info.role : "unknown",
    parts: partRows.map((part) => attachRawPartVersion(parseJsonUnknown(part.data), part.time_updated)),
    createdAt: row.time_created,
    version: row.time_updated ?? null
  };
}
var ORDINAL_SUMMARY_FLAG_SQL = `(CASE WHEN json_valid(data) = 1
        THEN COALESCE(json_extract(data, '$.summary'), 0)
        ELSE 0 END = 1)`;
var ORDINAL_STOP_FLAG_SQL = `(CASE WHEN json_valid(data) = 1
        THEN COALESCE(json_extract(data, '$.finish'), '')
        ELSE '' END = 'stop')`;
function ordinalRangeSql(lowerBound) {
  return `SELECT COUNT(*) AS visited,
                   COALESCE(SUM(CASE WHEN ${ORDINAL_SUMMARY_FLAG_SQL} AND ${ORDINAL_STOP_FLAG_SQL}
                                     THEN 0 ELSE 1 END), 0) AS eligible
            FROM message
            WHERE session_id = ?
              ${lowerBound ? "AND (time_created, id) > (?, ?)" : ""}
              AND (time_created, id) <= (?, ?)`;
}
var ORDINAL_RANGE_FROM_START_SQL = ordinalRangeSql(false);
var ORDINAL_RANGE_BETWEEN_SQL = ordinalRangeSql(true);
function readStoreStamp(db) {
  try {
    const row = db.prepare(`SELECT data_version AS dataVersion, total_changes() AS totalChanges,
                        (SELECT schema_version FROM pragma_schema_version) AS schemaVersion
                 FROM pragma_data_version`).get();
    if (typeof row?.dataVersion !== "number" || typeof row.totalChanges !== "number" || typeof row.schemaVersion !== "number")
      return null;
    return {
      dataVersion: row.dataVersion,
      totalChanges: row.totalChanges,
      schemaVersion: row.schemaVersion
    };
  } catch {
    return null;
  }
}
function sameStoreStamp(left, right) {
  return left !== null && right !== null && left.dataVersion === right.dataVersion && left.totalChanges === right.totalChanges && left.schemaVersion === right.schemaVersion;
}
var ordinalWatermarks = new WeakMap;
var ordinalWatermarkEpochs = new Map;
var ordinalRowsVisited = 0;
var STABLE_STORE_ATTEMPTS = 3;
function forgetRawSessionOrdinalWatermark2(sessionId) {
  ordinalWatermarkEpochs.set(sessionId, (ordinalWatermarkEpochs.get(sessionId) ?? 0) + 1);
}
function compareOrdinalKeys(left, right) {
  if (left.timeCreated !== right.timeCreated)
    return left.timeCreated < right.timeCreated ? -1 : 1;
  if (left.id === right.id)
    return 0;
  return Buffer.compare(Buffer.from(left.id, "utf8"), Buffer.from(right.id, "utf8"));
}
function countEligibleOrdinals(db, sessionId, after, through) {
  const indexed = countCanonicalOrdinalsIndexed(db, sessionId, after, through);
  if (indexed !== null)
    return indexed;
  const row = after ? db.prepare(ORDINAL_RANGE_BETWEEN_SQL).get(sessionId, after.timeCreated, after.id, through.timeCreated, through.id) : db.prepare(ORDINAL_RANGE_FROM_START_SQL).get(sessionId, through.timeCreated, through.id);
  const visited = typeof row?.visited === "number" ? row.visited : 0;
  ordinalRowsVisited += visited;
  ordinalJsonRowsRead += visited;
  return typeof row?.eligible === "number" ? row.eligible : 0;
}
var EXCLUDED_ROW_SQL = `${ORDINAL_SUMMARY_FLAG_SQL} AND ${ORDINAL_STOP_FLAG_SQL}`;
var SUMMARY_ANCHOR_SPAN = 256;
var SUMMARY_ANCHOR_LIMIT = 64;
var WRITTEN_SUMMARY_ID_LIMIT = 4096;
var summaryCandidateSets = new WeakMap;
var summaryCandidateEpochs = new Map;
var writtenSummaryIds = new Map;
var indexedCountUnsupported = new WeakSet;
var ordinalJsonRowsRead = 0;
var summaryFullScans = 0;
function forgetRawSessionSummaryRows2(sessionId) {
  summaryCandidateEpochs.set(sessionId, (summaryCandidateEpochs.get(sessionId) ?? 0) + 1);
  writtenSummaryIds.delete(sessionId);
  forgetRawSessionOrdinalWatermark2(sessionId);
}
function noteRawSessionSummaryRowWritten2(sessionId, messageId) {
  let ids = writtenSummaryIds.get(sessionId);
  if (!ids) {
    ids = new Set;
    writtenSummaryIds.set(sessionId, ids);
  }
  ids.add(messageId);
  if (ids.size > WRITTEN_SUMMARY_ID_LIMIT)
    forgetRawSessionSummaryRows2(sessionId);
}
var ANCHOR_ROWS_SQL = `SELECT rowid AS rid, id, 1 AS kind FROM message
    WHERE rowid > (SELECT MAX(rowid) FROM message) - ${SUMMARY_ANCHOR_SPAN}`;
var SUMMARY_FULL_SCAN_SQL = `${ANCHOR_ROWS_SQL}
    UNION ALL
    SELECT rowid, id, 2 FROM message WHERE session_id = ? AND ${ORDINAL_SUMMARY_FLAG_SQL}
    UNION ALL
    SELECT COUNT(*), NULL, 4 FROM message WHERE session_id = ?`;
var SUMMARY_SCAN_AFTER_SQL = `${ANCHOR_ROWS_SQL}
    UNION ALL
    SELECT rowid, id, CASE WHEN ${ORDINAL_SUMMARY_FLAG_SQL} THEN 2 ELSE 3 END
    FROM message WHERE rowid > ? AND +session_id = ?`;
var ANCHOR_CHECK_SQL = "SELECT rowid AS rid, id FROM message WHERE rowid IN (SELECT value FROM json_each(?))";
function survivingAnchor(db, set) {
  if (set.anchors.length === 0)
    return null;
  const current = new Map(db.prepare(ANCHOR_CHECK_SQL).all(JSON.stringify(set.anchors.map((anchor) => anchor.rowid))).map((row) => [row.rid, row.id]));
  return set.anchors.find((anchor) => current.get(anchor.rowid) === anchor.id);
}
var ordinalCheckpoints = new WeakMap;
var ordinalSummarySeeds = new WeakMap;
var ORDINAL_LOOKUP_LIMIT = 512;
function currentOrdinalCheckpoints(db, sessionId) {
  const cached = ordinalCheckpoints.get(db)?.get(sessionId);
  if (!cached)
    return;
  return withReadSnapshot(db, () => {
    if (!extendOrdinalCheckpoints(db, sessionId, cached.scan, ORDINAL_LOOKUP_LIMIT))
      return;
    cached.epoch = getRawSessionSummaryEpoch2(sessionId);
    return cached;
  });
}
function extendOrdinalCheckpoints(db, sessionId, scan, limit) {
  const points = scan.checkpoints ?? [];
  const exists = (point) => Boolean(db.prepare("SELECT 1 FROM message WHERE id=? AND session_id=? AND time_created=?").get(point.id, sessionId, point.timeCreated));
  if (points.length && !exists(points[points.length - 1])) {
    let low = 0;
    let high = points.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (exists(points[middle]))
        low = middle + 1;
      else
        high = middle;
    }
    points.length = low;
    scan.total = points.at(-1)?.ordinal ?? 0;
    scan.sessionRows = points.at(-1)?.storedCount ?? 0;
  }
  const tail = points.at(-1);
  const rows = db.prepare(`SELECT id, time_created AS timeCreated, ${EXCLUDED_ROW_SQL} AS excluded FROM message
        WHERE session_id=?${tail ? " AND (time_created,id) > (?,?)" : ""}
        ORDER BY time_created,id${limit === undefined ? "" : ` LIMIT ${limit + 1}`}`).all(sessionId, ...tail ? [tail.timeCreated, tail.id] : []);
  ordinalJsonRowsRead += rows.length;
  if (limit !== undefined && rows.length > limit)
    return false;
  let total = scan.total ?? 0;
  if (rows.length && tail && (tail.storedCount ?? 0) % 256 !== 0)
    points.pop();
  for (let index = 0;index < rows.length; index++) {
    const row = rows[index];
    if (row.excluded !== 1)
      total++;
    const storedCount = scan.sessionRows + index + 1;
    if (storedCount % 256 === 0 || index === rows.length - 1)
      points.push({ id: row.id, timeCreated: row.timeCreated, ordinal: total, storedCount });
  }
  scan.checkpoints = points;
  scan.sessionRows += rows.length;
  scan.total = total;
  return true;
}

class RawOrdinalsNotReady2 extends Error {
  constructor() {
    super("canonical ordinals are warming off-thread; retry after preparation");
  }
}
function rawOrdinalSummarySeed2(db, sessionId) {
  const retained = ordinalCheckpoints.get(db)?.get(sessionId);
  if (retained)
    return retained.scan;
  const seed = ordinalSummarySeeds.get(db)?.get(sessionId);
  if (!seed || seed.epoch !== getRawSessionSummaryEpoch2(sessionId))
    return;
  return {
    ...seed.scan,
    ids: [...new Set([...seed.scan.ids, ...writtenSummaryIds.get(sessionId) ?? []])]
  };
}
function boundedOrdinalPrefix(db, sessionId, through) {
  const cached = currentOrdinalCheckpoints(db, sessionId);
  if (cached && through === null)
    return cached.scan.total ?? 0;
  let floor;
  if (cached && through) {
    const points = cached.scan.checkpoints ?? [];
    let low = 0;
    let high = points.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (compareOrdinalKeys(points[middle], through) <= 0)
        low = middle + 1;
      else
        high = middle;
    }
    floor = points[low - 1];
    if (floor && compareOrdinalKeys(floor, through) === 0)
      return floor.ordinal;
  }
  const bindings = [sessionId];
  if (floor)
    bindings.push(floor.timeCreated, floor.id);
  if (through)
    bindings.push(through.timeCreated, through.id);
  const rows = db.prepare(`SELECT ${EXCLUDED_ROW_SQL} AS excluded FROM message WHERE id IN (
        SELECT id FROM message WHERE session_id = ?${floor ? " AND (time_created, id) > (?, ?)" : ""}${through ? " AND (time_created, id) <= (?, ?)" : ""}
        ORDER BY time_created, id LIMIT ${ORDINAL_LOOKUP_LIMIT + 1})`).all(...bindings);
  ordinalRowsVisited += rows.length;
  ordinalJsonRowsRead += rows.length;
  if (rows.length > ORDINAL_LOOKUP_LIMIT) {
    prewarmRawSessionOrdinalsForDb(db, sessionId);
    throw new RawOrdinalsNotReady2;
  }
  return (floor?.ordinal ?? 0) + rows.reduce((sum, row) => sum + (row.excluded === 1 ? 0 : 1), 0);
}
function scanRawSessionSummaryRows2(db, sessionId, previous) {
  return withReadSnapshot(db, () => {
    if (previous?.checkpoints) {
      extendOrdinalCheckpoints(db, sessionId, previous);
      return previous;
    }
    if (previous) {
      const sessions = summaryCandidateSets.get(db) ?? new Map;
      sessions.set(sessionId, {
        epoch: getRawSessionSummaryEpoch2(sessionId),
        anchors: previous.anchors,
        ids: new Set(previous.ids)
      });
      summaryCandidateSets.set(db, sessions);
    }
    const incremental = previous && isRawSessionSummaryWarm2(db, sessionId) ? summaryCandidatesOf(db, sessionId) : undefined;
    const rows = incremental ? [] : db.prepare(SUMMARY_FULL_SCAN_SQL).all(sessionId, sessionId);
    const anchors = [];
    const ids = [];
    let sessionRows = 0;
    for (const row of rows) {
      if (row.kind === 1 && typeof row.rid === "number" && typeof row.id === "string")
        anchors.push({ rowid: row.rid, id: row.id });
      else if (row.kind === 2 && typeof row.id === "string")
        ids.push(row.id);
      else if (row.kind === 4 && typeof row.rid === "number")
        sessionRows = row.rid;
    }
    if (incremental) {
      ids.push(...incremental.ids);
      anchors.push(...summaryCandidateSets.get(db)?.get(sessionId)?.anchors ?? []);
      sessionRows = countStoredRawSessionRowsIndexed(db, sessionId);
    }
    anchors.sort((left, right) => right.rowid - left.rowid);
    anchors.length = Math.min(anchors.length, SUMMARY_ANCHOR_LIMIT);
    const keys = db.prepare(`SELECT id, time_created AS timeCreated, ${EXCLUDED_ROW_SQL} AS excluded FROM message WHERE session_id = ?
        ORDER BY time_created, id`).all(sessionId);
    const checkpoints = [];
    let total = 0;
    for (let index = 0;index < keys.length; index++) {
      const key = keys[index];
      if (key.excluded !== 1)
        total++;
      if (index % 256 === 255 || index === keys.length - 1)
        checkpoints.push({
          id: key.id,
          timeCreated: key.timeCreated,
          ordinal: total,
          storedCount: index + 1
        });
    }
    return { anchors, ids, sessionRows, checkpoints, total };
  });
}
function getRawSessionSummaryEpoch2(sessionId) {
  return summaryCandidateEpochs.get(sessionId) ?? 0;
}
function installRawSessionSummaryScan2(db, sessionId, scan, epoch, workerPrepared = false) {
  if (epoch !== getRawSessionSummaryEpoch2(sessionId))
    return false;
  const seeds = ordinalSummarySeeds.get(db) ?? new Map;
  seeds.set(sessionId, { epoch, scan });
  ordinalSummarySeeds.set(db, seeds);
  if (scan.checkpoints && workerPrepared) {
    const counts = ordinalCheckpoints.get(db) ?? new Map;
    counts.set(sessionId, { epoch, scan });
    ordinalCheckpoints.set(db, counts);
  } else if (getSqliteDatabasePath2(db) && isMainThread)
    return false;
  if (isRawSessionSummaryWarm2(db, sessionId))
    return true;
  let sessions = summaryCandidateSets.get(db);
  if (!sessions) {
    sessions = new Map;
    summaryCandidateSets.set(db, sessions);
  }
  sessions.set(sessionId, { epoch, anchors: [...scan.anchors], ids: new Set(scan.ids) });
  return isRawSessionSummaryWarm2(db, sessionId);
}
function isRawSessionSummaryWarm2(db, sessionId) {
  if (isMainThread && getSqliteDatabasePath2(db)) {
    return Boolean(currentOrdinalCheckpoints(db, sessionId));
  }
  const set = summaryCandidateSets.get(db)?.get(sessionId);
  if (!set || set.epoch !== getRawSessionSummaryEpoch2(sessionId))
    return false;
  try {
    return survivingAnchor(db, set) !== undefined;
  } catch {
    return false;
  }
}
function countStoredRawSessionRowsIndexed(db, sessionId) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM message WHERE session_id = ?").get(sessionId);
  return typeof row?.count === "number" ? row.count : 0;
}
function summaryCandidatesOf(db, sessionId) {
  let sessions = summaryCandidateSets.get(db);
  if (!sessions) {
    sessions = new Map;
    summaryCandidateSets.set(db, sessions);
  }
  const epoch = getRawSessionSummaryEpoch2(sessionId);
  const cached = sessions.get(sessionId);
  const floor = cached && cached.epoch === epoch ? survivingAnchor(db, cached) : undefined;
  let ids;
  let anchors;
  if (floor === undefined) {
    const scan = scanRawSessionSummaryRows2(db, sessionId);
    summaryFullScans += 1;
    ordinalJsonRowsRead += scan.sessionRows;
    ids = new Set(scan.ids);
    anchors = scan.anchors;
  } else {
    const rows = db.prepare(SUMMARY_SCAN_AFTER_SQL).all(floor?.rowid ?? 0, sessionId);
    ids = cached?.ids ?? new Set;
    anchors = [];
    for (const row of rows) {
      if (row.kind === 1 && typeof row.rid === "number" && typeof row.id === "string")
        anchors.push({ rowid: row.rid, id: row.id });
      else if (row.kind === 2 && typeof row.id === "string")
        ids.add(row.id);
      if (row.kind === 2 || row.kind === 3)
        ordinalJsonRowsRead += 1;
    }
    anchors.sort((left, right) => right.rowid - left.rowid);
    anchors.length = Math.min(anchors.length, SUMMARY_ANCHOR_LIMIT);
  }
  for (const id of writtenSummaryIds.get(sessionId) ?? [])
    ids.add(id);
  sessions.set(sessionId, { epoch, anchors, ids });
  const top = anchors[0];
  return { ids: [...ids], floorRowid: top?.rowid ?? 0, floorId: top?.id ?? null };
}
function canonicalCountSql(lower, upper) {
  const range = `${lower ? " AND (time_created, id) > (?, ?)" : ""}${upper ? " AND (time_created, id) <= (?, ?)" : ""}`;
  return `SELECT
        (SELECT COUNT(*) FROM message WHERE session_id = ?${range}) AS stored,
        (SELECT COUNT(*) FROM message
          WHERE id IN (SELECT value FROM json_each(?)) AND +session_id = ?${range}
            AND ${EXCLUDED_ROW_SQL}) AS knownExcluded,
        (SELECT COUNT(*) FROM message
          WHERE rowid > ? AND +session_id = ? AND id NOT IN (SELECT value FROM json_each(?))${range}
            AND ${EXCLUDED_ROW_SQL}) AS newExcluded,
        (SELECT id FROM message WHERE rowid = ?) AS floorId`;
}
var CANONICAL_COUNT_SQL = new Map;
function canonicalCountStatementText(lower, upper) {
  const key = `${lower}:${upper}`;
  let sql = CANONICAL_COUNT_SQL.get(key);
  if (!sql) {
    sql = canonicalCountSql(lower, upper);
    CANONICAL_COUNT_SQL.set(key, sql);
  }
  return sql;
}
function countCanonicalOrdinalsIndexed(db, sessionId, after, through) {
  if (isMainThread && getSqliteDatabasePath2(db)) {
    return withReadSnapshot(db, () => boundedOrdinalPrefix(db, sessionId, through) - (after ? boundedOrdinalPrefix(db, sessionId, after) : 0));
  }
  if (indexedCountUnsupported.has(db))
    return null;
  const range = [];
  if (after)
    range.push(after.timeCreated, after.id);
  if (through)
    range.push(through.timeCreated, through.id);
  try {
    return withReadSnapshot(db, () => {
      for (let attempt = 0;attempt < STABLE_STORE_ATTEMPTS; attempt += 1) {
        const view = summaryCandidatesOf(db, sessionId);
        const ids = JSON.stringify(view.ids);
        const row = db.prepare(canonicalCountStatementText(after !== null, through !== null)).get(sessionId, ...range, ids, sessionId, ...range, view.floorRowid, sessionId, ids, ...range, view.floorRowid);
        if (view.floorId !== null && row?.floorId !== view.floorId)
          continue;
        const stored = typeof row?.stored === "number" ? row.stored : 0;
        const excluded = (typeof row?.knownExcluded === "number" ? row.knownExcluded : 0) + (typeof row?.newExcluded === "number" ? row.newExcluded : 0);
        ordinalRowsVisited += stored;
        ordinalJsonRowsRead += view.ids.length;
        return stored - excluded;
      }
      return null;
    });
  } catch (error) {
    if (/no such (column|table|function)|json_each/i.test(String(error))) {
      indexedCountUnsupported.add(db);
      return null;
    }
    throw error;
  }
}
function connectionHasOpenTransaction(db) {
  const state = db;
  return state.inTransaction === true || state.isTransaction === true;
}
function withReadSnapshot(db, read) {
  if (connectionHasOpenTransaction(db))
    return read();
  db.exec("BEGIN");
  try {
    return read();
  } finally {
    if (connectionHasOpenTransaction(db))
      db.exec("ROLLBACK");
  }
}
function reusableWatermark(db, sessionId, stamp) {
  const watermark = ordinalWatermarks.get(db)?.get(sessionId);
  if (!watermark || watermark.epoch !== (ordinalWatermarkEpochs.get(sessionId) ?? 0) || !sameStoreStamp(watermark.stamp, stamp))
    return null;
  return watermark;
}
function rememberOrdinalWatermark(db, sessionId, key, ordinal, stamp) {
  let sessions = ordinalWatermarks.get(db);
  if (!sessions) {
    sessions = new Map;
    ordinalWatermarks.set(db, sessions);
  }
  const current = sessions.get(sessionId);
  if (current && sameStoreStamp(current.stamp, stamp) && compareOrdinalKeys(current, key) >= 0)
    return;
  sessions.set(sessionId, {
    timeCreated: key.timeCreated,
    id: key.id,
    ordinal,
    stamp,
    epoch: ordinalWatermarkEpochs.get(sessionId) ?? 0
  });
}
function canonicalOrdinalOf(db, sessionId, readTarget) {
  for (let attempt = 1;; attempt += 1) {
    const before = readStoreStamp(db);
    const target = readTarget();
    if (!target)
      return null;
    const watermark = attempt < STABLE_STORE_ATTEMPTS ? reusableWatermark(db, sessionId, before) : null;
    if (!watermark) {
      const ordinal = countEligibleOrdinals(db, sessionId, null, target);
      if (before && sameStoreStamp(before, readStoreStamp(db)))
        rememberOrdinalWatermark(db, sessionId, target, ordinal, before);
      return { target, ordinal };
    }
    const order = compareOrdinalKeys(target, watermark);
    const ordinal = order === 0 ? watermark.ordinal : order < 0 ? watermark.ordinal - countEligibleOrdinals(db, sessionId, target, watermark) : watermark.ordinal + countEligibleOrdinals(db, sessionId, watermark, target);
    if (sameStoreStamp(before, readStoreStamp(db))) {
      rememberOrdinalWatermark(db, sessionId, target, ordinal, before);
      return { target, ordinal };
    }
  }
}
function readRawSessionMessageOrdinalByIdFromDb2(db, sessionId, messageId) {
  const counted = canonicalOrdinalOf(db, sessionId, () => {
    const row = db.prepare(`SELECT id, time_created, ${ORDINAL_SUMMARY_FLAG_SQL} AND ${ORDINAL_STOP_FLAG_SQL} AS excluded
                 FROM message WHERE session_id = ? AND id = ?`).get(sessionId, messageId);
    if (typeof row?.id !== "string" || typeof row.time_created !== "number")
      return null;
    return { id: row.id, timeCreated: row.time_created, excluded: row.excluded === 1 };
  });
  if (!counted || counted.target.excluded)
    return null;
  return counted.ordinal > 0 ? counted.ordinal : null;
}
function readRawSessionMessageByIdFromDb2(db, sessionId, messageId) {
  const counted = canonicalOrdinalOf(db, sessionId, () => {
    const row = db.prepare("SELECT id, data, time_created, time_updated FROM message WHERE session_id = ? AND id = ?").get(sessionId, messageId);
    if (!row || !isRawMessageRow(row) || typeof row.time_created !== "number")
      return null;
    const parsed = parseJsonRecord(row.data);
    if (!parsed || isRawCompactionSummaryInfo(parsed))
      return null;
    return { ...row, timeCreated: row.time_created, info: parsed };
  });
  if (!counted)
    return null;
  const { target: row, ordinal } = counted;
  const info = row.info;
  if (ordinal <= 0) {
    return null;
  }
  const partRows = db.prepare(RAW_MESSAGE_PARTS_BY_ID_SQL).all(sessionId, messageId).filter(isRawPartRow);
  const role = typeof info.role === "string" ? info.role : "unknown";
  return {
    ordinal,
    id: row.id,
    role,
    parts: partRows.map((part) => attachRawPartVersion(parseJsonUnknown(part.data), part.time_updated)),
    createdAt: row.time_created,
    version: row.time_updated ?? null
  };
}
function hasRawSessionMessageByIdFromDb2(db, sessionId, messageId) {
  const row = db.prepare("SELECT id, data, time_created FROM message WHERE session_id = ? AND id = ?").get(sessionId, messageId);
  if (!row || !isRawMessageRow(row) || typeof row.time_created !== "number")
    return false;
  const info = parseJsonRecord(row.data);
  if (!info || isRawCompactionSummaryInfo(info))
    return false;
  if (info.summary === 1 && info.finish === "stop")
    return readRawSessionMessageByIdFromDb2(db, sessionId, messageId) !== null;
  return true;
}
function readRawSeedTailFromDb2(db, sessionId, boundaryId) {
  const rows = db.prepare(`
        WITH canonical AS (
            SELECT id, time_created,
                   ROW_NUMBER() OVER (ORDER BY time_created, id) AS ordinal
            FROM message WHERE session_id = ?
              AND NOT (CASE WHEN json_valid(data) THEN COALESCE(json_extract(data, '$.summary'), 0) ELSE 0 END = 1
                AND CASE WHEN json_valid(data) THEN COALESCE(json_extract(data, '$.finish'), '') ELSE '' END = 'stop')
        )
        SELECT c.id, m.data, c.time_created, m.time_updated, c.ordinal,
               p.data AS part_data, p.time_updated AS part_updated
        FROM canonical c JOIN message m ON m.id = c.id
        LEFT JOIN part p ON +p.session_id = ? AND likelihood(p.message_id = c.id, 0.000001)
        WHERE ? IS NULL OR c.ordinal >= (SELECT ordinal FROM canonical WHERE id = ?)
        ORDER BY c.ordinal, p.time_created, p.id
    `).all(sessionId, sessionId, boundaryId, boundaryId);
  const messages = new Map;
  for (const row of rows) {
    if (!messages.has(row.id)) {
      const info = parseJsonRecord(row.data);
      if (!info)
        continue;
      messages.set(row.id, {
        id: row.id,
        ordinal: row.ordinal,
        role: typeof info.role === "string" ? info.role : "unknown",
        createdAt: row.time_created,
        version: row.time_updated,
        parts: []
      });
    }
    if (row.part_data !== null)
      messages.get(row.id)?.parts.push(attachRawPartVersion(parseJsonUnknown(row.part_data), row.part_updated ?? undefined));
  }
  if (boundaryId !== null && !messages.has(boundaryId))
    throw new Error("state_sync materialized boundary is missing from raw storage");
  return messages;
}
var BOUNDARY_ORDINAL_SQL = `
    SELECT id, ordinal FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY time_created, id) AS ordinal
        FROM message
        WHERE session_id = ?
          AND typeof(id) = 'text' AND typeof(data) = 'text'
          AND CASE WHEN json_valid(data) THEN NOT (
                COALESCE(json_type(data, '$.summary'), '') = 'true'
                AND COALESCE(json_extract(data, '$.finish'), '') = 'stop'
              ) ELSE 1 END
    )
    WHERE id IN (SELECT value FROM json_each(?))`;
var BOUNDARY_MESSAGE_SQL = `
    SELECT id, data, time_created FROM message
    WHERE +session_id = ? AND id IN (SELECT value FROM json_each(?))`;
var BOUNDARY_BLOCK_COUNT_SQL = `
    SELECT message_id AS id, SUM(
        CASE
            WHEN NOT json_valid(data) OR json_type(data) <> 'object' THEN 0
            ELSE CASE (CASE WHEN json_type(data, '$.type') = 'text'
                            THEN json_extract(data, '$.type') ELSE 'unknown' END)
                WHEN 'text' THEN CASE WHEN json_type(data, '$.ignored') = 'true' THEN 0 ELSE 1 END
                WHEN 'reasoning' THEN 1
                WHEN 'thinking' THEN 1
                WHEN 'redacted_thinking' THEN 1
                WHEN 'tool' THEN 1 + CASE
                    WHEN json_type(data, '$.state') = 'object'
                     AND json_type(data, '$.state.status') = 'text'
                     AND json_extract(data, '$.state.status') IN ('completed', 'error')
                    THEN 1 ELSE 0 END
                WHEN 'compaction' THEN 0
                WHEN 'step-finish' THEN 0
                WHEN 'snapshot' THEN 0
                WHEN 'patch' THEN 0
                WHEN 'agent' THEN 0
                WHEN 'retry' THEN 0
                ELSE 1
            END
        END) AS blocks
    FROM part
    WHERE +session_id = ?
      AND message_id IN (SELECT value FROM json_each(?))
      AND typeof(message_id) = 'text' AND typeof(data) = 'text'
    GROUP BY message_id`;
var boundaryEndpointCaches = new WeakMap;
var BOUNDARY_ENDPOINT_CACHE_SESSIONS = 16;
var boundaryEndpointRowsRead = 0;
function readBoundaryEndpointRows(db, sessionId, ids, blockIds, into) {
  if (ids.length > 0) {
    boundaryEndpointRowsRead += ids.length;
    const wanted = JSON.stringify(ids);
    const ordinals = new Map;
    for (const row of db.prepare(BOUNDARY_ORDINAL_SQL).all(sessionId, wanted)) {
      ordinals.set(row.id, row.ordinal);
    }
    const rows = db.prepare(BOUNDARY_MESSAGE_SQL).all(sessionId, wanted);
    for (const id of ids)
      into.set(id, null);
    for (const row of rows) {
      if (!isRawMessageRow(row) || typeof row.time_created !== "number")
        continue;
      const info = parseJsonRecord(row.data);
      if (!info || isRawCompactionSummaryInfo(info))
        continue;
      into.set(row.id, {
        ordinal: ordinals.get(row.id) ?? null,
        createdAt: row.time_created
      });
    }
  }
  const servable = blockIds.filter((id) => {
    const endpoint = into.get(id);
    return endpoint && endpoint.lastBlockIndex === undefined;
  });
  if (servable.length === 0)
    return;
  const counts = new Map;
  for (const row of db.prepare(BOUNDARY_BLOCK_COUNT_SQL).all(sessionId, JSON.stringify(servable))) {
    counts.set(row.id, row.blocks);
  }
  for (const id of servable) {
    const endpoint = into.get(id);
    if (!endpoint)
      continue;
    const blocks = counts.get(id) ?? 0;
    into.set(id, { ...endpoint, lastBlockIndex: blocks > 0 ? blocks - 1 : 0 });
  }
}
function readRawSessionBoundaryEndpointsFromDb2(db, sessionId, ids, blockIds = []) {
  const wanted = [...new Set(ids)];
  const wantedBlocks = [...new Set(blockIds)];
  let sessions = boundaryEndpointCaches.get(db);
  if (!sessions) {
    sessions = new Map;
    boundaryEndpointCaches.set(db, sessions);
  }
  for (let attempt = 1;; attempt += 1) {
    const before = readStoreStamp(db);
    const cached = sessions.get(sessionId);
    const reuse = attempt === 1 && cached && sameStoreStamp(cached.stamp, before);
    const endpoints = new Map(reuse ? cached.endpoints : []);
    const missing = wanted.filter((id) => !endpoints.has(id));
    withReadSnapshot(db, () => readBoundaryEndpointRows(db, sessionId, missing, wantedBlocks, endpoints));
    const unchanged = before !== null && sameStoreStamp(before, readStoreStamp(db));
    if (unchanged) {
      sessions.delete(sessionId);
      sessions.set(sessionId, { stamp: before, endpoints });
      while (sessions.size > BOUNDARY_ENDPOINT_CACHE_SESSIONS) {
        const oldest = sessions.keys().next().value;
        if (oldest === undefined)
          break;
        sessions.delete(oldest);
      }
    } else if (reuse) {
      continue;
    }
    return new Map(wanted.map((id) => [id, endpoints.get(id) ?? null]));
  }
}

export { runSessionWarmupWorker, prewarmRawSessionOrdinalsForDb, areRustHistorianSyntheticParts2, isStrictGapHealingMessage2, readRawSessionMessagesFromDb2, readRawSessionMessagePageFromDb2, RAW_SUMMARY_TEXT_MAX_CHARS2, readRawSessionMessageSummaryPageFromDb2, countRawSessionMessageOrdinalsFromDb2, readRawSessionMessageIdOrdinalsForRangeFromDb2, readRawSessionMessageIdsAtOrdinalsFromDb2, readRawSessionMessageOrdinalPageFromDb2, countStoredRawSessionMessagesFromDb2, readRawSessionTailFromDb2, buildInMemoryTailRawMessages2, readRawSessionMessagePartsByIdFromDb2, forgetRawSessionOrdinalWatermark2, forgetRawSessionSummaryRows2, noteRawSessionSummaryRowWritten2, RawOrdinalsNotReady2, rawOrdinalSummarySeed2, scanRawSessionSummaryRows2, getRawSessionSummaryEpoch2, installRawSessionSummaryScan2, isRawSessionSummaryWarm2, readRawSessionMessageOrdinalByIdFromDb2, readRawSessionMessageByIdFromDb2, hasRawSessionMessageByIdFromDb2, readRawSeedTailFromDb2, readRawSessionBoundaryEndpointsFromDb2 };
