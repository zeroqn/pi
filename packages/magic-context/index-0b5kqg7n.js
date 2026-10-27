import {
  parseTree
} from "./index-4knyh1kt.js";

// ../plugin/src/agents/permissions.ts
var DREAMER_PRIMER_INVESTIGATOR_ALLOWED_TOOLS = [
  "read",
  "grep",
  "glob",
  "aft_outline",
  "aft_zoom",
  "aft_search",
  "ctx_search"
];

// ../plugin/src/shared/historian-cache.ts
function withoutHistorianTailCache(body) {
  const value = JSON.parse(body);
  if (!value || typeof value.model !== "string" || typeof value.max_tokens !== "number" || !Array.isArray(value.system) || value.system.length === 0 || !value.system.every((part) => part?.type === "text" && typeof part.text === "string") || !value.system.some((part) => part.cache_control) || !Array.isArray(value.messages) || value.cache_control !== undefined)
    return body;
  const root = parseTree(body);
  const property = (node, key) => node?.children?.find((child) => child.children?.[0]?.value === key)?.children?.[1];
  const removals = [];
  for (const message of property(root, "messages")?.children ?? []) {
    for (const block of property(message, "content")?.children ?? []) {
      if (block.type !== "object")
        continue;
      const fields = block.children ?? [];
      fields.forEach((field, index) => {
        if (field.children?.[0]?.value !== "cache_control")
          return;
        const next = fields[index + 1];
        const previous = fields[index - 1];
        removals.push(next ? [field.offset, next.offset] : [
          previous ? previous.offset + previous.length : field.offset,
          field.offset + field.length
        ]);
      });
    }
  }
  for (const [start, end] of removals.sort((a, b) => b[0] - a[0])) {
    body = body.slice(0, start) + body.slice(end);
  }
  return body;
}

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

// src/historian-calibration-extension.ts
import { readFileSync as readFileSync2 } from "node:fs";

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

// src/subagent-telemetry.ts
import { createHash } from "node:crypto";
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

// src/subagent-tool-boundary.ts
var SUBAGENT_TOOL_ALLOWLIST_FLAG = "magic-context-tool-allowlist";
var OMP_CHILD_TOOL_CONFIG = `tools:
  xdev: false
plan:
  enabled: false
  defaultOnStartup: false
`;
function registerSubagentToolBoundary(pi) {
  pi.registerFlag(SUBAGENT_TOOL_ALLOWLIST_FLAG, {
    description: "Exact active tool names for a Magic Context hidden child.",
    type: "string"
  });
  pi.on("session_start", async () => {
    const value = pi.getFlag(SUBAGENT_TOOL_ALLOWLIST_FLAG);
    if (value === undefined)
      return;
    try {
      const names = typeof value === "string" ? JSON.parse(value) : null;
      if (!Array.isArray(names) || !names.every((name) => typeof name === "string")) {
        throw new Error("Invalid Magic Context child tool allowlist");
      }
      await pi.setActiveTools(names);
      const allowed = new Set(names);
      if (pi.getActiveTools().some((name) => !allowed.has(name))) {
        throw new Error("Host activated tools outside the Magic Context child allowlist");
      }
    } catch (error) {
      process.stderr.write(`Magic Context child tool restriction failed: ${String(error)}
`);
      process.exit(1);
    }
  });
}

