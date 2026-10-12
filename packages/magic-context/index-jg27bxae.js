import {
  log2
} from "./index-f956htf3.js";
import {
  V2_MEMORY_CATEGORIES
} from "./index-135e8hvg.js";
import {
  normalizeStoredProjectPath,
  storedPathBelongsToIdentity
} from "./index-dkx0b1kt.js";
import {
  ensureColumn,
  healAllNullColumns,
  installV95PerfSchema
} from "./index-gj0r90h9.js";
import {
  resolveOpenCodeDbPath,
  openCodeDbPathExists,
  getOpenCodeDbProbeDescriptions
} from "./index-8976mezv.js";
import {
  Database2
} from "./index-3cgbv47m.js";
import {
  logSlowWriteTransaction
} from "./index-fp37he9a.js";

// ../plugin/src/features/magic-context/workspaces.ts
import { createHash } from "node:crypto";
var VALID_SHARE_CATEGORIES = new Set(V2_MEMORY_CATEGORIES);
var DEFAULT_WORKSPACE_SHARE_CATEGORIES = ["CONSTRAINTS"];
function tableExists(db, tableName) {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1").get(tableName);
  return Boolean(row);
}
function columnExists(db, tableName, columnName) {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return rows.some((row) => row.name === columnName);
}
function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function placeholders(values) {
  return values.map(() => "?").join(", ");
}
function defaultWorkspaceShareCategories() {
  return [...DEFAULT_WORKSPACE_SHARE_CATEGORIES];
}
function warnInvalidShareCategories(reason, raw) {
  log2("[magic-context] WARN: invalid workspace share_categories; sharing no foreign memory categories", {
    reason,
    raw
  });
}
function normalizeShareCategories(raw) {
  if (raw === null || raw === undefined) {
    return defaultWorkspaceShareCategories();
  }
  if (typeof raw !== "string") {
    warnInvalidShareCategories("not a string", raw);
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnInvalidShareCategories("malformed JSON", raw);
    return [];
  }
  if (!Array.isArray(parsed)) {
    warnInvalidShareCategories("not a JSON array", raw);
    return [];
  }
  const categories = [];
  for (const value of parsed) {
    if (typeof value !== "string" || !VALID_SHARE_CATEGORIES.has(value)) {
      warnInvalidShareCategories("unknown category", raw);
      return [];
    }
    if (!categories.includes(value))
      categories.push(value);
  }
  return categories.sort((left, right) => left.localeCompare(right));
}
function selectWorkspaceShareCategories(db, identities) {
  const candidates = uniqueSorted(identities.filter((identity) => identity.length > 0));
  if (candidates.length === 0 || !tableExists(db, "workspace_members")) {
    return null;
  }
  const hasMembership = Boolean(db.prepare(`SELECT 1
                   FROM workspace_members
                  WHERE project_path IN (${placeholders(candidates)})
                  LIMIT 1`).get(...candidates));
  if (!hasMembership)
    return null;
  if (!tableExists(db, "workspaces")) {
    log2("[magic-context] WARN: workspace member has no workspaces table; sharing no foreign memory categories");
    return [];
  }
  if (!columnExists(db, "workspaces", "share_categories")) {
    return defaultWorkspaceShareCategories();
  }
  const row = db.prepare(`SELECT workspace.share_categories AS shareCategories
               FROM workspace_members AS member
               JOIN workspaces AS workspace ON workspace.id = member.workspace_id
              WHERE member.project_path IN (${placeholders(candidates)})
              ORDER BY workspace.id ASC
              LIMIT 1`).get(...candidates);
  if (!row) {
    log2("[magic-context] WARN: workspace member has no workspace share_categories row; sharing no foreign memory categories");
    return [];
  }
  return normalizeShareCategories(row.shareCategories);
}
function resolveWorkspaceShareCategories(db, projectIdentity) {
  return selectWorkspaceShareCategories(db, [projectIdentity]);
}
function resolveWorkspaceIdentitySet(db, projectIdentity) {
  if (!tableExists(db, "workspace_members")) {
    return { identities: [projectIdentity], namesByIdentity: new Map };
  }
  const rows = db.prepare(`SELECT member.project_path AS identity, member.display_name AS displayName
               FROM workspace_members AS anchor
               JOIN workspace_members AS member ON member.workspace_id = anchor.workspace_id
              WHERE anchor.project_path = ?
              ORDER BY member.display_name ASC, member.project_path ASC`).all(projectIdentity);
  if (rows.length === 0) {
    return { identities: [projectIdentity], namesByIdentity: new Map };
  }
  const namesByIdentity = new Map;
  const identities = [];
  for (const row of rows) {
    if (typeof row.identity !== "string" || row.identity.length === 0)
      continue;
    if (identities.includes(row.identity))
      continue;
    identities.push(row.identity);
    if (typeof row.displayName === "string" && row.displayName.length > 0) {
      namesByIdentity.set(row.identity, row.displayName);
    }
  }
  return identities.length > 0 ? { identities, namesByIdentity } : { identities: [projectIdentity], namesByIdentity: new Map };
}
function expandWorkspaceIdentitySetWithAliases(db, identities) {
  const canonical = uniqueSorted(identities.filter((identity) => identity.length > 0));
  const expanded = new Set(canonical);
  const canonicalIdentityByStoredPath = new Map;
  for (const identity of canonical) {
    canonicalIdentityByStoredPath.set(identity, identity);
  }
  if (canonical.length === 0 || !tableExists(db, "v22_identity_rekey_map")) {
    return { expandedIdentities: [...expanded], canonicalIdentityByStoredPath };
  }
  const rows = db.prepare(`SELECT old_project_path AS oldProjectPath, new_project_path AS newProjectPath
               FROM v22_identity_rekey_map
              WHERE new_project_path IN (${placeholders(canonical)})
              ORDER BY old_project_path ASC`).all(...canonical);
  for (const row of rows) {
    if (typeof row.oldProjectPath !== "string" || typeof row.newProjectPath !== "string") {
      continue;
    }
    if (!canonicalIdentityByStoredPath.has(row.newProjectPath))
      continue;
    expanded.add(row.oldProjectPath);
    canonicalIdentityByStoredPath.set(row.oldProjectPath, row.newProjectPath);
  }
  return { expandedIdentities: [...expanded], canonicalIdentityByStoredPath };
}
function resolveStoredPathWorkspaceIdentity(storedProjectPath, memberIdentities, canonicalIdentityByStoredPath) {
  const direct = canonicalIdentityByStoredPath.get(storedProjectPath);
  if (direct)
    return direct;
  const normalized = normalizeStoredProjectPath(storedProjectPath);
  const normalizedDirect = canonicalIdentityByStoredPath.get(normalized);
  if (normalizedDirect)
    return normalizedDirect;
  if (memberIdentities.includes(normalized))
    return normalized;
  for (const identity of memberIdentities) {
    if (storedPathBelongsToIdentity(storedProjectPath, identity)) {
      return identity;
    }
  }
  return null;
}
function storedPathBelongsToWorkspace(storedProjectPath, memberIdentities, expandedIdentities, canonicalIdentityByStoredPath) {
  if (expandedIdentities.includes(storedProjectPath))
    return true;
  return resolveStoredPathWorkspaceIdentity(storedProjectPath, memberIdentities, canonicalIdentityByStoredPath) !== null;
}
function sourceNameForMemory(storedProjectPath, ownIdentity, memberIdentities, namesByIdentity, canonicalIdentityByStoredPath) {
  const canonicalIdentity = resolveStoredPathWorkspaceIdentity(storedProjectPath, memberIdentities, canonicalIdentityByStoredPath);
  if (!canonicalIdentity || canonicalIdentity === ownIdentity)
    return;
  return namesByIdentity.get(canonicalIdentity);
}
function getEpochMap(db, identities) {
  if (identities.length === 0)
    return new Map;
  const rows = db.prepare(`SELECT project_path AS projectPath, project_memory_epoch AS epoch
               FROM project_state
              WHERE project_path IN (${placeholders(identities)})`).all(...identities);
  const epochs = new Map;
  for (const row of rows) {
    if (typeof row.projectPath !== "string" || typeof row.epoch !== "number")
      continue;
    epochs.set(row.projectPath, row.epoch);
  }
  return epochs;
}
function computeWorkspaceEpochFingerprint(db, identities) {
  const canonical = uniqueSorted(identities.filter((identity) => identity.length > 0));
  const epochs = getEpochMap(db, canonical);
  const shareCategories = selectWorkspaceShareCategories(db, canonical);
  const hash = createHash("sha256");
  hash.update("share_categories", "utf8");
  hash.update("\x00");
  hash.update(shareCategories === null ? "NO_WORKSPACE" : JSON.stringify(shareCategories), "utf8");
  hash.update(`
`);
  for (const identity of canonical) {
    hash.update(identity, "utf8");
    hash.update("\x00");
    hash.update(String(epochs.get(identity) ?? 0), "utf8");
    hash.update(`
`);
  }
  return hash.digest("hex");
}
function isInTransaction(db) {
  const candidate = db;
  return candidate.inTransaction === true || candidate.isTransaction === true;
}
function bumpEpochRows(db, identities, now) {
  const stmt = db.prepare(`INSERT INTO project_state
            (project_path, project_memory_epoch, project_user_profile_version, updated_at)
         VALUES (?, 1, 0, ?)
         ON CONFLICT(project_path) DO UPDATE SET
            project_memory_epoch = project_memory_epoch + 1,
            updated_at = excluded.updated_at`);
  for (const identity of uniqueSorted(identities)) {
    stmt.run(identity, now);
  }
}
function bumpEpochsForWorkspaceMemberSet(db, identities, now = Date.now()) {
  const run = () => bumpEpochRows(db, identities, now);
  if (isInTransaction(db)) {
    run();
    return;
  }
  db.exec("BEGIN IMMEDIATE");
  const transactionStartedAt = performance.now();
  try {
    run();
    db.exec("COMMIT");
    logSlowWriteTransaction("workspace_epoch_bump", transactionStartedAt);
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

// ../plugin/src/features/magic-context/migrations.ts
import { isMainThread } from "node:worker_threads";

// ../plugin/src/shared/xml-unescape.ts
var XML_ENTITY_REGEX = /&(amp|apos|quot|lt|gt);/g;
var XML_ENTITIES = {
  amp: "&",
  apos: "'",
  quot: '"',
  lt: "<",
  gt: ">"
};
function unescapeXml(s) {
  return s.replace(XML_ENTITY_REGEX, (entity, name) => XML_ENTITIES[name] ?? entity);
}

// ../plugin/src/hooks/magic-context/compartment-parser.ts
var COMPARTMENT_OPEN_REGEX = /<compartment\s+((?:[^>"]|"[^"\n]*")*?)\s*>/g;
var COMPARTMENT_CLOSE_TAG = "</compartment>";
var COMPARTMENT_CLOSE_FOLLOWER_REGEX = /^\s*(?:$|<(?:compartment\s|\/compartments\s*>|\/output\s*>|(?:facts|events|meta|user_observations|primer_candidates|unprocessed_from)\s*>))/;
var ATTR_START_REGEX = /\bstart="(\d+)"/;
var ATTR_END_REGEX = /\bend="(\d+)"/;
var ATTR_TITLE_REGEX = /\btitle="([^"]*)"/;
var ATTR_EPISODE_REGEX = /\bepisode_type="([^"]*)"/;
var ATTR_IMPORTANCE_REGEX = /\bimportance="(\d+)"/;
var TIER_OPEN_REGEX = /<p(\d)\s*(\/?)>/g;
var TIER_CLOSE_REGEX = /<\/p(\d)\s*>/g;
var TIER_CLOSE_FOLLOWER_REGEX = /^\s*(?:$|<\/?p\d\s*\/?>)/;
var TIER_CLOSE_ANY_REGEX = /<\/p\d/;
var TIER_OPEN_ANY_REGEX = /<p\d/;
var CATEGORY_BLOCK_REGEX = /<([A-Za-z_][A-Za-z0-9_-]*)>(.*?)<\/\1>/gs;
var HISTORIAN_CATEGORIES = new Set(V2_MEMORY_CATEGORIES);
var FACT_ITEM_REGEX = /^\s*\*\s*(.+)$/gm;
var UNPROCESSED_REGEX = /<unprocessed_from>(\d+)<\/unprocessed_from>/;
var USER_OBSERVATIONS_REGEX = /<user_observations>(.*?)<\/user_observations>/s;
var USER_OBS_ITEM_REGEX = /^\s*\*\s*(.+)$/gm;
var PRIMER_CANDIDATES_REGEX = /<primer_candidates>(.*?)<\/primer_candidates>/s;
var PRIMER_ELEMENT_REGEX = /<primer\s+at_compartment="(\d+)"\s*>(.*?)<\/primer>/gs;
var PRIMER_ITEM_REGEX = /^\s*(?:\*|-|\d+\.)\s*(.+)$/gm;
var FACTS_BLOCK_REGEX = /<facts>(.*?)<\/facts>/s;
var EVENTS_BLOCK_REGEX = /<events>(.*?)<\/events>/s;
var EVENT_ELEMENT_REGEX = /<([a-z_]+)\s+at_compartment="(\d+)"\s*>(.*?)<\/\1>/gs;
var EVENT_FIELD_REGEX = /<([a-z_]+)\s*>(.*?)<\/\1>/gs;
function searchFrom(s, regex, from) {
  const at = s.slice(from).search(regex);
  return at === -1 ? -1 : from + at;
}
function hasTierOpenerFrom(inner, digit, from) {
  return new RegExp(`<p${digit}\\s*/?>`).test(inner.slice(from));
}
function findMatchingTierClose(inner, bodyStart, digit, found) {
  const closeRegex = new RegExp(TIER_CLOSE_REGEX.source, "g");
  closeRegex.lastIndex = bodyStart;
  for (let close = closeRegex.exec(inner);close; close = closeRegex.exec(inner)) {
    const end = close.index + close[0].length;
    if (Number(close[1]) !== digit)
      continue;
    if (!TIER_CLOSE_FOLLOWER_REGEX.test(inner.slice(end)))
      continue;
    const body = inner.slice(bodyStart, close.index);
    for (const open of body.matchAll(new RegExp(TIER_OPEN_REGEX.source, "g"))) {
      const other = Number(open[1]);
      const otherwiseMissing = other >= 1 && other <= 4 && other !== digit && !found.has(other) && !hasTierOpenerFrom(inner, other, end);
      if (otherwiseMissing)
        return;
    }
    return { start: close.index, end };
  }
  return;
}
function extractTiers(inner) {
  const tiers = new Map;
  const openRegex = new RegExp(TIER_OPEN_REGEX.source, "g");
  let pos = 0;
  for (;; ) {
    openRegex.lastIndex = pos;
    const open = openRegex.exec(inner);
    if (!open)
      break;
    const digit = Number(open[1]);
    const bodyStart = open.index + open[0].length;
    let bodyEnd = bodyStart;
    pos = bodyStart;
    if (open[2] !== "/") {
      const close = findMatchingTierClose(inner, bodyStart, digit, tiers);
      if (close) {
        bodyEnd = close.start;
        pos = close.end;
      } else {
        const closeAt = searchFrom(inner, TIER_CLOSE_ANY_REGEX, bodyStart);
        bodyEnd = closeAt === -1 ? inner.length : closeAt;
        pos = closeAt === -1 ? inner.length : closeAt + 1;
        const openInside = searchFrom(inner.slice(0, bodyEnd), TIER_OPEN_ANY_REGEX, bodyStart);
        if (openInside !== -1) {
          bodyEnd = openInside;
          pos = openInside;
        }
      }
    }
    if (!tiers.has(digit)) {
      tiers.set(digit, unescapeXml(inner.slice(bodyStart, bodyEnd).trim()));
    }
  }
  return tiers;
}
function extractTiersFromInner(inner) {
  const tiers = extractTiers(inner);
  return { p1: tiers.get(1), p2: tiers.get(2), p3: tiers.get(3), p4: tiers.get(4) };
}
function findCompartmentElements(text) {
  const elements = [];
  const openRegex = new RegExp(COMPARTMENT_OPEN_REGEX.source, "g");
  let cursor = 0;
  for (;; ) {
    openRegex.lastIndex = cursor;
    const open = openRegex.exec(text);
    if (!open)
      break;
    const bodyStart = open.index + open[0].length;
    const nextOpen = openRegex.exec(text);
    const windowEnd = nextOpen ? nextOpen.index : text.length;
    const firstClose = text.indexOf(COMPARTMENT_CLOSE_TAG, bodyStart);
    if (firstClose === -1)
      break;
    let closeAt = firstClose;
    for (let at = firstClose;at !== -1 && at < windowEnd; at = text.indexOf(COMPARTMENT_CLOSE_TAG, at + 1)) {
      if (COMPARTMENT_CLOSE_FOLLOWER_REGEX.test(text.slice(at + COMPARTMENT_CLOSE_TAG.length))) {
        closeAt = at;
        break;
      }
    }
    const end = closeAt + COMPARTMENT_CLOSE_TAG.length;
    elements.push({
      start: open.index,
      end,
      attrs: open[1],
      inner: text.slice(bodyStart, closeAt)
    });
    cursor = end;
  }
  return elements;
}
function textOutsideCompartments(text, elements) {
  let outside = "";
  let last = 0;
  for (const element of elements) {
    outside += text.slice(last, element.start);
    last = element.end;
  }
  return outside + text.slice(last);
}
function parseCompartmentOutput(text) {
  const compartments = [];
  const facts = [];
  let droppedFactBlocks = 0;
  let droppedFacts = 0;
  const elements = findCompartmentElements(text);
  for (const { attrs, inner } of elements) {
    const startMatch = attrs.match(ATTR_START_REGEX);
    const endMatch = attrs.match(ATTR_END_REGEX);
    const titleMatch = attrs.match(ATTR_TITLE_REGEX);
    if (!startMatch || !endMatch || !titleMatch)
      continue;
    const startMessage = parseInt(startMatch[1], 10);
    const endMessage = parseInt(endMatch[1], 10);
    const title = unescapeXml(titleMatch[1]);
    if (Number.isNaN(startMessage) || Number.isNaN(endMessage) || !title)
      continue;
    const episodeMatch = attrs.match(ATTR_EPISODE_REGEX);
    const importanceMatch = attrs.match(ATTR_IMPORTANCE_REGEX);
    const episodeType = episodeMatch ? unescapeXml(episodeMatch[1]) : undefined;
    const importance = importanceMatch ? parseInt(importanceMatch[1], 10) : undefined;
    const { p1, p2, p3, p4 } = extractTiersFromInner(inner);
    if (typeof p1 === "string" && p1.length > 0) {
      compartments.push({
        startMessage,
        endMessage,
        title,
        content: p1,
        p1,
        p2: typeof p2 === "string" ? p2 : p1,
        p3: typeof p3 === "string" ? p3 : typeof p2 === "string" ? p2 : p1,
        p4: typeof p4 === "string" ? p4 : "",
        importance,
        episodeType
      });
      continue;
    }
    const content = unescapeXml(inner.trim());
    if (content) {
      compartments.push({
        startMessage,
        endMessage,
        title,
        content,
        importance,
        episodeType
      });
    }
  }
  const outside = textOutsideCompartments(text, elements);
  const factsBlockMatch = outside.match(FACTS_BLOCK_REGEX);
  const factsScope = factsBlockMatch ? factsBlockMatch[1] : outside.replace(EVENTS_BLOCK_REGEX, "").replace(/<(meta|user_observations|primer_candidates)>.*?<\/\1>/gs, "").replace(/<\/?(?:output|compartments)>/g, "");
  for (const categoryMatch of factsScope.matchAll(CATEGORY_BLOCK_REGEX)) {
    const category = categoryMatch[1];
    const blockContent = categoryMatch[2];
    const items = [...blockContent.matchAll(FACT_ITEM_REGEX)].map((match) => unescapeXml(match[1].trim())).filter(Boolean);
    if (!HISTORIAN_CATEGORIES.has(category)) {
      if (items.length === 0)
        continue;
      droppedFactBlocks++;
      droppedFacts += items.length;
      log2(`[historian] Dropped <facts> category ${category} (${items.length} facts)`);
      continue;
    }
    for (const content of items)
      facts.push({ category, content });
  }
  const unprocessedMatch = outside.match(UNPROCESSED_REGEX);
  const unprocessedFrom = unprocessedMatch ? parseInt(unprocessedMatch[1], 10) : null;
  const userObservations = [];
  const userObsMatch = outside.match(USER_OBSERVATIONS_REGEX);
  if (userObsMatch) {
    for (const itemMatch of userObsMatch[1].matchAll(USER_OBS_ITEM_REGEX)) {
      const obs = unescapeXml(itemMatch[1].trim());
      if (obs)
        userObservations.push(obs);
    }
  }
  const primerCandidates = [];
  const primerMatch = outside.match(PRIMER_CANDIDATES_REGEX);
  if (primerMatch) {
    const block = primerMatch[1];
    let sawElement = false;
    for (const el of block.matchAll(PRIMER_ELEMENT_REGEX)) {
      sawElement = true;
      const question = unescapeXml(el[2].trim());
      if (question) {
        primerCandidates.push({
          question,
          originCompartmentIndex: Number.parseInt(el[1], 10)
        });
      }
    }
    if (!sawElement) {
      for (const itemMatch of block.matchAll(PRIMER_ITEM_REGEX)) {
        const question = unescapeXml(itemMatch[1].trim());
        if (question)
          primerCandidates.push({ question });
      }
    }
  }
  const events = parseEvents(outside);
  const sortedByStart = compartments.map((compartment, emitted) => ({ compartment, emitted })).sort((a, b) => a.compartment.startMessage - b.compartment.startMessage);
  const sortedPosition = [];
  sortedByStart.forEach(({ emitted }, sorted) => {
    sortedPosition[emitted] = sorted + 1;
  });
  const remapAnchor = (anchor) => anchor >= 1 && anchor <= sortedPosition.length ? sortedPosition[anchor - 1] : anchor;
  return {
    compartments: sortedByStart.map(({ compartment }) => compartment),
    facts,
    droppedFactBlocks,
    droppedFacts,
    events: events.map((event) => event.atCompartment === null ? event : { ...event, atCompartment: remapAnchor(event.atCompartment) }),
    unprocessedFrom,
    userObservations,
    primerCandidates: primerCandidates.map((candidate) => candidate.originCompartmentIndex === undefined ? candidate : {
      ...candidate,
      originCompartmentIndex: remapAnchor(candidate.originCompartmentIndex)
    })
  };
}
function parseEvents(text) {
  const blockMatch = text.match(EVENTS_BLOCK_REGEX);
  if (!blockMatch)
    return [];
  const block = blockMatch[1];
  const events = [];
  for (const elMatch of block.matchAll(EVENT_ELEMENT_REGEX)) {
    const kind = elMatch[1];
    const atRaw = parseInt(elMatch[2], 10);
    const atCompartment = Number.isNaN(atRaw) ? null : atRaw;
    const fields = {};
    for (const fieldMatch of elMatch[3].matchAll(EVENT_FIELD_REGEX)) {
      const name = fieldMatch[1];
      const value = unescapeXml(fieldMatch[2].trim());
      if (value)
        fields[name] = value;
    }
    events.push({ kind, atCompartment, fields });
  }
  return events;
}

