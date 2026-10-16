import {
  getMagicContextStorageDir,
  log2
} from "./index-x3dcnxh0.js";
import {
  projectDirectoryKey
} from "./index-knxngpvf.js";
import {
  writeStorageFileAtomicSync
} from "./index-81nthk8j.js";

// ../plugin/src/features/magic-context/memory/project-identity.ts
import { execFileSync } from "node:child_process";
import { createHash as createHash2 } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path2 from "node:path";

// ../plugin/src/features/magic-context/memory/project-identity-cache.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
function cachePath(directory, storageDir = getMagicContextStorageDir()) {
  const hash = createHash("sha256").update(projectDirectoryKey(directory)).digest("hex");
  return path.join(storageDir, "project-identities", `${hash}.json`);
}
function rememberGitIdentity(directory, identity) {
  try {
    const destination = cachePath(directory);
    writeStorageFileAtomicSync(destination, JSON.stringify({ directory: projectDirectoryKey(directory), identity }));
  } catch {}
}
function readRememberedGitIdentity(directory, storageDir) {
  try {
    const record = JSON.parse(readFileSync(cachePath(directory, storageDir), "utf8"));
    if (record.directory === projectDirectoryKey(directory) && /^git:[0-9a-f]{7,64}$/.test(record.identity))
      return record.identity;
  } catch {}
  return;
}

// ../plugin/src/features/magic-context/memory/project-identity.ts
var GIT_TIMEOUT_MS = 5000;
var TRANSIENT_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
var identityCache = new Map;
var linkedGitWorktreeCache = new Map;
var lastKnownGitIdentityCache = new Map;
var directoryFallbackCache = new Map;
var transientFailureCooldown = new Map;
var dubiousOwnershipFallbackDirectories = new Set;
var dubiousOwnershipLoggedDirectories = new Set;
var dubiousOwnershipWarnedDirectories = new Set;
var transientGitIdentityReuseLoggedDirectories = new Set;
var sessionIdentityCache = new Map;
var homeProjectPermission = false;
var pausedIdentityReasons = new Map;
var pausedIdentityLogged = new Set;
function setHomeProjectPermission(allowed) {
  homeProjectPermission = allowed;
}
var execFileSyncForIdentity = execFileSync;
var userHomeDirectoryForIdentity = () => homedir();
var nowMs = () => Date.now();
var filesystemProbeObserverForTests;

