import {
  resolveOpenCodeDbPath,
  assertOpenCodeStoreGeneration
} from "./index-n0zjvs3h.js";
import {
  Database2
} from "./index-2qtx0q6h.js";
import {
  sameProjectDirectory
} from "./index-wrr9rp9a.js";

// ../plugin/src/v2/store-reader.ts
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
function gaDatabasePath2(dataHome, channel = "latest", env = process.env) {
  return resolveOpenCodeDbPath("v2", { dataHome, channel, env }).path;
}
var RAW_MESSAGE_TYPES2 = [
  "user",
  "synthetic",
  "assistant",
  "skill",
  "shell",
  "system"
];
var RAW_MESSAGE_TYPE_PARAMETERS = RAW_MESSAGE_TYPES2.map(() => "?").join(", ");
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
  messageOrdinalById: "SELECT seq FROM session_message WHERE session_id = ? AND id = ? AND type IN (?) LIMIT 1",
  messageIdOrdinals: "SELECT id FROM session_message WHERE session_id = ? AND seq >= ? AND type IN (?) ORDER BY seq ASC LIMIT ?",
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
  return {
    db,
    statements: new Map,
    identity: acquiredIdentity,
    leases: 0,
    retired: false,
    ordinalSequences: new Map
  };
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

class V2StoreReaderPool2 {
  capacity;
  connections = new Map;
  closed = false;
  closing = false;
  holds = 0;
  idleWaiters = new Set;
  constructor(capacity = 4) {
    this.capacity = capacity;
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("Invalid reader capacity");
  }
  open(path) {
    return new V2StoreReader2(path, this);
  }
  acquire(path) {
    if (this.closed)
      throw new Error("Store reader pool is closed");
    const key = resolve(path);
    const stat = statSync(key);
    const identity = `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    let connection = this.connections.get(key);
    if (connection && connection.identity !== identity) {
      this.connections.delete(key);
      this.retire(connection);
      connection = undefined;
    }
    if (!connection)
      connection = connect(key, identity);
    connection.leases++;
    this.connections.delete(key);
    this.connections.set(key, connection);
    while (this.connections.size > this.capacity) {
      const oldest = this.connections.entries().next().value;
      if (!oldest)
        break;
      this.connections.delete(oldest[0]);
      this.retire(oldest[1]);
    }
    return connection;
  }
  release(connection) {
    connection.leases--;
    if (connection.retired && connection.leases === 0)
      closeConnection(connection);
  }
  retire(connection) {
    connection.retired = true;
    if (connection.leases === 0)
      closeConnection(connection);
  }
  hold() {
    if (this.closed || this.closing)
      throw new Error("Store reader pool is closed");
    this.holds++;
    let released = false;
    return () => {
      if (released)
        return;
      released = true;
      this.holds--;
      if (this.holds === 0 && this.closing)
        this.finishClose();
    };
  }
  isClosed() {
    return this.closed;
  }
  holdCount() {
    return this.holds;
  }
  close() {
    if (this.closed || this.closing)
      return;
    this.closing = true;
    if (this.holds === 0)
      this.finishClose();
  }
  async closeWhenIdle(timeoutMs) {
    this.close();
    if (this.closed)
      return true;
    let timer;
    let waiter;
    try {
      await new Promise((resolve) => {
        waiter = resolve;
        this.idleWaiters.add(resolve);
        timer = setTimeout(resolve, Math.max(0, timeoutMs));
      });
    } finally {
      if (timer)
        clearTimeout(timer);
      if (waiter)
        this.idleWaiters.delete(waiter);
    }
    return this.closed;
  }
  finishClose() {
    if (this.closed)
      return;
    this.closed = true;
    for (const connection of this.connections.values())
      this.retire(connection);
    this.connections.clear();
    for (const resolve of this.idleWaiters)
      resolve();
    this.idleWaiters.clear();
  }
}
function messageTimesQuery(count, withVersions = false) {
  return `SELECT id, COALESCE(time_created, json_extract(data, '$.time.created')) AS created,
                   json_extract(data, '$.time.completed') AS completed
                   ${withVersions ? ", type, seq, time_created AS version_created, time_updated AS version_updated" : ""}
            FROM session_message WHERE +session_id = ? AND id IN (${Array.from({ length: count }, () => "?").join(",")})`;
}

class V2StoreReader2 {
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
    return createHash("sha256").update(JSON.stringify([hostname(), resolve(this.path), this.connection.identity])).digest("hex");
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
                        AND type IN (${RAW_MESSAGE_TYPE_PARAMETERS}) ORDER BY seq ASC LIMIT ?`).all(sessionID, anchor.seq, ...RAW_MESSAGE_TYPES2, pageSize).map(decode);
        }
      }
      const maximumSeq = Number.MAX_SAFE_INTEGER;
      const rows = this.prepare(V2_MESSAGE_PAGE_SQL).all(afterOrdinal, sessionID, ...RAW_MESSAGE_TYPES2, Math.max(0, afterOrdinal - 1), sessionID, sessionID, ...RAW_MESSAGE_TYPES2, finalWatermark - 1, maximumSeq, sessionID, ...RAW_MESSAGE_TYPES2, pageSize);
      return rows.map(decode);
    });
  }
  messageCount(sessionID) {
    return trackDecodeOperation("messageCount", () => {
      const rawTypes = RAW_MESSAGE_TYPES2.map(() => "?").join(", ");
      const row = this.prepare(`SELECT COUNT(*) AS count FROM session_message
                     WHERE session_id = ? AND type IN (${rawTypes})`).get(sessionID, ...RAW_MESSAGE_TYPES2);
      return typeof row?.count === "number" ? row.count : 0;
    });
  }
  messageCountAfterSequence(sessionID, after, through) {
    const rawTypes = RAW_MESSAGE_TYPES2.map(() => "?").join(", ");
    const row = this.prepare(`SELECT COUNT(*) AS count FROM session_message
             WHERE session_id = ? AND seq > ? AND seq <= ? AND type IN (${rawTypes})`).get(sessionID, after, through, ...RAW_MESSAGE_TYPES2);
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
      const rawTypes = RAW_MESSAGE_TYPES2.map(() => "?").join(", ");
      const row = this.prepare(`SELECT id, session_id, type, seq, time_created, data FROM session_message
                     WHERE session_id = ? AND id = ? AND type IN (${rawTypes}) LIMIT 1`).get(sessionID, id, ...RAW_MESSAGE_TYPES2);
      return row ? decode(row) : null;
    });
  }
  messageTimeVersions(sessionID, ids, span) {
    const versions = new Map;
    if (ids.length > 0 && span && span.last - span.first < ids.length * 2) {
      const wanted = new Set(ids);
      const rows = this.prepare(`SELECT id, type, seq, time_created AS created, time_updated AS updated
                FROM session_message WHERE session_id = ? AND seq >= ? AND seq <= ?`).all(sessionID, span.first, span.last);
      for (const row of rows)
        if (wanted.has(row.id))
          versions.set(row.id, row);
      for (const [id, version] of this.messageTimeVersions(sessionID, ids.filter((id) => !versions.has(id))))
        versions.set(id, version);
      return versions;
    }
    for (let offset = 0;offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      const rows = this.prepare(`SELECT id, type, seq, time_created AS created, time_updated AS updated
                FROM session_message WHERE +session_id = ? AND id IN (${batch.map(() => "?").join(",")})`).all(sessionID, ...batch);
      for (const row of rows)
        versions.set(row.id, row);
    }
    return versions;
  }
  messageTimes(sessionID, ids, versions) {
    const times = new Map;
    for (let offset = 0;offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      const rows = this.prepare(messageTimesQuery(batch.length, versions !== undefined)).all(sessionID, ...batch);
      for (const row of rows) {
        times.set(row.id, {
          created: typeof row.created === "number" ? row.created : undefined,
          completed: typeof row.completed === "number" ? row.completed : undefined
        });
        versions?.set(row.id, {
          id: row.id,
          type: row.type,
          seq: row.seq,
          created: row.version_created,
          updated: row.version_updated
        });
      }
    }
    return times;
  }
  messageExistsById(sessionID, id) {
    return trackDecodeOperation("messageExistsById", () => {
      const rawTypes = RAW_MESSAGE_TYPES2.map(() => "?").join(", ");
      const row = this.prepare(`SELECT 1 FROM session_message
                     WHERE id = ? AND session_id = ? AND type IN (${rawTypes}) LIMIT 1`).get(id, sessionID, ...RAW_MESSAGE_TYPES2);
      return row != null;
    });
  }
  withOrdinalSequences(sessionID, read) {
    return this.db.transaction(() => {
      this.prepare("SELECT seq FROM session_message WHERE session_id = ? ORDER BY seq DESC LIMIT 1").get(sessionID);
      const { data_version: version } = this.prepare("PRAGMA data_version").get();
      if (version !== this.connection.ordinalVersion) {
        this.connection.ordinalSequences.clear();
        this.connection.ordinalVersion = version;
      }
      let sequences = this.connection.ordinalSequences.get(sessionID);
      if (!sequences) {
        const rows = this.prepare(`SELECT seq FROM session_message
                    WHERE session_id = ? AND type IN (${RAW_MESSAGE_TYPE_PARAMETERS}) ORDER BY seq ASC`).all(sessionID, ...RAW_MESSAGE_TYPES2);
        sequences = rows.map((row) => row.seq);
        if (this.connection.ordinalSequences.size >= 8)
          this.connection.ordinalSequences.clear();
        this.connection.ordinalSequences.set(sessionID, sequences);
      }
      return read(sequences);
    }).deferred();
  }
  messageOrdinalById(sessionID, id) {
    return trackDecodeOperation("messageOrdinalById", () => this.withOrdinalSequences(sessionID, (sequences) => {
      const row = this.prepare(`SELECT seq FROM session_message
                WHERE session_id = ? AND id = ? AND type IN (${RAW_MESSAGE_TYPE_PARAMETERS}) LIMIT 1`).get(sessionID, id, ...RAW_MESSAGE_TYPES2);
      if (!row)
        return null;
      let low = 0;
      let high = sequences.length;
      while (low < high) {
        const middle = low + high >>> 1;
        if (sequences[middle] < row.seq)
          low = middle + 1;
        else
          high = middle;
      }
      return sequences[low] === row.seq ? low + 1 : null;
    }));
  }
  messageIdOrdinals(sessionID, fromOrdinal, toOrdinal) {
    return trackDecodeOperation("messageIdOrdinals", () => {
      if (!Number.isSafeInteger(fromOrdinal) || fromOrdinal < 1)
        throw new Error("Invalid raw-message range start");
      if (!Number.isSafeInteger(toOrdinal) || toOrdinal < fromOrdinal)
        throw new Error("Invalid raw-message range end");
      return this.withOrdinalSequences(sessionID, (sequences) => {
        const anchor = sequences[fromOrdinal - 1];
        if (anchor === undefined)
          return new Map;
        const rows = this.prepare(`SELECT id FROM session_message
                    WHERE session_id = ? AND seq >= ? AND type IN (${RAW_MESSAGE_TYPE_PARAMETERS})
                    ORDER BY seq ASC LIMIT ?`).all(sessionID, anchor, ...RAW_MESSAGE_TYPES2, toOrdinal - fromOrdinal + 1);
        return new Map(rows.map((row, index) => [row.id, fromOrdinal + index]));
      });
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
      const rawTypes = new Set(RAW_MESSAGE_TYPES2);
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
      const rawTypes = RAW_MESSAGE_TYPES2.map(() => "?").join(", ");
      return this.prepare(`SELECT id, session_id, type, seq, time_created, data FROM session_message
                         WHERE session_id = ? AND type IN (${rawTypes}) AND seq <= ?
                         ORDER BY seq DESC LIMIT ?`).all(sessionID, ...RAW_MESSAGE_TYPES2, throughSeq, limit).map(decode);
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
  rowStampsThrough(sessionID, throughSeq, after) {
    if (after !== undefined)
      return this.prepare(`SELECT id, type, seq, time_created FROM session_message
                     WHERE session_id = ? AND seq > ? AND seq <= ? ORDER BY seq ASC`).all(sessionID, after, throughSeq);
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

export { gaDatabasePath2, RAW_MESSAGE_TYPES2, V2StoreReaderPool2, V2StoreReader2 };
