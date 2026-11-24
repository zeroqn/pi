import {
  canonicalModelIdentity,
  piModelRefToCanonical,
  resolveModelConfigValue,
  DEFAULT_PROTECTED_TOOLS,
  normalizeProtectedToolName,
  mergeProtectedTools,
  deriveDefaultProtectedTokens
} from "./index-vcegxfwg.js";
import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  sessionLog2
} from "./index-tm11k42a.js";
import {
  estimateTokens,
  createTokenCountMemo
} from "./index-pefn1gt5.js";
import {
  stableStringify,
  jsonHashSink,
  tagOrderConstraintIndex,
  tagIdentityRevisionKey
} from "./index-jhmz9tgv.js";
import {
  getTagIdentityWriteGeneration2,
  getSqliteDatabasePath2,
  prepareCachedStatement2
} from "./index-2qtx0q6h.js";
import {
  logSlowWriteTransaction
} from "./index-1ts77n1b.js";

// ../plugin/src/features/magic-context/overflow-detection.ts
var TOKEN_COUNT = String.raw`(?<![\d+_-])(?:\d+(?:[,_ .\u202f]+\d+)*(?=\s*tokens?\b)|\d+(?:[,_ \u202f]+\d+)*)(?!\w|[,_\s.]+\d)`;
var ESTIMATED_REQUEST = String.raw`\bthis request has an estimated\b`;
function overflowPattern(strings, ...fragments) {
  return new RegExp(String.raw(strings, ...fragments), "i");
}
var OVERFLOW_PATTERNS = [
  /prompt is too long/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /input token count.*exceeds the maximum/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  overflowPattern`maximum context length is ${TOKEN_COUNT} tokens?\b`,
  /maximum model length is \d+/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /request entity too large/i,
  overflowPattern`context length is only ${TOKEN_COUNT} tokens?\b`,
  /input length.*exceeds.*context length/i,
  /\bContextWindowExceededError\b/i,
  overflowPattern`\bthe input \(${TOKEN_COUNT} tokens?\) is longer than the model's context length \(${TOKEN_COUNT} tokens?\)`,
  /prompt too long; exceeded (?:max )?context length/i,
  overflowPattern`too large for model with ${TOKEN_COUNT} maximum context length`,
  /model_context_window_exceeded/i,
  /context size has been exceeded/i,
  /prepared prompt exceeds engine max_context/i,
  /prompt exceeds (?:the )?.{0,32}\bmax_context\b/i
];
var LIMIT_EXTRACTION_PATTERNS = [
  {
    pattern: overflowPattern`maximum prompt length is (${TOKEN_COUNT})`,
    provenance: "prompt_only"
  },
  {
    pattern: overflowPattern`maximum context length is (${TOKEN_COUNT}) tokens?\b`,
    provenance: "combined"
  },
  { pattern: overflowPattern`maximum model length is (${TOKEN_COUNT})`, provenance: "combined" },
  {
    pattern: overflowPattern`context length is only (${TOKEN_COUNT}) tokens?\b`,
    provenance: "combined"
  },
  { pattern: overflowPattern`exceeds the limit of (${TOKEN_COUNT})`, provenance: "unknown" },
  {
    pattern: overflowPattern`too large for model with (${TOKEN_COUNT}) maximum context length`,
    provenance: "combined"
  },
  {
    pattern: overflowPattern`context size[^0-9]{0,40}(${TOKEN_COUNT})\s*tokens?\b`,
    provenance: "combined"
  },
  {
    pattern: overflowPattern`exceeds? the context length of (${TOKEN_COUNT})`,
    provenance: "combined"
  },
  {
    pattern: overflowPattern`\bthe input \(${TOKEN_COUNT} tokens?\) is longer than the model's context length \((${TOKEN_COUNT}) tokens?\)`,
    provenance: "combined"
  },
  {
    pattern: overflowPattern`>\s*(${TOKEN_COUNT})\s*(?:tokens?\s*)?(?:maximum|max|limit)\b`,
    provenance: "prompt_only"
  },
  {
    pattern: overflowPattern`maximum number of tokens allowed\s*\(?\s*(${TOKEN_COUNT})`,
    provenance: "prompt_only"
  },
  {
    pattern: overflowPattern`prepared prompt exceeds engine max_context\s+(${TOKEN_COUNT})`,
    provenance: "unknown"
  },
  {
    pattern: overflowPattern`prompt exceeds (?:the )?.{0,32}\bmax_context\s+(${TOKEN_COUNT})`,
    provenance: "unknown"
  },
  {
    pattern: overflowPattern`\ballows a context of up to (${TOKEN_COUNT}) tokens?\b`,
    provenance: "combined"
  },
  {
    pattern: overflowPattern`(?<!${ESTIMATED_REQUEST}\s+)\bup to (${TOKEN_COUNT}) tokens?\b`,
    provenance: "unknown"
  },
  {
    pattern: overflowPattern`max(?:imum)?.*context(?:(?!${ESTIMATED_REQUEST})[^\d\r\n])*(${TOKEN_COUNT})`,
    provenance: "unknown"
  }
];
function parseTokenCount(raw) {
  if (raw === undefined || !/^(?:\d+|\d{1,3}([,_ .\u202f])\d{3}(?:\1\d{3})*)$/.test(raw)) {
    return null;
  }
  const value = Number(raw.replace(/[,_ .\u202f]/g, ""));
  return Number.isSafeInteger(value) ? value : null;
}
var MIN_PLAUSIBLE_LIMIT = 1024;
var MAX_PLAUSIBLE_LIMIT = 1e7;
var THINKING_BINDING_MISMATCH_PATTERN = /bound to a different conversation/i;
var THINKING_BINDING_FAILING_PATH_PATTERN = /^\s*(messages\.\d+\.content\.\d+):/;
var THINKING_BINDING_FIRST_CHANGED_PATTERN = /first at `?(messages\.\d+\.content\.\d+)`?/;
function extractErrorMessage(error) {
  if (!error)
    return "";
  if (typeof error === "string")
    return error;
  if (typeof error === "object") {
    const obj = error;
    const nested = obj.error;
    if (nested && typeof nested.message === "string" && nested.message.length > 0) {
      return nested.message;
    }
  }
  if (error instanceof Error)
    return error.message;
  if (typeof error === "object") {
    const obj = error;
    if (typeof obj.message === "string")
      return obj.message;
    if (typeof obj.responseBody === "string")
      return obj.responseBody;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}
function extractExplicitHttpStatus(error) {
  if (!error || typeof error !== "object")
    return;
  const seen = new Set;
  const queue = [error];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current))
      continue;
    seen.add(current);
    const record = current;
    for (const key of ["status", "statusCode", "status_code"]) {
      const value = record[key];
      if (typeof value === "number")
        return value;
    }
    for (const value of Object.values(record)) {
      if (value && typeof value === "object")
        queue.push(value);
    }
  }
  return;
}
function detectThinkingBindingMismatch(error) {
  const message = extractErrorMessage(error);
  const explicitStatus = extractExplicitHttpStatus(error);
  if (explicitStatus !== undefined && explicitStatus !== 400 || !THINKING_BINDING_MISMATCH_PATTERN.test(message)) {
    return { isBindingMismatch: false };
  }
  const failingBlockPath = THINKING_BINDING_FAILING_PATH_PATTERN.exec(message)?.[1];
  const firstChangedPath = THINKING_BINDING_FIRST_CHANGED_PATTERN.exec(message)?.[1];
  return {
    isBindingMismatch: true,
    matchedPattern: "bound to a different conversation",
    ...failingBlockPath ? { failingBlockPath } : {},
    ...firstChangedPath ? { firstChangedPath } : {}
  };
}
function detectLatestTurnThinkingMismatch(error) {
  const status = extractExplicitHttpStatus(error);
  return (status === undefined || status === 400) && /(?:thinking|redacted_thinking)[\s\S]*latest assistant (?:message|turn)[\s\S]*cannot be modified/i.test(extractErrorMessage(error));
}
var PREFIX_BOUND_THINKING_MODELS = [
  ["fable", 5, 1],
  ["fable", 5, 2],
  ["mythos", 5, 1],
  ["mythos", 5, 2],
  ["opus", 5, 5],
  ["sonnet", 5, 5],
  ["haiku", 5, 5]
];
var PREFIX_BOUND_THINKING_PATTERN = new RegExp(`(?:^|[-_.:/])(?:${PREFIX_BOUND_THINKING_MODELS.map(([family, major, minor]) => `${family}[-_.]?${major}[-_.]${minor}`).join("|")})(?:$|[-_.:/@])`, "i");
function isPrefixBoundThinkingModel(_providerID, modelID) {
  if (!modelID)
    return false;
  return PREFIX_BOUND_THINKING_PATTERN.test(modelID);
}
function isFable51ThinkingBindingModel(providerID, modelID) {
  if (providerID?.toLowerCase() !== "anthropic" || !modelID)
    return false;
  return /(?:^|[-_.])fable[-_.]?5[-_.]1(?:$|[-_.])/i.test(modelID);
}
function detectOverflow(error) {
  const message = extractErrorMessage(error);
  if (!message) {
    return { isOverflow: false };
  }
  const hasStatus413 = /\b413\b/.test(message) && /(entity|payload|context|prompt)/i.test(message);
  let matched;
  for (const pattern of OVERFLOW_PATTERNS) {
    if (pattern.test(message)) {
      matched = pattern;
      break;
    }
  }
  if (!matched && !hasStatus413) {
    return { isOverflow: false };
  }
  const reportedLimit = parseReportedLimit(message);
  const reportedInputTokens = parseReportedInputTokens(message);
  return {
    isOverflow: true,
    reportedInputTokens,
    reportedLimit: reportedLimit?.value,
    reportedLimitProvenance: reportedLimit?.provenance,
    matchedPattern: matched?.source
  };
}
var INPUT_EXTRACTION_PATTERNS = [
  overflowPattern`prompt is too long:\s*(${TOKEN_COUNT})`,
  overflowPattern`input token count\s*\(?\s*(${TOKEN_COUNT})`,
  overflowPattern`input length\s*(${TOKEN_COUNT})`,
  overflowPattern`prompt was\s*(${TOKEN_COUNT})`,
  overflowPattern`messages resulted in\s*(${TOKEN_COUNT})\s*tokens?\b`,
  overflowPattern`\bthe input \((${TOKEN_COUNT}) tokens?\) is longer than the model's context length \(${TOKEN_COUNT} tokens?\)`,
  overflowPattern`\(\s*(${TOKEN_COUNT})\s+in the messages,\s*${TOKEN_COUNT}\s+in the completion\s*\)`,
  overflowPattern`${ESTIMATED_REQUEST}\s+(${TOKEN_COUNT})`
];
function parseReportedInputTokens(message) {
  if (!message)
    return;
  for (const pattern of INPUT_EXTRACTION_PATTERNS) {
    const value = parseTokenCount(message.match(pattern)?.[1]);
    if (value !== null && value > 0)
      return value;
  }
  return;
}
function parseReportedLimit(message) {
  if (!message)
    return;
  for (const { pattern, provenance } of LIMIT_EXTRACTION_PATTERNS) {
    const value = parseTokenCount(message.match(pattern)?.[1]);
    if (value === null || value < MIN_PLAUSIBLE_LIMIT || value > MAX_PLAUSIBLE_LIMIT)
      continue;
    return { value, provenance };
  }
  return;
}

// ../plugin/src/shared/context-limit-provenance.ts
function normalizeContextLimitProvenance(value) {
  if (value === "prompt_only" || value === "combined")
    return value;
  return "unknown";
}

// ../plugin/src/shared/escalation-bands.ts
var MAX_EXECUTE_THRESHOLD = 90;
var ABSOLUTE_EMERGENCY_PERCENTAGE = 95;
function escalationBands(effectiveThresholdPercentage) {
  const threshold = Number.isFinite(effectiveThresholdPercentage) ? Math.min(effectiveThresholdPercentage, MAX_EXECUTE_THRESHOLD) : 65;
  return {
    forceMaterializationPercentage: Math.max(85, threshold + 2),
    emergencyPercentage: ABSOLUTE_EMERGENCY_PERCENTAGE
  };
}

// ../plugin/src/features/magic-context/merged-reasoning-decisions.ts
var MERGED_REASONING_PARTS_PREFIX = "__merged_reasoning_parts_v1__:";
var decodedDecisions = new Map;
var decodedDecisionBytes = 0;
var MAX_DECODED_DECISION_BYTES = 32 * 1024 * 1024;
function decodeMergedReasoningParts(value) {
  if (!value.startsWith(MERGED_REASONING_PARTS_PREFIX))
    return null;
  try {
    const record = JSON.parse(value.slice(MERGED_REASONING_PARTS_PREFIX.length));
    if (!Array.isArray(record) || record.length !== 2)
      return null;
    const [id, parts] = record;
    if (typeof id !== "string" || id.length === 0 || !Array.isArray(parts) || parts.length === 0)
      return null;
    if (!parts.every((part) => typeof part === "string" && part.length > 0 || typeof part === "number" && Number.isSafeInteger(part) && part >= 0))
      return null;
    return [id, parts];
  } catch {
    return null;
  }
}
function readFrozenMergedReasoningParts(ids) {
  const decisions = new Map;
  for (const value of ids) {
    let record = decodedDecisions.get(value);
    if (record === undefined) {
      record = decodeMergedReasoningParts(value);
      const bytes = 2 * value.length + 128;
      if (bytes <= MAX_DECODED_DECISION_BYTES) {
        while (decodedDecisions.size >= 1e5 || decodedDecisionBytes + bytes > MAX_DECODED_DECISION_BYTES) {
          const oldest = decodedDecisions.keys().next().value;
          if (oldest === undefined)
            break;
          decodedDecisionBytes -= 2 * oldest.length + 128;
          decodedDecisions.delete(oldest);
        }
        decodedDecisions.set(value, record);
        decodedDecisionBytes += bytes;
      }
    }
    if (record && !decisions.has(record[0]))
      decisions.set(record[0], [...record[1]]);
  }
  return decisions;
}

// ../plugin/src/hooks/magic-context/tokenizer-calibration-seeds.json
var tokenizer_calibration_seeds_default = [
  {
    prefix: "google/gemini-3.8-flash",
    systemRatio: 0.961167,
    toolsRatio: 0.967504,
    proseRatio: 1.006909
  },
  {
    prefix: "google/gemini-3.7-flash",
    systemRatio: 0.961167,
    toolsRatio: 0.967504,
    proseRatio: 1.006909
  },
  {
    prefix: "google/gemini-3.1-pro-preview",
    systemRatio: 0.961167,
    toolsRatio: 0.967504,
    proseRatio: 1.006909
  },
  {
    prefix: "anthropic/claude-fable-5-1",
    systemRatio: 1.511497,
    toolsRatio: 1.551639,
    proseRatio: 1.571778
  },
  {
    prefix: "anthropic/claude-opus-5",
    systemRatio: 1.511497,
    toolsRatio: 1.551639,
    proseRatio: 1.571778
  },
  {
    prefix: "anthropic/claude-sonnet-5",
    systemRatio: 1.511497,
    toolsRatio: 1.554814,
    proseRatio: 1.571815
  },
  {
    prefix: "openrouter/anthropic/claude-fable-5-1",
    systemRatio: 1.511497,
    toolsRatio: 1.551639,
    proseRatio: 1.571778
  },
  {
    prefix: "openrouter/anthropic/claude-opus-5",
    systemRatio: 1.511497,
    toolsRatio: 1.551639,
    proseRatio: 1.571778
  },
  {
    prefix: "openrouter/anthropic/claude-sonnet-5",
    systemRatio: 1.511497,
    toolsRatio: 1.554814,
    proseRatio: 1.571815
  },
  {
    prefix: "github-copilot/claude-fable-5-1",
    systemRatio: 1.511497,
    toolsRatio: 1.551639,
    proseRatio: 1.571778
  },
  {
    prefix: "github-copilot/claude-opus-5",
    systemRatio: 1.511497,
    toolsRatio: 1.551639,
    proseRatio: 1.571778
  },
  {
    prefix: "github-copilot/claude-sonnet-5",
    systemRatio: 1.511497,
    toolsRatio: 1.554814,
    proseRatio: 1.571815
  },
  {
    prefix: "anthropic/claude-opus-4-8",
    systemRatio: 1.51,
    toolsRatio: 1.57
  },
  {
    prefix: "anthropic/claude-opus-4.8",
    systemRatio: 1.51,
    toolsRatio: 1.57
  },
  {
    prefix: "anthropic/claude-opus-4-7",
    systemRatio: 1.51,
    toolsRatio: 1.57,
    proseRatio: 1.571778
  },
  {
    prefix: "anthropic/claude-opus-4.7",
    systemRatio: 1.51,
    toolsRatio: 1.57
  },
  {
    prefix: "anthropic/claude-opus-4-5",
    systemRatio: 1.02,
    toolsRatio: 1.16
  },
  {
    prefix: "anthropic/claude-opus-4.5",
    systemRatio: 1.02,
    toolsRatio: 1.16
  },
  {
    prefix: "anthropic/claude-opus-4-6",
    systemRatio: 1.02,
    toolsRatio: 1.16
  },
  {
    prefix: "anthropic/claude-opus-4.6",
    systemRatio: 1.02,
    toolsRatio: 1.16
  },
  {
    prefix: "anthropic/claude-sonnet-4-5",
    systemRatio: 1.02,
    toolsRatio: 1.16
  },
  {
    prefix: "anthropic/claude-sonnet-4.5",
    systemRatio: 1.02,
    toolsRatio: 1.16
  },
  {
    prefix: "anthropic/claude-sonnet-4-6",
    systemRatio: 1.02,
    toolsRatio: 1.14,
    proseRatio: 1.057976
  },
  {
    prefix: "anthropic/claude-sonnet-4.6",
    systemRatio: 1.02,
    toolsRatio: 1.14
  },
  {
    prefix: "anthropic/claude-haiku-4-5",
    systemRatio: 1.02,
    toolsRatio: 1.16
  },
  {
    prefix: "anthropic/claude-haiku-4.5",
    systemRatio: 1.02,
    toolsRatio: 1.16
  },
  {
    prefix: "openrouter/anthropic/claude-opus-4-8",
    systemRatio: 1.51,
    toolsRatio: 1.57
  },
  {
    prefix: "openrouter/anthropic/claude-opus-4.8",
    systemRatio: 1.51,
    toolsRatio: 1.57
  },
  {
    prefix: "github-copilot/claude-opus-4-8",
    systemRatio: 1.51,
    toolsRatio: 1.57
  },
  {
    prefix: "github-copilot/claude-opus-4.8",
    systemRatio: 1.51,
    toolsRatio: 1.57
  },
  {
    prefix: "openrouter/anthropic/claude-opus-4-7",
    systemRatio: 1.51,
    toolsRatio: 1.57
  },
  {
    prefix: "openrouter/anthropic/claude-opus-4.7",
    systemRatio: 1.51,
    toolsRatio: 1.57
  },
  {
    prefix: "github-copilot/claude-opus-4-7",
    systemRatio: 1.51,
    toolsRatio: 1.57
  },
  {
    prefix: "github-copilot/claude-opus-4.7",
    systemRatio: 1.51,
    toolsRatio: 1.57
  },
  {
    prefix: "openrouter/anthropic/claude-sonnet-4.6",
    systemRatio: 1.02,
    toolsRatio: 1.14
  },
  {
    prefix: "github-copilot/claude-sonnet-4.6",
    systemRatio: 1.02,
    toolsRatio: 1.14
  },
  {
    prefix: "github-copilot/claude-sonnet-4.5",
    systemRatio: 1.02,
    toolsRatio: 1.16
  },
  {
    prefix: "github-copilot/claude-opus-4.5",
    systemRatio: 1.02,
    toolsRatio: 1.16
  },
  {
    prefix: "github-copilot/claude-haiku-4.5",
    systemRatio: 1.02,
    toolsRatio: 1.16
  },
  {
    prefix: "openai/gpt-5.5",
    systemRatio: 1.000278,
    toolsRatio: 0.850953,
    proseRatio: 1.000017
  },
  {
    prefix: "openai/gpt-6-astra",
    systemRatio: 1.000278,
    toolsRatio: 0.850953,
    proseRatio: 1.000017
  },
  {
    prefix: "openai/gpt-6-sol",
    systemRatio: 1.000278,
    toolsRatio: 0.850953,
    proseRatio: 1.000017,
    provenance: "Mirrored from openai/gpt-6-astra; prose inherited-unmeasured. Reported OAuth system/tools counts match GPT-5.5; no independent API-key measurement."
  },
  {
    prefix: "openai/gpt-6.1-sol",
    systemRatio: 1.000278,
    toolsRatio: 0.850953,
    proseRatio: 1.000017,
    provenance: "Mirrored from openai/gpt-6-astra; prose inherited-unmeasured. Reported OAuth system/tools counts match GPT-5.5; no independent API-key measurement."
  },
  {
    prefix: "openai/gpt-5",
    systemRatio: 1,
    toolsRatio: 0.84
  },
  {
    prefix: "xai/grok-4-latest",
    systemRatio: 0.817751,
    toolsRatio: 0.880494,
    proseRatio: 0.880137
  },
  {
    prefix: "xai/grok-code-fast-1",
    systemRatio: 0.817751,
    toolsRatio: 0.880494,
    proseRatio: 0.880137
  },
  {
    prefix: "xai/grok-4",
    systemRatio: 0.82,
    toolsRatio: 0.88
  },
  {
    prefix: "xai/grok-code-fast",
    systemRatio: 0.82,
    toolsRatio: 0.89
  },
  {
    prefix: "cerebras/qwen-3-235b",
    systemRatio: 1,
    toolsRatio: 1.1
  },
  {
    prefix: "cerebras/zai-glm-4.7",
    systemRatio: 1,
    toolsRatio: 1.09
  },
  {
    prefix: "cerebras/gpt-oss-120b",
    systemRatio: 0.84,
    toolsRatio: 0.79
  },
  {
    prefix: "fireworks-ai/accounts/fireworks/models/glm-5p1",
    systemRatio: 1,
    toolsRatio: 1.06
  },
  {
    prefix: "fireworks-ai/accounts/fireworks/models/deepseek-v3p2",
    systemRatio: 1.05,
    toolsRatio: 1.09
  },
  {
    prefix: "opencode-go/glm-5.1",
    systemRatio: 1,
    toolsRatio: 1.06
  },
  {
    prefix: "opencode-go/glm-5",
    systemRatio: 1,
    toolsRatio: 1.06
  },
  {
    prefix: "opencode-go/kimi-k2.6",
    systemRatio: 0.87,
    toolsRatio: 0.86,
    proseRatio: 0.925501
  },
  {
    prefix: "moonshot/kimi-k2.6",
    systemRatio: 0.872126,
    toolsRatio: 0.863853,
    proseRatio: 0.925501
  },
  {
    prefix: "moonshot/kimi-for-coding",
    systemRatio: 0.872126,
    toolsRatio: 0.863853,
    proseRatio: 0.925501
  },
  {
    prefix: "zai/glm-4.7",
    systemRatio: 0.999721,
    toolsRatio: 1.056823,
    proseRatio: 1.000875
  },
  {
    prefix: "meta/muse-spark",
    systemRatio: 0.865949,
    toolsRatio: 1.024605,
    proseRatio: 0.923366
  },
  {
    prefix: "opencode/muse-spark",
    systemRatio: 0.865949,
    toolsRatio: 1.024605,
    proseRatio: 0.923366
  }
];

// ../plugin/src/hooks/magic-context/tokenizer-calibration.ts
var CALIBRATION_TABLE = tokenizer_calibration_seeds_default;
var NEUTRAL = { systemRatio: 1, toolsRatio: 1, proseRatio: 1 };
var CALIBRATION_TABLE_REVISION = "2026-09-30-sol-tokenizer-seeds-v3";
var UNKNOWN_FIT_RATIO = Math.max(2, ...CALIBRATION_TABLE.flatMap((entry) => [
  entry.systemRatio,
  entry.toolsRatio,
  entry.proseRatio ?? 1
]));
function hasModelCalibration(providerId, modelId) {
  return resolveModelCalibration(providerId, modelId) !== NEUTRAL;
}
function resolveModelCalibration(providerId, modelId) {
  if (!providerId || !modelId)
    return NEUTRAL;
  const key = `${providerId}/${modelId}`.toLowerCase();
  let best = null;
  for (const entry of CALIBRATION_TABLE) {
    const prefix = entry.prefix.toLowerCase();
    if (!key.startsWith(prefix))
      continue;
    if (!best || prefix.length > best.prefix.length) {
      best = entry;
    }
  }
  if (best)
    return { ...best, proseRatio: best.proseRatio ?? 1 };
  const provider = providerId.toLowerCase();
  const model = modelId.toLowerCase();
  if (CALIBRATION_TABLE.some((entry) => entry.prefix.toLowerCase().startsWith(`${provider}/`))) {
    return resolveFamilyFallback(provider, model) ?? NEUTRAL;
  }
  const canonical = canonicalProvider(model);
  let modelMatch = null;
  for (const entry of CALIBRATION_TABLE) {
    const seedModel = entry.prefix.toLowerCase().split("/").slice(1).join("/");
    if (!model.startsWith(seedModel))
      continue;
    const oldModel = modelMatch?.prefix.toLowerCase().split("/").slice(1).join("/") ?? "";
    if (seedModel.length > oldModel.length || seedModel.length === oldModel.length && entry.prefix.toLowerCase().startsWith(`${canonical}/`) && !modelMatch?.prefix.toLowerCase().startsWith(`${canonical}/`))
      modelMatch = entry;
  }
  if (modelMatch)
    return {
      ...modelMatch,
      proseRatio: modelMatch.proseRatio ?? 1,
      derivedFrom: modelMatch.prefix,
      matchedByModelId: true
    };
  const inherited = canonical ? resolveFamilyFallback(canonical, model) : null;
  return inherited ? { ...inherited, matchedByModelId: true } : NEUTRAL;
}
function parseModelLineage(modelId) {
  const tokens = modelId.split("-");
  const versionAt = tokens.findIndex((token) => /^\d+(\.\d+)*$/.test(token));
  if (versionAt <= 0)
    return null;
  const version = [];
  let end = versionAt;
  while (end < tokens.length && /^\d+(\.\d+)*$/.test(tokens[end] ?? "")) {
    for (const part of (tokens[end] ?? "").split("."))
      version.push(Number(part));
    end += 1;
  }
  return {
    family: tokens.slice(0, versionAt).join("-"),
    version,
    variant: tokens.slice(end).join("-")
  };
}
function canonicalProvider(model) {
  if (model.startsWith("claude-"))
    return "anthropic";
  if (model.startsWith("gpt-"))
    return "openai";
  if (model.startsWith("gemini-"))
    return "google";
  return "";
}
function compareVersions(a, b) {
  const length = Math.max(a.length, b.length);
  for (let i = 0;i < length; i++) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0)
      return delta;
  }
  return 0;
}
function resolveFamilyFallback(providerId, modelId) {
  const wanted = parseModelLineage(modelId);
  if (!wanted)
    return null;
  let below = null;
  let above = null;
  for (const entry of CALIBRATION_TABLE) {
    const prefix = entry.prefix.toLowerCase();
    if (!prefix.startsWith(`${providerId}/`))
      continue;
    const lineage = parseModelLineage(prefix.slice(providerId.length + 1));
    if (!lineage || lineage.family !== wanted.family || lineage.variant !== wanted.variant)
      continue;
    const order = compareVersions(lineage.version, wanted.version);
    if (order === 0)
      continue;
    if (order < 0) {
      if (!below || compareVersions(lineage.version, below.version) > 0) {
        below = { entry, version: lineage.version };
      }
    } else if (!above || compareVersions(lineage.version, above.version) < 0) {
      above = { entry, version: lineage.version };
    }
  }
  let source = below ?? above;
  if (source?.version[0] !== wanted.version[0] && canonicalProvider(modelId) !== "") {
    let sibling = null;
    for (const entry of CALIBRATION_TABLE) {
      const prefix = entry.prefix.toLowerCase();
      if (!prefix.startsWith(`${providerId}/`))
        continue;
      const lineage = parseModelLineage(prefix.slice(providerId.length + 1));
      if (!lineage || lineage.version[0] !== wanted.version[0] || lineage.variant !== wanted.variant || lineage.family.split("-")[0] !== wanted.family.split("-")[0])
        continue;
      const candidate = { entry, version: lineage.version };
      if (!sibling || compareVersions(candidate.version, wanted.version) <= 0 && compareVersions(sibling.version, wanted.version) > 0 || compareVersions(candidate.version, wanted.version) <= 0 && compareVersions(candidate.version, sibling.version) > 0 || compareVersions(sibling.version, wanted.version) > 0 && compareVersions(candidate.version, sibling.version) < 0)
        sibling = candidate;
    }
    source = sibling ?? source;
  }
  if (!source)
    return null;
  return {
    systemRatio: source.entry.systemRatio,
    toolsRatio: source.entry.toolsRatio,
    proseRatio: source.entry.proseRatio ?? 1,
    derivedFrom: source.entry.prefix
  };
}

// ../plugin/src/hooks/magic-context/decision-calibration.ts
function resolveDecisionCalibration(providerId, modelId) {
  const ratios = resolveModelCalibration(providerId, modelId);
  return Object.freeze({
    ...ratios,
    modelKey: `${providerId ?? "unknown"}/${modelId ?? "unknown"}`.toLowerCase(),
    revision: CALIBRATION_TABLE_REVISION,
    matchedPrefix: ratios.derivedFrom ?? ratios.prefix,
    seeded: hasModelCalibration(providerId, modelId),
    source: ratios.matchedByModelId ? "model-id" : ratios.derivedFrom ? "family-fallback" : "seed"
  });
}
function hasMeasuredDecisionCalibration(seed) {
  const measured = calibrationForModelKey(seed.modelKey);
  return seed.seeded && seed.source === "seed" && measured.seeded && measured.source === "seed";
}
function providerMass(raw, seed, fit = false) {
  const { system = 0, tools = 0, prose = 0 } = raw;
  if ([system, tools, prose].some((count) => !Number.isFinite(count) || count < 0) || [seed.systemRatio, seed.toolsRatio, seed.proseRatio].some((ratio) => !Number.isFinite(ratio) || ratio <= 0)) {
    return Number.POSITIVE_INFINITY;
  }
  const total = fit && !seed.seeded ? (system + tools + prose) * UNKNOWN_FIT_RATIO : system * seed.systemRatio + tools * seed.toolsRatio + prose * seed.proseRatio;
  return Number.isFinite(total) ? Math.ceil(total) : Number.POSITIVE_INFINITY;
}
function localBudget(providerTokens, ratio) {
  if (!Number.isFinite(providerTokens) || providerTokens <= 0 || !Number.isFinite(ratio) || ratio <= 0)
    return 0;
  return Math.floor(providerTokens / ratio);
}
function calibrationForModelKey(modelKey) {
  const slash = modelKey?.indexOf("/") ?? -1;
  return modelKey != null && slash > 0 ? resolveDecisionCalibration(modelKey.slice(0, slash), modelKey.slice(slash + 1)) : resolveDecisionCalibration(undefined, undefined);
}
function historyLocalBudget(providerTokens, modelKey) {
  const ratio = calibrationForModelKey(modelKey).proseRatio;
  return ratio === 1 ? providerTokens : localBudget(providerTokens, ratio);
}

// ../plugin/src/features/magic-context/session-decision-calibration.ts
var CALIBRATION_STATE_KEY = "magicContextTokenizerCalibration";
var HYGIENE_PROVIDER_UNITS_VERSION = 2;
function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function parseFrozenCalibration(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const candidate = value;
  if (typeof candidate.revision !== "string" || candidate.revision.length === 0 || typeof candidate.providerId !== "string" || typeof candidate.modelId !== "string" || !finitePositive(candidate.systemRatio) || !finitePositive(candidate.toolsRatio) || !finitePositive(candidate.proseRatio) || candidate.source !== "seed" && candidate.source !== "family-fallback") {
    return null;
  }
  return {
    revision: candidate.revision,
    providerId: candidate.providerId,
    modelId: candidate.modelId,
    systemRatio: candidate.systemRatio,
    toolsRatio: candidate.toolsRatio,
    proseRatio: candidate.proseRatio,
    source: candidate.source
  };
}
function parseStateRoot(raw) {
  if (!raw)
    return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}
function parseNamespace(root) {
  const value = root[CALIBRATION_STATE_KEY];
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  const namespace = value;
  const active = parseFrozenCalibration(namespace.active);
  return {
    active: active ?? undefined,
    hygieneUnitsVersion: typeof namespace.hygieneUnitsVersion === "number" && Number.isFinite(namespace.hygieneUnitsVersion) ? Math.max(0, Math.floor(namespace.hygieneUnitsVersion)) : undefined
  };
}
function readSessionRow(db, sessionId) {
  try {
    return db.prepare("SELECT COALESCE(NULLIF(cached_m0_model_key, ''), last_observed_model_key) AS model_key, deferred_execute_state, last_nudge_undropped, last_nudge_level FROM session_meta WHERE session_id = ?").get(sessionId);
  } catch {
    try {
      return db.prepare("SELECT COALESCE(NULLIF(cached_m0_model_key, ''), last_observed_model_key) AS model_key, deferred_execute_state FROM session_meta WHERE session_id = ?").get(sessionId);
    } catch {
      return;
    }
  }
}
function splitCanonicalModelKey(modelKey) {
  const slash = modelKey.indexOf("/");
  return slash > 0 ? { providerId: modelKey.slice(0, slash), modelId: modelKey.slice(slash + 1) } : { providerId: "unknown", modelId: "unknown" };
}
function freezeCalibration(calibration) {
  const identity = splitCanonicalModelKey(calibration.modelKey);
  return {
    revision: calibration.revision,
    providerId: identity.providerId,
    modelId: identity.modelId,
    systemRatio: calibration.systemRatio,
    toolsRatio: calibration.toolsRatio,
    proseRatio: calibration.proseRatio,
    source: calibration.source
  };
}
function thawCalibration(frozen) {
  const seeded = frozen.source === "family-fallback" || frozen.systemRatio !== 1 || frozen.toolsRatio !== 1 || frozen.proseRatio !== 1;
  return Object.freeze({
    modelKey: `${frozen.providerId}/${frozen.modelId}`.toLowerCase(),
    revision: frozen.revision,
    seeded,
    source: frozen.source,
    systemRatio: frozen.systemRatio,
    toolsRatio: frozen.toolsRatio,
    proseRatio: frozen.proseRatio
  });
}
function sameCalibration(left, right) {
  return left.revision === right.revision && left.providerId === right.providerId && left.modelId === right.modelId && left.systemRatio === right.systemRatio && left.toolsRatio === right.toolsRatio && left.proseRatio === right.proseRatio && left.source === right.source;
}
function persistNamespace(db, sessionId, root, namespace) {
  root[CALIBRATION_STATE_KEY] = namespace;
  db.prepare("UPDATE session_meta SET deferred_execute_state = ? WHERE session_id = ?").run(JSON.stringify(root), sessionId);
}
function sessionDecisionCalibration(db, sessionId, pass) {
  const row = readSessionRow(db, sessionId);
  const root = parseStateRoot(row?.deferred_execute_state);
  const namespace = parseNamespace(root);
  if (!pass?.bustPermitted) {
    return namespace.active ? thawCalibration(namespace.active) : resolveDecisionCalibration(undefined, undefined);
  }
  const key = piModelRefToCanonical(pass.modelKey ?? row?.model_key ?? "");
  const candidate = freezeCalibration(calibrationForModelKey(key));
  if (!namespace.active || !sameCalibration(namespace.active, candidate)) {
    const previousRevision = namespace.active?.revision ?? "unfrozen";
    persistNamespace(db, sessionId, root, { ...namespace, active: candidate });
    if (namespace.active) {
      pass.onAdopt?.(`calibration revision ${previousRevision} → ${candidate.revision} adopted (bust=${pass.bustReason ?? "unknown"})`);
    }
  }
  return thawCalibration(candidate);
}
function sessionHygieneUnitsVersion(db, sessionId) {
  const row = readSessionRow(db, sessionId);
  return parseNamespace(parseStateRoot(row?.deferred_execute_state)).hygieneUnitsVersion ?? 1;
}
function parseNudgeLevelState(raw) {
  if (!raw)
    return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : null;
  } catch {
    return null;
  }
}
function scaledWatermark(value, ratio) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value * ratio)) : null;
}
function transitionSessionHygieneUnits(db, sessionId, bustPermitted, calibration) {
  const before = sessionHygieneUnitsVersion(db, sessionId);
  if (before >= HYGIENE_PROVIDER_UNITS_VERSION || !bustPermitted)
    return before;
  return db.transaction(() => {
    const row = readSessionRow(db, sessionId);
    const root = parseStateRoot(row?.deferred_execute_state);
    const namespace = parseNamespace(root);
    if ((namespace.hygieneUnitsVersion ?? 1) >= HYGIENE_PROVIDER_UNITS_VERSION) {
      return HYGIENE_PROVIDER_UNITS_VERSION;
    }
    const lastNudge = scaledWatermark(row?.last_nudge_undropped, calibration.toolsRatio);
    const nudgeLevel = parseNudgeLevelState(row?.last_nudge_level);
    if (nudgeLevel) {
      const grace = scaledWatermark(nudgeLevel.postReduceGraceBaselineU, calibration.toolsRatio);
      if (grace !== null)
        nudgeLevel.postReduceGraceBaselineU = grace;
    }
    db.prepare("UPDATE session_meta SET last_nudge_undropped = COALESCE(?, last_nudge_undropped), last_nudge_level = COALESCE(?, last_nudge_level) WHERE session_id = ?").run(lastNudge, nudgeLevel ? JSON.stringify(nudgeLevel) : null, sessionId);
    persistNamespace(db, sessionId, root, {
      ...namespace,
      hygieneUnitsVersion: HYGIENE_PROVIDER_UNITS_VERSION
    });
    return HYGIENE_PROVIDER_UNITS_VERSION;
  }).immediate();
}

