import {
  sanitizeDiagnosticText
} from "./index-dnp1jjar.js";

// ../plugin/src/features/magic-context/fail-closed-block.ts
var FAIL_CLOSED_DOCTOR_COMMAND = "npx @cortexkit/magic-context@latest doctor";
var FAIL_CLOSED_REPROBE_EVERY_N = 5;
function attachFailClosedBlockingProcessEvidence(process, evidence) {
  Object.defineProperties(process, {
    startTime: { configurable: true, value: evidence.startTime },
    commandLine: { configurable: true, value: evidence.commandLine }
  });
  return process;
}

class FailClosedBlockingError extends Error {
  code = "FAIL_CLOSED_BLOCKING";
  reason;
  constructor(message, reason, options) {
    super(message, options);
    this.name = "FailClosedBlockingError";
    this.reason = reason;
  }
}
var OPENCODE_INTERNAL_AGENT_NAMES = new Set(["title", "summary", "compaction"]);
function isMagicContextHiddenAgentName(agent) {
  if (agent === "smart-note-compiler" || agent.startsWith("smart-note-")) {
    return true;
  }
  if (agent === "historian" || agent.startsWith("historian-"))
    return true;
  if (agent === "dreamer" || agent.startsWith("dreamer-"))
    return true;
  return false;
}
var MAX_FORMATTED_BLOCKING_PROCESSES = 8;
var MAX_FORMATTED_COMMAND_LINE_LENGTH = 80;
function normalizeFailClosedProcessKind(process) {
  switch (process.kind) {
    case "OpenCode server":
    case "OpenCode instance (TUI/CLI)":
    case "Pi":
    case "process":
      return process.kind;
  }
  switch (process.harness?.trim().toLowerCase()) {
    case "opencode server":
      return "OpenCode server";
    case "opencode instance (tui/cli)":
    case "opencode instance":
      return "OpenCode instance (TUI/CLI)";
    case "pi":
    case "pi harness":
    case "omp":
      return "Pi";
    default:
      return "process";
  }
}
function formatFailClosedProcessStartTime(startTime) {
  if (!Number.isFinite(startTime) || startTime <= 0)
    return "unverified";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      hour12: false
    }).formatToParts(new Date(startTime));
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    if (!values.month || !values.day || !values.hour || !values.minute)
      return "unverified";
    return `${values.month} ${values.day} ${values.hour}:${values.minute}`;
  } catch {
    return "unverified";
  }
}
function formatFailClosedCommandLine(commandLine) {
  if (typeof commandLine !== "string" || commandLine.trim().length === 0)
    return "unverified";
  try {
    const normalized = commandLine.replaceAll("\x00", " ").replace(/\s+/g, " ").trim();
    if (normalized.length === 0)
      return "unverified";
    const sanitized = sanitizeDiagnosticText(normalized).trim();
    if (sanitized.length === 0)
      return "unverified";
    return sanitized.length > MAX_FORMATTED_COMMAND_LINE_LENGTH ? `${sanitized.slice(0, MAX_FORMATTED_COMMAND_LINE_LENGTH - 3)}...` : sanitized;
  } catch {
    return "unverified";
  }
}
function formatFailClosedBlockingProcesses(processes) {
  const uniqueProcesses = new Map;
  for (const process of processes) {
    if (!Number.isInteger(process.pid) || process.pid <= 0)
      continue;
    const candidate = {
      kind: normalizeFailClosedProcessKind(process),
      pid: process.pid,
      startTime: process.startTime,
      commandLine: process.commandLine
    };
    const previous = uniqueProcesses.get(process.pid);
    if (!previous || previous.kind === "process" && candidate.kind !== "process") {
      uniqueProcesses.set(process.pid, candidate);
    } else {
      uniqueProcesses.set(process.pid, {
        ...previous,
        startTime: previous.startTime ?? candidate.startTime,
        commandLine: previous.commandLine ?? candidate.commandLine
      });
    }
  }
  const entries = [...uniqueProcesses.values()];
  const visible = entries.slice(0, MAX_FORMATTED_BLOCKING_PROCESSES);
  const rendered = visible.map(({ kind, pid }) => `${kind} (PID ${pid})`);
  const omitted = entries.length - visible.length;
  if (omitted > 0)
    rendered.push(`${omitted} more blocking process(es)`);
  if (rendered.length === 0)
    return "a live process";
  const summary = rendered.length === 1 ? rendered[0] : `${rendered.slice(0, -1).join(", ")}, and ${rendered.at(-1)}`;
  const evidence = entries.map(({ kind, pid, startTime, commandLine }) => `- PID ${pid}: ${kind}, started ${formatFailClosedProcessStartTime(startTime)}, cmd: ${formatFailClosedCommandLine(commandLine)}`).join(`
`);
  return `${summary}
Blocking process evidence:
${evidence}`;
}
function formatFailClosedBlockingMessage(reason) {
  if (reason.kind === "migration_guard") {
    if (reason.unreadableFile) {
      const arm = reason.unreadableArm ?? "io";
      const recovery = arm === "io" ? `If none of these processes are running, it is safe to delete ${reason.unreadableFile} and retry.` : `The file may be a recent incomplete write; retry after the file is older than the ten-minute grace window, or stop the relevant process before deleting it.`;
      return [
        `Magic Context cannot migrate the shared database because RPC discovery file ${reason.unreadableFile} is uncertain (${arm} arm), so the absence of a live process cannot be proven.`,
        recovery,
        `Recovery: ${FAIL_CLOSED_DOCTOR_COMMAND}`
      ].join(" ");
    }
    return [
      `Magic Context cannot migrate the shared database (one database serves every project on this machine) because ${formatFailClosedBlockingProcesses(reason.blockingProcesses)} may be running an older Magic Context build that would fail against the migrated database.`,
      `The database is at upstream migration v${reason.persistedVersion}; this build needs v${reason.supportedVersion}.`,
      "Restart the blocking process — even one from a different project — and it will pick up the new build and migrate on start; or shut it down and retry.",
      "If that host loads a pinned or cached older Magic Context build, a restart alone is not enough: stop it or update its Magic Context build, then start this host once so it migrates the database with nothing older attached.",
      `Recovery: ${FAIL_CLOSED_DOCTOR_COMMAND}`
    ].join(" ");
  }
  if (reason.kind === "schema_fence") {
    return [
      `Magic Context cannot operate: this Magic Context build is older than the database; upgrade/restart this harness (upstream migration lane v${reason.persistedVersion}, build supports through v${reason.supportedVersion}).`,
      `Recovery: ${FAIL_CLOSED_DOCTOR_COMMAND}`
    ].join(" ");
  }
  const cause = reason.cause.trim().length > 0 ? reason.cause.trim() : "unknown storage error";
  return [
    `Magic Context cannot operate: persistent storage failed (${cause}).`,
    "The plugin will not silently degrade to native compaction while enabled.",
    `Recovery: ${FAIL_CLOSED_DOCTOR_COMMAND}`
  ].join(" ");
}
function createFailClosedBlockingError(reason, options) {
  return new FailClosedBlockingError(formatFailClosedBlockingMessage(reason), reason, options);
}
function isFailClosedBlockingError(error) {
  return error instanceof FailClosedBlockingError || typeof error === "object" && error !== null && error.name === "FailClosedBlockingError" && error.code === "FAIL_CLOSED_BLOCKING";
}
function shouldBypassFailClosedBlock(input) {
  if (input.isPiSubagentEnv === true)
    return true;
  if (input.isInternalChildSession === true)
    return true;
  const agent = typeof input.agent === "string" ? input.agent.trim() : "";
  if (agent.length === 0)
    return false;
  if (OPENCODE_INTERNAL_AGENT_NAMES.has(agent))
    return true;
  if (isMagicContextHiddenAgentName(agent))
    return true;
  return false;
}
function createFailClosedController(options) {
  const reprobeEveryN = Math.max(1, options?.reprobeEveryN ?? FAIL_CLOSED_REPROBE_EVERY_N);
  let reason = null;
  let blockedPassCount = 0;
  return {
    arm(next) {
      reason = next;
      blockedPassCount = 0;
    },
    clear() {
      reason = null;
      blockedPassCount = 0;
    },
    isArmed() {
      return reason !== null;
    },
    getReason() {
      return reason;
    },
    async enforce(input) {
      if (!reason)
        return;
      if (!input.blockingEnabled)
        return;
      if (input.exempt)
        return;
      blockedPassCount += 1;
      const shouldReprobe = typeof input.tryReopen === "function" && (blockedPassCount === 1 || blockedPassCount % reprobeEveryN === 0);
      if (shouldReprobe) {
        try {
          const healed = await input.tryReopen?.();
          if (healed) {
            reason = null;
            blockedPassCount = 0;
            return;
          }
        } catch {}
      }
      const blockedReason = reason;
      if (!blockedReason)
        return;
      throw createFailClosedBlockingError(blockedReason);
    }
  };
}

export { FAIL_CLOSED_DOCTOR_COMMAND, attachFailClosedBlockingProcessEvidence, formatFailClosedBlockingMessage, createFailClosedBlockingError, isFailClosedBlockingError, shouldBypassFailClosedBlock, createFailClosedController };
