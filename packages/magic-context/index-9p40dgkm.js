// ../plugin/src/shared/embedding-activity.ts
var busySessions = new Set;
function setEmbeddingSessionBusy2(sessionId, busy) {
  if (busy)
    busySessions.add(sessionId);
  else
    busySessions.delete(sessionId);
}
function observeEmbeddingActivity2(event) {
  const props = event.properties;
  if (!props || typeof props.sessionID !== "string")
    return;
  if (event.type === "session.idle" || event.type === "session.deleted" || event.type === "session.status" && props.status?.type === "idle") {
    setEmbeddingSessionBusy2(props.sessionID, false);
  } else if (event.type === "session.status" && props.status?.type) {
    setEmbeddingSessionBusy2(props.sessionID, true);
  }
}
function isEmbeddingHostBusy2() {
  return busySessions.size > 0;
}
export { setEmbeddingSessionBusy2, observeEmbeddingActivity2, isEmbeddingHostBusy2 };
