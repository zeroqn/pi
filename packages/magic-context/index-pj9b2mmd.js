import {
  sanitizeDiagnosticText
} from "./index-dnp1jjar.js";
import {
  PROMOTABLE_CATEGORIES,
  CATEGORY_DEFAULT_TTL
} from "./index-135e8hvg.js";
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL
} from "./index-vcegxfwg.js";
import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  getDataDir,
  log2,
  sessionLog2
} from "./index-tm11k42a.js";
import {
  SubcClient,
  isSynapseEmbeddingTruncated,
  SynapseEmbeddingProvider
} from "./index-5rcjs14a.js";
import {
  inRootAsyncContext2,
  getSqliteDatabasePath2,
  withSqliteBackgroundWriter2,
  indexCoordinationInput2
} from "./index-2qtx0q6h.js";
import {
  runSessionWarmupWorker
} from "./index-xjhq27z9.js";
import {
  buildCanonicalChunkTextFromFts2,
  loadCompartmentChunkEmbeddingsForSearch2,
  peekCompartmentChunkSearchPool2,
  warmCompartmentChunkSearchPool2
} from "./index-cxczethe.js";
import {
  LocalEmbeddingProvider
} from "./index-bte6kzsd.js";
import {
  OpenAICompatibleEmbeddingProvider,
  saveCommitEmbedding,
  loadProjectCommitEmbeddings,
  loadUnembeddedCommits,
  countEmbeddedCommits,
  upsertCommits,
  getLatestIndexedCommitSha,
  enforceProjectCap,
  contentSha2562,
  getShadowEmbeddingMeasurementCohort2,
  getPrimaryEmbeddingMeasurementCohort2,
  embedShadowTextForProject2,
  enqueueShadowEmbeddingItems2,
  getProjectEmbeddingSnapshot2,
  embedTextForProject2,
  embedItemsForProject2
} from "./index-s2zjddb6.js";
import {
  recordEmbeddingMeasurement
} from "./index-hgd00nas.js";
import {
  scheduleAfterBootQuiet
} from "./index-453s1hj6.js";
import {
  saveEmbeddingIfHashMatches,
  getProjectEmbeddings2
} from "./index-yhzhdp3m.js";
import {
  ensureMemoryEmbeddings2
} from "./index-t5pyexcf.js";
import {
  getMemorySelectColumns2,
  isMemoryRow2,
  toMemory2,
  ModuleMemoryAuthorityError2,
  insertMemory2,
  getMemoryByHash2,
  getMemoriesByProject2,
  buildWorkspaceMemorySqlFilter2,
  getMemoriesByProjects2,
  getMemoryById2,
  updateMemorySeenCount2,
  updateMemoryRetrievalCount2
} from "./index-29nw7n1r.js";
import {
  cleanSearchText,
  hintKeywordRelevance,
  matchedSearchSnippet,
  getMessageIndexSourceIdentity,
  isMessageIndexSourceCurrent,
  getLastIndexedOrdinal,
  getIndexedMessageCorpusSize,
  getMessageIndexReconciliationStartOrdinal,
  isMessageIndexReconciledThrough,
  clearIndexedMessages,
  indexSingleMessage,
  indexMessagesAfterOrdinal
} from "./index-0t9xfj3x.js";
import {
  MESSAGE_FTS_SESSION_FILTER_SQL,
  withMessageFtsSessionFilter
} from "./index-8d2z6503.js";
import {
  resolveWorkspaceShareCategories,
  resolveWorkspaceIdentitySet,
  expandWorkspaceIdentitySetWithAliases,
  resolveStoredPathWorkspaceIdentity,
  sourceNameForMemory
} from "./index-pqhc0k9d.js";
import {
  getNotes,
  getActivePrimers
} from "./index-ay13n5s4.js";
import {
  computeNormalizedHash
} from "./index-9x1f96r8.js";
import {
  isKnownAutocommit
} from "./index-nrzkqte4.js";

// ../plugin/src/shared/user-facing-codes.ts
var USER_FACING_FAILURES = {
  historian_unavailable: {
    code: "MC-H01",
    sentence: "History compression could not finish this turn.",
    action: "It will retry automatically."
  },
  historian_saved_history_misaligned: {
    code: "MC-H03",
    sentence: "History compression is paused because this session's saved summaries no longer line up with its messages.",
    action: "Run /ctx-recomp to rebuild them."
  },
  history_boundary_unresolved: {
    code: "MC-H04",
    sentence: "This request was not sent: it is larger than the model's context window, and Magic Context could not cut the already-summarized history out of it.",
    action: "Run /ctx-flush to compress the history now, then send your message again."
  },
  history_boundary_recovering: {
    code: "MC-H08",
    sentence: "This request was not sent: it is larger than the model's context window, and Magic Context could not cut the already-summarized history out of it.",
    action: "Send your message again: Magic Context will first summarize more of the history and drop old tool output to make it fit."
  },
  history_over_window_unmanaged: {
    code: "MC-H06",
    sentence: "This request was not sent: this session's history is larger than the model's context window, and Magic Context does not have a summary of it yet to send in its place.",
    action: "Send your message again once history compression has caught up, or switch to a model with a larger context window."
  },
  frozen_history_over_window: {
    code: "MC-H07",
    sentence: "This request was not sent: the conversation is larger than the context window the provider reported, and the compressed history Magic Context has ready does not fit either.",
    action: "Run /ctx-flush to compress it now, then send your message again."
  },
  historian_window_too_small: {
    code: "MC-H05",
    sentence: "History compression is paused because the history model's context window is too small for its instructions.",
    action: "Set historian.model in magic-context.jsonc to a model with a larger context window."
  },
  recomp_unavailable: {
    code: "MC-R01",
    sentence: "History compression could not be rebuilt.",
    action: "Run /ctx-recomp again."
  },
  dream_provider_timeout: {
    code: "MC-D01",
    sentence: "Memory maintenance took too long to respond.",
    action: "Run /ctx-dream again."
  },
  dream_provider_error: {
    code: "MC-D02",
    sentence: "Memory maintenance could not reach its model.",
    action: "Check the model connection, then run /ctx-dream again."
  },
  dream_local_refusal: {
    code: "MC-D12",
    sentence: "Memory maintenance was refused before reaching the model.",
    action: "Check the hidden-request diagnostic in the Magic Context log before retrying."
  },
  dream_step_limit: {
    code: "MC-D10",
    sentence: "Memory maintenance stopped at its hidden agent step limit.",
    action: "This task needs less work per run; changing the model connection will not help."
  },
  dream_token_budget: {
    code: "MC-D11",
    sentence: "Memory maintenance reached its prompt-token budget.",
    action: "The unfinished items will be retried on the next run."
  },
  dream_empty_completion: {
    code: "MC-D03",
    sentence: "Memory maintenance received no usable response.",
    action: "Run /ctx-dream again."
  },
  dream_no_models: {
    code: "MC-D04",
    sentence: "Memory maintenance has no model available.",
    action: "Check the model settings, then run /ctx-dream again."
  },
  dream_child_aborted: {
    code: "MC-D05",
    sentence: "Memory maintenance was interrupted.",
    action: "Run /ctx-dream again."
  },
  dream_parse_failed: {
    code: "MC-D06",
    sentence: "Memory maintenance could not use the model response.",
    action: "Run /ctx-dream again."
  },
  dream_unknown: {
    code: "MC-D07",
    sentence: "Memory maintenance could not finish.",
    action: "Run /ctx-dream again."
  },
  dreamer_tick_blocked: {
    code: "MC-D09",
    sentence: "Background maintenance is not running: its last pass stopped before it reached the scheduled tasks.",
    action: "It is retried automatically; if it keeps happening, check the Magic Context log for the stage that stopped and run `npx @cortexkit/magic-context doctor`."
  },
  dream_task_needs_tool_loop: {
    code: "MC-D08",
    sentence: "Some memory maintenance tasks need a tool loop this host does not provide.",
    action: "The remaining tasks still run; the listed ones are skipped on this host."
  },
  embedding_substitution_rejected: {
    code: "MC-E01",
    sentence: "Search indexing could not use the selected model.",
    action: "Check the embedding model setting, then run /ctx-embed start again."
  },
  embedding_http_error: {
    code: "MC-E02",
    sentence: "The search indexing provider refused the request.",
    action: "Check the provider connection and credentials, then run /ctx-embed start again."
  },
  embedding_transport_error: {
    code: "MC-E03",
    sentence: "Search indexing could not reach its provider.",
    action: "Check the connection, then run /ctx-embed start again."
  },
  embedding_invalid_envelope: {
    code: "MC-E04",
    sentence: "Search indexing received an unsupported response.",
    action: "Check the embedding endpoint, then run /ctx-embed start again."
  },
  embedding_empty_result: {
    code: "MC-E05",
    sentence: "Search indexing received no usable result.",
    action: "Run /ctx-embed start again."
  },
  embedding_certification_refusal: {
    code: "MC-E06",
    sentence: "Search indexing is not ready for this provider.",
    action: "Finish the provider setup, or set a fallback provider in the embedding settings, then run /ctx-embed start again."
  },
  embedding_credential_required: {
    code: "MC-E07",
    sentence: "Search indexing needs provider credentials.",
    action: "Sign in to the provider, then run /ctx-embed start again."
  },
  embedding_local_binding_missing: {
    code: "MC-E08",
    sentence: "Local search indexing is unavailable on this system.",
    action: "Run `npx @cortexkit/magic-context doctor`, then retry."
  },
  embedding_local_fs_unavailable: {
    code: "MC-E09",
    sentence: "Local search indexing cannot save its model files.",
    action: "Update or reinstall Magic Context, then retry."
  },
  embedding_local_download_failure: {
    code: "MC-E10",
    sentence: "Local search indexing could not download its model.",
    action: "Check the network connection, then retry."
  },
  embedding_local_runtime_error: {
    code: "MC-E11",
    sentence: "Local search indexing could not start.",
    action: "Run `npx @cortexkit/magic-context doctor`, then retry."
  },
  embedding_unavailable: {
    code: "MC-E12",
    sentence: "Search indexing could not finish.",
    action: "Run /ctx-embed start again."
  },
  status_unavailable: {
    code: "MC-S01",
    sentence: "Magic Context status is temporarily unavailable.",
    action: "Retry /ctx-status in a moment."
  },
  transform_update_failed: {
    code: "MC-S02",
    sentence: "The last context update did not finish.",
    action: "Send another message to retry."
  },
  transform_pass_degraded: {
    code: "MC-S06",
    sentence: "This request was not sent: Magic Context could not finish preparing it, and without that preparation it could be far larger than the previous request.",
    action: "Send your message again."
  },
  configuration_warning: {
    code: "MC-S03",
    sentence: "Some configuration settings could not be applied.",
    action: "Fix the configuration warning shown in /ctx-status, then restart."
  },
  status_log_unavailable: {
    code: "MC-S04",
    sentence: "Some diagnostic details could not be saved.",
    action: "Retry /ctx-status in a moment."
  },
  memory_writes_paused: {
    code: "MC-C01",
    sentence: "Memory writes are paused while the engine syncs.",
    action: "Retry in a moment."
  },
  memory_access_unavailable: {
    code: "MC-C02",
    sentence: "Memory access is temporarily unavailable.",
    action: "Retry in a moment."
  },
  note_changes_paused: {
    code: "MC-C03",
    sentence: "Note changes are paused while the engine syncs.",
    action: "Retry in a moment."
  },
  note_access_unavailable: {
    code: "MC-C04",
    sentence: "Notes are temporarily unavailable.",
    action: "Retry in a moment."
  },
  context_cleanup_paused: {
    code: "MC-C05",
    sentence: "Context cleanup is paused while the engine syncs.",
    action: "Retry in a moment."
  },
  partial_history_unavailable: {
    code: "MC-C06",
    sentence: "Partial history compression is not available in the current mode.",
    action: "Run /ctx-recomp without a range."
  },
  smart_note_conditions_unavailable: {
    code: "MC-C08",
    sentence: "Conditional notes are not available in the current mode.",
    action: "Save a regular note without a condition."
  },
  history_compression_paused: {
    code: "MC-C09",
    sentence: "History compression is paused while the engine syncs.",
    action: "Retry in a moment."
  },
  history_compression_needs_message: {
    code: "MC-C12",
    sentence: "History compression has not seen this session since Magic Context reconnected.",
    action: "Send a message in this session first, then run /ctx-wrapup again."
  },
  context_service_unavailable: {
    code: "MC-C10",
    sentence: "Magic Context is temporarily unavailable.",
    action: "Retry in a moment."
  },
  context_db_missing: {
    code: "MC-C15",
    sentence: "Magic Context has no context.db.",
    action: "Run `npx @cortexkit/magic-context doctor store init`, then restart ck-mc."
  },
  single_store_migration_required: {
    code: "MC-C14",
    sentence: "Magic Context's Rust mode needs a one-time migration of its store.",
    action: "Quit OpenCode and every ck-mc process, then run `magic-context doctor single-store migrate`."
  },
  store_ahead_of_binary: {
    code: "MC-C13",
    sentence: "Magic Context refused to start: its store (store.db) was migrated by a newer ck-mc build than the one running.",
    action: "Update ck-mc, or roll back by restoring ck-mc together with context.db and store.db from the same backup."
  },
  compaction_marker_missing: {
    code: "MC-C11",
    sentence: "The history boundary marker is missing from the OpenCode store, so requests carry the full session.",
    action: "It is retried on every message; if this persists, run `/ctx-flush`."
  },
  memory_mirror_stalled: {
    code: "MC-M01",
    sentence: "Memory synchronization stopped before the host mirror caught up.",
    action: "Send another message to resume it, or run `ck doctor drain-authority`."
  },
  memory_authority_mismatch: {
    code: "MC-M02",
    sentence: "Memory authority is inconsistent between the host and module.",
    action: "Run `ck doctor drain-authority` before changing Rust mode."
  },
  dreamer_task_failing: {
    code: "MC-S05",
    sentence: "A background maintenance task keeps failing on its schedule.",
    action: "Check the Magic Context log for the failing task and its error."
  }
};
function renderUserFacingFailure(key, style = "markdown") {
  const failure = USER_FACING_FAILURES[key];
  const action = style === "plain" ? failure.action.replaceAll("`", "") : failure.action;
  return `${failure.sentence} ${action} (${failure.code})`;
}
function userFacingFailureCode(key) {
  return USER_FACING_FAILURES[key].code;
}
var CAPABILITY_FAILURES = {
  memory_write: "memory_writes_paused",
  memory_access: "memory_access_unavailable",
  note_change: "note_changes_paused",
  note_access: "note_access_unavailable",
  context_cleanup: "context_cleanup_paused",
  partial_history: "partial_history_unavailable",
  smart_note_condition: "smart_note_conditions_unavailable",
  history_compression: "history_compression_paused",
  context_service: "context_service_unavailable"
};
function renderCapabilityRefusal(capability) {
  return renderUserFacingFailure(CAPABILITY_FAILURES[capability]);
}
var DREAM_FAILURE_KEYS = {
  provider_timeout: "dream_provider_timeout",
  provider_error: "dream_provider_error",
  local_refusal: "dream_local_refusal",
  step_limit: "dream_step_limit",
  token_budget: "dream_token_budget",
  empty_completion: "dream_empty_completion",
  no_models: "dream_no_models",
  child_aborted: "dream_child_aborted",
  parse_failed: "dream_parse_failed",
  unknown: "dream_unknown"
};
var EMBEDDING_FAILURE_KEYS = {
  substitution_rejected: "embedding_substitution_rejected",
  http_error: "embedding_http_error",
  transport_error: "embedding_transport_error",
  invalid_envelope: "embedding_invalid_envelope",
  empty_result: "embedding_empty_result",
  certification_refusal: "embedding_certification_refusal",
  credential_required: "embedding_credential_required",
  local_binding_missing: "embedding_local_binding_missing",
  local_fs_unavailable: "embedding_local_fs_unavailable",
  local_download_failure: "embedding_local_download_failure",
  local_runtime_error: "embedding_local_runtime_error"
};
function renderDreamFailure(failureClass, style = "markdown", refusalReason) {
  const rendered = renderUserFacingFailure(DREAM_FAILURE_KEYS[failureClass], style);
  return failureClass === "local_refusal" && refusalReason ? `${rendered} Reason: ${sanitizeDiagnosticText(refusalReason).slice(0, 500)}` : rendered;
}
function dreamFailureCode(failureClass) {
  return userFacingFailureCode(DREAM_FAILURE_KEYS[failureClass]);
}
function renderEmbeddingFailure(failureClass, style = "markdown") {
  return renderUserFacingFailure(EMBEDDING_FAILURE_KEYS[failureClass], style);
}

// ../plugin/src/hooks/magic-context/single-store-refusal.ts
var SINGLE_STORE_MIGRATION_REQUIRED_CODE = "single_store_migration_required";
function renderSingleStoreMigrationRequiredRefusal() {
  const failure = USER_FACING_FAILURES.single_store_migration_required;
  return `${failure.sentence} ${failure.action} (${failure.code})`;
}

