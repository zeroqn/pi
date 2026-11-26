import {
  exitOnWorkerClose
} from "./index-x2n261wp.js";
import {
  serveWorkerJobs
} from "./index-nypgv96r.js";

// ../plugin/src/hooks/magic-context/auto-search-worker.ts
serveWorkerJobs(async (initial, port) => {
  let input = initial;
  function post(reply) {
    port.postMessage({ ...reply, jobId: input.jobId });
  }
  const persistent = input.persistent === true;
  if (input.job === "messages") {
    post({ kind: "accepted" });
  }
  const [
    { ensureMemoryEmbeddings },
    { getProjectEmbeddings },
    { getMemoriesByProject },
    { installProjectEmbeddingSearchBridge },
    { searchMessageHistory, unifiedSearch },
    { getLastCompartmentChunkPoolWarm, maintainCompartmentChunkSearchPools },
    { setEmbeddingSessionBusy },
    { getHarness, setHarness },
    { Database, registerSqliteDiagnosticSink },
    { log }
  ] = await Promise.all([
    import("./embedding-backfill-6f2berym.js"),
    import("./embedding-cache-7rp4gqzr.js"),
    import("./storage-memory-0ndn65fm.js"),
    import("./project-embedding-registry-zwd2g1vj.js"),
    import("./search-gg9g9qm1.js"),
    import("./compartment-chunk-embedding-avkyp2df.js"),
    import("./embedding-activity-ew6dshfd.js"),
    import("./harness-9872e0ym.js"),
    import("./sqlite-v89bj0yy.js"),
    import("./logger-93cnqyh0.js")
  ]);
  setHarness(input.harness);
  registerSqliteDiagnosticSink(log, getHarness);
  let nextId = 0;
  const pending = new Map;
  let queryDimensions = null;
  let db;
  port.on("message", (reply) => {
    if (reply.jobId !== input.jobId)
      return;
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
      post({ ...message, id });
    });
  }
  db = new Database(input.path, input.job === "backfill" ? undefined : { readonly: true });
  db.exec("PRAGMA busy_timeout = 250");
  const { closePort } = exitOnWorkerClose(port, () => db.close());
  const CHUNK_POOL_MAINTENANCE_INTERVAL_MS = 5000;
  let maintenanceTimer;
  let maintaining = false;
  function maintainChunkPools() {
    if (maintaining)
      return;
    maintaining = true;
    maintainCompartmentChunkSearchPools(db).catch(() => {}).finally(() => {
      maintaining = false;
    });
  }
  function scheduleChunkPoolMaintenance() {
    if (!persistent)
      return;
    if (!maintenanceTimer) {
      maintenanceTimer = setInterval(maintainChunkPools, CHUNK_POOL_MAINTENANCE_INTERVAL_MS);
      maintenanceTimer.unref?.();
    }
    setTimeout(maintainChunkPools, 0);
  }
  async function run(jobInput) {
    input = jobInput;
    queryDimensions = null;
    setEmbeddingSessionBusy(input.sessionId, input.embeddingHostBusy === true);
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
        post({ kind: "result", results: [] });
      } else if (input.job === "messages") {
        if (!input.messageRequest)
          throw new Error("message search job carries no request");
        const outcome = searchMessageHistory(db, input.messageRequest);
        post({ kind: "messages", outcome });
      } else {
        const jobStarted = performance.now();
        const steps = {};
        const diagnostics = input.options.autoSearchDiagnostics;
        const results = await unifiedSearch(db, input.sessionId, input.projectPath, input.query, {
          ...input.options,
          backfillMemoryEmbeddings: false,
          countRetrievals: false,
          measurementDisabled: true,
          embedQuery: async (text) => (await request({ kind: "query", text })).result ?? null,
          isEmbeddingRuntimeEnabled: () => input.embeddingRuntimeEnabled,
          stepTimings: steps,
          onAutoSearchDiagnostics: diagnostics ? () => port.postMessage({
            kind: "diagnostics",
            diagnostics,
            jobId: jobInput.jobId
          }) : undefined
        });
        post({
          kind: "result",
          results,
          timings: {
            steps,
            jobMs: performance.now() - jobStarted,
            lastPoolWarm: getLastCompartmentChunkPoolWarm()
          }
        });
        scheduleChunkPoolMaintenance();
      }
    } catch (error) {
      post({
        kind: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setEmbeddingSessionBusy(input.sessionId, false);
      if (!persistent) {
        db.close();
        closePort();
      }
    }
  }
  port.on("message", (message) => {
    if (message.kind === "run" && message.input)
      run(message.input);
  });
  await run(input);
});