// ../plugin/src/features/magic-context/storage-tags.ts
import { isMainThread } from "node:worker_threads";

// ../plugin/src/features/magic-context/reclaim-protection.ts
var CTX_REDUCE_KEEP = DEFAULT_PROTECTED_TOOLS.ctx_reduce;
function adoptedProtectedToolsPolicy(current, previous, rebuilding, hasBaseline) {
  if (rebuilding || !hasBaseline)
    return mergeProtectedTools(current);
  return { ...previous ?? { todowrite: 0, ctx_reduce: 3 } };
}
function protectedToolTagNumbers(tags, protectedTools) {
  const counts = mergeProtectedTools(protectedTools);
  const protectedTags = new Set;
  for (const tag of [...tags].sort((left, right) => right.tagNumber - left.tagNumber)) {
    if (tag.status !== undefined && tag.status !== "active")
      continue;
    if (tag.type !== undefined && tag.type !== "tool")
      continue;
    const name = normalizeProtectedToolName(tag.toolName);
    if (!Object.hasOwn(counts, name) || counts[name] <= 0)
      continue;
    protectedTags.add(tag.tagNumber);
    counts[name] -= 1;
  }
  return protectedTags;
}
function protectedToolTokenCount(tags, counts, calibration) {
  const protectedTags = protectedToolTagNumbers(tags, counts);
  const tokens = tags.reduce((sum, tag) => sum + (protectedTags.has(tag.tagNumber) ? tag.tokenCount ?? 0 : 0), 0);
  return calibration && hasMeasuredDecisionCalibration(calibration) ? providerMass({ tools: tokens }, calibration) : 0;
}

// ../plugin/src/hooks/magic-context/tag-content-primitives.ts
var encoder = new TextEncoder;
var TAG_PREFIX_REGEX = /^(?:§\d+§\s*)+/;
var MALFORMED_TAG_PREFIX_REGEX = /^(?:§\d+">§(?:\d+§)?\s*)+/;
var DANGLING_TAG_GLOBAL_REGEX = /\u00a7\d+(?!\d)(?!\.\d)[^\s\u00a7\w.]?/g;
var DANGLING_TAG_PREFIX_REGEX = /^(?:\u00a7\d+(?!\d)(?!\.\d)[^\s\u00a7\w.]?\s*)+/;
var COMPLETE_TAG_PAIR_GLOBAL_REGEX = /\u00a7\d+\u00a7/g;
var MALFORMED_TAG_GLOBAL_REGEX = /\u00a7\d+">(?:\u00a7(?:\d+\u00a7)?)?/g;
var STRAY_SECTION_CHAR_REGEX = /\u00a7/g;
function stripWellFormedLeadingTagPrefix(value) {
  return value.replace(/^(\u00a7\d+\u00a7\s*)+/, "");
}
function stripCompleteTagPairsGlobally(value) {
  return value.replace(COMPLETE_TAG_PAIR_GLOBAL_REGEX, "");
}
function stripMalformedTagNotationGlobally(value) {
  return value.replace(MALFORMED_TAG_GLOBAL_REGEX, "");
}
function stripDanglingTagNotationGlobally(value) {
  return value.replace(DANGLING_TAG_GLOBAL_REGEX, "");
}
function stripTagSectionCharacters(value) {
  return value.replace(STRAY_SECTION_CHAR_REGEX, "");
}
function stripPersistedAssistantText(value, acceptsEmpty = true) {
  if (!acceptsEmpty && !value.includes("§") && !value.trim())
    return value;
  let text = stripWellFormedLeadingTagPrefix(value);
  text = stripCompleteTagPairsGlobally(text);
  text = stripMalformedTagNotationGlobally(text);
  text = stripDanglingTagNotationGlobally(text);
  text = stripTagSectionCharacters(text);
  const stripped = text.trim();
  return !acceptsEmpty && value.trim().length > 0 && stripped.length === 0 ? value : stripped;
}
function byteSize(value) {
  return encoder.encode(value).length;
}
function stripTagPrefix(value) {
  let stripped = value;
  for (let pass = 0;pass < 8; pass++) {
    const prev = stripped;
    stripped = stripped.replace(MALFORMED_TAG_PREFIX_REGEX, "");
    stripped = stripped.replace(TAG_PREFIX_REGEX, "");
    stripped = stripped.replace(DANGLING_TAG_PREFIX_REGEX, "");
    if (stripped === prev)
      break;
  }
  return stripped;
}
function peelLeadingMcTagNotation(value) {
  const body = stripTagPrefix(value);
  if (body === value)
    return { tagPrefix: "", body };
  return { tagPrefix: value.slice(0, value.length - body.length), body };
}
function prependTag(tagId, value) {
  const stripped = stripTagPrefix(value);
  return `§${tagId}§ ${stripped}`;
}

// ../plugin/src/hooks/magic-context/tail-hygiene-output-count.ts
var CURRENT_OUTPUT_COUNT = Symbol.for("magic-context.current-reclaimable-tool-output-count");
function countReclaimableToolOutputs(parts) {
  return parts.filter((part) => part.kind === "toolOutput" && part.uTokens > 0).length;
}
function rememberCurrentToolOutputCount(baseline, measurement) {
  return Object.assign(baseline, {
    [CURRENT_OUTPUT_COUNT]: countReclaimableToolOutputs(measurement.parts)
  });
}
function currentReclaimableToolOutputCount(baseline) {
  if (!baseline || !Object.hasOwn(baseline, CURRENT_OUTPUT_COUNT))
    return 0;
  return baseline[CURRENT_OUTPUT_COUNT];
}

// ../plugin/src/shared/record-type-guard.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ../plugin/src/shared/tag-owner-id.ts
var TEXT_TAG_IDENTITY_MARKER = ":mc-text-v1:";
var PI_FALLBACK_PREFIXES_JSON = JSON.stringify([..."pi-msg-"].reduce((prefixes, char) => prefixes.flatMap((prefix) => /[a-z]/.test(char) ? [prefix + char, prefix + char.toUpperCase()] : [prefix + char]), [""]));
var POSITIONAL_CONTENT_SUFFIX = /:(?:p|file)\d+$/;
var CONTENT_DERIVED_TEXT_SUFFIX = /:mc-text-v1:[0-9a-f]+:[0-9a-f]+:o\d+$/;
function contentTagOwnerMessageId(contentId) {
  const positional = POSITIONAL_CONTENT_SUFFIX.exec(contentId);
  if (positional)
    return contentId.slice(0, positional.index);
  const derived = CONTENT_DERIVED_TEXT_SUFFIX.exec(contentId);
  if (derived)
    return contentId.slice(0, derived.index);
  return contentId;
}

// ../plugin/src/shared/tail-hygiene-json.ts
var MAX_MEMO_BYTES = 64 * 1024 * 1024;
var MAX_MEMO_ENTRIES = 1e4;

class TailHygieneJsonMemo {
  entries = new Map;
  bytes = 0;
  passText = new WeakMap;
  passHash = new WeakMap;
  beginPass() {
    this.passText = new WeakMap;
    this.passHash = new WeakMap;
  }
  get(key, value, compute, fingerprint = false) {
    const pass = fingerprint ? this.passHash : this.passText;
    const object = value !== null && typeof value === "object" ? value : undefined;
    const local = object ? pass.get(object) : undefined;
    if (local !== undefined)
      return local;
    const previous = this.entries.get(key);
    if (previous && sameJson(previous.snapshot, value)) {
      if (object)
        pass.set(object, previous.result);
      return previous.result;
    }
    const result = compute();
    if (previous) {
      this.bytes -= previous.bytes;
      this.entries.delete(key);
    }
    try {
      const copy = copyJson(value);
      const bytes = copy.bytes + (key.length + result.length) * 2;
      if (bytes <= MAX_MEMO_BYTES) {
        this.entries.set(key, { snapshot: copy.value, result, bytes });
        this.bytes += bytes;
        if (object)
          pass.set(object, result);
      }
    } catch {}
    while (this.bytes > MAX_MEMO_BYTES || this.entries.size > MAX_MEMO_ENTRIES) {
      const oldest = this.entries.entries().next().value;
      if (!oldest)
        break;
      this.bytes -= oldest[1].bytes;
      this.entries.delete(oldest[0]);
    }
    return result;
  }
}
function copyJson(value) {
  const seen = new Map;
  let bytes = 0;
  const copy = (current) => {
    bytes += 16;
    if (typeof current === "string")
      bytes += current.length * 2;
    if (bytes > MAX_MEMO_BYTES)
      throw new Error("memo capacity");
    if (current === null || typeof current !== "object") {
      if (["function", "symbol", "bigint"].includes(typeof current))
        throw new Error("exotic");
      return current;
    }
    if (seen.has(current))
      return seen.get(current);
    const prototype = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null)
      throw new Error("exotic");
    const result = Array.isArray(current) ? new Array(current.length) : Object.create(prototype);
    seen.set(current, result);
    for (const key of Object.keys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor))
        throw new Error("accessor");
      bytes += key.length * 2 + 16;
      if (key === "__proto__") {
        Object.defineProperty(result, key, {
          value: copy(descriptor.value),
          enumerable: true,
          writable: true,
          configurable: true
        });
      } else
        result[key] = copy(descriptor.value);
    }
    return result;
  };
  return { value: copy(value), bytes };
}
function sameJson(before, after) {
  const forward = new Map;
  const reverse = new Set;
  const same = (left, right) => {
    if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
      return Object.is(left, right);
    if (forward.has(left))
      return forward.get(left) === right;
    if (reverse.has(right) || Object.getPrototypeOf(left) !== Object.getPrototypeOf(right))
      return false;
    forward.set(left, right);
    reverse.add(right);
    if (Array.isArray(left) && (!Array.isArray(right) || left.length !== right.length))
      return false;
    const keys = Object.keys(left);
    const otherKeys = Object.keys(right);
    if (keys.length !== otherKeys.length)
      return false;
    for (let index = 0;index < keys.length; index++) {
      const key = keys[index];
      if (key !== otherKeys[index])
        return false;
      const descriptor = Object.getOwnPropertyDescriptor(right, key);
      if (!descriptor || !("value" in descriptor) || !same(left[key], descriptor.value))
        return false;
    }
    return true;
  };
  return same(before, after);
}
function piJsonHash(value, fallback) {
  const sink = jsonHashSink("excluded\x00");
  try {
    const seen = new Set;
    const arrays = new Set;
    const write = (current) => {
      if (current === null || typeof current !== "object") {
        if (["function", "symbol", "bigint"].includes(typeof current))
          throw new Error("exotic");
        sink.write(JSON.stringify(current) ?? "");
      } else if (Array.isArray(current)) {
        if (Object.getPrototypeOf(current) !== Array.prototype || Object.hasOwn(current, "toJSON"))
          throw new Error("exotic array");
        if (arrays.has(current))
          throw new Error("array cycle");
        arrays.add(current);
        sink.write("[");
        for (let index = 0;index < current.length; index++) {
          if (index)
            sink.write(",");
          const descriptor = Object.getOwnPropertyDescriptor(current, index);
          if (descriptor && !("value" in descriptor))
            throw new Error("accessor");
          if (!descriptor && index in current)
            throw new Error("inherited array element");
          write(descriptor?.value === undefined ? null : descriptor.value);
        }
        sink.write("]");
        arrays.delete(current);
      } else if (seen.has(current)) {
        sink.write('"[Circular]"');
      } else {
        const prototype = Object.getPrototypeOf(current);
        if (prototype !== Object.prototype && prototype !== null)
          throw new Error("exotic");
        seen.add(current);
        const entries = Object.keys(current).map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (!descriptor || !("value" in descriptor))
            throw new Error("accessor");
          return [key, descriptor.value];
        });
        const sorted = Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
        if (entries.length <= 16 && entries.every(([key, child]) => key.length <= 4096 && (child === null || child === undefined || typeof child === "number" || typeof child === "boolean" || typeof child === "string" && child.length <= 4096))) {
          sink.write(JSON.stringify(sorted));
          return;
        }
        sink.write("{");
        let first = true;
        for (const [key, child] of Object.entries(sorted)) {
          if (child === undefined)
            continue;
          if (!first)
            sink.write(",");
          first = false;
          sink.write(JSON.stringify(key));
          sink.write(":");
          write(child);
        }
        sink.write("}");
      }
    };
    write(value);
    return sink.digest();
  } catch {
    const failed = jsonHashSink("excluded\x00");
    failed.write(fallback());
    return failed.digest();
  }
}

// ../plugin/src/hooks/magic-context/image-token-estimate.ts
var IMAGE_TOKEN_DIVISOR = 750;
var IMAGE_FALLBACK_TOKENS = 1200;
var IMAGE_TOKEN_CAP = 4500;
function estimateImageTokensFromDataUrl(url) {
  const comma = url.indexOf(",");
  if (comma < 0)
    return IMAGE_FALLBACK_TOKENS;
  return estimateImageTokensFromBase64(url.slice(0, comma), url.slice(comma + 1));
}
function estimateImageTokensFromBase64(header, payload) {
  const sliceLen = Math.min(512, payload.length);
  const preview = payload.slice(0, sliceLen);
  let bytes;
  try {
    bytes = base64Decode(preview);
  } catch {
    return IMAGE_FALLBACK_TOKENS;
  }
  return estimateImageTokensFromHeader(header, bytes, () => createBase64ByteReader(payload, bytes));
}
function estimateImageTokensFromHeader(header, bytes, jpegReader) {
  if (header.includes("image/png")) {
    const dims = parsePngDimensions(bytes);
    if (dims)
      return clampImageTokens(Math.ceil(dims.w * dims.h / IMAGE_TOKEN_DIVISOR));
  } else if (header.includes("image/jpeg") || header.includes("image/jpg")) {
    const dims = parseJpegDimensions(jpegReader());
    if (dims)
      return clampImageTokens(Math.ceil(dims.w * dims.h / IMAGE_TOKEN_DIVISOR));
  } else if (header.includes("image/webp")) {
    const dims = parseWebpDimensions(bytes);
    if (dims)
      return clampImageTokens(Math.ceil(dims.w * dims.h / IMAGE_TOKEN_DIVISOR));
  } else if (header.includes("image/gif")) {
    const dims = parseGifDimensions(bytes);
    if (dims)
      return clampImageTokens(Math.ceil(dims.w * dims.h / IMAGE_TOKEN_DIVISOR));
  }
  return IMAGE_FALLBACK_TOKENS;
}
function nativeMediaImage(part) {
  if (part.type !== "media" || !isRecord(part.media))
    return;
  const { mediaType, source } = part.media;
  if (typeof mediaType !== "string" || !mediaType.startsWith("image/"))
    return;
  let inline;
  if (isRecord(source)) {
    const { type, data } = source;
    if (type === "base64" && typeof data === "string" && data.length > 0)
      inline = data;
    if (type === "bytes" && data instanceof Uint8Array && data.byteLength > 0)
      inline = data;
  }
  return { mediaType, inline };
}
function estimateNativeMediaImageTokens(part) {
  const image = nativeMediaImage(part);
  if (!image)
    return 0;
  const { mediaType, inline } = image;
  if (typeof inline === "string")
    return estimateImageTokensFromBase64(mediaType, inline);
  if (inline)
    return estimateImageTokensFromHeader(mediaType, inline, () => (i) => inline[i]);
  return IMAGE_FALLBACK_TOKENS;
}
function estimateToolAttachmentImageTokens(state) {
  if (!state || typeof state !== "object")
    return 0;
  const attachments = state.attachments;
  if (!Array.isArray(attachments))
    return 0;
  let tokens = 0;
  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== "object")
      continue;
    const { mime, url } = attachment;
    if (typeof mime !== "string" || !mime.startsWith("image/"))
      continue;
    tokens += typeof url === "string" && url.startsWith("data:") ? estimateImageTokensFromDataUrl(url) : IMAGE_FALLBACK_TOKENS;
  }
  return tokens;
}
function clampImageTokens(n) {
  if (n < 1)
    return 1;
  if (n > IMAGE_TOKEN_CAP)
    return IMAGE_TOKEN_CAP;
  return n;
}
function base64Decode(b64) {
  const pad = b64.length % 4;
  const padded = pad === 0 ? b64 : b64 + "=".repeat(4 - pad);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0;i < binary.length; i++)
    out[i] = binary.charCodeAt(i);
  return out;
}
function parsePngDimensions(b) {
  if (b.length < 24)
    return null;
  if (b[0] !== 137 || b[1] !== 80 || b[2] !== 78 || b[3] !== 71 || b[4] !== 13 || b[5] !== 10 || b[6] !== 26 || b[7] !== 10)
    return null;
  const w = readUint32BE(b, 16);
  const h = readUint32BE(b, 20);
  if (!w || !h)
    return null;
  return { w, h };
}
var READER_PREVIEW_CHARS = 512;
var READER_PREVIEW_BYTES = 384;
var READER_WINDOW_CHARS = 4096;
var READER_WINDOW_BYTES = 3072;
function createBase64ByteReader(payload, preview) {
  const windows = new Map;
  return (offset) => {
    if (offset < READER_PREVIEW_BYTES)
      return preview[offset];
    const index = Math.floor((offset - READER_PREVIEW_BYTES) / READER_WINDOW_BYTES);
    let window = windows.get(index);
    if (window === undefined) {
      const start = READER_PREVIEW_CHARS + index * READER_WINDOW_CHARS;
      const chars = payload.slice(start, start + READER_WINDOW_CHARS);
      try {
        window = chars.length > 0 ? base64Decode(chars) : null;
      } catch {
        window = null;
      }
      windows.set(index, window);
    }
    return window?.[offset - READER_PREVIEW_BYTES - index * READER_WINDOW_BYTES];
  };
}
var JPEG_SCAN_LIMIT_BYTES = 256 * 1024;
function parseJpegDimensions(byteAt) {
  if (byteAt(0) !== 255 || byteAt(1) !== 216 || byteAt(3) === undefined)
    return null;
  let i = 2;
  while (i < JPEG_SCAN_LIMIT_BYTES && byteAt(i + 8) !== undefined) {
    if (byteAt(i) !== 255) {
      i++;
      continue;
    }
    const marker = byteAt(i + 1);
    if (marker === undefined)
      break;
    if (isSofMarker(marker)) {
      const h = byteAt(i + 5) << 8 | byteAt(i + 6);
      const w = byteAt(i + 7) << 8 | byteAt(i + 8);
      if (w && h)
        return { w, h };
      return null;
    }
    if (marker === 216 || marker === 217 || marker === 1) {
      i += 2;
      continue;
    }
    const segLen = byteAt(i + 2) << 8 | byteAt(i + 3);
    if (segLen < 2)
      return null;
    i += 2 + segLen;
  }
  return null;
}
function isSofMarker(m) {
  if (m >= 192 && m <= 195)
    return true;
  if (m >= 197 && m <= 199)
    return true;
  if (m >= 201 && m <= 203)
    return true;
  if (m >= 205 && m <= 207)
    return true;
  return false;
}
function parseWebpDimensions(b) {
  if (b.length < 30)
    return null;
  if (b[0] !== 82 || b[1] !== 73 || b[2] !== 70 || b[3] !== 70)
    return null;
  if (b[8] !== 87 || b[9] !== 69 || b[10] !== 66 || b[11] !== 80)
    return null;
  const variant = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (variant === "VP8 ") {
    const w = (b[26] | b[27] << 8) & 16383;
    const h = (b[28] | b[29] << 8) & 16383;
    if (w && h)
      return { w, h };
  } else if (variant === "VP8L") {
    const b0 = b[21];
    const b1 = b[22];
    const b2 = b[23];
    const b3 = b[24];
    const w = 1 + ((b0 | b1 << 8) & 16383);
    const h = 1 + ((b1 >> 6 | b2 << 2 | b3 << 10) & 16383);
    if (w && h)
      return { w, h };
  } else if (variant === "VP8X") {
    const w = 1 + (b[24] | b[25] << 8 | b[26] << 16);
    const h = 1 + (b[27] | b[28] << 8 | b[29] << 16);
    if (w && h)
      return { w, h };
  }
  return null;
}
function parseGifDimensions(b) {
  if (b.length < 10)
    return null;
  if (b[0] !== 71 || b[1] !== 73 || b[2] !== 70)
    return null;
  const w = b[6] | b[7] << 8;
  const h = b[8] | b[9] << 8;
  if (!w || !h)
    return null;
  return { w, h };
}
function readUint32BE(b, offset) {
  return (b[offset] << 24 | b[offset + 1] << 16 | b[offset + 2] << 8 | b[offset + 3]) >>> 0;
}

// ../plugin/src/hooks/magic-context/provider-visible-parts.ts
function isRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
var KEPT_TOOL_STATE_FIELDS = new Set([
  "status",
  "input",
  "output",
  "error",
  "attachments",
  "content"
]);
var KEPT_TOOL_STATE_TIME_FIELD = "compacted";
function providerVisiblePart(part) {
  if (!isRecord2(part) || part.type !== "tool" || !isRecord2(part.state))
    return part;
  if (toolStateIsReduced(part.state))
    return part;
  return { ...part, state: providerVisibleToolState(part.state) };
}
var KEPT_ERROR_METADATA_FIELDS = ["interrupted", "output"];
function providerVisibleToolState(state) {
  const view = {};
  for (const key of Object.keys(state)) {
    const value = state[key];
    if (KEPT_TOOL_STATE_FIELDS.has(key)) {
      view[key] = value;
    } else if (key === "time" && isRecord2(value)) {
      view.time = value[KEPT_TOOL_STATE_TIME_FIELD] === undefined ? {} : { [KEPT_TOOL_STATE_TIME_FIELD]: value[KEPT_TOOL_STATE_TIME_FIELD] };
    } else if (key === "metadata" && state.status === "error" && isRecord2(value)) {
      const kept = {};
      for (const field of KEPT_ERROR_METADATA_FIELDS) {
        if (Object.hasOwn(value, field))
          kept[field] = value[field];
      }
      view.metadata = kept;
    }
  }
  return view;
}
function toolStateIsReduced(state) {
  for (const key of Object.keys(state)) {
    if (KEPT_TOOL_STATE_FIELDS.has(key))
      continue;
    const value = state[key];
    if (key === "time" && isRecord2(value)) {
      const keys = Object.keys(value);
      if (keys.length === 0)
        continue;
      if (keys.length === 1 && keys[0] === KEPT_TOOL_STATE_TIME_FIELD)
        continue;
      return false;
    }
    if (key === "metadata" && state.status === "error" && isRecord2(value)) {
      const extra = Object.keys(value).some((field) => !KEPT_ERROR_METADATA_FIELDS.includes(field));
      if (!extra)
        continue;
    }
    return false;
  }
  return true;
}
function providerVisibleMessage(message) {
  return projectMessage(message, providerVisiblePart);
}
function projectMessage(message, projectPart) {
  if (!isRecord2(message) || !Array.isArray(message.parts))
    return message;
  let parts;
  for (let index = 0;index < message.parts.length; index += 1) {
    const part = message.parts[index];
    const view = projectPart(part);
    if (view !== part) {
      parts ??= message.parts.slice(0, index);
      parts.push(view);
    } else if (parts) {
      parts.push(part);
    }
  }
  return parts ? { ...message, parts } : message;
}

// ../plugin/src/hooks/magic-context/todo-view.ts
import { createHash } from "node:crypto";
var TODO_STATUS_PENDING = "pending";
var TODO_STATUS_IN_PROGRESS = "in_progress";
var TODO_STATUS_COMPLETED = "completed";
var TODO_STATUS_CANCELLED = "cancelled";
var TODO_PRIORITY_HIGH = "high";
var TODO_PRIORITY_MEDIUM = "medium";
var TODO_PRIORITY_LOW = "low";
var TODO_STATUSES = [
  TODO_STATUS_PENDING,
  TODO_STATUS_IN_PROGRESS,
  TODO_STATUS_COMPLETED,
  TODO_STATUS_CANCELLED
];
var TODO_PRIORITIES = [
  TODO_PRIORITY_HIGH,
  TODO_PRIORITY_MEDIUM,
  TODO_PRIORITY_LOW
];
var TERMINAL_STATUSES = new Set([
  TODO_STATUS_COMPLETED,
  TODO_STATUS_CANCELLED
]);
var TITLE_DONE_STATUSES = new Set([TODO_STATUS_COMPLETED]);
var SYNTHETIC_CALL_ID_PREFIX = "mc_synthetic_todo_";
function normalizeTodoStateJson(todos) {
  if (!Array.isArray(todos))
    return null;
  const normalized = [];
  for (const todo of todos) {
    if (!isTodoItem(todo))
      return null;
    normalized.push({
      content: todo.content,
      status: todo.status,
      priority: todo.priority ?? TODO_PRIORITY_MEDIUM
    });
  }
  return JSON.stringify(normalized);
}
function buildSyntheticTodoPart(stateJson) {
  const todos = parseTodoState(stateJson);
  if (todos === null || todos.length === 0)
    return null;
  if (todos.every((t) => TERMINAL_STATUSES.has(t.status)))
    return null;
  const callID = computeSyntheticCallId(stateJson);
  const activeCount = todos.filter((t) => !TITLE_DONE_STATUSES.has(t.status)).length;
  const output = JSON.stringify(todos, null, 2);
  const ts = 0;
  return {
    type: "tool",
    callID,
    tool: "todowrite",
    state: {
      status: "completed",
      input: { todos },
      output,
      title: `${activeCount} todos`,
      metadata: { todos, truncated: false },
      time: { start: ts, end: ts }
    },
    syntheticTodoMarker: true
  };
}
function computeSyntheticCallId(stateJson) {
  const hash = createHash("sha256").update(stateJson).digest("hex").slice(0, 16);
  return `${SYNTHETIC_CALL_ID_PREFIX}${hash}`;
}
function parseTodoState(stateJson) {
  if (stateJson.length === 0)
    return null;
  try {
    const parsed = JSON.parse(stateJson);
    if (!Array.isArray(parsed))
      return null;
    const result = [];
    for (const item of parsed) {
      if (!isTodoItem(item))
        return null;
      result.push({
        content: item.content,
        status: item.status,
        priority: item.priority ?? TODO_PRIORITY_MEDIUM
      });
    }
    return result;
  } catch {
    return null;
  }
}
function isTodoItem(value) {
  if (value === null || typeof value !== "object")
    return false;
  const todo = value;
  return typeof todo.content === "string" && typeof todo.status === "string" && todo.status.length > 0 && (todo.priority === undefined || typeof todo.priority === "string");
}

// ../plugin/src/hooks/magic-context/tail-hygiene-walk.ts
var MAX_CONTENT_MEMO_BYTES = 256 * 1024 * 1024;
var contentMemo = new Map;
var contentMemoOrder = new Set;
var CHANNEL1_REMINDER_OPEN = `

<system-reminder>
`;
var CHANNEL1_REMINDER_CLOSE = `
</system-reminder>`;
function stripChannel1ReminderSpans(output) {
  let stripped = output;
  while (stripped.endsWith(CHANNEL1_REMINDER_CLOSE)) {
    const opener = stripped.lastIndexOf(CHANNEL1_REMINDER_OPEN);
    if (opener < 0)
      break;
    stripped = stripped.slice(0, opener);
  }
  return stripped;
}
function reclaimableTailTokens(part) {
  return part.tagStatus === "active" && !part.protected && !part.queuedForDrop && part.kind !== "excluded" && part.kind !== "text" ? part.tokens : 0;
}
var partJsonMemo = new TailHygieneJsonMemo;
function messageIdFromPartKey(key) {
  const separator = key.indexOf("\x00");
  return separator > 0 ? key.slice(0, separator) : key;
}
function prefixMismatch(baseline, current, partIndex, field) {
  return {
    valid: false,
    boundaryAdvanceU: 0,
    queuedDropDeltaU: 0,
    mismatch: {
      partIndex,
      messageId: messageIdFromPartKey(baseline[partIndex]?.key ?? ""),
      field,
      frozenParts: baseline.length,
      measuredParts: current.length
    }
  };
}
function compareMeasuredTailPrefix(baseline, current) {
  if (current.length < baseline.length) {
    return prefixMismatch(baseline, current, current.length, "shorter");
  }
  let boundaryAdvanceU = 0;
  let queuedDropDeltaU = 0;
  for (let index = 0;index < baseline.length; index += 1) {
    const before = baseline[index];
    const after = current[index];
    const changedField = comparedField(before, after);
    if (changedField)
      return prefixMismatch(baseline, current, index, changedField);
    if (before.protected && !after.protected) {
      boundaryAdvanceU += after.uTokens;
    } else if (before.queuedForDrop !== after.queuedForDrop) {
      queuedDropDeltaU += after.uTokens - before.uTokens;
    }
  }
  return { valid: true, boundaryAdvanceU, queuedDropDeltaU };
}
function comparedField(before, after) {
  if (before.key !== after.key)
    return "key";
  if (before.contentHash !== after.contentHash)
    return "contentHash";
  if (before.kind !== after.kind)
    return "kind";
  if (before.tokens !== after.tokens)
    return "tokens";
  if (before.tagNumber !== after.tagNumber)
    return "tagNumber";
  if (before.tagStatus !== after.tagStatus)
    return "tagStatus";
  if (!before.protected && after.protected)
    return "protection-entered";
  if (before.protected && !after.protected) {
    return after.tagStatus === "active" ? null : "protection-exit-inactive";
  }
  if (before.queuedForDrop !== after.queuedForDrop) {
    return before.tagStatus === "active" && after.tagStatus === "active" ? null : "queued-drop-inactive";
  }
  return before.uTokens === after.uTokens ? null : "uTokens";
}
function formatTailHygienePrefixMismatch(mismatch, baselineGeneration) {
  return [
    "tail hygiene prefix invalidated:",
    `part_index=${mismatch.partIndex}`,
    `message=${mismatch.messageId || "unknown"}`,
    `field=${mismatch.field}`,
    `frozen_parts=${mismatch.frozenParts}`,
    `measured_parts=${mismatch.measuredParts}`,
    "action=re-measured",
    `generation=${baselineGeneration}`
  ].join(" ");
}
var baselineMeasurementMemo = new Map;
var MAX_BASELINE_MEMO_SIZE = 128 * 1024 * 1024;
function freezeTailHygieneMeasurement(measured) {
  const cut = Math.min(Math.max(0, measured.newestMessagePartStart), measured.parts.length);
  let baselineT = 0;
  let baselineU = 0;
  for (let index = 0;index < cut; index += 1) {
    baselineT += measured.parts[index].tokens;
    baselineU += measured.parts[index].uTokens;
  }
  let turnDeltaT = 0;
  let turnDeltaU = 0;
  for (let index = cut;index < measured.parts.length; index += 1) {
    const part = measured.parts[index];
    turnDeltaT += part.tokens;
    if (part.kind !== "toolOutput" || !part.protected)
      turnDeltaU += part.uTokens;
  }
  baselineT = Math.max(0, baselineT);
  return {
    baselineU: Math.min(Math.max(0, baselineU), baselineT),
    baselineT,
    turnDeltaU,
    turnDeltaT,
    baselineParts: cut === measured.parts.length ? measured.parts : measured.parts.slice(0, cut)
  };
}
function effectiveTailHygiene(baseline) {
  const t = Math.ceil(Math.max(0, baseline.baselineT + baseline.turnDeltaT));
  const u = Math.min(t, Math.ceil(Math.max(0, baseline.baselineU + baseline.turnDeltaU)));
  return { u, t };
}

// ../plugin/src/hooks/magic-context/ctx-reduce-nudge.ts
var CHANNEL1_SENTINEL = "<system-reminder>";
var TOKENS_PER_BYTE = 0.25;
var CHANNEL1_MIN_TOKENS = 60000;
var CHANNEL1_FLOOR_TOKENS = 25000;
var CHANNEL1_REFIRE_FLOOR_TOKENS = 25000;
var S_GENTLE = 0.2;
var S_FIRM = 0.4;
var S_URGENT = 0.6;
var CHANNEL2_SEVERITY_THRESHOLD = 0.75;
var CHANNEL2_FLOOR_TOKENS = 50000;
var LEVEL_RANK = { gentle: 1, firm: 2, urgent: 3 };
function channel1RefireTokens(tailTokens) {
  const scaled = Math.round(0.08 * Math.max(0, tailTokens));
  return Math.max(CHANNEL1_REFIRE_FLOOR_TOKENS, scaled);
}
function channel1Band(undroppedTokens, tailTokens) {
  if (tailTokens < CHANNEL1_MIN_TOKENS || undroppedTokens < CHANNEL1_FLOOR_TOKENS) {
    return "quiet";
  }
  const severity = Math.min(1, Math.max(0, undroppedTokens / Math.max(tailTokens, 1)));
  if (severity >= S_URGENT)
    return "urgent";
  if (severity >= S_FIRM)
    return "firm";
  if (severity >= S_GENTLE)
    return "gentle";
  return "quiet";
}
function nudgeBand(undroppedTokens, tailTokens) {
  const base = channel1Band(undroppedTokens, tailTokens);
  const severity = Math.min(1, Math.max(0, undroppedTokens / Math.max(tailTokens, 1)));
  return base === "urgent" && undroppedTokens >= CHANNEL2_FLOOR_TOKENS && severity >= CHANNEL2_SEVERITY_THRESHOLD ? "channel2" : base;
}
function decideChannel1(input) {
  const tailTokens = Math.max(0, input.baselineT + input.turnDeltaT);
  const undroppedTokens = Math.min(tailTokens, Math.max(0, input.baselineU + input.turnDeltaU));
  const severity = Math.min(1, Math.max(0, undroppedTokens / Math.max(tailTokens, 1)));
  const previousLevel = input.lastNudgeLevel;
  let lastNudge = Math.max(0, input.lastNudgeUndropped);
  let nextLevel = previousLevel;
  let clearPostReduceGrace = false;
  const growthThreshold = channel1RefireTokens(tailTokens);
  const graceBaselineU = input.postReduceGraceBaselineU === undefined ? null : Math.max(0, input.postReduceGraceBaselineU);
  const graceGrowth = graceBaselineU === null ? 0 : undroppedTokens - graceBaselineU;
  const cadenceGrowth = undroppedTokens - lastNudge;
  const currentTurn = input.currentRealUserTurnCount;
  const lastFireTurn = input.lastFireOrdinal;
  const stickyTurnsRemaining = currentTurn === undefined || lastFireTurn === undefined || lastFireTurn > currentTurn ? 0 : Math.max(0, CHANNEL1_STICKY_REAL_USER_TURN_GAP - (currentTurn - lastFireTurn));
  const measuredBand = channel1Band(undroppedTokens, tailTokens);
  const quiet = (reason, dampeningState, level = measuredBand === "quiet" ? "gentle" : measuredBand) => ({
    fire: false,
    sticky: false,
    level,
    band: measuredBand,
    undroppedTokens,
    tailTokens,
    severity,
    graceBaselineU,
    graceGrowth,
    growthThreshold,
    cadenceGrowth,
    stickyTurnsRemaining,
    dampeningState,
    verdictReason: reason,
    nextLastNudge: lastNudge,
    nextLastNudgeLevel: nextLevel,
    clearPostReduceGrace
  });
  if (input.evaluable === false || input.generationInvalidated === true) {
    return quiet("baseline-unevaluable", "baseline-hold");
  }
  if (input.hasRecentReduce)
    return quiet("recent-reduce-refresh", "baseline-hold");
  if (input.agentDropsAppliedThisPass) {
    return quiet("agent-drops-applied", "baseline-hold");
  }
  if (input.postReduceGracePending) {
    return quiet("post-reduce-baseline-pending", "baseline-hold");
  }
  const level = measuredBand === "quiet" ? "" : measuredBand;
  const previousRank = previousLevel === "" ? 0 : LEVEL_RANK[previousLevel];
  const currentRank = level === "" ? 0 : LEVEL_RANK[level];
  let graceReleaseReason = null;
  if (graceBaselineU !== null) {
    const preReduceLevel = input.postReduceGracePreLevel ?? previousLevel;
    const preReduceRank = preReduceLevel === "" ? 0 : LEVEL_RANK[preReduceLevel];
    const regrowthReached = graceGrowth >= growthThreshold;
    const escalatedAbovePreReduceBand = currentRank > preReduceRank;
    if (!regrowthReached && !escalatedAbovePreReduceBand) {
      return quiet("post-reduce-compliance-grace", "post-reduce-grace");
    }
    clearPostReduceGrace = true;
    graceReleaseReason = regrowthReached ? "post-reduce-regrowth-reached" : "post-reduce-band-escalation";
  }
  if (level === "") {
    nextLevel = "";
    lastNudge = 0;
    if (tailTokens < CHANNEL1_MIN_TOKENS) {
      return quiet("tail-below-minimum", "none");
    }
    if (undroppedTokens < CHANNEL1_FLOOR_TOKENS) {
      return quiet("reclaimable-below-floor", "none");
    }
    return quiet("ratio-below-gentle", "none");
  }
  if (currentRank < previousRank) {
    nextLevel = level;
    lastNudge = undroppedTokens;
    return quiet("band-deescalation", "band-hysteresis", level);
  }
  const crossedFromBelow = currentRank > previousRank;
  const cadenceReached = currentRank === previousRank && cadenceGrowth >= growthThreshold;
  const stickyTurnGapReached = stickyTurnsRemaining === 0;
  if (!crossedFromBelow && !cadenceReached) {
    return quiet("cadence-growth", "cadence", level);
  }
  if (!crossedFromBelow && !stickyTurnGapReached) {
    return quiet("sticky-turn-floor", "sticky-floor", level);
  }
  return {
    fire: true,
    sticky: !crossedFromBelow,
    level,
    band: measuredBand,
    undroppedTokens,
    tailTokens,
    severity,
    graceBaselineU,
    graceGrowth,
    growthThreshold,
    cadenceGrowth,
    stickyTurnsRemaining,
    dampeningState: "none",
    verdictReason: graceReleaseReason ?? (crossedFromBelow ? "band-crossing" : "cadence-refire"),
    nextLastNudge: undroppedTokens,
    nextLastNudgeLevel: level,
    clearPostReduceGrace
  };
}
function evaluateChannel2(input) {
  const unavailable = (reason) => ({
    evaluable: false,
    shouldTrigger: false,
    reclaimableTokens: 0,
    tailTokens: 0,
    severity: 0,
    band: "quiet",
    verdictReason: reason
  });
  if (!input)
    return unavailable("baseline-unavailable");
  if (input.evaluable !== true)
    return unavailable("baseline-unevaluable");
  if (input.generationInvalidated === true)
    return unavailable("generation-invalidated");
  const values = [input.baselineU, input.baselineT, input.turnDeltaU, input.turnDeltaT];
  if (values.some((value) => !Number.isFinite(value)))
    return unavailable("non-finite-input");
  const tailTokens = Math.max(0, input.baselineT + input.turnDeltaT);
  const reclaimableTokens = Math.min(tailTokens, Math.max(0, input.baselineU + input.turnDeltaU));
  const severity = Math.min(1, Math.max(0, reclaimableTokens / Math.max(tailTokens, 1)));
  const band = nudgeBand(reclaimableTokens, tailTokens);
  let verdictReason = "ceiling-threshold-met";
  if (tailTokens < CHANNEL1_MIN_TOKENS)
    verdictReason = "tail-below-minimum";
  else if (reclaimableTokens < CHANNEL2_FLOOR_TOKENS) {
    verdictReason = "reclaimable-below-floor";
  } else if (severity < CHANNEL2_SEVERITY_THRESHOLD)
    verdictReason = "ratio-below-ceiling";
  return {
    evaluable: true,
    shouldTrigger: verdictReason === "ceiling-threshold-met",
    reclaimableTokens,
    tailTokens,
    severity,
    band,
    verdictReason
  };
}
function approxThousands(tokens) {
  return `${Math.round(tokens / 1000)}k`;
}
function formatOldestReclaimableHint(hint) {
  if (!hint || hint.length === 0)
    return "";
  const rendered = hint.slice(0, 4).map((tag) => `§${tag.tagNumber}§ ${tag.toolName ?? "tool"}`).join(" · ");
  return rendered.length > 0 ? `
oldest reclaimable: ${rendered}.` : "";
}
function formatReclaimableOutputSummary(count, tokens) {
  const outputCount = Math.max(0, Math.floor(count));
  const outputs = outputCount === 0 ? "spent tool outputs" : `${outputCount} spent tool output${outputCount === 1 ? "" : "s"}`;
  return `${outputs} (~${approxThousands(tokens)} tokens)`;
}
function buildChannel2Reminder(undroppedTokens, reclaimableToolOutputs, hint) {
  const summary = formatReclaimableOutputSummary(reclaimableToolOutputs, undroppedTokens);
  const hintText = formatOldestReclaimableHint(hint);
  return `<system-reminder>
` + `Your next step: call ctx_reduce on the outputs you've already used (${summary}). Then continue your task.${hintText}
` + `</system-reminder>`;
}
var CHANNEL1_STICKY_REAL_USER_TURN_GAP = 5;
function buildChannel1Reminder(level, undroppedTokens, reclaimableToolOutputs, hint, sticky = false) {
  const summary = formatReclaimableOutputSummary(reclaimableToolOutputs, undroppedTokens);
  const hintText = formatOldestReclaimableHint(hint);
  if (sticky) {
    return `

<system-reminder>
Still unstamped: ${summary}. Stamp the ones you've used with ctx_reduce now.${hintText}
</system-reminder>`;
  }
  let body;
  switch (level) {
    case "gentle":
      body = `Housekeeping: ${summary} are reclaimable. Stamp each output with ctx_reduce as soon as you've taken what you need from it; don't wait for the task to finish.`;
      break;
    case "firm":
      body = `${summary} are reclaimable. Make a ctx_reduce pass now over the outputs you've already used, then continue.`;
      break;
    case "urgent":
      body = `${summary} are still unstamped. Call ctx_reduce now, before your next tool call, on every output you've already used.`;
      break;
  }
  return `

<system-reminder>
${body}${hintText}
</system-reminder>`;
}

