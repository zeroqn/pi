// ../plugin/src/shared/reusable-worker-entry.ts
import { EventEmitter } from "node:events";
import { parentPort, workerData } from "node:worker_threads";
function serveWorkerJobs(run, autoClose = true) {
  if (!parentPort)
    throw new Error("worker requires a parent port");
  const parent = parentPort;
  if (!workerData?.reusableWorker) {
    Promise.resolve(run(workerData, parent)).catch(rethrow);
    return;
  }
  let active;
  parent.on("message", (message) => {
    if (!("start" in message)) {
      if (active?.id === message.jobId)
        active.port.emit("message", message.value);
      return;
    }
    if (active)
      throw new Error("reusable worker received overlapping jobs");
    const id = message.jobId;
    let closed = false;
    const port = Object.assign(new EventEmitter, {
      postMessage(value, transferList) {
        if (!closed)
          parent.postMessage({ jobId: id, value }, transferList);
      },
      close() {
        if (closed)
          return;
        closed = true;
        port.removeAllListeners();
        active = undefined;
        parent.postMessage({
          jobId: id,
          finished: true,
          code: Number(process.exitCode) || 0
        });
      }
    });
    active = { id, port };
    try {
      Promise.resolve(run(message.start, port)).then(() => {
        if (autoClose)
          port.close();
      }).catch(rethrow);
    } catch (error) {
      rethrow(error);
    }
  });
}
function rethrow(error) {
  setTimeout(() => {
    throw error;
  });
}

export { serveWorkerJobs };
