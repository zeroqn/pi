import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  getMagicContextStorageDir
} from "./index-fgs78jyd.js";
import {
  isPidAlive,
  readProcessStartTime
} from "./index-n4wyxcgr.js";
import {
  BoundedSessionMap,
  resolveOpenCodeDbPath,
  assertOpenCodeStoreGeneration
} from "./index-23t8ryqw.js";
import {
  Database2,
  getSqliteDatabasePath2,
  prepareCachedStatement2,
  withSqliteBackgroundWriter2,
  withoutSqliteTransformPass2
} from "./index-2qtx0q6h.js";
import {
  removeSystemReminders,
  removeNestedBlocks,
  hasMeaningfulUserText2,
  extractTexts2
} from "./index-my0dn413.js";
import {
  recordMessageFtsRowid2,
  recordIndexedMessageTime2,
  messageFtsOrdinalRangeIsMapped2,
  getMessageFtsRowidMapBackfillProgress2,
  deleteUnmappedMessageFtsRows2
} from "./index-8a2wvrda.js";
import {
  deleteChunkEmbedBackoffForSession2
} from "./index-wb2t932e.js";
import {
  closeQuietly,
  TAG_TOMBSTONE_OWNER_PREFIX,
  tagTombstoneOwnerRange,
  tagTombstoneOwnerKey,
  tagRevisionKey,
  tagIdentityRevisionKey,
  deleteTagIdentityRevisions
} from "./index-w1avzkdt.js";
import {
  cleanUserText2
} from "./index-cm9e52mb.js";
import {
  sameProjectDirectory
} from "./index-wrr9rp9a.js";
import {
  logSlowWriteTransaction
} from "./index-hqw0rt9k.js";
import {
  ensurePrivateStorageDirectorySync,
  writeStorageFileSync,
  writeStorageFileAtomicSync,
  syncStorageDirectorySync,
  writeStorageFileDurableAtomicSync
} from "./index-81nthk8j.js";

// ../plugin/src/hooks/magic-context/lkg-recovery-fence.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
import {
  lstatSync,
  opendirSync,
  readdirSync as readdirSync2,
  readFileSync as readFileSync2,
  rmdirSync,
  rmSync as rmSync2
} from "node:fs";
import { basename, dirname, join as join2 } from "node:path";

// ../plugin/src/shared/storage-file-mutex.ts
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
var ticketChecksum = (name, ticket) => createHash("sha256").update(JSON.stringify([name, ticket.choosing, ticket.number, ticket.birth])).digest("hex");
function processBirth(pid) {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const ticks = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19];
      if (!ticks || !/^\d+$/.test(ticks))
        return null;
      return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${ticks}`;
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
        const parsed = JSON.parse(readFileSync(otherPath, "utf8"));
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
    lstatSync(lkgRecoveryFencePath(sessionId));
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
var hash = (value) => createHash2("sha256").update(value).digest("hex");
function lkgRecoveryFencePath(sessionId) {
  return join2(getMagicContextStorageDir(), "lkg-recovery-fences", `${hash(sessionId)}.json`);
}
var lockSweepDirectory;
function closeLkgLockSweepDirectory() {
  lockSweepDirectory?.dir.closeSync();
  lockSweepDirectory = undefined;
}
function takeLkgRecoveryLockSweepPage(maxEntries = 200) {
  const path = join2(getMagicContextStorageDir(), "lkg-recovery-fences");
  if (lockSweepDirectory?.path !== path)
    closeLkgLockSweepDirectory();
  const names = [];
  try {
    lockSweepDirectory ??= { path, dir: opendirSync(path) };
    for (let i = 0;i < Math.min(200, Math.max(1, maxEntries)); i++) {
      const entry = lockSweepDirectory.dir.readSync();
      if (!entry) {
        closeLkgLockSweepDirectory();
        break;
      }
      if (entry.isDirectory() && /^[a-f0-9]{64}\.json\.locks$/.test(entry.name))
        names.push(entry.name);
    }
  } catch {
    closeLkgLockSweepDirectory();
  }
  return names;
}
function sweepEmptyLkgRecoveryLockDirectories(names, retainedSessionIds) {
  if (!durableFencesSupported())
    return 0;
  const retainedHashes = new Set(Array.from(retainedSessionIds, hash));
  const root = join2(getMagicContextStorageDir(), "lkg-recovery-fences");
  let removed = 0;
  for (const name of names.slice(0, 200)) {
    if (!/^[a-f0-9]{64}\.json\.locks$/.test(name) || retainedHashes.has(name.slice(0, 64)))
      continue;
    const path = join2(root, name);
    try {
      try {
        lstatSync(path.slice(0, -".locks".length));
        continue;
      } catch (error) {
        if (error.code !== "ENOENT")
          continue;
      }
      if (!lstatSync(path).isDirectory())
        continue;
      rmdirSync(path);
      removed++;
    } catch {}
  }
  return removed;
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
  return createHash2("sha256").update(slot.jsonPrefix).update(JSON.stringify(metadata(slot))).digest("hex");
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
    const stat = lstatSync(path);
    const directory = lstatSync(dirname(path));
    if (!stat.isFile() || stat.size > 4096 || !directory.isDirectory() || directory.isSymbolicLink() || process.platform !== "win32" && ((stat.mode & 63) !== 0 || (directory.mode & 63) !== 0 || process.getuid && stat.uid !== process.getuid()))
      return null;
    const value = JSON.parse(readFileSync2(path, "utf8"));
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
      lstatSync(file);
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

// ../plugin/src/v2/store-reader.ts
import { createHash as createHash3 } from "node:crypto";
import { statSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
function gaDatabasePath(dataHome, channel = "latest", env = process.env) {
  return resolveOpenCodeDbPath("v2", { dataHome, channel, env }).path;
}
var RAW_MESSAGE_TYPES = [
  "user",
  "synthetic",
  "assistant",
  "skill",
  "shell",
  "system"
];
var RAW_MESSAGE_TYPE_PARAMETERS = RAW_MESSAGE_TYPES.map(() => "?").join(", ");
var V2_MESSAGE_PAGE_SQL = `WITH bounds AS (
    SELECT
        CASE WHEN ? = 0 THEN -1 ELSE COALESCE((
            SELECT seq FROM session_message
            WHERE session_id = ? AND type IN (${RAW_MESSAGE_TYPE_PARAMETERS})
            ORDER BY seq ASC LIMIT 1 OFFSET ?
        ), (SELECT MAX(seq) FROM session_message WHERE session_id = ?), -1) END AS after_seq,
        COALESCE((
            SELECT seq FROM session_message
            WHERE session_id = ? AND type IN (${RAW_MESSAGE_TYPE_PARAMETERS})
            ORDER BY seq ASC LIMIT 1 OFFSET ?
        ), ?) AS watermark_seq
)
SELECT id, session_id, type, seq, time_created, data FROM session_message, bounds
WHERE session_id = ?
  AND type IN (${RAW_MESSAGE_TYPE_PARAMETERS})
  AND seq > bounds.after_seq
  AND seq <= bounds.watermark_seq
