// ../plugin/src/shared/exit-abort-registry.ts
var controllers = new Set;
var listenerRegistered = false;
function abortAll() {
  for (const controller of controllers) {
    try {
      controller.abort();
    } catch {}
  }
}
function registerExitAbort(controller) {
  controllers.add(controller);
  if (listenerRegistered)
    return;
  listenerRegistered = true;
  process.once("exit", abortAll);
}

export { registerExitAbort };
