import {
  tagRevisionIncarnationSql,
  tagRevisionCountSql,
  tagRevisionKey,
  TAG_INSERT_CONFLICT_ROWS
} from "./index-w1avzkdt.js";
import {
  getTagsBySession2,
  getTagsByNumbers2
} from "./index-n8e5e9fp.js";
import {
  inRootAsyncContext2,
  getSqliteDatabasePath2,
  withSqliteTurnDeadline2
} from "./index-2qtx0q6h.js";
import {
  createFailClosedBlockingError
} from "./index-j0t5pwjg.js";
import {
  createWorkerShutdown
} from "./index-54wmg4rj.js";

// src/pi-context-budget.ts
var PI_CONTEXT_BUDGET = {
  hostDeadlineMs: 30000,
  hostMarginMs: 5000,
  outcomeMs: 25000,
  fallbackObservedMs: 4,
  workMs: 21000,
  writerMs: 16500,
  completionReserveMs: 2000,
  searchMs: 3000
};

class PiContextDeadlineError extends Error {
}

class PiContextSupersededError extends Error {
  origin;
  constructor(message, origin = "context ownership") {
    super(message);
    this.origin = origin;
  }
}

class PiContextBudget {
  startedAt;
  now;
  sideTurn = false;
  stage = "entry";
  recovery = "not attempted";
  abandoned = false;
  completed = false;
  failureReason;
  signal;
  cancelled = false;
  isCancelled(error) {
    return this.cancelled || this.signal?.aborted === true || !this.signal && typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
  }
  cancel() {
    this.cancelled = true;
    this.abandoned = true;
    this.completed = false;
    this.failureReason = undefined;
  }
  assertOwner = () => {};
  constructor(startedAt = performance.now(), now = () => performance.now()) {
    this.startedAt = startedAt;
    this.now = now;
  }
  elapsed() {
    return this.now() - this.startedAt;
  }
  remainingWork = () => {
    return Math.max(0, PI_CONTEXT_BUDGET.workMs - this.elapsed());
  };
  remainingOutcome = () => Math.max(0, PI_CONTEXT_BUDGET.outcomeMs - this.elapsed());
  writerAllowance() {
    return Math.max(0, Math.min(PI_CONTEXT_BUDGET.writerMs, this.remainingWork() - PI_CONTEXT_BUDGET.completionReserveMs));
  }
  hydrationAllowance() {
    return Math.max(0, Math.min(this.remainingWork() - PI_CONTEXT_BUDGET.completionReserveMs, this.remainingOutcome() - PI_CONTEXT_BUDGET.completionReserveMs));
  }
  assertOutcome = () => {
    this.assertOwner();
    this.signal?.throwIfAborted();
    if (this.abandoned || this.elapsed() >= PI_CONTEXT_BUDGET.outcomeMs)
      throw new PiContextDeadlineError(this.diagnostic());
  };
  assert = () => {
    this.assertOutcome();
    if (this.elapsed() >= PI_CONTEXT_BUDGET.workMs)
      throw new PiContextDeadlineError(this.diagnostic());
  };
  assertDecisionPublication = () => {
    this.signal?.throwIfAborted();
    if (!this.completed)
      this.assertOwner();
    if (this.abandoned || !this.completed && this.elapsed() >= PI_CONTEXT_BUDGET.outcomeMs)
      throw new PiContextDeadlineError(this.diagnostic());
  };
  diagnostic() {
    return `stage=${this.stage} elapsed=${Math.round(this.elapsed())}ms recovery=${this.recovery}`;
  }
  waitUntil = async (pending, assert, remaining) => {
    try {
      assert();
    } catch (error) {
      pending.catch(() => {});
      throw error;
    }
    let timer;
    let onAbort;
    try {
      return await Promise.race([
        pending,
        ...this.signal ? [
          new Promise((_, reject) => {
            onAbort = () => reject(this.signal?.reason);
            this.signal?.addEventListener("abort", onAbort, {
              once: true
            });
          })
        ] : [],
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new PiContextDeadlineError(this.diagnostic())), remaining());
        })
      ]);
    } finally {
      clearTimeout(timer);
      if (onAbort)
        this.signal?.removeEventListener("abort", onAbort);
      assert();
    }
  };
  wait = (pending) => this.waitUntil(pending, this.assert, () => this.remainingWork());
  waitMandatory = (pending) => this.waitUntil(pending, this.assertOutcome, this.remainingOutcome);
}

// src/tag-snapshot-worker-client-pi.ts
import { setImmediate as yieldImmediate } from "node:timers/promises";
import { Worker } from "node:worker_threads";

// src/tag-snapshot-codec-pi.ts
var encoder = new TextEncoder;
var decoder = new TextDecoder;
function encodePiHydrationOperation(operation) {
  return encoder.encode(JSON.stringify(operation, (_key, value) => {
    if (value instanceof Uint8Array)
      return { $piScalar: "bytes", value: Array.from(value) };
    if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0)))
      return {
        $piScalar: "number",
        value: Object.is(value, -0) ? "-0" : String(value)
      };
    if (value === undefined)
      return { $piScalar: "undefined" };
    return value;
  }));
}
function decodePiHydrationOperation(bytes) {
  const operation = JSON.parse(decoder.decode(bytes));
  const restore = (value) => {
    for (const key of Object.keys(value)) {
      const scalar = value[key];
      if (!scalar || typeof scalar !== "object")
        continue;
      if (scalar.$piScalar === "bytes")
        value[key] = Uint8Array.from(scalar.value);
      else if (scalar.$piScalar === "undefined")
        value[key] = undefined;
      else if (scalar.$piScalar === "number")
        value[key] = scalar.value === "-0" ? -0 : Number(scalar.value);
    }
  };
  if (operation.type === "row")
    restore(operation.value);
  else if (operation.type === "field")
    restore(operation);
  return operation;
}

