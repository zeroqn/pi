// ../plugin/src/shared/sqlite.ts
import { AsyncLocalStorage } from "node:async_hooks";
var reportSlowPrivilegedWrite;
function registerSlowWriteReporter2(reporter) {
  reportSlowPrivilegedWrite = reporter;
}
var sqliteDiagnosticSink;
function registerSqliteDiagnosticSink2(sink) {
  sqliteDiagnosticSink = sink;
}
function reportSqliteDiagnostic(message) {
  try {
    sqliteDiagnosticSink?.(`[magic-context] ${message}`);
  } catch {}
}
function detectSqliteRuntime2() {
  const hasBunVersion = typeof process !== "undefined" && typeof process.versions?.bun === "string";
  const hasBunGlobal = typeof globalThis !== "undefined" && typeof globalThis.Bun !== "undefined";
  return hasBunVersion || hasBunGlobal ? "Bun" : "Node.js";
}
var bunSpec = "bun:" + "sqlite";
var nodeSpec = "node:" + "sqlite";
async function importSqliteModule(specifier) {
  return await import(specifier);
}
function isModuleNotFoundError(error, specifier) {
  const candidate = error;
  const code = typeof candidate?.code === "string" ? candidate.code : "";
  const name = typeof candidate?.name === "string" ? candidate.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const details = `${code} ${name} ${message}`.toLowerCase();
  const mentionsSpecifier = details.includes(specifier.toLowerCase());
  if (!mentionsSpecifier)
    return false;
  return code === "ERR_MODULE_NOT_FOUND" || code === "ERR_UNKNOWN_BUILTIN_MODULE" || code === "MODULE_NOT_FOUND" || name === "ResolveMessage" || details.includes("module not found") || details.includes("cannot find module") || details.includes("cannot find package") || details.includes("no such built-in module");
}

