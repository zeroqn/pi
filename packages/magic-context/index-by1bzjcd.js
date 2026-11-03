// ../plugin/src/hooks/magic-context/host-served-rows.ts
var HOST_UNSERVED_ROW = "hostUnservedRow";
function markHostUnservedRow(target) {
  Object.defineProperty(target, HOST_UNSERVED_ROW, {
    value: true,
    enumerable: false,
    configurable: true
  });
  return target;
}
function isHostUnservedRow(value) {
  return typeof value === "object" && value !== null && value[HOST_UNSERVED_ROW] === true;
}
function retreatPastHostUnservedRows(messages, exclusiveEnd, floor) {
  if (!messages.some(isHostUnservedRow))
    return exclusiveEnd;
  const byOrdinal = new Map(messages.map((message) => [message.ordinal, message]));
  let end = exclusiveEnd;
  while (end - 1 >= floor && isHostUnservedRow(byOrdinal.get(end - 1)))
    end -= 1;
  return end;
}

export { markHostUnservedRow, isHostUnservedRow, retreatPastHostUnservedRows };
