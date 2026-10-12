import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  embeddingModelsMatch,
  resolveEmbeddingTextPrefixes,
  getEmbeddingProviderIdentity,
  dominantEmbeddingFailure,
  LocalEmbeddingProvider
} from "./index-yy0h7gp8.js";
import {
  withSqliteBackgroundWriter2,
  withoutSqliteTransformPass2,
  isTransientSqliteError2
} from "./index-3cgbv47m.js";
import {
  isEmbeddingHostBusy2
} from "./index-9p40dgkm.js";
import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  sanitizeDiagnosticText,
  log2
} from "./index-f956htf3.js";
import {
  estimateTokens
} from "./index-xwgrhenf.js";
import {
  SYNAPSE_DEFAULT_MODEL,
  isSynapseEmbeddingTruncated,
  getSynapseBatchRequestKey,
  SynapseEmbeddingProvider
} from "./index-7neahsnb.js";
import {
  CHUNK_WINDOW_SAFETY_RATIO,
  normalizeCompartmentChunkMaxInputTokens,
  buildCanonicalChunkTextFromFts,
  buildCompartmentSummaryFallbackText,
  chunkCanonicalText,
  chunkEmbeddingWindowsAreCurrent,
  replaceCompartmentChunkEmbeddings,
  loadUnembeddedShadowChunkCandidates,
  loadUnembeddedCompartmentChunkCandidatesPolite,
  recordChunkEmbedBackoff,
  chunkWindowSourceKey,
  loadUnembeddedSessionChunkCandidatesPolite,
  countSessionCompartmentEmbedCoverage,
  countSessionCompartmentEmbedCoveragePolite,
  countUnembeddedSessionCompartmentsPolite
} from "./index-zmyrvs22.js";
import {
  saveEmbeddingIfHashMatches,
  getMemoryEmbedCoverage,
  invalidateProject2
} from "./index-yhzhdp3m.js";
import {
  isUserHomeDirectory,
  setBootQuietPeriodForTests
} from "./index-dkx0b1kt.js";
import {
  logSlowWriteTransaction
} from "./index-fp37he9a.js";

// ../plugin/src/features/magic-context/project-embedding-registry.ts
import { createHash as createHash2, randomUUID } from "node:crypto";

// ../plugin/src/shared/background-batch-drain.ts
async function drainBackgroundBatches(step, options = {}) {
  const now = options.now ?? (() => performance.now());
  const deadline = now() + (options.budgetMs ?? 2000);
  const yieldFn = options.yieldFn ?? (() => new Promise((resolve) => setTimeout(resolve, 0)));
  let batches = 0;
  while (now() < deadline) {
    try {
      if (!withoutSqliteTransformPass2(() => withSqliteBackgroundWriter2(step)))
        break;
    } catch (error) {
      if (isTransientSqliteError2(error))
        break;
      throw error;
    }
    batches++;
    await yieldFn();
  }
  return batches;
}

// ../plugin/src/features/magic-context/git-commits/storage-git-commit-embeddings.ts
var saveStatements = new WeakMap;
var loadProjectStatements = new WeakMap;
var loadUnembeddedStatements = new WeakMap;
var countEmbeddedStatements = new WeakMap;
function getSaveStatement(db) {
  let stmt = saveStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`INSERT INTO git_commit_embeddings (sha, embedding, model_id, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(sha, model_id) DO UPDATE SET
                  embedding = excluded.embedding,
                  created_at = excluded.created_at`);
    saveStatements.set(db, stmt);
  }
  return stmt;
}
function getLoadProjectStatement(db) {
  let stmt = loadProjectStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT e.sha AS sha, e.embedding AS embedding, e.model_id AS model_id
             FROM git_commit_embeddings e
             JOIN git_commits c ON c.sha = e.sha
             WHERE c.project_path = ? AND e.model_id = ?`);
    loadProjectStatements.set(db, stmt);
  }
  return stmt;
}
function getLoadUnembeddedStatement(db) {
  let stmt = loadUnembeddedStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT c.sha AS sha, c.message AS message
             FROM git_commits c
             LEFT JOIN git_commit_embeddings e ON c.sha = e.sha AND e.model_id = ?
             WHERE c.project_path = ? AND e.sha IS NULL
             ORDER BY c.committed_at DESC
             LIMIT ?`);
    loadUnembeddedStatements.set(db, stmt);
  }
  return stmt;
}
function getCountEmbeddedStatement(db) {
  let stmt = countEmbeddedStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT COUNT(*) AS count FROM git_commit_embeddings e
             JOIN git_commits c ON c.sha = e.sha WHERE c.project_path = ? AND e.model_id = ?`);
    countEmbeddedStatements.set(db, stmt);
  }
  return stmt;
}
function saveCommitEmbedding(db, sha, embedding, modelId) {
  const bytes = new Uint8Array(embedding.buffer, embedding.byteOffset, embedding.byteLength);
  getSaveStatement(db).run(sha, bytes, modelId, Date.now());
}
function loadProjectCommitEmbeddings(db, projectPath, modelId) {
  const rows = getLoadProjectStatement(db).all(projectPath, modelId);
  const map = new Map;
  for (const row of rows) {
    const buffer = row.embedding.buffer.slice(row.embedding.byteOffset, row.embedding.byteOffset + row.embedding.byteLength);
    map.set(row.sha, new Float32Array(buffer));
  }
  return map;
}
function loadUnembeddedCommits(db, projectPath, modelId, limit) {
  return getLoadUnembeddedStatement(db).all(modelId, projectPath, limit);
}
function countEmbeddedCommits(db, projectPath, modelId) {
  const row = getCountEmbeddedStatement(db).get(projectPath, modelId);
  return row?.count ?? 0;
}

// ../plugin/src/features/magic-context/git-commits/storage-git-commits.ts
var insertStatements = new WeakMap;
var existingShasStatements = new WeakMap;
var projectCountStatements = new WeakMap;
var evictOverflowStatements = new WeakMap;
var latestCommitTimeStatements = new WeakMap;
var latestCommitShaStatements = new WeakMap;
function getInsertStatement(db) {
  let stmt = insertStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`INSERT INTO git_commits (sha, project_path, short_sha, message, author, committed_at, indexed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(sha) DO UPDATE SET
                 project_path = excluded.project_path,
                 short_sha = excluded.short_sha,
                 message = excluded.message,
                 author = excluded.author,
                 committed_at = excluded.committed_at,
                 indexed_at = excluded.indexed_at
             WHERE git_commits.message != excluded.message`);
    insertStatements.set(db, stmt);
  }
  return stmt;
}
function getExistingShasStatement(db) {
  let stmt = existingShasStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT sha FROM git_commits WHERE project_path = ?");
    existingShasStatements.set(db, stmt);
  }
  return stmt;
}
function getProjectCountStatement(db) {
  let stmt = projectCountStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT COUNT(*) AS count FROM git_commits WHERE project_path = ?");
    projectCountStatements.set(db, stmt);
  }
  return stmt;
}
function getLatestCommitShaStatement(db) {
  let stmt = latestCommitShaStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT sha FROM git_commits WHERE project_path = ? ORDER BY committed_at DESC, sha DESC LIMIT 1");
    latestCommitShaStatements.set(db, stmt);
  }
  return stmt;
}
function getEvictOverflowStatement(db) {
  let stmt = evictOverflowStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`DELETE FROM git_commits
             WHERE rowid IN (
                 SELECT rowid FROM git_commits
                 WHERE project_path = ?
                 ORDER BY committed_at DESC, sha DESC
                 LIMIT -1 OFFSET ?
             )`);
    evictOverflowStatements.set(db, stmt);
  }
  return stmt;
}
function upsertCommits(db, projectPath, commits) {
  if (commits.length === 0)
    return { inserted: 0, updated: 0 };
  const existing = new Set;
  for (const row of getExistingShasStatement(db).all(projectPath)) {
    existing.add(row.sha);
  }
  let inserted = 0;
  let updated = 0;
  const now = Date.now();
  const insertStmt = getInsertStatement(db);
  db.transaction(() => {
    for (const commit of commits) {
      const result = insertStmt.run(commit.sha, projectPath, commit.shortSha, commit.message, commit.author, commit.committedAtMs, now);
      if (result.changes > 0) {
        if (existing.has(commit.sha)) {
          updated++;
        } else {
          inserted++;
          existing.add(commit.sha);
        }
      }
    }
  }).immediate();
  return { inserted, updated };
}
function getCommitCount(db, projectPath) {
  const row = getProjectCountStatement(db).get(projectPath);
  return row?.count ?? 0;
}
function getLatestIndexedCommitSha(db, projectPath) {
  const row = getLatestCommitShaStatement(db).get(projectPath);
  return row?.sha ?? null;
}
function enforceProjectCap(db, projectPath, maxCommits) {
  if (maxCommits <= 0)
    return 0;
  const count = getCommitCount(db, projectPath);
  if (count <= maxCommits)
    return 0;
  getEvictOverflowStatement(db).run(projectPath, maxCommits);
  const after = getCommitCount(db, projectPath);
  const evicted = Math.max(0, count - after);
  if (evicted > 0) {
    log2(`[git-commits] evicted ${evicted} oldest commits for project ${projectPath} (cap=${maxCommits}, was=${count})`);
  }
  return evicted;
}

// ../plugin/src/features/magic-context/git-commits/sweep-coordinator.ts
var GIT_SWEEP_COOLDOWN_MS = 10 * 60 * 1000;
var GIT_SWEEP_LEASE_TTL_MS = 5 * 60 * 1000;
var GIT_SWEEP_NON_INDEXABLE_REPROBE_MS = 24 * 60 * 60 * 1000;
var GIT_SWEEP_LEASE_RENEWAL_MS = 60 * 1000;
function runImmediate(db, body) {
  db.exec("BEGIN IMMEDIATE");
  const transactionStartedAt = performance.now();
  let committed = false;
  try {
    const result = body();
    db.exec("COMMIT");
    committed = true;
    logSlowWriteTransaction("git_sweep_lease", transactionStartedAt);
    return result;
  } finally {
    if (!committed) {
      try {
        db.exec("ROLLBACK");
      } catch {}
    }
  }
}
function rowToState(row) {
  return {
    projectPath: row.project_path,
    leaseHolder: row.lease_holder,
    leaseExpiresAt: row.lease_expires_at,
    lastSweptAt: row.last_swept_at
  };
}
function getGitSweepCoordinatorState(db, projectPath) {
  const row = db.prepare(`SELECT project_path, lease_holder, lease_expires_at, last_swept_at
             FROM git_sweep_coordinator
             WHERE project_path = ?`).get(projectPath);
  return row ? rowToState(row) : null;
}
function acquireGitSweepLease(db, projectPath, holderId, options = {}) {
  const cooldownMs = options.cooldownMs ?? GIT_SWEEP_COOLDOWN_MS;
  const leaseTtlMs = options.leaseTtlMs ?? GIT_SWEEP_LEASE_TTL_MS;
  return runImmediate(db, () => {
    const now = Date.now();
    const row = getGitSweepCoordinatorState(db, projectPath);
    if (row?.leaseHolder && row.leaseExpiresAt !== null && row.leaseExpiresAt > now) {
      return {
        acquired: false,
        projectPath,
        reason: "lease_active",
        leaseHolder: row.leaseHolder,
        leaseExpiresAt: row.leaseExpiresAt,
        lastSweptAt: row.lastSweptAt,
        nextAllowedAt: null
      };
    }
    if (!options.ignoreCooldown && row?.lastSweptAt !== null && row?.lastSweptAt !== undefined) {
      const nextAllowedAt = row.lastSweptAt + cooldownMs;
      if (nextAllowedAt > now) {
        return {
          acquired: false,
          projectPath,
          reason: "cooldown_active",
          leaseHolder: row.leaseHolder,
          leaseExpiresAt: row.leaseExpiresAt,
          lastSweptAt: row.lastSweptAt,
          nextAllowedAt
        };
      }
    }
    const leaseExpiresAt = now + leaseTtlMs;
    db.prepare(`INSERT INTO git_sweep_coordinator (
                 project_path,
                 lease_holder,
                 lease_expires_at,
                 last_swept_at
             ) VALUES (?, ?, ?, NULL)
             ON CONFLICT(project_path) DO UPDATE SET
                 lease_holder = excluded.lease_holder,
                 lease_expires_at = excluded.lease_expires_at`).run(projectPath, holderId, leaseExpiresAt);
    return {
      acquired: true,
      projectPath,
      holderId,
      acquiredAt: now,
      leaseExpiresAt
    };
  });
}
function renewGitSweepLease(db, projectPath, holderId, leaseTtlMs = GIT_SWEEP_LEASE_TTL_MS) {
  return runImmediate(db, () => {
    const now = Date.now();
    const leaseExpiresAt = now + leaseTtlMs;
    const result = db.prepare(`UPDATE git_sweep_coordinator
                 SET lease_expires_at = ?
                 WHERE project_path = ?
                   AND lease_holder = ?
                   AND lease_expires_at > ?`).run(leaseExpiresAt, projectPath, holderId, now);
    return result.changes === 1;
  });
}
function markGitSweepSuccessAndRelease(db, projectPath, holderId) {
  return runImmediate(db, () => {
    const now = Date.now();
    const result = db.prepare(`UPDATE git_sweep_coordinator
                 SET lease_holder = NULL,
                     lease_expires_at = NULL,
                     last_swept_at = ?
                 WHERE project_path = ?
                   AND lease_holder = ?
                   AND lease_expires_at > ?`).run(now, projectPath, holderId, now);
    return result.changes === 1;
  });
}
function parkGitSweepNonIndexable(db, projectPath, holderId, reprobeMs = GIT_SWEEP_NON_INDEXABLE_REPROBE_MS) {
  return runImmediate(db, () => {
    const now = Date.now();
    const sweptAt = now + reprobeMs - GIT_SWEEP_COOLDOWN_MS;
    const result = db.prepare(`UPDATE git_sweep_coordinator
                 SET lease_holder = NULL,
                     lease_expires_at = NULL,
                     last_swept_at = ?
                 WHERE project_path = ?
                   AND lease_holder = ?
                   AND lease_expires_at > ?`).run(sweptAt, projectPath, holderId, now);
    return result.changes === 1;
  });
}
function releaseGitSweepLease(db, projectPath, holderId) {
  runImmediate(db, () => {
    db.prepare(`UPDATE git_sweep_coordinator
             SET lease_holder = NULL,
                 lease_expires_at = NULL
             WHERE project_path = ?
               AND lease_holder = ?`).run(projectPath, holderId);
  });
}

// ../plugin/src/features/magic-context/memory/embedding-ssrf.ts
var METADATA_HOSTNAMES = new Set(["metadata.google.internal", "metadata.goog"]);
var IPV6_METADATA_HOSTS = new Set(["fd00:ec2::254"]);
function isLinkLocalIpv4(host) {
  return /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host);
}
function ipv4FromMappedIpv6(host) {
  const m = /^::ffff:(.+)$/.exec(host);
  if (!m)
    return null;
  const tail = m[1];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(tail))
    return tail;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
  if (hex) {
    const hi = Number.parseInt(hex[1], 16);
    const lo = Number.parseInt(hex[2], 16);
    if (Number.isNaN(hi) || Number.isNaN(lo))
      return null;
    return `${hi >> 8 & 255}.${hi & 255}.${lo >> 8 & 255}.${lo & 255}`;
  }
  return null;
}
function blockedEmbeddingEndpointReason(endpoint) {
  const trimmed = endpoint.trim();
  if (trimmed.length === 0)
    return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return `embedding endpoint is not a valid URL: ${trimmed}`;
  }
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (METADATA_HOSTNAMES.has(host)) {
    return `embedding endpoint host ${host} is a cloud metadata service (blocked)`;
  }
  if (IPV6_METADATA_HOSTS.has(host)) {
    return `embedding endpoint host ${host} is the AWS IPv6 metadata service (blocked)`;
  }
  if (isLinkLocalIpv4(host)) {
    return `embedding endpoint host ${host} is link-local / cloud metadata (blocked)`;
  }
  const mappedV4 = ipv4FromMappedIpv6(host);
  if (mappedV4 && isLinkLocalIpv4(mappedV4)) {
    return `embedding endpoint host ${host} (IPv4-mapped ${mappedV4}) is link-local / cloud metadata (blocked)`;
  }
  if (host.startsWith("fe80:")) {
    return `embedding endpoint host ${host} is link-local / cloud metadata (blocked)`;
  }
  return null;
}

// ../plugin/src/features/magic-context/memory/embedding-openai.ts
function responseSlots(items, inputCount) {
  if (items.every((item) => item?.index === undefined)) {
    return items.map((_, position) => position);
  }
  const slots = [];
  const seen = new Set;
  for (const item of items) {
    const index = item?.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= inputCount || seen.has(index)) {
      return null;
    }
    seen.add(index);
    slots.push(index);
  }
  return slots;
}
function capEmbeddingInput(input, maxInputTokens, purpose) {
  const ratio = purpose === "query" ? CHUNK_WINDOW_SAFETY_RATIO : 1;
  const budget = Math.max(1, Math.floor(maxInputTokens * ratio));
  if (estimateTokens(input) <= budget)
    return input;
  let low = 0;
  let high = input.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTokens(input.slice(0, mid)) <= budget)
      low = mid;
    else
      high = mid - 1;
  }
  if (low > 0 && low < input.length) {
    const last = input.charCodeAt(low - 1);
    const next = input.charCodeAt(low);
    if (last >= 55296 && last <= 56319 && next >= 56320 && next <= 57343)
      low -= 1;
  }
  return input.slice(0, low);
}
function normalizeEndpoint(endpoint) {
  return endpoint?.trim().replace(/\/+$/, "") ?? "";
}
var FAILURE_THRESHOLD = 3;
var FAILURE_WINDOW_MS = 60000;
var OPEN_DURATION_MS = 5 * 60000;
var FETCH_TIMEOUT_MS = 30000;

class OpenAICompatibleEmbeddingProvider {
  modelId;
  maxInputTokens;
  endpoint;
  model;
  apiKey;
  inputType;
  queryInputType;
  queryPrefix;
  documentPrefix;
  truncate;
  initialized = false;
  failureTimes = [];
  circuitOpenUntil = 0;
  openLogged = false;
  modelMismatchLogged = false;
  lastFailureReason = null;
  halfOpenProbeInFlight = false;
  queryTruncationLogged = false;
  constructor(options) {
    this.endpoint = normalizeEndpoint(options.endpoint);
    this.model = options.model?.trim() ?? "";
    this.apiKey = options.apiKey?.trim() ?? "";
    this.inputType = options.inputType?.trim() ?? "";
    this.queryInputType = options.queryInputType?.trim() ?? "";
    const prefixes = resolveEmbeddingTextPrefixes(this.model, options.queryInstruction, options.documentPrefix);
    this.queryPrefix = prefixes.queryPrefix;
    this.documentPrefix = prefixes.documentPrefix;
    this.truncate = options.truncate?.trim() ?? "";
    this.maxInputTokens = typeof options.maxInputTokens === "number" && Number.isFinite(options.maxInputTokens) ? Math.max(1, Math.floor(options.maxInputTokens)) : 512;
    this.modelId = getEmbeddingProviderIdentity({
      provider: "openai-compatible",
      endpoint: this.endpoint,
      model: this.model,
      ...this.apiKey ? { api_key: this.apiKey } : {},
      ...this.inputType ? { input_type: this.inputType } : {},
      ...options.documentPrefix !== undefined ? { document_prefix: options.documentPrefix } : {},
      ...this.truncate ? { truncate: this.truncate } : {}
    });
  }
  async initialize() {
    if (this.initialized)
      return true;
    if (!this.endpoint || !this.model) {
      log2("[magic-context] openai-compatible embedding provider is missing endpoint or model");
      this.initialized = false;
      return false;
    }
    const blockedReason = blockedEmbeddingEndpointReason(this.endpoint);
    if (blockedReason) {
      log2(`[magic-context] embedding endpoint blocked: ${blockedReason}`);
      this.initialized = false;
      return false;
    }
    this.initialized = true;
    return true;
  }
  resolveInputTypeForPurpose(purpose = "passage") {
    if (purpose === "query") {
      return this.queryInputType || this.inputType;
    }
    return this.inputType;
  }
  async embed(text, signal, purpose) {
    const [embedding] = await this.embedBatch([text], signal, purpose);
    return embedding ?? null;
  }
  async embedBatch(texts, signal, purpose) {
    if (texts.length === 0) {
      return [];
    }
    const textPrefix = purpose === "query" ? this.queryPrefix : this.documentPrefix;
    const requestTexts = texts.map((text) => {
      const input = `${textPrefix}${text.trim().length === 0 ? " " : text}`;
      const capped = capEmbeddingInput(input, this.maxInputTokens, purpose);
      if (purpose === "query" && capped.length < input.length && !this.queryTruncationLogged) {
        log2(`[magic-context] embedding query truncated from ${input.length} to ${capped.length} characters to fit max_input_tokens`);
        this.queryTruncationLogged = true;
      }
      return capped;
    });
    if (!await this.initialize()) {
      return Array.from({ length: texts.length }, () => null);
    }
    if (signal?.aborted) {
      return Array.from({ length: texts.length }, () => null);
    }
    let isProbe = false;
    let internalController;
    let timeoutHandle;
    let onOuterAbort;
    try {
      const claim = this.claimProbeOrShortCircuit();
      if (claim === "short_circuit") {
        return Array.from({ length: texts.length }, () => null);
      }
      isProbe = claim === "probe";
      internalController = new AbortController;
      timeoutHandle = setTimeout(() => internalController?.abort(), FETCH_TIMEOUT_MS);
      onOuterAbort = () => internalController?.abort();
      if (signal) {
        signal.addEventListener("abort", onOuterAbort, { once: true });
      }
      const inputTypeForRequest = this.resolveInputTypeForPurpose(purpose);
      const response = await fetch(`${this.endpoint}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}
        },
        body: JSON.stringify({
          model: this.model,
          input: requestTexts,
          ...inputTypeForRequest ? { input_type: inputTypeForRequest } : {},
          ...this.truncate ? { truncate: this.truncate } : {}
        }),
        redirect: "error",
        signal: internalController.signal
      });
      if (!response.ok) {
        const excerpt = await response.text().catch(() => "");
        const failure = this.failure("http_error", `HTTP ${response.status} from endpoint${this.bodyExcerpt(excerpt)}`, response.status >= 500 || response.status === 408 || response.status === 429);
        log2(`[magic-context] openai-compatible embedding request failed: ${failure.reason}`);
        this.recordFailure(isProbe, failure);
        return Array.from({ length: texts.length }, () => null);
      }
      const rawBody = await response.text();
      if (rawBody.trim().length === 0) {
        const failure = this.failure("invalid_envelope", "response body was empty", false);
        log2(`[magic-context] openai-compatible embedding request failed: ${failure.reason}`);
        this.recordFailure(isProbe, failure);
        return Array.from({ length: texts.length }, () => null);
      }
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        const failure = this.failure("invalid_envelope", `response body was not valid JSON${this.bodyExcerpt(rawBody)}`, false);
        log2(`[magic-context] openai-compatible embedding request failed: ${failure.reason}`);
        this.recordFailure(isProbe, failure);
        return Array.from({ length: texts.length }, () => null);
      }
      const servedModel = typeof body.model === "string" ? body.model : "";
      if (this.model && servedModel && !embeddingModelsMatch(servedModel, this.model)) {
        if (!this.modelMismatchLogged) {
          log2(`[magic-context] embedding endpoint served a DIFFERENT model than requested — refusing the substituted vectors (they have the wrong dimensions/space). requested="${sanitizeDiagnosticText(this.model)}" served="${sanitizeDiagnosticText(servedModel)}". Check that the endpoint serves the requested model; variant suffixes and vendor prefixes are matched automatically.`);
          this.modelMismatchLogged = true;
        }
        this.recordFailure(isProbe, this.failure("substitution_rejected", `served model '${sanitizeDiagnosticText(servedModel)}' does not match requested '${sanitizeDiagnosticText(this.model)}' (substitution guard)`, false));
        return Array.from({ length: texts.length }, () => null);
      }
      const responseKeys = Object.keys(body).sort();
      if (!Array.isArray(body.data)) {
        const failure = this.failure("invalid_envelope", `response had keys [${responseKeys.join(", ")}] but data[] was absent`, false);
        log2(`[magic-context] openai-compatible embedding request failed: ${failure.reason}`);
        this.recordFailure(isProbe, failure);
        return Array.from({ length: texts.length }, () => null);
      }
      if (body.data.length === 0) {
        const failure = this.failure("empty_result", "response data[] was empty", true);
        log2(`[magic-context] openai-compatible embedding request failed: ${failure.reason}`);
        this.recordFailure(isProbe, failure);
        return Array.from({ length: texts.length }, () => null);
      }
      const slots = responseSlots(body.data, texts.length);
      if (!slots) {
        const failure = this.failure("invalid_envelope", "response data[].index values were missing, duplicated or out of range", false);
        log2(`[magic-context] openai-compatible embedding request failed: ${failure.reason}`);
        this.recordFailure(isProbe, failure);
        return Array.from({ length: texts.length }, () => null);
      }
      const results = Array.from({ length: texts.length }, () => null);
      body.data.forEach((item, position) => {
        const embedding = item?.embedding;
        const slot = slots[position];
        if (slot !== undefined && slot < results.length && Array.isArray(embedding)) {
          results[slot] = Float32Array.from(embedding);
        }
      });
      if (results.every((r) => r === null)) {
        const failure = this.failure("invalid_envelope", `response had keys [${responseKeys.join(", ")}] but data[].embedding was absent`, false);
        log2(`[magic-context] openai-compatible embedding request failed: ${failure.reason}`);
        this.recordFailure(isProbe, failure);
      } else {
        this.recordSuccess();
      }
      return results;
    } catch (error) {
      const isAbort = error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"));
      if (isAbort) {
        if (signal?.aborted) {} else {
          log2(`[magic-context] openai-compatible embedding request timed out after ${FETCH_TIMEOUT_MS}ms`);
          const failure = this.failure("transport_error", `request timed out after ${FETCH_TIMEOUT_MS}ms`, true);
          this.recordFailure(isProbe, failure);
        }
      } else {
        const detail = error instanceof Error ? error.message : String(error);
        const failure = this.failure("transport_error", `transport error: ${sanitizeDiagnosticText(detail)}`, true);
        log2(`[magic-context] openai-compatible embedding request failed: ${failure.reason}`);
        this.recordFailure(isProbe, failure);
      }
      return Array.from({ length: texts.length }, () => null);
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
      if (signal && onOuterAbort) {
        signal.removeEventListener("abort", onOuterAbort);
      }
      if (isProbe) {
        this.halfOpenProbeInFlight = false;
      }
    }
  }
  async dispose() {
    this.initialized = false;
  }
  isLoaded() {
    return this.initialized;
  }
  claimProbeOrShortCircuit() {
    if (this.circuitOpenUntil === 0) {
      return "allow";
    }
    if (Date.now() < this.circuitOpenUntil) {
      return "short_circuit";
    }
    if (this.halfOpenProbeInFlight) {
      return "short_circuit";
    }
    this.halfOpenProbeInFlight = true;
    log2(`[magic-context] openai-compatible embedding: circuit half-open, probing endpoint after ${this.lastFailureReason?.reason ?? "unknown failure"}`);
    return "probe";
  }
  failure(failureClass, reason, retryable) {
    return { class: failureClass, reason, retryable };
  }
  bodyExcerpt(body) {
    const excerpt = sanitizeDiagnosticText(body).replace(/\s+/g, " ").trim().slice(0, 200);
    return excerpt ? `: ${excerpt}` : "";
  }
  recordFailure(isProbe, failure) {
    if (failure)
      this.lastFailureReason = failure;
    if (isProbe) {
      this.circuitOpenUntil = Date.now() + OPEN_DURATION_MS;
      if (!this.openLogged) {
        log2(`[magic-context] openai-compatible embedding: probe failed (${failure?.reason ?? this.lastFailureReason?.reason ?? "unknown failure"}), re-opening circuit for ${OPEN_DURATION_MS / 60000}min`);
        this.openLogged = true;
      }
      this.failureTimes = [];
      return;
    }
    const now = Date.now();
    const cutoff = now - FAILURE_WINDOW_MS;
    this.failureTimes = this.failureTimes.filter((t) => t > cutoff);
    this.failureTimes.push(now);
    if (this.failureTimes.length >= FAILURE_THRESHOLD) {
      this.circuitOpenUntil = now + OPEN_DURATION_MS;
      if (!this.openLogged) {
        log2(`[magic-context] openai-compatible embedding: opening circuit for ${OPEN_DURATION_MS / 60000}min after ${this.failureTimes.length} failures in ${FAILURE_WINDOW_MS / 1000}s (${failure?.reason ?? this.lastFailureReason?.reason ?? "unknown failure"})`);
        this.openLogged = true;
      }
      this.failureTimes = [];
    }
  }
  recordSuccess() {
    if (this.failureTimes.length > 0 || this.circuitOpenUntil > 0 || this.openLogged) {
      log2("[magic-context] openai-compatible embedding: endpoint recovered, circuit closed");
    }
    this.failureTimes = [];
    this.circuitOpenUntil = 0;
    this.openLogged = false;
    this.lastFailureReason = null;
  }
  getLastFailureReason() {
    return this.lastFailureReason;
  }
  _getCircuitState() {
    if (this.circuitOpenUntil === 0)
      return "closed";
    if (Date.now() < this.circuitOpenUntil) {
      return this.halfOpenProbeInFlight ? "half_open" : "open";
    }
    return "half_open";
  }
  _getFailureCount() {
    return this.failureTimes.length;
  }
  _resetCircuit() {
    this.failureTimes = [];
    this.circuitOpenUntil = 0;
    this.openLogged = false;
    this.halfOpenProbeInFlight = false;
    this.lastFailureReason = null;
  }
}

