import {
  withSqliteBackgroundWriter2,
  withIndexChunk2,
  yieldIndexChunk2
} from "./index-2qtx0q6h.js";
import"./index-asxy48qe.js";
import"./index-3rq8rbt9.js";
import"./index-0h2mkab2.js";
import"./index-gymgz20n.js";
import"./index-dnp1jjar.js";
import"./index-3pk2mhaq.js";
import"./index-ccanzg8p.js";
import"./index-399p688g.js";
import"./index-54wmg4rj.js";
import"./index-mkh1cm5k.js";
import"./index-n0zjvs3h.js";
import"./index-6vfy5y6a.js";
import"./index-6x556c2q.js";
import"./index-c6wbq66z.js";
import {
  MESSAGE_INDEX_MAX_FTS_BYTES,
  messageIndexSkipKey,
  getLastIndexedOrdinal,
  markMessageIndexDirty,
  getIndexableContent,
  indexSingleMessage
} from "./index-2bfj5gcg.js";
import"./index-rgvqh5x7.js";
import"./index-0wtm7g7f.js";

// ../plugin/src/features/magic-context/message-index-bounded.ts
import { createHash } from "node:crypto";
var IDENTITY_CHUNK_BYTES = 256 * 1024;
async function indexMessageInShortChunks(db, sessionId, message, coordination, isCurrent) {
  const measurements = {
    holdMs: [],
    commitMs: [],
    sourceBytes: 0,
    skipped: false
  };
  const execute = db.exec.bind(db);
  let beginAt;
  db.exec = (sql) => {
    if (/^BEGIN IMMEDIATE$/.test(sql)) {
      const result = execute(sql);
      beginAt = performance.now();
      return result;
    }
    if (sql === "COMMIT" || sql === "ROLLBACK") {
      const start = performance.now();
      try {
        return execute(sql);
      } finally {
        if (beginAt !== undefined)
          measurements.holdMs.push(performance.now() - beginAt);
        if (sql === "COMMIT")
          measurements.commitMs.push(performance.now() - start);
        beginAt = undefined;
      }
    }
    return execute(sql);
  };
  const transaction = async (write) => withIndexChunk2(coordination, () => withSqliteBackgroundWriter2(() => {
    db.exec("BEGIN IMMEDIATE");
    let committed = false;
    try {
      if (isCurrent())
        write();
      db.exec("COMMIT");
      committed = true;
    } finally {
      if (!committed)
        db.exec("ROLLBACK");
    }
  }));
  try {
    if (!isCurrent())
      return { inserted: false, measurements };
    const content = getIndexableContent(message.role, message.parts);
    measurements.sourceBytes = Buffer.byteLength(content);
    const hash = createHash("sha256");
    const oversized = measurements.sourceBytes > MESSAGE_INDEX_MAX_FTS_BYTES;
    measurements.skipped = oversized;
    if (oversized) {
      await transaction(() => markMessageIndexDirty(db, sessionId, Math.min(message.ordinal, getLastIndexedOrdinal(db, sessionId) + 1)));
      const encoded = Buffer.from(content);
      const progress = db.prepare("INSERT INTO schema_migrations_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
      for (let offset = 0;offset < encoded.length; offset += IDENTITY_CHUNK_BYTES) {
        if (!isCurrent())
          return { inserted: false, measurements };
        const end = Math.min(encoded.length, offset + IDENTITY_CHUNK_BYTES);
        hash.update(encoded.subarray(offset, end));
        await transaction(() => progress.run(messageIndexSkipKey(sessionId, message.id), JSON.stringify({
          reason: "oversized",
          bytes: measurements.sourceBytes,
          processedBytes: end,
          ordinal: message.ordinal,
          sourceVersion: message.version ?? "",
          complete: false
        })));
        await yieldIndexChunk2();
      }
    } else
      hash.update(content);
    const source = {
      id: message.id,
      ordinal: message.ordinal,
      role: message.role,
      createdAt: message.createdAt,
      sourceVersion: message.version === null || message.version === undefined ? "" : String(message.version),
      contentHash: hash.digest("hex"),
      content: oversized ? "" : content,
      ...oversized ? { ftsSkippedBytes: measurements.sourceBytes } : {}
    };
    const inserted = await withIndexChunk2(coordination, () => withSqliteBackgroundWriter2(() => indexSingleMessage(db, sessionId, message, isCurrent, source)));
    return { inserted, measurements };
  } finally {
    db.exec = execute;
  }
}
export {
  indexMessageInShortChunks
};
