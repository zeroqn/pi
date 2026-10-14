// ../plugin/src/shared/models-dev-temperature.ts
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
var CATALOG_PROVIDER_ALIASES = {
  "google-antigravity": "google",
  "opencode-zen": "opencode"
};
var ANTIGRAVITY_MODEL_PREFIX = "antigravity-";
var cached;
function modelsDevCatalogPath(env = process.env) {
  if (env.OPENCODE_MODELS_PATH)
    return env.OPENCODE_MODELS_PATH;
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "opencode", "models.json");
}
function buildIndex(raw) {
  const index = new Map;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    return index;
  for (const [providerID, provider] of Object.entries(raw)) {
    const models = provider?.models;
    if (!models || typeof models !== "object")
      continue;
    for (const [modelID, model] of Object.entries(models)) {
      const temperature = model?.temperature;
      if (typeof temperature === "boolean")
        index.set(`${providerID}/${modelID}`, temperature);
    }
  }
  return index;
}
function loadIndex() {
  const path = modelsDevCatalogPath();
  try {
    const stat = statSync(path);
    if (cached?.path === path && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size)
      return cached.index;
    const index = buildIndex(JSON.parse(readFileSync(path, "utf8")));
    cached = { path, mtimeMs: stat.mtimeMs, size: stat.size, index };
    return index;
  } catch {
    return;
  }
}
function catalogCandidates(providerID, modelID) {
  const provider = Object.hasOwn(CATALOG_PROVIDER_ALIASES, providerID) ? CATALOG_PROVIDER_ALIASES[providerID] : providerID;
  const candidates = [`${provider}/${modelID}`];
  if (provider === "google" && modelID.startsWith(ANTIGRAVITY_MODEL_PREFIX))
    candidates.push(`google/${modelID.slice(ANTIGRAVITY_MODEL_PREFIX.length)}`);
  return candidates;
}
function catalogTemperature(model) {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1)
    return;
  const index = loadIndex();
  if (!index)
    return;
  for (const entry of catalogCandidates(model.slice(0, slash), model.slice(slash + 1))) {
    const temperature = index.get(entry);
    if (temperature !== undefined)
      return { temperature, entry };
  }
  return;
}

// ../plugin/src/shared/subagent-temperature.ts
var loggedDecisions = new Set;
function temperatureCapability(metadata) {
  if (!metadata || typeof metadata !== "object")
    return;
  const model = metadata;
  const supported = model.capabilities?.temperature ?? model.temperature ?? model.compat?.supportsTemperature ?? model.compat?.supportsSamplingParams;
  return typeof supported === "boolean" ? supported : undefined;
}
function resolveTemperatureCapability(model, metadata) {
  const host = temperatureCapability(metadata);
  if (host !== undefined)
    return { supported: host, source: "host" };
  const catalog = catalogTemperature(model);
  if (catalog)
    return { supported: catalog.temperature, source: "catalog", entry: catalog.entry };
  return { supported: undefined, source: "none" };
}
function describeTemperatureDecision(model, decision) {
  const verdict = decision.supported === true ? "sent" : "omitted";
  const answer = decision.supported === true ? "yes" : "no";
  const reason = decision.source === "host" ? `host model metadata says ${answer}` : decision.source === "catalog" ? `models.dev cache entry ${decision.entry ?? "unknown"} says ${answer}` : "no host or models.dev metadata";
  return `Subagent temperature ${verdict} for ${model}: ${reason}`;
}
function logTemperatureDecision(model, decision, log) {
  const key = `${model}\x00${decision.source}\x00${decision.supported}\x00${decision.entry ?? ""}`;
  if (loggedDecisions.has(key))
    return;
  loggedDecisions.add(key);
  log(describeTemperatureDecision(model, decision), decision);
}
function subagentTemperature(model, metadata, temperature, log) {
  if (temperature === undefined)
    return;
  const decision = resolveTemperatureCapability(model, metadata);
  logTemperatureDecision(model, decision, log);
  return decision.supported === true ? temperature : undefined;
}

// src/subagent-telemetry.ts
import { createHash } from "node:crypto";

