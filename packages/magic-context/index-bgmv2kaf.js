// ../plugin/src/shared/harness-provider-map.ts
var CANONICAL_TO_PI_PROVIDER = {
  openai: "openai-codex",
  google: "google-antigravity"
};
var PI_TO_CANONICAL_PROVIDER = {
  "openai-codex": "openai",
  "google-antigravity": "google"
};
var CANONICAL_TO_OMP_PROVIDER = {
  openai: "openai-codex",
  google: "google-antigravity",
  opencode: "opencode-zen"
};
var OMP_TO_CANONICAL_PROVIDER = {
  "openai-codex": "openai",
  "google-antigravity": "google",
  "opencode-zen": "opencode"
};
var CANONICAL_MODEL_IDENTITY_ALIASES = {
  "github-copilot/gpt-6-astra": "openai/gpt-6-astra"
};
function remapProviderPrefix(ref, map) {
  if (typeof ref !== "string")
    return ref;
  const slash = ref.indexOf("/");
  if (slash <= 0)
    return ref;
  const provider = ref.slice(0, slash);
  if (!Object.hasOwn(map, provider))
    return ref;
  return `${map[provider]}${ref.slice(slash)}`;
}
function canonicalModelIdentity(ref) {
  const harnessCanonical = piModelRefToCanonical(ompModelRefToCanonical(ref));
  return CANONICAL_MODEL_IDENTITY_ALIASES[harnessCanonical.toLowerCase()] ?? harnessCanonical;
}
function piModelRefToCanonical(ref) {
  return remapProviderPrefix(ref, PI_TO_CANONICAL_PROVIDER);
}
function resolveModelRefForPi(ref) {
  return remapProviderPrefix(piModelRefToCanonical(ref), CANONICAL_TO_PI_PROVIDER);
}
function modelRefLookupOrder(ref) {
  const canonical = piModelRefToCanonical(ompModelRefToCanonical(ref));
  return [
    ...new Set([
      canonical,
      ref,
      resolveModelRefForPi(canonical),
      resolveModelRefForOmp(canonical)
    ])
  ];
}
function ompModelRefToCanonical(ref) {
  return remapProviderPrefix(ref, OMP_TO_CANONICAL_PROVIDER);
}
function resolveModelRefForOmp(ref) {
  return remapProviderPrefix(ompModelRefToCanonical(ref), CANONICAL_TO_OMP_PROVIDER);
}