class SingleStoreMigrationRequiredError extends Error {
  code = SINGLE_STORE_MIGRATION_REQUIRED_CODE;
  constructor(options) {
    super(renderSingleStoreMigrationRequiredRefusal(), options);
    this.name = "SingleStoreMigrationRequiredError";
  }
}
function projectNeedsSingleStoreMigration(db, projectPath) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'authority_managed'").get();
  return Boolean(table && db.prepare("SELECT 1 FROM authority_managed WHERE project_path = ?").get(projectPath));
}
// ../plugin/src/features/magic-context/memory/cosine-similarity.ts
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0;index < a.length; index++) {
    dotProduct += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// ../plugin/src/features/magic-context/memory/embedding.ts
var DEFAULT_EMBEDDING_CONFIG = {
  provider: "local",
  model: DEFAULT_LOCAL_EMBEDDING_MODEL,
  local_runtime: "auto"
};
var embeddingConfig = DEFAULT_EMBEDDING_CONFIG;
var provider = null;
function createProvider(config) {
  if (config.provider === "off") {
    return null;
  }
  if (config.provider === "openai-compatible") {
    return new OpenAICompatibleEmbeddingProvider({
      endpoint: config.endpoint,
      model: config.model,
      apiKey: config.api_key,
      inputType: config.input_type,
      queryInputType: config.query_input_type,
      queryInstruction: config.query_instruction,
      documentPrefix: config.document_prefix,
      truncate: config.truncate,
      dimensions: config.dimensions,
      maxInputTokens: config.max_input_tokens
    });
  }
  if (config.provider === "local") {
    return new LocalEmbeddingProvider(config.model, config.max_input_tokens, config.local_dtype, config.local_runtime);
  }
  if (config.provider === "synapse") {
    const synapse = config;
    return new SynapseEmbeddingProvider({
      connectionFile: synapse.synapse_connection_file ?? "",
      projectRoot: "",
      session: "embedding",
      model: synapse.model,
      fingerprint: synapse.synapse_fingerprint,
      tableEpoch: synapse.synapse_table_epoch,
      dims: synapse.synapse_dims,
      recommendedBatch: synapse.synapse_recommended_batch,
      recommendedTokenBudget: synapse.synapse_recommended_token_budget,
      descriptor: synapse.synapse_descriptor,
      provenance: synapse.synapse_provenance
    });
  }
  throw new Error("Unknown embedding provider");
}
function getOrCreateProvider() {
  if (provider) {
    return provider;
  }
  provider = createProvider(embeddingConfig);
  return provider;
}
function isEmbeddingEnabled() {
  return embeddingConfig.provider !== "off";
}
async function embedText(text, signal) {
  const currentProvider = getOrCreateProvider();
  if (!currentProvider) {
    return null;
  }
  if (!await currentProvider.initialize()) {
    return null;
  }
  const vector = await currentProvider.embed(text, signal);
  return vector && !isSynapseEmbeddingTruncated(vector) ? vector : null;
}
// ../plugin/src/features/magic-context/memory/promotion.ts
function isPromotableCategory(category) {
  return PROMOTABLE_CATEGORIES.some((promotableCategory) => promotableCategory === category);
}
function resolveExpiresAt(category) {
  const ttl = CATEGORY_DEFAULT_TTL[category];
  return ttl === undefined ? null : Date.now() + ttl;
}
function promoteSessionFactsDurable(db, sessionId, projectPath, facts) {
  const newMemoryRefs = [];
  let factsPromoted = 0;
  for (const fact of facts) {
    if (!fact || typeof fact.category !== "string" || typeof fact.content !== "string" || fact.content.trim().length === 0) {
      continue;
    }
    if (!isPromotableCategory(fact.category)) {
      continue;
    }
    const normalizedHash = computeNormalizedHash(fact.content);
    const existingMemory = getMemoryByHash2(db, projectPath, fact.category, normalizedHash);
    if (existingMemory) {
      updateMemorySeenCount2(db, existingMemory.id);
      factsPromoted += 1;
      continue;
    }
    const memoryInput = {
      projectPath,
      category: fact.category,
      content: fact.content,
      sourceSessionId: sessionId,
      sourceType: "historian",
      expiresAt: resolveExpiresAt(fact.category)
    };
    const memory = insertMemory2(db, memoryInput);
    newMemoryRefs.push({ memoryId: memory.id, content: memory.content });
    factsPromoted += 1;
  }
  return { newMemoryRefs, factsPromoted };
}
async function embedPromotedFacts(db, sessionId, projectPath, refs) {
  for (const ref of refs) {
    await embedAndStoreMemory(db, sessionId, projectPath, ref.memoryId, ref.content);
  }
}
async function embedAndStoreMemory(db, sessionId, projectPath, memoryId, content) {
  try {
    const hashBeforeEmbed = getMemoryById2(db, memoryId)?.normalizedHash;
    if (!hashBeforeEmbed) {
      return;
    }
    const result = await embedTextForProject2(projectPath, content);
    if (result) {
      db.transaction(() => {
        saveEmbeddingIfHashMatches(db, memoryId, result.vector, result.modelId, hashBeforeEmbed);
      }).immediate();
    }
  } catch (error) {
    sessionLog2(sessionId, `memory embedding failed for memory ${memoryId}:`, error);
  }
}
// ../plugin/src/features/magic-context/memory/storage-memory-fts.ts
var DEFAULT_SEARCH_LIMIT = 10;
var searchStatements = new WeakMap;
var datedSearchStatements = new WeakMap;
var unionSearchStatements = new Map;
var datedUnionSearchStatements = new Map;
function getSearchStatement(db, dated = false) {
  const statements = dated ? datedSearchStatements : searchStatements;
  let stmt = statements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT ${getMemorySelectColumns2(db)} FROM memories_fts INNER JOIN memories ON memories.id = memories_fts.rowid WHERE memories.project_path = ? AND memories.status IN ('active', 'permanent') AND (memories.expires_at IS NULL OR memories.expires_at > ?)${dated ? " AND memories.created_at BETWEEN ? AND ?" : ""} AND memories_fts MATCH ? ORDER BY bm25(memories_fts), memories.updated_at DESC, memories.id ASC LIMIT ?`);
    statements.set(db, stmt);
  }
  return stmt;
}
function getUnionSearchStatement(db, arity, dated = false) {
  const statementRegistry = dated ? datedUnionSearchStatements : unionSearchStatements;
  let statements = statementRegistry.get(arity);
  if (!statements) {
    statements = new WeakMap;
    statementRegistry.set(arity, statements);
  }
  let stmt = statements.get(db);
  if (!stmt) {
    const placeholders = Array.from({ length: arity }, () => "?").join(", ");
    stmt = db.prepare(`SELECT ${getMemorySelectColumns2(db)} FROM memories_fts INNER JOIN memories ON memories.id = memories_fts.rowid WHERE memories.project_path IN (${placeholders}) AND memories.status IN ('active', 'permanent') AND (memories.expires_at IS NULL OR memories.expires_at > ?)${dated ? " AND memories.created_at BETWEEN ? AND ?" : ""} AND memories_fts MATCH ? ORDER BY bm25(memories_fts), memories.updated_at DESC, memories.id ASC LIMIT ?`);
    statements.set(db, stmt);
  }
  return stmt;
}
function uniqueProjectPaths(projectPaths) {
  return [...new Set(projectPaths.filter((path) => path.length > 0))];
}
function relaxedFtsQuery(query) {
  const tokens = [...new Set(query.match(/[\p{L}\p{N}_]+/gu) ?? [])].filter((token) => token.length > 2 || /\d/.test(token)).slice(0, 16);
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" OR ");
}
function sanitizeFtsQuery(query) {
  const tokens = query.replaceAll("\x00", " ").split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0)
    return "";
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"`).join(" ");
}
function searchMemoriesFTS(db, projectPath, query, limit = DEFAULT_SEARCH_LIMIT, dateRange = null) {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0 || limit <= 0) {
    return [];
  }
  const sanitized = sanitizeFtsQuery(trimmedQuery);
  if (sanitized.length === 0) {
    return [];
  }
  let rows = getSearchStatement(db, dateRange !== null).all(projectPath, Date.now(), ...dateRange === null ? [] : [dateRange.from, dateRange.to], sanitized, limit).filter(isMemoryRow2);
  if (rows.length === 0) {
    const relaxed = relaxedFtsQuery(trimmedQuery);
    if (relaxed)
      rows = getSearchStatement(db, dateRange !== null).all(projectPath, Date.now(), ...dateRange === null ? [] : [dateRange.from, dateRange.to], relaxed, limit).filter(isMemoryRow2);
  }
  return rows.map(toMemory2);
}
function searchMemoriesFTSUnion(db, projectPaths, query, limit = DEFAULT_SEARCH_LIMIT, ownIdentities, shareCategories, dateRange = null) {
  const identities = uniqueProjectPaths(projectPaths);
  if (identities.length === 0)
    return [];
  const sharingFilter = buildWorkspaceMemorySqlFilter2({
    identities,
    ownIdentities,
    shareCategories,
    tableName: "memories",
    includeClassificationFields: (() => {
      const columns = db.prepare("PRAGMA table_info(memories)").all();
      return columns.some((row) => row.name === "shareable") && columns.some((row) => row.name === "scope");
    })()
  });
  if (identities.length === 1 && !sharingFilter.active) {
    return searchMemoriesFTS(db, identities[0], query, limit, dateRange);
  }
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0 || limit <= 0)
    return [];
  const sanitized = sanitizeFtsQuery(trimmedQuery);
  if (sanitized.length === 0)
    return [];
  let rows = sharingFilter.active ? db.prepare(`SELECT ${getMemorySelectColumns2(db)} FROM memories_fts INNER JOIN memories ON memories.id = memories_fts.rowid WHERE memories.project_path IN (${identities.map(() => "?").join(", ")}) AND memories.status IN ('active', 'permanent') AND (memories.expires_at IS NULL OR memories.expires_at > ?)${dateRange === null ? "" : " AND memories.created_at BETWEEN ? AND ?"} AND memories_fts MATCH ?${sharingFilter.clause} ORDER BY bm25(memories_fts), memories.updated_at DESC, memories.id ASC LIMIT ?`).all(...identities, Date.now(), ...dateRange === null ? [] : [dateRange.from, dateRange.to], sanitized, ...sharingFilter.params, limit).filter(isMemoryRow2) : getUnionSearchStatement(db, identities.length, dateRange !== null).all(...identities, Date.now(), ...dateRange === null ? [] : [dateRange.from, dateRange.to], sanitized, limit).filter(isMemoryRow2);
  if (rows.length === 0) {
    const relaxed = relaxedFtsQuery(trimmedQuery);
    if (relaxed) {
      rows = (sharingFilter.active ? db.prepare(`SELECT ${getMemorySelectColumns2(db)} FROM memories_fts INNER JOIN memories ON memories.id = memories_fts.rowid WHERE memories.project_path IN (${identities.map(() => "?").join(", ")}) AND memories.status IN ('active', 'permanent') AND (memories.expires_at IS NULL OR memories.expires_at > ?)${dateRange === null ? "" : " AND memories.created_at BETWEEN ? AND ?"} AND memories_fts MATCH ?${sharingFilter.clause} ORDER BY bm25(memories_fts), memories.updated_at DESC, memories.id ASC LIMIT ?`) : getUnionSearchStatement(db, identities.length, dateRange !== null)).all(...identities, Date.now(), ...dateRange === null ? [] : [dateRange.from, dateRange.to], relaxed, ...sharingFilter.params, limit).filter(isMemoryRow2);
    }
  }
  return rows.map(toMemory2);
}
// ../plugin/src/features/magic-context/memory/storage-memory-verifications.ts
var MEMORY_VERIFICATION_SENTINEL = "";
function uniqueSortedFiles(files) {
  return Array.from(new Set(files.filter((file) => file !== MEMORY_VERIFICATION_SENTINEL))).sort();
}
function recordMemoryMapping(db, memoryId, normalizedFiles, now, mappingOrigin = "mapper") {
  const realFiles = uniqueSortedFiles(normalizedFiles);
  const filesToWrite = realFiles.length > 0 ? realFiles : [MEMORY_VERIFICATION_SENTINEL];
  db.prepare("DELETE FROM memory_verifications WHERE memory_id = ?").run(memoryId);
  const insert = db.prepare("INSERT INTO memory_verifications (memory_id, file_path, verified_at, mapped_at, mapping_origin) VALUES (?, ?, 0, ?, ?)");
  for (const file of filesToWrite) {
    insert.run(memoryId, file, now, mappingOrigin);
  }
  return filesToWrite.length;
}
function recordMemoryVerifications(db, memoryId, normalizedFiles, now) {
  const realFiles = uniqueSortedFiles(normalizedFiles);
  const filesToWrite = realFiles.length > 0 ? realFiles : [MEMORY_VERIFICATION_SENTINEL];
  db.prepare("DELETE FROM memory_verifications WHERE memory_id = ?").run(memoryId);
  const insert = db.prepare("INSERT INTO memory_verifications (memory_id, file_path, verified_at, mapped_at, mapping_origin) VALUES (?, ?, ?, ?, 'mapper')");
  for (const file of filesToWrite) {
    insert.run(memoryId, file, now, now);
  }
  return filesToWrite.length;
}
function getUnmappedMemoryIds(db, memoryIds) {
  const ids = Array.from(new Set(memoryIds.filter(Number.isInteger)));
  if (ids.length === 0)
    return [];
  const rows = db.prepare("SELECT DISTINCT memory_id FROM memory_verifications WHERE memory_id IN (SELECT value FROM json_each(?))").all(JSON.stringify(ids));
  const mapped = new Set(rows.map((r) => r.memory_id));
  return ids.filter((id) => !mapped.has(id));
}
function clearMemoryVerifications(db, memoryId) {
  db.prepare("DELETE FROM memory_verifications WHERE memory_id = ?").run(memoryId);
}
function getMemoryVerifications(db, memoryIds) {
  const ids = Array.from(new Set(memoryIds.filter(Number.isInteger)));
  const result = new Map;
  if (ids.length === 0)
    return result;
  const rows = db.prepare(`SELECT memory_id, file_path, verified_at, mapped_at, mapping_origin
               FROM memory_verifications
              WHERE memory_id IN (SELECT value FROM json_each(?))
              ORDER BY memory_id, file_path`).all(JSON.stringify(ids));
  for (const row of rows) {
    const existing = result.get(row.memory_id) ?? {
      files: [],
      hasSentinel: false,
      mappingOrigin: "mapper",
      verifiedAt: 0,
      mappedAt: 0
    };
    if (row.file_path === MEMORY_VERIFICATION_SENTINEL) {
      existing.hasSentinel = true;
    } else if (!existing.files.includes(row.file_path)) {
      existing.files.push(row.file_path);
    }
    if (row.mapping_origin === "host_rejected_fallback") {
      existing.mappingOrigin = "host_rejected_fallback";
    }
    existing.verifiedAt = Math.max(existing.verifiedAt, row.verified_at);
    existing.mappedAt = Math.max(existing.mappedAt, row.mapped_at ?? 0);
    result.set(row.memory_id, existing);
  }
  for (const state of result.values()) {
    state.files.sort();
  }
  return result;
}
// ../plugin/src/features/magic-context/memory/verification-paths.ts
import { execFile } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var GIT_TIMEOUT_MS = 1e4;
var defaultExecFileForVerificationPaths = async (file, args, options) => await execFileAsync(file, [...args], {
  ...options,
  windowsHide: true
});
var execFileForVerificationPaths = defaultExecFileForVerificationPaths;
async function runGit(cwd, args) {
  try {
    const result = await execFileForVerificationPaths("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8",
      windowsHide: true
    });
    return String(result.stdout);
  } catch (error) {
    if (error.killed || error.code === "ETIMEDOUT") {
      throw new Error(`Git verification command git ${args.join(" ")} timed out after ${GIT_TIMEOUT_MS}ms`, {
        cause: error
      });
    }
    return null;
  }
}
function toPosixPath(value) {
  return value.split(path.sep).join("/");
}
function isWithin(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || !rel.startsWith("..") && !path.isAbsolute(rel);
}
function safeRealpath(value) {
  try {
    return realpathSync.native(value);
  } catch {
    return null;
  }
}
async function resolveGitTopLevel(cwd) {
  const stdout = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const root = stdout?.trim();
  return root ? safeRealpath(root) ?? path.resolve(root) : null;
}
async function readGitHead(cwd) {
  const stdout = await runGit(cwd, ["rev-parse", "HEAD"]);
  const head = stdout?.trim();
  return head && /^[0-9a-f]{40}$/i.test(head) ? head : null;
}
async function readGitChangedFilesSince(cwd, revision, knownGitRoot) {
  if (!/^[0-9a-f]{7,40}$/i.test(revision))
    return null;
  const gitRoot = knownGitRoot ?? await resolveGitTopLevel(cwd);
  if (!gitRoot)
    return null;
  const stdout = await runGit(gitRoot, ["diff", "--name-only", "-z", revision]);
  if (stdout === null)
    return null;
  return new Set(stdout.split("\x00").filter(Boolean));
}
async function readGitFileChangeTimesSince(cwd, sinceMs, knownGitRoot) {
  const gitRoot = knownGitRoot ?? await resolveGitTopLevel(cwd);
  if (!gitRoot)
    return null;
  const sinceSec = Math.max(0, Math.floor(sinceMs / 1000));
  const stdout = await runGit(gitRoot, [
    "log",
    `--since=@${sinceSec}`,
    "--name-only",
    "--format=%ct"
  ]);
  if (stdout === null)
    return null;
  const times = new Map;
  let currentMs = 0;
  for (const rawLine of stdout.split(`
`)) {
    const line = rawLine.trimEnd();
    if (line === "")
      continue;
    if (/^\d+$/.test(line)) {
      currentMs = Number.parseInt(line, 10) * 1000;
      continue;
    }
    if (currentMs > 0 && !times.has(line)) {
      times.set(line, currentMs);
    }
  }
  return times;
}
async function gitTrackedPath(gitRoot, repoRelativePath) {
  const stdout = await runGit(gitRoot, [
    "ls-files",
    "-z",
    "--full-name",
    "--error-unmatch",
    "--",
    repoRelativePath
  ]);
  const fallbackStdout = stdout === null ? await runGit(gitRoot, ["ls-files", "-z", "--full-name"]) : null;
  if (stdout === null && fallbackStdout === null)
    return null;
  const matches = (stdout ?? fallbackStdout ?? "").split("\x00").filter(Boolean);
  if (matches.length === 0)
    return null;
  return matches.find((match) => match === repoRelativePath) ?? matches.find((match) => match.toLowerCase() === repoRelativePath.toLowerCase()) ?? (matches.length === 1 ? matches[0] : null);
}
function verificationFileExists(baseRoot, filePath) {
  if (!filePath || filePath === ".")
    return false;
  const root = path.resolve(baseRoot);
  const candidate = path.resolve(root, filePath);
  return isWithin(root, candidate) && existsSync(candidate);
}
async function normalizeVerificationFiles(args) {
  const cwd = path.resolve(args.cwd);
  const gitRoot = await resolveGitTopLevel(cwd);
  const root = gitRoot ?? cwd;
  const rootReal = safeRealpath(root) ?? root;
  const warnings = [];
  const normalized = [];
  let trackedPaths;
  for (const raw of args.files) {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      warnings.push("Skipped blank verification path.");
      continue;
    }
    if (value === ".") {
      warnings.push('Skipped verification path "." (repo/project root is not a file).');
      continue;
    }
    const candidate = path.resolve(cwd, value);
    const candidateReal = safeRealpath(candidate);
    if (candidateReal && !isWithin(rootReal, candidateReal)) {
      warnings.push(`Skipped verification path "${value}" because it resolves outside the project.`);
      continue;
    }
    if (!candidateReal && !isWithin(path.resolve(root), candidate)) {
      warnings.push(`Skipped verification path "${value}" because it escapes the project.`);
      continue;
    }
    if (path.resolve(root) === candidate) {
      warnings.push(`Skipped verification path "${value}" because it is the repo/project root.`);
      continue;
    }
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory()) {
          warnings.push(`Skipped verification path "${value}" because it is a directory.`);
          continue;
        }
      } catch {
        warnings.push(`Skipped verification path "${value}" because it could not be inspected.`);
        continue;
      }
    }
    if (gitRoot) {
      const repoRelative = toPosixPath(path.relative(gitRoot, candidateReal ?? candidate));
      if (!repoRelative || repoRelative === "." || repoRelative.startsWith("../")) {
        warnings.push(`Skipped verification path "${value}" because it is not inside the git repo.`);
        continue;
      }
      if (!trackedPaths) {
        let trackedOutput = null;
        try {
          trackedOutput = await runGit(gitRoot, ["ls-files", "-z", "--full-name"]);
        } catch {}
        trackedPaths = new Set(trackedOutput?.split("\x00").filter(Boolean) ?? []);
      }
      const tracked = trackedPaths.has(repoRelative) ? repoRelative : await gitTrackedPath(gitRoot, repoRelative);
      if (!tracked) {
        warnings.push(`Skipped verification path "${value}" because it is not a tracked git file.`);
        continue;
      }
      if (candidateReal && tracked !== repoRelative) {
        const realRelative = toPosixPath(path.relative(gitRoot, candidateReal));
        if (realRelative !== tracked) {
          warnings.push(`Skipped verification path "${value}" because it is not a tracked git file.`);
          continue;
        }
      }
      normalized.push(tracked);
    } else {
      if (!existsSync(candidate)) {
        warnings.push(`Skipped verification path "${value}" because it does not exist.`);
        continue;
      }
      const projectRelative = toPosixPath(path.relative(cwd, candidate));
      if (!projectRelative || projectRelative === "." || projectRelative.startsWith("../")) {
        warnings.push(`Skipped verification path "${value}" because it is not inside the project.`);
        continue;
      }
      normalized.push(projectRelative);
    }
  }
  return {
    files: Array.from(new Set(normalized)).sort(),
    warnings,
    gitRoot
  };
}
// ../plugin/src/features/magic-context/git-commits/git-log-reader.ts
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";
var execFileAsync2 = promisify2(execFile2);
var GIT_TIMEOUT_MS2 = 1e4;
var DEFAULT_MAX_COMMITS = 5000;
var RECORD_SEPARATOR = "\x1E";
var FIELD_SEPARATOR = "\x1F";
var FULL_OBJECT_NAME = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
function classifyGitLogFailure(message) {
  if (message.includes("not a git repository"))
    return "not_a_repo";
  if (message.includes("unknown revision or path not in the working tree") || message.includes("does not have any commits yet") || message.includes("bad revision")) {
    return "no_head";
  }
  return "transient";
}
async function readGitCommitsResult(directory, options = {}) {
  const revision = options.branch ?? "HEAD";
  if (revision.startsWith("-")) {
    throw new Error(`readGitCommits: refusing revision that looks like an option: "${revision}"`);
  }
  const projectLabel = options.projectIdentity ?? "<project>";
  const exclusion = options.excludeReachableFrom && FULL_OBJECT_NAME.test(options.excludeReachableFrom) ? options.excludeReachableFrom : null;
  const args = [
    "log",
    revision,
    ...exclusion ? [`^${exclusion}`] : [],
    "--no-merges",
    `--max-count=${options.maxCommits ?? DEFAULT_MAX_COMMITS}`,
    `--format=%H${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%ct${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`
  ];
  if (options.sinceMs !== undefined && options.sinceMs > 0) {
    const iso = new Date(options.sinceMs).toISOString();
    args.push(`--since=${iso}`);
  }
  args.push("--");
  let stdout;
  try {
    const result = await execFileAsync2("git", args, {
      windowsHide: true,
      cwd: directory,
      timeout: GIT_TIMEOUT_MS2,
      maxBuffer: 32 * 1024 * 1024,
      encoding: "utf8"
    });
    stdout = result.stdout;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (exclusion && message.includes("bad object")) {
      log2(`[git-commits] indexed tip ${exclusion.slice(0, 7)} is missing for ${projectLabel}; reading the full window`);
      return readGitCommitsResult(directory, { ...options, excludeReachableFrom: undefined });
    }
    const failure = classifyGitLogFailure(message);
    if (failure === "transient") {
      log2(`[git-commits] readGitCommits failed for ${projectLabel}: ${message.slice(0, 500)}`);
    } else {
      log2(`[git-commits] ${projectLabel} is not indexable (${failure})`);
    }
    return { commits: [], failure };
  }
  if (stdout.trim().length === 0) {
    log2(`[git-commits] readGitCommits returned empty stdout for ${projectLabel} (sinceMs=${options.sinceMs ?? "none"} args=${args.slice(0, 4).join(" ")})`);
  }
  return { commits: parseGitLogOutput(stdout), failure: null };
}
function parseGitLogOutput(stdout) {
  const commits = [];
  const records = stdout.split(RECORD_SEPARATOR);
  for (const rawRecord of records) {
    const record = rawRecord.replace(/^\s+/, "");
    if (!record)
      continue;
    const fields = [];
    let remaining = record;
    for (let i = 0;i < 4; i++) {
      const idx = remaining.indexOf(FIELD_SEPARATOR);
      if (idx < 0)
        break;
      fields.push(remaining.slice(0, idx));
      remaining = remaining.slice(idx + FIELD_SEPARATOR.length);
    }
    fields.push(remaining);
    if (fields.length < 5)
      continue;
    const sha = fields[0].trim();
    const subject = fields[1].trim();
    const author = fields[2].trim();
    const timeSec = Number.parseInt(fields[3].trim(), 10);
    const body = fields[4].trim();
    if (!FULL_OBJECT_NAME.test(sha) || !Number.isFinite(timeSec) || timeSec <= 0) {
      continue;
    }
    const message = body.length > 0 ? `${subject}

${body}` : subject;
    commits.push({
      sha,
      shortSha: sha.slice(0, 7),
      message,
      author: author.length > 0 ? author : null,
      committedAtMs: timeSec * 1000
    });
  }
  return commits;
}
// ../plugin/src/features/magic-context/git-commits/indexer.ts
var MS_PER_DAY = 24 * 60 * 60 * 1000;
var EMBED_BATCH_SIZE = 16;
var EMBED_MAX_PER_SWEEP = 500;
var EMBED_SWEEP_MAX_WALL_CLOCK_MS = 5 * 60 * 1000;
var indexInProgress = new Set;
var embedInProgress = new Set;
async function indexCommitsForProject(db, projectPath, directory, options) {
  const result = {
    scanned: 0,
    inserted: 0,
    updated: 0,
    evicted: 0,
    embedded: 0,
    nonIndexable: false
  };
  if (projectPath.startsWith("dir:")) {
    result.nonIndexable = true;
    return result;
  }
  if (indexInProgress.has(projectPath)) {
    log2(`[git-commits] index already in progress for ${projectPath}, skipping`);
    return result;
  }
  indexInProgress.add(projectPath);
  try {
    const latestIndexed = getLatestIndexedCommitSha(db, projectPath);
    const sinceMs = Date.now() - options.sinceDays * MS_PER_DAY;
    const read = await readGitCommitsResult(directory, {
      sinceMs,
      maxCommits: options.maxCommits,
      projectIdentity: projectPath,
      excludeReachableFrom: latestIndexed ?? undefined
    });
    const commits = read.commits;
    result.scanned = commits.length;
    if (read.failure === "not_a_repo" || read.failure === "no_head") {
      result.nonIndexable = true;
      return result;
    }
    if (commits.length === 0) {
      if (!options.skipRetention) {
        result.evicted = enforceProjectCap(db, projectPath, options.maxCommits);
      }
      log2(`[git-commits] no new commits for ${projectPath} (sinceMs=${sinceMs} latestIndexed=${latestIndexed?.slice(0, 7) ?? "none"} evicted=${result.evicted})`);
      return result;
    }
    log2(`[git-commits] read ${commits.length} commits for ${projectPath} (sinceMs=${sinceMs} latestIndexed=${latestIndexed?.slice(0, 7) ?? "none"})`);
    const upsert = upsertCommits(db, projectPath, commits);
    result.inserted = upsert.inserted;
    result.updated = upsert.updated;
    if (!options.skipRetention) {
      result.evicted = enforceProjectCap(db, projectPath, options.maxCommits);
    }
    const snapshot = getProjectEmbeddingSnapshot2(projectPath);
    if (options.skipEmbed || !snapshot?.gitCommitEnabled) {
      log2(`[git-commits] indexed ${projectPath}: scanned=${result.scanned} inserted=${result.inserted} updated=${result.updated} evicted=${result.evicted} embedded=0 (embedding skipped: skipEmbed=${options.skipEmbed === true} gitCommitEnabled=${snapshot?.gitCommitEnabled === true})`);
      return result;
    }
    result.embedded = await embedUnembeddedCommits(db, projectPath);
    log2(`[git-commits] indexed ${projectPath}: scanned=${result.scanned} inserted=${result.inserted} updated=${result.updated} evicted=${result.evicted} embedded=${result.embedded}`);
    return result;
  } finally {
    indexInProgress.delete(projectPath);
  }
}
async function embedUnembeddedCommits(db, projectPath) {
  if (embedInProgress.has(projectPath)) {
    return 0;
  }
  const snapshot = getProjectEmbeddingSnapshot2(projectPath);
  if (!snapshot?.gitCommitEnabled) {
    return 0;
  }
  embedInProgress.add(projectPath);
  const startedAt = Date.now();
  const deadline = startedAt + EMBED_SWEEP_MAX_WALL_CLOCK_MS;
  const signal = AbortSignal.timeout(EMBED_SWEEP_MAX_WALL_CLOCK_MS);
  let total = 0;
  try {
    while (Date.now() < deadline && total < EMBED_MAX_PER_SWEEP) {
      const rows = loadUnembeddedCommits(db, projectPath, snapshot.modelId, EMBED_BATCH_SIZE);
      if (rows.length === 0)
        break;
      let embeddedThisBatch = 0;
      try {
        const result = await embedItemsForProject2(projectPath, rows.map((row) => ({
          id: `commit:${row.sha}`,
          text: row.message,
          contentSha256: contentSha2562(row.message)
        })), signal, db, projectPath);
        if (!result)
          break;
        db.transaction(() => {
          for (const row of rows) {
            const embedding = result.vectors.get(`commit:${row.sha}`);
            if (!embedding)
              continue;
            saveCommitEmbedding(db, row.sha, embedding, result.modelId);
            embeddedThisBatch += 1;
          }
        }).immediate();
        enqueueShadowEmbeddingItems2(projectPath, "commit", rows.filter((row) => result.vectors.has(`commit:${row.sha}`)).map((row) => row.sha));
      } catch (error) {
        log2(`[git-commits] embed batch failed for ${projectPath}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
      if (embeddedThisBatch === 0)
        break;
      total += embeddedThisBatch;
      if (embeddedThisBatch < rows.length)
        break;
    }
    if (total > 0) {
      const totalEmbedded = countEmbeddedCommits(db, projectPath, snapshot.modelId);
      log2(`[git-commits] embedded ${total} commits for ${projectPath} (total embedded: ${totalEmbedded})`);
    }
    return total;
  } finally {
    embedInProgress.delete(projectPath);
  }
}
// ../plugin/src/features/magic-context/git-commits/search-git-commits.ts
var ftsStatements = new WeakMap;
var datedFtsStatements = new WeakMap;
var ftsPlainStatements = new WeakMap;
var datedFtsPlainStatements = new WeakMap;
var getBySHAsStatements = new WeakMap;
var datedGetBySHAsStatements = new WeakMap;
var embeddingCache = new WeakMap;
function getSearchEmbeddings(db, projectPath, modelId) {
  if (!isKnownAutocommit(db)) {
    embeddingCache.delete(db);
    return loadProjectCommitEmbeddings(db, projectPath, modelId);
  }
  let cache = embeddingCache.get(db);
  if (!cache) {
    cache = {
      revisionStatement: db.prepare(`SELECT total_changes() AS writes,
                (SELECT data_version FROM pragma_data_version) AS dataVersion,
                (SELECT schema_version FROM pragma_schema_version) AS schemaVersion`),
      revision: "",
      entries: new Map
    };
    embeddingCache.set(db, cache);
  }
  const revision = JSON.stringify(cache.revisionStatement.get());
  if (revision !== cache.revision) {
    cache.entries.clear();
    cache.revision = revision;
  }
  const key = JSON.stringify([projectPath, modelId]);
  const cached = cache.entries.get(key);
  if (cached) {
    cache.entries.delete(key);
    cache.entries.set(key, cached);
    return cached;
  }
  const vectors = loadProjectCommitEmbeddings(db, projectPath, modelId);
  const size = (entries) => [...entries.values()].reduce((sum, vector) => sum + vector.byteLength, 0);
  if (size(vectors) <= 32 * 1024 * 1024)
    cache.entries.set(key, vectors);
  while (cache.entries.size > 16 || [...cache.entries.values()].reduce((sum, entry) => sum + size(entry), 0) > 32 * 1024 * 1024) {
    const oldest = cache.entries.keys().next().value;
    if (oldest === undefined)
      break;
    cache.entries.delete(oldest);
  }
  return vectors;
}
function rowToCommit(row) {
  return {
    sha: row.sha,
    shortSha: row.short_sha,
    projectPath: row.project_path,
    message: row.message,
    author: row.author,
    committedAtMs: row.committed_at,
    indexedAtMs: row.indexed_at
  };
}
function getFtsStatement(db, dated = false) {
  const statements = dated ? datedFtsStatements : ftsStatements;
  let stmt = statements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT c.sha AS sha, c.project_path AS project_path, c.short_sha AS short_sha,
                    c.message AS message, c.author AS author,
                    c.committed_at AS committed_at, c.indexed_at AS indexed_at
             FROM git_commits_fts
             INNER JOIN git_commits c ON c.sha = git_commits_fts.sha
             WHERE c.project_path = ?
               ${dated ? "AND c.committed_at BETWEEN ? AND ?" : ""}
               AND git_commits_fts MATCH ?
             ORDER BY bm25(git_commits_fts) LIMIT ?`);
    statements.set(db, stmt);
  }
  return stmt;
}
function escapeLikePattern(text) {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}
function getLikeFallbackStatement(db, dated = false) {
  const statements = dated ? datedFtsPlainStatements : ftsPlainStatements;
  let stmt = statements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT sha, project_path, short_sha, message, author, committed_at, indexed_at
             FROM git_commits
             WHERE project_path = ?
               ${dated ? "AND committed_at BETWEEN ? AND ?" : ""}
               AND lower(message) LIKE '%' || lower(?) || '%' ESCAPE '\\'
             ORDER BY committed_at DESC LIMIT ?`);
    statements.set(db, stmt);
  }
  return stmt;
}
function getBySHAsStatement(db, dated = false) {
  const statements = dated ? datedGetBySHAsStatements : getBySHAsStatements;
  let stmt = statements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT sha, project_path, short_sha, message, author, committed_at, indexed_at
               FROM git_commits
               WHERE project_path = ?
                 ${dated ? "AND committed_at BETWEEN ? AND ?" : ""}
                 AND sha IN (SELECT value FROM json_each(?))`);
    statements.set(db, stmt);
  }
  return stmt;
}
function clamp01(value) {
  if (!Number.isFinite(value))
    return 0;
  return Math.min(1, Math.max(0, value));
}
function searchGitCommitsSync(db, projectPath, query, options) {
  const trimmed = query.trim();
  if (trimmed.length === 0 || options.limit <= 0)
    return [];
  const semanticWeight = options.semanticWeight ?? 0.7;
  const ftsWeight = options.ftsWeight ?? 0.3;
  const singleSourcePenalty = options.singleSourcePenalty ?? 0.8;
  const fetchLimit = Math.max(options.limit * 3, 30);
  const dated = options.from !== undefined || options.to !== undefined;
  const from = options.from ?? Number.MIN_SAFE_INTEGER;
  const to = options.to ?? Number.MAX_SAFE_INTEGER;
  const ftsCandidates = [];
  const sanitized = sanitizeFtsQuery(trimmed);
  if (sanitized.length > 0) {
    try {
      for (const row of getFtsStatement(db, dated).all(projectPath, ...dated ? [from, to] : [], sanitized, fetchLimit)) {
        ftsCandidates.push(rowToCommit(row));
      }
    } catch (error) {
      log2(`[git-commits] FTS query failed for "${trimmed}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (ftsCandidates.length === 0) {
    for (const row of getLikeFallbackStatement(db, dated).all(projectPath, ...dated ? [from, to] : [], escapeLikePattern(trimmed), fetchLimit)) {
      ftsCandidates.push(rowToCommit(row));
    }
  }
  const ftsScores = new Map;
  ftsCandidates.forEach((commit, rank) => {
    ftsScores.set(commit.sha, 1 / (rank + 1));
  });
  const semanticScores = new Map;
  if (options.queryEmbedding && options.queryModelId && options.queryModelId !== "off") {
    const embeddings = getSearchEmbeddings(db, projectPath, options.queryModelId);
    for (const [sha, embedding] of embeddings.entries()) {
      const similarity = clamp01(cosineSimilarity(options.queryEmbedding, embedding));
      if (similarity > 0) {
        semanticScores.set(sha, similarity);
      }
    }
  }
  const bySha = new Map;
  for (const commit of ftsCandidates)
    bySha.set(commit.sha, commit);
  const semanticOnlyShas = [...semanticScores.keys()].filter((sha) => !bySha.has(sha));
  if (semanticOnlyShas.length > 0) {
    const rows = getBySHAsStatement(db, dated).all(projectPath, ...dated ? [from, to] : [], JSON.stringify(semanticOnlyShas));
    for (const row of rows)
      bySha.set(row.sha, rowToCommit(row));
  }
  if (options.captureLanes) {
    const fts = [...bySha.values()].filter((commit) => ftsScores.has(commit.sha)).map((commit) => ({
      commit,
      matchType: "fts",
      score: (ftsScores.get(commit.sha) ?? 0) * singleSourcePenalty
    })).sort((a, b) => b.score - a.score || b.commit.committedAtMs - a.commit.committedAtMs).slice(0, 25);
    const vector = [...bySha.values()].filter((commit) => (semanticScores.get(commit.sha) ?? 0) > 0).map((commit) => ({
      commit,
      matchType: "semantic",
      score: semanticScores.get(commit.sha) ?? 0
    })).sort((a, b) => b.score - a.score || b.commit.committedAtMs - a.commit.committedAtMs).slice(0, 25);
    options.captureLanes(fts, vector);
  }
  const results = [];
  for (const [sha, commit] of bySha.entries()) {
    const sem = semanticScores.get(sha);
    const fts = ftsScores.get(sha);
    let score = 0;
    let matchType = "fts";
    if (sem !== undefined && fts !== undefined) {
      score = semanticWeight * sem + ftsWeight * fts;
      matchType = "hybrid";
    } else if (sem !== undefined) {
      score = sem * singleSourcePenalty;
      matchType = "semantic";
    } else if (fts !== undefined) {
      score = fts * singleSourcePenalty;
      matchType = "fts";
    }
    if (score <= 0)
      continue;
    results.push({ commit, score, matchType });
  }
  results.sort((left, right) => {
    if (right.score !== left.score)
      return right.score - left.score;
    return right.commit.committedAtMs - left.commit.committedAtMs;
  });
  return results.slice(0, options.limit);
}
// ../plugin/src/features/magic-context/message-index-async.ts
var indexCancellations = new Map;
var sessionEpochs = new Map;
var rebuildingSessions = new Set;
function getMessageIndexEpoch(sessionId) {
  return sessionEpochs.get(sessionId) ?? 0;
}
function isMessageIndexSearchable(sessionId) {
  return !rebuildingSessions.has(sessionId);
}
var workerMeasurements = new WeakMap;
function isDatabaseLockedError(error) {
  if (!error || typeof error !== "object")
    return false;
  const e = error;
  if (typeof e.code === "string") {
    if (e.code === "SQLITE_BUSY" || e.code === "SQLITE_LOCKED")
      return true;
  }
  if (typeof e.message === "string") {
    if (/database is locked/i.test(e.message))
      return true;
    if (/sqlite_(busy|locked)/i.test(e.message))
      return true;
  }
  return false;
}
var INCREMENTAL_DEBOUNCE_MS = 100;
var RECONCILIATION_BATCH_SIZE = 100;

class MagicContextMessageIndexHeapHolder {
  reconciledSessions = new Set;
  reconciledSnapshots = new Map;
  stalledSessions = new Set;
  reconciliationScheduledSessions = new Set;
  clearAndReindexScheduledSessions = new Map;
  sessionLocks = new Map;
  incrementalTimers = new Map;
  pendingIncrementalKeys = new Set;
  completedIncrementalKeys = new Set;
  activeReconcilerBuffers = new Map;
}
var heapHolder = new MagicContextMessageIndexHeapHolder;
function clearCompletedIncrementalKeys(sessionId) {
  const prefix = `${sessionId}\x00`;
  for (const key of heapHolder.completedIncrementalKeys) {
    if (key.startsWith(prefix))
      heapHolder.completedIncrementalKeys.delete(key);
  }
}
var PREPARE_RETRY_MS = 60000;
async function sourceReady(source, sessionId) {
  const prepare = source?.prepare;
  return typeof prepare === "function" ? prepare(sessionId) : true;
}
function defer(fn) {
  const immediate = globalThis.setImmediate;
  if (typeof immediate === "function") {
    inRootAsyncContext2(() => immediate(fn));
    return;
  }
  inRootAsyncContext2(() => setTimeout(fn, 0));
}
function yieldToEventLoop() {
  return new Promise((resolve) => defer(resolve));
}
function runWithSessionLock(sessionId, operation) {
  const previous = heapHolder.sessionLocks.get(sessionId) ?? Promise.resolve();
  const run = previous.catch(() => {
    return;
  }).then(async () => {
    await operation();
  });
  heapHolder.sessionLocks.set(sessionId, run);
  run.finally(() => {
    if (heapHolder.sessionLocks.get(sessionId) === run) {
      heapHolder.sessionLocks.delete(sessionId);
    }
  }).catch(() => {
    return;
  });
  return run;
}
function logIndexingError(sessionId, action, error) {
  if (isDatabaseLockedError(error)) {
    sessionLog2(sessionId, `message FTS async ${action} skipped (database busy; will retry on next reconciliation)`);
    return;
  }
  sessionLog2(sessionId, `message FTS async ${action} failed: ${error instanceof Error ? error.message : String(error)}`);
  log2(`[message-index-async] ${action} failed for ${sessionId}:`, error);
}
function logReconciliationStall(sessionId, reason) {
  if (heapHolder.stalledSessions.has(sessionId))
    return;
  heapHolder.stalledSessions.add(sessionId);
  sessionLog2(sessionId, `message FTS reconciliation stalled: ${reason}; will retry`);
}
async function reconcileSessionIndex(db, sessionId, readMessages, epoch = getMessageIndexEpoch(sessionId)) {
  if (!await sourceReady(readMessages, sessionId)) {
    logReconciliationStall(sessionId, "raw message reader is not ready");
    return false;
  }
  await runWithSessionLock(sessionId, async () => {
    if (getMessageIndexEpoch(sessionId) !== epoch)
      return;
    if (!readMessages.getRevision && heapHolder.reconciledSessions.has(sessionId))
      return;
    let fallbackSnapshot = null;
    try {
      const fullReader = typeof readMessages === "function" ? readMessages : null;
      const revision = readMessages.getRevision?.(sessionId);
      const previous = heapHolder.reconciledSnapshots.get(sessionId);
      const finalWatermark = previous && revision === previous.revision ? previous.count : revision !== undefined && readMessages.getCountAfterRevision ? previous && revision > previous.revision ? previous.count + readMessages.getCountAfterRevision(sessionId, previous.revision, revision) : readMessages.getCountAfterRevision(sessionId, -1, revision) : readMessages.getCount ? readMessages.getCount(sessionId) : (fallbackSnapshot = fullReader?.(sessionId) ?? []).length;
      let cursor = getMessageIndexReconciliationStartOrdinal(db, sessionId);
      let after = cursor === previous?.count ? previous.after : undefined;
      while (cursor < finalWatermark) {
        if (getMessageIndexEpoch(sessionId) !== epoch)
          return;
        const pageEnd = Math.min(finalWatermark, cursor + RECONCILIATION_BATCH_SIZE);
        const messages = readMessages.readPage ? readMessages.readPage(sessionId, cursor, RECONCILIATION_BATCH_SIZE, finalWatermark, after) : (fallbackSnapshot ?? []).filter((message) => message.ordinal > cursor && message.ordinal <= pageEnd);
        const retainedMessages = fallbackSnapshot ?? messages;
        heapHolder.activeReconcilerBuffers.set(sessionId, retainedMessages);
        if (getMessageIndexEpoch(sessionId) !== epoch)
          return;
        withSqliteBackgroundWriter2(() => indexMessagesAfterOrdinal(db, sessionId, messages, cursor, pageEnd));
        const nextCursor = getMessageIndexReconciliationStartOrdinal(db, sessionId);
        if (nextCursor <= cursor)
          break;
        cursor = nextCursor;
        const last = messages.at(-1);
        after = last?.ordinal === cursor && typeof last.createdAt === "number" ? { timeCreated: last.createdAt, id: last.id } : undefined;
        if (cursor < finalWatermark) {
          await yieldToEventLoop();
        }
      }
      if (getMessageIndexEpoch(sessionId) !== epoch)
        return;
      if (isMessageIndexReconciledThrough(db, sessionId, finalWatermark)) {
        heapHolder.reconciledSessions.add(sessionId);
        rebuildingSessions.delete(sessionId);
        if (revision !== undefined) {
          if (!after && finalWatermark > 0 && readMessages.readPage) {
            const last = readMessages.readPage(sessionId, finalWatermark - 1, 1, finalWatermark).at(-1);
            if (last?.ordinal === finalWatermark && typeof last.createdAt === "number")
              after = { timeCreated: last.createdAt, id: last.id };
          }
          heapHolder.reconciledSnapshots.set(sessionId, {
            revision,
            count: finalWatermark,
            after
          });
        }
      } else {
        logReconciliationStall(sessionId, `gap after ordinal ${cursor} (store count ${finalWatermark})`);
      }
    } finally {
      heapHolder.activeReconcilerBuffers.delete(sessionId);
    }
  });
  return true;
}
function scheduleReconciliation(db, sessionId, readMessages) {
  if (rebuildingSessions.has(sessionId)) {
    if (!heapHolder.clearAndReindexScheduledSessions.has(sessionId))
      scheduleClearAndReindex(db, sessionId, readMessages);
    return;
  }
  const epoch = getMessageIndexEpoch(sessionId);
  if (!readMessages.getRevision && heapHolder.reconciledSessions.has(sessionId) || heapHolder.reconciliationScheduledSessions.has(sessionId)) {
    return;
  }
  heapHolder.reconciliationScheduledSessions.add(sessionId);
  scheduleAfterBootQuiet(() => {
    defer(() => {
      let appendedDuringReconciliation = false;
      const previousSnapshot = heapHolder.reconciledSnapshots.get(sessionId);
      if (getMessageIndexEpoch(sessionId) !== epoch)
        return;
      reconcileSessionIndex(db, sessionId, readMessages, epoch).then((ran) => {
        if (getMessageIndexEpoch(sessionId) !== epoch)
          return;
        if (ran) {
          const snapshot = heapHolder.reconciledSnapshots.get(sessionId);
          appendedDuringReconciliation = snapshot !== undefined && snapshot !== previousSnapshot && readMessages.getRevision !== undefined && readMessages.getRevision(sessionId) !== snapshot.revision;
          return;
        }
        inRootAsyncContext2(() => setTimeout(() => {
          if (getMessageIndexEpoch(sessionId) !== epoch)
            return;
          heapHolder.reconciliationScheduledSessions.delete(sessionId);
          scheduleReconciliation(db, sessionId, readMessages);
        }, PREPARE_RETRY_MS)).unref?.();
      }).catch((error) => {
        if (getMessageIndexEpoch(sessionId) !== epoch)
          return;
        logReconciliationStall(sessionId, error instanceof Error ? error.message : String(error));
        if (isDatabaseLockedError(error))
          inRootAsyncContext2(() => setTimeout(() => {
            if (getMessageIndexEpoch(sessionId) === epoch)
              scheduleReconciliation(db, sessionId, readMessages);
          }, 1000)).unref();
      }).finally(() => {
        if (getMessageIndexEpoch(sessionId) !== epoch)
          return;
        heapHolder.reconciliationScheduledSessions.delete(sessionId);
        if (appendedDuringReconciliation)
          scheduleReconciliation(db, sessionId, readMessages);
      });
    });
  });
}
function scheduleIncrementalIndex(db, sessionId, messageId, messageSource) {
  const schedulingKey = `${sessionId}\x00${messageId}`;
  const epoch = sessionEpochs.get(sessionId) ?? 0;
  if (heapHolder.pendingIncrementalKeys.has(schedulingKey))
    return;
  const activeTimer = heapHolder.incrementalTimers.get(schedulingKey);
  if (activeTimer)
    clearTimeout(activeTimer);
  const timer = inRootAsyncContext2(() => setTimeout(() => {
    heapHolder.incrementalTimers.delete(schedulingKey);
    heapHolder.pendingIncrementalKeys.add(schedulingKey);
    const indexMessage = async () => {
      if ((sessionEpochs.get(sessionId) ?? 0) !== epoch || !heapHolder.pendingIncrementalKeys.has(schedulingKey))
        return;
      const message = typeof messageSource === "function" ? messageSource(sessionId, messageId) : messageSource;
      if (!message)
        return;
      const revisionKey = `${schedulingKey}\x00${getMessageIndexSourceIdentity(message)}`;
      if (heapHolder.completedIncrementalKeys.has(revisionKey))
        return;
      const currentWatermark = getLastIndexedOrdinal(db, sessionId);
      if (message.ordinal <= currentWatermark && isMessageIndexSourceCurrent(db, sessionId, message)) {
        heapHolder.completedIncrementalKeys.add(revisionKey);
        return;
      }
      const wasReconciled = heapHolder.reconciledSessions.delete(sessionId);
      await indexSingleMessageOffThread(db, sessionId, message);
      if ((sessionEpochs.get(sessionId) ?? 0) !== epoch || !heapHolder.pendingIncrementalKeys.has(schedulingKey))
        return;
      const finalWatermark = getLastIndexedOrdinal(db, sessionId);
      if (wasReconciled && isMessageIndexReconciledThrough(db, sessionId, finalWatermark)) {
        heapHolder.reconciledSessions.add(sessionId);
      }
      heapHolder.completedIncrementalKeys.add(revisionKey);
    };
    sourceReady(messageSource, sessionId).then((ready) => {
      if ((sessionEpochs.get(sessionId) ?? 0) !== epoch)
        return;
      if (ready)
        return runWithSessionLock(sessionId, indexMessage);
      setTimeout(() => {
        if (getMessageIndexEpoch(sessionId) === epoch)
          scheduleIncrementalIndex(db, sessionId, messageId, messageSource);
      }, PREPARE_RETRY_MS).unref?.();
    }).catch((error) => {
      if ((sessionEpochs.get(sessionId) ?? 0) !== epoch)
        return;
      heapHolder.reconciledSessions.delete(sessionId);
      logIndexingError(sessionId, `incremental index for ${messageId}`, error);
      if (isDatabaseLockedError(error))
        setTimeout(() => {
          if (getMessageIndexEpoch(sessionId) === epoch)
            scheduleIncrementalIndex(db, sessionId, messageId, messageSource);
        }, 1000).unref();
    }).finally(() => {
      if ((sessionEpochs.get(sessionId) ?? 0) === epoch)
        heapHolder.pendingIncrementalKeys.delete(schedulingKey);
    });
  }, INCREMENTAL_DEBOUNCE_MS));
  heapHolder.incrementalTimers.set(schedulingKey, timer);
}
async function indexSingleMessageOffThread(db, sessionId, message) {
  const path = getSqliteDatabasePath2(db);
  if (!path)
    return withSqliteBackgroundWriter2(() => indexSingleMessage(db, sessionId, message));
  const cancellation = new Int32Array(new SharedArrayBuffer(4));
  const active = indexCancellations.get(sessionId) ?? new Set;
  active.add(cancellation);
  indexCancellations.set(sessionId, active);
  const result = await runSessionWarmupWorker({
    path,
    sessionId,
    indexMessage: message,
    harness: getHarness2(),
    indexCancellation: cancellation.buffer,
    ...indexCoordinationInput2()
  }, {}).finally(() => {
    active.delete(cancellation);
    if (active.size === 0)
      indexCancellations.delete(sessionId);
  });
  if (!("inserted" in result))
    throw new Error("failure" in result ? result.detail : "unexpected indexing worker reply");
  if (result.measurements) {
    const sessions = workerMeasurements.get(db) ?? new Map;
    sessions.set(sessionId, result.measurements);
    workerMeasurements.set(db, sessions);
    if (result.measurements.skipped)
      log2(`[magic-context] incremental FTS skipped oversized source ${message.id} (${result.measurements.sourceBytes} bytes); identity and progress persisted`);
  }
  return result.inserted;
}
function scheduleClearAndReindex(db, sessionId, readMessages) {
  rebuildingSessions.add(sessionId);
  invalidateIncrementalWork(sessionId);
  heapHolder.reconciledSessions.delete(sessionId);
  heapHolder.reconciledSnapshots.delete(sessionId);
  heapHolder.reconciliationScheduledSessions.add(sessionId);
  clearCompletedIncrementalKeys(sessionId);
  const existing = heapHolder.clearAndReindexScheduledSessions.get(sessionId);
  if (existing) {
    existing.source = readMessages;
    return;
  }
  const pending = { source: readMessages };
  heapHolder.clearAndReindexScheduledSessions.set(sessionId, pending);
  scheduleAfterBootQuiet(() => {
    defer(() => {
      let cleared = false;
      let ownsSchedule = false;
      let epoch = getMessageIndexEpoch(sessionId);
      runWithSessionLock(sessionId, () => {
        if (heapHolder.clearAndReindexScheduledSessions.get(sessionId) !== pending)
          return;
        ownsSchedule = true;
        epoch = getMessageIndexEpoch(sessionId);
        heapHolder.clearAndReindexScheduledSessions.delete(sessionId);
        heapHolder.reconciledSessions.delete(sessionId);
        heapHolder.reconciledSnapshots.delete(sessionId);
        clearCompletedIncrementalKeys(sessionId);
        clearIndexedMessages(db, sessionId);
        cleared = true;
      }).then(() => cleared && getMessageIndexEpoch(sessionId) === epoch ? reconcileSessionIndex(db, sessionId, pending.source, epoch) : undefined).catch((error) => {
        if (getMessageIndexEpoch(sessionId) !== epoch)
          return;
        heapHolder.reconciledSessions.delete(sessionId);
        if (heapHolder.clearAndReindexScheduledSessions.get(sessionId) === pending)
          heapHolder.clearAndReindexScheduledSessions.delete(sessionId);
        logIndexingError(sessionId, "clear and reindex", error);
      }).finally(() => {
        if (ownsSchedule && getMessageIndexEpoch(sessionId) === epoch)
          heapHolder.reconciliationScheduledSessions.delete(sessionId);
      });
    });
  });
}
function clearSessionTracking(sessionId) {
  invalidateIncrementalWork(sessionId);
  heapHolder.clearAndReindexScheduledSessions.delete(sessionId);
  heapHolder.reconciledSessions.delete(sessionId);
  heapHolder.reconciledSnapshots.delete(sessionId);
  heapHolder.stalledSessions.delete(sessionId);
  heapHolder.reconciliationScheduledSessions.delete(sessionId);
  heapHolder.sessionLocks.delete(sessionId);
  heapHolder.activeReconcilerBuffers.delete(sessionId);
}
function invalidateIncrementalWork(sessionId) {
  sessionEpochs.set(sessionId, (sessionEpochs.get(sessionId) ?? 0) + 1);
  for (const cancellation of indexCancellations.get(sessionId) ?? [])
    Atomics.store(cancellation, 0, 1);
  const prefix = `${sessionId}\x00`;
  for (const [key, timer] of heapHolder.incrementalTimers) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer);
      heapHolder.incrementalTimers.delete(key);
    }
  }
  for (const key of heapHolder.pendingIncrementalKeys) {
    if (key.startsWith(prefix)) {
      heapHolder.pendingIncrementalKeys.delete(key);
    }
  }
  for (const key of heapHolder.completedIncrementalKeys) {
    if (key.startsWith(prefix))
      heapHolder.completedIncrementalKeys.delete(key);
  }
}

// ../plugin/src/features/magic-context/auto-search-diagnostics.ts
var memoryHintContent = new WeakMap;
function withMemoryHintContent(result, fullContent) {
  memoryHintContent.set(result, fullContent);
  return result;
}
function createAutoSearchDiagnostics(threshold) {
  return {
    threshold,
    lanes: {},
    pool: "unknown",
    poolRows: null,
    peek: "not-run",
    workerStarted: false
  };
}
function autoSearchRelevance(query, result) {
  const content = result.source === "memory" ? memoryHintContent.get(result) ?? result.content : result.source === "compartment" ? result.title : result.content;
  if (cleanSearchText(content).length === 0)
    return 0;
  return result.source === "message" || "matchType" in result && result.source !== "compartment" && result.matchType !== "semantic" ? hintKeywordRelevance(query, content) : result.score;
}
function recordAutoSearchLane(diagnostics, lane, query, results) {
  if (!diagnostics)
    return;
  const scores = results.map((result) => result.relevanceScore ?? autoSearchRelevance(query, result));
  diagnostics.lanes[lane] = {
    top: scores.length ? Math.max(...scores) : null,
    nearMisses: scores.filter((score) => score >= 0.5 && score < diagnostics.threshold).length
  };
}

// ../plugin/src/features/magic-context/literal-probes.ts
var MAX_PROBES = 5;
var MIN_PROBE_LENGTH = 3;
var SLASH_COMMAND_RE = /\/[a-z][a-z0-9]*(?:-[a-z0-9]+)+/gi;
var KEBAB_SNAKE_RE = /[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+/gi;
var DOTTED_RE = /[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)+/gi;
var CAMEL_RE = /\b[a-zA-Z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b/g;
var SHA_RE = /\b[0-9a-f]{7,40}\b/gi;
var ERROR_CODE_RE = /\b(?:TS\d{4,}|ERR_[A-Z][A-Z0-9_]*)\b/g;
var QUOTED_RE = /["`]([^"`]{3,80})["`]/g;
function looksLikeSha(token) {
  return /[0-9]/.test(token) && /^[0-9a-f]{7,40}$/i.test(token);
}
function extractLiteralProbes(query) {
  const trimmed = query.trim();
  if (trimmed.length === 0)
    return [];
  const ordered = [];
  const seen = new Set;
  const add = (raw) => {
    if (!raw)
      return;
    const probe = raw.trim();
    if (probe.length < MIN_PROBE_LENGTH)
      return;
    const key = probe.toLowerCase();
    if (seen.has(key))
      return;
    seen.add(key);
    ordered.push(probe);
  };
  for (const m of trimmed.matchAll(QUOTED_RE))
    add(m[1]);
  for (const m of trimmed.matchAll(SLASH_COMMAND_RE))
    add(m[0]);
  for (const m of trimmed.matchAll(ERROR_CODE_RE))
    add(m[0]);
  for (const m of trimmed.matchAll(DOTTED_RE))
    add(m[0]);
  for (const m of trimmed.matchAll(KEBAB_SNAKE_RE))
    add(m[0]);
  for (const m of trimmed.matchAll(CAMEL_RE))
    add(m[0]);
  for (const m of trimmed.matchAll(SHA_RE)) {
    if (looksLikeSha(m[0]))
      add(m[0]);
  }
  return ordered.slice(0, MAX_PROBES);
}
function containsProbeVerbatim(text, probes) {
  if (probes.length === 0)
    return false;
  const haystack = text.toLowerCase();
  return probes.some((probe) => haystack.includes(probe.toLowerCase()));
}

// ../plugin/src/features/magic-context/search-measurement.ts
import { createHash } from "node:crypto";
function resultId(result) {
  switch (result.source) {
    case "memory":
      return `memory:${result.memoryId}`;
    case "message":
      return `message:${result.messageId}`;
    case "compartment":
      return `chunk:${result.compartmentId}`;
    case "git_commit":
      return `commit:${result.sha}`;
    case "primer":
      return `primer:${result.primerId}`;
    case "note":
      return `note:${result.noteId}`;
  }
}
async function recordShadowMeasurement(args) {
  try {
    const shadowCohort = getShadowEmbeddingMeasurementCohort2(args.projectPath);
    if (!shadowCohort)
      return;
    const primaryCohort = getPrimaryEmbeddingMeasurementCohort2(args.projectPath);
    const shadowStartedAt = Date.now();
    let shadowFailed = false;
    let shadowResults = [];
    try {
      const vector = await embedShadowTextForProject2(args.projectPath, args.query);
      if (!vector) {
        shadowFailed = true;
      } else {
        shadowResults = await args.search(args.db, args.sessionId, args.projectPath, args.query, {
          ...args.options,
          embedQuery: async () => vector,
          isEmbeddingRuntimeEnabled: () => true,
          embeddingEnabled: true,
          embeddingModelIdOverride: shadowCohort.modelId,
          chunkModelIdOverride: shadowCohort.chunkModelId,
          measurementDisabled: true,
          countRetrievals: false
        });
      }
    } catch {
      shadowFailed = true;
    }
    const primaryModelId = args.primaryQuery?.modelId ?? primaryCohort?.modelId ?? "";
    const primaryFingerprint = primaryCohort?.fingerprint ?? "";
    const primaryEpoch = primaryCohort?.epoch ?? 0;
    const cohortKey = JSON.stringify({
      primaryFingerprint,
      primaryEpoch,
      shadowFingerprint: shadowCohort.fingerprint,
      shadowEpoch: shadowCohort.epoch
    });
    const primaryIds = args.primaryResults.map(resultId);
    const shadowIds = shadowResults.map(resultId);
    const corpusHash = sha256(JSON.stringify({ query: args.query, primaryIds, shadowIds }));
    recordEmbeddingMeasurement(args.db, {
      sessionId: args.sessionId,
      projectPath: args.projectPath,
      queryText: args.query,
      cohortKey,
      primaryResultIds: primaryIds,
      shadowResultIds: shadowIds,
      primaryLatencyMs: args.primaryLatencyMs,
      shadowLatencyMs: Date.now() - shadowStartedAt,
      primaryFailed: args.primaryQuery === null,
      shadowFailed,
      primaryModelId,
      shadowModelId: shadowCohort.modelId,
      primaryFingerprint,
      shadowFingerprint: shadowCohort.fingerprint,
      primaryEpoch,
      shadowEpoch: shadowCohort.epoch,
      corpusHash,
      coverage: {
        primaryResultCount: primaryIds.length,
        shadowResultCount: shadowIds.length,
        primaryAnswered: args.primaryQuery !== null,
        shadowAnswered: !shadowFailed
      }
    });
  } catch (error) {
    log2("[magic-context] shadow embedding measurement failed:", error);
  }
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// ../plugin/src/hooks/magic-context/module-transport.ts
import { join } from "node:path";

// ../plugin/src/hooks/magic-context/reply-pages.ts
var MAX_REPLY_BYTES = 128 * 1024 * 1024;
var MAX_PAGE_BYTES = 512 * 1024;

// ../plugin/src/hooks/magic-context/module-transport.ts
function getDefaultSubcConnectionFile() {
  return join(getDataDir(), "cortexkit", "run", "subc-connection.json");
}

// ../plugin/src/features/magic-context/search-rerank.ts
var RERANK_MODEL = "gte-reranker-modernbert-base-f32";
var RERANK_LANE_LIMIT = 25;
var DEADLINE_MS = 1500;
var SYNAPSE_RESTART_BACKOFF_MS = 30000;
var SYNAPSE_ABSENT_BACKOFF_MS = 10 * 60000;
var DOCUMENT_BYTES = 1024;
var proseWordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
function isProseQuery(query) {
  const text = query.trim();
  if (!text || /[\n;]|^["'`]|["'`]$/.test(text))
    return false;
  if (/^(?:error\b|cannot\b|failed\b|panic\b|traceback\b|assertion\b|SQLITE_|TypeError\b|ReferenceError\b|SyntaxError\b)/i.test(text))
    return false;
  if (/\b(?:[A-Z][A-Z_]+:|\w*(?:Error|Exception):)|\bat\s+\S+\s*\(/.test(text))
    return false;
  const words = /(?![a-zA-Z])\p{L}/u.test(text) ? [...proseWordSegmenter.segment(text)].filter((word) => word.isWordLike).map((word) => word.segment) : text.replace(/[?!.]$/, "").split(/\s+/);
  if (words.length < 3)
    return false;
  const plain = words.filter((word) => /^[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*$/u.test(word));
  if (/^(?:how|why|what|where|when|which|who)\b/i.test(text))
    return plain.length >= 3;
  return words.length >= 4 && plain.length >= 3 && !/[\\/]|::|=/.test(text);
}
function emptySearchLanes() {
  return {
    memory_fts: [],
    memory_vector: [],
    primer_fts: [],
    primer_vector: [],
    message_fts: [],
    chunk_vector: [],
    git_fts: [],
    git_vector: [],
    notes: []
  };
}
function searchResultKey(hit) {
  switch (hit.source) {
    case "memory":
      return `memory:${hit.memoryId}`;
    case "primer":
      return `primer:${hit.primerId}`;
    case "message":
      return `message:${hit.messageId}`;
    case "compartment":
      return `compartment:${hit.compartmentId}`;
    case "git_commit":
      return `git_commit:${hit.sha}`;
    case "note":
      return `note:${hit.noteId}`;
  }
}
function fuseSearchLanes(lanes) {
  const compartments = lanes.chunk_vector.filter((hit) => hit.source === "compartment");
  const fused = new Map;
  for (const [name, lane] of Object.entries(lanes)) {
    const seen = new Set;
    lane.slice(0, RERANK_LANE_LIMIT).forEach((original, index) => {
      const hit = name === "message_fts" && original.source === "message" ? compartments.find((chunk) => original.messageOrdinal >= chunk.startOrdinal && original.messageOrdinal <= chunk.endOrdinal) ?? original : original;
      const key = searchResultKey(hit);
      if (seen.has(key))
        return;
      seen.add(key);
      const prior = fused.get(key);
      const score = 1 / (60 + index + 1);
      if (prior)
        prior.score += score;
      else
        fused.set(key, { hit, score, order: fused.size });
    });
  }
  return [...fused.values()].sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 20).map((row) => row.hit);
}
function truncateUtf8(text, bytes) {
  const buffer = Buffer.from(text);
  let end = Math.min(buffer.length, bytes);
  while (end > 0 && end < buffer.length && (buffer[end] & 192) === 128)
    end--;
  return buffer.subarray(0, end).toString("utf8");
}
function candidateText(location, title, body) {
  const header = `${truncateUtf8(location.replaceAll(`
`, " "), 200)}
${truncateUtf8(title.replaceAll(`
`, " "), 120)}
`;
  return header + truncateUtf8(body, DOCUMENT_BYTES - Buffer.byteLength(header));
}

class RerankFailure extends Error {
  reason;
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
function unwrap(value) {
  if (!value || typeof value !== "object")
    throw new RerankFailure("validation");
  const outer = value;
  const body = outer.result ?? outer;
  if (!body || typeof body !== "object")
    throw new RerankFailure("validation");
  if (body.error) {
    const error = body.error;
    throw new RerankFailure(error.code ?? "synapse_error");
  }
  return body;
}
function pinReranker(value) {
  const body = unwrap(value);
  const models = body.models;
  const model = Array.isArray(models) ? models.find((row) => row?.model_id === RERANK_MODEL) : null;
  if (model?.certified !== true || model.fingerprints?.length !== 1 || typeof model.fingerprints[0] !== "string" || !/^[a-f0-9]{64}$/.test(model.fingerprints[0]) || !Number.isSafeInteger(body.table_epoch))
    throw new RerankFailure("catalog_validation");
  return { fingerprint: model.fingerprints[0], tableEpoch: body.table_epoch };
}
var loggedReasons = new Set;
function logRerankFallback(reason) {
  if (loggedReasons.has(reason))
    return;
  loggedReasons.add(reason);
  log2(`[ctx_search] rerank fallback (${reason}); retaining original ranking`);
}
function reasonOf(error) {
  if (error instanceof RerankFailure)
    return error.reason;
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);
    return ["ENOENT", "ECONNREFUSED"].includes(code) ? "missing_synapse" : code;
  }
  return "synapse_error";
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new RerankFailure("deadline_exceeded")), DEADLINE_MS);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
var connections = new Map;
var synapseRetryAt = new Map;
async function connect(connectionFile) {
  let connection = connections.get(connectionFile);
  if (!connection) {
    connection = inRootAsyncContext2(() => SubcClient.connect({ connectionFile, routeOpenRetryDeadlineMs: 0 }));
    connections.set(connectionFile, connection);
    connection.catch(() => connections.delete(connectionFile));
  }
  return bounded(connection);
}
async function remoteScores(config, query, documents, signal) {
  const controller = new AbortController;
  let timer;
  let onAbort;
  try {
    const cancelled = new Promise((_, reject) => {
      const cancel = (reason) => {
        reject(new RerankFailure(reason));
        controller.abort();
      };
      onAbort = () => cancel("aborted");
      if (signal?.aborted)
        onAbort();
      else
        signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => cancel("timeout"), Math.max(50, Math.min(15000, config.timeout_ms ?? DEADLINE_MS)));
    });
    const request = async () => {
      const tei = config.endpoint?.startsWith("tei+");
      const endpoint = (tei ? config.endpoint?.slice(4) : config.endpoint)?.replace(/\/+$/, "");
      if (!endpoint || !/^https?:\/\//.test(endpoint))
        throw new RerankFailure("invalid_endpoint");
      const response = await fetch(`${endpoint}/rerank`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}
        },
        body: JSON.stringify(tei ? { query, texts: documents } : { model: config.model, query, documents }),
        signal: controller.signal,
        redirect: "error"
      });
      if (!response.ok)
        throw new RerankFailure(`http_${response.status}`);
      const body = await response.json();
      const reply = body;
      const rows = tei ? body : reply?.results ?? reply?.data;
      if (!Array.isArray(rows) || rows.length !== documents.length)
        throw new RerankFailure("invalid_reply");
      const scores = new Array(documents.length);
      const seen = new Set;
      for (const row of rows) {
        const index = row?.index;
        const score = tei ? row?.score : row?.relevance_score;
        if (!Number.isInteger(index) || index < 0 || index >= documents.length || seen.has(index) || typeof score !== "number" || !Number.isFinite(score))
          throw new RerankFailure("invalid_reply");
        seen.add(index);
        scores[index] = score;
      }
      return scores;
    };
    return await Promise.race([cancelled, request()]);
  } finally {
    clearTimeout(timer);
    if (onAbort)
      signal?.removeEventListener("abort", onAbort);
  }
}
function remoteRerankSkipped(reason, onSkipped) {
  const safe = /^(?:invalid_reply|invalid_endpoint|validation|timeout|aborted|candidate_validation|http_\d{3})$/.test(reason) ? reason : "remote_error";
  const line = `Reranking skipped: ${safe}`;
  logRerankFallback(safe);
  onSkipped?.(line);
}
async function prepareReranker(projectRoot, sessionId, connectionFile, injectedClient, config, now = Date.now) {
  if (config?.provider === "off")
    return null;
  if (config?.provider === "remote")
    return { remote: config };
  const daemonFile = connectionFile ?? getDefaultSubcConnectionFile();
  const rememberAbsence = injectedClient === undefined;
  if (rememberAbsence && (synapseRetryAt.get(daemonFile) ?? 0) > now())
    return null;
  let catalogRequested = false;
  try {
    if (injectedClient === null)
      throw new RerankFailure("missing_synapse");
    const client = injectedClient ?? await connect(daemonFile);
    const identity = {
      project_root: projectRoot,
      harness: "magic-context",
      session: sessionId
    };
    catalogRequested = true;
    const lane = pinReranker(await bounded(client.call("synapse", "models.list", {}, { timeoutMs: DEADLINE_MS, targetKind: "management_surface", identity })));
    if (rememberAbsence)
      synapseRetryAt.delete(daemonFile);
    return { client, lane, identity };
  } catch (error) {
    const reason = reasonOf(error);
    if (rememberAbsence && catalogRequested && reason === "unknown_module") {
      const failedAt = now();
      const previousRetryAt = synapseRetryAt.get(daemonFile);
      const backoff = previousRetryAt !== undefined && failedAt - previousRetryAt < SYNAPSE_ABSENT_BACKOFF_MS ? SYNAPSE_ABSENT_BACKOFF_MS : SYNAPSE_RESTART_BACKOFF_MS;
      synapseRetryAt.set(daemonFile, failedAt + backoff);
    }
    logRerankFallback(reason);
    return null;
  }
}
async function rerankSearchResults(session, query, baseline, pool, texts, limit, signal, onSkipped) {
  if (!pool.length)
    return baseline;
  try {
    if (pool.length > 20 || texts.length !== pool.length || texts.some((text) => Buffer.byteLength(text) > DOCUMENT_BYTES))
      throw new RerankFailure("validation");
    let scores;
    if ("remote" in session) {
      scores = await remoteScores(session.remote, query, texts, signal);
    } else {
      const body = unwrap(await bounded(session.client.call("synapse", "rerank.score", {
        model: RERANK_MODEL,
        query,
        candidates: texts,
        required_fingerprint: session.lane.fingerprint,
        allow_equivalent: false,
        max_queue_ms: 100,
        deadline_ms: DEADLINE_MS
      }, {
        timeoutMs: DEADLINE_MS,
        targetKind: "management_surface",
        identity: session.identity
      })));
      if (body.fingerprint !== session.lane.fingerprint)
        throw new RerankFailure("fingerprint_mismatch");
      if (body.table_epoch !== session.lane.tableEpoch)
        throw new RerankFailure("epoch_mismatch");
      if (!Array.isArray(body.scores) || body.scores.length !== pool.length || body.scores.some((score) => typeof score !== "number" || !Number.isFinite(score)))
        throw new RerankFailure("validation");
      scores = body.scores;
    }
    return pool.map((hit, index) => ({ hit, index, score: scores[index] })).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map((row) => row.hit);
  } catch (error) {
    if ("remote" in session)
      remoteRerankSkipped(error instanceof RerankFailure ? error.reason : "remote_error", onSkipped);
    else
      logRerankFallback(reasonOf(error));
    return baseline;
  }
}
function candidateTexts(db, sessionId, projectPath, pool) {
  return pool.map((hit) => {
    const id = searchResultKey(hit).split(":").slice(1).join(":");
    let location = `${hit.source} ${id} ${projectPath}`;
    let title = hit.content.split(`
`)[0];
    let body = hit.content;
    switch (hit.source) {
      case "memory": {
        const row = db.prepare("SELECT content FROM memories WHERE id=?").get(hit.memoryId);
        body = row.content;
        title = body.split(`
`)[0];
        break;
      }
      case "primer": {
        const row = db.prepare("SELECT question, answer FROM primers WHERE id=?").get(hit.primerId);
        title = row.question;
        body = `Q: ${row.question}
A: ${row.answer}`;
        break;
      }
      case "git_commit": {
        const row = db.prepare("SELECT message FROM git_commits WHERE sha=?").get(hit.sha);
        body = row.message;
        title = `${hit.shortSha} ${body.split(`
`)[0]}`;
        break;
      }
      case "note": {
        const row = db.prepare("SELECT content, ready_reason AS reason FROM notes WHERE id=?").get(hit.noteId);
        body = `${row.content}${row.reason ? `
Reason: ${row.reason}` : ""}`;
        title = body.split(`
`)[0];
        break;
      }
      case "message": {
        const mapped = db.prepare(`SELECT f.content FROM message_fts_rowid_map m
                    JOIN message_history_fts f ON f.rowid=m.fts_rowid
                    WHERE m.session_id=? AND m.message_ordinal=? AND f.message_id=?`).get(sessionId, hit.messageOrdinal, hit.messageId);
        const row = mapped ?? db.prepare("SELECT content FROM message_history_fts WHERE session_id=? AND message_id=? ORDER BY CAST(message_ordinal AS INTEGER) LIMIT 1").get(sessionId, hit.messageId);
        body = row.content;
        title = `${hit.role}: ${body.split(`
`)[0]}`;
        location = `message ${hit.messageId} ${sessionId} @${hit.messageOrdinal}`;
        break;
      }
      case "compartment": {
        title = hit.title;
        location = `compartment ${hit.compartmentId} ${hit.sessionId} @${hit.startOrdinal}-${hit.endOrdinal}`;
        body = buildCanonicalChunkTextFromFts2(db, hit.sessionId, hit.startOrdinal, hit.endOrdinal) ?? "";
        break;
      }
    }
    return candidateText(location, title, body);
  });
}