// ../plugin/src/agents/hidden-agent-registrations.ts
var HIDDEN_AGENT_DESCRIPTION = "Internal Magic Context maintenance agent. Not for general tasks — do not select for user work.";
function buildHiddenAgentRegistrations(args) {
  return [
    {
      id: "dreamer",
      mode: "primary",
      hidden: true,
      description: HIDDEN_AGENT_DESCRIPTION,
      prompt: args.dreamerPrompt,
      allowedTools: ["ctx_memory"],
      maxSteps: 150,
      overrides: args.dreamerOverrides,
      lockPermissions: true
    },
    {
      id: "dreamer-docs",
      mode: "primary",
      hidden: true,
      description: HIDDEN_AGENT_DESCRIPTION,
      prompt: args.dreamerPrompt,
      allowedTools: ["read", "grep", "glob", "aft_outline", "aft_zoom", "aft_search"],
      maxSteps: 60,
      overrides: args.dreamerOverrides,
      lockPermissions: true
    },
    {
      id: "dreamer-reviewer",
      mode: "primary",
      hidden: true,
      description: HIDDEN_AGENT_DESCRIPTION,
      prompt: args.dreamerPrompt,
      allowedTools: [],
      maxSteps: 4,
      overrides: args.dreamerOverrides,
      lockPermissions: true
    },
    {
      id: "dreamer-retrospective",
      mode: "primary",
      hidden: true,
      description: HIDDEN_AGENT_DESCRIPTION,
      prompt: args.dreamerPrompt,
      allowedTools: ["ctx_search"],
      maxSteps: 40,
      overrides: args.dreamerOverrides,
      lockPermissions: true
    },
    {
      id: "dreamer-primer-investigator",
      mode: "primary",
      hidden: true,
      description: HIDDEN_AGENT_DESCRIPTION,
      prompt: args.dreamerPrompt,
      allowedTools: [
        "read",
        "grep",
        "glob",
        "aft_outline",
        "aft_zoom",
        "aft_search",
        "ctx_search"
      ],
      maxSteps: 40,
      overrides: args.dreamerOverrides,
      lockPermissions: true
    },
    {
      id: "dreamer-memory-mapper",
      mode: "primary",
      hidden: true,
      description: HIDDEN_AGENT_DESCRIPTION,
      prompt: args.dreamerPrompt,
      allowedTools: ["read", "grep", "glob", "aft_outline", "aft_zoom", "aft_search"],
      maxSteps: 60,
      overrides: args.dreamerOverrides,
      lockPermissions: true
    },
    {
      id: "dreamer-classifier",
      mode: "primary",
      hidden: true,
      description: HIDDEN_AGENT_DESCRIPTION,
      prompt: args.dreamerPrompt,
      allowedTools: [],
      maxSteps: 4,
      overrides: args.dreamerOverrides,
      lockPermissions: true
    },
    {
      id: "smart-note-compiler",
      mode: "primary",
      hidden: true,
      description: HIDDEN_AGENT_DESCRIPTION,
      prompt: args.smartNoteCompilerPrompt,
      allowedTools: [],
      maxSteps: 8,
      overrides: args.dreamerOverrides,
      lockPermissions: true
    },
    {
      id: "historian",
      mode: "primary",
      hidden: true,
      description: HIDDEN_AGENT_DESCRIPTION,
      prompt: args.historianPrompt,
      allowedTools: [],
      maxSteps: 4,
      overrides: args.historianOverrides,
      lockPermissions: true
    },
    {
      id: "historian-recomp",
      mode: "primary",
      hidden: true,
      description: HIDDEN_AGENT_DESCRIPTION,
      prompt: args.historianRecompPrompt ?? args.historianPrompt,
      allowedTools: [],
      maxSteps: 4,
      overrides: args.historianOverrides,
      lockPermissions: true
    },
    {
      id: "historian-editor",
      mode: "primary",
      hidden: true,
      description: HIDDEN_AGENT_DESCRIPTION,
      prompt: args.historianEditorPrompt,
      allowedTools: [],
      maxSteps: 4,
      overrides: args.historianOverrides,
      lockPermissions: true
    }
  ];
}