// ../plugin/src/shared/historian-tool-template.ts
class Parser {
  source;
  pos = 0;
  constructor(source) {
    this.source = source;
  }
  error() {
    throw new Error(`Invalid tool expansion template at character ${this.pos + 1}`);
  }
  take(value) {
    if (!this.source.startsWith(value, this.pos))
      return false;
    this.pos += value.length;
    return true;
  }
  field() {
    const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(this.source.slice(this.pos));
    if (!match)
      return this.error();
    this.pos += match[0].length;
    return match[0];
  }
  quoted() {
    const start = this.pos;
    if (!this.take('"'))
      return this.error();
    while (this.pos < this.source.length) {
      if (this.take("\\")) {
        this.pos++;
        continue;
      }
      if (this.take('"')) {
        try {
          return JSON.parse(this.source.slice(start, this.pos));
        } catch {
          return this.error();
        }
      }
      this.pos++;
    }
    return this.error();
  }
  integer() {
    const match = /^\d+/.exec(this.source.slice(this.pos));
    if (!match)
      return this.error();
    this.pos += match[0].length;
    const n = Number(match[0]);
    if (!Number.isSafeInteger(n))
      return this.error();
    return n;
  }
  expression(relative) {
    const steps = [];
    if (!(relative && this.take("."))) {
      const root = this.field();
      if (!relative && root !== "input" && root !== "output")
        return this.error();
      steps.push({ field: root });
    }
    while (true) {
      if (this.take("[")) {
        if (this.take("*]."))
          steps.push({ project: this.field() });
        else {
          const index = this.integer();
          if (!this.take("]"))
            return this.error();
          steps.push({ index });
        }
      } else if (this.source[this.pos] === "." && !/^\.(each\(|join\(|count(?:\.|\})|truncate\()/.test(this.source.slice(this.pos))) {
        this.pos++;
        steps.push({ field: this.field() });
        if (this.source[this.pos] === "(")
          return this.error();
      } else
        break;
    }
    const expression = { steps };
    if (this.take(".each(")) {
      if (relative)
        return this.error();
      expression.each = parseTemplate(this.quoted(), true);
      if (!this.take(")"))
        return this.error();
    }
    if (this.take(".join(")) {
      expression.join = this.quoted();
      if (!this.take(")"))
        return this.error();
    }
    if (this.take(".count")) {
      if (expression.each || expression.join !== undefined)
        return this.error();
      expression.count = true;
    }
    if (this.take(".truncate(")) {
      expression.cap = this.integer();
      if (!this.take(")"))
        return this.error();
    }
    if (!this.take("}"))
      return this.error();
    return expression;
  }
  template(relative) {
    const nodes = [];
    while (this.pos < this.source.length) {
      const next = this.source.indexOf("${", this.pos);
      if (next < 0) {
        nodes.push(this.source.slice(this.pos));
        break;
      }
      nodes.push(this.source.slice(this.pos, next));
      this.pos = next + 2;
      nodes.push(this.expression(relative));
    }
    return nodes;
  }
}
function parseTemplate(source, relative = false) {
  return new Parser(source).template(relative);
}
function toolTemplateError(source) {
  try {
    parseTemplate(source);
    return;
  } catch (error) {
    return error.message;
  }
}
var templates = new Map;
function compiled(source) {
  if (!templates.has(source)) {
    try {
      templates.set(source, parseTemplate(source));
    } catch {
      templates.set(source, null);
    }
  }
  return templates.get(source) ?? null;
}
function oneLine(value) {
  return value.replace(/[\r\n\u2028\u2029]+/g, " ");
}
function truncate(value, cap, legacyPreview = false) {
  const chars = Array.from(oneLine(value));
  if (cap === undefined || chars.length <= cap)
    return chars.join("");
  if (legacyPreview)
    return `${chars.slice(0, cap).join("")}…`;
  let end = 0;
  for (let i = 0;i < Math.min(cap, chars.length); i++) {
    if (!".!?。！？".includes(chars[i]))
      continue;
    let next = i + 1;
    while (next < chars.length && `"'”’)]`.includes(chars[next]))
      next++;
    if (next <= cap && ("。！？".includes(chars[i]) || next === chars.length || /[ \t]/.test(chars[next])))
      end = next;
  }
  return `${end ? `${chars.slice(0, end).join("")} ` : ""}[… ${chars.length - end} more characters]`;
}
function scalar(value) {
  if (value === undefined)
    return "";
  return typeof value === "string" ? value : compactJson(value);
}
function compactJson(value) {
  if (Array.isArray(value))
    return `[${value.map((v) => compactJson(v)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${compactJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function field(value, key) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}
function render(nodes, root, legacyPreview) {
  return nodes.map((node) => {
    if (typeof node === "string")
      return node;
    const cap = node.cap ?? (legacyPreview ? 300 : undefined);
    let value = root;
    let list = false;
    for (const step of node.steps) {
      if ("field" in step)
        value = list && Array.isArray(value) ? value.map((item) => field(item, step.field)) : field(value, step.field);
      else if ("index" in step)
        value = Array.isArray(value) ? value[step.index] : undefined;
      else {
        value = Array.isArray(value) ? value.map((item) => field(item, step.project)) : undefined;
        list = true;
      }
    }
    if (node.count)
      return truncate(Array.isArray(value) ? String(value.length) : "", cap, legacyPreview);
    if (node.each || list || node.join !== undefined) {
      if (!Array.isArray(value))
        return "";
      const elements = value.slice(0, legacyPreview ? 10 : undefined).map((item) => truncate(node.each ? render(node.each, item, legacyPreview) : scalar(item), legacyPreview ? 300 : undefined, legacyPreview));
      if (legacyPreview && value.length > 10)
        elements.push(`… +${value.length - 10} more`);
      return truncate(elements.join(node.join ?? (node.each ? "; " : ", ")), cap, legacyPreview);
    }
    return truncate(scalar(value), cap, legacyPreview);
  }).join("");
}
function renderToolTemplate(source, input, output, legacyPreview = false) {
  const nodes = compiled(source);
  if (!nodes)
    return null;
  const text = typeof output === "string" ? output : output === undefined ? "" : compactJson(output);
  let structured = output;
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output);
      structured = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
    } catch {
      structured = undefined;
    }
  }
  const root = { input, output: structured };
  const bareOutputNodes = nodes.map((node) => typeof node !== "string" && node.steps.length === 1 && ("field" in node.steps[0]) && node.steps[0].field === "output" && !node.each && !node.count && node.join === undefined ? truncate(text ?? "", node.cap ?? (legacyPreview ? 300 : undefined), legacyPreview) : node);
  return truncate(render(bareOutputNodes, root, legacyPreview), legacyPreview ? 1000 : undefined, legacyPreview);
}

export { canonicalModelIdentity, piModelRefToCanonical, resolveModelRefForPi, modelRefLookupOrder, ompModelRefToCanonical, resolveModelRefForOmp, toolTemplateError, renderToolTemplate };
