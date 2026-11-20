import {
  registerExitAbort
} from "./index-8sqebjzk.js";
import {
  inRootAsyncContext2
} from "./index-2qtx0q6h.js";
import {
  createWorkerShutdown
} from "./index-x2n261wp.js";

// ../plugin/src/tools/ctx-expand/v2-archive-reader.ts
import { Worker } from "node:worker_threads";
var worker;
var shutdown;
var ready;
var idle;
var startingTimer;
var rejectStart;
var nextId = 0;
var exitRegistered = false;
var pending = new Map;
async function stopV2ArchiveReader() {
  const closing = shutdown;
  worker = undefined;
  shutdown = undefined;
  ready = undefined;
  clearTimeout(idle);
  clearTimeout(startingTimer);
  rejectStart?.(new Error("Search archive worker unavailable: reader stopped"));
  rejectStart = undefined;
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(new Error("Search archive worker unavailable: reader stopped"));
  }
  pending.clear();
  await closing?.close();
}
function start() {
  if (ready)
    return ready;
  if (!exitRegistered) {
    exitRegistered = true;
    const controller = new AbortController;
    controller.signal.addEventListener("abort", () => {
      stopV2ArchiveReader();
    }, { once: true });
    registerExitAbort(controller);
  }
  ready = new Promise((resolve, reject) => {
    rejectStart = reject;
    const entry = new URL(import.meta.url.endsWith(".ts") ? "../../hooks/magic-context/raw-ordinal-warmup-worker.ts" : "./raw-ordinal-warmup-worker.js", import.meta.url);
    const current = inRootAsyncContext2(() => new Worker(entry, { workerData: { v2ArchiveReader: true } }));
    worker = current;
    shutdown = createWorkerShutdown(current, "v2-archive-reader", 2000);
    current.unref();
    const fail = (detail) => {
      if (worker !== current)
        return;
      clearTimeout(startingTimer);
      reject(new Error(`Search archive worker unavailable: ${detail}`));
      stopV2ArchiveReader();
    };
    startingTimer = setTimeout(() => fail("reader did not start"), 1e4);
    startingTimer.unref?.();
    current.on("error", (error) => fail(String(error)));
    current.on("exit", (code) => fail(`exit code ${code}`));
    current.on("message", (reply) => {
      if (worker !== current)
        return;
      if (reply.kind === "v2-archive-ready") {
        clearTimeout(startingTimer);
        rejectStart = undefined;
        resolve();
      } else if (reply.kind === "v2-archive-result") {
        const item = pending.get(reply.id);
        if (!item)
          return;
        pending.delete(reply.id);
        clearTimeout(item.timer);
        if (reply.error)
          item.reject(new Error(`Search archive worker unavailable: ${reply.error}`));
        else
          item.resolve(reply.text);
        if (pending.size === 0) {
          idle = setTimeout(() => {
            stopV2ArchiveReader();
          }, 60000);
          idle.unref?.();
        }
      }
    });
  });
  return ready;
}
async function readV2ArchiveOffThread2(path, rawPath, sessionId, read) {
  try {
    clearTimeout(idle);
    await start();
    const current = worker;
    if (!current)
      throw new Error("Search archive worker unavailable: reader stopped");
    return await new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        stopV2ArchiveReader();
      }, 10 * 60000);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer });
      try {
        current.postMessage({
          kind: "v2-archive-read",
          id,
          path,
          rawPath,
          sessionId,
          read
        });
      } catch {
        stopV2ArchiveReader();
      }
    });
  } catch (error) {
    await stopV2ArchiveReader();
    if (error instanceof Error && error.message.startsWith("Search archive worker unavailable:"))
      throw error;
    throw new Error(`Search archive worker unavailable: ${String(error)}`);
  }
}
async function serveV2ArchiveReads2(port, openConnections) {
  const [
    { Database },
    { V2StoreReaderPool },
    { createV2RawMessageReader, createV2RawMessageProvider },
    { setBoundedRawMessageProvider },
    { renderItemByTag, renderMessageByOrdinal, renderVerboseRangeForTool },
    { renderSearchArchive },
    { createV2RecoveryAttachments }
  ] = await Promise.all([
    import("./sqlite-v89bj0yy.js"),
    import("./store-reader-mmfw2h48.js"),
    import("./store-0hhs1db3.js"),
    import("./read-session-chunk-0bcnmmch.js"),
    import("./render-j28xkadk.js"),
    import("./search-archive-shn3xhsv.js"),
    import("./expand-attachments-8sxeyj26.js")
  ]);
  const pool = new V2StoreReaderPool;
  openConnections.add(pool);
  port.on("message", (request) => {
    if (request.kind !== "v2-archive-read")
      return;
    let db;
    let unregister;
    let rawReader;
    let reply;
    try {
      db = new Database(request.path, { readonly: true, fileMustExist: true });
      openConnections.add(db);
      db.exec("PRAGMA busy_timeout = 250");
      const raw = pool.open(request.rawPath);
      rawReader = raw;
      const reader = createV2RawMessageReader(() => raw, undefined, () => {});
      const attachments = createV2RecoveryAttachments(raw);
      unregister = setBoundedRawMessageProvider(request.sessionId, createV2RawMessageProvider(reader, request.sessionId));
      const read = request.read;
      let text;
      if (read.kind === "tag") {
        text = renderItemByTag(db, request.sessionId, read.tag, "part", attachments);
      } else {
        const start = read.kind === "message" ? read.message : read.start;
        const end = read.kind === "message" ? read.message : read.end;
        text = renderSearchArchive(db, request.sessionId, start, end, read.tokenBudget, read.kind === "archive" && read.archiveOnly, () => reader.ordinalMapForRange(request.sessionId, start, end));
        if (text === null && read.kind === "message") {
          text = renderMessageByOrdinal(request.sessionId, read.message, attachments);
        } else if (text === null && read.kind === "verbose") {
          text = renderVerboseRangeForTool(request.sessionId, start, end, read.tokenBudget, read.expandTools, attachments);
        }
      }
      reply = { kind: "v2-archive-result", id: request.id, text };
    } catch (error) {
      reply = { kind: "v2-archive-result", id: request.id, text: null, error: String(error) };
    } finally {
      unregister?.();
      rawReader?.close();
      if (db)
        openConnections.delete(db);
      db?.close();
    }
    port.postMessage(reply);
  });
  port.postMessage({ kind: "v2-archive-ready" });
}

export { readV2ArchiveOffThread2, serveV2ArchiveReads2 };
