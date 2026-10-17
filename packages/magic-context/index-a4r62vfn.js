import {
  getMagicContextStorageDir,
  getLegacyOpenCodeMagicContextStorageDir,
  sanitizeDiagnosticText,
  importPluginModule,
  writeForwardedLogLine2,
  log2
} from "./index-x3dcnxh0.js";
import {
  getHarness2,
  harnessOwnsOpenCodeStore2
} from "./index-0h2mkab2.js";
import {
  isOwnRpcServerRecord,
  isPidAlive,
  readProcessProbeEvidence,
  classifyProcessKind,
  isPidIdentityPlausible,
  inspectLivePiProcesses,
  parseRpcPortFile,
  inspectProcessesAsync,
  inspectWindowsProcessesSync
} from "./index-kgd6t63g.js";
import {
  registerSlowWriteReporter2,
  registerSqliteDiagnosticSink2,
  detectSqliteRuntime2,
  Database2,
  withSqliteBackgroundWriter2,
  withoutSqliteTransformPass2,
  isTransientSqliteError2,
  withPrivilegedWriter2
} from "./index-7ptxvfc5.js";
import {
  configureContextDatabasePragmas2
} from "./index-fapenpch.js";
import {
  startMessageFtsRowidMapBackfill
} from "./index-j36vpt39.js";
import {
  LKG_SLOT_CHUNKS_DDL,
  SESSION_REPLAY_DECISIONS_DDL,
  LKG_SLOTS_DDL,
  installCompartmentHistoryVersions,
  FORK_MIGRATION_VERSION_FLOOR,
  hasPendingMigrations,
  getMainThreadMigrationBodyCount,
  runMigrations
} from "./index-pznwj7hn.js";
import {
  closeQuietly,
  ensureColumn,
  installV95PerfSchema,
  installTagIdentityRevisionTrigger
} from "./index-nmsb3x01.js";
import {
  resolveOpenCodeDbPath,
  hasV1MessageTables,
  setDatabase,
  loadToolDefinitionMeasurements
} from "./index-8976mezv.js";
import {
  bootQuietRemainingMs,
  scheduleAfterBootQuiet
} from "./index-mfysz78d.js";
import {
  logSlowWriteTransaction
} from "./index-0vrkp1jq.js";
import {
  shouldEnforcePrivateStoragePermissions,
  ensureStorageDirectorySync,
  writeStorageFileSync,
  copyStorageFileSync,
  copyStorageTreeSync,
  tightenStorageTreeSync
} from "./index-81nthk8j.js";

// ../plugin/src/features/magic-context/fail-closed-block.ts
var FAIL_CLOSED_DOCTOR_COMMAND = "npx @cortexkit/magic-context@latest doctor";
var FAIL_CLOSED_REPROBE_EVERY_N = 5;
function attachFailClosedBlockingProcessEvidence(process2, evidence) {
  Object.defineProperties(process2, {
    startTime: { configurable: true, value: evidence.startTime },
    commandLine: { configurable: true, value: evidence.commandLine }
  });
  return process2;
}

class FailClosedBlockingError extends Error {
  code = "FAIL_CLOSED_BLOCKING";
  reason;
  constructor(message, reason, options) {
    super(message, options);
    this.name = "FailClosedBlockingError";
    this.reason = reason;
  }
}
var OPENCODE_INTERNAL_AGENT_NAMES = new Set(["title", "summary", "compaction"]);
function isMagicContextHiddenAgentName(agent) {
  if (agent === "smart-note-compiler" || agent.startsWith("smart-note-")) {
    return true;
  }
  if (agent === "historian" || agent.startsWith("historian-"))
    return true;
  if (agent === "dreamer" || agent.startsWith("dreamer-"))
    return true;
  return false;
}
var MAX_FORMATTED_BLOCKING_PROCESSES = 8;
var MAX_FORMATTED_COMMAND_LINE_LENGTH = 80;
function normalizeFailClosedProcessKind(process2) {
  switch (process2.kind) {
    case "OpenCode server":
    case "OpenCode instance (TUI/CLI)":
    case "Pi":
    case "process":
      return process2.kind;
  }
  switch (process2.harness?.trim().toLowerCase()) {
    case "opencode server":
      return "OpenCode server";
    case "opencode instance (tui/cli)":
    case "opencode instance":
      return "OpenCode instance (TUI/CLI)";
    case "pi":
    case "pi harness":
    case "omp":
      return "Pi";
    default:
      return "process";
  }
}
function formatFailClosedProcessStartTime(startTime) {
  if (!Number.isFinite(startTime) || startTime <= 0)
    return "unverified";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      hour12: false
    }).formatToParts(new Date(startTime));
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    if (!values.month || !values.day || !values.hour || !values.minute)
      return "unverified";
    return `${values.month} ${values.day} ${values.hour}:${values.minute}`;
  } catch {
    return "unverified";
  }
}
function formatFailClosedCommandLine(commandLine) {
  if (typeof commandLine !== "string" || commandLine.trim().length === 0)
    return "unverified";
  try {
    const normalized = commandLine.replaceAll("\x00", " ").replace(/\s+/g, " ").trim();
    if (normalized.length === 0)
      return "unverified";
    const sanitized = sanitizeDiagnosticText(normalized).trim();
    if (sanitized.length === 0)
      return "unverified";
    return sanitized.length > MAX_FORMATTED_COMMAND_LINE_LENGTH ? `${sanitized.slice(0, MAX_FORMATTED_COMMAND_LINE_LENGTH - 3)}...` : sanitized;
  } catch {
    return "unverified";
  }
}
function formatFailClosedBlockingProcesses(processes) {
  const uniqueProcesses = new Map;
  for (const process2 of processes) {
    if (!Number.isInteger(process2.pid) || process2.pid <= 0)
      continue;
    const candidate = {
      kind: normalizeFailClosedProcessKind(process2),
      pid: process2.pid,
      startTime: process2.startTime,
      commandLine: process2.commandLine
    };
    const previous = uniqueProcesses.get(process2.pid);
    if (!previous || previous.kind === "process" && candidate.kind !== "process") {
      uniqueProcesses.set(process2.pid, candidate);
    } else {
      uniqueProcesses.set(process2.pid, {
        ...previous,
        startTime: previous.startTime ?? candidate.startTime,
        commandLine: previous.commandLine ?? candidate.commandLine
      });
    }
  }
  const entries = [...uniqueProcesses.values()];
  const visible = entries.slice(0, MAX_FORMATTED_BLOCKING_PROCESSES);
  const rendered = visible.map(({ kind, pid }) => `${kind} (PID ${pid})`);
  const omitted = entries.length - visible.length;
  if (omitted > 0)
    rendered.push(`${omitted} more blocking process(es)`);
  if (rendered.length === 0)
    return "a live process";
  const summary = rendered.length === 1 ? rendered[0] : `${rendered.slice(0, -1).join(", ")}, and ${rendered.at(-1)}`;
  const evidence = entries.map(({ kind, pid, startTime, commandLine }) => `- PID ${pid}: ${kind}, started ${formatFailClosedProcessStartTime(startTime)}, cmd: ${formatFailClosedCommandLine(commandLine)}`).join(`
`);
  return `${summary}
Blocking process evidence:
${evidence}`;
}
function formatFailClosedBlockingMessage(reason) {
  if (reason.kind === "migration_guard") {
    if (reason.unreadableFile) {
      const arm = reason.unreadableArm ?? "io";
      const recovery = arm === "io" ? `If none of these processes are running, it is safe to delete ${reason.unreadableFile} and retry.` : `The file may be a recent incomplete write; retry after the file is older than the ten-minute grace window, or stop the relevant process before deleting it.`;
      return [
        `Magic Context cannot migrate the shared database because RPC discovery file ${reason.unreadableFile} is uncertain (${arm} arm), so the absence of a live process cannot be proven.`,
        recovery,
        `Recovery: ${FAIL_CLOSED_DOCTOR_COMMAND}`
      ].join(" ");
    }
    return [
      `Magic Context cannot migrate the shared database (one database serves every project on this machine) because ${formatFailClosedBlockingProcesses(reason.blockingProcesses)} may be running an older Magic Context build that would fail against the migrated database.`,
      `The database is at upstream migration v${reason.persistedVersion}; this build needs v${reason.supportedVersion}.`,
      "Restart the blocking process — even one from a different project — and it will pick up the new build and migrate on start; or shut it down and retry.",
      "If that host loads a pinned or cached older Magic Context build, a restart alone is not enough: stop it or update its Magic Context build, then start this host once so it migrates the database with nothing older attached.",
      `Recovery: ${FAIL_CLOSED_DOCTOR_COMMAND}`
    ].join(" ");
  }
  if (reason.kind === "schema_fence") {
    return [
      `Magic Context cannot operate: this Magic Context build is older than the database; upgrade/restart this harness (upstream migration lane v${reason.persistedVersion}, build supports through v${reason.supportedVersion}).`,
      `Recovery: ${FAIL_CLOSED_DOCTOR_COMMAND}`
    ].join(" ");
  }
  const cause = reason.cause.trim().length > 0 ? reason.cause.trim() : "unknown storage error";
  return [
    `Magic Context cannot operate: persistent storage failed (${cause}).`,
    "The plugin will not silently degrade to native compaction while enabled.",
    `Recovery: ${FAIL_CLOSED_DOCTOR_COMMAND}`
  ].join(" ");
}
function createFailClosedBlockingError(reason, options) {
  return new FailClosedBlockingError(formatFailClosedBlockingMessage(reason), reason, options);
}
function isFailClosedBlockingError(error) {
  return error instanceof FailClosedBlockingError || typeof error === "object" && error !== null && error.name === "FailClosedBlockingError" && error.code === "FAIL_CLOSED_BLOCKING";
}
function shouldBypassFailClosedBlock(input) {
  if (input.isPiSubagentEnv === true)
    return true;
  if (input.isInternalChildSession === true)
    return true;
  const agent = typeof input.agent === "string" ? input.agent.trim() : "";
  if (agent.length === 0)
    return false;
  if (OPENCODE_INTERNAL_AGENT_NAMES.has(agent))
    return true;
  if (isMagicContextHiddenAgentName(agent))
    return true;
  return false;
}
function createFailClosedController(options) {
  const reprobeEveryN = Math.max(1, options?.reprobeEveryN ?? FAIL_CLOSED_REPROBE_EVERY_N);
  let reason = null;
  let blockedPassCount = 0;
  return {
    arm(next) {
      reason = next;
      blockedPassCount = 0;
    },
    clear() {
      reason = null;
      blockedPassCount = 0;
    },
    isArmed() {
      return reason !== null;
    },
    getReason() {
      return reason;
    },
    async enforce(input) {
      if (!reason)
        return;
      if (!input.blockingEnabled)
        return;
      if (input.exempt)
        return;
      blockedPassCount += 1;
      const shouldReprobe = typeof input.tryReopen === "function" && (blockedPassCount === 1 || blockedPassCount % reprobeEveryN === 0);
      if (shouldReprobe) {
        try {
          const healed = await input.tryReopen?.();
          if (healed) {
            reason = null;
            blockedPassCount = 0;
            return;
          }
        } catch {}
      }
      const blockedReason = reason;
      if (!blockedReason)
        return;
      throw createFailClosedBlockingError(blockedReason);
    }
  };
}

// ../plugin/src/features/magic-context/storage-db.ts
import {
  existsSync as existsSync2,
  readdirSync,
  readFileSync as readFileSync2,
  rmdirSync,
  statSync,
  unlinkSync
} from "node:fs";
import { basename as basename2, dirname as dirname2, join as join2, resolve } from "node:path";

// ../plugin/src/shared/error-message.ts
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function readString(value) {
  if (typeof value === "string" && value.length > 0)
    return value;
  if (typeof value === "number")
    return String(value);
  return;
}
function clip(value, max) {
  if (value.length <= max)
    return value;
  return `${value.slice(0, max)}…`;
}
function describeError(error) {
  const stringForm = clip(safeString(error), 400);
  if (!(error instanceof Error) && !(error && typeof error === "object")) {
    return {
      name: typeof error,
      message: "",
      stringForm,
      brief: stringForm || "<empty>"
    };
  }
  const obj = error;
  const nameFromField = readString(obj.name);
  const nameFromCtor = error?.constructor?.name;
  const name = nameFromField ?? nameFromCtor ?? "Error";
  const message = readString(obj.message) ?? "";
  const status = readString(obj.status) ?? readString(obj.statusCode);
  const code = readString(obj.code);
  let causeName;
  const cause = obj.cause;
  if (cause && typeof cause === "object") {
    const causeRecord = cause;
    causeName = readString(causeRecord.name) ?? cause.constructor?.name;
  }
  const stack = readString(obj.stack);
  const stackHead = stack ? stack.split(`
`).slice(0, 4).map((l) => l.trim()).filter((l) => l.length > 0).join(" | ") : undefined;
  const briefParts = [];
  if (name)
    briefParts.push(name);
  if (message)
    briefParts.push(`message="${clip(message, 200)}"`);
  if (status)
    briefParts.push(`status=${status}`);
  if (code)
    briefParts.push(`code=${code}`);
  if (causeName)
    briefParts.push(`cause=${causeName}`);
  if (!message && stringForm && stringForm !== name) {
    briefParts.push(`str="${clip(stringForm, 200)}"`);
  }
  const brief = briefParts.join(" ") || stringForm || name;
  return {
    name,
    message,
    ...status ? { status } : {},
    ...code ? { code } : {},
    ...causeName ? { causeName } : {},
    ...stackHead ? { stackHead } : {},
    stringForm,
    brief
  };
}
function safeString(value) {
  try {
    return String(value);
  } catch {
    return "<unstringifiable>";
  }
}

// ../plugin/src/features/magic-context/context-store-uuid.ts
import { randomUUID } from "node:crypto";
function getContextStoreUuid(db) {
  const row = db.prepare("SELECT value FROM context_store_meta WHERE key = 'store_uuid'").get();
  return typeof row?.value === "string" && row.value.length > 0 ? row.value : null;
}
function ensureContextStoreUuid(db) {
  const existing = getContextStoreUuid(db);
  if (existing)
    return existing;
  const minted = randomUUID();
  withPrivilegedWriter2(db, () => {
    db.transaction(() => {
      db.prepare("INSERT INTO context_store_meta(key, value) VALUES ('store_uuid', ?) ON CONFLICT(key) DO NOTHING").run(minted);
    }).immediate();
  });
  return getContextStoreUuid(db) ?? minted;
}

// ../plugin/src/features/magic-context/migration-worker-client.ts
import { Worker } from "node:worker_threads";