// src/tag-snapshot-worker-client-pi.ts
class PiTagHydrationError extends Error {
  code;
  constructor(message, code = "failed") {
    super(`Pi tag hydration: ${message}`);
    this.code = code;
    this.name = "PiTagHydrationError";
  }
}
function createPiHydrationPacketConsumer(request, cached = [], byteLimit) {
  const assembly = createPiTagSnapshotCandidate(cached, byteLimit);
  let sequence = 0;
  let generation;
  let busy = false;
  let rejected = false;
  let stream = "tags";
  let tagsEnded = false;
  let fallbackEnded = false;
  let fragment;
  let fragmentBytes = 0;
  const byteOffsets = new Map;
  let streamRows = 0;
  let maxAssemblyMs = 0;
  let done = false;
  const fail = (message) => {
    rejected = true;
    throw new PiTagHydrationError(message);
  };
  return {
    async consume(message) {
      if (busy || rejected || done)
        return fail("packet after completion or without credit");
      if (message.jobId !== request.jobId || message.sessionId !== request.sessionId || message.connectionEpoch !== request.connectionEpoch || message.sessionEpoch !== request.sessionEpoch || message.sequence !== sequence++)
        return fail("packet sequence or lifetime mismatch");
      if (message.type === "failed") {
        rejected = true;
        if (message.code === "open")
          throw createFailClosedBlockingError({
            kind: "storage_failure",
            cause: `Pi tag hydration: ${message.reason}`
          });
        if (message.code === "schema")
          throw createFailClosedBlockingError({
            kind: "schema_fence",
            persistedVersion: message.persistedVersion ?? 0,
            supportedVersion: message.supportedVersion ?? 0
          }, { cause: new PiTagHydrationError(message.reason, "schema") });
        throw new PiTagHydrationError(message.reason, message.code);
      }
      if (generation && (generation.revision !== message.generation.revision || generation.durable !== message.generation.durable))
        return fail("packet generation mismatch");
      generation ??= message.generation;
      if (message.type === "done") {
        if (!tagsEnded || !fallbackEnded || fragment)
          return fail("completion before both streams ended");
        done = true;
        return assembly.finish();
      }
      if (message.stream !== stream || fallbackEnded)
        return fail("stream order mismatch");
      if (message.type === "end") {
        if (fragment || message.rows !== streamRows)
          return fail("incomplete row or stream count mismatch");
        assembly.end(stream);
        if (stream === "tags") {
          tagsEnded = true;
          stream = "fallback";
        } else
          fallbackEnded = true;
        streamRows = 0;
        return null;
      }
      if (!(message.bytes instanceof ArrayBuffer) || message.bytes.byteLength > 65536 || message.byteLength <= 0 || message.byteLength > message.bytes.byteLength || message.rows > 256)
        return fail("packet exceeds credit limits");
      busy = true;
      let started = performance.now();
      let packetRows = 0;
      const append = (row) => {
        if (stream === "tags")
          assembly.appendTag(row);
        else
          assembly.appendFallback(row);
        streamRows++;
        packetRows++;
      };
      try {
        const bytes = new Uint8Array(message.bytes, 0, message.byteLength);
        const view = new DataView(message.bytes);
        for (let offset = 0;offset < bytes.length; ) {
          if (offset + 4 > bytes.length)
            return fail("truncated frame length");
          const length = view.getUint32(offset);
          offset += 4;
          if (length === 0 || offset + length > bytes.length)
            return fail("truncated frame");
          const operation = decodePiHydrationOperation(bytes.subarray(offset, offset + length));
          offset += length;
          if (operation.type === "row") {
            if (fragment)
              return fail("whole row inside fragments");
            append(operation.value);
          } else if (operation.type === "field") {
            if (!fragment)
              fragmentBytes = 384;
            fragment ??= Object.create(null);
            const value = operation.value;
            fragmentBytes += typeof value === "string" ? 24 + value.length * 2 : value instanceof Uint8Array ? value.length : 8;
            if (assembly.estimatedBytes + fragmentBytes > (byteLimit ?? 128 * 1024 * 1024))
              return fail("candidate memory limit exceeded during field assembly");
            if (operation.append) {
              const prior = fragment[operation.key];
              if (typeof prior === "string" && typeof operation.value === "string")
                fragment[operation.key] = prior + operation.value;
              else if (prior instanceof Uint8Array && operation.value instanceof Uint8Array) {
                const offset = byteOffsets.get(operation.key);
                if (offset === undefined || offset + operation.value.length > prior.length)
                  return fail("invalid binary field length");
                prior.set(operation.value, offset);
                byteOffsets.set(operation.key, offset + operation.value.length);
              } else
                return fail("invalid field fragment");
            } else if (value instanceof Uint8Array) {
              const length = operation.totalLength ?? value.length;
              if (length < value.length || length > (byteLimit ?? 128 * 1024 * 1024))
                return fail("binary field memory limit");
              const target = new Uint8Array(length);
              target.set(value);
              fragment[operation.key] = target;
              byteOffsets.set(operation.key, value.length);
            } else
              fragment[operation.key] = value;
          } else if (operation.type === "row-end") {
            if (!fragment)
              return fail("row end without fields");
            append(fragment);
            fragment = undefined;
            byteOffsets.clear();
          } else
            return fail("unknown frame");
          const elapsed = performance.now() - started;
          maxAssemblyMs = Math.max(maxAssemblyMs, elapsed);
          if (elapsed >= 4) {
            await yieldImmediate();
            started = performance.now();
          }
        }
        if (packetRows !== message.rows)
          return fail("packet row count mismatch");
        return null;
      } catch (error) {
        rejected = true;
        throw error;
      } finally {
        busy = false;
      }
    },
    get generation() {
      return generation;
    },
    get maxAssemblyMs() {
      return maxAssemblyMs;
    }
  };
}
function startPiTagSnapshotWorker(request, options = {}) {
  const entry = options.entry ?? new URL(import.meta.url.endsWith(".ts") ? "./tag-snapshot-worker-pi.ts" : "./tag-snapshot-worker-pi.js", import.meta.url);
  const started = performance.now();
  const consumer = createPiHydrationPacketConsumer(request, options.cached, options.byteLimit);
  const worker = inRootAsyncContext2(() => new Worker(entry, { workerData: request }));
  const shutdown = createWorkerShutdown(worker, "pi-tag-snapshot", 1000);
  let exited = false;
  let settled = false;
  let consumption = Promise.resolve();
  let complete;
  let rejectResult;
  const released = new Promise((resolve) => worker.once("exit", () => {
    exited = true;
    resolve();
  }));
  const result = new Promise((resolve, reject) => {
    rejectResult = reject;
    const consumeMessage = async (message) => {
      if (settled)
        return;
      try {
        const candidate = await consumer.consume(message);
        if (candidate && message.type === "done") {
          complete = {
            candidate,
            generation: message.generation,
            telemetry: {
              maxReadTransactionMs: message.maxReadTransactionMs,
              maxAssemblyMs: consumer.maxAssemblyMs,
              packetCount: message.packetCount,
              packetBytes: message.packetBytes,
              jobMs: performance.now() - started
            }
          };
        } else {
          await options.beforeAck?.(message);
          if (!settled) {
            const bytes = message.type === "packet" ? message.bytes : undefined;
            worker.postMessage({ type: "ack", sequence: message.sequence, bytes }, bytes ? [bytes] : []);
          }
        }
      } catch (error) {
        abort(error instanceof Error ? error : new Error(String(error)));
      }
    };
    worker.on("message", (message) => {
      consumption = consumeMessage(message);
    });
    worker.once("error", (error) => abort(error));
    worker.once("exit", async (code) => {
      await consumption;
      worker.removeAllListeners("message");
      worker.removeAllListeners("error");
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 && complete)
        resolve(complete);
      else
        reject(new PiTagHydrationError(`worker exited with code ${code} before a clean complete result`));
    });
  });
  function abort(error = new PiTagHydrationError("cancelled", "cancelled")) {
    if (settled)
      return;
    settled = true;
    clearTimeout(timer);
    rejectResult(error);
    if (!exited)
      shutdown.close();
  }
  const timer = inRootAsyncContext2(() => setTimeout(() => abort(new PiTagHydrationError("job deadline exceeded", "deadline")), options.deadlineMs ?? 1e4));
  timer.unref();
  worker.unref();
  result.catch(() => {});
  return { result, released, cancel: abort };
}