// ../plugin/src/features/magic-context/search.ts
var DEFAULT_UNIFIED_SEARCH_LIMIT = 10;
var MAX_UNIFIED_SEARCH_LIMIT = 25;
var FTS_SEMANTIC_CANDIDATE_LIMIT = 50;
var SEMANTIC_WEIGHT = 0.7;
var FTS_WEIGHT = 0.3;
var SINGLE_SOURCE_PENALTY = 0.8;
var RESULT_PREVIEW_LIMIT = 220;
var MEMORY_SOURCE_BOOST = 1.3;
var MESSAGE_SOURCE_BOOST = 1.275;
var GIT_COMMIT_SOURCE_BOOST = 1.2;
var PRIMER_SOURCE_BOOST = 1.25;
var messageSearchStatements = new WeakMap;
var sessionFirstMessageSearchStatements = new WeakMap;
var messageSearchStatementsWithCutoff = new WeakMap;
var sessionFirstMessageSearchStatementsWithCutoff = new WeakMap;
var messageSearchStatementsWithDateRange = new WeakMap;
var messageSearchDiagnosticStatements = new WeakMap;
var sessionFirstMessageSearchDiagnosticStatements = new WeakMap;
var messageSearchDiagnosticStatementsWithDateRange = new WeakMap;
var batchedMessageSearchStatements = new WeakMap;
var batchedFtsCountStatements = new WeakMap;
function createUnifiedSearchDiagnostics2() {
  return {
    suppressedVisibleMemoryIds: [],
    suppressedLiveMessageMatches: 0,
    gitCommitUnavailable: null
  };
}
function searchMessageHistory2(db, request) {
  if (!isMessageIndexSearchable(request.sessionId))
    return { results: [], suppressedLiveMessageMatches: 0 };
  const diagnostics = request.collectDiagnostics ? createUnifiedSearchDiagnostics2() : undefined;
  const capture = request.captureLimit ? { limit: request.captureLimit, results: [] } : undefined;
  const results = searchMessages({
    db,
    sessionId: request.sessionId,
    query: request.query,
    limit: request.limit,
    maxOrdinal: request.maxOrdinal,
    probes: request.probes,
    relaxedRecall: request.relaxedRecall,
    diagnostics,
    dateRange: request.dateRange,
    capture
  });
  return {
    results,
    laneResults: capture?.results,
    suppressedLiveMessageMatches: diagnostics?.suppressedLiveMessageMatches ?? 0
  };
}
function normalizeLimit(limit) {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_UNIFIED_SEARCH_LIMIT;
  }
  return Math.min(MAX_UNIFIED_SEARCH_LIMIT, Math.max(1, Math.floor(limit)));
}
function normalizeDateRange(from, to) {
  if (from === undefined && to === undefined)
    return null;
  return {
    from: typeof from === "number" && Number.isSafeInteger(from) ? from : Number.MIN_SAFE_INTEGER,
    to: typeof to === "number" && Number.isSafeInteger(to) ? to : Number.MAX_SAFE_INTEGER
  };
}
function timestampIsInRange(timestamp, range) {
  return range === null || timestamp >= range.from && timestamp <= range.to;
}
var ID_SHAPED_QUERY_MAX_TOKENS = 5;
var ID_SHAPED_TOKEN = /^#?\d+$/;
function parseIdShapedQuery2(query) {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const tokens = trimmed.split(/[\s,]+/).filter((token) => token.length > 0);
  if (tokens.length === 0 || tokens.length > ID_SHAPED_QUERY_MAX_TOKENS) {
    return null;
  }
  const ids = [];
  for (const token of tokens) {
    if (!ID_SHAPED_TOKEN.test(token)) {
      return null;
    }
    const parsed = Number.parseInt(token.replace(/^#/, ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    ids.push(parsed);
  }
  return ids;
}
function normalizeCosineScore(score) {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.min(1, Math.max(0, score));
}
function previewText(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= RESULT_PREVIEW_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, RESULT_PREVIEW_LIMIT - 1).trimEnd()}…`;
}
function resolveSearchWorkspaceContext(db, projectPath, identitySet) {
  const resolved = identitySet ?? resolveWorkspaceIdentitySet(db, projectPath);
  const isWorkspaced = resolved.identities.length > 1;
  const expanded = expandWorkspaceIdentitySetWithAliases(db, resolved.identities);
  const expandedIdentities = isWorkspaced ? expanded.expandedIdentities : resolved.identities;
  const canonicalIdentityByStoredPath = isWorkspaced ? expanded.canonicalIdentityByStoredPath : new Map(resolved.identities.map((identity) => [identity, identity]));
  const ownIdentities = expandedIdentities.filter((identity) => canonicalIdentityByStoredPath.get(identity) === projectPath);
  return {
    identities: resolved.identities,
    expandedIdentities,
    ownIdentities,
    shareCategories: isWorkspaced ? resolveWorkspaceShareCategories(db, projectPath) : null,
    namesByIdentity: resolved.namesByIdentity,
    canonicalIdentityByStoredPath,
    isWorkspaced
  };
}
function memoryWorkspaceIdentity(memory, workspace) {
  return resolveStoredPathWorkspaceIdentity(memory.projectPath, workspace.identities, workspace.canonicalIdentityByStoredPath);
}
function sourceNamesForSearchMemories(args) {
  if (!args.workspace.isWorkspaced)
    return;
  const sourceNames = new Map;
  for (const memory of args.memories) {
    const source = sourceNameForMemory(memory.projectPath, args.projectPath, args.workspace.identities, args.workspace.namesByIdentity, args.workspace.canonicalIdentityByStoredPath);
    if (source)
      sourceNames.set(memory.id, source);
  }
  return sourceNames.size > 0 ? sourceNames : undefined;
}
function getMessageSearchStatement(db, sessionFirst) {
  const statements = sessionFirst ? sessionFirstMessageSearchStatements : messageSearchStatements;
  let stmt = statements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT message_ordinal AS messageOrdinal, message_id AS messageId, role, content FROM message_history_fts WHERE ${sessionFirst ? MESSAGE_FTS_SESSION_FILTER_SQL : ""}session_id = ? AND message_history_fts MATCH ? ORDER BY bm25(message_history_fts), CAST(message_ordinal AS INTEGER) ASC LIMIT ?`);
    statements.set(db, stmt);
  }
  return stmt;
}
function getMessageSearchStatementWithCutoff(db, sessionFirst) {
  const statements = sessionFirst ? sessionFirstMessageSearchStatementsWithCutoff : messageSearchStatementsWithCutoff;
  let stmt = statements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT message_ordinal AS messageOrdinal, message_id AS messageId, role, content FROM message_history_fts WHERE ${sessionFirst ? MESSAGE_FTS_SESSION_FILTER_SQL : ""}session_id = ? AND message_history_fts MATCH ? AND CAST(message_ordinal AS INTEGER) <= ? ORDER BY bm25(message_history_fts), CAST(message_ordinal AS INTEGER) ASC LIMIT ?`);
    statements.set(db, stmt);
  }
  return stmt;
}
function getMessageSearchStatementWithDateRange(db, withCutoff) {
  let statements = messageSearchStatementsWithDateRange.get(db);
  if (!statements) {
    statements = new Map;
    messageSearchStatementsWithDateRange.set(db, statements);
  }
  const key = withCutoff ? "cutoff" : "all";
  let statement = statements.get(key);
  if (!statement) {
    statement = db.prepare(`SELECT message_history_fts.message_ordinal AS messageOrdinal,
                    message_history_fts.message_id AS messageId,
                    message_history_fts.role AS role,
                    message_history_fts.content AS content
               FROM message_history_fts
               JOIN message_fts_rowid_map AS map
                 ON map.session_id = message_history_fts.session_id
                AND map.fts_rowid = message_history_fts.rowid
              WHERE ${MESSAGE_FTS_SESSION_FILTER_SQL}message_history_fts.session_id = ?
                 AND message_history_fts MATCH ?
                 AND map.message_time_ms BETWEEN ? AND ?
                ${withCutoff ? "AND CAST(message_history_fts.message_ordinal AS INTEGER) <= ?" : ""}
              ORDER BY bm25(message_history_fts),
                       CAST(message_history_fts.message_ordinal AS INTEGER) ASC
              LIMIT ?`);
    statements.set(key, statement);
  }
  return statement;
}
function getMessageSearchDiagnosticStatement(db, sessionFirst) {
  const statements = sessionFirst ? sessionFirstMessageSearchDiagnosticStatements : messageSearchDiagnosticStatements;
  let stmt = statements.get(db);
  if (!stmt) {
    stmt = db.prepare(`
            WITH matches AS MATERIALIZED (
                SELECT
                    message_ordinal AS messageOrdinal,
                    message_id AS messageId,
                    role,
                    content,
                    CAST(message_ordinal AS INTEGER) AS ordinalValue,
                    bm25(message_history_fts) AS ftsRank
                FROM message_history_fts
                WHERE ${sessionFirst ? MESSAGE_FTS_SESSION_FILTER_SQL : ""}session_id = ? AND message_history_fts MATCH ?
            ),
            eligible AS (
                SELECT * FROM matches
                WHERE ordinalValue <= ?
                ORDER BY ftsRank, ordinalValue ASC
                LIMIT ?
            ),
            summary AS (
                SELECT COUNT(*) AS suppressedCount
                FROM matches
                WHERE ordinalValue > ?
            )
            SELECT
                eligible.messageOrdinal,
                eligible.messageId,
                eligible.role,
                eligible.content,
                eligible.ftsRank,
                summary.suppressedCount,
                0 AS summaryOnly
            FROM eligible CROSS JOIN summary
            UNION ALL
            SELECT NULL, NULL, NULL, NULL, NULL, summary.suppressedCount, 1
            FROM summary
            WHERE NOT EXISTS (SELECT 1 FROM eligible)
            ORDER BY summaryOnly ASC, ftsRank ASC, messageOrdinal ASC
        `);
    statements.set(db, stmt);
  }
  return stmt;
}
function getMessageSearchDiagnosticStatementWithDateRange(db) {
  let statement = messageSearchDiagnosticStatementsWithDateRange.get(db);
  if (!statement) {
    statement = db.prepare(`
            WITH matches AS MATERIALIZED (
                SELECT
                    message_history_fts.message_ordinal AS messageOrdinal,
                    message_history_fts.message_id AS messageId,
                    message_history_fts.role AS role,
                    message_history_fts.content AS content,
                    CAST(message_history_fts.message_ordinal AS INTEGER) AS ordinalValue,
                    bm25(message_history_fts) AS ftsRank
                FROM message_history_fts
                JOIN message_fts_rowid_map AS map
                  ON map.session_id = message_history_fts.session_id
                 AND map.fts_rowid = message_history_fts.rowid
                WHERE ${MESSAGE_FTS_SESSION_FILTER_SQL}message_history_fts.session_id = ?
                   AND message_history_fts MATCH ?
                   AND map.message_time_ms BETWEEN ? AND ?
            ),
            eligible AS (
                SELECT * FROM matches
                WHERE ordinalValue <= ?
                ORDER BY ftsRank, ordinalValue ASC
                LIMIT ?
            ),
            summary AS (
                SELECT COUNT(*) AS suppressedCount
                FROM matches
                WHERE ordinalValue > ?
            )
            SELECT
                eligible.messageOrdinal,
                eligible.messageId,
                eligible.role,
                eligible.content,
                eligible.ftsRank,
                summary.suppressedCount,
                0 AS summaryOnly
            FROM eligible CROSS JOIN summary
            UNION ALL
            SELECT NULL, NULL, NULL, NULL, NULL, summary.suppressedCount, 1
            FROM summary
            WHERE NOT EXISTS (SELECT 1 FROM eligible)
            ORDER BY summaryOnly ASC, ftsRank ASC, messageOrdinal ASC
        `);
    messageSearchDiagnosticStatementsWithDateRange.set(db, statement);
  }
  return statement;
}
function getBatchedFtsCountStatement(db, queryCount, cutoff, dateRange, sessionFirst) {
  let statements = batchedFtsCountStatements.get(db);
  if (!statements) {
    statements = new Map;
    batchedFtsCountStatements.set(db, statements);
  }
  const key = `${queryCount}:${cutoff === null ? "all" : "cutoff"}:${dateRange === null ? "all-dates" : "dated"}:${sessionFirst}`;
  let statement = statements.get(key);
  if (!statement) {
    const cutoffSql = cutoff === null ? "" : " AND CAST(message_history_fts.message_ordinal AS INTEGER) <= ?";
    const joinSql = dateRange === null ? "" : ` JOIN message_fts_rowid_map AS map
                         ON map.session_id = message_history_fts.session_id
                        AND map.fts_rowid = message_history_fts.rowid`;
    const dateSql = dateRange === null ? "" : " AND map.message_time_ms BETWEEN ? AND ?";
    statement = db.prepare(Array.from({ length: queryCount }, (_, index) => `SELECT ${index} AS queryIndex, COUNT(*) AS count
                       FROM message_history_fts${joinSql}
                      WHERE ${sessionFirst || dateRange !== null ? MESSAGE_FTS_SESSION_FILTER_SQL : ""}message_history_fts.session_id = ?
                         AND message_history_fts MATCH ?${dateSql}${cutoffSql}`).join(`
UNION ALL
`));
    statements.set(key, statement);
  }
  return statement;
}
function contentOnlyMessageQuery(ftsQuery) {
  return ftsQuery.length === 0 ? "" : `content : (${ftsQuery})`;
}
function countSessionFtsMatchesBatch(db, sessionId, ftsQueries, cutoff, dateRange, sessionFirst) {
  if (ftsQueries.length === 0)
    return [];
  const bindings = [];
  for (const query of ftsQueries) {
    if (sessionFirst || dateRange !== null)
      bindings.push(sessionId);
    bindings.push(sessionId, contentOnlyMessageQuery(query));
    if (dateRange !== null)
      bindings.push(dateRange.from, dateRange.to);
    if (cutoff !== null)
      bindings.push(cutoff);
  }
  try {
    const rows = getBatchedFtsCountStatement(db, ftsQueries.length, cutoff, dateRange, sessionFirst).all(...bindings);
    const counts = Array.from({ length: ftsQueries.length }, () => 0);
    for (const row of rows) {
      if (typeof row.queryIndex === "number" && row.queryIndex >= 0 && row.queryIndex < counts.length && typeof row.count === "number") {
        counts[row.queryIndex] = row.count;
      }
    }
    return counts;
  } catch {
    return Array.from({ length: ftsQueries.length }, () => 0);
  }
}
function getMessageOrdinal(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
async function getSemanticScores(args) {
  const semanticScores = new Map;
  if (!args.queryEmbedding || args.memories.length === 0 || !args.queryModelId || args.queryModelId === "off") {
    return semanticScores;
  }
  if (!args.workspace?.isWorkspaced) {
    const cachedEmbeddings = getProjectEmbeddings2(args.db, args.projectPath, args.queryModelId);
    const embeddings = args.backfillMemoryEmbeddings === false ? cachedEmbeddings : await ensureMemoryEmbeddings2({
      db: args.db,
      projectIdentity: args.projectPath,
      memories: args.memories,
      existingEmbeddings: cachedEmbeddings
    });
    for (const memory of args.memories) {
      const memoryEmbedding = embeddings.get(memory.id);
      if (!memoryEmbedding) {
        continue;
      }
      semanticScores.set(memory.id, normalizeCosineScore(cosineSimilarity(args.queryEmbedding, memoryEmbedding.embedding)));
    }
    return semanticScores;
  }
  const workspace = args.workspace;
  const memoriesByIdentity = new Map;
  for (const memory of args.memories) {
    const identity = memoryWorkspaceIdentity(memory, workspace);
    if (!identity)
      continue;
    const list = memoriesByIdentity.get(identity) ?? [];
    list.push(memory);
    memoriesByIdentity.set(identity, list);
  }
  const ownMemories = memoriesByIdentity.get(args.projectPath) ?? [];
  if (ownMemories.length > 0 && args.backfillMemoryEmbeddings !== false) {
    const ownEmbeddings = getProjectEmbeddings2(args.db, args.projectPath, args.queryModelId);
    await ensureMemoryEmbeddings2({
      db: args.db,
      projectIdentity: args.projectPath,
      memories: ownMemories,
      existingEmbeddings: ownEmbeddings
    });
  }
  for (const identity of workspace.identities) {
    const memberMemories = memoriesByIdentity.get(identity) ?? [];
    if (memberMemories.length === 0)
      continue;
    const cachedEmbeddings = getProjectEmbeddings2(args.db, identity, args.queryModelId);
    for (const memory of memberMemories) {
      const memoryEmbedding = cachedEmbeddings.get(memory.id);
      if (!memoryEmbedding || memoryEmbedding.modelId !== args.queryModelId)
        continue;
      semanticScores.set(memory.id, normalizeCosineScore(cosineSimilarity(args.queryEmbedding, memoryEmbedding.embedding)));
    }
  }
  return semanticScores;
}
function getFtsMatches(args) {
  try {
    return args.workspace?.isWorkspaced ? searchMemoriesFTSUnion(args.db, args.workspace.expandedIdentities, args.query, args.limit, args.workspace.ownIdentities, args.workspace.shareCategories, args.dateRange) : searchMemoriesFTS(args.db, args.projectPath, args.query, args.limit, args.dateRange);
  } catch (error) {
    log2(`[search] FTS query failed for "${args.query}": ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
function getFtsScores(matches) {
  return new Map(matches.map((memory, rank) => [memory.id, 1 / (rank + 1)]));
}
function selectSemanticCandidates(args) {
  if (args.ftsMatches.length === 0) {
    return args.memories;
  }
  const candidateIds = new Set(args.ftsMatches.map((memory) => memory.id));
  if (args.queryModelId && args.queryModelId !== "off") {
    const embeddingProjects = args.workspace?.isWorkspaced ? args.workspace.identities : [args.projectPath];
    for (const projectPath of embeddingProjects) {
      const storedEmbeddings = getProjectEmbeddings2(args.db, projectPath, args.queryModelId);
      for (const memoryId of storedEmbeddings.keys()) {
        candidateIds.add(memoryId);
      }
    }
  }
  return args.memories.filter((memory) => candidateIds.has(memory.id));
}
function mergeMemoryResults(args) {
  const memoryById = new Map(args.memories.map((memory) => [memory.id, memory]));
  const candidateIds = new Set([...args.semanticScores.keys(), ...args.ftsScores.keys()]);
  const results = [];
  const suppressedVisibleIds = [];
  for (const id of candidateIds) {
    const memory = memoryById.get(id);
    if (!memory) {
      continue;
    }
    const semanticScore = args.semanticScores.get(id);
    const ftsScore = args.ftsScores.get(id);
    let score = 0;
    let matchType = "fts";
    if (semanticScore !== undefined && ftsScore !== undefined) {
      score = SEMANTIC_WEIGHT * semanticScore + FTS_WEIGHT * ftsScore;
      matchType = "hybrid";
    } else if (semanticScore !== undefined) {
      score = semanticScore * (args.singleSourcePenalty ?? SINGLE_SOURCE_PENALTY);
      matchType = "semantic";
    } else if (ftsScore !== undefined) {
      score = ftsScore * SINGLE_SOURCE_PENALTY;
      matchType = "fts";
    }
    if (score <= 0) {
      continue;
    }
    if (args.visibleMemoryIds?.has(id)) {
      suppressedVisibleIds.push(id);
      continue;
    }
    results.push(withMemoryHintContent({
      source: "memory",
      content: previewText(memory.content),
      score,
      memoryId: memory.id,
      category: memory.category,
      matchType,
      sourceName: args.sourceNameByMemoryId?.get(memory.id)
    }, memory.content));
  }
  return {
    results: results.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.memoryId - right.memoryId;
    }).slice(0, args.limit),
    suppressedVisibleIds: suppressedVisibleIds.sort((left, right) => left - right)
  };
}
async function searchMemories(args) {
  if (!args.memoryEnabled) {
    return { results: [], suppressedVisibleIds: [] };
  }
  const unfilteredMemories = args.workspace?.isWorkspaced ? getMemoriesByProjects2(args.db, args.workspace.expandedIdentities, ["active", "permanent"], Date.now(), args.workspace.ownIdentities, args.workspace.shareCategories) : getMemoriesByProject2(args.db, args.projectPath);
  const memories = unfilteredMemories.filter((memory) => timestampIsInRange(memory.createdAt, args.dateRange));
  if (memories.length === 0) {
    return { results: [], suppressedVisibleIds: [] };
  }
  const ftsMatches = getFtsMatches({
    db: args.db,
    projectPath: args.projectPath,
    query: args.query,
    limit: FTS_SEMANTIC_CANDIDATE_LIMIT,
    workspace: args.workspace,
    dateRange: args.dateRange
  });
  const ftsScores = getFtsScores(ftsMatches);
  const semanticCandidates = selectSemanticCandidates({
    db: args.db,
    memories,
    projectPath: args.projectPath,
    ftsMatches,
    queryModelId: args.queryModelId,
    workspace: args.workspace
  });
  const semanticScores = await getSemanticScores({
    db: args.db,
    projectPath: args.projectPath,
    memories: semanticCandidates,
    backfillMemoryEmbeddings: args.backfillMemoryEmbeddings,
    queryEmbedding: args.queryEmbedding,
    queryModelId: args.queryModelId,
    workspace: args.workspace
  });
  const sourceNameByMemoryId = sourceNamesForSearchMemories({
    memories,
    projectPath: args.projectPath,
    workspace: args.workspace ?? {
      identities: [args.projectPath],
      expandedIdentities: [args.projectPath],
      namesByIdentity: new Map,
      canonicalIdentityByStoredPath: new Map([[args.projectPath, args.projectPath]]),
      ownIdentities: [args.projectPath],
      shareCategories: null,
      isWorkspaced: false
    }
  });
  if (args.lanes) {
    args.lanes.memory_fts = mergeMemoryResults({
      memories,
      semanticScores: new Map,
      ftsScores,
      sourceNameByMemoryId,
      limit: 25,
      visibleMemoryIds: args.visibleMemoryIds
    }).results;
    args.lanes.memory_vector = mergeMemoryResults({
      memories,
      semanticScores,
      ftsScores: new Map,
      sourceNameByMemoryId,
      singleSourcePenalty: 1,
      limit: 25,
      visibleMemoryIds: args.visibleMemoryIds
    }).results;
  }
  return mergeMemoryResults({
    memories,
    semanticScores,
    ftsScores,
    limit: args.limit,
    visibleMemoryIds: args.visibleMemoryIds,
    sourceNameByMemoryId
  });
}
function linearDecayScore(rank, total) {
  if (total <= 0)
    return 0;
  return Math.max(0, 1 - rank / total);
}
function normalizeMessageSearchRow(row, cutoff) {
  const messageOrdinal = getMessageOrdinal(row.messageOrdinal);
  if (messageOrdinal === null || typeof row.messageId !== "string" || typeof row.role !== "string" || typeof row.content !== "string") {
    return null;
  }
  if (cutoff !== null && messageOrdinal > cutoff)
    return null;
  return {
    messageOrdinal,
    messageId: row.messageId,
    role: row.role,
    content: row.content
  };
}
function runMessageFtsQuery(db, sessionId, ftsQuery, fetchLimit, cutoff, dateRange, sessionFirst) {
  if (ftsQuery.length === 0)
    return [];
  let rawRows;
  const matchQuery = contentOnlyMessageQuery(ftsQuery);
  if (dateRange !== null) {
    const bindings = [
      sessionId,
      sessionId,
      matchQuery,
      dateRange.from,
      dateRange.to
    ];
    if (cutoff !== null)
      bindings.push(cutoff);
    bindings.push(fetchLimit);
    rawRows = getMessageSearchStatementWithDateRange(db, cutoff !== null).all(...bindings);
  } else {
    const sessionBindings = sessionFirst ? [sessionId, sessionId] : [sessionId];
    rawRows = cutoff !== null ? getMessageSearchStatementWithCutoff(db, sessionFirst).all(...sessionBindings, matchQuery, cutoff, fetchLimit) : getMessageSearchStatement(db, sessionFirst).all(...sessionBindings, matchQuery, fetchLimit);
  }
  const rows = rawRows.map((row) => row);
  const result = [];
  for (const row of rows) {
    const normalized = normalizeMessageSearchRow(row, cutoff);
    if (normalized)
      result.push(normalized);
  }
  return result;
}
function runMessageFtsQueryWithDiagnostics(args) {
  if (args.ftsQuery.length === 0)
    return { rows: [], suppressedCount: 0 };
  const matchQuery = contentOnlyMessageQuery(args.ftsQuery);
  const rawRows = (args.dateRange === null ? getMessageSearchDiagnosticStatement(args.db, args.sessionFirst).all(...args.sessionFirst ? [args.sessionId, args.sessionId] : [args.sessionId], matchQuery, args.cutoff, args.fetchLimit, args.cutoff) : getMessageSearchDiagnosticStatementWithDateRange(args.db).all(args.sessionId, args.sessionId, matchQuery, args.dateRange.from, args.dateRange.to, args.cutoff, args.fetchLimit, args.cutoff)).map((row) => row);
  const suppressedCount = rawRows[0]?.suppressedCount ?? 0;
  const rows = [];
  for (const row of rawRows) {
    if (row.summaryOnly === 1)
      continue;
    const normalized = normalizeMessageSearchRow(row, args.cutoff);
    if (normalized)
      rows.push(normalized);
  }
  return { rows, suppressedCount };
}
function getBatchedMessageSearchStatement(db, queryCount, cutoff, dateRange, sessionFirst) {
  let statements = batchedMessageSearchStatements.get(db);
  if (!statements) {
    statements = new Map;
    batchedMessageSearchStatements.set(db, statements);
  }
  const key = `${queryCount}:${cutoff === null ? "all" : "cutoff"}:${dateRange === null ? "all-dates" : "dated"}:${sessionFirst}`;
  let statement = statements.get(key);
  if (!statement) {
    const cutoffSql = cutoff === null ? "" : " AND CAST(message_history_fts.message_ordinal AS INTEGER) <= ?";
    const joinSql = dateRange === null ? "" : ` JOIN message_fts_rowid_map AS map
                         ON map.session_id = message_history_fts.session_id
                        AND map.fts_rowid = message_history_fts.rowid`;
    const dateSql = dateRange === null ? "" : " AND map.message_time_ms BETWEEN ? AND ?";
    const branches = Array.from({ length: queryCount }, (_, index) => `SELECT * FROM (
                SELECT ${index} AS queryIndex,
                       message_history_fts.message_ordinal AS messageOrdinal,
                       message_history_fts.message_id AS messageId,
                       message_history_fts.role AS role,
                       message_history_fts.content AS content,
                       bm25(message_history_fts) AS ftsRank
                  FROM message_history_fts${joinSql}
                 WHERE ${sessionFirst || dateRange !== null ? MESSAGE_FTS_SESSION_FILTER_SQL : ""}message_history_fts.session_id = ?
                    AND message_history_fts MATCH ?${dateSql}${cutoffSql}
                 ORDER BY ftsRank
                 LIMIT ?
            )`);
    statement = db.prepare(`${branches.join(`
UNION ALL
`)}
ORDER BY queryIndex ASC, ftsRank ASC`);
    statements.set(key, statement);
  }
  return statement;
}
function runMessageFtsQueriesBatch(db, sessionId, ftsQueries, fetchLimit, cutoff, dateRange, sessionFirst) {
  if (ftsQueries.length === 0)
    return [];
  const bindings = [];
  for (const query of ftsQueries) {
    if (sessionFirst || dateRange !== null)
      bindings.push(sessionId);
    bindings.push(sessionId, contentOnlyMessageQuery(query));
    if (dateRange !== null)
      bindings.push(dateRange.from, dateRange.to);
    if (cutoff !== null)
      bindings.push(cutoff);
    bindings.push(fetchLimit);
  }
  const rows = getBatchedMessageSearchStatement(db, ftsQueries.length, cutoff, dateRange, sessionFirst).all(...bindings);
  const result = Array.from({ length: ftsQueries.length }, () => []);
  for (const row of rows) {
    if (typeof row.queryIndex !== "number" || row.queryIndex < 0 || row.queryIndex >= result.length) {
      continue;
    }
    const normalized = normalizeMessageSearchRow(row, cutoff);
    if (normalized)
      result[row.queryIndex].push(normalized);
  }
  return result;
}
var RRF_K = 60;
var VERBATIM_RANK_BONUS = 1 / RRF_K;
var IDF_FALLOFF = 100;
function probeDiscriminationWeight(df, corpusSize) {
  if (corpusSize <= 0 || df <= 0)
    return 1;
  return 1 / (1 + IDF_FALLOFF * df / corpusSize);
}
function searchMessages(args) {
  return withMessageFtsSessionFilter(args.db, args.sessionId, (sessionFirst) => searchMessagesInSnapshot(args, sessionFirst));
}
function searchMessagesInSnapshot(args, sessionFirst) {
  const cutoff = args.maxOrdinal != null && args.maxOrdinal >= 0 ? args.maxOrdinal : null;
  const baselineFetchLimit = cutoff !== null ? args.limit * 3 : args.limit;
  const captureFetchLimit = args.capture ? cutoff !== null ? args.capture.limit * 3 : args.capture.limit : 0;
  const fetchLimit = Math.max(baselineFetchLimit, captureFetchLimit);
  const baseQuery = sanitizeFtsQuery(args.query.trim());
  const probes = args.probes ?? [];
  if (probes.length === 0) {
    const outcome = args.diagnostics && cutoff !== null ? runMessageFtsQueryWithDiagnostics({
      db: args.db,
      sessionId: args.sessionId,
      ftsQuery: baseQuery,
      fetchLimit,
      cutoff,
      dateRange: args.dateRange,
      sessionFirst
    }) : {
      rows: runMessageFtsQuery(args.db, args.sessionId, baseQuery, fetchLimit, cutoff, args.dateRange, sessionFirst),
      suppressedCount: 0
    };
    if (args.diagnostics) {
      args.diagnostics.suppressedLiveMessageMatches = outcome.suppressedCount;
    }
    const rows = outcome.rows.length > 0 || !args.relaxedRecall ? outcome.rows : runMessageFtsQuery(args.db, args.sessionId, relaxedFtsQuery(args.query), fetchLimit, cutoff, args.dateRange, sessionFirst);
    const renderRows = (limit) => {
      const filtered = rows.slice(0, limit);
      return filtered.map((row, rank) => ({
        source: "message",
        content: matchedSearchSnippet(row.content, args.query) || previewText(row.content),
        score: linearDecayScore(rank, filtered.length),
        messageOrdinal: row.messageOrdinal,
        messageId: row.messageId,
        role: row.role
      }));
    };
    if (args.capture)
      args.capture.results = renderRows(args.capture.limit);
    return renderRows(args.limit);
  }
  const sanitizedProbes = probes.map((probe) => ({ probe, query: sanitizeFtsQuery(probe) })).filter((entry) => entry.query.length > 0);
  const corpusSize = getIndexedMessageCorpusSize(args.db, args.sessionId, cutoff);
  const probeCounts = countSessionFtsMatchesBatch(args.db, args.sessionId, sanitizedProbes.map((entry) => entry.query), cutoff, args.dateRange, sessionFirst);
  const collectBaseDiagnostics = args.diagnostics !== undefined && cutoff !== null;
  const baseOutcome = collectBaseDiagnostics && baseQuery.length > 0 ? runMessageFtsQueryWithDiagnostics({
    db: args.db,
    sessionId: args.sessionId,
    ftsQuery: baseQuery,
    fetchLimit,
    cutoff,
    dateRange: args.dateRange,
    sessionFirst
  }) : null;
  if (args.diagnostics) {
    args.diagnostics.suppressedLiveMessageMatches = baseOutcome?.suppressedCount ?? 0;
  }
  const searchQueries = [
    ...!collectBaseDiagnostics && baseQuery.length > 0 ? [baseQuery] : [],
    ...sanitizedProbes.map((entry) => entry.query)
  ];
  const rowsByQuery = runMessageFtsQueriesBatch(args.db, args.sessionId, searchQueries, fetchLimit, cutoff, args.dateRange, sessionFirst);
  const queryLists = [];
  let queryIndex = 0;
  if (baseQuery.length > 0) {
    queryLists.push({
      rows: baseOutcome?.rows ?? rowsByQuery[queryIndex] ?? [],
      weight: 1
    });
    if (!collectBaseDiagnostics)
      queryIndex += 1;
  }
  const probeWeights = new Map;
  sanitizedProbes.forEach((entry, probeIndex) => {
    const weight = probeDiscriminationWeight(probeCounts[probeIndex] ?? 0, corpusSize);
    probeWeights.set(entry.probe, weight);
    queryLists.push({ rows: rowsByQuery[queryIndex] ?? [], weight });
    queryIndex += 1;
  });
  const rankProbeLists = (rowLimit, resultLimit) => {
    const fused = new Map;
    for (const list of queryLists) {
      list.rows.slice(0, rowLimit).forEach((row, rank) => {
        const rrf = list.weight / (RRF_K + rank);
        const existing = fused.get(row.messageId);
        if (existing) {
          existing.score += rrf;
        } else {
          fused.set(row.messageId, { row, score: rrf });
        }
      });
    }
    for (const entry of fused.values()) {
      let best = 0;
      for (const probe of probes) {
        const weight = probeWeights.get(probe) ?? 0;
        if (weight > best && containsProbeVerbatim(entry.row.content, [probe])) {
          best = weight;
        }
      }
      if (best > 0) {
        entry.score += best * VERBATIM_RANK_BONUS;
      }
    }
    const ranked = [...fused.values()].sort((a, b) => b.score !== a.score ? b.score - a.score : a.row.messageOrdinal - b.row.messageOrdinal).slice(0, resultLimit);
    return ranked.map((entry, rank) => ({
      source: "message",
      content: matchedSearchSnippet(entry.row.content, args.query) || previewText(entry.row.content),
      score: linearDecayScore(rank, ranked.length),
      messageOrdinal: entry.row.messageOrdinal,
      messageId: entry.row.messageId,
      role: entry.row.role
    }));
  };
  if (args.capture)
    args.capture.results = rankProbeLists(captureFetchLimit, args.capture.limit);
  return rankProbeLists(baselineFetchLimit, args.limit);
}
var NOTE_SEARCHABLE_STATUSES = ["active", "pending", "ready"];
var MAX_NOTE_KEYWORD_SCORE = 3.5;
function noteSearchText(note) {
  const reason = note.readyReason?.trim();
  return reason ? `${note.content}
Reason: ${reason}` : note.content;
}
function tokenizeKeywordNeedle(text) {
  const matches = text.toLowerCase().match(/[a-z0-9/._:-]+/g) ?? [];
  const seen = new Set;
  const tokens = [];
  for (const match of matches) {
    if (match.length <= 1 || !/[a-z0-9]/.test(match) || seen.has(match)) {
      continue;
    }
    seen.add(match);
    tokens.push(match);
  }
  return tokens;
}
function normalizeNoteKeywordScore(score) {
  return normalizeCosineScore(score / MAX_NOTE_KEYWORD_SCORE) * SINGLE_SOURCE_PENALTY;
}
function rankNotesForNeedle(notes, needle) {
  const normalizedNeedle = needle.trim().toLowerCase();
  if (normalizedNeedle.length === 0) {
    return [];
  }
  const needleTokens = tokenizeKeywordNeedle(normalizedNeedle);
  const ranked = [];
  for (const note of notes) {
    const text = noteSearchText(note);
    const normalizedText = text.toLowerCase();
    const noteTokens = new Set(tokenizeKeywordNeedle(normalizedText));
    const exact = normalizedText.includes(normalizedNeedle);
    const matchedTokens = needleTokens.filter((token) => noteTokens.has(token)).length;
    if (!exact && matchedTokens === 0) {
      continue;
    }
    const matchedUniqueTokens = new Set(needleTokens.filter((token) => noteTokens.has(token))).size;
    const coverage = needleTokens.length > 0 ? matchedTokens / needleTokens.length : 0;
    const density = noteTokens.size > 0 ? matchedUniqueTokens / noteTokens.size : 0;
    const exactPhrase = exact && (needleTokens.length > 1 || normalizedText.trim() === normalizedNeedle);
    const allTokens = needleTokens.length > 1 && matchedTokens === needleTokens.length;
    const score = (exactPhrase ? 2 : 0) + coverage * density + (allTokens ? 0.5 * density : 0);
    ranked.push({ note, score, text });
  }
  return ranked.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.note.createdAt !== left.note.createdAt) {
      return right.note.createdAt - left.note.createdAt;
    }
    return left.note.id - right.note.id;
  });
}
function searchNotes(args) {
  if (args.limit <= 0) {
    return [];
  }
  const notes = [
    ...getNotes(args.db, {
      sessionId: args.sessionId,
      type: "session",
      status: NOTE_SEARCHABLE_STATUSES
    }),
    ...getNotes(args.db, {
      projectPath: args.projectPath,
      type: "smart",
      status: NOTE_SEARCHABLE_STATUSES
    })
  ].filter((note) => timestampIsInRange(note.createdAt, args.dateRange));
  if (notes.length === 0) {
    return [];
  }
  const baseList = rankNotesForNeedle(notes, args.query);
  const probes = args.probes ?? [];
  if (probes.length === 0) {
    const ranked = baseList.slice(0, args.limit);
    return ranked.map((entry) => ({
      source: "note",
      content: previewText(entry.text),
      score: normalizeNoteKeywordScore(entry.score),
      noteId: entry.note.id,
      status: entry.note.status,
      createdAt: entry.note.createdAt,
      anchorOrdinal: entry.note.anchorOrdinal,
      sourceSessionId: entry.note.sessionId
    }));
  }
  const queryLists = [];
  if (baseList.length > 0) {
    queryLists.push({ rows: baseList, weight: 1 });
  }
  for (const probe of probes) {
    const rows = rankNotesForNeedle(notes, probe);
    if (rows.length === 0) {
      continue;
    }
    const weight = probeDiscriminationWeight(rows.length, notes.length);
    queryLists.push({ rows, weight });
  }
  const fused = new Map;
  for (const list of queryLists) {
    for (const row of list.rows) {
      const relevance = row.score * list.weight;
      const existing = fused.get(row.note.id);
      if (existing) {
        if (relevance > existing.score) {
          existing.entry = row;
          existing.score = relevance;
        }
      } else {
        fused.set(row.note.id, { entry: row, score: relevance });
      }
    }
  }
  const ranked = [...fused.values()].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (right.entry.note.createdAt !== left.entry.note.createdAt) {
      return right.entry.note.createdAt - left.entry.note.createdAt;
    }
    return left.entry.note.id - right.entry.note.id;
  }).slice(0, args.limit);
  return ranked.map((entry) => ({
    source: "note",
    content: previewText(entry.entry.text),
    score: normalizeNoteKeywordScore(entry.score),
    noteId: entry.entry.note.id,
    status: entry.entry.note.status,
    createdAt: entry.entry.note.createdAt,
    anchorOrdinal: entry.entry.note.anchorOrdinal,
    sourceSessionId: entry.entry.note.sessionId
  }));
}
async function searchCompartmentChunks(args) {
  if (args.limit <= 0 || !args.modelId || args.modelId === "off") {
    if (args.timings)
      args.timings.chunkPool = "off";
    if (args.diagnostics)
      args.diagnostics.pool = "off";
    args.reportDiagnostics?.();
    return [];
  }
  if (!args.queryEmbedding) {
    if (args.timings)
      args.timings.chunkPool = "no-vector";
    if (args.diagnostics)
      args.diagnostics.pool = "no-vector";
    args.reportDiagnostics?.();
    if (args.warmOnly)
      warmCompartmentChunkSearchPool2(args.db, args.sessionId, args.projectPath, args.modelId);
    return [];
  }
  const cutoff = args.maxOrdinal != null && args.maxOrdinal >= 0 ? args.maxOrdinal : null;
  let rows;
  if (args.warmOnly) {
    const warm = peekCompartmentChunkSearchPool2(args.db, args.sessionId, args.projectPath, args.modelId, args.dateRange, args.diagnostics);
    if (warm === null) {
      if (args.timings)
        args.timings.chunkPool = "cold";
      if (args.diagnostics) {
        args.diagnostics.pool = "cold";
        args.diagnostics.poolRows = 0;
      }
      args.reportDiagnostics?.();
      warmCompartmentChunkSearchPool2(args.db, args.sessionId, args.projectPath, args.modelId);
      return [];
    }
    if (args.timings)
      args.timings.chunkPool = "warm";
    if (args.diagnostics) {
      args.diagnostics.pool = "warm";
      args.diagnostics.poolRows = warm.length;
    }
    args.reportDiagnostics?.();
    rows = warm;
  } else {
    try {
      rows = await loadCompartmentChunkEmbeddingsForSearch2(args.db, args.sessionId, args.projectPath, args.modelId, args.dateRange, args.signal);
    } catch (error) {
      if (args.signal?.aborted)
        return [];
      throw error;
    }
    if (args.timings)
      args.timings.chunkPool = "loaded";
  }
  if (rows.length === 0)
    return [];
  const byCompartment = new Map;
  let sliceStarted = performance.now();
  for (const row of rows) {
    if (performance.now() - sliceStarted >= 4) {
      await new Promise((resolve) => setImmediate(resolve));
      sliceStarted = performance.now();
    }
    if (cutoff !== null && row.endOrdinal > cutoff) {
      continue;
    }
    const score = normalizeCosineScore(cosineSimilarity(args.queryEmbedding, row.vector));
    if (score <= 0)
      continue;
    const existing = byCompartment.get(row.compartmentId);
    if (!existing || score > existing.score) {
      byCompartment.set(row.compartmentId, { row, score });
    }
  }
  return [...byCompartment.values()].sort((left, right) => right.score !== left.score ? right.score - left.score : left.row.startOrdinal - right.row.startOrdinal).slice(0, args.limit).map(({ row, score }) => ({
    source: "compartment",
    content: previewText(row.title),
    score: score * SINGLE_SOURCE_PENALTY,
    compartmentId: row.compartmentId,
    sessionId: row.sessionId,
    title: row.title,
    startOrdinal: row.startOrdinal,
    endOrdinal: row.endOrdinal,
    matchType: "semantic"
  }));
}
function mergeMessageAndCompartmentResults(args) {
  if (args.compartments.length === 0)
    return args.messages;
  if (args.messages.length === 0)
    return args.compartments;
  const fused = new Map;
  const add = (key, result, score, tieOrdinal) => {
    const existing = fused.get(key);
    if (existing) {
      existing.score += score;
      return existing;
    }
    const entry = { result, score, tieOrdinal, snippetScore: -1 };
    fused.set(key, entry);
    return entry;
  };
  args.compartments.forEach((compartment, rank) => {
    add(`compartment:${compartment.compartmentId}`, compartment, 1 / (RRF_K + rank), compartment.startOrdinal);
  });
  for (const [rank, message] of args.messages.entries()) {
    const containing = args.compartments.find((compartment) => message.messageOrdinal >= compartment.startOrdinal && message.messageOrdinal <= compartment.endOrdinal);
    const contribution = 1 / (RRF_K + rank);
    if (!containing) {
      add(`message:${message.messageId}`, message, contribution, message.messageOrdinal);
      continue;
    }
    const entry = add(`compartment:${containing.compartmentId}`, containing, contribution, containing.startOrdinal);
    if (message.score > entry.snippetScore && entry.result.source === "compartment") {
      entry.snippetScore = message.score;
      entry.result = {
        ...entry.result,
        matchType: "hybrid",
        snippet: message.content
      };
    }
  }
  const ranked = [...fused.values()].sort((left, right) => right.score !== left.score ? right.score - left.score : left.tieOrdinal - right.tieOrdinal).slice(0, args.limit);
  return ranked.map((entry) => entry.result);
}
function getSourceBoost(result) {
  switch (result.source) {
    case "memory":
      return MEMORY_SOURCE_BOOST;
    case "message":
    case "compartment":
      return MESSAGE_SOURCE_BOOST;
    case "git_commit":
      return GIT_COMMIT_SOURCE_BOOST;
    case "primer":
      return PRIMER_SOURCE_BOOST;
    case "note":
      return 1;
  }
}
function compareUnifiedResults(left, right) {
  const leftEffective = left.score * getSourceBoost(left);
  const rightEffective = right.score * getSourceBoost(right);
  if (rightEffective !== leftEffective) {
    return rightEffective - leftEffective;
  }
  if (left.source === "memory" && right.source === "memory") {
    return left.memoryId - right.memoryId;
  }
  if (left.source === "message" && right.source === "message") {
    return left.messageOrdinal - right.messageOrdinal;
  }
  if (left.source === "compartment" && right.source === "compartment") {
    return left.startOrdinal - right.startOrdinal;
  }
  if (left.source === "git_commit" && right.source === "git_commit") {
    return right.committedAtMs - left.committedAtMs;
  }
  if (left.source === "primer" && right.source === "primer") {
    return right.support - left.support || left.primerId - right.primerId;
  }
  if (left.source === "note" && right.source === "note") {
    return right.createdAt - left.createdAt || left.noteId - right.noteId;
  }
  return 0;
}
function toGitCommitResult(hit) {
  return {
    source: "git_commit",
    content: previewText(hit.commit.message),
    score: hit.score,
    sha: hit.commit.sha,
    shortSha: hit.commit.shortSha,
    author: hit.commit.author,
    committedAtMs: hit.commit.committedAtMs,
    matchType: hit.matchType
  };
}
function searchGitCommits(args) {
  if (args.limit <= 0)
    return [];
  const lanes = args.lanes;
  const hits = searchGitCommitsSync(args.db, args.projectPath, args.query, {
    limit: args.limit,
    queryEmbedding: args.queryEmbedding,
    queryModelId: args.queryModelId,
    from: args.dateRange?.from,
    to: args.dateRange?.to,
    captureLanes: lanes ? (fts, vector) => {
      lanes.git_fts = fts.map(toGitCommitResult);
      lanes.git_vector = vector.map(toGitCommitResult);
    } : undefined
  });
  return hits.map(toGitCommitResult);
}
function primerText(primer) {
  const answer = primer.answer.trim();
  return answer ? `Q: ${primer.question}
A: ${answer}` : `Q: ${primer.question}`;
}
function searchPrimers(args) {
  const primers = getActivePrimers(args.db, args.projectPath).filter((primer) => timestampIsInRange(primer.createdAt, args.dateRange));
  if (primers.length === 0 || args.limit <= 0)
    return [];
  const ftsQuery = sanitizeFtsQuery(args.query);
  const ftsRanks = new Map;
  if (ftsQuery) {
    const rows = args.db.prepare(`SELECT p.id AS id, bm25(primers_fts) AS rank
                 FROM primers_fts
                 JOIN primers p ON p.id = primers_fts.rowid
                  WHERE primers_fts MATCH ? AND p.project_path = ? AND p.status = 'active'
                    ${args.dateRange === null ? "" : "AND p.created_at BETWEEN ? AND ?"}
                  ORDER BY rank ASC
                  LIMIT ?`).all(ftsQuery, args.projectPath, ...args.dateRange === null ? [] : [args.dateRange.from, args.dateRange.to], args.lanes ? Math.max(args.limit * 3, 225) : args.limit * 3);
    const baselineRows = rows.slice(0, args.limit * 3);
    baselineRows.forEach((row, index) => {
      ftsRanks.set(row.id, linearDecayScore(index, baselineRows.length));
    });
    if (args.lanes) {
      const byId = new Map(primers.map((primer) => [primer.id, primer]));
      args.lanes.primer_fts = rows.flatMap((row, index) => {
        const primer = byId.get(row.id);
        return primer ? [
          {
            source: "primer",
            primerId: primer.id,
            content: previewText(primerText(primer)),
            question: primer.question,
            support: primer.totalSupport,
            lastObservedAt: primer.lastObservedAt,
            matchType: "fts",
            score: linearDecayScore(index, rows.length)
          }
        ] : [];
      }).slice(0, 25);
    }
  }
  const vectorResults = [];
  const scored = primers.map((primer) => {
    const semantic = args.queryEmbedding && primer.questionEmbedding && primer.questionEmbeddingModelId === args.queryModelId ? normalizeCosineScore(cosineSimilarity(args.queryEmbedding, primer.questionEmbedding)) : 0;
    if (args.lanes && semantic > 0)
      vectorResults.push({
        source: "primer",
        primerId: primer.id,
        content: previewText(primerText(primer)),
        question: primer.question,
        support: primer.totalSupport,
        lastObservedAt: primer.lastObservedAt,
        matchType: "semantic",
        score: semantic
      });
    const fts = ftsRanks.get(primer.id) ?? 0;
    if (semantic <= 0 && fts <= 0)
      return null;
    const score = semantic > 0 && fts > 0 ? semantic * SEMANTIC_WEIGHT + fts * FTS_WEIGHT : Math.max(semantic, fts);
    return {
      source: "primer",
      content: previewText(primerText(primer)),
      score,
      primerId: primer.id,
      question: primer.question,
      support: primer.totalSupport,
      lastObservedAt: primer.lastObservedAt,
      matchType: semantic > 0 && fts > 0 ? "hybrid" : semantic > 0 ? "semantic" : "fts"
    };
  }).filter((result) => result !== null).sort((a, b) => b.score - a.score || b.support - a.support || a.primerId - b.primerId).slice(0, args.limit);
  if (args.lanes)
    args.lanes.primer_vector = vectorResults.sort((a, b) => b.score - a.score || b.support - a.support || a.primerId - b.primerId).slice(0, 25);
  return scored;
}
function resolveSources(sources) {
  if (sources === undefined) {
    return new Set(["memory", "message", "git_commit", "primer", "note"]);
  }
  const set = new Set;
  for (const source of sources) {
    if (source === "memory" || source === "message" || source === "git_commit" || source === "primer" || source === "note") {
      set.add(source);
    }
  }
  return set;
}
function memoriesToIdLookupResults(args) {
  const ordered = args.memories.slice(0, args.limit);
  return ordered.map((memory, rank) => ({
    source: "memory",
    content: previewText(memory.content),
    score: 1 - rank * 0.01,
    memoryId: memory.id,
    category: memory.category,
    matchType: "fts",
    sourceName: args.sourceNameByMemoryId?.get(memory.id)
  }));
}
function resolveMemoriesByIdsForSearch2(args) {
  if (args.diagnostics) {
    args.diagnostics.suppressedVisibleMemoryIds = [];
  }
  if (args.ids.length === 0) {
    return null;
  }
  const workspace = resolveSearchWorkspaceContext(args.db, args.projectPath);
  const fetched = workspace.isWorkspaced ? getMemoriesByProjects2(args.db, workspace.expandedIdentities, ["active", "permanent", "archived"], Date.now(), workspace.ownIdentities, workspace.shareCategories) : getMemoriesByProject2(args.db, args.projectPath, ["active", "permanent", "archived"]);
  if (fetched.length === 0) {
    return null;
  }
  const dateRange = normalizeDateRange(args.from, args.to);
  const memoriesById = new Map(fetched.filter((memory) => timestampIsInRange(memory.createdAt, dateRange)).map((memory) => [memory.id, memory]));
  const ordered = [];
  const suppressedVisibleIds = new Set;
  for (const id of args.ids) {
    const memory = memoriesById.get(id);
    if (!memory)
      continue;
    if (args.visibleMemoryIds?.has(id)) {
      suppressedVisibleIds.add(id);
      continue;
    }
    ordered.push(memory);
    if (ordered.length >= args.limit)
      break;
  }
  if (args.diagnostics) {
    args.diagnostics.suppressedVisibleMemoryIds = [...suppressedVisibleIds].sort((left, right) => left - right);
  }
  if (ordered.length === 0) {
    return null;
  }
  return memoriesToIdLookupResults({
    memories: ordered,
    limit: args.limit,
    sourceNameByMemoryId: sourceNamesForSearchMemories({
      memories: ordered,
      projectPath: args.projectPath,
      workspace
    })
  });
}
async function unifiedSearch2(db, sessionId, projectPath, query, options = {}) {
  const messageIndexEpoch = getMessageIndexEpoch(sessionId);
  const messageIndexWasSearchable = isMessageIndexSearchable(sessionId);
  const messageIndexStillCurrent = () => messageIndexWasSearchable && isMessageIndexSearchable(sessionId) && getMessageIndexEpoch(sessionId) === messageIndexEpoch;
  const trimmedQuery = query.trim();
  const measurementStartedAt = Date.now();
  if (trimmedQuery.length === 0 || options.signal?.aborted) {
    return [];
  }
  const limit = normalizeLimit(options.limit);
  const reranker = options.explicitSearch && options.rerank !== false && isProseQuery(trimmedQuery) ? await prepareReranker(projectPath, sessionId, options.rerankConnectionFile, options.rerankClient, options.rerankConfig) : null;
  const lanes = reranker || options.captureRerankLanes ? emptySearchLanes() : undefined;
  const dateRange = normalizeDateRange(options.from, options.to);
  const tierLimit = Math.max(limit * 3, DEFAULT_UNIFIED_SEARCH_LIMIT);
  if (options.diagnostics) {
    options.diagnostics.suppressedVisibleMemoryIds = [];
    options.diagnostics.suppressedLiveMessageMatches = 0;
    options.diagnostics.gitCommitUnavailable = null;
  }
  const embeddingEnabled = options.embeddingEnabled ?? true;
  const embedQuery = options.embedQuery ?? embedText;
  const isEmbeddingRuntimeEnabled = options.isEmbeddingRuntimeEnabled ?? isEmbeddingEnabled;
  const gitCommitsEnabled = options.gitCommitsEnabled ?? false;
  const activeSources = resolveSources(options.sources);
  const memoryFeatureEnabled = options.memoryEnabled ?? true;
  const runMemory = activeSources.has("memory") && memoryFeatureEnabled;
  const runMessages = activeSources.has("message");
  const runGitCommits = activeSources.has("git_commit") && gitCommitsEnabled;
  if (options.diagnostics && activeSources.has("git_commit") && options.gitRepositoryAvailable === false) {
    options.diagnostics.gitCommitUnavailable = "no_git_repository";
  }
  const runPrimers = activeSources.has("primer") && memoryFeatureEnabled;
  const runNotes = activeSources.has("note");
  const runCompartmentChunks = runMessages && embeddingEnabled;
  const needsEmbedding = (runMemory || runGitCommits || runCompartmentChunks || runPrimers) && embeddingEnabled && isEmbeddingRuntimeEnabled();
  const queryEmbeddingPromise = needsEmbedding ? embedQuery(trimmedQuery, options.signal).catch((error) => {
    log2(`[search] query embedding failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }) : Promise.resolve(null);
  await Promise.resolve();
  if (options.signal?.aborted)
    return [];
  const messageProbes = options.explicitSearch ? extractLiteralProbes(trimmedQuery) : [];
  const timings = options.stepTimings;
  let stepStartedAt = performance.now();
  let messageResults = [];
  if (runMessages && messageIndexStillCurrent()) {
    const messageRequest = {
      sessionId,
      query: trimmedQuery,
      limit: tierLimit,
      captureLimit: lanes ? 75 : undefined,
      maxOrdinal: options.maxMessageOrdinal,
      probes: messageProbes,
      relaxedRecall: options.explicitSearch,
      collectDiagnostics: options.diagnostics !== undefined,
      dateRange
    };
    const delegated = options.searchMessageHistory ? await options.searchMessageHistory(messageRequest).catch((error) => {
      log2(`[search] off-thread message search failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }) : null;
    if (delegated && options.signal?.aborted)
      return [];
    const outcome = delegated ?? searchMessageHistory2(db, messageRequest);
    if (options.diagnostics) {
      options.diagnostics.suppressedLiveMessageMatches = outcome.suppressedLiveMessageMatches;
    }
    messageResults = outcome.results.filter((result) => result.messageId !== options.excludeMessageId);
    if (lanes)
      lanes.message_fts = (outcome.laneResults ?? outcome.results).slice(0, 25);
    if (timings)
      timings.messageMs = performance.now() - stepStartedAt;
    recordAutoSearchLane(options.autoSearchDiagnostics, "messages", trimmedQuery, messageResults);
    options.onAutoSearchDiagnostics?.();
  }
  stepStartedAt = performance.now();
  const capturedQuery = await queryEmbeddingPromise;
  if (timings && needsEmbedding)
    timings.vectorWaitMs = performance.now() - stepStartedAt;
  if (options.signal?.aborted)
    return [];
  const embeddingSnapshot = getProjectEmbeddingSnapshot2(projectPath);
  const queryContract = capturedQuery instanceof Float32Array || capturedQuery === null ? null : capturedQuery;
  const generationIsCurrent = queryContract === null || embeddingSnapshot !== null && embeddingSnapshot.generation === queryContract.generation;
  const queryEmbedding = generationIsCurrent ? queryContract?.vector ?? (capturedQuery instanceof Float32Array ? capturedQuery : null) : null;
  const workspace = resolveSearchWorkspaceContext(db, projectPath);
  const embeddingModelId = queryContract?.modelId ?? options.embeddingModelIdOverride ?? embeddingSnapshot?.modelId;
  const chunkModelId = queryContract?.chunkModelId ?? options.chunkModelIdOverride ?? embeddingSnapshot?.chunkModelId;
  stepStartedAt = performance.now();
  if (timings)
    timings.chunkPool = "off";
  if (options.autoSearchDiagnostics && !runCompartmentChunks)
    options.autoSearchDiagnostics.pool = "off";
  const compartmentResults = runCompartmentChunks ? await searchCompartmentChunks({
    db,
    sessionId,
    projectPath,
    queryEmbedding,
    limit: lanes ? Math.max(tierLimit, 25) : tierLimit,
    maxOrdinal: options.maxMessageOrdinal,
    modelId: chunkModelId && chunkModelId !== "off" ? chunkModelId : null,
    dateRange,
    warmOnly: options.chunkPoolWarmOnly,
    signal: options.signal,
    timings,
    diagnostics: options.autoSearchDiagnostics,
    reportDiagnostics: options.onAutoSearchDiagnostics
  }) : [];
  if (runCompartmentChunks)
    recordAutoSearchLane(options.autoSearchDiagnostics, "summaries", trimmedQuery, compartmentResults);
  options.onAutoSearchDiagnostics?.();
  if (timings && runCompartmentChunks)
    timings.chunkMs = performance.now() - stepStartedAt;
  stepStartedAt = performance.now();
  if (lanes)
    lanes.chunk_vector = compartmentResults.slice(0, 25);
  const messageLikeResults = mergeMessageAndCompartmentResults({
    messages: messageResults,
    compartments: compartmentResults.slice(0, tierLimit),
    limit: tierLimit
  });
  const [memoryOutcome, gitCommitResults, primerResults, noteResults] = await Promise.all([
    runMemory ? searchMemories({
      db,
      projectPath,
      query: trimmedQuery,
      limit: tierLimit,
      memoryEnabled: true,
      queryEmbedding,
      queryModelId: embeddingModelId && embeddingModelId !== "off" ? embeddingModelId : null,
      workspace,
      visibleMemoryIds: options.visibleMemoryIds,
      backfillMemoryEmbeddings: options.backfillMemoryEmbeddings,
      lanes,
      dateRange
    }) : Promise.resolve({
      results: [],
      suppressedVisibleIds: []
    }),
    runGitCommits ? Promise.resolve(searchGitCommits({
      db,
      projectPath,
      query: trimmedQuery,
      limit: tierLimit,
      queryEmbedding,
      queryModelId: embeddingModelId && embeddingModelId !== "off" ? embeddingModelId : null,
      dateRange,
      lanes
    })) : Promise.resolve([]),
    runPrimers ? Promise.resolve(searchPrimers({
      db,
      projectPath,
      query: trimmedQuery,
      limit: tierLimit,
      queryEmbedding,
      queryModelId: embeddingModelId && embeddingModelId !== "off" ? embeddingModelId : null,
      dateRange,
      lanes
    })) : Promise.resolve([]),
    runNotes ? Promise.resolve(searchNotes({
      db,
      sessionId,
      projectPath,
      query: trimmedQuery,
      limit: lanes ? Math.max(tierLimit, 25) : tierLimit,
      probes: messageProbes,
      dateRange
    })) : Promise.resolve([])
  ]);
  if (timings)
    timings.otherLanesMs = performance.now() - stepStartedAt;
  if (runMemory)
    recordAutoSearchLane(options.autoSearchDiagnostics, "memory", trimmedQuery, memoryOutcome.results);
  if (runGitCommits)
    recordAutoSearchLane(options.autoSearchDiagnostics, "git", trimmedQuery, gitCommitResults);
  options.onAutoSearchDiagnostics?.();
  if (options.diagnostics) {
    options.diagnostics.suppressedVisibleMemoryIds = memoryOutcome.suppressedVisibleIds;
  }
  let results = [
    ...memoryOutcome.results,
    ...primerResults,
    ...messageLikeResults,
    ...gitCommitResults,
    ...noteResults
  ].sort(compareUnifiedResults).slice(0, limit);
  const originalResults = results;
  const originalLatencyMs = Date.now() - measurementStartedAt;
  if (lanes) {
    lanes.notes = noteResults.slice(0, 25);
    options.captureRerankLanes?.(lanes);
  }
  if (reranker && lanes) {
    const pool = fuseSearchLanes(lanes).slice(0, "remote" in reranker ? reranker.remote.top_n : 20);
    try {
      results = await rerankSearchResults(reranker, trimmedQuery, results, pool, candidateTexts(db, sessionId, projectPath, pool), limit, options.signal, options.onRerankSkipped);
    } catch {
      if ("remote" in reranker)
        remoteRerankSkipped("candidate_validation", options.onRerankSkipped);
      else
        logRerankFallback("candidate_validation");
    }
  }
  if (!options.measurementDisabled) {
    recordShadowMeasurement({
      db,
      sessionId,
      projectPath,
      query: trimmedQuery,
      options: { ...options, rerank: false, captureRerankLanes: undefined },
      primaryResults: originalResults,
      primaryQuery: queryContract,
      primaryLatencyMs: originalLatencyMs,
      search: unifiedSearch2
    });
  }
  const countRetrievals = options.countRetrievals ?? true;
  if (countRetrievals) {
    const memoryIds = results.filter((result) => result.source === "memory").map((result) => result.memoryId);
    if (memoryIds.length > 0) {
      db.transaction(() => {
        for (const memoryId of memoryIds) {
          try {
            updateMemoryRetrievalCount2(db, memoryId);
          } catch (error) {
            if (error instanceof ModuleMemoryAuthorityError2)
              continue;
            throw error;
          }
        }
      }).immediate();
    }
  }
  if (!messageIndexStillCurrent())
    results = results.filter((result) => result.source !== "message");
  if (options.autoHint) {
    return results.map((result) => ({
      ...result,
      relevanceScore: autoSearchRelevance(trimmedQuery, result)
    }));
  }
  return results;
}
var SEARCH_NOTE_EXPAND_HINT = "Use ctx_expand(start=N-10, end=N) around any note @msg anchor above to read the surrounding conversation context.";
function formatSearchAge(timestampMs) {
  const ageMs = Date.now() - timestampMs;
  if (ageMs < 0)
    return "future";
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  if (days <= 0)
    return "today";
  if (days === 1)
    return "1d ago";
  if (days < 30)
    return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months === 1)
    return "1mo ago";
  if (months < 12)
    return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1y ago" : `${years}y ago`;
}
function formatUnifiedSearchResult(result, index, currentSessionId) {
  if (result.source === "memory") {
    const source = result.sourceName ? ` source=${result.sourceName}` : "";
    return [
      `[${index}] [memory] score=${result.score.toFixed(2)} id=${result.memoryId} category=${result.category}${source} match=${result.matchType}`,
      result.content
    ].join(`
`);
  }
  if (result.source === "git_commit") {
    return [
      `[${index}] [git_commit] score=${result.score.toFixed(2)} sha=${result.shortSha} ${formatSearchAge(result.committedAtMs)} match=${result.matchType}`,
      result.content
    ].join(`
`);
  }
  if (result.source === "primer") {
    return [
      `[${index}] [primer] score=${result.score.toFixed(2)} id=${result.primerId} support=${result.support} match=${result.matchType}`,
      result.content
    ].join(`
`);
  }
  if (result.source === "note") {
    const anchor = result.anchorOrdinal !== null && result.sourceSessionId === currentSessionId ? ` @msg ${result.anchorOrdinal}` : "";
    return [
      `[${index}] [note] score=${result.score.toFixed(2)} id=#${result.noteId} status=${result.status} ${formatSearchAge(result.createdAt)}${anchor}`,
      result.content
    ].join(`
`);
  }
  if (result.source === "compartment") {
    return [
      `[${index}] [message] score=${result.score.toFixed(2)} compartment_id=${result.compartmentId} range=${result.startOrdinal}-${result.endOrdinal} match=${result.matchType} title=${result.title}`,
      result.snippet ? `Snippet: ${result.snippet}` : result.content
    ].join(`
`);
  }
  const expandStart = Math.max(1, result.messageOrdinal - 3);
  const expandEnd = result.messageOrdinal + 3;
  return [
    `[${index}] [message] score=${result.score.toFixed(2)} ordinal=${result.messageOrdinal} range=${expandStart}-${expandEnd} role=${result.role}`,
    result.content
  ].join(`
`);
}
function formatSearchDiagnosticLines(results, diagnostics) {
  if (!diagnostics)
    return [];
  const lines = [];
  const visibleIds = [...diagnostics.suppressedVisibleMemoryIds].sort((left, right) => left - right);
  if (visibleIds.length > 0) {
    const count = visibleIds.length;
    const noun = count === 1 ? "match" : "matches";
    const ids = visibleIds.join(", ");
    if (results.some((result) => result.source === "memory")) {
      lines.push(`Memories: ${count} additional ${noun} suppressed because ${count === 1 ? "it is" : "they are"} already visible in your project-memory block (ids ${ids}).`);
    } else {
      lines.push(`Memories: ${count} ${noun} found, all already visible in your project-memory block (ids ${ids}).`);
    }
  }
  if (diagnostics.suppressedLiveMessageMatches > 0) {
    const count = diagnostics.suppressedLiveMessageMatches;
    lines.push(`Message history: ${count} raw-message ${count === 1 ? "match is" : "matches are"} newer than the last compartment boundary (already in your context).`);
  }
  if (diagnostics.gitCommitUnavailable === "no_git_repository") {
    lines.push("Git commits: no git repository — commit search unavailable for this project.");
  }
  return lines;
}
function formatSearchResults2(query, results, currentSessionId, diagnostics) {
  const diagnosticLines = formatSearchDiagnosticLines(results, diagnostics);
  if (results.length === 0) {
    if (diagnosticLines.length > 0) {
      return `No hidden results found for "${query}".

${diagnosticLines.join(`
`)}`;
    }
    return `No results found for "${query}" across notes, memories, primers, git commits, or message history.`;
  }
  const bodyParts = results.map((result, index) => formatUnifiedSearchResult(result, index + 1, currentSessionId));
  if (diagnosticLines.length > 0)
    bodyParts.push(diagnosticLines.join(`
`));
  if (results.some((result) => result.source === "message" || result.source === "compartment")) {
    bodyParts.push("Use ctx_expand(start, end) with the range from any message result above to read the conversation context. If the host no longer holds those messages, ctx_expand returns indexed text from the search archive only, with no surrounding messages or tool output.");
  }
  if (results.some((result) => result.source === "note" && result.anchorOrdinal !== null && result.sourceSessionId === currentSessionId)) {
    bodyParts.push(SEARCH_NOTE_EXPAND_HINT);
  }
  return `Found ${results.length} result${results.length === 1 ? "" : "s"} for "${query}":

${bodyParts.join(`

`)}`;
}

export { USER_FACING_FAILURES, renderUserFacingFailure, userFacingFailureCode, renderCapabilityRefusal, renderDreamFailure, dreamFailureCode, renderEmbeddingFailure, renderSingleStoreMigrationRequiredRefusal, SingleStoreMigrationRequiredError, projectNeedsSingleStoreMigration, cosineSimilarity, promoteSessionFactsDurable, embedPromotedFacts, recordMemoryMapping, recordMemoryVerifications, getUnmappedMemoryIds, clearMemoryVerifications, getMemoryVerifications, resolveGitTopLevel, readGitHead, readGitChangedFilesSince, readGitFileChangeTimesSince, verificationFileExists, normalizeVerificationFiles, indexCommitsForProject, embedUnembeddedCommits, getMessageIndexEpoch, isMessageIndexSearchable, scheduleReconciliation, scheduleIncrementalIndex, scheduleClearAndReindex, clearSessionTracking, createAutoSearchDiagnostics, createUnifiedSearchDiagnostics2, searchMessageHistory2, parseIdShapedQuery2, resolveMemoriesByIdsForSearch2, unifiedSearch2, formatSearchResults2 };
