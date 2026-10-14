import {
  isRecord,
  providerVisiblePart,
  getCandidateToolOwners2,
  pickNearestPriorOwner2
} from "./index-wj9v2eh7.js";
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
  harnessOwnsOpenCodeStore2
} from "./index-0h2mkab2.js";
import {
  log2,
  sessionLog2
} from "./index-x3dcnxh0.js";
import {
  Database2
} from "./index-3cgbv47m.js";
import {
  stableStringify,
  closeQuietly
} from "./index-nmsb3x01.js";
import {
  canonicalModelIdentity,
  renderToolTemplate
} from "./index-bgmv2kaf.js";
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
} from "./index-vakawmbc.js";
import {
  resolveOpenCodeDbPath,
  assertOpenCodeStoreGeneration,
  openCodeDbPathExists,
  recordOpenCodeDbReadFailure,
  clearOpenCodeDbReadFailure,
  claimOpenCodeDbDiagnosticOnce
} from "./index-8976mezv.js";
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

// ../plugin/src/hooks/magic-context/final-wire-token-estimate.ts
var wireTextTokens = createTokenCountMemo(1e5, 128 * 1024 * 1024);

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

export { detectThinkingBindingMismatch, detectLatestTurnThinkingMismatch, isPrefixBoundThinkingModel, detectOverflow, withReadOnlySessionDb, expandToolPart, retreatPastHostUnservedRows, completedToolArcCrossesBoundary, estimateTrueRawMessageTokens, buildToolArcs, fenceBoundaryForCompletedToolArcs, fenceBoundaryForToolArcs, buildTrueRawTokenIndex, computeRawRangeFingerprint, invalidateTrueRawTokenCache, stripSystemInjection, hasUserAnswerMetadata, DreamTokenBudgetExceeded, TOKEN_BUDGET_FINALIZE_MESSAGE, TOKEN_BUDGET_TOOL_REFUSAL, registerBudgetFinalizeChild, releaseBudgetFinalizeChild, createDreamTokenBudget, droppedInputMarker, createDroppedInputGuard, isEditTool, applyEditMarkerToInput, modelAcceptsEmptyContent, isAnthropicFamilyRoute, variantChangeBustsProviderCache, SKELETON_REAL_INPUT_MAX_BYTES, toolInputStringBytes, resolveHostServedBoundaryId2, hasRawMessageProvider2, setRawMessageProvider2, setBoundedRawMessageProvider2, withRawMessageProvider2, cleanUserText2, withRawSessionMessageCache2, readRawSessionMessages2, readRawSessionMessagePage2, getRawSessionMessageOrdinalCount2, RAW_MESSAGE_VISIT_PAGE_SIZE2, visitRawSessionMessages2, readRawSessionMessageRange2, prepareRawSessionOrdinals2, primeTailRawMessageCache2, getCachedAbsoluteMessageCount2, primeInMemoryTailRawMessageCache2, readRawSessionMessageOrdinalPage2, getRawSessionStoredMessageCount2, readRawSessionMessageIdOrdinalsForRange2, readRawSessionMessageIdOrdinals2, readRawSessionMessagePartsById2, readRawSessionBoundaryEndpoints2, hasRawSessionMessageById2, readRawSessionMessageOrdinalById2, compareRawSessionMessageOrder2, readRawSessionMessageById2, getRawSessionMessageCount2, RAW_SESSION_TAG_KEY_PAGE_SIZE2, getRawSessionTagKeysThrough2, getLegacyProtectedTailStartOrdinal2, getProtectedTailStartOrdinal2, readSessionChunk2, getRawSessionMessageIdsThrough2, readRawSessionSeedTail2 };
