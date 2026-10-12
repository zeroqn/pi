// ../plugin/src/shared/opencode-db-path.ts
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
var cachedResolution = null;
var lastReadFailure = null;
var claimedDiagnostics = new Set;
function openCodeDataDir(env = process.env, dataHome) {
  return join(dataHome ?? env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode");
}
function environmentKey(dataDir, hostGeneration, channel, env) {
  return [
    hostGeneration,
    dataDir,
    env.OPENCODE_DB ?? "",
    env.OPENCODE_DISABLE_CHANNEL_DB ?? "",
    channel ?? env.OPENCODE_CHANNEL ?? ""
  ].join("\x00");
}
function channelPath(dataDir, channel) {
  return ["latest", "beta", "prod"].includes(channel) ? join(dataDir, "opencode.db") : join(dataDir, `opencode-${channel}.db`);
}
function discoveredCandidateNames(dataDir) {
  const names = ["opencode.db", "opencode-local.db", "opencode-dev.db"];
  try {
    const discovered = readdirSync(dataDir, { withFileTypes: true }).filter((entry) => /^opencode-.+\.db$/.test(entry.name) && !names.includes(entry.name)).map((entry) => entry.name).sort();
    names.push(...discovered);
  } catch {}
  return names;
}
function discoverOpenCodeDb(dataDir) {
  const candidates = discoveredCandidateNames(dataDir).map((name, order) => {
    const path = join(dataDir, name);
    try {
      const metadata = statSync(path);
      return metadata.isFile() ? { path, order, mtimeMs: metadata.mtimeMs } : null;
    } catch {
      return null;
    }
  });
  const existing = candidates.filter((candidate) => candidate !== null).sort((left, right) => right.mtimeMs - left.mtimeMs || left.order - right.order)[0];
  if (!existing) {
    return { path: join(dataDir, "opencode.db"), source: "default", channel: null };
  }
  const name = existing.path.slice(dataDir.length + 1);
  const channel = name === "opencode.db" ? null : name.slice("opencode-".length, -".db".length) || null;
  return { path: existing.path, source: "discovered", channel };
}
function resolveV1Fresh(dataDir, env = process.env) {
  const explicit = env.OPENCODE_DB;
  if (explicit !== undefined && explicit.length > 0) {
    if (explicit === ":memory:") {
      return { path: explicit, source: "OPENCODE_DB", channel: null };
    }
    return {
      path: isAbsolute(explicit) ? explicit : join(dataDir, explicit),
      source: "OPENCODE_DB",
      channel: null
    };
  }
  const disableChannelDb = env.OPENCODE_DISABLE_CHANNEL_DB;
  if (disableChannelDb === "1" || disableChannelDb === "true") {
    return { path: join(dataDir, "opencode.db"), source: "default", channel: null };
  }
  const channel = env.OPENCODE_CHANNEL;
  if (channel !== undefined && channel.length > 0) {
    return { path: channelPath(dataDir, channel), source: "channel", channel };
  }
  return discoverOpenCodeDb(dataDir);
}
function sourceOpenCodeDatabaseFilename(hostGeneration, channel, env = process.env) {
  if (hostGeneration === "v1") {
    const explicit = env.OPENCODE_DB;
    if (explicit !== undefined && explicit.length > 0)
      return explicit;
    if (env.OPENCODE_DISABLE_CHANNEL_DB === "1" || env.OPENCODE_DISABLE_CHANNEL_DB === "true") {
      return "opencode.db";
    }
    return ["latest", "beta", "prod"].includes(channel) ? "opencode.db" : `opencode-${channel}.db`;
  }
  return env.OPENCODE_DB ?? (["latest", "dev", "beta", "next", "prod"].includes(channel) || env.OPENCODE_DISABLE_CHANNEL_DB === "1" || env.OPENCODE_DISABLE_CHANNEL_DB === "true" ? "opencode.db" : `opencode-${channel.replace(/[^a-zA-Z0-9._-]/g, "")}.db`);
}
function resolveV2Fresh(dataDir, channel, env) {
  const filename = sourceOpenCodeDatabaseFilename("v2", channel, env);
  const explicit = env.OPENCODE_DB !== undefined;
  return {
    path: filename === ":memory:" ? filename : resolve(dataDir, filename),
    source: explicit ? "OPENCODE_DB" : env.OPENCODE_CHANNEL ? "channel" : "default",
    channel: explicit ? null : channel
  };
}
function resolveOpenCodeDbPath(hostGeneration = "v1", options = {}) {
  const env = options.env ?? process.env;
  const dataDir = openCodeDataDir(env, options.dataHome);
  const channel = options.channel ?? env.OPENCODE_CHANNEL;
  const key = environmentKey(dataDir, hostGeneration, channel, env);
  if (cachedResolution?.key === key && (!cachedResolution.existed || existsSync(cachedResolution.resolution.path))) {
    if (cachedResolution.existed)
      return cachedResolution.resolution;
  }
  const resolution = hostGeneration === "v2" ? resolveV2Fresh(dataDir, channel ?? "latest", env) : resolveV1Fresh(dataDir, env);
  cachedResolution = {
    key,
    resolution,
    existed: resolution.path !== ":memory:" && existsSync(resolution.path)
  };
  return resolution;
}
function schemaTableNames(db, schema = "main") {
  const rows = db.prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name IN ('message', 'part', 'session', 'project', 'session_message', 'session_v2')`).all();
  return new Set(rows.flatMap((row) => typeof row.name === "string" ? [row.name] : []));
}
function hasV1MessageTables(db, schema = "main") {
  const tables = schemaTableNames(db, schema);
  return tables.has("message") && tables.has("part");
}
function detectOpenCodeStoreGeneration(db, schema = "main") {
  const tables = schemaTableNames(db, schema);
  const hasV1Messages = tables.has("message") && tables.has("part");
  if (hasV1Messages)
    return "v1";
  if (tables.has("session_message"))
    return "v2";
  if (tables.has("session") || tables.has("project"))
    return "v1";
  return "unknown";
}
function hasMigratedV2Schema(tables) {
  return tables.has("session_message") && tables.has("session_v2");
}
function isOpenCodeV2Store(db, schema = "main") {
  return detectOpenCodeStoreGeneration(db, schema) === "v2" || hasMigratedV2Schema(schemaTableNames(db, schema));
}
function assertOpenCodeStoreGeneration(db, expected, path, schema = "main") {
  const actual = detectOpenCodeStoreGeneration(db, schema);
  if (actual === expected)
    return;
  if (expected === "v2" && isOpenCodeV2Store(db, schema))
    return;
  if (actual === "unknown")
    return;
  throw new Error(`OpenCode store generation mismatch at ${path}: expected ${expected}, found ${actual}; refusing generation-specific database access`);
}
function openCodeDbPathExists(resolution = resolveOpenCodeDbPath()) {
  return resolution.path !== ":memory:" && existsSync(resolution.path);
}
function getOpenCodeDbProbeDescriptions(resolution = resolveOpenCodeDbPath()) {
  if (resolution.source === "OPENCODE_DB")
    return [resolution.path];
  if (resolution.source === "channel" || process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" || process.env.OPENCODE_DISABLE_CHANNEL_DB === "true") {
    return [resolution.path];
  }
  const dataDir = openCodeDataDir();
  return [
    join(dataDir, "opencode.db"),
    join(dataDir, "opencode-local.db"),
    join(dataDir, "opencode-dev.db"),
    join(dataDir, "opencode-<channel>.db")
  ];
}
function recordOpenCodeDbReadFailure(resolution, error) {
  const message = error instanceof Error ? error.message : String(error);
  lastReadFailure = { ...resolution, message };
  return lastReadFailure;
}
function clearOpenCodeDbReadFailure(path) {
  if (path === undefined || lastReadFailure?.path === path)
    lastReadFailure = null;
}
function claimOpenCodeDbDiagnosticOnce(surface, resolution) {
  const key = `${surface}\x00${resolution.path}\x00${resolution.source}`;
  if (claimedDiagnostics.has(key))
    return false;
  claimedDiagnostics.add(key);
  return true;
}

// ../plugin/src/features/magic-context/tool-definition-tokens.ts
var measurements = new Map;
var fingerprints = new Map;
var persistenceDb = null;
var cachedInsertStmt = null;
function keyFor(providerID, modelID, agentName) {
  const agent = agentName && agentName.length > 0 ? agentName : "default";
  return `${providerID}/${modelID}/${agent}`;
}
function setDatabase(db) {
  persistenceDb = db;
  cachedInsertStmt = null;
}
function loadToolDefinitionMeasurements(db) {
  let rows = [];
  try {
    rows = db.prepare("SELECT provider_id, model_id, agent_name, tool_id, token_count FROM tool_definition_measurements").all();
  } catch {
    return;
  }
  for (const row of rows) {
    const key = keyFor(row.provider_id, row.model_id, row.agent_name);
    let inner = measurements.get(key);
    if (!inner) {
      inner = new Map;
      measurements.set(key, inner);
    }
    inner.set(row.tool_id, row.token_count);
  }
}

export { resolveOpenCodeDbPath, hasV1MessageTables, assertOpenCodeStoreGeneration, openCodeDbPathExists, getOpenCodeDbProbeDescriptions, recordOpenCodeDbReadFailure, clearOpenCodeDbReadFailure, claimOpenCodeDbDiagnosticOnce, setDatabase, loadToolDefinitionMeasurements };