// ../plugin/src/features/magic-context/lkg-prefix-chunks.ts
import { createHash as createHash2 } from "node:crypto";
var LKG_PREFIX_CHUNK_CHARS = 64 * 1024;
function splitLkgPrefix(jsonPrefix) {
  const chunks = [];
  let start = 0;
  while (start < jsonPrefix.length) {
    let end = Math.min(start + LKG_PREFIX_CHUNK_CHARS, jsonPrefix.length);
    if (end < jsonPrefix.length) {
      const last = jsonPrefix.charCodeAt(end - 1);
      if (last >= 55296 && last <= 56319)
        end -= 1;
    }
    chunks.push(jsonPrefix.slice(start, end));
    start = end;
  }
  return chunks;
}
function hashLkgChunk(body) {
  return createHash2("sha256").update(body).digest("hex");
}
function hashLkgChunkList(chunkHashes) {
  return createHash2("sha256").update(chunkHashes.join(`
`)).digest("hex");
}
function layoutLkgPrefix(jsonPrefix) {
  const chunks = splitLkgPrefix(jsonPrefix);
  const chunkHashes = chunks.map(hashLkgChunk);
  return { chunks, chunkHashes, chars: jsonPrefix.length, hash: hashLkgChunkList(chunkHashes) };
}
function assembleLkgPrefix(expected, rows) {
  const { chars, chunks, hash } = expected;
  if (typeof chars !== "number" || !Number.isSafeInteger(chars) || typeof chunks !== "number" || !Number.isSafeInteger(chunks) || typeof hash !== "string" || rows.length !== chunks) {
    return;
  }
  const bodies = [];
  let length = 0;
  for (let index = 0;index < rows.length; index += 1) {
    const row = rows[index];
    if (row?.chunk !== index || typeof row.body !== "string")
      return;
    bodies.push(row.body);
    length += row.body.length;
  }
  if (length !== chars)
    return;
  const chunkHashes = bodies.map(hashLkgChunk);
  if (chunkHashes.some((chunkHash, index) => rows[index]?.hash !== chunkHash))
    return;
  if (hashLkgChunkList(chunkHashes) !== hash)
    return;
  return { jsonPrefix: bodies.join(""), chunkHashes, hash };
}

// ../plugin/src/features/magic-context/migration-v94-write-split.ts
var LKG_SLOT_CHUNKS_DDL = `
    CREATE TABLE IF NOT EXISTS lkg_slot_chunks (
        session_id TEXT NOT NULL,
        chunk INTEGER NOT NULL,
        hash TEXT NOT NULL,
        body TEXT NOT NULL,
        PRIMARY KEY (session_id, chunk)
    );
`;
var SESSION_REPLAY_DECISIONS_DDL = `
    CREATE TABLE IF NOT EXISTS session_replay_decisions (
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        PRIMARY KEY (session_id, message_id)
    ) WITHOUT ROWID;
`;
function lkgSlotsDdl(table) {
  return `
        CREATE TABLE IF NOT EXISTS ${table} (
            session_id TEXT PRIMARY KEY,
            json_prefix_chars INTEGER NOT NULL,
            json_prefix_chunks INTEGER NOT NULL,
            json_prefix_hash TEXT NOT NULL,
            input_id_seq TEXT NOT NULL,
            input_content_digests TEXT NOT NULL,
            input_content_signatures TEXT,
            last_input_message_id TEXT NOT NULL,
            model_key TEXT,
            provider_key TEXT,
            captured_at INTEGER NOT NULL,
            row_version INTEGER,
            capture_sequence INTEGER
        );
    `;
}
var LKG_SLOTS_DDL = lkgSlotsDdl("lkg_slots");
var LKG_MOVE_WINDOW_MS = 24 * 60 * 60 * 1000;
function tableExists2(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}
function columnExists2(db, table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => row.name === column);
}
function splitLkgSlotPrefixes(db, now = Date.now()) {
  db.exec(LKG_SLOT_CHUNKS_DDL);
  if (!tableExists2(db, "lkg_slots")) {
    db.exec(LKG_SLOTS_DDL);
    return;
  }
  if (!columnExists2(db, "lkg_slots", "json_prefix"))
    return;
  db.prepare("DELETE FROM lkg_slots WHERE NOT (captured_at >= ?)").run(now - LKG_MOVE_WINDOW_MS);
  db.exec("DROP TABLE IF EXISTS lkg_slots_v94");
  db.exec(lkgSlotsDdl("lkg_slots_v94"));
  const sessionIds = db.prepare("SELECT session_id FROM lkg_slots").all().map((row) => row.session_id);
  const readPrefix = db.prepare("SELECT json_prefix FROM lkg_slots WHERE session_id IS ?");
  const insertSlot = db.prepare(`INSERT OR IGNORE INTO lkg_slots_v94 (
            session_id, json_prefix_chars, json_prefix_chunks, json_prefix_hash,
            input_id_seq, input_content_digests, input_content_signatures,
            last_input_message_id, model_key, provider_key,
            captured_at, row_version, capture_sequence
        )
        SELECT session_id, ?, ?, ?,
            input_id_seq, input_content_digests, input_content_signatures,
            last_input_message_id, model_key, provider_key,
            captured_at, row_version, capture_sequence
        FROM lkg_slots WHERE session_id IS ?`);
  const insertChunk = db.prepare("INSERT INTO lkg_slot_chunks (session_id, chunk, hash, body) VALUES (?, ?, ?, ?)");
  db.prepare("DELETE FROM lkg_slot_chunks").run();
  for (const sessionId of sessionIds) {
    if (typeof sessionId !== "string")
      continue;
    const row = readPrefix.get(sessionId);
    if (typeof row?.json_prefix !== "string")
      continue;
    const layout = layoutLkgPrefix(row.json_prefix);
    const inserted = insertSlot.run(layout.chars, layout.chunks.length, layout.hash, sessionId);
    if (Number(inserted.changes) !== 1)
      continue;
    for (let index = 0;index < layout.chunks.length; index += 1) {
      insertChunk.run(sessionId, index, layout.chunkHashes[index], layout.chunks[index]);
    }
  }
  db.exec("DROP TABLE lkg_slots");
  db.exec("ALTER TABLE lkg_slots_v94 RENAME TO lkg_slots");
}
function validDecisionSql(type, value) {
  return `(${type} = 'text' AND (
        ${value} IN ('keep', 'strip') OR (
            ${value} GLOB 'keep:[1-9]*'
            AND substr(${value}, 6) NOT GLOB '*[^0-9]*'
            AND length(${value}) <= 10
            AND CAST(substr(${value}, 6) AS INTEGER) BETWEEN 2 AND 10000
        )
    ))`;
}
function splitReplayDecisions(db) {
  db.exec(SESSION_REPLAY_DECISIONS_DDL);
  if (!tableExists2(db, "session_meta"))
    return;
  if (!columnExists2(db, "session_meta", "trailing_blank_decisions"))
    return;
  const doc = "sm.trailing_blank_decisions";
  const hasVersionKey = `json_type(${doc}, '$.version') IS NOT NULL`;
  const versionIsDecision = validDecisionSql(`json_type(${doc}, '$.version')`, `json_extract(${doc}, '$.version')`);
  const isV2 = `(${hasVersionKey} AND NOT ${versionIsDecision})`;
  const v2Valid = `(
        json_type(${doc}, '$.version') IN ('integer', 'real')
        AND json_extract(${doc}, '$.version') = 2
        AND json_type(${doc}, '$.trailingBlank') = 'object'
        AND NOT EXISTS (
            SELECT 1 FROM json_each(${doc}, '$.trailingBlank') AS entry
            WHERE entry.key = '' OR NOT ${validDecisionSql("entry.type", "entry.value")}
        )
    )`;
  const v1Valid = `NOT EXISTS (
        SELECT 1 FROM json_each(${doc}) AS entry
        WHERE entry.key = '' OR NOT ${validDecisionSql("entry.type", "entry.value")}
    )`;
  db.exec("DROP TABLE IF EXISTS temp.v94_replay_documents");
  db.exec(`
        CREATE TEMP TABLE v94_replay_documents AS
        SELECT session_id, version FROM (
            SELECT sm.session_id AS session_id, CASE WHEN ${isV2} THEN 2 ELSE 1 END AS version,
                CASE WHEN ${isV2} THEN ${v2Valid} ELSE ${v1Valid} END AS strictly_valid
            FROM session_meta AS sm
            WHERE typeof(${doc}) = 'text' AND ${doc} <> ''
                AND json_valid(${doc}) AND json_type(${doc}) = 'object'
        ) WHERE strictly_valid;
    `);
  db.exec(`
        INSERT INTO session_replay_decisions (session_id, message_id, decision)
        SELECT sm.session_id, entry.key, entry.value
        FROM v94_replay_documents AS moved
        JOIN session_meta AS sm ON sm.session_id = moved.session_id
        JOIN json_each(
            ${doc}, CASE moved.version WHEN 2 THEN '$.trailingBlank' ELSE '$' END
        ) AS entry
        WHERE true
        ON CONFLICT(session_id, message_id) DO UPDATE SET decision = excluded.decision;
    `);
  db.exec(`
        UPDATE session_meta SET trailing_blank_decisions = (
            SELECT CASE moved.version
                WHEN 2 THEN json_set(session_meta.trailing_blank_decisions, '$.trailingBlank', json('{}'))
                ELSE ''
            END
            FROM v94_replay_documents AS moved WHERE moved.session_id = session_meta.session_id
        )
        WHERE session_id IN (SELECT session_id FROM v94_replay_documents);
    `);
  db.exec("DROP TABLE temp.v94_replay_documents");
}