class SqliteRuntimeUnavailableError extends Error {
  runtime;
  specifier;
  constructor(runtime, specifier, cause) {
    const requirement = specifier === nodeSpec ? "Requires Node.js >= 24, or Bun with bun:sqlite — this Bun build lacks node:sqlite." : "Requires Bun with bun:sqlite, or Node.js >= 24 — this Bun build lacks bun:sqlite.";
    super(`Magic Context detected ${runtime}, but could not load ${specifier}. ${requirement}`, { cause });
    this.name = "SqliteRuntimeUnavailableError";
    this.runtime = runtime;
    this.specifier = specifier;
  }
}
function isNodeSqliteExperimentalWarning(args) {
  const [warning, options] = args;
  const message = warning instanceof Error ? warning.message : warning;
  const type = typeof options === "string" ? options : options && typeof options === "object" ? options.type : undefined;
  return type === "ExperimentalWarning" && typeof message === "string" && message.startsWith("SQLite is an experimental feature");
}
async function importSqliteModuleForRuntime(runtime, specifier, importer) {
  if (runtime !== "Node.js")
    return importer(specifier);
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function(...args) {
    if (isNodeSqliteExperimentalWarning(args))
      return;
    Reflect.apply(originalEmitWarning, this, args);
  };
  try {
    return await importer(specifier);
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}
async function loadSqliteModule(runtime = detectSqliteRuntime2(), importer = importSqliteModule) {
  const specifier = runtime === "Bun" ? bunSpec : nodeSpec;
  try {
    return await importSqliteModuleForRuntime(runtime, specifier, importer);
  } catch (error) {
    if (isModuleNotFoundError(error, specifier)) {
      throw new SqliteRuntimeUnavailableError(runtime, specifier, error);
    }
    throw error;
  }
}
var detectedRuntime = detectSqliteRuntime2();
var isBun = detectedRuntime === "Bun";
var sqliteModule = await loadSqliteModule(detectedRuntime);
var DatabaseImpl = isBun ? sqliteModule.Database : buildNodeSqliteDatabaseClass(sqliteModule.DatabaseSync);
var trackedSqliteConnections = new Map;
var nextSqliteConnectionSequence = 1;
var TAG_COLUMNS_OUTSIDE_IDENTITY = new Set([
  "status",
  "drop_mode",
  "byte_size",
  "input_byte_size",
  "reasoning_byte_size",
  "token_count",
  "input_token_count",
  "caveman_depth",
  "entry_fingerprint",
  "tool_name",
  "harness"
]);
var tagIdentityWriteGeneration = 0;
function mayChangeTagIdentity(sql) {
  if (!/\btags\b/i.test(sql) || /^\s*(?:SELECT|EXPLAIN|PRAGMA)\b/i.test(sql))
    return false;
  if (/^\s*WITH\b/i.test(sql) && !/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql))
    return false;
  if (/;\s*\S/.test(sql) || /\bREPLACE\b/i.test(sql) || /\bON\s+CONFLICT\b/i.test(sql))
    return true;
  const insert = /^\s*INSERT\s+INTO\s+(?:main\.)?["`]?tags["`]?\s*\(([^)]*)\)/i.exec(sql);
  if (insert) {
    const columns = (insert[1] ?? "").split(",").map((column) => column.trim().replace(/["`[\]]/g, "").toLowerCase());
    return columns.includes("id") || columns.includes("rowid");
  }
  const update = /^\s*UPDATE\s+(?:main\.)?["`]?tags["`]?\s+SET\s+([\s\S]*?)\bWHERE\b/i.exec(sql);
  if (update && !/\bSELECT\b/i.test(sql)) {
    const assignments = topLevelCommaSegments(update[1] ?? "");
    if (!assignments)
      return true;
    return !assignments.every((assignment) => {
      const column = /^\s*["`]?(\w+)["`]?\s*=(?!=)/.exec(assignment)?.[1];
      return column !== undefined && TAG_COLUMNS_OUTSIDE_IDENTITY.has(column.toLowerCase());
    });
  }
  return true;
}
function topLevelCommaSegments(text) {
  const segments = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let index = 0;index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        if (text[index + 1] === quote)
          index += 1;
        else
          quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`")
      quote = char;
    else if (char === "(")
      depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth < 0)
        return null;
    } else if (char === "," && depth === 0) {
      segments.push(text.slice(start, index));
      start = index + 1;
    }
  }
  if (quote || depth !== 0)
    return null;
  segments.push(text.slice(start));
  return segments;
}
function getTagIdentityWriteGeneration2() {
  return tagIdentityWriteGeneration;
}
function installTransactionRouting(db, readonly) {
  const nativeExec = db.exec.bind(db);
  Object.defineProperty(db, "exec", {
    configurable: true,
    writable: true,
    value: (sql) => {
      if (/^\s*(?:COMMIT|END)\b/i.test(sql))
        assertTransformWrite2();
      if (/^\s*BEGIN\s+(?:IMMEDIATE|EXCLUSIVE)(?:\s+TRANSACTION)?\s*;?\s*$/i.test(sql)) {
        openWriterTransactions.delete(db);
        if (transformPassScope.getStore()?.active || backgroundWriterScope.getStore())
          acquireShort(db, () => nativeExec(sql), sql.trim());
        else
          nativeExec(sql);
        return db;
      }
      if (WRITER_TRANSACTION_END.test(sql) && openWriterTransactions.has(db))
        return endWriterTransaction(db, () => nativeExec(sql), sql);
      if (!/^\s*(?:SELECT|EXPLAIN|PRAGMA|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(sql)) {
        try {
          return withAutocommitTimeout(db, () => nativeExec(sql));
        } finally {
          if (mayChangeTagIdentity(sql))
            tagIdentityWriteGeneration += 1;
        }
      }
      return nativeExec(sql);
    }
  });
  const nativePrepare = db.prepare.bind(db);
  Object.defineProperty(db, "prepare", {
    configurable: true,
    writable: true,
    value: (sql) => {
      const statement = nativePrepare(sql);
      if (!readonly && !/^\s*(?:SELECT|EXPLAIN|PRAGMA)\b/i.test(sql)) {
        const changesTagIdentity = mayChangeTagIdentity(sql);
        for (const method of ["run", "get", "all"]) {
          const execute = statement[method].bind(statement);
          Object.defineProperty(statement, method, {
            configurable: true,
            value: (...args) => {
              try {
                return withAutocommitTimeout(db, () => execute(...args));
              } finally {
                if (changesTagIdentity)
                  tagIdentityWriteGeneration += 1;
              }
            }
          });
        }
        if (changesTagIdentity)
          wrapRemainingTagWriteForms(statement);
      }
      return statement;
    }
  });
  Object.defineProperty(db, "transaction", {
    configurable: true,
    writable: true,
    value: (fn) => {
      const make = (mode) => function(...args) {
        const nested = isInTransaction(db);
        const savepoint = "mc_tx_sp";
        db.exec(nested ? `SAVEPOINT ${savepoint}` : `BEGIN ${mode}`);
        try {
          const result = fn.apply(this, args);
          db.exec(nested ? `RELEASE ${savepoint}` : "COMMIT");
          return result;
        } catch (error) {
          if (isInTransaction(db)) {
            if (nested) {
              db.exec(`ROLLBACK TO ${savepoint}`);
              db.exec(`RELEASE ${savepoint}`);
            } else
              db.exec("ROLLBACK");
          }
          throw error;
        }
      };
      const defaultTransaction = make(readonly ? "DEFERRED" : "IMMEDIATE");
      const variants = {
        default: defaultTransaction,
        deferred: make("DEFERRED"),
        immediate: make("IMMEDIATE"),
        exclusive: make("EXCLUSIVE"),
        database: db
      };
      for (const transaction of [
        variants.default,
        variants.deferred,
        variants.immediate,
        variants.exclusive
      ]) {
        Object.assign(transaction, variants);
      }
      return defaultTransaction;
    }
  });
}
function wrapRemainingTagWriteForms(statement) {
  if (typeof statement.iterate === "function") {
    const iterate = statement.iterate.bind(statement);
    Object.defineProperty(statement, "iterate", {
      configurable: true,
      value: function* (...args) {
        tagIdentityWriteGeneration += 1;
        try {
          yield* iterate(...args);
        } finally {
          tagIdentityWriteGeneration += 1;
        }
      }
    });
  }
  if (typeof statement.values === "function") {
    const values = statement.values.bind(statement);
    Object.defineProperty(statement, "values", {
      configurable: true,
      value: (...args) => {
        try {
          return values(...args);
        } finally {
          tagIdentityWriteGeneration += 1;
        }
      }
    });
  }
}
function trackSqliteConnection(db, filename, options) {
  const originalClose = db.close.bind(db);
  const sequence = nextSqliteConnectionSequence++;
  const metadata = {
    sequence,
    filename: typeof filename === "string" ? filename : Buffer.isBuffer(filename) ? "<buffer>" : ":memory:",
    readonly: Boolean(options) && typeof options === "object" && (options.readonly === true || options.readOnly === true)
  };
  installTransactionRouting(db, metadata.readonly);
  Object.defineProperty(db, "close", {
    configurable: true,
    value: (...args) => {
      try {
        return originalClose(...args);
      } finally {
        trackedSqliteConnections.delete(sequence);
      }
    }
  });
  trackedSqliteConnections.set(sequence, {
    ...metadata,
    reference: new WeakRef(db)
  });
  const prepare = db.prepare.bind(db);
  Object.defineProperty(db, "prepare", {
    configurable: true,
    writable: true,
    value: (sql) => ownPreparedStatement(db, prepare(sql))
  });
  return db;
}
var TrackedDatabase = new Proxy(DatabaseImpl, {
  construct(target, args) {
    const db = Reflect.construct(target, args, target);
    return trackSqliteConnection(db, args[0], args[1]);
  }
});
function buildNodeSqliteDatabaseClass(DatabaseSync) {

  class NodeSqliteDatabase extends DatabaseSync {
    constructor(filename, options) {
      const translated = { ...options };
      if (options && "readonly" in options) {
        translated.readOnly = options.readonly;
        delete translated.readonly;
      }
      super(typeof filename === "string" ? filename : ":memory:", translated);
    }
    prepare(sql) {
      const stmt = super.prepare(sql);
      for (const method of ["run", "get", "all"]) {
        const original = stmt[method].bind(stmt);
        stmt[method] = (...args) => args.length === 1 && Array.isArray(args[0]) ? original(...args[0]) : original(...args);
      }
      return stmt;
    }
  }
  return NodeSqliteDatabase;
}
var Database2 = TrackedDatabase;
function getSqliteDatabasePath2(db) {
  for (const connection of trackedSqliteConnections.values()) {
    if (connection.reference.deref() === db) {
      return connection.filename === ":memory:" || connection.filename === "<buffer>" ? null : connection.filename;
    }
  }
  const native = db;
  const path = native.filename ?? native.name;
  if (typeof path === "string" && path !== ":memory:" && path !== "")
    return path;
  return null;
}
function pragmaValue(db, name) {
  const row = db.prepare(`PRAGMA ${name}`).get();
  if (!row)
    return;
  return row[name] ?? Object.values(row)[0];
}
function pragmaNumber(db, name) {
  try {
    const value = pragmaValue(db, name);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
var statementOwners = new WeakMap;
var FIRST_PRUNE_AT = 256;
function closeReleasingStatements(close, args) {
  if (args[0] === true)
    return close(true);
  try {
    return close(true);
  } catch {
    return close(...args);
  }
}
function ownPreparedStatement(db, statement) {
  const finalizable = statement;
  if (typeof finalizable.finalize !== "function")
    return statement;
  let owner = statementOwners.get(db);
  if (!owner) {
    const references = new Set;
    owner = { references, registered: new WeakSet, pruneAt: FIRST_PRUNE_AT };
    statementOwners.set(db, owner);
    const close = db.close.bind(db);
    Object.defineProperty(db, "close", {
      configurable: true,
      writable: true,
      value: (...args) => {
        let failure;
        for (const reference of references) {
          try {
            reference.deref()?.finalize();
          } catch (error) {
            failure ??= error;
          }
        }
        references.clear();
        const result = closeReleasingStatements(close, args);
        if (failure)
          throw failure;
        return result;
      }
    });
  }
  if (!owner.registered.has(finalizable)) {
    if (owner.references.size >= owner.pruneAt) {
      for (const reference of owner.references) {
        if (reference.deref() === undefined)
          owner.references.delete(reference);
      }
      owner.pruneAt = Math.max(FIRST_PRUNE_AT, owner.references.size * 2);
    }
    owner.references.add(new WeakRef(finalizable));
    owner.registered.add(finalizable);
  }
  return statement;
}
function prepareCachedStatement2(db, sql) {
  return ownPreparedStatement(db, db.prepare(sql));
}
var privilegeDepth = new WeakMap;
var transformPassScope = new AsyncLocalStorage;
var admissionScope = new AsyncLocalStorage;
var backgroundWriterScope = new AsyncLocalStorage;
function withSqliteBackgroundWriter2(operation) {
  return backgroundWriterScope.run(true, operation);
}
function withSqliteTransformPass2(operation) {
  const existing = transformPassScope.getStore();
  if (existing?.active)
    return operation();
  const reservation = reserveForegroundSqliteTurn();
  const run = (release) => {
    const lease = { active: true, remainingWaitMs: FOREGROUND_IN_PASS_BUSY_TIMEOUT_MS };
    return transformPassScope.run(lease, () => {
      try {
        const result = operation();
        if (result && typeof result.then === "function") {
          return Promise.resolve(result).finally(() => {
            lease.active = false;
            release();
          });
        }
        lease.active = false;
        release();
        return result;
      } catch (error) {
        lease.active = false;
        release();
        throw error;
      }
    });
  };
  return typeof reservation === "function" ? run(reservation) : reservation.then(run);
}
function withoutSqliteTransformPass2(operation) {
  return transformPassScope.run(undefined, operation);
}
function guardSqliteTransformPass2(guard) {
  const lease = transformPassScope.getStore();
  if (lease)
    lease.guard = guard;
}
function assertTransformWrite2() {
  if (!backgroundWriterScope.getStore())
    transformPassScope.getStore()?.guard?.assert();
}
function isTransientSqliteError2(error) {
  if (!error || typeof error !== "object")
    return false;
  const value = error;
  return typeof value.code === "string" && /^(SQLITE_BUSY|SQLITE_LOCKED)(_|$)/.test(value.code) || typeof value.errcode === "number" && [5, 6].includes(value.errcode & 255);
}

class SqliteAcquisitionBusyError extends Error {
  code = "SQLITE_BUSY";
  stage;
  constructor(cause, stage = "BEGIN IMMEDIATE") {
    super("SQLite writer acquisition remained busy", { cause });
    this.name = "SqliteAcquisitionBusyError";
    this.stage = stage;
  }
}
var SHORT_BUSY_TIMEOUT_MS = 25;
var FOREGROUND_IN_PASS_BUSY_TIMEOUT_MS = 250;
var FOREGROUND_ACQUISITION_BUDGET_MS = 16500;
var SLOW_WRITER_LOG_MS = 250;
var WRITER_TRANSACTION_END = /^\s*(?:COMMIT|END|ROLLBACK)(?:\s+TRANSACTION)?\s*;?\s*$/i;
var writerAcquisitionScope = new AsyncLocalStorage;
var openWriterTransactions = new WeakMap;
function foregroundWaitLease() {
  const lease = transformPassScope.getStore();
  return lease?.active && !admissionScope.getStore() && !backgroundWriterScope.getStore() ? lease : undefined;
}
function withAutocommitTimeout(db, operation) {
  assertTransformWrite2();
  const lease = foregroundWaitLease();
  if (isInTransaction(db) || !lease && !backgroundWriterScope.getStore())
    return operation();
  const previous = pragmaNumber(db, "busy_timeout");
  db.exec(`PRAGMA busy_timeout=${lease ? Math.floor(lease.remainingWaitMs) : SHORT_BUSY_TIMEOUT_MS}`);
  const started = performance.now();
  try {
    return operation();
  } catch (error) {
    if (lease && isTransientSqliteError2(error))
      throw new SqliteAcquisitionBusyError(error, "autocommit");
    throw error;
  } finally {
    if (lease)
      lease.remainingWaitMs = Math.max(0, lease.remainingWaitMs - (performance.now() - started));
    if (previous !== null)
      db.exec(`PRAGMA busy_timeout=${previous}`);
  }
}
function acquireShort(db, acquire, site) {
  assertTransformWrite2();
  const started = performance.now();
  const previous = pragmaNumber(db, "busy_timeout");
  const outer = writerAcquisitionScope.getStore();
  const owner = outer && !outer.claimed ? outer : undefined;
  if (owner)
    owner.claimed = true;
  const writerSite = owner?.site ?? site;
  const lane = owner?.lane ?? (transformPassScope.getStore()?.active ? "foreground" : "background");
  let acquiredAt;
  try {
    const lease = foregroundWaitLease();
    const timeout = Math.floor(Math.min(lease ? lease.remainingWaitMs : SHORT_BUSY_TIMEOUT_MS, owner?.remainingMs?.() ?? lease?.guard?.remainingMs() ?? Infinity));
    db.exec(`PRAGMA busy_timeout=${timeout}`);
    acquire();
    acquiredAt = performance.now();
  } catch (error) {
    if (transformPassScope.getStore()?.active && isTransientSqliteError2(error))
      throw new SqliteAcquisitionBusyError(error, site);
    throw error;
  } finally {
    const attemptMs = (acquiredAt ?? performance.now()) - started;
    const lease = foregroundWaitLease();
    if (lease)
      lease.remainingWaitMs = Math.max(0, lease.remainingWaitMs - attemptMs);
    if (previous !== null)
      db.exec(`PRAGMA busy_timeout=${previous}`);
    if (acquiredAt !== undefined) {
      openWriterTransactions.set(db, {
        site: writerSite,
        lane,
        acquireMs: acquiredAt - (owner?.startedAt ?? started),
        attempts: owner?.attempts ?? 1,
        acquiredAt
      });
    } else if (attemptMs >= SLOW_WRITER_LOG_MS) {
      reportSqliteDiagnostic(`sqlite writer site=${writerSite} lane=${lane} acquire_ms=${Math.round(attemptMs)} attempts=${owner?.attempts ?? 1} outcome=busy`);
    }
  }
}
function endWriterTransaction(db, end, sql) {
  let ended = false;
  const endStarted = performance.now();
  try {
    const result = end();
    ended = true;
    return result;
  } finally {
    const open = openWriterTransactions.get(db);
    const endMs = performance.now() - endStarted;
    if (open && !isInTransaction(db)) {
      openWriterTransactions.delete(db);
      const holdMs = performance.now() - open.acquiredAt;
      if (open.acquireMs >= SLOW_WRITER_LOG_MS || holdMs >= SLOW_WRITER_LOG_MS) {
        const outcome = /^\s*ROLLBACK/i.test(sql) ? "rolled_back" : ended ? "committed" : "failed";
        reportSqliteDiagnostic(`sqlite writer site=${open.site} lane=${open.lane} acquire_ms=${Math.round(open.acquireMs)} hold_ms=${Math.round(holdMs)} end_ms=${Math.round(endMs)} attempts=${open.attempts} outcome=${outcome}`);
      }
    }
  }
}
async function beginSqliteWriterAsync2(db, site) {
  const started = performance.now();
  let attempts = 0;
  for (;; ) {
    attempts++;
    try {
      const acquisition = {
        site,
        lane: "background",
        startedAt: started,
        attempts,
        claimed: false
      };
      writerAcquisitionScope.run(acquisition, () => withSqliteBackgroundWriter2(() => db.exec("BEGIN IMMEDIATE")));
      return performance.now();
    } catch (error) {
      if (!isTransientSqliteError2(error))
        throw error;
      const elapsed = performance.now() - started;
      if (elapsed >= FOREGROUND_ACQUISITION_BUDGET_MS) {
        reportSqliteDiagnostic(`sqlite writer site=${site} lane=background acquire_ms=${Math.round(elapsed)} attempts=${attempts} outcome=busy`);
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(attempts === 1 ? 500 : 1000, FOREGROUND_ACQUISITION_BUDGET_MS - elapsed)));
    }
  }
}
async function withAsyncPrivilegedWriter2(db, operation, options = {}) {
  const started = performance.now();
  const budgetMs = Math.max(0, Math.min(FOREGROUND_ACQUISITION_BUDGET_MS, options.budgetMs ?? Infinity));
  let attempts = 0;
  for (;; ) {
    options.signal?.throwIfAborted();
    options.assertCurrentPass?.();
    attempts++;
    let entered = false;
    try {
      const acquisition = {
        site: "privileged_writer",
        lane: "foreground",
        startedAt: started,
        attempts,
        claimed: false,
        remainingMs: () => Math.max(0, budgetMs - (performance.now() - started))
      };
      return admissionScope.run(true, () => withSqliteTransformPass2(() => writerAcquisitionScope.run(acquisition, () => withPrivilegedWriter2(db, () => {
        entered = true;
        return operation();
      }))));
    } catch (error) {
      if (entered || !(error instanceof SqliteAcquisitionBusyError))
        throw error;
      options.beforeRetry?.(error);
      const elapsed = performance.now() - started;
      if (elapsed >= budgetMs) {
        reportSqliteDiagnostic(`sqlite writer site=privileged_writer lane=foreground acquire_ms=${Math.round(elapsed)} attempts=${attempts} outcome=busy`);
        throw error;
      }
      const backoff = attempts === 1 ? 500 : 1000;
      const delay = Math.min(options.jitter ? backoff * (0.8 + Math.random() * 0.4) : backoff, budgetMs - elapsed);
      await new Promise((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", abort);
          reject(options.signal?.reason ?? new Error("Writer wait aborted"));
        };
        const timer = setTimeout(() => {
          options.signal?.removeEventListener("abort", abort);
          resolve();
        }, delay);
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted)
          abort();
      });
    }
  }
}
function isInTransaction(db) {
  const candidate = db;
  return candidate.inTransaction === true || candidate.isTransaction === true;
}
function withPrivilegedWriter2(db, operation) {
  const previousDepth = privilegeDepth.get(db) ?? 0;
  const nested = isInTransaction(db);
  const savepoint = "mc_privilege_scope";
  let transactionStartedAt;
  if (nested) {
    db.exec(`SAVEPOINT ${savepoint}`);
  } else {
    try {
      db.exec("BEGIN IMMEDIATE");
    } catch (error) {
      if (transformPassScope.getStore()?.active && isTransientSqliteError2(error))
        throw new SqliteAcquisitionBusyError(error);
      throw error;
    }
    transactionStartedAt = performance.now();
  }
  privilegeDepth.set(db, previousDepth + 1);
  try {
    db.prepare("INSERT INTO context_privilege_state(id, enabled) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET enabled = 1").run();
    const result = operation();
    if (previousDepth === 0) {
      db.prepare("UPDATE context_privilege_state SET enabled = 0 WHERE id = 1").run();
    }
    if (nested) {
      db.exec(`RELEASE ${savepoint}`);
    } else {
      db.exec("COMMIT");
      if (transactionStartedAt !== undefined) {
        reportSlowPrivilegedWrite?.("privileged_writer", transactionStartedAt);
      }
    }
    if (previousDepth > 0)
      privilegeDepth.set(db, previousDepth);
    else
      privilegeDepth.delete(db);
    return result;
  } catch (error) {
    try {
      if (nested) {
        db.exec(`ROLLBACK TO ${savepoint}`);
        db.exec(`RELEASE ${savepoint}`);
      } else {
        db.exec("ROLLBACK");
      }
    } finally {
      if (previousDepth > 0)
        privilegeDepth.set(db, previousDepth);
      else
        privilegeDepth.delete(db);
    }
    throw error;
  }
}
var indexCoordinationKey = Symbol.for("magic-context.index-foreground-coordination.v1");
var indexCoordinationHeap = globalThis;
var indexCoordinationBuffer = indexCoordinationHeap[indexCoordinationKey] ?? new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT);
indexCoordinationHeap[indexCoordinationKey] = indexCoordinationBuffer;
var indexCoordinationState = new Int32Array(indexCoordinationBuffer);
function indexCoordinationInput2() {
  return {
    indexCoordination: indexCoordinationBuffer,
    indexOwner: Atomics.add(indexCoordinationState, 2, 1) + 1
  };
}
var yieldIndexTurn = () => new Promise((resolve) => setTimeout(resolve, 1));
function reserveForegroundSqliteTurn() {
  Atomics.add(indexCoordinationState, 0, 1);
  const release = () => {
    Atomics.sub(indexCoordinationState, 0, 1);
    Atomics.notify(indexCoordinationState, 0);
  };
  if (Atomics.load(indexCoordinationState, 1) === 0)
    return release;
  return (async () => {
    while (Atomics.load(indexCoordinationState, 1) !== 0)
      await yieldIndexTurn();
    return release;
  })();
}
function releaseIndexOwner2(input) {
  if (!input.indexCoordination || !input.indexOwner)
    return;
  const shared = new Int32Array(input.indexCoordination);
  Atomics.compareExchange(shared, 1, input.indexOwner, 0);
  Atomics.notify(shared, 1);
}
async function withIndexChunk2(input, operation) {
  if (!input.indexCoordination || !input.indexOwner)
    return operation();
  const shared = new Int32Array(input.indexCoordination);
  for (;; ) {
    if (Atomics.load(shared, 0) === 0 && Atomics.compareExchange(shared, 1, 0, input.indexOwner) === 0) {
      if (Atomics.load(shared, 0) === 0)
        break;
      releaseIndexOwner2(input);
    }
    await yieldIndexTurn();
  }
  try {
    return await operation();
  } finally {
    releaseIndexOwner2(input);
  }
}
async function yieldIndexChunk2() {
  await yieldIndexTurn();
}

export { registerSlowWriteReporter2, registerSqliteDiagnosticSink2, detectSqliteRuntime2, getTagIdentityWriteGeneration2, Database2, getSqliteDatabasePath2, prepareCachedStatement2, withSqliteBackgroundWriter2, withSqliteTransformPass2, withoutSqliteTransformPass2, guardSqliteTransformPass2, assertTransformWrite2, isTransientSqliteError2, beginSqliteWriterAsync2, withAsyncPrivilegedWriter2, withPrivilegedWriter2, indexCoordinationInput2, releaseIndexOwner2, withIndexChunk2, yieldIndexChunk2 };
