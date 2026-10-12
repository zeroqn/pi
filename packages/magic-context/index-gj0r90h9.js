import {
  sessionLog2
} from "./index-f956htf3.js";

// ../plugin/src/shared/sqlite-helpers.ts
function closeQuietly(db) {
  if (!db)
    return;
  try {
    db.close();
  } catch {}
}
function isKnownAutocommit(db) {
  const state = db;
  try {
    return state.inTransaction === false || state.isTransaction === false;
  } catch {
    return false;
  }
}

// ../plugin/src/features/magic-context/storage-schema-helpers.ts
var columnCaches = new WeakMap;
function readColumnNames(db, table) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(rows.flatMap((row) => typeof row.name === "string" ? [row.name] : []));
}
function columnNames(db, table) {
  if (!isKnownAutocommit(db)) {
    columnCaches.delete(db);
    return readColumnNames(db, table);
  }
  let cache = columnCaches.get(db);
  if (!cache) {
    cache = { version: -1, stamp: db.prepare("PRAGMA schema_version"), tables: new Map };
    columnCaches.set(db, cache);
  }
  const [{ schema_version: version }] = cache.stamp.all();
  if (version !== cache.version) {
    cache.tables.clear();
    cache.version = version;
  }
  let columns = cache.tables.get(table);
  if (!columns) {
    columns = readColumnNames(db, table);
    cache.tables.set(table, columns);
  }
  return columns;
}
function getTableColumnNames(db, table) {
  if (!/^[a-z][a-z0-9_]*$/.test(table))
    throw new Error(`Unsafe schema identifier: ${table}`);
  return columnNames(db, table);
}
function ensureColumn(db, table, column, definition) {
  if (!/^[a-z][a-z0-9_]*$/.test(table) || !/^[a-z][a-z0-9_]*$/.test(column) || !/^[A-Z0-9_"'(),[\]\s]+$/i.test(definition)) {
    throw new Error(`Unsafe schema identifier: ${table}.${column} ${definition}`);
  }
  if (columnNames(db, table).has(column)) {
    return;
  }
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    columnCaches.delete(db);
    const recheck = db.prepare(`PRAGMA table_info(${table})`).all();
    if (recheck.some((row) => row.name === column)) {
      return;
    }
    throw err;
  }
}
function healAllNullColumns(db) {
  const existingColumns = getSessionMetaColumns(db);
  const fallbacks = [
    ["cache_ttl", ""],
    ["last_nudge_band", ""],
    ["last_nudge_level", ""],
    ["channel2_nudge_claim_token", ""],
    ["last_transform_error", ""],
    ["nudge_anchor_message_id", ""],
    ["nudge_anchor_text", ""],
    ["sticky_turn_reminder_text", ""],
    ["sticky_turn_reminder_message_id", ""],
    ["note_nudge_trigger_message_id", ""],
    ["note_nudge_sticky_text", ""],
    ["note_nudge_sticky_message_id", ""],
    ["last_todo_state", ""],
    ["todo_synthetic_call_id", ""],
    ["todo_synthetic_anchor_message_id", ""],
    ["todo_synthetic_state_json", ""],
    ["system_prompt_hash", ""],
    ["stripped_placeholder_ids", ""],
    ["stale_reduce_stripped_ids", ""],
    ["processed_image_stripped_ids", ""],
    ["merged_reasoning_stripped_ids", ""],
    ["thinking_binding_recovery_target", ""],
    ["trailing_blank_decisions", ""],
    ["memory_block_cache", ""],
    ["memory_block_ids", ""],
    ["compaction_marker_state", ""],
    ["key_files", ""],
    ["times_execute_threshold_reached", 0],
    ["compartment_in_progress", 0],
    ["historian_failure_count", 0],
    ["cleared_reasoning_through_tag", 0],
    ["memory_block_count", 0],
    ["system_prompt_tokens", 0],
    ["conversation_tokens", 0],
    ["tool_call_tokens", 0],
    ["note_nudge_trigger_pending", 0],
    ["observed_safe_input_tokens", 0],
    ["cache_alert_sent", 0],
    ["new_work_tokens", 0],
    ["total_input_tokens", 0],
    ["last_emergency_input_sample", 0],
    ["channel2_nudge_claimed_at", 0],
    ["last_usage_context_limit", 0],
    ["prior_boundary_ordinal", 1],
    ["protected_tail_policy_version", 0],
    ["protected_tail_drain_window_started_at", 0],
    ["protected_tail_drain_tokens", 0],
    ["recovery_no_eligible_head_count", 0],
    ["force_emergency_bypass_window_start", 0],
    ["force_emergency_bypass_used", 0],
    ["emergency_drain_active", 0],
    ["historian_drain_failure_at", 0]
  ];
  const presentFallbacks = fallbacks.filter(([column]) => existingColumns.has(column));
  if (presentFallbacks.length > 0) {
    const assignments = presentFallbacks.map(([column]) => `${column} = COALESCE(${column}, ?)`).join(", ");
    const nullPredicate = presentFallbacks.map(([column]) => `${column} IS NULL`).join(" OR ");
    db.prepare(`UPDATE session_meta SET ${assignments} WHERE ${nullPredicate}`).run(...presentFallbacks.map(([, fallback]) => fallback));
  }
  healMissingMemoryBlockIds(db, existingColumns);
}
function getSessionMetaColumns(db) {
  const rows = db.prepare("PRAGMA table_info(session_meta)").all();
  return new Set(rows.flatMap((row) => typeof row.name === "string" ? [row.name] : []));
}
function healMissingMemoryBlockIds(db, columns) {
  if (!columns.has("memory_block_cache") || !columns.has("memory_block_ids") || !columns.has("memory_block_count")) {
    return;
  }
  db.prepare("UPDATE session_meta SET memory_block_cache = '' WHERE memory_block_cache != '' AND (memory_block_ids IS NULL OR memory_block_ids = '') AND memory_block_count > 0").run();
}

