import {
  resolveDecisionCalibration,
  calibrationForModelKey,
  isRecord,
  providerVisiblePart,
  TAG_SELECT_COLUMNS2,
  getCandidateToolOwners2,
  pickNearestPriorOwner2
} from "./index-2s0s8mca.js";
import {
  OMO_INTERNAL_INITIATOR_MARKER,
  isSystemDirective,
  hasMeaningfulUserText2,
  extractTexts2,
  extractToolResultBodyTokens,
  extractToolCallSummaries,
  estimateTokens,
  createTokenCountMemo,
  normalizeText,
  compactRole,
  formatBlock,
  compactTextForSummary,
  mergeCommitHashes
} from "./index-vaah9fbg.js";
import {
  getHarness2,
  harnessOwnsOpenCodeStore2
} from "./index-0h2mkab2.js";
import {
  log2,
  sessionLog2
} from "./index-x3dcnxh0.js";
import {
  Database2,
  prepareCachedStatement2
} from "./index-3cgbv47m.js";
import {
  stableStringify,
  closeQuietly
} from "./index-nmsb3x01.js";
import {
  canonicalModelIdentity,
  piModelRefToCanonical,
  renderToolTemplate,
  resolveModelConfigValue,
  deriveDefaultProtectedTokens
} from "./index-cyrnv16r.js";
import {
  prewarmRawSessionOrdinalsForDb,
  readRawSessionMessagesFromDb2,
  readRawSessionMessagePageFromDb2,
  readRawSessionMessageSummaryPageFromDb2,
  countRawSessionMessageOrdinalsFromDb2,
  readRawSessionMessageIdOrdinalsForRangeFromDb2,
  readRawSessionMessageOrdinalPageFromDb2,
  countStoredRawSessionMessagesFromDb2,
  readRawSessionTailFromDb2,
  readRawSessionMessagePartsByIdFromDb2,
  readRawSessionMessageOrdinalByIdFromDb2,
  readRawSessionMessageByIdFromDb2,
  hasRawSessionMessageByIdFromDb2,
  readRawSeedTailFromDb2,
  readRawSessionBoundaryEndpointsFromDb2
} from "./index-2apf1afe.js";
import {
  resolveOpenCodeDbPath,
  assertOpenCodeStoreGeneration,
  openCodeDbPathExists,
  recordOpenCodeDbReadFailure,
  clearOpenCodeDbReadFailure,
  claimOpenCodeDbDiagnosticOnce
} from "./index-8976mezv.js";
import {
  logSlowWriteTransaction
} from "./index-0vrkp1jq.js";
// ../plugin/src/shared/historian-tool-defaults.json
var historian_tool_defaults_default = {
  ctx_note: "Note ${input.action} ${input.note_ids}: ${input.content} → ${output.truncate(160)}",
  ctx_memory: "Memory ${input.action} ${input.category} ${input.ids}: ${input.content} → ${output.truncate(160)}",
  todowrite: 'Todos (${input.todos.count}): ${input.todos.each("${status}: ${content}")}',
  question: 'Asked user: ${input.questions[*].question.join(" / ")} → ${output}',
  task: "Task ${input.subagent_type}: ${input.prompt.truncate(600)} → ${output.truncate(200)}",
  ask: 'Asked: ${input.question} [options: ${input.options.join(" / ")}] ${input.text}${input.resolution} → ${output.truncate(300)}',
  peer_send: "PM ${input.recipient}: ${input.message}",
  board: 'Board ${input.verb}${input.board_lane}: ${input.ops.each("${op} ${lane_label} ${item}${props.text}${lane.items} ${state}${props.state}${lane.status}${id}${title}")}',
  room: "Room ${input.action} ${input.room_label}: ${input.room_detail}",
  work: "Work ${input.action} ${input.title}${input.id}: ${input.prompt.truncate(600)}${input.notes.truncate(600)} → ${output.truncate(160)}",
  knowhow: "Looked up how-to: ${input.query}${input.id}"
};
// ../plugin/src/shared/historian-tool-preview-defaults.json
var historian_tool_preview_defaults_default = {
  ctx_note: "Note ${input.action} ${input.note_ids}: ${input.content} → ${output.truncate(160)}",
  ctx_memory: "Memory ${input.action} ${input.category} ${input.ids}: ${input.content} → ${output.truncate(160)}",
  todowrite: 'Todos (${input.todos.count}): ${input.todos.each("${status}: ${content}")}',
  question: 'Asked user: ${input.questions[*].question.join(" / ")} → ${output}',
  task: "Task ${input.subagent_type}: ${input.prompt} → ${output.truncate(200)}",
  ask: 'Asked: ${input.question.truncate(250)} [options: ${input.options.join(" / ")}] ${input.resolution} → ${output.truncate(300)}',
  peer_send: "PM to ${input.agent}${input.agent_id}: ${input.message.truncate(400)}",
  board: 'Board ${input.verb}: ${input.ops.each("${op} ${item}${lane.title} ${state}${lane.status}${props.text} ${lane.items[*].text}")}',
  room: "Room ${input.action} ${input.room_id}: ${input.text.truncate(400)}",
  work: "Work ${input.action} ${input.id}: ${input.prompt_file}${input.prompt.truncate(200)}${input.notes.truncate(200)} → ${output.truncate(160)}",
  knowhow: "Looked up how-to: ${input.query}${input.id}"
};

// ../plugin/src/shared/historian-tool-expansions.ts
function builtinInput(tool, input) {
  if (!input || typeof input !== "object")
    return input;
  const i = input;
  if (tool === "peer_send") {
    const external = i.external;
    const recipient = i.reply_to_pmid ? `reply to ${i.reply_to_pmid}` : i.agent || i.agent_id ? `to ${i.agent || i.agent_id}` : external?.session_id || i.session_id ? `to session ${external?.session_id || i.session_id}` : "to unknown recipient";
    return { ...i, recipient };
  }
  if (tool === "room") {
    return {
      ...i,
      room_label: i.room_id || i.title,
      room_detail: i.action === "create" || i.action === "invite" ? `invitees: ${renderToolTemplate("${input.invitees}", i)}` : i.text
    };
  }
  if (tool === "board") {
    return {
      ...i,
      board_lane: i.lane ? ` ${i.lane}` : "",
      ops: Array.isArray(i.ops) ? i.ops.map((op) => op && typeof op === "object" ? {
        ...op,
        lane_label: typeof op.lane === "string" ? op.lane : op.lane?.title || op.lane?.id
      } : op) : i.ops
    };
  }
  return input;
}
function expandToolPart(part, overrides, legacyPreview = false) {
  if (!part || typeof part !== "object")
    return null;
  const p = part;
  if (p.type !== "tool" || typeof p.tool !== "string")
    return null;
  const builtinDefaults = legacyPreview ? historian_tool_preview_defaults_default : historian_tool_defaults_default;
  const overridden = overrides && Object.hasOwn(overrides, p.tool);
  const template = overridden ? overrides[p.tool] : Object.hasOwn(builtinDefaults, p.tool) ? builtinDefaults[p.tool] : undefined;
  if (typeof template !== "string")
    return null;
  const state = p.state;
  const input = overridden || legacyPreview ? state?.input : builtinInput(p.tool, state?.input);
  return renderToolTemplate(template, input, state?.output ?? state?.error, legacyPreview);
}

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

// ../plugin/src/hooks/magic-context/read-session-db.ts
function openCodeDbExists() {
  return harnessOwnsOpenCodeStore2() && openCodeDbPathExists(resolveOpenCodeDbPath());
}
var cachedReadOnlyDb = null;
function closeCachedReadOnlyDb() {
  if (!cachedReadOnlyDb) {
    return;
  }
  try {
    closeQuietly(cachedReadOnlyDb.db);
  } catch (error) {
    log2("[magic-context] failed to close cached OpenCode read-only DB:", error);
  } finally {
    cachedReadOnlyDb = null;
  }
}
function getReadOnlySessionDb() {
  if (!harnessOwnsOpenCodeStore2()) {
    throw new Error("OpenCode session database is not readable from a Pi-compatible process; its history lives in Pi sessions");
  }
  const resolution = resolveOpenCodeDbPath();
  const dbPath = resolution.path;
  if (!openCodeDbPathExists(resolution)) {
    throw new Error(`OpenCode session database is unavailable at ${dbPath} (source=${resolution.source})`);
  }
  if (cachedReadOnlyDb?.path === dbPath) {
    return cachedReadOnlyDb.db;
  }
  closeCachedReadOnlyDb();
  const db = new Database2(dbPath, { readonly: true });
  try {
    assertOpenCodeStoreGeneration(db, "v1", dbPath);
  } catch (error) {
    closeQuietly(db);
    throw error;
  }
  cachedReadOnlyDb = { path: dbPath, db };
  clearOpenCodeDbReadFailure();
  return db;
}
function withReadOnlySessionDb(fn) {
  return fn(getReadOnlySessionDb());
}
function getRawSessionMessageCountFromDb(db, sessionId) {
  const row = db.prepare(`SELECT COUNT(*) as count FROM message WHERE session_id = ?
             AND NOT (COALESCE(json_extract(data, '$.summary'), 0) = 1
                      AND COALESCE(json_extract(data, '$.finish'), '') = 'stop')`).get(sessionId);
  return typeof row?.count === "number" ? row.count : 0;
}
var trackedSessions = new Map;
var pendingParts = new Map;
var probeLogObserverForTests;
function logProbeFailureOnce(resolution, error) {
  const failure = recordOpenCodeDbReadFailure(resolution, error);
  if (!claimOpenCodeDbDiagnosticOnce("session-state-probe", resolution))
    return;
  const message = `[magic-context] OpenCode DB probe failed: path=${resolution.path} source=${resolution.source} cause=${failure.message}`;
  probeLogObserverForTests?.(message);
  log2(message);
}
function getMessageTimesFromOpenCodeDb(sessionId, messageIds) {
  const result = new Map;
  if (messageIds.length === 0 || !harnessOwnsOpenCodeStore2())
    return result;
  try {
    withReadOnlySessionDb((db) => {
      const placeholders = messageIds.map(() => "?").join(",");
      const rows = db.prepare(`SELECT id, time_created FROM message WHERE +session_id = ? AND id IN (${placeholders})`).all(sessionId, ...messageIds);
      for (const row of rows) {
        if (typeof row.id === "string" && typeof row.time_created === "number") {
          result.set(row.id, row.time_created);
        }
      }
    });
  } catch (error) {
    logProbeFailureOnce(resolveOpenCodeDbPath(), error);
  }
  return result;
}