// ../plugin/src/features/magic-context/session-project-storage.ts
var SESSION_CHUNK_REPAIR_BATCH_SIZE = 100;
var upsertSessionProjectStatements = new WeakMap;
var repairSessionChunkProjectStatements = new WeakMap;
var misScopedProjectChunkStatements = new WeakMap;
var MIS_SCOPED_PROJECT_CHUNK_IDS_SQL = `
    SELECT e.id FROM compartment_chunk_embeddings e
    JOIN session_projects sp ON sp.session_id = e.session_id AND sp.harness = e.harness
    WHERE e.project_path = ? AND sp.project_path <> e.project_path
    UNION ALL
    SELECT e.id FROM session_projects sp
    JOIN compartment_chunk_embeddings e ON e.session_id = sp.session_id
    WHERE sp.project_path = ? AND e.harness = sp.harness AND e.project_path <> sp.project_path`;
function getUpsertSessionProjectStatement(db) {
  let stmt = upsertSessionProjectStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`INSERT INTO session_projects (session_id, harness, project_path, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(session_id, harness) DO UPDATE SET
                 project_path = excluded.project_path,
                 updated_at = excluded.updated_at
             WHERE session_projects.project_path <> excluded.project_path`);
    upsertSessionProjectStatements.set(db, stmt);
  }
  return stmt;
}
function getRepairSessionChunkProjectStatement(db) {
  let stmt = repairSessionChunkProjectStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`UPDATE compartment_chunk_embeddings
             SET project_path = ?
             WHERE id IN (
                 SELECT id
                 FROM compartment_chunk_embeddings
                 WHERE session_id = ?
                   AND harness = ?
                   AND project_path <> ?
                 LIMIT ?
             )`);
    repairSessionChunkProjectStatements.set(db, stmt);
  }
  return stmt;
}
function findMisScopedCompartmentChunkEmbeddingIdsForProject(db, projectPath) {
  return db.prepare(`SELECT id FROM (${MIS_SCOPED_PROJECT_CHUNK_IDS_SQL}) LIMIT 25`).all(projectPath, projectPath).map(({ id }) => id);
}
function recordSessionProjectIdentity(db, sessionId, projectPath) {
  if (!sessionId || !projectPath)
    return;
  if (!projectPath.startsWith("git:") && !projectPath.startsWith("dir:") && isUserHomeDirectory(projectPath))
    return;
  const harness = getHarness2();
  const now = Date.now();
  let previousProjectPath;
  db.transaction(() => {
    const existing = db.prepare("SELECT project_path FROM session_projects WHERE session_id = ? AND harness = ?").get(sessionId, harness);
    previousProjectPath = existing?.project_path;
    getUpsertSessionProjectStatement(db).run(sessionId, harness, projectPath, now);
    getRepairSessionChunkProjectStatement(db).run(projectPath, sessionId, harness, projectPath, SESSION_CHUNK_REPAIR_BATCH_SIZE);
  }).immediate();
  return previousProjectPath === projectPath ? undefined : { previousProjectPath, projectPath };
}
function repairMisScopedCompartmentChunkEmbeddingsForProject(db, projectPath, ids = findMisScopedCompartmentChunkEmbeddingIdsForProject(db, projectPath)) {
  if (!projectPath || ids.length === 0)
    return 0;
  return db.prepare(`UPDATE compartment_chunk_embeddings
        SET project_path = (SELECT sp.project_path FROM session_projects sp
            WHERE sp.session_id = compartment_chunk_embeddings.session_id
              AND sp.harness = compartment_chunk_embeddings.harness)
        WHERE id IN (${ids.map(() => "?").join(",")}) AND EXISTS (
            SELECT 1 FROM session_projects sp
            WHERE sp.session_id = compartment_chunk_embeddings.session_id
              AND sp.harness = compartment_chunk_embeddings.harness
              AND sp.project_path <> compartment_chunk_embeddings.project_path
              AND (sp.project_path = ? OR compartment_chunk_embeddings.project_path = ?)
        )`).run(...ids, projectPath, projectPath).changes;
}

