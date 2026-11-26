import {
  isEmbeddingHostBusy2
} from "./index-9p40dgkm.js";
import {
  log2
} from "./index-tm11k42a.js";
import {
  contentSha2562,
  getProjectEmbeddingSnapshot2,
  readSearchBackfillCursor2,
  writeSearchBackfillCursor2,
  embedItemsWindowBounded2
} from "./index-s2zjddb6.js";
import {
  saveEmbeddingIfHashMatches
} from "./index-yhzhdp3m.js";

// ../plugin/src/features/magic-context/memory/embedding-backfill.ts
var SEARCH_BACKFILL_LIMIT = 50;
var SEARCH_BACKFILL_REQUEST_SIZE = 10;
async function ensureMemoryEmbeddings2(args) {
  if (isEmbeddingHostBusy2())
    return args.existingEmbeddings;
  const snapshot = getProjectEmbeddingSnapshot2(args.projectIdentity);
  if (!snapshot?.enabled) {
    return args.existingEmbeddings;
  }
  const missing = args.memories.filter((memory) => !args.existingEmbeddings.has(memory.id)).sort((a, b) => a.id - b.id);
  const capped = missing.length > SEARCH_BACKFILL_LIMIT;
  const cursor = capped ? readSearchBackfillCursor2(args.projectIdentity, snapshot.generation) : undefined;
  const next = cursor === undefined ? 0 : missing.findIndex((memory) => memory.id > cursor);
  const start = Math.max(0, next);
  const missingMemories = missing.slice(start, start + SEARCH_BACKFILL_LIMIT);
  if (missingMemories.length === 0) {
    return args.existingEmbeddings;
  }
  try {
    const result = await embedItemsWindowBounded2(args.projectIdentity, missingMemories.map((memory) => ({
      id: `memory:${memory.id}`,
      text: memory.content,
      contentSha256: contentSha2562(memory.content)
    })), undefined, args.db, args.projectIdentity, { maxItemsPerCall: SEARCH_BACKFILL_REQUEST_SIZE });
    if (!result) {
      return args.existingEmbeddings;
    }
    const staged = new Map;
    args.db.transaction(() => {
      for (const memory of missingMemories) {
        const embedding = result.vectors.get(`memory:${memory.id}`);
        if (!embedding) {
          continue;
        }
        const saved = saveEmbeddingIfHashMatches(args.db, memory.id, embedding, result.modelId, memory.normalizedHash);
        if (saved) {
          staged.set(memory.id, { embedding, modelId: result.modelId });
        }
      }
    }).immediate();
    const currentSnapshot = getProjectEmbeddingSnapshot2(args.projectIdentity);
    if (!currentSnapshot || currentSnapshot.generation !== result.generation) {
      return args.existingEmbeddings;
    }
    if (capped && (cursor !== undefined || result.vectors.size < missingMemories.length)) {
      const nextCursor = start + missingMemories.length < missing.length ? missingMemories.at(-1)?.id : undefined;
      writeSearchBackfillCursor2(args.projectIdentity, snapshot.generation, cursor, nextCursor);
    }
    for (const [id, embedding] of staged) {
      args.existingEmbeddings.set(id, embedding);
    }
  } catch (error) {
    log2("[magic-context] failed to backfill memory embeddings:", error);
  }
  return args.existingEmbeddings;
}

export { ensureMemoryEmbeddings2 };