// ../plugin/src/hooks/magic-context/read-session-true-raw-tokens.ts
function completedToolArcCrossesBoundary(invOrdinal, resOrdinal, boundary) {
  return invOrdinal < boundary && boundary <= resOrdinal;
}
var MAX_MESSAGE_CACHE_ENTRIES = 1e5;
var MAX_MESSAGE_CACHE_KEY_BYTES = 64 * 1024 * 1024;
var FNV1A_32_OFFSET = 2166136261;
var FNV1A_32_PRIME = 16777619;
var messageEstimateCache = new Map;
var messageEstimateKeysByField = new Map;
var messageEstimateCacheBytes = 0;
var EMPTY_BREAKDOWN = {
  text: 0,
  reasoning: 0,
  toolInput: 0,
  toolOutput: 0,
  image: 0,
  other: 0,
  total: 0
};
function addBreakdown(target, kind, value) {
  if (kind === "total")
    return;
  const safeValue = Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
  target[kind] += safeValue;
  target.total += safeValue;
}
function estimateStructured(value) {
  if (typeof value === "string")
    return estimateTokens(value);
  if (value === undefined || value === null)
    return 0;
  return estimateTokens(stableStringify(value));
}
function firstStringField(record, fields) {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0)
      return value;
  }
  return null;
}
function stringValue(value) {
  if (typeof value === "string")
    return value;
  if (value === undefined || value === null)
    return "";
  return stableStringify(value);
}
function textFromToolResultContent(content) {
  if (typeof content === "string")
    return content;
  if (Array.isArray(content)) {
    const pieces = [];
    for (const entry of content) {
      if (typeof entry === "string") {
        pieces.push(entry);
      } else if (isRecord(entry)) {
        const text = firstStringField(entry, ["text", "content", "value"]);
        pieces.push(text ?? stableStringify(entry));
      } else if (entry !== null && entry !== undefined) {
        pieces.push(String(entry));
      }
    }
    return pieces.join(`
`);
  }
  return stringValue(content);
}
function looksImageLike(part) {
  const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
  const mime = typeof part.mime === "string" ? part.mime.toLowerCase() : "";
  const mediaType = typeof part.mediaType === "string" ? part.mediaType.toLowerCase() : "";
  return type.includes("image") || mime.startsWith("image/") || mediaType.startsWith("image/") || part.image_url !== undefined || part.imageUrl !== undefined || part.image !== undefined;
}
function defaultImageTokenHeuristic(part) {
  if (isRecord(part)) {
    const width = part.width;
    const height = part.height;
    if (typeof width === "number" && typeof height === "number" && width > 0 && height > 0) {
      return Math.max(256, Math.min(4096, Math.ceil(width * height / 750)));
    }
  }
  return 1024;
}
function partType(part) {
  return typeof part.type === "string" ? part.type : "";
}
function hasOwn(record, key) {
  return Object.hasOwn(record, key);
}
function recursiveByteLength(value) {
  if (value === null || value === undefined)
    return 0;
  if (typeof value === "string")
    return value.length;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).length;
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + recursiveByteLength(item), value.length);
  }
  if (isRecord(value)) {
    let total = Object.keys(value).length;
    for (const [key, child] of Object.entries(value)) {
      total += key.length + recursiveByteLength(child);
    }
    return total;
  }
  return String(value).length;
}
function updateFnv1a32(hash, text) {
  let next = hash;
  for (let index = 0;index < text.length; index += 1) {
    next ^= text.charCodeAt(index);
    next = Math.imul(next, FNV1A_32_PRIME) >>> 0;
  }
  return next;
}
function contentStringsHash(fields) {
  let hash = FNV1A_32_OFFSET;
  for (const field of fields) {
    hash = updateFnv1a32(hash, `${field.length}:`);
    hash = updateFnv1a32(hash, field);
    hash = updateFnv1a32(hash, "\x00");
  }
  return hash.toString(16).padStart(8, "0");
}
function rawPartVersion(part) {
  return part.__magicContextPartUpdatedAt ?? part.updated_at ?? part.updatedAt ?? part.version ?? part.revision ?? "";
}
function callIdFromPart(part) {
  const direct = firstStringField(part, ["callID", "callId", "toolCallId", "tool_call_id", "id"]);
  if (direct)
    return direct;
  const state = isRecord(part.state) ? part.state : null;
  return state ? firstStringField(state, ["callID", "callId", "toolCallId", "tool_call_id", "id"]) ?? "" : "";
}
function toolSignalFromPart(part, withText = true) {
  if (!isRecord(part))
    return null;
  const type = partType(part);
  const state = isRecord(part.state) ? part.state : null;
  const callId = callIdFromPart(part);
  if (!callId && type !== "tool")
    return null;
  if (type === "tool") {
    const hasInput = state !== null && hasOwn(state, "input");
    const outputKey = state ? hasOwn(state, "output") ? "output" : hasOwn(state, "error") ? "error" : hasOwn(state, "result") ? "result" : null : null;
    const hasOutput = outputKey !== null;
    const outputValue = outputKey && state ? state[outputKey] : undefined;
    const providerExecuted = part.providerExecuted === true;
    const openInvocation = !providerExecuted && !hasOutput;
    return {
      callId,
      hasInput: hasInput || openInvocation,
      hasOutput,
      inputText: withText && hasInput && state ? stringValue(state.input) : "",
      outputText: withText && hasOutput ? stringValue(outputValue) : ""
    };
  }
  if (type === "tool-invocation") {
    const args = part.args ?? part.input;
    return {
      callId,
      hasInput: args !== undefined,
      hasOutput: false,
      inputText: withText && args !== undefined ? stringValue(args) : "",
      outputText: ""
    };
  }
  if (type === "tool_use") {
    const input = part.input;
    return {
      callId,
      hasInput: input !== undefined,
      hasOutput: false,
      inputText: withText && input !== undefined ? stringValue(input) : "",
      outputText: ""
    };
  }
  if (type === "tool_result") {
    const content = part.content ?? part.output ?? part.result;
    return {
      callId,
      hasInput: false,
      hasOutput: content !== undefined,
      inputText: "",
      outputText: withText && content !== undefined ? textFromToolResultContent(content) : ""
    };
  }
  return null;
}
function partCheapFingerprint(part) {
  if (!isRecord(part))
    return `${typeof part}:${recursiveByteLength(part)}`;
  const version = rawPartVersion(part);
  const type = typeof part.type === "string" ? part.type : "";
  return `${type}:${String(version)}:${recursiveByteLength(providerVisiblePart(part))}`;
}
function messageCacheKey(message, options) {
  const namespace = "cacheNamespace" in options ? options.cacheNamespace : "estimate";
  const cheapFingerprint = message.parts.map(partCheapFingerprint).join("|");
  return [
    namespace,
    options.providerShapeVersion,
    message.id || `ordinal:${message.ordinal}`,
    message.role,
    message.parts.length,
    cheapFingerprint
  ].join("\x00");
}
function setCachedEstimate(key, breakdown) {
  const keyEstimateBytes = key.length * 2 + 64;
  const existing = messageEstimateCache.get(key);
  if (existing)
    messageEstimateCacheBytes -= existing.keyEstimateBytes;
  else {
    for (const field of new Set(key.split("\x00").slice(1, -1))) {
      const keys = messageEstimateKeysByField.get(field) ?? new Set;
      keys.add(key);
      messageEstimateKeysByField.set(field, keys);
    }
  }
  messageEstimateCache.set(key, { breakdown, keyEstimateBytes });
  messageEstimateCacheBytes += keyEstimateBytes;
  while (messageEstimateCache.size > MAX_MESSAGE_CACHE_ENTRIES || messageEstimateCacheBytes > MAX_MESSAGE_CACHE_KEY_BYTES) {
    const first = messageEstimateCache.keys().next().value;
    if (typeof first !== "string")
      break;
    deleteCachedEstimate(first);
  }
}
function deleteCachedEstimate(key) {
  const removed = messageEstimateCache.get(key);
  if (!removed)
    return;
  messageEstimateCacheBytes -= removed.keyEstimateBytes;
  messageEstimateCache.delete(key);
  for (const field of new Set(key.split("\x00").slice(1, -1))) {
    const keys = messageEstimateKeysByField.get(field);
    keys?.delete(key);
    if (keys?.size === 0)
      messageEstimateKeysByField.delete(field);
  }
}
function cloneBreakdown(value) {
  return { ...value };
}
function estimateNonToolPart(part, options, breakdown) {
  if (!isRecord(part)) {
    if (part !== null && part !== undefined)
      addBreakdown(breakdown, "other", estimateStructured(part));
    return true;
  }
  const type = partType(part);
  if (type === "step-start" || type === "step-finish" || type === "meta" && Object.keys(part).length <= 1) {
    return true;
  }
  if (type === "text") {
    const text = firstStringField(part, ["text", "content"]);
    if (text)
      addBreakdown(breakdown, "text", estimateTokens(text));
    return true;
  }
  if (type === "reasoning" || type === "thinking" || type === "redacted_thinking") {
    const text = firstStringField(part, ["thinking", "text", "content", "reasoning"]);
    if (text) {
      addBreakdown(breakdown, "reasoning", estimateTokens(text));
    } else {
      addBreakdown(breakdown, "other", estimateStructured(part));
    }
    return true;
  }
  const reasoningText = firstStringField(part, ["thinking", "reasoning"]);
  if (reasoningText && type.length === 0) {
    addBreakdown(breakdown, "reasoning", estimateTokens(reasoningText));
    return true;
  }
  if (looksImageLike(part)) {
    addBreakdown(breakdown, "image", options.imageTokenHeuristic?.(part) ?? defaultImageTokenHeuristic(part));
    const altText = firstStringField(part, ["alt", "text", "description"]);
    if (altText)
      addBreakdown(breakdown, "text", estimateTokens(altText));
    return true;
  }
  if (type.includes("file") || type === "source") {
    const content = firstStringField(part, ["content", "text", "source"]);
    if (content)
      addBreakdown(breakdown, "text", estimateTokens(content));
    else
      addBreakdown(breakdown, "other", estimateStructured(part));
    return true;
  }
  return false;
}
function estimateTrueRawMessageTokens(message, options) {
  const breakdown = cloneBreakdown(EMPTY_BREAKDOWN);
  const countedInput = new Set;
  const countedOutput = new Set;
  let ordinalToolIndex = 0;
  for (const part of message.parts) {
    const signal = toolSignalFromPart(part);
    if (signal) {
      const localKey = `${signal.callId || "tool"}:${message.ordinal}:${ordinalToolIndex}`;
      ordinalToolIndex += 1;
      if (signal.hasInput) {
        const key = `${signal.callId}:input:${message.ordinal}`;
        if (!countedInput.has(key)) {
          countedInput.add(key);
          addBreakdown(breakdown, "toolInput", estimateTokens(signal.inputText));
        }
      }
      if (signal.hasOutput) {
        const key = `${signal.callId}:output:${message.ordinal}:${localKey}`;
        if (!countedOutput.has(key)) {
          countedOutput.add(key);
          addBreakdown(breakdown, "toolOutput", estimateTokens(signal.outputText));
        }
      }
      continue;
    }
    if (!estimateNonToolPart(part, options, breakdown)) {
      addBreakdown(breakdown, "other", estimateStructured(part));
    }
  }
  return breakdown;
}
function buildToolArcs(messages) {
  const openQueues = new Map;
  const arcs = [];
  for (const message of messages) {
    for (const part of message.parts) {
      const signal = toolSignalFromPart(part, false);
      if (!signal || signal.callId.length === 0)
        continue;
      if (signal.hasInput && signal.hasOutput) {
        arcs.push({
          callId: signal.callId,
          invOrdinal: message.ordinal,
          resOrdinal: message.ordinal
        });
        continue;
      }
      if (signal.hasInput) {
        const queue = openQueues.get(signal.callId) ?? [];
        queue.push(message.ordinal);
        openQueues.set(signal.callId, queue);
        continue;
      }
      if (signal.hasOutput) {
        const queue = openQueues.get(signal.callId) ?? [];
        const invOrdinal = queue.shift();
        if (queue.length === 0)
          openQueues.delete(signal.callId);
        else
          openQueues.set(signal.callId, queue);
        if (invOrdinal !== undefined) {
          arcs.push({ callId: signal.callId, invOrdinal, resOrdinal: message.ordinal });
        }
      }
    }
  }
  for (const [callId, queue] of openQueues) {
    for (const invOrdinal of queue) {
      arcs.push({ callId, invOrdinal, resOrdinal: null });
    }
  }
  return arcs.sort((a, b) => a.invOrdinal - b.invOrdinal || (a.resOrdinal ?? Number.MAX_SAFE_INTEGER) - (b.resOrdinal ?? Number.MAX_SAFE_INTEGER));
}
function fenceBoundaryForCompletedToolArcs(candidate, arcs, publicationFloorOrdinal, observeComponent) {
  const completed = arcs.filter((arc) => arc.resOrdinal !== null).map((arc) => ({ invocation: arc.invOrdinal, result: arc.resOrdinal }));
  const component = completed.filter((arc) => completedToolArcCrossesBoundary(arc.invocation, arc.result, candidate));
  if (component.length === 0)
    return candidate;
  for (let pass = 0;pass <= completed.length; pass += 1) {
    const minInvocation = Math.min(...component.map((arc) => arc.invocation));
    const maxResult = Math.max(...component.map((arc) => arc.result));
    const before = component.length;
    for (const arc of completed) {
      if (arc.invocation <= maxResult && arc.result >= minInvocation && !component.includes(arc)) {
        component.push(arc);
      }
    }
    if (component.length === before)
      break;
  }
  const minInvocation = Math.min(...component.map((arc) => arc.invocation));
  const maxResult = Math.max(...component.map((arc) => arc.result));
  observeComponent?.(component);
  return minInvocation < publicationFloorOrdinal ? maxResult + 1 : minInvocation;
}
function fenceBoundaryForToolArcs(candidate, arcs, lastCompartmentEndOrdinal, recentOpenArcCutoff) {
  let boundary = fenceBoundaryForCompletedToolArcs(candidate, arcs, lastCompartmentEndOrdinal + 1);
  for (const arc of arcs) {
    if (arc.resOrdinal !== null)
      continue;
    if (arc.invOrdinal < recentOpenArcCutoff)
      continue;
    if (arc.invOrdinal >= lastCompartmentEndOrdinal + 1 && arc.invOrdinal < boundary) {
      boundary = arc.invOrdinal;
      break;
    }
    if (arc.invOrdinal >= boundary) {
      boundary = arc.invOrdinal;
      break;
    }
  }
  return fenceBoundaryForCompletedToolArcs(boundary, arcs, 1);
}
function tokenForMessage(message, options) {
  const key = messageCacheKey(message, options);
  const cached = messageEstimateCache.get(key);
  if (cached)
    return cloneBreakdown(cached.breakdown);
  const breakdown = estimateTrueRawMessageTokens(message, options);
  setCachedEstimate(key, breakdown);
  return cloneBreakdown(breakdown);
}
function buildTrueRawTokenIndex(sessionId, messages, options) {
  const ordered = [...messages].sort((a, b) => a.ordinal - b.ordinal);
  const sliceCount = ordered.length;
  const firstOrdinal = ordered.length > 0 ? ordered[0].ordinal : 1;
  const terminalOrdinal = ordered.length > 0 ? ordered[ordered.length - 1].ordinal : 0;
  const rawMessageCount = Math.max(sliceCount, terminalOrdinal, options.absoluteMessageCount ?? sliceCount);
  const ordinalSpan = terminalOrdinal >= firstOrdinal ? terminalOrdinal - firstOrdinal + 1 : 0;
  const tokensByOrdinal = new Map;
  const idsByOrdinal = new Map;
  const prefix = new Array(ordinalSpan + 1).fill(0);
  for (const message of ordered) {
    const stored = options.storedTotalForMessage?.(message);
    let total;
    if (stored !== undefined && stored !== null) {
      total = stored;
    } else {
      const raw = tokenForMessage(message, options);
      const seed = options.calibration;
      total = seed ? (raw.toolInput + raw.toolOutput) * seed.toolsRatio + (raw.text + raw.reasoning + raw.other) * seed.proseRatio + raw.image : raw.total;
    }
    tokensByOrdinal.set(message.ordinal, total);
    idsByOrdinal.set(message.ordinal, message.id);
    const relative = message.ordinal - firstOrdinal + 1;
    if (relative >= 1 && relative <= ordinalSpan) {
      prefix[relative] = total;
    }
  }
  for (let k = 1;k <= ordinalSpan; k += 1) {
    prefix[k] += prefix[k - 1];
  }
  const ordinalToIndex = (ordinal) => Math.max(0, Math.min(ordinalSpan, ordinal - firstOrdinal));
  return {
    sessionId,
    providerShapeVersion: options.providerShapeVersion,
    rawMessageCount,
    tokenForOrdinal(ordinal) {
      return tokensByOrdinal.get(ordinal) ?? 0;
    },
    messageIdAtOrdinal(ordinal) {
      return idsByOrdinal.get(ordinal) ?? null;
    },
    suffixTokensFromOrdinal(ordinal) {
      if (ordinal <= firstOrdinal)
        return prefix[ordinalSpan];
      if (ordinal > terminalOrdinal)
        return 0;
      return prefix[ordinalSpan] - prefix[ordinalToIndex(ordinal)];
    },
    rangeTokens(startInclusive, endExclusive) {
      const start = Math.max(firstOrdinal, startInclusive);
      const end = Math.max(start, Math.min(terminalOrdinal + 1, endExclusive));
      return prefix[end - firstOrdinal] - prefix[start - firstOrdinal];
    },
    findSuffixStartForTokens(tokens) {
      if (!Number.isFinite(tokens) || tokens <= 0)
        return terminalOrdinal + 1;
      const target = Math.max(0, Math.floor(tokens));
      const total = prefix[ordinalSpan];
      if (total < target)
        return firstOrdinal;
      const cut = total - target;
      let lo = 0;
      let hi = ordinalSpan;
      let best = 0;
      while (lo <= hi) {
        const mid = lo + hi >> 1;
        if (prefix[mid] <= cut) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return firstOrdinal + best;
    },
    findHeadEndForCap(startInclusive, endExclusive, capTokens) {
      const start = Math.max(firstOrdinal, Math.min(terminalOrdinal + 1, startInclusive));
      const end = Math.max(start, Math.min(terminalOrdinal + 1, endExclusive));
      if (!Number.isFinite(capTokens) || capTokens <= 0)
        return start;
      const startIndex = start - firstOrdinal;
      const endIndex = end - firstOrdinal;
      const cut = prefix[startIndex] + Math.floor(capTokens);
      let lo = startIndex + 1;
      let hi = endIndex;
      let bestEndIndex = startIndex;
      while (lo <= hi) {
        const mid = lo + hi >> 1;
        if (prefix[mid] <= cut) {
          bestEndIndex = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      let bestEnd = firstOrdinal + bestEndIndex;
      if (bestEnd === start && start < end)
        bestEnd = start + 1;
      return Math.min(bestEnd, end);
    }
  };
}
function partContentFingerprint(part) {
  if (!isRecord(part))
    return `${typeof part}:${recursiveByteLength(part)}`;
  const tool = toolSignalFromPart(part);
  if (tool) {
    return contentStringsHash([tool.inputText, tool.outputText]);
  }
  const text = firstStringField(part, ["text", "thinking", "reasoning", "content", "url"]) ?? "";
  return contentStringsHash([text]);
}
function computeRawRangeFingerprint(messages, startInclusive, endExclusive) {
  const pieces = [];
  for (const message of messages) {
    if (message.ordinal < startInclusive || message.ordinal >= endExclusive)
      continue;
    const partFingerprint = message.parts.map(partContentFingerprint).join(",");
    pieces.push(`${message.ordinal}:${message.id}:${message.parts.length}:${partFingerprint}`);
  }
  return pieces.join("|");
}
function invalidateTrueRawTokenCache(args) {
  const sessionNeedle = args.sessionId ? `${args.sessionId}` : null;
  const messageNeedle = args.messageId ? `\x00${args.messageId}\x00` : null;
  const keys = args.messageId && !args.messageId.includes("\x00") ? messageEstimateKeysByField.get(args.messageId) ?? [] : messageEstimateCache.keys();
  for (const key of keys) {
    const sessionMatches = sessionNeedle === null || key.includes(sessionNeedle);
    const messageMatches = messageNeedle === null || key.includes(messageNeedle);
    if (sessionMatches && messageMatches) {
      deleteCachedEstimate(key);
    }
  }
  args.reason;
}

// ../plugin/src/hooks/magic-context/system-injection-stripper.ts
var SYSTEM_INJECTION_MARKERS = [
  "<!-- OMO_INTERNAL_INITIATOR -->",
  "[SYSTEM DIRECTIVE: MAGIC-CONTEXT",
  "[SYSTEM DIRECTIVE: OH-MY-OPENCODE",
  "[Category+Skill Reminder]",
  "[EDIT ERROR - IMMEDIATE ACTION REQUIRED]",
  "[task CALL FAILED - IMMEDIATE RETRY REQUIRED]",
  "[EMERGENCY CONTEXT WINDOW WARNING]",
  "Unstable background agent appears idle",
  "**THE SUBAGENT JUST CLAIMED THIS TASK IS DONE."
];
var SYSTEM_REMINDER_REGEX = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
var OMO_MARKER_REGEX = /<!-- OMO_INTERNAL_INITIATOR -->/g;
var STEERING_WRAPPER_REGEX = /<system-reminder>\nThe user sent the following message:\n[\s\S]*?\n\nPlease address this message and continue with your tasks\.\n<\/system-reminder>/g;
function stripSystemInjection(text) {
  STEERING_WRAPPER_REGEX.lastIndex = 0;
  if (!STEERING_WRAPPER_REGEX.test(text))
    return stripInjectedRegions(text);
  STEERING_WRAPPER_REGEX.lastIndex = 0;
  let result = "";
  let changed = false;
  let cursor = 0;
  const keepOrStrip = (segment) => {
    const stripped = stripInjectedRegions(segment);
    if (stripped === null) {
      result += segment;
    } else {
      result += stripped;
      changed = true;
    }
  };
  for (const match of text.matchAll(STEERING_WRAPPER_REGEX)) {
    keepOrStrip(text.slice(cursor, match.index));
    result += match[0];
    cursor = match.index + match[0].length;
  }
  keepOrStrip(text.slice(cursor));
  return changed ? result.trim() : null;
}
function stripOutsideSteeringWrappers(text, strip) {
  STEERING_WRAPPER_REGEX.lastIndex = 0;
  let result = "";
  let cursor = 0;
  for (const match of text.matchAll(STEERING_WRAPPER_REGEX)) {
    result += strip(text.slice(cursor, match.index));
    result += match[0];
    cursor = match.index + match[0].length;
  }
  return result + strip(text.slice(cursor));
}
function stripInjectedRegions(text) {
  let hasInjection = false;
  for (const marker of SYSTEM_INJECTION_MARKERS) {
    if (text.includes(marker)) {
      hasInjection = true;
      break;
    }
  }
  if (SYSTEM_REMINDER_REGEX.test(text))
    hasInjection = true;
  SYSTEM_REMINDER_REGEX.lastIndex = 0;
  if (!hasInjection)
    return null;
  let cleaned = text;
  cleaned = cleaned.replace(SYSTEM_REMINDER_REGEX, "");
  cleaned = cleaned.replace(OMO_MARKER_REGEX, "");
  cleaned = cleaned.replace(/\[SYSTEM DIRECTIVE: OH-MY-(?:OPENCODE|CLAUDE)[^\]]*\][\s\S]*?(?=\n\n(?!\s*[-*])|$)/g, "");
  for (const marker of SYSTEM_INJECTION_MARKERS) {
    if (marker.startsWith("<!-- ") || marker.startsWith("[SYSTEM DIRECTIVE"))
      continue;
    const idx = cleaned.indexOf(marker);
    if (idx === -1)
      continue;
    const blockEnd = cleaned.indexOf(`

`, idx + marker.length);
    cleaned = blockEnd !== -1 ? cleaned.slice(0, idx) + cleaned.slice(blockEnd) : cleaned.slice(0, idx);
  }
  return cleaned.trim();
}

// ../plugin/src/hooks/magic-context/tag-part-guards.ts
function isTextPart(part) {
  if (part === null || typeof part !== "object")
    return false;
  const p = part;
  return p.type === "text" && typeof p.text === "string";
}
function isFilePart(part) {
  if (part === null || typeof part !== "object")
    return false;
  const p = part;
  return p.type === "file" && typeof p.url === "string";
}

// ../plugin/src/shared/user-answer.ts
function hasUserAnswerMetadata(value) {
  if (!isRecord(value))
    return false;
  if (value.userAnswer === true)
    return true;
  if (Array.isArray(value.answers))
    return true;
  if (typeof value.answer === "string")
    return true;
  if (Array.isArray(value.selectedOptions) || typeof value.customInput === "string")
    return true;
  return Array.isArray(value.results) && value.results.some(hasUserAnswerMetadata);
}

// ../plugin/src/features/magic-context/dreamer/token-budget.ts
class DreamTokenBudgetExceeded extends Error {
  sessionId;
  spent;
  constructor(sessionId, spent) {
    super(`Dreamer child ${sessionId} spent ${spent} prompt tokens (token_budget)`);
    this.sessionId = sessionId;
    this.spent = spent;
    this.name = "DreamTokenBudgetExceeded";
  }
}
var TOKEN_BUDGET_FINALIZE_MESSAGE = "You're out of token budget. Stop investigating: make no more tool calls and output your result now, covering only what you've already checked; leave the rest out.";
var TOKEN_BUDGET_TOOL_REFUSAL = "Out of token budget: no more tool calls. Output your result now.";
var finalizingChildren = new Map;
function registerBudgetFinalizeChild(sessionId, guard) {
  finalizingChildren.set(sessionId, guard);
}
function releaseBudgetFinalizeChild(sessionId) {
  finalizingChildren.delete(sessionId);
}
function createDreamTokenBudget(budget) {
  if (!Number.isSafeInteger(budget) || budget <= 0)
    throw new Error("Invalid token budget");
  let spent = 0;
  let finalizeFired = false;
  let refusedCalls = 0;
  let forcedStop = false;
  const snapshot = () => ({
    budget,
    spent,
    finalizeFired,
    refusedCalls,
    hardStopped: forcedStop || spent >= budget || refusedCalls >= 2
  });
  return {
    snapshot,
    finalize() {
      if (finalizeFired)
        return "continue";
      finalizeFired = true;
      return "finalize";
    },
    charge(input, cacheRead, cacheWrite, completed = false, canFinalize = true) {
      for (const value of [input, cacheRead, cacheWrite]) {
        if (!Number.isSafeInteger(value) || value < 0)
          throw new Error("Invalid prompt usage");
      }
      spent += input + cacheRead + cacheWrite;
      if (completed)
        return "continue";
      if (spent >= budget)
        return "stop";
      if (!completed && !finalizeFired && spent >= budget * 0.8) {
        if (!canFinalize) {
          forcedStop = true;
          return "stop";
        }
        finalizeFired = true;
        return "finalize";
      }
      return "continue";
    },
    refuseTool() {
      if (!finalizeFired && !snapshot().hardStopped)
        return null;
      refusedCalls += 1;
      return { message: TOKEN_BUDGET_TOOL_REFUSAL, hardStopped: snapshot().hardStopped };
    }
  };
}

// ../plugin/src/hooks/magic-context/dropped-input-guard.ts
var LEGACY_TRUNCATED_VALUE = /^[\s\S]{0,5}\.\.\.\[truncated\]$/;
var MAX_QUOTED_ARGUMENTS = 160;
var MAX_LISTED_PARAMETERS = 12;
var MAX_TRACKED_SESSIONS = 1000;
function isDroppedPlaceholderString(value) {
  return value.startsWith("[dropped §") && value.endsWith("§]") || LEGACY_TRUNCATED_VALUE.test(value) || value === "[object]" || /^\[\d+ items\]$/.test(value);
}
function droppedInputMarker(tagId) {
  return { dropped: `[dropped §${tagId}§]` };
}
function containsDroppedInputPlaceholder(value) {
  const seen = new WeakSet;
  const visit = (candidate) => {
    if (typeof candidate === "string")
      return isDroppedPlaceholderString(candidate);
    if (candidate === null || typeof candidate !== "object")
      return false;
    if (seen.has(candidate))
      return false;
    seen.add(candidate);
    if (Array.isArray(candidate))
      return candidate.some(visit);
    return Object.values(candidate).some(visit);
  };
  return visit(value);
}
function isRecord2(value) {
  return value !== null && typeof value === "object";
}
function isOptionalZodField(field) {
  if (!isRecord2(field))
    return false;
  const isOptional = field.isOptional;
  if (typeof isOptional === "function") {
    try {
      return isOptional.call(field) === true;
    } catch {}
  }
  const internals = field._zod;
  return internals?.optin === "optional";
}
function toolParameterNames(schema) {
  if (!isRecord2(schema))
    return;
  const properties = schema.properties;
  if (isRecord2(properties) && !Array.isArray(properties)) {
    const names = Object.keys(properties);
    const requiredList = Array.isArray(schema.required) ? schema.required : [];
    const required = new Set(requiredList.filter((name) => typeof name === "string"));
    return {
      required: names.filter((name) => required.has(name)),
      optional: names.filter((name) => !required.has(name))
    };
  }
  let shape;
  try {
    shape = schema.shape;
  } catch {
    shape = undefined;
  }
  if (isRecord2(shape) && !Array.isArray(shape)) {
    const result = { required: [], optional: [] };
    for (const [name, field] of Object.entries(shape)) {
      (isOptionalZodField(field) ? result.optional : result.required).push(name);
    }
    return result;
  }
  return;
}
var recordedToolParameters = new Map;
function quoteArguments(input) {
  let text;
  try {
    text = JSON.stringify(input) ?? String(input);
  } catch {
    text = String(input);
  }
  return text.length > MAX_QUOTED_ARGUMENTS ? `${text.slice(0, MAX_QUOTED_ARGUMENTS - 1)}…` : text;
}
function ordinal(value) {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13)
    return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}
function describeParameters(names) {
  if (!names || names.required.length + names.optional.length === 0) {
    return "the tool's own parameters";
  }
  const listed = [...names.required.map((name) => `${name} (required)`), ...names.optional];
  const shown = listed.slice(0, MAX_LISTED_PARAMETERS);
  const more = listed.length > shown.length ? ", …" : "";
  return `its parameters: ${shown.join(", ")}${more}`;
}
function droppedInputRefusalMessage(refusal) {
  const tool = refusal.toolName ? `\`${refusal.toolName}\`` : undefined;
  const names = toolParameterNames(refusal.parameters) ?? (refusal.toolName ? recordedToolParameters.get(refusal.toolName) : undefined);
  const lines = [];
  if (refusal.consecutive >= 2) {
    lines.push(`This is the ${ordinal(refusal.consecutive)} call in a row with placeholder arguments.`);
  }
  lines.push(`Not executed: your arguments${tool ? ` to ${tool}` : ""} were ${quoteArguments(refusal.input)}. That is the placeholder Magic Context shows in place of an earlier call's arguments, not a value to send. Nothing is wrong with the session or the tool.`, `Call ${tool ?? "the tool"} again with real values for ${describeParameters(names)}.`, "Only if you need the original arguments of an earlier dropped call, recover them with ctx_expand first.");
  return lines.join(`
`);
}
function createDroppedInputGuard(options = {}) {
  const consecutiveBySession = new Map;
  return {
    check(call) {
      const session = call.sessionID ?? "";
      if (!containsDroppedInputPlaceholder(call.input)) {
        consecutiveBySession.delete(session);
        return;
      }
      const consecutive = (consecutiveBySession.get(session) ?? 0) + 1;
      consecutiveBySession.delete(session);
      consecutiveBySession.set(session, consecutive);
      if (consecutiveBySession.size > MAX_TRACKED_SESSIONS) {
        const oldest = consecutiveBySession.keys().next().value;
        if (oldest !== undefined)
          consecutiveBySession.delete(oldest);
      }
      let parameters;
      if (call.toolName && options.parametersFor) {
        try {
          parameters = options.parametersFor(call.toolName);
        } catch {
          parameters = undefined;
        }
      }
      return droppedInputRefusalMessage({
        toolName: call.toolName,
        input: call.input,
        parameters,
        consecutive
      });
    }
  };
}

// ../plugin/src/hooks/magic-context/edit-marker.ts
var TRUNCATION_SENTINEL = "...[truncated]";
var EDIT_REGION_HINT_LEN = 40;
var PATH_KEYS = new Set(["filePath", "file_path", "path"]);
var DIFF_KEYS = new Set(["oldString", "newString", "content", "old_string", "new_string"]);
function safeSlice(str, maxLen) {
  if (str.length <= maxLen)
    return str;
  const lastCharCode = str.charCodeAt(maxLen - 1);
  if (lastCharCode >= 55296 && lastCharCode <= 56319) {
    return str.slice(0, maxLen - 1);
  }
  return str.slice(0, maxLen);
}
function isEditTool(name) {
  return name === "edit" || name === "write";
}
function applyEditMarkerToInput(input) {
  for (const key of Object.keys(input)) {
    if (PATH_KEYS.has(key))
      continue;
    const value = input[key];
    if (typeof value !== "string" || !DIFF_KEYS.has(key))
      continue;
    if (value.endsWith(TRUNCATION_SENTINEL))
      continue;
    input[key] = value.length > EDIT_REGION_HINT_LEN ? `${safeSlice(value, EDIT_REGION_HINT_LEN)}${TRUNCATION_SENTINEL}` : value;
  }
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

// ../plugin/src/features/magic-context/storage-meta-shared.ts
import { Buffer as Buffer2 } from "node:buffer";
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
  return typeof r.session_id === "string" && isNumberOrNull(r.last_response_time) && isStringOrNull(r.cache_ttl) && typeof r.counter === "number" && typeof r.last_nudge_tokens === "number" && isStringOrNull(r.last_nudge_band) && isStringOrNull(r.last_transform_error) && typeof r.is_subagent === "number" && typeof r.last_context_percentage === "number" && typeof r.last_input_tokens === "number" && isNumberOrNull(r.observed_safe_input_tokens) && isNumberOrNull(r.cache_alert_sent) && isNumberOrNull(r.times_execute_threshold_reached) && isNumberOrNull(r.compartment_in_progress) && (r.system_prompt_hash === null || typeof r.system_prompt_hash === "string" || typeof r.system_prompt_hash === "number") && isNumberOrNull(r.system_prompt_tokens) && isNumberOrNull(r.conversation_tokens) && isNumberOrNull(r.tool_call_tokens) && isNumberOrNull(r.cleared_reasoning_through_tag) && isStringOrNull(r.last_todo_state) && isBlobOrNull(r.cached_m0_bytes) && isStringOrNull(r.cached_m0_mural_data_url) && isStringOrNull(r.cached_m0_mural_hash) && isBlobOrNull(r.cached_m1_bytes) && isNumberOrNull(r.cached_m0_project_memory_epoch) && isStringOrNull(r.cached_m0_workspace_fingerprint) && isNumberOrNull(r.cached_m0_project_user_profile_version) && isNumberOrNull(r.cached_m0_max_compartment_seq) && isNumberOrNull(r.cached_m0_max_memory_id) && isNumberOrNull(r.cached_m0_max_mutation_id) && isNumberOrNull(r.cached_m0_max_memory_mutation_id) && isStringOrNull(r.cached_m0_project_docs_hash) && isNumberOrNull(r.cached_m0_materialized_at) && isNumberOrNull(r.cached_m0_session_facts_version) && isStringOrNull(r.cached_m0_upgrade_state) && isStringOrNull(r.cached_m0_system_hash) && isStringOrNull(r.cached_m0_tool_set_hash) && isStringOrNull(r.cached_m0_model_key) && isStringOrNull(r.cached_m0_project_identity) && isStringOrNull(r.last_observed_model_key) && isNumberOrNull(r.last_usage_context_limit) && isNumberOrNull(r.prior_boundary_ordinal) && isNumberOrNull(r.protected_tail_policy_version) && isNumberOrNull(r.protected_tail_drain_window_started_at) && isNumberOrNull(r.protected_tail_drain_tokens) && isNumberOrNull(r.recovery_no_eligible_head_count) && isNumberOrNull(r.force_emergency_bypass_window_start) && isNumberOrNull(r.force_emergency_bypass_used) && isNumberOrNull(r.upgrade_reminded_at) && isNumberOrNull(r.upgrade_reminder_last_sent_at) && isNumberOrNull(r.upgrade_reminder_count) && isNumberOrNull(r.pi_stable_id_scheme) && isNumberOrNull(r.tool_reclaim_watermark);
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
function ensureSessionMetaRow(db, sessionId, initialIsSubagent = false) {
  let exists = sessionMetaExistsStatements.get(db);
  if (!exists) {
    exists = prepareCachedStatement2(db, "SELECT 1 FROM session_meta WHERE session_id = ?");
    sessionMetaExistsStatements.set(db, exists);
  }
  if (exists.get(sessionId))
    return;
  const defaults = getDefaultSessionMeta(sessionId);
  db.prepare("INSERT OR IGNORE INTO session_meta (session_id, harness, last_response_time, cache_ttl, counter, last_nudge_tokens, last_nudge_band, last_transform_error, is_subagent, last_context_percentage, last_input_tokens, observed_safe_input_tokens, cache_alert_sent, times_execute_threshold_reached, compartment_in_progress, system_prompt_hash, cleared_reasoning_through_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(sessionId, getHarness2(), defaults.lastResponseTime, defaults.cacheTtl, defaults.counter, defaults.lastNudgeTokens, defaults.lastNudgeBand ?? "", defaults.lastTransformError ?? "", initialIsSubagent ? 1 : 0, defaults.lastContextPercentage, defaults.lastInputTokens, defaults.observedSafeInputTokens, defaults.cacheAlertSent ? 1 : 0, defaults.timesExecuteThresholdReached, defaults.compartmentInProgress ? 1 : 0, defaults.systemPromptHash ?? "", defaults.clearedReasoningThroughTag);
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
function readRawReplayDocument(db, sessionId) {
  try {
    const row = db.prepare("SELECT trailing_blank_decisions FROM session_meta WHERE session_id = ?").get(sessionId);
    const raw = row?.trailing_blank_decisions;
    if (raw === null || raw === undefined || typeof raw === "string")
      return raw;
    throw invalidReplayDocument("stored value is not text");
  } catch (error) {
    if (isMissingReplayDocumentColumn(error))
      return MISSING_REPLAY_DOCUMENT_COLUMN;
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
function updateReplayDocument(db, sessionId, mutate) {
  let initial;
  try {
    initial = readRawReplayDocument(db, sessionId);
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
      raw = readRawReplayDocument(db, sessionId);
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
  return value === "provider_overflow" || value === "proactive_model_shrink" ? value : null;
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
        ...parsed,
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
function setPersistedCompactionMarkerState(db, sessionId, state) {
  db.transaction(() => {
    ensureSessionMetaRow(db, sessionId);
    const previous = state === null ? getPersistedCompactionMarkerState(db, sessionId) ?? getDeferredClearedCompactionMarkerState(db, sessionId) : null;
    const json = state ? JSON.stringify(state) : previous ? JSON.stringify({ deferredClear: previous }) : "";
    db.prepare("UPDATE session_meta SET compaction_marker_state = ?, compaction_marker_target_end_message_id = ? WHERE session_id = ?").run(json, state?.targetEndMessageId ?? null, sessionId);
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
function getThinkingBindingRecoveryTarget(db, sessionId) {
  const row = db.prepare("SELECT thinking_binding_recovery_target FROM session_meta WHERE session_id = ?").get(sessionId);
  const target = row?.thinking_binding_recovery_target;
  return typeof target === "string" && target.length > 0 ? target : null;
}
function armThinkingBindingRecovery(db, sessionId) {
  ensureSessionMetaRow(db, sessionId);
  db.prepare("UPDATE session_meta SET thinking_binding_recovery_target = ? WHERE session_id = ?").run(THINKING_BINDING_RECOVERY_ALL_ASSISTANTS, sessionId);
}
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
  const row = db.prepare("SELECT processed_image_stripped_ids FROM session_meta WHERE session_id = ?").get(sessionId);
  return new Set(parseStrippedBlob(row?.processed_image_stripped_ids));
}
function addProcessedImageStrippedIds(db, sessionId, ids) {
  const add = [...ids];
  if (add.length === 0)
    return true;
  ensureSessionMetaRow(db, sessionId);
  for (let attempt = 0;attempt < CAS_RETRY_LIMIT2; attempt += 1) {
    const row = db.prepare("SELECT processed_image_stripped_ids FROM session_meta WHERE session_id = ?").get(sessionId);
    const rawStored = row ? row.processed_image_stripped_ids ?? null : null;
    const current = new Set(parseStrippedBlob(rawStored));
    let changed = false;
    for (const id of add) {
      if (!current.has(id)) {
        current.add(id);
        changed = true;
      }
    }
    if (!changed)
      return true;
    const nextBlob = JSON.stringify([...current]);
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
  db.prepare("UPDATE session_meta SET pending_pi_compaction_marker_state = NULL WHERE session_id = ? AND pending_pi_compaction_marker_state = ?").run(sessionId, raw);
  return null;
}
function setPendingPiCompactionMarkerState(db, sessionId, state) {
  ensureSessionMetaRow(db, sessionId);
  const blob = state ? stableStringify(state) : null;
  db.prepare("UPDATE session_meta SET pending_pi_compaction_marker_state = ? WHERE session_id = ?").run(blob, sessionId);
}
function clearPendingPiCompactionMarkerStateIf(db, sessionId, expected) {
  const expectedBlob = stableStringify(expected);
  const result = db.prepare(`UPDATE session_meta SET pending_pi_compaction_marker_state = NULL
             WHERE session_id = ? AND pending_pi_compaction_marker_state = ?`).run(sessionId, expectedBlob);
  return result.changes > 0;
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

// ../plugin/src/features/magic-context/overflow-detection.ts
var OVERFLOW_PATTERNS = [
  /prompt is too long/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /input token count.*exceeds the maximum/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /maximum model length is \d+/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /request entity too large/i,
  /context length is only \d+ tokens/i,
  /input length.*exceeds.*context length/i,
  /prompt too long; exceeded (?:max )?context length/i,
  /too large for model with \d+ maximum context length/i,
  /model_context_window_exceeded/i,
  /context size has been exceeded/i,
  /prepared prompt exceeds engine max_context/i,
  /prompt exceeds (?:the )?.{0,32}\bmax_context\b/i
];
var LIMIT_EXTRACTION_PATTERNS = [
  { pattern: /maximum prompt length is (\d+)/i, provenance: "prompt_only" },
  {
    pattern: /maximum context length is (\d+) tokens?/i,
    provenance: "combined"
  },
  { pattern: /maximum model length is (\d+)/i, provenance: "combined" },
  { pattern: /context length is only (\d+) tokens?/i, provenance: "combined" },
  { pattern: /exceeds the limit of (\d+)/i, provenance: "unknown" },
  {
    pattern: /too large for model with (\d+) maximum context length/i,
    provenance: "combined"
  },
  { pattern: /context size[^0-9]{0,40}(\d{4,})\s*tokens?/i, provenance: "combined" },
  { pattern: /exceeds? the context length of (\d+)/i, provenance: "combined" },
  {
    pattern: />\s*(\d+)\s*(?:tokens?\s*)?(?:maximum|max|limit)\b/i,
    provenance: "prompt_only"
  },
  {
    pattern: /maximum number of tokens allowed\s*\(?\s*(\d+)/i,
    provenance: "prompt_only"
  },
  { pattern: /prepared prompt exceeds engine max_context\s+(\d+)/i, provenance: "unknown" },
  { pattern: /prompt exceeds (?:the )?.{0,32}\bmax_context\s+(\d+)/i, provenance: "unknown" },
  { pattern: /max(?:imum)?.*context.*?(\d+)/i, provenance: "unknown" }
];
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
function parseReportedInputTokens(message) {
  if (!message)
    return;
  const patterns = [
    /prompt is too long:\s*(\d+)/i,
    /input token count\s*\(?\s*(\d+)/i,
    /input length\s*(\d+)/i,
    /prompt was\s*(\d+)/i,
    /messages resulted in\s*(\d+)\s*tokens?/i
  ];
  for (const pattern of patterns) {
    const raw = message.match(pattern)?.[1];
    if (!raw)
      continue;
    const value = Number.parseInt(raw, 10);
    if (Number.isFinite(value) && value > 0)
      return value;
  }
  return;
}
function parseReportedLimit(message) {
  if (!message)
    return;
  for (const { pattern, provenance } of LIMIT_EXTRACTION_PATTERNS) {
    const match = message.match(pattern);
    if (!match)
      continue;
    const raw = match[1];
    if (!raw)
      continue;
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value))
      continue;
    if (value < MIN_PLAUSIBLE_LIMIT || value > MAX_PLAUSIBLE_LIMIT)
      continue;
    return { value, provenance };
  }
  return;
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
    const message = messages[user];
    if (!isRecord(message))
      continue;
    const info = isRecord(message.info) ? message.info : message;
    if (info.role !== "user" || info.synthetic === true || message.synthetic === true)
      continue;
    const id = typeof info.id === "string" ? info.id : "";
    if (id.startsWith("synth-user-"))
      continue;
    const parts = Array.isArray(message.parts) ? message.parts : Array.isArray(message.content) ? message.content : [];
    if (parts.length > 0 && parts.every((part) => isRecord(part) && (part.synthetic === true || part.ignored === true || ["tool_result", "toolResult", "tool-result"].includes(String(part.type)))))
      continue;
    return user + 1;
  }
  return;
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

// ../plugin/src/hooks/magic-context/tool-input-size.ts
var SKELETON_REAL_INPUT_MAX_BYTES = 1024;
var encoder = new TextEncoder;
function toolInputStringBytes(value) {
  const seen = new WeakSet;
  const visit = (candidate) => {
    if (typeof candidate === "string")
      return encoder.encode(candidate).length;
    if (candidate === null || typeof candidate !== "object")
      return 0;
    if (seen.has(candidate))
      return 0;
    seen.add(candidate);
    let total = 0;
    const values = Array.isArray(candidate) ? candidate : Object.values(candidate);
    for (const item of values)
      total += visit(item);
    return total;
  };
  return visit(value);
}

// ../plugin/src/hooks/magic-context/tool-drop-target.ts
var IGNORE_PART_TYPES = new Set([
  "thinking",
  "reasoning",
  "redacted_thinking",
  "meta",
  "step-start",
  "step-finish"
]);
function isToolCallId(value) {
  return typeof value === "string" && value.length > 0;
}
function extractToolCallObservation(part) {
  if (!isRecord(part))
    return null;
  if (part.type === "tool" && isToolCallId(part.callID)) {
    return { callId: part.callID, kind: "result" };
  }
  if (part.type === "tool-invocation" && isToolCallId(part.callID)) {
    return { callId: part.callID, kind: "invocation" };
  }
  if (part.type === "tool_use" && isToolCallId(part.id)) {
    return { callId: part.id, kind: "invocation" };
  }
  if (part.type === "tool_result" && isToolCallId(part.tool_use_id)) {
    return { callId: part.tool_use_id, kind: "result" };
  }
  return null;
}

// ../plugin/src/hooks/magic-context/read-session-chunk.ts
var BLOCK_TOKEN_MEMO_MAX = 2048;
var blockTokenMemo = new Map;
function estimateBlockTokens(blockText) {
  const cached = blockTokenMemo.get(blockText);
  if (cached !== undefined) {
    blockTokenMemo.delete(blockText);
    blockTokenMemo.set(blockText, cached);
    return cached;
  }
  const count = estimateTokens(blockText);
  if (blockTokenMemo.size >= BLOCK_TOKEN_MEMO_MAX) {
    const oldest = blockTokenMemo.keys().next().value;
    if (oldest !== undefined)
      blockTokenMemo.delete(oldest);
  }
  blockTokenMemo.set(blockText, count);
  return count;
}
var activeRawMessageCache = null;
var activeAbsoluteCountCache = null;
var sessionProviders = new Map;
function resolveHostServedBoundaryId2(sessionId, messageId) {
  if (messageId.length === 0)
    return messageId;
  return sessionProviders.get(sessionId)?.provider.readServedBoundaryId?.(messageId) ?? messageId;
}
function hasRawMessageProvider2(sessionId) {
  return sessionProviders.has(sessionId);
}
function setRawMessageProvider2(sessionId, provider) {
  const current = sessionProviders.get(sessionId);
  const registration = current?.provider === provider ? current : { provider, scopes: 0 };
  registration.scopes += 1;
  sessionProviders.set(sessionId, registration);
  let active = true;
  return () => {
    if (!active)
      return;
    active = false;
    registration.scopes -= 1;
    if (registration.scopes === 0 && sessionProviders.get(sessionId) === registration) {
      sessionProviders.delete(sessionId);
    }
  };
}
var boundedProviderWrappers = new WeakMap;
function setBoundedRawMessageProvider2(sessionId, provider) {
  let wrapper = boundedProviderWrappers.get(provider);
  if (!wrapper) {
    wrapper = {
      ...provider,
      readMessages: () => {
        throw new Error("Bounded raw-message providers cannot read complete history; full reads are reserved for store-generation conversion");
      }
    };
    boundedProviderWrappers.set(provider, wrapper);
  }
  return setRawMessageProvider2(sessionId, wrapper);
}
function withRawMessageProvider2(sessionId, provider, fn) {
  const cleanup = setRawMessageProvider2(sessionId, provider);
  let result;
  try {
    result = fn();
  } catch (error) {
    cleanup();
    throw error;
  }
  if (result !== null && typeof result === "object" && typeof result.then === "function") {
    return result.finally(cleanup);
  }
  cleanup();
  return result;
}
var SYSTEM_REMINDER_BLOCK_REGEX = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;
function cleanUserText2(text) {
  return stripOutsideSteeringWrappers(text, (segment) => segment.replace(SYSTEM_REMINDER_BLOCK_REGEX, "").replace(OMO_INTERNAL_INITIATOR_MARKER, "")).trim();
}
function hasMeaningfulChunkUserText(parts) {
  for (const part of parts) {
    if (part === null || typeof part !== "object")
      continue;
    const candidate = part;
    if (candidate.type !== "text" || typeof candidate.text !== "string")
      continue;
    if (candidate.ignored === true)
      continue;
    const cleaned = cleanUserText2(candidate.text);
    if (!cleaned)
      continue;
    if (isSystemDirective(cleaned))
      continue;
    return true;
  }
  return false;
}
function withRawSessionMessageCache2(fn) {
  const outerCache = activeRawMessageCache;
  if (!outerCache) {
    activeRawMessageCache = new Map;
    activeAbsoluteCountCache = new Map;
  }
  try {
    return fn();
  } finally {
    if (!outerCache) {
      activeRawMessageCache = null;
      activeAbsoluteCountCache = null;
    }
  }
}
function readRawSessionMessages2(sessionId) {
  if (activeRawMessageCache) {
    const cached = activeRawMessageCache.get(sessionId);
    if (cached?.coveredFromOrdinal === 1 && cached.coveredToOrdinal === null) {
      return cached.messages;
    }
    const messages = readRawSessionMessagesFromSource(sessionId);
    if (!cached) {
      activeRawMessageCache.set(sessionId, {
        messages,
        coveredFromOrdinal: 1,
        coveredToOrdinal: null
      });
    }
    return messages;
  }
  return readRawSessionMessagesFromSource(sessionId);
}
function readRawSessionMessagePage2(sessionId, afterOrdinal, limit, finalWatermark, after) {
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider?.readMessagePage) {
    return provider.readMessagePage(afterOrdinal, limit, finalWatermark, after);
  }
  if (provider) {
    return provider.readMessages().filter((message) => message.ordinal > afterOrdinal && message.ordinal <= finalWatermark).slice(0, limit);
  }
  if (!openCodeDbExists())
    return [];
  return withReadOnlySessionDb((db) => readRawSessionMessagePageFromDb2(db, sessionId, afterOrdinal, limit, finalWatermark, after));
}
function getRawSessionMessageOrdinalCount2(sessionId) {
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider) {
    if (provider.getMessageCount)
      return provider.getMessageCount();
    const messages = provider.readMessages();
    return messages.reduce((maximum, message) => Math.max(maximum, message.ordinal), messages.length);
  }
  if (!openCodeDbExists())
    return 0;
  return withReadOnlySessionDb((db) => countRawSessionMessageOrdinalsFromDb2(db, sessionId));
}
var RAW_MESSAGE_RANGE_PAGE_SIZE = 100;
function readRawSessionMessageRangeFromSource(sessionId, fromOrdinal, toOrdinal) {
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider?.iterateMessageRange)
    return [...provider.iterateMessageRange(fromOrdinal, toOrdinal)];
  if (provider && !provider.readMessagePage) {
    return provider.readMessages().filter((message) => message.ordinal >= fromOrdinal && message.ordinal <= toOrdinal);
  }
  if (!provider && !openCodeDbExists())
    return [];
  const messages = [];
  let afterOrdinal = fromOrdinal - 1;
  let after;
  while (afterOrdinal < toOrdinal) {
    const limit = Math.min(RAW_MESSAGE_RANGE_PAGE_SIZE, toOrdinal - afterOrdinal);
    const page = provider?.readMessagePage ? provider.readMessagePage(afterOrdinal, limit, toOrdinal, after) : withReadOnlySessionDb((db) => readRawSessionMessagePageFromDb2(db, sessionId, afterOrdinal, limit, toOrdinal, after));
    if (page.length === 0)
      break;
    let nextOrdinal = afterOrdinal;
    for (const message of page) {
      if (message.ordinal < fromOrdinal || message.ordinal > toOrdinal)
        continue;
      messages.push(message);
      nextOrdinal = Math.max(nextOrdinal, message.ordinal);
    }
    if (nextOrdinal <= afterOrdinal)
      break;
    afterOrdinal = nextOrdinal;
    const last = page.at(-1);
    after = last ? { timeCreated: last.createdAt ?? 0, id: last.id } : undefined;
  }
  return messages;
}
var RAW_MESSAGE_VISIT_PAGE_SIZE2 = 50;
function visitRawSessionMessages2(sessionId, fromOrdinal, toOrdinal, visit, options = {}) {
  const from = Math.max(1, Math.floor(fromOrdinal));
  const to = Math.floor(toOrdinal);
  if (to < from)
    return;
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider?.iterateMessageRange) {
    for (const message of provider.iterateMessageRange(from, to)) {
      if (!visit(message))
        return;
    }
    return;
  }
  if (provider && !provider.readMessagePage) {
    for (const message of provider.readMessages()) {
      if (message.ordinal < from || message.ordinal > to)
        continue;
      if (!visit(message))
        return;
    }
    return;
  }
  if (!provider && !openCodeDbExists())
    return;
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? RAW_MESSAGE_VISIT_PAGE_SIZE2));
  let afterOrdinal = from - 1;
  let after;
  while (afterOrdinal < to) {
    const limit = Math.min(pageSize, to - afterOrdinal);
    const cursor = afterOrdinal;
    const page = provider?.readMessagePage ? provider.readMessagePage(cursor, limit, to, after) : withReadOnlySessionDb((db) => options.summary ? readRawSessionMessageSummaryPageFromDb2(db, sessionId, cursor, limit, to, after) : readRawSessionMessagePageFromDb2(db, sessionId, cursor, limit, to, after));
    if (page.length === 0)
      return;
    let nextOrdinal = afterOrdinal;
    for (const message of page) {
      if (message.ordinal < from || message.ordinal > to)
        continue;
      if (!visit(message))
        return;
      nextOrdinal = Math.max(nextOrdinal, message.ordinal);
    }
    if (nextOrdinal <= afterOrdinal)
      return;
    afterOrdinal = nextOrdinal;
    const last = page.at(-1);
    after = last ? { timeCreated: last.createdAt ?? 0, id: last.id } : undefined;
  }
}
function readRawSessionMessageRange2(sessionId, fromOrdinal, toOrdinal) {
  const from = Math.max(1, Math.floor(fromOrdinal));
  const to = Math.floor(toOrdinal);
  if (to < from)
    return [];
  const cached = activeRawMessageCache?.get(sessionId);
  if (!cached)
    return readRawSessionMessageRangeFromSource(sessionId, from, to);
  const coveredTo = cached.coveredToOrdinal ?? Number.POSITIVE_INFINITY;
  const overlapFrom = Math.max(from, cached.coveredFromOrdinal);
  const overlapTo = Math.min(to, coveredTo);
  if (overlapTo < overlapFrom) {
    return readRawSessionMessageRangeFromSource(sessionId, from, to);
  }
  const messages = [];
  if (from < overlapFrom) {
    messages.push(...readRawSessionMessageRangeFromSource(sessionId, from, overlapFrom - 1));
  }
  messages.push(...cached.messages.filter((message) => message.ordinal >= overlapFrom && message.ordinal <= overlapTo));
  if (overlapTo < to) {
    messages.push(...readRawSessionMessageRangeFromSource(sessionId, overlapTo + 1, to));
  }
  return messages;
}
readRawSessionMessages2.readPage = readRawSessionMessagePage2;
readRawSessionMessages2.getCount = getRawSessionMessageOrdinalCount2;
readRawSessionMessages2.prepare = prepareRawSessionOrdinals2;
async function prepareRawSessionOrdinals2(sessionId) {
  if (sessionProviders.get(sessionId)?.provider)
    return true;
  if (!openCodeDbExists())
    return true;
  const db = withReadOnlySessionDb((connection) => connection);
  let timer;
  const deadline = Date.now() + 250;
  const prepare = async () => {
    for (let attempt = 0;attempt < 3 && Date.now() < deadline; attempt++) {
      if (await prewarmRawSessionOrdinalsForDb(db, sessionId) === "warm")
        return true;
    }
    return false;
  };
  try {
    const ready = await Promise.race([
      prepare(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 250);
      })
    ]);
    if (!ready) {
      sessionLog2(sessionId, "WARN canonical ordinal preparation unavailable within 250ms; exact reads must defer or retry");
    }
    return ready;
  } finally {
    clearTimeout(timer);
  }
}
function primeTailRawMessageCache2(args) {
  const { sessionId, lastCompartmentEnd, anchorMessageId } = args;
  if (!activeRawMessageCache)
    return false;
  if (activeRawMessageCache.has(sessionId))
    return false;
  if (lastCompartmentEnd < 1 || !anchorMessageId)
    return false;
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider) {
    if (!provider.readMessagePage || !provider.getMessageCount)
      return false;
    const absoluteMessageCount = provider.getMessageCount();
    const messages = readRawSessionMessageRange2(sessionId, lastCompartmentEnd, absoluteMessageCount);
    if (messages.find((message) => message.ordinal === lastCompartmentEnd)?.id !== anchorMessageId)
      return false;
    activeRawMessageCache.set(sessionId, {
      messages,
      coveredFromOrdinal: lastCompartmentEnd,
      coveredToOrdinal: lastCompartmentEnd === 1 ? null : absoluteMessageCount
    });
    activeAbsoluteCountCache?.set(sessionId, absoluteMessageCount);
    return true;
  }
  if (!openCodeDbExists())
    return false;
  const result = withReadOnlySessionDb((db) => readRawSessionTailFromDb2(db, sessionId, lastCompartmentEnd, anchorMessageId));
  if (!result)
    return false;
  activeRawMessageCache.set(sessionId, {
    messages: result.messages,
    coveredFromOrdinal: lastCompartmentEnd,
    coveredToOrdinal: lastCompartmentEnd === 1 ? null : result.absoluteMessageCount
  });
  activeAbsoluteCountCache?.set(sessionId, result.absoluteMessageCount);
  return true;
}
function getCachedAbsoluteMessageCount2(sessionId) {
  return activeAbsoluteCountCache?.get(sessionId) ?? null;
}
function primeInMemoryTailRawMessageCache2(args) {
  const { sessionId, messages, absoluteMessageCount } = args;
  if (!activeRawMessageCache)
    return false;
  if (activeRawMessageCache.has(sessionId))
    return false;
  const coveredFromOrdinal = messages[0]?.ordinal ?? absoluteMessageCount + 1;
  activeRawMessageCache.set(sessionId, {
    messages,
    coveredFromOrdinal,
    coveredToOrdinal: coveredFromOrdinal === 1 ? null : absoluteMessageCount
  });
  activeAbsoluteCountCache?.set(sessionId, absoluteMessageCount);
  return true;
}
function readRawSessionMessageOrdinalPage2(sessionId, after, limit) {
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider?.readMessageOrdinalPage)
    return provider.readMessageOrdinalPage(after, limit);
  if (provider) {
    const rows = provider.readMessages().map((message) => ({
      id: message.id,
      timeCreated: message.createdAt ?? message.ordinal,
      contributesOrdinal: true,
      hasValidInfo: true
    })).filter((row) => !after || row.timeCreated > after.timeCreated || row.timeCreated === after.timeCreated && row.id > after.id).sort((left, right) => left.timeCreated - right.timeCreated || left.id.localeCompare(right.id));
    return rows.slice(0, Math.max(1, Math.floor(limit)));
  }
  if (!openCodeDbExists())
    return [];
  return withReadOnlySessionDb((db) => readRawSessionMessageOrdinalPageFromDb2(db, sessionId, after, limit));
}
function getRawSessionStoredMessageCount2(sessionId) {
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider?.getStoredMessageCount)
    return provider.getStoredMessageCount();
  if (provider)
    return provider.readMessages().length;
  if (!openCodeDbExists())
    return 0;
  return withReadOnlySessionDb((db) => countStoredRawSessionMessagesFromDb2(db, sessionId));
}
function readRawSessionMessageIdOrdinalsForRange2(sessionId, fromOrdinal, toOrdinal) {
  const from = Math.max(1, Math.floor(fromOrdinal));
  const to = Math.floor(toOrdinal);
  if (to < from)
    return new Map;
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider?.readMessageIdOrdinalsForRange) {
    return provider.readMessageIdOrdinalsForRange(from, to);
  }
  if (!provider) {
    return !openCodeDbExists() ? new Map : withReadOnlySessionDb((db) => readRawSessionMessageIdOrdinalsForRangeFromDb2(db, sessionId, from, to));
  }
  const all = provider?.readMessageIdOrdinals ? provider.readMessageIdOrdinals() : new Map(provider.readMessages().map((message) => [message.id, message.ordinal]));
  return new Map([...all].filter(([, ordinal]) => ordinal >= from && ordinal <= to));
}
function readRawSessionMessageIdOrdinals2(sessionId) {
  const count = getRawSessionMessageOrdinalCount2(sessionId);
  return readRawSessionMessageIdOrdinalsForRange2(sessionId, 1, count);
}
function readRawSessionMessagePartsById2(sessionId, messageId, onQuery) {
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider?.readMessagePartsById)
    return provider.readMessagePartsById(messageId);
  if (provider?.readMessageById)
    return provider.readMessageById(messageId);
  if (provider) {
    return provider.readMessages().find((message) => message.id === messageId) ?? null;
  }
  if (!openCodeDbExists())
    return null;
  return withReadOnlySessionDb((db) => readRawSessionMessagePartsByIdFromDb2(db, sessionId, messageId, onQuery));
}
function readRawSessionBoundaryEndpoints2(sessionId, ids, blockIds) {
  if (sessionProviders.get(sessionId)?.provider)
    return null;
  if (!openCodeDbExists())
    return new Map(ids.map((id) => [id, null]));
  return withReadOnlySessionDb((db) => readRawSessionBoundaryEndpointsFromDb2(db, sessionId, ids, blockIds));
}
function hasRawSessionMessageById2(sessionId, messageId) {
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider?.hasMessageById)
    return provider.hasMessageById(messageId);
  if (!provider)
    return openCodeDbExists() && withReadOnlySessionDb((db) => hasRawSessionMessageByIdFromDb2(db, sessionId, messageId));
  return readRawSessionMessageById2(sessionId, messageId) !== null;
}
function readRawSessionMessageOrdinalById2(sessionId, messageId) {
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider?.readMessageOrdinalById) {
    return provider.readMessageOrdinalById(messageId);
  }
  if (provider?.readMessageIdOrdinals) {
    return provider.readMessageIdOrdinals().get(messageId) ?? null;
  }
  if (provider?.readMessageOrdinalPage) {
    let after = null;
    let ordinal = 0;
    while (true) {
      const page = provider.readMessageOrdinalPage(after, 500);
      if (page.length === 0)
        return null;
      for (const entry of page) {
        if (entry.contributesOrdinal)
          ordinal += 1;
        if (entry.id === messageId)
          return entry.contributesOrdinal ? ordinal : null;
      }
      const last = page.at(-1);
      if (!last || page.length < 500)
        return null;
      after = { timeCreated: last.timeCreated, id: last.id };
    }
  }
  if (provider?.readMessageById) {
    return provider.readMessageById(messageId)?.ordinal ?? null;
  }
  if (provider) {
    return provider.readMessages().find((message) => message.id === messageId)?.ordinal ?? null;
  }
  if (!openCodeDbExists())
    return null;
  return withReadOnlySessionDb((db) => readRawSessionMessageOrdinalByIdFromDb2(db, sessionId, messageId));
}
function compareRawSessionMessageOrder2(sessionId, leftId, rightId) {
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider) {
    if (!provider.readMessageOrdinalById)
      return null;
    const left = provider.readMessageOrdinalById(leftId);
    const right = provider.readMessageOrdinalById(rightId);
    return left === null || right === null ? null : left - right;
  }
  if (!openCodeDbExists())
    return null;
  return withReadOnlySessionDb((db) => {
    const lookup = db.prepare("SELECT time_created, id FROM message WHERE session_id = ? AND id = ? LIMIT 1");
    const left = lookup.get(sessionId, leftId);
    const right = lookup.get(sessionId, rightId);
    if (typeof left?.time_created !== "number" || typeof right?.time_created !== "number" || typeof left.id !== "string" || typeof right.id !== "string") {
      return null;
    }
    if (left.time_created !== right.time_created) {
      return left.time_created - right.time_created;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}
function readRawSessionMessageById2(sessionId, messageId) {
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider?.readMessageById) {
    return provider.readMessageById(messageId);
  }
  if (provider) {
    return provider.readMessages().find((message) => message.id === messageId) ?? null;
  }
  if (!openCodeDbExists())
    return null;
  return withReadOnlySessionDb((db) => readRawSessionMessageByIdFromDb2(db, sessionId, messageId));
}
readRawSessionMessageById2.prepare = prepareRawSessionOrdinals2;
function readRawSessionMessagesFromSource(sessionId) {
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider)
    return provider.readMessages();
  if (!openCodeDbExists())
    return [];
  return withReadOnlySessionDb((db) => readRawSessionMessagesFromDb2(db, sessionId));
}
function getRawSessionMessageCount2(sessionId) {
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider) {
    if (provider.getMessageCount)
      return provider.getMessageCount();
    const messages = provider.readMessages();
    return messages.reduce((maximum, message) => Math.max(maximum, message.ordinal), messages.length);
  }
  if (!openCodeDbExists())
    return 0;
  return withReadOnlySessionDb((db) => getRawSessionMessageCountFromDb(db, sessionId));
}
var RAW_SESSION_TAG_KEY_PAGE_SIZE2 = 32;
function yieldRawSessionTagKeyPage() {
  return new Promise((resolve) => {
    const immediate = globalThis.setImmediate;
    if (typeof immediate === "function") {
      immediate(resolve);
      return;
    }
    setTimeout(resolve, 0);
  });
}
async function getRawSessionTagKeysThrough2(sessionId, upToMessageIndex, options = {}) {
  const messageFileKeys = new Set;
  const toolObservations = new Map;
  const unpairedInvocations = new Map;
  const candidateOwnersByCallId = new Map;
  const messageTimesById = new Map;
  const finalWatermark = Number.isFinite(upToMessageIndex) ? Math.max(0, Math.floor(upToMessageIndex)) : getRawSessionMessageOrdinalCount2(sessionId);
  const pageSize = Number.isFinite(options.pageSize) ? Math.max(1, Math.floor(options.pageSize ?? RAW_SESSION_TAG_KEY_PAGE_SIZE2)) : RAW_SESSION_TAG_KEY_PAGE_SIZE2;
  const yieldToEventLoop = options.yieldToEventLoop ?? yieldRawSessionTagKeyPage;
  const nearestPersistedOwner = (callId, currentMessageId) => {
    if (!options.db)
      return null;
    let candidates = candidateOwnersByCallId.get(callId);
    if (!candidates) {
      candidates = getCandidateToolOwners2(options.db, sessionId, callId);
      candidateOwnersByCallId.set(callId, candidates);
    }
    if (candidates.length === 0)
      return null;
    const ids = [...candidates, currentMessageId];
    const unresolved = ids.filter((id) => !messageTimesById.has(id));
    if (unresolved.length > 0) {
      const resolved = getMessageTimesFromOpenCodeDb(sessionId, unresolved);
      for (const id of unresolved) {
        messageTimesById.set(id, resolved.get(id) ?? null);
      }
    }
    const times = new Map;
    for (const id of ids) {
      const time = messageTimesById.get(id);
      if (typeof time === "number")
        times.set(id, time);
    }
    return pickNearestPriorOwner2(candidates, currentMessageId, times);
  };
  const firstOrdinal = Number.isFinite(options.fromMessageIndex) ? Math.max(1, Math.floor(options.fromMessageIndex ?? 1)) : 1;
  let afterOrdinal = firstOrdinal - 1;
  let after;
  while (afterOrdinal < finalWatermark) {
    const messages = readRawSessionMessages2.readPage(sessionId, afterOrdinal, pageSize, finalWatermark, after);
    if (messages.length === 0)
      break;
    let nextOrdinal = afterOrdinal;
    for (const message of messages) {
      if (message.ordinal <= afterOrdinal || message.ordinal > finalWatermark)
        continue;
      nextOrdinal = Math.max(nextOrdinal, message.ordinal);
      messageTimesById.set(message.id, typeof message.createdAt === "number" ? message.createdAt : null);
      for (const [partIndex, part] of message.parts.entries()) {
        if (isTextPart(part)) {
          messageFileKeys.add(`${message.id}:p${partIndex}`);
          continue;
        }
        if (isFilePart(part)) {
          messageFileKeys.add(`${message.id}:file${partIndex}`);
          continue;
        }
        const observation = extractToolCallObservation(part);
        if (!observation)
          continue;
        let ownerMessageId;
        if (observation.kind === "invocation") {
          ownerMessageId = message.id;
          const queue = unpairedInvocations.get(observation.callId) ?? [];
          queue.push(message.id);
          unpairedInvocations.set(observation.callId, queue);
        } else {
          const queue = unpairedInvocations.get(observation.callId);
          const pairedOwner = queue?.shift();
          if (queue?.length === 0)
            unpairedInvocations.delete(observation.callId);
          ownerMessageId = pairedOwner ?? nearestPersistedOwner(observation.callId, message.id) ?? message.id;
        }
        const owners = toolObservations.get(observation.callId) ?? new Set;
        owners.add(ownerMessageId);
        toolObservations.set(observation.callId, owners);
      }
    }
    if (nextOrdinal <= afterOrdinal)
      break;
    afterOrdinal = nextOrdinal;
    const last = messages.at(-1);
    after = last ? { timeCreated: last.createdAt ?? 0, id: last.id } : undefined;
    if (afterOrdinal < finalWatermark)
      await yieldToEventLoop();
  }
  return { messageFileKeys, toolObservations };
}
var PROTECTED_TAIL_USER_TURNS = 5;
function getLegacyProtectedTailStartOrdinal2(sessionId) {
  const count = getRawSessionMessageOrdinalCount2(sessionId);
  const userOrdinals = [];
  let toOrdinal = count;
  while (toOrdinal >= 1 && userOrdinals.length < PROTECTED_TAIL_USER_TURNS) {
    const fromOrdinal = Math.max(1, toOrdinal - RAW_MESSAGE_RANGE_PAGE_SIZE + 1);
    const messages = readRawSessionMessageRange2(sessionId, fromOrdinal, toOrdinal);
    for (let index = messages.length - 1;index >= 0; index--) {
      const message = messages[index];
      if (message?.role === "user" && hasMeaningfulUserText2(message.parts)) {
        userOrdinals.push(message.ordinal);
        if (userOrdinals.length === PROTECTED_TAIL_USER_TURNS)
          break;
      }
    }
    toOrdinal = fromOrdinal - 1;
  }
  return userOrdinals.length < PROTECTED_TAIL_USER_TURNS ? 1 : userOrdinals[PROTECTED_TAIL_USER_TURNS - 1] ?? 1;
}
function getProtectedTailStartOrdinal2(sessionId) {
  return getLegacyProtectedTailStartOrdinal2(sessionId);
}
function readSessionChunk2(sessionId, tokenBudget, offset = 1, eligibleEndOrdinal, options = {}) {
  const totalMessageCount = getCachedAbsoluteMessageCount2(sessionId) ?? getRawSessionMessageOrdinalCount2(sessionId);
  const startOrdinal = Math.max(1, offset);
  const finalOrdinal = eligibleEndOrdinal === undefined ? totalMessageCount : Math.min(totalMessageCount, eligibleEndOrdinal - 1);
  const messages = readRawSessionMessageRange2(sessionId, Math.max(1, startOrdinal - 1), finalOrdinal);
  const expandedParts = new Map;
  const expandedResults = new Set;
  if (options.expand !== false) {
    const calls = new Map;
    for (const message of messages)
      for (const part of message.parts) {
        if (!part || typeof part !== "object")
          continue;
        const p = part;
        if (p.type !== "tool")
          continue;
        const state = p.state;
        if (state?.input !== undefined && typeof p.callID === "string")
          calls.set(p.callID, p);
        expandedParts.set(part, expandToolPart(part, options.expandTools));
        if (state?.input === undefined && state?.output !== undefined && typeof p.callID === "string") {
          const call = calls.get(p.callID);
          if (call) {
            const expansion = expandToolPart({ ...call, state: { ...call.state, output: state.output } }, options.expandTools);
            if (expansion !== null) {
              expandedParts.set(call, expansion);
              expandedResults.add(part);
            }
            calls.delete(p.callID);
          }
        }
      }
  }
  const completedToolArcs = buildToolArcs(messages).flatMap((arc) => arc.resOrdinal === null ? [] : [{ start: arc.invOrdinal, end: arc.resOrdinal }]);
  const completedToolComponents = [];
  for (const arc of completedToolArcs) {
    const component = completedToolComponents[completedToolComponents.length - 1];
    if (component && arc.start <= component.end)
      component.end = Math.max(component.end, arc.end);
    else
      completedToolComponents.push({ ...arc });
  }
  const lines = [];
  const lineMeta = [];
  const flushedToolOnlyBlocks = [];
  let totalTokens = 0;
  let messagesProcessed = 0;
  let lastOrdinal = startOrdinal - 1;
  let highestScannedOrdinal = startOrdinal - 1;
  let lastMessageId = "";
  let firstMessageId = "";
  let currentBlock = null;
  let pendingNoiseMeta = [];
  let commitClusters = 0;
  let lastFlushedRole = "";
  let admittedOversizeComponentEnd = null;
  let currentBlockApproxTokens = 0;
  let formattedBudgetCrossed = false;
  let sourceCharacters = 0;
  const toolResultBoundaries = [];
  function pinComponentWhenFormattedBudgetCrosses(ordinal, appendedText) {
    if (admittedOversizeComponentEnd !== null || formattedBudgetCrossed || !currentBlock)
      return;
    currentBlockApproxTokens += estimateTokens(appendedText) + (currentBlock.parts.length > 1 ? 1 : 0);
    if (totalTokens + currentBlockApproxTokens + 64 <= tokenBudget)
      return;
    const previewTokens = totalTokens + estimateTokens(formatBlock(currentBlock));
    if (previewTokens <= tokenBudget)
      return;
    formattedBudgetCrossed = true;
    const component = completedToolComponents.find((candidate) => candidate.start <= ordinal && candidate.end >= ordinal);
    if (component)
      admittedOversizeComponentEnd = component.end;
  }
  function recordFilteredNoise(meta) {
    pendingNoiseMeta.push(meta);
    if (!currentBlock) {
      highestScannedOrdinal = Math.max(highestScannedOrdinal, meta.ordinal);
    }
  }
  function flushCurrentBlock() {
    if (!currentBlock)
      return true;
    const blockText = formatBlock(currentBlock);
    const blockTokens = estimateBlockTokens(blockText);
    if (totalTokens + blockTokens > tokenBudget && totalTokens > 0) {
      const splitsCompletedArc = completedToolArcs.some((arc) => arc.start <= lastOrdinal && arc.end > lastOrdinal);
      if (!splitsCompletedArc)
        return false;
    }
    if (currentBlock.role === "A" && currentBlock.commitHashes.length > 0 && lastFlushedRole !== "A") {
      commitClusters++;
    }
    lastFlushedRole = currentBlock.role;
    if (!firstMessageId)
      firstMessageId = currentBlock.meta[0]?.messageId ?? "";
    lastOrdinal = currentBlock.meta[currentBlock.meta.length - 1]?.ordinal ?? currentBlock.endOrdinal;
    highestScannedOrdinal = Math.max(highestScannedOrdinal, lastOrdinal);
    lastMessageId = currentBlock.meta[currentBlock.meta.length - 1]?.messageId ?? "";
    messagesProcessed += currentBlock.meta.length;
    const lineStart = sourceCharacters + (lines.length > 0 ? 1 : 0);
    const renderedParts = currentBlock.parts.join(" / ");
    let partOffset = lineStart + (blockText.length - renderedParts.length);
    for (let index = 0;index < currentBlock.parts.length; index++) {
      const part = currentBlock.parts[index] ?? "";
      const partMeta = currentBlock.partMeta[index];
      if (partMeta && partMeta.toolResultBodyTokens > 0) {
        toolResultBoundaries.push({
          ordinal: partMeta.ordinal,
          sourceOffset: partOffset,
          bodyTokens: partMeta.toolResultBodyTokens
        });
      }
      partOffset += part.length + (index + 1 < currentBlock.parts.length ? 3 : 0);
    }
    lines.push(blockText);
    sourceCharacters = lineStart + blockText.length;
    lineMeta.push(...currentBlock.meta);
    totalTokens += blockTokens;
    if (currentBlock.isToolOnly) {
      flushedToolOnlyBlocks.push({
        start: currentBlock.startOrdinal,
        end: currentBlock.endOrdinal
      });
    }
    currentBlock = null;
    currentBlockApproxTokens = 0;
    return true;
  }
  for (const msg of messages) {
    if (eligibleEndOrdinal !== undefined && msg.ordinal >= eligibleEndOrdinal)
      break;
    if (admittedOversizeComponentEnd !== null && msg.ordinal > admittedOversizeComponentEnd) {
      break;
    }
    if (msg.ordinal < startOrdinal)
      continue;
    const meta = { ordinal: msg.ordinal, messageId: msg.id };
    if (isHostUnservedRow(msg))
      markHostUnservedRow(meta);
    if (msg.role === "user" && !hasMeaningfulChunkUserText(msg.parts)) {
      const tcSummaries = msg.parts.flatMap((part) => {
        if (expandedResults.has(part))
          return [];
        const expansion = expandedParts.get(part) ?? null;
        return expansion === null ? extractToolCallSummaries([part]) : [`TC: ${expansion}`];
      });
      if (tcSummaries.length === 0) {
        recordFilteredNoise(meta);
        continue;
      }
      const tcText = tcSummaries.join(" / ");
      if (currentBlock && currentBlock.role === "A") {
        currentBlock.endOrdinal = msg.ordinal;
        currentBlock.parts.push(tcText);
        currentBlock.partMeta.push({
          ordinal: msg.ordinal,
          toolResultBodyTokens: extractToolResultBodyTokens(msg.parts)
        });
        currentBlock.meta.push(...pendingNoiseMeta, meta);
        pendingNoiseMeta = [];
      } else {
        if (!flushCurrentBlock())
          break;
        currentBlock = {
          role: "A",
          startOrdinal: pendingNoiseMeta[0]?.ordinal ?? msg.ordinal,
          endOrdinal: msg.ordinal,
          parts: [tcText],
          partMeta: [
            {
              ordinal: msg.ordinal,
              toolResultBodyTokens: extractToolResultBodyTokens(msg.parts)
            }
          ],
          meta: [...pendingNoiseMeta, meta],
          commitHashes: [],
          isToolOnly: true
        };
        pendingNoiseMeta = [];
      }
      pinComponentWhenFormattedBudgetCrosses(msg.ordinal, tcText);
      continue;
    }
    const role = compactRole(msg.role);
    const textParts = extractTexts2(msg.parts).map((t) => msg.role === "user" ? cleanUserText2(t) : t).map(normalizeText).filter((value) => value.length > 0);
    const allParts = options.expand === false ? [
      ...textParts,
      ...textParts.length === 0 ? extractToolCallSummaries(msg.parts) : []
    ] : msg.parts.flatMap((part) => {
      if (expandedResults.has(part))
        return [];
      const expansion = expandedParts.get(part) ?? null;
      if (expansion !== null)
        return [`TC: ${expansion}`];
      const texts = extractTexts2([part]).map((t) => msg.role === "user" ? cleanUserText2(t) : t).map(normalizeText).filter(Boolean);
      return texts.length ? texts : textParts.length === 0 ? extractToolCallSummaries([part]) : [];
    });
    const compacted = compactTextForSummary(allParts.join(" / "), msg.role);
    const text = compacted.text;
    if (!text) {
      recordFilteredNoise(meta);
      continue;
    }
    const msgHasNarrative = textParts.length > 0;
    if (currentBlock && currentBlock.role === role) {
      currentBlock.endOrdinal = msg.ordinal;
      currentBlock.parts.push(text);
      currentBlock.partMeta.push({
        ordinal: msg.ordinal,
        toolResultBodyTokens: extractToolResultBodyTokens(msg.parts)
      });
      currentBlock.meta.push(...pendingNoiseMeta, meta);
      currentBlock.commitHashes = mergeCommitHashes(currentBlock.commitHashes, compacted.commitHashes);
      if (msgHasNarrative)
        currentBlock.isToolOnly = false;
      pendingNoiseMeta = [];
      pinComponentWhenFormattedBudgetCrosses(msg.ordinal, text);
      continue;
    }
    if (!flushCurrentBlock())
      break;
    currentBlock = {
      role,
      startOrdinal: pendingNoiseMeta[0]?.ordinal ?? msg.ordinal,
      endOrdinal: msg.ordinal,
      parts: [text],
      partMeta: [
        {
          ordinal: msg.ordinal,
          toolResultBodyTokens: extractToolResultBodyTokens(msg.parts)
        }
      ],
      meta: [...pendingNoiseMeta, meta],
      commitHashes: [...compacted.commitHashes],
      isToolOnly: !msgHasNarrative
    };
    pendingNoiseMeta = [];
    pinComponentWhenFormattedBudgetCrosses(msg.ordinal, text);
  }
  if (flushCurrentBlock() && pendingNoiseMeta.length > 0) {
    const lastNoise = pendingNoiseMeta[pendingNoiseMeta.length - 1];
    if (messagesProcessed > 0 && lastNoise) {
      lineMeta.push(...pendingNoiseMeta);
      messagesProcessed += pendingNoiseMeta.length;
      lastOrdinal = lastNoise.ordinal;
      lastMessageId = lastNoise.messageId;
      pendingNoiseMeta = [];
    }
    highestScannedOrdinal = Math.max(highestScannedOrdinal, pendingNoiseMeta[pendingNoiseMeta.length - 1]?.ordinal ?? highestScannedOrdinal);
  }
  const toolOnlyRanges = [];
  for (const range of flushedToolOnlyBlocks) {
    const last = toolOnlyRanges[toolOnlyRanges.length - 1];
    if (last && range.start === last.end + 1) {
      last.end = range.end;
    } else {
      toolOnlyRanges.push({ start: range.start, end: range.end });
    }
  }
  const text = lines.join(`
`);
  const oversizeAtomicUnit = estimateBlockTokens(text) > tokenBudget && completedToolArcs.some((arc) => arc.start <= lastOrdinal && arc.end >= startOrdinal);
  return {
    startIndex: startOrdinal,
    endIndex: lastOrdinal,
    startMessageId: firstMessageId,
    endMessageId: lastMessageId,
    messageCount: messagesProcessed,
    tokenEstimate: totalTokens,
    ...oversizeAtomicUnit ? { oversizeAtomicUnit: true } : {},
    hasMore: Math.max(lastOrdinal, highestScannedOrdinal) < (eligibleEndOrdinal !== undefined ? Math.min(eligibleEndOrdinal - 1, totalMessageCount) : totalMessageCount),
    text,
    lines: lineMeta,
    ...messagesProcessed === 0 && text.length === 0 ? { filteredNoiseLines: pendingNoiseMeta } : {},
    commitClusterCount: commitClusters,
    toolOnlyRanges,
    completedToolArcs,
    toolResultBoundaries
  };
}
function getRawSessionMessageIdsThrough2(sessionId, endOrdinal) {
  if (endOrdinal < 1)
    return [];
  return [...readRawSessionMessageIdOrdinalsForRange2(sessionId, 1, endOrdinal).entries()].sort((left, right) => left[1] - right[1]).map(([id]) => id);
}
function readRawSessionSeedTail2(sessionId, boundaryId, onQuery) {
  const provider = sessionProviders.get(sessionId)?.provider;
  if (provider) {
    const boundaryOrdinal = boundaryId === null ? 1 : readRawSessionMessageOrdinalById2(sessionId, boundaryId);
    if (boundaryOrdinal === null)
      throw new Error("state_sync materialized boundary is missing from raw provider");
    const messages = readRawSessionMessageRange2(sessionId, boundaryOrdinal, getRawSessionMessageOrdinalCount2(sessionId));
    return new Map(messages.map((message) => [message.id, message]));
  }
  if (!openCodeDbExists()) {
    if (boundaryId !== null)
      throw new Error("state_sync raw storage is unavailable for materialized boundary");
    return new Map;
  }
  return withReadOnlySessionDb((db) => {
    onQuery?.();
    return readRawSeedTailFromDb2(db, sessionId, boundaryId);
  });
}