// ../plugin/src/features/magic-context/opencode2-relabel.ts
var OPENCODE2_RELABEL_STATE_KEY = "v87_opencode2_relabel";
var V87_HARNESS_TWIN_RULES = [
  {
    table: "session_projects",
    keyColumns: ["session_id"],
    incomingIsNewer: "incoming.updated_at > existing.updated_at"
  },
  {
    table: "primer_candidates",
    keyColumns: [
      "project_path",
      "session_id",
      "source_start_message_id",
      "source_end_message_id"
    ],
    incomingIsNewer: "incoming.created_at > existing.created_at"
  },
  {
    table: "transform_decisions",
    keyColumns: ["session_id", "message_id"],
    incomingIsNewer: "incoming.ts_ms > existing.ts_ms"
  }
];
function tableExists3(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}
function columnNames(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}
function listSessionScopedHarnessTables(db, tables) {
  const shapes = [];
  for (const table of tables) {
    if (!tableExists3(db, table))
      continue;
    const columns = columnNames(db, table);
    if (!columns.has("harness"))
      continue;
    shapes.push({ table, hasSessionId: columns.has("session_id") });
  }
  return shapes;
}
function collectCandidateSessions(db, shapes) {
  const sessions = new Set;
  for (const shape of shapes) {
    if (!shape.hasSessionId)
      continue;
    const rows = db.prepare(`SELECT DISTINCT session_id AS id FROM ${shape.table}
                  WHERE session_id IS NOT NULL AND harness IN ('opencode', 'opencode2')`).all();
    for (const row of rows)
      sessions.add(row.id);
  }
  return [...sessions].sort();
}
function openEvidenceStore(path) {
  const store = new Database2(path, { readonly: true, fileMustExist: true });
  try {
    const hasV1Messages = tableExists3(store, "message");
    const hasV1Session = tableExists3(store, "session");
    const hasV2 = tableExists3(store, "session_v2");
    const hasV2Messages = hasV2 && tableExists3(store, "session_message");
    if (!hasV1Messages && !hasV1Session && !hasV2) {
      store.close();
      return null;
    }
    const v1Message = hasV1Messages ? store.prepare("SELECT MAX(time_updated) AS newest FROM message WHERE session_id = ?") : null;
    const v1Session = hasV1Session ? store.prepare("SELECT time_updated AS newest FROM session WHERE id = ?") : null;
    const v2Message = hasV2Messages ? store.prepare("SELECT MAX(time_updated) AS newest FROM session_message WHERE session_id = ?") : null;
    const v2Session = hasV2 ? store.prepare("SELECT time_updated AS newest FROM session_v2 WHERE id = ?") : null;
    const newest = (statements, sessionId) => {
      let best = null;
      for (const statement of statements) {
        if (!statement)
          continue;
        const row = statement.get(sessionId);
        const value = row?.newest;
        if (typeof value !== "number")
          continue;
        if (best === null || value > best)
          best = value;
      }
      return best;
    };
    return {
      newestV1Activity: (sessionId) => newest([v1Message, v1Session], sessionId),
      newestV2Activity: (sessionId) => newest([v2Message, v2Session], sessionId),
      close: () => store.close()
    };
  } catch (error) {
    store.close();
    throw error;
  }
}
function resolveHarnessFromEvidence(evidence, sessionId) {
  const v1 = evidence.newestV1Activity(sessionId);
  const v2 = evidence.newestV2Activity(sessionId);
  if (v1 === null && v2 === null)
    return null;
  if (v2 !== null && (v1 === null || v2 > v1))
    return "opencode2";
  if (v1 !== null && (v2 === null || v1 > v2))
    return "opencode";
  return null;
}
function prepareTwinResolver(db, table, keyColumns, incomingIsNewer) {
  const joinOn = keyColumns.map((column) => `incoming.${column} = existing.${column}`).join(" AND ");
  const dropIncoming = db.prepare(`DELETE FROM ${table} WHERE rowid IN (
             SELECT incoming.rowid FROM ${table} AS incoming
             JOIN ${table} AS existing ON ${joinOn} AND existing.harness = ?
             WHERE incoming.session_id = ? AND incoming.harness = ?
               AND NOT (${incomingIsNewer})
         )`);
  const dropExisting = db.prepare(`DELETE FROM ${table} WHERE rowid IN (
             SELECT existing.rowid FROM ${table} AS existing
             JOIN ${table} AS incoming ON ${joinOn} AND incoming.harness = ?
             WHERE existing.session_id = ? AND existing.harness = ?
               AND (${incomingIsNewer})
         )`);
  return {
    run(sessionId, target, source) {
      dropIncoming.run(target, sessionId, source);
      dropExisting.run(source, sessionId, target);
    }
  };
}
function writeUnresolvedState(db, reason, resolution, sessionIds) {
  if (!tableExists3(db, "schema_migrations_meta"))
    return;
  const value = {
    reason,
    lookedFor: getOpenCodeDbProbeDescriptions(resolution).join(", "),
    sessionIds: [...sessionIds],
    recordedAt: Date.now()
  };
  db.prepare(`INSERT INTO schema_migrations_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(OPENCODE2_RELABEL_STATE_KEY, JSON.stringify(value));
}
function clearUnresolvedState(db) {
  if (!tableExists3(db, "schema_migrations_meta"))
    return;
  db.prepare("DELETE FROM schema_migrations_meta WHERE key = ?").run(OPENCODE2_RELABEL_STATE_KEY);
}
function repairOpenCode2HarnessLabels(db, options) {
  const shapes = listSessionScopedHarnessTables(db, options.tables);
  const candidateSessionIds = collectCandidateSessions(db, shapes);
  if (candidateSessionIds.length === 0) {
    clearUnresolvedState(db);
    return {
      status: "no_candidates",
      storePath: null,
      candidateSessionIds,
      relabelledSessions: []
    };
  }
  const resolution = resolveOpenCodeDbPath("v1", { env: options.env });
  let evidence = null;
  let reason = null;
  if (!openCodeDbPathExists(resolution)) {
    reason = "store_not_found";
  } else {
    try {
      evidence = openEvidenceStore(resolution.path);
      if (!evidence)
        reason = "store_schema_unknown";
    } catch (error) {
      reason = "store_unreadable";
      log2(`[migration] OpenCode session database at ${resolution.path} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!evidence || reason !== null) {
    evidence?.close();
    writeUnresolvedState(db, reason ?? "store_not_found", resolution, candidateSessionIds);
    log2(`[migration] OpenCode harness labels left unverified for ${candidateSessionIds.length} session(s): ` + `no readable OpenCode session database (${reason ?? "store_not_found"}) at ${resolution.path}. ` + "Nothing was relabelled; `magic-context doctor` reports the affected sessions.");
    return {
      status: "unresolved",
      reason: reason ?? "store_not_found",
      storePath: null,
      candidateSessionIds,
      relabelledSessions: []
    };
  }
  const relabelledSessions = [];
  try {
    const updates = shapes.filter((shape) => shape.hasSessionId).map((shape) => db.prepare(`UPDATE ${shape.table} SET harness = ? WHERE session_id = ? AND harness = ?`));
    const presentTables = new Set(shapes.map((shape) => shape.table));
    const twinResolvers = V87_HARNESS_TWIN_RULES.filter((rule) => presentTables.has(rule.table)).map((rule) => prepareTwinResolver(db, rule.table, rule.keyColumns, rule.incomingIsNewer));
    for (const sessionId of candidateSessionIds) {
      const target = resolveHarnessFromEvidence(evidence, sessionId);
      if (target === null)
        continue;
      const source = target === "opencode" ? "opencode2" : "opencode";
      for (const resolver of twinResolvers)
        resolver.run(sessionId, target, source);
      let moved = 0;
      for (const update of updates) {
        moved += Number(update.run(target, sessionId, source).changes ?? 0);
      }
      if (moved > 0)
        relabelledSessions.push({ sessionId, harness: target });
    }
  } finally {
    evidence.close();
  }
  clearUnresolvedState(db);
  if (relabelledSessions.length > 0) {
    const toOpenCode2 = relabelledSessions.filter((entry) => entry.harness === "opencode2").length;
    log2(`[migration] OpenCode harness labels repaired from ${resolution.path}: ` + `${toOpenCode2} session(s) restored to opencode2, ` + `${relabelledSessions.length - toOpenCode2} session(s) set to opencode.`);
  }
  return {
    status: "resolved",
    storePath: resolution.path,
    candidateSessionIds,
    relabelledSessions
  };
}

// ../plugin/src/features/magic-context/storage-compartment-history-version.ts
function definitions(db) {
  const hasPrivilegeTable = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='context_privilege_state'").get());
  const externalUpdate = hasPrivilegeTable ? "CASE WHEN COALESCE((SELECT enabled FROM context_privilege_state WHERE id=1),0)=0 THEN 1 ELSE 0 END" : "1";
  return [
    {
      type: "table",
      name: "compartment_history_versions",
      sql: `CREATE TABLE compartment_history_versions (
            session_id TEXT PRIMARY KEY NOT NULL,
            generation TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
            version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
            rewrite_version INTEGER NOT NULL DEFAULT 0 CHECK (rewrite_version >= 0),
            seeded INTEGER NOT NULL DEFAULT 0 CHECK (seeded IN (0, 1))
        )`
    },
    {
      type: "trigger",
      name: "compartment_history_ai",
      sql: `CREATE TRIGGER compartment_history_ai AFTER INSERT ON compartments BEGIN
            INSERT INTO compartment_history_versions(session_id, version) VALUES (NEW.session_id, 1)
            ON CONFLICT(session_id) DO UPDATE SET version = version + 1;
        END`
    },
    {
      type: "trigger",
      name: "compartment_history_ad",
      sql: `CREATE TRIGGER compartment_history_ad AFTER DELETE ON compartments BEGIN
            INSERT INTO compartment_history_versions(session_id, version) VALUES (OLD.session_id, 1)
            ON CONFLICT(session_id) DO UPDATE SET version = version + 1;
        END`
    },
    {
      type: "trigger",
      name: "compartment_history_au",
      sql: `CREATE TRIGGER compartment_history_au AFTER UPDATE ON compartments BEGIN
            INSERT INTO compartment_history_versions(session_id, version, rewrite_version) VALUES (OLD.session_id, 1, ${externalUpdate})
            ON CONFLICT(session_id) DO UPDATE SET version = version + 1, rewrite_version = rewrite_version + ${externalUpdate};
            INSERT INTO compartment_history_versions(session_id, version, rewrite_version)
                SELECT NEW.session_id, 1, ${externalUpdate} WHERE NEW.session_id != OLD.session_id
            ON CONFLICT(session_id) DO UPDATE SET version = version + 1, rewrite_version = rewrite_version + ${externalUpdate};
        END`
    }
  ];
}
function installedDefinitions(db) {
  const rows = db.prepare(`SELECT type, name, sql FROM sqlite_master
        WHERE name IN ('compartment_history_versions', 'compartment_history_ai', 'compartment_history_ad', 'compartment_history_au')`).all();
  return new Map(rows.map((row) => [`${row.type}:${row.name}`, row.sql]));
}
function matches(expected, installed) {
  return expected.every((definition) => installed.get(`${definition.type}:${definition.name}`) === definition.sql);
}
function installCompartmentHistoryVersions(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='compartments'").get())
    return;
  if (matches(definitions(db), installedDefinitions(db)))
    return;
  db.transaction(() => {
    const expected = definitions(db);
    const installed = installedDefinitions(db);
    if (matches(expected, installed))
      return;
    const table = expected[0];
    const existingTable = installed.get(`table:${table.name}`);
    if (existingTable !== undefined && existingTable !== table.sql) {
      throw new Error("compartment_history_versions schema differs from v93; refusing to replace revision data");
    }
    if (existingTable === undefined)
      db.exec(table.sql);
    db.exec(`INSERT OR IGNORE INTO compartment_history_versions(session_id, seeded)
            SELECT DISTINCT session_id, 1 FROM compartments`);
    for (const trigger of expected.slice(1)) {
      if (installed.get(`trigger:${trigger.name}`) === trigger.sql)
        continue;
      db.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
      db.exec(trigger.sql);
    }
  }).immediate();
}

// ../plugin/src/features/magic-context/migrations.ts
var FORK_MIGRATION_VERSION_FLOOR = 1e4;
var MIGRATION_LOCK_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