// ../plugin/src/shared/off-thread-migration-clock.ts
var activeMigrations = 0;
var activeSince = 0;
var accumulatedMs = 0;
var idleWaiters = [];
function offThreadMigrationMs(now = performance.now()) {
  return accumulatedMs + (activeMigrations > 0 ? Math.max(0, now - activeSince) : 0);
}
function isOffThreadMigrationRunning() {
  return activeMigrations > 0;
}
function beginOffThreadMigration() {
  if (activeMigrations === 0)
    activeSince = performance.now();
  activeMigrations += 1;
  let ended = false;
  return () => {
    if (ended)
      return;
    ended = true;
    activeMigrations -= 1;
    if (activeMigrations > 0)
      return;
    accumulatedMs += Math.max(0, performance.now() - activeSince);
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const wake of waiters)
      wake();
  };
}
function whenOffThreadMigrationIdle() {
  if (activeMigrations === 0)
    return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}
function startBootDeadline(timeoutMs, onDeferred) {
  const startedAt = performance.now();
  const migratedAtStart = offThreadMigrationMs(startedAt);
  const budgetMs = Math.max(0, timeoutMs);
  let timer;
  let cancelled = false;
  let deferredReported = false;
  let resolveExpired;
  const expired = new Promise((resolve) => {
    resolveExpired = resolve;
  });
  const remainingMs = () => {
    const now = performance.now();
    const countedMs = now - startedAt - (offThreadMigrationMs(now) - migratedAtStart);
    return budgetMs - countedMs;
  };
  const check = () => {
    timer = undefined;
    if (cancelled)
      return;
    if (isOffThreadMigrationRunning()) {
      if (!deferredReported) {
        deferredReported = true;
        onDeferred?.();
      }
      whenOffThreadMigrationIdle().then(check);
      return;
    }
    const left = remainingMs();
    if (left > 0) {
      timer = setTimeout(check, left);
      return;
    }
    resolveExpired();
  };
  timer = setTimeout(check, budgetMs);
  return {
    expired,
    cancel: () => {
      cancelled = true;
      if (timer)
        clearTimeout(timer);
      timer = undefined;
    }
  };
}

// ../plugin/src/features/magic-context/migration-worker-client.ts
function workerStartError(detail) {
  return new Error(`the migration worker could not start (${detail}); reinstall or rebuild the plugin`);
}
function defaultWorkerEntry() {
  return new URL(new URL(import.meta.url).pathname.endsWith(".ts") ? "./migration-worker.ts" : "./migration-worker.js", import.meta.url);
}
var workerEntryOverride = null;
function runMigrationsOffThread(data) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(workerEntryOverride ?? defaultWorkerEntry(), { workerData: data });
    } catch (error) {
      reject(workerStartError(error instanceof Error ? error.message : String(error)));
      return;
    }
    log2(`[migrations] applying pending migrations on a worker thread: ${data.dbPath}`);
    let ready = false;
    let settled = false;
    let endBusy = beginOffThreadMigration();
    const setBusy = (busy) => {
      if (busy && !endBusy)
        endBusy = beginOffThreadMigration();
      if (!busy && endBusy) {
        endBusy();
        endBusy = null;
      }
    };
    const settle = (finish) => {
      if (settled)
        return;
      settled = true;
      setBusy(false);
      finish();
    };
    const unavailable = (detail) => {
      settle(() => {
        reject(workerStartError(detail));
      });
    };
    worker.on("message", (message) => {
      switch (message.type) {
        case "ready":
          ready = true;
          log2(`[migrations] migration worker ready: ${data.dbPath}`);
          return;
        case "log":
          writeForwardedLogLine2(message.line);
          return;
        case "lock-wait":
          if (!settled)
            setBusy(!message.waiting);
          return;
        case "done":
          if (!ready) {
            unavailable("reported completion before ready");
            return;
          }
          settle(() => resolve("migrated"));
          return;
        case "failed":
          if (!ready) {
            unavailable(message.message);
            return;
          }
          settle(() => reject(new Error(message.message)));
          return;
      }
    });
    worker.on("error", (error) => {
      if (!ready) {
        unavailable(error.message);
        worker.terminate();
        return;
      }
      settle(() => reject(new Error(`migration worker failed: ${error.message}`)));
    });
    worker.on("exit", (code) => {
      if (!ready) {
        unavailable(`exited with code ${code} before loading`);
        return;
      }
      settle(() => reject(new Error(`migration worker exited (code ${code}) before reporting a result`)));
    });
  });
}