// src/tag-snapshot-pi.ts
function createPiTagSnapshotReader(db) {
  const existing = readers.get(db);
  if (existing)
    return existing;
  const nativeWaiters = new Set;
  const inSnapshotRoot = (operation) => inRootAsyncContext2(() => withSqliteTurnDeadline2(() => {
    let remaining = Infinity;
    for (const waiter of nativeWaiters)
      remaining = Math.min(remaining, waiter());
    return remaining;
  }, operation));
  db.exec(`
		CREATE TEMP TABLE IF NOT EXISTS pi_tag_revision (revision INTEGER NOT NULL);
		INSERT INTO pi_tag_revision SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM pi_tag_revision);
		CREATE TEMP TABLE IF NOT EXISTS pi_tag_session_revision (session_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
		CREATE TEMP TABLE IF NOT EXISTS pi_tag_watch (session_id TEXT PRIMARY KEY);
		CREATE TEMP TABLE IF NOT EXISTS pi_tag_changes (session_id TEXT, tag_number INTEGER, PRIMARY KEY (session_id, tag_number));
		CREATE TEMP TABLE IF NOT EXISTS pi_tag_version_own (session_id TEXT PRIMARY KEY, count INTEGER NOT NULL);
		CREATE TEMP TABLE IF NOT EXISTS pi_tag_first_watch (session_id TEXT PRIMARY KEY);
		CREATE TEMP TABLE IF NOT EXISTS pi_tag_first_rows (session_id TEXT, id INTEGER, tag_number INTEGER, PRIMARY KEY(session_id, id));
		CREATE TEMP TABLE IF NOT EXISTS pi_tag_first_allocation (session_id TEXT PRIMARY KEY, incarnation TEXT, seen INTEGER);
		DROP TRIGGER IF EXISTS temp.pi_tag_first_allocation;
		CREATE TEMP TRIGGER pi_tag_first_allocation AFTER UPDATE ON main.schema_migrations_meta
		WHEN SUBSTR(NEW.key, 1, 13) = 'tag_revision:' AND INSTR(OLD.value, ':') = 0
		AND NEW.value = (SELECT value FROM schema_migrations_meta WHERE key = 'tag_revision_incarnation') || ':' || OLD.value
		AND EXISTS (SELECT 1 FROM pi_tag_first_watch WHERE session_id = SUBSTR(NEW.key, 14)) BEGIN
			INSERT INTO pi_tag_first_allocation SELECT SUBSTR(NEW.key, 14), ${tagRevisionIncarnationSql("NEW.value")}, 0
			WHERE NOT EXISTS (SELECT 1 FROM pi_tag_first_allocation WHERE session_id = SUBSTR(NEW.key, 14));
			UPDATE pi_tag_first_allocation SET seen = seen + 1 WHERE session_id = SUBSTR(NEW.key, 14);
		END;
		DROP TRIGGER IF EXISTS temp.pi_tag_version_ai;
		DROP TRIGGER IF EXISTS temp.pi_tag_version_ad;
		DROP TRIGGER IF EXISTS temp.pi_tag_version_au;
		DROP TRIGGER IF EXISTS temp.pi_tag_insert;
		DROP TRIGGER IF EXISTS temp.pi_tag_update;
		DROP TRIGGER IF EXISTS temp.pi_tag_delete;
		DROP TRIGGER IF EXISTS temp.pi_tag_insert_conflicts;
		CREATE TEMP TRIGGER pi_tag_insert_conflicts BEFORE INSERT ON main.tags BEGIN
			UPDATE pi_tag_revision SET revision = revision + (SELECT COUNT(*) FROM (${TAG_INSERT_CONFLICT_ROWS}));
			INSERT INTO pi_tag_session_revision
				SELECT session_id, COUNT(*) FROM (${TAG_INSERT_CONFLICT_ROWS}) GROUP BY session_id
				ON CONFLICT(session_id) DO UPDATE SET revision = revision + excluded.revision;
			INSERT INTO pi_tag_changes
				SELECT session_id, tag_number FROM (${TAG_INSERT_CONFLICT_ROWS}) AS conflicts
				WHERE EXISTS (SELECT 1 FROM pi_tag_watch WHERE session_id = conflicts.session_id)
				AND NOT EXISTS (SELECT 1 FROM pi_tag_changes WHERE session_id = conflicts.session_id AND tag_number = conflicts.tag_number)
				GROUP BY session_id, tag_number;
		END;
		CREATE TEMP TRIGGER IF NOT EXISTS pi_tag_insert AFTER INSERT ON main.tags BEGIN
			INSERT INTO pi_tag_first_rows SELECT NEW.session_id, NEW.id, NEW.tag_number
			WHERE EXISTS (SELECT 1 FROM pi_tag_first_watch WHERE session_id = NEW.session_id)
			AND NOT EXISTS (SELECT 1 FROM pi_tag_first_rows WHERE session_id = NEW.session_id AND id = NEW.id);
			UPDATE pi_tag_revision SET revision = revision + 1;
			INSERT INTO pi_tag_session_revision VALUES (NEW.session_id, 1) ON CONFLICT(session_id) DO UPDATE SET revision = revision + 1;
			INSERT INTO pi_tag_changes SELECT NEW.session_id, NEW.tag_number WHERE EXISTS (SELECT 1 FROM pi_tag_watch WHERE session_id = NEW.session_id) AND NOT EXISTS (SELECT 1 FROM pi_tag_changes WHERE session_id = NEW.session_id AND tag_number = NEW.tag_number);
		END;
		CREATE TEMP TRIGGER IF NOT EXISTS pi_tag_update AFTER UPDATE ON main.tags BEGIN
			UPDATE pi_tag_revision SET revision = revision + 1;
			INSERT INTO pi_tag_session_revision VALUES (OLD.session_id, 1) ON CONFLICT(session_id) DO UPDATE SET revision = revision + 1;
			INSERT INTO pi_tag_session_revision SELECT NEW.session_id, 1 WHERE NEW.session_id IS NOT OLD.session_id ON CONFLICT(session_id) DO UPDATE SET revision = revision + 1;
			INSERT INTO pi_tag_changes SELECT OLD.session_id, OLD.tag_number WHERE EXISTS (SELECT 1 FROM pi_tag_watch WHERE session_id = OLD.session_id) AND NOT EXISTS (SELECT 1 FROM pi_tag_changes WHERE session_id = OLD.session_id AND tag_number = OLD.tag_number);
			INSERT INTO pi_tag_changes SELECT NEW.session_id, NEW.tag_number WHERE EXISTS (SELECT 1 FROM pi_tag_watch WHERE session_id = NEW.session_id) AND NOT EXISTS (SELECT 1 FROM pi_tag_changes WHERE session_id = NEW.session_id AND tag_number = NEW.tag_number);
		END;
		CREATE TEMP TRIGGER IF NOT EXISTS pi_tag_delete AFTER DELETE ON main.tags BEGIN
			UPDATE pi_tag_revision SET revision = revision + 1;
			INSERT INTO pi_tag_session_revision VALUES (OLD.session_id, 1) ON CONFLICT(session_id) DO UPDATE SET revision = revision + 1;
			INSERT INTO pi_tag_changes SELECT OLD.session_id, OLD.tag_number WHERE EXISTS (SELECT 1 FROM pi_tag_watch WHERE session_id = OLD.session_id) AND NOT EXISTS (SELECT 1 FROM pi_tag_changes WHERE session_id = OLD.session_id AND tag_number = OLD.tag_number);
		END;
		CREATE TEMP TRIGGER pi_tag_version_ai AFTER INSERT ON main.tags BEGIN
			INSERT INTO pi_tag_version_own VALUES (NEW.session_id, 1) ON CONFLICT(session_id) DO UPDATE SET count = count + 1;
		END;
		CREATE TEMP TRIGGER pi_tag_version_ad AFTER DELETE ON main.tags BEGIN
			INSERT INTO pi_tag_version_own VALUES (OLD.session_id, 1) ON CONFLICT(session_id) DO UPDATE SET count = count + 1;
		END;
		CREATE TEMP TRIGGER pi_tag_version_au
		AFTER UPDATE OF session_id, message_id, tag_number, type, tool_owner_message_id, status ON main.tags BEGIN
			INSERT INTO pi_tag_version_own VALUES (OLD.session_id, 1) ON CONFLICT(session_id) DO UPDATE SET count = count + 1;
			INSERT INTO pi_tag_version_own SELECT NEW.session_id, 1 WHERE NEW.session_id != OLD.session_id
				ON CONFLICT(session_id) DO UPDATE SET count = count + 1;
		END;
	`);
  const versionStamp = db.prepare(`SELECT
		COALESCE((SELECT tags_version FROM session_meta WHERE session_id = ?), 0) AS durable,
		COALESCE((SELECT count FROM pi_tag_version_own WHERE session_id = ?), 0) AS own`);
  const revision = db.prepare(`WITH stamp AS (SELECT
		COALESCE((SELECT revision FROM pi_tag_session_revision WHERE session_id = ?), 0) AS own,
		COALESCE((SELECT value FROM schema_migrations_meta WHERE key = ?), '0') AS total)
		SELECT CAST(own AS TEXT) AS local,
		(${tagRevisionIncarnationSql("total")}) || ':' || CAST(${tagRevisionCountSql("total")} - own AS TEXT) AS foreign_revision FROM stamp`);
  revisionReaders.set(db, (sessionId) => {
    const transaction = db;
    if (transaction.inTransaction || transaction.isTransaction)
      return null;
    const row = revision.get(sessionId, tagRevisionKey(sessionId));
    return [row.local, row.foreign_revision];
  });
  const changed = db.prepare("SELECT tag_number FROM pi_tag_changes WHERE session_id = ? ORDER BY tag_number");
  const clearChanged = db.prepare("DELETE FROM pi_tag_changes WHERE session_id = ?");
  const watch = db.prepare("INSERT OR IGNORE INTO pi_tag_watch VALUES (?)");
  const unwatch = db.prepare("DELETE FROM pi_tag_watch WHERE session_id = ?");
  const cache = new Map;
  const ownFirstAllocation = db.prepare(`SELECT 1 FROM pi_tag_first_allocation allocation
		WHERE session_id = ? AND seen = 1 AND incarnation || ':0' = ?
		AND EXISTS (SELECT 1 FROM pi_tag_watch WHERE session_id = allocation.session_id)
		AND EXISTS (SELECT 1 FROM pi_tag_changes WHERE session_id = allocation.session_id)
		AND (? = 'legacy' OR EXISTS (SELECT 1 FROM pi_tag_first_rows WHERE session_id = allocation.session_id))
		AND NOT EXISTS (SELECT 1 FROM pi_tag_first_rows first_row WHERE first_row.session_id = allocation.session_id
		AND NOT EXISTS (SELECT 1 FROM pi_tag_changes change WHERE change.session_id = first_row.session_id AND change.tag_number IS first_row.tag_number))`);
  const managed = new Set;
  const epoch = ++connectionEpoch;
  const sessionEpochs = new Map;
  let closed = false;
  let jobId = 0;
  let current;
  let failedUntil = 0;
  let lastFailure;
  let failedSession;
  const totalRevision = db.prepare("SELECT COALESCE(value, '0') AS revision, value IS NOT NULL AS present FROM (SELECT 1) LEFT JOIN schema_migrations_meta ON key = ?");
  const assertOutsideTransaction = () => {
    const connection = db;
    if (connection.inTransaction || connection.isTransaction)
      throw new PiTagHydrationError("readiness requested inside a transaction");
  };
  const stamps = (sessionId, id) => {
    assertOutsideTransaction();
    const revision = revisionReaders.get(db)?.(sessionId);
    if (!revision)
      throw new PiTagHydrationError("owner revision unavailable");
    const stamp = versionStamp.get(sessionId, sessionId);
    const total = totalRevision.get(tagRevisionKey(sessionId));
    return {
      connectionEpoch: epoch,
      sessionEpoch: sessionEpochs.get(sessionId) ?? 0,
      jobId: id,
      sessionId,
      localRevision: revision[0],
      foreignRevision: revision[1],
      durableVersion: stamp.durable,
      ownVersion: stamp.own,
      totalRevision: total.revision,
      revisionPresent: total.present
    };
  };
  const ready = (sessionId) => {
    assertOutsideTransaction();
    const cached = cache.get(sessionId);
    if (!cached?.fallback)
      return false;
    const revision = revisionReaders.get(db)?.(sessionId);
    if (!revision || cached.foreignRevision !== revision[1])
      return false;
    const stamp = versionStamp.get(sessionId, sessionId);
    return stamp.durable - cached.durableVersion === stamp.own - cached.ownVersion;
  };
  const cancel = (sessionId) => {
    sessionEpochs.set(sessionId, (sessionEpochs.get(sessionId) ?? 0) + 1);
    if (current?.sessionId === sessionId)
      current.cancel();
  };
  const load = (sessionId, kind) => inSnapshotRoot(async () => {
    if (closed)
      throw new PiTagHydrationError("connection closed");
    managed.add(sessionId);
    if (ready(sessionId))
      return;
    if (current) {
      if (current.sessionId === sessionId && !current.retryable && !current.preempted) {
        if (kind === "turn")
          current.kind = "turn";
        return current.result;
      }
      if (kind === "turn" && current.kind === "prewarm" && current.sessionId !== sessionId && !current.preempted) {
        current.preempted = true;
        current.cancel();
      }
      const epoch = sessionEpochs.get(sessionId) ?? 0;
      await Promise.allSettled([current.result, current.released]);
      if (epoch !== (sessionEpochs.get(sessionId) ?? 0))
        throw new PiTagHydrationError("session hydration cancelled while queued", "cancelled");
      return load(sessionId, kind);
    }
    if (failedSession === sessionId && performance.now() < failedUntil)
      throw lastFailure;
    watch.run(sessionId);
    const token = stamps(sessionId, ++jobId);
    const previous = cache.get(sessionId);
    const legacyFallbackOnly = previous && previous.foreignRevision === token.foreignRevision && (previous.legacyFallback || token.durableVersion - previous.durableVersion !== token.ownVersion - previous.ownVersion);
    const path = getSqliteDatabasePath2(db);
    const factory = workerFactories.get(db) ?? ((request, cached) => {
      if (!path)
        throw new PiTagHydrationError("read-only hydration requires a file-backed database");
      return startPiTagSnapshotWorker({ ...request, path }, { cached });
    });
    const worker = factory({
      path: path ?? "",
      sessionId,
      connectionEpoch: epoch,
      sessionEpoch: token.sessionEpoch,
      jobId: token.jobId
    }, previous?.tags ?? []);
    const destination = {
      sessionId,
      kind,
      result: Promise.resolve(),
      released: worker.released,
      cancel: worker.cancel
    };
    current = destination;
    let jobs = activeJobs.get(sessionId);
    if (!jobs) {
      jobs = new Set;
      activeJobs.set(sessionId, jobs);
    }
    const lifetime = {
      cancel,
      released: worker.released,
      get result() {
        return destination.result;
      }
    };
    jobs.add(lifetime);
    destination.result = worker.result.then(({ candidate, generation }) => {
      if (destination.preempted)
        throw new PiTagHydrationError("prewarm yielded to a turn", "cancelled");
      const live = stamps(sessionId, token.jobId);
      if (closed || current !== destination || !samePiTagSnapshotToken(token, live) || token.totalRevision !== live.totalRevision || generation.revision !== token.totalRevision || generation.durable !== token.durableVersion)
        throw new PiTagHydrationError("owner generation or lifetime changed", "stale");
      const snapshot = {
        firstAllocationPending: live.revisionPresent ? undefined : candidate.tags.length === 0 && !db.prepare("SELECT 1 FROM tags WHERE session_id = ? LIMIT 1").get(sessionId) ? "empty" : "legacy",
        revision: legacyFallbackOnly ? previous.revision : live.localRevision,
        foreignRevision: live.foreignRevision,
        tags: legacyFallbackOnly ? previous.tags : candidate.tags,
        active: legacyFallbackOnly ? previous.active : candidate.active,
        fallback: candidate.fallback,
        durableVersion: live.durableVersion,
        ownVersion: live.ownVersion
      };
      if (cache.size >= 100 && !cache.has(sessionId)) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
          cache.delete(oldest);
          unwatch.run(oldest);
          clearChanged.run(oldest);
        }
      }
      if (!legacyFallbackOnly)
        clearChanged.run(sessionId);
      if (snapshot.firstAllocationPending) {
        db.prepare("DELETE FROM pi_tag_first_allocation WHERE session_id = ?").run(sessionId);
        db.prepare("DELETE FROM pi_tag_first_rows WHERE session_id = ?").run(sessionId);
        db.prepare("INSERT OR IGNORE INTO pi_tag_first_watch VALUES (?)").run(sessionId);
      }
      cache.set(sessionId, snapshot);
    }).catch((error) => {
      const retryable = error instanceof PiTagHydrationError && (error.code === "stale" || error.code === "cancelled");
      if (retryable)
        destination.retryable = true;
      if (!destination.preempted && current === destination && token.sessionEpoch === (sessionEpochs.get(sessionId) ?? 0)) {
        failedSession = sessionId;
        lastFailure = error;
        failedUntil = performance.now() + (retryable ? 0 : 500);
      }
      throw error;
    });
    Promise.allSettled([destination.result, worker.released]).then(() => {
      if (current === destination)
        current = undefined;
      jobs.delete(lifetime);
      if (!jobs.size)
        activeJobs.delete(sessionId);
    });
    return destination.result;
  });
  owners.set(db, {
    ready,
    load,
    addNativeWaiter: (remaining) => {
      nativeWaiters.add(remaining);
      return () => {
        nativeWaiters.delete(remaining);
      };
    },
    manage: (sessionId) => managed.add(sessionId),
    cancel
  });
  const fallbackRows = db.prepare(`SELECT ${PI_FALLBACK_ROW_COLUMNS} FROM tags WHERE session_id = ? AND ${PI_FALLBACK_ROW_PREDICATE}`);
  const fallbackRowsByNumbers = db.prepare(`SELECT ${PI_FALLBACK_ROW_COLUMNS} FROM tags WHERE session_id = ?
		 AND tag_number IN (SELECT value FROM json_each(?)) AND ${PI_FALLBACK_ROW_PREDICATE}`);
  const sync = (sessionId) => {
    const transaction = db;
    if (transaction.inTransaction || transaction.isTransaction)
      return null;
    const [local, external] = revisionReaders.get(db)?.(sessionId) ?? [
      "0",
      "0:0"
    ];
    const stamp = versionStamp.get(sessionId, sessionId);
    let snapshot = cache.get(sessionId);
    if (snapshot?.firstAllocationPending && snapshot.foreignRevision !== external && snapshot.revision !== local && stamp.durable - snapshot.durableVersion === stamp.own - snapshot.ownVersion && ownFirstAllocation.get(sessionId, external, snapshot.firstAllocationPending)) {
      snapshot.foreignRevision = external;
      snapshot.firstAllocationPending = undefined;
      db.prepare("DELETE FROM pi_tag_first_watch WHERE session_id = ?").run(sessionId);
      db.prepare("DELETE FROM pi_tag_first_rows WHERE session_id = ?").run(sessionId);
    }
    if (!snapshot || snapshot.foreignRevision !== external) {
      if (managed.has(sessionId))
        throw new PiTagHydrationError("tag snapshot is not ready; turn not sent, retry");
      const tags = snapshot ? reuseUnchangedRows(snapshot.tags, getTagsBySession2(db, sessionId)) : getTagsBySession2(db, sessionId);
      snapshot = {
        revision: local,
        foreignRevision: external,
        tags,
        active: tags.filter(isActive),
        durableVersion: stamp.durable,
        ownVersion: stamp.own
      };
      if (cache.size >= 100 && !cache.has(sessionId)) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
          cache.delete(oldest);
          unwatch.run(oldest);
          clearChanged.run(oldest);
        }
      }
      cache.set(sessionId, snapshot);
      for (const tag of snapshot.tags)
        Object.freeze(tag);
      watch.run(sessionId);
    } else if (snapshot.revision !== local) {
      const numbers = changed.all(sessionId).map((row) => row.tag_number);
      if (numbers.length > 0) {
        const dirty = new Set(numbers);
        const replacements = getTagsByNumbers2(db, sessionId, numbers);
        for (const tag of replacements)
          Object.freeze(tag);
        snapshot.tags = mergeChangedRows(snapshot.tags, dirty, replacements);
        snapshot.active = mergeChangedRows(snapshot.active, dirty, replacements.filter(isActive));
        if (!numbers.every(Number.isSafeInteger)) {
          snapshot.fallback = undefined;
        } else if (snapshot.fallback) {
          snapshot.fallback = [
            ...snapshot.fallback.filter((row) => !dirty.has(row.tag_number)),
            ...fallbackRowsByNumbers.all(sessionId, JSON.stringify(numbers))
          ];
        }
      }
      snapshot.revision = local;
    }
    if (stamp.durable - snapshot.durableVersion !== stamp.own - snapshot.ownVersion) {
      snapshot.fallback = undefined;
      snapshot.legacyFallback = true;
    }
    snapshot.durableVersion = stamp.durable;
    snapshot.ownVersion = stamp.own;
    clearChanged.run(sessionId);
    return snapshot;
  };
  const read = (sessionId, borrowed = false) => {
    const snapshot = sync(sessionId);
    if (!snapshot && managed.has(sessionId))
      throw new PiTagHydrationError("managed snapshot read inside a transaction");
    if (!snapshot)
      return getTagsBySession2(db, sessionId);
    return borrowed ? snapshot.tags : snapshot.tags.map((tag) => ({ ...tag }));
  };
  entryReaders.set(db, sync);
  fallbackReaders.set(db, (sessionId) => {
    const snapshot = sync(sessionId);
    if (!snapshot)
      return null;
    if (!snapshot.fallback && managed.has(sessionId))
      throw new PiTagHydrationError("fallback snapshot is not ready; turn not sent, retry");
    snapshot.fallback ??= fallbackRows.all(sessionId);
    return snapshot.fallback;
  });
  readers.set(db, read);
  const close = db.close.bind(db);
  Object.defineProperty(db, "close", {
    configurable: true,
    writable: true,
    value: (...args) => {
      closed = true;
      nativeWaiters.clear();
      current?.cancel();
      cache.clear();
      entryReaders.delete(db);
      fallbackReaders.delete(db);
      readers.delete(db);
      revisionReaders.delete(db);
      owners.delete(db);
      workerFactories.delete(db);
      return close(...args);
    }
  });
  return read;
}
var PI_FALLBACK_ROW_COLUMNS = "id, tag_number, type, message_id, tool_owner_message_id, entry_fingerprint";
var PI_FALLBACK_ROW_PREDICATE = `((type = 'message' AND message_id LIKE 'pi-msg-%')
	OR (type = 'tool' AND tool_owner_message_id LIKE 'pi-msg-%'))`;
