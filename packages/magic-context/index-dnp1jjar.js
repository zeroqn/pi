// ../plugin/src/shared/redaction.ts
import { homedir, userInfo } from "node:os";
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
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
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

export { sanitizeDiagnosticText, hasShareabilitySensitiveText, sanitizeConfigValue };
