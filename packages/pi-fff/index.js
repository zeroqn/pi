// vendor/fff/packages/pi-fff/src/index.ts
import nodePath from "node:path";
import {
  sliceByColumn,
  Text,
  visibleWidth
} from "@earendil-works/pi-tui";
import { Type } from "@sinclair/typebox";

// vendor/fff/packages/pi-fff/src/aux-finders.ts
import fs2 from "node:fs";
import path2 from "node:path";

// vendor/fff/packages/pi-fff/src/paths.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var HOME_DIR = path.resolve(os.homedir());
var NVIM_FRECENCY_DIR = "fff_nvim";
var NVIM_HISTORY_DIR = "fff_queries";
function isHomeDir(dir) {
  return path.resolve(dir) === HOME_DIR;
}
function isFsRoot(dir) {
  const resolved = path.resolve(dir);
  return path.dirname(resolved) === resolved;
}
function resolveDbPaths(overrides) {
  return {
    frecency: overrides.frecency ?? existingDir(nvimCacheDir(), NVIM_FRECENCY_DIR) ?? path.join(piDataDir(), "fff", "frecency"),
    history: overrides.history ?? existingDir(nvimDataDir(), NVIM_HISTORY_DIR) ?? path.join(piDataDir(), "fff", "history")
  };
}
function nvimCacheDir() {
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg)
    return path.join(xdg, "nvim");
  if (process.platform === "win32" && process.env.LOCALAPPDATA)
    return path.join(process.env.LOCALAPPDATA, "nvim-data", "cache");
  return path.join(HOME_DIR, ".cache", "nvim");
}
function nvimDataDir() {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg)
    return path.join(xdg, "nvim");
  if (process.platform === "win32" && process.env.LOCALAPPDATA)
    return path.join(process.env.LOCALAPPDATA, "nvim-data");
  return path.join(HOME_DIR, ".local", "share", "nvim");
}
function piDataDir() {
  return process.env.PI_CODING_AGENT_DIR ?? path.join(HOME_DIR, ".pi", "agent");
}
function existingDir(parent, name) {
  const candidate = path.join(parent, name);
  try {
    return fs.statSync(candidate).isDirectory() ? candidate : undefined;
  } catch {
    return;
  }
}

// vendor/fff/packages/pi-fff/src/aux-finders.ts
var MAX_AUX = 3;
var IDLE_TTL_MS = 5 * 60 * 1000;

