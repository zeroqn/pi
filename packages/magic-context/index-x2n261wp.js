// ../plugin/src/shared/worker-shutdown.ts
var WORKER_CLOSE_MESSAGE = { kind: "close" };
function isWorkerCloseMessage(message) {
  return typeof message === "object" && message !== null && message.kind === WORKER_CLOSE_MESSAGE.kind;
}
function exitOnWorkerClose(port, closeConnections, exitThread = true) {
  const listener = (message) => {
    if (!isWorkerCloseMessage(message))
      return;
    try {
      closeConnections();
    } finally {
      if (exitThread)
        process.exit(0);
      closePort();
    }
  };
  if (!port)
    return { closePort() {} };
  const owner = port;
  owner.on("message", listener);
  let closed = false;
  function closePort() {
    if (closed)
      return;
    closed = true;
    setTimeout(() => {
      owner.off("message", listener);
      owner.close();
    });
  }
  return { closePort };
}
var outcomes = new Map;
function createWorkerShutdown(worker, site, deadlineMs) {
  let exited = false;
  let forced = false;
  let closing;
  const exit = new Promise((resolve) => {
    worker.once("exit", () => {
      exited = true;
      resolve();
    });
  });
  const record = () => {
    const counts = outcomes.get(site) ?? { graceful: 0, forced: 0 };
    if (forced)
      counts.forced += 1;
    else
      counts.graceful += 1;
    outcomes.set(site, counts);
  };
  const terminate = () => {
    forced = true;
    worker.terminate().catch(() => {});
  };
  return {
    close() {
      if (closing)
        return closing;
      if (exited) {
        closing = Promise.resolve();
        return closing;
      }
      try {
        worker.postMessage(WORKER_CLOSE_MESSAGE);
      } catch {
        terminate();
      }
      const fallback = setTimeout(() => {
        if (!exited)
          terminate();
      }, deadlineMs);
      fallback.unref?.();
      closing = exit.then(() => {
        clearTimeout(fallback);
        record();
      });
      return closing;
    }
  };
}

export { isWorkerCloseMessage, exitOnWorkerClose, createWorkerShutdown };