// ../plugin/src/features/magic-context/temporal-decisions.ts
var PREFIX = "temporal-message-v1:";
function decodeTemporalDecision(entry) {
  if (!entry.startsWith(PREFIX))
    return null;
  try {
    const pair = JSON.parse(entry.slice(PREFIX.length));
    if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "string" && pair[0] && typeof pair[1] === "string")
      return [pair[0], pair[1]];
  } catch {}
  return null;
}
function readRows(db, sessionId, messageIds) {
  if (!messageIds)
    return db.prepare("SELECT message_id,marker FROM temporal_decisions WHERE session_id=?").all(sessionId);
  const ids = [...messageIds];
  const result = [];
  for (let offset = 0;offset < ids.length; offset += 400) {
    const chunk = ids.slice(offset, offset + 400);
    result.push(...db.prepare(`SELECT message_id,marker FROM temporal_decisions WHERE session_id=? AND message_id IN (${chunk.map(() => "?").join(",")})`).all(sessionId, ...chunk));
  }
  return result;
}
function getTemporalDecisions(db, sessionId, messageIds) {
  return new Map(readRows(db, sessionId, messageIds).flatMap((row) => row.marker === null ? [] : [[row.message_id, row.marker]]));
}
function observeTemporalDecisions(db, sessionId, candidates, previouslyServed, messageIds) {
  const ids = new Set([...candidates.keys(), ...messageIds ?? []]);
  const rows = readRows(db, sessionId, ids);
  const known = new Set(rows.map((row) => row.message_id));
  const missing = [...candidates].filter(([id]) => !known.has(id));
  if (!missing.length)
    return new Map(rows.flatMap((row) => row.marker === null ? [] : [[row.message_id, row.marker]]));
  const transient = new Map;
  db.transaction(() => {
    const insert = db.prepare("INSERT OR IGNORE INTO temporal_decisions(session_id,message_id,marker) VALUES (?,?,?)");
    const servedTag = db.prepare("SELECT 1 FROM tags WHERE session_id=? AND message_id=? UNION ALL SELECT 1 FROM tags WHERE session_id=? AND message_id>=? AND message_id<? LIMIT 1");
    let served;
    for (const [id, candidate] of missing) {
      const historical = servedTag.get(sessionId, id, sessionId, `${id}:p`, `${id}:q`);
      if (historical) {
        served ??= previouslyServed?.(missing.map(([missingId]) => missingId)) ?? new Map;
        const previous = served.get(id);
        if (previous === undefined) {
          transient.set(id, candidate);
          continue;
        }
        insert.run(sessionId, id, previous === "" && candidate !== "" ? null : previous);
      } else {
        insert.run(sessionId, id, null);
      }
    }
  }).immediate();
  return new Map([...transient, ...getTemporalDecisions(db, sessionId, ids)]);
}
function freezeTemporalDecisions(db, sessionId, candidates) {
  if (candidates.size === 0)
    return new Map;
  return db.transaction(() => {
    const insert = db.prepare("INSERT INTO temporal_decisions(session_id,message_id,marker) VALUES (?,?,?) ON CONFLICT(session_id,message_id) DO UPDATE SET marker=excluded.marker WHERE temporal_decisions.marker IS NULL");
    for (const [id, marker] of candidates) {
      insert.run(sessionId, id, marker);
    }
    return getTemporalDecisions(db, sessionId, candidates.keys());
  }).immediate();
}

