import"./index-dnp1jjar.js";
import"./index-3bb24eb6.js";
import"./index-n0zjvs3h.js";
import"./index-2qtx0q6h.js";
import {
  RAW_MESSAGE_TYPES2
} from "./index-nvh6d3bz.js";
import {
  markHostUnservedRow
} from "./index-by1bzjcd.js";

// ../plugin/src/v2/fold/restore.ts
import { fileURLToPath } from "node:url";

// ../plugin/src/v2/hooks/storage-notice.ts
var STORAGE_NOTICE_PREFIX = "[Magic Context storage notice] ";
function isStorageNoticeText(text) {
  return typeof text === "string" && text.startsWith(STORAGE_NOTICE_PREFIX);
}

// ../plugin/src/v2/fold/host-media.ts
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function isClassInstance(value) {
  if (!isRecord(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype !== Object.prototype && prototype !== null;
}
var rememberedAssetClass;
var rememberedAssetSchema;
var assetSchemaByClass = new WeakMap;
function decodeThroughHostSchema(encoded) {
  const source = encoded.source;
  const assetSchema = rememberedAssetSchema;
  if (!assetSchema)
    return "no host message schema with a media member seen";
  const encoding = assetSchema.ast?.encoding;
  const decode = Array.isArray(encoding) ? encoding[0]?.transformation?.decode : undefined;
  const getter = decode;
  let asset;
  if (getter?._tag === "Transform") {
    if (typeof getter.transform !== "function")
      return "host media schema has no decode transformation";
    asset = getter.transform(encoded);
  } else {
    if (getter?._tag !== undefined)
      return `host media schema has unsupported decode transformation: ${String(getter._tag)}`;
    const run = getter?.run;
    if (typeof run !== "function")
      return "host media schema has no decode transformation";
    const result = run.call(decode, { _tag: "Some", value: encoded }, {});
    const option = result?._tag === "Success" ? result.value : undefined;
    asset = option?._tag === "Some" ? option.value : undefined;
  }
  if (!isClassInstance(asset) || asset.source !== source)
    return "host media schema decode did not return an asset";
  return asset;
}
function hostMediaAsset(data, mediaType) {
  return hostMediaFromEncoded({ source: { type: "base64", data, mediaType } });
}
function hostMediaFromEncoded(value) {
  if (!isRecord(value.source))
    return "missing Media.Asset source";
  const encoded = structuredClone(value);
  if (encoded.source.type === "bytes") {
    if (typeof encoded.source.data !== "string")
      return "bytes media has no JSON codec payload";
    encoded.source.data = new Uint8Array(Buffer.from(encoded.source.data, "base64"));
  }
  if (!["bytes", "base64", "url", "ref"].includes(String(encoded.source.type)))
    return "unknown Media.Asset source";
  let first = "no Media.Asset seen in this process";
  if (rememberedAssetClass) {
    try {
      return new rememberedAssetClass(encoded);
    } catch (error) {
      first = `remembered asset class threw: ${String(error)}`;
    }
  }
  let second;
  try {
    const decoded = decodeThroughHostSchema(encoded);
    if (typeof decoded !== "string")
      return decoded;
    second = decoded;
  } catch (error) {
    second = `host media schema decode threw: ${String(error)}`;
  }
  return `${first}; ${second}`;
}

// ../plugin/src/v2/fold/restore.ts
var HOST_RESTORE_MEDIA = { asset: hostMediaAsset, unavailable: () => {} };
function unavailableAttachmentNote(name, mediaType) {
  return `[Attachment ${name ? `"${name}" ` : ""}(${mediaType}) is not available in this restored history]`;
}
var imageMimes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
function attachmentParts(files, rowID, media) {
  const seen = new Map;
  return files.flatMap((file) => {
    if (imageMimes.has(file.mime) && file.source.type === "inline" && file.mention?.text) {
      const key = JSON.stringify([
        file.mime,
        file.name ?? null,
        file.description ?? null,
        file.mention.text
      ]);
      const payloads = seen.get(key) ?? new Set;
      if (payloads.has(file.data))
        return [];
      payloads.add(file.data);
      seen.set(key, payloads);
    }
    const uri = file.source.type === "uri" ? file.source.uri : undefined;
    const location = uri?.startsWith("file:") ? fileURLToPath(uri) : undefined;
    if (file.mime === "text/plain" || file.mime === "application/x-directory") {
      const directory = file.mime === "application/x-directory";
      return [
        {
          type: "text",
          text: `

${[
            directory ? `Attached directory: ${location ?? file.name ?? uri ?? "directory"}` : `Attached file: ${file.name ?? uri ?? "inline attachment"}`,
            file.description === undefined ? undefined : `Description: ${file.description}`,
            directory && !file.data.length ? undefined : "",
            directory && !file.data.length ? undefined : Buffer.from(file.data, "base64").toString("utf8")
          ].filter((line) => line !== undefined).join(`
`)}`,
          metadata: {
            attachment: {
              source: file.source,
              name: file.name,
              description: file.description
            }
          }
        }
      ];
    }
    if (!imageMimes.has(file.mime) && file.mime !== "application/pdf")
      return [];
    const metadata = file.description === undefined ? undefined : { description: file.description };
    const located = location ? [{ type: "text", text: `Attached file: ${location}` }] : [];
    const asset = media.asset(file.data, file.mime);
    if (typeof asset === "string") {
      media.unavailable({ rowID, name: file.name, mediaType: file.mime, reason: asset });
      return [
        ...located,
        { type: "text", text: unavailableAttachmentNote(file.name, file.mime) }
      ];
    }
    return [...located, { type: "media", media: asset, filename: file.name, metadata }];
  });
}
function restoreRow(row, model, media = HOST_RESTORE_MEDIA) {
  const data = row.data;
  const make = (role, content, metadata = data.metadata) => ({
    id: row.id,
    role,
    content,
    ...metadata === undefined ? {} : { metadata }
  });
  if (row.type === "user") {
    const skills = data.skills ?? [];
    const content = [
      ...skills.flatMap((skill) => skill.text === undefined ? [] : [{ type: "text", text: skill.text }]),
      ...data.text ? [{ type: "text", text: data.text }] : [],
      ...attachmentParts(data.files ?? [], row.id, media)
    ];
    return content.length ? [
      make("user", content, {
        ...data.metadata ?? {},
        ...data.agents?.length ? { agents: data.agents } : {}
      })
    ] : [];
  }
  if (row.type === "system")
    return [{ role: "system", content: [{ type: "text", text: data.text ?? "" }] }];
  if (row.type === "synthetic") {
    if (isStorageNoticeText(data.text))
      return [];
    return [make("user", [{ type: "text", text: data.text ?? "", synthetic: true }])];
  }
  if (row.type === "skill")
    return [make("user", [{ type: "text", text: data.text ?? "" }])];
  if (row.type === "location-switched")
    return [
      make("user", [
        {
          type: "text",
          text: `The working directory has been changed to ${data.location.directory}.`
        }
      ])
    ];
  if (row.type === "shell")
    return data.metadata?.background === true ? [] : [
      make("user", [
        {
          type: "text",
          text: `The following shell command was executed by the user:

Command:
${data.command}

Output:
${data.output?.output ?? ""}`
        }
      ])
    ];
  if (row.type !== "assistant")
    return [];
  const previousModel = data.model;
  const sameProvider = previousModel?.providerID === model.providerID;
  const sameModel = sameProvider && previousModel?.id === model.id;
  const reuse = sameModel && data.error === undefined;
  const metadata = (state) => state === undefined ? undefined : { [model.providerID]: state };
  const reasoningInterrupted = data.content?.some((part) => part.type === "reasoning" && part.time !== undefined && part.time.completed === undefined);
  const content = [];
  const results = [];
  for (const part of data.content ?? []) {
    let native = "native" in part ? part.native : part.type === "tool" ? part.providerState : part.state;
    if (part.type === "tool" && part.providerResultState !== null && typeof part.providerResultState === "object" && !Array.isArray(part.providerResultState))
      native = {
        ...native !== null && typeof native === "object" && !Array.isArray(native) ? native : {},
        ...part.providerResultState
      };
    if (part.type === "text") {
      if (part.text !== "")
        content.push({
          type: "text",
          text: part.text,
          providerMetadata: reuse ? metadata(native) : undefined
        });
      continue;
    }
    if (part.type === "reasoning") {
      if (part.text !== "" || reuse && !reasoningInterrupted && native !== undefined)
        content.push({
          type: data.error === undefined && !reasoningInterrupted ? "reasoning" : "text",
          text: part.text,
          providerMetadata: reuse && !reasoningInterrupted ? metadata(native) : undefined
        });
      continue;
    }
    const state = part.state;
    const completed = state.status === "completed" || state.status === "error";
    const toolReuse = reuse || sameModel && part.executed === true && completed;
    let input = state.input;
    if (state.status === "streaming" && typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch {}
    }
    content.push({
      type: "tool-call",
      id: part.id,
      name: part.name,
      input,
      providerExecuted: part.executed,
      providerMetadata: toolReuse ? metadata(native) : undefined
    });
    if (!completed)
      continue;
    const toolContent = state.content ?? [];
    const single = toolContent.length === 1 ? toolContent[0] : undefined;
    const result = {
      type: "tool-result",
      id: part.id,
      name: part.name,
      providerExecuted: part.executed,
      providerMetadata: (part.executed === true ? sameProvider : reuse) ? metadata(native) : undefined,
      result: state.status === "error" ? { type: "error", value: { error: state.error, content: toolContent } } : single?.type === "text" ? { type: "text", value: single.text } : { type: "content", value: toolContent }
    };
    if (part.executed === true)
      content.push(result);
    else
      results.push({ role: "tool", content: [result] });
  }
  return [...content.length ? [make("assistant", content)] : [], ...results];
}

// ../plugin/src/v2/tool-result.ts
function toolErrorText(result) {
  const value = result.value === undefined ? result : result.value;
  return typeof value === "string" ? value : JSON.stringify(value);
}
function toolStateContent(state) {
  if (typeof state.output === "string")
    return state.output;
  if (state.status === "error")
    return toolErrorText({ error: state.error, content: state.content ?? [] });
  if (typeof state.content === "string")
    return state.content;
  if (!Array.isArray(state.content))
    return "";
  return state.content.map((part) => {
    if (typeof part === "string")
      return part;
    if (!part || typeof part !== "object")
      return "";
    const value = part;
    if (typeof value.text === "string")
      return value.text;
    if (typeof value.value === "string")
      return value.value;
    return "";
  }).filter(Boolean).join(`
`);
}

// ../plugin/src/v2/hooks/store.ts
var rawMessageTypes = new Set(RAW_MESSAGE_TYPES2);
var isRawRow = (row) => rawMessageTypes.has(row.type);
var NO_MODEL = { providerID: "", id: "" };
var NO_MEDIA = {
  asset: () => "rendered only to read message ids",
  unavailable: () => {}
};
function hostServesRowById(row) {
  return isRawRow(row) && restoreRow(row, NO_MODEL, NO_MEDIA).some((message) => message.id === row.id);
}
function projectRawMessages(rows, ordinalFor) {
  return rows.filter(isRawRow).map((row, index) => {
    const message = {
      id: row.id,
      ordinal: ordinalFor(row, index),
      role: row.type === "assistant" ? "assistant" : row.type === "system" ? "system" : "user",
      createdAt: row.time_created ?? row.data.time?.created,
      parts: row.type === "assistant" ? (row.data.content ?? []).map((part) => {
        if (part.type !== "tool")
          return { ...part };
        const state = part.state;
        const content = state.content;
        return {
          type: "tool",
          tool: part.name,
          callID: part.id,
          state: {
            ...state,
            output: state.status === "error" ? toolStateContent(state) : content?.filter((p) => p.type === "text").map((p) => p.text).join(`
`) ?? ""
          }
        };
      }) : [{ type: "text", text: row.data.text ?? "" }]
    };
    Object.defineProperty(message, "storeType", { value: row.type, enumerable: false });
    if (!hostServesRowById(row))
      markHostUnservedRow(message);
    return message;
  });
}
function rawMessagePage(rows, afterOrdinal) {
  return projectRawMessages(rows, (_row, index) => afterOrdinal + index + 1);
}
var SERVED_BOUNDARY_PAGE = 50;
function servedBoundaryRow(reader, sessionID, messageID) {
  const boundary = reader.messageById(sessionID, messageID);
  if (!boundary)
    return null;
  if (hostServesRowById(boundary))
    return boundary;
  let through = boundary.seq - 1;
  for (;; ) {
    const rows = reader.rawRowsThrough(sessionID, through, SERVED_BOUNDARY_PAGE);
    const served = rows.find(hostServesRowById);
    if (served)
      return served;
    const oldest = rows.at(-1);
    if (rows.length < SERVED_BOUNDARY_PAGE || !oldest)
      return null;
    through = oldest.seq - 1;
  }
}
function createV2RawMessageReader(openReader, storePath, releaseReader = (reader) => reader.close()) {
  const servedBoundaryCache = new Map;
  return {
    storePath,
    getRevision: (sessionID) => {
      const reader = openReader();
      try {
        return reader.latestSequence(sessionID);
      } finally {
        releaseReader(reader);
      }
    },
    getCountAfterRevision: (sessionID, after, through) => {
      const reader = openReader();
      try {
        return reader.messageCountAfterSequence(sessionID, after, through);
      } finally {
        releaseReader(reader);
      }
    },
    readPage: (sessionID, afterOrdinal, limit, finalWatermark, after) => {
      const reader = openReader();
      try {
        return rawMessagePage(reader.messagePage(sessionID, afterOrdinal, limit, finalWatermark, after), afterOrdinal);
      } finally {
        releaseReader(reader);
      }
    },
    findById: (sessionID, messageID) => {
      const reader = openReader();
      try {
        const ordinal = reader.messageOrdinalById(sessionID, messageID);
        const row = reader.messageById(sessionID, messageID);
        if (ordinal === null || row === null)
          return null;
        return rawMessagePage([row], ordinal - 1)[0] ?? null;
      } finally {
        releaseReader(reader);
      }
    },
    findPartsById: (sessionID, messageID) => {
      const reader = openReader();
      try {
        const row = reader.messageById(sessionID, messageID);
        return row ? rawMessagePage([row], 0)[0] ?? null : null;
      } finally {
        releaseReader(reader);
      }
    },
    hasById: (sessionID, messageID) => {
      const reader = openReader();
      try {
        return reader.messageExistsById(sessionID, messageID);
      } finally {
        releaseReader(reader);
      }
    },
    ordinalOf: (sessionID, messageID) => {
      const reader = openReader();
      try {
        return reader.messageOrdinalById(sessionID, messageID);
      } finally {
        releaseReader(reader);
      }
    },
    orderOf: (sessionID, messageID) => {
      const reader = openReader();
      try {
        return reader.sequenceForId(sessionID, messageID) ?? null;
      } finally {
        releaseReader(reader);
      }
    },
    ordinalMapForRange: (sessionID, fromOrdinal, toOrdinal) => {
      const reader = openReader();
      try {
        return reader.messageIdOrdinals(sessionID, fromOrdinal, toOrdinal);
      } finally {
        releaseReader(reader);
      }
    },
    readOrdinalPage: (sessionID, after, limit) => {
      const reader = openReader();
      try {
        return reader.messageOrdinalPage(sessionID, after, limit);
      } finally {
        releaseReader(reader);
      }
    },
    getCount: (sessionID) => {
      const reader = openReader();
      try {
        return reader.messageCount(sessionID);
      } finally {
        releaseReader(reader);
      }
    },
    getStoredCount: (sessionID) => {
      const reader = openReader();
      try {
        return reader.storedMessageCount(sessionID);
      } finally {
        releaseReader(reader);
      }
    },
    servedBoundaryIdOf: (sessionID, messageID) => {
      const key = `${sessionID}\x00${messageID}`;
      if (servedBoundaryCache.has(key))
        return servedBoundaryCache.get(key) ?? null;
      const reader = openReader();
      try {
        const served = servedBoundaryRow(reader, sessionID, messageID)?.id ?? null;
        if (servedBoundaryCache.size >= 1000)
          servedBoundaryCache.clear();
        if (served !== null)
          servedBoundaryCache.set(key, served);
        return served;
      } finally {
        releaseReader(reader);
      }
    }
  };
}
function createV2RawMessageProvider(reader, sessionID) {
  return {
    ...reader.storePath ? { workerSource: { kind: "opencode2", path: reader.storePath } } : {},
    readMessagePage: (afterOrdinal, limit, finalWatermark, after) => reader.readPage(sessionID, afterOrdinal, limit, finalWatermark, after),
    readMessageById: (messageID) => reader.findById(sessionID, messageID),
    readMessagePartsById: (messageID) => reader.findPartsById(sessionID, messageID),
    hasMessageById: (messageID) => reader.hasById(sessionID, messageID),
    readMessageOrdinalById: (messageID) => reader.ordinalOf(sessionID, messageID),
    ...reader.orderOf ? {
      readMessageOrderById: (messageID) => reader.orderOf?.(sessionID, messageID) ?? null
    } : {},
    readMessageIdOrdinalsForRange: (fromOrdinal, toOrdinal) => reader.ordinalMapForRange(sessionID, fromOrdinal, toOrdinal),
    readMessageOrdinalPage: (after, limit) => reader.readOrdinalPage(sessionID, after, limit),
    getMessageCount: () => reader.getCount(sessionID),
    getStoredMessageCount: () => reader.getStoredCount(sessionID),
    ...reader.servedBoundaryIdOf ? {
      readServedBoundaryId: (messageID) => reader.servedBoundaryIdOf?.(sessionID, messageID) ?? null
    } : {}
  };
}
export {
  createV2RawMessageProvider,
  createV2RawMessageReader
};