// ../plugin/src/features/magic-context/tool-owner-backfill.ts
import { existsSync } from "node:fs";
var LEASE_DURATION_MS = 5 * 60 * 1000;
var LEASE_RENEWAL_MS = 60 * 1000;
function resolveOpencodeDbPath() {
  return resolveOpenCodeDbPath().path;
}
function ensureBackfillStateTable(db) {
  db.exec(`
        CREATE TABLE IF NOT EXISTS tool_owner_backfill_state (
            session_id TEXT PRIMARY KEY,
            status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'skipped')),
            started_at INTEGER,
            lease_expires_at INTEGER,
            completed_at INTEGER,
            last_error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tool_owner_backfill_state_status
        ON tool_owner_backfill_state(status);
    `);
}
function runToolOwnerBackfill(db) {
  const startedAt = performance.now();
  ensureBackfillStateTable(db);
  const result = {
    sessionsProcessed: 0,
    sessionsSkippedNoOcDb: 0,
    sessionsSkippedNoMatches: 0,
    sessionsCompleted: 0,
    sessionsBlockedByLease: 0,
    sessionsErrored: 0,
    rowsUpdated: 0,
    rowsLeftNull: 0,
    durationMs: 0
  };
  if (!isToolOwnerBackfillNeeded(db)) {
    result.durationMs = performance.now() - startedAt;
    return result;
  }
  const opencodeDbPath = resolveOpencodeDbPath();
  if (!existsSync(opencodeDbPath)) {
    log2(`[backfill] OpenCode DB not found at ${opencodeDbPath} — marking all unbackfilled sessions as skipped. Lazy adoption (defense-in-depth) handles legacy rows at runtime.`);
    markAllUnbackfilledSessionsSkipped(db);
    result.sessionsSkippedNoOcDb = countSessionsByStatus(db, "skipped");
    result.durationMs = performance.now() - startedAt;
    return result;
  }
  const escapedDbPath = opencodeDbPath.replaceAll("'", "''");
  db.exec(`ATTACH '${escapedDbPath}' AS oc_backfill`);
  try {
    if (!hasV1MessageTables(db, "oc_backfill")) {
      throw new Error(`OpenCode store at ${opencodeDbPath} has no v1 message tables; nothing to backfill`);
    }
    backfillToolOwnersInChunks(db, result);
  } finally {
    try {
      db.exec("DETACH DATABASE oc_backfill");
    } catch (error) {
      log2(`[backfill] failed to detach oc_backfill database: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  result.durationMs = performance.now() - startedAt;
  log2(`[backfill] sessions=${result.sessionsProcessed} completed=${result.sessionsCompleted} skipped_no_oc=${result.sessionsSkippedNoOcDb} skipped_no_matches=${result.sessionsSkippedNoMatches} blocked_by_lease=${result.sessionsBlockedByLease} errored=${result.sessionsErrored} rows_updated=${result.rowsUpdated} rows_left_null=${result.rowsLeftNull} duration_ms=${Math.round(result.durationMs)}`);
  return result;
}
function isToolOwnerBackfillNeeded(db) {
  ensureBackfillStateTable(db);
  const row = db.prepare(`SELECT 1 AS hit
             FROM tags
             WHERE type = 'tool' AND tool_owner_message_id IS NULL
               AND NOT EXISTS (
                   SELECT 1 FROM tool_owner_backfill_state s
                   WHERE s.session_id = tags.session_id
                     AND s.status IN ('completed', 'skipped')
               )
             LIMIT 1`).get();
  return row !== null && row !== undefined;
}
function markAllUnbackfilledSessionsSkipped(db) {
  const now = Date.now();
  db.prepare(`INSERT INTO tool_owner_backfill_state(session_id, status, started_at, completed_at, last_error)
         SELECT DISTINCT session_id, 'skipped', NULL, ?, NULL
         FROM tags
         WHERE type = 'tool' AND tool_owner_message_id IS NULL
         ON CONFLICT(session_id) DO UPDATE SET
             status = 'skipped',
             completed_at = excluded.completed_at,
             last_error = NULL
         WHERE tool_owner_backfill_state.status NOT IN ('completed', 'running')`).run(now);
}
function countSessionsByStatus(db, status) {
  const row = db.prepare("SELECT COUNT(*) AS c FROM tool_owner_backfill_state WHERE status = ?").get(status);
  return row.c;
}
function acquireSessionLease(db, sessionId, now) {
  const expiresAt = now + LEASE_DURATION_MS;
  const result = db.prepare(`INSERT INTO tool_owner_backfill_state(session_id, status, started_at, lease_expires_at)
             SELECT ?, 'running', ?, ?
             WHERE EXISTS (SELECT 1 FROM tags WHERE session_id = ?)
             ON CONFLICT(session_id) DO UPDATE SET
                 status = 'running',
                 started_at = excluded.started_at,
                 lease_expires_at = excluded.lease_expires_at,
                 last_error = NULL
             WHERE tool_owner_backfill_state.status IN ('pending', 'skipped')
                OR (tool_owner_backfill_state.status = 'running'
                    AND tool_owner_backfill_state.lease_expires_at < ?)`).run(sessionId, now, expiresAt, sessionId, now);
  return (result.changes ?? 0) === 1;
}
function renewSessionLease(db, sessionId, now) {
  const expiresAt = now + LEASE_DURATION_MS;
  db.prepare(`UPDATE tool_owner_backfill_state
         SET lease_expires_at = ?
         WHERE session_id = ? AND status = 'running'`).run(expiresAt, sessionId);
}
function markSessionCompleted(db, sessionId, now) {
  db.prepare(`UPDATE tool_owner_backfill_state
         SET status = 'completed', completed_at = ?, lease_expires_at = NULL, last_error = NULL
         WHERE session_id = ?`).run(now, sessionId);
}
function markSessionPendingRetry(db, sessionId) {
  db.prepare(`UPDATE tool_owner_backfill_state
         SET status = 'pending', completed_at = NULL, lease_expires_at = NULL, last_error = NULL
         WHERE session_id = ?`).run(sessionId);
}
function markSessionSkipped(db, sessionId, now, reason) {
  db.prepare(`UPDATE tool_owner_backfill_state
         SET status = 'skipped', completed_at = ?, last_error = ?, lease_expires_at = NULL
         WHERE session_id = ? AND status = 'running'`).run(now, reason, sessionId);
}
function markSessionErrored(db, sessionId, error) {
  const message = error instanceof Error ? error.message : String(error);
  db.prepare(`UPDATE tool_owner_backfill_state
         SET last_error = ?, lease_expires_at = NULL
         WHERE session_id = ?`).run(message, sessionId);
}
function getSessionsNeedingBackfill(db) {
  const rows = db.prepare(`SELECT DISTINCT t.session_id
             FROM tags t
             LEFT JOIN tool_owner_backfill_state s ON s.session_id = t.session_id
             WHERE t.type = 'tool' AND t.tool_owner_message_id IS NULL
               AND (s.status IS NULL OR s.status NOT IN ('completed', 'skipped'))
             ORDER BY t.session_id ASC`).all();
  return rows.map((r) => r.session_id);
}
function buildSessionOwnerMap(db, sessionId) {
  const rows = db.prepare(`SELECT
                COALESCE(
                    CASE WHEN json_extract(p.data, '$.type') = 'tool_use'
                        THEN json_extract(p.data, '$.id')
                    END,
                    json_extract(p.data, '$.callID')
                ) AS callid,
                m.id AS owner_id,
                m.time_created AS owner_t_created,
                p.id AS part_id,
                p.time_created AS part_t_created
             FROM oc_backfill.message m
             INNER JOIN oc_backfill.part p ON p.message_id = m.id
             WHERE m.session_id = ?
               AND json_extract(m.data, '$.role') = 'assistant'
               AND (
                   (json_extract(p.data, '$.type') IN ('tool', 'tool-invocation')
                       AND json_extract(p.data, '$.callID') IS NOT NULL)
                   OR (json_extract(p.data, '$.type') = 'tool_use'
                       AND json_extract(p.data, '$.id') IS NOT NULL)
               )
             ORDER BY
                 m.time_created ASC,
                 m.id ASC,
                 p.time_created ASC,
                 p.id ASC`).all(sessionId);
  const oldestByCallId = new Map;
  for (const r of rows) {
    if (typeof r.callid !== "string" || r.callid.length === 0)
      continue;
    if (!oldestByCallId.has(r.callid)) {
      oldestByCallId.set(r.callid, r.owner_id);
    }
  }
  return oldestByCallId;
}
function applyOwnersForSession(db, sessionId, ownersByCallId) {
  if (ownersByCallId.size === 0) {
    const leftNull = db.prepare(`SELECT COUNT(*) AS c FROM tags
                     WHERE session_id = ? AND type = 'tool'
                       AND tool_owner_message_id IS NULL`).get(sessionId).c;
    return { rowsUpdated: 0, rowsLeftNull: leftNull };
  }
  const findOrphanStmt = db.prepare(`SELECT id FROM tags
         WHERE session_id = ? AND message_id = ? AND type = 'tool'
           AND tool_owner_message_id IS NULL
         ORDER BY tag_number ASC
         LIMIT 1`);
  const updateRowStmt = db.prepare(`UPDATE tags
         SET tool_owner_message_id = ?
         WHERE id = ? AND tool_owner_message_id IS NULL`);
  const existingOwnerStmt = db.prepare(`SELECT 1 AS hit FROM tags
         WHERE session_id = ? AND message_id = ? AND type = 'tool'
           AND tool_owner_message_id = ?
         LIMIT 1`);
  const ownerForRowStmt = db.prepare("SELECT tool_owner_message_id FROM tags WHERE id = ?");
  let rowsUpdated = 0;
  db.transaction(() => {
    for (const [callId, ownerId] of ownersByCallId) {
      const orphan = findOrphanStmt.get(sessionId, callId);
      if (!orphan)
        continue;
      if (existingOwnerStmt.get(sessionId, callId, ownerId))
        continue;
      updateRowStmt.run(ownerId, orphan.id);
      const updated = ownerForRowStmt.get(orphan.id);
      if (updated?.tool_owner_message_id === ownerId)
        rowsUpdated += 1;
    }
  }).immediate();
  const rowsLeftNull = db.prepare(`SELECT COUNT(*) AS c FROM tags
                 WHERE session_id = ? AND type = 'tool'
                   AND tool_owner_message_id IS NULL`).get(sessionId).c;
  return { rowsUpdated, rowsLeftNull };
}
function backfillToolOwnersInChunks(db, result) {
  const sessionIds = getSessionsNeedingBackfill(db);
  let lastRenewedAt = Date.now();
  for (const sessionId of sessionIds) {
    const now = Date.now();
    result.sessionsProcessed += 1;
    const acquired = acquireSessionLease(db, sessionId, now);
    if (!acquired) {
      result.sessionsBlockedByLease += 1;
      continue;
    }
    try {
      const owners = buildSessionOwnerMap(db, sessionId);
      const { rowsUpdated, rowsLeftNull } = applyOwnersForSession(db, sessionId, owners);
      result.rowsUpdated += rowsUpdated;
      result.rowsLeftNull += rowsLeftNull;
      if (owners.size === 0) {
        markSessionSkipped(db, sessionId, Date.now(), "no_oc_matches");
        result.sessionsSkippedNoMatches += 1;
      } else if (rowsLeftNull > 0) {
        markSessionPendingRetry(db, sessionId);
      } else {
        markSessionCompleted(db, sessionId, Date.now());
        result.sessionsCompleted += 1;
      }
    } catch (error) {
      log2(`[backfill] session=${sessionId} errored: ${error instanceof Error ? error.message : String(error)}`);
      markSessionErrored(db, sessionId, error);
      result.sessionsErrored += 1;
    }
    const sinceRenew = Date.now() - lastRenewedAt;
    if (sinceRenew > LEASE_RENEWAL_MS) {
      renewSessionLease(db, sessionId, Date.now());
      lastRenewedAt = Date.now();
    }
  }
}

// ../plugin/src/features/magic-context/wal-filesystem.ts
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
var WAL_UNSAFE_FILESYSTEMS = new Set(["virtiofs"]);
var PROC_SELF_MOUNTS = "/proc/self/mounts";
function unescapeMountField(field) {
  return field.replace(/\\([0-7]{3})/g, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
}
function parseMountTable(text) {
  const entries = [];
  for (const line of text.split(`
`)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 3)
      continue;
    entries.push({
      mountPoint: unescapeMountField(fields[1]),
      filesystemType: unescapeMountField(fields[2])
    });
  }
  return entries;
}
function isWithinMount(mountPoint, path) {
  if (mountPoint === path)
    return true;
  const prefix = mountPoint.endsWith("/") ? mountPoint : `${mountPoint}/`;
  return path.startsWith(prefix);
}
function filesystemTypeFor(path, mounts) {
  let best = null;
  for (const entry of mounts) {
    if (!isWithinMount(entry.mountPoint, path))
      continue;
    if (best === null || entry.mountPoint.length > best.mountPoint.length)
      best = entry;
  }
  return best === null ? null : best.filesystemType;
}
function readProcSelfMounts() {
  try {
    return readFileSync(PROC_SELF_MOUNTS, "utf8");
  } catch {
    return null;
  }
}
var mountTableReader = readProcSelfMounts;
function canonicalizeForLookup(path) {
  try {
    return realpathSync(path);
  } catch {}
  try {
    return join(realpathSync(dirname(path)), basename(path));
  } catch {
    return path;
  }
}
function detectWalUnsafeFilesystem(dbPath) {
  const mountTable = mountTableReader();
  if (mountTable === null)
    return null;
  const filesystemType = filesystemTypeFor(canonicalizeForLookup(dbPath), parseMountTable(mountTable));
  if (filesystemType === null)
    return null;
  return WAL_UNSAFE_FILESYSTEMS.has(filesystemType) ? filesystemType : null;
}

// ../plugin/src/features/magic-context/storage-db.ts
registerSlowWriteReporter2(logSlowWriteTransaction);
registerSqliteDiagnosticSink2((message) => log2(message), getHarness2);
var databases = new Map;
var pendingAsyncOpens = new Map;
var persistenceByDatabase = new WeakMap;
var persistenceErrorByDatabase = new WeakMap;
var pathByDatabase = new WeakMap;
var lastSchemaFenceRejection = null;
var lastMigrationOnOpenRefusal = null;
var lastUnconfirmedMigrationHolders = null;
function getSchemaFenceRejection() {
  return lastSchemaFenceRejection;
}
function getMigrationOnOpenRefusal() {
  return lastMigrationOnOpenRefusal;
}
var LATEST_SUPPORTED_VERSION = 95;
var BOOT_SQLITE_BUSY_TIMEOUT_MS = 5000;
function ensureSecureStorageDir(dir) {
  ensureStorageDirectorySync(dir);
}
function tightenStorageTree(dir) {
  const { failures } = tightenStorageTreeSync(dir);
  log2(`[magic-context] storage permission tightening failures=${failures}`);
}
function resolveBootBusyTimeoutMs(value) {
  if (value === undefined)
    return BOOT_SQLITE_BUSY_TIMEOUT_MS;
  if (!Number.isFinite(value))
    return BOOT_SQLITE_BUSY_TIMEOUT_MS;
  return Math.max(0, Math.min(BOOT_SQLITE_BUSY_TIMEOUT_MS, Math.floor(value)));
}
function installBootBusyTimeout(db, dbPath, timeoutMs, report = log2) {
  db.exec(`PRAGMA busy_timeout=${timeoutMs}`);
  report(`[magic-context] SQLite boot busy timeout: backend=${detectSqliteRuntime2()} timeout=${timeoutMs}ms path=${dbPath}`);
}
function resolveDatabasePath(dbPathOverride) {
  if (dbPathOverride) {
    return { dbDir: dirname2(dbPathOverride), dbPath: dbPathOverride };
  }
  const dbDir = getMagicContextStorageDir();
  return { dbDir, dbPath: join2(dbDir, "context.db") };
}
function isFileBackedPath(dbPath) {
  const trimmed = dbPath.trim();
  return trimmed !== "" && trimmed !== ":memory:" && !trimmed.startsWith("file:");
}
function getDatabasePath(db) {
  return pathByDatabase.get(db) ?? null;
}
function migrateLegacyStorageIfNeeded(targetDbPath, targetDbDir) {
  if (existsSync2(targetDbPath))
    return;
  const legacyDir = getLegacyOpenCodeMagicContextStorageDir();
  const legacyDbPath = join2(legacyDir, "context.db");
  if (!existsSync2(legacyDbPath))
    return;
  log2(`[magic-context] migrating legacy plugin storage: ${legacyDir} -> ${targetDbDir} (legacy left in place as backup)`);
  ensureSecureStorageDir(targetDbDir);
  try {
    const legacyDb = new Database2(legacyDbPath);
    try {
      configureContextDatabasePragmas2(legacyDb, true);
      legacyDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      closeQuietly(legacyDb);
    }
  } catch (error) {
    log2(`[magic-context] legacy WAL checkpoint before copy failed (continuing with sidecar copy): ${getErrorMessage(error)}`);
  }
  for (const suffix of ["", "-wal", "-shm"]) {
    const src = `${legacyDbPath}${suffix}`;
    const dst = join2(targetDbDir, `context.db${suffix}`);
    if (existsSync2(src)) {
      try {
        copyStorageFileSync(src, dst);
      } catch (error) {
        log2(`[magic-context] failed to copy ${src}:`, getErrorMessage(error));
      }
    }
  }
  const legacyModelsDir = join2(legacyDir, "models");
  const targetModelsDir = join2(targetDbDir, "models");
  if (existsSync2(legacyModelsDir) && !existsSync2(targetModelsDir)) {
    try {
      copyStorageTreeSync(legacyModelsDir, targetModelsDir);
    } catch (error) {
      log2("[magic-context] failed to copy embedding model cache:", getErrorMessage(error));
    }
  }
}
function getPersistedSchemaVersion(db) {
  const hasMigrationsTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!hasMigrationsTable) {
    return 0;
  }
  const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations WHERE version < ?").get(FORK_MIGRATION_VERSION_FLOOR);
  return row?.version ?? 0;
}
function formatSchemaFenceBootLog(persistedVersion, supportedVersion) {
  return `[magic-context] upstream migration lane at boot: database=v${persistedVersion}, supported_fence=v${supportedVersion}`;
}
function getRuntimeLatestSupportedVersion(options) {
  if (options?.latestSupportedVersion !== undefined) {
    return options.latestSupportedVersion;
  }
  const override = process.env.MAGIC_CONTEXT_LATEST_SUPPORTED_VERSION;
  if (override) {
    const parsed = Number.parseInt(override, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return LATEST_SUPPORTED_VERSION;
}
function enforceSchemaFence(db, dbPath, latestSupportedVersion) {
  const persistedVersion = getPersistedSchemaVersion(db);
  if (persistedVersion <= latestSupportedVersion) {
    lastSchemaFenceRejection = null;
    return true;
  }
  lastSchemaFenceRejection = { persistedVersion, supportedVersion: latestSupportedVersion };
  log2(`[magic-context] storage fatal: refusing to open ${dbPath}; upstream migration lane v${persistedVersion} is newer than this binary supports (max v${latestSupportedVersion}). A pinned or stale plugin is likely sharing this database with a newer instance; update or unpin Magic Context with 'npx @cortexkit/magic-context@latest doctor --force', then restart.`);
  return false;
}
function unreadableDiscovery(path, arm) {
  return {
    state: "unreadable",
    serverPids: [],
    staleFiles: [],
    unreadableFile: path,
    unreadableArm: arm
  };
}
var RPC_DISCOVERY_PARSE_GRACE_MS = 10 * 60 * 1000;
var defaultRpcDiscoveryFs = {
  readdirSync: (path, options) => options?.withFileTypes ? readdirSync(path, { withFileTypes: true }) : readdirSync(path),
  readFileSync: (path, encoding) => String(readFileSync2(path, encoding)),
  statSync: (path) => ({ mtimeMs: statSync(path).mtimeMs }),
  unlinkSync: (path) => unlinkSync(path),
  rmdirSync: (path) => rmdirSync(path)
};
var rpcDiscoveryFs = defaultRpcDiscoveryFs;
function invalidDiscoveryReason(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if ("pid" in parsed) {
        const pid = Number(parsed.pid);
        if (!Number.isInteger(pid) || pid <= 0)
          return "invalid-pid";
      }
    } catch {}
  }
  return "parse-invalid";
}
function classifyDiscoveryRecordKind(record) {
  for (const value of [record.kind, record.harness]) {
    const normalized = value?.trim().toLowerCase();
    if (!normalized)
      continue;
    if (normalized === "process")
      return "process";
    if (normalized === "opencode server" || normalized === "server") {
      return "OpenCode server";
    }
    if (normalized === "opencode instance" || normalized === "opencode instance (tui/cli)" || normalized === "opencode" || normalized === "tui" || normalized === "cli") {
      return "OpenCode instance (TUI/CLI)";
    }
    if (normalized === "pi" || normalized === "pi harness" || normalized === "omp" || normalized === "oh-my-pi") {
      return "Pi";
    }
  }
  return null;
}
function classifyRpcProcess(record, commandLine) {
  return classifyDiscoveryRecordKind(record) ?? classifyProcessKind(commandLine === undefined ? readProcessProbeEvidence(record.pid).commandLine : commandLine);
}
function classifyJunkDiscovery(portFile, raw, staleFiles) {
  let mtimeMs;
  try {
    mtimeMs = rpcDiscoveryFs.statSync(portFile).mtimeMs;
  } catch (error) {
    if (error.code === "ENOENT")
      return null;
    return unreadableDiscovery(portFile, "io");
  }
  const ageMs = Date.now() - mtimeMs;
  if (!Number.isFinite(ageMs) || ageMs < RPC_DISCOVERY_PARSE_GRACE_MS) {
    return unreadableDiscovery(portFile, "parse");
  }
  staleFiles.push(portFile);
  const reason = invalidDiscoveryReason(raw);
  log2(`[magic-context] removing stale RPC discovery file ${portFile}: ${reason} record older than 10 minutes`);
  return null;
}
function inspectRpcServerDiscovery(storageDir, processes, options) {
  const deadline = options?.deadlineMs === undefined ? Number.POSITIVE_INFINITY : Date.now() + options.deadlineMs;
  let progressAt = Date.now() + 3000;
  const rpcRoot = join2(storageDir, "rpc");
  let projectEntries;
  try {
    projectEntries = rpcDiscoveryFs.readdirSync(rpcRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return { state: "absent", serverPids: [], staleFiles: [] };
    }
    return unreadableDiscovery(rpcRoot, "io");
  }
  const portFiles = [];
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory())
      continue;
    const projectDir = join2(rpcRoot, projectEntry.name);
    let entries;
    try {
      entries = rpcDiscoveryFs.readdirSync(projectDir);
    } catch (error) {
      if (error.code === "ENOENT")
        continue;
      return unreadableDiscovery(projectDir, "io");
    }
    for (const entry of entries) {
      if (entry === "port" || entry.startsWith("port-") && entry.endsWith(".json")) {
        portFiles.push(join2(projectDir, entry));
      }
    }
  }
  if (portFiles.length === 0) {
    return { state: "absent", serverPids: [], staleFiles: [] };
  }
  if (!processes && process.platform === "win32")
    processes = inspectWindowsProcessesSync();
  const pids = new Set;
  const processByPid = new Map;
  const staleFiles = [];
  const inconclusivePids = new Set;
  const inconclusiveRecords = [];
  for (const [index, portFile] of portFiles.entries()) {
    if (Date.now() >= deadline)
      throw new Error(`RPC holder inspection timed out after ${Math.round((options?.deadlineMs ?? 0) / 1000)} seconds (${index}/${portFiles.length} records checked). Close OpenCode and Pi, then retry.`);
    if (options?.onProgress && Date.now() >= progressAt) {
      options.onProgress(index, portFiles.length);
      progressAt = Date.now() + 3000;
    }
    let raw;
    try {
      raw = rpcDiscoveryFs.readFileSync(portFile, "utf8");
    } catch (error) {
      if (error.code === "ENOENT")
        continue;
      return unreadableDiscovery(portFile, "io");
    }
    const filename = basename2(portFile);
    const pidFromName = /^port-(\d+)/.exec(filename)?.[1];
    const fallbackPid = pidFromName ? Number(pidFromName) : 0;
    const record = parseRpcPortFile(raw, fallbackPid);
    if (!record || !Number.isInteger(record.pid) || record.pid <= 0) {
      const junk = classifyJunkDiscovery(portFile, raw, staleFiles);
      if (junk)
        return junk;
      continue;
    }
    if (isOwnRpcServerRecord(record))
      continue;
    const liveness = processes ? processes.liveness(record.pid) : isPidAlive(record.pid);
    if (liveness === "dead") {
      staleFiles.push(portFile);
      continue;
    }
    const evidence = processes ? processes.evidence(record.pid) : readProcessProbeEvidence(record.pid);
    const identity = isPidIdentityPlausible(record, evidence);
    if (identity === "plausible") {
      pids.add(record.pid);
      const detected = attachFailClosedBlockingProcessEvidence({
        kind: classifyRpcProcess(record, evidence.commandLine),
        pid: record.pid
      }, evidence);
      const previous = processByPid.get(record.pid);
      if (!previous || previous.kind === "process" && detected.kind !== "process") {
        processByPid.set(record.pid, detected);
      }
    } else if (identity === "implausible") {
      staleFiles.push(portFile);
    } else {
      inconclusivePids.add(record.pid);
      inconclusiveRecords.push({
        file: portFile,
        pid: record.pid,
        recordedStartedAt: record.started_at > 0 ? record.started_at : null,
        processStartTime: evidence.startTime,
        imageName: evidence.imageName ?? null,
        commandLine: evidence.commandLine,
        liveness
      });
    }
  }
  for (const staleFile of staleFiles) {
    try {
      rpcDiscoveryFs.unlinkSync(staleFile);
    } catch {
      return unreadableDiscovery(staleFile, "io");
    }
  }
  const serverPids = [...pids].sort((a, b) => a - b);
  if (serverPids.length > 0) {
    return {
      state: "live",
      serverPids,
      serverProcesses: serverPids.map((pid) => processByPid.get(pid) ?? { kind: "process", pid }),
      staleFiles,
      ...inconclusiveRecords.length > 0 ? { inconclusiveRecords } : {}
    };
  }
  const uncertainPids = [...inconclusivePids].sort((a, b) => a - b);
  if (uncertainPids.length > 0) {
    return {
      state: "inconclusive",
      serverPids: [],
      staleFiles,
      inconclusivePids: uncertainPids,
      inconclusiveRecords
    };
  }
  return { state: "stale", serverPids: [], staleFiles };
}
function createPiBlockingProcess(pid) {
  return attachFailClosedBlockingProcessEvidence({ kind: "Pi", pid }, readProcessProbeEvidence(pid));
}
function formatInconclusiveOpenCodeMigrationWarning(dbPath, pids) {
  return `[magic-context] storage warning: continuing migration for ${dbPath}; OpenCode server PID ${pids.join(", ")} was not confirmed because its liveness or identity check could not run. This commonly means an OS sandbox denied kill(0) or ps. No live OpenCode server was confirmed.`;
}
function formatInconclusivePiMigrationWarning(dbPath, pids) {
  return `[magic-context] storage warning: continuing migration for ${dbPath}; Pi/OMP PID ${pids.join(", ")} was not confirmed as a live harness because the process image or command line was ambiguous. No live Pi harness was confirmed.`;
}
function logInconclusiveMigrationProbes(dbPath, discovery, piDiscovery) {
  const uncertainPids = discovery.inconclusivePids ?? [];
  if (uncertainPids.length > 0) {
    log2(formatInconclusiveOpenCodeMigrationWarning(dbPath, uncertainPids));
  }
  if (piDiscovery.state === "unreadable") {
    log2(`[magic-context] storage warning: continuing migration for ${dbPath}; the Pi/OMP process-list probe could not run, which commonly means an OS sandbox denied ps. No live Pi harness was confirmed.`);
  } else if ((piDiscovery.inconclusivePids?.length ?? 0) > 0) {
    log2(formatInconclusivePiMigrationWarning(dbPath, piDiscovery.inconclusivePids ?? []));
  }
}
function isDefaultSharedDatabasePath(dbPath) {
  if (!process.env.XDG_DATA_HOME && (process.env.MAGIC_CONTEXT_TEST_DATA_DIR || false)) {
    return false;
  }
  return resolve(dbPath) === resolve(join2(getMagicContextStorageDir(), "context.db"));
}
function migrationBlockingPiPids(dbPath, discovery, discoveredPiPids) {
  if (isDefaultSharedDatabasePath(dbPath))
    return [...discoveredPiPids];
  const sameDataDirPids = new Set(discovery.serverPids);
  return discoveredPiPids.filter((pid) => sameDataDirPids.has(pid));
}
function formatLiveProcessMigrationRefusal(dbPath, persistedVersion, latestSupportedVersion, serverPids, piPids) {
  const blockers = [
    ...serverPids.map((pid) => `confirmed OpenCode server PID ${pid}`),
    ...piPids.map((pid) => `confirmed Pi harness PID ${pid}`)
  ];
  return `[magic-context] storage fatal: refusing to migrate ${dbPath} from upstream migration v${persistedVersion} to v${latestSupportedVersion} while ${blockers.join(", ")} still use the old plugin build. Restart the blocking harness, then retry this process.`;
}
function enforceMigrationOnOpenGuard(db, dbPath, dbDir, latestSupportedVersion, processes) {
  const persistedVersion = getPersistedSchemaVersion(db);
  if (persistedVersion >= latestSupportedVersion) {
    lastMigrationOnOpenRefusal = null;
    return true;
  }
  const discovery = inspectRpcServerDiscovery(dbDir, processes);
  const piDiscovery = processes?.pi ?? inspectLivePiProcesses();
  const piPids = migrationBlockingPiPids(dbPath, discovery, piDiscovery.processIds);
  const serverProcesses = discovery.serverProcesses ?? (discovery.state === "live" ? discovery.serverPids.map((pid) => ({ kind: "process", pid })) : []);
  const blockingProcesses = [
    ...serverProcesses,
    ...piPids.map((pid) => processes ? attachFailClosedBlockingProcessEvidence({ kind: "Pi", pid }, processes.evidence(pid)) : createPiBlockingProcess(pid))
  ];
  if ((discovery.state === "absent" || discovery.state === "stale" || discovery.state === "inconclusive") && piPids.length === 0) {
    lastMigrationOnOpenRefusal = null;
    logInconclusiveMigrationProbes(dbPath, discovery, piDiscovery);
    const uncertainPids = discovery.inconclusivePids ?? [];
    if (uncertainPids.length > 0) {
      lastUnconfirmedMigrationHolders = {
        pids: [...uncertainPids],
        fromVersion: persistedVersion,
        toVersion: latestSupportedVersion
      };
    }
    return true;
  }
  const blockingPids = [...new Set([...discovery.serverPids, ...piPids])].sort((left, right) => left - right);
  lastMigrationOnOpenRefusal = {
    persistedVersion,
    supportedVersion: latestSupportedVersion,
    serverPids: blockingPids,
    blockingProcesses,
    ...discovery.unreadableFile ? { unreadableFile: discovery.unreadableFile } : {},
    ...discovery.unreadableArm ? { unreadableArm: discovery.unreadableArm } : {}
  };
  if (discovery.state === "unreadable") {
    const unreadableFile = discovery.unreadableFile ?? "<unknown>";
    const arm = discovery.unreadableArm ?? "io";
    const recovery = arm === "io" ? `If no OpenCode server is running, it is safe to delete ${unreadableFile} and retry.` : `Retry after the file is older than the ten-minute grace window, or stop OpenCode before deleting it.`;
    log2(`[magic-context] storage fatal: refusing to migrate ${dbPath} from upstream migration v${persistedVersion} to v${latestSupportedVersion} because RPC discovery file ${unreadableFile} is uncertain (${arm} arm), so the absence of a live OpenCode server cannot be proven. ${recovery}`);
  } else {
    log2(formatLiveProcessMigrationRefusal(dbPath, persistedVersion, latestSupportedVersion, discovery.serverPids, piPids));
  }
  return false;
}
var sqlitePragmaConfig = {
  cacheSizeMb: 64,
  mmapSizeMb: 0
};
function setSqlitePragmaConfig(config) {
  sqlitePragmaConfig = config;
}
function applySqliteTuningPragmas(db) {
  db.exec(`PRAGMA cache_size=-${Math.round(sqlitePragmaConfig.cacheSizeMb * 1024)}`);
  db.exec(`PRAGMA mmap_size=${Math.round(sqlitePragmaConfig.mmapSizeMb * 1024 * 1024)}`);
  db.exec("PRAGMA analysis_limit=400");
}
function runSqliteOptimize(db) {
  try {
    db.exec("PRAGMA analysis_limit=400");
    db.exec("PRAGMA optimize");
  } catch {}
}
function finishDatabaseOpen(db, dbPath, explicitDbPath, latestSupportedVersion) {
  if (!enforceSchemaFence(db, dbPath, latestSupportedVersion)) {
    closeQuietly(db);
    return null;
  }
  healWedgedChannel2Claims(db);
  if (!explicitDbPath) {
    const readsOpenCodeStore = harnessOwnsOpenCodeStore2();
    let busyRetryMs = 100;
    const runBackfills = () => withoutSqliteTransformPass2(() => withSqliteBackgroundWriter2(() => {
      if (readsOpenCodeStore) {
        try {
          runToolOwnerBackfill(db);
        } catch (error) {
          log2(`[magic-context] tool-owner backfill failed (continuing with lazy adoption fallback): ${getErrorMessage(error)}`);
        }
      }
      startMessageFtsRowidMapBackfill(db).then(async () => {
        if (!readsOpenCodeStore)
          return;
        const { readRawSessionMessagePage, readRawSessionMessages } = await importPluginModule(() => import("./read-session-chunk-b9mzhqn9.js"));
        const { startMessageTimeBackfill } = await importPluginModule(() => import("./message-time-backfill-hmekd2jj.js"));
        await startMessageTimeBackfill(db, Object.assign(readRawSessionMessages, {
          readPage: readRawSessionMessagePage
        }));
      }).catch((error) => {
        if (isTransientSqliteError2(error)) {
          withoutSqliteTransformPass2(() => {
            const timer = setTimeout(runBackfills, busyRetryMs);
            timer.unref();
          });
          busyRetryMs = Math.min(30000, busyRetryMs * 2);
          return;
        }
        log2(`[magic-context] message-index backfill failed (will resume next startup): ${getErrorMessage(error)}`);
      });
    }));
    if (bootQuietRemainingMs() > 0)
      scheduleAfterBootQuiet(runBackfills);
    else
      runBackfills();
  }
  setDatabase(db);
  loadToolDefinitionMeasurements(db);
  tightenStorageTree(dirname2(dbPath));
  databases.set(dbPath, db);
  pathByDatabase.set(db, dbPath);
  persistenceByDatabase.set(db, true);
  persistenceErrorByDatabase.delete(db);
  if (!explicitDbPath) {
    log2(formatSchemaFenceBootLog(getPersistedSchemaVersion(db), latestSupportedVersion));
  }
  return db;
}
function journalMode(db) {
  try {
    const row = db.prepare("PRAGMA journal_mode").get();
    const value = row === undefined ? undefined : row.journal_mode ?? Object.values(row)[0];
    return typeof value === "string" ? value.toLowerCase() : "unknown";
  } catch {
    return "unknown";
  }
}
function applyJournalMode(db, dbPath) {
  const unsafeFilesystem = dbPath === undefined ? null : detectWalUnsafeFilesystem(dbPath);
  if (unsafeFilesystem === null) {
    configureContextDatabasePragmas2(db);
    return;
  }
  db.exec("PRAGMA synchronous=FULL");
  if (journalMode(db) !== "delete") {
    try {
      db.exec("PRAGMA journal_mode=DELETE");
    } catch (error) {
      log2(`[magic-context] could not switch ${dbPath} to journal_mode=delete: ${getErrorMessage(error)}`);
    }
  }
  const mode = journalMode(db);
  if (mode === "delete") {
    log2(`[magic-context] ${unsafeFilesystem} cannot support SQLite WAL: using journal_mode=delete with synchronous=FULL for ${dbPath}`);
    return;
  }
  log2(`[magic-context] WARNING ${unsafeFilesystem} cannot support SQLite WAL, but ${dbPath} is still in journal_mode=${mode}: durability is not guaranteed until a connection can take the database to itself`);
}
function initializeDatabase(db, busyTimeoutMs = BOOT_SQLITE_BUSY_TIMEOUT_MS, dbPath) {
  db.exec(`PRAGMA busy_timeout=${resolveBootBusyTimeoutMs(busyTimeoutMs)}`);
  db.exec("PRAGMA foreign_keys=ON");
  applyJournalMode(db, dbPath);
  applySqliteTuningPragmas(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      message_id TEXT,
      type TEXT,
      status TEXT DEFAULT 'active',
      byte_size INTEGER,
      tag_number INTEGER,
      harness TEXT NOT NULL DEFAULT 'opencode',
      entry_fingerprint TEXT,
      token_count INTEGER,
      input_token_count INTEGER,
      reasoning_token_count INTEGER,
      UNIQUE(session_id, tag_number)
    );

    CREATE TABLE IF NOT EXISTS pending_ops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      tag_id INTEGER,
      operation TEXT,
      queued_at INTEGER,
      harness TEXT NOT NULL DEFAULT 'opencode'
    );

    CREATE TABLE IF NOT EXISTS source_contents (
      tag_id INTEGER,
      session_id TEXT,
      content TEXT,
      created_at INTEGER, -- epoch ms; Date.now() on source writes, preserved on session clones
      harness TEXT NOT NULL DEFAULT 'opencode',
      PRIMARY KEY(session_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS compartments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      start_message INTEGER NOT NULL,
      end_message INTEGER NOT NULL,
      start_message_id TEXT DEFAULT '',
      end_message_id TEXT DEFAULT '',
      start_block_index INTEGER,
      end_block_index INTEGER,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      p1 TEXT,
      p2 TEXT,
      p3 TEXT,
      p4 TEXT,
      importance INTEGER NOT NULL DEFAULT 50,
      episode_type TEXT,
      p1_embedding BLOB,
      p1_embedding_model_id TEXT,
      legacy INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, -- epoch ms (Date.now())
      harness TEXT NOT NULL DEFAULT 'opencode',
      UNIQUE(session_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS compartment_chunk_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compartment_id INTEGER NOT NULL REFERENCES compartments(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL,
      project_path TEXT NOT NULL,
      harness TEXT NOT NULL DEFAULT 'opencode',
      window_index INTEGER NOT NULL DEFAULT 0,
      start_ordinal INTEGER NOT NULL,
      end_ordinal INTEGER NOT NULL,
      chunk_hash TEXT NOT NULL,
      model_id TEXT NOT NULL,
      dims INTEGER NOT NULL,
      vector BLOB NOT NULL,
      created_at INTEGER NOT NULL, -- epoch ms (Date.now())
      UNIQUE(compartment_id, model_id, window_index)
    );
    CREATE INDEX IF NOT EXISTS idx_cce_session ON compartment_chunk_embeddings(session_id);
    CREATE INDEX IF NOT EXISTS idx_cce_project_model ON compartment_chunk_embeddings(project_path, model_id);

    CREATE TABLE IF NOT EXISTS session_projects (
      session_id TEXT NOT NULL,
      harness TEXT NOT NULL DEFAULT 'opencode',
      project_path TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(session_id, harness)
    );
    CREATE INDEX IF NOT EXISTS idx_session_projects_project
      ON session_projects(project_path);

    CREATE TABLE IF NOT EXISTS compartment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      compartment_id INTEGER,
      kind TEXT NOT NULL,
      at_compartment INTEGER,
      fields_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL, -- epoch ms (Date.now())
      harness TEXT NOT NULL DEFAULT 'opencode'
    );
    CREATE INDEX IF NOT EXISTS idx_compartment_events_session
      ON compartment_events(session_id);

    CREATE TABLE IF NOT EXISTS compartment_state_lease (
      session_id TEXT PRIMARY KEY NOT NULL,
      holder_id TEXT NOT NULL,
      owner_pid INTEGER,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_compartment_state_lease_expires
      ON compartment_state_lease(expires_at);

    CREATE TABLE IF NOT EXISTS compression_depth (
      session_id TEXT NOT NULL,
      message_ordinal INTEGER NOT NULL,
      depth INTEGER NOT NULL DEFAULT 0,
      harness TEXT NOT NULL DEFAULT 'opencode',
      PRIMARY KEY(session_id, message_ordinal)
    );

    CREATE TABLE IF NOT EXISTS session_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL, -- epoch ms (Date.now())
      updated_at INTEGER NOT NULL,
      harness TEXT NOT NULL DEFAULT 'opencode'
    );

    CREATE TABLE IF NOT EXISTS primer_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      harness TEXT NOT NULL DEFAULT 'opencode',
      session_id TEXT NOT NULL,
      question TEXT NOT NULL,
      normalized_question TEXT NOT NULL,
      source_compartment_start INTEGER,
      source_compartment_end INTEGER,
      source_start_message_id TEXT NOT NULL DEFAULT '',
      source_end_message_id TEXT NOT NULL DEFAULT '',
      source_message_time INTEGER NOT NULL,
      question_embedding BLOB,
      question_embedding_model_id TEXT,
      created_at INTEGER NOT NULL, -- epoch ms (Date.now())
      UNIQUE(project_path, harness, session_id, source_start_message_id, source_end_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_primer_candidates_project_time
      ON primer_candidates(project_path, source_message_time);
    CREATE INDEX IF NOT EXISTS idx_primer_candidates_session
      ON primer_candidates(session_id, harness);
    CREATE INDEX IF NOT EXISTS idx_primer_candidates_embedding_model
      ON primer_candidates(project_path, question_embedding_model_id);

    CREATE TABLE IF NOT EXISTS primers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      question TEXT NOT NULL,
      question_embedding BLOB,
      question_embedding_model_id TEXT,
      answer TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
      total_support INTEGER NOT NULL DEFAULT 0,
      last_observed_at INTEGER,
      answer_refreshed_at INTEGER,
      source_candidate_ids TEXT NOT NULL DEFAULT '[]',
      source_candidate_provenance TEXT,
      created_at INTEGER NOT NULL, -- epoch ms (Date.now())
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_primers_project_status_observed
      ON primers(project_path, status, last_observed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_primers_embedding_model
      ON primers(project_path, question_embedding_model_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS primers_fts USING fts5(
      question,
      answer,
      project_path UNINDEXED,
      content='primers',
      content_rowid='id',
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS primers_ai AFTER INSERT ON primers BEGIN
      INSERT INTO primers_fts(rowid, question, answer, project_path)
      VALUES (new.id, new.question, new.answer, new.project_path);
    END;

    CREATE TRIGGER IF NOT EXISTS primers_ad AFTER DELETE ON primers BEGIN
      INSERT INTO primers_fts(primers_fts, rowid, question, answer, project_path)
      VALUES ('delete', old.id, old.question, old.answer, old.project_path);
    END;

    CREATE TRIGGER IF NOT EXISTS primers_au AFTER UPDATE ON primers BEGIN
      INSERT INTO primers_fts(primers_fts, rowid, question, answer, project_path)
      VALUES ('delete', old.id, old.question, old.answer, old.project_path);
      INSERT INTO primers_fts(rowid, question, answer, project_path)
      VALUES (new.id, new.question, new.answer, new.project_path);
    END;

    -- session_notes and smart_notes were merged into the unified notes table
    -- by migration v1 (see features/magic-context/migrations.ts). The old tables
    -- are never recreated; fresh DBs create only notes, upgraded DBs have
    -- their old tables migrated and dropped by the migration runner.

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      normalized_hash TEXT NOT NULL,
      importance INTEGER,
      scope TEXT NOT NULL DEFAULT 'project',
      shareable INTEGER NOT NULL DEFAULT 0,
      source_session_id TEXT,
      source_type TEXT DEFAULT 'historian',
      seen_count INTEGER DEFAULT 1,
      retrieval_count INTEGER DEFAULT 0,
      first_seen_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      last_retrieved_at INTEGER,
      status TEXT DEFAULT 'active',
      expires_at INTEGER,
      verification_status TEXT DEFAULT 'unverified',
      verified_at INTEGER,
      classified_at INTEGER,
      superseded_by_memory_id INTEGER,
      merged_from TEXT,
      metadata_json TEXT,
      mural_cue TEXT,
      mural_cue_hash TEXT,
      mural_cue_at INTEGER,
      mural_cue_rejection_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(project_path, category, normalized_hash)
    );

    CREATE TABLE IF NOT EXISTS memory_embeddings (
      -- FK-cascade audit (v12): memory_embeddings.memory_id -> memories.id
      -- uses ON DELETE CASCADE, so SQLite PRAGMA foreign_keys must be ON on
      -- every connection and v12 cleans historical orphan rows.
      memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      embedding BLOB NOT NULL,
      model_id TEXT NOT NULL,
      PRIMARY KEY(memory_id, model_id)
    );

    CREATE TABLE IF NOT EXISTS embedding_identity_active (
      project_path TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('memory', 'commit', 'chunk')),
      model_id TEXT NOT NULL,
      last_active_at INTEGER NOT NULL,
      PRIMARY KEY(project_path, scope, model_id)
    );

    CREATE TABLE IF NOT EXISTS embedding_registrations (
      project_path TEXT PRIMARY KEY,
      provider_identity TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL DEFAULT '',
      chunk_model_id TEXT NOT NULL DEFAULT '',
      fingerprint TEXT NOT NULL DEFAULT '',
      table_epoch INTEGER NOT NULL DEFAULT 0,
      dims INTEGER NOT NULL DEFAULT 0,
      provenance_json TEXT NOT NULL DEFAULT '{}',
      generation INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS synapse_batch_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      project_path TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT '',
      manifest_json TEXT NOT NULL DEFAULT '{}',
      request_key TEXT NOT NULL DEFAULT '',
      job_id TEXT,
      cursor TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL DEFAULT 0, -- epoch ms (Date.now())
      updated_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(session_id, request_key)
    );
    CREATE INDEX IF NOT EXISTS idx_synapse_batch_ledger_session
      ON synapse_batch_ledger(session_id, updated_at);

    CREATE TABLE IF NOT EXISTS shadow_embedding_registrations (
      project_path TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('memory', 'commit', 'chunk')),
      model_id TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 0,
      fingerprint TEXT NOT NULL DEFAULT '',
      table_epoch INTEGER NOT NULL DEFAULT 0,
      dims INTEGER NOT NULL DEFAULT 0,
      provenance_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(project_path, scope, model_id)
    );

    CREATE TABLE IF NOT EXISTS embedding_measurement_corpus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      project_path TEXT NOT NULL DEFAULT '',
      dedup_key TEXT NOT NULL DEFAULT '',
      cohort_key TEXT NOT NULL DEFAULT '',
      query_text_hash TEXT NOT NULL DEFAULT '',
      primary_result_ids_json TEXT NOT NULL DEFAULT '[]',
      shadow_result_ids_json TEXT NOT NULL DEFAULT '[]',
      primary_latency_ms INTEGER,
      shadow_latency_ms INTEGER,
      primary_failed INTEGER NOT NULL DEFAULT 0,
      shadow_failed INTEGER NOT NULL DEFAULT 0,
      primary_model_id TEXT NOT NULL DEFAULT '',
      shadow_model_id TEXT NOT NULL DEFAULT '',
      primary_fingerprint TEXT NOT NULL DEFAULT '',
      shadow_fingerprint TEXT NOT NULL DEFAULT '',
      primary_epoch INTEGER NOT NULL DEFAULT 0,
      shadow_epoch INTEGER NOT NULL DEFAULT 0,
      corpus_hash TEXT NOT NULL DEFAULT '',
      coverage_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT 0, -- epoch ms (Date.now())
      UNIQUE(dedup_key, cohort_key)
    );
    CREATE INDEX IF NOT EXISTS idx_embedding_measurement_session
      ON embedding_measurement_corpus(session_id, created_at);

    CREATE TABLE IF NOT EXISTS memory_verifications (
      memory_id    INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      file_path    TEXT NOT NULL,
      -- verified_at=0 means "mapped (files known) but not yet content-verified".
      -- map-memories sets mapped_at + verified_at=0; verify sets verified_at=now.
      verified_at  INTEGER NOT NULL,
       mapped_at    INTEGER NOT NULL DEFAULT 0,
       -- Distinguishes mapper-authored independence from a host rejection fallback.
       mapping_origin TEXT NOT NULL DEFAULT 'mapper',
       PRIMARY KEY (memory_id, file_path)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_verifications_memory ON memory_verifications(memory_id);

    CREATE TABLE IF NOT EXISTS memory_mutation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      mutation_type TEXT NOT NULL CHECK (mutation_type IN ('archive', 'delete', 'update', 'superseded')),
      target_memory_id INTEGER NOT NULL,
      superseded_by_id INTEGER,
      category TEXT,
      new_content TEXT,
      queued_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_mutation_log_project
      ON memory_mutation_log(project_path, id);
    CREATE INDEX IF NOT EXISTS idx_memory_mutation_log_visibility
      ON memory_mutation_log(project_path, category, id, target_memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_mutation_log_target
      ON memory_mutation_log(project_path, target_memory_id, id);

    CREATE TABLE IF NOT EXISTS dream_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dream_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      reason TEXT NOT NULL,
      enqueued_at INTEGER NOT NULL,
      started_at INTEGER,
      retry_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_dream_queue_project ON dream_queue(project_path);
CREATE INDEX IF NOT EXISTS idx_dream_queue_pending ON dream_queue(started_at, enqueued_at);

    CREATE TABLE IF NOT EXISTS dream_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER NOT NULL,
      holder_id TEXT NOT NULL,
      tasks_json TEXT NOT NULL,
      tasks_succeeded INTEGER NOT NULL DEFAULT 0,
      tasks_failed INTEGER NOT NULL DEFAULT 0,
      smart_notes_surfaced INTEGER NOT NULL DEFAULT 0,
      smart_notes_pending INTEGER NOT NULL DEFAULT 0,
      memory_changes_json TEXT,
      parent_session_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dream_runs_project ON dream_runs(project_path, finished_at DESC);

    CREATE TABLE IF NOT EXISTS task_schedule_state (
      project_path  TEXT    NOT NULL,
      task          TEXT    NOT NULL,
      last_run_at   INTEGER,
      next_due_at   INTEGER,
      schedule      TEXT,
      last_status   TEXT,
      last_error    TEXT,
      last_checked_commit TEXT,
      last_broad_run_at INTEGER,
      retrospective_watermark_ms INTEGER,
      retry_count   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (project_path, task)
    );
    CREATE INDEX IF NOT EXISTS idx_task_schedule_due ON task_schedule_state(next_due_at);

    CREATE TABLE IF NOT EXISTS retrospective_processed_windows (
      project_path TEXT NOT NULL,
      window_key   TEXT NOT NULL,
      processed_at INTEGER NOT NULL,
      PRIMARY KEY (project_path, window_key)
    );

    CREATE TABLE IF NOT EXISTS project_key_files (
      project_path           TEXT    NOT NULL,
      path                   TEXT    NOT NULL,
      content                TEXT    NOT NULL,
      content_hash           TEXT    NOT NULL,
      local_token_estimate   INTEGER NOT NULL,
      generated_at           INTEGER NOT NULL,
      generated_by_model     TEXT,
      generation_config_hash TEXT    NOT NULL,
      stale_reason           TEXT,
      PRIMARY KEY (project_path, path)
    );
    CREATE INDEX IF NOT EXISTS idx_project_key_files_generated_at ON project_key_files(project_path, generated_at);

    CREATE TABLE IF NOT EXISTS project_key_files_version (
      project_path TEXT    PRIMARY KEY,
      version      INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS schema_migrations_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_state (
      project_path TEXT PRIMARY KEY,
      project_memory_epoch INTEGER NOT NULL DEFAULT 0,
      project_user_profile_version INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS git_sweep_coordinator (
      project_path TEXT PRIMARY KEY,
      lease_holder TEXT,
      lease_expires_at INTEGER,
      last_swept_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_git_sweep_coordinator_lease_expires
      ON git_sweep_coordinator(lease_expires_at);
    CREATE INDEX IF NOT EXISTS idx_git_sweep_coordinator_last_swept
      ON git_sweep_coordinator(last_swept_at);

    CREATE TABLE IF NOT EXISTS m0_mutation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      mutation_type TEXT NOT NULL CHECK (mutation_type IN (
        'compartment_delete', 'compartment_merge', 'recomp_boundary_change', 'compartment_upgrade'
      )),
      target_id INTEGER,
      queued_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_m0_mutation_log_session ON m0_mutation_log(session_id);

    CREATE TABLE IF NOT EXISTS v22_identity_rekey_map (
      old_project_path TEXT PRIMARY KEY,
      new_project_path TEXT NOT NULL,
      rekeyed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      share_categories TEXT NOT NULL DEFAULT '["CONSTRAINTS"]'
    );

    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      project_path TEXT NOT NULL,
      display_name TEXT NOT NULL,
      display_path TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (workspace_id, project_path)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_member_unique ON workspace_members(project_path);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_member_name ON workspace_members(workspace_id, display_name);

    CREATE TABLE IF NOT EXISTS v22_backfill_failures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id INTEGER NOT NULL,
      raw_project_path TEXT NOT NULL,
      error_class TEXT NOT NULL CHECK (error_class IN ('not_git_repo', 'git_missing', 'git_timeout', 'permission_denied', 'unknown')),
      error_message TEXT,
      failed_at INTEGER NOT NULL,
      UNIQUE(table_name, row_id)
    );

    -- (smart_notes: see note above; merged into unified notes table by migration v1)

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      category,
      content='memories',
      content_rowid='id',
      tokenize='porter unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS message_history_fts USING fts5(
      session_id UNINDEXED,
      message_ordinal UNINDEXED,
      message_id UNINDEXED,
      role,
      content,
      tokenize='porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS message_fts_rowid_map (
      session_id TEXT NOT NULL,
      message_ordinal INTEGER NOT NULL,
      fts_rowid INTEGER NOT NULL,
      message_time_ms INTEGER,
      PRIMARY KEY(session_id, message_ordinal)
    );

    CREATE TABLE IF NOT EXISTS message_fts_rowid_map_backfill_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      watermark_rowid INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO message_fts_rowid_map_backfill_state
      (id, watermark_rowid, completed, updated_at)
    VALUES (1, 0, 0, 0);

    CREATE TABLE IF NOT EXISTS message_time_backfill_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      cursor_session_id TEXT NOT NULL DEFAULT '',
      cursor_ordinal INTEGER NOT NULL DEFAULT 0,
      completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO message_time_backfill_state
      (id, cursor_session_id, cursor_ordinal, completed, updated_at)
    VALUES (1, '', 0, 0, 0);

    CREATE TABLE IF NOT EXISTS single_store_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state TEXT NOT NULL CHECK (state IN ('required', 'migrated')),
      migrated_at INTEGER,
      migrated_by TEXT,
      backup_dir TEXT,
      report_json TEXT
    );
    INSERT OR IGNORE INTO single_store_state(id, state) VALUES (1, 'required');

    -- Highest memory id another writer (the Rust module in single-store mode) put
    -- into memories for a project, and how far this host has embedded. Migration v91.
    CREATE TABLE IF NOT EXISTS memory_embedding_watermarks (
      project_path TEXT PRIMARY KEY,
      written_memory_id INTEGER NOT NULL DEFAULT 0,
      embedded_memory_id INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    -- Last-known-good replay slots, their prefix slices, and trailing-blank replay
    -- decisions, in the layout of migration v94.
    ${LKG_SLOTS_DDL}
    ${LKG_SLOT_CHUNKS_DDL}
    ${SESSION_REPLAY_DECISIONS_DDL}

    CREATE TABLE IF NOT EXISTS message_history_index (
      session_id TEXT PRIMARY KEY,
      last_indexed_ordinal INTEGER NOT NULL DEFAULT 0,
      dirty_floor_ordinal INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      harness TEXT NOT NULL DEFAULT 'opencode'
    );

    CREATE TABLE IF NOT EXISTS message_history_source (
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      message_ordinal INTEGER NOT NULL,
      source_version TEXT NOT NULL,
      normalized_content_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      harness TEXT NOT NULL DEFAULT 'opencode',
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(session_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_history_source_session_ordinal
      ON message_history_source(session_id, message_ordinal);

    CREATE TABLE IF NOT EXISTS pending_session_cleanup (
      session_id TEXT PRIMARY KEY,
      harness TEXT NOT NULL DEFAULT 'opencode',
      requested_at INTEGER NOT NULL,
      last_attempt_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS message_history_orphan_sweep (
      harness TEXT PRIMARY KEY,
      cursor_session_id TEXT NOT NULL DEFAULT '',
      last_swept_at INTEGER
    );

    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES ('delete', old.id, old.content, old.category);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES ('delete', old.id, old.content, old.category);
      INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
    END;

    CREATE TABLE IF NOT EXISTS session_meta (
      session_id TEXT PRIMARY KEY,
      harness TEXT NOT NULL DEFAULT 'opencode',
      last_response_time INTEGER,
      cache_ttl TEXT,
      counter INTEGER DEFAULT 0,
      tags_version INTEGER NOT NULL DEFAULT 0,
      last_nudge_tokens INTEGER DEFAULT 0,
      last_nudge_band TEXT DEFAULT '',
      last_nudge_undropped INTEGER DEFAULT 0,
      last_nudge_level TEXT DEFAULT '',
      channel2_nudge_state TEXT DEFAULT '',
      channel2_nudge_claimed_at INTEGER DEFAULT 0,
      channel2_nudge_claim_token TEXT DEFAULT '',
      last_emergency_input_sample INTEGER DEFAULT 0,
      last_transform_error TEXT DEFAULT '',
      nudge_anchor_message_id TEXT DEFAULT '',
      nudge_anchor_text TEXT DEFAULT '',
      sticky_turn_reminder_text TEXT DEFAULT '',
      sticky_turn_reminder_message_id TEXT DEFAULT '',
      note_nudge_trigger_pending INTEGER DEFAULT 0,
      note_nudge_trigger_message_id TEXT DEFAULT '',
      note_nudge_sticky_text TEXT DEFAULT '',
      note_nudge_sticky_message_id TEXT DEFAULT '',
      note_nudge_anchors TEXT NOT NULL DEFAULT '[]',
      auto_search_hint_decisions TEXT NOT NULL DEFAULT '[]',
      last_todo_state TEXT DEFAULT '',
      todo_permission_denied INTEGER NOT NULL DEFAULT 2,
      todo_synthetic_call_id TEXT DEFAULT '',
      todo_synthetic_anchor_message_id TEXT DEFAULT '',
      todo_synthetic_state_json TEXT DEFAULT '',
      is_subagent INTEGER DEFAULT 0,
      last_context_percentage REAL DEFAULT 0,
      last_input_tokens INTEGER DEFAULT 0,
      detected_context_limit_provenance TEXT NOT NULL DEFAULT 'unknown',
      observed_safe_input_tokens INTEGER NOT NULL DEFAULT 0,
      cache_alert_sent INTEGER NOT NULL DEFAULT 0,
      times_execute_threshold_reached INTEGER DEFAULT 0,
      compartment_in_progress INTEGER DEFAULT 0,
      historian_failure_count INTEGER DEFAULT 0,
      historian_last_error TEXT DEFAULT NULL,
      historian_last_failure_at INTEGER DEFAULT NULL,
      system_prompt_hash TEXT DEFAULT '',
      memory_block_cache TEXT DEFAULT '',
      memory_block_count INTEGER DEFAULT 0,
      memory_block_ids TEXT DEFAULT '',
      -- pending_compaction_marker_state: intentionally NULLABLE without a
      -- default. Absence of a deferred marker is SQL NULL; presence is a
      -- valid JSON blob written via setPendingCompactionMarkerState.
      -- Excluded from the healAllNullColumns fallback list. Readers filter
      -- IS NOT NULL AND != empty-string defensively. Plan v6 section 3.
      pending_compaction_marker_state TEXT,
      -- Target OpenCode message id used to inject the current compaction marker.
      -- Nullable for legacy persisted markers; repaired on the next marker move.
      compaction_marker_target_end_message_id TEXT,
      -- pending_pi_compaction_marker_state: intentionally NULLABLE without a
      -- default. Absence of a deferred Pi-native marker is SQL NULL; presence
      -- is a valid JSON blob written via setPendingPiCompactionMarkerState.
      -- Excluded from the healAllNullColumns fallback list.
      pending_pi_compaction_marker_state TEXT,
      new_work_tokens INTEGER NOT NULL DEFAULT 0,
      total_input_tokens INTEGER NOT NULL DEFAULT 0,
      -- Retired columns remain in place so existing databases keep the same schema:
      -- deferred_execute_state was used by the removed turn-boundary execute hold.
      deferred_execute_state TEXT,
      cached_m0_bytes BLOB,
      cached_m0_project_memory_epoch INTEGER,
      cached_m0_workspace_fingerprint TEXT,
      cached_m0_project_user_profile_version INTEGER,
      cached_m0_max_compartment_seq INTEGER,
      cached_m0_max_memory_id INTEGER,
      cached_m0_max_mutation_id INTEGER,
      cached_m0_max_memory_mutation_id INTEGER,
      cached_m0_project_docs_hash TEXT,
      cached_m1_bytes BLOB,
      last_observed_model_key TEXT,
      last_usage_context_limit INTEGER NOT NULL DEFAULT 0,
      prior_boundary_ordinal INTEGER NOT NULL DEFAULT 1,
      protected_tokens_effective INTEGER,
      protected_tokens_pre_snapshot TEXT,
      protected_tail_policy_version INTEGER NOT NULL DEFAULT 0,
      protected_tail_drain_window_started_at INTEGER NOT NULL DEFAULT 0,
      protected_tail_drain_tokens INTEGER NOT NULL DEFAULT 0,
      recovery_no_eligible_head_count INTEGER NOT NULL DEFAULT 0,
      force_emergency_bypass_window_start INTEGER NOT NULL DEFAULT 0,
      force_emergency_bypass_used INTEGER NOT NULL DEFAULT 0,
      emergency_drain_active INTEGER NOT NULL DEFAULT 0,
      historian_drain_failure_at INTEGER NOT NULL DEFAULT 0,
      wrapup_in_progress_state TEXT,
      compaction_mode_record TEXT,
      cached_m0_materialized_at INTEGER,
      cached_m0_session_facts_version INTEGER,
      cached_m0_upgrade_state TEXT,
      cached_m0_system_hash TEXT,
      cached_m0_tool_set_hash TEXT,
      cached_m0_model_key TEXT,
       cached_m0_project_identity TEXT,
       cached_m0_last_baseline_end_message_id TEXT,
       thinking_binding_recovery_target TEXT NOT NULL DEFAULT '',
       upgrade_reminded_at INTEGER,
       pi_stable_id_scheme INTEGER
    );

    CREATE TABLE IF NOT EXISTS tool_owner_backfill_state (
      session_id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'skipped')),
      started_at INTEGER,
      lease_expires_at INTEGER,
      completed_at INTEGER,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tool_owner_backfill_state_status
      ON tool_owner_backfill_state(status);

    CREATE TABLE IF NOT EXISTS subagent_invocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      harness TEXT NOT NULL,
      subagent TEXT NOT NULL,
      task TEXT,
      provider_id TEXT,
      model_id TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      parent_invocation_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sai_session_started
      ON subagent_invocations(session_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sai_subagent
      ON subagent_invocations(subagent, started_at DESC);

    CREATE TABLE IF NOT EXISTS historian_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      harness TEXT NOT NULL DEFAULT 'opencode',
      subagent_invocation_id INTEGER,
      run_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      failure_reason TEXT,
      chunk_start_ordinal INTEGER,
      chunk_end_ordinal INTEGER,
      unprocessed_from INTEGER,
      compartments_produced INTEGER NOT NULL DEFAULT 0,
      compartment_id_min INTEGER,
      compartment_id_max INTEGER,
      facts_emitted INTEGER NOT NULL DEFAULT 0,
      facts_by_category_json TEXT,
      events_emitted INTEGER NOT NULL DEFAULT 0,
      importance_min INTEGER,
      importance_max INTEGER,
      importance_avg REAL,
      discarded_last INTEGER NOT NULL DEFAULT 0,
      legacy INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL -- epoch ms (Date.now())
    );
    CREATE INDEX IF NOT EXISTS idx_historian_runs_session
      ON historian_runs(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_historian_runs_status
      ON historian_runs(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS transform_decisions (
      session_id         TEXT    NOT NULL,
      harness            TEXT    NOT NULL DEFAULT 'opencode',
      message_id         TEXT    NOT NULL,
      ts_ms              INTEGER NOT NULL,
      decision           TEXT    NOT NULL,
      materialized       INTEGER NOT NULL DEFAULT 0,
      materialize_reason TEXT,
      system_hash_prev      TEXT,
      system_hash_new       TEXT,
      m0_tool_set_hash_prev TEXT,
      m0_tool_set_hash_new  TEXT,
      m0_model_key_prev     TEXT,
      m0_model_key_new      TEXT,
      emergency          INTEGER NOT NULL DEFAULT 0,
      dropped_tokens     INTEGER NOT NULL DEFAULT 0,
      dropped_count      INTEGER NOT NULL DEFAULT 0,
      input_tokens       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (session_id, harness, message_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tags_session_message_id ON tags(session_id, message_id);

    -- Clone/import paths can write tags before session bootstrap. Keep trigger-created
    -- metadata rows aligned with the explicit defaults in ensureSessionMetaRow.
    CREATE TRIGGER IF NOT EXISTS tags_version_ai AFTER INSERT ON tags BEGIN
      INSERT INTO session_meta(
        session_id, harness, last_response_time, cache_ttl, counter, tags_version,
        last_nudge_tokens, last_nudge_band, last_transform_error, is_subagent,
        last_context_percentage, last_input_tokens, observed_safe_input_tokens,
        cache_alert_sent, times_execute_threshold_reached, compartment_in_progress,
        system_prompt_hash, cleared_reasoning_through_tag
      ) VALUES(NEW.session_id, NEW.harness, 0, '5m', 0, 1, 0, '', '', 0, 0, 0, 0, 0, 0, 0, '', 0)
      ON CONFLICT(session_id) DO UPDATE SET tags_version = tags_version + 1;
    END;
    CREATE TRIGGER IF NOT EXISTS tags_version_ad AFTER DELETE ON tags BEGIN
      INSERT INTO session_meta(
        session_id, harness, last_response_time, cache_ttl, counter, tags_version,
        last_nudge_tokens, last_nudge_band, last_transform_error, is_subagent,
        last_context_percentage, last_input_tokens, observed_safe_input_tokens,
        cache_alert_sent, times_execute_threshold_reached, compartment_in_progress,
        system_prompt_hash, cleared_reasoning_through_tag
      ) VALUES(OLD.session_id, OLD.harness, 0, '5m', 0, 1, 0, '', '', 0, 0, 0, 0, 0, 0, 0, '', 0)
      ON CONFLICT(session_id) DO UPDATE SET tags_version = tags_version + 1;
    END;
    CREATE TRIGGER IF NOT EXISTS tags_version_au
    AFTER UPDATE OF session_id, message_id, tag_number, type, tool_owner_message_id, status ON tags BEGIN
      INSERT INTO session_meta(
        session_id, harness, last_response_time, cache_ttl, counter, tags_version,
        last_nudge_tokens, last_nudge_band, last_transform_error, is_subagent,
        last_context_percentage, last_input_tokens, observed_safe_input_tokens,
        cache_alert_sent, times_execute_threshold_reached, compartment_in_progress,
        system_prompt_hash, cleared_reasoning_through_tag
      ) VALUES(OLD.session_id, OLD.harness, 0, '5m', 0, 1, 0, '', '', 0, 0, 0, 0, 0, 0, 0, '', 0)
      ON CONFLICT(session_id) DO UPDATE SET tags_version = tags_version + 1;
      INSERT INTO session_meta(
        session_id, harness, last_response_time, cache_ttl, counter, tags_version,
        last_nudge_tokens, last_nudge_band, last_transform_error, is_subagent,
        last_context_percentage, last_input_tokens, observed_safe_input_tokens,
        cache_alert_sent, times_execute_threshold_reached, compartment_in_progress,
        system_prompt_hash, cleared_reasoning_through_tag
      )
      SELECT NEW.session_id, NEW.harness, 0, '5m', 0, 1, 0, '', '', 0, 0, 0, 0, 0, 0, 0, '', 0
      WHERE NEW.session_id != OLD.session_id
      ON CONFLICT(session_id) DO UPDATE SET tags_version = tags_version + 1;
    END;
    CREATE INDEX IF NOT EXISTS idx_pending_ops_session_tag_id ON pending_ops(session_id, tag_id);
    
    CREATE TABLE IF NOT EXISTS recomp_compartments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      start_message INTEGER NOT NULL,
      end_message INTEGER NOT NULL,
      start_message_id TEXT DEFAULT '',
      end_message_id TEXT DEFAULT '',
      start_block_index INTEGER,
      end_block_index INTEGER,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      p1 TEXT,
      p2 TEXT,
      p3 TEXT,
      p4 TEXT,
      importance INTEGER NOT NULL DEFAULT 50,
      episode_type TEXT,
      pass_number INTEGER NOT NULL,
      created_at INTEGER NOT NULL, -- epoch ms (Date.now())
      harness TEXT NOT NULL DEFAULT 'opencode',
      UNIQUE(session_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS recomp_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      pass_number INTEGER NOT NULL,
      created_at INTEGER NOT NULL, -- epoch ms (Date.now())
      harness TEXT NOT NULL DEFAULT 'opencode'
    );

    CREATE INDEX IF NOT EXISTS idx_session_facts_session ON session_facts(session_id);
    CREATE INDEX IF NOT EXISTS idx_recomp_compartments_session ON recomp_compartments(session_id);
    CREATE INDEX IF NOT EXISTS idx_recomp_facts_session ON recomp_facts(session_id);
    CREATE INDEX IF NOT EXISTS idx_memories_project_status_category ON memories(project_path, status, category);
    CREATE INDEX IF NOT EXISTS idx_memories_project_status_expires ON memories(project_path, status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_memories_project_category_hash ON memories(project_path, category, normalized_hash);
    CREATE INDEX IF NOT EXISTS idx_message_history_index_updated_at ON message_history_index(updated_at);
  `);
  installCompartmentHistoryVersions(db);
  ensureColumn(db, "message_fts_rowid_map", "message_time_ms", "INTEGER");
  db.exec(`
      CREATE INDEX IF NOT EXISTS idx_message_fts_rowid_map_session_time
        ON message_fts_rowid_map(session_id, message_time_ms);
    `);
  ensureColumn(db, "primer_candidates", "harness", "TEXT NOT NULL DEFAULT 'opencode'");
  ensureColumn(db, "primer_candidates", "source_start_message_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "primer_candidates", "source_end_message_id", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "primer_candidates", "question_embedding", "BLOB");
  ensureColumn(db, "primer_candidates", "question_embedding_model_id", "TEXT");
  ensureColumn(db, "primers", "question_embedding_model_id", "TEXT");
  ensureColumn(db, "primers", "source_candidate_provenance", "TEXT");
  const hasUserMemoriesTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user_memories'").get();
  if (hasUserMemoriesTable) {
    ensureColumn(db, "user_memories", "source_candidate_provenance", "TEXT");
  }
  db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_primer_candidates_occurrence
        ON primer_candidates(project_path, harness, session_id, source_start_message_id, source_end_message_id);
      CREATE INDEX IF NOT EXISTS idx_primer_candidates_project_time
        ON primer_candidates(project_path, source_message_time);
      CREATE INDEX IF NOT EXISTS idx_primer_candidates_session
        ON primer_candidates(session_id, harness);
      CREATE INDEX IF NOT EXISTS idx_primer_candidates_embedding_model
        ON primer_candidates(project_path, question_embedding_model_id);
      CREATE INDEX IF NOT EXISTS idx_primers_project_status_observed
        ON primers(project_path, status, last_observed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_primers_embedding_model
        ON primers(project_path, question_embedding_model_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS primers_fts USING fts5(
        question,
        answer,
        project_path UNINDEXED,
        content='primers',
        content_rowid='id',
        tokenize='porter unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS primers_ai AFTER INSERT ON primers BEGIN
        INSERT INTO primers_fts(rowid, question, answer, project_path)
        VALUES (new.id, new.question, new.answer, new.project_path);
      END;
      CREATE TRIGGER IF NOT EXISTS primers_ad AFTER DELETE ON primers BEGIN
        INSERT INTO primers_fts(primers_fts, rowid, question, answer, project_path)
        VALUES ('delete', old.id, old.question, old.answer, old.project_path);
      END;
      CREATE TRIGGER IF NOT EXISTS primers_au AFTER UPDATE ON primers BEGIN
        INSERT INTO primers_fts(primers_fts, rowid, question, answer, project_path)
        VALUES ('delete', old.id, old.question, old.answer, old.project_path);
        INSERT INTO primers_fts(rowid, question, answer, project_path)
        VALUES (new.id, new.question, new.answer, new.project_path);
      END;
    `);
  ensureColumn(db, "session_meta", "last_nudge_band", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "last_nudge_undropped", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "last_nudge_level", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "channel2_nudge_state", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "channel2_nudge_claimed_at", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "channel2_nudge_claim_token", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "last_emergency_input_sample", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "last_transform_error", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "nudge_anchor_message_id", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "nudge_anchor_text", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "sticky_turn_reminder_text", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "sticky_turn_reminder_message_id", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "note_nudge_trigger_pending", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "note_nudge_trigger_message_id", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "note_nudge_sticky_text", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "note_nudge_sticky_message_id", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "note_nudge_anchors", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "session_meta", "auto_search_hint_decisions", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(db, "session_meta", "last_todo_state", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "todo_permission_denied", "INTEGER NOT NULL DEFAULT 2");
  ensureColumn(db, "session_meta", "todo_synthetic_call_id", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "todo_synthetic_anchor_message_id", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "todo_synthetic_state_json", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "note_last_read_at", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "times_execute_threshold_reached", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "observed_safe_input_tokens", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "cache_alert_sent", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "compartment_in_progress", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "historian_failure_count", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "historian_last_error", "TEXT DEFAULT NULL");
  ensureColumn(db, "session_meta", "historian_last_failure_at", "INTEGER DEFAULT NULL");
  ensureColumn(db, "session_meta", "system_prompt_hash", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "cleared_reasoning_through_tag", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "tags_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "tool_reclaim_watermark", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "stripped_placeholder_ids", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "stale_reduce_stripped_ids", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "processed_image_stripped_ids", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "merged_reasoning_stripped_ids", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "thinking_binding_recovery_target", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "trailing_blank_decisions", "TEXT DEFAULT ''");
  ensureColumn(db, "compartment_state_lease", "owner_pid", "INTEGER");
  ensureColumn(db, "compartments", "start_message_id", "TEXT DEFAULT ''");
  ensureColumn(db, "compartments", "end_message_id", "TEXT DEFAULT ''");
  ensureColumn(db, "memory_embeddings", "model_id", "TEXT");
  ensureColumn(db, "session_meta", "memory_block_cache", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "memory_block_count", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "pi_stable_id_scheme", "INTEGER");
  ensureColumn(db, "session_meta", "memory_block_ids", "TEXT DEFAULT ''");
  ensureColumn(db, "dream_queue", "retry_count", "INTEGER DEFAULT 0");
  ensureColumn(db, "tags", "reasoning_byte_size", "INTEGER DEFAULT 0");
  ensureColumn(db, "tags", "drop_mode", "TEXT DEFAULT 'full'");
  ensureColumn(db, "tags", "tool_name", "TEXT");
  ensureColumn(db, "tags", "input_byte_size", "INTEGER DEFAULT 0");
  ensureColumn(db, "tags", "caveman_depth", "INTEGER DEFAULT 0");
  ensureColumn(db, "tags", "tool_owner_message_id", "TEXT DEFAULT NULL");
  ensureColumn(db, "tags", "entry_fingerprint", "TEXT");
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tags_pi_adopt
            ON tags(session_id, entry_fingerprint)
            WHERE type='message' AND entry_fingerprint IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_tags_pi_fallback_tool_owner
            ON tags(session_id, tool_owner_message_id)
            WHERE type='tool'`);
  ensureColumn(db, "tags", "token_count", "INTEGER");
  ensureColumn(db, "tags", "input_token_count", "INTEGER");
  ensureColumn(db, "tags", "reasoning_token_count", "INTEGER");
  ensureColumn(db, "task_schedule_state", "schedule", "TEXT");
  ensureColumn(db, "task_schedule_state", "last_checked_commit", "TEXT");
  ensureColumn(db, "task_schedule_state", "last_broad_run_at", "INTEGER");
  ensureColumn(db, "task_schedule_state", "retrospective_watermark_ms", "INTEGER");
  ensureColumn(db, "dream_runs", "parent_session_id", "TEXT");
  ensureColumn(db, "session_meta", "system_prompt_tokens", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "compaction_marker_state", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "compaction_marker_target_end_message_id", "TEXT");
  ensureColumn(db, "session_meta", "key_files", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "conversation_tokens", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "tool_call_tokens", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "recomp_partial_range_start", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "recomp_partial_range_end", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "detected_context_limit", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "detected_context_limit_model_key", "TEXT");
  ensureColumn(db, "session_meta", "detected_context_limit_provenance", "TEXT NOT NULL DEFAULT 'unknown'");
  ensureColumn(db, "session_meta", "needs_emergency_recovery", "INTEGER DEFAULT 0");
  ensureColumn(db, "session_meta", "emergency_recovery_origin", "TEXT DEFAULT ''");
  ensureColumn(db, "session_meta", "pending_compaction_marker_state", "TEXT");
  ensureColumn(db, "session_meta", "pending_pi_compaction_marker_state", "TEXT");
  ensureColumn(db, "session_meta", "new_work_tokens", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "total_input_tokens", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "deferred_execute_state", "TEXT");
  ensureColumn(db, "compartments", "p1", "TEXT");
  ensureColumn(db, "compartments", "p2", "TEXT");
  ensureColumn(db, "compartments", "p3", "TEXT");
  ensureColumn(db, "compartments", "p4", "TEXT");
  ensureColumn(db, "compartments", "importance", "INTEGER NOT NULL DEFAULT 50");
  ensureColumn(db, "compartments", "episode_type", "TEXT");
  ensureColumn(db, "compartments", "p1_embedding", "BLOB");
  ensureColumn(db, "compartments", "p1_embedding_model_id", "TEXT");
  ensureColumn(db, "compartments", "legacy", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "recomp_compartments", "p1", "TEXT");
  ensureColumn(db, "recomp_compartments", "p2", "TEXT");
  ensureColumn(db, "recomp_compartments", "p3", "TEXT");
  ensureColumn(db, "recomp_compartments", "p4", "TEXT");
  ensureColumn(db, "recomp_compartments", "importance", "INTEGER NOT NULL DEFAULT 50");
  ensureColumn(db, "recomp_compartments", "episode_type", "TEXT");
  ensureColumn(db, "memories", "importance", "INTEGER");
  ensureColumn(db, "memories", "classified_at", "INTEGER");
  ensureColumn(db, "memories", "mural_cue", "TEXT");
  ensureColumn(db, "memories", "mural_cue_hash", "TEXT");
  ensureColumn(db, "memories", "mural_cue_at", "INTEGER");
  ensureColumn(db, "memory_verifications", "mapped_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "cached_m0_bytes", "BLOB");
  ensureColumn(db, "session_meta", "cached_m0_project_memory_epoch", "INTEGER");
  ensureColumn(db, "session_meta", "cached_m0_workspace_fingerprint", "TEXT");
  ensureColumn(db, "session_meta", "cached_m0_project_user_profile_version", "INTEGER");
  ensureColumn(db, "session_meta", "cached_m0_max_compartment_seq", "INTEGER");
  ensureColumn(db, "session_meta", "cached_m0_max_memory_id", "INTEGER");
  ensureColumn(db, "session_meta", "cached_m0_max_mutation_id", "INTEGER");
  ensureColumn(db, "session_meta", "cached_m0_max_memory_mutation_id", "INTEGER");
  ensureColumn(db, "session_meta", "cached_m0_project_docs_hash", "TEXT");
  ensureColumn(db, "session_meta", "cached_m1_bytes", "BLOB");
  ensureColumn(db, "session_meta", "last_observed_model_key", "TEXT");
  ensureColumn(db, "session_meta", "last_usage_context_limit", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "prior_boundary_ordinal", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "session_meta", "protected_tokens_effective", "INTEGER");
  ensureColumn(db, "session_meta", "protected_tokens_pre_snapshot", "TEXT");
  ensureColumn(db, "session_meta", "protected_tail_policy_version", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "protected_tail_drain_window_started_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "protected_tail_drain_tokens", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "recovery_no_eligible_head_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "force_emergency_bypass_window_start", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "force_emergency_bypass_used", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "emergency_drain_active", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "historian_drain_failure_at", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "wrapup_in_progress_state", "TEXT");
  ensureColumn(db, "session_meta", "compaction_mode_record", "TEXT");
  ensureColumn(db, "session_meta", "cached_m0_materialized_at", "INTEGER");
  ensureColumn(db, "session_meta", "cached_m0_session_facts_version", "INTEGER");
  ensureColumn(db, "session_meta", "cached_m0_upgrade_state", "TEXT");
  ensureColumn(db, "session_meta", "cached_m0_system_hash", "TEXT");
  ensureColumn(db, "session_meta", "cached_m0_tool_set_hash", "TEXT");
  ensureColumn(db, "session_meta", "cached_m0_model_key", "TEXT");
  ensureColumn(db, "session_meta", "cached_m0_project_identity", "TEXT");
  ensureColumn(db, "session_meta", "cached_m0_last_baseline_end_message_id", "TEXT");
  ensureColumn(db, "session_meta", "upgrade_reminded_at", "INTEGER");
  ensureColumn(db, "session_meta", "upgrade_reminder_last_sent_at", "INTEGER");
  ensureColumn(db, "session_meta", "upgrade_reminder_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "session_meta", "cached_m0_mural_data_url", "TEXT");
  ensureColumn(db, "session_meta", "cached_m0_mural_hash", "TEXT");
  ensureColumn(db, "session_meta", "coordinate_generation", "TEXT");
  ensureColumn(db, "session_meta", "coordinate_rebase_notice", "TEXT");
  ensureColumn(db, "compartments", "rebase_status", "TEXT NOT NULL DEFAULT 'ok'");
  ensureColumn(db, "recomp_compartments", "rebase_status", "TEXT NOT NULL DEFAULT 'ok'");
  db.exec(`
      CREATE TABLE IF NOT EXISTS project_state (
        project_path TEXT PRIMARY KEY,
        project_memory_epoch INTEGER NOT NULL DEFAULT 0,
        project_user_profile_version INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS session_projects (
        session_id TEXT NOT NULL,
        harness TEXT NOT NULL DEFAULT 'opencode',
        project_path TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, harness)
      );
      CREATE INDEX IF NOT EXISTS idx_session_projects_project
        ON session_projects(project_path);
      CREATE TABLE IF NOT EXISTS m0_mutation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        mutation_type TEXT NOT NULL CHECK (mutation_type IN (
          'compartment_delete', 'compartment_merge', 'recomp_boundary_change', 'compartment_upgrade'
        )),
        target_id INTEGER,
        queued_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_m0_mutation_log_session ON m0_mutation_log(session_id);
      CREATE TABLE IF NOT EXISTS memory_mutation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_path TEXT NOT NULL,
        mutation_type TEXT NOT NULL CHECK (mutation_type IN ('archive', 'delete', 'update', 'superseded')),
        target_memory_id INTEGER NOT NULL,
        superseded_by_id INTEGER,
        category TEXT,
        new_content TEXT,
        queued_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_mutation_log_project
        ON memory_mutation_log(project_path, id);
       CREATE TABLE IF NOT EXISTS v22_identity_rekey_map (
         old_project_path TEXT PRIMARY KEY,
         new_project_path TEXT NOT NULL,
         rekeyed_at INTEGER NOT NULL
       );
       CREATE TABLE IF NOT EXISTS identity_merge_log (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         from_identity TEXT NOT NULL,
         to_identity TEXT NOT NULL,
         table_name TEXT NOT NULL,
         row_id TEXT NOT NULL,
         action TEXT NOT NULL,
         target_row_id TEXT,
         merged_at INTEGER NOT NULL
       );
       CREATE INDEX IF NOT EXISTS idx_identity_merge_log_identities
         ON identity_merge_log(from_identity, to_identity, merged_at);
       CREATE INDEX IF NOT EXISTS idx_identity_merge_log_table_row
         ON identity_merge_log(table_name, row_id);
      CREATE TABLE IF NOT EXISTS workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        share_categories TEXT NOT NULL DEFAULT '["CONSTRAINTS"]'
      );
      CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        project_path TEXT NOT NULL,
        display_name TEXT NOT NULL,
        display_path TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, project_path)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_member_unique ON workspace_members(project_path);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_member_name ON workspace_members(workspace_id, display_name);
      CREATE TABLE IF NOT EXISTS v22_backfill_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        row_id INTEGER NOT NULL,
        raw_project_path TEXT NOT NULL,
        error_class TEXT NOT NULL CHECK (error_class IN ('not_git_repo', 'git_missing', 'git_timeout', 'permission_denied', 'unknown')),
        error_message TEXT,
        failed_at INTEGER NOT NULL,
        UNIQUE(table_name, row_id)
      );
      CREATE TABLE IF NOT EXISTS transform_decisions (
        session_id         TEXT    NOT NULL,
        harness            TEXT    NOT NULL DEFAULT 'opencode',
        message_id         TEXT    NOT NULL,
        ts_ms              INTEGER NOT NULL,
        decision           TEXT    NOT NULL,
        materialized       INTEGER NOT NULL DEFAULT 0,
        materialize_reason TEXT,
      system_hash_prev      TEXT,
      system_hash_new       TEXT,
      m0_tool_set_hash_prev TEXT,
      m0_tool_set_hash_new  TEXT,
      m0_model_key_prev     TEXT,
      m0_model_key_new      TEXT,
        emergency          INTEGER NOT NULL DEFAULT 0,
        dropped_tokens     INTEGER NOT NULL DEFAULT 0,
        dropped_count      INTEGER NOT NULL DEFAULT 0,
        input_tokens       INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, harness, message_id)
      );
    `);
  ensureColumn(db, "transform_decisions", "system_hash_prev", "TEXT");
  ensureColumn(db, "transform_decisions", "system_hash_new", "TEXT");
  ensureColumn(db, "transform_decisions", "m0_model_key_prev", "TEXT");
  ensureColumn(db, "transform_decisions", "m0_model_key_new", "TEXT");
  ensureColumn(db, "tags", "harness", "TEXT NOT NULL DEFAULT 'opencode'");
  ensureColumn(db, "message_history_index", "dirty_floor_ordinal", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "pending_ops", "harness", "TEXT NOT NULL DEFAULT 'opencode'");
  ensureColumn(db, "source_contents", "harness", "TEXT NOT NULL DEFAULT 'opencode'");
  ensureColumn(db, "compartments", "harness", "TEXT NOT NULL DEFAULT 'opencode'");
  ensureColumn(db, "compression_depth", "harness", "TEXT NOT NULL DEFAULT 'opencode'");
  ensureColumn(db, "session_facts", "harness", "TEXT NOT NULL DEFAULT 'opencode'");
  ensureColumn(db, "session_meta", "harness", "TEXT NOT NULL DEFAULT 'opencode'");
  ensureColumn(db, "recomp_compartments", "harness", "TEXT NOT NULL DEFAULT 'opencode'");
  ensureColumn(db, "recomp_facts", "harness", "TEXT NOT NULL DEFAULT 'opencode'");
  ensureColumn(db, "message_history_index", "harness", "TEXT NOT NULL DEFAULT 'opencode'");
  db.exec(`
      CREATE INDEX IF NOT EXISTS idx_message_history_index_orphan_sweep
        ON message_history_index(harness, session_id, updated_at);
    `);
  ensureColumn(db, "workspaces", "share_categories", `TEXT NOT NULL DEFAULT '["CONSTRAINTS"]'`);
  const version = getPersistedSchemaVersion(db);
  if (version === 0 || version >= 95)
    installV95PerfSchema(db, false, version === 0);
  installTagIdentityRevisionTrigger(db);
}
var CHANNEL2_CLAIM_TTL_MS = 10 * 60000;
var channel2HealStatements = new WeakMap;
function healWedgedChannel2Claims(db) {
  try {
    const staleBefore = Date.now() - CHANNEL2_CLAIM_TTL_MS;
    let statements = channel2HealStatements.get(db);
    if (!statements) {
      const predicate = "channel2_nudge_state = 'claimed' AND (channel2_nudge_claimed_at IS NULL OR channel2_nudge_claimed_at = 0 OR channel2_nudge_claimed_at <= ?)";
      statements = {
        stale: db.prepare(`SELECT 1 FROM session_meta WHERE ${predicate} LIMIT 1`),
        heal: db.prepare(`UPDATE session_meta SET channel2_nudge_state = '', channel2_nudge_claimed_at = 0, channel2_nudge_claim_token = '' WHERE ${predicate}`)
      };
      channel2HealStatements.set(db, statements);
    }
    if (statements.stale.get(staleBefore))
      statements.heal.run(staleBefore);
  } catch {}
}
function openDatabase(dbPathOrOptions) {
  const options = typeof dbPathOrOptions === "string" ? { dbPath: dbPathOrOptions } : dbPathOrOptions;
  const explicitDbPath = options?.dbPath !== undefined;
  const { dbDir, dbPath } = resolveDatabasePath(options?.dbPath);
  const latestSupportedVersion = getRuntimeLatestSupportedVersion(options);
  const busyTimeoutMs = resolveBootBusyTimeoutMs(options?.busyTimeoutMs);
  lastSchemaFenceRejection = null;
  lastMigrationOnOpenRefusal = null;
  const existing = databases.get(dbPath);
  if (!existing && pendingAsyncOpens.has(dbPath)) {
    log2(`[magic-context] storage not ready: ${dbPath} is still being opened or migrated; refusing a second synchronous open`);
    return null;
  }
  if (existing) {
    if (!enforceSchemaFence(existing, dbPath, latestSupportedVersion)) {
      return null;
    }
    if (!persistenceByDatabase.has(existing)) {
      persistenceByDatabase.set(existing, true);
    }
    healWedgedChannel2Claims(existing);
    return existing;
  }
  let db;
  try {
    if (!explicitDbPath) {
      migrateLegacyStorageIfNeeded(dbPath, dbDir);
    }
    ensureSecureStorageDir(dbDir);
    tightenStorageTree(dbDir);
    if (!existsSync2(dbPath) && shouldEnforcePrivateStoragePermissions()) {
      try {
        writeStorageFileSync(dbPath, new Uint8Array, { flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST")
          throw error;
      }
    }
    db = new Database2(dbPath);
    installBootBusyTimeout(db, dbPath, busyTimeoutMs, options?.onBootBusyTimeout);
    if (!enforceSchemaFence(db, dbPath, latestSupportedVersion)) {
      closeQuietly(db);
      return null;
    }
    if (options?.allowMigrations === false && hasPendingMigrations(db)) {
      log2(`[magic-context] storage not ready: pending migrations at ${dbPath}; host callers must await the async opener`);
      closeQuietly(db);
      return null;
    }
    if (!enforceMigrationOnOpenGuard(db, dbPath, dbDir, latestSupportedVersion)) {
      closeQuietly(db);
      return null;
    }
    initializeDatabase(db, busyTimeoutMs, dbPath);
    if (options?.allowMigrations === false) {
      if (hasPendingMigrations(db)) {
        closeQuietly(db);
        return null;
      }
    } else
      runMigrations(db);
    ensureContextStoreUuid(db);
    installTagIdentityRevisionTrigger(db);
    return finishDatabaseOpen(db, dbPath, explicitDbPath, latestSupportedVersion);
  } catch (error) {
    if (db)
      closeQuietly(db);
    const detail = getErrorMessage(error);
    log2(`[magic-context] storage fatal: failed to open ${dbPath}: ${detail}`);
    throw new Error(`[magic-context] storage unavailable: ${detail}. Magic Context is disabled for this run; check log for details.`);
  }
}
function openCurrentDatabase(options = {}) {
  return openDatabase({ ...options, allowMigrations: false });
}
async function openDatabaseAsync(dbPathOrOptions) {
  const options = typeof dbPathOrOptions === "string" ? { dbPath: dbPathOrOptions } : dbPathOrOptions;
  const explicitDbPath = options?.dbPath !== undefined;
  const { dbDir, dbPath } = resolveDatabasePath(options?.dbPath);
  const latestSupportedVersion = getRuntimeLatestSupportedVersion(options);
  const busyTimeoutMs = resolveBootBusyTimeoutMs(options?.busyTimeoutMs);
  lastSchemaFenceRejection = null;
  lastMigrationOnOpenRefusal = null;
  const existing = databases.get(dbPath);
  if (existing) {
    const startedAt = performance.now();
    const accepted = enforceSchemaFence(existing, dbPath, latestSupportedVersion);
    if (accepted) {
      if (!persistenceByDatabase.has(existing))
        persistenceByDatabase.set(existing, true);
      healWedgedChannel2Claims(existing);
    }
    options?.onBootTimings?.({
      openMs: performance.now() - startedAt,
      guardMs: 0,
      migrateMs: 0
    });
    return accepted ? existing : null;
  }
  const pending = pendingAsyncOpens.get(dbPath);
  if (pending)
    return pending;
  if (!isFileBackedPath(dbPath)) {
    throw new Error("async migration requires a file-backed database; use the explicit synchronous opener for in-memory or URI test databases");
  }
  const opening = (async () => {
    let db;
    const mainThreadBodiesBefore = getMainThreadMigrationBodyCount();
    const openStartedAt = performance.now();
    let openMs = 0;
    let guardMs = 0;
    let migrateMs = 0;
    let guardStartedAt = null;
    let migrateStartedAt = null;
    try {
      if (!explicitDbPath)
        migrateLegacyStorageIfNeeded(dbPath, dbDir);
      ensureSecureStorageDir(dbDir);
      tightenStorageTree(dbDir);
      if (!existsSync2(dbPath) && shouldEnforcePrivateStoragePermissions()) {
        try {
          writeStorageFileSync(dbPath, new Uint8Array, { flag: "wx" });
        } catch (error) {
          if (error.code !== "EEXIST")
            throw error;
        }
      }
      db = new Database2(dbPath);
      installBootBusyTimeout(db, dbPath, busyTimeoutMs, options?.onBootBusyTimeout);
      openMs = performance.now() - openStartedAt;
      guardStartedAt = performance.now();
      if (!enforceSchemaFence(db, dbPath, latestSupportedVersion)) {
        guardMs = performance.now() - guardStartedAt;
        closeQuietly(db);
        return null;
      }
      const processes = getPersistedSchemaVersion(db) < latestSupportedVersion ? await inspectProcessesAsync() : undefined;
      if (!enforceMigrationOnOpenGuard(db, dbPath, dbDir, latestSupportedVersion, processes)) {
        guardMs = performance.now() - guardStartedAt;
        closeQuietly(db);
        return null;
      }
      guardMs = performance.now() - guardStartedAt;
      migrateStartedAt = performance.now();
      if (hasPendingMigrations(db)) {
        await runMigrationsOffThread({
          dbPath,
          busyTimeoutMs,
          sqlitePragmaConfig: { ...sqlitePragmaConfig }
        });
      }
      if (hasPendingMigrations(db)) {
        throw new Error("the migration worker did not complete the pending migration; reinstall or rebuild the plugin");
      }
      initializeDatabase(db, busyTimeoutMs, dbPath);
      if (hasPendingMigrations(db)) {
        throw new Error("storage initialization left a pending migration; reinstall or rebuild the plugin");
      }
      ensureContextStoreUuid(db);
      installTagIdentityRevisionTrigger(db);
      const opened = finishDatabaseOpen(db, dbPath, explicitDbPath, latestSupportedVersion);
      migrateMs = performance.now() - migrateStartedAt;
      return opened;
    } catch (error) {
      if (db)
        closeQuietly(db);
      const detail = getErrorMessage(error);
      log2(`[magic-context] storage fatal: failed to open ${dbPath}: ${detail}`);
      throw new Error(`[magic-context] storage unavailable: ${detail}. Magic Context is disabled for this run; check log for details.`);
    } finally {
      log2(`[migrations] async open main-thread migration-body count: ${getMainThreadMigrationBodyCount() - mainThreadBodiesBefore} (total=${getMainThreadMigrationBodyCount()}) path=${dbPath}`);
      if (openMs === 0)
        openMs = performance.now() - openStartedAt;
      if (guardStartedAt !== null && guardMs === 0) {
        guardMs = performance.now() - guardStartedAt;
      }
      if (migrateStartedAt !== null && migrateMs === 0) {
        migrateMs = performance.now() - migrateStartedAt;
      }
      options?.onBootTimings?.({ openMs, guardMs, migrateMs });
    }
  })();
  pendingAsyncOpens.set(dbPath, opening);
  try {
    return await opening;
  } finally {
    if (pendingAsyncOpens.get(dbPath) === opening)
      pendingAsyncOpens.delete(dbPath);
  }
}
function closeDatabase() {
  pendingAsyncOpens.clear();
  for (const [key, db] of databases) {
    try {
      closeQuietly(db);
    } catch (error) {
      log2("[magic-context] storage error:", error);
    } finally {
      databases.delete(key);
    }
  }
}

export { FAIL_CLOSED_DOCTOR_COMMAND, formatFailClosedBlockingMessage, createFailClosedBlockingError, isFailClosedBlockingError, shouldBypassFailClosedBlock, createFailClosedController, getErrorMessage, describeError, startBootDeadline, getSchemaFenceRejection, getMigrationOnOpenRefusal, LATEST_SUPPORTED_VERSION, getDatabasePath, getPersistedSchemaVersion, setSqlitePragmaConfig, applySqliteTuningPragmas, runSqliteOptimize, initializeDatabase, openDatabase, openCurrentDatabase, openDatabaseAsync, closeDatabase };
