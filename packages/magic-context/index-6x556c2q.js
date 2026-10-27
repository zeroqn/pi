// ../plugin/src/shared/hidden-zen-read.ts
var blockedSessions = new Set;
var v1Runs = new Map;
function rememberV1HiddenRun(sessionID, run) {
  if (run)
    v1Runs.set(sessionID, run);
  else {
    v1Runs.delete(sessionID);
    setBlockedReadSession(sessionID, false);
  }
}
function setBlockedReadSession(sessionID, enabled) {
  if (enabled)
    blockedSessions.add(sessionID);
  else
    blockedSessions.delete(sessionID);
}

export { rememberV1HiddenRun };
