import {
  Database2
} from "./index-2qtx0q6h.js";
import"./index-453s1hj6.js";
import"./index-0h2mkab2.js";
import"./index-dnp1jjar.js";
import"./index-tm11k42a.js";
import {
  LATEST_SUPPORTED_VERSION2,
  getPersistedSchemaVersion2
} from "./index-cmhas8we.js";
import"./index-3bb24eb6.js";
import"./index-8sqebjzk.js";
import"./index-wfqysrwq.js";
import {
  exitOnWorkerClose
} from "./index-x2n261wp.js";
import"./index-xjhq27z9.js";
import"./index-ghp32f9m.js";
import"./index-pqhc0k9d.js";
import {
  tagRevisionKey
} from "./index-jhmz9tgv.js";
import"./index-135e8hvg.js";
import"./index-n0zjvs3h.js";
import"./index-pefn1gt5.js";
import {
  normalizeTagSnapshotRow2,
  TAG_SELECT_COLUMNS2
} from "./index-nh4srq1p.js";
import"./index-vcegxfwg.js";
import {
  encodePiHydrationOperation,
  projectPiPassTag,
  PI_FALLBACK_ROW_COLUMNS,
  PI_FALLBACK_ROW_PREDICATE
} from "./index-pdrberjp.js";
import"./index-1ts77n1b.js";
import {
  serveWorkerJobs
} from "./index-nypgv96r.js";