class ProjectIdentityError extends Error {
  errorClass;
  rawDirectory;
  constructor(errorClass, rawDirectory, message, cause) {
    super(message);
    this.name = "ProjectIdentityError";
    this.errorClass = errorClass;
    this.rawDirectory = rawDirectory;
    if (cause) {
      this.cause = cause;
    }
  }
}
function asError(error) {
  return error instanceof Error ? error : undefined;
}
function getErrorCode(error) {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return;
  }
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}
function getErrorSignal(error) {
  if (error === null || typeof error !== "object" || !("signal" in error)) {
    return;
  }
  const signal = error.signal;
  return typeof signal === "string" ? signal : undefined;
}
function getErrorKilled(error) {
  if (error === null || typeof error !== "object" || !("killed" in error)) {
    return false;
  }
  return error.killed === true;
}
function getErrorStderr(error) {
  if (error === null || typeof error !== "object" || !("stderr" in error)) {
    return "";
  }
  const stderr = error.stderr;
  if (typeof stderr === "string") {
    return stderr;
  }
  if (Buffer.isBuffer(stderr)) {
    return stderr.toString("utf8");
  }
  return "";
}
function directoryFallback(directory) {
  const canonical = path2.resolve(directory);
  const hash = createHash2("md5").update(canonical, "utf8").digest("hex").slice(0, 12);
  return `dir:${hash}`;
}
function rememberedIdentityOrDirectoryFallback(canonical) {
  return readRememberedGitIdentity(canonical) ?? directoryFallback(canonical);
}
function assertDirectoryUsable(canonicalDirectory, rawDirectory) {
  try {
    const stat = statSync(canonicalDirectory);
    if (!stat.isDirectory()) {
      throw new ProjectIdentityError("unknown", rawDirectory, `Project path is not a directory: ${canonicalDirectory}`);
    }
  } catch (error) {
    if (error instanceof ProjectIdentityError) {
      throw error;
    }
    const code = getErrorCode(error);
    if (code === "EACCES" || code === "EPERM") {
      throw new ProjectIdentityError("permission_denied", rawDirectory, `Permission denied while accessing project directory: ${canonicalDirectory}`, asError(error));
    }
    throw new ProjectIdentityError("unknown", rawDirectory, `Unable to access project directory: ${canonicalDirectory}`, asError(error));
  }
}
function isGitTimeoutError(error) {
  const code = getErrorCode(error);
  const signal = getErrorSignal(error);
  return code === "ETIMEDOUT" || signal === "SIGTERM" || signal === "SIGKILL" || getErrorKilled(error);
}
function hasUnbornHead(directory) {
  const options = {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true
  };
  try {
    execFileSyncForIdentity("git", ["rev-parse", "--git-dir"], options);
    try {
      execFileSyncForIdentity("git", ["rev-parse", "--verify", "--quiet", "HEAD"], options);
      return false;
    } catch (error) {
      return !isGitTimeoutError(error) && typeof error === "object" && error !== null && "status" in error && error.status === 1 && getErrorStderr(error) === "";
    }
  } catch {
    return false;
  }
}
function classifyGitError(error, rawDirectory) {
  if (isGitTimeoutError(error)) {
    return new ProjectIdentityError("git_timeout", rawDirectory, `git rev-list timed out after ${GIT_TIMEOUT_MS}ms`, asError(error));
  }
  const code = getErrorCode(error);
  if (code === "ENOENT") {
    return new ProjectIdentityError("git_missing", rawDirectory, "git binary is not available in PATH", asError(error));
  }
  if (code === "EACCES" || code === "EPERM") {
    return new ProjectIdentityError("permission_denied", rawDirectory, "Permission denied while spawning git", asError(error));
  }
  const stderr = getErrorStderr(error).toLowerCase();
  if (stderr.includes("detected dubious ownership")) {
    return new ProjectIdentityError("dubious_ownership", rawDirectory, "git refused to read the repository because it detected dubious ownership", asError(error));
  }
  if (stderr.includes("not a git repository") || stderr.includes("does not have any commits yet") || stderr.includes("ambiguous argument 'head'") || stderr.includes("unknown revision or path")) {
    return new ProjectIdentityError("not_git_repo", rawDirectory, "Directory has no git root commit; caller may use directory fallback", asError(error));
  }
  return new ProjectIdentityError("unknown", rawDirectory, "git rev-list failed while resolving project identity", asError(error));
}
function resolveProjectIdentityStrict(directory, allowHomeProject = homeProjectPermission, options = {}) {
  assertProjectAllowed(directory, allowHomeProject);
  const canonical = path2.resolve(directory);
  const cached = options.cache === false ? undefined : identityCache.get(canonical);
  if (cached !== undefined) {
    return cached;
  }
  assertDirectoryUsable(canonical, directory);
  if (!hasGitDir(canonical)) {
    throw new ProjectIdentityError("not_git_repo", directory, "Directory has no git metadata; caller may use directory fallback");
  }
  let output;
  try {
    output = execFileSyncForIdentity("git", ["rev-list", "--max-parents=0", "HEAD"], {
      cwd: canonical,
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true
    });
  } catch (error) {
    const classified = classifyGitError(error, directory);
    if (classified.errorClass === "not_git_repo" && hasUnbornHead(canonical)) {
      throw new ProjectIdentityError("no_commits", directory, "Git repository has no commits yet");
    }
    throw classified;
  }
  const rootCommit = output.split(`
`).map((line) => line.trim().slice(0, 64)).filter((line) => /^[0-9a-f]{7,64}$/.test(line)).sort()[0];
  if (!rootCommit) {
    throw new ProjectIdentityError("unknown", directory, "git rev-list returned no valid root commit hash");
  }
  const identity = `git:${rootCommit}`;
  if (options.cache === false)
    return identity;
  identityCache.set(canonical, identity);
  lastKnownGitIdentityCache.set(canonical, identity);
  rememberGitIdentity(canonical, identity);
  const root = gitRootDirectory(canonical);
  if (root && root !== canonical)
    rememberGitIdentity(root, identity);
  transientFailureCooldown.delete(canonical);
  dubiousOwnershipFallbackDirectories.delete(canonical);
  transientGitIdentityReuseLoggedDirectories.delete(canonical);
  return identity;
}
function shouldUseDirectoryFallback(error) {
  return error.errorClass !== "home_project_disabled";
}
function getActiveCooldown(canonical) {
  const until = transientFailureCooldown.get(canonical);
  if (until === undefined)
    return;
  if (nowMs() < until)
    return until;
  transientFailureCooldown.delete(canonical);
  return;
}
function lastKnownGitIdentity(canonical) {
  return lastKnownGitIdentityCache.get(canonical) ?? identityCache.get(canonical) ?? readRememberedGitIdentity(canonical);
}
function nearestLastKnownGitIdentity(canonical) {
  const visited = new Set;
  const walk = (start) => {
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      const cached = lastKnownGitIdentity(current);
      if (cached !== undefined)
        return { identity: cached, source: current };
      if (existsSync(path2.join(current, ".git")))
        break;
      const parent = path2.dirname(current);
      if (parent === current)
        break;
      current = parent;
    }
    return;
  };
  const exactOrAncestor = walk(canonical);
  if (exactOrAncestor)
    return exactOrAncestor;
  try {
    const realCanonical = realpathSync.native(canonical);
    if (realCanonical !== canonical)
      return walk(realCanonical);
  } catch {}
  return;
}
function reuseLastKnownGitIdentity(canonical) {
  const cached = nearestLastKnownGitIdentity(canonical);
  if (cached === undefined)
    return;
  if (!transientGitIdentityReuseLoggedDirectories.has(canonical)) {
    transientGitIdentityReuseLoggedDirectories.add(canonical);
    const sourceNote = cached.source === canonical ? "" : ` from ancestor ${cached.source}`;
    log2(`[magic-context] git identity resolution is temporarily unavailable for ${canonical}; reusing the last successful project identity${sourceNote} to avoid splitting project-scoped memory`);
  }
  return cached.identity;
}
function formatDubiousOwnershipWarning(canonical) {
  return `Magic Context: git refused to read ${canonical} (dubious ownership — the repo is owned by a different user). Memory features are paused unless a previous git identity is available. Fix: git config --global --add safe.directory ${canonical}`;
}
function recordDubiousOwnershipFallback(canonical) {
  dubiousOwnershipFallbackDirectories.add(canonical);
  if (dubiousOwnershipLoggedDirectories.has(canonical))
    return;
  dubiousOwnershipLoggedDirectories.add(canonical);
  log2(`[magic-context] ${formatDubiousOwnershipWarning(canonical)}`);
}
function canonicalUserHomeDirectory() {
  const homeDirectory = userHomeDirectoryForIdentity();
  try {
    return realpathSync.native(homeDirectory);
  } catch {
    return homeDirectory;
  }
}
function isUserHomeDirectory(directory) {
  if (projectDirectoryKey(directory) === projectDirectoryKey(userHomeDirectoryForIdentity()))
    return true;
  try {
    return projectDirectoryKey(realpathSync.native(path2.resolve(directory))) === projectDirectoryKey(canonicalUserHomeDirectory());
  } catch {
    return false;
  }
}
function assertProjectAllowed(directory, allowHomeProject) {
  const canonical = path2.resolve(directory);
  if (!allowHomeProject && (isUserHomeDirectory(directory) || isUserHomeDirectory(gitRootDirectory(canonical) ?? canonical))) {
    throw new ProjectIdentityError("home_project_disabled", directory, "Home project memory is disabled; set allow_home_project to opt in");
  }
}
function resolveProjectIdentity(directory, allowHomeProject = homeProjectPermission) {
  assertProjectAllowed(directory, allowHomeProject);
  const canonical = path2.resolve(directory);
  const cachedFallback = directoryFallbackCache.get(canonical);
  if (cachedFallback !== undefined) {
    if (!hasGitDir(canonical)) {
      return cachedFallback;
    }
    directoryFallbackCache.delete(canonical);
  }
  if (getActiveCooldown(canonical) !== undefined) {
    if (hasGitDir(canonical)) {
      const cachedGitIdentity = reuseLastKnownGitIdentity(canonical);
      if (cachedGitIdentity !== undefined) {
        return cachedGitIdentity;
      }
      throw new ProjectIdentityError("git_identity_unavailable", directory, "Git identity unavailable; memory features paused until the retry cooldown expires");
    }
    return rememberedIdentityOrDirectoryFallback(canonical);
  }
  try {
    return resolveProjectIdentityStrict(directory, allowHomeProject);
  } catch (error) {
    if (error instanceof ProjectIdentityError && shouldUseDirectoryFallback(error)) {
      if (error.errorClass === "no_commits")
        return directoryFallback(canonical);
      if (!hasGitDir(canonical)) {
        if (error.errorClass === "permission_denied")
          throw error;
        const resolved = rememberedIdentityOrDirectoryFallback(canonical);
        directoryFallbackCache.set(canonical, resolved);
        transientFailureCooldown.delete(canonical);
        return resolved;
      }
      transientFailureCooldown.set(canonical, nowMs() + TRANSIENT_FAILURE_COOLDOWN_MS);
      const cachedGitIdentity = reuseLastKnownGitIdentity(canonical);
      if (error.errorClass === "dubious_ownership")
        recordDubiousOwnershipFallback(canonical);
      if (cachedGitIdentity !== undefined) {
        return cachedGitIdentity;
      }
      throw error;
    }
    throw error;
  }
}
function resolveProjectIdentityOrFallback(directory, allowHomeProject = homeProjectPermission) {
  try {
    return resolveProjectIdentity(directory, allowHomeProject);
  } catch (error) {
    const canonical = path2.resolve(directory);
    if (hasGitDir(canonical) || error instanceof ProjectIdentityError && error.errorClass === "home_project_disabled")
      throw error;
    const fallback = rememberedIdentityOrDirectoryFallback(canonical);
    const message = error instanceof Error ? error.message : String(error);
    log2(`[magic-context] project identity resolution failed for ${canonical}; using directory fallback ${fallback}: ${message}`);
    return fallback;
  }
}
function hasGitDir(canonical) {
  if (hasGitDirInAncestorChain(canonical)) {
    return true;
  }
  try {
    const realCanonical = realpathSync.native(canonical);
    return realCanonical !== canonical && hasGitDirInAncestorChain(realCanonical);
  } catch {
    return false;
  }
}
function gitRootInAncestorChain(startDirectory) {
  let current = startDirectory;
  while (true) {
    if (existsSync(path2.join(current, ".git"))) {
      try {
        return realpathSync.native(current);
      } catch {
        return path2.resolve(current);
      }
    }
    const parent = path2.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
function hasGitDirInAncestorChain(startDirectory) {
  return gitRootInAncestorChain(startDirectory) !== null;
}
function gitRootDirectory(canonical) {
  const direct = gitRootInAncestorChain(canonical);
  if (direct)
    return direct;
  try {
    const realCanonical = realpathSync.native(canonical);
    return realCanonical === canonical ? null : gitRootInAncestorChain(realCanonical);
  } catch {
    return null;
  }
}
function directoryHasGitMetadata(directory) {
  return gitRootDirectory(path2.resolve(directory)) !== null;
}
function isUsableProjectIdentity(identity) {
  return typeof identity === "string" && identity.trim().length > 0;
}
function resolveProjectIdentityForSession(directory, allowHomeProject = homeProjectPermission) {
  const resolvedDirectory = path2.resolve(directory);
  const cacheKey = `${allowHomeProject ? "1" : "0"}\x00${resolvedDirectory}`;
  const cached = sessionIdentityCache.get(cacheKey);
  if (cached && (cached.revalidateAt === null || nowMs() < cached.revalidateAt) && !(cached.identity?.startsWith("dir:") && hasGitDir(resolvedDirectory))) {
    return cached.identity;
  }
  sessionIdentityCache.delete(cacheKey);
  filesystemProbeObserverForTests?.();
  const canonicalDirectory = (() => {
    try {
      filesystemProbeObserverForTests?.();
      return realpathSync.native(resolvedDirectory);
    } catch {
      return resolvedDirectory;
    }
  })();
  filesystemProbeObserverForTests?.();
  const homeRoot = gitRootDirectory(canonicalDirectory);
  const inheritsHomeRepository = homeRoot !== null && isUserHomeDirectory(homeRoot);
  let identity;
  if (!allowHomeProject && (isUserHomeDirectory(directory) || inheritsHomeRepository)) {
    identity = undefined;
  } else {
    try {
      identity = resolveProjectIdentityOrFallback(isUserHomeDirectory(directory) ? canonicalUserHomeDirectory() : directory, allowHomeProject);
    } catch (error) {
      if (!(error instanceof ProjectIdentityError))
        throw error;
      const reason = error.errorClass === "git_identity_unavailable" ? pausedIdentityReasons.get(resolvedDirectory) ?? error.errorClass : error.errorClass;
      pausedIdentityReasons.set(resolvedDirectory, reason);
      const logKey = `${resolvedDirectory}\x00${reason}`;
      if (!pausedIdentityLogged.has(logKey)) {
        pausedIdentityLogged.add(logKey);
        log2(`[magic-context] memory features paused for ${resolvedDirectory}: ${reason}`);
      }
      identity = undefined;
    }
  }
  if (identity !== undefined)
    pausedIdentityReasons.delete(resolvedDirectory);
  sessionIdentityCache.set(cacheKey, {
    identity,
    revalidateAt: identity?.startsWith("git:") === true ? null : nowMs() + TRANSIENT_FAILURE_COOLDOWN_MS
  });
  return identity;
}
function normalizeStoredProjectPath(rawOrStored) {
  if (rawOrStored.startsWith("git:") || rawOrStored.startsWith("dir:")) {
    return rawOrStored;
  }
  try {
    return resolveProjectIdentity(rawOrStored);
  } catch {
    return rawOrStored;
  }
}
function storedPathBelongsToIdentity(storedProjectPath, projectIdentity) {
  return storedProjectPath === projectIdentity || normalizeStoredProjectPath(storedProjectPath) === projectIdentity;
}

// ../plugin/src/plugin/boot-quiet.ts
var BOOT_QUIET_MS = 120000;
var bootQuietUntilMs = 0;
function beginBootQuietPeriod(now = Date.now()) {
  if (bootQuietUntilMs === 0)
    bootQuietUntilMs = now + BOOT_QUIET_MS;
}
function bootQuietRemainingMs(now = Date.now()) {
  return Math.max(0, bootQuietUntilMs - now);
}
function scheduleAfterBootQuiet(task, additionalDelayMs = 0) {
  const timer = setTimeout(task, bootQuietRemainingMs() + Math.max(0, additionalDelayMs));
  timer.unref?.();
  return timer;
}
function setBootQuietPeriodForTests(startAtMs) {
  bootQuietUntilMs = startAtMs === null ? 0 : startAtMs + BOOT_QUIET_MS;
}

export { setHomeProjectPermission, ProjectIdentityError, resolveProjectIdentityStrict, isUserHomeDirectory, resolveProjectIdentity, directoryHasGitMetadata, isUsableProjectIdentity, resolveProjectIdentityForSession, normalizeStoredProjectPath, storedPathBelongsToIdentity, beginBootQuietPeriod, bootQuietRemainingMs, scheduleAfterBootQuiet, setBootQuietPeriodForTests };