// ../plugin/src/features/magic-context/migration-v95-perf-indexes.ts
var TEMPORAL_DECISIONS_DDL = `CREATE TABLE temporal_decisions (
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    marker TEXT,
    PRIMARY KEY (session_id, message_id)
) WITHOUT ROWID`;
var indexes = [
  ["message_fts_rowid_map", "idx_message_fts_rowid_map_session_rowid", "session_id, fts_rowid"],
  ["transform_decisions", "idx_transform_decisions_retention", "session_id, harness, ts_ms"],
  ["plugin_messages", "idx_plugin_messages_session", "session_id"],
  ["user_memory_candidates", "idx_user_memory_candidates_session", "session_id"]
];
var V95_REDUNDANT_INDEXES = [
  "idx_tags_session_tag_number",
  "idx_compartments_session",
  "idx_pending_ops_session",
  "idx_source_contents_session",
  "idx_compression_depth_session",
  "idx_transform_decisions_session_harness",
  "idx_project_key_files_project"
];
var GIT_COMMIT_FTS_ROWID_MAP_DDL = `CREATE TABLE git_commit_fts_rowid_map (
    fts_rowid INTEGER PRIMARY KEY,
    sha BLOB
)`;
var GIT_FTS_MAP_REPAIR_COMMAND = "magic-context doctor git-fts-map --repair";
var GIT_FTS_MAP_DISAGREEMENT_SQL = `
    SELECT 1 FROM git_commits_fts AS f
    LEFT JOIN git_commit_fts_rowid_map AS m ON m.fts_rowid = f.rowid
    WHERE m.fts_rowid IS NULL OR m.sha IS NOT f.sha OR typeof(m.sha) IS NOT typeof(f.sha)
    UNION ALL
    SELECT 1 FROM git_commit_fts_rowid_map AS m
    WHERE NOT EXISTS (SELECT 1 FROM git_commits_fts AS f WHERE f.rowid = m.fts_rowid)
    LIMIT 1`;
function gitFtsMapRepairMessage(detail) {
  return `${detail}; stop all hosts, then run \`${GIT_FTS_MAP_REPAIR_COMMAND}\` to back up both stores and rebuild only the map`;
}
var mapIndex = "CREATE INDEX idx_git_commit_fts_rowid_map_sha ON git_commit_fts_rowid_map(sha)";
var remove = (row) => `
    DELETE FROM git_commits_fts WHERE rowid IN (
        SELECT fts_rowid FROM git_commit_fts_rowid_map WHERE sha = ${row}.sha
    );
    DELETE FROM git_commit_fts_rowid_map WHERE sha = ${row}.sha;`;
var insert = `
    INSERT INTO git_commits_fts(sha, project_path, message)
    VALUES (NEW.sha, NEW.project_path, NEW.message);
    INSERT INTO git_commit_fts_rowid_map(fts_rowid, sha)
    VALUES (last_insert_rowid(), NEW.sha);`;
