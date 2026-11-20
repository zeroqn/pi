import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  sanitizeDiagnosticText,
  sanitizeConfigValue
} from "./index-dnp1jjar.js";

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
  unlinkSync,
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
function getMagicContextHistorianDir(harness = getHarness2()) {
  return path.join(getMagicContextTempDir(harness), "historian");
}
function getMagicContextHistorianSessionDir(sessionId, harness = getHarness2()) {
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]/g, "-");
  const directoryName = /^\.*$/.test(safeSessionId) ? "unknown-session" : safeSessionId;
  return path.join(getMagicContextHistorianDir(harness), directoryName);
}
function getProjectMagicContextDir(directory) {
  return path.join(directory, ".cortexkit", "magic-context");
}
function ensureCortexKitArtifactGitignore(directory) {
  try {
    const artifactDir = getProjectMagicContextDir(directory);
    const gitignorePath = path.join(artifactDir, ".gitignore");
    mkdirSync(artifactDir, { recursive: true });
    if (!existsSync(gitignorePath) || readFileSync(gitignorePath, "utf8") !== `*
`) {
      writeFileSync(gitignorePath, `*
`, "utf8");
    }
    const sharedPath = path.join(directory, ".cortexkit", ".gitignore");
    if (!existsSync(sharedPath))
      return;
    const existing = readFileSync(sharedPath).toString("latin1");
    const next = existing.replace(/^# >>> cortexkit:magic-context\r?\n(?:(?!^# (?:>>>|<<<) cortexkit:)[\s\S])*?^# <<< cortexkit:magic-context(?:\r?\n|$)/gm, "");
    if (next === existing)
      return;
    const remaining = Buffer.from(next, "latin1");
    if (remaining.toString("utf8").trim() === "")
      unlinkSync(sharedPath);
    else
      writeFileSync(sharedPath, remaining);
  } catch (error) {
    log2("Failed to ensure project artifact gitignore", { directory, error: String(error) });
  }
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

export { getDataDir, getMagicContextHistorianSessionDir, ensureCortexKitArtifactGitignore, getMagicContextStorageDir, isMagicContextStorageOutsideEngram, claimStorageBackupWarningCheck, getLegacyOpenCodeMagicContextStorageDir, registerStalePluginBuildHost, classifyStalePluginBuild, importPluginModule, setLogLineForwarder2, writeForwardedLogLine2, log2, sessionLog2, getLoggerDiagnostics2, flushLogger2, getLogFilePath2 };
