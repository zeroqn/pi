import {
  log2
} from "./index-f956htf3.js";

// ../plugin/src/shared/internal-initiator-marker.ts
var OMO_INTERNAL_INITIATOR_MARKER = "<!-- OMO_INTERNAL_INITIATOR -->";

// ../plugin/src/shared/system-directive.ts
var SYSTEM_DIRECTIVE_PREFIX = "[SYSTEM DIRECTIVE: MAGIC-CONTEXT";
function isSystemDirective(text) {
  return text.trimStart().startsWith(SYSTEM_DIRECTIVE_PREFIX);
}
function removeSystemReminders(text) {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "").trim();
}

// ../plugin/src/hooks/magic-context/read-session-formatting.ts
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ../plugin/src/shared/commit-detection.ts
var HASH_HEX = "[0-9a-f]{7,12}";
var COMMIT_HASH_TEST_PATTERN = new RegExp(`\\b${HASH_HEX}\\b`, "i");
var COMMIT_VERB_PATTERN = /\b(?:commit(?:ted|ting|s)?|cherry-?pick(?:ed|ing|s)?|merge[ds]?|merging|rebas(?:e|ed|es|ing))\b/i;
function textMentionsRecentCommit(text) {
  return COMMIT_HASH_TEST_PATTERN.test(text) && COMMIT_VERB_PATTERN.test(text);
}
function createCommitHashExtractPattern() {
  return new RegExp(`\`?\\b(${HASH_HEX})\\b\`?`, "gi");
}