var triggers = [
  [
    "git_commits_fts_insert",
    `CREATE TRIGGER git_commits_fts_insert AFTER INSERT ON git_commits BEGIN${remove("NEW")}${insert}
END`
  ],
  [
    "git_commits_fts_delete",
    `CREATE TRIGGER git_commits_fts_delete AFTER DELETE ON git_commits BEGIN${remove("OLD")}
END`
  ],
  [
    "git_commits_fts_update",
    `CREATE TRIGGER git_commits_fts_update AFTER UPDATE OF message, project_path ON git_commits BEGIN${remove("OLD")}${insert}
END`
  ]
];
function installV95PerfSchema(db, verifyExistingMap = false, allowCreateMap = true) {
  const schema = new Map(db.prepare("SELECT name, sql FROM sqlite_master").all().map((row) => [row.name, row.sql]));
  if (!schema.has("temporal_decisions")) {
    db.exec(TEMPORAL_DECISIONS_DDL);
    if (schema.has("session_meta")) {
      ensureColumn(db, "session_meta", "merged_reasoning_stripped_ids", "TEXT DEFAULT ''");
      const rows = db.prepare("SELECT session_id, merged_reasoning_stripped_ids AS entries FROM session_meta WHERE merged_reasoning_stripped_ids LIKE '%temporal-message-v1:%'").all();
      const insert = db.prepare("INSERT OR IGNORE INTO temporal_decisions(session_id,message_id,marker) VALUES (?,?,?)");
      for (const row of rows) {
        let entries;
        try {
          entries = JSON.parse(row.entries);
        } catch {
          sessionLog2(row.session_id, "v95 temporal metadata: malformed JSON skipped; original blob retained");
          continue;
        }
        if (!Array.isArray(entries)) {
          sessionLog2(row.session_id, "v95 temporal metadata: non-array JSON skipped; original blob retained");
          continue;
        }
        const kept = [];
        for (const entry of entries) {
          const decision = typeof entry === "string" ? decodeTemporalDecision(entry) : null;
          if (decision)
            insert.run(row.session_id, ...decision);
          else
            kept.push(entry);
        }
        db.prepare("UPDATE session_meta SET merged_reasoning_stripped_ids=? WHERE session_id=?").run(JSON.stringify(kept), row.session_id);
      }
    }
  }
  for (const [table, name, columns] of indexes) {
    if (schema.has(table) && !schema.has(name))
      db.exec(`CREATE INDEX ${name} ON ${table}(${columns})`);
  }
  for (const name of V95_REDUNDANT_INDEXES) {
    if (schema.has(name))
      db.exec(`DROP INDEX ${name}`);
  }
  if (!schema.has("git_commits") || !schema.has("git_commits_fts"))
    return;
  const installed = schema.get("git_commit_fts_rowid_map");
  if (installed === undefined) {
    if (!allowCreateMap)
      throw new Error(gitFtsMapRepairMessage("git FTS rowid map is missing"));
    db.exec(GIT_COMMIT_FTS_ROWID_MAP_DDL);
    db.exec("INSERT INTO git_commit_fts_rowid_map(fts_rowid, sha) SELECT rowid, sha FROM git_commits_fts");
  } else if (installed !== GIT_COMMIT_FTS_ROWID_MAP_DDL) {
    throw new Error(gitFtsMapRepairMessage("git_commit_fts_rowid_map schema differs; refusing to replace rowid data"));
  }
  if (verifyExistingMap && installed !== undefined && db.prepare(GIT_FTS_MAP_DISAGREEMENT_SQL).get()) {
    throw new Error(gitFtsMapRepairMessage("git FTS rowid inventory differs; refusing migration replay"));
  }
  if (!schema.has("idx_git_commit_fts_rowid_map_sha"))
    db.exec(mapIndex);
  for (const [name, ddl] of triggers) {
    if (schema.get(name) === ddl)
      continue;
    db.exec(`DROP TRIGGER IF EXISTS ${name}`);
    db.exec(ddl);
  }
}
var tagOrderIndexes = new WeakMap;
function tagOrderConstraintIndex(db) {
  const version = db.prepare("PRAGMA schema_version").get().schema_version;
  const cacheable = isKnownAutocommit(db);
  if (!cacheable)
    tagOrderIndexes.delete(db);
  const cached = tagOrderIndexes.get(db);
  if (cached?.schemaVersion === version)
    return cached.name;
  const candidates = db.prepare("PRAGMA index_list(tags)").all();
  for (const candidate of candidates) {
    if (!candidate.unique || candidate.origin !== "u")
      continue;
    const quoted = `"${candidate.name.replaceAll('"', '""')}"`;
    const columns = db.prepare(`PRAGMA index_info(${quoted})`).all();
    if (columns.length !== 2 || columns[0]?.name !== "session_id" || columns[1]?.name !== "tag_number")
      continue;
    if (cacheable)
      tagOrderIndexes.set(db, { schemaVersion: version, name: quoted });
    return quoted;
  }
  throw new Error("tags lacks its UNIQUE(session_id, tag_number) ordering constraint");
}