class MigrationLockBusyError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationLockBusyError";
  }
}
function isSqliteLockError(error) {
  if (!error || typeof error !== "object")
    return false;
  const candidate = error;
  if (candidate.code === "SQLITE_BUSY" || candidate.code === "SQLITE_LOCKED")
    return true;
  return typeof candidate.message === "string" && /database is locked|sqlite_(busy|locked)/i.test(candidate.message);
}
function tableExists4(db, name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name));
}
var V85_OPENCODE2_RELABEL_TABLES = [
  "tags",
  "pending_ops",
  "source_contents",
  "compartments",
  "compartment_chunk_embeddings",
  "session_projects",
  "compartment_events",
  "compression_depth",
  "session_facts",
  "primer_candidates",
  "notes",
  "message_history_index",
  "message_history_source",
  "pending_session_cleanup",
  "message_history_orphan_sweep",
  "session_meta",
  "subagent_invocations",
  "historian_runs",
  "transform_decisions",
  "recomp_compartments",
  "recomp_facts"
];
var V85_OPTIONAL_OPENCODE2_RELABEL_TABLES = ["session_project_backfill_state"];
function healMismatchedTierClose(db, table, hasLegacy) {
  if (!tableExists4(db, table))
    return;
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  for (const required of ["content", "p1", "p2", "p3", "p4"]) {
    if (!columns.has(required))
      return;
  }
  if (hasLegacy && !columns.has("legacy"))
    return;
  const predicate = hasLegacy ? "legacy = 1 AND p1 IS NULL AND content LIKE '%<p1%'" : "p1 IS NULL AND content LIKE '%<p1%'";
  const rows = db.prepare(`SELECT id, content FROM ${table} WHERE ${predicate}`).all();
  const update = db.prepare(`UPDATE ${table} SET p1 = ?, p2 = ?, p3 = ?, p4 = ?${hasLegacy ? ", legacy = 0" : ""} WHERE id = ?`);
  for (const row of rows) {
    const tiers = extractTiersFromInner(row.content);
    if (typeof tiers.p1 !== "string" || tiers.p1.length === 0)
      continue;
    const p1 = tiers.p1;
    const p2 = typeof tiers.p2 === "string" ? tiers.p2 : p1;
    const p3 = typeof tiers.p3 === "string" ? tiers.p3 : p2;
    const p4 = typeof tiers.p4 === "string" ? tiers.p4 : "";
    update.run(p1, p2, p3, p4, row.id);
  }
}
function assertForeignKeyIntegrity(db, table) {
  const rows = (table ? db.prepare(`PRAGMA foreign_key_check(${table})`) : db.prepare("PRAGMA foreign_key_check")).all();
  if (rows.length > 0) {
    throw new Error(`foreign_key_check failed after embedding table rebuild${table ? ` (${table})` : ""} (${rows.length} violation(s))`);
  }
}
function authorityPrivilegeCheck() {
  return "COALESCE((SELECT enabled FROM context_privilege_state WHERE id = 1), 0) = 0";
}
function managedAuthorityNoteRow(row) {
  return `(
        EXISTS (SELECT 1 FROM authority_managed WHERE project_path = ${row}.project_path)
        OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = ${row}.project_path)
        OR EXISTS (
            SELECT 1 FROM session_projects sp
            JOIN authority_managed am ON am.project_path = sp.project_path
            WHERE sp.session_id = ${row}.session_id
        )
        OR EXISTS (
            SELECT 1 FROM session_projects sp
            JOIN authority_repair_pending arp ON arp.project_path = sp.project_path
            WHERE sp.session_id = ${row}.session_id
        )
    )`;
}
function installLatestAuthorityTriggers(db) {
  const privilegeCheck = authorityPrivilegeCheck();
  if (tableExists4(db, "memories")) {
    db.exec(`
            DROP TRIGGER IF EXISTS memories_authority_guard_insert;
            DROP TRIGGER IF EXISTS memories_authority_guard_update;
            DROP TRIGGER IF EXISTS memories_authority_guard_delete;
            CREATE TRIGGER memories_authority_guard_insert
            BEFORE INSERT ON memories
            WHEN (EXISTS (SELECT 1 FROM authority_managed WHERE project_path = NEW.project_path)
               OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = NEW.project_path))
              AND ${privilegeCheck}
            BEGIN SELECT RAISE(ABORT, 'context.db memory writes are managed by the Rust module'); END;
            CREATE TRIGGER memories_authority_guard_update
            BEFORE UPDATE ON memories
            WHEN (EXISTS (SELECT 1 FROM authority_managed WHERE project_path = OLD.project_path)
               OR EXISTS (SELECT 1 FROM authority_managed WHERE project_path = NEW.project_path)
               OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = OLD.project_path)
               OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = NEW.project_path))
              AND ${privilegeCheck}
            BEGIN SELECT RAISE(ABORT, 'context.db memory writes are managed by the Rust module'); END;
            CREATE TRIGGER memories_authority_guard_delete
            BEFORE DELETE ON memories
            WHEN (EXISTS (SELECT 1 FROM authority_managed WHERE project_path = OLD.project_path)
               OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = OLD.project_path))
              AND ${privilegeCheck}
            BEGIN SELECT RAISE(ABORT, 'context.db memory writes are managed by the Rust module'); END;
        `);
  }
  if (tableExists4(db, "notes")) {
    const managedOld = managedAuthorityNoteRow("OLD");
    const managedNew = managedAuthorityNoteRow("NEW");
    db.exec(`
            DROP TRIGGER IF EXISTS notes_authority_guard_insert;
            DROP TRIGGER IF EXISTS notes_authority_guard_update;
            DROP TRIGGER IF EXISTS notes_authority_guard_delete;
            CREATE TRIGGER notes_authority_guard_insert
            BEFORE INSERT ON notes
            WHEN ${managedNew} AND ${privilegeCheck}
            BEGIN SELECT RAISE(ABORT, 'context.db note writes are managed by the Rust module'); END;
            CREATE TRIGGER notes_authority_guard_update
            BEFORE UPDATE ON notes
            WHEN (${managedOld} OR ${managedNew}) AND ${privilegeCheck}
            BEGIN SELECT RAISE(ABORT, 'context.db note writes are managed by the Rust module'); END;
            CREATE TRIGGER notes_authority_guard_delete
            BEFORE DELETE ON notes
            WHEN ${managedOld} AND ${privilegeCheck}
            BEGIN SELECT RAISE(ABORT, 'context.db note writes are managed by the Rust module'); END;
        `);
  }
}
var MIGRATIONS = [
  {
    version: 1,
    description: "Merge session_notes + smart_notes into unified notes table",
    up: (db) => {
      db.exec(`
				CREATE TABLE IF NOT EXISTS notes (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					type TEXT NOT NULL DEFAULT 'session',
					status TEXT NOT NULL DEFAULT 'active',
					content TEXT NOT NULL,
					session_id TEXT,
					project_path TEXT,
					surface_condition TEXT,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL,
					last_checked_at INTEGER,
					ready_at INTEGER,
					ready_reason TEXT,
					compiled_provider TEXT,
					compiled_config TEXT,
					compiled_at INTEGER,
					compile_status TEXT CHECK(compile_status IN ('compiled', 'plain', 'refused'))
				);
				CREATE INDEX IF NOT EXISTS idx_notes_session_status ON notes(session_id, status);
				CREATE INDEX IF NOT EXISTS idx_notes_project_status ON notes(project_path, status);
				CREATE INDEX IF NOT EXISTS idx_notes_type_status ON notes(type, status);
			`);
      const hasSessionNotes = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_notes'").get();
      if (hasSessionNotes) {
        db.exec(`
					INSERT INTO notes (type, status, content, session_id, created_at, updated_at)
					SELECT 'session', 'active', content, session_id, created_at, created_at
					FROM session_notes
				`);
      }
      const hasSmartNotes = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='smart_notes'").get();
      if (hasSmartNotes) {
        db.exec(`
					INSERT INTO notes (type, status, content, session_id, project_path, surface_condition,
						created_at, updated_at, last_checked_at, ready_at, ready_reason)
					SELECT 'smart', status, content, created_session_id, project_path, surface_condition,
						created_at, updated_at, last_checked_at, ready_at, ready_reason
					FROM smart_notes
				`);
      }
      if (hasSessionNotes) {
        const sourceCount = db.prepare("SELECT COUNT(*) as c FROM session_notes").get().c;
        const migratedCount = db.prepare("SELECT COUNT(*) as c FROM notes WHERE type = 'session'").get().c;
        if (migratedCount >= sourceCount) {
          db.exec("DROP TABLE session_notes");
        } else {
          throw new Error(`session_notes migration verification failed: expected ${sourceCount} rows, got ${migratedCount}`);
        }
      }
      if (hasSmartNotes) {
        const sourceCount = db.prepare("SELECT COUNT(*) as c FROM smart_notes").get().c;
        const migratedCount = db.prepare("SELECT COUNT(*) as c FROM notes WHERE type = 'smart'").get().c;
        if (migratedCount >= sourceCount) {
          db.exec("DROP TABLE smart_notes");
        } else {
          throw new Error(`smart_notes migration verification failed: expected ${sourceCount} rows, got ${migratedCount}`);
        }
      }
    }
  },
  {
    version: 2,
    description: "Add plugin_messages table for TUI ↔ server communication",
    up: (db) => {
      db.exec(`
				CREATE TABLE IF NOT EXISTS plugin_messages (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					direction TEXT NOT NULL,
					type TEXT NOT NULL,
					payload TEXT NOT NULL DEFAULT '{}',
					session_id TEXT,
					created_at INTEGER NOT NULL,
					consumed_at INTEGER
				);
				CREATE INDEX IF NOT EXISTS idx_plugin_messages_direction_consumed
					ON plugin_messages(direction, consumed_at);
				CREATE INDEX IF NOT EXISTS idx_plugin_messages_created
					ON plugin_messages(created_at);
			`);
    }
  },
  {
    version: 3,
    description: "Add user_memory_candidates and user_memories tables",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS user_memory_candidates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    content TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    source_compartment_start INTEGER,
                    source_compartment_end INTEGER,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_umc_created ON user_memory_candidates(created_at);

                CREATE TABLE IF NOT EXISTS user_memories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    content TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    promoted_at INTEGER NOT NULL,
                    source_candidate_ids TEXT DEFAULT '[]',
                    source_candidate_provenance TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_um_status ON user_memories(status);
            `);
    }
  },
  {
    version: 4,
    description: "Add git_commits + git_commit_embeddings + git_commits_fts tables",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS git_commits (
                    sha TEXT PRIMARY KEY,
                    project_path TEXT NOT NULL,
                    short_sha TEXT NOT NULL,
                    message TEXT NOT NULL,
                    author TEXT,
                    committed_at INTEGER NOT NULL,
                    indexed_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_git_commits_project_time
                    ON git_commits(project_path, committed_at DESC);

                CREATE TABLE IF NOT EXISTS git_commit_embeddings (
                    sha TEXT PRIMARY KEY,
                    embedding BLOB NOT NULL,
                    model_id TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    -- FK-cascade audit (v12): git_commit_embeddings.sha -> git_commits.sha
                    -- uses ON DELETE CASCADE, so SQLite PRAGMA foreign_keys must be ON on
                    -- every connection and v12 cleans historical orphan rows.
                    FOREIGN KEY(sha) REFERENCES git_commits(sha) ON DELETE CASCADE
                );

                CREATE VIRTUAL TABLE IF NOT EXISTS git_commits_fts USING fts5(
                    sha UNINDEXED,
                    project_path UNINDEXED,
                    message,
                    tokenize = 'porter unicode61'
                );

                -- Mirror writes into FTS. We intentionally rebuild FTS rows on
                -- every INSERT OR REPLACE so amended commits or re-indexed
                -- messages update cleanly.
                CREATE TRIGGER IF NOT EXISTS git_commits_fts_insert
                AFTER INSERT ON git_commits BEGIN
                    DELETE FROM git_commits_fts WHERE sha = NEW.sha;
                    INSERT INTO git_commits_fts(sha, project_path, message)
                    VALUES (NEW.sha, NEW.project_path, NEW.message);
                END;

                CREATE TRIGGER IF NOT EXISTS git_commits_fts_delete
                AFTER DELETE ON git_commits BEGIN
                    DELETE FROM git_commits_fts WHERE sha = OLD.sha;
                END;

                CREATE TRIGGER IF NOT EXISTS git_commits_fts_update
                AFTER UPDATE OF message, project_path ON git_commits BEGIN
                    DELETE FROM git_commits_fts WHERE sha = OLD.sha;
                    INSERT INTO git_commits_fts(sha, project_path, message)
                    VALUES (NEW.sha, NEW.project_path, NEW.message);
                END;
            `);
    }
  },
  {
    version: 5,
    description: "One-shot heal of NULL session_meta columns",
    up: (db) => {
      healAllNullColumns(db);
    }
  },
  {
    version: 6,
    description: "Heal session_meta.counter drift below MAX(tag_number)",
    up: (db) => {
      db.prepare(`UPDATE session_meta
                 SET counter = (
                     SELECT MAX(tag_number)
                     FROM tags
                     WHERE tags.session_id = session_meta.session_id
                 )
                 WHERE EXISTS (
                     SELECT 1
                     FROM tags
                     WHERE tags.session_id = session_meta.session_id
                       AND tags.tag_number > session_meta.counter
                 )`).run();
    }
  },
  {
    version: 7,
    description: "Add harness column to notes table for cross-harness sharing",
    up: (db) => {
      const cols = db.prepare("PRAGMA table_info(notes)").all();
      if (!cols.some((c) => c.name === "harness")) {
        db.exec("ALTER TABLE notes ADD COLUMN harness TEXT NOT NULL DEFAULT 'opencode'");
      }
    }
  },
  {
    version: 8,
    description: "Add partial indexes on tags(session_id, tag_number) for active and dropped",
    up: (db) => {
      db.exec(`
                CREATE INDEX IF NOT EXISTS idx_tags_active_session_tag_number
                ON tags(session_id, tag_number)
                WHERE status = 'active';

                CREATE INDEX IF NOT EXISTS idx_tags_dropped_session_tag_number
                ON tags(session_id, tag_number)
                WHERE status = 'dropped';
            `);
      db.exec("ANALYZE tags;");
    }
  },
  {
    version: 9,
    description: "Persist tool_definition_measurements across plugin restarts",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS tool_definition_measurements (
                    provider_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    agent_name TEXT NOT NULL,
                    tool_id TEXT NOT NULL,
                    token_count INTEGER NOT NULL,
                    recorded_at INTEGER NOT NULL,
                    PRIMARY KEY (provider_id, model_id, agent_name, tool_id)
                );
            `);
    }
  },
  {
    version: 10,
    description: "Add tool_owner_message_id column to tags + composite identity indexes",
    up: (db) => {
      const cols = db.prepare("PRAGMA table_info(tags)").all();
      if (!cols.some((c) => c.name === "tool_owner_message_id")) {
        db.exec("ALTER TABLE tags ADD COLUMN tool_owner_message_id TEXT DEFAULT NULL");
      }
      db.exec(`
                CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_tool_composite
                ON tags(session_id, message_id, tool_owner_message_id)
                WHERE type = 'tool' AND tool_owner_message_id IS NOT NULL;

                CREATE INDEX IF NOT EXISTS idx_tags_tool_null_owner
                ON tags(session_id, message_id)
                WHERE type = 'tool' AND tool_owner_message_id IS NULL;
            `);
    }
  },
  {
    version: 11,
    description: "Add todo state synthesis columns to session_meta",
    up: (db) => {
      const cols = db.prepare("PRAGMA table_info(session_meta)").all();
      if (!cols.some((c) => c.name === "last_todo_state")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN last_todo_state TEXT DEFAULT ''");
      }
      if (!cols.some((c) => c.name === "todo_synthetic_call_id")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN todo_synthetic_call_id TEXT DEFAULT ''");
      }
      if (!cols.some((c) => c.name === "todo_synthetic_anchor_message_id")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN todo_synthetic_anchor_message_id TEXT DEFAULT ''");
      }
      if (!cols.some((c) => c.name === "todo_synthetic_state_json")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN todo_synthetic_state_json TEXT DEFAULT ''");
      }
    }
  },
  {
    version: 12,
    description: "Clean orphan rows from FK-cascade embedding tables",
    up: (db) => {
      const hasTable = (name) => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name));
      const memoryEmbeddings = hasTable("memory_embeddings") ? db.prepare(`DELETE FROM memory_embeddings
                           WHERE memory_id NOT IN (SELECT id FROM memories)`).run().changes : 0;
      log2(`[migrations] v12 cleaned ${memoryEmbeddings} orphan memory_embeddings row(s)`);
      const gitCommitEmbeddings = hasTable("git_commit_embeddings") ? db.prepare(`DELETE FROM git_commit_embeddings
                           WHERE sha NOT IN (SELECT sha FROM git_commits)`).run().changes : 0;
      log2(`[migrations] v12 cleaned ${gitCommitEmbeddings} orphan git_commit_embeddings row(s)`);
    }
  },
  {
    version: 13,
    description: "Add pending_compaction_marker_state column for deferred marker drain",
    up: (db) => {
      const cols = db.prepare("PRAGMA table_info(session_meta)").all();
      if (!cols.some((c) => c.name === "pending_compaction_marker_state")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN pending_compaction_marker_state TEXT");
      }
    }
  },
  {
    version: 14,
    description: "Add project-scoped key files and version counter",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS project_key_files (
                    project_path           TEXT    NOT NULL,
                    path                   TEXT    NOT NULL,
                    content                TEXT    NOT NULL,
                    content_hash           TEXT    NOT NULL,
                    local_token_estimate   INTEGER NOT NULL,
                    generated_at           INTEGER NOT NULL,
                    generated_by_model     TEXT,
                    generation_config_hash TEXT    NOT NULL,
                    stale_reason           TEXT,
                    PRIMARY KEY (project_path, path)
                );

                CREATE INDEX IF NOT EXISTS idx_project_key_files_project
                    ON project_key_files(project_path);
                CREATE INDEX IF NOT EXISTS idx_project_key_files_generated_at
                    ON project_key_files(project_path, generated_at);

                CREATE TABLE IF NOT EXISTS project_key_files_version (
                    project_path TEXT    PRIMARY KEY,
                    version      INTEGER NOT NULL DEFAULT 0
                );
            `);
    }
  },
  {
    version: 15,
    description: "Add the now-retired deferred_execute_state column",
    up: (db) => {
      const cols = db.prepare("PRAGMA table_info(session_meta)").all();
      if (!cols.some((c) => c.name === "deferred_execute_state")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN deferred_execute_state TEXT");
      }
    }
  },
  {
    version: 16,
    description: "Add context-limit cache regression sentinels",
    up: (db) => {
      const cols = db.prepare("PRAGMA table_info(session_meta)").all();
      if (!cols.some((c) => c.name === "observed_safe_input_tokens")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN observed_safe_input_tokens INTEGER NOT NULL DEFAULT 0");
      }
      if (!cols.some((c) => c.name === "cache_alert_sent")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN cache_alert_sent INTEGER NOT NULL DEFAULT 0");
      }
    }
  },
  {
    version: 17,
    description: "Multi-anchor JSON storage for note-nudge and auto-search-hint persistence",
    up: (db) => {
      const cols = db.prepare("PRAGMA table_info(session_meta)").all();
      if (!cols.some((c) => c.name === "note_nudge_anchors")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN note_nudge_anchors TEXT NOT NULL DEFAULT '[]'");
      }
      if (!cols.some((c) => c.name === "auto_search_hint_decisions")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN auto_search_hint_decisions TEXT NOT NULL DEFAULT '[]'");
      }
      db.exec(`
                UPDATE session_meta
                SET note_nudge_anchors = json_array(
                    json_object(
                        'messageId', note_nudge_sticky_message_id,
                        'text', note_nudge_sticky_text
                    )
                )
                WHERE COALESCE(note_nudge_sticky_text, '') != ''
                  AND COALESCE(note_nudge_sticky_message_id, '') != ''
                  AND (note_nudge_anchors IS NULL OR note_nudge_anchors = '[]')
            `);
      db.exec(`
                UPDATE session_meta SET note_nudge_anchors = '[]'
                WHERE note_nudge_anchors IS NULL
            `);
      db.exec(`
                UPDATE session_meta SET auto_search_hint_decisions = '[]'
                WHERE auto_search_hint_decisions IS NULL
            `);
    }
  },
  {
    version: 18,
    description: "Add pending_pi_compaction_marker_state column for Pi deferred marker drain",
    up: (db) => {
      const cols = db.prepare("PRAGMA table_info(session_meta)").all();
      if (!cols.some((c) => c.name === "pending_pi_compaction_marker_state")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN pending_pi_compaction_marker_state TEXT");
      }
    }
  },
  {
    version: 19,
    description: "Add compartment state lease table",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS compartment_state_lease (
                    session_id TEXT PRIMARY KEY NOT NULL,
                    holder_id TEXT NOT NULL,
                    acquired_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_compartment_state_lease_expires
                    ON compartment_state_lease(expires_at);
            `);
    }
  },
  {
    version: 20,
    description: "Add subagent invocation token accounting",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS subagent_invocations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    harness TEXT NOT NULL,
                    subagent TEXT NOT NULL,
                    task TEXT,
                    provider_id TEXT,
                    model_id TEXT,
                    started_at INTEGER NOT NULL,
                    ended_at INTEGER,
                    status TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL DEFAULT 0,
                    output_tokens INTEGER NOT NULL DEFAULT 0,
                    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
                    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
                    error TEXT,
                    parent_invocation_id INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_sai_session_started
                    ON subagent_invocations(session_id, started_at DESC);
                CREATE INDEX IF NOT EXISTS idx_sai_subagent
                    ON subagent_invocations(subagent, started_at DESC);
            `);
    }
  },
  {
    version: 21,
    description: "Add session lifetime work metrics",
    up: (db) => {
      const cols = db.prepare("PRAGMA table_info(session_meta)").all();
      if (!cols.some((c) => c.name === "new_work_tokens")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN new_work_tokens INTEGER NOT NULL DEFAULT 0");
      }
      if (!cols.some((c) => c.name === "total_input_tokens")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN total_input_tokens INTEGER NOT NULL DEFAULT 0");
      }
    }
  },
  {
    version: 22,
    description: "v2.0 cache architecture schema foundation",
    up: (db) => {
      const hasSessionMetaTable = tableExists4(db, "session_meta");
      const hasCompartmentsTable = tableExists4(db, "compartments");
      const hasMemoriesTable = tableExists4(db, "memories");
      if (hasSessionMetaTable) {
        ensureColumn(db, "session_meta", "cached_m0_bytes", "BLOB");
        ensureColumn(db, "session_meta", "cached_m0_project_memory_epoch", "INTEGER");
        ensureColumn(db, "session_meta", "cached_m0_project_user_profile_version", "INTEGER");
        ensureColumn(db, "session_meta", "cached_m0_max_compartment_seq", "INTEGER");
        ensureColumn(db, "session_meta", "cached_m0_max_memory_id", "INTEGER");
        ensureColumn(db, "session_meta", "cached_m0_max_mutation_id", "INTEGER");
        ensureColumn(db, "session_meta", "cached_m0_project_docs_hash", "TEXT");
        ensureColumn(db, "session_meta", "cached_m0_materialized_at", "INTEGER");
        ensureColumn(db, "session_meta", "cached_m0_session_facts_version", "INTEGER");
        ensureColumn(db, "session_meta", "cached_m0_upgrade_state", "TEXT");
        ensureColumn(db, "session_meta", "upgrade_reminded_at", "INTEGER");
      }
      if (hasCompartmentsTable) {
        ensureColumn(db, "compartments", "p1", "TEXT");
        ensureColumn(db, "compartments", "p2", "TEXT");
        ensureColumn(db, "compartments", "p3", "TEXT");
        ensureColumn(db, "compartments", "p4", "TEXT");
        ensureColumn(db, "compartments", "importance", "INTEGER NOT NULL DEFAULT 50");
        ensureColumn(db, "compartments", "episode_type", "TEXT");
        ensureColumn(db, "compartments", "p1_embedding", "BLOB");
        ensureColumn(db, "compartments", "p1_embedding_model_id", "TEXT");
        ensureColumn(db, "compartments", "legacy", "INTEGER NOT NULL DEFAULT 0");
      }
      const hasRecompCompartmentsTable = tableExists4(db, "recomp_compartments");
      if (hasRecompCompartmentsTable) {
        ensureColumn(db, "recomp_compartments", "p1", "TEXT");
        ensureColumn(db, "recomp_compartments", "p2", "TEXT");
        ensureColumn(db, "recomp_compartments", "p3", "TEXT");
        ensureColumn(db, "recomp_compartments", "p4", "TEXT");
        ensureColumn(db, "recomp_compartments", "importance", "INTEGER NOT NULL DEFAULT 50");
        ensureColumn(db, "recomp_compartments", "episode_type", "TEXT");
      }
      if (hasMemoriesTable) {
        ensureColumn(db, "memories", "importance", "INTEGER");
      }
      db.exec(`
                CREATE TABLE IF NOT EXISTS schema_migrations_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS project_state (
                    project_path TEXT PRIMARY KEY,
                    project_memory_epoch INTEGER NOT NULL DEFAULT 0,
                    project_user_profile_version INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS m0_mutation_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    mutation_type TEXT NOT NULL CHECK (mutation_type IN (
                        'compartment_delete',
                        'compartment_merge',
                        'recomp_boundary_change',
                        'compartment_upgrade'
                    )),
                    target_id INTEGER,
                    queued_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_m0_mutation_log_session
                    ON m0_mutation_log(session_id);

                CREATE TABLE IF NOT EXISTS v22_identity_rekey_map (
                    old_project_path TEXT PRIMARY KEY,
                    new_project_path TEXT NOT NULL,
                    rekeyed_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS v22_backfill_failures (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    table_name TEXT NOT NULL,
                    row_id INTEGER NOT NULL,
                    raw_project_path TEXT NOT NULL,
                    error_class TEXT NOT NULL CHECK (error_class IN (
                        'not_git_repo',
                        'git_missing',
                        'git_timeout',
                        'permission_denied',
                        'unknown'
                    )),
                    error_message TEXT,
                    failed_at INTEGER NOT NULL,
                    UNIQUE(table_name, row_id)
                );
            `);
      if (hasCompartmentsTable) {
        db.exec(`
                    INSERT OR IGNORE INTO schema_migrations_meta (key, value)
                    SELECT 'v22_legacy_compartment_boundary', CAST(COALESCE(MAX(id), 0) AS TEXT)
                    FROM compartments
                `);
        const boundaryRow = db.prepare("SELECT value FROM schema_migrations_meta WHERE key = 'v22_legacy_compartment_boundary'").get();
        const compartmentBoundary = Number.parseInt(boundaryRow?.value ?? "0", 10);
        db.prepare("UPDATE compartments SET legacy = 1 WHERE legacy = 0 AND id <= ?").run(Number.isFinite(compartmentBoundary) ? compartmentBoundary : 0);
      } else {
        db.prepare("INSERT OR IGNORE INTO schema_migrations_meta (key, value) VALUES ('v22_legacy_compartment_boundary', '0')").run();
      }
      db.prepare("INSERT OR IGNORE INTO schema_migrations_meta (key, value) VALUES ('v22_legacy_memory_backfill', 'pending')").run();
    }
  },
  {
    version: 23,
    description: "v2 compartment events storage (causal_incident / trajectory_correction)",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS compartment_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    compartment_id INTEGER,
                    kind TEXT NOT NULL,
                    at_compartment INTEGER,
                    fields_json TEXT NOT NULL DEFAULT '{}',
                    created_at INTEGER NOT NULL,
                    harness TEXT NOT NULL DEFAULT 'opencode'
                );
                CREATE INDEX IF NOT EXISTS idx_compartment_events_session
                    ON compartment_events(session_id);
            `);
    }
  },
  {
    version: 24,
    description: "historian_runs metrics (per-run quality/cost telemetry)",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS historian_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    harness TEXT NOT NULL DEFAULT 'opencode',
                    subagent_invocation_id INTEGER,
                    run_kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    failure_reason TEXT,
                    chunk_start_ordinal INTEGER,
                    chunk_end_ordinal INTEGER,
                    unprocessed_from INTEGER,
                    compartments_produced INTEGER NOT NULL DEFAULT 0,
                    compartment_id_min INTEGER,
                    compartment_id_max INTEGER,
                    facts_emitted INTEGER NOT NULL DEFAULT 0,
                    facts_by_category_json TEXT,
                    events_emitted INTEGER NOT NULL DEFAULT 0,
                    importance_min INTEGER,
                    importance_max INTEGER,
                    importance_avg REAL,
                    discarded_last INTEGER NOT NULL DEFAULT 0,
                    legacy INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_historian_runs_session
                    ON historian_runs(session_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_historian_runs_status
                    ON historian_runs(status, created_at DESC);
            `);
    }
  },
  {
    version: 25,
    description: "pi_stable_id_scheme session_meta column (Pi message-id cutover gate)",
    up: (db) => {
      const rows = db.prepare("PRAGMA table_info(session_meta)").all();
      if (!rows.some((row) => row.name === "pi_stable_id_scheme")) {
        db.exec("ALTER TABLE session_meta ADD COLUMN pi_stable_id_scheme INTEGER");
      }
    }
  },
  {
    version: 26,
    description: "memory mutation log and atomic m[1] cache columns",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS memory_mutation_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_path TEXT NOT NULL,
                    mutation_type TEXT NOT NULL CHECK (mutation_type IN (
                        'archive',
                        'delete',
                        'update',
                        'superseded'
                    )),
                    target_memory_id INTEGER NOT NULL,
                    superseded_by_id INTEGER,
                    category TEXT,
                    new_content TEXT,
                    queued_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_memory_mutation_log_project
                    ON memory_mutation_log(project_path, id);
            `);
      ensureColumn(db, "session_meta", "cached_m0_bytes", "BLOB");
      ensureColumn(db, "session_meta", "cached_m0_project_memory_epoch", "INTEGER");
      ensureColumn(db, "session_meta", "cached_m0_project_user_profile_version", "INTEGER");
      ensureColumn(db, "session_meta", "cached_m0_max_compartment_seq", "INTEGER");
      ensureColumn(db, "session_meta", "cached_m0_max_memory_id", "INTEGER");
      ensureColumn(db, "session_meta", "cached_m0_max_mutation_id", "INTEGER");
      ensureColumn(db, "session_meta", "cached_m0_max_memory_mutation_id", "INTEGER");
      ensureColumn(db, "session_meta", "cached_m0_project_docs_hash", "TEXT");
      ensureColumn(db, "session_meta", "cached_m0_materialized_at", "INTEGER");
      ensureColumn(db, "session_meta", "cached_m0_session_facts_version", "INTEGER");
      ensureColumn(db, "session_meta", "cached_m0_upgrade_state", "TEXT");
      ensureColumn(db, "session_meta", "cached_m1_bytes", "BLOB");
      ensureColumn(db, "session_meta", "last_observed_model_key", "TEXT");
      ensureColumn(db, "session_meta", "memory_block_cache", "TEXT DEFAULT ''");
      ensureColumn(db, "session_meta", "memory_block_count", "INTEGER DEFAULT 0");
      ensureColumn(db, "session_meta", "memory_block_ids", "TEXT DEFAULT ''");
      db.prepare(`UPDATE session_meta SET
                    cached_m0_bytes = NULL,
                    cached_m1_bytes = NULL,
                    cached_m0_project_memory_epoch = NULL,
                    cached_m0_project_user_profile_version = NULL,
                    cached_m0_max_compartment_seq = NULL,
                    cached_m0_max_memory_id = NULL,
                    cached_m0_max_mutation_id = NULL,
                    cached_m0_max_memory_mutation_id = NULL,
                    cached_m0_project_docs_hash = NULL,
                    cached_m0_materialized_at = NULL,
                    cached_m0_session_facts_version = NULL,
                    cached_m0_upgrade_state = NULL,
                    memory_block_cache = '',
                    memory_block_count = 0,
                    memory_block_ids = ''`).run();
    }
  },
  {
    version: 27,
    description: "tags.entry_fingerprint for Pi fallback-tag adoption",
    up: (db) => {
      const hasTags = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tags' LIMIT 1").get();
      if (!hasTags)
        return;
      ensureColumn(db, "tags", "entry_fingerprint", "TEXT");
      db.exec(`CREATE INDEX IF NOT EXISTS idx_tags_pi_adopt
                    ON tags(session_id, entry_fingerprint)
                    WHERE type='message' AND entry_fingerprint IS NOT NULL`);
    }
  },
  {
    version: 28,
    description: "Add git commit sweep coordinator lease/cooldown table",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS git_sweep_coordinator (
                    project_path TEXT PRIMARY KEY,
                    lease_holder TEXT,
                    lease_expires_at INTEGER,
                    last_swept_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_git_sweep_coordinator_lease_expires
                    ON git_sweep_coordinator(lease_expires_at);
                CREATE INDEX IF NOT EXISTS idx_git_sweep_coordinator_last_swept
                    ON git_sweep_coordinator(last_swept_at);
            `);
    }
  },
  {
    version: 29,
    description: "Add anchor_ordinal to notes (traceback to the conversation tail)",
    up: (db) => {
      const notesExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'").get();
      if (!notesExists) {
        return;
      }
      const columns = db.prepare("PRAGMA table_info(notes)").all();
      if (!columns.some((column) => column.name === "anchor_ordinal")) {
        db.exec("ALTER TABLE notes ADD COLUMN anchor_ordinal INTEGER");
      }
    }
  },
  {
    version: 30,
    description: "HARD-bust m[0] markers: cached system/tool-set/model identity",
    up: (db) => {
      const hasSessionMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_meta' LIMIT 1").get();
      if (!hasSessionMeta)
        return;
      ensureColumn(db, "session_meta", "cached_m0_system_hash", "TEXT");
      ensureColumn(db, "session_meta", "cached_m0_tool_set_hash", "TEXT");
      ensureColumn(db, "session_meta", "cached_m0_model_key", "TEXT");
      const columns = new Set(db.prepare("PRAGMA table_info(session_meta)").all().map((column) => column.name));
      if (columns.has("cached_m0_bytes")) {
        db.prepare(`UPDATE session_meta SET
                        cached_m0_bytes = NULL,
                        cached_m1_bytes = NULL,
                        cached_m0_materialized_at = NULL,
                        cached_m0_system_hash = NULL,
                        cached_m0_tool_set_hash = NULL,
                        cached_m0_model_key = NULL`).run();
      }
    }
  },
  {
    version: 31,
    description: "Nudge redesign: Channel 1 cadence (last_nudge_undropped) + Channel 2 ceiling lease " + "(channel2_nudge_state); zero legacy ctx_reduce-nudge sticky/anchor state (startup heal)",
    up: (db) => {
      const hasSessionMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_meta' LIMIT 1").get();
      if (!hasSessionMeta)
        return;
      ensureColumn(db, "session_meta", "last_nudge_undropped", "INTEGER DEFAULT 0");
      ensureColumn(db, "session_meta", "channel2_nudge_state", "TEXT DEFAULT ''");
      const columns = new Set(db.prepare("PRAGMA table_info(session_meta)").all().map((column) => column.name));
      if (columns.has("sticky_turn_reminder_text")) {
        db.prepare(`UPDATE session_meta SET
                        sticky_turn_reminder_text = '',
                        sticky_turn_reminder_message_id = '',
                        nudge_anchor_message_id = '',
                        nudge_anchor_text = ''`).run();
      }
    }
  },
  {
    version: 32,
    description: "Protected tail boundary state, usage resolver fields, recovery escape, and drain quota",
    up: (db) => {
      const hasSessionMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_meta' LIMIT 1").get();
      if (!hasSessionMeta)
        return;
      ensureColumn(db, "session_meta", "prior_boundary_ordinal", "INTEGER NOT NULL DEFAULT 1");
      ensureColumn(db, "session_meta", "protected_tail_policy_version", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "session_meta", "protected_tail_drain_window_started_at", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "session_meta", "protected_tail_drain_tokens", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "session_meta", "recovery_no_eligible_head_count", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "session_meta", "force_emergency_bypass_window_start", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "session_meta", "force_emergency_bypass_used", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "session_meta", "last_usage_context_limit", "INTEGER NOT NULL DEFAULT 0");
      db.prepare("UPDATE session_meta SET prior_boundary_ordinal = 1 WHERE prior_boundary_ordinal IS NULL OR prior_boundary_ordinal < 1").run();
      db.prepare("UPDATE session_meta SET protected_tail_policy_version = 0 WHERE protected_tail_policy_version IS NULL").run();
      db.prepare("UPDATE session_meta SET protected_tail_drain_window_started_at = 0 WHERE protected_tail_drain_window_started_at IS NULL").run();
      db.prepare("UPDATE session_meta SET protected_tail_drain_tokens = 0 WHERE protected_tail_drain_tokens IS NULL").run();
      db.prepare("UPDATE session_meta SET recovery_no_eligible_head_count = 0 WHERE recovery_no_eligible_head_count IS NULL").run();
      db.prepare("UPDATE session_meta SET force_emergency_bypass_window_start = 0 WHERE force_emergency_bypass_window_start IS NULL").run();
      db.prepare("UPDATE session_meta SET force_emergency_bypass_used = 0 WHERE force_emergency_bypass_used IS NULL").run();
      db.prepare("UPDATE session_meta SET last_usage_context_limit = 0 WHERE last_usage_context_limit IS NULL").run();
    }
  },
  {
    version: 33,
    description: "Compartment chunk embeddings for semantic message-history search",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS compartment_chunk_embeddings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    compartment_id INTEGER NOT NULL REFERENCES compartments(id) ON DELETE CASCADE,
                    session_id TEXT NOT NULL,
                    project_path TEXT NOT NULL,
                    harness TEXT NOT NULL DEFAULT 'opencode',
                    window_index INTEGER NOT NULL DEFAULT 0,
                    start_ordinal INTEGER NOT NULL,
                    end_ordinal INTEGER NOT NULL,
                    chunk_hash TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    dims INTEGER NOT NULL,
                    vector BLOB NOT NULL,
                    created_at INTEGER NOT NULL,
                    UNIQUE(compartment_id, window_index)
                );
                CREATE INDEX IF NOT EXISTS idx_cce_session
                    ON compartment_chunk_embeddings(session_id);
                CREATE INDEX IF NOT EXISTS idx_cce_project_model
                    ON compartment_chunk_embeddings(project_path, model_id);
            `);
    }
  },
  {
    version: 34,
    description: "workspace tables and m[0] workspace fingerprint cache reset",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS workspaces (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS workspace_members (
                    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    project_path TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    display_path TEXT NOT NULL,
                    added_at INTEGER NOT NULL,
                    PRIMARY KEY (workspace_id, project_path)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_member_unique
                    ON workspace_members(project_path);
                CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_member_name
                    ON workspace_members(workspace_id, display_name);
            `);
      const hasSessionMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_meta' LIMIT 1").get();
      if (!hasSessionMeta)
        return;
      ensureColumn(db, "session_meta", "cached_m0_workspace_fingerprint", "TEXT");
      const columns = new Set(db.prepare("PRAGMA table_info(session_meta)").all().map((column) => column.name));
      const clears = [
        ["cached_m0_bytes", null],
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
        ["cached_m0_last_baseline_end_message_id", null],
        ["memory_block_cache", ""],
        ["memory_block_ids", ""],
        ["memory_block_count", 0]
      ];
      const setClauses = [];
      const values = [];
      for (const [column, value] of clears) {
        if (!columns.has(column))
          continue;
        setClauses.push(`${column} = ?`);
        values.push(value);
      }
      if (setClauses.length > 0) {
        db.prepare(`UPDATE session_meta SET ${setClauses.join(", ")}`).run(...values);
      }
    }
  },
  {
    version: 35,
    description: "workspace per-category share defaults and epoch refresh",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS workspaces (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    share_categories TEXT NOT NULL DEFAULT '["CONSTRAINTS"]'
                );
            `);
      ensureColumn(db, "workspaces", "share_categories", `TEXT NOT NULL DEFAULT '["CONSTRAINTS"]'`);
      db.prepare(`UPDATE workspaces
                    SET share_categories = '["CONSTRAINTS"]'
                  WHERE share_categories IS NULL OR share_categories = ''`).run();
      if (!tableExists4(db, "workspace_members"))
        return;
      const rows = db.prepare(`SELECT DISTINCT project_path AS identity
                       FROM workspace_members
                      WHERE project_path IS NOT NULL AND project_path <> ''
                      ORDER BY project_path ASC`).all();
      const identities = rows.map((row) => typeof row.identity === "string" ? row.identity : "").filter((identity) => identity.length > 0);
      if (identities.length > 0) {
        bumpEpochsForWorkspaceMemberSet(db, identities, Date.now());
      }
    }
  },
  {
    version: 36,
    description: "session project ownership map for compartment chunk backfill scoping",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS session_projects (
                    session_id TEXT NOT NULL,
                    harness TEXT NOT NULL DEFAULT 'opencode',
                    project_path TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY(session_id, harness)
                );
                CREATE INDEX IF NOT EXISTS idx_session_projects_project
                    ON session_projects(project_path);
            `);
      const hasChunkTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='compartment_chunk_embeddings'").get();
      if (hasChunkTable) {
        db.exec(`
                    INSERT OR IGNORE INTO session_projects (session_id, harness, project_path, updated_at)
                    SELECT session_id, harness, MIN(project_path), 0
                    FROM compartment_chunk_embeddings
                    GROUP BY session_id, harness
                    HAVING COUNT(DISTINCT project_path) = 1;
                `);
      }
    }
  },
  {
    version: 37,
    description: "emergency drain catch-up latch + historian drain failure backoff",
    up: (db) => {
      const hasSessionMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_meta'").get();
      if (!hasSessionMeta)
        return;
      ensureColumn(db, "session_meta", "emergency_drain_active", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "session_meta", "historian_drain_failure_at", "INTEGER NOT NULL DEFAULT 0");
    }
  },
  {
    version: 38,
    description: "durable transform decisions for cache-event cause attribution",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS transform_decisions (
                    session_id         TEXT    NOT NULL,
                    harness            TEXT    NOT NULL DEFAULT 'opencode',
                    message_id         TEXT    NOT NULL,
                    ts_ms              INTEGER NOT NULL,
                    decision           TEXT    NOT NULL,
                    materialized       INTEGER NOT NULL DEFAULT 0,
                    materialize_reason TEXT,
                    emergency          INTEGER NOT NULL DEFAULT 0,
                    dropped_tokens     INTEGER NOT NULL DEFAULT 0,
                    dropped_count      INTEGER NOT NULL DEFAULT 0,
                    input_tokens       INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (session_id, harness, message_id)
                );
                CREATE INDEX IF NOT EXISTS idx_transform_decisions_session_harness
                    ON transform_decisions(session_id, harness);
            `);
    }
  },
  {
    version: 39,
    description: "persist compaction marker target end message id",
    up: (db) => {
      const hasSessionMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_meta'").get();
      if (!hasSessionMeta)
        return;
      ensureColumn(db, "session_meta", "compaction_marker_state", "TEXT DEFAULT ''");
      ensureColumn(db, "session_meta", "compaction_marker_target_end_message_id", "TEXT");
      db.exec(`
                UPDATE session_meta
                SET compaction_marker_target_end_message_id = json_extract(compaction_marker_state, '$.targetEndMessageId')
                WHERE compaction_marker_target_end_message_id IS NULL
                  AND COALESCE(compaction_marker_state, '') != ''
                  AND json_valid(compaction_marker_state)
                  AND typeof(json_extract(compaction_marker_state, '$.targetEndMessageId')) = 'text'
            `);
    }
  },
  {
    version: 40,
    description: "index Pi fallback tool owners for stable-id cutover",
    up: (db) => {
      if (!tableExists4(db, "tags"))
        return;
      db.exec(`
                CREATE INDEX IF NOT EXISTS idx_tags_pi_fallback_tool_owner
                ON tags(session_id, tool_owner_message_id)
                WHERE type='tool';
            `);
    }
  },
  {
    version: 41,
    description: "key detected context limits by model",
    up: (db) => {
      if (!tableExists4(db, "session_meta"))
        return;
      ensureColumn(db, "session_meta", "detected_context_limit_model_key", "TEXT");
    }
  },
  {
    version: 42,
    description: "per-task dreamer scheduling state (Dreamer v2 A+B)",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS task_schedule_state (
                    project_path  TEXT    NOT NULL,
                    task          TEXT    NOT NULL,
                    last_run_at   INTEGER,
                    next_due_at   INTEGER,
                    schedule      TEXT,
                    last_status   TEXT,
                    last_error    TEXT,
                    retry_count   INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (project_path, task)
                );
                CREATE INDEX IF NOT EXISTS idx_task_schedule_due
                    ON task_schedule_state(next_due_at);
            `);
    }
  },
  {
    version: 43,
    description: "memory verification side table and verify watermarks",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS memory_verifications (
                    memory_id    INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
                    file_path    TEXT NOT NULL,
                    verified_at  INTEGER NOT NULL,
                    PRIMARY KEY (memory_id, file_path)
                );
                CREATE INDEX IF NOT EXISTS idx_memory_verifications_memory
                    ON memory_verifications(memory_id);
            `);
      if (tableExists4(db, "task_schedule_state")) {
        ensureColumn(db, "task_schedule_state", "last_checked_commit", "TEXT");
        ensureColumn(db, "task_schedule_state", "last_broad_run_at", "INTEGER");
      }
    }
  },
  {
    version: 44,
    description: "memory classification scope and shareability columns",
    up: (db) => {
      if (!tableExists4(db, "memories"))
        return;
      ensureColumn(db, "memories", "scope", "TEXT NOT NULL DEFAULT 'project'");
      ensureColumn(db, "memories", "shareable", "INTEGER NOT NULL DEFAULT 0");
    }
  },
  {
    version: 45,
    description: "retrospective content watermark and processed-window idempotence",
    up: (db) => {
      if (tableExists4(db, "task_schedule_state")) {
        ensureColumn(db, "task_schedule_state", "retrospective_watermark_ms", "INTEGER");
      }
      db.exec(`
                CREATE TABLE IF NOT EXISTS retrospective_processed_windows (
                    project_path TEXT NOT NULL,
                    window_key   TEXT NOT NULL,
                    processed_at INTEGER NOT NULL,
                    PRIMARY KEY (project_path, window_key)
                );
            `);
    }
  },
  {
    version: 46,
    description: "Primers v1 candidate and promoted primer storage",
    up: (db) => {
      db.exec(`
                CREATE TABLE IF NOT EXISTS primer_candidates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_path TEXT NOT NULL,
                    harness TEXT NOT NULL DEFAULT 'opencode',
                    session_id TEXT NOT NULL,
                    question TEXT NOT NULL,
                    normalized_question TEXT NOT NULL,
                    source_compartment_start INTEGER,
                    source_compartment_end INTEGER,
                    source_start_message_id TEXT NOT NULL DEFAULT '',
                    source_end_message_id TEXT NOT NULL DEFAULT '',
                    source_message_time INTEGER NOT NULL,
                    question_embedding BLOB,
                    question_embedding_model_id TEXT,
                    created_at INTEGER NOT NULL,
                    UNIQUE(project_path, harness, session_id, source_start_message_id, source_end_message_id)
                );
                CREATE INDEX IF NOT EXISTS idx_primer_candidates_project_time
                    ON primer_candidates(project_path, source_message_time);
                CREATE INDEX IF NOT EXISTS idx_primer_candidates_session
                    ON primer_candidates(session_id, harness);
                CREATE INDEX IF NOT EXISTS idx_primer_candidates_embedding_model
                    ON primer_candidates(project_path, question_embedding_model_id);

                CREATE TABLE IF NOT EXISTS primers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_path TEXT NOT NULL,
                    question TEXT NOT NULL,
                    question_embedding BLOB,
                    question_embedding_model_id TEXT,
                    answer TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
                    total_support INTEGER NOT NULL DEFAULT 0,
                    last_observed_at INTEGER,
                    answer_refreshed_at INTEGER,
                    source_candidate_ids TEXT NOT NULL DEFAULT '[]',
                    source_candidate_provenance TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_primers_project_status_observed
                    ON primers(project_path, status, last_observed_at DESC);
                CREATE INDEX IF NOT EXISTS idx_primers_embedding_model
                    ON primers(project_path, question_embedding_model_id);

                CREATE VIRTUAL TABLE IF NOT EXISTS primers_fts USING fts5(
                    question,
                    answer,
                    project_path UNINDEXED,
                    content='primers',
                    content_rowid='id',
                    tokenize='porter unicode61'
                );
                CREATE TRIGGER IF NOT EXISTS primers_ai AFTER INSERT ON primers BEGIN
                    INSERT INTO primers_fts(rowid, question, answer, project_path)
                    VALUES (new.id, new.question, new.answer, new.project_path);
                END;
                CREATE TRIGGER IF NOT EXISTS primers_ad AFTER DELETE ON primers BEGIN
                    INSERT INTO primers_fts(primers_fts, rowid, question, answer, project_path)
                    VALUES ('delete', old.id, old.question, old.answer, old.project_path);
                END;
                CREATE TRIGGER IF NOT EXISTS primers_au AFTER UPDATE ON primers BEGIN
                    INSERT INTO primers_fts(primers_fts, rowid, question, answer, project_path)
                    VALUES ('delete', old.id, old.question, old.answer, old.project_path);
                    INSERT INTO primers_fts(rowid, question, answer, project_path)
                    VALUES (new.id, new.question, new.answer, new.project_path);
                END;
            `);
    }
  },
  {
    version: 47,
    description: "compiled smart-note checks and runtime policy state",
    up: (db) => {
      if (!tableExists4(db, "notes"))
        return;
      ensureColumn(db, "notes", "compiled_check", "TEXT");
      ensureColumn(db, "notes", "manifest_json", "TEXT");
      ensureColumn(db, "notes", "check_hash", "TEXT");
      ensureColumn(db, "notes", "check_cron", "TEXT");
      ensureColumn(db, "notes", "check_version", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "notes", "check_status", "TEXT NOT NULL DEFAULT 'uncompiled'");
      ensureColumn(db, "notes", "check_failure_count", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "notes", "check_network_failure_count", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "notes", "check_quarantined_until", "INTEGER");
      ensureColumn(db, "notes", "check_next_due_at", "INTEGER");
      ensureColumn(db, "notes", "check_compiled_at", "INTEGER");
      ensureColumn(db, "notes", "check_false_since_at", "INTEGER");
      ensureColumn(db, "notes", "check_last_liveness_at", "INTEGER");
      ensureColumn(db, "notes", "policy_version", "INTEGER NOT NULL DEFAULT 1");
      db.exec(`
                CREATE INDEX IF NOT EXISTS idx_notes_smart_checks_due
                    ON notes(project_path, check_status, check_next_due_at)
                    WHERE type = 'smart' AND status = 'pending';
                CREATE INDEX IF NOT EXISTS idx_notes_smart_checks_liveness
                    ON notes(project_path, check_false_since_at, check_last_liveness_at)
                    WHERE type = 'smart' AND status = 'pending';
            `);
    }
  },
  {
    version: 48,
    description: "DreamerV2 rework: memory→file mapping vs verification split, classify marker",
    up: (db) => {
      if (tableExists4(db, "memory_verifications")) {
        ensureColumn(db, "memory_verifications", "mapped_at", "INTEGER NOT NULL DEFAULT 0");
      }
      if (tableExists4(db, "memories")) {
        ensureColumn(db, "memories", "classified_at", "INTEGER");
      }
    }
  },
  {
    version: 49,
    description: "per-model embedding coexistence and active identity tracking",
    up: (db) => {
      if (tableExists4(db, "memory_embeddings")) {
        db.exec(`
                    UPDATE memory_embeddings
                    SET model_id = 'legacy:unknown'
                    WHERE model_id IS NULL;
                `);
        if (tableExists4(db, "memories")) {
          db.exec(`
                        DELETE FROM memory_embeddings
                        WHERE memory_id NOT IN (SELECT id FROM memories);
                    `);
        }
        db.exec(`
                    DROP TABLE IF EXISTS memory_embeddings_v49_new;
                    CREATE TABLE memory_embeddings_v49_new (
                        memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
                        embedding BLOB NOT NULL,
                        model_id TEXT NOT NULL,
                        PRIMARY KEY(memory_id, model_id)
                    );
                    INSERT INTO memory_embeddings_v49_new (memory_id, embedding, model_id)
                    SELECT memory_id, embedding, model_id
                    FROM memory_embeddings;
                    DROP TABLE memory_embeddings;
                    ALTER TABLE memory_embeddings_v49_new RENAME TO memory_embeddings;
                `);
        assertForeignKeyIntegrity(db, "memory_embeddings");
      }
      if (tableExists4(db, "git_commit_embeddings")) {
        if (tableExists4(db, "git_commits")) {
          db.exec(`
                        DELETE FROM git_commit_embeddings
                        WHERE sha NOT IN (SELECT sha FROM git_commits);
                    `);
        }
        db.exec(`
                    DROP TABLE IF EXISTS git_commit_embeddings_v49_new;
                    CREATE TABLE git_commit_embeddings_v49_new (
                        sha TEXT NOT NULL,
                        embedding BLOB NOT NULL,
                        model_id TEXT NOT NULL,
                        created_at INTEGER NOT NULL,
                        PRIMARY KEY(sha, model_id),
                        FOREIGN KEY(sha) REFERENCES git_commits(sha) ON DELETE CASCADE
                    );
                    INSERT INTO git_commit_embeddings_v49_new (sha, embedding, model_id, created_at)
                    SELECT sha, embedding, model_id, created_at
                    FROM git_commit_embeddings;
                    DROP TABLE git_commit_embeddings;
                    ALTER TABLE git_commit_embeddings_v49_new RENAME TO git_commit_embeddings;
                `);
        assertForeignKeyIntegrity(db, "git_commit_embeddings");
      }
      if (tableExists4(db, "compartment_chunk_embeddings")) {
        if (tableExists4(db, "compartments")) {
          db.exec(`
                        DELETE FROM compartment_chunk_embeddings
                        WHERE compartment_id NOT IN (SELECT id FROM compartments);
                    `);
        }
        db.exec(`
                    DROP INDEX IF EXISTS idx_cce_session;
                    DROP INDEX IF EXISTS idx_cce_project_model;
                    DROP TABLE IF EXISTS compartment_chunk_embeddings_v49_new;
                    CREATE TABLE compartment_chunk_embeddings_v49_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        compartment_id INTEGER NOT NULL REFERENCES compartments(id) ON DELETE CASCADE,
                        session_id TEXT NOT NULL,
                        project_path TEXT NOT NULL,
                        harness TEXT NOT NULL DEFAULT 'opencode',
                        window_index INTEGER NOT NULL DEFAULT 0,
                        start_ordinal INTEGER NOT NULL,
                        end_ordinal INTEGER NOT NULL,
                        chunk_hash TEXT NOT NULL,
                        model_id TEXT NOT NULL,
                        dims INTEGER NOT NULL,
                        vector BLOB NOT NULL,
                        created_at INTEGER NOT NULL,
                        UNIQUE(compartment_id, model_id, window_index)
                    );
                    INSERT INTO compartment_chunk_embeddings_v49_new (
                        id, compartment_id, session_id, project_path, harness, window_index,
                        start_ordinal, end_ordinal, chunk_hash, model_id, dims, vector, created_at
                    )
                    SELECT id, compartment_id, session_id, project_path, harness, window_index,
                           start_ordinal, end_ordinal, chunk_hash, model_id, dims, vector, created_at
                    FROM compartment_chunk_embeddings;
                    DROP TABLE compartment_chunk_embeddings;
                    ALTER TABLE compartment_chunk_embeddings_v49_new RENAME TO compartment_chunk_embeddings;
                    CREATE INDEX IF NOT EXISTS idx_cce_session ON compartment_chunk_embeddings(session_id);
                    CREATE INDEX IF NOT EXISTS idx_cce_project_model ON compartment_chunk_embeddings(project_path, model_id);
                `);
        assertForeignKeyIntegrity(db, "compartment_chunk_embeddings");
      }
      db.exec(`
                CREATE TABLE IF NOT EXISTS embedding_identity_active (
                    project_path TEXT NOT NULL,
                    scope TEXT NOT NULL CHECK(scope IN ('memory', 'commit', 'chunk')),
                    model_id TEXT NOT NULL,
                    last_active_at INTEGER NOT NULL,
                    PRIMARY KEY(project_path, scope, model_id)
                );
            `);
    }
  },
  {
    version: 50,
    description: "add durable ctx-wrapup session marker",
    up(db) {
      if (tableExists4(db, "session_meta")) {
        ensureColumn(db, "session_meta", "wrapup_in_progress_state", "TEXT");
      }
    }
  },
  {
    version: 51,
    description: "version tool-owner backfill state and repair legacy NULL session metadata",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS tool_owner_backfill_state (
                    session_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'skipped')),
                    started_at INTEGER,
                    lease_expires_at INTEGER,
                    completed_at INTEGER,
                    last_error TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_tool_owner_backfill_state_status
                    ON tool_owner_backfill_state(status);
            `);
      healAllNullColumns(db);
    }
  },
  {
    version: 52,
    description: "persist emergency recovery origin",
    up(db) {
      if (tableExists4(db, "session_meta")) {
        ensureColumn(db, "session_meta", "emergency_recovery_origin", "TEXT DEFAULT ''");
      }
    }
  },
  {
    version: 53,
    description: "add Synapse batch, shadow, and measurement storage",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS embedding_registrations (
                    project_path TEXT PRIMARY KEY,
                    provider_identity TEXT NOT NULL DEFAULT '',
                    model_id TEXT NOT NULL DEFAULT '',
                    chunk_model_id TEXT NOT NULL DEFAULT '',
                    fingerprint TEXT NOT NULL DEFAULT '',
                    table_epoch INTEGER NOT NULL DEFAULT 0,
                    dims INTEGER NOT NULL DEFAULT 0,
                    provenance_json TEXT NOT NULL DEFAULT '{}',
                    generation INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS synapse_batch_ledger (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    project_path TEXT NOT NULL DEFAULT '',
                    scope TEXT NOT NULL DEFAULT '',
                    manifest_json TEXT NOT NULL DEFAULT '{}',
                    request_key TEXT NOT NULL DEFAULT '',
                    job_id TEXT,
                    cursor TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(session_id, request_key)
                );
                CREATE INDEX IF NOT EXISTS idx_synapse_batch_ledger_session
                    ON synapse_batch_ledger(session_id, updated_at);
                CREATE TABLE IF NOT EXISTS shadow_embedding_registrations (
                    project_path TEXT NOT NULL,
                    scope TEXT NOT NULL CHECK(scope IN ('memory', 'commit', 'chunk')),
                    model_id TEXT NOT NULL,
                    generation INTEGER NOT NULL DEFAULT 0,
                    fingerprint TEXT NOT NULL DEFAULT '',
                    table_epoch INTEGER NOT NULL DEFAULT 0,
                    dims INTEGER NOT NULL DEFAULT 0,
                    provenance_json TEXT NOT NULL DEFAULT '{}',
                    updated_at INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(project_path, scope, model_id)
                );
                CREATE TABLE IF NOT EXISTS embedding_measurement_corpus (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    project_path TEXT NOT NULL DEFAULT '',
                    dedup_key TEXT NOT NULL DEFAULT '',
                    cohort_key TEXT NOT NULL DEFAULT '',
                    query_text_hash TEXT NOT NULL DEFAULT '',
                    primary_result_ids_json TEXT NOT NULL DEFAULT '[]',
                    shadow_result_ids_json TEXT NOT NULL DEFAULT '[]',
                    primary_latency_ms INTEGER,
                    shadow_latency_ms INTEGER,
                    primary_failed INTEGER NOT NULL DEFAULT 0,
                    shadow_failed INTEGER NOT NULL DEFAULT 0,
                    primary_model_id TEXT NOT NULL DEFAULT '',
                    shadow_model_id TEXT NOT NULL DEFAULT '',
                    primary_fingerprint TEXT NOT NULL DEFAULT '',
                    shadow_fingerprint TEXT NOT NULL DEFAULT '',
                    primary_epoch INTEGER NOT NULL DEFAULT 0,
                    shadow_epoch INTEGER NOT NULL DEFAULT 0,
                    corpus_hash TEXT NOT NULL DEFAULT '',
                    coverage_json TEXT NOT NULL DEFAULT '{}',
                    created_at INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(dedup_key, cohort_key)
                );
                CREATE INDEX IF NOT EXISTS idx_embedding_measurement_session
                    ON embedding_measurement_corpus(session_id, created_at);
            `);
    }
  },
  {
    version: 54,
    description: "add authority identity, managed-write guards, and mirror cursors",
    up(db) {
      const memoriesPresent = tableExists4(db, "memories");
      const notesPresent = tableExists4(db, "notes");
      db.exec(`
                CREATE TABLE IF NOT EXISTS context_store_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS authority_managed (
                    project_path TEXT PRIMARY KEY,
                    context_store_uuid TEXT NOT NULL,
                    marked_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS authority_repair_pending (
                    project_path TEXT PRIMARY KEY,
                    started_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS mirror_identity (
                    domain TEXT NOT NULL CHECK(domain IN ('memories', 'notes')),
                    module_project TEXT NOT NULL,
                    module_row_id INTEGER NOT NULL,
                    context_row_id INTEGER NOT NULL,
                    PRIMARY KEY(domain, module_project, module_row_id),
                    UNIQUE(domain, context_row_id)
                );
                CREATE TABLE IF NOT EXISTS mirror_cursors (
                    domain TEXT PRIMARY KEY CHECK(domain IN ('memories', 'notes')),
                    cursor INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS context_privilege_state (
                    id INTEGER PRIMARY KEY CHECK(id = 1),
                    enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1))
                );
            `);
      if (memoriesPresent) {
        db.exec(`
                DROP TRIGGER IF EXISTS memories_authority_guard_insert;
                DROP TRIGGER IF EXISTS memories_authority_guard_update;
                DROP TRIGGER IF EXISTS memories_authority_guard_delete;
                CREATE TRIGGER memories_authority_guard_insert
                BEFORE INSERT ON memories
                 WHEN (
                     EXISTS (SELECT 1 FROM authority_managed WHERE project_path = NEW.project_path)
                     OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = NEW.project_path)
                 ) AND COALESCE((SELECT enabled FROM context_privilege_state WHERE id = 1), 0) = 0
                BEGIN
                    SELECT RAISE(ABORT, 'context.db memory writes are managed by the Rust module');
                END;
                CREATE TRIGGER memories_authority_guard_update
                BEFORE UPDATE ON memories
                 WHEN (
                     EXISTS (SELECT 1 FROM authority_managed WHERE project_path = OLD.project_path)
                     OR EXISTS (SELECT 1 FROM authority_managed WHERE project_path = NEW.project_path)
                     OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = OLD.project_path)
                     OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = NEW.project_path)
                 ) AND COALESCE((SELECT enabled FROM context_privilege_state WHERE id = 1), 0) = 0
                BEGIN
                    SELECT RAISE(ABORT, 'context.db memory writes are managed by the Rust module');
                END;
                CREATE TRIGGER memories_authority_guard_delete
                BEFORE DELETE ON memories
                 WHEN (
                     EXISTS (SELECT 1 FROM authority_managed WHERE project_path = OLD.project_path)
                     OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = OLD.project_path)
                 ) AND COALESCE((SELECT enabled FROM context_privilege_state WHERE id = 1), 0) = 0
                BEGIN
                    SELECT RAISE(ABORT, 'context.db memory writes are managed by the Rust module');
                END;
                `);
      }
      if (notesPresent) {
        db.exec(`
                DROP TRIGGER IF EXISTS notes_authority_guard_insert;
                DROP TRIGGER IF EXISTS notes_authority_guard_update;
                DROP TRIGGER IF EXISTS notes_authority_guard_delete;
                CREATE TRIGGER notes_authority_guard_insert
                BEFORE INSERT ON notes
                 WHEN NEW.type = 'smart' AND NEW.project_path IS NOT NULL
                   AND (
                       EXISTS (SELECT 1 FROM authority_managed WHERE project_path = NEW.project_path)
                       OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = NEW.project_path)
                   ) AND COALESCE((SELECT enabled FROM context_privilege_state WHERE id = 1), 0) = 0
                BEGIN
                    SELECT RAISE(ABORT, 'context.db smart-note writes are managed by the Rust module');
                END;
                CREATE TRIGGER notes_authority_guard_update
                BEFORE UPDATE ON notes
                WHEN (
                     (OLD.type = 'smart' AND OLD.project_path IS NOT NULL
                      AND (EXISTS (SELECT 1 FROM authority_managed WHERE project_path = OLD.project_path)
                       OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = OLD.project_path)))
                     OR
                     (NEW.type = 'smart' AND NEW.project_path IS NOT NULL
                      AND (EXISTS (SELECT 1 FROM authority_managed WHERE project_path = NEW.project_path)
                       OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = NEW.project_path)))
                ) AND COALESCE((SELECT enabled FROM context_privilege_state WHERE id = 1), 0) = 0
                BEGIN
                    SELECT RAISE(ABORT, 'context.db smart-note writes are managed by the Rust module');
                END;
                CREATE TRIGGER notes_authority_guard_delete
                BEFORE DELETE ON notes
                 WHEN OLD.type = 'smart' AND OLD.project_path IS NOT NULL
                   AND (
                       EXISTS (SELECT 1 FROM authority_managed WHERE project_path = OLD.project_path)
                       OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = OLD.project_path)
                   ) AND COALESCE((SELECT enabled FROM context_privilege_state WHERE id = 1), 0) = 0
                BEGIN
                    SELECT RAISE(ABORT, 'context.db smart-note writes are managed by the Rust module');
                END;
                `);
      }
    }
  },
  {
    version: 55,
    description: "make managed-write privilege connection-local",
    up(db) {
      const memoriesPresent = tableExists4(db, "memories");
      const notesPresent = tableExists4(db, "notes");
      const native = db;
      const privilegeCheck = typeof native.function === "function" || typeof native.createFunction === "function" ? "mc_privileged_writer() = 0" : "COALESCE((SELECT enabled FROM context_privilege_state WHERE id = 1), 0) = 0";
      if (memoriesPresent) {
        db.exec(`
                    DROP TRIGGER IF EXISTS memories_authority_guard_insert;
                    DROP TRIGGER IF EXISTS memories_authority_guard_update;
                    DROP TRIGGER IF EXISTS memories_authority_guard_delete;
                    CREATE TRIGGER memories_authority_guard_insert
                    BEFORE INSERT ON memories
                    WHEN (EXISTS (SELECT 1 FROM authority_managed WHERE project_path = NEW.project_path)
                       OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = NEW.project_path))
                      AND ${privilegeCheck}
                    BEGIN SELECT RAISE(ABORT, 'context.db memory writes are managed by the Rust module'); END;
                    CREATE TRIGGER memories_authority_guard_update
                    BEFORE UPDATE ON memories
                    WHEN (EXISTS (SELECT 1 FROM authority_managed WHERE project_path = OLD.project_path)
                       OR EXISTS (SELECT 1 FROM authority_managed WHERE project_path = NEW.project_path)
                       OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = OLD.project_path)
                       OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = NEW.project_path))
                      AND ${privilegeCheck}
                    BEGIN SELECT RAISE(ABORT, 'context.db memory writes are managed by the Rust module'); END;
                    CREATE TRIGGER memories_authority_guard_delete
                    BEFORE DELETE ON memories
                    WHEN (EXISTS (SELECT 1 FROM authority_managed WHERE project_path = OLD.project_path)
                       OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = OLD.project_path))
                      AND ${privilegeCheck}
                    BEGIN SELECT RAISE(ABORT, 'context.db memory writes are managed by the Rust module'); END;
                `);
      }
      if (notesPresent) {
        db.exec(`
                    DROP TRIGGER IF EXISTS notes_authority_guard_insert;
                    DROP TRIGGER IF EXISTS notes_authority_guard_update;
                    DROP TRIGGER IF EXISTS notes_authority_guard_delete;
                    CREATE TRIGGER notes_authority_guard_insert
                    BEFORE INSERT ON notes
                    WHEN NEW.type = 'smart' AND NEW.project_path IS NOT NULL
                      AND (EXISTS (SELECT 1 FROM authority_managed WHERE project_path = NEW.project_path)
                        OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = NEW.project_path))
                      AND ${privilegeCheck}
                    BEGIN SELECT RAISE(ABORT, 'context.db smart-note writes are managed by the Rust module'); END;
                    CREATE TRIGGER notes_authority_guard_update
                    BEFORE UPDATE ON notes
                    WHEN ((OLD.type = 'smart' AND OLD.project_path IS NOT NULL
                            AND (EXISTS (SELECT 1 FROM authority_managed WHERE project_path = OLD.project_path)
                              OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = OLD.project_path)))
                       OR (NEW.type = 'smart' AND NEW.project_path IS NOT NULL
                            AND (EXISTS (SELECT 1 FROM authority_managed WHERE project_path = NEW.project_path)
                              OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = NEW.project_path))))
                      AND ${privilegeCheck}
                    BEGIN SELECT RAISE(ABORT, 'context.db smart-note writes are managed by the Rust module'); END;
                    CREATE TRIGGER notes_authority_guard_delete
                    BEFORE DELETE ON notes
                    WHEN OLD.type = 'smart' AND OLD.project_path IS NOT NULL
                      AND (EXISTS (SELECT 1 FROM authority_managed WHERE project_path = OLD.project_path)
                        OR EXISTS (SELECT 1 FROM authority_repair_pending WHERE project_path = OLD.project_path))
                      AND ${privilegeCheck}
                    BEGIN SELECT RAISE(ABORT, 'context.db smart-note writes are managed by the Rust module'); END;
                `);
      }
    }
  },
  {
    version: 56,
    description: "record authority capture bounds and pending mirror references",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS authority_capture_bounds (
                    project_path TEXT NOT NULL,
                    domain TEXT NOT NULL CHECK(domain IN ('memories', 'notes')),
                    max_rowid INTEGER NOT NULL,
                    data_version INTEGER NOT NULL,
                    captured_at INTEGER NOT NULL,
                    PRIMARY KEY(project_path, domain)
                );
                CREATE TABLE IF NOT EXISTS mirror_pending_references (
                    domain TEXT NOT NULL CHECK(domain = 'memories'),
                    module_project TEXT NOT NULL,
                    module_row_id INTEGER NOT NULL,
                    target_module_row_id INTEGER NOT NULL,
                    PRIMARY KEY(domain, module_project, module_row_id)
                );
                CREATE INDEX IF NOT EXISTS idx_mirror_pending_reference_target
                    ON mirror_pending_references(domain, module_project, target_module_row_id);
                CREATE TABLE IF NOT EXISTS mirror_note_revisions (
                    module_project TEXT NOT NULL,
                    module_row_id INTEGER NOT NULL,
                    context_row_id INTEGER NOT NULL,
                    status_version INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(module_project, module_row_id),
                    UNIQUE(context_row_id)
                );
            `);
      installLatestAuthorityTriggers(db);
    }
  },
  {
    version: 57,
    description: "domain mutation epoch for authority capture bounds",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS domain_mutation_epoch (
                    project_path TEXT NOT NULL,
                    domain TEXT NOT NULL CHECK(domain IN ('memories', 'notes')),
                    epoch INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(project_path, domain)
                );
            `);
      if (tableExists4(db, "authority_capture_bounds")) {
        ensureColumn(db, "authority_capture_bounds", "mutation_epoch", "INTEGER NOT NULL DEFAULT 0");
      }
    }
  },
  {
    version: 58,
    description: "track live module memory identities during mirror replay",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS mirror_live_memory_rows (
                    module_project TEXT NOT NULL,
                    module_row_id INTEGER NOT NULL,
                    category TEXT NOT NULL,
                    normalized_hash TEXT NOT NULL,
                    PRIMARY KEY(module_project, module_row_id)
                );
                CREATE INDEX IF NOT EXISTS idx_mirror_live_memory_content
                    ON mirror_live_memory_rows(module_project, category, normalized_hash);
                CREATE TABLE IF NOT EXISTS mirror_resnapshot_state (
                    domain TEXT PRIMARY KEY CHECK(domain = 'memories'),
                    status TEXT NOT NULL CHECK(status IN ('pending_check', 'resnapshotting', 'complete')),
                    updated_at INTEGER NOT NULL
                );
                INSERT OR IGNORE INTO mirror_resnapshot_state(domain, status, updated_at)
                VALUES ('memories', 'pending_check', 0);
            `);
    }
  },
  {
    version: 59,
    description: "stage paged live memory resnapshots before atomic replacement",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS mirror_live_staging (
                    generation TEXT NOT NULL,
                    module_project TEXT NOT NULL,
                    module_row_id INTEGER NOT NULL,
                    category TEXT NOT NULL,
                    normalized_hash TEXT NOT NULL,
                    PRIMARY KEY(generation, module_project, module_row_id)
                );
                CREATE INDEX IF NOT EXISTS idx_mirror_live_staging_generation
                    ON mirror_live_staging(generation);
            `);
    }
  },
  {
    version: 60,
    description: "persist the owning live memory resnapshot generation",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS mirror_resnapshot_state (
                    domain TEXT PRIMARY KEY CHECK(domain = 'memories'),
                    status TEXT NOT NULL CHECK(status IN ('pending_check', 'resnapshotting', 'complete')),
                    updated_at INTEGER NOT NULL
                );
            `);
      db.exec("INSERT OR IGNORE INTO mirror_resnapshot_state(domain, status, updated_at) VALUES ('memories', 'pending_check', 0)");
      ensureColumn(db, "mirror_resnapshot_state", "generation", "TEXT");
    }
  },
  {
    version: 61,
    description: "retain complete memory snapshots for mirror healing",
    up(db) {
      ensureColumn(db, "mirror_live_memory_rows", "full_row_snapshot", "TEXT");
      ensureColumn(db, "mirror_live_staging", "full_row_snapshot", "TEXT");
      db.prepare(`UPDATE mirror_resnapshot_state
                    SET status = 'pending_check', generation = NULL, updated_at = ?
                  WHERE domain = 'memories'
                    AND status = 'complete'
                    AND NOT EXISTS (
                        SELECT 1 FROM schema_migrations WHERE version = 61
                    )`).run(Date.now());
    }
  },
  {
    version: 62,
    description: "durable row-level project identity merge audit log",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS identity_merge_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    from_identity TEXT NOT NULL,
                    to_identity TEXT NOT NULL,
                    table_name TEXT NOT NULL,
                    row_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    target_row_id TEXT,
                    merged_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_identity_merge_log_identities
                    ON identity_merge_log(from_identity, to_identity, merged_at);
                CREATE INDEX IF NOT EXISTS idx_identity_merge_log_table_row
                    ON identity_merge_log(table_name, row_id);
            `);
    }
  },
  {
    version: 63,
    description: "Add anchor_block_id to notes (module note mirror writes it)",
    up(db) {
      if (!tableExists4(db, "notes"))
        return;
      const columns = db.prepare("PRAGMA table_info(notes)").all();
      if (!columns.some((column) => column.name === "anchor_block_id")) {
        db.exec("ALTER TABLE notes ADD COLUMN anchor_block_id TEXT");
      }
    }
  },
  {
    version: 64,
    description: "store project-scoped rendered memory mural",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS mural_manifest (
                    project_path TEXT PRIMARY KEY,
                    image BLOB NOT NULL,
                    content_hash TEXT NOT NULL,
                    rendered_at INTEGER NOT NULL,
                    model TEXT,
                    memory_ids_json TEXT NOT NULL DEFAULT '[]',
                    width INTEGER NOT NULL DEFAULT 1092,
                    height INTEGER NOT NULL DEFAULT 1092
                );
            `);
      ensureColumn(db, "mural_manifest", "model", "TEXT");
      ensureColumn(db, "mural_manifest", "memory_ids_json", "TEXT NOT NULL DEFAULT '[]'");
      ensureColumn(db, "mural_manifest", "width", "INTEGER NOT NULL DEFAULT 1092");
      ensureColumn(db, "mural_manifest", "height", "INTEGER NOT NULL DEFAULT 1092");
    }
  },
  {
    version: 65,
    description: "Add per-memory mural cue columns for the deterministic cue-compression cutover",
    up(db) {
      if (!tableExists4(db, "memories"))
        return;
      ensureColumn(db, "memories", "mural_cue", "TEXT");
      ensureColumn(db, "memories", "mural_cue_hash", "TEXT");
      ensureColumn(db, "memories", "mural_cue_at", "INTEGER");
    }
  },
  {
    version: 66,
    description: "bound per-session historian upgrade reminders",
    up(db) {
      if (!tableExists4(db, "session_meta"))
        return;
      ensureColumn(db, "session_meta", "upgrade_reminder_last_sent_at", "INTEGER");
      ensureColumn(db, "session_meta", "upgrade_reminder_count", "INTEGER NOT NULL DEFAULT 0");
    }
  },
  {
    version: 67,
    description: "persist the frozen mural payload with each cached m0 baseline",
    up(db) {
      if (!tableExists4(db, "session_meta"))
        return;
      ensureColumn(db, "session_meta", "cached_m0_mural_data_url", "TEXT");
      ensureColumn(db, "session_meta", "cached_m0_mural_hash", "TEXT");
    }
  },
  {
    version: 68,
    description: "converge message FTS deletions and same-ID source revisions",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS message_history_source (
                    session_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    message_ordinal INTEGER NOT NULL,
                    source_version TEXT NOT NULL,
                    normalized_content_hash TEXT NOT NULL,
                    role TEXT NOT NULL,
                    harness TEXT NOT NULL DEFAULT 'opencode',
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY(session_id, message_id)
                );
                CREATE INDEX IF NOT EXISTS idx_message_history_source_session_ordinal
                    ON message_history_source(session_id, message_ordinal);

                CREATE TABLE IF NOT EXISTS pending_session_cleanup (
                    session_id TEXT PRIMARY KEY,
                    harness TEXT NOT NULL DEFAULT 'opencode',
                    requested_at INTEGER NOT NULL,
                    last_attempt_at INTEGER
                );

                CREATE TABLE IF NOT EXISTS message_history_orphan_sweep (
                    harness TEXT PRIMARY KEY,
                    cursor_session_id TEXT NOT NULL DEFAULT '',
                    last_swept_at INTEGER
                );
            `);
      if (tableExists4(db, "message_history_index")) {
        const columns = new Set(db.prepare("PRAGMA table_info(message_history_index)").all().map((column) => column.name));
        if (columns.has("session_id") && columns.has("harness") && columns.has("updated_at")) {
          db.exec(`
                        CREATE INDEX IF NOT EXISTS idx_message_history_index_orphan_sweep
                            ON message_history_index(harness, session_id, updated_at);
                    `);
        }
      }
    }
  },
  {
    version: 69,
    description: "index visibility mutation discovery and target loading",
    up(db) {
      if (!tableExists4(db, "memory_mutation_log"))
        return;
      db.exec(`
                CREATE INDEX IF NOT EXISTS idx_memory_mutation_log_visibility
                    ON memory_mutation_log(project_path, category, id, target_memory_id);
                CREATE INDEX IF NOT EXISTS idx_memory_mutation_log_target
                    ON memory_mutation_log(project_path, target_memory_id, id);
            `);
    }
  },
  {
    version: 70,
    description: "heal legacy compartments stranded by mismatched tier closing tags (issue #246)",
    up(db) {
      healMismatchedTierClose(db, "compartments", true);
      healMismatchedTierClose(db, "recomp_compartments", false);
    }
  },
  {
    version: 71,
    description: "rebuild authority guard triggers to the durable state-table form (issue #253)",
    up(db) {
      installLatestAuthorityTriggers(db);
    }
  },
  {
    version: 72,
    description: "add per-session compaction mode record column (issue #266)",
    up(db) {
      if (tableExists4(db, "session_meta")) {
        ensureColumn(db, "session_meta", "compaction_mode_record", "TEXT");
      }
    }
  },
  {
    version: 73,
    description: "persist the last successful todowrite permission verdict",
    up(db) {
      if (tableExists4(db, "session_meta")) {
        ensureColumn(db, "session_meta", "todo_permission_denied", "INTEGER NOT NULL DEFAULT 2");
      }
    }
  },
  {
    version: 74,
    description: "persist detected context-limit provenance",
    up(db) {
      if (tableExists4(db, "session_meta")) {
        ensureColumn(db, "session_meta", "detected_context_limit_provenance", "TEXT NOT NULL DEFAULT 'unknown'");
      }
    }
  },
  {
    version: 75,
    description: "persist mural cue validation rejection latches",
    up(db) {
      if (!tableExists4(db, "memories"))
        return;
      ensureColumn(db, "memories", "mural_cue_rejection_count", "INTEGER NOT NULL DEFAULT 0");
    }
  },
  {
    version: 76,
    description: "persist retina provider compilation for smart-note conditions",
    up(db) {
      if (!tableExists4(db, "notes"))
        return;
      ensureColumn(db, "notes", "compiled_provider", "TEXT");
      ensureColumn(db, "notes", "compiled_config", "TEXT");
      ensureColumn(db, "notes", "compiled_at", "INTEGER");
      ensureColumn(db, "notes", "compile_status", "TEXT CHECK(compile_status IN ('compiled', 'plain', 'refused'))");
    }
  },
  {
    version: 77,
    description: "persist scoped provenance for promoted user memories and primers",
    up(db) {
      if (tableExists4(db, "user_memories")) {
        ensureColumn(db, "user_memories", "source_candidate_provenance", "TEXT");
      }
      if (tableExists4(db, "primers")) {
        ensureColumn(db, "primers", "source_candidate_provenance", "TEXT");
      }
    }
  },
  {
    version: 78,
    description: "add migration_pending journal for crash-safe cross-harness session migration",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS migration_pending (
                    migration_key TEXT PRIMARY KEY,
                    source_session_id TEXT NOT NULL,
                    target_harness TEXT NOT NULL,
                    pi_session_id TEXT NOT NULL,
                    final_path TEXT NOT NULL,
                    stage_path TEXT NOT NULL,
                    content_sha256 TEXT NOT NULL,
                    phase TEXT NOT NULL CHECK (phase IN ('staged', 'db_committed')),
                    created_at INTEGER NOT NULL
                );
            `);
    }
  },
  {
    version: 79,
    description: "record m[0] system-hash and model-key comparison telemetry",
    up(db) {
      if (!tableExists4(db, "transform_decisions"))
        return;
      ensureColumn(db, "transform_decisions", "system_hash_prev", "TEXT");
      ensureColumn(db, "transform_decisions", "system_hash_new", "TEXT");
      ensureColumn(db, "transform_decisions", "m0_model_key_prev", "TEXT");
      ensureColumn(db, "transform_decisions", "m0_model_key_new", "TEXT");
    }
  },
  {
    version: 80,
    description: "record observed m[0] tool-set hash comparisons",
    up(db) {
      if (!tableExists4(db, "transform_decisions"))
        return;
      ensureColumn(db, "transform_decisions", "m0_tool_set_hash_prev", "TEXT");
      ensureColumn(db, "transform_decisions", "m0_tool_set_hash_new", "TEXT");
    }
  },
  {
    version: 81,
    description: "persist last-known-good transform snapshots across restarts",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS lkg_slots (
                    session_id TEXT PRIMARY KEY,
                    json_prefix TEXT NOT NULL,
                    input_id_seq TEXT NOT NULL,
                    input_content_digests TEXT NOT NULL,
                    input_content_signatures TEXT,
                    last_input_message_id TEXT NOT NULL,
                    model_key TEXT,
                    provider_key TEXT,
                    captured_at INTEGER NOT NULL,
                    row_version INTEGER,
                    capture_sequence INTEGER
                );
            `);
    }
  },
  {
    version: 82,
    description: "record the origin of memory file-independent mappings",
    up(db) {
      if (!tableExists4(db, "memory_verifications"))
        return;
      ensureColumn(db, "memory_verifications", "mapping_origin", "TEXT NOT NULL DEFAULT 'mapper'");
    }
  },
  {
    version: 83,
    description: "add indexed rowid access for message FTS content",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS message_fts_rowid_map (
                    session_id TEXT NOT NULL,
                    message_ordinal INTEGER NOT NULL,
                    fts_rowid INTEGER NOT NULL,
                    PRIMARY KEY(session_id, message_ordinal)
                );

                CREATE TABLE IF NOT EXISTS message_fts_rowid_map_backfill_state (
                    id INTEGER PRIMARY KEY CHECK(id = 1),
                    watermark_rowid INTEGER NOT NULL DEFAULT 0,
                    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
                    updated_at INTEGER NOT NULL DEFAULT 0
                );
                INSERT OR IGNORE INTO message_fts_rowid_map_backfill_state
                    (id, watermark_rowid, completed, updated_at)
                VALUES (1, 0, 0, 0);
            `);
    }
  },
  {
    version: 84,
    description: "persist protected-token floor state per session",
    up(db) {
      if (!tableExists4(db, "session_meta"))
        return;
      ensureColumn(db, "session_meta", "protected_tokens_effective", "INTEGER");
      ensureColumn(db, "session_meta", "protected_tokens_pre_snapshot", "TEXT");
    }
  },
  {
    version: 85,
    description: "relabel OpenCode 1.x mis-tagged opencode2 session rows (inert; superseded by v87)",
    up() {}
  },
  {
    version: 86,
    description: "track tag identity changes per session",
    up(db) {
      if (!tableExists4(db, "session_meta") || !tableExists4(db, "tags"))
        return;
      ensureColumn(db, "session_meta", "tags_version", "INTEGER NOT NULL DEFAULT 0");
      db.exec(`
                CREATE TRIGGER IF NOT EXISTS tags_version_ai AFTER INSERT ON tags BEGIN
                    INSERT INTO session_meta(
                        session_id, harness, last_response_time, cache_ttl, counter, tags_version,
                        last_nudge_tokens, last_nudge_band, last_transform_error, is_subagent,
                        last_context_percentage, last_input_tokens, observed_safe_input_tokens,
                        cache_alert_sent, times_execute_threshold_reached, compartment_in_progress,
                        system_prompt_hash, cleared_reasoning_through_tag
                    ) VALUES(NEW.session_id, NEW.harness, 0, '5m', 0, 1, 0, '', '', 0, 0, 0, 0, 0, 0, 0, '', 0)
                    ON CONFLICT(session_id) DO UPDATE SET tags_version = tags_version + 1;
                END;
                CREATE TRIGGER IF NOT EXISTS tags_version_ad AFTER DELETE ON tags BEGIN
                    INSERT INTO session_meta(
                        session_id, harness, last_response_time, cache_ttl, counter, tags_version,
                        last_nudge_tokens, last_nudge_band, last_transform_error, is_subagent,
                        last_context_percentage, last_input_tokens, observed_safe_input_tokens,
                        cache_alert_sent, times_execute_threshold_reached, compartment_in_progress,
                        system_prompt_hash, cleared_reasoning_through_tag
                    ) VALUES(OLD.session_id, OLD.harness, 0, '5m', 0, 1, 0, '', '', 0, 0, 0, 0, 0, 0, 0, '', 0)
                    ON CONFLICT(session_id) DO UPDATE SET tags_version = tags_version + 1;
                END;
                CREATE TRIGGER IF NOT EXISTS tags_version_au
                AFTER UPDATE OF session_id, message_id, tag_number, type, tool_owner_message_id, status
                ON tags BEGIN
                    INSERT INTO session_meta(
                        session_id, harness, last_response_time, cache_ttl, counter, tags_version,
                        last_nudge_tokens, last_nudge_band, last_transform_error, is_subagent,
                        last_context_percentage, last_input_tokens, observed_safe_input_tokens,
                        cache_alert_sent, times_execute_threshold_reached, compartment_in_progress,
                        system_prompt_hash, cleared_reasoning_through_tag
                    ) VALUES(OLD.session_id, OLD.harness, 0, '5m', 0, 1, 0, '', '', 0, 0, 0, 0, 0, 0, 0, '', 0)
                    ON CONFLICT(session_id) DO UPDATE SET tags_version = tags_version + 1;
                    INSERT INTO session_meta(
                        session_id, harness, last_response_time, cache_ttl, counter, tags_version,
                        last_nudge_tokens, last_nudge_band, last_transform_error, is_subagent,
                        last_context_percentage, last_input_tokens, observed_safe_input_tokens,
                        cache_alert_sent, times_execute_threshold_reached, compartment_in_progress,
                        system_prompt_hash, cleared_reasoning_through_tag
                    )
                    SELECT NEW.session_id, NEW.harness, 0, '5m', 0, 1, 0, '', '', 0, 0, 0, 0, 0, 0, 0, '', 0
                    WHERE NEW.session_id != OLD.session_id
                    ON CONFLICT(session_id) DO UPDATE SET tags_version = tags_version + 1;
                END;
            `);
    }
  },
  {
    version: 87,
    description: "repair OpenCode harness labels from host-store evidence",
    up(db) {
      repairOpenCode2HarnessLabels(db, {
        tables: [...V85_OPENCODE2_RELABEL_TABLES, ...V85_OPTIONAL_OPENCODE2_RELABEL_TABLES]
      });
    }
  },
  {
    version: 88,
    description: "record the store projection each session's coordinates were derived against",
    up(db) {
      if (tableExists4(db, "session_meta")) {
        ensureColumn(db, "session_meta", "coordinate_generation", "TEXT");
        ensureColumn(db, "session_meta", "coordinate_rebase_notice", "TEXT");
      }
      if (tableExists4(db, "compartments")) {
        ensureColumn(db, "compartments", "rebase_status", "TEXT NOT NULL DEFAULT 'ok'");
      }
      if (tableExists4(db, "recomp_compartments")) {
        ensureColumn(db, "recomp_compartments", "rebase_status", "TEXT NOT NULL DEFAULT 'ok'");
      }
    }
  },
  {
    version: 89,
    description: "persist indexed message creation times for date-bounded search",
    up(db) {
      if (!tableExists4(db, "message_fts_rowid_map"))
        return;
      ensureColumn(db, "message_fts_rowid_map", "message_time_ms", "INTEGER");
      db.exec(`
                CREATE INDEX IF NOT EXISTS idx_message_fts_rowid_map_session_time
                    ON message_fts_rowid_map(session_id, message_time_ms);
                CREATE TABLE IF NOT EXISTS message_time_backfill_state (
                    id INTEGER PRIMARY KEY CHECK(id = 1),
                    cursor_session_id TEXT NOT NULL DEFAULT '',
                    cursor_ordinal INTEGER NOT NULL DEFAULT 0,
                    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
                    updated_at INTEGER NOT NULL DEFAULT 0
                );
                INSERT OR IGNORE INTO message_time_backfill_state
                    (id, cursor_session_id, cursor_ordinal, completed, updated_at)
                VALUES (1, '', 0, 0, 0);
            `);
    }
  },
  {
    version: 90,
    description: "record compartment lease owner pids",
    up(db) {
      if (!tableExists4(db, "compartment_state_lease"))
        return;
      ensureColumn(db, "compartment_state_lease", "owner_pid", "INTEGER");
    }
  },
  {
    version: 91,
    description: "per-project embedding high-water mark for memories written outside this host",
    up(db) {
      db.exec(`
                CREATE TABLE IF NOT EXISTS memory_embedding_watermarks (
                    project_path TEXT PRIMARY KEY,
                    written_memory_id INTEGER NOT NULL DEFAULT 0,
                    embedded_memory_id INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0
                );
            `);
    }
  },
  {
    version: 92,
    description: "store-level offline single-store state and canonical compartment boundaries",
    up(db) {
      for (const table of ["compartments", "recomp_compartments"]) {
        if (!tableExists4(db, table))
          continue;
        ensureColumn(db, table, "start_block_index", "INTEGER");
        ensureColumn(db, table, "end_block_index", "INTEGER");
      }
      db.exec(`
                CREATE TABLE IF NOT EXISTS single_store_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    state TEXT NOT NULL CHECK (state IN ('required', 'migrated')),
                    migrated_at INTEGER,
                    migrated_by TEXT,
                    backup_dir TEXT,
                    report_json TEXT
                );
                INSERT OR IGNORE INTO single_store_state(id, state) VALUES (1, 'required');
            `);
    }
  },
  {
    version: 93,
    description: "per-session compartment history revision for shared readers",
    up(db) {
      installCompartmentHistoryVersions(db);
    }
  },
  {
    version: 94,
    description: "store LKG prefixes as slices and replay decisions as rows instead of growing records",
    up(db) {
      splitLkgSlotPrefixes(db);
      splitReplayDecisions(db);
    }
  },
  {
    version: 95,
    description: "cover cleanup and retention reads, index git FTS rowids and store temporal replay decisions",
    up(db) {
      installV95PerfSchema(db, true);
    }
  }
];
var LATEST_MIGRATION_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
function ensureMigrationsTable(db) {
  db.exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			description TEXT NOT NULL,
			applied_at INTEGER NOT NULL
		)
	`);
}
function getCurrentVersion(db) {
  const row = db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations WHERE version < ?").get(FORK_MIGRATION_VERSION_FLOOR);
  return row?.version ?? 0;
}
function isMigrationApplied(db, version) {
  return db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version) != null;
}
function hasPendingMigrations(db) {
  const bookkeeping = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (bookkeeping == null)
    return true;
  const currentVersion = getCurrentVersion(db);
  return MIGRATIONS.some((candidate) => candidate.version > currentVersion && !isMigrationApplied(db, candidate.version));
}
var mainThreadMigrationBodies = 0;
function getMainThreadMigrationBodyCount() {
  return mainThreadMigrationBodies;
}
function isSiblingMigrationConflict(db, error, version) {
  if (!(error instanceof Error))
    return false;
  const msg = error.message;
  if (!msg.includes("schema_migrations"))
    return false;
  if (!msg.toLowerCase().includes("version"))
    return false;
  const confirmed = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version);
  return confirmed != null;
}
function runMigrations(db) {
  try {
    ensureMigrationsTable(db);
  } catch (error) {
    if (isSqliteLockError(error)) {
      throw new MigrationLockBusyError(`failed to prepare migration lock: ${error instanceof Error ? error.message : String(error)}`);
    }
    throw error;
  }
  let loggedPlan = false;
  let touchedLegacyAuthorityBatch = false;
  while (true) {
    let migration;
    const migrationState = {};
    let currentVersion = 0;
    try {
      currentVersion = getCurrentVersion(db);
      const pendingMigration = MIGRATIONS.find((candidate) => candidate.version > currentVersion && !isMigrationApplied(db, candidate.version));
      if (!pendingMigration)
        break;
      migration = undefined;
      let transactionStartedAt = 0;
      const applied = db.transaction(() => {
        transactionStartedAt = performance.now();
        currentVersion = getCurrentVersion(db);
        migration = MIGRATIONS.find((candidate) => candidate.version > currentVersion && !isMigrationApplied(db, candidate.version));
        migrationState.value = migration;
        if (!migration)
          return false;
        if (!loggedPlan) {
          const pendingCount = MIGRATIONS.filter((candidate) => candidate.version > currentVersion && !isMigrationApplied(db, candidate.version)).length;
          log2(`[migrations] current upstream migration lane: ${currentVersion}, applying ${pendingCount} migration(s)`);
          loggedPlan = true;
        }
        if (isMainThread)
          mainThreadMigrationBodies += 1;
        migration.up(db);
        db.prepare("INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)").run(migration.version, migration.description, Date.now());
        return true;
      }).immediate();
      logSlowWriteTransaction("migration-runner", transactionStartedAt);
      migration = migrationState.value;
      if (!applied || !migration)
        break;
      if (migration.version <= 61)
        touchedLegacyAuthorityBatch = true;
      log2(`[migrations] applied v${migration.version}: ${migration.description}`);
    } catch (error) {
      if (!migration && isSqliteLockError(error)) {
        throw new MigrationLockBusyError(`failed to acquire migration write lock: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (migration && isSiblingMigrationConflict(db, error, migration.version)) {
        log2(`[migrations] v${migration.version} already applied by sibling instance — resuming with re-read version`);
        const reReadVersion = getCurrentVersion(db);
        if (reReadVersion > currentVersion)
          continue;
        throw new Error(`Migration v${migration.version} failed: sibling conflict reported but version did not advance. Database may need manual repair.`);
      }
      const version = migration?.version ?? currentVersion + 1;
      const description = migration?.description ?? "acquire migration write lock";
      log2(`[migrations] FAILED v${version}: ${description} — ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Migration v${version} failed: ${error instanceof Error ? error.message : String(error)}. Database may need manual repair.`);
    }
  }
  if (touchedLegacyAuthorityBatch) {
    try {
      let transactionStartedAt = 0;
      db.transaction(() => {
        transactionStartedAt = performance.now();
        installLatestAuthorityTriggers(db);
      }).immediate();
      logSlowWriteTransaction("migration-runner", transactionStartedAt);
    } catch (error) {
      throw new Error(`Migration authority-trigger postcondition failed: ${error instanceof Error ? error.message : String(error)}. Database may need manual repair.`);
    }
  }
  if (loggedPlan) {
    log2(`[migrations] upstream migration lane now: ${MIGRATIONS[MIGRATIONS.length - 1].version}`);
  }
}
async function runMigrationsWithRetry(db, options = {}) {
  const retryDelaysMs = options.retryDelaysMs ?? MIGRATION_LOCK_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const totalAttempts = retryDelaysMs.length + 1;
  for (let attempt = 1;attempt <= totalAttempts; attempt += 1) {
    log2(`[migrations] migration lock check attempt ${attempt}/${totalAttempts}`);
    try {
      runMigrations(db);
      return;
    } catch (error) {
      if (!(error instanceof MigrationLockBusyError))
        throw error;
      const delayMs = retryDelaysMs[attempt - 1];
      if (delayMs === undefined)
        throw error;
      log2(`[migrations] migration write lock is busy; retrying attempt ${attempt + 1}/${totalAttempts} in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
}

export { unescapeXml, parseCompartmentOutput, layoutLkgPrefix, assembleLkgPrefix, LKG_SLOT_CHUNKS_DDL, SESSION_REPLAY_DECISIONS_DDL, LKG_SLOTS_DDL, installCompartmentHistoryVersions, resolveWorkspaceShareCategories, resolveWorkspaceIdentitySet, expandWorkspaceIdentitySetWithAliases, resolveStoredPathWorkspaceIdentity, storedPathBelongsToWorkspace, sourceNameForMemory, computeWorkspaceEpochFingerprint, FORK_MIGRATION_VERSION_FLOOR, managedAuthorityNoteRow, hasPendingMigrations, getMainThreadMigrationBodyCount, runMigrations, runMigrationsWithRetry };
