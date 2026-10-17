import {
  estimateTokens
} from "./index-vaah9fbg.js";
import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  sessionLog2
} from "./index-x3dcnxh0.js";
import {
  getTagIdentityWriteGeneration2,
  getSqliteDatabasePath2
} from "./index-7ptxvfc5.js";
import {
  tagOrderConstraintIndex,
  tagIdentityRevisionKey
} from "./index-nmsb3x01.js";
import {
  DEFAULT_PROTECTED_TOOLS,
  normalizeProtectedToolName,
  mergeProtectedTools
} from "./index-674f6qs2.js";

// ../plugin/src/features/magic-context/storage-tags.ts
import { isMainThread } from "node:worker_threads";

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
var DANGLING_TAG_GLOBAL_REGEX = /\u00a7\d+(?!\.\d)[^\s\u00a7\w.]?/g;
var DANGLING_TAG_PREFIX_REGEX = /^(?:\u00a7\d+(?!\.\d)[^\s\u00a7\w.]?\s*)+/;
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
function stripPersistedAssistantText(value) {
  let text = stripWellFormedLeadingTagPrefix(value);
  text = stripCompleteTagPairsGlobally(text);
  text = stripMalformedTagNotationGlobally(text);
  text = stripDanglingTagNotationGlobally(text);
  text = stripTagSectionCharacters(text);
  return text.trim();
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

// ../plugin/src/hooks/magic-context/image-token-estimate.ts
var IMAGE_TOKEN_DIVISOR = 750;
var IMAGE_FALLBACK_TOKENS = 1200;
var IMAGE_TOKEN_CAP = 4500;
function estimateImageTokensFromDataUrl(url) {
  const comma = url.indexOf(",");
  if (comma < 0)
    return IMAGE_FALLBACK_TOKENS;
  const header = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  const sliceLen = Math.min(512, payload.length);
  const preview = payload.slice(0, sliceLen);
  let bytes;
  try {
    bytes = base64Decode(preview);
  } catch {
    return IMAGE_FALLBACK_TOKENS;
  }
  if (header.includes("image/png")) {
    const dims = parsePngDimensions(bytes);
    if (dims)
      return clampImageTokens(Math.ceil(dims.w * dims.h / IMAGE_TOKEN_DIVISOR));
  } else if (header.includes("image/jpeg") || header.includes("image/jpg")) {
    const dims = parseJpegDimensions(createBase64ByteReader(payload, bytes));
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
function providerVisiblePart(part) {
  if (!isRecord2(part) || part.type !== "tool" || !isRecord2(part.state))
    return part;
  if (toolStateIsReduced(part.state))
    return part;
  return { ...part, state: providerVisibleToolState(part.state) };
}
function providerVisibleMessage(message) {
  if (!isRecord2(message) || !Array.isArray(message.parts))
    return message;
  let parts;
  for (let index = 0;index < message.parts.length; index += 1) {
    const part = message.parts[index];
    const view = providerVisiblePart(part);
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
var TODO_STATUS_SET = new Set(TODO_STATUSES);
var TODO_PRIORITY_SET = new Set(TODO_PRIORITIES);
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
function isTodoStatus(value) {
  return typeof value === "string" && TODO_STATUS_SET.has(value);
}
function isTodoPriority(value) {
  return typeof value === "string" && TODO_PRIORITY_SET.has(value);
}
function isTodoItem(value) {
  if (value === null || typeof value !== "object")
    return false;
  const todo = value;
  return typeof todo.content === "string" && isTodoStatus(todo.status) && (todo.priority === undefined || isTodoPriority(todo.priority));
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
function reclaimableToolOutputCount(parts) {
  return parts.filter((part) => part.kind === "toolOutput" && part.uTokens > 0).length;
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
  for (const tag of floorTags) {
    if (tag.status !== "active")
      continue;
    tailTokens += tag.servedTokens ?? estimateEmergencyDropReclaimTokens(tag);
  }
  const fixedFloor = Math.max(currentTotalInputTokens - tailTokens, 0);
  const workingSpan = Math.max(ceilingTokens - fixedFloor, 0);
  const target = fixedFloor + TARGET_FRACTION * workingSpan;
  const reclaimTokens = Math.round(currentTotalInputTokens - target);
  const floorNote = fixedFloor > ceilingTokens ? `; fixed floor ≈${Math.round(fixedFloor)} already exceeds ceiling ${Math.round(ceilingTokens)}: tool drops cannot reach the target` : "";
  if (reclaimTokens <= EMERGENCY_REARM_MIN_TOKENS) {
    return noop(`reclaim<=min (${reclaimTokens} <= ${EMERGENCY_REARM_MIN_TOKENS})${floorNote}`);
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
    return noop(`no-candidates${floorNote}`);
  }
  if (!input.passAlreadyPriced && reclaimed < EMERGENCY_MIN_ACHIEVABLE_RECLAIM_TOKENS) {
    return noop(`achievable reclaim below minimum (${selected.length} tags, reclaim≈${Math.round(reclaimed)} < ${EMERGENCY_MIN_ACHIEVABLE_RECLAIM_TOKENS} against gap ${reclaimTokens})${floorNote}`);
  }
  return {
    shouldDrop: true,
    tagNumbers: selected,
    reclaimTokens,
    reason: `tiered drop: ${selected.length} tags, reclaim≈${reclaimed}/${reclaimTokens} tokens (floor≈${fixedFloor}, ceiling=${Math.round(ceilingTokens)})${floorNote}`
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
var updateTagInputTokenCountStatements = new WeakMap;
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
  const nullMessageIds = new Set;
  for (const row of rows) {
    if (row.type === "tool" && row.tool_owner_message_id === null)
      continue;
    const owner = ownerMessageIdForTagRow(row);
    if (owners && !owners.has(owner))
      continue;
    if (row.token_count === null) {
      nullMessageIds.add(owner);
      totals.delete(owner);
      continue;
    }
    if (nullMessageIds.has(owner))
      continue;
    const ratio = row.type === "tool" ? calibration.toolsRatio : calibration.proseRatio;
    const weight = ((row.token_count ?? 0) + (row.input_token_count ?? 0)) * ratio + (row.reasoning_token_count ?? 0) * calibration.proseRatio;
    totals.set(owner, (totals.get(owner) ?? 0) + weight);
  }
  return { totals, nullMessageIds };
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
              WHERE session_id = ? AND type = 'tool'
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

export { UNKNOWN_FIT_RATIO, resolveDecisionCalibration, hasMeasuredDecisionCalibration, providerMass, localBudget, calibrationForModelKey, historyLocalBudget, adoptedProtectedToolsPolicy, protectedToolTagNumbers, protectedToolTokenCount, stripWellFormedLeadingTagPrefix, stripPersistedAssistantText, byteSize, stripTagPrefix, peelLeadingMcTagNotation, prependTag, isRecord, TEXT_TAG_IDENTITY_MARKER, PI_FALLBACK_PREFIXES_JSON, contentTagOwnerMessageId, estimateImageTokensFromDataUrl, providerVisiblePart, providerVisibleMessage, TODO_STATUSES, TODO_PRIORITIES, TITLE_DONE_STATUSES, normalizeTodoStateJson, buildSyntheticTodoPart, stripChannel1ReminderSpans, compareMeasuredTailPrefix, formatTailHygienePrefixMismatch, freezeTailHygieneMeasurement, effectiveTailHygiene, CHANNEL1_SENTINEL, CHANNEL1_FLOOR_TOKENS, decideChannel1, evaluateChannel2, reclaimableToolOutputCount, buildChannel2Reminder, buildChannel1Reminder, planEmergencyDrop, measureEmergencyTag, queuePendingOp, queuePendingDropForUnchangedTag, getPendingOps, getPendingOpsCount, clearPendingOps, removePendingOp, updateTagByteSize2, getRecentTagOwnerMessageIds2, getActiveTagTokenAggregate2, AGE_RECLAIM_MIN_TOKENS2, getOldestActiveUnprotectedToolTags2, getActiveToolTagsForAgeReclaim2, getTriggerTagTokenUpperBound2, getActiveTagTokenTotalsByMessage2, updateTagInputByteSize2, updateTagTokenCount2, getPersistedToolTagAccounting2, getAllStatusTagTokenTotalsFlat2, getReasoningTokenEstimatesByMessage2, tryGetReasoningTokenEstimatesByMessage2, getMaxTagNumberByOwnerMessage2, scanTagOwnerSummary2, scanTagOwnerDelta2, updateTagInputTokenCount2, tagTokenCountIsNull2, backfillTagTokenCounts2, insertTag2, updateTagStatus2, getInertWhitespaceAssistantTagsByNumbers2, updateTagDropMode2, updateCavemanDepth2, updateTagMessageId2, hasPiFallbackMessageTags2, findAdoptableFallbackTags2, adoptFallbackTagMessageId2, foldShrunkPartTags2, hasPiFallbackToolOwnerTags2, findPiFallbackToolOwnerTags2, PiTagIdentityConflictError2, getPiMessageTagCandidates2, findPiTagIdentityConflict2, adoptPiFallbackToolOwnerTag2, adoptPiFallbackMessageTag2, markTagsCompactedByMessageIds2, deleteTagsByMessageId2, getMaxTagNumberBySession2, getTagNumberByMessageId2, getAssignableTagNumberByMessageId2, getMinMessageTagNumberForRawId2, deriveTagLoadFloor2, TAG_SELECT_COLUMNS2, getTagsBySession2, getActiveTagsBySession2, getTagsForPendingOperations2, getTagsByNumbers2, getNewestToolTagNumbers2, getDroppedTagsByNumbers2, getMaxDroppedTagNumber2, getTagById2, getTopNBySize2, getToolTagNumberByOwner2, getNullOwnerToolTag2, adoptNullOwnerToolTag2, getCandidateToolOwners2, pickNearestPriorOwner2 };