// ../plugin/src/features/magic-context/storage-tag-identity-revision.ts
var TAG_IDENTITY_REVISION_PREFIX = "tag_identity_revision:";
function tagIdentityRevisionKey(sessionId) {
  return `${TAG_IDENTITY_REVISION_PREFIX}${sessionId}`;
}
var BUMP = (session) => `INSERT INTO schema_migrations_meta (key, value)
        VALUES ('${TAG_IDENTITY_REVISION_PREFIX}' || ${session}, '1')
        ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`;
var TRIGGER_SQL = `CREATE TEMP TRIGGER IF NOT EXISTS mc_tag_identity_revision_au
    AFTER UPDATE OF id, session_id, message_id, tag_number, type, tool_owner_message_id, reasoning_token_count
    ON main.tags
    BEGIN
        ${BUMP("OLD.session_id")};
        INSERT INTO schema_migrations_meta (key, value)
            SELECT '${TAG_IDENTITY_REVISION_PREFIX}' || NEW.session_id, '1'
            WHERE NEW.session_id IS NOT OLD.session_id
            ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT);
    END`;
function installTagIdentityRevisionTrigger(db) {
  db.exec(TRIGGER_SQL);
}
function deleteTagIdentityRevisions(db, sessionIds) {
  const statement = db.prepare("DELETE FROM schema_migrations_meta WHERE key = ? AND NOT EXISTS (SELECT 1 FROM tags WHERE session_id = ?)");
  for (const sessionId of sessionIds)
    statement.run(tagIdentityRevisionKey(sessionId), sessionId);
}

// ../plugin/src/shared/stable-json.ts
function stableStringify(value, seen = new WeakSet) {
  const pieces = [];
  writeStable(value, seen, pieces);
  return pieces.join("");
}
function writeStable(value, seen, pieces) {
  if (value === undefined) {
    pieces.push("undefined");
    return;
  }
  if (value === null || typeof value !== "object") {
    pieces.push(JSON.stringify(value) ?? String(value));
    return;
  }
  if (seen.has(value)) {
    pieces.push('"[Circular]"');
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    pieces.push("[");
    for (let index = 0;index < value.length; index += 1) {
      if (index > 0)
        pieces.push(",");
      if (index in value)
        writeStable(value[index], seen, pieces);
    }
    pieces.push("]");
    return;
  }
  const entries = Object.entries(value).sort(([a], [b]) => {
    if (a < b)
      return -1;
    if (a > b)
      return 1;
    return 0;
  });
  pieces.push("{");
  entries.forEach(([key, child], index) => {
    if (index > 0)
      pieces.push(",");
    pieces.push(JSON.stringify(key), ":");
    writeStable(child, seen, pieces);
  });
  pieces.push("}");
}

export { stableStringify, closeQuietly, isKnownAutocommit, getTableColumnNames, ensureColumn, healAllNullColumns, observeTemporalDecisions, freezeTemporalDecisions, installV95PerfSchema, tagOrderConstraintIndex, tagIdentityRevisionKey, installTagIdentityRevisionTrigger, deleteTagIdentityRevisions };
