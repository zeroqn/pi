// ../plugin/src/shared/bounded-session-map.ts
class BoundedSessionMap {
  maxEntries;
  store = new Map;
  constructor(maxEntries) {
    if (!Number.isFinite(maxEntries) || maxEntries < 1) {
      throw new Error(`BoundedSessionMap: maxEntries must be >= 1, got ${maxEntries}`);
    }
    this.maxEntries = maxEntries;
  }
  get(sessionId) {
    const value = this.store.get(sessionId);
    if (value === undefined)
      return;
    this.store.delete(sessionId);
    this.store.set(sessionId, value);
    return value;
  }
  peek(sessionId) {
    return this.store.get(sessionId);
  }
  has(sessionId) {
    return this.store.has(sessionId);
  }
  set(sessionId, value) {
    if (this.store.has(sessionId)) {
      this.store.delete(sessionId);
    } else if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined)
        this.store.delete(oldest);
    }
    this.store.set(sessionId, value);
  }
  delete(sessionId) {
    return this.store.delete(sessionId);
  }
  clear() {
    this.store.clear();
  }
  get size() {
    return this.store.size;
  }
}

// ../plugin/src/features/magic-context/tool-definition-tokens.ts
var ACTIVITY_WINDOW_MS = 10 * 60000;
var MAX_ACTIVITY_GAP_MS = 60000;
var WINDOWED_SINCE_KEY = "tool_definition_measurements:windowed_since";
var routes = new Map;
var sessionFlights = new BoundedSessionMap(1000);
var persistenceDb = null;
var windowedSince;
var boundAt = 0;
var cachedInsertStmt = null;
var cachedDeleteStmt = null;
function agentKey(agentName) {
  return agentName && agentName.length > 0 ? agentName : "default";
}
function keyFor(providerID, modelID, agentName) {
  return `${providerID}/${modelID}/${agentKey(agentName)}`;
}
function routeFor(providerID, modelID, agentName) {
  const key = keyFor(providerID, modelID, agentName);
  let route = routes.get(key);
  if (!route) {
    route = {
      providerID,
      modelID,
      agentName: agentKey(agentName),
      tools: new Map,
      live: false,
      clock: 0,
      lastWallAt: Date.now(),
      oldestFireAt: Number.POSITIVE_INFINITY,
      retired: new Map,
      legacyRows: new Set
    };
    routes.set(key, route);
  }
  return { key, route };
}
function advanceClock(route) {
  const now = Date.now();
  const gap = Math.min(Math.max(now - route.lastWallAt, 0), MAX_ACTIVITY_GAP_MS);
  route.clock += gap;
  route.lastWallAt = Math.max(route.lastWallAt, now);
  return route.clock;
}
function readWindowedSince(db) {
  try {
    const row = db.prepare("SELECT value FROM schema_migrations_meta WHERE key = ?").get(WINDOWED_SINCE_KEY);
    if (!row)
      return;
    const value = Number(row.value);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return;
  }
}
function markWindowed() {
  if (windowedSince !== undefined || !persistenceDb)
    return;
  try {
    persistenceDb.prepare("INSERT OR IGNORE INTO schema_migrations_meta (key, value) VALUES (?, ?)").run(WINDOWED_SINCE_KEY, String(boundAt));
    windowedSince = readWindowedSince(persistenceDb);
  } catch {}
}
function setDatabase(db) {
  const rebound = persistenceDb !== null && persistenceDb !== db;
  persistenceDb = db;
  boundAt = Date.now();
  cachedInsertStmt = null;
  cachedDeleteStmt = null;
  if (rebound) {
    for (const route of routes.values()) {
      for (const slot of route.tools.values()) {
        slot.persisted = false;
        slot.writeFailedAt = undefined;
      }
      for (const retired of route.retired.values())
        retired.rowKept = false;
      route.legacyRows.clear();
    }
  }
  windowedSince = readWindowedSince(db);
  if (windowedSince !== undefined)
    return;
  try {
    if (!db.prepare("SELECT 1 FROM tool_definition_measurements LIMIT 1").get())
      markWindowed();
  } catch {}
}
function loadToolDefinitionMeasurements(db) {
  let rows = [];
  try {
    rows = db.prepare("SELECT provider_id, model_id, agent_name, tool_id, token_count, recorded_at FROM tool_definition_measurements").all();
  } catch {
    return;
  }
  const since = readWindowedSince(db);
  const loadedAt = new Map;
  for (const row of rows) {
    const { route } = routeFor(row.provider_id, row.model_id, row.agent_name);
    if (route.live)
      continue;
    let now = loadedAt.get(route);
    if (now === undefined) {
      now = advanceClock(route);
      loadedAt.set(route, now);
    }
    const legacy = since === undefined || !(Number(row.recorded_at) >= since);
    route.tools.set(row.tool_id, {
      tokens: row.token_count,
      fingerprint: undefined,
      lastFireAt: now,
      legacy,
      persisted: !legacy
    });
    route.oldestFireAt = Math.min(route.oldestFireAt, now);
    if (legacy)
      route.legacyRows.add(row.tool_id);
    else
      route.legacyRows.delete(row.tool_id);
  }
}

export { BoundedSessionMap, setDatabase, loadToolDefinitionMeasurements };
