import {
  getHarness2
} from "./index-0h2mkab2.js";

// ../plugin/src/shared/logger.ts
import * as fs from "node:fs";
import * as path2 from "node:path";

// ../plugin/src/shared/data-path.ts
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync
} from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ../plugin/src/shared/test-temp-dir.ts
var STALE_TEMP_DIR_AGE_MS = 60 * 60 * 1000;
var registeredTempDirs = new Set;

// ../plugin/src/shared/data-path.ts
function getDataDir() {
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
}
function getMagicContextTempDir(harness = getHarness2()) {
  return path.join(os.tmpdir(), harness, "magic-context");
}
function getMagicContextLogPath(harness = getHarness2()) {
  const envPath = process.env.MAGIC_CONTEXT_LOG_PATH?.trim();
  if (envPath)
    return envPath;
  return path.join(getMagicContextTempDir(harness), "magic-context.log");
}
function getProjectMagicContextDir(directory) {
  return path.join(directory, ".cortexkit", "magic-context");
}
var GITIGNORE_GUARD_OPEN = "# >>> cortexkit:magic-context";
var GITIGNORE_GUARD_CLOSE = "# <<< cortexkit:magic-context";
function ensureCortexKitArtifactGitignore(directory) {
  try {
    const cortexKitDir = path.join(directory, ".cortexkit");
    const gitignorePath = path.join(cortexKitDir, ".gitignore");
    let existing = "";
    if (existsSync(gitignorePath)) {
      existing = readFileSync(gitignorePath, "utf8");
      if (existing.includes(GITIGNORE_GUARD_OPEN))
        return;
    }
    const block = `${GITIGNORE_GUARD_OPEN}
magic-context/
${GITIGNORE_GUARD_CLOSE}
`;
    const needsLeadingNewline = existing.length > 0 && !existing.endsWith(`
`);
    const next = existing + (needsLeadingNewline ? `
` : "") + block;
    mkdirSync(cortexKitDir, { recursive: true });
    writeFileSync(gitignorePath, next, "utf8");
  } catch {}
}
function getProjectMagicContextHistorianDir(directory) {
  return path.join(getProjectMagicContextDir(directory), "historian");
}
function getOpenCodeStorageDir() {
  return path.join(getDataDir(), "opencode", "storage");
}
function getMagicContextStorageResolution() {
  const testDataDir = process.env.MAGIC_CONTEXT_TEST_DATA_DIR?.trim();
  if (testDataDir) {
    const perTestDataHome = process.env.XDG_DATA_HOME?.trim();
    if (perTestDataHome && path.resolve(perTestDataHome) !== path.resolve(testDataDir)) {
      return {
        path: path.join(perTestDataHome, "cortexkit", "magic-context"),
        source: "test isolation"
      };
    }
    return {
      path: path.join(testDataDir, "cortexkit", "magic-context"),
      source: "test isolation"
    };
  }
  if (false) {}
  const explicitStorageDir = process.env.MAGIC_CONTEXT_STORAGE_DIR?.trim();
  if (explicitStorageDir) {
    if (!path.isAbsolute(explicitStorageDir)) {
      throw new Error("MAGIC_CONTEXT_STORAGE_DIR must be an absolute path");
    }
    return { path: explicitStorageDir, source: "environment override" };
  }
  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  if (xdgDataHome) {
    return {
      path: path.join(xdgDataHome, "cortexkit", "magic-context"),
      source: "XDG_DATA_HOME"
    };
  }
  return {
    path: path.join(os.homedir(), ".local", "share", "cortexkit", "magic-context"),
    source: "platform default"
  };
}
function getMagicContextStorageDir() {
  return getMagicContextStorageResolution().path;
}
function canonicalizeStoragePath(value, seen = new Set) {
  const absolute = path.resolve(value);
  if (seen.has(absolute))
    return absolute;
  seen.add(absolute);
  try {
    return realpathSync.native(absolute);
  } catch {
    try {
      if (lstatSync(absolute).isSymbolicLink()) {
        const target = readlinkSync(absolute);
        const resolvedTarget = path.isAbsolute(target) ? target : path.resolve(path.dirname(absolute), target);
        return canonicalizeStoragePath(resolvedTarget, seen);
      }
    } catch {}
    const parent = path.dirname(absolute);
    if (parent === absolute)
      return absolute;
    const resolvedParent = canonicalizeStoragePath(parent, seen);
    return path.resolve(resolvedParent, path.basename(absolute));
  }
}
function isMagicContextStorageOutsideEngram(storageDir = getMagicContextStorageDir(), backupDir = path.join(os.homedir(), ".local", "share", "cortexkit", "magic-context")) {
  const resolvedStorageDir = canonicalizeStoragePath(storageDir);
  const resolvedBackupDir = canonicalizeStoragePath(backupDir);
  const relative2 = path.relative(resolvedBackupDir, resolvedStorageDir);
  return path.isAbsolute(relative2) || relative2 === ".." || relative2.startsWith(`..${path.sep}`);
}
var STORAGE_BACKUP_WARNING_CHECKED = Symbol.for("magic-context.storage-backup-warning-checked");
function claimStorageBackupWarningCheck() {
  const processState = globalThis;
  if (processState[STORAGE_BACKUP_WARNING_CHECKED])
    return false;
  processState[STORAGE_BACKUP_WARNING_CHECKED] = true;
  return true;
}
function getLegacyOpenCodeMagicContextStorageDir() {
  return path.join(getOpenCodeStorageDir(), "plugin", "magic-context");
}