ORDER BY seq ASC LIMIT ?`;
var V2_STORE_READER_DEBUG_COUNTER_KEY = "magic-context.v2.store-reader-debug";
var debugSymbol = Symbol.for(V2_STORE_READER_DEBUG_COUNTER_KEY);
var debugGlobal = globalThis;
var QUERY_STATEMENTS = {
  messagePage: V2_MESSAGE_PAGE_SQL,
  messageCount: "SELECT COUNT(*) AS count FROM session_message WHERE session_id = ? AND type IN (?)",
  storedMessageCount: "SELECT COUNT(*) AS count FROM session_message WHERE session_id = ?",
  messageById: "SELECT id, session_id, type, seq, time_created, data FROM session_message WHERE session_id = ? AND id = ? AND type IN (?) LIMIT 1",
  messageExistsById: "SELECT 1 FROM session_message WHERE id = ? AND session_id = ? AND type IN (?) LIMIT 1",
  messageOrdinalById: `WITH target AS (
    SELECT seq FROM session_message WHERE session_id = ? AND id = ? AND type IN (?) LIMIT 1
)
SELECT (SELECT COUNT(*) FROM session_message WHERE session_id = ? AND type IN (?) AND seq <= target.seq) AS ordinal FROM target`,
  messageIdOrdinals: "SELECT id FROM session_message WHERE session_id = ? AND type IN (?) ORDER BY seq ASC LIMIT ? OFFSET ?",
  messageOrdinalPage: "SELECT id, type, seq, json_valid(data) AS valid FROM session_message WHERE session_id = ? AND seq > ? ORDER BY seq ASC, id ASC LIMIT ?",
  rawRowsThrough: "SELECT id, session_id, type, seq, time_created, data FROM session_message WHERE session_id = ? AND type IN (?) AND seq <= ? ORDER BY seq DESC LIMIT ?"
};
function debugCounters() {
  const counters = debugGlobal[debugSymbol] ??= {
    decodedRows: 0,
    operations: {},
    openReaders: 0,
    maxOpenReaders: 0,
    readersOpened: 0,
    readersClosed: 0
  };
  counters.openReaders ??= 0;
  counters.maxOpenReaders ??= 0;
  counters.readersOpened ??= 0;
  counters.readersClosed ??= 0;
  return counters;
}
function returnedRowCount(value) {
  if (Array.isArray(value))
    return value.length;
  if (value === null || value === undefined || value === false)
    return 0;
  return 1;
}
function trackDecodeOperation(name, operation) {
  const counters = debugCounters();
  const before = counters.decodedRows;
  const started = performance.now();
  let value;
  try {
    value = operation();
    return value;
  } finally {
    const decodedRows = counters.decodedRows - before;
    const current = counters.operations[name] ?? {
      calls: 0,
      decodedRows: 0,
      maxDecodedRows: 0
    };
    current.calls += 1;
    current.decodedRows += decodedRows;
    current.maxDecodedRows = Math.max(current.maxDecodedRows, decodedRows);
    counters.operations[name] = current;
    const statement = QUERY_STATEMENTS[name];
    if (counters.captureQueries && statement) {
      (counters.queries ??= []).push({
        operation: name,
        statement,
        rows: returnedRowCount(value),
        elapsedMs: performance.now() - started
      });
    }
  }
}
function decode(row) {
  debugCounters().decodedRows += 1;
  const data = JSON.parse(row.data);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Invalid session_message data at seq ${row.seq}`);
  }
  if (row.type === "idle" && !["succeeded", "failed", "interrupted"].includes(String(data.outcome))) {
    throw new Error(`Invalid idle outcome at seq ${row.seq}`);
  }
  return { ...row, data };
}
function connect(path, identity = "") {
  const stat = statSync(path);
  const acquiredIdentity = identity || `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
  const db = new Database2(path, { readonly: true, fileMustExist: true });
  try {
    assertOpenCodeStoreGeneration(db, "v2", path);
  } catch (error) {
    db.close();
    throw error;
  }
  const counters = debugCounters();
  counters.openReaders += 1;
  counters.readersOpened += 1;
  counters.maxOpenReaders = Math.max(counters.maxOpenReaders, counters.openReaders);
  return { db, statements: new Map, identity: acquiredIdentity, leases: 0, retired: false };
}
function closeConnection(connection) {
  connection.statements.clear();
  try {
    connection.db.close();
  } finally {
    const counters = debugCounters();
    counters.openReaders = Math.max(0, counters.openReaders - 1);
    counters.readersClosed += 1;
  }
}
function messageTimesQuery(count) {
  return `SELECT id, COALESCE(time_created, json_extract(data, '$.time.created')) AS created,
                   json_extract(data, '$.time.completed') AS completed
            FROM session_message WHERE +session_id = ? AND id IN (${Array.from({ length: count }, () => "?").join(",")})`;
}

class V2StoreReader {
  path;
  pool;
  db;
  connection;
  closed = false;
  constructor(path, pool) {
    this.path = path;
    this.pool = pool;
    this.connection = pool ? pool.acquire(path) : connect(path);
    this.db = this.connection.db;
  }
  hostIdentity() {
    return createHash3("sha256").update(JSON.stringify([hostname(), resolve(this.path), this.connection.identity])).digest("hex");
  }
  prepare(sql) {
    if (this.closed)
      throw new Error("Store reader is closed");
    const statements = this.connection.statements;
    let statement = statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      if (statements.size >= 128)
        statements.clear();
      statements.set(sql, statement);
    }
    return statement;
  }
  close() {
    if (this.closed)
      return;
    this.closed = true;
    if (this.pool)
      this.pool.release(this.connection);
    else
      closeConnection(this.connection);
  }
  page(sessionID, options = {}) {
    return trackDecodeOperation("page", () => {
      const limit = options.limit ?? 100;
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1e4)
        throw new Error("Invalid page limit");
      const after = options.after ?? -1;
      if (!Number.isSafeInteger(after))
        throw new Error("Invalid seq cursor");
      if (options.through !== undefined && !Number.isSafeInteger(options.through))
        throw new Error("Invalid seq upper bound");
      const predicates = ["session_id = ?", "seq > ?"];
      const parameters = [sessionID, after];
      if (options.through !== undefined) {
        predicates.push("seq <= ?");
        parameters.push(options.through);
      }
      if (options.type) {
        predicates.push("type = ?");
        parameters.push(options.type);
      }
      const rows = this.prepare(`SELECT id, session_id, type, seq, time_created, data FROM session_message
                        WHERE ${predicates.join(" AND ")}
                        ORDER BY seq ASC LIMIT ?`).all(...parameters, limit).map(decode);
      return { rows, cursor: rows.at(-1)?.seq };
    });
  }
  messagePage(sessionID, afterOrdinal, limit, finalWatermark, after) {
    return trackDecodeOperation("messagePage", () => {
      if (!Number.isSafeInteger(afterOrdinal) || afterOrdinal < 0)
        throw new Error("Invalid raw-message ordinal cursor");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1e4)
        throw new Error("Invalid page limit");
      if (!Number.isSafeInteger(finalWatermark) || finalWatermark < 0)
        throw new Error("Invalid raw-message watermark");
      const pageSize = Math.min(limit, finalWatermark - afterOrdinal);
      if (pageSize <= 0)
        return [];
      if (after) {
        const anchor = this.prepare("SELECT seq FROM session_message WHERE session_id = ? AND id = ?").get(sessionID, after.id);
        if (anchor) {
          return this.prepare(`SELECT id, session_id, type, seq, time_created, data
                        FROM session_message WHERE session_id = ? AND seq > ?
                        AND type IN (${RAW_MESSAGE_TYPE_PARAMETERS}) ORDER BY seq ASC LIMIT ?`).all(sessionID, anchor.seq, ...RAW_MESSAGE_TYPES, pageSize).map(decode);
        }
      }
      const maximumSeq = Number.MAX_SAFE_INTEGER;
      const rows = this.prepare(V2_MESSAGE_PAGE_SQL).all(afterOrdinal, sessionID, ...RAW_MESSAGE_TYPES, Math.max(0, afterOrdinal - 1), sessionID, sessionID, ...RAW_MESSAGE_TYPES, finalWatermark - 1, maximumSeq, sessionID, ...RAW_MESSAGE_TYPES, pageSize);
      return rows.map(decode);
    });
  }
  messageCount(sessionID) {
    return trackDecodeOperation("messageCount", () => {
      const rawTypes = RAW_MESSAGE_TYPES.map(() => "?").join(", ");
      const row = this.prepare(`SELECT COUNT(*) AS count FROM session_message
                     WHERE session_id = ? AND type IN (${rawTypes})`).get(sessionID, ...RAW_MESSAGE_TYPES);
      return typeof row?.count === "number" ? row.count : 0;
    });
  }
  messageCountAfterSequence(sessionID, after, through) {
    const rawTypes = RAW_MESSAGE_TYPES.map(() => "?").join(", ");
    const row = this.prepare(`SELECT COUNT(*) AS count FROM session_message
             WHERE session_id = ? AND seq > ? AND seq <= ? AND type IN (${rawTypes})`).get(sessionID, after, through, ...RAW_MESSAGE_TYPES);
    return typeof row?.count === "number" ? row.count : 0;
  }
  sessionDirectoryPage(afterSessionID, limit) {
    const rows = this.prepare(`SELECT id, COALESCE(directory, '') AS directory FROM session_v2
                 WHERE id > ? ORDER BY id ASC LIMIT ?`).all(afterSessionID ?? "", limit);
    return rows.map((row) => ({ sessionId: row.id, directory: row.directory }));
  }
  latestMessageTime(sessionID) {
    const row = this.prepare("SELECT MAX(time_created) AS time FROM session_message WHERE session_id = ?").get(sessionID);
    return row?.time ?? undefined;
  }
  isSubagent(sessionID) {
    const row = this.prepare("SELECT parent_id FROM session_v2 WHERE id = ?").get(sessionID);
    if (!row)
      return null;
    return typeof row.parent_id === "string" && row.parent_id.length > 0;
  }
  sessionIds() {
    return this.prepare("SELECT id FROM session_v2").all().map((row) => row.id);
  }
  latestRootSessionInDirectory(directory) {
    const columns = new Set(this.prepare("PRAGMA table_info(session_v2)").all().map((column) => column.name));
    const archived = columns.has("time_archived") ? " AND time_archived IS NULL" : "";
    const order = columns.has("time_updated") ? "time_updated DESC, id DESC" : "id DESC";
    const page = this.prepare(`SELECT id, COALESCE(directory, '') AS directory FROM session_v2
                 WHERE parent_id IS NULL${archived}
                   AND COALESCE(json_extract(metadata, '$.magic_context'), '') <> 'hidden-run'
                 ORDER BY ${order} LIMIT ? OFFSET ?`);
    const pageSize = 500;
    for (let offset = 0;; offset += pageSize) {
      const rows = page.all(pageSize, offset);
      const match = rows.find((row) => sameProjectDirectory(row.directory, directory));
      if (match)
        return match.id;
      if (rows.length < pageSize)
        return;
    }
  }
  rootSessionActivity(sessionIDs) {
    const roots = new Map;
    for (let offset = 0;offset < sessionIDs.length; offset += 500) {
      const chunk = sessionIDs.slice(offset, offset + 500);
      const rows = this.prepare(`SELECT id, (
                    SELECT MAX(time_created) FROM session_message
                    WHERE session_id = session_v2.id AND type = 'user'
                ) AS time FROM session_v2
                WHERE parent_id IS NULL
                  AND COALESCE(json_extract(metadata, '$.magic_context'), '') <> 'hidden-run'
                  AND id IN (${chunk.map(() => "?").join(",")})`).all(...chunk);
      for (const row of rows)
        if (row.time !== null)
          roots.set(row.id, row.time);
    }
    return roots;
  }
  oldestUserMessageTimesSince(sessionIDs, sinceMs) {
    const result = new Map;
    for (let offset = 0;offset < sessionIDs.length; offset += 500) {
      const chunk = sessionIDs.slice(offset, offset + 500);
      const rows = this.prepare(`SELECT session_id, MIN(time_created) AS time FROM session_message
                WHERE type = 'user' AND time_created > ? AND session_id IN (${chunk.map(() => "?").join(",")})
                GROUP BY session_id`).all(sinceMs, ...chunk);
      for (const row of rows)
        result.set(row.session_id, row.time);
    }
    return result;
  }
  retrospectiveUserPage(sessionID, options) {
    const { boundaryMs, before, limit, maxChars, truncationMarker } = options;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1e4)
      throw new Error("Invalid page limit");
    if (!Number.isSafeInteger(maxChars) || maxChars <= truncationMarker.length)
      throw new Error("Invalid text limit");
    const direction = before ? "DESC" : "ASC";
    const head = Math.floor((maxChars - truncationMarker.length) / 2);
    const tail = maxChars - truncationMarker.length - head;
    return this.prepare(`WITH users AS (
            SELECT session_id, seq, time_created, data FROM session_message
            WHERE session_id = ? AND type = 'user' AND time_created ${before ? "<=" : ">"}
                ?
            ORDER BY time_created ${direction}, seq ${direction} LIMIT ?
        ), texts AS (
            SELECT session_id, seq, time_created, CASE
                WHEN json_extract(data, '$.synthetic') = 1 OR json_extract(data, '$.ignored') = 1 THEN ''
                WHEN json_type(data, '$.text') = 'text' THEN json_extract(data, '$.text')
                ELSE COALESCE((SELECT group_concat(json_extract(value, '$.text'), char(10))
                    FROM json_each(users.data, '$.content')
                    WHERE json_extract(value, '$.type') IN ('text', 'input_text')
                      AND COALESCE(json_extract(value, '$.synthetic'), 0) <> 1
                      AND COALESCE(json_extract(value, '$.ignored'), 0) <> 1), '') END AS text
            FROM users WHERE json_valid(data)
        ) SELECT seq, time_created, CASE WHEN length(text) > ?
            THEN substr(text, 1, ?) || ? || substr(text, -?) ELSE text END AS text,
            EXISTS (
                SELECT 1 FROM session_message assistant_reply
                 WHERE assistant_reply.session_id = texts.session_id
                   AND assistant_reply.type = 'assistant'
                   AND assistant_reply.seq < texts.seq
                   AND EXISTS (
                       SELECT 1 FROM session_message prior_user
                        WHERE prior_user.session_id = texts.session_id
                          AND prior_user.type = 'user'
                          AND prior_user.seq < assistant_reply.seq
                   )
            ) AS follows_assistant_reply
          FROM texts ORDER BY time_created ${direction}, seq ${direction}`).all(sessionID, boundaryMs, limit, maxChars, head, truncationMarker, tail);
  }
  storedRowsAfter(sessionID, after) {
    const row = this.prepare("SELECT COUNT(*) AS count FROM session_message WHERE session_id = ? AND seq > ?").get(sessionID, after);
    return row.count;
  }
  storedMessageCount(sessionID) {
    return trackDecodeOperation("storedMessageCount", () => {
      const row = this.prepare("SELECT COUNT(*) AS count FROM session_message WHERE session_id = ?").get(sessionID);
      return typeof row?.count === "number" ? row.count : 0;
    });
  }
  messageById(sessionID, id) {
    return trackDecodeOperation("messageById", () => {
      const rawTypes = RAW_MESSAGE_TYPES.map(() => "?").join(", ");
      const row = this.prepare(`SELECT id, session_id, type, seq, time_created, data FROM session_message
                     WHERE session_id = ? AND id = ? AND type IN (${rawTypes}) LIMIT 1`).get(sessionID, id, ...RAW_MESSAGE_TYPES);
      return row ? decode(row) : null;
    });
  }
  messageTimes(sessionID, ids) {
    const times = new Map;
    for (let offset = 0;offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      const rows = this.prepare(messageTimesQuery(batch.length)).all(sessionID, ...batch);
      for (const row of rows)
        times.set(row.id, {
          created: typeof row.created === "number" ? row.created : undefined,
          completed: typeof row.completed === "number" ? row.completed : undefined
        });
    }
    return times;
  }
  messageExistsById(sessionID, id) {
    return trackDecodeOperation("messageExistsById", () => {
      const rawTypes = RAW_MESSAGE_TYPES.map(() => "?").join(", ");
      const row = this.prepare(`SELECT 1 FROM session_message
                     WHERE id = ? AND session_id = ? AND type IN (${rawTypes}) LIMIT 1`).get(id, sessionID, ...RAW_MESSAGE_TYPES);
      return row != null;
    });
  }
  messageOrdinalById(sessionID, id) {
    return trackDecodeOperation("messageOrdinalById", () => {
      const rawTypes = RAW_MESSAGE_TYPES.map(() => "?").join(", ");
      const row = this.prepare(`WITH target AS (
                        SELECT seq FROM session_message
                        WHERE session_id = ? AND id = ? AND type IN (${rawTypes})
                        LIMIT 1
                    )
                    SELECT (
                        SELECT COUNT(*) FROM session_message
                        WHERE session_id = ?
                          AND type IN (${rawTypes})
                          AND seq <= target.seq
                    ) AS ordinal
                    FROM target`).get(sessionID, id, ...RAW_MESSAGE_TYPES, sessionID, ...RAW_MESSAGE_TYPES);
      return typeof row?.ordinal === "number" ? row.ordinal : null;
    });
  }
  messageIdOrdinals(sessionID, fromOrdinal, toOrdinal) {
    return trackDecodeOperation("messageIdOrdinals", () => {
      if (!Number.isSafeInteger(fromOrdinal) || fromOrdinal < 1)
        throw new Error("Invalid raw-message range start");
      if (!Number.isSafeInteger(toOrdinal) || toOrdinal < fromOrdinal)
        throw new Error("Invalid raw-message range end");
      const rawTypes = RAW_MESSAGE_TYPES.map(() => "?").join(", ");
      const rows = this.prepare(`SELECT id FROM session_message
                     WHERE session_id = ? AND type IN (${rawTypes})
                     ORDER BY seq ASC LIMIT ? OFFSET ?`).all(sessionID, ...RAW_MESSAGE_TYPES, toOrdinal - fromOrdinal + 1, fromOrdinal - 1);
      return new Map(rows.map((row, index) => [row.id, fromOrdinal + index]));
    });
  }
  messageOrdinalPage(sessionID, after, limit) {
    return trackDecodeOperation("messageOrdinalPage", () => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1e4)
        throw new Error("Invalid page limit");
      const rows = after ? this.prepare(`SELECT id, type, seq, json_valid(data) AS valid
                               FROM session_message
                               WHERE session_id = ? AND (seq > ? OR (seq = ? AND id > ?))
                               ORDER BY seq ASC, id ASC LIMIT ?`).all(sessionID, after.timeCreated, after.timeCreated, after.id, limit) : this.prepare(`SELECT id, type, seq, json_valid(data) AS valid
                               FROM session_message
                               WHERE session_id = ?
                               ORDER BY seq ASC, id ASC LIMIT ?`).all(sessionID, limit);
      const rawTypes = new Set(RAW_MESSAGE_TYPES);
      return rows.map((row) => ({
        id: row.id,
        timeCreated: row.seq,
        contributesOrdinal: rawTypes.has(row.type),
        hasValidInfo: row.valid === 1
      }));
    });
  }
  range(sessionID, after, through) {
    return trackDecodeOperation("range", () => through <= after ? [] : this.all(sessionID, after, undefined, through));
  }
  spanRowStamps(sessionID, after, through) {
    if (!Number.isSafeInteger(after) || !Number.isSafeInteger(through))
      throw new Error("Invalid seq span");
    const rows = this.prepare(`SELECT seq, id, time_updated AS updated, length(CAST(data AS BLOB)) AS bytes
                 FROM session_message WHERE session_id = ? AND seq > ? AND seq <= ?
                 ORDER BY seq ASC`).all(sessionID, after, through);
    const stamps = new Map;
    for (const row of rows)
      stamps.set(row.seq, `${row.id}\x00${row.updated ?? ""}\x00${row.bytes ?? ""}`);
    return stamps;
  }
  rawRowsThrough(sessionID, throughSeq, limit) {
    return trackDecodeOperation("rawRowsThrough", () => {
      if (!Number.isSafeInteger(throughSeq))
        throw new Error("Invalid seq upper bound");
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1e4)
        throw new Error("Invalid page limit");
      const rawTypes = RAW_MESSAGE_TYPES.map(() => "?").join(", ");
      return this.prepare(`SELECT id, session_id, type, seq, time_created, data FROM session_message
                         WHERE session_id = ? AND type IN (${rawTypes}) AND seq <= ?
                         ORDER BY seq DESC LIMIT ?`).all(sessionID, ...RAW_MESSAGE_TYPES, throughSeq, limit).map(decode);
    });
  }
  instructionRowsThrough(sessionID, throughSeq) {
    return trackDecodeOperation("instructionRowsThrough", () => {
      if (!Number.isSafeInteger(throughSeq))
        throw new Error("Invalid seq upper bound");
      return this.prepare(`SELECT id, session_id, type, seq, time_created, data FROM session_message
                         WHERE session_id = ? AND type = 'system' AND seq <= ?
                         ORDER BY seq ASC`).all(sessionID, throughSeq).map(decode);
    });
  }
  sequenceForId(sessionID, id) {
    if (!id)
      return;
    const row = this.prepare("SELECT seq FROM session_message WHERE session_id = ? AND id = ? LIMIT 1").get(sessionID, id);
    return typeof row?.seq === "number" ? row.seq : undefined;
  }
  syntheticMessageIDs(sessionID) {
    const rows = this.prepare("SELECT id FROM session_message WHERE session_id = ? AND type = 'synthetic'").all(sessionID);
    return new Set(rows.map((row) => row.id));
  }
  forkOrigin(sessionID) {
    const columns = new Set(this.prepare("PRAGMA table_info(session_v2)").all().map((column) => column.name));
    if (!columns.has("fork_session_id") || !columns.has("fork_boundary"))
      return null;
    const row = this.prepare("SELECT fork_session_id, fork_boundary FROM session_v2 WHERE id = ?").get(sessionID);
    if (!row?.fork_session_id || !row.fork_boundary)
      return null;
    try {
      const boundary = JSON.parse(row.fork_boundary);
      if (boundary.type !== "before" && boundary.type !== "through" || typeof boundary.messageID !== "string" || boundary.messageID.length === 0)
        return null;
      return {
        parentSessionID: row.fork_session_id,
        boundary: { type: boundary.type, messageID: boundary.messageID }
      };
    } catch {
      return null;
    }
  }
  sessionExists(sessionID) {
    return this.prepare("SELECT 1 FROM session_v2 WHERE id = ?").get(sessionID) != null;
  }
  rowStampsThrough(sessionID, throughSeq) {
    return this.prepare(`SELECT id, type, seq, time_created FROM session_message
                 WHERE session_id = ? AND seq <= ? ORDER BY seq ASC`).all(sessionID, throughSeq);
  }
  latestSequenceForIds(sessionID, ids) {
    let latest = -1;
    for (let offset = 0;offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500);
      const row = this.prepare(`SELECT MAX(seq) AS seq FROM session_message
                     WHERE session_id = ? AND id IN (${chunk.map(() => "?").join(", ")})`).get(sessionID, ...chunk);
      if (typeof row?.seq === "number")
        latest = Math.max(latest, row.seq);
    }
    return latest;
  }
  compactionByStatus(sessionID, status) {
    const row = this.prepare(`SELECT id, session_id, type, seq, time_created, data FROM session_message
                WHERE session_id = ? AND type = 'compaction'
                  AND json_extract(data, '$.status') = ?
                ORDER BY seq DESC LIMIT 1`).get(sessionID, status);
    return row ? decode(row) : undefined;
  }
  latestCompaction(sessionID) {
    return trackDecodeOperation("latestCompaction", () => this.compactionByStatus(sessionID, "completed"));
  }
  latestRunningCompaction(sessionID) {
    return trackDecodeOperation("latestRunningCompaction", () => this.compactionByStatus(sessionID, "running"));
  }
  idleRows(sessionID, after = -1) {
    return trackDecodeOperation("idleRows", () => this.all(sessionID, after, "idle"));
  }
  earliestSequence(sessionID) {
    const row = this.prepare("SELECT MIN(seq) AS seq FROM session_message WHERE session_id = ?").get(sessionID);
    return typeof row?.seq === "number" ? row.seq : undefined;
  }
  latestSequence(sessionID) {
    const row = this.prepare("SELECT MAX(seq) AS seq FROM session_message WHERE session_id = ?").get(sessionID);
    return typeof row?.seq === "number" ? row.seq : -1;
  }
  assistantSince(sessionID, afterSeq) {
    return trackDecodeOperation("assistantSince", () => {
      const rows = this.prepare(`SELECT id, session_id, type, seq, time_created, data FROM session_message
                    WHERE session_id = ? AND type = 'assistant' AND seq > ?
                    ORDER BY seq ASC`).all(sessionID, afterSeq);
      return rows.map((row) => decode(row));
    });
  }
  latestAssistant(sessionID) {
    return trackDecodeOperation("latestAssistant", () => {
      const row = this.prepare(`SELECT id, session_id, type, seq, time_created, data FROM session_message
                    WHERE session_id = ? AND type = 'assistant'
                    ORDER BY seq DESC LIMIT 1`).get(sessionID);
      return row ? decode(row) : undefined;
    });
  }
  latestIdle(sessionID) {
    return trackDecodeOperation("latestIdle", () => {
      const row = this.prepare(`SELECT id, session_id, type, seq, time_created, data FROM session_message
                    WHERE session_id = ? AND type = 'idle'
                    ORDER BY seq DESC LIMIT 1`).get(sessionID);
      return row ? decode(row) : undefined;
    });
  }
  window(sessionID) {
    return trackDecodeOperation("window", () => this.db.transaction(() => {
      const cut = this.latestCompaction(sessionID);
      return this.all(sessionID, cut ? cut.seq - 1 : -1);
    }).deferred());
  }
  history(sessionID) {
    return trackDecodeOperation("history", () => this.all(sessionID, -1));
  }
  all(sessionID, after, type, through) {
    const rows = [];
    for (;; ) {
      const page = this.page(sessionID, { after, through, type });
      rows.push(...page.rows);
      if (page.rows.length < 100 || page.cursor === undefined)
        return rows;
      after = page.cursor;
    }
  }
}

// ../plugin/src/features/magic-context/session-activity.ts
var PREFIX = "retrospective_activity:";
var INTERVAL_MS = 15000;
var pending = new WeakMap;
function sessionActivityKey(sessionId) {
  return `${PREFIX}${sessionId}`;
}
function deleteSessionActivity(db, sessionIds) {
  if (sessionIds.length === 0)
    return;
  const sessions = pending.get(db);
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
  let sessions = pending.get(db);
  if (!sessions) {
    sessions = new Map;
    pending.set(db, sessions);
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
var SESSION_CLEANUP_SLICE_ROWS = 64;
function deleteSessionScopedRowsSlice(db, sessionId, harness) {
  if (cleanupStatement(db, "SELECT 1 FROM pending_session_cleanup WHERE session_id = ? AND harness = ?").get(sessionId, `${harness}:rust`))
    return { complete: true, deleted: 0 };
  cleanupStatement(db, "INSERT OR IGNORE INTO schema_migrations_meta(key,value) VALUES (?,?)").run(tagTombstoneOwnerKey(sessionId, harness), harness);
  let remaining = SESSION_CLEANUP_SLICE_ROWS;
  const started = performance.now();
  remaining -= deleteChunkEmbedBackoffForSession2(db, sessionId, remaining);
  if (remaining <= 0)
    return { complete: false, deleted: 0 };
  for (const definition of SESSION_SCOPED_TABLES) {
    if (definition.table === "message_history_fts") {
      const rows = cleanupStatement(db, "SELECT fts_rowid AS id FROM message_fts_rowid_map WHERE session_id = ? LIMIT ?").all(sessionId, remaining);
      const removeFts = cleanupStatement(db, "DELETE FROM message_history_fts WHERE rowid = ?");
      const removeMap = cleanupStatement(db, "DELETE FROM message_fts_rowid_map WHERE session_id = ? AND fts_rowid = ?");
      for (const row of rows) {
        removeFts.run(row.id);
        removeMap.run(sessionId, row.id);
      }
      remaining -= rows.length;
      if (remaining > 0 && !getMessageFtsRowidMapBackfillProgress2(db).completed)
        remaining -= cleanupStatement(db, `DELETE FROM message_history_fts WHERE rowid IN (
                    SELECT rowid FROM message_history_fts WHERE session_id = ? LIMIT ?
                )`).run(sessionId, remaining).changes;
    } else {
      const predicates = ["session_id = ?"];
      if (definition.extraPredicate)
        predicates.push(definition.extraPredicate);
      if (definition.harnessScoped)
        predicates.push("harness = ?");
      const args = [sessionId, ...definition.harnessScoped ? [harness] : [], remaining];
      const withoutRowid = definition.table === "temporal_decisions" || definition.table === "session_replay_decisions";
      const key = withoutRowid ? "message_id" : "rowid";
      remaining -= cleanupStatement(db, `DELETE FROM ${definition.table}
                WHERE ${withoutRowid ? "session_id = ? AND " : ""}${key} IN (
                    SELECT ${key} FROM ${definition.table} WHERE ${predicates.join(" AND ")} LIMIT ?
                )`).run(...withoutRowid ? [sessionId] : [], ...args).changes;
    }
    if (remaining <= 0 || performance.now() - started >= 10)
      return { complete: false, deleted: 0 };
  }
  return {
    complete: true,
    deleted: deleteSessionScopedRows(db, [sessionId], harness, {
      deferRecoveryFenceCleanup: true
    })
  };
}

// ../plugin/src/features/magic-context/compression-depth-storage.ts
var incrementDepthStatements = new WeakMap;
var totalDepthStatements = new WeakMap;
var maxDepthStatements = new WeakMap;
var clearDepthStatements = new WeakMap;
function getClearDepthStatement(db) {
  let stmt = clearDepthStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM compression_depth WHERE session_id = ?");
    clearDepthStatements.set(db, stmt);
  }
  return stmt;
}
function clearCompressionDepth(db, sessionId) {
  getClearDepthStatement(db).run(sessionId);
}
function clearCompressionDepthRange(db, sessionId, startOrdinal, endOrdinal) {
  if (endOrdinal < startOrdinal) {
    return;
  }
  db.prepare("DELETE FROM compression_depth WHERE session_id = ? AND message_ordinal BETWEEN ? AND ?").run(sessionId, startOrdinal, endOrdinal);
}

// ../plugin/src/features/magic-context/message-index.ts
import { createHash as createHash4 } from "node:crypto";

// ../plugin/src/shared/search-text.ts
function removeTaskNotifications(text) {
  return removeNestedBlocks(text, ["task", "task_cohort"]);
}
function cleanSearchText(text) {
  return removeNestedBlocks(text, ["system-reminder", "task", "task_cohort"]).replace(/\s+/g, " ").trim();
}
var QUERY_STOP_WORDS = new Set("a an and are as at be been by can could did do does for from how i in is it me my of on or our please should that the their them there these they this to us was we were what when where which who why will with would you your".split(" "));
function terms(text) {
  return [
    ...new Set((text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((term) => !QUERY_STOP_WORDS.has(term)))
  ];
}
function keywordRelevance(query, content) {
  const needles = terms(query);
  if (needles.length === 0)
    return 0;
  const words = new Set(terms(cleanSearchText(content)));
  return 0.8 * needles.filter((term) => words.has(term)).length / needles.length;
}
function matchedSearchSnippet(content, query, cap = 220) {
  const text = cleanSearchText(content);
  const needles = new Set(terms(query));
  const matches = [...text.matchAll(/[\p{L}\p{N}_]+/gu)].filter((match) => needles.has(match[0].toLowerCase()));
  if (matches.length === 0)
    return "";
  let bestStart = matches[0].index;
  let bestCoverage = -1;
  for (const match of matches) {
    const start = Math.max(0, match.index - Math.floor(cap / 5));
    const coverage = keywordRelevance(query, text.slice(start, start + cap));
    if (coverage > bestCoverage) {
      bestStart = start;
      bestCoverage = coverage;
    }
  }
  if (bestStart > 0) {
    const boundary = text.indexOf(" ", bestStart);
    if (boundary >= 0 && boundary < matches[matches.length - 1].index)
      bestStart = boundary + 1;
  }
  const passage = text.slice(bestStart, bestStart + cap).trim();
  return `${bestStart > 0 ? "…" : ""}${passage}${bestStart + cap < text.length ? "…" : ""}`;
}

// ../plugin/src/features/magic-context/message-index.ts
var MESSAGE_HISTORY_ORPHAN_SWEEP_BATCH_SIZE = 200;
var MESSAGE_HISTORY_ORPHAN_SAFETY_AGE_MS = 24 * 60 * 60 * 1000;
var MESSAGE_HISTORY_ORPHAN_SWEEP_COOLDOWN_MS = 10 * 60 * 1000;
var MESSAGE_HISTORY_ORPHAN_UNAVAILABLE_REPROBE_MS = 24 * 60 * 60 * 1000;
var lastIndexedStatements = new WeakMap;
var insertMessageStatements = new WeakMap;
var upsertProgressStatements = new WeakMap;
var upsertDirtyFloorStatements = new WeakMap;
var deleteFtsStatements = new WeakMap;
var deleteFtsRangeStatements = new WeakMap;
var deleteIndexStatements = new WeakMap;
var countIndexedMessageStatements = new WeakMap;
var getMessageSourceStatements = new WeakMap;
var upsertMessageSourceStatements = new WeakMap;
var deleteMessageSourceStatements = new WeakMap;
var deleteMessageSourceRangeStatements = new WeakMap;
var deleteMessageFtsStatements = new WeakMap;
var deleteFtsMapStatements = new WeakMap;
var deleteFtsMapRangeStatements = new WeakMap;
var deleteMessageFtsMapStatements = new WeakMap;
var MESSAGE_INDEX_MAX_FTS_BYTES2 = 64 * 1024;
var skipStatements = new WeakMap;
function skipStatement(db, sql) {
  const statements = skipStatements.get(db) ?? new Map;
  skipStatements.set(db, statements);
  let statement = statements.get(sql);
  if (!statement) {
    statement = db.prepare(sql);
    statements.set(sql, statement);
  }
  return statement;
}
var messageIndexSkipKey2 = (sessionId, messageId) => `message_index_skip:${JSON.stringify([sessionId, messageId])}`;
function deleteMessageIndexSkips(db, sessionId, messageId) {
  if (messageId !== undefined) {
    skipStatement(db, "DELETE FROM schema_migrations_meta WHERE key=?").run(messageIndexSkipKey2(sessionId, messageId));
  } else {
    const prefix = `message_index_skip:${JSON.stringify([sessionId]).slice(0, -1)},`;
    skipStatement(db, "DELETE FROM schema_migrations_meta WHERE substr(key,1,length(?))=?").run(prefix, prefix);
  }
}
function normalizeIndexText(text) {
  return text.replace(/\s+/g, " ").trim();
}
function getLastIndexedStatement(db) {
  let stmt = lastIndexedStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT last_indexed_ordinal, dirty_floor_ordinal FROM message_history_index WHERE session_id = ?");
    lastIndexedStatements.set(db, stmt);
  }
  return stmt;
}
function getInsertMessageStatement(db) {
  let stmt = insertMessageStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("INSERT INTO message_history_fts (session_id, message_ordinal, message_id, role, content) VALUES (?, ?, ?, ?, ?)");
    insertMessageStatements.set(db, stmt);
  }
  return stmt;
}
function getUpsertProgressStatement(db) {
  let stmt = upsertProgressStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("INSERT INTO message_history_index (session_id, last_indexed_ordinal, dirty_floor_ordinal, updated_at, harness) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET last_indexed_ordinal = excluded.last_indexed_ordinal, dirty_floor_ordinal = excluded.dirty_floor_ordinal, updated_at = excluded.updated_at");
    upsertProgressStatements.set(db, stmt);
  }
  return stmt;
}
function getUpsertDirtyFloorStatement(db) {
  let stmt = upsertDirtyFloorStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("INSERT INTO message_history_index (session_id, last_indexed_ordinal, dirty_floor_ordinal, updated_at, harness) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET last_indexed_ordinal = MAX(message_history_index.last_indexed_ordinal, excluded.last_indexed_ordinal), dirty_floor_ordinal = CASE WHEN message_history_index.dirty_floor_ordinal <= 0 THEN excluded.dirty_floor_ordinal WHEN excluded.dirty_floor_ordinal <= 0 THEN message_history_index.dirty_floor_ordinal ELSE MIN(message_history_index.dirty_floor_ordinal, excluded.dirty_floor_ordinal) END, updated_at = excluded.updated_at");
    upsertDirtyFloorStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteFtsStatement(db) {
  let stmt = deleteFtsStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`DELETE FROM message_history_fts
             WHERE rowid IN (
                 SELECT fts_rowid FROM message_fts_rowid_map WHERE session_id = ?
             )`);
    deleteFtsStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteFtsRangeStatement(db) {
  let stmt = deleteFtsRangeStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`DELETE FROM message_history_fts
             WHERE rowid IN (
                 SELECT fts_rowid
                 FROM message_fts_rowid_map
                 WHERE session_id = ? AND message_ordinal BETWEEN ? AND ?
             )`);
    deleteFtsRangeStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteIndexStatement(db) {
  let stmt = deleteIndexStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM message_history_index WHERE session_id = ?");
    deleteIndexStatements.set(db, stmt);
  }
  return stmt;
}
function getCountIndexedMessageStatement(db) {
  let stmt = countIndexedMessageStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT COUNT(*) AS count
             FROM message_history_source AS source
             JOIN message_fts_rowid_map AS map
               ON map.session_id = source.session_id
              AND map.message_ordinal = source.message_ordinal
             WHERE source.session_id = ? AND source.message_id = ?`);
    countIndexedMessageStatements.set(db, stmt);
  }
  return stmt;
}
function getMessageSourceStatement(db) {
  let stmt = getMessageSourceStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT message_ordinal, source_version, normalized_content_hash, role FROM message_history_source WHERE session_id = ? AND message_id = ?");
    getMessageSourceStatements.set(db, stmt);
  }
  return stmt;
}
function getUpsertMessageSourceStatement(db) {
  let stmt = upsertMessageSourceStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`INSERT INTO message_history_source (
                 session_id, message_id, message_ordinal, source_version,
                 normalized_content_hash, role, harness, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_id, message_id) DO UPDATE SET
                 message_ordinal = excluded.message_ordinal,
                 source_version = excluded.source_version,
                 normalized_content_hash = excluded.normalized_content_hash,
                 role = excluded.role,
                 harness = excluded.harness,
                 updated_at = excluded.updated_at`);
    upsertMessageSourceStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteMessageSourceStatement(db) {
  let stmt = deleteMessageSourceStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM message_history_source WHERE session_id = ?");
    deleteMessageSourceStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteMessageSourceRangeStatement(db) {
  let stmt = deleteMessageSourceRangeStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM message_history_source WHERE session_id = ? AND message_ordinal BETWEEN ? AND ?");
    deleteMessageSourceRangeStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteMessageFtsStatement(db) {
  let stmt = deleteMessageFtsStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`DELETE FROM message_history_fts
             WHERE rowid IN (
                 SELECT map.fts_rowid
                 FROM message_history_source AS source
                 JOIN message_fts_rowid_map AS map
                   ON map.session_id = source.session_id
                  AND map.message_ordinal = source.message_ordinal
                 WHERE source.session_id = ? AND source.message_id = ?
             )`);
    deleteMessageFtsStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteFtsMapStatement(db) {
  let stmt = deleteFtsMapStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM message_fts_rowid_map WHERE session_id = ?");
    deleteFtsMapStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteFtsMapRangeStatement(db) {
  let stmt = deleteFtsMapRangeStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM message_fts_rowid_map WHERE session_id = ? AND message_ordinal BETWEEN ? AND ?");
    deleteFtsMapRangeStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteMessageFtsMapStatement(db) {
  let stmt = deleteMessageFtsMapStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`DELETE FROM message_fts_rowid_map
             WHERE session_id = ?
               AND message_ordinal = (
                   SELECT message_ordinal
                   FROM message_history_source
                   WHERE session_id = ? AND message_id = ?
               )`);
    deleteMessageFtsMapStatements.set(db, stmt);
  }
  return stmt;
}
function insertMessageFtsRow(db, sessionId, messageOrdinal, messageId, role, content, messageTimeMs) {
  const result = getInsertMessageStatement(db).run(sessionId, messageOrdinal, messageId, role, content);
  recordMessageFtsRowid2(db, sessionId, messageOrdinal, result.lastInsertRowid, messageTimeMs ?? null);
}
function normalizeSourceVersion(version) {
  if (typeof version === "number")
    return `number:${version}`;
  if (typeof version === "string")
    return `string:${version}`;
  return "null";
}
function toMessageIndexSource2(message) {
  const content = getIndexableContent2(message.role, message.parts);
  return {
    id: message.id,
    ordinal: message.ordinal,
    role: message.role,
    createdAt: message.createdAt,
    sourceVersion: normalizeSourceVersion(message.version),
    contentHash: createHash4("sha256").update(content).digest("hex"),
    content
  };
}
function getMessageSourceSnapshot(message) {
  return toMessageIndexSource2(message);
}
function getMessageIndexSourceIdentity2(message) {
  const source = getMessageSourceSnapshot(message);
  return JSON.stringify([
    source.ordinal,
    source.sourceVersion,
    source.contentHash,
    source.role,
    message.createdAt ?? null
  ]);
}
function isMessageIndexSourceCurrent2(db, sessionId, message) {
  const source = getMessageSourceSnapshot(message);
  return isIndexSourceCurrent(db, sessionId, source);
}
function isIndexSourceCurrent(db, sessionId, source) {
  const row = getMessageSourceStatement(db).get(sessionId, source.id);
  return row?.message_ordinal === source.ordinal && row.source_version === source.sourceVersion && row.normalized_content_hash === source.contentHash && row.role === source.role;
}
function writeMessageSource(db, sessionId, source, now) {
  getUpsertMessageSourceStatement(db).run(sessionId, source.id, source.ordinal, source.sourceVersion, source.contentHash, source.role, getHarness2(), now);
  const bytes = Buffer.byteLength(source.content);
  if (source.ftsSkippedBytes !== undefined || bytes > MESSAGE_INDEX_MAX_FTS_BYTES2) {
    skipStatement(db, "INSERT INTO schema_migrations_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(messageIndexSkipKey2(sessionId, source.id), JSON.stringify({
      reason: "oversized",
      bytes: source.ftsSkippedBytes ?? bytes,
      contentHash: source.contentHash,
      ordinal: source.ordinal,
      complete: true
    }));
    return "";
  }
  skipStatement(db, "DELETE FROM schema_migrations_meta WHERE key=?").run(messageIndexSkipKey2(sessionId, source.id));
  return source.content;
}
function getLastIndexedOrdinal2(db, sessionId) {
  const row = getLastIndexedStatement(db).get(sessionId);
  return typeof row?.last_indexed_ordinal === "number" ? row.last_indexed_ordinal : 0;
}
function getIndexedMessageCorpusSize2(db, sessionId, maxOrdinal) {
  const watermark = getLastIndexedOrdinal2(db, sessionId);
  return maxOrdinal === null ? watermark : Math.min(watermark, Math.max(0, maxOrdinal));
}
function getDirtyIndexFloor(db, sessionId) {
  const row = getLastIndexedStatement(db).get(sessionId);
  return typeof row?.dirty_floor_ordinal === "number" && row.dirty_floor_ordinal > 0 ? row.dirty_floor_ordinal : null;
}
function markMessageIndexDirty2(db, sessionId, floorOrdinal) {
  const dirtyFloor = Math.max(1, Math.floor(floorOrdinal));
  getUpsertDirtyFloorStatement(db).run(sessionId, getLastIndexedOrdinal2(db, sessionId), dirtyFloor, Date.now(), getHarness2());
}
function isMessageAlreadyIndexed(db, sessionId, messageId) {
  const row = getCountIndexedMessageStatement(db).get(sessionId, messageId);
  return (typeof row?.count === "number" ? row.count : 0) > 0;
}
function setIndexProgress(db, sessionId, watermark, dirtyFloor, now) {
  getUpsertProgressStatement(db).run(sessionId, Math.max(0, Math.floor(watermark)), dirtyFloor ?? 0, now, getHarness2());
}
function getMessageIndexReconciliationStartOrdinal2(db, sessionId) {
  const watermark = getLastIndexedOrdinal2(db, sessionId);
  const dirtyFloor = getDirtyIndexFloor(db, sessionId);
  return dirtyFloor === null ? watermark : Math.min(watermark, dirtyFloor - 1);
}
function isMessageIndexReconciledThrough2(db, sessionId, finalWatermark) {
  const dirtyFloor = getDirtyIndexFloor(db, sessionId);
  return getLastIndexedOrdinal2(db, sessionId) >= finalWatermark && dirtyFloor === null;
}
function deleteIndexedMessage2(db, sessionId, messageId) {
  deleteMessageIndexSkips(db, sessionId, messageId);
  const row = getCountIndexedMessageStatement(db).get(sessionId, messageId);
  const count = typeof row?.count === "number" ? row.count : 0;
  clearIndexedMessages2(db, sessionId);
  return count;
}
function clearIndexedMessagesInTransaction2(db, sessionId) {
  deleteMessageIndexSkips(db, sessionId);
  getDeleteFtsStatement(db).run(sessionId);
  deleteUnmappedMessageFtsRows2(db, [sessionId]);
  getDeleteFtsMapStatement(db).run(sessionId);
  getDeleteMessageSourceStatement(db).run(sessionId);
  getDeleteIndexStatement(db).run(sessionId);
  clearCompressionDepth(db, sessionId);
}
function clearIndexedMessages2(db, sessionId) {
  let transactionStartedAt = 0;
  db.transaction(() => {
    transactionStartedAt = performance.now();
    clearIndexedMessagesInTransaction2(db, sessionId);
  }).immediate();
  logSlowWriteTransaction("message_index_clear", transactionStartedAt);
}
function getIndexableContent2(role, parts) {
  if (role === "user") {
    if (!hasMeaningfulUserText2(parts)) {
      return "";
    }
    return extractTexts2(parts).map(removeTaskNotifications).map(cleanUserText2).map(normalizeIndexText).filter((text) => text.length > 0).join(" / ");
  }
  if (role === "assistant") {
    return extractTexts2(parts).map(removeTaskNotifications).map(removeSystemReminders).map(normalizeIndexText).filter((text) => text.length > 0).join(" / ");
  }
  return "";
}
function indexSingleMessageInTransaction(db, sessionId, message, now, dirtyFloorBeforeAttempt, source) {
  const currentWatermark = getLastIndexedOrdinal2(db, sessionId);
  const dirtyFloor = getDirtyIndexFloor(db, sessionId);
  if (message.ordinal <= currentWatermark) {
    if (isIndexSourceCurrent(db, sessionId, source)) {
      recordIndexedMessageTime2(db, sessionId, message.ordinal, message.createdAt);
      return false;
    }
    if (!messageFtsOrdinalRangeIsMapped2(db, sessionId, message.ordinal, message.ordinal)) {
      return false;
    }
    getDeleteMessageFtsStatement(db).run(sessionId, message.id);
    getDeleteMessageFtsMapStatement(db).run(sessionId, sessionId, message.id);
    const content = writeMessageSource(db, sessionId, source, now);
    if (content.length > 0 && (message.role === "user" || message.role === "assistant")) {
      insertMessageFtsRow(db, sessionId, message.ordinal, message.id, message.role, content, message.createdAt);
    }
    setIndexProgress(db, sessionId, currentWatermark, dirtyFloorBeforeAttempt === message.ordinal ? null : dirtyFloorBeforeAttempt, now);
    return true;
  }
  if (message.ordinal !== currentWatermark + 1 || dirtyFloor !== null && dirtyFloor !== message.ordinal) {
    return false;
  }
  const content = writeMessageSource(db, sessionId, source, now);
  let inserted = false;
  if (content.length > 0 && (message.role === "user" || message.role === "assistant") && !isMessageAlreadyIndexed(db, sessionId, message.id)) {
    insertMessageFtsRow(db, sessionId, message.ordinal, message.id, message.role, content, message.createdAt);
    inserted = true;
  }
  setIndexProgress(db, sessionId, message.ordinal, dirtyFloorBeforeAttempt === message.ordinal ? null : dirtyFloorBeforeAttempt, now);
  return inserted;
}
function indexSingleMessage2(db, sessionId, message, shouldCommit = () => true, preparedSource) {
  if (!shouldCommit())
    return false;
  const source = preparedSource ?? getMessageSourceSnapshot(message);
  const currentWatermark = getLastIndexedOrdinal2(db, sessionId);
  if (message.ordinal <= currentWatermark && isIndexSourceCurrent(db, sessionId, source)) {
    recordIndexedMessageTime2(db, sessionId, message.ordinal, message.createdAt);
    return false;
  }
  const dirtyFloorBeforeAttempt = getDirtyIndexFloor(db, sessionId);
  markMessageIndexDirty2(db, sessionId, Math.min(message.ordinal, currentWatermark + 1));
  db.exec("BEGIN IMMEDIATE");
  const transactionStartedAt = performance.now();
  let committed = false;
  try {
    const result = indexSingleMessageInTransaction(db, sessionId, message, Date.now(), dirtyFloorBeforeAttempt, source);
    if (!shouldCommit())
      return false;
    db.exec("COMMIT");
    committed = true;
    logSlowWriteTransaction("message_index_incremental", transactionStartedAt);
    return result;
  } finally {
    if (!committed) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
  }
}
function indexMessagesAfterOrdinal2(db, sessionId, messages, _lastIndexedOrdinal, finalWatermark = messages.length) {
  return indexItemsAfterOrdinal(db, sessionId, messages, finalWatermark, toMessageIndexSource2);
}
function indexSourcesAfterOrdinal2(db, sessionId, sources, finalWatermark) {
  return indexItemsAfterOrdinal(db, sessionId, sources, finalWatermark, (source) => source);
}
function indexItemsAfterOrdinal(db, sessionId, items, finalWatermark, toSource) {
  const now = Date.now();
  let inserted = 0;
  const sources = new Map(items.map((item) => [item.ordinal, toSource(item)]));
  db.exec("BEGIN IMMEDIATE");
  const transactionStartedAt = performance.now();
  let committed = false;
  try {
    const currentWatermark = getLastIndexedOrdinal2(db, sessionId);
    const dirtyFloor = getDirtyIndexFloor(db, sessionId);
    const effectiveWatermark = dirtyFloor === null ? currentWatermark : Math.min(currentWatermark, Math.max(0, dirtyFloor - 1));
    if (dirtyFloor !== null && dirtyFloor <= currentWatermark && !messageFtsOrdinalRangeIsMapped2(db, sessionId, dirtyFloor, Math.min(currentWatermark, finalWatermark))) {
      db.exec("COMMIT");
      committed = true;
      logSlowWriteTransaction("message_index_reconcile", transactionStartedAt);
      return 0;
    }
    if (dirtyFloor !== null && dirtyFloor <= finalWatermark) {
      getDeleteFtsRangeStatement(db).run(sessionId, dirtyFloor, finalWatermark);
      getDeleteFtsMapRangeStatement(db).run(sessionId, dirtyFloor, finalWatermark);
      getDeleteMessageSourceRangeStatement(db).run(sessionId, dirtyFloor, finalWatermark);
    }
    const itemsByOrdinal = new Map;
    for (const item of items) {
      if (item.ordinal > effectiveWatermark && item.ordinal <= finalWatermark) {
        itemsByOrdinal.set(item.ordinal, item);
      }
    }
    let coveredWatermark = effectiveWatermark;
    while (coveredWatermark < finalWatermark && itemsByOrdinal.has(coveredWatermark + 1)) {
      coveredWatermark += 1;
    }
    for (let ordinal = effectiveWatermark + 1;ordinal <= coveredWatermark; ordinal++) {
      const item = itemsByOrdinal.get(ordinal);
      if (!item)
        continue;
      const message = sources.get(ordinal);
      if (!message)
        continue;
      const content = writeMessageSource(db, sessionId, message, now);
      if (content.length === 0 || message.role !== "user" && message.role !== "assistant" || isMessageAlreadyIndexed(db, sessionId, message.id)) {
        continue;
      }
      insertMessageFtsRow(db, sessionId, message.ordinal, message.id, message.role, content, message.createdAt);
      inserted += 1;
    }
    const missingFloor = coveredWatermark < finalWatermark ? coveredWatermark + 1 : null;
    const preservedFloor = dirtyFloor !== null && dirtyFloor > finalWatermark ? dirtyFloor : null;
    const nextDirtyFloor = missingFloor === null ? preservedFloor : preservedFloor === null ? missingFloor : Math.min(missingFloor, preservedFloor);
    setIndexProgress(db, sessionId, coveredWatermark, nextDirtyFloor, now);
    db.exec("COMMIT");
    committed = true;
    logSlowWriteTransaction("message_index_reconcile", transactionStartedAt);
  } finally {
    if (!committed) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
  }
  return inserted;
}
function harnessSupportsOpenCodeOrphanSweep(harness) {
  return harness === "opencode" || harness === "opencode2";
}
function getMessageHistoryOrphanSweepState(db, harness) {
  const state = db.prepare("SELECT cursor_session_id, last_swept_at FROM message_history_orphan_sweep WHERE harness = ?").get(harness) ?? {};
  if (harness === "opencode2") {
    if (!state.cursor_session_id?.startsWith("session_v2:"))
      return {};
    return { ...state, cursor_session_id: state.cursor_session_id.slice("session_v2:".length) };
  }
  return state;
}
function persistMessageHistoryOrphanSweepState(db, cursor, lastSweptAt, harness) {
  db.prepare(`INSERT INTO message_history_orphan_sweep (harness, cursor_session_id, last_swept_at)
          VALUES (?, ?, ?)
         ON CONFLICT(harness) DO UPDATE SET
             cursor_session_id = excluded.cursor_session_id,
             last_swept_at = excluded.last_swept_at`).run(harness, harness === "opencode2" ? `session_v2:${cursor}` : cursor, lastSweptAt);
}
function getOpenCodeSessionScopedCandidateSourceSql(harness) {
  const sources = SESSION_SCOPED_TABLES.filter((definition) => definition.harnessScoped === true).map((definition) => {
    const predicates = ["session_id IS NOT NULL", `harness = '${harness}'`];
    if (definition.extraPredicate)
      predicates.push(definition.extraPredicate);
    return `SELECT session_id FROM ${definition.table} WHERE ${predicates.join(" AND ")}`;
  });
  const jsonId = `SUBSTR(key, ${TAG_TOMBSTONE_OWNER_PREFIX.length + 1}, LENGTH(key) - ${TAG_TOMBSTONE_OWNER_PREFIX.length + harness.length + 1})`;
  sources.push(`SELECT CASE WHEN json_valid(${jsonId}) THEN
        CASE WHEN json_type(${jsonId}) = 'text' THEN json_extract(${jsonId}, '$') END END AS session_id
        FROM schema_migrations_meta WHERE value = '${harness}'
        AND key >= '${TAG_TOMBSTONE_OWNER_PREFIX}' AND key < '${TAG_TOMBSTONE_OWNER_PREFIX.slice(0, -1)};'
        AND SUBSTR(key, -${harness.length + 1}) = ':${harness}'`);
  return sources.join(`
UNION
`);
}
function* sweepOrphanedOpenCodeMessageIndexesInBackground(db, openReadableOpenCodeDb, options = {}) {
  const now = options.now ?? Date.now();
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? MESSAGE_HISTORY_ORPHAN_SWEEP_BATCH_SIZE));
  const safetyAgeMs = Math.max(0, options.safetyAgeMs ?? MESSAGE_HISTORY_ORPHAN_SAFETY_AGE_MS);
  const cooldownMs = Math.max(0, options.cooldownMs ?? MESSAGE_HISTORY_ORPHAN_SWEEP_COOLDOWN_MS);
  const unavailableReprobeMs = Math.max(cooldownMs, options.unavailableReprobeMs ?? MESSAGE_HISTORY_ORPHAN_UNAVAILABLE_REPROBE_MS);
  const harness = getHarness2();
  const state = getMessageHistoryOrphanSweepState(db, harness);
  const cursor = typeof state.cursor_session_id === "string" ? state.cursor_session_id : "";
  if (typeof state.last_swept_at === "number" && state.last_swept_at + cooldownMs > now) {
    return { status: "cooldown", scanned: 0, deleted: 0, cursor };
  }
  if (!harnessSupportsOpenCodeOrphanSweep(harness)) {
    persistMessageHistoryOrphanSweepState(db, cursor, now + unavailableReprobeMs - cooldownMs, harness);
    return { status: "unavailable", scanned: 0, deleted: 0, cursor };
  }
  let openCodeDb = null;
  try {
    openCodeDb = openReadableOpenCodeDb();
  } catch {
    openCodeDb = null;
  }
  if (!openCodeDb) {
    persistMessageHistoryOrphanSweepState(db, cursor, now + unavailableReprobeMs - cooldownMs, harness);
    return { status: "source_unavailable", scanned: 0, deleted: 0, cursor };
  }
  let v2Reader;
  try {
    let sessionExists;
    let liveIds;
    if (harness === "opencode2") {
      try {
        const path = getSqliteDatabasePath2(openCodeDb);
        if (!path)
          throw new Error("OpenCode 2 source has no durable path");
        v2Reader = new V2StoreReader(path);
        liveIds = new Set(v2Reader.sessionIds());
        if (liveIds.size === 0)
          throw new Error("OpenCode 2 source has no sessions");
        sessionExists = (id) => liveIds.has(id);
      } catch {
        persistMessageHistoryOrphanSweepState(db, cursor, now + unavailableReprobeMs - cooldownMs, harness);
        return { status: "source_unavailable", scanned: 0, deleted: 0, cursor };
      }
    } else {
      liveIds = new Set(openCodeDb.prepare("SELECT id FROM session").all().map((row) => row.id));
      const query = openCodeDb.prepare("SELECT 1 FROM session WHERE id = ? LIMIT 1");
      sessionExists = (id) => !!query.get(id);
    }
    if (options.fenceLockNames?.length) {
      const retainedIds = new Set(liveIds);
      const sources = SESSION_SCOPED_TABLES.map((def) => `SELECT session_id FROM ${def.table}${def.extraPredicate ? ` WHERE ${def.extraPredicate}` : ""}`);
      for (const row of db.prepare(sources.join(" UNION ")).all()) {
        if (typeof row.session_id === "string")
          retainedIds.add(row.session_id);
      }
      for (const row of db.prepare("SELECT key FROM schema_migrations_meta WHERE key >= ? AND key < ?").all(TAG_TOMBSTONE_OWNER_PREFIX, "tag_revision_owner;")) {
        try {
          const id = JSON.parse(row.key.slice(TAG_TOMBSTONE_OWNER_PREFIX.length, row.key.lastIndexOf(":")));
          if (typeof id === "string")
            retainedIds.add(id);
        } catch {}
      }
      sweepEmptyLkgRecoveryLockDirectories(options.fenceLockNames, retainedIds);
    }
    const cutoff = now - safetyAgeMs;
    const candidateSourceSql = getOpenCodeSessionScopedCandidateSourceSql(harness);
    const candidates = db.prepare(`SELECT session_id
                 FROM (${candidateSourceSql}) AS session_candidates
                 WHERE session_id > ?
                   AND NOT EXISTS (
                       SELECT 1
                       FROM message_history_index
                       WHERE message_history_index.session_id = session_candidates.session_id
                          AND message_history_index.harness = '${harness}'
                         AND message_history_index.updated_at > ?
                   )
                 ORDER BY session_id ASC
                 LIMIT ?`).all(cursor, cutoff, batchSize);
    const missingSessionIds = candidates.filter((candidate) => !sessionExists(candidate.session_id)).map((candidate) => candidate.session_id);
    const nextCursor = candidates.length < batchSize ? "" : candidates[candidates.length - 1]?.session_id ?? cursor;
    const completedAt = candidates.length < batchSize ? now : null;
    let deleted = 0;
    let slices = 0;
    const stillEligible = db.prepare(`SELECT 1 WHERE NOT EXISTS (
                SELECT 1 FROM message_history_index
                WHERE session_id = ? AND harness = '${harness}' AND updated_at > ?
            )`);
    for (const sessionId of missingSessionIds) {
      let complete = false;
      do {
        let removed = 0;
        db.exec("BEGIN IMMEDIATE");
        const transactionStartedAt = performance.now();
        let committed = false;
        try {
          const hostStillMissing = v2Reader ? !v2Reader.sessionExists(sessionId) : !sessionExists(sessionId);
          if (hostStillMissing && stillEligible.get(sessionId, cutoff)) {
            const slice = deleteSessionScopedRowsSlice(db, sessionId, harness);
            removed = slice.deleted;
            complete = slice.complete;
          } else
            complete = true;
          db.exec("COMMIT");
          committed = true;
          logSlowWriteTransaction("message_index_orphan_sweep", transactionStartedAt);
        } finally {
          if (!committed) {
            try {
              db.exec("ROLLBACK");
            } catch {}
          }
        }
        deleted += removed;
        if (removed)
          clearLkgRecoveryFence(sessionId);
        yield;
        if (++slices >= Math.max(1, options.maxSlices ?? 512)) {
          return {
            status: "swept",
            scanned: candidates.length,
            deleted,
            cursor,
            partial: true
          };
        }
      } while (!complete);
    }
    persistMessageHistoryOrphanSweepState(db, nextCursor, completedAt, harness);
    return {
      status: "swept",
      scanned: candidates.length,
      deleted,
      cursor: nextCursor
    };
  } finally {
    v2Reader?.close();
    closeQuietly(openCodeDb);
  }
}
async function sweepOrphanedOpenCodeMessageIndexesCooperatively2(db, openSource, options = {}) {
  return withoutSqliteTransformPass2(() => withSqliteBackgroundWriter2(async () => {
    const sweep = sweepOrphanedOpenCodeMessageIndexesInBackground(db, openSource, options);
    try {
      for (;; ) {
        const step = sweep.next();
        if (step.done)
          return step.value;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      sweep.return({ status: "source_unavailable", scanned: 0, deleted: 0, cursor: "" });
    }
  }));
}

export { LkgRecoveryFenceError, clearLkgFenceProcessState, takeLkgRecoveryLockSweepPage, lkgFenceRequiresRebuild, lkgRecoveryFenceUnclean, ownsLkgDirtyFence, invalidateCleanLkgRecoveryFence, markLkgRecoveryDirty, commitLkgWithRecoveryFence, clearLkgRecoveryFence, gaDatabasePath, V2StoreReader, readSessionActivity, observeSessionActivity, backfillSessionActivity, deleteSessionScopedRows, clearCompressionDepth, clearCompressionDepthRange, cleanSearchText, keywordRelevance, matchedSearchSnippet, MESSAGE_INDEX_MAX_FTS_BYTES2, messageIndexSkipKey2, toMessageIndexSource2, getMessageIndexSourceIdentity2, isMessageIndexSourceCurrent2, getLastIndexedOrdinal2, getIndexedMessageCorpusSize2, markMessageIndexDirty2, getMessageIndexReconciliationStartOrdinal2, isMessageIndexReconciledThrough2, deleteIndexedMessage2, clearIndexedMessagesInTransaction2, clearIndexedMessages2, getIndexableContent2, indexSingleMessage2, indexMessagesAfterOrdinal2, indexSourcesAfterOrdinal2, sweepOrphanedOpenCodeMessageIndexesCooperatively2 };
