// ../plugin/src/features/magic-context/memory/normalize-hash.ts
import { createHash } from "node:crypto";
function normalizeMemoryContent(content) {
  return content.toLowerCase().replace(/\s+/g, " ").trim();
}
function computeNormalizedHash(content) {
  const normalized = normalizeMemoryContent(content);
  return createHash("md5").update(normalized).digest("hex");
}

export { computeNormalizedHash };