// ../plugin/src/shared/redaction.ts
import { homedir as homedir2, userInfo } from "node:os";
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var SECRET_WORDS = [
  "key",
  "token",
  "secret",
  "password",
  "auth",
  "authorization",
  "bearer",
  "credential"
];
var SECRET_SEGMENT_PATTERN = new RegExp(`^(?:${SECRET_WORDS.map((w) => `${w}s?`).join("|")})$`, "i");
var TRAILING_DESCRIPTORS = new Set(["id", "ids", "value", "values", "header", "headers"]);
function redactionTypeForKey(key) {
  const normalized = key.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_");
  const suffix = normalized.split(".").filter(Boolean).at(-1) ?? normalized;
  return suffix || "secret";
}
function isNonSecretScalarValue(value) {
  const v = value.trim();
  if (v === "true" || v === "false" || v === "null" || v === "undefined")
    return true;
  return /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v);
}
var SECRET_QUALIFIERS = new Set([
  "api",
  "access",
  "private",
  "client",
  "auth",
  "authorization",
  "secret",
  "bearer",
  "session",
  "refresh",
  "service",
  "x",
  "openai",
  "anthropic",
  "google",
  "github",
  "huggingface",
  "aws",
  "azure",
  "id"
]);
var UNQUALIFIED_SECRET_SEGMENT_PATTERN = /^(?:password|secret|credential|bearer|authorization)s?$/;
function isSecretKey(key) {
  const segments = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[._-]+/).filter(Boolean);
  if (segments.length === 0)
    return false;
  if (segments.length === 1) {
    const first = segments[0];
    return Boolean(first && SECRET_SEGMENT_PATTERN.test(first));
  }
  for (let i = 0;i < segments.length; i++) {
    const seg = segments[i];
    if (!seg || !SECRET_SEGMENT_PATTERN.test(seg))
      continue;
    let trailingOk = true;
    for (let j = i + 1;j < segments.length; j++) {
      const tail = segments[j];
      if (!tail)
        continue;
      if (TRAILING_DESCRIPTORS.has(tail))
        continue;
      if (SECRET_SEGMENT_PATTERN.test(tail))
        continue;
      trailingOk = false;
      break;
    }
    if (!trailingOk)
      continue;
    if (UNQUALIFIED_SECRET_SEGMENT_PATTERN.test(seg))
      return true;
    for (let k = i - 1;k >= 0; k--) {
      const lead = segments[k];
      if (lead && SECRET_QUALIFIERS.has(lead))
        return true;
    }
  }
  return false;
}
function sanitizePathString(value) {
  const home = process.env.HOME || process.env.USERPROFILE || homedir2();
  const username = userInfo().username;
  let sanitized = value;
  if (home) {
    sanitized = sanitized.replace(new RegExp(escapeRegex(home), "g"), "~");
  }
  sanitized = sanitized.replace(/\/Users\/[^/]+\//g, "/Users/<USER>/");
  sanitized = sanitized.replace(/\/home\/[^/]+\//g, "/home/<USER>/");
  sanitized = sanitized.replace(/C:\\Users\\[^\\]+\\/g, "C:\\Users\\<USER>\\");
  if (username) {
    sanitized = sanitized.replace(new RegExp(escapeRegex(username), "g"), "<USER>");
  }
  return sanitized;
}
var SECRET_TEXT_PATTERNS = [
  {
    pattern: /\bsk-ant-(?:api03-)?[A-Za-z0-9_-]{32,}/g,
    replacement: "<ANTHROPIC_API_KEY_REDACTED>"
  },
  {
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{12,}/g,
    replacement: "<OPENAI_API_KEY_REDACTED>"
  },
  {
    pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
    replacement: "<GITHUB_PAT_REDACTED>"
  },
  {
    pattern: /\b(?:gh[opsu]|ghr)_[A-Za-z0-9_-]{30,}/g,
    replacement: "<GITHUB_TOKEN_REDACTED>"
  },
  {
    pattern: /\bhf_[A-Za-z0-9]{30,}/g,
    replacement: "<HUGGINGFACE_TOKEN_REDACTED>"
  },
  {
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: "<AWS_ACCESS_KEY_ID_REDACTED>"
  },
  {
    pattern: /\bxox[abprsuvc]-[A-Za-z0-9-]{10,}/g,
    replacement: "<SLACK_TOKEN_REDACTED>"
  },
  {
    pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g,
    replacement: "<GOOGLE_API_KEY_REDACTED>"
  },
  {
    pattern: /\b(Authorization\s*:\s*Bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi,
    replacement: (_full, prefix) => `${prefix}<REDACTED:bearer>`
  },
  {
    pattern: /\b((?:Proxy-)?Authorization\s*:\s*(?:Basic|Digest|Token|Negotiate|NTLM)\s+)([A-Za-z0-9._~+/=-]{4,})/gi,
    replacement: (_full, prefix) => `${prefix}<REDACTED:authorization>`
  },
  {
    pattern: /\b((?:x-)?(?:api-?key|api-?token|auth-?token|access-?token)\s*:\s*)([^\s'"`,;<>]{6,})/gi,
    replacement: (full, prefix, value) => isNonSecretScalarValue(value) ? full : `${prefix}<REDACTED:api_key>`
  },
  {
    pattern: /\b((?:api[_-]?key|client[_-]?secret|access[_-]?token|token|secret|password|passwd|pwd)\s*:\s*)([^\s'"`,;<>]{6,})/gi,
    replacement: (full, prefix, value) => isNonSecretScalarValue(value) ? full : `${prefix}<REDACTED:credential>`
  },
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)([^\s/@]+)(@)/gi,
    replacement: (_full, prefix, _password, at) => `${prefix}<REDACTED:password>${at}`
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    replacement: "<JWT_REDACTED>"
  },
  {
    pattern: /(["'])([^"']*(?:key|token|secret|password|auth|bearer|credential)[^"']*)\1(\s*:\s*)(["'])([^"']*)\4/gi,
    replacement: (full, quote, key, separator, valueQuote, value) => isNonSecretScalarValue(value) ? full : `${quote}${key}${quote}${separator}${valueQuote}<REDACTED:${redactionTypeForKey(key)}>${valueQuote}`
  },
  {
    pattern: /\b([A-Za-z0-9_.-]*(?:key|token|secret|password|auth|bearer|credential)[A-Za-z0-9_.-]*)\s*=\s*([^\s'"`]+)/gi,
    replacement: (full, key, value) => isNonSecretScalarValue(value) ? full : `${key}=<REDACTED:${redactionTypeForKey(key)}>`
  }
];
function redactSecretText(value) {
  let redacted = value;
  for (const { pattern, replacement } of SECRET_TEXT_PATTERNS) {
    if (typeof replacement === "string") {
      redacted = redacted.replace(pattern, replacement);
    } else {
      redacted = redacted.replace(pattern, replacement);
    }
  }
  return redacted;
}
function sanitizeDiagnosticText(value) {
  return redactSecretText(sanitizePathString(value));
}
var SHAREABILITY_SENSITIVE_PATTERNS = [
  /\bC:\/Users\/[^/\s]+/i,
  /(?:^|\s)~\/[^\s]+/,
  /\b(?:api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret|access[_-]?key)\b\s*[:=]\s*\S+/i,
  /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?\b/i,
  /\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
  /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/
];
function hasShareabilitySensitiveText(text) {
  try {
    if (sanitizeDiagnosticText(text) !== text)
      return true;
    return SHAREABILITY_SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
  } catch {
    return true;
  }
}
function sanitizeConfigValue(value, keyPath = []) {
  if (value === null || typeof value === "number" || typeof value === "boolean")
    return value;
  const key = keyPath.at(-1) ?? "";
  if (key && isSecretKey(key)) {
    return `<REDACTED:${redactionTypeForKey(key)}>`;
  }
  if (typeof value === "string")
    return sanitizeDiagnosticText(value);
  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeConfigValue(entry, [...keyPath, String(index)]));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [
      entryKey,
      sanitizeConfigValue(entry, [...keyPath, entryKey])
    ]));
  }
  return value;
}

// ../plugin/src/shared/stale-plugin-build.ts
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
var STATE = Symbol.for("magic-context.stale-plugin-build");
function state() {
  const globals = globalThis;
  return globals[STATE] ??= {
    hosts: new Map,
    loggedChunks: new Set,
    notified: false
  };
}
function absolutePath(value) {
  let path = value;
  if (path.startsWith("file:")) {
    try {
      path = fileURLToPath(path);
    } catch {
      return;
    }
  }
  path = path.replaceAll("\\", "/").replace(/^\/(?=[A-Za-z]:\/)/, "");
  if (!path.startsWith("/") && !/^[A-Za-z]:\//.test(path))
    return;
  path = posix.normalize(path);
  return /^[A-Za-z]:\//.test(path) ? path.toLowerCase() : path;
}
function distForModule(moduleUrl) {
  const path = absolutePath(moduleUrl);
  if (!path)
    return;
  const dist = path.lastIndexOf("/dist/");
  return dist < 0 ? undefined : path.slice(0, dist + "/dist".length);
}
function stalePluginBuildGuidance(harness) {
  return harness === "pi" || harness === "omp" ? "Magic Context was rebuilt while this Pi was running; type /reload to load the new build" : "Magic Context was rebuilt while this OpenCode host was running; restart the host to load the new build";
}
function deliverNotice(host) {
  const current = state();
  if (current.notified || !current.pendingNotice || !host.notify)
    return;
  current.notified = true;
  try {
    Promise.resolve(host.notify(current.pendingNotice)).catch(() => {});
  } catch {}
}
function registerStalePluginBuildHost(options) {
  const dist = distForModule(options.moduleUrl);
  if (!dist)
    return;
  const host = { ...options, dist };
  state().hosts.set(dist, host);
  deliverNotice(host);
}
function classifyStalePluginBuild(error) {
  if (error instanceof StalePluginBuildError)
    return error.build;
  const message = error instanceof Error ? error.message : String(error);
  const missing = message.match(/(?:Cannot find module|ENOENT reading)\s+(['"])(.*?)\1/);
  if (!missing)
    return null;
  let chunk = absolutePath(missing[2]);
  if (!chunk && /^\.\.?[/\\]/.test(missing[2])) {
    const importer = message.slice((missing.index ?? 0) + missing[0].length).match(/(?:imported from|from)\s+(?:['"]([^'"]+)['"]|([^\n]+))/);
    const from = importer && absolutePath((importer[1] ?? importer[2]).trim());
    if (from)
      chunk = absolutePath(posix.join(posix.dirname(from), missing[2].replaceAll("\\", "/")));
  }
  if (!chunk)
    return null;
  for (const host of state().hosts.values()) {
    if (chunk.startsWith(`${host.dist}/`)) {
      return { chunk, guidance: stalePluginBuildGuidance(host.harness) };
    }
  }
  const ownDist = distForModule(import.meta.url);
  return ownDist && chunk.startsWith(`${ownDist}/`) ? { chunk, guidance: stalePluginBuildGuidance(getHarness2()) } : null;
}

class StalePluginBuildError extends Error {
  build;
  constructor(build) {
    super(build.guidance);
    this.build = build;
    this.name = "StalePluginBuildError";
  }
}
function stalePluginBuildDiagnostic(error) {
  const pending = state().pendingNotice;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (pending && message.includes(pending))
    return null;
  const build = classifyStalePluginBuild(error);
  if (!build)
    return;
  const current = state();
  current.pendingNotice ??= build.guidance;
  for (const host of current.hosts.values())
    deliverNotice(host);
  if (current.loggedChunks.has(build.chunk))
    return null;
  current.loggedChunks.add(build.chunk);
  return `[magic-context] stale plugin build: missing ${build.chunk.replace(/[\r\n]/g, " ")}; ${build.guidance}`;
}
async function importPluginModule(load) {
  try {
    return await load();
  } catch (error) {
    const build = classifyStalePluginBuild(error);
    if (!build)
      throw error;
    log2("[magic-context] lazy import failed", error);
    throw new StalePluginBuildError(build);
  }
}

// ../plugin/src/shared/logger.ts
var isTestEnv = false;
var syncLogWrites = process.env.MAGIC_CONTEXT_LOG_SYNC === "1";
var buffer = [];
var flushTimer = null;
var FLUSH_INTERVAL_MS = 500;
var BUFFER_SIZE_LIMIT = 50;
var MAX_BUFFERED_BYTES = 1024 * 1024;
var bufferedBytes = 0;
var droppedLines = 0;
function boundBuffer() {
  while (bufferedBytes > MAX_BUFFERED_BYTES && buffer.length > 0) {
    bufferedBytes -= Buffer.byteLength(buffer.shift() ?? "");
    droppedLines++;
  }
}
var MAX_LOG_FILE_BYTES = 32 * 1024 * 1024;
var SIZE_CHECK_INTERVAL_FLUSHES = 64;
var activeLogFile = null;
var activeLogSize = null;
var flushesSinceSizeCheck = 0;
var swallowedWriteCount = 0;
var lastErrorMessage = null;
var lastErrorTime = null;
function recordSwallowedWrite(error) {
  try {
    swallowedWriteCount++;
    lastErrorMessage = sanitizeDiagnosticText(error instanceof Error ? error.message : String(error));
    lastErrorTime = new Date().toISOString();
  } catch {}
}
function ensureDir(filePath) {
  fs.mkdirSync(path2.dirname(filePath), { recursive: true });
}
function isMissingFile(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function getCurrentLogSize(logFile) {
  if (activeLogFile === logFile && activeLogSize !== null && flushesSinceSizeCheck < SIZE_CHECK_INTERVAL_FLUSHES) {
    return activeLogSize;
  }
  try {
    const stat = fs.statSync(logFile);
    if (!stat.isFile()) {
      throw new Error(`Magic Context log path is not a regular file: ${logFile}`);
    }
    fs.chmodSync(logFile, 384);
    activeLogFile = logFile;
    activeLogSize = stat.size;
    flushesSinceSizeCheck = 0;
    return stat.size;
  } catch (error) {
    if (!isMissingFile(error))
      throw error;
    activeLogFile = logFile;
    activeLogSize = 0;
    flushesSinceSizeCheck = 0;
    return 0;
  }
}
function capLogData(data) {
  if (Buffer.byteLength(data) <= MAX_LOG_FILE_BYTES)
    return data;
  let bounded = Buffer.from(data).subarray(0, MAX_LOG_FILE_BYTES).toString("utf8");
  while (Buffer.byteLength(bounded) > MAX_LOG_FILE_BYTES) {
    bounded = bounded.slice(0, -1);
  }
  return bounded;
}
function writeBoundedPredecessor(logFile, predecessorPath, size) {
  const predecessorFd = fs.openSync(predecessorPath, "w", 384);
  try {
    fs.fchmodSync(predecessorFd, 384);
    const bytesToCopy = Math.min(size, MAX_LOG_FILE_BYTES);
    const sourceFd = fs.openSync(logFile, "r");
    try {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, bytesToCopy));
      let remaining = bytesToCopy;
      let position = Math.max(0, size - bytesToCopy);
      while (remaining > 0) {
        const bytesRead = fs.readSync(sourceFd, chunk, 0, Math.min(chunk.length, remaining), position);
        if (bytesRead === 0)
          break;
        fs.writeSync(predecessorFd, chunk, 0, bytesRead);
        remaining -= bytesRead;
        position += bytesRead;
      }
    } finally {
      fs.closeSync(sourceFd);
    }
  } finally {
    fs.closeSync(predecessorFd);
  }
}
function rotateLogFile(logFile, size) {
  const predecessorPath = `${logFile}.1`;
  writeBoundedPredecessor(logFile, predecessorPath, size);
  fs.truncateSync(logFile, 0);
  activeLogSize = 0;
  flushesSinceSizeCheck = 0;
}
function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0 && droppedLines === 0)
    return;
  const notice = droppedLines ? `[${new Date().toISOString()}] [magic-context][global] logger dropped ${droppedLines} ${droppedLines === 1 ? "line" : "lines"}: buffer exceeded ${MAX_BUFFERED_BYTES} bytes while writes were pending
` : "";
  try {
    const data = capLogData(notice + buffer.join(""));
    const logFile = getMagicContextLogPath();
    ensureDir(logFile);
    let currentSize = getCurrentLogSize(logFile);
    const dataSize = Buffer.byteLength(data);
    if (currentSize > 0 && currentSize + dataSize > MAX_LOG_FILE_BYTES) {
      flushesSinceSizeCheck = SIZE_CHECK_INTERVAL_FLUSHES;
      currentSize = getCurrentLogSize(logFile);
      if (currentSize > 0 && currentSize + dataSize > MAX_LOG_FILE_BYTES) {
        rotateLogFile(logFile, currentSize);
        currentSize = 0;
      }
    }
    fs.appendFileSync(logFile, data, { encoding: "utf8", mode: 384 });
    buffer = [];
    bufferedBytes = 0;
    droppedLines = 0;
    activeLogFile = logFile;
    activeLogSize = currentSize + dataSize;
    flushesSinceSizeCheck++;
  } catch (error) {
    activeLogFile = null;
    activeLogSize = null;
    flushesSinceSizeCheck = 0;
    recordSwallowedWrite(error);
    boundBuffer();
  }
}
function scheduleFlush() {
  if (flushTimer)
    return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
}
function appendLine(line) {
  buffer.push(line);
  bufferedBytes += Buffer.byteLength(line);
  boundBuffer();
  if (syncLogWrites || buffer.length >= BUFFER_SIZE_LIMIT)
    flush();
  else
    scheduleFlush();
}
var lineForwarder = null;
function setLogLineForwarder2(forward) {
  lineForwarder = forward;
}
function writeForwardedLogLine2(line) {
  if (isTestEnv)
    return;
  try {
    appendLine(line);
  } catch {}
}
function log2(message, data) {
  try {
    let diagnostic = stalePluginBuildDiagnostic(data);
    if (diagnostic === undefined)
      diagnostic = stalePluginBuildDiagnostic(message);
    if (diagnostic === null)
      return;
    if (diagnostic !== undefined) {
      message = diagnostic;
      data = undefined;
    }
    if (isTestEnv)
      return;
    const timestamp = new Date().toISOString();
    const serialized = data === undefined ? "" : data instanceof Error ? ` ${sanitizeDiagnosticText(`${data.message}${data.stack ? `
${data.stack}` : ""}`)}` : ` ${JSON.stringify(sanitizeConfigValue(data))}`;
    const line = `[${timestamp}] ${sanitizeDiagnosticText(message)}${serialized}
`;
    if (lineForwarder) {
      lineForwarder(line);
      return;
    }
    appendLine(line);
  } catch {}
}
function sessionLog2(sessionId, message, data) {
  log2(`[magic-context][${sessionId}] ${message}`, data);
}
function getLoggerDiagnostics2() {
  return {
    swallowedWriteCount,
    lastErrorMessage,
    lastErrorTime
  };
}
function flushLogger2() {
  flush();
}
function getLogFilePath2() {
  return getMagicContextLogPath();
}
if (!isTestEnv) {
  process.on("exit", flush);
}

export { getDataDir, ensureCortexKitArtifactGitignore, getProjectMagicContextHistorianDir, getMagicContextStorageDir, isMagicContextStorageOutsideEngram, claimStorageBackupWarningCheck, getLegacyOpenCodeMagicContextStorageDir, sanitizeDiagnosticText, hasShareabilitySensitiveText, registerStalePluginBuildHost, classifyStalePluginBuild, importPluginModule, setLogLineForwarder2, writeForwardedLogLine2, log2, sessionLog2, getLoggerDiagnostics2, flushLogger2, getLogFilePath2 };
