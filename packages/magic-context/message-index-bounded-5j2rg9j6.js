import {
  withSqliteBackgroundWriter2,
  withIndexChunk2,
  yieldIndexChunk2
} from "./index-7ptxvfc5.js";
import"./index-jg7jwy8c.js";
import"./index-vaah9fbg.js";
import"./index-0h2mkab2.js";
import"./index-x3dcnxh0.js";
import"./index-nmsb3x01.js";
import"./index-cyrnv16r.js";
import"./index-399p688g.js";
import"./index-7mm27xdc.js";
import"./index-8976mezv.js";
import"./index-774944sz.js";
import {
  MESSAGE_INDEX_MAX_FTS_BYTES2,
  messageIndexSkipKey2,
  getLastIndexedOrdinal2,
  markMessageIndexDirty2,
  getIndexableContent2,
  indexSingleMessage2
} from "./index-k3f0x2pv.js";
import"./index-j36vpt39.js";
import"./index-kgd6t63g.js";
import"./index-xkf1qyj1.js";
import"./index-c4y7qcdm.js";
import"./index-0vrkp1jq.js";

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
    const content = getIndexableContent2(message.role, message.parts);
    measurements.sourceBytes = Buffer.byteLength(content);
    const hash = createHash("sha256");
    const oversized = measurements.sourceBytes > MESSAGE_INDEX_MAX_FTS_BYTES2;
    measurements.skipped = oversized;
    if (oversized) {
      await transaction(() => markMessageIndexDirty2(db, sessionId, Math.min(message.ordinal, getLastIndexedOrdinal2(db, sessionId) + 1)));
      const encoded = Buffer.from(content);
      const progress = db.prepare("INSERT INTO schema_migrations_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
      for (let offset = 0;offset < encoded.length; offset += IDENTITY_CHUNK_BYTES) {
        if (!isCurrent())
          return { inserted: false, measurements };
        const end = Math.min(encoded.length, offset + IDENTITY_CHUNK_BYTES);
        hash.update(encoded.subarray(offset, end));
        await transaction(() => progress.run(messageIndexSkipKey2(sessionId, message.id), JSON.stringify({
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
    const inserted = await withIndexChunk2(coordination, () => withSqliteBackgroundWriter2(() => indexSingleMessage2(db, sessionId, message, isCurrent, source)));
    return { inserted, measurements };
  } finally {
    db.exec = execute;
  }
}
export {
  indexMessageInShortChunks
};