// ../plugin/src/features/magic-context/storage-replay-document.ts
import { AsyncLocalStorage } from "node:async_hooks";

// ../plugin/src/features/magic-context/storage-meta-shared.ts
import { Buffer as Buffer2 } from "node:buffer";
var CACHED_TRIM_PARTIAL_SQL = `EXISTS (
    SELECT 1 FROM compartments
    WHERE compartments.session_id = session_meta.session_id
      AND compartments.end_message_id = session_meta.cached_m0_last_baseline_end_message_id
      AND compartments.end_block_index IS NOT NULL
)`;
var SESSION_META_SELECT_COLUMNS = [
  "session_id",
  "last_response_time",
  "cache_ttl",
  "counter",
  "last_nudge_tokens",
  "last_nudge_band",
  "last_transform_error",
  "is_subagent",
  "last_context_percentage",
  "last_input_tokens",
  "observed_safe_input_tokens",
  "cache_alert_sent",
  "times_execute_threshold_reached",
  "compartment_in_progress",
  "system_prompt_hash",
  "system_prompt_tokens",
  "conversation_tokens",
  "tool_call_tokens",
  "cleared_reasoning_through_tag",
  "tool_reclaim_watermark",
  "last_todo_state",
  "cached_m0_bytes",
  "cached_m0_mural_data_url",
  "cached_m0_mural_hash",
  "cached_m1_bytes",
  "cached_m0_last_baseline_end_message_id",
  "cached_m0_project_memory_epoch",
  "cached_m0_workspace_fingerprint",
  "cached_m0_project_user_profile_version",
  "cached_m0_max_compartment_seq",
  "cached_m0_max_memory_id",
  "cached_m0_max_mutation_id",
  "cached_m0_max_memory_mutation_id",
  "cached_m0_project_docs_hash",
  "cached_m0_materialized_at",
  "cached_m0_session_facts_version",
  "cached_m0_upgrade_state",
  "cached_m0_system_hash",
  "cached_m0_tool_set_hash",
  "cached_m0_model_key",
  "cached_m0_project_identity",
  "last_observed_model_key",
  "last_usage_context_limit",
  "prior_boundary_ordinal",
  "protected_tail_policy_version",
  "protected_tail_drain_window_started_at",
  "protected_tail_drain_tokens",
  "recovery_no_eligible_head_count",
  "force_emergency_bypass_window_start",
  "force_emergency_bypass_used",
  "emergency_drain_active",
  "historian_drain_failure_at",
  "upgrade_reminded_at",
  "upgrade_reminder_last_sent_at",
  "upgrade_reminder_count",
  "pi_stable_id_scheme"
];
var META_COLUMNS = {
  lastResponseTime: "last_response_time",
  cacheTtl: "cache_ttl",
  counter: "counter",
  lastNudgeTokens: "last_nudge_tokens",
  lastNudgeBand: "last_nudge_band",
  lastTransformError: "last_transform_error",
  isSubagent: "is_subagent",
  lastContextPercentage: "last_context_percentage",
  lastInputTokens: "last_input_tokens",
  observedSafeInputTokens: "observed_safe_input_tokens",
  cacheAlertSent: "cache_alert_sent",
  timesExecuteThresholdReached: "times_execute_threshold_reached",
  compartmentInProgress: "compartment_in_progress",
  systemPromptHash: "system_prompt_hash",
  systemPromptTokens: "system_prompt_tokens",
  conversationTokens: "conversation_tokens",
  toolCallTokens: "tool_call_tokens",
  clearedReasoningThroughTag: "cleared_reasoning_through_tag",
  toolReclaimWatermark: "tool_reclaim_watermark",
  lastTodoState: "last_todo_state",
  cachedM0Bytes: "cached_m0_bytes",
  cachedM0MuralDataUrl: "cached_m0_mural_data_url",
  cachedM0MuralHash: "cached_m0_mural_hash",
  cachedM1Bytes: "cached_m1_bytes",
  cachedM0ProjectMemoryEpoch: "cached_m0_project_memory_epoch",
  cachedM0WorkspaceFingerprint: "cached_m0_workspace_fingerprint",
  cachedM0ProjectUserProfileVersion: "cached_m0_project_user_profile_version",
  cachedM0MaxCompartmentSeq: "cached_m0_max_compartment_seq",
  cachedM0MaxMemoryId: "cached_m0_max_memory_id",
  cachedM0MaxMutationId: "cached_m0_max_mutation_id",
  cachedM0MaxMemoryMutationId: "cached_m0_max_memory_mutation_id",
  cachedM0ProjectDocsHash: "cached_m0_project_docs_hash",
  cachedM0MaterializedAt: "cached_m0_materialized_at",
  cachedM0SessionFactsVersion: "cached_m0_session_facts_version",
  cachedM0UpgradeState: "cached_m0_upgrade_state",
  cachedM0SystemHash: "cached_m0_system_hash",
  cachedM0ToolSetHash: "cached_m0_tool_set_hash",
  cachedM0ModelKey: "cached_m0_model_key",
  cachedM0ProjectIdentity: "cached_m0_project_identity",
  lastObservedModelKey: "last_observed_model_key",
  lastUsageContextLimit: "last_usage_context_limit",
  priorBoundaryOrdinal: "prior_boundary_ordinal",
  protectedTailPolicyVersion: "protected_tail_policy_version",
  protectedTailDrainWindowStartedAt: "protected_tail_drain_window_started_at",
  protectedTailDrainTokens: "protected_tail_drain_tokens",
  recoveryNoEligibleHeadCount: "recovery_no_eligible_head_count",
  forceEmergencyBypassWindowStart: "force_emergency_bypass_window_start",
  forceEmergencyBypassUsed: "force_emergency_bypass_used",
  emergencyDrainActive: "emergency_drain_active",
  historianDrainFailureAt: "historian_drain_failure_at",
  upgradeRemindedAt: "upgrade_reminded_at",
  upgradeReminderLastSentAt: "upgrade_reminder_last_sent_at",
  upgradeReminderCount: "upgrade_reminder_count",
  piStableIdScheme: "pi_stable_id_scheme"
};
var BOOLEAN_META_KEYS = new Set(["isSubagent", "compartmentInProgress", "cacheAlertSent"]);
var NULL_BIND_META_KEYS = new Set([
  "cachedM0Bytes",
  "cachedM0MuralDataUrl",
  "cachedM0MuralHash",
  "cachedM1Bytes",
  "cachedM0ProjectMemoryEpoch",
  "cachedM0WorkspaceFingerprint",
  "cachedM0ProjectUserProfileVersion",
  "cachedM0MaxCompartmentSeq",
  "cachedM0MaxMemoryId",
  "cachedM0MaxMutationId",
  "cachedM0MaxMemoryMutationId",
  "cachedM0ProjectDocsHash",
  "cachedM0MaterializedAt",
  "cachedM0SessionFactsVersion",
  "cachedM0UpgradeState",
  "cachedM0ProjectIdentity",
  "lastObservedModelKey",
  "upgradeRemindedAt",
  "upgradeReminderLastSentAt",
  "piStableIdScheme"
]);
function isStringOrNull(value) {
  return value === null || typeof value === "string";
}
function isNumberOrNull(value) {
  return value === null || typeof value === "number";
}
function isBlobOrNull(value) {
  return value === null || Buffer2.isBuffer(value) || value instanceof Uint8Array;
}
function toBufferOrNull(value) {
  if (value === null)
    return null;
  if (Buffer2.isBuffer(value))
    return value;
  return Buffer2.from(value.buffer, value.byteOffset, value.byteLength);
}
function isSessionMetaRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.session_id === "string" && isNumberOrNull(r.last_response_time) && isStringOrNull(r.cache_ttl) && typeof r.counter === "number" && typeof r.last_nudge_tokens === "number" && isStringOrNull(r.last_nudge_band) && isStringOrNull(r.last_transform_error) && isNumberOrNull(r.is_subagent) && typeof r.last_context_percentage === "number" && typeof r.last_input_tokens === "number" && isNumberOrNull(r.observed_safe_input_tokens) && isNumberOrNull(r.cache_alert_sent) && isNumberOrNull(r.times_execute_threshold_reached) && isNumberOrNull(r.compartment_in_progress) && (r.system_prompt_hash === null || typeof r.system_prompt_hash === "string" || typeof r.system_prompt_hash === "number") && isNumberOrNull(r.system_prompt_tokens) && isNumberOrNull(r.conversation_tokens) && isNumberOrNull(r.tool_call_tokens) && isNumberOrNull(r.cleared_reasoning_through_tag) && isStringOrNull(r.last_todo_state) && isBlobOrNull(r.cached_m0_bytes) && isStringOrNull(r.cached_m0_mural_data_url) && isStringOrNull(r.cached_m0_mural_hash) && isBlobOrNull(r.cached_m1_bytes) && isNumberOrNull(r.cached_m0_project_memory_epoch) && isStringOrNull(r.cached_m0_workspace_fingerprint) && isNumberOrNull(r.cached_m0_project_user_profile_version) && isNumberOrNull(r.cached_m0_max_compartment_seq) && isNumberOrNull(r.cached_m0_max_memory_id) && isNumberOrNull(r.cached_m0_max_mutation_id) && isNumberOrNull(r.cached_m0_max_memory_mutation_id) && isStringOrNull(r.cached_m0_project_docs_hash) && isNumberOrNull(r.cached_m0_materialized_at) && isNumberOrNull(r.cached_m0_session_facts_version) && isStringOrNull(r.cached_m0_upgrade_state) && isStringOrNull(r.cached_m0_system_hash) && isStringOrNull(r.cached_m0_tool_set_hash) && isStringOrNull(r.cached_m0_model_key) && isStringOrNull(r.cached_m0_project_identity) && isStringOrNull(r.last_observed_model_key) && isNumberOrNull(r.last_usage_context_limit) && isNumberOrNull(r.prior_boundary_ordinal) && isNumberOrNull(r.protected_tail_policy_version) && isNumberOrNull(r.protected_tail_drain_window_started_at) && isNumberOrNull(r.protected_tail_drain_tokens) && isNumberOrNull(r.recovery_no_eligible_head_count) && isNumberOrNull(r.force_emergency_bypass_window_start) && isNumberOrNull(r.force_emergency_bypass_used) && isNumberOrNull(r.upgrade_reminded_at) && isNumberOrNull(r.upgrade_reminder_last_sent_at) && isNumberOrNull(r.upgrade_reminder_count) && isNumberOrNull(r.pi_stable_id_scheme) && isNumberOrNull(r.tool_reclaim_watermark);
}
function getDefaultSessionMeta(sessionId) {
  return {
    sessionId,
    lastResponseTime: 0,
    cacheTtl: "5m",
    counter: 0,
    lastNudgeTokens: 0,
    lastNudgeBand: null,
    lastTransformError: null,
    isSubagent: false,
    lastContextPercentage: 0,
    lastInputTokens: 0,
    observedSafeInputTokens: 0,
    cacheAlertSent: false,
    timesExecuteThresholdReached: 0,
    compartmentInProgress: false,
    systemPromptHash: "",
    systemPromptTokens: 0,
    conversationTokens: 0,
    toolCallTokens: 0,
    clearedReasoningThroughTag: 0,
    toolReclaimWatermark: 0,
    lastTodoState: "",
    cachedM0Bytes: null,
    cachedM0MuralDataUrl: null,
    cachedM0MuralHash: null,
    cachedM1Bytes: null,
    cachedM0TrimBoundaryId: null,
    cachedM0TrimBoundaryPartial: false,
    cachedM0ProjectMemoryEpoch: null,
    cachedM0WorkspaceFingerprint: null,
    cachedM0ProjectUserProfileVersion: null,
    cachedM0MaxCompartmentSeq: null,
    cachedM0MaxMemoryId: null,
    cachedM0MaxMutationId: null,
    cachedM0MaxMemoryMutationId: null,
    cachedM0ProjectDocsHash: null,
    cachedM0MaterializedAt: null,
    cachedM0SessionFactsVersion: null,
    cachedM0UpgradeState: null,
    cachedM0SystemHash: null,
    cachedM0ToolSetHash: null,
    cachedM0ModelKey: null,
    cachedM0ProjectIdentity: null,
    lastObservedModelKey: null,
    lastUsageContextLimit: 0,
    priorBoundaryOrdinal: 1,
    protectedTailPolicyVersion: 0,
    protectedTailDrainWindowStartedAt: 0,
    protectedTailDrainTokens: 0,
    recoveryNoEligibleHeadCount: 0,
    forceEmergencyBypassWindowStart: 0,
    forceEmergencyBypassUsed: 0,
    upgradeRemindedAt: null,
    upgradeReminderLastSentAt: null,
    upgradeReminderCount: 0,
    piStableIdScheme: null
  };
}
var sessionMetaExistsStatements = new WeakMap;
function ensureSessionMetaRow(db, sessionId, initialIsSubagent = getHarness2() === "opencode2" ? null : false) {
  let exists = sessionMetaExistsStatements.get(db);
  if (!exists) {
    exists = prepareCachedStatement2(db, "SELECT 1 FROM session_meta WHERE session_id = ?");
    sessionMetaExistsStatements.set(db, exists);
  }
  if (exists.get(sessionId))
    return;
  const defaults = getDefaultSessionMeta(sessionId);
  db.prepare("INSERT OR IGNORE INTO session_meta (session_id, harness, last_response_time, cache_ttl, counter, last_nudge_tokens, last_nudge_band, last_transform_error, is_subagent, last_context_percentage, last_input_tokens, observed_safe_input_tokens, cache_alert_sent, times_execute_threshold_reached, compartment_in_progress, system_prompt_hash, cleared_reasoning_through_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(sessionId, getHarness2(), defaults.lastResponseTime, defaults.cacheTtl, defaults.counter, defaults.lastNudgeTokens, defaults.lastNudgeBand ?? "", defaults.lastTransformError ?? "", initialIsSubagent === null ? null : initialIsSubagent ? 1 : 0, defaults.lastContextPercentage, defaults.lastInputTokens, defaults.observedSafeInputTokens, defaults.cacheAlertSent ? 1 : 0, defaults.timesExecuteThresholdReached, defaults.compartmentInProgress ? 1 : 0, defaults.systemPromptHash ?? "", defaults.clearedReasoningThroughTag);
}
function toSessionMeta(row) {
  const nudgeBandRaw = typeof row.last_nudge_band === "string" ? row.last_nudge_band : "";
  const transformErrorRaw = typeof row.last_transform_error === "string" ? row.last_transform_error : "";
  const cacheTtlRaw = typeof row.cache_ttl === "string" && row.cache_ttl.length > 0 ? row.cache_ttl : "5m";
  const systemPromptHashRaw = row.system_prompt_hash == null ? "" : row.system_prompt_hash;
  const lastTodoStateRaw = typeof row.last_todo_state === "string" ? row.last_todo_state : "";
  const numOrZero = (value) => typeof value === "number" ? value : 0;
  const numOrNull = (value) => typeof value === "number" ? value : null;
  const stringOrNull = (value) => typeof value === "string" ? value : null;
  return {
    sessionId: row.session_id,
    lastResponseTime: numOrZero(row.last_response_time),
    cacheTtl: cacheTtlRaw,
    counter: row.counter,
    lastNudgeTokens: row.last_nudge_tokens,
    lastNudgeBand: nudgeBandRaw.length > 0 ? nudgeBandRaw : null,
    lastTransformError: transformErrorRaw.length > 0 ? transformErrorRaw : null,
    isSubagent: row.is_subagent === 1,
    lastContextPercentage: row.last_context_percentage,
    lastInputTokens: row.last_input_tokens,
    observedSafeInputTokens: numOrZero(row.observed_safe_input_tokens),
    cacheAlertSent: numOrZero(row.cache_alert_sent) === 1,
    timesExecuteThresholdReached: numOrZero(row.times_execute_threshold_reached),
    compartmentInProgress: row.compartment_in_progress === 1,
    systemPromptHash: String(systemPromptHashRaw),
    systemPromptTokens: numOrZero(row.system_prompt_tokens),
    conversationTokens: numOrZero(row.conversation_tokens),
    toolCallTokens: numOrZero(row.tool_call_tokens),
    clearedReasoningThroughTag: numOrZero(row.cleared_reasoning_through_tag),
    toolReclaimWatermark: numOrZero(row.tool_reclaim_watermark),
    lastTodoState: lastTodoStateRaw,
    cachedM0Bytes: toBufferOrNull(row.cached_m0_bytes),
    cachedM0MuralDataUrl: stringOrNull(row.cached_m0_mural_data_url),
    cachedM0MuralHash: stringOrNull(row.cached_m0_mural_hash),
    cachedM1Bytes: toBufferOrNull(row.cached_m1_bytes),
    cachedM0TrimBoundaryId: row.cached_m0_last_baseline_end_message_id || null,
    cachedM0TrimBoundaryPartial: row.cached_trim_partial === 1,
    cachedM0ProjectMemoryEpoch: numOrNull(row.cached_m0_project_memory_epoch),
    cachedM0WorkspaceFingerprint: stringOrNull(row.cached_m0_workspace_fingerprint),
    cachedM0ProjectUserProfileVersion: numOrNull(row.cached_m0_project_user_profile_version),
    cachedM0MaxCompartmentSeq: numOrNull(row.cached_m0_max_compartment_seq),
    cachedM0MaxMemoryId: numOrNull(row.cached_m0_max_memory_id),
    cachedM0MaxMutationId: numOrNull(row.cached_m0_max_mutation_id),
    cachedM0MaxMemoryMutationId: numOrNull(row.cached_m0_max_memory_mutation_id),
    cachedM0ProjectDocsHash: stringOrNull(row.cached_m0_project_docs_hash),
    cachedM0MaterializedAt: numOrNull(row.cached_m0_materialized_at),
    cachedM0SessionFactsVersion: numOrNull(row.cached_m0_session_facts_version),
    cachedM0UpgradeState: stringOrNull(row.cached_m0_upgrade_state),
    cachedM0SystemHash: stringOrNull(row.cached_m0_system_hash),
    cachedM0ToolSetHash: stringOrNull(row.cached_m0_tool_set_hash),
    cachedM0ModelKey: stringOrNull(row.cached_m0_model_key),
    cachedM0ProjectIdentity: stringOrNull(row.cached_m0_project_identity),
    lastObservedModelKey: stringOrNull(row.last_observed_model_key),
    lastUsageContextLimit: numOrZero(row.last_usage_context_limit),
    priorBoundaryOrdinal: Math.max(1, numOrZero(row.prior_boundary_ordinal) || 1),
    protectedTailPolicyVersion: numOrZero(row.protected_tail_policy_version),
    protectedTailDrainWindowStartedAt: numOrZero(row.protected_tail_drain_window_started_at),
    protectedTailDrainTokens: numOrZero(row.protected_tail_drain_tokens),
    recoveryNoEligibleHeadCount: numOrZero(row.recovery_no_eligible_head_count),
    forceEmergencyBypassWindowStart: numOrZero(row.force_emergency_bypass_window_start),
    forceEmergencyBypassUsed: numOrZero(row.force_emergency_bypass_used),
    upgradeRemindedAt: numOrNull(row.upgrade_reminded_at),
    upgradeReminderLastSentAt: numOrNull(row.upgrade_reminder_last_sent_at),
    upgradeReminderCount: numOrZero(row.upgrade_reminder_count),
    piStableIdScheme: numOrNull(row.pi_stable_id_scheme)
  };
}
function persistCachedM0(db, sessionId, payload) {
  ensureSessionMetaRow(db, sessionId);
  db.prepare(`UPDATE session_meta SET
            cached_m0_bytes = ?,
            cached_m0_mural_data_url = ?,
            cached_m0_mural_hash = ?,
            cached_m0_project_memory_epoch = ?,
            cached_m0_workspace_fingerprint = ?,
            cached_m0_project_user_profile_version = ?,
            cached_m0_max_compartment_seq = ?,
            cached_m0_max_memory_id = ?,
            cached_m0_max_mutation_id = ?,
            cached_m0_max_memory_mutation_id = ?,
            cached_m1_bytes = ?,
            cached_m0_project_docs_hash = ?,
            cached_m0_materialized_at = ?,
            cached_m0_session_facts_version = ?,
            cached_m0_upgrade_state = ?,
            cached_m0_system_hash = ?,
            cached_m0_tool_set_hash = ?,
            cached_m0_model_key = ?,
            cached_m0_project_identity = ?
         WHERE session_id = ?`).run(Buffer2.from(payload.m0Bytes), payload.muralDataUrl ?? null, payload.muralHash ?? null, payload.projectMemoryEpoch, payload.workspaceFingerprint ?? null, payload.projectUserProfileVersion, payload.maxCompartmentSeq, payload.maxMemoryId, payload.maxMutationId, payload.maxMemoryMutationId ?? null, payload.m1Bytes ? Buffer2.from(payload.m1Bytes) : null, payload.projectDocsHash, payload.materializedAt, payload.sessionFactsVersion, payload.upgradeState, payload.systemHash ?? "", payload.toolSetHash ?? "", payload.modelKey ? piModelRefToCanonical(payload.modelKey) : "", payload.projectIdentity ?? null, sessionId);
}
function clearCachedM0M1(db, sessionId) {
  ensureSessionMetaRow(db, sessionId);
  const existingColumns = new Set(db.prepare("PRAGMA table_info(session_meta)").all().map((column) => column.name));
  const clears = [
    ["cached_m0_bytes", null],
    ["cached_m0_mural_data_url", null],
    ["cached_m0_mural_hash", null],
    ["cached_m1_bytes", null],
    ["cached_m0_project_memory_epoch", null],
    ["cached_m0_workspace_fingerprint", null],
    ["cached_m0_project_user_profile_version", null],
    ["cached_m0_max_compartment_seq", null],
    ["cached_m0_max_memory_id", null],
    ["cached_m0_max_mutation_id", null],
    ["cached_m0_max_memory_mutation_id", null],
    ["cached_m0_project_docs_hash", null],
    ["cached_m0_materialized_at", null],
    ["cached_m0_session_facts_version", null],
    ["cached_m0_upgrade_state", null],
    ["cached_m0_system_hash", null],
    ["cached_m0_tool_set_hash", null],
    ["cached_m0_model_key", null],
    ["cached_m0_project_identity", null],
    ["cached_m0_last_baseline_end_message_id", null],
    ["memory_block_cache", ""],
    ["memory_block_count", 0],
    ["memory_block_ids", ""]
  ];
  const setClauses = [];
  const values = [];
  for (const [column, value] of clears) {
    if (!existingColumns.has(column))
      continue;
    setClauses.push(`${column} = ?`);
    values.push(value);
  }
  if (setClauses.length === 0)
    return;
  db.prepare(`UPDATE session_meta SET ${setClauses.join(", ")} WHERE session_id = ?`).run(...values, sessionId);
}

// ../plugin/src/features/magic-context/storage-replay-document.ts
var CAS_RETRY_LIMIT = 5;
var MISSING_REPLAY_DOCUMENT_COLUMN = Symbol("missing replay document column");
var replaySnapshots = new AsyncLocalStorage;
function invalidateReplayEnvelopeSnapshot(db, sessionId) {
  const snapshot = replaySnapshots.getStore();
  if (snapshot?.db === db && snapshot.sessionId === sessionId)
    snapshot.loaded = false;
}
function isRustMarkerAdmissionFenced(db, sessionId) {
  const row = db.prepare("SELECT COALESCE(json_extract(NULLIF(trailing_blank_decisions, ''), '$.rustMarkerAdmissionFence'), 0) AS fenced FROM session_meta WHERE session_id=?").get(sessionId);
  return row?.fenced === 1;
}
function isPersistedTrailingBlankDecision(value) {
  if (value === "keep" || value === "strip")
    return true;
  if (typeof value !== "string" || !value.startsWith("keep:"))
    return false;
  const countText = value.slice("keep:".length);
  if (!/^[1-9]\d*$/.test(countText))
    return false;
  const count = Number(countText);
  return Number.isSafeInteger(count) && count > 1 && count <= 1e4;
}

class ReplayDocumentError extends Error {
  constructor(reason) {
    super(`invalid persisted replay document: ${reason}`);
    this.name = "ReplayDocumentError";
  }
}
function invalidReplayDocument(reason) {
  return new ReplayDocumentError(reason);
}
function parseTrailingBlank(value, mode) {
  if (!isRecord(value)) {
    throw invalidReplayDocument("trailingBlank must be an object");
  }
  const entries = [];
  for (const [id, decision] of Object.entries(value)) {
    if (id.length === 0 || !isPersistedTrailingBlankDecision(decision)) {
      if (mode === "read")
        continue;
      throw invalidReplayDocument("trailingBlank contains an invalid decision");
    }
    entries.push([id, decision]);
  }
  return Object.fromEntries(entries);
}
function parseV2ReplayDocument(parsed, mode) {
  if (parsed.version !== 2) {
    throw invalidReplayDocument("unknown envelope version");
  }
  if (!Object.hasOwn(parsed, "trailingBlank")) {
    throw invalidReplayDocument("version 2 is missing trailingBlank");
  }
  return {
    ...parsed,
    version: 2,
    trailingBlank: parseTrailingBlank(parsed.trailingBlank, mode)
  };
}
function parseReplayDocument(raw, mode = "strict") {
  if (raw === null || raw === undefined || raw === "") {
    return { version: 1, trailingBlank: {} };
  }
  if (typeof raw !== "string") {
    throw invalidReplayDocument("stored value is not text");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw invalidReplayDocument("stored value is not JSON");
  }
  if (!isRecord(parsed)) {
    throw invalidReplayDocument("stored value is not an object");
  }
  if (Object.hasOwn(parsed, "version") && !isPersistedTrailingBlankDecision(parsed.version))
    return parseV2ReplayDocument(parsed, mode);
  return {
    version: 1,
    trailingBlank: parseTrailingBlank(parsed, mode)
  };
}
function serializeReplayDocument(doc) {
  const trailingBlank = parseTrailingBlank(doc.trailingBlank, "strict");
  if (doc.version === 1)
    return JSON.stringify(trailingBlank);
  if (doc.version !== 2) {
    throw invalidReplayDocument("unknown document version");
  }
  return JSON.stringify({
    ...doc,
    version: 2,
    trailingBlank
  });
}
function isMissingReplayDocumentColumn(error) {
  return error instanceof Error && /no such column: trailing_blank_decisions/i.test(error.message);
}
var decisionTablePresent = new WeakMap;
function hasReplayDecisionTable(db) {
  if (decisionTablePresent.has(db))
    return true;
  const row = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'session_replay_decisions'").get();
  if (row?.present !== 1)
    return false;
  decisionTablePresent.set(db, true);
  return true;
}
function readDecisionRows(db, sessionId, messageIds) {
  if (messageIds === undefined) {
    return db.prepare("SELECT message_id, decision FROM session_replay_decisions WHERE session_id = ?").all(sessionId);
  }
  if (messageIds.length === 0)
    return [];
  return db.prepare(`SELECT message_id, decision FROM session_replay_decisions
             WHERE session_id = ? AND message_id IN (SELECT value FROM json_each(?))`).all(sessionId, JSON.stringify(messageIds));
}
function readRawReplayDocument(db, sessionId, fresh = false) {
  const snapshot = replaySnapshots.getStore();
  const reusable = !fresh && snapshot?.active && snapshot.db === db && snapshot.sessionId === sessionId;
  if (reusable && snapshot.loaded)
    return snapshot.raw;
  try {
    const row = db.prepare("SELECT trailing_blank_decisions FROM session_meta WHERE session_id = ?").get(sessionId);
    const raw = row?.trailing_blank_decisions;
    if (raw === null || raw === undefined || typeof raw === "string") {
      if (reusable) {
        snapshot.raw = raw;
        snapshot.loaded = true;
      }
      return raw;
    }
    throw invalidReplayDocument("stored value is not text");
  } catch (error) {
    if (isMissingReplayDocumentColumn(error)) {
      if (reusable) {
        snapshot.raw = MISSING_REPLAY_DOCUMENT_COLUMN;
        snapshot.loaded = true;
      }
      return MISSING_REPLAY_DOCUMENT_COLUMN;
    }
    throw error;
  }
}
var trailingBlankReadCache = new WeakMap;
var TRAILING_BLANK_CACHE_MAX_CHARS = 4 * 1024 * 1024;
function readReplayEnvelope(db, sessionId, mode = "strict") {
  const raw = readRawReplayDocument(db, sessionId);
  if (raw === MISSING_REPLAY_DOCUMENT_COLUMN) {
    return { version: 1, trailingBlank: {} };
  }
  return parseReplayDocument(raw, mode);
}
function readReplayDocument(db, sessionId, mode = "strict") {
  const doc = readReplayEnvelope(db, sessionId, mode);
  if (!hasReplayDecisionTable(db))
    return doc;
  const rows = readDecisionRows(db, sessionId);
  if (rows.length === 0)
    return doc;
  const merged = new Map(Object.entries(doc.trailingBlank));
  for (const row of rows) {
    if (!isPersistedTrailingBlankDecision(row.decision)) {
      if (mode === "read")
        continue;
      throw invalidReplayDocument("trailingBlank contains an invalid decision");
    }
    merged.set(row.message_id, row.decision);
  }
  return { ...doc, trailingBlank: Object.fromEntries(merged) };
}
function readAllTrailingBlankDecisions(db, sessionId, rawColumn) {
  let decisions;
  try {
    decisions = new Map(Object.entries(parseReplayDocument(rawColumn, "read").trailingBlank));
  } catch (error) {
    if (error instanceof ReplayDocumentError)
      return new Map;
    throw error;
  }
  if (!hasReplayDecisionTable(db))
    return decisions;
  for (const row of readDecisionRows(db, sessionId)) {
    if (isPersistedTrailingBlankDecision(row.decision))
      decisions.set(row.message_id, row.decision);
  }
  return decisions;
}
function updateReplayDocument(db, sessionId, mutate) {
  invalidateReplayEnvelopeSnapshot(db, sessionId);
  let initial;
  try {
    initial = readRawReplayDocument(db, sessionId, true);
  } catch (error) {
    if (error instanceof ReplayDocumentError)
      return false;
    throw error;
  }
  if (initial === MISSING_REPLAY_DOCUMENT_COLUMN)
    return false;
  ensureSessionMetaRow(db, sessionId);
  for (let attempt = 0;attempt < CAS_RETRY_LIMIT; attempt += 1) {
    let raw;
    try {
      raw = readRawReplayDocument(db, sessionId, true);
    } catch (error) {
      if (error instanceof ReplayDocumentError)
        return false;
      throw error;
    }
    if (raw === MISSING_REPLAY_DOCUMENT_COLUMN)
      return false;
    let doc;
    try {
      doc = parseReplayDocument(raw);
    } catch (error) {
      if (error instanceof ReplayDocumentError)
        return false;
      throw error;
    }
    if (!mutate(doc))
      return true;
    const next = serializeReplayDocument(doc);
    if (next === raw)
      return true;
    const result = db.prepare("UPDATE session_meta SET trailing_blank_decisions = ? WHERE session_id = ? AND trailing_blank_decisions IS ?").run(next, sessionId, raw);
    if (result.changes > 0)
      return true;
  }
  sessionLog2(sessionId, `trailing_blank_decisions CAS: ${CAS_RETRY_LIMIT} retries exhausted`);
  return false;
}
var DECISION_CONFLICT = Symbol("replay decision changed concurrently");
function writeReplayDocument(db, sessionId, doc) {
  invalidateReplayEnvelopeSnapshot(db, sessionId);
  if (!hasReplayDecisionTable(db)) {
    db.prepare("UPDATE session_meta SET trailing_blank_decisions = ? WHERE session_id = ?").run(serializeReplayDocument(doc), sessionId);
    return;
  }
  const decisions = parseTrailingBlank(doc.trailingBlank, "strict");
  db.prepare("UPDATE session_meta SET trailing_blank_decisions = ? WHERE session_id = ?").run(doc.version === 1 ? "" : serializeReplayDocument({ ...doc, trailingBlank: {} }), sessionId);
  db.prepare("DELETE FROM session_replay_decisions WHERE session_id = ?").run(sessionId);
  const insert = db.prepare("INSERT INTO session_replay_decisions (session_id, message_id, decision) VALUES (?, ?, ?)");
  for (const [id, decision] of Object.entries(decisions))
    insert.run(sessionId, id, decision);
}

// ../plugin/src/features/magic-context/storage-reasoning-removal.ts
var NAMESPACE = "reasoningRemoval";
var BACKUP_NAMESPACE = "reasoningRemovalBackup";
function invalidState(sessionId) {
  return new Error(`invalid persisted reasoning removal state for session ${sessionId}`);
}
function parseState(doc, sessionId, namespace = NAMESPACE) {
  const lane = doc[namespace];
  if (lane === undefined)
    return { messageIds: new Set, dropLeavesReasoning: false };
  if (!isRecord(lane) || !Array.isArray(lane.messageIds))
    throw invalidState(sessionId);
  const ids = new Set;
  for (const id of lane.messageIds) {
    if (typeof id !== "string" || id.length === 0)
      throw invalidState(sessionId);
    ids.add(id);
  }
  if (lane.dropLeavesReasoning !== undefined && typeof lane.dropLeavesReasoning !== "boolean") {
    throw invalidState(sessionId);
  }
  return { messageIds: ids, dropLeavesReasoning: lane.dropLeavesReasoning === true };
}
function getReasoningRemovalState(db, sessionId) {
  const doc = readReplayEnvelope(db, sessionId);
  try {
    return parseState(doc, sessionId);
  } catch (error) {
    if (doc[BACKUP_NAMESPACE] === undefined)
      throw error;
    return parseState(doc, sessionId, BACKUP_NAMESPACE);
  }
}

// ../plugin/src/hooks/magic-context/sentinel.ts
function modelAcceptsEmptyContent(providerID) {
  return providerID === "anthropic";
}
function isAnthropicFamilyRoute(providerID, modelID) {
  const provider = (providerID ?? "").toLowerCase();
  const model = (modelID ?? "").toLowerCase();
  return provider.includes("anthropic") || model.includes("claude") || model.includes("anthropic");
}
var REMOVED_REASONING_MARK = Symbol.for("magic-context.removed-reasoning");
var NEUTRALIZED_ORIGINALS = new WeakMap;
var VARIANT_CACHE_PRESERVING_MODELS = {
  "anthropic/claude-fable-5-1": "2026-09-02",
  "openai/gpt-6-astra": "2026-09-05",
  "anthropic/claude-opus-5-5": "2026-09-23"
};
function canonicalVariantModelIdentity(providerID, modelID) {
  const normalizedProviderID = providerID.toLowerCase();
  const isAnthropicFamily = normalizedProviderID === "anthropic" || normalizedProviderID === "google-vertex-anthropic" || normalizedProviderID.includes("bedrock");
  if (isAnthropicFamily && isFable51ThinkingBindingModel("anthropic", modelID)) {
    return "anthropic/claude-fable-5-1";
  }
  return canonicalModelIdentity(`${providerID}/${modelID}`).toLowerCase();
}
function variantChangeBustsProviderCache(providerID, modelID) {
  if (!providerID || !modelID)
    return false;
  const identity = canonicalVariantModelIdentity(providerID, modelID);
  if (Object.hasOwn(VARIANT_CACHE_PRESERVING_MODELS, identity))
    return false;
  const normalizedProviderID = providerID.toLowerCase();
  return normalizedProviderID === "anthropic" || normalizedProviderID === "google-vertex-anthropic" || normalizedProviderID.includes("bedrock");
}

// ../plugin/src/hooks/magic-context/active-anthropic-turn.ts
function isInActiveAnthropicTurn(messages, index, anthropic) {
  const start = activeAnthropicTurnStart(messages, anthropic);
  return start !== undefined && index >= start;
}
function activeAnthropicTurnStart(messages, anthropic) {
  if (!anthropic)
    return;
  for (let user = messages.length - 1;user >= 0; user--) {
    if (isRealUserRequest(messages[user]))
      return user + 1;
  }
  return;
}
function isRealUserRequest(message) {
  if (!isRecord(message))
    return false;
  const info = isRecord(message.info) ? message.info : message;
  if (info.role !== "user" || info.synthetic === true || message.synthetic === true)
    return false;
  const id = typeof info.id === "string" ? info.id : "";
  if (id.startsWith("synth-user-"))
    return false;
  const parts = Array.isArray(message.parts) ? message.parts : Array.isArray(message.content) ? message.content : [];
  return !(parts.length > 0 && parts.every((part) => isRecord(part) && (part.synthetic === true || part.ignored === true || ["tool_result", "toolResult", "tool-result"].includes(String(part.type)))));
}
function hasAnthropicReasoning(messages) {
  return messages.some((message) => {
    if (!isRecord(message))
      return false;
    const info = isRecord(message.info) ? message.info : message;
    if (isAnthropicFamilyRoute(typeof info.providerID === "string" ? info.providerID : typeof info.provider === "string" ? info.provider : undefined, typeof info.modelID === "string" ? info.modelID : typeof info.model === "string" ? info.model : undefined))
      return true;
    const parts = Array.isArray(message.parts) ? message.parts : [];
    return parts.some((part) => isRecord(part) && isRecord(part.metadata) && isRecord(part.metadata.anthropic));
  });
}

// ../plugin/src/shared/marker-only-text.ts
var MARKER_ONLY_PATTERN = /^(?:(?:§\d+§|\[dropped\s*(?:\d+|§\d*§)?\]|\[cleared\])\s*)+$/;
function isMarkerOnlyText(text) {
  const trimmed = text.trim();
  return trimmed.length > 0 && MARKER_ONLY_PATTERN.test(trimmed);
}

// ../plugin/src/hooks/magic-context/served-shape-repair.ts
var sources = new WeakMap;
// ../plugin/src/hooks/magic-context/strip-content.ts
var METADATA_PART_TYPES = new Set([
  "step-start",
  "step-finish",
  "snapshot",
  "patch",
  "agent",
  "retry",
  "subtask",
  "compaction"
]);
var CLEARED_REASONING_TYPES = new Set(["thinking", "reasoning"]);
var REASONING_IGNORED_PART_TYPES = new Set([
  "step-start",
  "step-finish",
  "snapshot",
  "patch",
  "agent",
  "retry",
  "subtask",
  "compaction"
]);
var REASONING_PART_TYPES = new Set(["reasoning", "thinking", "redacted_thinking"]);
function hasReasoningReplayContent(message) {
  return message.parts.some((part) => {
    if (!isRecord(part) || part.ignored === true)
      return false;
    const type = typeof part.type === "string" ? part.type : "";
    if (REASONING_IGNORED_PART_TYPES.has(type))
      return false;
    return type !== "text" || typeof part.text !== "string" || part.text.trim().length > 0;
  });
}
function findLatestAssistantReasoningMutationExemptMessage(messages) {
  for (let index = messages.length - 1;index >= 0; index -= 1) {
    const message = messages[index];
    if (message.info.role === "assistant" && hasReasoningReplayContent(message))
      return message;
  }
  return;
}
var emptyImageParts = new WeakMap;

// ../plugin/src/hooks/magic-context/reasoning-budget.ts
var DEFAULT_KEEP_REASONING_TOKENS = 1e4;
var UNKNOWN_REASONING_STEP_TOKENS = 1000;
function resolveKeepReasoningTokens(config, modelKey) {
  const values = config && typeof config === "object" ? Object.assign(Object.create(null), config) : undefined;
  return typeof config === "number" ? config : resolveModelConfigValue(values, modelKey)?.value ?? values?.default ?? DEFAULT_KEEP_REASONING_TOKENS;
}
function reasoningStepCost(reported, textEstimate, opaque) {
  if (reported !== undefined && Number.isFinite(reported) && reported > 0)
    return reported;
  if (textEstimate > 0)
    return Math.ceil(textEstimate);
  return opaque ? UNKNOWN_REASONING_STEP_TOKENS : 0;
}
function reasoningBudgetCutoff(steps, budget) {
  const cost = (step) => step.alreadyRemoved ? 0 : typeof step.cost === "function" ? step.cost() : step.cost;
  let kept = 0;
  let upperBound = Number.POSITIVE_INFINITY;
  for (const step of steps) {
    if (!step.exempt)
      continue;
    kept += cost(step);
    if (step.tag > 0)
      upperBound = Math.min(upperBound, step.tag - 1);
  }
  for (let index = steps.length - 1;index >= 0; index--) {
    const step = steps[index];
    if (step.exempt || step.alreadyRemoved)
      continue;
    const tokens = cost(step);
    if (kept + tokens <= budget) {
      kept += tokens;
      if (step.tag > 0)
        upperBound = Math.min(upperBound, step.tag - 1);
      continue;
    }
    let tag = step.tag;
    for (let older = index - 1;tag <= 0 && older >= 0; older--)
      tag = steps[older].tag;
    return Math.max(0, Math.min(tag, upperBound));
  }
  return 0;
}
function reasoningTextAndOpaque(parts) {
  let text = "";
  let inlineText = "";
  let opaque = false;
  let hasReasoning = false;
  const detailText = new Set;
  for (const part of parts) {
    if (!isRecord(part))
      continue;
    if (part.ignored === true)
      continue;
    if (isRecord(part.metadata)) {
      const router = part.metadata.openrouter;
      if (isRecord(router) && Array.isArray(router.reasoning_details) && router.reasoning_details.length > 0) {
        hasReasoning = true;
        opaque = true;
        for (const detail of router.reasoning_details) {
          if (!isRecord(detail))
            continue;
          if (detail.type === "reasoning.text" && typeof detail.text === "string")
            detailText.add(detail.text);
          if (detail.type === "reasoning.summary" && typeof detail.summary === "string")
            detailText.add(detail.summary);
        }
      }
    }
    if (["reasoning", "thinking", "redacted_thinking"].includes(String(part.type))) {
      hasReasoning = true;
      const visible = part.type === "redacted_thinking" || part.redacted === true ? "" : typeof part.thinking === "string" ? part.thinking : typeof part.text === "string" ? part.text : "";
      if (visible !== "[cleared]")
        text += visible;
      opaque ||= part.type === "redacted_thinking" || part.redacted === true || visible === "" && (part.metadata !== undefined || part.signature !== undefined || part.thinkingSignature !== undefined);
    } else if (part.type === "text" && typeof part.text === "string") {
      for (const match of part.text.matchAll(/<(?:thinking|think)>([\s\S]*?)<\/(?:thinking|think)>/gi))
        inlineText += match[1];
    }
  }
  return { text: text || [...detailText].join(""), inlineText, opaque, hasReasoning };
}

// ../plugin/src/hooks/magic-context/opaque-thinking.ts
function opaqueThinkingCost(reasoning, output) {
  for (const count of [reasoning, output]) {
    if (typeof count === "number" && Number.isFinite(count) && count > 0)
      return { tokens: count, fallback: false };
  }
  return { tokens: UNKNOWN_REASONING_STEP_TOKENS, fallback: true };
}

// ../plugin/src/hooks/magic-context/final-wire-token-estimate.ts
var wireTextTokens = createTokenCountMemo(1e5, 128 * 1024 * 1024);
function estimatePartImageTokens(raw) {
  if (!isRecord(raw))
    return 0;
  const part = raw;
  if (part.ignored)
    return 0;
  if (part.type === "media")
    return estimateNativeMediaImageTokens(raw);
  if (part.type === "file" && part.mime?.startsWith("image/")) {
    return typeof part.url === "string" && part.url.startsWith("data:") ? estimateImageTokensFromDataUrl(part.url) : 1200;
  }
  return part.type === "tool" ? estimateToolAttachmentImageTokens(part.state) : 0;
}

// ../plugin/src/hooks/magic-context/emergency-drop.ts
var TARGET_FRACTION = 0.3;
var TIER_RECENCY_RESERVE = 0.2;
var EMERGENCY_REARM_MIN_TOKENS = 2000;
var EMERGENCY_MIN_ACHIEVABLE_RECLAIM_TOKENS = EMERGENCY_REARM_MIN_TOKENS;
var T1_TOOLS = new Set(["read", "todowrite", "task", "aft_outline", "aft_zoom"]);
var T2_TOOLS = new Set(["edit", "write", "apply_patch", "grep", "glob", "aft_search"]);
function normalizeToolName(toolName) {
  if (!toolName)
    return "";
  let name = toolName.toLowerCase();
  if (name.startsWith("mcp_"))
    name = name.slice(4);
  return name;
}
function resolveToolTier(toolName) {
  const name = normalizeToolName(toolName);
  if (T1_TOOLS.has(name))
    return 1;
  if (T2_TOOLS.has(name))
    return 2;
  return 3;
}
function tagReclaimBytes(tag) {
  return tag.byteSize + tag.inputByteSize + tag.reasoningByteSize;
}
function estimateEmergencyDropReclaimTokens(tag) {
  if (tag.reclaimableTokens !== undefined)
    return Number.isFinite(tag.reclaimableTokens) ? Math.max(0, tag.reclaimableTokens) : 0;
  return Math.round(tagReclaimBytes(tag) * TOKENS_PER_BYTE);
}
function planEmergencyDrop(input) {
  const {
    tags,
    floorTags,
    currentTotalInputTokens,
    ceilingTokens,
    priorInputSample,
    hasPriorDrop
  } = input;
  const noop = (reason) => ({
    shouldDrop: false,
    tagNumbers: [],
    reclaimTokens: 0,
    reason
  });
  if (!Number.isFinite(ceilingTokens) || ceilingTokens <= 0) {
    return noop("unknown-ceiling");
  }
  if (!Number.isFinite(currentTotalInputTokens) || currentTotalInputTokens <= 0) {
    return noop("unknown-usage");
  }
  const absoluteEmergency = (input.usagePercentage ?? 0) >= 95;
  if (hasPriorDrop && !absoluteEmergency) {
    return noop(`pressure-episode-latched (prior sample ${priorInputSample}; awaiting exit or independent bust)`);
  }
  let tailTokens = 0;
  let newerTailTokens = 0;
  for (const tag of floorTags) {
    if (tag.status !== "active")
      continue;
    const tokens = tag.servedTokens ?? estimateEmergencyDropReclaimTokens(tag);
    if (tag.sinceReading)
      newerTailTokens += tokens;
    else
      tailTokens += tokens;
  }
  const removedMeasured = Math.max(input.removedThisPassTokens ?? 0, 0);
  const account = (newerInReading) => {
    const measuredTail = newerInReading ? tailTokens + newerTailTokens : tailTokens;
    const removed = Math.min(removedMeasured, Math.max(currentTotalInputTokens - measuredTail, 0));
    const floor = Math.max(currentTotalInputTokens - removed - measuredTail, 0);
    const served = currentTotalInputTokens >= measuredTail ? currentTotalInputTokens - removed + (newerInReading ? 0 : newerTailTokens) : currentTotalInputTokens;
    const target = floor + TARGET_FRACTION * Math.max(ceilingTokens - floor, 0);
    return { removed, floor, served, reclaim: Math.round(served - target) };
  };
  let accounting = account(false);
  let olderAccounting = false;
  if (accounting.floor > ceilingTokens && absoluteEmergency && newerTailTokens > 0) {
    const older = account(true);
    if (older.floor <= ceilingTokens) {
      accounting = older;
      olderAccounting = true;
    }
  }
  const { removed: removedThisPass, floor: fixedFloor, served: servedInputTokens } = accounting;
  const reclaimTokens = accounting.reclaim;
  const servedNote = removedMeasured > 0 || newerTailTokens > 0 ? `, served≈${Math.round(servedInputTokens)} after ≈${Math.round(removedThisPass)} removed this pass${removedThisPass < removedMeasured ? ` (≈${Math.round(removedMeasured)} measured)` : ""}${newerTailTokens > 0 ? `, ≈${Math.round(newerTailTokens)} newer than the reading${olderAccounting ? " (counted in the reading)" : ""}` : ""}` : "";
  if (fixedFloor > ceilingTokens) {
    return noop(`fixed floor ≈${Math.round(fixedFloor)} already exceeds ceiling ${Math.round(ceilingTokens)}: tool drops cannot reach the target${servedNote}`);
  }
  if (reclaimTokens <= EMERGENCY_REARM_MIN_TOKENS) {
    return noop(`reclaim<=min (${reclaimTokens} <= ${EMERGENCY_REARM_MIN_TOKENS}; floor≈${Math.round(fixedFloor)}${servedNote})`);
  }
  const cutoff = input.protectedCutoff;
  const windowYields = absoluteEmergency;
  const tierActive = { 1: [], 2: [] };
  for (const tag of tags) {
    if (tag.status !== "active" || tag.type !== "tool")
      continue;
    const tier = resolveToolTier(tag.toolName);
    if (tier === 1 || tier === 2)
      tierActive[tier].push(tag.tagNumber);
  }
  const reserved = new Set;
  for (const tier of [1, 2]) {
    const nums = tierActive[tier];
    if (nums.length === 0)
      continue;
    nums.sort((a, b) => b - a);
    const reserveCount = absoluteEmergency ? 0 : Math.ceil(TIER_RECENCY_RESERVE * nums.length);
    for (let i = 0;i < reserveCount && i < nums.length; i++) {
      reserved.add(nums[i]);
    }
  }
  const protectedTags = input.protectedToolTags ?? protectedToolTagNumbers(floorTags, input.protectedTools);
  const byTier = { 1: [], 2: [], 3: [] };
  for (const tag of tags) {
    if (tag.status !== "active" || tag.type !== "tool")
      continue;
    if (!windowYields) {
      if (cutoff !== null) {
        if (tag.tagNumber >= cutoff)
          continue;
      }
    }
    if (protectedTags.has(tag.tagNumber))
      continue;
    const tier = resolveToolTier(tag.toolName);
    if ((tier === 1 || tier === 2) && reserved.has(tag.tagNumber))
      continue;
    byTier[tier].push(tag);
  }
  const selected = [];
  let reclaimed = 0;
  outer:
    for (const tier of [3, 2, 1]) {
      const group = byTier[tier];
      group.sort((a, b) => a.tagNumber - b.tagNumber);
      for (const tag of group) {
        selected.push(tag.tagNumber);
        reclaimed += estimateEmergencyDropReclaimTokens(tag);
        if (reclaimed >= reclaimTokens)
          break outer;
      }
    }
  if (selected.length === 0) {
    return noop("no-candidates");
  }
  if (!input.passAlreadyPriced && reclaimed < EMERGENCY_MIN_ACHIEVABLE_RECLAIM_TOKENS) {
    return noop(`achievable reclaim below minimum (${selected.length} tags, reclaim≈${Math.round(reclaimed)} < ${EMERGENCY_MIN_ACHIEVABLE_RECLAIM_TOKENS} against gap ${reclaimTokens})`);
  }
  return {
    shouldDrop: true,
    tagNumbers: selected,
    reclaimTokens,
    reason: `tiered drop: ${selected.length} tags, reclaim≈${reclaimed}/${reclaimTokens} tokens (floor≈${fixedFloor}, ceiling=${Math.round(ceilingTokens)}${servedNote})`
  };
}
function measureEmergencyTag(tag, target, calibration, skeleton) {
  const observation = target?.measureReclaim?.(skeleton);
  if (observation) {
    const before = observation.beforeTools * calibration.toolsRatio + observation.beforeProse * calibration.proseRatio;
    const after = observation.afterTools * calibration.toolsRatio + observation.afterProse * calibration.proseRatio;
    return { ...tag, servedTokens: before, reclaimableTokens: Math.max(0, before - after) };
  }
  const content = target?.getContent?.();
  const served = content ? estimateTokens(content) * (tag.type === "tool" ? calibration.toolsRatio : calibration.proseRatio) : 0;
  return { ...tag, servedTokens: served, reclaimableTokens: 0 };
}
function tagsSinceReading(messages, targets) {
  let boundary = messages.length - 1;
  while (boundary >= 0 && !(messages[boundary]?.info.role === "assistant" && (messages[boundary]?.parts.length ?? 0) > 0))
    boundary -= 1;
  const since = new Set;
  if (boundary < 0)
    return since;
  const newerInfos = new Set(messages.slice(boundary).map((message) => message.info));
  for (const [tagNumber, target] of targets) {
    const parts = target.mutationParts;
    const newer = parts && parts.length > 0 ? parts.some(({ message }) => newerInfos.has(message.info)) : target.message !== undefined && newerInfos.has(target.message.info);
    if (newer)
      since.add(tagNumber);
  }
  return since;
}

// ../plugin/src/features/magic-context/storage-ops.ts
var queuePendingOpStatements = new WeakMap;
var queueUnchangedDropStatements = new WeakMap;
var getPendingOpsStatements = new WeakMap;
var getPendingOpsCountStatements = new WeakMap;
var hasPendingDropOpsStatements = new WeakMap;
var clearPendingOpsStatements = new WeakMap;
var removePendingOpStatements = new WeakMap;
function getQueuePendingOpStatement(db) {
  let stmt = queuePendingOpStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`INSERT INTO pending_ops (session_id, tag_id, operation, queued_at, harness)
             SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (
                 SELECT 1 FROM pending_ops WHERE session_id = ? AND tag_id = ? AND operation = ?
             )`);
    queuePendingOpStatements.set(db, stmt);
  }
  return stmt;
}
function getPendingOpsStatement(db) {
  let stmt = getPendingOpsStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT id, session_id, tag_id, operation, queued_at FROM pending_ops WHERE session_id = ? ORDER BY queued_at ASC, id ASC");
    getPendingOpsStatements.set(db, stmt);
  }
  return stmt;
}
function getClearPendingOpsStatement(db) {
  let stmt = clearPendingOpsStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM pending_ops WHERE session_id = ?");
    clearPendingOpsStatements.set(db, stmt);
  }
  return stmt;
}
function getRemovePendingOpStatement(db) {
  let stmt = removePendingOpStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM pending_ops WHERE session_id = ? AND tag_id = ?");
    removePendingOpStatements.set(db, stmt);
  }
  return stmt;
}
function isPendingOpRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.id === "number" && typeof r.session_id === "string" && typeof r.tag_id === "number" && typeof r.operation === "string" && typeof r.queued_at === "number";
}
function toPendingOp(row) {
  if (row.operation !== "drop") {
    sessionLog2(row.session_id, `unknown pending operation "${row.operation}"; ignoring`);
    return null;
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    tagId: row.tag_id,
    operation: row.operation,
    queuedAt: row.queued_at
  };
}
function queuePendingOp(db, sessionId, tagId, operation, queuedAt = Date.now()) {
  getQueuePendingOpStatement(db).run(sessionId, tagId, operation, queuedAt, getHarness2(), sessionId, tagId, operation);
}
function queuePendingDropForUnchangedTag(db, sessionId, tag) {
  let statement = queueUnchangedDropStatements.get(db);
  if (!statement) {
    statement = db.prepare(`INSERT INTO pending_ops (session_id, tag_id, operation, queued_at, harness)
            SELECT session_id, tag_number, 'drop', ?, ? FROM tags
            WHERE id = ? AND session_id = ? AND tag_number = ? AND message_id = ?
                AND type = ? AND tool_owner_message_id IS ? AND status = 'active'
                AND NOT EXISTS (
                    SELECT 1 FROM pending_ops WHERE session_id = tags.session_id
                        AND tag_id = tags.tag_number AND operation = 'drop'
                )`);
    queueUnchangedDropStatements.set(db, statement);
  }
  return statement.run(Date.now(), getHarness2(), tag.id ?? null, sessionId, tag.tagNumber, tag.messageId, tag.type, tag.toolOwnerMessageId).changes > 0;
}
function getPendingOps(db, sessionId) {
  const rows = getPendingOpsStatement(db).all(sessionId).filter(isPendingOpRow);
  return rows.map(toPendingOp).filter((op) => op !== null);
}
function getPendingOpsCount(db, sessionId) {
  try {
    let statement = getPendingOpsCountStatements.get(db);
    if (!statement) {
      statement = db.prepare("SELECT COUNT(*) AS count FROM pending_ops WHERE session_id = ?");
      getPendingOpsCountStatements.set(db, statement);
    }
    const row = statement.get(sessionId);
    return typeof row?.count === "number" && Number.isFinite(row.count) ? row.count : null;
  } catch {
    return null;
  }
}
function clearPendingOps(db, sessionId) {
  getClearPendingOpsStatement(db).run(sessionId);
}
function removePendingOp(db, sessionId, tagId) {
  getRemovePendingOpStatement(db).run(sessionId, tagId);
}