// ../plugin/src/hooks/magic-context/token-count-exact.ts
var NO_RANK = 4294967295;
var LONG_PIECE_BYTES = 256;
var MERGE_CACHE_GENERATION = 50000;
function hasInternals(tokenizer) {
  const value = tokenizer;
  return !!value && value.patternRegex instanceof RegExp && value.patternRegex.global && typeof value.stringRankEncoder === "object" && value.stringRankEncoder !== null && Array.isArray(value.binaryFirstByteIndex);
}
var textEncoder = new TextEncoder;
var textDecoder = new TextDecoder("utf-8");
function isValidUtf8(bytes) {
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index];
    let size = 0;
    let codePoint = 0;
    if (first <= 127) {
      size = 1;
      codePoint = first;
    } else if ((first & 224) === 192) {
      size = 2;
      codePoint = first & 31;
      if (first <= 193)
        return false;
    } else if ((first & 240) === 224) {
      size = 3;
      codePoint = first & 15;
    } else if ((first & 248) === 240) {
      size = 4;
      codePoint = first & 7;
      if (first > 244)
        return false;
    } else
      return false;
    if (index + size > bytes.length)
      return false;
    for (let offset = 1;offset < size; offset += 1) {
      const byte = bytes[index + offset];
      if ((byte & 192) !== 128)
        return false;
      codePoint = codePoint << 6 | byte & 63;
    }
    if (size === 2 && codePoint < 128)
      return false;
    if (size === 3 && codePoint < 2048)
      return false;
    if (size === 4 && codePoint < 65536)
      return false;
    if (codePoint >= 55296 && codePoint <= 57343)
      return false;
    if (codePoint > 1114111)
      return false;
    index += size;
  }
  return true;
}
function binarySearchBytes(sorted, key) {
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    const mid = low + high >>> 1;
    const midKey = sorted[mid][0];
    let compare = 0;
    const shared = Math.min(midKey.length, key.length);
    for (let index = 0;index < shared; index += 1) {
      compare = midKey[index] - key[index];
      if (compare !== 0)
        break;
    }
    if (compare === 0)
      compare = midKey.length - key.length;
    if (compare === 0)
      return sorted[mid][1];
    if (compare < 0)
      low = mid + 1;
    else
      high = mid - 1;
  }
  return -1;
}
function rankOf(tokenizer, slice) {
  if (isValidUtf8(slice)) {
    const rank = tokenizer.stringRankEncoder[textDecoder.decode(slice)];
    if (rank !== undefined)
      return rank;
  }
  const bucket = tokenizer.binaryFirstByteIndex[slice[0]];
  if (bucket !== null && bucket !== undefined) {
    const rank = binarySearchBytes(bucket, slice);
    if (rank !== -1)
      return rank;
  }
  return NO_RANK;
}
function mergeByScanning(tokenizer, bytes) {
  const starts = [];
  const ranks = [];
  const pairRank = (index) => {
    const end = starts[index + 2];
    return end === undefined ? NO_RANK : rankOf(tokenizer, bytes.subarray(starts[index], end));
  };
  for (let index = 0;index <= bytes.length; index += 1)
    starts.push(index);
  for (let index = 0;index < starts.length; index += 1)
    ranks.push(pairRank(index));
  while (starts.length > 1) {
    let minRank = NO_RANK;
    let minIndex = -1;
    for (let index = 0;index < ranks.length - 1; index += 1) {
      if (ranks[index] < minRank) {
        minRank = ranks[index];
        minIndex = index;
      }
    }
    if (minIndex === -1)
      break;
    starts.splice(minIndex + 1, 1);
    ranks.splice(minIndex, 1);
    ranks[minIndex] = pairRank(minIndex);
    if (minIndex > 0)
      ranks[minIndex - 1] = pairRank(minIndex - 1);
  }
  const tokens = [];
  for (let index = 0;index < starts.length - 1; index += 1) {
    const rank = rankOf(tokenizer, bytes.subarray(starts[index], starts[index + 1]));
    if (rank !== NO_RANK)
      tokens.push(rank);
  }
  return tokens;
}
function mergeWithHeap(tokenizer, bytes) {
  const length = bytes.length;
  const next = new Int32Array(length + 1);
  const prev = new Int32Array(length + 1);
  const alive = new Uint8Array(length + 1).fill(1);
  const rank = new Float64Array(length + 1).fill(NO_RANK);
  for (let index = 0;index <= length; index += 1) {
    next[index] = index + 1;
    prev[index] = index - 1;
  }
  const heapRank = [];
  const heapAt = [];
  const less = (a, b) => heapRank[a] < heapRank[b] || heapRank[a] === heapRank[b] && heapAt[a] < heapAt[b];
  const swap = (a, b) => {
    [heapRank[a], heapRank[b]] = [heapRank[b], heapRank[a]];
    [heapAt[a], heapAt[b]] = [heapAt[b], heapAt[a]];
  };
  const push = (value, at) => {
    heapRank.push(value);
    heapAt.push(at);
    let child = heapRank.length - 1;
    while (child > 0) {
      const parent = child - 1 >> 1;
      if (!less(child, parent))
        break;
      swap(child, parent);
      child = parent;
    }
  };
  const pop = () => {
    const last = heapRank.length - 1;
    swap(0, last);
    heapRank.pop();
    heapAt.pop();
    let parent = 0;
    for (;; ) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let smallest = parent;
      if (left < heapRank.length && less(left, smallest))
        smallest = left;
      if (right < heapRank.length && less(right, smallest))
        smallest = right;
      if (smallest === parent)
        break;
      swap(parent, smallest);
      parent = smallest;
    }
  };
  const pairRank = (at) => {
    const middle = next[at];
    if (middle >= length)
      return NO_RANK;
    return rankOf(tokenizer, bytes.subarray(at, next[middle]));
  };
  const update = (at) => {
    rank[at] = pairRank(at);
    if (rank[at] !== NO_RANK)
      push(rank[at], at);
  };
  for (let at = 0;at < length; at += 1)
    update(at);
  while (heapRank.length > 0) {
    const value = heapRank[0];
    const at = heapAt[0];
    pop();
    if (!alive[at] || rank[at] !== value)
      continue;
    const removed = next[at];
    alive[removed] = 0;
    next[at] = next[removed];
    prev[next[removed]] = at;
    update(at);
    if (at > 0)
      update(prev[at]);
  }
  const tokens = [];
  for (let at = 0;at < length; at = next[at]) {
    const value = rankOf(tokenizer, bytes.subarray(at, next[at]));
    if (value !== NO_RANK)
      tokens.push(value);
  }
  return tokens;
}
var mergeCaches = new WeakMap;
var mergedPieces = 0;
function mergePiece(tokenizer, piece) {
  let cache = mergeCaches.get(tokenizer);
  if (!cache) {
    cache = { current: new Map, previous: new Map };
    mergeCaches.set(tokenizer, cache);
  }
  let tokens = cache.current.get(piece);
  if (tokens)
    return tokens;
  tokens = cache.previous.get(piece);
  if (!tokens) {
    const bytes = textEncoder.encode(piece);
    mergedPieces += 1;
    tokens = bytes.length > LONG_PIECE_BYTES ? mergeWithHeap(tokenizer, bytes) : mergeByScanning(tokenizer, bytes);
  }
  if (cache.current.size >= MERGE_CACHE_GENERATION) {
    cache.previous = cache.current;
    cache.current = new Map;
  }
  cache.current.set(piece, tokens);
  return tokens;
}
function encodeTokensExactly(tokenizer, text) {
  if (!hasInternals(tokenizer)) {
    return tokenizer.encode(text, "all");
  }
  if (text.length < 10) {
    const direct = tokenizer.stringRankEncoder[text];
    if (direct !== undefined)
      return [direct];
  }
  const tokens = [];
  const regex = tokenizer.patternRegex;
  regex.lastIndex = 0;
  for (let match = regex.exec(text);match !== null; match = regex.exec(text)) {
    const piece = match[0];
    const direct = tokenizer.stringRankEncoder[piece];
    if (direct !== undefined) {
      tokens.push(direct);
      continue;
    }
    for (const token of mergePiece(tokenizer, piece))
      tokens.push(token);
  }
  return tokens;
}
function countTokensExactly(tokenizer, text) {
  return encodeTokensExactly(tokenizer, text).length;
}