// ../plugin/src/features/magic-context/shadow-backfill-state.ts
var SHADOW_BACKFILL_PROVENANCE_KEY = "_magicContextShadowBackfill";
function parseJsonRecord(value) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function parsePersistedShadowBackfillState(provenanceJson) {
  const raw = parseJsonRecord(provenanceJson)[SHADOW_BACKFILL_PROVENANCE_KEY];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return;
  const state = raw;
  if (state.version !== 1)
    return;
  return state;
}
function hasShadowEmbeddingRegistrationsTable(db) {
  return Boolean(db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'shadow_embedding_registrations'").get());
}
function describeShadowBackfillWriteRefusal2(reason) {
  switch (reason) {
    case "provider_returned_no_vectors":
      return "the provider returned no vectors";
    case "memory_hash_guard_rejected":
      return "the memory normalized-hash guard rejected vectors because content changed in flight";
    case "candidate_rows_changed":
      return "the selected source rows changed before the writer loaded them";
    case "registration_retired_during_embed":
      return "the shadow registration was retired or replaced while the provider call was in flight, so the vectors were discarded";
    case "chunk_fts_mapping_incomplete":
      return "the chunk writer refused rows whose transcript ordinals are not fully mapped in FTS";
    case "chunk_empty_canonical_text":
      return "the chunk writer produced no canonical windows";
    case "chunk_partial_vector_set":
      return "the chunk writer refused a partial provider result so it would not replace a compartment incompletely";
    case "chunk_window_contract_mismatch":
      return "written chunk window keys or hashes did not satisfy the selector's window contract";
    case "duplicate_submission_budget":
      return "the same content batch was already submitted within the one-hour provider budget";
    default:
      return "the write completed without satisfying the selected candidate";
  }
}
function listShadowBackfillStalls2(db, projectIdentity) {
  if (!hasShadowEmbeddingRegistrationsTable(db))
    return [];
  const rows = db.prepare(`SELECT project_path AS projectIdentity, scope, model_id AS modelId,
                    provenance_json AS provenanceJson
             FROM shadow_embedding_registrations
             ${projectIdentity ? "WHERE project_path = ?" : ""}
             ORDER BY updated_at DESC, generation DESC`).all(...projectIdentity ? [projectIdentity] : []);
  const latestScopes = new Set;
  const stalls = [];
  for (const row of rows) {
    const scopeKey = `${row.projectIdentity}:${row.scope}`;
    if (latestScopes.has(scopeKey))
      continue;
    latestScopes.add(scopeKey);
    const state = parsePersistedShadowBackfillState(row.provenanceJson);
    if (state?.stopReason !== "stalled_no_progress")
      continue;
    stalls.push({
      projectIdentity: row.projectIdentity,
      scope: row.scope,
      modelId: row.modelId,
      candidateSignature: state.candidateSignature ?? "unknown",
      writeRefusalReason: state.writeRefusalReason ?? "unknown_write_rejection",
      stoppedAt: state.stoppedAt ?? 0
    });
  }
  return stalls;
}

// ../plugin/src/features/magic-context/storage-embedding-measurements.ts
import { createHash } from "node:crypto";
function normalizedQueryHash(query) {
  const normalized = query.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}
var MEASUREMENT_CORPUS_SESSION_ROW_CAP = 2000;
function recordEmbeddingMeasurement(db, input, cap = MEASUREMENT_CORPUS_SESSION_ROW_CAP) {
  const queryTextHash = normalizedQueryHash(input.queryText);
  const dedupKey = queryTextHash;
  const result = db.prepare(`INSERT OR IGNORE INTO embedding_measurement_corpus
            (session_id, project_path, dedup_key, cohort_key, query_text_hash,
             primary_result_ids_json, shadow_result_ids_json, primary_latency_ms, shadow_latency_ms,
             primary_failed, shadow_failed, primary_model_id, shadow_model_id,
             primary_fingerprint, shadow_fingerprint, primary_epoch, shadow_epoch,
             corpus_hash, coverage_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.sessionId, input.projectPath, dedupKey, input.cohortKey, queryTextHash, JSON.stringify(input.primaryResultIds.slice(0, 10)), JSON.stringify(input.shadowResultIds.slice(0, 10)), input.primaryLatencyMs, input.shadowLatencyMs, input.primaryFailed ? 1 : 0, input.shadowFailed ? 1 : 0, input.primaryModelId, input.shadowModelId, input.primaryFingerprint, input.shadowFingerprint, input.primaryEpoch, input.shadowEpoch, input.corpusHash, JSON.stringify(input.coverage), Date.now());
  if (result.changes > 0) {
    const rowCount = db.prepare("SELECT COUNT(*) AS count FROM embedding_measurement_corpus WHERE session_id = ?").get(input.sessionId).count;
    const overflow = rowCount - cap;
    if (overflow > 0) {
      db.prepare(`DELETE FROM embedding_measurement_corpus
                  WHERE session_id = ?
                    AND id IN (
                        SELECT id FROM embedding_measurement_corpus
                        WHERE session_id = ?
                        ORDER BY id ASC
                        LIMIT ?
                    )`).run(input.sessionId, input.sessionId, overflow);
    }
  }
  return result.changes > 0;
}
function beginSynapseBatchLedger(db, input, now = Date.now()) {
  db.prepare(`INSERT INTO synapse_batch_ledger
            (session_id, project_path, scope, manifest_json, request_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(session_id, request_key) DO UPDATE SET
            manifest_json = excluded.manifest_json,
            updated_at = excluded.updated_at`).run(input.sessionId, input.projectPath, input.scope, JSON.stringify(input.manifest), input.requestKey, now, now);
}
function finishSynapseBatchLedger(db, sessionId, requestKey, status, now = Date.now()) {
  db.prepare("UPDATE synapse_batch_ledger SET status = ?, updated_at = ? WHERE session_id = ? AND request_key = ?").run(status, now, sessionId, requestKey);
}
var SYNAPSE_BATCH_LEDGER_TTL_MS = 14 * 24 * 60 * 60 * 1000;
function pruneSynapseBatchLedgerForProject(db, projectIdentity, ttlMs = SYNAPSE_BATCH_LEDGER_TTL_MS) {
  const ledgerTable = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'synapse_batch_ledger'").get();
  if (!ledgerTable)
    return 0;
  const shadow = `shadow:${projectIdentity}`;
  const cutoff = Date.now() - ttlMs;
  const predicate = "session_id IN (?, ?) AND updated_at < ?";
  if (!db.prepare(`SELECT 1 FROM synapse_batch_ledger WHERE ${predicate} LIMIT 1`).get(projectIdentity, shadow, cutoff))
    return 0;
  return db.prepare(`DELETE FROM synapse_batch_ledger WHERE ${predicate}`).run(projectIdentity, shadow, cutoff).changes;
}

// ../plugin/src/features/magic-context/project-embedding-registry.ts
var OFF_PROVIDER_IDENTITY = "embedding-provider:off";
var SWEEP_MAX_WALL_CLOCK_MS = 10 * 60 * 1000;
var SWEEP_MAX_CONSECUTIVE_EMPTY = 3;
var COMMIT_DRAIN_BATCH_SIZE = 16;
var COMMIT_DRAIN_MAX_PER_SWEEP = 500;
var CHUNK_DRAIN_BATCH_SIZE = 8;
var CHUNK_DRAIN_MAX_PER_SWEEP = CHUNK_DRAIN_BATCH_SIZE;
var EMBEDDING_IDENTITY_GC_GRACE_MS = 14 * 24 * 60 * 60 * 1000;
var STALE_EMBEDDING_GC_BATCH_SIZE = 25;
var MAX_WINDOWS_PER_EMBED_CALL = 2;
var SESSION_EMBED_LEASE_RENEWAL_MS = 60 * 1000;
var EMBED_SLICE_RETRY_ATTEMPTS = 3;
var EMBED_SLICE_RETRY_BASE_MS = 250;
var EMBED_SLOW_FAILURE_NO_RETRY_MS = 1e4;
var MAX_CONSECUTIVE_FAILED_BATCHES = 3;
var projectRegistrations = new Map;
var shadowRegistrations = new Map;
var shadowQueue = [];
var shadowWorker = null;
var SHADOW_MAX_ITEMS_PER_TICK = 64;
var SHADOW_MAX_BYTES_PER_TICK = 512 * 1024;
var SHADOW_MAX_WALL_CLOCK_MS = 2000;
var SHADOW_RESUBMIT_WINDOW_MS = 60 * 60 * 1000;
var SHADOW_BACKFILL_PROVENANCE_KEY2 = "_magicContextShadowBackfill";
var pendingShadowBackfills = new Map;
var shadowBackfillLastIds = new Map;
var shadowBackfillStopReasons = new Map;
var shadowBackfillLastWriteOutcomes = new Map;
var shadowBackfillNow = () => Date.now();
function getShadowBackfillStopReason2(projectIdentity, scope) {
  return shadowBackfillStopReasons.get(`${projectIdentity}:${scope}`);
}
var loadUnembeddedMemoriesStatements = new WeakMap;
var upsertActiveIdentityStatements = new WeakMap;
var backfillActiveIdentityStatements = new Map;
var staleIdentityStatements = new Map;
var deleteActiveIdentityStatements = new WeakMap;
var globalRegistrationGeneration = 0;
var untrustedLoadProjects = new Set;
function markProjectLoadUntrusted2(projectIdentity) {
  untrustedLoadProjects.add(projectIdentity);
}
var projectSweepInProgress = false;
var testProviderFactory = null;

class TestProviderFactoryRequiredError extends Error {
  constructor() {
    super("test constructed a network-capable embedding provider without a test factory — install _setTestProviderFactoryForProject or set embedding.provider off in the fixture");
    this.name = "TestProviderFactoryRequiredError";
  }
}
function synapseDescriptorFromConfig(config) {
  const raw = config;
  const candidate = raw.synapse_descriptor;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return;
  const descriptor = candidate;
  if (typeof descriptor.lane !== "string" || descriptor.lane.length === 0 || typeof descriptor.max_tokens !== "number" || !Number.isInteger(descriptor.max_tokens) || descriptor.max_tokens <= 0 || descriptor.max_tokens_source !== "runtime_bucket" && descriptor.max_tokens_source !== "worker_bucket" && descriptor.max_tokens_source !== "catalog" && descriptor.max_tokens_source !== "catalog_unloaded" || typeof descriptor.warm !== "boolean") {
    return;
  }
  return descriptor;
}
function synapseConfigFields(config) {
  const raw = config;
  const descriptor = synapseDescriptorFromConfig(config);
  const rawProvenance = raw.synapse_provenance;
  const provenance = descriptor ? {
    ...rawProvenance && typeof rawProvenance === "object" && !Array.isArray(rawProvenance) ? rawProvenance : rawProvenance === undefined ? {} : { synapse_provenance: rawProvenance },
    capability_descriptor: descriptor
  } : rawProvenance;
  return {
    ...typeof raw.model === "string" ? { model: raw.model } : {},
    ...typeof raw.synapse_fingerprint === "string" ? { fingerprint: raw.synapse_fingerprint } : {},
    ...typeof raw.synapse_table_epoch === "number" ? { tableEpoch: raw.synapse_table_epoch } : {},
    ...typeof raw.synapse_dims === "number" ? { dims: raw.synapse_dims } : {},
    ...provenance !== undefined ? { provenance } : {},
    ...descriptor ? { descriptor } : {}
  };
}
function parseJsonRecord2(value) {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : { synapse_provenance: parsed };
  } catch {
    return {};
  }
}
function hasShadowEmbeddingRegistrationsTable2(db) {
  return Boolean(db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'shadow_embedding_registrations'").get());
}
function getPersistedShadowBackfillState(db, projectIdentity, scope, modelId) {
  if (!hasShadowEmbeddingRegistrationsTable2(db))
    return;
  const row = db.prepare(`SELECT provenance_json AS provenanceJson
             FROM shadow_embedding_registrations
             WHERE project_path = ? AND scope = ? AND model_id = ?`).get(projectIdentity, scope, modelId);
  return typeof row?.provenanceJson === "string" ? parsePersistedShadowBackfillState(row.provenanceJson) : undefined;
}
function updatePersistedShadowBackfillState(db, projectIdentity, scope, modelId, update) {
  if (!hasShadowEmbeddingRegistrationsTable2(db))
    return;
  const row = db.prepare(`SELECT provenance_json AS provenanceJson
             FROM shadow_embedding_registrations
             WHERE project_path = ? AND scope = ? AND model_id = ?`).get(projectIdentity, scope, modelId);
  if (typeof row?.provenanceJson !== "string")
    return;
  const provenance = parseJsonRecord2(row.provenanceJson);
  const current = parsePersistedShadowBackfillState(row.provenanceJson) ?? { version: 1 };
  provenance[SHADOW_BACKFILL_PROVENANCE_KEY2] = update(current);
  db.prepare(`UPDATE shadow_embedding_registrations
         SET provenance_json = ?
         WHERE project_path = ? AND scope = ? AND model_id = ?`).run(JSON.stringify(provenance), projectIdentity, scope, modelId);
}
function shadowDescriptorProvenanceJson(db, projectIdentity, scope, modelId, synapseProvenance) {
  const provenance = typeof synapseProvenance === "object" && synapseProvenance !== null && !Array.isArray(synapseProvenance) ? { ...synapseProvenance } : synapseProvenance === undefined ? {} : { synapse_provenance: synapseProvenance };
  const existing = getPersistedShadowBackfillState(db, projectIdentity, scope, modelId);
  if (existing)
    provenance[SHADOW_BACKFILL_PROVENANCE_KEY2] = existing;
  return JSON.stringify(provenance);
}
function persistPrimaryDescriptor(db, registration) {
  const descriptorTable = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'embedding_registrations'").get();
  if (!descriptorTable)
    return;
  const fields = synapseConfigFields(registration.config);
  db.prepare(`INSERT INTO embedding_registrations
            (project_path, provider_identity, model_id, chunk_model_id, fingerprint, table_epoch, dims, provenance_json, generation, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_path) DO UPDATE SET
            provider_identity = excluded.provider_identity,
            model_id = excluded.model_id,
            chunk_model_id = excluded.chunk_model_id,
            fingerprint = excluded.fingerprint,
            table_epoch = excluded.table_epoch,
            dims = excluded.dims,
            provenance_json = excluded.provenance_json,
            generation = excluded.generation,
            updated_at = excluded.updated_at`).run(registration.projectIdentity, registration.providerIdentity, registration.modelId, registration.chunkModelId, fields.fingerprint ?? "", fields.tableEpoch ?? 0, fields.dims ?? 0, JSON.stringify(fields.provenance ?? {}), registration.generation, Date.now());
}
function persistShadowDescriptor(db, registration) {
  const descriptorTable = db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'shadow_embedding_registrations'").get();
  if (!descriptorTable)
    return;
  const fields = synapseConfigFields(registration.config);
  const now = Date.now();
  db.prepare(`INSERT INTO shadow_embedding_registrations
            (project_path, scope, model_id, generation, fingerprint, table_epoch, dims, provenance_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_path, scope, model_id) DO UPDATE SET
            generation = excluded.generation,
            fingerprint = excluded.fingerprint,
            table_epoch = excluded.table_epoch,
            dims = excluded.dims,
            provenance_json = excluded.provenance_json,
            updated_at = excluded.updated_at`).run(registration.projectIdentity, "memory", registration.modelId, registration.generation, fields.fingerprint ?? "", fields.tableEpoch ?? 0, fields.dims ?? 0, shadowDescriptorProvenanceJson(db, registration.projectIdentity, "memory", registration.modelId, fields.provenance), now);
  db.prepare(`INSERT INTO shadow_embedding_registrations
            (project_path, scope, model_id, generation, fingerprint, table_epoch, dims, provenance_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_path, scope, model_id) DO UPDATE SET
            generation = excluded.generation,
            fingerprint = excluded.fingerprint,
            table_epoch = excluded.table_epoch,
            dims = excluded.dims,
            provenance_json = excluded.provenance_json,
            updated_at = excluded.updated_at`).run(registration.projectIdentity, "commit", registration.modelId, registration.generation, fields.fingerprint ?? "", fields.tableEpoch ?? 0, fields.dims ?? 0, shadowDescriptorProvenanceJson(db, registration.projectIdentity, "commit", registration.modelId, fields.provenance), now);
  db.prepare(`INSERT INTO shadow_embedding_registrations
            (project_path, scope, model_id, generation, fingerprint, table_epoch, dims, provenance_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_path, scope, model_id) DO UPDATE SET
            generation = excluded.generation,
            fingerprint = excluded.fingerprint,
            table_epoch = excluded.table_epoch,
            dims = excluded.dims,
            provenance_json = excluded.provenance_json,
            updated_at = excluded.updated_at`).run(registration.projectIdentity, "chunk", registration.chunkModelId, registration.generation, fields.fingerprint ?? "", fields.tableEpoch ?? 0, fields.dims ?? 0, shadowDescriptorProvenanceJson(db, registration.projectIdentity, "chunk", registration.chunkModelId, fields.provenance), now);
}
function resolveEmbeddingConfig(config) {
  if (!config || config.provider === "local") {
    return {
      provider: "local",
      model: config?.model?.trim() || DEFAULT_LOCAL_EMBEDDING_MODEL,
      local_runtime: config?.local_runtime ?? "auto",
      ...config?.max_input_tokens ? {
        max_input_tokens: normalizeCompartmentChunkMaxInputTokens(config.max_input_tokens)
      } : {},
      ...config?.local_dtype ? { local_dtype: config.local_dtype } : {}
    };
  }
  if (config.provider === "openai-compatible") {
    const apiKey = config.api_key?.trim();
    const inputType = config.input_type?.trim();
    const queryInputType = config.query_input_type?.trim();
    const truncate = config.truncate?.trim();
    return {
      provider: "openai-compatible",
      model: config.model.trim(),
      endpoint: config.endpoint.trim(),
      ...apiKey ? { api_key: apiKey } : {},
      ...inputType ? { input_type: inputType } : {},
      ...queryInputType ? { query_input_type: queryInputType } : {},
      ...config.query_instruction !== undefined ? { query_instruction: config.query_instruction } : {},
      ...config.document_prefix !== undefined ? { document_prefix: config.document_prefix } : {},
      ...truncate ? { truncate } : {},
      ...config.max_input_tokens ? {
        max_input_tokens: normalizeCompartmentChunkMaxInputTokens(config.max_input_tokens)
      } : {}
    };
  }
  if (config.provider === "off") {
    return { provider: "off" };
  }
  if (config.provider === "synapse") {
    const synapse = config;
    const descriptor = synapseDescriptorFromConfig(config);
    return {
      provider: "synapse",
      model: synapse.model?.trim() || "gte-modernbert-base-f16",
      max_input_tokens: normalizeCompartmentChunkMaxInputTokens(descriptor?.max_tokens ?? synapse.max_input_tokens),
      ...synapse.synapse_connection_file ? { synapse_connection_file: synapse.synapse_connection_file } : {},
      ...synapse.synapse_fingerprint ? { synapse_fingerprint: synapse.synapse_fingerprint } : {},
      ...typeof synapse.synapse_table_epoch === "number" ? { synapse_table_epoch: synapse.synapse_table_epoch } : {},
      ...typeof synapse.synapse_dims === "number" ? { synapse_dims: synapse.synapse_dims } : {},
      ...typeof synapse.synapse_recommended_batch === "number" ? { synapse_recommended_batch: synapse.synapse_recommended_batch } : {},
      ...typeof synapse.synapse_recommended_token_budget === "number" ? {
        synapse_recommended_token_budget: synapse.synapse_recommended_token_budget
      } : {},
      ...descriptor ? { synapse_descriptor: descriptor } : {},
      ...synapse.synapse_provenance !== undefined ? { synapse_provenance: synapse.synapse_provenance } : {}
    };
  }
  throw new Error("Unknown embedding provider");
}
function createProvider(config, context) {
  if (config.provider === "off") {
    return null;
  }
  if (testProviderFactory) {
    return testProviderFactory(config);
  }
  if (process.env.MAGIC_CONTEXT_TEST_DATA_DIR?.trim()) {
    throw new TestProviderFactoryRequiredError;
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
      projectRoot: context?.projectRoot ?? "",
      session: context?.session ?? "embedding",
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
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function sha256Prefix(value, length = 16) {
  return createHash2("sha256").update(value).digest("hex").slice(0, length);
}
function contentSha2562(value) {
  return createHash2("sha256").update(value).digest("hex");
}
function getRuntimeFingerprint(config) {
  if (config.provider === "off") {
    return OFF_PROVIDER_IDENTITY;
  }
  return `${getEmbeddingProviderIdentity(config)}:${sha256Prefix(stableStringify(config))}`;
}
function getChunkEmbeddingModelId(config, providerIdentity) {
  if (config.provider === "off") {
    return OFF_PROVIDER_IDENTITY;
  }
  const chunkIdentity = {
    providerIdentity,
    chunkerVersion: 2,
    maxInputTokens: normalizeCompartmentChunkMaxInputTokens("max_input_tokens" in config ? config.max_input_tokens : undefined),
    truncate: config.provider === "openai-compatible" ? config.truncate ?? "" : ""
  };
  return `${providerIdentity}:chunk:${sha256Prefix(stableStringify(chunkIdentity))}`;
}
function sameFeatures(a, b) {
  return a.memoryEnabled === b.memoryEnabled && a.gitCommitEnabled === b.gitCommitEnabled;
}
function snapshotFor(registration) {
  const providerIsOn = registration.providerIdentity !== OFF_PROVIDER_IDENTITY;
  const historyEnabled = !registration.observationMode && providerIsOn;
  const enabled = historyEnabled && registration.features.memoryEnabled;
  const gitCommitEnabled = !registration.observationMode && providerIsOn && registration.features.gitCommitEnabled;
  const configuredModel = "model" in registration.config && typeof registration.config.model === "string" ? registration.config.model.trim() : "";
  const synapseDescriptor = !registration.observationMode && registration.config.provider === "synapse" ? synapseDescriptorFromConfig(registration.config) : undefined;
  return {
    projectIdentity: registration.projectIdentity,
    sourceDirectory: registration.sourceDirectory,
    providerIdentity: registration.providerIdentity,
    runtimeFingerprint: registration.runtimeFingerprint,
    generation: registration.generation,
    features: { ...registration.features },
    enabled,
    historyEnabled,
    gitCommitEnabled,
    modelId: registration.observationMode || !providerIsOn ? "off" : registration.modelId,
    chunkModelId: registration.observationMode || !providerIsOn ? "off" : registration.chunkModelId,
    model: registration.observationMode || !providerIsOn ? "off" : configuredModel ? configuredModel : registration.modelId,
    provider: registration.observationMode || !providerIsOn ? "off" : registration.config.provider ?? "local",
    ...synapseDescriptor ? { synapseDescriptor } : {}
  };
}
function disposeProvider(provider) {
  if (!provider)
    return;
  provider.dispose().catch((error) => {
    log2("[magic-context] embedding provider dispose failed:", error);
  });
}
function getUpsertActiveIdentityStatement(db) {
  let stmt = upsertActiveIdentityStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`INSERT INTO embedding_identity_active (project_path, scope, model_id, last_active_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(project_path, scope, model_id) DO UPDATE SET
                 last_active_at = excluded.last_active_at`);
    upsertActiveIdentityStatements.set(db, stmt);
  }
  return stmt;
}
function statementMapFor(maps, key) {
  let map = maps.get(key);
  if (!map) {
    map = new WeakMap;
    maps.set(key, map);
  }
  return map;
}
function getBackfillActiveIdentityStatement(db, scope) {
  const map = statementMapFor(backfillActiveIdentityStatements, scope);
  let stmt = map.get(db);
  if (!stmt) {
    const selectByScope = {
      memory: `SELECT DISTINCT e.model_id AS model_id
                     FROM memory_embeddings e
                     JOIN memories m ON m.id = e.memory_id
                     WHERE m.project_path = ?`,
      commit: `SELECT DISTINCT e.model_id AS model_id
                     FROM git_commit_embeddings e
                     JOIN git_commits c ON c.sha = e.sha
                     WHERE c.project_path = ?`,
      chunk: `SELECT DISTINCT e.model_id AS model_id
                    FROM compartment_chunk_embeddings e
                    WHERE e.project_path = ?`
    };
    stmt = db.prepare(`SELECT model_id FROM (${selectByScope[scope]}) legacy
             WHERE model_id IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM embedding_identity_active active
                 WHERE active.project_path = ? AND active.scope = ?
                   AND active.model_id = legacy.model_id
             ) LIMIT 25`);
    map.set(db, stmt);
  }
  return stmt;
}
function recordScopeActiveIdentity(db, projectIdentity, scope, modelId, now) {
  getUpsertActiveIdentityStatement(db).run(projectIdentity, scope, modelId, now);
}
var legacyDiscoveryComplete = new WeakMap;
function recordActiveEmbeddingIdentity(db, projectIdentity, currentProviderIdentity, currentChunkIdentity, features) {
  if (currentProviderIdentity === OFF_PROVIDER_IDENTITY) {
    return false;
  }
  const scopes = [["chunk", currentChunkIdentity]];
  if (features.memoryEnabled)
    scopes.push(["memory", currentProviderIdentity]);
  if (features.gitCommitEnabled)
    scopes.push(["commit", currentProviderIdentity]);
  const active = db.prepare("SELECT 1 FROM embedding_identity_active WHERE project_path = ? AND scope = ? AND model_id = ?");
  let discovered = legacyDiscoveryComplete.get(db);
  if (!discovered) {
    discovered = new Set;
    legacyDiscoveryComplete.set(db, discovered);
  }
  const discoveryKey = (scope, model) => JSON.stringify([projectIdentity, scope, model]);
  const legacy = scopes.filter(([scope, model]) => !discovered.has(discoveryKey(scope, model)) || !active.get(projectIdentity, scope, model)).map(([scope, model]) => ({
    scope,
    model,
    rows: getBackfillActiveIdentityStatement(db, scope).all(projectIdentity, projectIdentity, scope)
  }));
  const repairIds = findMisScopedCompartmentChunkEmbeddingIdsForProject(db, projectIdentity);
  if (legacy.every(({ rows }) => rows.length === 0) && scopes.every(([scope, model]) => active.get(projectIdentity, scope, model)) && repairIds.length === 0) {
    for (const { scope, model } of legacy)
      discovered.add(discoveryKey(scope, model));
    return false;
  }
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  const transactionStartedAt = performance.now();
  try {
    if (features.memoryEnabled) {
      recordScopeActiveIdentity(db, projectIdentity, "memory", currentProviderIdentity, now);
    }
    if (features.gitCommitEnabled) {
      recordScopeActiveIdentity(db, projectIdentity, "commit", currentProviderIdentity, now);
    }
    for (const { scope, rows } of legacy) {
      for (const { model_id } of rows) {
        db.prepare(`INSERT OR IGNORE INTO embedding_identity_active
                    (project_path, scope, model_id, last_active_at) VALUES (?, ?, ?, ?)`).run(projectIdentity, scope, model_id, now);
      }
    }
    repairMisScopedCompartmentChunkEmbeddingsForProject(db, projectIdentity, repairIds);
    recordScopeActiveIdentity(db, projectIdentity, "chunk", currentChunkIdentity, now);
    db.exec("COMMIT");
    logSlowWriteTransaction("embedding_identity_record", transactionStartedAt);
    for (const { scope, model, rows } of legacy) {
      if (rows.length < 25)
        discovered.add(discoveryKey(scope, model));
    }
    return true;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}
function getStaleIdentityStatement(db, scope) {
  const map = statementMapFor(staleIdentityStatements, scope);
  let stmt = map.get(db);
  if (!stmt) {
    stmt = db.prepare(`SELECT model_id AS modelId
             FROM embedding_identity_active
             WHERE project_path = ?
               AND scope = ?
               AND model_id <> ?
               AND last_active_at < ?`);
    map.set(db, stmt);
  }
  return stmt;
}
function getDeleteActiveIdentityStatement(db) {
  let stmt = deleteActiveIdentityStatements.get(db);
  if (!stmt) {
    stmt = db.prepare(`DELETE FROM embedding_identity_active
             WHERE project_path = ? AND scope = ? AND model_id = ?`);
    deleteActiveIdentityStatements.set(db, stmt);
  }
  return stmt;
}
function staleModelsForScope(db, projectIdentity, scope, currentModelId, cutoff, protectedModelIds = new Set([currentModelId])) {
  const rows = getStaleIdentityStatement(db, scope).all(projectIdentity, scope, currentModelId, cutoff);
  return rows.map((row) => row.modelId).filter((modelId) => typeof modelId === "string" && !protectedModelIds.has(modelId));
}
function deleteStaleEmbeddingBatch(db, scope, projectIdentity, modelId, limit) {
  if (scope === "memory") {
    return db.prepare(`DELETE FROM memory_embeddings
                 WHERE rowid IN (
                     SELECT me.rowid
                     FROM memory_embeddings me
                     WHERE me.memory_id IN (SELECT id FROM memories WHERE project_path = ?)
                        AND me.model_id = ?
                     LIMIT ?
                 )`).run(projectIdentity, modelId, limit).changes;
  }
  if (scope === "commit") {
    return db.prepare(`DELETE FROM git_commit_embeddings
                 WHERE rowid IN (
                     SELECT gce.rowid
                     FROM git_commit_embeddings gce
                     WHERE gce.sha IN (SELECT sha FROM git_commits WHERE project_path = ?)
                        AND gce.model_id = ?
                     LIMIT ?
                 )`).run(projectIdentity, modelId, limit).changes;
  }
  return db.prepare(`DELETE FROM compartment_chunk_embeddings
             WHERE id IN (
                 SELECT id
                 FROM compartment_chunk_embeddings
                 WHERE project_path = ? AND model_id = ?
                 LIMIT ?
             )`).run(projectIdentity, modelId, limit).changes;
}
function hasStaleEmbeddingRows(db, scope, projectIdentity, modelId) {
  if (scope === "memory") {
    return Boolean(db.prepare(`SELECT 1
                     FROM memory_embeddings me
                     WHERE me.memory_id IN (SELECT id FROM memories WHERE project_path = ?)
                        AND me.model_id = ?
                     LIMIT 1`).get(projectIdentity, modelId));
  }
  if (scope === "commit") {
    return Boolean(db.prepare(`SELECT 1
                     FROM git_commit_embeddings gce
                     WHERE gce.sha IN (SELECT sha FROM git_commits WHERE project_path = ?)
                        AND gce.model_id = ?
                     LIMIT 1`).get(projectIdentity, modelId));
  }
  return Boolean(db.prepare(`SELECT 1
                 FROM compartment_chunk_embeddings
                 WHERE project_path = ? AND model_id = ?
                 LIMIT 1`).get(projectIdentity, modelId));
}
function sweepStaleEmbeddingIdentitiesForProject(db, projectIdentity, now = Date.now()) {
  const snapshot = getProjectEmbeddingSnapshot2(projectIdentity);
  const result = {
    memoryRowsDeleted: 0,
    commitRowsDeleted: 0,
    chunkRowsDeleted: 0,
    trackingRowsDeleted: 0
  };
  if (!snapshot)
    return result;
  if (untrustedLoadProjects.has(projectIdentity))
    return result;
  const cutoff = now - EMBEDDING_IDENTITY_GC_GRACE_MS;
  const deleteTracking = getDeleteActiveIdentityStatement(db);
  const shadow = shadowRegistrations.get(projectIdentity);
  const protectedModels = {
    memory: new Set([snapshot.modelId, ...shadow ? [shadow.modelId] : []]),
    commit: new Set([snapshot.modelId, ...shadow ? [shadow.modelId] : []]),
    chunk: new Set([snapshot.chunkModelId, ...shadow ? [shadow.chunkModelId] : []])
  };
  const scopes = [
    {
      scope: "memory",
      enabled: snapshot.enabled && snapshot.modelId !== "off",
      currentModelId: snapshot.modelId
    },
    {
      scope: "commit",
      enabled: snapshot.gitCommitEnabled && snapshot.modelId !== "off",
      currentModelId: snapshot.modelId
    },
    {
      scope: "chunk",
      enabled: snapshot.historyEnabled && snapshot.chunkModelId !== "off",
      currentModelId: snapshot.chunkModelId
    }
  ];
  let remainingBudget = STALE_EMBEDDING_GC_BATCH_SIZE;
  const candidates = scopes.flatMap(({ scope, enabled, currentModelId }) => enabled ? staleModelsForScope(db, projectIdentity, scope, currentModelId, cutoff, protectedModels[scope]).slice(0, STALE_EMBEDDING_GC_BATCH_SIZE).map((modelId) => ({ scope, modelId })) : []).slice(0, STALE_EMBEDDING_GC_BATCH_SIZE);
  if (candidates.length === 0)
    return result;
  db.exec("BEGIN IMMEDIATE");
  const transactionStartedAt = performance.now();
  try {
    for (const { scope, modelId } of candidates) {
      if (remainingBudget === 0)
        break;
      const marker = db.prepare(`SELECT last_active_at FROM embedding_identity_active
                    WHERE project_path = ? AND scope = ? AND model_id = ?`).get(projectIdentity, scope, modelId);
      if (!marker || marker.last_active_at >= cutoff)
        continue;
      const deleted = deleteStaleEmbeddingBatch(db, scope, projectIdentity, modelId, remainingBudget);
      remainingBudget -= deleted;
      if (scope === "memory")
        result.memoryRowsDeleted += deleted;
      else if (scope === "commit")
        result.commitRowsDeleted += deleted;
      else
        result.chunkRowsDeleted += deleted;
      if (!hasStaleEmbeddingRows(db, scope, projectIdentity, modelId)) {
        result.trackingRowsDeleted += deleteTracking.run(projectIdentity, scope, modelId).changes;
      } else if (deleted === 0) {
        remainingBudget = 0;
      }
    }
    db.exec("COMMIT");
    logSlowWriteTransaction("embedding_stale_gc", transactionStartedAt);
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }
  if (result.memoryRowsDeleted > 0)
    invalidateProject2(projectIdentity);
  return result;
}
async function drainProjectEmbeddingIdentityMaintenance2(db, projectIdentity, budgetMs = 2000) {
  const snapshot = getProjectEmbeddingSnapshot2(projectIdentity);
  if (!snapshot || untrustedLoadProjects.has(projectIdentity))
    return 0;
  return drainBackgroundBatches(() => recordActiveEmbeddingIdentity(db, projectIdentity, snapshot.modelId, snapshot.chunkModelId, { memoryEnabled: snapshot.enabled, gitCommitEnabled: snapshot.gitCommitEnabled }), { budgetMs });
}
async function drainStaleEmbeddingIdentitiesForProject2(db, projectIdentity, budgetMs = 2000) {
  const total = {
    memoryRowsDeleted: 0,
    commitRowsDeleted: 0,
    chunkRowsDeleted: 0,
    trackingRowsDeleted: 0
  };
  await drainBackgroundBatches(() => {
    const result = sweepStaleEmbeddingIdentitiesForProject(db, projectIdentity);
    total.memoryRowsDeleted += result.memoryRowsDeleted;
    total.commitRowsDeleted += result.commitRowsDeleted;
    total.chunkRowsDeleted += result.chunkRowsDeleted;
    total.trackingRowsDeleted += result.trackingRowsDeleted;
    return result.memoryRowsDeleted + result.commitRowsDeleted + result.chunkRowsDeleted + result.trackingRowsDeleted > 0;
  }, { budgetMs });
  return total;
}
function registerProjectEmbedding2(db, projectIdentity, config, features, sourceDirectory) {
  const resolvedConfig = resolveEmbeddingConfig(config);
  const providerIdentity = getEmbeddingProviderIdentity(resolvedConfig);
  const runtimeFingerprint = getRuntimeFingerprint(resolvedConfig);
  const chunkModelId = getChunkEmbeddingModelId(resolvedConfig, providerIdentity);
  const prior = projectRegistrations.get(projectIdentity);
  const canReuseProvider = prior !== undefined && !prior.observationMode && prior.runtimeFingerprint === runtimeFingerprint && prior.providerIdentity === providerIdentity;
  recordActiveEmbeddingIdentity(db, projectIdentity, providerIdentity, chunkModelId, features);
  pruneSynapseBatchLedgerForProject(db, projectIdentity);
  untrustedLoadProjects.delete(projectIdentity);
  const generationChanged = prior === undefined || prior.observationMode || prior.runtimeFingerprint !== runtimeFingerprint || prior.chunkModelId !== chunkModelId || !sameFeatures(prior.features, features);
  const generation = generationChanged ? ++globalRegistrationGeneration : prior.generation;
  const registration = {
    projectIdentity,
    sourceDirectory,
    config: resolvedConfig,
    providerIdentity,
    runtimeFingerprint,
    provider: canReuseProvider ? prior.provider : null,
    generation,
    features: { ...features },
    modelId: providerIdentity === OFF_PROVIDER_IDENTITY ? "off" : providerIdentity,
    chunkModelId: providerIdentity === OFF_PROVIDER_IDENTITY ? "off" : chunkModelId,
    observationMode: false
  };
  projectRegistrations.set(projectIdentity, registration);
  if (generationChanged || !db.prepare("SELECT 1 FROM embedding_registrations WHERE project_path = ? AND provider_identity = ? AND chunk_model_id = ? AND generation = ?").get(projectIdentity, providerIdentity, registration.chunkModelId, generation)) {
    persistPrimaryDescriptor(db, registration);
  }
  if (!canReuseProvider) {
    disposeProvider(prior?.provider ?? null);
  }
  return snapshotFor(registration);
}
function registerProjectShadowEmbedding2(db, projectIdentity, config, sourceDirectory, options = {}) {
  const resolvedConfig = resolveEmbeddingConfig(config);
  if (resolvedConfig.provider !== "synapse") {
    throw new Error("Shadow embedding registration requires the synapse provider");
  }
  const providerIdentity = getEmbeddingProviderIdentity(resolvedConfig);
  const chunkModelId = getChunkEmbeddingModelId(resolvedConfig, providerIdentity);
  const provider = createProvider(resolvedConfig, {
    projectRoot: sourceDirectory,
    session: `shadow:${projectIdentity}`
  });
  if (!provider)
    return null;
  const prior = shadowRegistrations.get(projectIdentity);
  if (prior && prior.providerIdentity === providerIdentity) {
    provider.dispose();
    dbForShadowQueue.set(projectIdentity, db);
    persistShadowDescriptor(db, prior);
    const backfillAlreadyArmed = hasPendingShadowBackfill(projectIdentity) || shadowQueue.some((item) => item.projectIdentity === projectIdentity);
    if (!backfillAlreadyArmed || options.manualBackfill === true) {
      maybeArmShadowBackfill(db, projectIdentity, prior, options.manualBackfill === true);
    }
    return {
      ...snapshotFor({
        projectIdentity,
        sourceDirectory,
        config: prior.config,
        providerIdentity: prior.providerIdentity,
        runtimeFingerprint: `shadow:${prior.providerIdentity}`,
        provider: prior.provider,
        generation: prior.generation,
        features: { memoryEnabled: true, gitCommitEnabled: true },
        modelId: prior.modelId,
        chunkModelId: prior.chunkModelId,
        observationMode: false
      }),
      provider: "synapse"
    };
  }
  const generation = ++globalRegistrationGeneration;
  const registration = {
    projectIdentity,
    sourceDirectory,
    config: resolvedConfig,
    provider,
    providerIdentity,
    modelId: providerIdentity,
    chunkModelId,
    generation
  };
  shadowRegistrations.set(projectIdentity, registration);
  dbForShadowQueue.set(projectIdentity, db);
  if (prior) {
    disposeProvider(prior.provider);
    for (const scope of ["memory", "commit", "chunk"]) {
      const scopeKey = `${projectIdentity}:${scope}`;
      shadowBackfillLastIds.delete(scopeKey);
      shadowBackfillStopReasons.delete(scopeKey);
      shadowBackfillLastWriteOutcomes.delete(scopeKey);
    }
  }
  db.transaction(() => {
    const now = Date.now();
    recordScopeActiveIdentity(db, projectIdentity, "memory", registration.modelId, now);
    recordScopeActiveIdentity(db, projectIdentity, "commit", registration.modelId, now);
    recordScopeActiveIdentity(db, projectIdentity, "chunk", registration.chunkModelId, now);
    persistShadowDescriptor(db, registration);
  }).immediate();
  maybeArmShadowBackfill(db, projectIdentity, registration, options.manualBackfill === true);
  return {
    projectIdentity,
    sourceDirectory,
    providerIdentity,
    runtimeFingerprint: `shadow:${providerIdentity}`,
    generation,
    features: { memoryEnabled: true, gitCommitEnabled: true },
    enabled: true,
    historyEnabled: true,
    gitCommitEnabled: true,
    modelId: registration.modelId,
    chunkModelId: registration.chunkModelId,
    model: "model" in resolvedConfig && typeof resolvedConfig.model === "string" ? resolvedConfig.model : registration.modelId,
    provider: "synapse",
    ...synapseDescriptorFromConfig(resolvedConfig) ? { synapseDescriptor: synapseDescriptorFromConfig(resolvedConfig) } : {}
  };
}
function startShadowWorker() {
  if (shadowWorker)
    return;
  shadowWorker = runShadowWorker().finally(() => {
    shadowWorker = null;
    if (shadowQueue.length > 0 || hasPendingShadowBackfill())
      startShadowWorker();
  });
}
function getShadowEmbeddingMeasurementCohort2(projectIdentity) {
  const registration = shadowRegistrations.get(projectIdentity);
  if (!registration)
    return null;
  const fields = synapseConfigFields(registration.config);
  return {
    modelId: registration.modelId,
    chunkModelId: registration.chunkModelId,
    fingerprint: fields.fingerprint ?? "",
    epoch: fields.tableEpoch ?? 0,
    dims: fields.dims ?? 0
  };
}
function getPrimaryEmbeddingMeasurementCohort2(projectIdentity) {
  const registration = projectRegistrations.get(projectIdentity);
  if (!registration)
    return null;
  const fields = synapseConfigFields(registration.config);
  return {
    modelId: registration.modelId,
    chunkModelId: registration.chunkModelId,
    fingerprint: fields.fingerprint ?? "",
    epoch: fields.tableEpoch ?? 0,
    dims: fields.dims ?? 0
  };
}
async function embedShadowTextForProject2(projectIdentity, text, signal) {
  const registration = shadowRegistrations.get(projectIdentity);
  if (!registration)
    return null;
  try {
    const vector = await registration.provider.embed(text, signal, "query");
    return vector && !isSynapseEmbeddingTruncated(vector) ? vector : null;
  } catch (error) {
    log2("[magic-context] Synapse shadow query failed:", error);
    return null;
  }
}
function enqueueShadowEmbeddingItems2(projectIdentity, scope, ids) {
  if (ids.length === 0 || !shadowRegistrations.has(projectIdentity))
    return;
  shadowQueue.push({ projectIdentity, scope, ids: [...ids] });
  startShadowWorker();
}
function shadowBackfillMissingBase(scope, primaryModelId, shadowModelId, projectIdentity) {
  if (scope === "memory") {
    return {
      sql: `SELECT m.id AS id
                  FROM memories m
                  JOIN memory_embeddings mp ON mp.memory_id = m.id AND mp.model_id = ?
                  LEFT JOIN memory_embeddings ms ON ms.memory_id = m.id AND ms.model_id = ?
                  WHERE m.project_path = ? AND m.status = 'active' AND ms.memory_id IS NULL`,
      params: [primaryModelId, shadowModelId, projectIdentity],
      orderBy: " ORDER BY m.id"
    };
  }
  return {
    sql: `SELECT gc.sha AS id
              FROM git_commits gc
              JOIN git_commit_embeddings gp ON gp.sha = gc.sha AND gp.model_id = ?
              LEFT JOIN git_commit_embeddings gs ON gs.sha = gc.sha AND gs.model_id = ?
              WHERE gc.project_path = ? AND gs.sha IS NULL`,
    params: [primaryModelId, shadowModelId, projectIdentity],
    orderBy: " ORDER BY gc.committed_at DESC, gc.sha"
  };
}
function shadowBackfillMissingIds(db, projectIdentity, scope, primaryModelId, shadowModelId, limit, shadowMaxInputTokens) {
  if (scope === "chunk") {
    return loadUnembeddedShadowChunkCandidates(db, projectIdentity, primaryModelId, shadowModelId, limit, shadowMaxInputTokens).map((candidate) => String(candidate.id));
  }
  const { sql, params, orderBy } = shadowBackfillMissingBase(scope, primaryModelId, shadowModelId, projectIdentity);
  const rows = db.prepare(`${sql}${orderBy} LIMIT ?`).all(...params, limit);
  return rows.map((row) => String(row.id));
}
function countShadowBackfillMissing(db, projectIdentity, scope, primaryModelId, shadowModelId, shadowMaxInputTokens) {
  if (scope === "chunk") {
    return loadUnembeddedShadowChunkCandidates(db, projectIdentity, primaryModelId, shadowModelId, Number.MAX_SAFE_INTEGER, shadowMaxInputTokens).length;
  }
  const { sql, params } = shadowBackfillMissingBase(scope, primaryModelId, shadowModelId, projectIdentity);
  return db.prepare(`SELECT COUNT(*) AS count FROM (${sql})`).get(...params).count;
}
function shadowModelIdForScope(registration, scope) {
  return scope === "chunk" ? registration.chunkModelId : registration.modelId;
}
function shadowMaxInputTokensFor(registration) {
  return normalizeCompartmentChunkMaxInputTokens("max_input_tokens" in registration.config ? registration.config.max_input_tokens : undefined);
}
function shadowBackfillCohortFingerprint(db, projectIdentity, scope, primaryModelId) {
  if (scope === "memory") {
    return db.prepare(`SELECT COUNT(*) AS rowCount, MAX(m.id) AS maxId, MAX(m.updated_at) AS maxUpdatedAt
                 FROM memories m
                 JOIN memory_embeddings me ON me.memory_id = m.id AND me.model_id = ?
                 WHERE m.project_path = ? AND m.status = 'active'`).get(primaryModelId, projectIdentity);
  }
  if (scope === "commit") {
    return db.prepare(`SELECT COUNT(*) AS rowCount, MAX(gc.sha) AS maxId, MAX(gc.committed_at) AS maxUpdatedAt
                 FROM git_commits gc
                 JOIN git_commit_embeddings gce ON gce.sha = gc.sha AND gce.model_id = ?
                 WHERE gc.project_path = ?`).get(primaryModelId, projectIdentity);
  }
  return db.prepare(`SELECT COUNT(*) AS rowCount,
                    COUNT(DISTINCT compartment_id) AS compartmentCount,
                    MAX(compartment_id) AS maxId,
                    MAX(created_at) AS maxUpdatedAt
             FROM compartment_chunk_embeddings
             WHERE project_path = ? AND model_id = ?`).get(projectIdentity, primaryModelId);
}
function shadowBackfillCandidateBatch(db, projectIdentity, scope, primaryModelId, shadow, limit) {
  const shadowModelId = shadowModelIdForScope(shadow, scope);
  const ids = shadowBackfillMissingIds(db, projectIdentity, scope, primaryModelId, shadowModelId, limit, shadowMaxInputTokensFor(shadow));
  return {
    ids,
    signature: sha256Prefix(stableStringify({
      scope,
      primaryModelId,
      shadowModelId,
      ids,
      cohort: shadowBackfillCohortFingerprint(db, projectIdentity, scope, primaryModelId)
    }), 32)
  };
}
function hasPendingShadowBackfill(projectIdentity) {
  if (projectIdentity === undefined)
    return pendingShadowBackfills.size > 0;
  const scopes = pendingShadowBackfills.get(projectIdentity);
  return scopes !== undefined && scopes.size > 0;
}
function pumpShadowBackfill() {
  for (const [projectIdentity, scopes] of pendingShadowBackfills) {
    const db = dbForShadowQueue.get(projectIdentity);
    const shadow = shadowRegistrations.get(projectIdentity);
    const primary = projectRegistrations.get(projectIdentity);
    if (!db || !shadow || !primary) {
      pendingShadowBackfills.delete(projectIdentity);
      continue;
    }
    for (const scope of [...scopes]) {
      const primaryModelId = shadowModelIdForScope(primary, scope);
      const shadowModelId = shadowModelIdForScope(shadow, scope);
      const stallKey = `${projectIdentity}:${scope}`;
      if (primaryModelId === "off" || shadowModelId === "off") {
        scopes.delete(scope);
        shadowBackfillLastIds.delete(stallKey);
        shadowBackfillLastWriteOutcomes.delete(stallKey);
        continue;
      }
      const batch = shadowBackfillCandidateBatch(db, projectIdentity, scope, primaryModelId, shadow, SHADOW_MAX_ITEMS_PER_TICK);
      if (batch.ids.length === 0) {
        shadowBackfillStopReasons.set(stallKey, "drained");
        scopes.delete(scope);
        shadowBackfillLastIds.delete(stallKey);
        shadowBackfillLastWriteOutcomes.delete(stallKey);
        updatePersistedShadowBackfillState(db, projectIdentity, scope, shadowModelId, (state) => ({
          ...state,
          stopReason: "drained",
          candidateSignature: undefined,
          writeRefusalReason: undefined,
          stoppedAt: shadowBackfillNow()
        }));
        continue;
      }
      if (shadowBackfillLastIds.get(stallKey) === batch.signature) {
        const lastOutcome = shadowBackfillLastWriteOutcomes.get(stallKey);
        const writeRefusalReason = lastOutcome?.refusalReason ?? (lastOutcome && lastOutcome.writes > 0 ? "chunk_window_contract_mismatch" : "unknown_write_rejection");
        shadowBackfillStopReasons.set(stallKey, "stalled_no_progress");
        updatePersistedShadowBackfillState(db, projectIdentity, scope, shadowModelId, (state) => ({
          ...state,
          stopReason: "stalled_no_progress",
          candidateSignature: batch.signature,
          writeRefusalReason,
          stoppedAt: shadowBackfillNow()
        }));
        log2(`[shadow] backfill scope ${scope} for ${projectIdentity} retired without progress — ` + `${describeShadowBackfillWriteRefusal2(writeRefusalReason)}; ` + `${batch.ids.length}+ items remain and automatic registration will not retry unchanged candidates`);
        scopes.delete(scope);
        shadowBackfillLastIds.delete(stallKey);
        shadowBackfillLastWriteOutcomes.delete(stallKey);
        continue;
      }
      shadowBackfillLastIds.set(stallKey, batch.signature);
      shadowQueue.push({ projectIdentity, scope, ids: batch.ids });
    }
    if (scopes.size === 0)
      pendingShadowBackfills.delete(projectIdentity);
  }
}
function maybeArmShadowBackfill(db, projectIdentity, shadow, manualBackfill = false) {
  if (untrustedLoadProjects.has(projectIdentity))
    return;
  const primary = projectRegistrations.get(projectIdentity);
  if (!primary)
    return;
  const pending = new Set;
  for (const scope of ["memory", "commit", "chunk"]) {
    const primaryModelId = shadowModelIdForScope(primary, scope);
    const shadowModelId = shadowModelIdForScope(shadow, scope);
    const stallKey = `${projectIdentity}:${scope}`;
    if (primaryModelId === "off" || shadowModelId === "off")
      continue;
    if (scope === "memory" && !primary.features.memoryEnabled)
      continue;
    const batch = shadowBackfillCandidateBatch(db, projectIdentity, scope, primaryModelId, shadow, SHADOW_MAX_ITEMS_PER_TICK);
    const persisted = getPersistedShadowBackfillState(db, projectIdentity, scope, shadowModelId);
    if (batch.ids.length === 0) {
      if (persisted?.stopReason === "stalled_no_progress") {
        shadowBackfillStopReasons.set(stallKey, "drained");
        updatePersistedShadowBackfillState(db, projectIdentity, scope, shadowModelId, (state) => ({
          ...state,
          stopReason: "drained",
          candidateSignature: undefined,
          writeRefusalReason: undefined,
          stoppedAt: shadowBackfillNow()
        }));
      }
      continue;
    }
    if (!manualBackfill && persisted?.stopReason === "stalled_no_progress" && persisted.candidateSignature === batch.signature) {
      shadowBackfillStopReasons.set(stallKey, "stalled_no_progress");
      continue;
    }
    shadowBackfillStopReasons.delete(stallKey);
    shadowBackfillLastIds.delete(stallKey);
    shadowBackfillLastWriteOutcomes.delete(stallKey);
    updatePersistedShadowBackfillState(db, projectIdentity, scope, shadowModelId, (state) => ({
      ...state,
      stopReason: undefined,
      candidateSignature: undefined,
      writeRefusalReason: undefined,
      stoppedAt: undefined
    }));
    pending.add(scope);
  }
  if (pending.size === 0)
    return;
  pendingShadowBackfills.set(projectIdentity, pending);
  pumpShadowBackfill();
  startShadowWorker();
}
function getShadowBackfillRemaining2(db, projectIdentity) {
  const remaining = { memory: 0, commit: 0, chunk: 0 };
  const primary = projectRegistrations.get(projectIdentity);
  const shadow = shadowRegistrations.get(projectIdentity);
  if (!primary || !shadow)
    return remaining;
  for (const scope of ["memory", "commit", "chunk"]) {
    const primaryModelId = shadowModelIdForScope(primary, scope);
    const shadowModelId = shadowModelIdForScope(shadow, scope);
    if (primaryModelId === "off" || shadowModelId === "off")
      continue;
    remaining[scope] = countShadowBackfillMissing(db, projectIdentity, scope, primaryModelId, shadowModelId, shadowMaxInputTokensFor(shadow));
  }
  return remaining;
}
async function flushShadowEmbeddingBacklog2(projectIdentity, onSettled) {
  if (shadowQueue.length > 0 || hasPendingShadowBackfill(projectIdentity)) {
    startShadowWorker();
  }
  for (;; ) {
    const worker = shadowWorker;
    if (worker) {
      await worker;
      await onSettled?.();
      continue;
    }
    if (shadowQueue.length === 0 && !hasPendingShadowBackfill(projectIdentity))
      return;
    startShadowWorker();
    if (!shadowWorker)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await onSettled?.();
  }
}
async function embedShadowItems(registration, items, db, scope) {
  const raw = registration.config;
  const fingerprint = typeof raw.synapse_fingerprint === "string" ? raw.synapse_fingerprint : "";
  const tableEpoch = typeof raw.synapse_table_epoch === "number" ? raw.synapse_table_epoch : 0;
  const requestKey = getSynapseBatchRequestKey({
    model: typeof raw.model === "string" ? raw.model : SYNAPSE_DEFAULT_MODEL,
    fingerprint,
    tableEpoch,
    items
  });
  const sessionId = `shadow:${registration.projectIdentity}`;
  const now = shadowBackfillNow();
  const prior = db.prepare(`SELECT updated_at AS updatedAt
             FROM synapse_batch_ledger
             WHERE session_id = ? AND request_key = ?`).get(sessionId, requestKey);
  if (typeof prior?.updatedAt === "number" && now - prior.updatedAt >= 0 && now - prior.updatedAt < SHADOW_RESUBMIT_WINDOW_MS) {
    const modelId = shadowModelIdForScope(registration, scope);
    const state = getPersistedShadowBackfillState(db, registration.projectIdentity, scope, modelId);
    if (state?.budgetLogRequestKey !== requestKey || typeof state.budgetLoggedAt !== "number" || now - state.budgetLoggedAt >= SHADOW_RESUBMIT_WINDOW_MS) {
      log2(`[shadow] skipped duplicate ${scope} batch for ${registration.projectIdentity}; ` + "the same content was submitted within the one-hour provider budget");
      updatePersistedShadowBackfillState(db, registration.projectIdentity, scope, modelId, (current) => ({
        ...current,
        budgetLogRequestKey: requestKey,
        budgetLoggedAt: now
      }));
    }
    return {
      vectors: new Map,
      refusalReason: "duplicate_submission_budget"
    };
  }
  beginSynapseBatchLedger(db, {
    sessionId,
    projectPath: registration.projectIdentity,
    scope,
    manifest: items.map(({ id, contentSha256 }) => ({ id, contentSha256 })),
    requestKey
  }, now);
  try {
    if (registration.provider.embedItems) {
      const returned = await registration.provider.embedItems(items);
      const vectors = new Map([...returned].filter(([, vector]) => !isSynapseEmbeddingTruncated(vector)));
      finishSynapseBatchLedger(db, sessionId, requestKey, vectors.size === items.length ? "complete" : "partial", shadowBackfillNow());
      return {
        vectors,
        ...vectors.size === 0 ? { refusalReason: "provider_returned_no_vectors" } : {}
      };
    }
    const positional = await registration.provider.embedBatch(items.map((item) => item.text));
    const vectors = new Map(items.flatMap((item, index) => {
      const vector = positional[index];
      return vector && !isSynapseEmbeddingTruncated(vector) ? [[item.id, vector]] : [];
    }));
    finishSynapseBatchLedger(db, sessionId, requestKey, vectors.size === items.length ? "complete" : "partial", shadowBackfillNow());
    return {
      vectors,
      ...vectors.size === 0 ? { refusalReason: "provider_returned_no_vectors" } : {}
    };
  } catch (error) {
    finishSynapseBatchLedger(db, sessionId, requestKey, "failed", shadowBackfillNow());
    throw error;
  }
}
async function processShadowQueueItem(item) {
  const registration = shadowRegistrations.get(item.projectIdentity);
  if (!registration)
    return { writes: 0, refusalReason: "candidate_rows_changed" };
  const boundedIds = item.ids.slice(0, SHADOW_MAX_ITEMS_PER_TICK);
  if (item.scope === "memory") {
    const db = dbForShadowQueue.get(item.projectIdentity);
    if (!db)
      return { writes: 0, refusalReason: "candidate_rows_changed" };
    const placeholders = boundedIds.map(() => "?").join(",");
    const rows = db.prepare(`SELECT id, content, normalized_hash FROM memories
                 WHERE project_path = ? AND id IN (${placeholders}) AND status = 'active'`).all(item.projectIdentity, ...boundedIds.map((id) => Number(id)));
    if (rows.length === 0)
      return { writes: 0, refusalReason: "candidate_rows_changed" };
    const embedded = await embedShadowItems(registration, rows.map((row) => ({
      id: `memory:${row.id}`,
      text: row.content,
      contentSha256: contentSha2562(row.content)
    })), db, "memory");
    const live = shadowRegistrations.get(item.projectIdentity);
    if (!live || live.generation !== registration.generation) {
      return { writes: 0, refusalReason: "registration_retired_during_embed" };
    }
    let writes = 0;
    let hashGuardRejected = false;
    db.transaction(() => {
      for (const row of rows) {
        const vector = embedded.vectors.get(`memory:${row.id}`);
        if (!vector)
          continue;
        if (saveEmbeddingIfHashMatches(db, row.id, vector, registration.modelId, row.normalized_hash)) {
          writes += 1;
        } else {
          hashGuardRejected = true;
        }
      }
    }).immediate();
    return {
      writes,
      ...writes === 0 ? {
        refusalReason: embedded.refusalReason ?? (hashGuardRejected ? "memory_hash_guard_rejected" : "provider_returned_no_vectors")
      } : {}
    };
  }
  if (item.scope === "commit") {
    const db = dbForShadowQueue.get(item.projectIdentity);
    if (!db)
      return { writes: 0, refusalReason: "candidate_rows_changed" };
    const placeholders = boundedIds.map(() => "?").join(",");
    const rows = db.prepare(`SELECT sha, message FROM git_commits WHERE project_path = ? AND sha IN (${placeholders})`).all(item.projectIdentity, ...boundedIds);
    if (rows.length === 0)
      return { writes: 0, refusalReason: "candidate_rows_changed" };
    const embedded = await embedShadowItems(registration, rows.map((row) => ({
      id: `commit:${row.sha}`,
      text: row.message,
      contentSha256: contentSha2562(row.message)
    })), db, "commit");
    const live = shadowRegistrations.get(item.projectIdentity);
    if (!live || live.generation !== registration.generation) {
      return { writes: 0, refusalReason: "registration_retired_during_embed" };
    }
    let writes = 0;
    db.transaction(() => {
      for (const row of rows) {
        const vector = embedded.vectors.get(`commit:${row.sha}`);
        if (!vector)
          continue;
        saveCommitEmbedding(db, row.sha, vector, registration.modelId);
        writes += 1;
      }
    }).immediate();
    return {
      writes,
      ...writes === 0 ? { refusalReason: embedded.refusalReason ?? "provider_returned_no_vectors" } : {}
    };
  }
  const db = dbForShadowQueue.get(item.projectIdentity);
  if (!db)
    return { writes: 0, refusalReason: "candidate_rows_changed" };
  const placeholders = boundedIds.map(() => "?").join(",");
  const candidates = db.prepare(`SELECT id, session_id, start_message, end_message
             FROM compartments WHERE id IN (${placeholders})`).all(...boundedIds.map((id) => Number(id)));
  if (candidates.length === 0) {
    return { writes: 0, refusalReason: "candidate_rows_changed" };
  }
  const prepared = [];
  let ftsMappingIncomplete = false;
  let emptyCanonicalText = false;
  for (const candidate of candidates) {
    const mappedText = buildCanonicalChunkTextFromFts(db, candidate.session_id, candidate.start_message, candidate.end_message);
    if (mappedText === null) {
      ftsMappingIncomplete = true;
    } else {
      const text = mappedText || buildCompartmentSummaryFallbackText(db, candidate.id);
      const shadowMaxInputTokens = shadowMaxInputTokensFor(registration);
      const windows = chunkCanonicalText(text, candidate.start_message, candidate.end_message, shadowMaxInputTokens);
      const windowSourceKey = chunkWindowSourceKey(text, candidate.start_message, candidate.end_message, shadowMaxInputTokens);
      if (windows.length > 0)
        prepared.push({ candidate, windows, windowSourceKey });
      else
        emptyCanonicalText = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (prepared.length === 0) {
    return {
      writes: 0,
      refusalReason: ftsMappingIncomplete ? "chunk_fts_mapping_incomplete" : "chunk_empty_canonical_text"
    };
  }
  const items = prepared.flatMap((item) => item.windows.map((window) => ({
    id: `chunk:${item.candidate.id}:${window.windowIndex}`,
    text: window.text,
    contentSha256: contentSha2562(window.text)
  })));
  const embedded = await embedShadowItems(registration, items, db, "chunk");
  const live = shadowRegistrations.get(item.projectIdentity);
  if (!live || live.generation !== registration.generation) {
    return { writes: 0, refusalReason: "registration_retired_during_embed" };
  }
  let writes = 0;
  let partialVectorSet = false;
  for (const item of prepared) {
    const rows = item.windows.flatMap((window) => {
      const vector = embedded.vectors.get(`chunk:${item.candidate.id}:${window.windowIndex}`);
      return vector ? [
        {
          compartmentId: item.candidate.id,
          sessionId: item.candidate.session_id,
          projectPath: registration.projectIdentity,
          window,
          modelId: registration.chunkModelId,
          vector
        }
      ] : [];
    });
    if (rows.length === item.windows.length) {
      replaceCompartmentChunkEmbeddings(db, rows, item.windowSourceKey);
      writes += 1;
    } else {
      partialVectorSet = true;
    }
  }
  return {
    writes,
    ...writes === 0 ? {
      refusalReason: embedded.refusalReason ?? (partialVectorSet ? "chunk_partial_vector_set" : ftsMappingIncomplete ? "chunk_fts_mapping_incomplete" : emptyCanonicalText ? "chunk_empty_canonical_text" : "unknown_write_rejection")
    } : {}
  };
}
var dbForShadowQueue = new Map;
async function runShadowWorker() {
  const startedAt = Date.now();
  let processed = 0;
  let processedBytes = 0;
  for (;; ) {
    if (shadowQueue.length === 0) {
      pumpShadowBackfill();
      if (shadowQueue.length === 0)
        break;
    }
    if (processed >= SHADOW_MAX_ITEMS_PER_TICK || Date.now() - startedAt >= SHADOW_MAX_WALL_CLOCK_MS) {
      break;
    }
    const item = shadowQueue.shift();
    if (!item)
      break;
    const itemBytes = item.ids.reduce((total, id) => total + id.length, 0);
    if (processed > 0 && processedBytes + itemBytes > SHADOW_MAX_BYTES_PER_TICK) {
      shadowQueue.unshift(item);
      break;
    }
    const generationAtStart = shadowRegistrations.get(item.projectIdentity)?.generation;
    const isStillCurrent = () => generationAtStart !== undefined && shadowRegistrations.get(item.projectIdentity)?.generation === generationAtStart;
    try {
      const outcome = await processShadowQueueItem(item);
      if (isStillCurrent()) {
        shadowBackfillLastWriteOutcomes.set(`${item.projectIdentity}:${item.scope}`, outcome);
      }
    } catch (error) {
      if (isStillCurrent()) {
        shadowBackfillLastWriteOutcomes.set(`${item.projectIdentity}:${item.scope}`, {
          writes: 0,
          refusalReason: "provider_returned_no_vectors"
        });
      }
      log2("[magic-context] Synapse shadow write failed:", error);
    }
    processed += item.ids.length;
    processedBytes += itemBytes;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
function registerProjectInObservationMode2(db, projectIdentity, sourceDirectory, failedConfig, failureSummary) {
  const prior = projectRegistrations.get(projectIdentity);
  const runtimeFingerprint = `observation:${sha256Prefix(failureSummary)}`;
  const generation = prior?.runtimeFingerprint === runtimeFingerprint && prior.observationMode ? prior.generation : ++globalRegistrationGeneration;
  const registration = {
    projectIdentity,
    sourceDirectory,
    config: resolveEmbeddingConfig(failedConfig),
    providerIdentity: OFF_PROVIDER_IDENTITY,
    runtimeFingerprint,
    provider: null,
    generation,
    features: { memoryEnabled: false, gitCommitEnabled: false },
    modelId: "off",
    chunkModelId: "off",
    observationMode: true
  };
  projectRegistrations.set(projectIdentity, registration);
  disposeProvider(prior?.provider ?? null);
  return snapshotFor(registration);
}
function unregisterProjectShadowEmbedding2(projectIdentity) {
  const shadow = shadowRegistrations.get(projectIdentity);
  shadowRegistrations.delete(projectIdentity);
  dbForShadowQueue.delete(projectIdentity);
  pendingShadowBackfills.delete(projectIdentity);
  for (let index = shadowQueue.length - 1;index >= 0; index -= 1) {
    if (shadowQueue[index].projectIdentity === projectIdentity)
      shadowQueue.splice(index, 1);
  }
  for (const scope of ["memory", "commit", "chunk"]) {
    const key = `${projectIdentity}:${scope}`;
    shadowBackfillLastIds.delete(key);
    shadowBackfillStopReasons.delete(key);
    shadowBackfillLastWriteOutcomes.delete(key);
  }
  const primaryProvider = projectRegistrations.get(projectIdentity)?.provider ?? null;
  if (shadow?.provider && shadow.provider !== primaryProvider) {
    disposeProvider(shadow.provider);
  }
}
function unregisterProjectEmbedding2(projectIdentity) {
  const prior = projectRegistrations.get(projectIdentity);
  const shadow = shadowRegistrations.get(projectIdentity);
  if (!prior && !shadow)
    return;
  projectRegistrations.delete(projectIdentity);
  shadowRegistrations.delete(projectIdentity);
  dbForShadowQueue.delete(projectIdentity);
  globalRegistrationGeneration += 1;
  disposeProvider(prior?.provider ?? null);
  disposeProvider(shadow?.provider ?? null);
}
function getProjectEmbeddingSnapshot2(projectIdentity) {
  const registration = projectRegistrations.get(projectIdentity);
  return registration ? snapshotFor(registration) : null;
}
function installProjectEmbeddingSearchBridge2(snapshot, provider) {
  projectRegistrations.set(snapshot.projectIdentity, {
    projectIdentity: snapshot.projectIdentity,
    sourceDirectory: snapshot.sourceDirectory,
    providerIdentity: snapshot.providerIdentity,
    runtimeFingerprint: snapshot.runtimeFingerprint,
    generation: snapshot.generation,
    features: { ...snapshot.features },
    modelId: snapshot.modelId,
    chunkModelId: snapshot.chunkModelId,
    config: { provider: "off" },
    provider,
    observationMode: !snapshot.historyEnabled
  });
}
function getProjectChunkEmbeddingModelId2(projectIdentity) {
  const registration = projectRegistrations.get(projectIdentity);
  return registration && !registration.observationMode ? registration.chunkModelId : "off";
}
function getProjectEmbeddingMaxInputTokens2(projectIdentity) {
  const registration = projectRegistrations.get(projectIdentity);
  const configMax = registration?.config && "max_input_tokens" in registration.config ? registration.config.max_input_tokens : undefined;
  return normalizeCompartmentChunkMaxInputTokens(registration?.provider?.maxInputTokens ?? configMax);
}
function getOrCreateProjectProvider(registration) {
  if (registration.providerIdentity === OFF_PROVIDER_IDENTITY || registration.observationMode) {
    return null;
  }
  if (registration.provider) {
    return registration.provider;
  }
  const provider = createProvider(registration.config, {
    projectRoot: registration.sourceDirectory,
    session: `project:${registration.projectIdentity}`
  });
  registration.provider = provider;
  return provider;
}
async function embedTextForProject2(projectIdentity, text, signal, purpose = "passage") {
  const registration = projectRegistrations.get(projectIdentity);
  if (!registration)
    return null;
  const generation = registration.generation;
  const modelId = registration.modelId;
  const provider = getOrCreateProjectProvider(registration);
  if (!provider)
    return null;
  const vector = await provider.embed(text, signal, purpose);
  if (!vector || isSynapseEmbeddingTruncated(vector))
    return null;
  const current = projectRegistrations.get(projectIdentity);
  if (!current || current.generation !== generation || current.runtimeFingerprint !== registration.runtimeFingerprint) {
    return null;
  }
  return { vector, modelId, chunkModelId: registration.chunkModelId, generation };
}
async function embedBatchForProject2(projectIdentity, texts, signal, purpose = "passage") {
  if (texts.length === 0) {
    const registration = projectRegistrations.get(projectIdentity);
    if (!registration || registration.observationMode)
      return null;
    return { vectors: [], modelId: registration.modelId, generation: registration.generation };
  }
  const registration = projectRegistrations.get(projectIdentity);
  if (!registration)
    return null;
  const generation = registration.generation;
  const modelId = registration.modelId;
  const runtimeFingerprint = registration.runtimeFingerprint;
  const provider = getOrCreateProjectProvider(registration);
  if (!provider)
    return null;
  const vectors = (await provider.embedBatch(texts, signal, purpose)).map((vector) => vector && !isSynapseEmbeddingTruncated(vector) ? vector : null);
  const current = projectRegistrations.get(projectIdentity);
  if (!current || current.generation !== generation || current.runtimeFingerprint !== runtimeFingerprint) {
    return null;
  }
  return { vectors, modelId, generation };
}
async function embedItemsForProject2(projectIdentity, items, signal, db, sessionId = projectIdentity) {
  const registration = projectRegistrations.get(projectIdentity);
  if (!registration || registration.observationMode || items.length === 0)
    return null;
  const generation = registration.generation;
  const modelId = registration.modelId;
  const runtimeFingerprint = registration.runtimeFingerprint;
  const provider = getOrCreateProjectProvider(registration);
  if (!provider)
    return null;
  const rawConfig = registration.config;
  const fingerprint = typeof rawConfig.synapse_fingerprint === "string" ? rawConfig.synapse_fingerprint : "";
  const tableEpoch = typeof rawConfig.synapse_table_epoch === "number" ? rawConfig.synapse_table_epoch : undefined;
  const isSynapse = registration.providerIdentity.startsWith("synapse:v1:") && fingerprint && tableEpoch !== undefined;
  const ledgerKey = isSynapse ? getSynapseBatchRequestKey({
    model: typeof rawConfig.model === "string" ? rawConfig.model : registration.modelId,
    fingerprint,
    tableEpoch,
    items
  }) : null;
  if (db && ledgerKey) {
    beginSynapseBatchLedger(db, {
      sessionId,
      projectPath: projectIdentity,
      scope: items[0].id.split(":", 1)[0],
      manifest: items.map(({ id, contentSha256 }) => ({ id, contentSha256 })),
      requestKey: ledgerKey
    });
  }
  let vectors;
  try {
    if (provider.embedItems) {
      const returned = await provider.embedItems(items, signal);
      vectors = new Map([...returned].filter(([, vector]) => !isSynapseEmbeddingTruncated(vector)));
    } else {
      const positional = await provider.embedBatch(items.map((item) => item.text), signal, "passage");
      vectors = new Map(items.flatMap((item, index) => {
        const vector = positional[index];
        return vector && !isSynapseEmbeddingTruncated(vector) ? [[item.id, vector]] : [];
      }));
    }
  } catch (error) {
    if (db && ledgerKey)
      finishSynapseBatchLedger(db, sessionId, ledgerKey, "failed");
    throw error;
  }
  if (db && ledgerKey) {
    finishSynapseBatchLedger(db, sessionId, ledgerKey, vectors.size === items.length ? "complete" : "partial");
  }
  const current = projectRegistrations.get(projectIdentity);
  if (!current || current.generation !== generation || current.runtimeFingerprint !== runtimeFingerprint) {
    return null;
  }
  return { vectors, modelId, generation };
}
async function embedItemsWindowBounded(projectIdentity, items, signal, db) {
  if (items.length <= MAX_WINDOWS_PER_EMBED_CALL) {
    return embedItemsForProject2(projectIdentity, items, signal, db, projectIdentity);
  }
  const vectors = new Map;
  let modelId = null;
  let generation = null;
  for (let start = 0;start < items.length; start += MAX_WINDOWS_PER_EMBED_CALL) {
    const result = await embedItemsForProject2(projectIdentity, items.slice(start, start + MAX_WINDOWS_PER_EMBED_CALL), signal, db, projectIdentity);
    if (!result)
      return null;
    if (modelId === null) {
      modelId = result.modelId;
      generation = result.generation;
    } else if (modelId !== result.modelId || generation !== result.generation) {
      return null;
    }
    for (const [id, vector] of result.vectors)
      vectors.set(id, vector);
  }
  return modelId === null || generation === null ? null : { vectors, modelId, generation };
}
function isUnembeddedMemoryRow(row) {
  if (row === null || typeof row !== "object")
    return false;
  const candidate = row;
  return typeof candidate.id === "number" && typeof candidate.content === "string" && typeof candidate.normalized_hash === "string";
}
function getLoadUnembeddedMemoriesStatement(db) {
  let stmt = loadUnembeddedMemoriesStatements.get(db);
  if (!stmt) {
    stmt = db.prepare("SELECT m.id AS id, m.content AS content, m.normalized_hash AS normalized_hash FROM memories m LEFT JOIN memory_embeddings me ON m.id = me.memory_id AND me.model_id = ? WHERE m.project_path = ? AND m.status = 'active' AND me.memory_id IS NULL LIMIT ?");
    loadUnembeddedMemoriesStatements.set(db, stmt);
  }
  return stmt;
}
async function embedUnembeddedMemoriesForProject2(db, projectIdentity, batchSize = 10) {
  const outcome = await embedUnembeddedMemoriesForProjectOutcome(db, projectIdentity, batchSize);
  return outcome.kind === "embedded" ? outcome.count : 0;
}
async function embedUnembeddedMemoriesForProjectOutcome(db, projectIdentity, batchSize = 10) {
  if (isEmbeddingHostBusy2())
    return { kind: "unavailable" };
  const snapshot = getProjectEmbeddingSnapshot2(projectIdentity);
  if (!snapshot?.enabled)
    return { kind: "disabled" };
  const normalizedBatchSize = Math.max(1, Math.floor(batchSize));
  const memories = getLoadUnembeddedMemoriesStatement(db).all(snapshot.modelId, projectIdentity, normalizedBatchSize).filter(isUnembeddedMemoryRow);
  if (memories.length === 0)
    return { kind: "done" };
  try {
    const result = await embedItemsForProject2(projectIdentity, memories.map((memory) => ({
      id: `memory:${memory.id}`,
      text: memory.content,
      contentSha256: contentSha2562(memory.content)
    })), undefined, db, projectIdentity);
    if (!result)
      return { kind: "unavailable" };
    let embeddedCount = 0;
    db.transaction(() => {
      for (const memory of memories) {
        const embedding = result.vectors.get(`memory:${memory.id}`);
        if (!embedding)
          continue;
        if (saveEmbeddingIfHashMatches(db, memory.id, embedding, result.modelId, memory.normalized_hash)) {
          embeddedCount += 1;
        }
      }
    }).immediate();
    enqueueShadowEmbeddingItems2(projectIdentity, "memory", memories.filter((memory) => result.vectors.has(`memory:${memory.id}`)).map((memory) => String(memory.id)));
    return { kind: "embedded", count: embeddedCount };
  } catch (error) {
    log2("[magic-context] failed to proactively embed missing memories:", error);
    return { kind: "failed", error };
  }
}
async function embedCommitBatch(db, projectIdentity, batchSize) {
  const snapshot = getProjectEmbeddingSnapshot2(projectIdentity);
  if (!snapshot?.gitCommitEnabled)
    return 0;
  const commits = loadUnembeddedCommits(db, projectIdentity, snapshot.modelId, Math.max(1, Math.floor(batchSize)));
  if (commits.length === 0)
    return 0;
  const result = await embedItemsForProject2(projectIdentity, commits.map((commit) => ({
    id: `commit:${commit.sha}`,
    text: commit.message,
    contentSha256: contentSha2562(commit.message)
  })), undefined, db, projectIdentity);
  if (!result)
    return 0;
  let embeddedCount = 0;
  db.transaction(() => {
    for (const commit of commits) {
      const embedding = result.vectors.get(`commit:${commit.sha}`);
      if (!embedding)
        continue;
      saveCommitEmbedding(db, commit.sha, embedding, result.modelId);
      embeddedCount += 1;
    }
  }).immediate();
  enqueueShadowEmbeddingItems2(projectIdentity, "commit", commits.filter((commit) => result.vectors.has(`commit:${commit.sha}`)).map((commit) => commit.sha));
  return embeddedCount;
}
async function drainCommitBacklogForProject2(db, projectIdentity, deadline) {
  const snapshot = getProjectEmbeddingSnapshot2(projectIdentity);
  if (!snapshot?.gitCommitEnabled)
    return 0;
  const holderId = `embed-sweep-${randomUUID()}`;
  const lease = acquireGitSweepLease(db, projectIdentity, holderId, { ignoreCooldown: true });
  if (!lease.acquired) {
    return 0;
  }
  let total = 0;
  let leaseLost = false;
  const renewal = setInterval(() => {
    try {
      if (!renewGitSweepLease(db, projectIdentity, holderId))
        leaseLost = true;
    } catch {}
  }, SESSION_EMBED_LEASE_RENEWAL_MS);
  renewal.unref?.();
  try {
    while (!leaseLost && !isEmbeddingHostBusy2() && Date.now() < deadline && total < COMMIT_DRAIN_MAX_PER_SWEEP) {
      const embedded = await embedCommitBatch(db, projectIdentity, COMMIT_DRAIN_BATCH_SIZE);
      if (!renewGitSweepLease(db, projectIdentity, holderId))
        leaseLost = true;
      if (leaseLost || embedded === 0)
        break;
      total += embedded;
      if (embedded < COMMIT_DRAIN_BATCH_SIZE)
        break;
    }
  } finally {
    clearInterval(renewal);
    releaseGitSweepLease(db, projectIdentity, holderId);
  }
  return total;
}
async function embedCompartmentChunkBatch(db, projectIdentity, batchSize) {
  const snapshot = getProjectEmbeddingSnapshot2(projectIdentity);
  if (!snapshot?.historyEnabled || snapshot.chunkModelId === "off")
    return 0;
  repairMisScopedCompartmentChunkEmbeddingsForProject(db, projectIdentity);
  const candidates = await loadUnembeddedCompartmentChunkCandidatesPolite(db, projectIdentity, snapshot.chunkModelId, batchSize, getProjectEmbeddingMaxInputTokens2(projectIdentity), true);
  if (candidates.length === 0)
    return 0;
  const { embedded } = await embedCandidateChunkBatch(db, projectIdentity, snapshot.chunkModelId, candidates);
  return embedded;
}
function getLastEmbeddingFailureForProject(projectIdentity) {
  const registration = projectRegistrations.get(projectIdentity);
  return registration?.provider?.getLastFailureReason?.() ?? null;
}
async function embedCandidateChunkBatch(db, projectIdentity, modelId, candidates, signal) {
  const noWork = [];
  const failed = [];
  const failureReasons = [];
  if (candidates.length === 0)
    return { embedded: 0, noWork, failed, failureReasons };
  const maxInputTokens = getProjectEmbeddingMaxInputTokens2(projectIdentity);
  const prepared = [];
  for (const candidate of candidates) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const mappedText = buildCanonicalChunkTextFromFts(db, candidate.sessionId, candidate.startMessage, candidate.endMessage);
    if (mappedText === null)
      continue;
    const canonicalText = mappedText || buildCompartmentSummaryFallbackText(db, candidate.id);
    if (canonicalText.length === 0) {
      recordChunkEmbedBackoff(db, candidate, projectIdentity, modelId);
      noWork.push(candidate.id);
      continue;
    }
    const windows = chunkCanonicalText(canonicalText, candidate.startMessage, candidate.endMessage, maxInputTokens);
    if (windows.length === 0 || chunkEmbeddingWindowsAreCurrent(db, candidate.id, modelId, windows, projectIdentity)) {
      noWork.push(candidate.id);
      continue;
    }
    prepared.push({
      candidate,
      windows,
      windowSourceKey: chunkWindowSourceKey(canonicalText, candidate.startMessage, candidate.endMessage, maxInputTokens)
    });
  }
  if (prepared.length === 0)
    return { embedded: 0, noWork, failed, failureReasons };
  let embedded = 0;
  let i = 0;
  while (i < prepared.length) {
    if (signal?.aborted)
      break;
    const slice = [];
    let windowCount = 0;
    do {
      const item = prepared[i];
      slice.push(item);
      windowCount += item.windows.length;
      i += 1;
    } while (i < prepared.length && windowCount + prepared[i].windows.length <= MAX_WINDOWS_PER_EMBED_CALL);
    const items = slice.flatMap((item) => item.windows.map((window) => ({
      id: `chunk:${item.candidate.id}:${window.windowIndex}`,
      text: window.text,
      contentSha256: contentSha2562(window.text)
    })));
    const persistedIds = new Set;
    for (let attempt = 0;attempt < EMBED_SLICE_RETRY_ATTEMPTS; attempt++) {
      if (signal?.aborted)
        break;
      await new Promise((resolve) => setTimeout(resolve, 15));
      let result = null;
      const attemptStart = Date.now();
      try {
        result = await embedItemsWindowBounded(projectIdentity, items, signal, db);
      } catch (error) {
        log2("[magic-context] failed to proactively embed compartment chunks:", error);
      }
      if (signal?.aborted)
        break;
      if (!result || result.vectors.size === 0) {
        const failure = getLastEmbeddingFailureForProject(projectIdentity);
        if (failure)
          failureReasons.push(failure);
      }
      if (result) {
        let writeSliceStarted = performance.now();
        for (const item of slice) {
          if (persistedIds.has(item.candidate.id))
            continue;
          const vectors = item.windows.map((window) => result.vectors.get(`chunk:${item.candidate.id}:${window.windowIndex}`));
          if (vectors.length !== item.windows.length || vectors.some((v) => !v)) {
            continue;
          }
          const rows = item.windows.map((window, index) => ({
            compartmentId: item.candidate.id,
            sessionId: item.candidate.sessionId,
            projectPath: projectIdentity,
            window,
            modelId,
            vector: vectors[index]
          }));
          replaceCompartmentChunkEmbeddings(db, rows, item.windowSourceKey);
          persistedIds.add(item.candidate.id);
          enqueueShadowEmbeddingItems2(projectIdentity, "chunk", [
            String(item.candidate.id)
          ]);
          if (performance.now() - writeSliceStarted >= 35) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            writeSliceStarted = performance.now();
          }
        }
      }
      if (persistedIds.size === slice.length)
        break;
      if (persistedIds.size > 0)
        break;
      if (Date.now() - attemptStart >= EMBED_SLOW_FAILURE_NO_RETRY_MS)
        break;
      if (attempt < EMBED_SLICE_RETRY_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, EMBED_SLICE_RETRY_BASE_MS * 2 ** attempt));
      }
    }
    embedded += persistedIds.size;
    if (!signal?.aborted) {
      for (const item of slice) {
        if (!persistedIds.has(item.candidate.id)) {
          recordChunkEmbedBackoff(db, item.candidate, projectIdentity, modelId);
          failed.push(item.candidate.id);
        }
      }
    }
  }
  return { embedded, noWork, failed, failureReasons };
}
async function drainCompartmentChunkBacklogForProject(db, projectIdentity, deadline) {
  const snapshot = getProjectEmbeddingSnapshot2(projectIdentity);
  if (!snapshot?.historyEnabled)
    return 0;
  const holderId = `chunk-embed-sweep-${randomUUID()}`;
  const lease = acquireGitSweepLease(db, projectIdentity, holderId, { ignoreCooldown: true });
  if (!lease.acquired) {
    return 0;
  }
  let total = 0;
  let leaseLost = false;
  const renewal = setInterval(() => {
    try {
      if (!renewGitSweepLease(db, projectIdentity, holderId))
        leaseLost = true;
    } catch {}
  }, SESSION_EMBED_LEASE_RENEWAL_MS);
  renewal.unref?.();
  try {
    while (!leaseLost && !isEmbeddingHostBusy2() && Date.now() < deadline && total < CHUNK_DRAIN_MAX_PER_SWEEP) {
      const embedded = await embedCompartmentChunkBatch(db, projectIdentity, CHUNK_DRAIN_BATCH_SIZE);
      if (!renewGitSweepLease(db, projectIdentity, holderId))
        leaseLost = true;
      if (leaseLost || embedded === 0)
        break;
      total += embedded;
      if (embedded < CHUNK_DRAIN_BATCH_SIZE)
        break;
    }
  } finally {
    clearInterval(renewal);
    releaseGitSweepLease(db, projectIdentity, holderId);
  }
  return total;
}
async function embedUnembeddedCompartmentChunksForProject2(db, projectIdentity) {
  return drainCompartmentChunkBacklogForProject(db, projectIdentity, Date.now() + SWEEP_MAX_WALL_CLOCK_MS);
}
async function embedSessionCompartmentChunks2(db, projectIdentity, sessionId, options) {
  const snapshot = getProjectEmbeddingSnapshot2(projectIdentity);
  if (!snapshot?.historyEnabled || snapshot.chunkModelId === "off") {
    return { status: "disabled", embedded: 0, total: 0 };
  }
  recordSessionProjectIdentity(db, sessionId, projectIdentity);
  const maxInputTokens = getProjectEmbeddingMaxInputTokens2(projectIdentity);
  const total = await countUnembeddedSessionCompartmentsPolite(db, projectIdentity, sessionId, snapshot.chunkModelId, maxInputTokens);
  const holderId = `session-embed-${randomUUID()}`;
  const lease = acquireGitSweepLease(db, projectIdentity, holderId, { ignoreCooldown: true });
  if (!lease.acquired)
    return { status: "busy", embedded: 0, total };
  let leaseLost = false;
  const drainAbort = new AbortController;
  const forwardCallerAbort = () => drainAbort.abort();
  if (options?.signal?.aborted)
    drainAbort.abort();
  else
    options?.signal?.addEventListener("abort", forwardCallerAbort, { once: true });
  const renewal = setInterval(() => {
    try {
      if (!renewGitSweepLease(db, projectIdentity, holderId)) {
        leaseLost = true;
        drainAbort.abort();
      }
    } catch {}
  }, SESSION_EMBED_LEASE_RENEWAL_MS);
  renewal.unref?.();
  const batchSize = Math.max(1, options?.batchSize ?? CHUNK_DRAIN_BATCH_SIZE);
  const skipIds = [];
  const failedIds = [];
  let embedded = 0;
  let aborted = false;
  let providerDown = false;
  let consecutiveFailedBatches = 0;
  const failureReasons = [];
  try {
    options?.onProgress?.({ embedded, total });
    for (;; ) {
      if (leaseLost || drainAbort.signal.aborted || isEmbeddingHostBusy2()) {
        aborted = true;
        break;
      }
      const candidates = await loadUnembeddedSessionChunkCandidatesPolite(db, projectIdentity, sessionId, snapshot.chunkModelId, batchSize, [...skipIds, ...failedIds], maxInputTokens, true);
      if (candidates.length === 0)
        break;
      const {
        embedded: n,
        noWork,
        failed,
        failureReasons: batchFailureReasons
      } = await embedCandidateChunkBatch(db, projectIdentity, snapshot.chunkModelId, candidates, drainAbort.signal);
      if (leaseLost || !renewGitSweepLease(db, projectIdentity, holderId)) {
        leaseLost = true;
        drainAbort.abort();
        aborted = true;
        break;
      }
      failureReasons.push(...batchFailureReasons);
      for (const id of noWork)
        skipIds.push(id);
      for (const id of failed)
        failedIds.push(id);
      if (n === 0 && noWork.length === 0) {
        consecutiveFailedBatches += 1;
        if (consecutiveFailedBatches >= MAX_CONSECUTIVE_FAILED_BATCHES) {
          providerDown = true;
          break;
        }
      } else {
        consecutiveFailedBatches = 0;
      }
      embedded += n;
      options?.onProgress?.({ embedded: Math.min(embedded, total), total });
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  } finally {
    clearInterval(renewal);
    options?.signal?.removeEventListener("abort", forwardCallerAbort);
    try {
      releaseGitSweepLease(db, projectIdentity, holderId);
    } catch (error) {
      log2("[magic-context] embed drain: lease release failed (will TTL-expire):", error);
    }
  }
  if (total === 0)
    return { status: "nothing", embedded: 0, total: 0 };
  if (aborted)
    return { status: "aborted", embedded, total, failed: failedIds.length };
  if (providerDown || failedIds.length > 0) {
    const remaining = Math.max(failedIds.length, await countUnembeddedSessionCompartmentsPolite(db, projectIdentity, sessionId, snapshot.chunkModelId, maxInputTokens) - skipIds.length);
    if (remaining > 0) {
      return {
        status: "stalled",
        embedded,
        total,
        remaining,
        failed: failedIds.length,
        failure: dominantEmbeddingFailure(failureReasons)
      };
    }
  }
  return { status: "done", embedded, total, failed: failedIds.length };
}
function getEmbeddingCoverageStatus2(db, projectIdentity, sessionId) {
  const snapshot = getProjectEmbeddingSnapshot2(projectIdentity);
  if (!snapshot?.historyEnabled || snapshot.chunkModelId === "off") {
    return {
      enabled: false,
      model: snapshot?.model ?? "off",
      provider: snapshot?.provider ?? "off",
      ...snapshot?.synapseDescriptor ? { synapseDescriptor: snapshot.synapseDescriptor } : {},
      session: { embedded: 0, total: 0 },
      memories: { embedded: 0, total: 0 },
      commits: { embedded: 0, total: 0, gitEnabled: false },
      shadowBackfillStalls: listShadowBackfillStalls2(db, projectIdentity)
    };
  }
  const session = countSessionCompartmentEmbedCoverage(db, projectIdentity, sessionId, snapshot.chunkModelId, getProjectEmbeddingMaxInputTokens2(projectIdentity));
  const memories = snapshot.enabled ? getMemoryEmbedCoverage(db, projectIdentity, snapshot.modelId) : { embedded: 0, total: 0, memoryEnabled: false };
  const gitEnabled = snapshot.gitCommitEnabled;
  const commits = gitEnabled ? {
    embedded: countEmbeddedCommits(db, projectIdentity, snapshot.modelId),
    total: getCommitCount(db, projectIdentity),
    gitEnabled: true
  } : { embedded: 0, total: 0, gitEnabled: false };
  return {
    enabled: true,
    model: snapshot.model,
    provider: snapshot.provider,
    ...snapshot.synapseDescriptor ? { synapseDescriptor: snapshot.synapseDescriptor } : {},
    session,
    memories,
    commits,
    shadowBackfillStalls: listShadowBackfillStalls2(db, projectIdentity)
  };
}
async function getAutoEmbeddingSessionCoverage2(db, projectIdentity, sessionId) {
  const snapshot = getProjectEmbeddingSnapshot2(projectIdentity);
  if (!snapshot?.historyEnabled || snapshot.chunkModelId === "off") {
    return { enabled: false, embedded: 0, total: 0 };
  }
  const coverage = await countSessionCompartmentEmbedCoveragePolite(db, projectIdentity, sessionId, snapshot.chunkModelId, getProjectEmbeddingMaxInputTokens2(projectIdentity));
  return { enabled: true, ...coverage };
}
async function sweepAllRegisteredProjects2(db, batchSize = 10) {
  if (projectSweepInProgress || isEmbeddingHostBusy2()) {
    log2("[magic-context] project embedding sweep already in progress, skipping this tick");
    return {
      memoriesEmbedded: 0,
      commitsEmbedded: 0,
      chunksEmbedded: 0,
      perProject: new Map
    };
  }
  projectSweepInProgress = true;
  const startedAt = Date.now();
  const deadline = startedAt + SWEEP_MAX_WALL_CLOCK_MS;
  const perProject = new Map;
  let memoriesEmbedded = 0;
  let commitsEmbedded = 0;
  let chunksEmbedded = 0;
  try {
    for (const projectIdentity of projectRegistrations.keys()) {
      let memories = 0;
      let commits = 0;
      let chunks = 0;
      let consecutiveEmpty = 0;
      while (Date.now() < deadline && !isEmbeddingHostBusy2()) {
        const count = await embedUnembeddedMemoriesForProject2(db, projectIdentity, batchSize);
        if (count === 0) {
          consecutiveEmpty += 1;
          if (consecutiveEmpty >= SWEEP_MAX_CONSECUTIVE_EMPTY)
            break;
          break;
        }
        consecutiveEmpty = 0;
        memories += count;
        memoriesEmbedded += count;
        if (count < batchSize)
          break;
      }
      if (Date.now() < deadline) {
        commits = await drainCommitBacklogForProject2(db, projectIdentity, deadline);
        commitsEmbedded += commits;
      }
      if (Date.now() < deadline) {
        chunks = await drainCompartmentChunkBacklogForProject(db, projectIdentity, deadline);
        chunksEmbedded += chunks;
      }
      perProject.set(projectIdentity, { memories, commits, chunks });
      if (Date.now() >= deadline)
        break;
    }
  } finally {
    projectSweepInProgress = false;
  }
  return { memoriesEmbedded, commitsEmbedded, chunksEmbedded, perProject };
}
function _setTestProviderFactoryForProject2(factory) {
  testProviderFactory = factory;
}
function _resetProjectEmbeddingRegistryForTests2() {
  for (const registration of projectRegistrations.values()) {
    disposeProvider(registration.provider);
  }
  for (const registration of shadowRegistrations.values()) {
    disposeProvider(registration.provider);
  }
  projectRegistrations.clear();
  shadowRegistrations.clear();
  shadowQueue.length = 0;
  pendingShadowBackfills.clear();
  shadowBackfillLastIds.clear();
  shadowBackfillStopReasons.clear();
  shadowBackfillLastWriteOutcomes.clear();
  dbForShadowQueue.clear();
  untrustedLoadProjects.clear();
  globalRegistrationGeneration = 0;
  projectSweepInProgress = false;
  testProviderFactory = null;
  shadowBackfillNow = () => Date.now();
  setBootQuietPeriodForTests(null);
}

export { recordSessionProjectIdentity, recordEmbeddingMeasurement, OpenAICompatibleEmbeddingProvider, drainBackgroundBatches, saveCommitEmbedding, loadProjectCommitEmbeddings, loadUnembeddedCommits, countEmbeddedCommits, upsertCommits, getLatestIndexedCommitSha, enforceProjectCap, GIT_SWEEP_LEASE_RENEWAL_MS, acquireGitSweepLease, renewGitSweepLease, markGitSweepSuccessAndRelease, parkGitSweepNonIndexable, releaseGitSweepLease, describeShadowBackfillWriteRefusal2, listShadowBackfillStalls2, getShadowBackfillStopReason2, markProjectLoadUntrusted2, contentSha2562, drainProjectEmbeddingIdentityMaintenance2, drainStaleEmbeddingIdentitiesForProject2, registerProjectEmbedding2, registerProjectShadowEmbedding2, getShadowEmbeddingMeasurementCohort2, getPrimaryEmbeddingMeasurementCohort2, embedShadowTextForProject2, enqueueShadowEmbeddingItems2, getShadowBackfillRemaining2, flushShadowEmbeddingBacklog2, registerProjectInObservationMode2, unregisterProjectShadowEmbedding2, unregisterProjectEmbedding2, getProjectEmbeddingSnapshot2, installProjectEmbeddingSearchBridge2, getProjectChunkEmbeddingModelId2, getProjectEmbeddingMaxInputTokens2, embedTextForProject2, embedBatchForProject2, embedItemsForProject2, embedUnembeddedMemoriesForProject2, drainCommitBacklogForProject2, embedUnembeddedCompartmentChunksForProject2, embedSessionCompartmentChunks2, getEmbeddingCoverageStatus2, getAutoEmbeddingSessionCoverage2, sweepAllRegisteredProjects2, _setTestProviderFactoryForProject2, _resetProjectEmbeddingRegistryForTests2 };