// ../plugin/src/features/magic-context/storage-tags.ts
var insertTagStatements = new WeakMap;
var updateTagStatusStatements = new WeakMap;
var updateTagDropModeStatements = new WeakMap;
var updateTagMessageIdStatements = new WeakMap;
var getTagNumbersByMessageIdStatements = new WeakMap;
var deleteTagsByMessageIdStatements = new WeakMap;
var getMaxTagNumberBySessionStatements = new WeakMap;
var getTagNumberByMessageIdStatements = new WeakMap;
var getAssignableTagNumberByMessageIdStatements = new WeakMap;
var hasPiFallbackMessageTagStatements = new WeakMap;
var WHITESPACE_ASSISTANT_INERT_MESSAGE_PREFIX = "__mc_whitespace_assistant_inert__:";
var WHITESPACE_ASSISTANT_INERT_FINGERPRINT_PREFIX = "mc:whitespace-assistant:";
function getInsertTagStatement(db) {
  let stmt = insertTagStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("INSERT INTO tags (session_id, message_id, type, byte_size, reasoning_byte_size, tag_number, tool_name, input_byte_size, harness, tool_owner_message_id, entry_fingerprint, token_count, input_token_count, reasoning_token_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    insertTagStatements.set(db, stmt);
  }
  return stmt;
}
function getUpdateTagStatusStatement(db) {
  let stmt = updateTagStatusStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE tags SET status = ? WHERE session_id = ? AND tag_number = ?");
    updateTagStatusStatements.set(db, stmt);
  }
  return stmt;
}
function getUpdateTagDropModeStatement(db) {
  let stmt = updateTagDropModeStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE tags SET drop_mode = ? WHERE session_id = ? AND tag_number = ?");
    updateTagDropModeStatements.set(db, stmt);
  }
  return stmt;
}
var updateTagByteSizeStatements = new WeakMap;
var updateTagInputByteSizeStatements = new WeakMap;
function getUpdateTagByteSizeStatement(db) {
  let stmt = updateTagByteSizeStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE tags SET byte_size = ? WHERE session_id = ? AND tag_number = ?");
    updateTagByteSizeStatements.set(db, stmt);
  }
  return stmt;
}
function getUpdateTagInputByteSizeStatement(db) {
  let stmt = updateTagInputByteSizeStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE tags SET input_byte_size = ? WHERE session_id = ? AND tag_number = ?");
    updateTagInputByteSizeStatements.set(db, stmt);
  }
  return stmt;
}
function updateTagByteSize2(db, sessionId, tagNumber, newByteSize) {
  getUpdateTagByteSizeStatement(db).run(newByteSize, sessionId, tagNumber);
}
var RECENT_OWNER_SCAN_PAGE_SIZE = 128;
var recentTagOwnerStatements = new WeakMap;
function ownerMessageIdForTagRow(row) {
  if (row.type === "tool") {
    return row.tool_owner_message_id ?? row.message_id;
  }
  return contentTagOwnerMessageId(row.message_id);
}
function getRecentTagOwnerStatement(db) {
  let statement = recentTagOwnerStatements.get(db);
  if (!statement) {
    statement = db.prepare(`SELECT type, message_id, tool_owner_message_id
             FROM tags
             WHERE session_id = ?
             ORDER BY tag_number DESC, id DESC
             LIMIT ? OFFSET ?`);
    recentTagOwnerStatements.set(db, statement);
  }
  return statement;
}
function getRecentTagOwnerMessageIds2(db, sessionId, maxOwners) {
  const recent = new Set;
  if (!Number.isFinite(maxOwners) || maxOwners <= 0)
    return recent;
  const statement = getRecentTagOwnerStatement(db);
  let offset = 0;
  while (recent.size < maxOwners) {
    const rows = statement.all(sessionId, RECENT_OWNER_SCAN_PAGE_SIZE, offset);
    for (const row of rows) {
      if (typeof row.type !== "string" || typeof row.message_id !== "string")
        continue;
      const ownerId = row.type === "tool" ? typeof row.tool_owner_message_id === "string" ? row.tool_owner_message_id : null : contentTagOwnerMessageId(row.message_id);
      if (!ownerId || recent.has(ownerId))
        continue;
      recent.add(ownerId);
      if (recent.size >= maxOwners)
        break;
    }
    if (rows.length < RECENT_OWNER_SCAN_PAGE_SIZE)
      break;
    offset += rows.length;
  }
  return recent;
}
function getActiveTagTokenAggregate2(db, sessionId, protectedCutoff = null) {
  const toolOutputExpr = protectedCutoff !== null ? `COALESCE(SUM(CASE WHEN type = 'tool' AND tag_number < ? THEN COALESCE(token_count, 0) ELSE 0 END), 0)` : `COALESCE(SUM(CASE WHEN type = 'tool' THEN COALESCE(token_count, 0) ELSE 0 END), 0)`;
  const sql = `SELECT
                COALESCE(SUM(CASE WHEN type != 'tool' THEN COALESCE(token_count, 0) ELSE 0 END), 0)
                    + COALESCE(SUM(COALESCE(reasoning_token_count, 0)), 0) AS conversation,
                COALESCE(SUM(CASE WHEN type = 'tool' THEN COALESCE(token_count, 0) + COALESCE(input_token_count, 0) ELSE 0 END), 0) AS tool_call,
                ${toolOutputExpr} AS tool_output,
                COALESCE(SUM(CASE WHEN token_count IS NULL THEN 1 ELSE 0 END), 0) AS null_count
             FROM tags
             WHERE session_id = ? AND status = 'active'`;
  const params = protectedCutoff !== null ? [protectedCutoff, sessionId] : [sessionId];
  const row = db.prepare(sql).get(...params);
  return {
    conversation: row?.conversation ?? 0,
    toolCall: row?.tool_call ?? 0,
    toolOutput: row?.tool_output ?? 0,
    nullCount: row?.null_count ?? 0
  };
}
var RECLAIM_HINT_EXCLUDED_TOOLS = new Set([
  "ask",
  "bash_kill",
  "bash_status",
  "board",
  "task",
  "todoread",
  "todowrite",
  "work"
]);
var AGE_RECLAIM_MIN_TOKENS2 = 250;
function isReclaimHintExcludedTool(toolName) {
  if (!toolName)
    return false;
  const normalized = toolName.toLowerCase().replace(/^mcp_/, "");
  return normalized.startsWith("ctx_") || RECLAIM_HINT_EXCLUDED_TOOLS.has(normalized);
}
function getOldestActiveUnprotectedToolTags2(db, sessionId, protectedTagNumbers = new Set, limit = 4) {
  if (limit <= 0)
    return [];
  const boundedLimit = Math.max(1, Math.min(10, Math.floor(limit)));
  const valueFloor = `AND (
            (token_count IS NULL AND input_token_count IS NULL)
            OR (COALESCE(token_count, 0) + COALESCE(input_token_count, 0)) >= ?
        )`;
  const params = [sessionId, AGE_RECLAIM_MIN_TOKENS2];
  const rows = db.prepare(`SELECT tag_number, tool_name
             FROM tags
               WHERE session_id = ? AND status = 'active' AND type = 'tool'
                    AND NOT EXISTS (
                        SELECT 1 FROM pending_ops
                        WHERE pending_ops.session_id = tags.session_id
                          AND pending_ops.tag_id = tags.tag_number
                          AND pending_ops.operation = 'drop'
                    )
                     ${valueFloor}
              ORDER BY tag_number ASC, id ASC`).all(...params);
  return rows.filter((row) => typeof row.tag_number === "number").map((row) => ({
    tagNumber: row.tag_number,
    toolName: typeof row.tool_name === "string" ? row.tool_name : null
  })).filter((tag) => !protectedTagNumbers.has(tag.tagNumber) && !isReclaimHintExcludedTool(tag.toolName)).sort((left, right) => resolveToolTier(right.toolName) - resolveToolTier(left.toolName) || left.tagNumber - right.tagNumber).slice(0, boundedLimit);
}
var getActiveToolTagsForAgeReclaimStatements = new WeakMap;
function getActiveToolTagsForAgeReclaim2(db, sessionId) {
  let stmt = getActiveToolTagsForAgeReclaimStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT tag_number, tool_name, token_count, input_token_count
             FROM tags
             WHERE session_id = ? AND status = 'active' AND type = 'tool'
             ORDER BY tag_number ASC, id ASC`);
    getActiveToolTagsForAgeReclaimStatements.set(db, stmt);
  }
  const rows = stmt.all(sessionId);
  const tags = rows.filter((row) => typeof row.tag_number === "number").map((row) => {
    const outputTokens = typeof row.token_count === "number" ? row.token_count : null;
    const inputTokens = typeof row.input_token_count === "number" ? row.input_token_count : null;
    return {
      tagNumber: row.tag_number,
      toolName: typeof row.tool_name === "string" ? row.tool_name : null,
      reclaimableTokens: outputTokens === null && inputTokens === null ? null : (outputTokens ?? 0) + (inputTokens ?? 0)
    };
  });
  return tags;
}
function getTriggerTagTokenUpperBound2(db, sessionId, floor = 0) {
  const sql = floor > 0 ? `SELECT
                COALESCE(SUM(COALESCE(token_count, 0) + COALESCE(input_token_count, 0) + COALESCE(reasoning_token_count, 0)), 0) AS bound,
                COALESCE(SUM(CASE WHEN token_count IS NULL THEN 1 ELSE 0 END), 0) AS null_count
             FROM tags
             WHERE session_id = ? AND status IN ('active', 'dropped') AND tag_number >= ?` : `SELECT
                COALESCE(SUM(COALESCE(token_count, 0) + COALESCE(input_token_count, 0) + COALESCE(reasoning_token_count, 0)), 0) AS bound,
                COALESCE(SUM(CASE WHEN token_count IS NULL THEN 1 ELSE 0 END), 0) AS null_count
             FROM tags
             WHERE session_id = ? AND status IN ('active', 'dropped')`;
  const row = floor > 0 ? db.prepare(sql).get(sessionId, floor) : db.prepare(sql).get(sessionId);
  return { bound: row?.bound ?? 0, nullCount: row?.null_count ?? 0 };
}
var scopedActiveTokenTotalStatements = new WeakMap;
function getActiveTagTokenTotalsByMessage2(db, sessionId, messageIds) {
  if (messageIds?.length === 0)
    return new Map;
  const fields = "id, tag_number, type, message_id, tool_owner_message_id, token_count, input_token_count, reasoning_token_count".split(", ").map((field) => `tags.${field}`).join(", ");
  let scoped = scopedActiveTokenTotalStatements.get(db);
  if (messageIds && !scoped) {
    scoped = db.prepare(`
            SELECT ${fields} FROM json_each(?) AS owners
            CROSS JOIN tags INDEXED BY idx_tags_session_message_id
            WHERE session_id = ? AND tags.type != 'tool' AND +status = 'active'
              AND message_id >= owners.value || ':' AND message_id < owners.value || ';'
            UNION
            SELECT ${fields} FROM tags INDEXED BY idx_tags_session_message_id
            WHERE session_id = ? AND type != 'tool' AND +status = 'active'
              AND message_id IN (SELECT value FROM json_each(?))
            UNION
            SELECT ${fields} FROM tags INDEXED BY idx_tags_pi_fallback_tool_owner
            WHERE session_id = ? AND type = 'tool' AND +status = 'active'
              AND tool_owner_message_id IN (SELECT value FROM json_each(?))
            UNION
            SELECT ${fields} FROM tags INDEXED BY idx_tags_session_message_id
            WHERE session_id = ? AND type = 'tool' AND +status = 'active'
              AND tool_owner_message_id IS NULL AND message_id IN (SELECT value FROM json_each(?))
            ORDER BY tag_number, id`);
    scopedActiveTokenTotalStatements.set(db, scoped);
  }
  const owners = messageIds ? new Set(messageIds) : undefined;
  const encoded = owners ? JSON.stringify([...owners]) : "";
  const rows = messageIds && scoped ? scoped.all(encoded, sessionId, sessionId, encoded, sessionId, encoded, sessionId, encoded) : db.prepare(`SELECT type, message_id, tool_owner_message_id, token_count, input_token_count, reasoning_token_count
             FROM tags
             WHERE session_id = ? AND status = 'active'`).all(sessionId);
  const out = new Map;
  for (const row of rows) {
    const owner = ownerMessageIdForTagRow(row);
    if (owners && !owners.has(owner))
      continue;
    let entry = out.get(owner);
    if (!entry) {
      entry = { conversation: 0, toolCall: 0, toolOutput: 0, hasNull: false };
      out.set(owner, entry);
    }
    const reasoning = row.reasoning_token_count ?? 0;
    if (row.type === "tool") {
      const output = row.token_count ?? 0;
      entry.toolCall += output + (row.input_token_count ?? 0);
      entry.toolOutput += output;
    } else {
      entry.conversation += row.token_count ?? 0;
    }
    entry.conversation += reasoning;
    if (row.token_count === null)
      entry.hasNull = true;
  }
  return out;
}
function updateTagInputByteSize2(db, sessionId, tagNumber, newInputByteSize) {
  getUpdateTagInputByteSizeStatement(db).run(newInputByteSize, sessionId, tagNumber);
}
var updateTagTokenCountStatements = new WeakMap;
var setTagTokenCountStatements = new WeakMap;
var updateTagInputTokenCountStatements = new WeakMap;
function getSetTagTokenCountStatement(db) {
  let stmt = setTagTokenCountStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE tags SET token_count = ? WHERE session_id = ? AND tag_number = ?");
    setTagTokenCountStatements.set(db, stmt);
  }
  return stmt;
}
function getUpdateTagTokenCountStatement(db) {
  let stmt = updateTagTokenCountStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE tags SET token_count = MAX(COALESCE(token_count, 0), ?) WHERE session_id = ? AND tag_number = ?");
    updateTagTokenCountStatements.set(db, stmt);
  }
  return stmt;
}
function getUpdateTagInputTokenCountStatement(db) {
  let stmt = updateTagInputTokenCountStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("UPDATE tags SET input_token_count = ? WHERE session_id = ? AND tag_number = ?");
    updateTagInputTokenCountStatements.set(db, stmt);
  }
  return stmt;
}
function updateTagTokenCount2(db, sessionId, tagNumber, newTokenCount) {
  getUpdateTagTokenCountStatement(db).run(newTokenCount, sessionId, tagNumber);
}
function setTagTokenCount2(db, sessionId, tagNumber, tokenCount) {
  getSetTagTokenCountStatement(db).run(tokenCount, sessionId, tagNumber);
}
function getPersistedToolTagAccounting2(db, sessionId, tagNumber) {
  const row = db.prepare(`SELECT byte_size AS byteSize,
                    token_count AS tokenCount,
                    input_byte_size AS inputByteSize,
                    input_token_count AS inputTokenCount
             FROM tags
             WHERE session_id = ? AND tag_number = ? AND type = 'tool'`).get(sessionId, tagNumber);
  if (!row || typeof row.byteSize !== "number" || row.tokenCount !== null && typeof row.tokenCount !== "number" || typeof row.inputByteSize !== "number" || row.inputTokenCount !== null && typeof row.inputTokenCount !== "number") {
    return null;
  }
  return row;
}
function getAllStatusTagTokenTotalsFlat2(db, sessionId, floor = 0, calibration = { proseRatio: 1, toolsRatio: 1 }, ownerMessageIds) {
  const columns = "type, message_id, tool_owner_message_id, token_count, input_token_count, reasoning_token_count";
  const owners = ownerMessageIds ? new Set(ownerMessageIds) : undefined;
  let scanOrder = "id";
  if (owners) {
    const planStatement = db.prepare(`EXPLAIN QUERY PLAN SELECT ${columns} FROM tags WHERE session_id = ?${floor > 0 ? " AND tag_number >= ?" : ""}`);
    let plan;
    try {
      plan = planStatement.all(sessionId, ...floor > 0 ? [floor] : []);
    } finally {
      planStatement.finalize?.();
    }
    const index = plan.map((row) => /USING (?:COVERING )?INDEX (\S+)/.exec(row.detail)?.[1]).find(Boolean);
    if (index) {
      const keyStatement = db.prepare("SELECT name, coll, desc FROM pragma_index_xinfo(?) WHERE key = 1 ORDER BY seqno");
      let keys;
      try {
        keys = keyStatement.all(index);
      } finally {
        keyStatement.finalize?.();
      }
      scanOrder = [
        ...keys.map((key) => `"${(key.name ?? "id").replaceAll('"', '""')}" COLLATE "${key.coll.replaceAll('"', '""')}"${key.desc ? " DESC" : ""}`),
        "id"
      ].join(", ");
    }
  }
  const rows = owners ? db.prepare(`SELECT ${columns} FROM tags WHERE id IN (
                SELECT t.id FROM json_each(?) o CROSS JOIN tags t INDEXED BY idx_tags_session_message_id
                ON t.session_id = ? AND t.message_id >= o.value AND t.message_id < o.value || ';'
                UNION
                SELECT t.id FROM json_each(?) o CROSS JOIN tags t INDEXED BY idx_tags_pi_fallback_tool_owner
                ON t.session_id = ? AND t.tool_owner_message_id = o.value
                WHERE t.type = 'tool'
              ) AND tag_number >= ? ORDER BY ${scanOrder}`).all(JSON.stringify([...owners]), sessionId, JSON.stringify([...owners]), sessionId, floor) : floor > 0 ? db.prepare(`SELECT type, message_id, tool_owner_message_id, token_count, input_token_count, reasoning_token_count
                       FROM tags
                       WHERE session_id = ? AND tag_number >= ?`).all(sessionId, floor) : db.prepare(`SELECT type, message_id, tool_owner_message_id, token_count, input_token_count, reasoning_token_count
                       FROM tags
                       WHERE session_id = ?`).all(sessionId);
  const totals = new Map;
  const summaryRemovedTotals = new Map;
  const nullMessageIds = new Set;
  const nullSummaryRemovedMessageIds = new Set;
  for (const row of rows) {
    if (row.type === "tool" && row.tool_owner_message_id === null)
      continue;
    const owner = ownerMessageIdForTagRow(row);
    if (owners && !owners.has(owner))
      continue;
    if (row.token_count === null) {
      nullMessageIds.add(owner);
      totals.delete(owner);
      summaryRemovedTotals.delete(owner);
      continue;
    }
    if (nullMessageIds.has(owner))
      continue;
    const ratio = row.type === "tool" ? calibration.toolsRatio : calibration.proseRatio;
    const weight = ((row.token_count ?? 0) + (row.input_token_count ?? 0)) * ratio + (row.reasoning_token_count ?? 0) * calibration.proseRatio;
    totals.set(owner, (totals.get(owner) ?? 0) + weight);
    if (row.type === "tool" && row.input_token_count === null) {
      nullSummaryRemovedMessageIds.add(owner);
      summaryRemovedTotals.delete(owner);
    }
    if (!nullSummaryRemovedMessageIds.has(owner)) {
      const removedWeight = row.type === "tool" ? (row.input_token_count ?? 0) * calibration.toolsRatio : row.type === "message" ? row.token_count * calibration.proseRatio : 0;
      summaryRemovedTotals.set(owner, (summaryRemovedTotals.get(owner) ?? 0) + removedWeight);
    }
  }
  return { totals, summaryRemovedTotals, nullMessageIds };
}
function getReasoningTokenEstimatesByMessage2(db, sessionId, proseRatio) {
  const summary = readTagOwnerSummary(db, sessionId, proseRatio);
  return summary.reasoningEstimatesByRatio.get(proseRatio) ?? new Map;
}
function tryGetReasoningTokenEstimatesByMessage2(db, sessionId, ratio) {
  try {
    return getReasoningTokenEstimatesByMessage2(db, sessionId, ratio);
  } catch (error) {
    if (error instanceof TagOwnerSummaryNotReady)
      return;
    throw error;
  }
}
function getMaxTagNumberByOwnerMessage2(db, sessionId) {
  return readTagOwnerSummary(db, sessionId).maxTagByOwner;
}
var tagOwnerSummaries = new WeakMap;
var MAX_CACHED_PROSE_RATIOS = 4;
var TAG_OWNER_PAGE_LIMIT = 512;

class TagOwnerSummaryNotReady extends Error {
  constructor() {
    super("tag owner summary needs off-thread preparation");
  }
}
function scanTagOwnerSummary2(db, sessionId, ratio, ratios = []) {
  db.exec("BEGIN");
  try {
    return readTagOwnerSummary(db, sessionId, ratio, ratios);
  } finally {
    db.exec("ROLLBACK");
  }
}
function scanTagOwnerDelta2(db, sessionId, state) {
  db.exec("BEGIN");
  try {
    const globalLastRowId = db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM tags").get().id;
    if (globalLastRowId - state.globalLastRowId > TAG_OWNER_PAGE_LIMIT)
      return null;
    const rows = appendedSinceForeignCommit(db, sessionId, state);
    if (!rows)
      return null;
    return { rows, adopted: adoptedSinceForeignCommit(db, state), globalLastRowId };
  } finally {
    db.exec("ROLLBACK");
  }
}
var tagOwnerRowsRead = 0;
var tagOwnerShapeChecks = 0;
function foldTagOwnerRow(summary, row, newRow = true) {
  summary.lastRowId = Math.max(summary.lastRowId, row.id);
  if (newRow)
    summary.rowCount += 1;
  if (row.type === "tool" && typeof row.tool_owner_message_id !== "string")
    summary.unownedToolRows.add(row.id);
  else
    summary.unownedToolRows.delete(row.id);
  const owner = row.type === "tool" ? typeof row.tool_owner_message_id === "string" ? row.tool_owner_message_id : null : typeof row.message_id === "string" ? contentTagOwnerMessageId(row.message_id) : null;
  if (owner) {
    summary.maxTagByOwner.set(owner, Math.max(summary.maxTagByOwner.get(owner) ?? 0, row.tag_number));
  }
  if (row.type !== "message" || row.reasoning_token_count === null)
    return;
  const reasoningOwner = ownerMessageIdForTagRow({
    type: row.type,
    message_id: row.message_id,
    tool_owner_message_id: row.tool_owner_message_id
  });
  for (const [ratio, estimates] of summary.reasoningEstimatesByRatio) {
    estimates.set(reasoningOwner, Math.max(estimates.get(reasoningOwner) ?? 0, row.reasoning_token_count * ratio));
  }
}
var TAG_OWNER_COLUMNS = "id, type, message_id, tool_owner_message_id, tag_number, reasoning_token_count";
function connectionInTransaction(db) {
  try {
    const state = db;
    return state.inTransaction !== false && state.isTransaction !== false;
  } catch {
    return true;
  }
}
var TAG_OWNER_APPENDED_WITH_SHAPE_SQL = `SELECT ${TAG_OWNER_COLUMNS}, 0 AS shape, NULL AS tag_count, NULL AS max_id, NULL AS revision
    FROM tags WHERE id > ? AND +session_id = ?
    UNION ALL
    SELECT NULL, NULL, NULL, NULL, NULL, NULL, 1, COUNT(*), MAX(id), (SELECT value FROM schema_migrations_meta WHERE key = ?)
    FROM tags WHERE session_id = ?`;
function readTagIdentityRevision(db, sessionId) {
  const row = db.prepare("SELECT value FROM schema_migrations_meta WHERE key = ?").get(tagIdentityRevisionKey(sessionId));
  return typeof row?.value === "string" ? row.value : null;
}
function captureInitialTagOwnerRevision(db, sessionId, cached, appendedRows) {
  if (cached.identityRevision !== null || appendedRows === 0)
    return true;
  const revision = readTagIdentityRevision(db, sessionId);
  if (revision !== null && !/^[1-9]\d*:0$/.test(revision))
    return false;
  cached.identityRevision = revision;
  return true;
}
function appendedSinceForeignCommit(db, sessionId, cached) {
  tagOwnerShapeChecks += 1;
  const rows = db.prepare(TAG_OWNER_APPENDED_WITH_SHAPE_SQL).all(cached.globalLastRowId, sessionId, tagIdentityRevisionKey(sessionId), sessionId);
  const shape = rows.find((row) => row.shape === 1);
  const appended = rows.filter((row) => row.shape === 0);
  const highest = appended.reduce((max, row) => Math.max(max, row.id), cached.lastRowId);
  if (!shape || (shape.revision ?? null) !== cached.identityRevision || shape.tag_count !== cached.rowCount + appended.length || (shape.max_id ?? 0) !== highest)
    return null;
  return appended;
}
function adoptedSinceForeignCommit(db, cached) {
  if (cached.unownedToolRows.size === 0)
    return [];
  return db.prepare(`SELECT ${TAG_OWNER_COLUMNS} FROM tags
             WHERE id IN (SELECT value FROM json_each(?)) AND tool_owner_message_id IS NOT NULL LIMIT ${TAG_OWNER_PAGE_LIMIT + 1}`).all(JSON.stringify([...cached.unownedToolRows]));
}
function readTagOwnerSummary(db, sessionId, proseRatio, extraRatios = []) {
  const inTransaction = connectionInTransaction(db);
  const versions = inTransaction ? null : db.prepare("SELECT data_version AS dataVersion, (SELECT schema_version FROM pragma_schema_version) AS schemaVersion FROM pragma_data_version").get();
  const dataVersion = versions?.dataVersion ?? -1;
  const schemaVersion = versions?.schemaVersion ?? -1;
  const generation = getTagIdentityWriteGeneration2();
  const offThreadOnly = isMainThread && Boolean(getSqliteDatabasePath2(db));
  const sessions = tagOwnerSummaries.get(db) ?? new Map;
  const cached = inTransaction ? undefined : sessions.get(sessionId);
  if (cached && (cached.generation === generation || cached.identityRevision === readTagIdentityRevision(db, sessionId)) && cached.schemaVersion === schemaVersion && (proseRatio === undefined || cached.reasoningEstimatesByRatio.has(proseRatio))) {
    let rows;
    let globalLastRowId = db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM tags").get().id;
    if (offThreadOnly && (globalLastRowId - cached.globalLastRowId > TAG_OWNER_PAGE_LIMIT || cached.dataVersion !== dataVersion && cached.unownedToolRows.size > TAG_OWNER_PAGE_LIMIT))
      throw new TagOwnerSummaryNotReady;
    if (cached.dataVersion === dataVersion && cached.generation === generation) {
      const statement = db.prepare(`SELECT ${TAG_OWNER_COLUMNS} FROM tags WHERE id > ? AND +session_id = ? ORDER BY id LIMIT ${TAG_OWNER_PAGE_LIMIT + 1}`);
      rows = statement.all(cached.globalLastRowId, sessionId);
      if (!offThreadOnly) {
        let page = rows;
        while (page.length === TAG_OWNER_PAGE_LIMIT + 1) {
          page = statement.all(page[page.length - 1].id, sessionId);
          rows.push(...page);
        }
      }
      if (!captureInitialTagOwnerRevision(db, sessionId, cached, rows.length)) {
        if (offThreadOnly)
          throw new TagOwnerSummaryNotReady;
        rows = null;
      }
    } else {
      if (offThreadOnly)
        db.exec("BEGIN");
      try {
        globalLastRowId = db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM tags").get().id;
        if (offThreadOnly && globalLastRowId - cached.globalLastRowId > TAG_OWNER_PAGE_LIMIT)
          throw new TagOwnerSummaryNotReady;
        rows = appendedSinceForeignCommit(db, sessionId, cached);
        const adopted = rows ? adoptedSinceForeignCommit(db, cached) : [];
        if (!rows || rows.length > TAG_OWNER_PAGE_LIMIT || adopted.length > TAG_OWNER_PAGE_LIMIT) {
          if (offThreadOnly)
            throw new TagOwnerSummaryNotReady;
        } else if (offThreadOnly) {
          tagOwnerRowsRead += rows.length + adopted.length;
          for (const row of rows)
            foldTagOwnerRow(cached, row);
          for (const row of adopted)
            foldTagOwnerRow(cached, row, false);
          cached.dataVersion = dataVersion;
          cached.generation = generation;
          cached.globalLastRowId = globalLastRowId;
          return cached;
        }
      } finally {
        if (offThreadOnly)
          db.exec("ROLLBACK");
      }
    }
    if (rows) {
      const adopted = cached.dataVersion === dataVersion ? [] : adoptedSinceForeignCommit(db, cached);
      if (isMainThread && getSqliteDatabasePath2(db) && (rows.length > TAG_OWNER_PAGE_LIMIT || adopted.length > TAG_OWNER_PAGE_LIMIT))
        throw new TagOwnerSummaryNotReady;
      tagOwnerRowsRead += rows.length + adopted.length;
      for (const row of rows)
        foldTagOwnerRow(cached, row);
      for (const row of adopted)
        foldTagOwnerRow(cached, row, false);
      cached.dataVersion = dataVersion;
      cached.generation = generation;
      cached.globalLastRowId = globalLastRowId;
      return cached;
    }
  }
  if (isMainThread && getSqliteDatabasePath2(db))
    throw new TagOwnerSummaryNotReady;
  const ratios = [
    ...new Set([...cached?.reasoningEstimatesByRatio.keys() ?? [], ...extraRatios])
  ];
  if (proseRatio !== undefined && !ratios.includes(proseRatio))
    ratios.push(proseRatio);
  const summary = {
    dataVersion,
    schemaVersion,
    generation,
    lastRowId: 0,
    globalLastRowId: db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM tags").get().id,
    rowCount: 0,
    unownedToolRows: new Set,
    identityRevision: readTagIdentityRevision(db, sessionId),
    maxTagByOwner: new Map,
    reasoningEstimatesByRatio: new Map(ratios.slice(-MAX_CACHED_PROSE_RATIOS).map((ratio) => [ratio, new Map]))
  };
  const rows = db.prepare(`SELECT ${TAG_OWNER_COLUMNS} FROM tags WHERE session_id = ? ORDER BY id`).all(sessionId);
  tagOwnerRowsRead += rows.length;
  for (const row of rows)
    foldTagOwnerRow(summary, row);
  if (!inTransaction) {
    sessions.set(sessionId, summary);
    tagOwnerSummaries.set(db, sessions);
  }
  return summary;
}
function updateTagInputTokenCount2(db, sessionId, tagNumber, newInputTokenCount) {
  getUpdateTagInputTokenCountStatement(db).run(newInputTokenCount, sessionId, tagNumber);
}
function tagTokenCountIsNull2(db, sessionId, tagNumber) {
  const row = db.prepare("SELECT token_count FROM tags WHERE session_id = ? AND tag_number = ?").get(sessionId, tagNumber);
  return row != null && row.token_count === null;
}
function backfillTagTokenCounts2(db, sessionId, tagNumber, counts) {
  db.prepare(`UPDATE tags
            SET token_count = CASE WHEN ? IS NOT NULL THEN MAX(COALESCE(token_count, 0), ?) ELSE token_count END,
                input_token_count = ?,
                reasoning_token_count = ?
            WHERE session_id = ? AND tag_number = ? AND token_count IS NULL`).run(counts.tokenCount ?? null, counts.tokenCount ?? null, counts.inputTokenCount ?? null, counts.reasoningTokenCount ?? null, sessionId, tagNumber);
}
function getUpdateTagMessageIdStatement(db) {
  let stmt = updateTagMessageIdStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`UPDATE tags SET message_id = ?
             WHERE session_id = ?
               AND tag_number = ?
               AND message_id NOT LIKE '${WHITESPACE_ASSISTANT_INERT_MESSAGE_PREFIX}%'`);
    updateTagMessageIdStatements.set(db, stmt);
  }
  return stmt;
}
function getTagNumbersByMessageIdStatement(db) {
  let stmt = getTagNumbersByMessageIdStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT tag_number FROM tags WHERE session_id = ? AND (message_id = ? OR message_id LIKE ? ESCAPE '\\' OR message_id LIKE ? ESCAPE '\\' OR message_id LIKE ? ESCAPE '\\') ORDER BY tag_number ASC");
    getTagNumbersByMessageIdStatements.set(db, stmt);
  }
  return stmt;
}
function getDeleteTagsByMessageIdStatement(db) {
  let stmt = deleteTagsByMessageIdStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("DELETE FROM tags WHERE session_id = ? AND (message_id = ? OR message_id LIKE ? ESCAPE '\\' OR message_id LIKE ? ESCAPE '\\' OR message_id LIKE ? ESCAPE '\\')");
    deleteTagsByMessageIdStatements.set(db, stmt);
  }
  return stmt;
}
function getMaxTagNumberBySessionStatement(db) {
  let stmt = getMaxTagNumberBySessionStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT COALESCE(MAX(tag_number), 0) AS max_tag_number FROM tags WHERE session_id = ?");
    getMaxTagNumberBySessionStatements.set(db, stmt);
  }
  return stmt;
}
function getTagNumberByMessageIdStatement(db) {
  let stmt = getTagNumberByMessageIdStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT tag_number FROM tags INDEXED BY idx_tags_session_message_id WHERE session_id = ? AND message_id = ? ORDER BY tag_number ASC LIMIT 1");
    getTagNumberByMessageIdStatements.set(db, stmt);
  }
  return stmt;
}
function getAssignableTagNumberByMessageIdStatement(db) {
  let stmt = getAssignableTagNumberByMessageIdStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT tag_number FROM tags INDEXED BY idx_tags_session_message_id
             WHERE session_id = ?
               AND message_id = ?
               AND NOT (
                   status = 'compacted'
                   AND COALESCE(
                       entry_fingerprint LIKE '${WHITESPACE_ASSISTANT_INERT_FINGERPRINT_PREFIX}%',
                       0
                   ) = 1
               )
             ORDER BY tag_number ASC
             LIMIT 1`);
    getAssignableTagNumberByMessageIdStatements.set(db, stmt);
  }
  return stmt;
}
function isTagRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.id === "number" && typeof r.message_id === "string" && typeof r.type === "string" && typeof r.status === "string" && typeof r.byte_size === "number" && typeof r.session_id === "string" && typeof r.tag_number === "number";
}
function toTagEntry(row) {
  const type = row.type === "tool" ? "tool" : row.type === "file" ? "file" : "message";
  const status = row.status === "dropped" || row.status === "compacted" ? row.status : "active";
  return {
    id: row.id,
    tagNumber: row.tag_number,
    messageId: row.message_id,
    type,
    status,
    dropMode: row.drop_mode === "truncated" ? "truncated" : row.drop_mode === "skeleton_real" ? "skeleton_real" : row.drop_mode === "skeleton_stripped" ? "skeleton_stripped" : row.drop_mode === "edit_marker" ? "edit_marker" : row.drop_mode === "edit_marker_stripped" ? "edit_marker_stripped" : "full",
    toolName: row.tool_name ?? null,
    inputByteSize: row.input_byte_size ?? 0,
    byteSize: row.byte_size,
    reasoningByteSize: row.reasoning_byte_size ?? 0,
    sessionId: row.session_id,
    cavemanDepth: typeof row.caveman_depth === "number" && Number.isFinite(row.caveman_depth) ? row.caveman_depth : 0,
    toolOwnerMessageId: typeof row.tool_owner_message_id === "string" ? row.tool_owner_message_id : null,
    tokenCount: typeof row.token_count === "number" ? row.token_count : null
  };
}
function normalizeTagSnapshotRow2(row) {
  return isTagRow(row) ? toTagEntry(row) : null;
}
function isTagNumberRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.tag_number === "number";
}
function isMaxTagNumberRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.max_tag_number === "number";
}
function escapeLikePattern(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
function insertTag2(db, sessionId, messageId, type, byteSize, tagNumber, reasoningByteSize = 0, toolName = null, inputByteSize = 0, toolOwnerMessageId = null, entryFingerprint = null, tokenCounts = null) {
  getInsertTagStatement(db).run(sessionId, messageId, type, byteSize, reasoningByteSize, tagNumber, toolName, inputByteSize, getHarness2(), toolOwnerMessageId, entryFingerprint, tokenCounts?.tokenCount ?? null, tokenCounts?.inputTokenCount ?? null, tokenCounts?.reasoningTokenCount ?? null);
  return tagNumber;
}
function updateTagStatus2(db, sessionId, tagId, status) {
  getUpdateTagStatusStatement(db).run(status, sessionId, tagId);
}
var droppedTagStatements = new WeakMap;
function markTagDropped2(db, sessionId, tagId, mode) {
  if (!mode) {
    updateTagStatus2(db, sessionId, tagId, "dropped");
    return;
  }
  let statement = droppedTagStatements.get(db);
  if (!statement) {
    statement = db.prepare("UPDATE tags SET status = ?, drop_mode = ? WHERE session_id = ? AND tag_number = ?");
    droppedTagStatements.set(db, statement);
  }
  statement.run("dropped", mode, sessionId, tagId);
}
var inertWhitespaceStatements = new WeakMap;
var inertWhitespaceByNumberStatements = new WeakMap;
function getInertWhitespaceAssistantTagsByNumbers2(db, sessionId, tagNumbers) {
  if (tagNumbers.length === 0)
    return [];
  let statement = inertWhitespaceByNumberStatements.get(db);
  if (!statement) {
    statement = db.prepare(`SELECT tags.tag_number AS tagNumber, tags.entry_fingerprint AS entryFingerprint
             FROM json_each(?) AS wanted CROSS JOIN tags
             WHERE tags.session_id = ?
               AND tags.tag_number = wanted.value
               AND tags.type = 'message'
               AND tags.status = 'compacted'
               AND tags.entry_fingerprint LIKE ?
             ORDER BY tags.tag_number, tags.id`);
    inertWhitespaceByNumberStatements.set(db, statement);
  }
  const rows = statement.all(JSON.stringify([...new Set(tagNumbers)]), sessionId, `${WHITESPACE_ASSISTANT_INERT_FINGERPRINT_PREFIX}%`);
  return rows.flatMap((row) => {
    const contentId = row.entryFingerprint.slice(WHITESPACE_ASSISTANT_INERT_FINGERPRINT_PREFIX.length);
    return contentId.length > 0 ? [{ tagNumber: row.tagNumber, contentId }] : [];
  });
}
function updateTagDropMode2(db, sessionId, tagNumber, dropMode) {
  getUpdateTagDropModeStatement(db).run(dropMode, sessionId, tagNumber);
}
function updateCavemanDepth2(db, sessionId, tagNumber, depth) {
  db.prepare("UPDATE tags SET caveman_depth = ? WHERE session_id = ? AND tag_number = ?").run(depth, sessionId, tagNumber);
}
function updateTagMessageId2(db, sessionId, tagId, messageId) {
  getUpdateTagMessageIdStatement(db).run(messageId, sessionId, tagId);
}
function hasPiFallbackMessageTags2(db, sessionId) {
  let statement = hasPiFallbackMessageTagStatements.get(db);
  if (!statement) {
    statement = db.prepare(`SELECT 1
             FROM tags
             WHERE session_id = ?
               AND type = 'message'
               AND message_id LIKE 'pi-msg-%'
             LIMIT 1`);
    hasPiFallbackMessageTagStatements.set(db, statement);
  }
  return statement.get(sessionId) != null;
}
function findAdoptableFallbackTags2(db, sessionId, entryFingerprint) {
  const rows = db.prepare(`SELECT tag_number AS tagNumber, message_id AS messageId
             FROM tags
             WHERE session_id = ?
               AND type = 'message'
               AND entry_fingerprint = ?
               AND message_id LIKE 'pi-msg-%'`).all(sessionId, entryFingerprint);
  return rows;
}
function adoptFallbackTagMessageId2(db, sessionId, tagNumber, oldFallbackMessageId, newRealMessageId) {
  if (oldFallbackMessageId.startsWith(WHITESPACE_ASSISTANT_INERT_MESSAGE_PREFIX))
    return false;
  const result = db.prepare(`UPDATE tags SET message_id = ?
             WHERE session_id = ? AND tag_number = ? AND message_id = ?`).run(newRealMessageId, sessionId, tagNumber, oldFallbackMessageId);
  return (result.changes ?? 0) > 0;
}
function isPiFallbackToolOwnerTag(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.tagNumber === "number" && typeof r.callId === "string" && typeof r.toolOwnerMessageId === "string" && typeof r.status === "string";
}
function isPiFallbackFoldTagRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.tagNumber === "number" && typeof r.messageId === "string" && (typeof r.toolOwnerMessageId === "string" || r.toolOwnerMessageId === null) && typeof r.type === "string" && typeof r.status === "string" && (typeof r.byteSize === "number" || r.byteSize === null) && (typeof r.reasoningByteSize === "number" || r.reasoningByteSize === null) && (typeof r.inputByteSize === "number" || r.inputByteSize === null) && (typeof r.tokenCount === "number" || r.tokenCount === null) && (typeof r.inputTokenCount === "number" || r.inputTokenCount === null) && (typeof r.reasoningTokenCount === "number" || r.reasoningTokenCount === null);
}
function isPendingOpIdentityRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.id === "number" && typeof r.operation === "string";
}
function maxNullableNumber(a, b) {
  if (typeof a === "number" && typeof b === "number")
    return Math.max(a, b);
  if (typeof a === "number")
    return a;
  if (typeof b === "number")
    return b;
  return null;
}
function getPiFallbackFoldTagRowByNumber(db, sessionId, tagNumber) {
  const row = db.prepare(`SELECT tag_number AS tagNumber,
                    message_id AS messageId,
                    tool_owner_message_id AS toolOwnerMessageId,
                    type,
                    status,
                    byte_size AS byteSize,
                    reasoning_byte_size AS reasoningByteSize,
                    input_byte_size AS inputByteSize,
                    token_count AS tokenCount,
                    input_token_count AS inputTokenCount,
                    reasoning_token_count AS reasoningTokenCount
             FROM tags
             WHERE session_id = ? AND tag_number = ?`).get(sessionId, tagNumber);
  return isPiFallbackFoldTagRow(row) ? row : null;
}
function getPiFallbackToolFoldTagRowByOwner(db, sessionId, callId, ownerMsgId) {
  const row = db.prepare(`SELECT tag_number AS tagNumber,
                    message_id AS messageId,
                    tool_owner_message_id AS toolOwnerMessageId,
                    type,
                    status,
                    byte_size AS byteSize,
                    reasoning_byte_size AS reasoningByteSize,
                    input_byte_size AS inputByteSize,
                    token_count AS tokenCount,
                    input_token_count AS inputTokenCount,
                    reasoning_token_count AS reasoningTokenCount
             FROM tags
             WHERE session_id = ?
               AND message_id = ?
               AND type = 'tool'
               AND tool_owner_message_id = ?
             LIMIT 1`).get(sessionId, callId, ownerMsgId);
  return isPiFallbackFoldTagRow(row) ? row : null;
}
function getPiFallbackMessageFoldTagRowsByMessageId(db, sessionId, messageId) {
  return db.prepare(`SELECT tag_number AS tagNumber,
                    message_id AS messageId,
                    tool_owner_message_id AS toolOwnerMessageId,
                    type,
                    status,
                    byte_size AS byteSize,
                    reasoning_byte_size AS reasoningByteSize,
                    input_byte_size AS inputByteSize,
                    token_count AS tokenCount,
                    input_token_count AS inputTokenCount,
                    reasoning_token_count AS reasoningTokenCount
             FROM tags
             WHERE session_id = ?
               AND message_id = ?
               AND type = 'message'
             ORDER BY tag_number ASC`).all(sessionId, messageId).filter(isPiFallbackFoldTagRow);
}
var foldStatements = new WeakMap;
function foldStatement(db, sql) {
  let statements = foldStatements.get(db);
  if (!statements) {
    statements = new Map;
    foldStatements.set(db, statements);
  }
  let statement = statements.get(sql);
  if (!statement) {
    statement = db.prepare(sql);
    statements.set(sql, statement);
  }
  return statement;
}
function mergeSizeAndTokenColumnsIntoSurvivor(db, sessionId, survivor, duplicate) {
  foldStatement(db, `UPDATE tags
         SET byte_size = ?,
             reasoning_byte_size = ?,
             input_byte_size = ?,
             token_count = ?,
             input_token_count = ?,
             reasoning_token_count = ?
         WHERE session_id = ? AND tag_number = ?`).run(maxNullableNumber(survivor.byteSize, duplicate.byteSize), maxNullableNumber(survivor.reasoningByteSize, duplicate.reasoningByteSize), maxNullableNumber(survivor.inputByteSize, duplicate.inputByteSize), maxNullableNumber(survivor.tokenCount, duplicate.tokenCount), maxNullableNumber(survivor.inputTokenCount, duplicate.inputTokenCount), maxNullableNumber(survivor.reasoningTokenCount, duplicate.reasoningTokenCount), sessionId, survivor.tagNumber);
  survivor.byteSize = maxNullableNumber(survivor.byteSize, duplicate.byteSize);
  survivor.reasoningByteSize = maxNullableNumber(survivor.reasoningByteSize, duplicate.reasoningByteSize);
  survivor.inputByteSize = maxNullableNumber(survivor.inputByteSize, duplicate.inputByteSize);
  survivor.tokenCount = maxNullableNumber(survivor.tokenCount, duplicate.tokenCount);
  survivor.inputTokenCount = maxNullableNumber(survivor.inputTokenCount, duplicate.inputTokenCount);
  survivor.reasoningTokenCount = maxNullableNumber(survivor.reasoningTokenCount, duplicate.reasoningTokenCount);
}
function applyDroppedStatusIfNeeded(db, sessionId, survivor, duplicate) {
  if (survivor.status === "dropped")
    return;
  if (duplicate.status !== "dropped")
    return;
  foldStatement(db, "UPDATE tags SET status = 'dropped' WHERE session_id = ? AND tag_number = ?").run(sessionId, survivor.tagNumber);
  survivor.status = "dropped";
}
function retargetPendingOps(db, sessionId, fromTagNumber, toTagNumber) {
  const rows = foldStatement(db, `SELECT id, operation
         FROM pending_ops
         WHERE session_id = ? AND tag_id = ?
         ORDER BY id ASC`).all(sessionId, fromTagNumber).filter(isPendingOpIdentityRow);
  for (const row of rows) {
    const existing = foldStatement(db, `SELECT 1
             FROM pending_ops
             WHERE session_id = ? AND tag_id = ? AND operation = ?
             LIMIT 1`).get(sessionId, toTagNumber, row.operation);
    if (existing) {
      foldStatement(db, "DELETE FROM pending_ops WHERE session_id = ? AND id = ?").run(sessionId, row.id);
    } else {
      foldStatement(db, "UPDATE pending_ops SET tag_id = ? WHERE session_id = ? AND id = ?").run(toTagNumber, sessionId, row.id);
    }
  }
  foldStatement(db, "DELETE FROM pending_ops WHERE session_id = ? AND tag_id = ?").run(sessionId, fromTagNumber);
}
function deleteFoldedDuplicateTag(db, sessionId, tagNumber) {
  foldStatement(db, "DELETE FROM source_contents WHERE session_id = ? AND tag_id = ?").run(sessionId, tagNumber);
  foldStatement(db, "DELETE FROM tags WHERE session_id = ? AND tag_number = ?").run(sessionId, tagNumber);
  foldStatement(db, "DELETE FROM pending_ops WHERE session_id = ? AND tag_id = ?").run(sessionId, tagNumber);
}
function foldDuplicateIntoSurvivor(db, sessionId, survivor, duplicate, duplicateMayHaveQueuedOps = true, propagateDroppedStatus = true) {
  mergeSizeAndTokenColumnsIntoSurvivor(db, sessionId, survivor, duplicate);
  if (propagateDroppedStatus)
    applyDroppedStatusIfNeeded(db, sessionId, survivor, duplicate);
  if (duplicateMayHaveQueuedOps) {
    retargetPendingOps(db, sessionId, duplicate.tagNumber, survivor.tagNumber);
  }
  deleteFoldedDuplicateTag(db, sessionId, duplicate.tagNumber);
}
function readPartTagRowsByMessage(db, sessionId) {
  const rows = db.prepare(`SELECT tag_number AS tagNumber,
                    message_id AS messageId,
                    tool_owner_message_id AS toolOwnerMessageId,
                    type,
                    status,
                    byte_size AS byteSize,
                    reasoning_byte_size AS reasoningByteSize,
                    input_byte_size AS inputByteSize,
                    token_count AS tokenCount,
                    input_token_count AS inputTokenCount,
                    reasoning_token_count AS reasoningTokenCount
             FROM tags
             WHERE session_id = ?
               AND type = 'message'
             ORDER BY tag_number ASC`).all(sessionId).filter(isPiFallbackFoldTagRow);
  const byMessage = new Map;
  for (const row of rows) {
    const marker = row.messageId.lastIndexOf(":p");
    if (marker < 0)
      continue;
    const suffix = row.messageId.slice(marker + 2);
    if (!/^\d+$/.test(suffix))
      continue;
    const messageId = row.messageId.slice(0, marker);
    const group = byMessage.get(messageId);
    const entry = { ...row, partIndex: Number.parseInt(suffix, 10) };
    if (group)
      group.push(entry);
    else
      byMessage.set(messageId, [entry]);
  }
  for (const group of byMessage.values())
    group.sort((a, b) => a.partIndex - b.partIndex);
  return byMessage;
}
function readQueuedTagNumbers(db, sessionId) {
  const rows = db.prepare("SELECT tag_id AS tagNumber, operation FROM pending_ops WHERE session_id = ? AND tag_id IS NOT NULL").all(sessionId);
  const any = new Set;
  const drop = new Set;
  for (const row of rows) {
    if (typeof row.tagNumber !== "number")
      continue;
    any.add(row.tagNumber);
    if (row.operation === "drop")
      drop.add(row.tagNumber);
  }
  return { any, drop };
}
function foldShrunkPartTags2(db, sessionId, messages) {
  const result = {
    foldedTagNumbers: [],
    rekeyedTagNumbers: [],
    discardedDropTagNumbers: []
  };
  if (messages.length === 0)
    return result;
  const rowsByMessage = readPartTagRowsByMessage(db, sessionId);
  const queuedTags = readQueuedTagNumbers(db, sessionId);
  const discardDrop = foldStatement(db, "DELETE FROM pending_ops WHERE session_id = ? AND tag_id = ? AND operation = 'drop'");
  const rekey = foldStatement(db, "UPDATE tags SET message_id = ? WHERE session_id = ? AND tag_number = ? AND type = 'message'");
  for (const { messageId, partCount } of messages) {
    const rows = rowsByMessage.get(messageId) ?? [];
    if (rows.length === 0)
      continue;
    const orphans = rows.filter((row) => row.partIndex >= partCount);
    if (orphans.length === 0)
      continue;
    const queued = [
      ...new Set(rows.map((row) => row.tagNumber).filter((tag) => queuedTags.drop.has(tag)))
    ].sort((a, b) => a - b);
    if (queued.length > 0 && queued.length < rows.length) {
      for (const tagNumber of queued) {
        discardDrop.run(sessionId, tagNumber);
        result.discardedDropTagNumbers.push(tagNumber);
      }
    }
    let survivor = rows.find((row) => row.partIndex < partCount) ?? null;
    if (survivor === null) {
      const lowest = orphans[0];
      if (!lowest)
        continue;
      rekey.run(`${messageId}:p0`, sessionId, lowest.tagNumber);
      result.rekeyedTagNumbers.push(lowest.tagNumber);
      survivor = { ...lowest, messageId: `${messageId}:p0`, partIndex: 0 };
    }
    for (const orphan of orphans) {
      if (orphan.tagNumber === survivor.tagNumber)
        continue;
      foldDuplicateIntoSurvivor(db, sessionId, survivor, orphan, queuedTags.any.has(orphan.tagNumber), false);
      result.foldedTagNumbers.push(orphan.tagNumber);
    }
  }
  result.discardedDropTagNumbers.sort((a, b) => a - b);
  result.foldedTagNumbers.sort((a, b) => a - b);
  return result;
}
function hasPiFallbackToolOwnerTags2(db, sessionId) {
  const row = db.prepare(`SELECT 1
             FROM tags
             WHERE session_id = ?
               AND type = 'tool'
               AND tool_owner_message_id LIKE 'pi-msg-%'
             LIMIT 1`).get(sessionId);
  return row != null;
}
function findPiFallbackToolOwnerTags2(db, sessionId) {
  return db.prepare(`SELECT tag_number AS tagNumber,
                    message_id AS callId,
                    tool_owner_message_id AS toolOwnerMessageId,
                    status
             FROM json_each(?) prefix CROSS JOIN tags
             WHERE session_id = ?
               AND tags.type = 'tool'
                AND tool_owner_message_id >= prefix.value
                AND tool_owner_message_id < substr(prefix.value, 1, 6) || '.'
                AND tool_owner_message_id LIKE 'pi-msg-%'
             ORDER BY tag_number ASC`).all(PI_FALLBACK_PREFIXES_JSON, sessionId).filter(isPiFallbackToolOwnerTag);
}

