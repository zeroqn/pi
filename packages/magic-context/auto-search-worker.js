// ../plugin/src/hooks/magic-context/auto-search-worker.ts
import { parentPort, workerData } from "node:worker_threads";
var port = parentPort;
if (!port)
  throw new Error("auto-search worker requires a parent port");
var input = workerData;
if (input.job === "messages") {
  port.postMessage({ kind: "accepted" });
}
var [
  { ensureMemoryEmbeddings },
  { getProjectEmbeddings },
  { getMemoriesByProject },
  { installProjectEmbeddingSearchBridge },
  { searchMessageHistory, unifiedSearch },
  { setEmbeddingSessionBusy },
  { setHarness },
  { Database }
] = await Promise.all([
  import("./embedding-backfill-jazkqw0f.js"),
  import("./embedding-cache-7rp4gqzr.js"),
  import("./storage-memory-1z20y55x.js"),
  import("./project-embedding-registry-y1rqgygj.js"),
  import("./search-6gdm3505.js"),
  import("./embedding-activity-ew6dshfd.js"),
  import("./harness-9872e0ym.js"),
  import("./sqlite-3yye76ht.js")
]);
setHarness(input.harness);
setEmbeddingSessionBusy(input.sessionId, input.embeddingHostBusy === true);
var nextId = 0;
var pending = new Map;
var queryDimensions = null;
var db;
port.on("message", (reply) => {
  if (reply.embeddingHostBusy !== undefined)
    setEmbeddingSessionBusy(input.sessionId, reply.embeddingHostBusy);
  const vector = reply.result instanceof Float32Array ? reply.result : reply.result?.vector;
  if (vector)
    queryDimensions = vector.length;
  pending.get(reply.id)?.(reply);
  pending.delete(reply.id);
});
function request(message) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (reply) => reply.error ? reject(new Error(reply.error)) : resolve(reply));
    port?.postMessage({ ...message, id });
  });
}
if (input.snapshot) {
  installProjectEmbeddingSearchBridge(input.snapshot, {
    modelId: input.snapshot.modelId,
    initialize: async () => true,
    isLoaded: () => true,
    dispose: async () => {},
    embed: async (text) => {
      const result = (await request({ kind: "query", text })).result;
      return result instanceof Float32Array ? result : result?.vector ?? null;
    },
    embedBatch: async (texts, _signal, purpose = "passage") => {
      const passage = (await request({ kind: "batch", texts, purpose })).passage;
      const captured = input.snapshot;
      if (!passage || !captured || passage.generation !== captured.generation || passage.modelId !== captured.modelId || passage.providerIdentity !== captured.providerIdentity || passage.runtimeFingerprint !== captured.runtimeFingerprint || !queryDimensions || passage.dimensions !== queryDimensions || passage.vectors.length !== texts.length)
        return texts.map(() => null);
      return passage.vectors.map((vector) => vector && vector.length === queryDimensions && vector.every(Number.isFinite) ? vector : null);
    }
  });
}
db = new Database(input.path, input.job === "backfill" ? undefined : { readonly: true });
db.exec("PRAGMA busy_timeout = 250");
try {
  if (input.job === "backfill") {
    if (input.snapshot?.enabled && input.snapshot.features.memoryEnabled) {
      await request({ kind: "query", text: input.query });
      if (queryDimensions) {
        const existingEmbeddings = getProjectEmbeddings(db, input.projectPath, input.snapshot.modelId);
        const memories = getMemoriesByProject(db, input.projectPath).filter((memory) => !existingEmbeddings.has(memory.id)).slice(0, 50);
        await ensureMemoryEmbeddings({
          db,
          projectIdentity: input.projectPath,
          memories,
          existingEmbeddings
        });
      }
    }
    port.postMessage({ kind: "result", results: [] });
  } else if (input.job === "messages") {
    if (!input.messageRequest)
      throw new Error("message search job carries no request");
    const outcome = searchMessageHistory(db, input.messageRequest);
    port.postMessage({ kind: "messages", outcome });
  } else {
    const results = await unifiedSearch(db, input.sessionId, input.projectPath, input.query, {
      ...input.options,
      backfillMemoryEmbeddings: false,
      countRetrievals: false,
      measurementDisabled: true,
      embedQuery: async (text) => (await request({ kind: "query", text })).result ?? null,
      isEmbeddingRuntimeEnabled: () => input.embeddingRuntimeEnabled
    });
    port.postMessage({ kind: "result", results });
  }
} catch (error) {
  port.postMessage({
    kind: "error",
    error: error instanceof Error ? error.message : String(error)
  });
} finally {
  db.close();
  port.close();
}
