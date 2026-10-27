// ../plugin/src/shared/worker-shutdown.ts
var WORKER_CLOSE_MESSAGE = { kind: "close" };
function isWorkerCloseMessage(message) {
  return typeof message === "object" && message !== null && message.kind === WORKER_CLOSE_MESSAGE.kind;
}
function exitOnWorkerClose(port, closeConnections) {
  const listener = (message) => {
    if (!isWorkerCloseMessage(message))
      return;
    try {
      closeConnections();
    } finally {
      process.exit(0);
    }
  };
  if (!port)
    return { closePort() {} };
  port.on("message", listener);
  let closed = false;
  return {
    closePort() {
      if (closed)
        return;
      closed = true;
      setTimeout(() => {
        port.off("message", listener);
        port.close();
      });
    }
  };
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