// src/tag-snapshot-worker-pi.ts
import { setTimeout as delay } from "node:timers/promises";
serveWorkerJobs(async (request, port) => {
  let db;
  let sequence = 0;
  let generation = { revision: "0", durable: 0 };
  let maxReadTransactionMs = 0;
  let packetCount = 0;
  let packetBytes = 0;
  let sampledGeneration = false;
  let generationStatement;
  let opened = false;
  let persistedVersion = 0;
  const { closePort } = exitOnWorkerClose(port, () => {
    const connection = db;
    db = undefined;
    connection?.close();
  });

  class StaleGeneration extends Error {
  }

  class UnsupportedSchema extends Error {
  }
  function sample(_connection) {
    return generationStatement.get(tagRevisionKey(request.sessionId), request.sessionId);
  }
  function envelope() {
    return {
      jobId: request.jobId,
      sessionId: request.sessionId,
      connectionEpoch: request.connectionEpoch,
      sessionEpoch: request.sessionEpoch,
      sequence: sequence++,
      generation
    };
  }
  async function send(message) {
    const ack = new Promise((resolve, reject) => {
      port?.once("message", (value) => {
        if (value.type !== "ack" || value.sequence !== message.sequence)
          reject(new Error("invalid packet credit"));
        else if (message.type === "packet" && (!(value.bytes instanceof ArrayBuffer) || value.bytes.byteLength !== 65536))
          reject(new Error("invalid returned packet buffer"));
        else
          resolve(value.bytes);
      });
    });
    if (message.type === "packet")
      port?.postMessage(message, [message.bytes]);
    else
      port?.postMessage(message);
    return await ack;
  }
  function* operations(row) {
    if (Object.values(row).every((value) => !(typeof value === "string" && value.length > 2048) && !(value instanceof Uint8Array && value.length > 2048))) {
      yield { type: "row", value: row };
      return;
    }
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string" || value instanceof Uint8Array) {
        if (value.length === 0)
          yield { type: "field", key, value, append: false };
        for (let start = 0;start < value.length; start += 2048)
          yield {
            type: "field",
            key,
            value: value.slice(start, start + 2048),
            append: start !== 0,
            totalLength: value instanceof Uint8Array ? value.length : undefined
          };
      } else
        yield { type: "field", key, value, append: false };
    }
    yield { type: "row-end" };
  }
  async function stream(kind) {
    const connection = db;
    if (!connection)
      throw new Error("closed worker connection");
    let cursor;
    let rowsSent = 0;
    const columns = kind === "tags" ? TAG_SELECT_COLUMNS2 : PI_FALLBACK_ROW_COLUMNS;
    const fallback = kind === "fallback" ? `AND ${PI_FALLBACK_ROW_PREDICATE}` : "";
    const query = `SELECT ${columns} FROM tags WHERE session_id = ? ${fallback}`;
    const firstPage = connection.prepare(`${query} ORDER BY tag_number ASC, id ASC LIMIT 256`);
    const nextPage = connection.prepare(`${query} AND (tag_number, id) > (?, ?) ORDER BY tag_number ASC, id ASC LIMIT 256`);
    const nextNullPage = connection.prepare(`${query} AND ((tag_number IS NULL AND id > ?) OR tag_number IS NOT NULL) ORDER BY tag_number ASC, id ASC LIMIT 256`);
    let buffer = new Uint8Array(65536);
    for (;; ) {
      if (request.test?.pageDelayMs)
        await delay(request.test.pageDelayMs);
      const started = performance.now();
      let rows;
      connection.exec("BEGIN");
      try {
        const stamp = sample(connection);
        if (!sampledGeneration) {
          sampledGeneration = true;
          generation = stamp;
        } else if (stamp.revision !== generation.revision || stamp.durable !== generation.durable)
          throw new StaleGeneration("session tags changed between pages");
        rows = cursor ? cursor.tag_number === null ? nextNullPage.all(request.sessionId, cursor.id) : nextPage.all(request.sessionId, cursor.tag_number, cursor.id) : firstPage.all(request.sessionId);
        connection.exec("COMMIT");
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      } finally {
        maxReadTransactionMs = Math.max(maxReadTransactionMs, performance.now() - started);
      }
      let used = 0;
      let packetRows = 0;
      const flush = async () => {
        if (used === 0)
          return;
        const bytes = buffer.buffer;
        packetCount++;
        packetBytes += used;
        const returned = await send({
          ...envelope(),
          type: "packet",
          stream: kind,
          bytes,
          byteLength: used,
          rows: packetRows
        });
        buffer = new Uint8Array(returned);
        used = 0;
        packetRows = 0;
      };
      for (const raw of rows) {
        cursor = { tag_number: raw.tag_number, id: raw.id };
        const normalized = kind === "tags" ? normalizeTagSnapshotRow2(raw) : raw;
        const row = kind === "tags" && normalized && request.projection === "pass" ? projectPiPassTag(normalized) : normalized;
        if (!row)
          continue;
        for (const operation of operations(row)) {
          const encoded = encodePiHydrationOperation(operation);
          if (encoded.length + 4 > 65536)
            throw new Error("field fragment exceeds packet limit");
          if (used + encoded.length + 4 > buffer.length || packetRows === 256)
            await flush();
          new DataView(buffer.buffer).setUint32(used, encoded.length);
          used += 4;
          buffer.set(encoded, used);
          used += encoded.length;
          if (operation.type === "row" || operation.type === "row-end") {
            packetRows++;
            rowsSent++;
          }
        }
      }
      await flush();
      if (rows.length < 256)
        break;
    }
    await send({ ...envelope(), type: "end", stream: kind, rows: rowsSent });
  }
  const run = async () => {
    try {
      if (request.test?.openDelayMs)
        await delay(request.test.openDelayMs);
      db = new Database2(request.path, { readonly: true });
      opened = true;
      db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 50; PRAGMA cache_size = -1024");
      generationStatement = db.prepare(`SELECT
		COALESCE((SELECT value FROM schema_migrations_meta WHERE key = ?), '0') AS revision,
		COALESCE((SELECT tags_version FROM session_meta WHERE session_id = ?), 0) AS durable`);
      const version = getPersistedSchemaVersion2(db);
      persistedVersion = version;
      if (version > LATEST_SUPPORTED_VERSION2)
        throw new UnsupportedSchema(`shared database schema v${version} is newer than this build supports (v${LATEST_SUPPORTED_VERSION2}); update and restart this host`);
      await stream("tags");
      await stream("fallback");
      if (request.test?.crash === "before-end")
        throw new Error("injected worker crash before completion");
      const final = sample(db);
      if (final.revision !== generation.revision || final.durable !== generation.durable)
        throw new StaleGeneration("session tags changed after final page");
      db.close();
      db = undefined;
      port.postMessage({
        ...envelope(),
        type: "done",
        maxReadTransactionMs,
        packetCount,
        packetBytes
      });
      if (request.test?.crash === "after-end")
        process.exit(1);
    } catch (error) {
      port.postMessage({
        ...envelope(),
        type: "failed",
        code: error instanceof StaleGeneration ? "stale" : error instanceof UnsupportedSchema ? "schema" : opened ? "failed" : "open",
        persistedVersion,
        supportedVersion: LATEST_SUPPORTED_VERSION2,
        reason: error instanceof Error ? error.message : String(error)
      });
      if (request.test?.crash === "before-end") {
        db?.close();
        db = undefined;
        process.exit(1);
      }
    } finally {
      db?.close();
      closePort();
    }
  };
  await run();
});
