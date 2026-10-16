import {
  log2
} from "./index-x3dcnxh0.js";

// ../plugin/src/shared/pi-executable.ts
var PI_IMAGE_NAMES = new Set(["pi", "pi.cmd", "omp", "oh-my-pi"]);
function piHarnessKindFromExecutable(value) {
  const executable = (value ?? "").trim().replace(/^['"]|['"]$/g, "").replaceAll("\\", "/").split("/").at(-1)?.toLowerCase().replace(/\.(?:exe|cmd)$/, "");
  if (!executable || !PI_IMAGE_NAMES.has(executable))
    return;
  return executable === "pi" ? "pi" : "omp";
}

// ../plugin/src/shared/rpc-utils.ts
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
var ownRpcServerInstanceIds = new Set;
function isOwnRpcServerRecord(record) {
  return record.pid === process.pid && record.instance_id !== undefined && ownRpcServerInstanceIds.has(record.instance_id);
}
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0)
    return "dead";
  if (rpcIdentityPlatform === "win32")
    return readWindowsProcess(pid).state;
  try {
    rpcIdentityProcessKill(pid, 0);
    return "alive";
  } catch (error) {
    return error.code === "ESRCH" ? "dead" : "inconclusive";
  }
}
var RPC_IDENTITY_SKEW_TOLERANCE_MS = 120000;
var LINUX_CLOCK_TICKS_PER_SECOND = 100;
var PS_PROBE_TIMEOUT_MS = 1000;
var WINDOWS_CIM_PROBE_TIMEOUT_MS = 5000;
var WINDOWS_PROCESS_SNAPSHOT_TTL_MS = 2000;
var MAX_ANCESTOR_WALK_DEPTH = 16;
var OPEN_CODE_COMMAND_MARKERS = ["opencode", "node", "bun", "electron"];
var WINDOWS_CIM_COMMAND = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,@{Name='CreationDate';Expression={if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }}} | ConvertTo-Json -Compress";
var PROCESS_LIST_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
var PI_HARNESS_ARC_MARKERS = [
  "pi-coding-agent",
  "oh-my-pi",
  "@oh-my-pi",
  "cljs/dist",
  "dist/bundle/cli"
];
var rpcIdentityReadFileSync = readFileSync;
var rpcIdentityExecFileSync = execFileSync;
var rpcIdentityProcessKill = process.kill;
var rpcProcessListExecFileSync = execFileSync;
var rpcIdentityPlatform = process.platform;
var rpcIdentityNowMs = () => Date.now();
function parseLinuxProcessStartTime(statContent, uptimeContent) {
  const closingCommandName = statContent.lastIndexOf(")");
  if (closingCommandName < 0)
    return null;
  const statFields = statContent.slice(closingCommandName + 1).trim().split(/\s+/);
  const startTimeTicks = Number(statFields[19]);
  const uptimeSeconds = Number(uptimeContent.trim().split(/\s+/)[0]);
  if (!Number.isFinite(startTimeTicks) || startTimeTicks < 0 || !Number.isFinite(uptimeSeconds) || uptimeSeconds < 0) {
    return null;
  }
  const processStartTime = rpcIdentityNowMs() - uptimeSeconds * 1000 + startTimeTicks / LINUX_CLOCK_TICKS_PER_SECOND * 1000;
  return Number.isFinite(processStartTime) ? processStartTime : null;
}
function readLinuxProcessStartTime(pid) {
  try {
    const statContent = String(rpcIdentityReadFileSync(`/proc/${pid}/stat`, "utf8"));
    const uptimeContent = String(rpcIdentityReadFileSync("/proc/uptime", "utf8"));
    return parseLinuxProcessStartTime(statContent, uptimeContent);
  } catch {
    return null;
  }
}
function readPsProcessStartTime(pid) {
  try {
    const output = rpcIdentityExecFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8",
      timeout: PS_PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const processStartTime = Date.parse(String(output).trim());
    return Number.isFinite(processStartTime) ? processStartTime : null;
  } catch {
    return null;
  }
}
function readProcessStartTime(pid) {
  if (!Number.isInteger(pid) || pid <= 0)
    return null;
  return rpcIdentityPlatform === "linux" ? readLinuxProcessStartTime(pid) : rpcIdentityPlatform === "win32" ? readWindowsProcessStartTime(pid) : readPsProcessStartTime(pid);
}
function readProcessProbeEvidence(pid) {
  return {
    startTime: readProcessStartTime(pid),
    commandLine: readProcessCommand(pid)
  };
}
function readCachedWindowsImageName(pid) {
  return rpcIdentityPlatform === "win32" ? windowsProcessFactsCache?.get(pid)?.imageName ?? null : null;
}
var windowsProcessFactsCache = null;
var windowsProcessSnapshotCache = null;
function rememberWindowsProcessFacts(facts) {
  windowsProcessFactsCache = new Map(facts.map((fact) => [fact.pid, fact]));
}
function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let index = 0;index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  if (quoted)
    return null;
  fields.push(field);
  return fields;
}
function parseTasklistOutput(output) {
  const entries = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line)
      continue;
    const fields = parseCsvLine(line);
    if (!fields)
      continue;
    if (fields[1]?.trim().toLowerCase() === "pid") {
      continue;
    }
    const pid = Number(fields[1]);
    if (!Number.isInteger(pid) || pid <= 0 || !fields[0])
      continue;
    entries.push({ pid, command: fields[0] });
  }
  return entries;
}
function readWindowsProcess(pid) {
  try {
    const output = rpcIdentityExecFileSync("tasklist", ["/FO", "CSV", "/NH", "/FI", `PID eq ${pid}`], {
      encoding: "utf8",
      timeout: PS_PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const entries = parseTasklistOutput(String(output));
    if (entries === null)
      return { state: "inconclusive" };
    const process2 = entries.find((entry) => entry.pid === pid);
    return process2 ? { state: "alive", command: process2.command } : { state: "dead" };
  } catch {
    return { state: "inconclusive" };
  }
}
function readWindowsProcessStartTime(pid) {
  const cached = windowsProcessFactsCache?.get(pid);
  if (cached)
    return cached.startTime;
  const snapshot = tryReadWindowsCimSnapshot(rpcIdentityExecFileSync);
  if (!snapshot)
    return null;
  rememberWindowsProcessFacts(snapshot.facts);
  return windowsProcessFactsCache?.get(pid)?.startTime ?? null;
}
function readLinuxProcessCommand(pid) {
  try {
    return String(rpcIdentityReadFileSync(`/proc/${pid}/cmdline`, "utf8"));
  } catch {
    return null;
  }
}
function readPsProcessCommand(pid) {
  try {
    const output = rpcIdentityExecFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: PS_PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    return String(output);
  } catch {
    return null;
  }
}
function readProcessCommand(pid) {
  if (!Number.isInteger(pid) || pid <= 0)
    return null;
  if (rpcIdentityPlatform === "linux")
    return readLinuxProcessCommand(pid);
  if (rpcIdentityPlatform === "win32") {
    const cached = windowsProcessFactsCache?.get(pid);
    if (cached?.commandLine)
      return cached.commandLine;
    return readWindowsProcess(pid).command ?? null;
  }
  return readPsProcessCommand(pid);
}
function executableName(token) {
  return (token ?? "").replace(/^['"]|['"]$/g, "").split("/").at(-1) ?? "";
}
function commandTokens(command) {
  return command.toLowerCase().replaceAll("\\", "/").replaceAll("\x00", " ").split(/\s+/).map((token) => token.replace(/^['"]|['"]$/g, "")).filter(Boolean);
}
function commandHasOpenCodeExecutable(tokens) {
  return tokens.findIndex((token) => {
    const executable = executableName(token).replace(/\.(?:exe|cmd)$/, "");
    return executable === "opencode" || executable.endsWith("/opencode");
  });
}
function commandHasPiExecutable(tokens) {
  for (let index = 0;index < tokens.length; index += 1) {
    const executable = executableName(tokens[index]).replace(/\.(?:exe|cmd)$/, "");
    if (piHarnessKindFromExecutable(executable) !== undefined)
      return true;
    if (["node", "bun", "deno"].includes(executable)) {
      const script = executableName(tokens[index + 1]).replace(/\.(?:exe|cmd)$/, "");
      if (["pi", "pi.js", "pi.mjs", "pi.cjs"].includes(script) || tokens[index + 1]?.includes("pi-coding-agent")) {
        return true;
      }
    }
  }
  return false;
}
function classifyProcessKind(command) {
  if (!command)
    return "process";
  const tokens = commandTokens(command);
  const openCodeIndex = commandHasOpenCodeExecutable(tokens);
  if (openCodeIndex >= 0) {
    const args = tokens.slice(openCodeIndex + 1);
    if (args.some((token) => token === "serve" || token === "--serve" || token.startsWith("--serve="))) {
      return "OpenCode server";
    }
    return "OpenCode instance (TUI/CLI)";
  }
  return commandHasPiExecutable(tokens) ? "Pi" : "process";
}
function commandLooksLikeOpenCode(command) {
  const normalized = command.toLowerCase();
  return OPEN_CODE_COMMAND_MARKERS.some((marker) => normalized.includes(marker));
}
var RPC_HOST_PROCESS_MARKERS = [
  "opencode",
  "openchamber",
  "ck-mc",
  "magic-context",
  "cortexkit",
  "electron",
  "node",
  "bun",
  "deno",
  "pi-coding-agent",
  "oh-my-pi"
];
function processCannotBeRpcHost(evidence) {
  const texts = [evidence.imageName, evidence.commandLine].filter((text) => typeof text === "string" && text.trim().length > 0);
  if (texts.length === 0)
    return false;
  for (const text of texts) {
    const normalized = text.toLowerCase();
    if (RPC_HOST_PROCESS_MARKERS.some((marker) => normalized.includes(marker)))
      return false;
    const tokens = commandTokens(text);
    if (commandHasPiExecutable(tokens))
      return false;
    if (tokens.some((token) => piHarnessKindFromExecutable(token) !== undefined))
      return false;
  }
  return true;
}
function isPidIdentityPlausible(record, evidence) {
  if (!Number.isInteger(record.pid) || record.pid <= 0)
    return "implausible";
  if (Number.isFinite(record.started_at) && record.started_at > 0) {
    const processStartTime = evidence ? evidence.startTime : readProcessStartTime(record.pid);
    if (processStartTime !== null) {
      return processStartTime <= record.started_at + RPC_IDENTITY_SKEW_TOLERANCE_MS ? "plausible" : "implausible";
    }
    const identity = evidence ?? {
      commandLine: readProcessCommand(record.pid),
      imageName: readCachedWindowsImageName(record.pid)
    };
    return processCannotBeRpcHost(identity) ? "implausible" : "inconclusive";
  }
  const command = evidence ? evidence.commandLine : rpcIdentityPlatform === "linux" ? readLinuxProcessCommand(record.pid) : rpcIdentityPlatform === "win32" ? readWindowsProcess(record.pid).command ?? null : readPsProcessCommand(record.pid);
  if (command === null)
    return "inconclusive";
  if (commandLooksLikeOpenCode(command))
    return "plausible";
  return processCannotBeRpcHost({ commandLine: command, imageName: evidence?.imageName }) ? "implausible" : "inconclusive";
}
function commandLooksLikePiImage(command) {
  const tokens = commandTokens(command);
  const first = executableName(tokens[0]).replace(/\.(?:exe|cmd)$/, "");
  return PI_IMAGE_NAMES.has(first);
}
function commandHasPiHarnessArc(command) {
  const normalized = command.trim().toLowerCase().replaceAll("\\", "/").replaceAll("\x00", " ");
  if (!normalized)
    return false;
  const tokens = commandTokens(command);
  if (tokens.length === 0)
    return false;
  const hasArc = PI_HARNESS_ARC_MARKERS.some((marker) => normalized.includes(marker));
  const first = executableName(tokens[0]).replace(/\.(?:exe|cmd)$/, "");
  if (hasArc && ["pi", "omp", "oh-my-pi", "node", "bun", "deno", "cmd"].includes(first)) {
    return true;
  }
  if (hasArc && PI_HARNESS_ARC_MARKERS.some((marker) => tokens[0].includes(marker))) {
    return true;
  }
  if (["node", "bun", "deno"].includes(first)) {
    const script = executableName(tokens[1]).replace(/\.(?:exe|cmd)$/, "");
    if (["pi", "pi.js", "pi.mjs", "pi.cjs"].includes(script))
      return true;
    if (hasArc)
      return true;
  }
  return false;
}
function execProcessList(exec, file, args, timeout = PS_PROBE_TIMEOUT_MS) {
  return String(exec(file, [...args], {
    encoding: "utf8",
    timeout,
    maxBuffer: PROCESS_LIST_MAX_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  }));
}
function parseWindowsCreationDate(value) {
  if (value !== null && typeof value === "object" && "value" in value) {
    return parseWindowsCreationDate(value.value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1000000000000 ? value : value * 1000;
  }
  if (typeof value !== "string")
    return null;
  const trimmed = value.trim();
  if (!trimmed)
    return null;
  const wmi = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.(\d{6})([+-])(\d{3})$/.exec(trimmed);
  if (wmi) {
    const utcMs = Date.UTC(Number(wmi[1]), Number(wmi[2]) - 1, Number(wmi[3]), Number(wmi[4]), Number(wmi[5]), Number(wmi[6]), Number(wmi[7]) / 1000);
    if (!Number.isFinite(utcMs))
      return null;
    const offsetMinutes = Number(wmi[9]);
    const sign = wmi[8] === "+" ? 1 : -1;
    return utcMs - sign * offsetMinutes * 60000;
  }
  const dotNet = /^\/Date\((-?\d+)\)\/$/.exec(trimmed);
  if (dotNet) {
    const milliseconds = Number(dotNet[1]);
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
function parseWindowsCimOutput(output) {
  const trimmed = output.trim();
  if (!trimmed)
    return null;
  const bracket = trimmed.indexOf("[");
  const brace = trimmed.indexOf("{");
  const start = Math.min(bracket === -1 ? Number.POSITIVE_INFINITY : bracket, brace === -1 ? Number.POSITIVE_INFINITY : brace);
  if (!Number.isFinite(start))
    return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed.slice(start));
  } catch {
    return null;
  }
  if (parsed == null)
    return null;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const facts = [];
  for (const row of rows) {
    if (!row || typeof row !== "object")
      continue;
    const record = row;
    const pid = Number(record.ProcessId);
    if (!Number.isInteger(pid) || pid <= 0)
      continue;
    const parentRaw = record.ParentProcessId;
    const parentPid = parentRaw == null || parentRaw === "" ? Number.NaN : Number(parentRaw);
    const commandLine = typeof record.CommandLine === "string" ? record.CommandLine : null;
    facts.push({
      pid,
      parentPid: Number.isInteger(parentPid) && parentPid > 0 ? parentPid : null,
      commandLine,
      imageName: typeof record.Name === "string" ? record.Name : commandLine ? executableName(commandTokens(commandLine)[0]) : null,
      startTime: parseWindowsCreationDate(record.CreationDate)
    });
  }
  return facts.length > 0 ? facts : null;
}
function snapshotFromFacts(facts, source) {
  const parentByPid = new Map;
  for (const fact of facts) {
    if (fact.parentPid != null)
      parentByPid.set(fact.pid, fact.parentPid);
  }
  return { facts, parentByPid, source };
}
function tryReadWindowsCimSnapshot(exec) {
  try {
    const output = execProcessList(exec, "powershell", ["-NoProfile", "-Command", WINDOWS_CIM_COMMAND], WINDOWS_CIM_PROBE_TIMEOUT_MS);
    const facts = parseWindowsCimOutput(output);
    return facts ? snapshotFromFacts(facts, "cim") : null;
  } catch {
    return null;
  }
}
function tryReadWindowsTasklistSnapshot() {
  try {
    const output = execProcessList(rpcProcessListExecFileSync, "tasklist", [
      "/FO",
      "CSV",
      "/NH"
    ]);
    const entries = parseTasklistOutput(output);
    if (entries === null)
      return null;
    const facts = entries.map((entry) => ({
      pid: entry.pid,
      parentPid: null,
      commandLine: null,
      imageName: entry.command,
      startTime: null
    }));
    return snapshotFromFacts(facts, "tasklist");
  } catch {
    return null;
  }
}
function readPosixProcessSnapshot() {
  const output = execProcessList(rpcProcessListExecFileSync, "ps", ["-axo", "pid=,command="]);
  const facts = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!match)
      continue;
    const pid = Number(match[1]);
    if (!Number.isInteger(pid) || pid <= 0)
      continue;
    facts.push({
      pid,
      parentPid: null,
      commandLine: match[2],
      imageName: executableName(commandTokens(match[2])[0]),
      startTime: null
    });
  }
  return snapshotFromFacts(facts, "ps");
}
function readPosixParentPid(pid) {
  try {
    const output = execProcessList(rpcProcessListExecFileSync, "ps", [
      "-o",
      "ppid=",
      "-p",
      String(pid)
    ]);
    const match = /^\s*(\d+)\s*$/.exec(output);
    if (!match)
      return null;
    const ppid = Number(match[1]);
    return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
  } catch {
    return null;
  }
}
function collectAncestorPids(selfPid, parentByPid, probeParents = true) {
  const ancestors = new Set;
  let current = selfPid;
  for (let depth = 0;depth < MAX_ANCESTOR_WALK_DEPTH; depth += 1) {
    let ppid = null;
    if (parentByPid.has(current)) {
      ppid = parentByPid.get(current) ?? null;
    } else if (rpcIdentityPlatform !== "win32" && probeParents) {
      ppid = readPosixParentPid(current);
      if (ppid == null && current === process.pid && process.ppid > 0) {
        ppid = process.ppid;
      }
    } else if (current === process.pid && process.ppid > 0) {
      ppid = process.ppid;
    } else {
      break;
    }
    if (ppid == null || ppid <= 0 || ppid === current || ancestors.has(ppid))
      break;
    ancestors.add(ppid);
    current = ppid;
  }
  return ancestors;
}
function classifyLivePiSnapshot(snapshot, probeParents = true) {
  const ancestors = collectAncestorPids(process.pid, snapshot.parentByPid, probeParents);
  const processIds = new Set;
  const inconclusivePids = new Set;
  const skippedAncestorPids = [];
  for (const fact of snapshot.facts) {
    if (fact.pid === process.pid)
      continue;
    const command = fact.commandLine ?? fact.imageName ?? "";
    const looksLikeHarness = commandHasPiHarnessArc(command) || commandLooksLikePiImage(command);
    if (!looksLikeHarness)
      continue;
    if (ancestors.has(fact.pid)) {
      skippedAncestorPids.push(fact.pid);
      log2(`[magic-context] Pi process scan: skipping ancestor PID ${fact.pid} (session launcher shim)`);
      continue;
    }
    if (commandHasPiHarnessArc(command)) {
      processIds.add(fact.pid);
      continue;
    }
    inconclusivePids.add(fact.pid);
    log2(`[magic-context] Pi process scan: PID ${fact.pid} command line is ambiguous (image-name or missing Pi/OMP arc); treating as inconclusive`);
  }
  skippedAncestorPids.sort((left, right) => left - right);
  const verified = [...processIds].sort((left, right) => left - right);
  const inconclusive = [...inconclusivePids].sort((left, right) => left - right);
  if (verified.length === 0 && inconclusive.length > 0) {
    return {
      state: "inconclusive",
      processIds: [],
      inconclusivePids: inconclusive,
      ...skippedAncestorPids.length > 0 ? { skippedAncestorPids } : {}
    };
  }
  return {
    state: "known",
    processIds: verified,
    ...inconclusive.length > 0 ? { inconclusivePids: inconclusive } : {},
    ...skippedAncestorPids.length > 0 ? { skippedAncestorPids } : {}
  };
}
function inspectLivePiProcesses() {
  if (false) {}
  try {
    if (rpcIdentityPlatform === "win32") {
      const now = rpcIdentityNowMs();
      const cached = windowsProcessSnapshotCache;
      const snapshot = cached && now >= cached.at && now - cached.at < WINDOWS_PROCESS_SNAPSHOT_TTL_MS ? cached.snapshot : tryReadWindowsCimSnapshot(rpcProcessListExecFileSync) ?? tryReadWindowsTasklistSnapshot();
      if (!snapshot) {
        return {
          state: "unreadable",
          processIds: [],
          error: "process list unavailable"
        };
      }
      if (snapshot !== cached?.snapshot)
        windowsProcessSnapshotCache = { snapshot, at: now };
      rememberWindowsProcessFacts(snapshot.facts);
      return classifyLivePiSnapshot(snapshot);
    }
    return classifyLivePiSnapshot(readPosixProcessSnapshot());
  } catch (error) {
    return {
      state: "unreadable",
      processIds: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
function parseRpcPortFile(content, fallbackPid = 0) {
  const trimmed = content.trim();
  if (!trimmed)
    return null;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const port = Number(parsed.port);
      const pid = Number(parsed.pid);
      const startedAt = Number(parsed.started_at);
      if (!isValidPort(port) || !Number.isInteger(pid) || pid <= 0)
        return null;
      return {
        port,
        pid,
        started_at: Number.isFinite(startedAt) ? startedAt : 0,
        kind: typeof parsed.kind === "string" ? parsed.kind : undefined,
        harness: typeof parsed.harness === "string" ? parsed.harness : undefined,
        token: typeof parsed.token === "string" ? parsed.token : undefined,
        instance_id: typeof parsed.instance_id === "string" ? parsed.instance_id : undefined
      };
    } catch {
      return null;
    }
  }
  const port = Number.parseInt(trimmed, 10);
  if (!isValidPort(port))
    return null;
  return { port, pid: fallbackPid, started_at: 0 };
}
function isValidPort(port) {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}
function snapshotEvidence(fact) {
  return {
    startTime: fact?.startTime ?? null,
    commandLine: fact?.commandLine ?? fact?.imageName ?? null,
    ...fact?.imageName ? { imageName: fact.imageName } : {}
  };
}
function execProcessListAsync(file, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: "utf8", timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error)
        reject(error);
      else
        resolve(stdout);
    });
  });
}
var asyncProcessExec = execProcessListAsync;
var asyncInspection;
var asyncInspectionExpires = 0;
var lastAsyncSnapshot = null;
function inspectProcessesAsync(forceFresh = false) {
  if (!forceFresh && asyncInspection && rpcIdentityNowMs() < asyncInspectionExpires)
    return asyncInspection;
  asyncInspectionExpires = Number.POSITIVE_INFINITY;
  asyncInspection = (async () => {
    let snapshot = null;
    try {
      if (rpcIdentityPlatform === "win32") {
        try {
          const output = await asyncProcessExec("powershell", ["-NoProfile", "-Command", WINDOWS_CIM_COMMAND], WINDOWS_CIM_PROBE_TIMEOUT_MS);
          const facts = parseWindowsCimOutput(output);
          if (facts)
            snapshot = snapshotFromFacts(facts, "cim");
        } catch {}
        if (!snapshot) {
          const entries = parseTasklistOutput(await asyncProcessExec("tasklist", ["/FO", "CSV", "/NH"], PS_PROBE_TIMEOUT_MS));
          if (entries)
            snapshot = snapshotFromFacts(entries.map(({ pid, command }) => ({
              pid,
              parentPid: null,
              commandLine: null,
              imageName: command,
              startTime: null
            })), "tasklist");
        }
      } else {
        const output = await asyncProcessExec("ps", ["-axo", "pid=,ppid=,lstart=,command="], PS_PROBE_TIMEOUT_MS);
        const facts = [];
        for (const line of output.split(/\r?\n/)) {
          const match = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.+)$/.exec(line);
          if (!match)
            continue;
          const startTime = Date.parse(match[3]);
          facts.push({
            pid: Number(match[1]),
            parentPid: Number(match[2]),
            commandLine: match[4],
            imageName: null,
            startTime: Number.isFinite(startTime) ? startTime : null
          });
        }
        snapshot = facts.length > 0 ? snapshotFromFacts(facts, "ps") : null;
      }
    } catch {}
    const fresh = snapshot !== null;
    if (snapshot)
      lastAsyncSnapshot = snapshot;
    else
      snapshot = lastAsyncSnapshot;
    const byPid = new Map(snapshot?.facts.map((fact) => [fact.pid, fact]));
    return {
      pi: snapshot ? classifyLivePiSnapshot(snapshot, false) : { state: "unreadable", processIds: [] },
      ...fresh && snapshot ? { processSnapshot: { source: snapshot.source, facts: snapshot.facts } } : {},
      evidence: (pid) => snapshotEvidence(byPid.get(pid)),
      liveness: (pid) => byPid.has(pid) ? "alive" : fresh ? "dead" : "inconclusive"
    };
  })().finally(() => {
    asyncInspectionExpires = rpcIdentityNowMs() + WINDOWS_PROCESS_SNAPSHOT_TTL_MS;
  });
  return asyncInspection;
}
function inspectWindowsProcessesSync() {
  const snapshot = tryReadWindowsCimSnapshot(rpcProcessListExecFileSync) ?? tryReadWindowsTasklistSnapshot();
  const byPid = new Map(snapshot?.facts.map((fact) => [fact.pid, fact]));
  return {
    pi: snapshot ? classifyLivePiSnapshot(snapshot) : { state: "unreadable", processIds: [] },
    ...snapshot ? { processSnapshot: { source: snapshot.source, facts: snapshot.facts } } : {},
    evidence: (pid) => snapshotEvidence(byPid.get(pid)),
    liveness: (pid) => byPid.has(pid) ? "alive" : snapshot ? "dead" : "inconclusive"
  };
}

export { piHarnessKindFromExecutable, isOwnRpcServerRecord, isPidAlive, readProcessStartTime, readProcessProbeEvidence, classifyProcessKind, isPidIdentityPlausible, inspectLivePiProcesses, parseRpcPortFile, inspectProcessesAsync, inspectWindowsProcessesSync };