export { detectThinkingBindingMismatch, detectLatestTurnThinkingMismatch, isPrefixBoundThinkingModel, detectOverflow, MAX_EXECUTE_THRESHOLD, escalationBands, MERGED_REASONING_PARTS_PREFIX, decodeMergedReasoningParts, HYGIENE_PROVIDER_UNITS_VERSION, sessionDecisionCalibration, transitionSessionHygieneUnits, computeProtectionWindow, readEpochFloorSnapshot, getProtectionWindowForSession, SESSION_META_SELECT_COLUMNS, META_COLUMNS, BOOLEAN_META_KEYS, NULL_BIND_META_KEYS, isSessionMetaRow, getDefaultSessionMeta, ensureSessionMetaRow, toSessionMeta, persistCachedM0, clearCachedM0M1, isRustMarkerAdmissionFenced, ReplayDocumentError, readReplayEnvelope, readReplayDocument, updateReplayDocument, writeReplayDocument, isProviderOverflowFailClosedProven, getEmergencyRecoveryArmedAt, describeProtectedTailDrainBudgetSkip, loadProtectedTailMeta, markProtectedTailPolicyV3Seeded, recordProtectedTailPublicationFloor, recordProtectedTailNoEligibleHead, getWrapupInProgressState, isWrapupInProgress, acquireWrapupInProgress, updateWrapupInProgress, releaseWrapupInProgress, resolveCompactionModeRecord, getCompactionModeRecord, setCompactionModeRecord, EMERGENCY_DRAIN_FAILURE_BACKOFF_MS, getProtectedTailDrainBudgetSkip, reserveProtectedTailDrainTokens, clearEmergencyDrainLatch, recordHistorianDrainFailure, clearHistorianDrainFailure, rollbackProtectedTailDrainReservation, clearPersistedReasoningWatermark, getEmergencyInputSample, setEmergencyDropSample, clearEmergencyDropSample, getLastNudgeUndropped, setLastNudgeUndropped, getChannel1NudgeState, setChannel1NudgeState, markChannel1PostReduceGracePending, captureChannel1PostReduceGraceBaseline, getChannel2NudgeState, getChannel2NudgeClaim, setChannel2NudgeState, casChannel2NudgeState, claimChannel2NudgeState, casChannel2NudgeClaim, getPersistedNoteNudge, setPersistedNoteNudgeTrigger, setPersistedNoteNudgeTriggerMessageId, getNoteNudgeAnchors, getAutoSearchHintDecisions, deliverNoteNudgeAtomic, appendAutoSearchHintDecision, pruneNoteNudgeAnchors, queueAutoSearchHintDecisionRetirement, flushAutoSearchHintDecisionRetirement, getPersistedTodoSyntheticAnchor, setPersistedTodoSyntheticAnchor, clearPersistedTodoSyntheticAnchor, getNoteLastReadAt, setNoteLastReadAt, getHistorianFailureState, incrementHistorianFailure, clearHistorianFailureState, getOverflowState, recordOverflowDetected, clearEmergencyRecovery, clearDetectedContextLimit, getPersistedCompactionMarkerState, setPersistedCompactionMarkerState, parseStrippedPlaceholderState, serializeStrippedPlaceholderState, getStrippedPlaceholderIds, applyStrippedPlaceholderDelta, THINKING_BINDING_RECOVERY_FROZEN_PREFIX, THINKING_BINDING_STRIP_ORDER_END_MARKER, thinkingBindingRecoveryFrozenId, getThinkingBindingRecoveryTarget, armThinkingBindingRecovery, clearThinkingBindingRecoveryIf, getMergedReasoningStrippedIds, addMergedReasoningStrippedIds, getProcessedImageStrippedIds, addProcessedImageStrippedIds, getPendingCompactionMarkerState, getCompactionMarkerHealth, clearPendingCompactionMarkerStateIf, getPendingPiCompactionMarkerState, setPendingPiCompactionMarkerState, clearPendingPiCompactionMarkerStateIf, getSessionsWithPendingPiMarker, setSessionWorkMetrics, getSessionWorkMetrics, resolveEpochFloorForPass, withReadOnlySessionDb, expandToolPart, retreatPastHostUnservedRows, completedToolArcCrossesBoundary, estimateTrueRawMessageTokens, buildToolArcs, fenceBoundaryForCompletedToolArcs, fenceBoundaryForToolArcs, buildTrueRawTokenIndex, computeRawRangeFingerprint, invalidateTrueRawTokenCache, stripSystemInjection, hasUserAnswerMetadata, DreamTokenBudgetExceeded, TOKEN_BUDGET_FINALIZE_MESSAGE, TOKEN_BUDGET_TOOL_REFUSAL, registerBudgetFinalizeChild, releaseBudgetFinalizeChild, createDreamTokenBudget, droppedInputMarker, createDroppedInputGuard, isEditTool, applyEditMarkerToInput, modelAcceptsEmptyContent, isAnthropicFamilyRoute, variantChangeBustsProviderCache, isInActiveAnthropicTurn, activeAnthropicTurnStart, hasAnthropicReasoning, findLatestAssistantReasoningMutationExemptMessage, DEFAULT_KEEP_REASONING_TOKENS, resolveKeepReasoningTokens, reasoningStepCost, reasoningBudgetCutoff, reasoningTextAndOpaque, opaqueThinkingCost, SKELETON_REAL_INPUT_MAX_BYTES, toolInputStringBytes, resolveHostServedBoundaryId2, hasRawMessageProvider2, setRawMessageProvider2, setBoundedRawMessageProvider2, withRawMessageProvider2, cleanUserText2, withRawSessionMessageCache2, readRawSessionMessages2, readRawSessionMessagePage2, getRawSessionMessageOrdinalCount2, RAW_MESSAGE_VISIT_PAGE_SIZE2, visitRawSessionMessages2, readRawSessionMessageRange2, prepareRawSessionOrdinals2, primeTailRawMessageCache2, getCachedAbsoluteMessageCount2, primeInMemoryTailRawMessageCache2, readRawSessionMessageOrdinalPage2, getRawSessionStoredMessageCount2, readRawSessionMessageIdOrdinalsForRange2, readRawSessionMessageIdOrdinals2, readRawSessionMessagePartsById2, readRawSessionBoundaryEndpoints2, hasRawSessionMessageById2, readRawSessionMessageOrdinalById2, compareRawSessionMessageOrder2, readRawSessionMessageById2, getRawSessionMessageCount2, RAW_SESSION_TAG_KEY_PAGE_SIZE2, getRawSessionTagKeysThrough2, getLegacyProtectedTailStartOrdinal2, getProtectedTailStartOrdinal2, readSessionChunk2, getRawSessionMessageIdsThrough2, readRawSessionSeedTail2 };
