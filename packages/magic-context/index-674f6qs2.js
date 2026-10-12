// ../plugin/src/shared/protected-tools-policy.ts
var DEFAULT_PROTECTED_TOOLS = {
  todowrite: 1,
  ctx_reduce: 3
};
function normalizeProtectedToolName(name) {
  return (name ?? "").toLowerCase().replace(/^mcp_/, "");
}
function mergeProtectedTools(...maps) {
  return Object.fromEntries([DEFAULT_PROTECTED_TOOLS, ...maps].flatMap((map) => Object.entries(map ?? {}).map(([name, count]) => [
    normalizeProtectedToolName(name),
    count
  ])));
}

export { DEFAULT_PROTECTED_TOOLS, normalizeProtectedToolName, mergeProtectedTools };