class AuxFinderPool {
  opts;
  entries = [];
  pending = new Map;
  constructor(opts) {
    this.opts = opts;
  }
  destroy() {
    for (const e of this.entries) {
      e.finder.destroy();
    }
    this.entries = [];
    this.pending.clear();
  }
  sweepIdle(now = Date.now()) {
    const kept = [];
    for (const e of this.entries) {
      if (now - e.lastUsed > IDLE_TTL_MS) {
        if (!e.finder.isDestroyed)
          e.finder.destroy();
      } else {
        kept.push(e);
      }
    }
    this.entries = kept;
  }
  async acquire(maybeRoot, opts) {
    this.sweepIdle();
    let covering = null;
    for (const e of this.entries) {
      if (e.finder.isDestroyed)
        continue;
      if (opts?.exact ? e.root !== maybeRoot : !rootCovers(e.root, maybeRoot))
        continue;
      if (!covering || e.root.length > covering.root.length)
        covering = e;
    }
    if (covering) {
      covering.lastUsed = Date.now();
      return { finder: covering.finder, root: covering.root };
    }
    const inflight = this.pending.get(maybeRoot);
    if (inflight) {
      const e = await inflight;
      e.lastUsed = Date.now();
      return { finder: e.finder, root: e.root };
    }
    const creation = this.create(maybeRoot).finally(() => {
      this.pending.delete(maybeRoot);
    });
    this.pending.set(maybeRoot, creation);
    const entry = await creation;
    return { finder: entry.finder, root: entry.root };
  }
  async create(root) {
    if (this.entries.length >= MAX_AUX) {
      let oldest = this.entries[0];
      for (const e of this.entries)
        if (e.lastUsed < oldest.lastUsed)
          oldest = e;
      if (!oldest.finder.isDestroyed)
        oldest.finder.destroy();
      this.entries = this.entries.filter((e) => e !== oldest);
    }
    const enableHomeDirScanning = this.opts.enableHomeDirScanning ?? true;
    if (enableHomeDirScanning && rootCovers(root, HOME_DIR)) {
      this.opts.onHomeDirScan?.(root);
    }
    const finder = await this.opts.pickers.create({
      basePath: root,
      enableHomeDirScanning,
      enableFsRootScanning: this.opts.enableFsRootScanning,
      followSymlinks: this.opts.followSymlinks
    });
    const entry = { root, finder, lastUsed: Date.now() };
    this.entries.push(entry);
    return entry;
  }
  size() {
    this.sweepIdle();
    return this.entries.length;
  }
}
function resolveAuxRoot(absPath) {
  const trimmed = path2.normalize(absPath.trim()).replace(/\/+$/, "") || "/";
  if (!path2.isAbsolute(trimmed))
    return null;
  if (trimmed === path2.sep)
    return { root: path2.sep, suffix: "" };
  const parts = trimmed.split(path2.sep);
  const firstGlob = parts.findIndex((p) => /[*?[{]/.test(p));
  const boundary = firstGlob === -1 ? parts.length : firstGlob;
  for (let i = boundary;i > 0; i--) {
    const candidate = parts.slice(0, i).join(path2.sep) || path2.sep;
    let stat;
    try {
      stat = fs2.statSync(candidate);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      return {
        root: parts.slice(0, i - 1).join(path2.sep) || path2.sep,
        suffix: parts.slice(i - 1).join("/")
      };
    }
    return { root: candidate, suffix: parts.slice(i).join("/") };
  }
  return null;
}
function isOutsideWorkspaceRelativePath(relativePath) {
  return path2.isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${path2.sep}`);
}
function routePathConstraint(pathConstraint, cwd) {
  if (!pathConstraint)
    return null;
  let candidate = pathConstraint.trim();
  if (!candidate)
    return null;
  if (candidate === "~" || candidate.startsWith("~/"))
    candidate = path2.join(HOME_DIR, candidate.slice(1));
  if (!path2.isAbsolute(candidate)) {
    if (candidate !== ".." && !candidate.startsWith("../"))
      return null;
    candidate = path2.resolve(cwd, candidate);
  }
  const rel = path2.relative(cwd, candidate);
  if (!isOutsideWorkspaceRelativePath(rel))
    return null;
  return resolveAuxRoot(candidate);
}
function rootCovers(root, target) {
  if (root === target)
    return true;
  const prefix = root.endsWith(path2.sep) ? root : root + path2.sep;
  return target.startsWith(prefix);
}

// vendor/fff/packages/pi-fff/src/config.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
var CONFIG_FILE_NAME = "pi-fff.json";
var VALID_MODES = ["tools-and-ui", "tools-only", "override", "engine-only"];
var CONFIG_KEYS = new Set([
  "$schema",
  "mode",
  "frecencyDbPath",
  "historyDbPath",
  "enableFsRootScanning",
  "enableHomeDirScanning",
  "warnOnHomeDirScan",
  "followSymlinks"
]);
function loadConfig(agentDir = piDataDir()) {
  const configPath = join(agentDir, CONFIG_FILE_NAME);
  let contents;
  try {
    contents = readFileSync(configPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT")
      return {};
    throw new Error(`Could not read pi-fff config at ${configPath}: ${errorMessage(error)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw invalidConfig(configPath, `not valid JSON (${errorMessage(error)})`);
  }
  if (!isRecord(parsed)) {
    throw invalidConfig(configPath, "expected a JSON object");
  }
  for (const key of Object.keys(parsed)) {
    if (!CONFIG_KEYS.has(key)) {
      throw invalidConfig(configPath, `unknown option "${key}"`);
    }
  }
  if (parsed.mode !== undefined && !VALID_MODES.includes(parsed.mode)) {
    throw invalidConfig(configPath, `"mode" must be one of ${VALID_MODES.join(", ")}`);
  }
  validateString(configPath, parsed, "$schema");
  validateString(configPath, parsed, "frecencyDbPath");
  validateString(configPath, parsed, "historyDbPath");
  validateBoolean(configPath, parsed, "enableFsRootScanning");
  validateBoolean(configPath, parsed, "enableHomeDirScanning");
  validateBoolean(configPath, parsed, "warnOnHomeDirScan");
  validateBoolean(configPath, parsed, "followSymlinks");
  return parsed;
}
function invalidConfig(configPath, reason) {
  return new Error(`Invalid pi-fff config at ${configPath}: ${reason}`);
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateString(configPath, config, key) {
  const value = config[key];
  if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
    throw invalidConfig(configPath, `"${key}" must be a non-empty string`);
  }
}
function validateBoolean(configPath, config, key) {
  const value = config[key];
  if (value !== undefined && typeof value !== "boolean") {
    throw invalidConfig(configPath, `"${key}" must be a boolean`);
  }
}

// vendor/fff/packages/pi-fff/src/sdk.ts
var SCAN_TIMEOUT_MS = 15000;
var sdkPromise = null;
var SDK_ORDER = {
  bun: ["@ff-labs/fff-bun", "@ff-labs/fff-node"],
  node: ["@ff-labs/fff-node", "@ff-labs/fff-bun"]
};
var SDK_IMPORTS = {
  "@ff-labs/fff-bun": () => import("@ff-labs/fff-bun"),
  "@ff-labs/fff-node": () => import("@ff-labs/fff-node")
};
function detectRuntime() {
  if (typeof globalThis.Bun !== "undefined")
    return "bun";
  if (typeof process !== "undefined" && process.versions?.bun)
    return "bun";
  return "node";
}
function sdkCandidates() {
  return SDK_ORDER[detectRuntime()];
}
async function loadFirst(candidates, loaders = SDK_IMPORTS) {
  let lastError;
  for (const pkg of candidates) {
    try {
      return await loaders[pkg]();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
function loadSdk() {
  if (sdkPromise)
    return sdkPromise;
  const g = globalThis;
  if (g.__fffSdkPromiseGlobal) {
    sdkPromise = g.__fffSdkPromiseGlobal;
    return sdkPromise;
  }
  const p = loadFirst(sdkCandidates());
  sdkPromise = p;
  globalThis.__fffSdkPromiseGlobal = p;
  return p;
}

// vendor/fff/packages/pi-fff/src/file-picker.ts
class FilePickerFactory {
  dbDisabled = false;
  frecencyDbPath;
  historyDbPath;
  onDbFailure;
  constructor(opts) {
    this.frecencyDbPath = opts.frecencyDbPath;
    this.historyDbPath = opts.historyDbPath;
    this.onDbFailure = opts.onDbFailure;
  }
  get databasesDisabled() {
    return this.dbDisabled;
  }
  async create(options) {
    const { FileFinder } = await loadSdk();
    const result = this.openWithDbFallback(FileFinder, options);
    if (!result.ok) {
      throw new Error(`Failed to create FFF file picker for ${options.basePath}: ${result.error}`);
    }
    await result.value.waitForScan(SCAN_TIMEOUT_MS);
    return result.value;
  }
  openWithDbFallback(FileFinder, options) {
    const init = { ...options, aiMode: true };
    if (this.dbDisabled)
      return FileFinder.create(init);
    const result = FileFinder.create({
      ...init,
      frecencyDbPath: this.frecencyDbPath,
      historyDbPath: this.historyDbPath
    });
    if (result.ok)
      return result;
    const dbLess = FileFinder.create(init);
    if (!dbLess.ok)
      return result;
    this.dbDisabled = true;
    this.onDbFailure?.(result.error);
    return dbLess;
  }
}

// vendor/fff/packages/pi-fff/src/query.ts
import path3 from "node:path";
function normalizePathConstraint(pathConstraint, cwd = process.cwd()) {
  let trimmed = pathConstraint.trim();
  if (!trimmed)
    return trimmed;
  if (path3.isAbsolute(trimmed)) {
    const relative = path3.relative(cwd, trimmed).replaceAll(path3.sep, "/");
    if (relative === "")
      return null;
    if (relative.startsWith("../") || relative === ".." || path3.isAbsolute(relative)) {
      throw new Error(`Path constraint must be relative to the workspace: ${pathConstraint}`);
    }
    trimmed = relative;
  }
  if (trimmed === "." || trimmed === "./")
    return null;
  if (trimmed.startsWith("./"))
    trimmed = trimmed.slice(2);
  if (trimmed === "**" || trimmed === "**/" || trimmed === "**/*")
    return null;
  const recursiveDir = trimmed.match(/^(.*)\/\*\*(?:\/\*)?$/);
  if (recursiveDir) {
    const dir = recursiveDir[1];
    if (dir && !/[*?[{]/.test(dir))
      return `${dir}/`;
  }
  if (trimmed.startsWith("/") || trimmed.endsWith("/"))
    return trimmed;
  if (/[*?[{]/.test(trimmed))
    return trimmed;
  const lastSegment = trimmed.split("/").pop() ?? "";
  if (/\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(lastSegment))
    return trimmed;
  return `${trimmed}/`;
}
function normalizeExcludes(exclude, cwd = process.cwd()) {
  if (!exclude)
    return [];
  const list = Array.isArray(exclude) ? exclude : [exclude];
  const out = [];
  for (const raw of list) {
    const parts = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      const stripped = p.startsWith("!") ? p.slice(1) : p;
      const normalized = normalizePathConstraint(stripped, cwd);
      if (normalized)
        out.push(`!${normalized}`);
    }
  }
  return out;
}
function buildQuery(path, pattern, exclude, cwd = process.cwd()) {
  const parts = [];
  if (path) {
    const pathConstraint = normalizePathConstraint(path, cwd);
    if (pathConstraint)
      parts.push(pathConstraint);
  }
  parts.push(...normalizeExcludes(exclude, cwd));
  parts.push(pattern);
  return parts.join(" ");
}

// vendor/fff/packages/pi-fff/src/index.ts
var FINDER_SLOT = Symbol.for("pi-fff:finder");
var FINDER_API_VERSION = 1;
var DEFAULT_GREP_LIMIT = 20;
var DEFAULT_FIND_LIMIT = 30;
var GREP_PAGE_SIZE_MAX = 50;
var GREP_MAX_MATCHES_PER_FILE = 200;
var GREP_CONTEXT_MAX = 20;
var GREP_MAX_LINE_LENGTH = 500;
var MENTION_MAX_RESULTS = 20;
var GREP_TIME_BUDGET_MS = 1e4;
var HOME_SCAN_STATUS_KEY = "fff";
var HOME_SCAN_POLL_MS = 1000;
var HOME_SCAN_DISABLE_HINT = 'You can prevent home dir indexing with --fff-enable-home-scan=false, FFF_ENABLE_HOME_SCAN=0, or "enableHomeDirScanning": false in pi-fff.json. ' + 'To keep indexing but silence this warning use --fff-warn-home-scan=false, FFF_WARN_HOME_SCAN=0, or "warnOnHomeDirScan": false in pi-fff.json.';
var FFF_TOOL_NAMES = {
  grep: "ffgrep",
  find: "fffind",
  multiGrep: "fff-multi-grep"
};
var OVERRIDE_TOOL_NAMES = {
  grep: "grep",
  find: "find",
  multiGrep: "multi_grep"
};
function resolveToolNames(mode) {
  return mode === "override" ? OVERRIDE_TOOL_NAMES : FFF_TOOL_NAMES;
}
function toolNameList(names) {
  return [names.grep, names.find, names.multiGrep];
}
var cursorCache = new Map;
var cursorCounter = 0;
function storeCursor(cursor) {
  const id = `fff_c${++cursorCounter}`;
  cursorCache.set(id, cursor);
  if (cursorCache.size > 200) {
    const first = cursorCache.keys().next().value;
    if (first)
      cursorCache.delete(first);
  }
  return id;
}
function getCursor(id) {
  return cursorCache.get(id);
}
var findCursorCache = new Map;
var findCursorCounter = 0;
function storeFindCursor(cursor) {
  const id = `${++findCursorCounter}`;
  findCursorCache.set(id, cursor);
  if (findCursorCache.size > 200) {
    const first = findCursorCache.keys().next().value;
    if (first)
      findCursorCache.delete(first);
  }
  return id;
}
function getFindCursor(id) {
  return findCursorCache.get(id);
}
function truncateLine(line, max = GREP_MAX_LINE_LENGTH) {
  const trimmed = line.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}
function clampContext(context) {
  if (!context || context < 0)
    return 0;
  return Math.min(Math.floor(context), GREP_CONTEXT_MAX);
}
var HOT_FRECENCY = 25;
var WARM_FRECENCY = 20;
function fffFileAnnotation(item) {
  const git = item.gitStatus;
  if (git && git !== "clean" && git !== "unknown" && git !== "") {
    return `  [${git} in git]`;
  }
  const frecency = item.totalFrecencyScore ?? item.accessFrecencyScore ?? 0;
  if (frecency >= HOT_FRECENCY)
    return "  [VERY often touched file]";
  if (frecency >= WARM_FRECENCY)
    return "  [often touched file]";
  return "";
}
function formatGrepOutput(result) {
  if (result.items.length === 0)
    return "No matches found";
  const lines = [];
  let currentFile = "";
  for (const match of result.items) {
    if (match.relativePath !== currentFile) {
      if (lines.length > 0)
        lines.push("");
      currentFile = match.relativePath;
      lines.push(`${currentFile}${fffFileAnnotation(match)}`);
    }
    match.contextBefore?.forEach((line, i) => {
      const lineNum = match.lineNumber - match.contextBefore.length + i;
      lines.push(` ${lineNum}- ${truncateLine(line)}`);
    });
    lines.push(` ${match.lineNumber}: ${truncateLine(match.lineContent)}`);
    match.contextAfter?.forEach((line, i) => {
      const lineNum = match.lineNumber + 1 + i;
      lines.push(` ${lineNum}- ${truncateLine(line)}`);
    });
  }
  return lines.join(`
`);
}
var FIND_WEAK_SAMPLE_SIZE = 5;
function weakScoreThreshold(pattern) {
  const perfect = pattern.length * 12;
  return Math.floor(perfect * 50 / 100);
}
function formatFindOutput(result, limit, pattern) {
  if (result.items.length === 0) {
    return {
      output: "No files found matching pattern",
      weak: false,
      shownCount: 0
    };
  }
  const reordered = result.items.map((item) => ({ item }));
  const topScore = result.scores[0]?.total ?? 0;
  const weak = topScore < weakScoreThreshold(pattern);
  const effective = weak ? Math.min(FIND_WEAK_SAMPLE_SIZE, limit) : limit;
  const shown = reordered.slice(0, effective);
  return {
    output: shown.map((p) => `${p.item.relativePath}${fffFileAnnotation(p.item)}`).join(`
`),
    weak,
    shownCount: shown.length
  };
}
function extractAtPrefix(textBeforeCursor) {
  const match = textBeforeCursor.match(/(?:^|[ \t])(@(?:"[^"]*|[^\s]*))$/);
  return match?.[1] ?? null;
}
function buildAtCompletionValue(path) {
  return path.includes(" ") ? `@"${path}"` : `@${path}`;
}
function createFffMentionProvider(getItems) {
  return {
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const currentLine = lines[cursorLine] || "";
      const prefix = extractAtPrefix(currentLine.slice(0, cursorCol));
      if (!prefix || options.signal.aborted)
        return null;
      const query = prefix.startsWith('@"') ? prefix.slice(2) : prefix.slice(1);
      const items = await getItems(query, options.signal);
      return options.signal.aborted || items.length === 0 ? null : { items, prefix };
    },
    applyCompletion(_lines, cursorLine, cursorCol, item, prefix) {
      const currentLine = _lines[cursorLine] || "";
      const before = currentLine.slice(0, cursorCol - prefix.length);
      const after = currentLine.slice(cursorCol);
      const newLine = before + item.value + after;
      const newCursorCol = cursorCol - prefix.length + item.value.length;
      return {
        lines: [..._lines.slice(0, cursorLine), newLine, ..._lines.slice(cursorLine + 1)],
        cursorLine,
        cursorCol: newCursorCol
      };
    }
  };
}
function fffExtension(pi) {
  let mainFinder = null;
  let finderCwd = null;
  let finderPromise = null;
  let activeCwd = process.cwd();
  const config = loadConfig();
  function getConfigValue(flagName, envName, fileValue, fallback, parse = (value) => value) {
    const flagValue = pi.getFlag(flagName);
    if (flagValue !== undefined) {
      const value = parse(flagValue);
      if (value !== undefined)
        return value;
    }
    const envValue = process.env[envName];
    if (envValue !== undefined) {
      const value = parse(envValue);
      if (value !== undefined)
        return value;
    }
    return fileValue ?? fallback;
  }
  function parseBoolean(value) {
    if (typeof value === "boolean")
      return value;
    if (value === "1" || value === "true")
      return true;
    if (value === "0" || value === "false")
      return false;
    return;
  }
  function parseMode(value) {
    return typeof value === "string" && VALID_MODES.includes(value) ? value : undefined;
  }
  function loadTimeMode() {
    const flag = parseMode(pi.getFlag("fff-mode"));
    if (flag !== undefined)
      return flag;
    return parseMode(process.env.PI_FFF_MODE) ?? config.mode ?? "tools-and-ui";
  }
  let currentMode = "tools-and-ui";
  let registerTools = loadTimeMode() !== "engine-only";
  let toolNames = resolveToolNames(currentMode);
  let resolvedDbPaths;
  let enableFsRootScanning = false;
  let enableHomeDirScanning = true;
  let warnOnHomeDirScan = true;
  let followSymlinks = true;
  function setMode(mode) {
    currentMode = mode;
    toolNames = resolveToolNames(mode);
  }
  function resolveStartupConfig() {
    setMode(getConfigValue("fff-mode", "PI_FFF_MODE", config.mode, "tools-and-ui", parseMode));
    resolvedDbPaths = resolveDbPaths({
      frecency: getConfigValue("fff-frecency-db", "FFF_FRECENCY_DB", config.frecencyDbPath, undefined),
      history: getConfigValue("fff-history-db", "FFF_HISTORY_DB", config.historyDbPath, undefined)
    });
    enableFsRootScanning = getConfigValue("fff-enable-root-scan", "FFF_ENABLE_ROOT_SCAN", config.enableFsRootScanning, false, parseBoolean);
    enableHomeDirScanning = getConfigValue("fff-enable-home-scan", "FFF_ENABLE_HOME_SCAN", config.enableHomeDirScanning, true, parseBoolean);
    warnOnHomeDirScan = getConfigValue("fff-warn-home-scan", "FFF_WARN_HOME_SCAN", config.warnOnHomeDirScan, true, parseBoolean);
    followSymlinks = getConfigValue("fff-follow-symlinks", "FFF_FOLLOW_SYMLINKS", config.followSymlinks, true, parseBoolean);
  }
  function getMode() {
    return currentMode;
  }
  function shouldEnableMentions() {
    return currentMode !== "tools-only";
  }
  let uiCtx = null;
  let homeScanTimer = null;
  function warnHomeDirScan(root) {
    if (!warnOnHomeDirScan)
      return;
    uiCtx?.ui.notify(`(fff): Your cwd (${root}) is too large. Indexing will take additional time and resources.
${HOME_SCAN_DISABLE_HINT}`, "warning");
  }
  let pickers = null;
  let auxPool = null;
  function initializeFinderFactories() {
    if (pickers)
      return;
    pickers = new FilePickerFactory({
      frecencyDbPath: resolvedDbPaths.frecency,
      historyDbPath: resolvedDbPaths.history,
      onDbFailure: (error) => uiCtx?.ui.notify(`(fff): Failed to open frecency/history database (${error}). Continuing without frecency persistence.`, "error")
    });
    auxPool = new AuxFinderPool({
      enableFsRootScanning,
      enableHomeDirScanning,
      followSymlinks,
      onHomeDirScan: warnHomeDirScan,
      pickers
    });
  }
  function publishFinderSlot() {
    const api = {
      apiVersion: FINDER_API_VERSION,
      activeCwd: () => activeCwd,
      route: routeForEngine
    };
    globalThis[FINDER_SLOT] = api;
  }
  function scanOptOutReason(cwd) {
    if (!enableHomeDirScanning && isHomeDir(cwd))
      return `(fff): cwd is $HOME and "enableHomeDirScanning" is false, so FFF search is disabled for this session. Start pi from a project directory, or set "enableHomeDirScanning": true / --fff-enable-home-scan=true to index $HOME.`;
    if (!enableFsRootScanning && isFsRoot(cwd))
      return `(fff): cwd is the filesystem root and "enableFsRootScanning" is false, so FFF search is disabled for this session. Start pi from a project directory, or set "enableFsRootScanning": true / --fff-enable-root-scan=true to index it.`;
    return null;
  }
  function ensureFinder(cwd) {
    const optOut = scanOptOutReason(cwd);
    if (optOut)
      return Promise.reject(new Error(optOut));
    if (mainFinder && !mainFinder.isDestroyed && finderCwd === cwd)
      return Promise.resolve(mainFinder);
    if (finderPromise)
      return finderPromise;
    finderPromise = (async () => {
      if (mainFinder && !mainFinder.isDestroyed) {
        mainFinder.destroy();
        mainFinder = null;
        finderCwd = null;
      }
      if (!pickers)
        throw new Error("FFF picker factory is not initialized");
      mainFinder = await pickers.create({
        basePath: cwd,
        enableHomeDirScanning,
        enableFsRootScanning,
        followSymlinks
      });
      finderCwd = cwd;
      return mainFinder;
    })().finally(() => {
      finderPromise = null;
    });
    return finderPromise;
  }
  function stopHomeScanStatus() {
    if (homeScanTimer) {
      clearInterval(homeScanTimer);
      homeScanTimer = null;
    }
    uiCtx?.ui.setStatus?.(HOME_SCAN_STATUS_KEY, undefined);
  }
  function trackHomeScanStatus() {
    stopHomeScanStatus();
    if (!uiCtx?.ui.setStatus)
      return;
    const tick = () => {
      const progress = mainFinder?.getScanProgress?.();
      if (!progress?.ok || !progress.value.isScanning) {
        stopHomeScanStatus();
        return;
      }
      uiCtx?.ui.setStatus?.(HOME_SCAN_STATUS_KEY, `Agent is indexing $HOME (${progress.value.scannedFilesCount} files), this can lead to high CPU`);
    };
    homeScanTimer = setInterval(tick, HOME_SCAN_POLL_MS);
    homeScanTimer.unref?.();
    tick();
  }
  function destroyFinder() {
    stopHomeScanStatus();
    if (mainFinder && !mainFinder.isDestroyed) {
      mainFinder.destroy();
      mainFinder = null;
      finderCwd = null;
    }
    auxPool?.destroy();
    auxPool = null;
    pickers = null;
  }
  async function resolveFinderForPath(pathParam, pattern, exclude) {
    const route = routePathConstraint(pathParam, activeCwd);
    if (!route)
      return null;
    if (!auxPool)
      throw new Error("FFF auxiliary finder pool is not initialized");
    const aux = await auxPool.acquire(route.root);
    const rebase = nodePath.relative(aux.root, route.root).replaceAll(nodePath.sep, "/");
    const suffix = [rebase, route.suffix].filter(Boolean).join("/");
    const query = buildQuery(suffix || undefined, pattern, exclude, aux.root);
    return { finder: aux.finder, query, root: aux.root };
  }
  async function routeForEngine(input) {
    if (!auxPool)
      throw new Error("FFF auxiliary finder pool is not initialized");
    const reroute = input.path ? routePathConstraint(input.path, input.cwd) : null;
    const target = reroute ? reroute.root : input.cwd;
    const covering = !reroute && input.cwd === activeCwd ? { finder: await ensureFinder(input.cwd), root: input.cwd } : await auxPool.acquire(target);
    const rebase = nodePath.relative(covering.root, target).replaceAll(nodePath.sep, "/");
    const relative = [rebase, reroute ? reroute.suffix : input.path ?? ""].filter(Boolean).join("/");
    return {
      finder: covering.finder,
      query: buildQuery(relative || undefined, input.pattern, input.exclude, covering.root),
      root: covering.root
    };
  }
  async function getMentionItems(query, signal) {
    if (signal.aborted)
      return [];
    const f = await ensureFinder(activeCwd);
    if (signal.aborted)
      return [];
    const result = f.mixedSearch(query, { pageSize: MENTION_MAX_RESULTS });
    if (!result.ok)
      return [];
    return result.value.items.slice(0, MENTION_MAX_RESULTS).map((mixed) => {
      if (mixed.type === "directory") {
        return {
          value: buildAtCompletionValue(mixed.item.relativePath),
          label: mixed.item.dirName,
          description: mixed.item.relativePath
        };
      }
      return {
        value: buildAtCompletionValue(mixed.item.relativePath),
        label: mixed.item.fileName,
        description: mixed.item.relativePath
      };
    });
  }
  function registerAutocompleteProvider(ctx) {
    if (typeof ctx.ui.addAutocompleteProvider !== "function")
      return;
    ctx.ui.addAutocompleteProvider((current) => {
      const mentionProvider = createFffMentionProvider(getMentionItems);
      return {
        async getSuggestions(lines, cursorLine, cursorCol, options) {
          if (shouldEnableMentions()) {
            try {
              const mentionResult = await mentionProvider.getSuggestions(lines, cursorLine, cursorCol, options);
              if (mentionResult)
                return mentionResult;
            } catch {}
          }
          return current.getSuggestions(lines, cursorLine, cursorCol, options);
        },
        applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
          return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
        },
        shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
          return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
        }
      };
    });
  }
  const pendingTools = [];
  const registeredToolNames = new Set;
  const renderToolNames = new WeakMap;
  let toolsRegistered = false;
  function getRenderToolName(context, fallback) {
    return renderToolNames.get(context) ?? fallback;
  }
  function registerTool(resolveName, definition) {
    const resolvedName = resolveName();
    if (registeredToolNames.has(resolvedName))
      return resolvedName;
    const { promptGuidelines, renderCall, ...tool } = definition;
    pi.registerTool({
      ...tool,
      name: resolvedName,
      label: resolvedName,
      promptGuidelines: promptGuidelines?.(toolNames),
      renderCall: renderCall ? (args, theme, context) => {
        renderToolNames.set(context, resolvedName);
        return renderCall(args, theme, context);
      } : undefined
    });
    registeredToolNames.add(resolvedName);
    return resolvedName;
  }
  function queueTool(resolveName, definition) {
    if (!registerTools)
      return;
    pendingTools.push(() => registerTool(resolveName, definition));
    registerTool(resolveName, definition);
  }
  function registerPendingTools(staleNames) {
    if (toolsRegistered)
      return;
    const registeredNames = currentMode === "engine-only" ? new Set : new Set(pendingTools.map((register) => register()));
    const stale = new Set(staleNames.filter((name) => !registeredNames.has(name)));
    pi.setActiveTools([
      ...new Set([
        ...pi.getActiveTools().filter((name) => !stale.has(name)),
        ...registeredNames
      ])
    ]);
    toolsRegistered = true;
  }
  pi.registerFlag("fff-mode", {
    description: "FFF mode: tools-and-ui | tools-only | override | engine-only",
    type: "string"
  });
  pi.registerFlag("fff-frecency-db", {
    description: "Path to the frecency database (overrides FFF_FRECENCY_DB env)",
    type: "string"
  });
  pi.registerFlag("fff-history-db", {
    description: "Path to the query history database (overrides FFF_HISTORY_DB env)",
    type: "string"
  });
  pi.registerFlag("fff-enable-root-scan", {
    description: "Allow indexing when launched from the filesystem root (also: FFF_ENABLE_ROOT_SCAN env)",
    type: "boolean"
  });
  pi.registerFlag("fff-enable-home-scan", {
    description: "Index the home dir when launched from $HOME (default true; disable with --fff-enable-home-scan=false or FFF_ENABLE_HOME_SCAN=0)",
    type: "boolean"
  });
  pi.registerFlag("fff-follow-symlinks", {
    description: "Index through directory symlinks, e.g. a git worktree or stow layout (default true; disable with --fff-follow-symlinks=false or FFF_FOLLOW_SYMLINKS=0)",
    type: "boolean"
  });
  pi.registerFlag("fff-warn-home-scan", {
    description: "Warn when indexing $HOME (default true; silence with --fff-warn-home-scan=false or FFF_WARN_HOME_SCAN=0)",
    type: "boolean"
  });
  function reportInitFailure(ctx, error) {
    ctx.ui.notify(`FFF init failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
  function prepareSession(ctx) {
    activeCwd = ctx.cwd;
    uiCtx = ctx;
    if (toolsRegistered)
      return;
    resolveStartupConfig();
    const staleNames = toolNameList(FFF_TOOL_NAMES);
    let usedOverride = currentMode === "override";
    const modes = sessionModes(ctx.sessionManager?.getEntries());
    if (modes.length > 0) {
      const restored = modes[modes.length - 1];
      if (restored !== currentMode)
        setMode(restored);
      usedOverride = usedOverride || modes.includes("override");
    }
    initializeFinderFactories();
    publishFinderSlot();
    const keepBuiltins = currentMode === "override" && scanOptOutReason(activeCwd) !== null;
    if (keepBuiltins)
      toolNames = FFF_TOOL_NAMES;
    if (usedOverride && !keepBuiltins)
      staleNames.push(...toolNameList(OVERRIDE_TOOL_NAMES));
    registerPendingTools(staleNames);
  }
  pi.on("session_start", async (_event, ctx) => {
    try {
      prepareSession(ctx);
      registerAutocompleteProvider(ctx);
      const optOut = scanOptOutReason(activeCwd);
      if (optOut) {
        ctx.ui.notify(optOut, "warning");
        return;
      }
      await ensureFinder(activeCwd);
      const atHome = enableHomeDirScanning && isHomeDir(activeCwd);
      if (atHome) {
        warnHomeDirScan(activeCwd);
        ctx.ui.setStatus?.(HOME_SCAN_STATUS_KEY, "Agent is indexing $HOME, this can lead to high CPU");
      }
      if (atHome)
        trackHomeScanStatus();
    } catch (error) {
      reportInitFailure(ctx, error);
    }
  });
  pi.on("before_agent_start", (_event, ctx) => {
    if (toolsRegistered)
      return;
    try {
      prepareSession(ctx);
    } catch (error) {
      reportInitFailure(ctx, error);
    }
  });
  pi.on("session_shutdown", async () => {
    destroyFinder();
  });

  class CollapsedText {
    preview;
    suffix;
    marker;
    constructor(preview, suffix, marker) {
      this.preview = preview;
      this.suffix = suffix;
      this.marker = marker;
    }
    render(width) {
      const availableWidth = Math.max(1, width);
      if (!this.suffix) {
        if (visibleWidth(this.preview) <= availableWidth)
          return [this.preview];
        const markerWidth = visibleWidth(this.marker);
        if (markerWidth >= availableWidth) {
          return [sliceByColumn(this.marker, 0, availableWidth, true)];
        }
        return [
          `${sliceByColumn(this.preview, 0, availableWidth - markerWidth, true)}${this.marker}`
        ];
      }
      const suffixWidth = visibleWidth(this.suffix);
      if (suffixWidth >= availableWidth) {
        return [sliceByColumn(this.suffix, 0, availableWidth, true)];
      }
      const previewWidth = availableWidth - suffixWidth - 1;
      if (visibleWidth(this.preview) <= previewWidth) {
        return [`${this.preview} ${this.suffix}`];
      }
      const markerWidth = visibleWidth(this.marker);
      return [
        `${sliceByColumn(this.preview, 0, Math.max(0, previewWidth - markerWidth), true)}${this.marker} ${this.suffix}`
      ];
    }
    invalidate() {}
  }
  const renderCompactTextResult = (result, options, theme, context) => {
    const output = result.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
    if (!output)
      return new Text(theme.fg("muted", "No output"), 0, 0);
    const lines = output.split(`
`);
    const color = context.isError ? "error" : "toolOutput";
    if (options.expanded) {
      return new Text(lines.map((line) => theme.fg(color, line)).join(`
`), 0, 0);
    }
    const suffix = lines.length > 1 ? theme.fg("muted", `... (${lines.length - 1} more lines)`) : "";
    return new CollapsedText(theme.fg(color, lines[0] ?? ""), suffix, theme.fg("muted", "..."));
  };
  const renderPreviewResult = (result, options, theme, context, maxLines = 15) => {
    const text = context.lastComponent ?? new Text("", 0, 0);
    const output = result.content?.find((c) => c.type === "text")?.text?.trim() ?? "";
    if (!output) {
      text.setText(theme.fg("muted", "No output"));
      return text;
    }
    const lines = output.split(`
`);
    const displayLines = lines.slice(0, options.expanded ? lines.length : maxLines);
    let content = `
${displayLines.map((line) => theme.fg("toolOutput", line)).join(`
`)}`;
    if (lines.length > displayLines.length) {
      content += theme.fg("muted", `
... (${lines.length - displayLines.length} more lines)`);
    }
    text.setText(content);
    return text;
  };
  const grepSchema = Type.Object({
    pattern: Type.String({
      description: "Search pattern (literal text or regex)"
    }),
    path: Type.Optional(Type.String({
      description: "Path constraint. Directory prefix (src/ or src/foo/), bare filename with extension (main.rs), or glob (*.ts, src/**/*.cc, {src,lib}/**). Applied to the full repo-relative path. Absolute, ~/, and ../ paths outside the workspace are also supported and searched with a separate index."
    })),
    exclude: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], {
      description: "Exclude paths (comma/space-separated or array). Same syntax as path: directory prefix ('test/'), filename with extension ('config.json'), or glob ('*.min.js', '**/*.{rs,go}'). A leading '!' is optional and ignored — both 'test/' and '!test/' work. Example: 'test/,*.min.js,!vendor/'."
    })),
    caseSensitive: Type.Optional(Type.Boolean({
      description: "Force case-sensitive matching. Default uses smart-case (case-insensitive when pattern is all lowercase)."
    })),
    context: Type.Optional(Type.Number({
      description: `Context lines before+after each match (0-${GREP_CONTEXT_MAX})`
    })),
    limit: Type.Optional(Type.Number({
      description: `Max matches (default ${DEFAULT_GREP_LIMIT})`
    })),
    cursor: Type.Optional(Type.String({ description: "Pagination cursor from previous result" }))
  });
  queueTool(() => toolNames.grep, {
    description: `Grep file contents. Smart-case, auto-detects regex vs literal, git-aware. Results are ranked by frecency (most-accessed files first); matches within a file stay in source order. Default limit ${DEFAULT_GREP_LIMIT}.`,
    promptSnippet: "Grep contents",
    promptGuidelines: (names) => [
      `${names.grep}: prefer bare identifiers as patterns. Literal queries are most efficient.`,
      `${names.grep}: use path for include ('src/', '*.ts') and exclude for noise ('test/,*.min.js').`,
      `${names.grep}: caseSensitive: true when you need exact case (smart-case otherwise).`,
      `${names.grep}: after 1-2 greps, read the top match instead of more greps.`
    ],
    parameters: grepSchema,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted)
        throw new Error("Operation aborted");
      const pattern = params.pattern;
      const aux = await resolveFinderForPath(params.path, pattern, params.exclude);
      const picker = aux ? aux.finder : await ensureFinder(activeCwd);
      const effectiveLimit = Math.max(1, params.limit ?? DEFAULT_GREP_LIMIT);
      const pageSize = Math.min(effectiveLimit, GREP_PAGE_SIZE_MAX);
      const context = clampContext(params.context);
      const query = aux ? aux.query : buildQuery(params.path, pattern, params.exclude, activeCwd);
      const hasRegexSyntax = pattern !== pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let mode = hasRegexSyntax ? "regex" : "plain";
      if (mode === "regex") {
        try {
          new RegExp(pattern);
        } catch {
          mode = "plain";
        }
      }
      const p = pattern.trim();
      const isWildcardOnly = hasRegexSyntax && /^(?:[.^$]*(?:[.][*+?]|\*|\+)[.^$]*|[.^$\s]*|\.\*\??|\.\*[+?]?|\.\+\??|\.|\*|\?)$/.test(p);
      if (isWildcardOnly) {
        return {
          content: [
            {
              type: "text",
              text: `Pattern '${params.pattern}' matches everything — grep needs a concrete substring or identifier. Example: \`pattern: 'MyClass'\` or \`pattern: 'export function'\`.`
            }
          ],
          details: { totalMatched: 0, totalFiles: 0 }
        };
      }
      const smartCase = params.caseSensitive !== true;
      const grepResult = picker.grep(query, {
        mode,
        smartCase,
        maxMatchesPerFile: GREP_MAX_MATCHES_PER_FILE,
        pageSize,
        cursor: (params.cursor ? getCursor(params.cursor) : null) ?? null,
        beforeContext: context,
        afterContext: context,
        classifyDefinitions: true,
        timeBudgetMs: GREP_TIME_BUDGET_MS
      });
      if (!grepResult.ok)
        throw new Error(grepResult.error);
      let result = grepResult.value;
      let fuzzyNotice = null;
      if (result.items.length === 0 && !result.nextCursor && !params.cursor && mode !== "regex") {
        const lastSeg = params.path?.split(/[\\/]/).pop() ?? "";
        const pathTargetsFile = /\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(lastSeg);
        const fuzzyQuery = pathTargetsFile ? pattern : query;
        const fuzzy = picker.grep(fuzzyQuery, {
          mode: "fuzzy",
          smartCase,
          maxMatchesPerFile: GREP_MAX_MATCHES_PER_FILE,
          pageSize,
          cursor: null,
          beforeContext: 0,
          afterContext: 0,
          classifyDefinitions: true,
          timeBudgetMs: GREP_TIME_BUDGET_MS
        });
        if (fuzzy.ok && fuzzy.value.items.length > 0) {
          fuzzyNotice = `0 exact matches. Maybe you meant this?`;
          result = fuzzy.value;
        }
      }
      let output = formatGrepOutput(result);
      const notices = [];
      if (result.regexFallbackError) {
        notices.push(`Invalid regex: ${result.regexFallbackError}, used literal match`);
      }
      if (result.nextCursor) {
        notices.push(`Continue with cursor="${storeCursor(result.nextCursor)}"`);
      }
      if (notices.length > 0)
        output += `

[${notices.join(". ")}]`;
      if (fuzzyNotice)
        output = `[${fuzzyNotice}]
${output}`;
      return {
        content: [{ type: "text", text: output }],
        details: {
          totalMatched: result.totalMatched,
          totalFiles: result.totalFiles
        }
      };
    },
    renderCall(args, theme, context) {
      const pattern = args?.pattern ?? "";
      const path = args?.path ?? ".";
      let content = theme.fg("toolTitle", theme.bold(getRenderToolName(context, toolNames.grep))) + " " + theme.fg("accent", `/${pattern}/`) + theme.fg("toolOutput", ` in ${path}`);
      const options = [];
      if (args?.limit !== undefined)
        options.push(`limit ${args.limit}`);
      if (args?.context !== undefined)
        options.push(`context ${args.context}`);
      if (options.length > 0)
        content += theme.fg("toolOutput", ` (${options.join(", ")})`);
      if (args?.cursor)
        content += theme.fg("muted", ` (page)`);
      return new CollapsedText(content, "", theme.fg("muted", "..."));
    },
    renderResult(result, options, theme, context) {
      return renderCompactTextResult(result, options, theme, context);
    }
  });
  const findSchema = Type.Object({
    pattern: Type.String({
      description: "Fuzzy filename search and glob search. Frecency-ranked, git-aware. Multi-word = narrower (AND) not bound to order, use for multi word related concept search. Prefer this over ls/find/bash as the first exploration step whenever the user names a concept, feature, or symbol — it surfaces the relevant files in one call. Only use ls/read on a directory when you specifically need the alphabetical layout of an unknown repo, or when a concept search returned nothing."
    }),
    path: Type.Optional(Type.String({
      description: "Path constraint. Directory prefix (src/ or src/foo/), bare filename with extension (main.rs), or glob (*.ts, src/**/*.cc, {src,lib}/**). Applied to the full repo-relative path. Absolute, ~/, and ../ paths outside the workspace are also supported and searched with a separate index."
    })),
    exclude: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], {
      description: "Exclude paths (comma/space-separated or array). Same syntax as path: directory prefix ('test/'), filename with extension ('config.json'), or glob ('*.min.js', '**/*.{rs,go}'). A leading '!' is optional and ignored — both 'test/' and '!test/' work. Example: 'test/,*.min.js,!vendor/'."
    })),
    limit: Type.Optional(Type.Number({
      description: `Max results per page (default ${DEFAULT_FIND_LIMIT})`
    })),
    cursor: Type.Optional(Type.String({ description: "Pagination cursor from previous result" }))
  });
  queueTool(() => toolNames.find, {
    description: `Fuzzy path search and glob search. Matches against the whole repo-relative path, not just the filename. Frecency-ranked, git-aware. Multi-word = narrower (AND). Default limit ${DEFAULT_FIND_LIMIT}.`,
    promptSnippet: "Find files by path or glob",
    promptGuidelines: (names) => [
      `${names.find}: matches the WHOLE path, not just the filename — \`profile\` hits \`chrome/browser/profiles/x.cc\` too.`,
      `${names.find}: keep queries to 1-2 terms; extra words narrow.`,
      `${names.find}: use for paths, not content. Use ${names.grep} for content.`,
      `${names.find}: for exact path matches use a glob in \`path\` — e.g. path: '**/profile.h' for exact filename, or path: 'src/**/profile.h' scoped to a subtree. Bare patterns are fuzzy.`,
      `${names.find}: to list everything inside a directory, pass path: 'dir/**' with an empty or wildcard pattern instead of using pattern alone.`,
      `${names.find}: use exclude: 'test/,*.min.js' to cut noise in large repos.`
    ],
    parameters: findSchema,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted)
        throw new Error("Operation aborted");
      const resumed = params.cursor ? getFindCursor(params.cursor) : undefined;
      const pool = auxPool;
      if (!pool)
        throw new Error("FFF auxiliary finder pool is not initialized");
      const aux = resumed ? resumed.auxRoot ? {
        finder: (await pool.acquire(resumed.auxRoot, { exact: true })).finder,
        root: resumed.auxRoot
      } : null : await resolveFinderForPath(params.path, params.pattern, params.exclude);
      const picker = aux ? aux.finder : await ensureFinder(activeCwd);
      const effectiveLimit = resumed ? resumed.pageSize : Math.max(1, params.limit ?? DEFAULT_FIND_LIMIT);
      const query = resumed ? resumed.query : aux && ("query" in aux) ? aux.query : buildQuery(params.path, params.pattern, params.exclude, activeCwd);
      const pattern = resumed ? resumed.pattern : params.pattern;
      const pageIndex = resumed?.nextPageIndex ?? 0;
      const auxRoot = resumed?.auxRoot ?? aux?.root;
      const searchResult = picker.fileSearch(query, {
        pageIndex,
        pageSize: effectiveLimit
      });
      if (!searchResult.ok)
        throw new Error(searchResult.error);
      const result = searchResult.value;
      const formatted = formatFindOutput(result, effectiveLimit, pattern);
      let output = formatted.output;
      const shownSoFar = pageIndex * effectiveLimit + result.items.length;
      const hasMore = result.items.length >= effectiveLimit && result.totalMatched > shownSoFar;
      const notices = [];
      if (formatted.weak && formatted.shownCount > 0)
        notices.push(`Query "${pattern}" produced only weak scattered fuzzy matches. Output capped at ${formatted.shownCount}/${result.totalMatched}.`);
      if (!formatted.weak && hasMore) {
        const remaining = result.totalMatched - shownSoFar;
        const cursorId = storeFindCursor({
          query,
          pattern,
          pageSize: effectiveLimit,
          nextPageIndex: pageIndex + 1,
          auxRoot
        });
        notices.push(`${remaining} more match${remaining === 1 ? "" : "es"} available. cursor="${cursorId}" to continue`);
      }
      if (notices.length > 0)
        output += `

[${notices.join(". ")}]`;
      return {
        content: [{ type: "text", text: output }],
        details: {
          totalMatched: result.totalMatched,
          totalFiles: result.totalFiles,
          pageIndex,
          hasMore
        }
      };
    },
    renderCall(args, theme, context) {
      const pattern = args?.pattern ?? "";
      const path = args?.path ?? ".";
      let content = theme.fg("toolTitle", theme.bold(getRenderToolName(context, toolNames.find))) + " " + theme.fg("accent", pattern) + theme.fg("toolOutput", ` in ${path}`);
      if (args?.limit !== undefined)
        content += theme.fg("toolOutput", ` (limit ${args.limit})`);
      if (args?.cursor)
        content += theme.fg("muted", ` (page)`);
      return new CollapsedText(content, "", theme.fg("muted", "..."));
    },
    renderResult(result, options, theme, context) {
      return renderCompactTextResult(result, options, theme, context);
    }
  });
  const enableMultiGrep = process.env.PI_FFF_MULTIGREP === "1";
  if (enableMultiGrep) {
    const multiGrepSchema = Type.Object({
      patterns: Type.Array(Type.String(), {
        description: "Literal patterns (OR). Include snake_case/camelCase/PascalCase variants."
      }),
      constraints: Type.Optional(Type.String({ description: "File filter, e.g. '*.{ts,tsx} !test/'" })),
      context: Type.Optional(Type.Number({
        description: `Context lines before+after (0-${GREP_CONTEXT_MAX})`
      })),
      limit: Type.Optional(Type.Number({
        description: `Max matches (default ${DEFAULT_GREP_LIMIT})`
      })),
      cursor: Type.Optional(Type.String({ description: "Pagination cursor" }))
    });
    queueTool(() => toolNames.multiGrep, {
      description: "Search file contents for ANY of multiple literal patterns (OR, SIMD Aho-Corasick). Faster than regex alternation.",
      promptSnippet: "Multi-pattern OR content search",
      promptGuidelines: (names) => [
        `${names.multiGrep}: use when searching for several identifiers at once.`,
        `${names.multiGrep}: include all naming-convention variants (snake/camel/Pascal).`,
        `${names.multiGrep}: patterns are literal. Use constraints for file filters.`
      ],
      parameters: multiGrepSchema,
      async execute(_toolCallId, params, signal) {
        if (signal?.aborted)
          throw new Error("Operation aborted");
        if (!params.patterns?.length)
          throw new Error("patterns array must have at least 1 element");
        const f = await ensureFinder(activeCwd);
        const effectiveLimit = Math.max(1, params.limit ?? DEFAULT_GREP_LIMIT);
        const pageSize = Math.min(effectiveLimit, GREP_PAGE_SIZE_MAX);
        const context = clampContext(params.context);
        const grepResult = f.multiGrep({
          patterns: params.patterns,
          constraints: params.constraints,
          maxMatchesPerFile: GREP_MAX_MATCHES_PER_FILE,
          pageSize,
          smartCase: true,
          cursor: (params.cursor ? getCursor(params.cursor) : null) ?? null,
          beforeContext: context,
          afterContext: context
        });
        if (!grepResult.ok)
          throw new Error(grepResult.error);
        const result = grepResult.value;
        let output = formatGrepOutput(result);
        const notices = [];
        if (result.items.length >= effectiveLimit)
          notices.push(`${effectiveLimit}+ matches (refine patterns)`);
        if (result.nextCursor)
          notices.push(`More available. cursor="${storeCursor(result.nextCursor)}" to continue`);
        if (notices.length > 0)
          output += `

[${notices.join(". ")}]`;
        return {
          content: [{ type: "text", text: output }],
          details: {
            totalMatched: result.totalMatched,
            totalFiles: result.totalFiles,
            patterns: params.patterns
          }
        };
      },
      renderCall(args, theme, context) {
        const text = context.lastComponent ?? new Text("", 0, 0);
        const patterns = args?.patterns ?? [];
        const constraints = args?.constraints;
        let content = theme.fg("toolTitle", theme.bold(getRenderToolName(context, toolNames.multiGrep))) + " " + theme.fg("accent", patterns.map((p) => `"${p}"`).join(", "));
        if (constraints)
          content += theme.fg("toolOutput", ` (${constraints})`);
        if (args?.cursor)
          content += theme.fg("muted", ` (page)`);
        text.setText(content);
        return text;
      },
      renderResult(result, options, theme, context) {
        return renderPreviewResult(result, options, theme, context, 15);
      }
    });
  }
  pi.registerCommand("fff-mode", {
    description: "Show or set FFF mode: /fff-mode [tools-and-ui | tools-only | override | engine-only]",
    handler: async (args, ctx) => {
      if (!toolsRegistered) {
        try {
          prepareSession(ctx);
        } catch (error) {
          reportInitFailure(ctx, error);
          return;
        }
      }
      const arg = (args || "").trim();
      if (!arg) {
        const mode = getMode();
        const flag = pi.getFlag("fff-mode") ?? "unset";
        ctx.ui.notify(`Current mode: '${mode}' (flag: ${flag})`, "info");
        return;
      }
      if (!VALID_MODES.includes(arg)) {
        ctx.ui.notify(`Usage: /fff-mode [${VALID_MODES.join(" | ")}]`, "warning");
        return;
      }
      const newMode = arg;
      const oldMode = getMode();
      pi.appendEntry("fff-mode", { mode: newMode });
      const changesRegistration = oldMode === "override" !== (newMode === "override") || oldMode === "engine-only" !== (newMode === "engine-only");
      if (changesRegistration) {
        ctx.ui.notify(`Mode '${newMode}' saved. Run /reload to apply the tool name change.`, "info");
        return;
      }
      setMode(newMode);
      ctx.ui.notify(`Mode changed: '${oldMode}' → '${newMode}'`, "info");
    }
  });
  pi.registerCommand("fff-health", {
    description: "Show FFF file finder health and status",
    handler: async (_args, ctx) => {
      if (!mainFinder || mainFinder.isDestroyed) {
        ctx.ui.notify("FFF not initialized", "warning");
        return;
      }
      const health = mainFinder.healthCheck();
      if (!health.ok) {
        ctx.ui.notify(`Health check failed: ${health.error}`, "error");
        return;
      }
      const lines = [
        `FFF v${health.value.version}`,
        `Mode: ${getMode()}`,
        `Git: ${health.value.git.repositoryFound ? `yes (${health.value.git.workdir ?? "unknown"})` : "no"}`,
        `Picker: ${health.value.filePicker.initialized ? `${health.value.filePicker.indexedFiles ?? 0} files` : "not initialized"}`,
        `Frecency: ${health.value.frecency.initialized ? "active" : "disabled"}`,
        `Query tracker: ${health.value.queryTracker.initialized ? "active" : "disabled"}`
      ];
      const progress = mainFinder.getScanProgress();
      if (progress.ok) {
        lines.push(`Scanning: ${progress.value.isScanning ? "yes" : "no"} (${progress.value.scannedFilesCount} files)`);
      }
      ctx.ui.notify(lines.join(`
`), "info");
    }
  });
  pi.registerCommand("fff-rescan", {
    description: "Trigger FFF to rescan files",
    handler: async (_args, ctx) => {
      if (!mainFinder || mainFinder.isDestroyed) {
        ctx.ui.notify("FFF not initialized", "warning");
        return;
      }
      const result = mainFinder.scanFiles();
      if (!result.ok) {
        ctx.ui.notify(`Rescan failed: ${result.error}`, "error");
        return;
      }
      ctx.ui.notify("FFF rescan triggered", "info");
    }
  });
}
function sessionModes(entries) {
  if (!Array.isArray(entries))
    return [];
  const modes = [];
  for (const entry of entries) {
    if (entry?.type !== "custom" || entry.customType !== "fff-mode")
      continue;
    const mode = entry.data?.mode;
    if (typeof mode === "string" && VALID_MODES.includes(mode)) {
      modes.push(mode);
    }
  }
  return modes;
}
export {
  FINDER_API_VERSION,
  FINDER_SLOT,
  SCAN_TIMEOUT_MS,
  fffExtension as default,
  fffFileAnnotation
};