var isActive = (tag) => tag.status === "active";
function sameRow(left, right, keys) {
  for (const key of keys)
    if (!Object.is(left[key], right[key]))
      return false;
  return true;
}
function samePiTagSnapshotToken(left, right) {
  return left.connectionEpoch === right.connectionEpoch && left.sessionEpoch === right.sessionEpoch && left.jobId === right.jobId && left.sessionId === right.sessionId && left.localRevision === right.localRevision && left.foreignRevision === right.foreignRevision && left.durableVersion === right.durableVersion && left.ownVersion === right.ownVersion;
}
function candidateRowBytes(row, overhead) {
  let bytes = overhead;
  for (const value of Object.values(row)) {
    if (typeof value === "string")
      bytes += 24 + value.length * 2;
    else if (value instanceof Uint8Array)
      bytes += 24 + value.byteLength;
  }
  return bytes;
}
function createPiTagSnapshotCandidate(cached = [], byteLimit = 128 * 1024 * 1024) {
  const tags = [];
  const active = [];
  const fallback = [];
  let estimatedBytes = 192;
  let oldIndex = 0;
  let keys;
  let tagsEnded = false;
  let fallbackEnded = false;
  let failed = false;
  const reject = (reason) => {
    failed = true;
    throw new Error(`Pi tag hydration: ${reason}`);
  };
  const admit = (row, overhead) => {
    estimatedBytes += candidateRowBytes(row, overhead);
    if (estimatedBytes > byteLimit)
      reject("candidate memory limit exceeded");
  };
  return {
    get estimatedBytes() {
      return estimatedBytes;
    },
    appendTag(row) {
      if (failed || tagsEnded)
        reject("tag packet after end or failure");
      const previous = tags.at(-1);
      if (previous && (previous.tagNumber > row.tagNumber || previous.tagNumber === row.tagNumber && (previous.id ?? 0) >= (row.id ?? 0)))
        reject("noncanonical tag order");
      admit(row, 384);
      keys ??= Object.keys(row);
      while (oldIndex < cached.length) {
        const old = cached[oldIndex];
        if (!old || old.tagNumber > row.tagNumber || old.tagNumber === row.tagNumber && (old.id ?? 0) >= (row.id ?? 0))
          break;
        oldIndex += 1;
      }
      const old = cached[oldIndex];
      const selected = old && old.id === row.id && sameRow(old, row, keys) ? old : row;
      Object.freeze(selected);
      tags.push(selected);
      if (isActive(selected))
        active.push(selected);
    },
    appendFallback(row) {
      if (failed || fallbackEnded)
        reject("fallback packet after end or failure");
      admit(row, 192);
      fallback.push(Object.freeze(row));
    },
    end(stream) {
      if (failed)
        reject("end after failure");
      if (stream === "tags") {
        if (tagsEnded)
          reject("duplicate tag end");
        tagsEnded = true;
      } else {
        if (fallbackEnded)
          reject("duplicate fallback end");
        fallbackEnded = true;
      }
    },
    finish() {
      if (failed || !tagsEnded || !fallbackEnded)
        throw new Error("Pi tag hydration: incomplete candidate");
      return { tags, active, fallback, estimatedBytes };
    }
  };
}
function reuseUnchangedRows(cached, fresh) {
  const first = fresh[0];
  if (!first)
    return fresh;
  const keys = Object.keys(first);
  let index = 0;
  for (let position = 0;position < fresh.length; position += 1) {
    const row = fresh[position];
    if (!row)
      continue;
    while (index < cached.length) {
      const old = cached[index];
      if (!old || old.tagNumber > row.tagNumber || old.tagNumber === row.tagNumber && (old.id ?? 0) >= (row.id ?? 0))
        break;
      index += 1;
    }
    const old = cached[index];
    if (old && old.id === row.id && sameRow(old, row, keys))
      fresh[position] = old;
  }
  return fresh;
}
function mergeChangedRows(rows, dirty, replacements) {
  const highest = rows.at(-1)?.tagNumber ?? -1;
  let appendOnly = true;
  for (const number of dirty) {
    if (number <= highest) {
      appendOnly = false;
      break;
    }
  }
  if (appendOnly)
    return [...rows, ...replacements];
  const unchanged = rows.filter((tag) => !dirty.has(tag.tagNumber));
  const merged = [];
  let index = 0;
  for (const tag of unchanged) {
    while (index < replacements.length) {
      const next = replacements[index];
      if (!next)
        break;
      if (next.tagNumber > tag.tagNumber || next.tagNumber === tag.tagNumber && (next.id ?? 0) > (tag.id ?? 0))
        break;
      merged.push(next);
      index += 1;
    }
    merged.push(tag);
  }
  merged.push(...replacements.slice(index));
  return merged;
}
var entryReaders = new WeakMap;
var fallbackReaders = new WeakMap;
var readers = new WeakMap;
var revisionReaders = new WeakMap;
function getPiTagSnapshotView(db, sessionId) {
  return createPiTagSnapshotReader(db)(sessionId, true);
}
function getPiActiveTagSnapshotView(db, sessionId, passTags) {
  createPiTagSnapshotReader(db);
  const snapshot = entryReaders.get(db)?.(sessionId);
  if (snapshot && (!passTags || snapshot.tags === passTags))
    return snapshot.active.slice();
  return (passTags ?? getTagsBySession2(db, sessionId)).filter(isActive);
}
function readPiFallbackTagRows(db, sessionId) {
  createPiTagSnapshotReader(db);
  return fallbackReaders.get(db)?.(sessionId) ?? null;
}
var connectionEpoch = 0;
var owners = new WeakMap;
var workerFactories = new WeakMap;
var activeJobs = new Map;
var waitDeadlines = new WeakMap;
function prewarmPiTagSnapshot(db, sessionId) {
  createPiTagSnapshotReader(db);
  owners.get(db)?.load(sessionId, "prewarm").catch(() => {});
}
function cancelPiTagSnapshotSession(sessionId) {
  for (const job of activeJobs.get(sessionId) ?? [])
    job.cancel(sessionId);
}
async function drainPiTagSnapshotSession(sessionId) {
  await Promise.allSettled([...activeJobs.get(sessionId) ?? []].flatMap((job) => [
    job.result,
    job.released
  ]));
}
function assertPiTagSnapshotReady(db, sessionId) {
  createPiTagSnapshotReader(db);
  const owner = owners.get(db);
  owner?.manage(sessionId);
  if (!owner?.ready(sessionId))
    throw new PiTagHydrationError("tag snapshot is not ready; turn not sent, retry");
}
function ensurePiTagSnapshotReady(db, sessionId, budget) {
  budget.assert();
  createPiTagSnapshotReader(db);
  const owner = owners.get(db);
  if (!owner)
    throw new PiTagHydrationError("snapshot owner unavailable");
  owner.manage(sessionId);
  if (owner.ready(sessionId))
    return;
  let deadline = waitDeadlines.get(budget);
  if (deadline === undefined) {
    deadline = performance.now() + budget.hydrationAllowance();
    waitDeadlines.set(budget, deadline);
  }
  const end = deadline;
  return (async () => {
    for (;; ) {
      budget.assert();
      const allowance = Math.min(end - performance.now(), budget.hydrationAllowance());
      if (allowance <= 0)
        throw new PiTagHydrationError("remaining pass budget exhausted waiting for tag snapshot; turn not sent, retry", "deadline");
      let timer;
      const releaseNativeWaiter = owner.addNativeWaiter(() => budget.remainingOutcome() - PI_CONTEXT_BUDGET.completionReserveMs);
      try {
        await budget.wait(Promise.race([
          owner.load(sessionId, "turn"),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new PiTagHydrationError("remaining pass budget exhausted waiting for tag snapshot; turn not sent, retry", "deadline")), allowance);
          })
        ]));
        budget.assert();
        assertPiTagSnapshotReady(db, sessionId);
        return;
      } catch (error) {
        budget.assert();
        if (!(error instanceof PiTagHydrationError && (error.code === "stale" || error.code === "cancelled")))
          throw error;
      } finally {
        clearTimeout(timer);
        releaseNativeWaiter();
      }
    }
  })();
}

export { PI_CONTEXT_BUDGET, PiContextDeadlineError, PiContextSupersededError, PiContextBudget, encodePiHydrationOperation, PiTagHydrationError, PI_FALLBACK_ROW_COLUMNS, PI_FALLBACK_ROW_PREDICATE, getPiTagSnapshotView, getPiActiveTagSnapshotView, readPiFallbackTagRows, prewarmPiTagSnapshot, cancelPiTagSnapshotSession, drainPiTagSnapshotSession, assertPiTagSnapshotReady, ensurePiTagSnapshotReady };