// ../plugin/src/hooks/magic-context/read-session-formatting.ts
var MAX_COMMITS_PER_BLOCK = 5;
function hasMeaningfulUserText2(parts) {
  for (const part of parts) {
    if (part === null || typeof part !== "object")
      continue;
    const candidate = part;
    if (candidate.type !== "text" || typeof candidate.text !== "string")
      continue;
    if (candidate.ignored === true)
      continue;
    const cleaned = removeSystemReminders(candidate.text).replace(OMO_INTERNAL_INITIATOR_MARKER, "").trim();
    if (!cleaned)
      continue;
    if (isSystemDirective(cleaned))
      continue;
    return true;
  }
  return false;
}
function extractTexts2(parts) {
  const texts = [];
  for (const part of parts) {
    if (part === null || typeof part !== "object")
      continue;
    const p = part;
    if (p.type === "text" && typeof p.text === "string" && p.text.trim().length > 0) {
      texts.push(p.text.trim());
    }
  }
  return texts;
}
function extractToolResultBodyTokens(parts) {
  let tokens = 0;
  for (const part of parts) {
    if (part === null || typeof part !== "object")
      continue;
    const p = part;
    if (p.type !== "tool")
      continue;
    const state = p.state;
    if (!state || typeof state !== "object")
      continue;
    const body = state.output ?? state.error;
    if (body === undefined)
      continue;
    const text = typeof body === "string" ? body : JSON.stringify(body);
    tokens += Math.ceil(text.length / 4);
  }
  return tokens;
}
function extractToolCallSummaries(parts) {
  const summaries = [];
  for (const part of parts) {
    if (part === null || typeof part !== "object")
      continue;
    const p = part;
    if (p.type !== "tool" || typeof p.tool !== "string")
      continue;
    const state = p.state;
    if (!state || typeof state !== "object")
      continue;
    const input = state.input;
    const metadata = state.metadata;
    const description = input && typeof input.description === "string" && input.description || metadata && typeof metadata.description === "string" && metadata.description;
    if (description) {
      summaries.push(`TC: ${description}`);
      continue;
    }
    const toolName = p.tool;
    const keyArg = extractKeyArg(toolName, input);
    summaries.push(keyArg ? `TC: ${toolName}(${keyArg})` : `TC: ${toolName}`);
  }
  return summaries;
}
function extractKeyArg(_toolName, input) {
  if (!input)
    return null;
  if (typeof input.filePath === "string")
    return truncateArg(input.filePath);
  if (typeof input.path === "string")
    return truncateArg(input.path);
  if (typeof input.pattern === "string")
    return truncateArg(input.pattern);
  if (typeof input.query === "string")
    return truncateArg(input.query);
  if (typeof input.symbol === "string")
    return input.symbol;
  if (typeof input.module === "string")
    return input.module;
  if (typeof input.action === "string")
    return input.action;
  return null;
}
function truncateArg(value, maxLen = 60) {
  if (value.length <= maxLen)
    return value;
  return `${value.slice(0, maxLen)}…`;
}
var TOKENIZER_PACKAGE_DIRS = [
  ["@cortexkit", "opencode-magic-context"],
  ["@cortexkit", "pi-magic-context"]
];
var tokenizer;
var tokenizerLoadAttempted = false;
var tokenizerLoadPromise;
var tokenizerWarningSent = false;
var tokenizerEncodingPath;
var tokenizerSerializedTableBytes;
function tokenizerPackageRoots() {
  const cwd = process.cwd();
  const openCodeCache = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "opencode");
  const candidates = [];
  const probeRoot = (root) => {
    for (const packageDir of TOKENIZER_PACKAGE_DIRS) {
      candidates.push(join(root, "node_modules", ...packageDir, "node_modules", "ai-tokenizer"));
    }
    candidates.push(join(root, "node_modules", "ai-tokenizer"));
  };
  for (const root of [cwd, openCodeCache]) {
    probeRoot(root);
  }
  const pushAncestors = (startDir) => {
    let ancestor = startDir;
    while (true) {
      candidates.push(join(ancestor, "node_modules", "ai-tokenizer"));
      const parent = dirname(ancestor);
      if (parent === ancestor)
        break;
      ancestor = parent;
    }
  };
  pushAncestors(process.argv[1] ? dirname(resolve(process.argv[1])) : cwd);
  const ownDir = dirname(fileURLToPath(new URL(import.meta.url)));
  pushAncestors(ownDir);
  probeRoot(join(homedir(), ".omp", "plugins"));
  return [...new Set(candidates)];
}
function packageImportTarget(value) {
  if (typeof value === "string")
    return value;
  if (!value || typeof value !== "object")
    return;
  const conditions = value;
  return packageImportTarget(conditions.import) ?? packageImportTarget(conditions.default);
}
function findTokenizerImportPaths() {
  for (const packageRoot of tokenizerPackageRoots()) {
    const packageJsonPath = join(packageRoot, "package.json");
    if (!existsSync(packageJsonPath))
      continue;
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
      const tokenizerTarget = packageImportTarget(packageJson.exports?.["."]) ?? (typeof packageJson.module === "string" ? packageJson.module : undefined) ?? (typeof packageJson.main === "string" ? packageJson.main : undefined);
      const encodingTarget = packageImportTarget(packageJson.exports?.["./encoding/claude"]);
      if (!tokenizerTarget || !encodingTarget)
        continue;
      return {
        tokenizerPath: realpathSync(join(packageRoot, tokenizerTarget)),
        encodingPath: realpathSync(join(packageRoot, encodingTarget))
      };
    } catch {}
  }
  return;
}
function constructTokenizer(tokenizerModule, claudeEncoding) {
  const typedModule = tokenizerModule;
  const Tokenizer = typedModule.default ?? typedModule.Tokenizer;
  if (!Tokenizer) {
    throw new Error("ai-tokenizer does not expose a Tokenizer constructor");
  }
  return new Tokenizer(claudeEncoding);
}
function loadTokenizer() {
  const requireFromThisModule = createRequire(import.meta.url);
  const encodingSpecifier = "ai-tokenizer/encoding/" + "claude";
  tokenizerEncodingPath = requireFromThisModule.resolve(encodingSpecifier);
  tokenizerSerializedTableBytes = undefined;
  return constructTokenizer(requireFromThisModule("ai-" + "tokenizer"), requireFromThisModule(encodingSpecifier));
}
async function loadTokenizerFromInstalledPackage() {
  const installedPaths = findTokenizerImportPaths();
  if (!installedPaths) {
    throw new Error("ai-tokenizer was not found under the project, runtime, or OpenCode cache node_modules roots");
  }
  const [tokenizerModule, claudeEncoding] = await Promise.all([
    import(pathToFileURL(installedPaths.tokenizerPath).href),
    import(pathToFileURL(installedPaths.encodingPath).href)
  ]);
  tokenizerEncodingPath = installedPaths.encodingPath;
  tokenizerSerializedTableBytes = undefined;
  return constructTokenizer(tokenizerModule, claudeEncoding);
}
function warnTokenizerFallback(error) {
  if (tokenizerWarningSent)
    return;
  tokenizerWarningSent = true;
  const reason = error instanceof Error ? error.message : String(error);
  log2("[magic-context] ai-tokenizer is unavailable; using approximate character-based token counts for this process. Token budgets, persisted per-message counts, and protected-tail/compartment boundaries may be less accurate until restart:", reason);
}
async function preloadTokenizer() {
  if (tokenizer)
    return true;
  if (tokenizerLoadAttempted)
    return false;
  if (tokenizerLoadPromise)
    return tokenizerLoadPromise;
  tokenizerLoadPromise = (async () => {
    try {
      try {
        tokenizer = loadTokenizer();
      } catch {
        tokenizer = await loadTokenizerFromInstalledPackage();
      }
      tokenizerLoadAttempted = true;
      return true;
    } catch (error) {
      tokenizerLoadAttempted = true;
      warnTokenizerFallback(error);
      return false;
    } finally {
      tokenizerLoadPromise = undefined;
    }
  })();
  return tokenizerLoadPromise;
}
function getTokenizer() {
  if (tokenizer || tokenizerLoadAttempted)
    return tokenizer;
  tokenizerLoadAttempted = true;
  try {
    tokenizer = loadTokenizer();
  } catch (error) {
    warnTokenizerFallback(error);
  }
  return tokenizer;
}
function estimateTokensHeuristically(text) {
  return Math.ceil(text.length / 3.5);
}
var TOKEN_ESTIMATOR_SAMPLE = 'Coverage check: const windows = chunk(text, 0x1f, 512); // ok? "naïve" café 日本語 <EOT> 3.14159 ->  done.';
var estimatorFingerprintTokenizer;
var estimatorFingerprint = "";
function getTokenEstimatorFingerprint() {
  const activeTokenizer = getTokenizer();
  if (!activeTokenizer) {
    return `heuristic:${estimateTokensHeuristically(TOKEN_ESTIMATOR_SAMPLE)}`;
  }
  if (estimatorFingerprintTokenizer === activeTokenizer)
    return estimatorFingerprint;
  let fingerprint;
  try {
    fingerprint = `tokenizer:${activeTokenizer.encode(TOKEN_ESTIMATOR_SAMPLE, "all").length}`;
  } catch {
    fingerprint = "tokenizer:sample-unencodable";
  }
  estimatorFingerprintTokenizer = activeTokenizer;
  estimatorFingerprint = fingerprint;
  return fingerprint;
}
function hasTokenizerForFit() {
  return getTokenizer() !== undefined;
}
function tokenCountUsesByteBound(text) {
  return text.length > 1024 * 1024 || /[\p{L}\p{N}]{16385}/u.test(text);
}
function estimateTokens(text) {
  if (!text)
    return 0;
  const activeTokenizer = getTokenizer();
  if (!activeTokenizer)
    return estimateTokensHeuristically(text);
  try {
    return countTokensExactly(activeTokenizer, text);
  } catch (error) {
    tokenizer = undefined;
    tokenizerLoadAttempted = true;
    warnTokenizerFallback(error);
    return estimateTokensHeuristically(text);
  }
}
function createTokenCountMemo(maxEntries, maxBytes) {
  const counts = new Map;
  let bytes = 0;
  return (text) => {
    const cached = counts.get(text);
    if (cached && cached.tokenizer === getTokenizer())
      return cached.tokens;
    const tokens = estimateTokens(text);
    if (cached) {
      bytes -= text.length * 2;
      counts.delete(text);
    }
    if (text.length * 2 <= maxBytes) {
      while (counts.size >= maxEntries || bytes + text.length * 2 > maxBytes) {
        const oldest = counts.keys().next().value;
        if (oldest === undefined)
          break;
        bytes -= oldest.length * 2;
        counts.delete(oldest);
      }
      counts.set(text, { tokenizer: getTokenizer(), tokens });
      bytes += text.length * 2;
    }
    return tokens;
  };
}
var promptTokenCounts = new Map;
var promptTokenCountBytes = 0;
var PROMPT_TOKEN_COUNT_BYTES = 8 * 1024 * 1024;
function estimateFixedPromptTokens(text) {
  const activeTokenizer = getTokenizer();
  const cached = promptTokenCounts.get(text);
  if (cached && cached.tokenizer === activeTokenizer) {
    promptTokenCounts.delete(text);
    promptTokenCounts.set(text, cached);
    return cached.tokens;
  }
  const tokens = estimateTokens(text);
  if (cached) {
    promptTokenCountBytes -= text.length * 2;
    promptTokenCounts.delete(text);
  }
  if (text.length * 2 <= PROMPT_TOKEN_COUNT_BYTES) {
    while (promptTokenCounts.size >= 64 || promptTokenCountBytes + text.length * 2 > PROMPT_TOKEN_COUNT_BYTES) {
      const oldest = promptTokenCounts.keys().next().value;
      if (oldest === undefined)
        break;
      promptTokenCountBytes -= oldest.length * 2;
      promptTokenCounts.delete(oldest);
    }
    promptTokenCounts.set(text, { tokenizer: getTokenizer(), tokens });
    promptTokenCountBytes += text.length * 2;
  }
  return tokens;
}
function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}
function compactRole(role) {
  if (role === "assistant")
    return "A";
  if (role === "user")
    return "U";
  return role.slice(0, 1).toUpperCase() || "M";
}
function formatBlock(block) {
  const range = block.startOrdinal === block.endOrdinal ? `[${block.startOrdinal}]` : `[${block.startOrdinal}-${block.endOrdinal}]`;
  const commitSuffix = block.commitHashes.length > 0 ? ` commits: ${block.commitHashes.join(", ")}` : "";
  return `${range} ${block.role}:${commitSuffix} ${block.parts.join(" / ")}`;
}
function extractCommitHashes(text) {
  const hashes = [];
  const seen = new Set;
  for (const match of text.matchAll(createCommitHashExtractPattern())) {
    const hash = match[1]?.toLowerCase();
    if (!hash || seen.has(hash))
      continue;
    seen.add(hash);
    hashes.push(hash);
    if (hashes.length >= MAX_COMMITS_PER_BLOCK)
      break;
  }
  return hashes;
}
function compactTextForSummary(text, role) {
  const commitHashes = role === "assistant" ? extractCommitHashes(text) : [];
  if (commitHashes.length === 0 || !COMMIT_VERB_PATTERN.test(text)) {
    return { text, commitHashes };
  }
  const withoutHashes = text.replace(createCommitHashExtractPattern(), "").replace(/\(\s*\)/g, "").replace(/\s+,/g, ",").replace(/,\s*,+/g, ", ").replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
  return {
    text: withoutHashes.length > 0 ? withoutHashes : text,
    commitHashes
  };
}
function mergeCommitHashes(existing, next) {
  if (next.length === 0)
    return existing;
  const merged = [...existing];
  for (const hash of next) {
    if (merged.includes(hash))
      continue;
    merged.push(hash);
    if (merged.length >= MAX_COMMITS_PER_BLOCK)
      break;
  }
  return merged;
}

export { textMentionsRecentCommit, OMO_INTERNAL_INITIATOR_MARKER, isSystemDirective, removeSystemReminders, hasMeaningfulUserText2, extractTexts2, extractToolResultBodyTokens, extractToolCallSummaries, preloadTokenizer, getTokenEstimatorFingerprint, hasTokenizerForFit, tokenCountUsesByteBound, estimateTokens, createTokenCountMemo, estimateFixedPromptTokens, normalizeText, compactRole, formatBlock, compactTextForSummary, mergeCommitHashes };