// src/historian-calibration-extension.ts
var HISTORIAN_TEMPERATURE_ENV2 = "MAGIC_CONTEXT_HISTORIAN_TEMPERATURE";
var HISTORIAN_CACHE_TAIL_ENV2 = "MAGIC_CONTEXT_HISTORIAN_CACHE_TAIL";
var HISTORIAN_MAX_OUTPUT_TOKENS_ENV2 = "MAGIC_CONTEXT_HISTORIAN_MAX_OUTPUT_TOKENS";
var SUBAGENT_OUTPUT_CEILING_ENV2 = "MAGIC_CONTEXT_SUBAGENT_OUTPUT_CEILING";
function finiteNumber(value) {
  if (value === undefined || value.trim().length === 0)
    return;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
function calibrateHistorianProviderPayload2(payload, temperature, maxOutputTokens) {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    return payload;
  if (temperature === undefined && maxOutputTokens === undefined)
    return payload;
  const calibrated = { ...payload };
  const generationConfig = calibrated.generationConfig;
  if (typeof generationConfig === "object" && generationConfig !== null && !Array.isArray(generationConfig)) {
    calibrated.generationConfig = {
      ...generationConfig,
      ...temperature !== undefined ? { temperature } : {},
      ...maxOutputTokens !== undefined ? { maxOutputTokens } : {}
    };
    return calibrated;
  }
  const inferenceConfig = calibrated.inferenceConfig;
  if (typeof inferenceConfig === "object" && inferenceConfig !== null && !Array.isArray(inferenceConfig)) {
    calibrated.inferenceConfig = {
      ...inferenceConfig,
      ...temperature !== undefined ? { temperature } : {},
      ...maxOutputTokens !== undefined ? { maxTokens: maxOutputTokens } : {}
    };
    return calibrated;
  }
  if (temperature !== undefined) {
    calibrated.temperature = temperature;
  }
  if (maxOutputTokens !== undefined) {
    if ("max_output_tokens" in calibrated) {
      calibrated.max_output_tokens = maxOutputTokens;
    } else if ("max_completion_tokens" in calibrated) {
      calibrated.max_completion_tokens = maxOutputTokens;
    } else if ("max_tokens" in calibrated) {
      calibrated.max_tokens = maxOutputTokens;
    } else if ("maxTokens" in calibrated) {
      calibrated.maxTokens = maxOutputTokens;
    }
  }
  return calibrated;
}
function ceilProviderOutputTokens2(payload, ceiling) {
  if (ceiling === undefined)
    return payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    return payload;
  const lowered = (options, keys) => {
    const next = { ...options };
    for (const key of keys) {
      const value = next[key];
      if (typeof value === "number" && value > ceiling)
        next[key] = ceiling;
    }
    return next;
  };
  const record = payload;
  const nested = (key) => {
    const value = record[key];
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
  };
  const generationConfig = nested("generationConfig");
  if (generationConfig)
    return {
      ...record,
      generationConfig: lowered(generationConfig, ["maxOutputTokens"])
    };
  const inferenceConfig = nested("inferenceConfig");
  if (inferenceConfig)
    return {
      ...record,
      inferenceConfig: lowered(inferenceConfig, ["maxTokens"])
    };
  const capped = lowered(record, [
    "max_output_tokens",
    "max_completion_tokens",
    "max_tokens",
    "maxTokens"
  ]);
  const thinking = nested("thinking");
  if (thinking && typeof capped.max_tokens === "number" && typeof thinking.budget_tokens === "number" && thinking.budget_tokens >= capped.max_tokens) {
    capped.thinking = {
      ...thinking,
      budget_tokens: Math.max(1024, capped.max_tokens - 1024)
    };
  }
  return capped;
}
function withoutProviderTemperature2(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return payload;
  const clean = { ...payload };
  delete clean.temperature;
  for (const key of ["generationConfig", "inferenceConfig"]) {
    const nested = clean[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const options = { ...nested };
      delete options.temperature;
      clean[key] = options;
    }
  }
  return clean;
}
function historianCalibrationExtension(pi) {
  registerSubagentToolBoundary(pi);
  if (process.env[HISTORIAN_CACHE_TAIL_ENV2] === "skip") {
    let requests = 0;
    let warned = false;
    pi.on("before_provider_request", (event) => {
      if (requests++ > 0)
        return;
      try {
        const original = JSON.stringify(event.payload);
        const body = withoutHistorianTailCache(original);
        return body === original ? undefined : JSON.parse(body);
      } catch (error) {
        if (!warned) {
          warned = true;
          try {
            process.stderr.write(`Historian cache optimization skipped: ${String(error)}
`);
          } catch {}
        }
        return;
      }
    });
  }
  const intendedPath = process.env.MAGIC_CONTEXT_SUBAGENT_PROMPT_FILE;
  if (intendedPath) {
    const intended = readFileSync2(intendedPath, "utf8");
    pi.on("context", (_event, ctx) => {
      const effective = readHostSystemPrompt(ctx);
      if (effective === undefined)
        return;
      process.stdout.write(`${JSON.stringify({ type: "mc_system_prompt", ...promptFingerprint(effective), containsIntended: effective.includes(intended) })}
`);
    });
  }
  const provenanceOnly = process.env.MAGIC_CONTEXT_SUBAGENT_PROVENANCE_ONLY === "1";
  const maxOutputTokens = finiteNumber(process.env[HISTORIAN_MAX_OUTPUT_TOKENS_ENV2]);
  const outputCeiling = finiteNumber(process.env[SUBAGENT_OUTPUT_CEILING_ENV2]);
  if (provenanceOnly) {
    if (maxOutputTokens === undefined && outputCeiling === undefined)
      return;
    pi.on("before_provider_request", (event) => ceilProviderOutputTokens2(calibrateHistorianProviderPayload2(event.payload, undefined, maxOutputTokens), outputCeiling));
    return;
  }
  const temperature = finiteNumber(process.env[HISTORIAN_TEMPERATURE_ENV2]);
  if (temperature === undefined && maxOutputTokens === undefined) {
    if (outputCeiling === undefined)
      return;
    pi.on("before_provider_request", (event) => ceilProviderOutputTokens2(event.payload, outputCeiling));
    return;
  }
  pi.on("before_provider_request", (event, ctx) => {
    const model = ctx.model;
    const key = `${model?.provider ?? "unknown"}/${model?.id ?? "unknown"}`;
    const sampling = subagentTemperature(key, model, temperature, (_message, decision) => {
      process.stdout.write(`${JSON.stringify({ type: "mc_temperature", model: key, supported: decision.supported ?? null, source: decision.source, ...decision.entry ? { entry: decision.entry } : {} })}
`);
    });
    return ceilProviderOutputTokens2(calibrateHistorianProviderPayload2(sampling === undefined ? withoutProviderTemperature2(event.payload) : event.payload, sampling, maxOutputTokens), outputCeiling);
  });
}

export { DREAMER_PRIMER_INVESTIGATOR_ALLOWED_TOOLS, buildHiddenAgentRegistrations, logTemperatureDecision, readHostSystemPrompt, subagentStepCap, SubagentTelemetry, OMP_CHILD_TOOL_CONFIG, HISTORIAN_TEMPERATURE_ENV2, HISTORIAN_CACHE_TAIL_ENV2, HISTORIAN_MAX_OUTPUT_TOKENS_ENV2, SUBAGENT_OUTPUT_CEILING_ENV2, calibrateHistorianProviderPayload2, ceilProviderOutputTokens2, withoutProviderTemperature2, historianCalibrationExtension };