class PiTagIdentityConflictError2 extends Error {
  code = "PI_TAG_IDENTITY_CONFLICT";
  constructor(detail, kind = "tool") {
    super(`Magic Context ${kind}-tag identity conflict: ${detail}. This turn was refused without sending raw history; resending alone will not repair it`);
    this.name = "PiTagIdentityConflictError";
  }
}
function selectPiTagSurvivor(rows, servedTagNumbers, cachedSurvivor, kind, rebuildingSurvivor) {
  const served = rows.filter((row) => servedTagNumbers.has(row.tagNumber));
  const cached = cachedSurvivor === undefined ? undefined : rows.find((row) => row.tagNumber === cachedSurvivor);
  const rebuilding = rows.find((row) => row.tagNumber === rebuildingSurvivor);
  if (cachedSurvivor !== undefined && !cached || served.length !== 1 && !cached && !rebuilding) {
    throw new PiTagIdentityConflictError2(served.length > 1 ? `Conflicting served Pi ${kind} tag numbers; no byte-safe cached survivor is proven` : `duplicate ${kind} tag identities have no proven served-byte survivor`, kind);
  }
  const kept = cached ?? rebuilding ?? served[0];
  if (!kept)
    throw new PiTagIdentityConflictError2("no served survivor is proven", kind);
  return kept;
}
function foldPiIdentityDuplicate(db, sessionId, kept, duplicate) {
  const owesDrop = kept.status !== "dropped" && duplicate.status === "dropped";
  foldDuplicateIntoSurvivor(db, sessionId, kept, duplicate, true, false);
  if (owesDrop)
    queuePendingOp(db, sessionId, kept.tagNumber, "drop");
}
function getPiMessageTagCandidates2(db, sessionId, messageId) {
  return getPiFallbackMessageFoldTagRowsByMessageId(db, sessionId, messageId);
}
function findPiTagIdentityConflict2(error) {
  const seen = new Set;
  while (error instanceof Error && !seen.has(error)) {
    if (error instanceof PiTagIdentityConflictError2)
      return error;
    seen.add(error);
    error = error.cause;
  }
}
function adoptPiFallbackToolOwnerTag2(db, sessionId, tagNumber, callId, oldOwnerMessageId, newOwnerMessageId, servedTagNumbers = new Set, cachedSurvivor, rebuildingSurvivor) {
  const survivor = getPiFallbackFoldTagRowByNumber(db, sessionId, tagNumber);
  if (survivor === null || survivor.type !== "tool" || survivor.messageId !== callId || survivor.toolOwnerMessageId !== oldOwnerMessageId) {
    return { action: "skipped" };
  }
  const existing = getPiFallbackToolFoldTagRowByOwner(db, sessionId, callId, newOwnerMessageId);
  if (existing === null) {
    const result = db.prepare(`UPDATE tags
                 SET tool_owner_message_id = ?
                 WHERE session_id = ?
                   AND tag_number = ?
                   AND type = 'tool'
                   AND message_id = ?
                   AND tool_owner_message_id = ?`).run(newOwnerMessageId, sessionId, tagNumber, callId, oldOwnerMessageId);
    return (result.changes ?? 0) > 0 ? { action: "rekeyed", tagNumber } : { action: "skipped" };
  }
  if (existing.tagNumber === tagNumber) {
    return { action: "skipped" };
  }
  const kept = selectPiTagSurvivor([survivor, existing], servedTagNumbers, cachedSurvivor, "tool", rebuildingSurvivor);
  if (kept.tagNumber === survivor.tagNumber) {
    foldPiIdentityDuplicate(db, sessionId, survivor, existing);
    db.prepare("UPDATE tags SET tool_owner_message_id = ? WHERE session_id = ? AND tag_number = ?").run(newOwnerMessageId, sessionId, tagNumber);
    return { action: "folded", tagNumber, deletedTagNumbers: [existing.tagNumber] };
  }
  foldPiIdentityDuplicate(db, sessionId, existing, survivor);
  return {
    action: "folded",
    tagNumber: existing.tagNumber,
    deletedTagNumbers: [tagNumber]
  };
}
function adoptPiFallbackMessageTag2(db, sessionId, tagNumber, oldFallbackMessageId, newRealMessageId, servedTagNumbers = new Set, cachedSurvivor, rebuildingSurvivor) {
  if (oldFallbackMessageId.startsWith(WHITESPACE_ASSISTANT_INERT_MESSAGE_PREFIX)) {
    return { action: "skipped" };
  }
  const survivor = getPiFallbackFoldTagRowByNumber(db, sessionId, tagNumber);
  if (survivor === null || survivor.type !== "message" || survivor.messageId !== oldFallbackMessageId) {
    return { action: "skipped" };
  }
  const duplicates = getPiFallbackMessageFoldTagRowsByMessageId(db, sessionId, newRealMessageId).filter((row) => row.tagNumber !== tagNumber);
  if (duplicates.length === 0) {
    const result = db.prepare(`UPDATE tags
                 SET message_id = ?
                 WHERE session_id = ?
                   AND tag_number = ?
                   AND type = 'message'
                   AND message_id = ?`).run(newRealMessageId, sessionId, tagNumber, oldFallbackMessageId);
    return (result.changes ?? 0) > 0 ? { action: "rekeyed", tagNumber } : { action: "skipped" };
  }
  const realSurvivor = selectPiTagSurvivor([survivor, ...duplicates], servedTagNumbers, cachedSurvivor, "message", rebuildingSurvivor);
  const deletedTagNumbers = [];
  for (const duplicate of [survivor, ...duplicates]) {
    if (duplicate.tagNumber === realSurvivor.tagNumber)
      continue;
    foldPiIdentityDuplicate(db, sessionId, realSurvivor, duplicate);
    deletedTagNumbers.push(duplicate.tagNumber);
  }
  if (realSurvivor.tagNumber === tagNumber) {
    db.prepare("UPDATE tags SET message_id = ? WHERE session_id = ? AND tag_number = ?").run(newRealMessageId, sessionId, tagNumber);
  }
  return {
    action: "folded",
    tagNumber: realSurvivor.tagNumber,
    deletedTagNumbers
  };
}
function markTagsCompactedByMessageIds2(db, sessionId, messageIds, eligibleTagNumbers) {
  const ids = new Set(messageIds);
  if (ids.size === 0 || eligibleTagNumbers?.size === 0)
    return 0;
  const asciiLower = (value) => value.replace(/[A-Z]/g, (char) => char.toLowerCase());
  const foldedIds = new Set(Array.from(ids, asciiLower));
  const nulPrefixes = new Set(Array.from(ids).filter((id) => id.includes("\x00")).map((id) => asciiLower(id.split("\x00")[0])));
  const matches = (messageId, owner) => {
    if (messageId !== null && ids.has(messageId))
      return true;
    if (owner !== null && ids.has(owner))
      return true;
    if (messageId === null)
      return false;
    const nul = messageId.indexOf("\x00");
    const value = nul < 0 ? messageId : messageId.slice(0, nul);
    if (nulPrefixes.size > 0 && nulPrefixes.has(asciiLower(value)))
      return true;
    for (let colon = value.indexOf(":");colon >= 0; colon = value.indexOf(":", colon + 1)) {
      const suffix = value[colon + 1];
      if ((suffix === "p" || suffix === "P" || asciiLower(value.slice(colon + 1, colon + 5)) === "file") && foldedIds.has(asciiLower(value.slice(0, colon))))
        return true;
    }
    return false;
  };
  const rows = db.prepare(`WITH ids AS MATERIALIZED (
            SELECT value AS source_id, lower(value) AS folded_id FROM json_each(?)
        )
        SELECT id, tag_number, message_id, tool_owner_message_id FROM tags INDEXED BY ${tagOrderConstraintIndex(db)}
        WHERE session_id = ? ${eligibleTagNumbers ? "AND tag_number IN (SELECT value FROM json_each(?))" : ""}
        AND status IN ('active', 'dropped') AND (
            message_id IN (SELECT source_id FROM ids)
            OR tool_owner_message_id IN (SELECT source_id FROM ids)
            OR (instr(lower(message_id), ':p') > 0 AND
                lower(substr(message_id, 1, instr(lower(message_id), ':p') - 1)) IN (SELECT folded_id FROM ids))
            OR (instr(lower(message_id), ':file') > 0 AND
                lower(substr(message_id, 1, instr(lower(message_id), ':file') - 1)) IN (SELECT folded_id FROM ids))
            OR (? AND instr(message_id, ':') > 0)
            OR ?
        )`).all(JSON.stringify(Array.from(ids)), sessionId, ...eligibleTagNumbers ? [JSON.stringify([...eligibleTagNumbers])] : [], Array.from(ids).some((id) => id.includes(":")) ? 1 : 0, nulPrefixes.size > 0 ? 1 : 0);
  const candidates = rows.filter((row) => (eligibleTagNumbers === undefined || eligibleTagNumbers.has(row.tag_number)) && matches(row.message_id, row.tool_owner_message_id));
  if (candidates.length === 0)
    return 0;
  const update = db.prepare(`UPDATE tags SET status = 'compacted'
         WHERE id = ? AND session_id = ?
            AND status IN ('active', 'dropped')
            AND message_id IS ? AND tool_owner_message_id IS ?
          RETURNING tag_number`);
  let cursor = 0;
  let changed = 0;
  const batch = db.transaction(() => {
    const start = performance.now();
    let processed = 0;
    do {
      const row = candidates[cursor++];
      const retired = update.get(row.id, sessionId, row.message_id, row.tool_owner_message_id);
      if (retired) {
        removePendingOp(db, sessionId, retired.tag_number);
        changed++;
      }
      processed++;
    } while (cursor < candidates.length && processed < 128 && performance.now() - start < 8);
  });
  while (cursor < candidates.length)
    batch.immediate();
  return changed;
}
function deleteTagsByMessageId2(db, sessionId, messageId) {
  const deleteTransaction = db.transaction(() => {
    const escapedMessageId = escapeLikePattern(messageId);
    const textPartPattern = `${escapedMessageId}:p%`;
    const filePartPattern = `${escapedMessageId}:file%`;
    const contentDerivedTextPattern = `${escapedMessageId}${escapeLikePattern(TEXT_TAG_IDENTITY_MARKER)}%`;
    const messageScopedTags = getTagNumbersByMessageIdStatement(db).all(sessionId, messageId, textPartPattern, filePartPattern, contentDerivedTextPattern).filter(isTagNumberRow).map((row) => row.tag_number);
    const ownerScopedTagNumbers = getOwnerScopedToolTagNumbers(db, sessionId, messageId);
    if (messageScopedTags.length === 0 && ownerScopedTagNumbers.length === 0) {
      return [];
    }
    if (messageScopedTags.length > 0) {
      getDeleteTagsByMessageIdStatement(db).run(sessionId, messageId, textPartPattern, filePartPattern, contentDerivedTextPattern);
    }
    if (ownerScopedTagNumbers.length > 0) {
      deleteToolTagsByOwner(db, sessionId, messageId);
    }
    const merged = new Set([...messageScopedTags, ...ownerScopedTagNumbers]);
    return Array.from(merged).sort((a, b) => a - b);
  });
  return deleteTransaction.immediate();
}
var getOwnerScopedToolTagNumbersStatements = new WeakMap;
function getOwnerScopedToolTagNumbers(db, sessionId, ownerMsgId) {
  let stmt = getOwnerScopedToolTagNumbersStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT tag_number FROM tags WHERE session_id = ? AND type = 'tool' AND tool_owner_message_id = ? ORDER BY tag_number ASC");
    getOwnerScopedToolTagNumbersStatements.set(db, stmt);
  }
  return stmt.all(sessionId, ownerMsgId).filter(isTagNumberRow).map((row) => row.tag_number);
}
function getMaxTagNumberBySession2(db, sessionId) {
  const row = getMaxTagNumberBySessionStatement(db).get(sessionId);
  return isMaxTagNumberRow(row) ? row.max_tag_number : 0;
}
function getTagNumberByMessageId2(db, sessionId, messageId) {
  const row = getTagNumberByMessageIdStatement(db).get(sessionId, messageId);
  return isTagNumberRow(row) ? row.tag_number : null;
}
function getAssignableTagNumberByMessageId2(db, sessionId, messageId) {
  const row = getAssignableTagNumberByMessageIdStatement(db).get(sessionId, messageId);
  return isTagNumberRow(row) ? row.tag_number : null;
}
var getMinMessageTagNumberForRawIdStatements = new WeakMap;
function isMinTagNumberRow(row) {
  return row !== null && typeof row === "object" && "m" in row;
}
function getMinMessageTagNumberForRawId2(db, sessionId, rawId) {
  if (rawId.includes(":"))
    return null;
  let stmt = getMinMessageTagNumberForRawIdStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT MIN(tag_number) AS m FROM tags WHERE session_id = ? AND message_id >= ? AND message_id < ?");
    getMinMessageTagNumberForRawIdStatements.set(db, stmt);
  }
  const row = stmt.get(sessionId, `${rawId}:`, `${rawId};`);
  return isMinTagNumberRow(row) && typeof row.m === "number" ? row.m : null;
}
var TAGGER_FLOOR_SCAN_MESSAGES = 8;
var TAGGER_FLOOR_MAX_PROBES = 64;
var TAGGER_FLOOR_SAFETY_MARGIN = 256;
var TAGGER_FLOOR_PER_SKIP_MARGIN = 64;
function deriveTagLoadFloor2(db, sessionId, rawIds) {
  let min = Number.POSITIVE_INFINITY;
  let probes = 0;
  let hits = 0;
  let skippedBeforeFirstHit = 0;
  for (const rawId of rawIds) {
    if (typeof rawId !== "string" || rawId.length === 0)
      continue;
    if (probes >= TAGGER_FLOOR_MAX_PROBES)
      break;
    probes++;
    const m = getMinMessageTagNumberForRawId2(db, sessionId, rawId);
    if (m === null) {
      if (hits === 0)
        skippedBeforeFirstHit++;
      continue;
    }
    if (m < min)
      min = m;
    if (++hits >= TAGGER_FLOOR_SCAN_MESSAGES)
      break;
  }
  if (!Number.isFinite(min))
    return 0;
  const margin = TAGGER_FLOOR_SAFETY_MARGIN + skippedBeforeFirstHit * TAGGER_FLOOR_PER_SKIP_MARGIN;
  return Math.max(0, min - margin);
}
var TAG_SELECT_COLUMNS2 = "id, message_id, type, status, drop_mode, tool_name, input_byte_size, byte_size, reasoning_byte_size, session_id, tag_number, caveman_depth, tool_owner_message_id, token_count";
function getTagsBySession2(db, sessionId) {
  const rows = db.prepare(`SELECT ${TAG_SELECT_COLUMNS2} FROM tags WHERE session_id = ? ORDER BY tag_number ASC, id ASC`).all(sessionId).filter(isTagRow);
  return rows.map(toTagEntry);
}
var getActiveTagsBySessionStatements = new WeakMap;
var getNullOwnerToolTagsBySessionStatements = new WeakMap;
var getDroppedTagsBySessionStatements = new WeakMap;
var getMaxDroppedTagNumberStatements = new WeakMap;
function getActiveTagsBySessionStatement(db) {
  let stmt = getActiveTagsBySessionStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT ${TAG_SELECT_COLUMNS2} FROM tags WHERE session_id = ? AND status = 'active' ORDER BY tag_number ASC, id ASC`);
    getActiveTagsBySessionStatements.set(db, stmt);
  }
  return stmt;
}
function getMaxDroppedTagNumberStatement(db) {
  let stmt = getMaxDroppedTagNumberStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT COALESCE(MAX(tag_number), 0) AS max_tag_number FROM tags WHERE session_id = ? AND status = 'dropped'");
    getMaxDroppedTagNumberStatements.set(db, stmt);
  }
  return stmt;
}
function getActiveTagsBySession2(db, sessionId) {
  const rows = getActiveTagsBySessionStatement(db).all(sessionId).filter(isTagRow);
  return rows.map(toTagEntry);
}
function getTailHygieneTags2(db, sessionId) {
  const active = getActiveTagsBySession2(db, sessionId);
  let orphanStatement = getNullOwnerToolTagsBySessionStatements.get(db);
  if (!orphanStatement) {
    orphanStatement = db.prepare(`SELECT ${TAG_SELECT_COLUMNS2} FROM tags
             WHERE session_id = ? AND type = 'tool' AND tool_owner_message_id IS NULL
             ORDER BY tag_number ASC, id ASC`);
    getNullOwnerToolTagsBySessionStatements.set(db, orphanStatement);
  }
  const seen = new Set(active.map((tag) => `${tag.tagNumber}\x00${tag.messageId}\x00${tag.type}`));
  for (const row of orphanStatement.all(sessionId).filter(isTagRow)) {
    const orphan = toTagEntry(row);
    const key = `${orphan.tagNumber}\x00${orphan.messageId}\x00${orphan.type}`;
    if (!seen.has(key))
      active.push(orphan);
  }
  return active;
}
function getTagsForPendingOperations2(db, sessionId, pendingTagNumbers, protectedCount, recentToolWindow) {
  const byNumber = new Map;
  for (const tag of getTagsByNumbers2(db, sessionId, pendingTagNumbers)) {
    byNumber.set(tag.tagNumber, tag);
  }
  const addRows = (sql, limit) => {
    if (limit <= 0)
      return;
    const rows = db.prepare(sql).all(sessionId, limit).filter(isTagRow);
    for (const row of rows) {
      const tag = toTagEntry(row);
      byNumber.set(tag.tagNumber, tag);
    }
  };
  addRows(`SELECT ${TAG_SELECT_COLUMNS2} FROM tags
         WHERE session_id = ? AND status = 'active'
         ORDER BY tag_number DESC, id DESC LIMIT ?`, protectedCount);
  addRows(`SELECT ${TAG_SELECT_COLUMNS2} FROM tags
         WHERE session_id = ? AND type = 'tool'
         ORDER BY tag_number DESC, id DESC LIMIT ?`, recentToolWindow);
  return [...byNumber.values()].sort((left, right) => left.tagNumber - right.tagNumber);
}
function getTagsByNumbers2(db, sessionId, tagNumbers) {
  if (tagNumbers.length === 0)
    return [];
  if (tagNumbers.length > 900) {
    const all = [];
    for (let i = 0;i < tagNumbers.length; i += 900) {
      all.push(...getTagsByNumbers2(db, sessionId, tagNumbers.slice(i, i + 900)));
    }
    return all;
  }
  const placeholders = tagNumbers.map(() => "?").join(",");
  const rows = db.prepare(`SELECT ${TAG_SELECT_COLUMNS2} FROM tags WHERE session_id = ? AND tag_number IN (${placeholders}) ORDER BY tag_number ASC, id ASC`).all(sessionId, ...tagNumbers).filter(isTagRow);
  return rows.map(toTagEntry);
}
var newestToolTagNumberStatements = new WeakMap;
function getNewestToolTagNumbers2(db, sessionId, limit) {
  if (limit <= 0)
    return [];
  let statement = newestToolTagNumberStatements.get(db);
  if (!statement) {
    statement = db.prepare(`SELECT tag_number FROM tags
              WHERE session_id = ? AND +type = 'tool'
                AND typeof(message_id) = 'text'
                AND typeof(status) = 'text'
                AND typeof(byte_size) IN ('integer', 'real')
                AND typeof(tag_number) IN ('integer', 'real')
              ORDER BY tag_number DESC
              LIMIT ?`);
    newestToolTagNumberStatements.set(db, statement);
  }
  return statement.all(sessionId, limit).map((row) => row.tag_number);
}
var droppedNumberStatements = new WeakMap;
function getDroppedTagsByNumbers2(db, sessionId, tagNumbers) {
  if (tagNumbers.length === 0)
    return [];
  if (tagNumbers.length > 900) {
    const all = [];
    for (let i = 0;i < tagNumbers.length; i += 900) {
      all.push(...getDroppedTagsByNumbers2(db, sessionId, tagNumbers.slice(i, i + 900)));
    }
    return all;
  }
  let statement = droppedNumberStatements.get(db);
  if (!statement) {
    statement = db.prepare(`SELECT ${TAG_SELECT_COLUMNS2} FROM tags WHERE session_id = ? AND status = 'dropped' AND tag_number IN (SELECT value FROM json_each(?)) ORDER BY tag_number ASC, id ASC`);
    droppedNumberStatements.set(db, statement);
  }
  const rows = statement.all(sessionId, JSON.stringify(tagNumbers)).filter(isTagRow);
  return rows.map(toTagEntry);
}
function getMaxDroppedTagNumber2(db, sessionId) {
  const row = getMaxDroppedTagNumberStatement(db).get(sessionId);
  return isMaxTagNumberRow(row) ? row.max_tag_number : 0;
}
var tagByIdStatements = new WeakMap;
function getTagById2(db, sessionId, tagId) {
  let statement = tagByIdStatements.get(db);
  if (!statement) {
    statement = db.prepare(`SELECT ${TAG_SELECT_COLUMNS2} FROM tags WHERE session_id = ? AND tag_number = ?`);
    tagByIdStatements.set(db, statement);
  }
  const result = statement.get(sessionId, tagId);
  if (!isTagRow(result)) {
    return null;
  }
  return toTagEntry(result);
}
function getTopNBySize2(db, sessionId, n) {
  if (n <= 0) {
    return [];
  }
  const rows = db.prepare(`SELECT ${TAG_SELECT_COLUMNS2} FROM tags WHERE session_id = ? AND status = 'active' ORDER BY byte_size DESC, tag_number ASC LIMIT ?`).all(sessionId, n).filter(isTagRow);
  return rows.map(toTagEntry);
}
var getToolTagNumberByOwnerStatements = new WeakMap;
var getNullOwnerToolTagStatements = new WeakMap;
var adoptNullOwnerToolTagStatements = new WeakMap;
var getToolOwnerByTagIdStatements = new WeakMap;
var deleteToolTagsByOwnerStatements = new WeakMap;
function getGetToolTagNumberByOwnerStatement(db) {
  let stmt = getToolTagNumberByOwnerStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT tag_number FROM tags
             WHERE session_id = ? AND message_id = ?
               AND type = 'tool' AND tool_owner_message_id = ?
             LIMIT 1`);
    getToolTagNumberByOwnerStatements.set(db, stmt);
  }
  return stmt;
}
function getToolTagNumberByOwner2(db, sessionId, callId, ownerMsgId) {
  const row = getGetToolTagNumberByOwnerStatement(db).get(sessionId, callId, ownerMsgId);
  return isTagNumberRow(row) ? row.tag_number : null;
}
function isNullOwnerToolTagRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.id === "number" && typeof r.tag_number === "number";
}
function getGetNullOwnerToolTagStatement(db) {
  let stmt = getNullOwnerToolTagStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT id, tag_number FROM tags
             WHERE session_id = ? AND message_id = ?
               AND type = 'tool' AND tool_owner_message_id IS NULL
             ORDER BY tag_number ASC
             LIMIT 1`);
    getNullOwnerToolTagStatements.set(db, stmt);
  }
  return stmt;
}
function getNullOwnerToolTag2(db, sessionId, callId) {
  const row = getGetNullOwnerToolTagStatement(db).get(sessionId, callId);
  if (!isNullOwnerToolTagRow(row))
    return null;
  return { id: row.id, tagNumber: row.tag_number };
}
function getAdoptNullOwnerToolTagStatement(db) {
  let stmt = adoptNullOwnerToolTagStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`UPDATE tags
             SET tool_owner_message_id = ?
             WHERE id = ? AND tool_owner_message_id IS NULL`);
    adoptNullOwnerToolTagStatements.set(db, stmt);
  }
  return stmt;
}
function getToolOwnerByTagIdStatement(db) {
  let stmt = getToolOwnerByTagIdStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT tool_owner_message_id FROM tags WHERE id = ?");
    getToolOwnerByTagIdStatements.set(db, stmt);
  }
  return stmt;
}
function adoptNullOwnerToolTag2(db, rowId, ownerMsgId) {
  return db.transaction(() => {
    const before = getToolOwnerByTagIdStatement(db).get(rowId);
    if (!before || before.tool_owner_message_id !== null)
      return false;
    getAdoptNullOwnerToolTagStatement(db).run(ownerMsgId, rowId);
    const after = getToolOwnerByTagIdStatement(db).get(rowId);
    return after?.tool_owner_message_id === ownerMsgId;
  }).immediate();
}
function getCandidateToolOwners2(db, sessionId, callId) {
  const rows = db.prepare(`SELECT DISTINCT tool_owner_message_id
             FROM tags
             WHERE session_id = ?
               AND message_id = ?
               AND type = 'tool'
               AND tool_owner_message_id IS NOT NULL`).all(sessionId, callId);
  return rows.map((r) => r.tool_owner_message_id);
}
function pickNearestPriorOwner2(candidates, currentMessageId, times) {
  const currentTime = times.get(currentMessageId);
  if (typeof currentTime !== "number")
    return null;
  let best = null;
  for (const id of candidates) {
    const t = times.get(id);
    if (typeof t !== "number")
      continue;
    if (t > currentTime)
      continue;
    if (t === currentTime && id >= currentMessageId)
      continue;
    if (best === null || t > best.time || t === best.time && id > best.id) {
      best = { id, time: t };
    }
  }
  return best?.id ?? null;
}
function getDeleteToolTagsByOwnerStatement(db) {
  let stmt = deleteToolTagsByOwnerStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`DELETE FROM tags
             WHERE session_id = ?
               AND type = 'tool'
               AND tool_owner_message_id = ?
             RETURNING id`);
    deleteToolTagsByOwnerStatements.set(db, stmt);
  }
  return stmt;
}
function deleteToolTagsByOwner(db, sessionId, ownerMsgId) {
  return getDeleteToolTagsByOwnerStatement(db).all(sessionId, ownerMsgId).length;
}

// ../plugin/src/features/magic-context/protection-window.ts
function rowWindowMass(row) {
  const raw = row.token_count ?? row.tokenCount;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return 0;
}
function getRowKind(row) {
  return (row.kind ?? row.type ?? "").toLowerCase();
}
function getRowTagNumber(row) {
  const num = row.tag_number ?? row.tagNumber;
  if (typeof num === "number" && Number.isFinite(num)) {
    return num;
  }
  return 0;
}
function getRowIdentity(row) {
  const id = row.row_identity ?? row.id;
  if (id !== undefined && id !== null) {
    return id;
  }
  return getRowTagNumber(row);
}
function rowKey(row) {
  return `${getRowTagNumber(row)}:${getRowIdentity(row)}`;
}
function compareRowsAscending(a, b) {
  const tagDiff = getRowTagNumber(a) - getRowTagNumber(b);
  if (tagDiff !== 0)
    return tagDiff;
  const idA = getRowIdentity(a);
  const idB = getRowIdentity(b);
  if (typeof idA === "number" && typeof idB === "number") {
    return idA - idB;
  }
  return String(idA).localeCompare(String(idB));
}
function computeProtectionWindow(rows, floor, toolsRatio = 1) {
  const toolRows = rows.filter((r) => getRowKind(r) === "tool");
  if (toolRows.length === 0) {
    return {
      memberRows: [],
      memberRowKeys: new Set,
      tagNumberSet: { coordinateSpace: "tag-number", tagNumbers: new Set },
      rowIdentitySet: {
        coordinateSpace: "row-identity",
        rowIdentities: new Set
      },
      ordinalCutoff: { coordinateSpace: "tag-number", cutoff: null },
      cutoff: null,
      protectedTagNumbers: new Set,
      protectedRowIdentities: new Set,
      status: {
        floor,
        protectedCount: 0,
        protectedMass: 0
      },
      isProtected: () => false
    };
  }
  const sortedAsc = [...toolRows].sort(compareRowsAscending);
  const tieGroupsDescending = [];
  let currentGroup = [];
  let currentTagNumber = null;
  for (let i = sortedAsc.length - 1;i >= 0; i--) {
    const row = sortedAsc[i];
    const tagNum = getRowTagNumber(row);
    if (currentTagNumber === null || tagNum === currentTagNumber) {
      currentGroup.push(row);
      currentTagNumber = tagNum;
    } else {
      tieGroupsDescending.push(currentGroup);
      currentGroup = [row];
      currentTagNumber = tagNum;
    }
  }
  if (currentGroup.length > 0) {
    tieGroupsDescending.push(currentGroup);
  }
  const massWindowRows = [];
  let cumulativeMass = 0;
  for (const group of tieGroupsDescending) {
    for (const row of group) {
      massWindowRows.push(row);
      cumulativeMass += rowWindowMass(row);
    }
    if (Math.ceil(cumulativeMass * toolsRatio) >= floor) {
      break;
    }
  }
  const mass_cutoff = massWindowRows.length > 0 ? getRowTagNumber(massWindowRows[massWindowRows.length - 1]) : null;
  const distinctToolTagNumbers = tieGroupsDescending.map((g) => getRowTagNumber(g[0]));
  const minCount = Math.min(3, distinctToolTagNumbers.length);
  const newest3_cutoff = minCount > 0 ? distinctToolTagNumbers[minCount - 1] : null;
  const cutoff = mass_cutoff !== null && newest3_cutoff !== null ? Math.min(mass_cutoff, newest3_cutoff) : mass_cutoff ?? newest3_cutoff;
  const memberRows = cutoff !== null ? sortedAsc.filter((row) => getRowTagNumber(row) >= cutoff) : [];
  const memberRowKeys = new Set(memberRows.map(rowKey));
  const protectedTagNumbers = new Set(memberRows.map(getRowTagNumber));
  const protectedRowIdentities = new Set(memberRows.map(getRowIdentity));
  const protectedCount = memberRows.length;
  const protectedMass = Math.ceil(memberRows.reduce((sum, row) => sum + rowWindowMass(row), 0) * toolsRatio);
  const isProtected = (row) => {
    return getRowKind(row) === "tool" && cutoff !== null && getRowTagNumber(row) >= cutoff;
  };
  return {
    memberRows,
    memberRowKeys,
    tagNumberSet: {
      coordinateSpace: "tag-number",
      tagNumbers: protectedTagNumbers
    },
    rowIdentitySet: {
      coordinateSpace: "row-identity",
      rowIdentities: protectedRowIdentities
    },
    ordinalCutoff: {
      coordinateSpace: "tag-number",
      cutoff
    },
    cutoff,
    protectedTagNumbers,
    protectedRowIdentities,
    status: {
      floor,
      protectedCount,
      protectedMass
    },
    isProtected
  };
}
function readEpochFloorSnapshot(db, sessionId) {
  try {
    const row = db.prepare("SELECT protected_tokens_effective FROM session_meta WHERE session_id = ?").get(sessionId);
    if (row && typeof row.protected_tokens_effective === "number" && Number.isFinite(row.protected_tokens_effective)) {
      return row.protected_tokens_effective;
    }
  } catch {}
  return null;
}
function getProtectionWindowForSession(db, sessionId, floor) {
  const effectiveFloor = typeof floor === "number" && Number.isFinite(floor) ? floor : readEpochFloorSnapshot(db, sessionId) ?? 0;
  const toolsRatio = sessionDecisionCalibration(db, sessionId).toolsRatio;
  const pageSize = 256;
  const projection = `SELECT ${TAG_SELECT_COLUMNS2} FROM tags
        WHERE session_id = ? AND +type = 'tool'`;
  const order = `ORDER BY tag_number DESC, id DESC LIMIT ${pageSize}`;
  let page = db.prepare(`${projection} ${order}`).all(sessionId);
  const rows = [];
  let mass = 0;
  let distinctTags = 0;
  let currentTag = null;
  while (page.length > 0) {
    for (const row of page) {
      const tagNumber = getRowTagNumber(row);
      if (tagNumber !== currentTag) {
        if (distinctTags >= 3 && Math.ceil(mass * toolsRatio) >= effectiveFloor) {
          return computeProtectionWindow(rows, effectiveFloor, toolsRatio);
        }
        distinctTags++;
        currentTag = tagNumber;
      }
      rows.push(row);
      mass += rowWindowMass(row);
    }
    if (page.length < pageSize)
      break;
    const last = page[page.length - 1];
    page = db.prepare(`${projection} AND (tag_number, id) < (?, ?) ${order}`).all(sessionId, getRowTagNumber(last), getRowIdentity(last));
  }
  return computeProtectionWindow(rows, effectiveFloor, toolsRatio);
}

// ../plugin/src/features/magic-context/storage-meta-persisted.ts
var emergencyRecoveryArmedSessions = new Set;
var emergencyRecoveryArmedAtBySession = new Map;
var providerOverflowReconfirmedSessions = new Set;
var providerOverflowKnownLimitSessions = new Set;
function isProviderOverflowFailClosedProven(sessionId) {
  return providerOverflowKnownLimitSessions.has(sessionId) || providerOverflowReconfirmedSessions.has(sessionId);
}
function getEmergencyRecoveryArmedAt(sessionId) {
  return emergencyRecoveryArmedAtBySession.get(sessionId) ?? null;
}
function describeProtectedTailDrainBudgetSkip(result) {
  const state = result.budgetState;
  if (!state)
    return "historian skip: internal drain budget spent";
  const resetMinutes = Math.max(1, Math.ceil(state.resetInMs / 60000));
  return `historian skip: internal drain budget spent (${state.spentTokens}/${state.limitTokens} tokens; resets in ${resetMinutes}m)`;
}
var CAS_RETRY_LIMIT2 = 5;
var AUTO_SEARCH_NO_HINT_REASONS = new Set([
  "below-threshold",
  "timeout",
  "empty",
  "error",
  "stacked",
  "too-short"
]);
function isPersistedUsageRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.last_context_percentage === "number" && typeof r.last_input_tokens === "number" && typeof r.last_response_time === "number" && (typeof r.last_observed_model_key === "string" || r.last_observed_model_key === null) && (typeof r.last_usage_context_limit === "number" || r.last_usage_context_limit === null) && typeof r.observed_safe_input_tokens === "number";
}
function isPersistedNoteNudgeRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.note_nudge_trigger_pending === "number" && typeof r.note_nudge_trigger_message_id === "string" && typeof r.note_nudge_sticky_text === "string" && typeof r.note_nudge_sticky_message_id === "string";
}
function isValidNoteNudgeAnchor(value) {
  if (value === null || typeof value !== "object")
    return false;
  const row = value;
  return typeof row.messageId === "string" && row.messageId.length > 0 && typeof row.text === "string" && row.text.length > 0;
}
function isValidAutoSearchHintDecision(value) {
  if (value === null || typeof value !== "object")
    return false;
  const row = value;
  if (typeof row.messageId !== "string" || row.messageId.length === 0)
    return false;
  if (row.decision === "hint") {
    return typeof row.text === "string" && row.text.length > 0;
  }
  if (row.decision === "no-hint") {
    return typeof row.reason === "string" && AUTO_SEARCH_NO_HINT_REASONS.has(row.reason);
  }
  return false;
}
function parseJsonArray(json, validator) {
  if (!json)
    return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed))
      return [];
    return parsed.filter(validator);
  } catch {
    return [];
  }
}
function isPersistedTodoSyntheticAnchorRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.todo_synthetic_call_id === "string" && typeof r.todo_synthetic_anchor_message_id === "string" && typeof r.todo_synthetic_state_json === "string";
}
function isPersistedHistorianFailureRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const r = row;
  return typeof r.historian_failure_count === "number" && (typeof r.historian_last_error === "string" || r.historian_last_error === null) && (typeof r.historian_last_failure_at === "number" || r.historian_last_failure_at === null);
}
function getDefaultPersistedNoteNudge() {
  return {
    triggerPending: false,
    triggerMessageId: null,
    stickyText: null,
    stickyMessageId: null
  };
}
function getDefaultHistorianFailureState() {
  return {
    failureCount: 0,
    lastError: null,
    lastFailureAt: null
  };
}
function parseHistorianFailureState(result) {
  if (!isPersistedHistorianFailureRow(result))
    return getDefaultHistorianFailureState();
  return {
    failureCount: result.historian_failure_count,
    lastError: typeof result.historian_last_error === "string" && result.historian_last_error.length > 0 ? result.historian_last_error : null,
    lastFailureAt: typeof result.historian_last_failure_at === "number" ? result.historian_last_failure_at : null
  };
}
function loadPersistedUsage(db, sessionId) {
  const result = db.prepare("SELECT last_context_percentage, last_input_tokens, last_response_time, last_observed_model_key, last_usage_context_limit, observed_safe_input_tokens FROM session_meta WHERE session_id = ?").get(sessionId);
  if (!isPersistedUsageRow(result) || result.last_context_percentage === 0 && result.last_input_tokens === 0) {
    return null;
  }
  return {
    usage: {
      percentage: result.last_context_percentage,
      inputTokens: result.last_input_tokens
    },
    updatedAt: result.last_response_time || Date.now(),
    lastObservedModelKey: result.last_observed_model_key,
    lastUsageContextLimit: typeof result.last_usage_context_limit === "number" ? result.last_usage_context_limit : 0,
    observedSafeInputTokens: result.observed_safe_input_tokens
  };
}
var DEFAULT_PROTECTED_TAIL_META = {
  priorBoundaryOrdinal: 1,
  protectedTailPolicyVersion: 0,
  protectedTailDrainWindowStartedAt: 0,
  protectedTailDrainTokens: 0,
  recoveryNoEligibleHeadCount: 0,
  forceEmergencyBypassWindowStart: 0,
  forceEmergencyBypassUsed: 0,
  emergencyDrainActive: 0,
  historianDrainFailureAt: 0
};
function toProtectedTailMeta(row) {
  if (row === null || typeof row !== "object")
    return { ...DEFAULT_PROTECTED_TAIL_META };
  const r = row;
  const numberOr = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return {
    priorBoundaryOrdinal: Math.max(1, numberOr(r.prior_boundary_ordinal, 1)),
    protectedTailPolicyVersion: numberOr(r.protected_tail_policy_version, 0),
    protectedTailDrainWindowStartedAt: numberOr(r.protected_tail_drain_window_started_at, 0),
    protectedTailDrainTokens: numberOr(r.protected_tail_drain_tokens, 0),
    recoveryNoEligibleHeadCount: numberOr(r.recovery_no_eligible_head_count, 0),
    forceEmergencyBypassWindowStart: numberOr(r.force_emergency_bypass_window_start, 0),
    forceEmergencyBypassUsed: numberOr(r.force_emergency_bypass_used, 0),
    emergencyDrainActive: numberOr(r.emergency_drain_active, 0),
    historianDrainFailureAt: numberOr(r.historian_drain_failure_at, 0)
  };
}
function loadProtectedTailMeta(db, sessionId) {
  ensureSessionMetaRow(db, sessionId);
  const row = db.prepare(`SELECT prior_boundary_ordinal, protected_tail_policy_version,
                    protected_tail_drain_window_started_at, protected_tail_drain_tokens,
                    recovery_no_eligible_head_count, force_emergency_bypass_window_start,
                    force_emergency_bypass_used, emergency_drain_active, historian_drain_failure_at
             FROM session_meta WHERE session_id = ?`).get(sessionId);
  return toProtectedTailMeta(row);
}
function markProtectedTailPolicyV3Seeded(db, sessionId, priorBoundaryOrdinal) {
  let seeded = false;
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    const existing = loadProtectedTailMeta(db, sessionId);
    if (existing.protectedTailPolicyVersion < 3) {
      db.prepare(`UPDATE session_meta
                 SET prior_boundary_ordinal = ?, protected_tail_policy_version = 3
                 WHERE session_id = ? AND protected_tail_policy_version < 3`).run(Math.max(1, Math.floor(priorBoundaryOrdinal)), sessionId);
      seeded = true;
    }
  }).immediate();
  return { ...loadProtectedTailMeta(db, sessionId), seeded };
}
function recordProtectedTailPublicationFloor(db, sessionId, floorOrdinal) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare(`UPDATE session_meta
             SET prior_boundary_ordinal = MAX(COALESCE(prior_boundary_ordinal, 1), ?),
                 recovery_no_eligible_head_count = 0
             WHERE session_id = ?`).run(Math.max(1, Math.floor(floorOrdinal)), sessionId);
  }).immediate();
}
function recordProtectedTailNoEligibleHead(db, sessionId) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare(`UPDATE session_meta
             SET recovery_no_eligible_head_count = COALESCE(recovery_no_eligible_head_count, 0) + 1
             WHERE session_id = ?`).run(sessionId);
  }).immediate();
  return loadProtectedTailMeta(db, sessionId).recoveryNoEligibleHeadCount;
}
var DRAIN_WINDOW_MS = 10 * 60 * 1000;
var WRAPUP_IN_PROGRESS_TTL_MS = 5 * 60 * 1000;
function parseWrapupState(value) {
  if (typeof value !== "string" || value.trim().length === 0)
    return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object")
      return null;
    if (typeof parsed.holderId !== "string" || parsed.holderId.length === 0)
      return null;
    const numberFields = [
      "acquiredAt",
      "expiresAt",
      "messagesToKeep",
      "anchorRawMessageCount",
      "targetEligibleEndOrdinal",
      "lastCompartmentEnd",
      "chunkIndex",
      "expectedChunks",
      "updatedAt"
    ];
    for (const field of numberFields) {
      if (typeof parsed[field] !== "number" || !Number.isFinite(parsed[field]))
        return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function readRawWrapupState(db, sessionId) {
  const row = db.prepare("SELECT wrapup_in_progress_state FROM session_meta WHERE session_id = ?").get(sessionId);
  return parseWrapupState(row?.wrapup_in_progress_state);
}
function getWrapupInProgressState(db, sessionId, now = Date.now()) {
  const state = readRawWrapupState(db, sessionId);
  if (!state)
    return null;
  if (state.expiresAt > now)
    return state;
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch {
    return null;
  }
  const transactionStartedAt = performance.now();
  let finished = false;
  try {
    const current = readRawWrapupState(db, sessionId);
    if (current && current.expiresAt <= now) {
      db.prepare("UPDATE session_meta SET wrapup_in_progress_state = NULL WHERE session_id = ?").run(sessionId);
    }
    db.exec("COMMIT");
    finished = true;
    logSlowWriteTransaction("storage_meta_wrapup_expiry_cleanup", transactionStartedAt);
  } finally {
    if (!finished) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
  }
  return null;
}
function isWrapupInProgress(db, sessionId, now = Date.now()) {
  return getWrapupInProgressState(db, sessionId, now) !== null;
}
function acquireWrapupInProgress(db, sessionId, state, now = Date.now()) {
  const acquiredAt = now;
  const next = {
    ...state,
    acquiredAt,
    expiresAt: acquiredAt + WRAPUP_IN_PROGRESS_TTL_MS,
    updatedAt: acquiredAt
  };
  db.exec("BEGIN IMMEDIATE");
  const transactionStartedAt = performance.now();
  let finished = false;
  try {
    ensureSessionMetaRow(db, sessionId);
    const current = readRawWrapupState(db, sessionId);
    if (current && current.expiresAt > now && current.holderId !== state.holderId) {
      db.exec("COMMIT");
      finished = true;
      logSlowWriteTransaction("storage_meta_wrapup_acquire", transactionStartedAt);
      return { ok: false, state: current };
    }
    db.prepare("UPDATE session_meta SET wrapup_in_progress_state = ? WHERE session_id = ?").run(stableStringify(next), sessionId);
    db.exec("COMMIT");
    finished = true;
    logSlowWriteTransaction("storage_meta_wrapup_acquire", transactionStartedAt);
    return { ok: true, state: next };
  } finally {
    if (!finished) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
  }
}
function updateWrapupInProgress(db, sessionId, holderId, updates, now = Date.now()) {
  db.exec("BEGIN IMMEDIATE");
  const transactionStartedAt = performance.now();
  let finished = false;
  try {
    const current = readRawWrapupState(db, sessionId);
    if (!current || current.holderId !== holderId || current.expiresAt <= now) {
      db.exec("ROLLBACK");
      finished = true;
      return null;
    }
    const next = {
      ...current,
      ...updates,
      holderId,
      expiresAt: now + WRAPUP_IN_PROGRESS_TTL_MS,
      updatedAt: now
    };
    db.prepare("UPDATE session_meta SET wrapup_in_progress_state = ? WHERE session_id = ?").run(stableStringify(next), sessionId);
    db.exec("COMMIT");
    finished = true;
    logSlowWriteTransaction("storage_meta_wrapup_update", transactionStartedAt);
    return next;
  } finally {
    if (!finished) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
  }
}
function releaseWrapupInProgress(db, sessionId, holderId) {
  db.exec("BEGIN IMMEDIATE");
  const transactionStartedAt = performance.now();
  let finished = false;
  try {
    const current = readRawWrapupState(db, sessionId);
    if (current?.holderId === holderId) {
      db.prepare("UPDATE session_meta SET wrapup_in_progress_state = NULL WHERE session_id = ?").run(sessionId);
    }
    db.exec("COMMIT");
    finished = true;
    logSlowWriteTransaction("storage_meta_wrapup_release", transactionStartedAt);
  } finally {
    if (!finished) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
  }
}
var COMPACTION_MODE_RECORD_VALUES = new Set([
  "on",
  "off",
  "on_notice_pending",
  "off_notice_pending",
  "off_cleanup_pending"
]);
function normalizeCompactionModeRecord(value) {
  if (value === null || value === undefined)
    return null;
  if (typeof value === "string" && COMPACTION_MODE_RECORD_VALUES.has(value)) {
    return value;
  }
  return null;
}
function resolveCompactionModeRecord(record) {
  switch (record) {
    case "on":
    case "on_notice_pending":
      return "on";
    case "off":
    case "off_notice_pending":
    case "off_cleanup_pending":
      return "off";
    default:
      return null;
  }
}
function getCompactionModeRecord(db, sessionId) {
  const row = db.prepare("SELECT compaction_mode_record FROM session_meta WHERE session_id = ?").get(sessionId);
  return normalizeCompactionModeRecord(row?.compaction_mode_record);
}
function setCompactionModeRecord(db, sessionId, value) {
  if (value !== null && !COMPACTION_MODE_RECORD_VALUES.has(value)) {
    throw new Error(`Invalid compaction_mode_record value: ${String(value)} (expected a supported compaction mode record or null)`);
  }
  ensureSessionMetaRow(db, sessionId);
  db.prepare("UPDATE session_meta SET compaction_mode_record = ? WHERE session_id = ?").run(value, sessionId);
}
function protectedTailWindowBudget(usagePercentage, usable, perRunCap) {
  if (usagePercentage >= 95)
    return Math.min(1e6, Math.max(4 * perRunCap, Math.round(0.5 * usable)));
  if (usagePercentage >= 80)
    return Math.min(750000, Math.max(3 * perRunCap, Math.round(0.35 * usable)));
  return Math.min(500000, Math.max(perRunCap, Math.round(0.2 * usable)));
}
var EMERGENCY_DRAIN_EXIT_MARGIN = 10;
var EMERGENCY_DRAIN_FALLBACK_EXIT_PERCENTAGE = 55;
var EMERGENCY_DRAIN_FAILURE_BACKOFF_MS = 60000;
var EMERGENCY_DRAIN_MAX_LATCH_MS = 30 * 60 * 1000;
function emergencyDrainExitThreshold(executeThresholdPercentage) {
  if (!Number.isFinite(executeThresholdPercentage) || executeThresholdPercentage <= 0) {
    return EMERGENCY_DRAIN_FALLBACK_EXIT_PERCENTAGE;
  }
  return Math.max(0, executeThresholdPercentage - EMERGENCY_DRAIN_EXIT_MARGIN);
}
function resolvedEmergencyDrainLatch(meta, usagePercentage, executeThresholdPercentage, now) {
  const { forceMaterializationPercentage } = escalationBands(executeThresholdPercentage);
  if (usagePercentage >= forceMaterializationPercentage)
    return meta.emergencyDrainActive > 0 ? meta.emergencyDrainActive : now;
  if (usagePercentage < emergencyDrainExitThreshold(executeThresholdPercentage) || now - meta.emergencyDrainActive > EMERGENCY_DRAIN_MAX_LATCH_MS)
    return 0;
  return meta.emergencyDrainActive;
}
function drainFailureBackoffActive(meta, now) {
  return meta.historianDrainFailureAt > 0 && meta.historianDrainFailureAt <= now && now - meta.historianDrainFailureAt < EMERGENCY_DRAIN_FAILURE_BACKOFF_MS;
}
function getProtectedTailDrainBudgetSkip(args) {
  const now = args.now ?? Date.now();
  const meta = loadProtectedTailMeta(args.db, args.sessionId);
  const latch = resolvedEmergencyDrainLatch(meta, args.usagePercentage, args.executeThresholdPercentage, now);
  if (latch !== meta.emergencyDrainActive) {
    args.db.prepare("UPDATE session_meta SET emergency_drain_active = ? WHERE session_id = ? AND emergency_drain_active = ?").run(latch, args.sessionId, meta.emergencyDrainActive);
  }
  const startedAt = meta.protectedTailDrainWindowStartedAt;
  if (startedAt <= 0 || startedAt > now || now - startedAt >= DRAIN_WINDOW_MS)
    return null;
  const limitTokens = protectedTailWindowBudget(args.usagePercentage, args.usable, args.perRunCap);
  if (meta.protectedTailDrainTokens < limitTokens)
    return null;
  if (latch > 0 && !drainFailureBackoffActive(meta, now))
    return null;
  return {
    windowStartedAt: startedAt,
    resetsAt: startedAt + DRAIN_WINDOW_MS,
    nextEligibleAt: latch > 0 ? Math.min(startedAt + DRAIN_WINDOW_MS, meta.historianDrainFailureAt + EMERGENCY_DRAIN_FAILURE_BACKOFF_MS) : startedAt + DRAIN_WINDOW_MS,
    resetInMs: startedAt + DRAIN_WINDOW_MS - now,
    spentTokens: meta.protectedTailDrainTokens,
    limitTokens
  };
}
function reserveProtectedTailDrainTokens(args) {
  const now = args.now ?? Date.now();
  const requested = Math.max(0, Math.floor(args.trueRawTokens));
  if (requested === 0) {
    return {
      ok: true,
      reservedTokens: 0,
      overQuotaBypass: false,
      reservation: null,
      budgetState: null
    };
  }
  let result = {
    ok: false,
    reservedTokens: 0,
    overQuotaBypass: false,
    reservation: null,
    budgetState: null,
    skippedReason: "internal drain budget spent"
  };
  args.db.transaction(() => {
    ensureSessionMetaRow(args.db, args.sessionId);
    let meta = loadProtectedTailMeta(args.db, args.sessionId);
    const windowStartedAt = meta.protectedTailDrainWindowStartedAt;
    const windowExpired = windowStartedAt <= 0 || windowStartedAt > now || now - windowStartedAt >= DRAIN_WINDOW_MS;
    if (windowExpired) {
      args.db.prepare(`UPDATE session_meta
                     SET protected_tail_drain_window_started_at = ?, protected_tail_drain_tokens = 0
                     WHERE session_id = ?`).run(now, args.sessionId);
      meta = loadProtectedTailMeta(args.db, args.sessionId);
    }
    const latchActiveSince = resolvedEmergencyDrainLatch(meta, args.usagePercentage, args.executeThresholdPercentage, now);
    if (latchActiveSince !== meta.emergencyDrainActive) {
      args.db.prepare("UPDATE session_meta SET emergency_drain_active = ? WHERE session_id = ?").run(latchActiveSince, args.sessionId);
    }
    const latchActive = latchActiveSince > 0;
    const budget = protectedTailWindowBudget(args.usagePercentage, args.usable, args.perRunCap);
    const remaining = Math.max(0, budget - meta.protectedTailDrainTokens);
    let reserved = Math.min(requested, args.perRunCap, remaining);
    let bypass = false;
    const inFailureBackoff = drainFailureBackoffActive(meta, now);
    if (reserved <= 0 && latchActive && !inFailureBackoff) {
      reserved = Math.min(requested, args.perRunCap);
      bypass = true;
    }
    const activeWindowStartedAt = meta.protectedTailDrainWindowStartedAt;
    const budgetState = (spentTokens) => ({
      windowStartedAt: activeWindowStartedAt,
      resetsAt: activeWindowStartedAt + DRAIN_WINDOW_MS,
      resetInMs: Math.max(0, activeWindowStartedAt + DRAIN_WINDOW_MS - now),
      spentTokens,
      limitTokens: budget
    });
    if (reserved <= 0) {
      result = {
        ...result,
        budgetState: budgetState(meta.protectedTailDrainTokens)
      };
      return;
    }
    args.db.prepare(`UPDATE session_meta
                 SET protected_tail_drain_tokens = COALESCE(protected_tail_drain_tokens, 0) + ?
                 WHERE session_id = ?`).run(reserved, args.sessionId);
    result = {
      ok: true,
      reservedTokens: reserved,
      overQuotaBypass: bypass,
      reservation: {
        sessionId: args.sessionId,
        runId: args.runId,
        tokens: reserved,
        windowStartedAt: activeWindowStartedAt
      },
      budgetState: budgetState(meta.protectedTailDrainTokens + reserved)
    };
  }).immediate();
  return result;
}
function clearEmergencyDrainLatch(db, sessionId) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET emergency_drain_active = 0 WHERE session_id = ?").run(sessionId);
  }).immediate();
}
function recordHistorianDrainFailure(db, sessionId, now) {
  const ts = now ?? Date.now();
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET historian_drain_failure_at = ? WHERE session_id = ?").run(ts, sessionId);
  }).immediate();
}
function clearHistorianDrainFailure(db, sessionId) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET historian_drain_failure_at = 0 WHERE session_id = ?").run(sessionId);
  }).immediate();
}
function rollbackProtectedTailDrainReservation(db, reservation) {
  if (!reservation || reservation.tokens <= 0)
    return;
  db.transaction(() => {
    ensureSessionMetaRow(db, reservation.sessionId);
    db.prepare(`UPDATE session_meta
             SET protected_tail_drain_tokens = MAX(0, COALESCE(protected_tail_drain_tokens, 0) - ?)
             WHERE session_id = ? AND protected_tail_drain_window_started_at = ?`).run(reservation.tokens, reservation.sessionId, reservation.windowStartedAt);
  }).immediate();
}
function setPersistedReasoningWatermark(db, sessionId, tagNumber) {
  ensureSessionMetaRow(db, sessionId);
  db.prepare("UPDATE session_meta SET cleared_reasoning_through_tag = ? WHERE session_id = ?").run(tagNumber, sessionId);
}
function clearPersistedReasoningWatermark(db, sessionId) {
  setPersistedReasoningWatermark(db, sessionId, 0);
}
function isEmergencyInputSampleRow(row) {
  return typeof row === "object" && row !== null && typeof row.last_emergency_input_sample === "number";
}
function getEmergencyInputSample(db, sessionId) {
  const result = db.prepare("SELECT last_emergency_input_sample FROM session_meta WHERE session_id = ?").get(sessionId);
  return isEmergencyInputSampleRow(result) ? result.last_emergency_input_sample : 0;
}
function setEmergencyDropSample(db, sessionId, inputSample) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET last_emergency_input_sample = ? WHERE session_id = ?").run(Math.max(0, Math.round(inputSample)), sessionId);
  }).immediate();
}
function clearEmergencyDropSample(db, sessionId) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET last_emergency_input_sample = 0 WHERE session_id = ?").run(sessionId);
  }).immediate();
}
var EMPTY_CHANNEL1_NUDGE_STATE = { level: "", ordinal: 0 };
function isLastNudgeUndroppedRow(row) {
  return typeof row === "object" && row !== null && typeof row.last_nudge_undropped === "number";
}
function isLastNudgeLevelRow(row) {
  return typeof row === "object" && row !== null && typeof row.last_nudge_level === "string";
}
function normalizeLastNudgeLevel(value) {
  return value === "gentle" || value === "firm" || value === "urgent" ? value : "";
}
function parseChannel1NudgeState(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const state = {
        level: normalizeLastNudgeLevel(parsed.level),
        ordinal: typeof parsed.ordinal === "number" ? Math.max(0, Math.round(parsed.ordinal)) : 0
      };
      if (parsed.postReduceGracePending === true)
        state.postReduceGracePending = true;
      if (typeof parsed.postReduceGraceBaselineU === "number" && Number.isFinite(parsed.postReduceGraceBaselineU)) {
        state.postReduceGraceBaselineU = Math.max(0, Math.round(parsed.postReduceGraceBaselineU));
      }
      const preLevel = normalizeLastNudgeLevel(parsed.postReduceGracePreLevel);
      if (preLevel !== "" || parsed.postReduceGracePreLevel === "") {
        state.postReduceGracePreLevel = preLevel;
      }
      return state;
    }
  } catch {}
  return { level: normalizeLastNudgeLevel(raw), ordinal: 0 };
}
function serializeChannel1NudgeState(value) {
  const serialized = {
    level: normalizeLastNudgeLevel(value.level),
    ordinal: Math.max(0, Math.round(value.ordinal))
  };
  if (value.postReduceGracePending === true)
    serialized.postReduceGracePending = true;
  if (value.postReduceGraceBaselineU !== undefined) {
    serialized.postReduceGraceBaselineU = Math.max(0, Math.round(value.postReduceGraceBaselineU));
  }
  if (value.postReduceGracePreLevel !== undefined) {
    serialized.postReduceGracePreLevel = normalizeLastNudgeLevel(value.postReduceGracePreLevel);
  }
  return JSON.stringify(serialized);
}
function getLastNudgeUndropped(db, sessionId) {
  const result = db.prepare("SELECT last_nudge_undropped FROM session_meta WHERE session_id = ?").get(sessionId);
  return isLastNudgeUndroppedRow(result) ? result.last_nudge_undropped : 0;
}
function setLastNudgeUndropped(db, sessionId, value) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET last_nudge_undropped = ? WHERE session_id = ?").run(Math.max(0, Math.round(value)), sessionId);
  }).immediate();
}
function getChannel1NudgeState(db, sessionId) {
  const result = db.prepare("SELECT last_nudge_level FROM session_meta WHERE session_id = ?").get(sessionId);
  return isLastNudgeLevelRow(result) ? parseChannel1NudgeState(result.last_nudge_level) : EMPTY_CHANNEL1_NUDGE_STATE;
}
function setChannel1NudgeState(db, sessionId, value) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET last_nudge_level = ? WHERE session_id = ?").run(serializeChannel1NudgeState(value), sessionId);
  }).immediate();
}
function markChannel1PostReduceGracePending(db, sessionId) {
  return db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    const current = getChannel1NudgeState(db, sessionId);
    const next = {
      level: current.level,
      ordinal: current.ordinal,
      postReduceGracePending: true,
      postReduceGracePreLevel: current.level
    };
    db.prepare("UPDATE session_meta SET last_nudge_level = ? WHERE session_id = ?").run(serializeChannel1NudgeState(next), sessionId);
    return next;
  }).immediate();
}
function captureChannel1PostReduceGraceBaseline(db, sessionId, measuredUndropped) {
  return db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    const current = getChannel1NudgeState(db, sessionId);
    if (current.postReduceGracePending !== true)
      return current;
    const baselineU = Math.max(0, Math.round(measuredUndropped));
    const next = {
      level: current.level,
      ordinal: current.ordinal,
      postReduceGraceBaselineU: baselineU,
      postReduceGracePreLevel: current.postReduceGracePreLevel ?? current.level
    };
    db.prepare("UPDATE session_meta SET last_nudge_level = ? WHERE session_id = ?").run(serializeChannel1NudgeState(next), sessionId);
    return next;
  }).immediate();
}
function isChannel2StateRow(row) {
  return typeof row === "object" && row !== null && typeof row.channel2_nudge_state === "string";
}
function getChannel2NudgeState(db, sessionId) {
  const result = db.prepare("SELECT channel2_nudge_state FROM session_meta WHERE session_id = ?").get(sessionId);
  if (!isChannel2StateRow(result))
    return "";
  const raw = result.channel2_nudge_state;
  return raw === "pending" || raw === "claimed" || raw === "delivered" ? raw : "";
}
function getChannel2NudgeClaim(db, sessionId) {
  const result = db.prepare("SELECT channel2_nudge_state, channel2_nudge_claimed_at, channel2_nudge_claim_token FROM session_meta WHERE session_id = ?").get(sessionId);
  const rawState = typeof result?.channel2_nudge_state === "string" ? result.channel2_nudge_state : "";
  const state = rawState === "pending" || rawState === "claimed" || rawState === "delivered" ? rawState : "";
  return {
    state,
    claimedAt: typeof result?.channel2_nudge_claimed_at === "number" ? result.channel2_nudge_claimed_at : 0,
    claimToken: typeof result?.channel2_nudge_claim_token === "string" ? result.channel2_nudge_claim_token : ""
  };
}
function setChannel2NudgeState(db, sessionId, state) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    const claimedAt = state === "claimed" ? Date.now() : 0;
    db.prepare("UPDATE session_meta SET channel2_nudge_state = ?, channel2_nudge_claimed_at = ?, channel2_nudge_claim_token = '' WHERE session_id = ?").run(state, claimedAt, sessionId);
  }).immediate();
}
function casChannel2NudgeState(db, sessionId, from, to) {
  let changed = false;
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    const claimedAt = to === "claimed" ? Date.now() : 0;
    const result = db.prepare("UPDATE session_meta SET channel2_nudge_state = ?, channel2_nudge_claimed_at = ?, channel2_nudge_claim_token = '' WHERE session_id = ? AND channel2_nudge_state = ?").run(to, claimedAt, sessionId, from);
    changed = (result.changes ?? 0) > 0;
  }).immediate();
  return changed;
}
function claimChannel2NudgeState(db, sessionId, claimToken) {
  let changed = false;
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    const result = db.prepare("UPDATE session_meta SET channel2_nudge_state = 'claimed', channel2_nudge_claimed_at = ?, channel2_nudge_claim_token = ? WHERE session_id = ? AND channel2_nudge_state = 'pending'").run(Date.now(), claimToken, sessionId);
    changed = (result.changes ?? 0) > 0;
  }).immediate();
  return changed;
}
function casChannel2NudgeClaim(db, sessionId, to, claimToken) {
  let changed = false;
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    const claimedAt = to === "claimed" ? Date.now() : 0;
    const nextClaimToken = to === "claimed" ? claimToken : "";
    const result = db.prepare("UPDATE session_meta SET channel2_nudge_state = ?, channel2_nudge_claimed_at = ?, channel2_nudge_claim_token = ? WHERE session_id = ? AND channel2_nudge_state = 'claimed' AND channel2_nudge_claim_token = ?").run(to, claimedAt, nextClaimToken, sessionId, claimToken);
    changed = (result.changes ?? 0) > 0;
  }).immediate();
  return changed;
}
function getPersistedNoteNudge(db, sessionId) {
  const result = db.prepare("SELECT note_nudge_trigger_pending, note_nudge_trigger_message_id, note_nudge_sticky_text, note_nudge_sticky_message_id FROM session_meta WHERE session_id = ?").get(sessionId);
  if (!isPersistedNoteNudgeRow(result)) {
    return getDefaultPersistedNoteNudge();
  }
  return {
    triggerPending: result.note_nudge_trigger_pending === 1,
    triggerMessageId: result.note_nudge_trigger_message_id.length > 0 ? result.note_nudge_trigger_message_id : null,
    stickyText: result.note_nudge_sticky_text.length > 0 ? result.note_nudge_sticky_text : null,
    stickyMessageId: result.note_nudge_sticky_message_id.length > 0 ? result.note_nudge_sticky_message_id : null
  };
}
function setPersistedNoteNudgeTrigger(db, sessionId, triggerMessageId = "") {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET note_nudge_trigger_pending = 1, note_nudge_trigger_message_id = ? WHERE session_id = ?").run(triggerMessageId, sessionId);
  }).immediate();
}
function setPersistedNoteNudgeTriggerMessageId(db, sessionId, triggerMessageId) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET note_nudge_trigger_message_id = ? WHERE session_id = ?").run(triggerMessageId, sessionId);
  }).immediate();
}
function getNoteNudgeAnchors(db, sessionId) {
  const row = db.prepare("SELECT note_nudge_anchors FROM session_meta WHERE session_id = ?").get(sessionId);
  return parseJsonArray(row?.note_nudge_anchors, isValidNoteNudgeAnchor);
}
function getAutoSearchHintDecisions(db, sessionId) {
  const row = db.prepare("SELECT auto_search_hint_decisions FROM session_meta WHERE session_id = ?").get(sessionId);
  return parseJsonArray(row?.auto_search_hint_decisions, isValidAutoSearchHintDecision);
}
function casUpdateJsonArrayColumn(db, sessionId, column, validator, mutate, options) {
  if (column !== "note_nudge_anchors" && column !== "auto_search_hint_decisions") {
    throw new Error(`casUpdateJsonArrayColumn: refusing unknown column "${column}"`);
  }
  if (options?.ensureRow === false) {
    const exists = db.prepare("SELECT 1 FROM session_meta WHERE session_id = ?").get(sessionId);
    if (!exists)
      return true;
  } else {
    ensureSessionMetaRow(db, sessionId);
  }
  for (let attempt = 0;attempt < CAS_RETRY_LIMIT2; attempt += 1) {
    const row = db.prepare(`SELECT ${column} FROM session_meta WHERE session_id = ?`).get(sessionId);
    const rawCurrent = row?.[column] ?? null;
    const currentBlob = rawCurrent ?? "[]";
    const current = parseJsonArray(currentBlob, validator);
    const next = mutate(current);
    if (next === null)
      return true;
    const nextBlob = stableStringify(next);
    if (nextBlob === currentBlob)
      return true;
    const result = db.prepare(`UPDATE session_meta SET ${column} = ? WHERE session_id = ? AND ${column} IS ?`).run(nextBlob, sessionId, rawCurrent);
    if (result.changes > 0)
      return true;
  }
  sessionLog2(sessionId, `${column} CAS: ${CAS_RETRY_LIMIT2} retries exhausted`);
  return false;
}
function deliverNoteNudgeAtomic(db, sessionId, messageId, text) {
  let plan = null;
  const casOk = casUpdateJsonArrayColumn(db, sessionId, "note_nudge_anchors", isValidNoteNudgeAnchor, (current) => {
    if (current.some((anchor) => anchor.messageId === messageId && anchor.text === text)) {
      plan = { kind: "already-present" };
      return null;
    }
    if (current.some((anchor) => anchor.messageId === messageId)) {
      plan = { kind: "conflict" };
      sessionLog2(sessionId, "note-nudge: messageId conflict, refusing append");
      return null;
    }
    plan = { kind: "appended" };
    return [...current, { messageId, text }];
  });
  if (!casOk) {
    sessionLog2(sessionId, `note-nudge: CAS exhausted for ${messageId}; skipping wire append`);
    return { ok: false, kind: "cas-exhausted" };
  }
  const committedPlan = plan;
  if (!committedPlan) {
    sessionLog2(sessionId, "note-nudge: CAS reported success with no plan staged; treating as failure");
    return { ok: false, kind: "cas-exhausted" };
  }
  if (committedPlan.kind === "conflict") {
    return { ok: false, kind: "conflict" };
  }
  db.prepare("UPDATE session_meta SET note_nudge_trigger_pending = 0, note_nudge_trigger_message_id = '' WHERE session_id = ?").run(sessionId);
  return { ok: true, kind: committedPlan.kind };
}
function appendAutoSearchHintDecision(db, sessionId, entry) {
  if (!entry.messageId)
    return { ok: false, kind: "cas-exhausted" };
  let staged = null;
  const casOk = casUpdateJsonArrayColumn(db, sessionId, "auto_search_hint_decisions", isValidAutoSearchHintDecision, (current) => {
    const existing = current.find((decision) => decision.messageId === entry.messageId);
    if (existing) {
      staged = { kind: "already-present", decision: existing };
      return null;
    }
    staged = { kind: "appended", decision: entry };
    return [...current, entry];
  });
  if (!casOk)
    return { ok: false, kind: "cas-exhausted" };
  const committed = staged;
  if (!committed) {
    sessionLog2(sessionId, "auto-search: CAS reported success with no staged outcome");
    return { ok: false, kind: "cas-exhausted" };
  }
  return { ok: true, kind: committed.kind, decision: committed.decision };
}
function pruneNoteNudgeAnchors(db, sessionId, visibleMessageIds) {
  let pruned = 0;
  casUpdateJsonArrayColumn(db, sessionId, "note_nudge_anchors", isValidNoteNudgeAnchor, (current) => {
    const next = current.filter((anchor) => visibleMessageIds.has(anchor.messageId));
    pruned = current.length - next.length;
    return pruned > 0 ? next : null;
  });
  return pruned;
}
var pendingAutoSearchRetirements = new WeakMap;
var AUTO_SEARCH_DECISION_SOFT_LIMIT = 2000;
function queueAutoSearchHintDecisionRetirement(db, sessionId, messageIds) {
  if (messageIds.size === 0)
    return;
  let sessions = pendingAutoSearchRetirements.get(db);
  if (!sessions) {
    sessions = new Map;
    pendingAutoSearchRetirements.set(db, sessions);
  }
  let retired = sessions.get(sessionId);
  if (!retired) {
    retired = new Set;
    sessions.set(sessionId, retired);
  }
  for (const id of messageIds)
    retired.add(id);
}
function flushAutoSearchHintDecisionRetirement(db, sessionId, visibleMessageIds) {
  const sessions = pendingAutoSearchRetirements.get(db);
  const retired = sessions?.get(sessionId) ?? new Set;
  const outcome = updateAutoSearchHintRetirement(db, sessionId, retired, visibleMessageIds);
  if (outcome.ok)
    sessions?.delete(sessionId);
  return outcome.pruned;
}
function updateAutoSearchHintRetirement(db, sessionId, retiredMessageIds, visibleMessageIds) {
  let pruned = 0;
  const ok = casUpdateJsonArrayColumn(db, sessionId, "auto_search_hint_decisions", isValidAutoSearchHintDecision, (current) => {
    let next = current.filter((decision) => !retiredMessageIds.has(decision.messageId) || visibleMessageIds?.has(decision.messageId));
    let excess = next.length - AUTO_SEARCH_DECISION_SOFT_LIMIT;
    if (visibleMessageIds && excess > 0) {
      next = next.filter((decision) => {
        if (excess > 0 && decision.decision === "no-hint" && !visibleMessageIds.has(decision.messageId)) {
          excess--;
          return false;
        }
        return true;
      });
    }
    pruned = current.length - next.length;
    return pruned > 0 ? next : null;
  }, { ensureRow: false });
  return { ok, pruned: ok ? pruned : 0 };
}
function parsePersistedTodoSyntheticAnchor(result) {
  if (!isPersistedTodoSyntheticAnchorRow(result))
    return null;
  if (result.todo_synthetic_call_id.length === 0 || result.todo_synthetic_anchor_message_id.length === 0) {
    return null;
  }
  return {
    callId: result.todo_synthetic_call_id,
    messageId: result.todo_synthetic_anchor_message_id,
    stateJson: result.todo_synthetic_state_json
  };
}
function getPersistedTodoSyntheticAnchor(db, sessionId) {
  const result = db.prepare("SELECT todo_synthetic_call_id, todo_synthetic_anchor_message_id, todo_synthetic_state_json FROM session_meta WHERE session_id = ?").get(sessionId);
  return parsePersistedTodoSyntheticAnchor(result);
}
function setPersistedTodoSyntheticAnchor(db, sessionId, callId, messageId, stateJson) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET todo_synthetic_call_id = ?, todo_synthetic_anchor_message_id = ?, todo_synthetic_state_json = ? WHERE session_id = ?").run(callId, messageId, stateJson, sessionId);
  }).immediate();
}
function clearPersistedTodoSyntheticAnchor(db, sessionId) {
  db.prepare("UPDATE session_meta SET todo_synthetic_call_id = '', todo_synthetic_anchor_message_id = '', todo_synthetic_state_json = '' WHERE session_id = ?").run(sessionId);
}
function getNoteLastReadAt(db, sessionId) {
  try {
    const result = db.prepare("SELECT note_last_read_at FROM session_meta WHERE session_id = ?").get(sessionId);
    if (!result || typeof result !== "object")
      return 0;
    const value = result.note_last_read_at;
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}
function setNoteLastReadAt(db, sessionId, at = Date.now()) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET note_last_read_at = ? WHERE session_id = ?").run(at, sessionId);
  }).immediate();
}
function getHistorianFailureState(db, sessionId) {
  const result = db.prepare("SELECT historian_failure_count, historian_last_error, historian_last_failure_at FROM session_meta WHERE session_id = ?").get(sessionId);
  return parseHistorianFailureState(result);
}
function incrementHistorianFailure(db, sessionId, error) {
  let nextCount = 1;
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    const current = getHistorianFailureState(db, sessionId);
    nextCount = current.failureCount + 1;
    db.prepare("UPDATE session_meta SET historian_failure_count = ?, historian_last_error = ?, historian_last_failure_at = ? WHERE session_id = ?").run(nextCount, error, Date.now(), sessionId);
    const reason = error.replace(/\s+/g, " ").trim().slice(0, 300);
    sessionLog2(sessionId, `historian failure recorded: count=${nextCount} reason="${reason}"`);
  }).immediate();
  return nextCount;
}
function clearHistorianFailureState(db, sessionId) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET historian_failure_count = 0, historian_last_error = NULL, historian_last_failure_at = NULL WHERE session_id = ?").run(sessionId);
  }).immediate();
}
function normalizeDetectedLimitModelKey(modelKey) {
  return typeof modelKey === "string" && modelKey.length > 0 ? piModelRefToCanonical(modelKey) : null;
}
function normalizeEmergencyRecoveryOrigin(value) {
  return value === "provider_overflow" || value === "proactive_model_shrink" || value === "history_boundary_over_window" ? value : null;
}
function parseOverflowState(result, modelKey) {
  if (!result) {
    return {
      detectedContextLimit: 0,
      detectedContextLimitModelKey: null,
      detectedContextLimitProvenance: "unknown",
      needsEmergencyRecovery: false,
      emergencyRecoveryOrigin: null
    };
  }
  const storedModelKey = normalizeDetectedLimitModelKey(result.detected_context_limit_model_key);
  const requestedModelKey = normalizeDetectedLimitModelKey(modelKey);
  const provenance = normalizeContextLimitProvenance(result.detected_context_limit_provenance);
  const limit = typeof result.detected_context_limit === "number" && result.detected_context_limit > 0 ? result.detected_context_limit : 0;
  const modelMatches = requestedModelKey ? storedModelKey !== null && requestedModelKey === storedModelKey : true;
  const needs = typeof result.needs_emergency_recovery === "number" && result.needs_emergency_recovery > 0;
  const persistedOrigin = normalizeEmergencyRecoveryOrigin(result.emergency_recovery_origin);
  const recoveryOrigin = needs ? persistedOrigin ?? (limit > 0 ? "provider_overflow" : null) : null;
  return {
    detectedContextLimit: modelMatches ? limit : 0,
    detectedContextLimitModelKey: storedModelKey,
    detectedContextLimitProvenance: provenance,
    needsEmergencyRecovery: needs,
    emergencyRecoveryOrigin: recoveryOrigin
  };
}
function getOverflowState(db, sessionId, modelKey) {
  const result = db.prepare("SELECT detected_context_limit, detected_context_limit_model_key, detected_context_limit_provenance, needs_emergency_recovery, emergency_recovery_origin FROM session_meta WHERE session_id = ?").get(sessionId);
  return parseOverflowState(result, modelKey);
}
function recordOverflowDetected(db, sessionId, reportedLimit, modelKey, origin = "provider_overflow", provenance = "unknown", reportedInputTokens) {
  emergencyRecoveryArmedSessions.add(sessionId);
  emergencyRecoveryArmedAtBySession.set(sessionId, Date.now());
  if (origin === "provider_overflow" && typeof reportedLimit === "number" && reportedLimit > 0) {
    providerOverflowKnownLimitSessions.add(sessionId);
  }
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    const prior = db.prepare("SELECT needs_emergency_recovery, detected_context_limit FROM session_meta WHERE session_id = ?").get(sessionId);
    if (origin === "provider_overflow" && typeof prior?.needs_emergency_recovery === "number" && prior.needs_emergency_recovery > 0) {
      providerOverflowReconfirmedSessions.add(sessionId);
    }
    if (typeof reportedLimit === "number" && reportedLimit > 0) {
      db.prepare("UPDATE session_meta SET detected_context_limit = ?, detected_context_limit_model_key = ?, detected_context_limit_provenance = ?, needs_emergency_recovery = 1, emergency_recovery_origin = ?, observed_safe_input_tokens = 0, cache_alert_sent = 0 WHERE session_id = ?").run(reportedLimit, normalizeDetectedLimitModelKey(modelKey), normalizeContextLimitProvenance(provenance), origin, sessionId);
    } else {
      db.prepare("UPDATE session_meta SET needs_emergency_recovery = 1, emergency_recovery_origin = ?, observed_safe_input_tokens = 0, cache_alert_sent = 0 WHERE session_id = ?").run(origin, sessionId);
    }
    if (origin === "provider_overflow" && typeof reportedInputTokens === "number" && Number.isFinite(reportedInputTokens) && reportedInputTokens > 0) {
      const effectiveLimit = typeof reportedLimit === "number" && reportedLimit > 0 ? reportedLimit : prior?.detected_context_limit ?? 0;
      const percentage = effectiveLimit > 0 ? reportedInputTokens / effectiveLimit * 100 : 100;
      db.prepare("UPDATE session_meta SET last_input_tokens = ?, last_context_percentage = MAX(last_context_percentage, ?) WHERE session_id = ?").run(reportedInputTokens, percentage, sessionId);
    }
  }).immediate();
}
function clearEmergencyRecovery(db, sessionId) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    try {
      db.prepare("UPDATE session_meta SET needs_emergency_recovery = 0, emergency_recovery_origin = '', recovery_no_eligible_head_count = 0 WHERE session_id = ?").run(sessionId);
    } catch {
      db.prepare("UPDATE session_meta SET needs_emergency_recovery = 0, emergency_recovery_origin = '' WHERE session_id = ?").run(sessionId);
    }
  }).immediate();
  emergencyRecoveryArmedSessions.delete(sessionId);
  emergencyRecoveryArmedAtBySession.delete(sessionId);
  providerOverflowReconfirmedSessions.delete(sessionId);
  providerOverflowKnownLimitSessions.delete(sessionId);
}
function clearDetectedContextLimit(db, sessionId) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    db.prepare("UPDATE session_meta SET detected_context_limit = 0, detected_context_limit_model_key = NULL, detected_context_limit_provenance = 'unknown' WHERE session_id = ?").run(sessionId);
  }).immediate();
}
function parsePersistedCompactionMarkerState(raw, storedTargetEndMessageId) {
  if (!raw || raw.length === 0)
    return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.boundaryMessageId === "string" && typeof parsed.summaryMessageId === "string" && typeof parsed.compactionPartId === "string" && typeof parsed.summaryPartId === "string" && typeof parsed.boundaryOrdinal === "number") {
      const targetEndMessageId = typeof storedTargetEndMessageId === "string" && storedTargetEndMessageId.length > 0 ? storedTargetEndMessageId : typeof parsed.targetEndMessageId === "string" && parsed.targetEndMessageId.length > 0 ? parsed.targetEndMessageId : null;
      return {
        boundaryMessageId: parsed.boundaryMessageId,
        summaryMessageId: parsed.summaryMessageId,
        compactionPartId: parsed.compactionPartId,
        summaryPartId: parsed.summaryPartId,
        boundaryOrdinal: parsed.boundaryOrdinal,
        targetEndMessageId
      };
    }
  } catch {}
  return null;
}
function getPersistedCompactionMarkerState(db, sessionId) {
  const row = db.prepare("SELECT compaction_marker_state, compaction_marker_target_end_message_id FROM session_meta WHERE session_id = ?").get(sessionId);
  return parsePersistedCompactionMarkerState(row?.compaction_marker_state, row?.compaction_marker_target_end_message_id);
}
function getCompactionMarkerPublicationState(db, sessionId) {
  const row = db.prepare("SELECT compaction_marker_state FROM session_meta WHERE session_id = ?").get(sessionId);
  const raw = row?.compaction_marker_state ?? "";
  let pending = null;
  try {
    pending = parsePersistedCompactionMarkerState(JSON.stringify(JSON.parse(raw).pending));
  } catch {}
  return { raw, pending };
}
function compareAndSetCompactionMarkerPublicationState(db, sessionId, expectedRaw, state, pending) {
  return db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    let envelope = {};
    if (pending) {
      try {
        const parsed = JSON.parse(expectedRaw);
        if (parsed && typeof parsed === "object")
          envelope = parsed;
      } catch {}
    }
    const raw = JSON.stringify(pending ? { ...envelope, pending } : state);
    const result = db.prepare(`UPDATE session_meta SET compaction_marker_state = ?, compaction_marker_target_end_message_id = ?
             WHERE session_id = ? AND COALESCE(compaction_marker_state, '') = ?`).run(raw, state?.targetEndMessageId ?? null, sessionId, expectedRaw);
    if (result.changes !== 1)
      throw new Error("marker publication state changed concurrently");
    return raw;
  }).immediate();
}
function getDeferredClearedCompactionMarkerState(db, sessionId) {
  const row = db.prepare("SELECT compaction_marker_state FROM session_meta WHERE session_id = ?").get(sessionId);
  try {
    const parsed = JSON.parse(row?.compaction_marker_state || "null");
    return parsePersistedCompactionMarkerState(JSON.stringify(parsed?.deferredClear));
  } catch {
    return null;
  }
}
var MAX_STRIPPED_PLACEHOLDER_IDS = 4096;
function parseStrippedPlaceholderState(raw) {
  if (!raw || raw.length === 0)
    return { ids: [], hiddenSeamIds: [] };
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        ids: parsed.filter((value) => typeof value === "string"),
        hiddenSeamIds: []
      };
    }
    if (parsed && typeof parsed === "object") {
      const state = parsed;
      return {
        ids: Array.isArray(state.ids) ? state.ids.filter((value) => typeof value === "string") : [],
        hiddenSeamIds: Array.isArray(state.hiddenSeamIds) ? state.hiddenSeamIds.filter((value) => typeof value === "string") : []
      };
    }
  } catch {}
  return { ids: [], hiddenSeamIds: [] };
}
function parseStrippedBlob(raw) {
  if (!raw || raw.length === 0)
    return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}
function serializeStrippedPlaceholderState(state) {
  if (state.ids.length === 0)
    return "";
  if (state.hiddenSeamIds.length === 0)
    return JSON.stringify(state.ids);
  return JSON.stringify(state);
}
function getStrippedPlaceholderIds(db, sessionId) {
  const row = db.prepare("SELECT stripped_placeholder_ids FROM session_meta WHERE session_id = ?").get(sessionId);
  return new Set(parseStrippedPlaceholderState(row?.stripped_placeholder_ids).ids);
}
function applyStrippedPlaceholderDelta(db, sessionId, delta) {
  const add = delta.add ? [...delta.add] : [];
  const remove = delta.remove ? [...delta.remove] : [];
  const hiddenSeamAdd = delta.hiddenSeamAdd ? [...delta.hiddenSeamAdd] : [];
  if (add.length === 0 && remove.length === 0 && hiddenSeamAdd.length === 0)
    return true;
  ensureSessionMetaRow(db, sessionId);
  for (let attempt = 0;attempt < CAS_RETRY_LIMIT2; attempt += 1) {
    const row = db.prepare("SELECT stripped_placeholder_ids FROM session_meta WHERE session_id = ?").get(sessionId);
    const rawStored = row ? row.stripped_placeholder_ids ?? null : null;
    const parsed = parseStrippedPlaceholderState(rawStored);
    const current = new Set(parsed.ids);
    const hiddenSeamIds = new Set(parsed.hiddenSeamIds);
    for (const id of add)
      current.add(id);
    for (const id of hiddenSeamAdd) {
      current.add(id);
      hiddenSeamIds.add(id);
    }
    for (const id of remove) {
      current.delete(id);
      hiddenSeamIds.delete(id);
    }
    const boundedIds = [...current].slice(-MAX_STRIPPED_PLACEHOLDER_IDS);
    const boundedSet = new Set(boundedIds);
    const nextBlob = serializeStrippedPlaceholderState({
      ids: boundedIds,
      hiddenSeamIds: [...hiddenSeamIds].filter((id) => boundedSet.has(id))
    });
    if (nextBlob === (rawStored ?? ""))
      return true;
    const result = db.prepare("UPDATE session_meta SET stripped_placeholder_ids = ? WHERE session_id = ? AND stripped_placeholder_ids IS ?").run(nextBlob, sessionId, rawStored);
    if (result.changes > 0)
      return true;
  }
  sessionLog2(sessionId, `stripped_placeholder_ids CAS: ${CAS_RETRY_LIMIT2} retries exhausted`);
  return false;
}
var THINKING_BINDING_RECOVERY_ALL_ASSISTANTS = "all_reasoning_bearing_assistants";
var THINKING_BINDING_RECOVERY_FROZEN_PREFIX = "binding_mismatch:";
var THINKING_BINDING_STRIP_ORDER_END_MARKER = "binding_mismatch_order:end";
function thinkingBindingRecoveryFrozenId(messageId) {
  return `${THINKING_BINDING_RECOVERY_FROZEN_PREFIX}${messageId}`;
}
var COMPACTION_OFF_THINKING_FROZEN_PREFIX = "compaction_off_thinking:";
function getThinkingBindingRecoveryTarget(db, sessionId) {
  const row = db.prepare("SELECT thinking_binding_recovery_target FROM session_meta WHERE session_id = ?").get(sessionId);
  const target = row?.thinking_binding_recovery_target;
  return typeof target === "string" && target.length > 0 ? target : null;
}
function armThinkingBindingRecovery(db, sessionId) {
  ensureSessionMetaRow(db, sessionId);
  db.prepare("UPDATE session_meta SET thinking_binding_recovery_target = ? WHERE session_id = ?").run(THINKING_BINDING_RECOVERY_ALL_ASSISTANTS, sessionId);
  bindingRecoveriesAwaitingClear.delete(sessionId);
}
var bindingRecoveriesAwaitingClear = new Map;
function clearThinkingBindingRecoveryIf(db, sessionId, expectedTarget) {
  const result = db.prepare("UPDATE session_meta SET thinking_binding_recovery_target = '' WHERE session_id = ? AND thinking_binding_recovery_target = ?").run(sessionId, expectedTarget);
  return result.changes > 0;
}
function getMergedReasoningStrippedIds(db, sessionId) {
  const row = db.prepare("SELECT merged_reasoning_stripped_ids FROM session_meta WHERE session_id = ?").get(sessionId);
  return new Set(parseStrippedBlob(row?.merged_reasoning_stripped_ids));
}
function addMergedReasoningStrippedIds(db, sessionId, ids) {
  const add = [...ids];
  if (add.length === 0)
    return true;
  ensureSessionMetaRow(db, sessionId);
  for (let attempt = 0;attempt < CAS_RETRY_LIMIT2; attempt += 1) {
    const row = db.prepare("SELECT merged_reasoning_stripped_ids FROM session_meta WHERE session_id = ?").get(sessionId);
    const rawStored = row ? row.merged_reasoning_stripped_ids ?? null : null;
    const current = new Set(parseStrippedBlob(rawStored));
    const frozenParts = readFrozenMergedReasoningParts(current);
    let changed = false;
    for (const id of add) {
      const decision = decodeMergedReasoningParts(id);
      if (decision && frozenParts.has(decision[0]))
        continue;
      if (!current.has(id)) {
        current.add(id);
        if (decision)
          frozenParts.set(...decision);
        changed = true;
      }
    }
    if (!changed)
      return true;
    const nextBlob = JSON.stringify([...current]);
    const result = db.prepare("UPDATE session_meta SET merged_reasoning_stripped_ids = ? WHERE session_id = ? AND merged_reasoning_stripped_ids IS ?").run(nextBlob, sessionId, rawStored);
    if (result.changes > 0)
      return true;
  }
  sessionLog2(sessionId, `merged_reasoning_stripped_ids CAS: ${CAS_RETRY_LIMIT2} retries exhausted`);
  return false;
}
function getProcessedImageStrippedIds(db, sessionId) {
  return new Set(getProcessedImageMarkers(db, sessionId).keys());
}
function parseProcessedImageMarkers(raw) {
  if (!raw)
    return new Map;
  try {
    const parsed = JSON.parse(raw);
    const ids = Array.isArray(parsed) ? parsed : parsed?.ids;
    const textIds = new Set(Array.isArray(parsed?.textMarkerIds) ? parsed.textMarkerIds : []);
    return new Map((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string").map((id) => [id, textIds.has(id) ? "[image stripped]" : ""]));
  } catch {
    return new Map;
  }
}
function serializeProcessedImageMarkers(markers) {
  const ids = [...markers.keys()];
  if (ids.length === 0)
    return "";
  const textMarkerIds = ids.filter((id) => markers.get(id) === "[image stripped]");
  return JSON.stringify(textMarkerIds.length > 0 ? { ids, textMarkerIds } : ids);
}
function getProcessedImageMarkers(db, sessionId) {
  const row = db.prepare("SELECT processed_image_stripped_ids FROM session_meta WHERE session_id = ?").get(sessionId);
  return parseProcessedImageMarkers(row?.processed_image_stripped_ids);
}
function addProcessedImageStrippedIds(db, sessionId, ids, marker = "") {
  const add = [...ids];
  if (add.length === 0)
    return true;
  ensureSessionMetaRow(db, sessionId);
  for (let attempt = 0;attempt < CAS_RETRY_LIMIT2; attempt += 1) {
    const row = db.prepare("SELECT processed_image_stripped_ids FROM session_meta WHERE session_id = ?").get(sessionId);
    const rawStored = row ? row.processed_image_stripped_ids ?? null : null;
    const current = parseProcessedImageMarkers(rawStored);
    let changed = false;
    for (const id of add) {
      if (!current.has(id)) {
        current.set(id, typeof marker === "string" ? marker : marker.get(id) ?? "");
        changed = true;
      }
    }
    if (!changed)
      return true;
    const nextBlob = serializeProcessedImageMarkers(current);
    const result = db.prepare("UPDATE session_meta SET processed_image_stripped_ids = ? WHERE session_id = ? AND processed_image_stripped_ids IS ?").run(nextBlob, sessionId, rawStored);
    if (result.changes > 0)
      return true;
  }
  sessionLog2(sessionId, `processed_image_stripped_ids CAS: ${CAS_RETRY_LIMIT2} retries exhausted`);
  return false;
}
function isPendingCompactionMarker(value) {
  return typeof value === "object" && value !== null && typeof value.ordinal === "number" && typeof value.endMessageId === "string" && typeof value.publishedAt === "number" && (value.injectAttempts === undefined || typeof value.injectAttempts === "number" && Number.isSafeInteger(value.injectAttempts) && value.injectAttempts >= 0) && (value.lastInjectError === undefined || value.lastInjectError === null || typeof value.lastInjectError === "string") && (value.firstInjectFailedAt === undefined || value.firstInjectFailedAt === null || typeof value.firstInjectFailedAt === "number");
}
function parsePendingCompactionMarkerState(raw) {
  if (raw === null || raw === undefined || raw === "")
    return null;
  try {
    const parsed = JSON.parse(raw);
    if (isPendingCompactionMarker(parsed))
      return parsed;
  } catch {}
  return null;
}
function getPendingCompactionMarkerState(db, sessionId) {
  const row = db.prepare("SELECT pending_compaction_marker_state FROM session_meta WHERE session_id = ?").get(sessionId);
  return parsePendingCompactionMarkerState(row?.pending_compaction_marker_state);
}
var COMPACTION_MARKER_ATTEMPT_BUDGET = 3;
var COMPACTION_MARKER_PENDING_BUDGET_MS = 5 * 60000;
function getCompactionMarkerHealth(db, sessionId, now = Date.now()) {
  const pending = getPendingCompactionMarkerState(db, sessionId);
  const attempts = pending?.injectAttempts ?? 0;
  const firstFailedAt = pending?.firstInjectFailedAt ?? null;
  const exhausted = attempts >= COMPACTION_MARKER_ATTEMPT_BUDGET || firstFailedAt !== null && now - firstFailedAt >= COMPACTION_MARKER_PENDING_BUDGET_MS;
  return {
    code: exhausted ? "MC-C11" : null,
    attempts,
    lastError: pending?.lastInjectError ?? null,
    pendingSinceMs: firstFailedAt
  };
}
function executeReclaimFromReplay(raw) {
  try {
    return parseReplayDocument(raw).executeReclaim;
  } catch {
    return;
  }
}
function loadPostprocessReplaySnapshot(db, sessionId) {
  const row = db.prepare(`SELECT stale_reduce_stripped_ids, processed_image_stripped_ids,
                    stripped_placeholder_ids, note_nudge_anchors,
                    auto_search_hint_decisions, todo_permission_denied,
                    todo_synthetic_call_id, todo_synthetic_anchor_message_id,
                    todo_synthetic_state_json, pending_compaction_marker_state,
                    compaction_marker_state, compaction_marker_target_end_message_id,
                    merged_reasoning_stripped_ids, thinking_binding_recovery_target,
                    trailing_blank_decisions
               FROM session_meta WHERE session_id = ?`).get(sessionId);
  const placeholders = parseStrippedPlaceholderState(row?.stripped_placeholder_ids);
  const todoPermissionDenied = row?.todo_permission_denied === 1 ? true : row?.todo_permission_denied === 0 ? false : null;
  const thinkingBindingRecoveryTarget = row?.thinking_binding_recovery_target;
  return {
    servedShapeRepair: (() => {
      try {
        return parseReplayDocument(row?.trailing_blank_decisions).servedShapeRepair;
      } catch {
        return;
      }
    })(),
    executeReclaim: executeReclaimFromReplay(row?.trailing_blank_decisions),
    staleReduceStrippedIds: new Set(parseStrippedBlob(row?.stale_reduce_stripped_ids)),
    processedImageStrippedIds: new Set(parseProcessedImageMarkers(row?.processed_image_stripped_ids).keys()),
    processedImageMarkers: parseProcessedImageMarkers(row?.processed_image_stripped_ids),
    strippedPlaceholderIds: new Set(placeholders.ids),
    hiddenSeamPlaceholderIds: new Set(placeholders.hiddenSeamIds),
    noteNudgeAnchors: parseJsonArray(row?.note_nudge_anchors, isValidNoteNudgeAnchor),
    autoSearchHintDecisions: parseJsonArray(row?.auto_search_hint_decisions, isValidAutoSearchHintDecision),
    todoPermissionDenied,
    todoSyntheticAnchor: parsePersistedTodoSyntheticAnchor(row),
    pendingCompactionMarker: parsePendingCompactionMarkerState(row?.pending_compaction_marker_state),
    compactionMarker: parsePersistedCompactionMarkerState(row?.compaction_marker_state, row?.compaction_marker_target_end_message_id),
    mergedReasoningStrippedIds: new Set(parseStrippedBlob(row?.merged_reasoning_stripped_ids)),
    thinkingBindingRecoveryTarget: typeof thinkingBindingRecoveryTarget === "string" && thinkingBindingRecoveryTarget.length > 0 ? thinkingBindingRecoveryTarget : null,
    trailingBlankDecisions: readAllTrailingBlankDecisions(db, sessionId, row?.trailing_blank_decisions)
  };
}
function clearPendingCompactionMarkerStateIf(db, sessionId, expected) {
  const expectedBlob = stableStringify(expected);
  const result = db.prepare(`UPDATE session_meta SET pending_compaction_marker_state = NULL
             WHERE session_id = ? AND pending_compaction_marker_state = ?`).run(sessionId, expectedBlob);
  return result.changes > 0;
}
function isPendingPiCompactionMarker(value) {
  return typeof value === "object" && value !== null && (value.firstKeptEntryId === null || typeof value.firstKeptEntryId === "string") && typeof value.endMessageId === "string" && typeof value.ordinal === "number" && typeof value.tokensBefore === "number" && typeof value.summary === "string" && typeof value.publishedAt === "number";
}
function getPendingPiCompactionMarkerState(db, sessionId) {
  const row = db.prepare("SELECT pending_pi_compaction_marker_state FROM session_meta WHERE session_id = ?").get(sessionId);
  const raw = row?.pending_pi_compaction_marker_state;
  if (raw === null || raw === undefined || raw === "")
    return null;
  try {
    const parsed = JSON.parse(raw);
    if (isPendingPiCompactionMarker(parsed)) {
      return parsed;
    }
  } catch {}
  const cleared = db.prepare("UPDATE session_meta SET pending_pi_compaction_marker_state = NULL WHERE session_id = ? AND pending_pi_compaction_marker_state = ?").run(sessionId, raw);
  if (cleared.changes > 0)
    sessionLog2(sessionId, "Pi compaction-marker clear: reason=malformed-state");
  return null;
}
function setPendingPiCompactionMarkerState(db, sessionId, state, clearReason = "explicit-reset") {
  ensureSessionMetaRow(db, sessionId);
  if (state === null) {
    const pending = getPendingPiCompactionMarkerState(db, sessionId);
    if (pending)
      clearPendingPiCompactionMarkerStateIf(db, sessionId, pending, clearReason);
    else
      db.prepare("UPDATE session_meta SET pending_pi_compaction_marker_state = NULL WHERE session_id = ? AND pending_pi_compaction_marker_state = ''").run(sessionId);
    return;
  }
  const blob = stableStringify(state);
  db.prepare("UPDATE session_meta SET pending_pi_compaction_marker_state = ? WHERE session_id = ?").run(blob, sessionId);
}
function clearPendingPiCompactionMarkerStateIf(db, sessionId, expected, reason = "explicit-clear") {
  const expectedBlob = stableStringify(expected);
  const result = db.prepare(`UPDATE session_meta SET pending_pi_compaction_marker_state = NULL
             WHERE session_id = ? AND pending_pi_compaction_marker_state = ?`).run(sessionId, expectedBlob);
  if (result.changes > 0 && reason !== null)
    logPiCompactionMarkerClear(sessionId, expected, reason);
  return result.changes > 0;
}
function logPiCompactionMarkerClear(sessionId, marker, reason) {
  sessionLog2(sessionId, `Pi compaction-marker clear: reason=${reason} endMessageId=${marker.endMessageId} ordinal=${marker.ordinal} firstKeptEntryId=${marker.firstKeptEntryId ?? "<none>"}`);
}
function getSessionsWithPendingPiMarker(db) {
  const rows = db.prepare(`SELECT session_id FROM session_meta
             WHERE pending_pi_compaction_marker_state IS NOT NULL
               AND pending_pi_compaction_marker_state != ''`).all();
  return rows.map((r) => r.session_id);
}
function setSessionWorkMetrics(db, sessionId, newWorkTokens, totalInputTokens) {
  ensureSessionMetaRow(db, sessionId);
  db.prepare(`UPDATE session_meta
         SET new_work_tokens = ?, total_input_tokens = ?
         WHERE session_id = ?`).run(Math.max(0, Math.floor(newWorkTokens)), Math.max(0, Math.floor(totalInputTokens)), sessionId);
}
function getSessionWorkMetrics(db, sessionId) {
  const row = db.prepare("SELECT new_work_tokens, total_input_tokens FROM session_meta WHERE session_id = ?").get(sessionId);
  return {
    newWorkTokens: typeof row?.new_work_tokens === "number" ? row.new_work_tokens : 0,
    totalInputTokens: typeof row?.total_input_tokens === "number" ? row.total_input_tokens : 0
  };
}
var preSnapshotSessions = new Map;
var warnedProtectedTokenTierOverrides = new WeakSet;
function isPreSnapshotMemo(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const memo = value;
  return (memo.configuredOverride === undefined || typeof memo.configuredOverride === "number" && Number.isFinite(memo.configuredOverride)) && typeof memo.usableSoft === "number" && Number.isFinite(memo.usableSoft) && typeof memo.floor === "number" && Number.isFinite(memo.floor) && memo.floor >= 0 && (memo.provenance === "override" || memo.provenance === "derived");
}
function readPreSnapshotMemo(db, sessionId) {
  const row = db.prepare("SELECT protected_tokens_pre_snapshot FROM session_meta WHERE session_id = ?").get(sessionId);
  const raw = row?.protected_tokens_pre_snapshot;
  if (!raw)
    return null;
  try {
    const parsed = JSON.parse(raw);
    if (isPreSnapshotMemo(parsed))
      return parsed;
  } catch {}
  db.prepare(`UPDATE session_meta SET protected_tokens_pre_snapshot = NULL
         WHERE session_id = ? AND protected_tokens_pre_snapshot = ?`).run(sessionId, raw);
  return null;
}
function writePreSnapshotMemo(db, sessionId, memo) {
  ensureSessionMetaRow(db, sessionId);
  db.prepare(`UPDATE session_meta SET protected_tokens_pre_snapshot = ?
         WHERE session_id = ? AND protected_tokens_pre_snapshot IS NULL`).run(JSON.stringify(memo), sessionId);
  return readPreSnapshotMemo(db, sessionId) ?? memo;
}
function clearPreSnapshotMemo(db, sessionId) {
  db.prepare("UPDATE session_meta SET protected_tokens_pre_snapshot = NULL WHERE session_id = ?").run(sessionId);
  preSnapshotSessions.delete(sessionId);
}
function preSnapshotResult(memo, inputs) {
  const overrideMoved = memo.configuredOverride !== inputs.configuredOverride;
  const geometryMoved = memo.usableSoft !== inputs.usableSoft;
  return {
    floor: memo.floor,
    isSnapshotPersisted: false,
    provenance: memo.provenance,
    snapshotChanged: false,
    preSnapshotInputChanged: overrideMoved || geometryMoved,
    preSnapshotBustReason: overrideMoved ? "config-re-read" : geometryMoved ? "live-geometry" : undefined
  };
}
function persistEpochFloorSnapshot(db, sessionId, floor) {
  ensureSessionMetaRow(db, sessionId);
  const rounded = Math.max(0, Math.round(floor));
  db.prepare(`UPDATE session_meta
         SET protected_tokens_effective = ?, protected_tokens_pre_snapshot = NULL
         WHERE session_id = ?`).run(rounded, sessionId);
  preSnapshotSessions.delete(sessionId);
}
function getPersistedEpochFloor(db, sessionId) {
  return readEpochFloorSnapshot(db, sessionId);
}
function resolveEpochFloorForPass(db, sessionId, inputs) {
  const derived = deriveDefaultProtectedTokens(inputs.usableSoft);
  let configuredOverride = inputs.configuredOverride;
  const tierOverrides = inputs.tierOverrides;
  if (tierOverrides) {
    const userOrDerived = tierOverrides.user ?? derived;
    configuredOverride = tierOverrides.user;
    if (tierOverrides.project !== undefined) {
      if (tierOverrides.project >= userOrDerived) {
        configuredOverride = tierOverrides.project;
      } else if (inputs.onRejectedProjectOverride && !warnedProtectedTokenTierOverrides.has(tierOverrides)) {
        warnedProtectedTokenTierOverrides.add(tierOverrides);
        inputs.onRejectedProjectOverride(`Ignoring project protected_tokens=${tierOverrides.project}; it cannot lower resolved user/default floor ${userOrDerived}.`);
      }
    }
  }
  const resolvedInputs = { ...inputs, configuredOverride };
  const persisted = getPersistedEpochFloor(db, sessionId);
  if (!inputs.isCacheBustingPass && persisted !== null) {
    return {
      floor: persisted,
      isSnapshotPersisted: true,
      provenance: "persisted",
      snapshotChanged: false
    };
  }
  const hasValidOverride = typeof configuredOverride === "number" && Number.isInteger(configuredOverride) && configuredOverride >= 4000 && configuredOverride <= 1e6;
  const floor = hasValidOverride && typeof configuredOverride === "number" ? configuredOverride : derived;
  const provenance = hasValidOverride ? "override" : "derived";
  if (inputs.isCacheBustingPass) {
    const snapshotChanged = persisted !== floor;
    if (snapshotChanged)
      persistEpochFloorSnapshot(db, sessionId, floor);
    else
      clearPreSnapshotMemo(db, sessionId);
    return {
      floor,
      isSnapshotPersisted: true,
      provenance,
      snapshotChanged
    };
  }
  const existing = preSnapshotSessions.get(sessionId) ?? readPreSnapshotMemo(db, sessionId);
  if (existing !== null && existing !== undefined) {
    preSnapshotSessions.set(sessionId, existing);
    return preSnapshotResult(existing, resolvedInputs);
  }
  const memo = {
    configuredOverride,
    usableSoft: inputs.usableSoft,
    floor,
    provenance
  };
  const firstObservedMemo = writePreSnapshotMemo(db, sessionId, memo);
  preSnapshotSessions.set(sessionId, firstObservedMemo);
  return preSnapshotResult(firstObservedMemo, resolvedInputs);
}

export { detectThinkingBindingMismatch, detectLatestTurnThinkingMismatch, isPrefixBoundThinkingModel, detectOverflow, MAX_EXECUTE_THRESHOLD, escalationBands, MERGED_REASONING_PARTS_PREFIX, decodeMergedReasoningParts, UNKNOWN_FIT_RATIO, hasMeasuredDecisionCalibration, providerMass, localBudget, calibrationForModelKey, historyLocalBudget, HYGIENE_PROVIDER_UNITS_VERSION, sessionDecisionCalibration, transitionSessionHygieneUnits, adoptedProtectedToolsPolicy, protectedToolTagNumbers, protectedToolTokenCount, stripWellFormedLeadingTagPrefix, stripPersistedAssistantText, byteSize, stripTagPrefix, peelLeadingMcTagNotation, prependTag, rememberCurrentToolOutputCount, currentReclaimableToolOutputCount, isRecord, TEXT_TAG_IDENTITY_MARKER, PI_FALLBACK_PREFIXES_JSON, contentTagOwnerMessageId, TailHygieneJsonMemo, piJsonHash, estimateImageTokensFromDataUrl, providerVisiblePart, providerVisibleMessage, TODO_STATUSES, TODO_PRIORITIES, TITLE_DONE_STATUSES, normalizeTodoStateJson, buildSyntheticTodoPart, stripChannel1ReminderSpans, reclaimableTailTokens, compareMeasuredTailPrefix, formatTailHygienePrefixMismatch, freezeTailHygieneMeasurement, effectiveTailHygiene, CHANNEL1_SENTINEL, CHANNEL1_FLOOR_TOKENS, decideChannel1, evaluateChannel2, buildChannel2Reminder, buildChannel1Reminder, CACHED_TRIM_PARTIAL_SQL, SESSION_META_SELECT_COLUMNS, META_COLUMNS, BOOLEAN_META_KEYS, NULL_BIND_META_KEYS, isSessionMetaRow, getDefaultSessionMeta, ensureSessionMetaRow, toSessionMeta, persistCachedM0, clearCachedM0M1, isRustMarkerAdmissionFenced, ReplayDocumentError, readReplayEnvelope, readReplayDocument, updateReplayDocument, writeReplayDocument, getReasoningRemovalState, modelAcceptsEmptyContent, isAnthropicFamilyRoute, variantChangeBustsProviderCache, isInActiveAnthropicTurn, activeAnthropicTurnStart, hasAnthropicReasoning, isMarkerOnlyText, findLatestAssistantReasoningMutationExemptMessage, DEFAULT_KEEP_REASONING_TOKENS, resolveKeepReasoningTokens, reasoningStepCost, reasoningBudgetCutoff, reasoningTextAndOpaque, opaqueThinkingCost, estimatePartImageTokens, planEmergencyDrop, measureEmergencyTag, tagsSinceReading, queuePendingOp, queuePendingDropForUnchangedTag, getPendingOps, getPendingOpsCount, clearPendingOps, removePendingOp, updateTagByteSize2, getRecentTagOwnerMessageIds2, getActiveTagTokenAggregate2, AGE_RECLAIM_MIN_TOKENS2, getOldestActiveUnprotectedToolTags2, getActiveToolTagsForAgeReclaim2, getTriggerTagTokenUpperBound2, getActiveTagTokenTotalsByMessage2, updateTagInputByteSize2, updateTagTokenCount2, setTagTokenCount2, getPersistedToolTagAccounting2, getAllStatusTagTokenTotalsFlat2, getReasoningTokenEstimatesByMessage2, tryGetReasoningTokenEstimatesByMessage2, getMaxTagNumberByOwnerMessage2, scanTagOwnerSummary2, scanTagOwnerDelta2, updateTagInputTokenCount2, tagTokenCountIsNull2, backfillTagTokenCounts2, normalizeTagSnapshotRow2, insertTag2, updateTagStatus2, markTagDropped2, getInertWhitespaceAssistantTagsByNumbers2, updateTagDropMode2, updateCavemanDepth2, updateTagMessageId2, hasPiFallbackMessageTags2, findAdoptableFallbackTags2, adoptFallbackTagMessageId2, foldShrunkPartTags2, hasPiFallbackToolOwnerTags2, findPiFallbackToolOwnerTags2, PiTagIdentityConflictError2, getPiMessageTagCandidates2, findPiTagIdentityConflict2, adoptPiFallbackToolOwnerTag2, adoptPiFallbackMessageTag2, markTagsCompactedByMessageIds2, deleteTagsByMessageId2, getMaxTagNumberBySession2, getTagNumberByMessageId2, getAssignableTagNumberByMessageId2, getMinMessageTagNumberForRawId2, deriveTagLoadFloor2, TAG_SELECT_COLUMNS2, getTagsBySession2, getActiveTagsBySession2, getTailHygieneTags2, getTagsForPendingOperations2, getTagsByNumbers2, getNewestToolTagNumbers2, getDroppedTagsByNumbers2, getMaxDroppedTagNumber2, getTagById2, getTopNBySize2, getToolTagNumberByOwner2, getNullOwnerToolTag2, adoptNullOwnerToolTag2, getCandidateToolOwners2, pickNearestPriorOwner2, rowWindowMass, computeProtectionWindow, readEpochFloorSnapshot, getProtectionWindowForSession, isProviderOverflowFailClosedProven, getEmergencyRecoveryArmedAt, describeProtectedTailDrainBudgetSkip, loadPersistedUsage, loadProtectedTailMeta, markProtectedTailPolicyV3Seeded, recordProtectedTailPublicationFloor, recordProtectedTailNoEligibleHead, getWrapupInProgressState, isWrapupInProgress, acquireWrapupInProgress, updateWrapupInProgress, releaseWrapupInProgress, resolveCompactionModeRecord, getCompactionModeRecord, setCompactionModeRecord, EMERGENCY_DRAIN_FAILURE_BACKOFF_MS, getProtectedTailDrainBudgetSkip, reserveProtectedTailDrainTokens, clearEmergencyDrainLatch, recordHistorianDrainFailure, clearHistorianDrainFailure, rollbackProtectedTailDrainReservation, clearPersistedReasoningWatermark, getEmergencyInputSample, setEmergencyDropSample, clearEmergencyDropSample, getLastNudgeUndropped, setLastNudgeUndropped, getChannel1NudgeState, setChannel1NudgeState, markChannel1PostReduceGracePending, captureChannel1PostReduceGraceBaseline, getChannel2NudgeState, getChannel2NudgeClaim, setChannel2NudgeState, casChannel2NudgeState, claimChannel2NudgeState, casChannel2NudgeClaim, getPersistedNoteNudge, setPersistedNoteNudgeTrigger, setPersistedNoteNudgeTriggerMessageId, getNoteNudgeAnchors, getAutoSearchHintDecisions, deliverNoteNudgeAtomic, appendAutoSearchHintDecision, pruneNoteNudgeAnchors, queueAutoSearchHintDecisionRetirement, flushAutoSearchHintDecisionRetirement, getPersistedTodoSyntheticAnchor, setPersistedTodoSyntheticAnchor, clearPersistedTodoSyntheticAnchor, getNoteLastReadAt, setNoteLastReadAt, getHistorianFailureState, incrementHistorianFailure, clearHistorianFailureState, getOverflowState, recordOverflowDetected, clearEmergencyRecovery, clearDetectedContextLimit, getPersistedCompactionMarkerState, getCompactionMarkerPublicationState, compareAndSetCompactionMarkerPublicationState, getDeferredClearedCompactionMarkerState, parseStrippedPlaceholderState, serializeStrippedPlaceholderState, getStrippedPlaceholderIds, applyStrippedPlaceholderDelta, THINKING_BINDING_RECOVERY_FROZEN_PREFIX, THINKING_BINDING_STRIP_ORDER_END_MARKER, thinkingBindingRecoveryFrozenId, COMPACTION_OFF_THINKING_FROZEN_PREFIX, getThinkingBindingRecoveryTarget, armThinkingBindingRecovery, clearThinkingBindingRecoveryIf, getMergedReasoningStrippedIds, addMergedReasoningStrippedIds, getProcessedImageStrippedIds, parseProcessedImageMarkers, serializeProcessedImageMarkers, addProcessedImageStrippedIds, getPendingCompactionMarkerState, getCompactionMarkerHealth, loadPostprocessReplaySnapshot, clearPendingCompactionMarkerStateIf, getPendingPiCompactionMarkerState, setPendingPiCompactionMarkerState, clearPendingPiCompactionMarkerStateIf, logPiCompactionMarkerClear, getSessionsWithPendingPiMarker, setSessionWorkMetrics, getSessionWorkMetrics, resolveEpochFloorForPass };