// src/subagent-telemetry.ts
var stepCaps = new Map(buildHiddenAgentRegistrations({
  dreamerPrompt: undefined,
  historianPrompt: undefined,
  historianEditorPrompt: undefined,
  historianDisallowed: []
}).map(({ id, maxSteps }) => [id, maxSteps]));
function subagentStepCap(agent) {
  return stepCaps.get(agent.replace(/^magic-context-/, ""));
}
function promptFingerprint(prompt) {
  return {
    bytes: Buffer.byteLength(prompt, "utf8"),
    sha256: createHash("sha256").update(prompt).digest("hex")
  };
}
function record(value) {
  return value !== null && typeof value === "object" ? value : {};
}

class SubagentTelemetry {
  log;
  steps = 0;
  intended;
  effective = null;
  tools = Object.create(null);
  promptTokens = {
    first: null,
    last: null,
    max: null
  };
  warned = false;
  streamedSteps = 0;
  terminalSeen = false;
  results = new Set;
  constructor(prompt, log) {
    this.log = log;
    this.intended = promptFingerprint(prompt);
  }
  observe(value) {
    const event = record(value);
    if (event.type === "mc_system_prompt" && typeof event.bytes === "number" && typeof event.sha256 === "string" && /^[a-f0-9]{64}$/.test(event.sha256)) {
      this.effective = { bytes: event.bytes, sha256: event.sha256 };
      if (!this.warned && event.sha256 !== this.intended.sha256) {
        this.warned = true;
        this.log(`subagent_system_prompt_${event.containsIntended === true ? "extended" : "replaced"} ${JSON.stringify({ intended: this.intended, effective: this.effective, extension: null })}`);
      }
    }
    if (event.type === "message_end") {
      if (record(event.message).role === "assistant") {
        this.streamedSteps++;
        this.assistant(event.message);
      }
    }
    if (event.type === "agent_end" && Array.isArray(event.messages) && !this.terminalSeen) {
      this.terminalSeen = true;
      const assistants = event.messages.filter((message) => record(message).role === "assistant");
      for (const message of assistants.slice(this.streamedSteps))
        this.assistant(message);
    }
    if (event.type === "tool_execution_end" && typeof event.toolCallId === "string" && typeof event.toolName === "string" && !this.results.has(event.toolCallId)) {
      this.results.add(event.toolCallId);
      const tool = this.tool(event.toolName);
      const content = record(event.result).content;
      if (Array.isArray(content))
        for (const part of content) {
          const block = record(part);
          const text = typeof block.text === "string" ? block.text : typeof block.data === "string" ? block.data : "";
          tool.outputBytes += Buffer.byteLength(text, "utf8");
        }
    }
  }
  tool(name) {
    this.tools[name] ??= { calls: 0, outputBytes: 0 };
    return this.tools[name];
  }
  assistant(value) {
    const message = record(value);
    this.steps++;
    const usage = record(message.usage);
    const fields = [usage.input, usage.cacheRead, usage.cacheWrite];
    const known = fields.some((value) => typeof value === "number" && Number.isFinite(value));
    const tokens = known ? fields.reduce((sum, value) => sum + (typeof value === "number" && Number.isFinite(value) ? value : 0), 0) : null;
    if (this.steps === 1)
      this.promptTokens.first = tokens;
    this.promptTokens.last = tokens;
    if (tokens !== null)
      this.promptTokens.max = Math.max(this.promptTokens.max ?? 0, tokens);
    if (Array.isArray(message.content))
      for (const part of message.content) {
        const call = record(part);
        if (call.type === "toolCall" && typeof call.name === "string")
          this.tool(call.name).calls++;
      }
  }
  finish(agent, outcome, cap) {
    this.log(`subagent_telemetry ${JSON.stringify({ agent, outcome, cap, steps: this.steps, tools: this.tools, promptTokens: this.promptTokens, intended: this.intended, effective: this.effective, provenanceSource: this.effective ? "pi_context_system_prompt" : "unavailable" })}`);
  }
}

// src/host-system-prompt.ts
function readHostSystemPrompt(ctx) {
  if (typeof ctx.getSystemPrompt !== "function")
    return;
  const raw = ctx.getSystemPrompt();
  if (typeof raw === "string")
    return raw;
  if (Array.isArray(raw) && raw.every((part) => typeof part === "string")) {
    return raw.join(`

`);
  }
  return;
}

export { buildHiddenAgentRegistrations, logTemperatureDecision, subagentTemperature, subagentStepCap, promptFingerprint, SubagentTelemetry, readHostSystemPrompt };
