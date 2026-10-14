import {
  modelRefLookupOrder,
  toolTemplateError
} from "./index-bgmv2kaf.js";
import {
  getSynapseLaneIdentity
} from "./index-xkf1qyj1.js";
import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  getMagicContextStorageDir,
  importPluginModule,
  log2
} from "./index-x3dcnxh0.js";
import {
  computeNormalizedHash
} from "./index-9x1f96r8.js";
import {
  shouldEnforcePrivateStoragePermissions,
  ensureStorageDirectorySync,
  writeStorageFileAsync,
  writeStorageFileHandleAsync,
  createStorageFileHandleAsync
} from "./index-vf38qhee.js";
import {
  DEFAULT_PROTECTED_TOOLS,
  mergeProtectedTools
} from "./index-674f6qs2.js";

// ../plugin/src/config/schema/magic-context.ts
import { homedir } from "node:os";

// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/core.js
var _a;
function $constructor(name, initializer, params) {
  function init(inst, def) {
    if (!inst._zod) {
      Object.defineProperty(inst, "_zod", {
        value: {
          def,
          constr: _,
          traits: new Set
        },
        enumerable: false
      });
    }
    if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer(inst, def);
    const proto = _.prototype;
    const keys = Object.keys(proto);
    for (let i = 0;i < keys.length; i++) {
      const k = keys[i];
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;

  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a;
    const inst = params?.Parent ? new Definition : this;
    init(inst, def);
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = Symbol("zod_brand");

class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}

class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array, separator = "|") {
  return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set = false;
  return {
    get value() {
      if (!set) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === undefined;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object, key, getter) {
  let value = undefined;
  Object.defineProperty(object, key, {
    get() {
      if (value === EVALUATING) {
        return;
      }
      if (value === undefined) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object, key, {
        value: v
      });
    },
    configurable: true
  });
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === undefined)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== undefined) {
    if (params?.error !== undefined)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = {};
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        newShape[key] = currDef.shape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = { ...schema._zod.def.shape };
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        delete newShape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = schema._zod.def.shape;
    for (const key in shape) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== undefined) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function merge(a, b) {
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const def = mergeDefs(a._zod.def, {
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class, schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".partial() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in oldShape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      } else {
        for (const key in oldShape) {
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    },
    checks: []
  });
  return clone(schema, def);
}
function required(Class, schema, mask) {
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in shape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      } else {
        for (const key in oldShape) {
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    }
  });
  return clone(schema, def);
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
  const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
  rest.path ?? (rest.path = []);
  rest.message = message;
  if (ctx?.reportInput) {
    rest.input = _input;
  }
  return rest;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}

// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue) => issue.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error, path = []) => {
    for (const issue of error.issues) {
      if (issue.code === "invalid_union" && issue.errors.length) {
        issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
      } else if (issue.code === "invalid_key") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else if (issue.code === "invalid_element") {
        processError({ issues: issue.issues }, [...path, ...issue.path]);
      } else {
        const fullpath = [...path, ...issue.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parse(_Err)(schema, value, ctx);
};
var _decode = (_Err) => (schema, value, _ctx) => {
  return _parse(_Err)(schema, value, _ctx);
};
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parseAsync(_Err)(schema, value, ctx);
};
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _parseAsync(_Err)(schema, value, _ctx);
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const timeRegex = `${time}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst) => {
    var _a;
    (_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = new Set);
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a = inst._zod).check ?? (_a.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst) => {
    const bag = inst._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/doc.js
class Doc {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split(`
`).filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join(`
`));
  }
}

// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 4,
  patch: 3
};

// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError;
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary) => {
            return handleCanaryResult(canary, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return result.then((result) => runChecks(result, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  defineLazy(inst, "~standard", () => ({
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_) {}
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === undefined)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      if (!def.normalize && def.protocol?.source === httpProtocol.source) {
        if (!/^https?:\/\//i.test(trimmed)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid URL format",
            input: payload.value,
            inst,
            continue: !def.abort
          });
          return;
        }
      }
      const url = new URL(trimmed);
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: def.hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.normalize) {
        payload.value = url.href;
      } else {
        payload.value = trimmed;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv4`;
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv6`;
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const parts = payload.value.split("/");
    try {
      if (parts.length !== 2)
        throw new Error;
      const [address, prefix] = parts;
      if (!prefix)
        throw new Error;
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix)
        throw new Error;
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error;
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64";
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64url";
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : undefined : undefined;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0;i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result) => handleArrayResult(result, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
  const isPresent = key in input;
  if (result.issues.length) {
    if (isOptionalIn && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && !isOptionalIn) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: undefined,
        path: [key]
      });
    }
    return;
  }
  if (result.value === undefined) {
    if (isPresent) {
      final.value[key] = undefined;
    }
  } else {
    final.value[key] = result.value;
  }
}
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  for (const k of keys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    keys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const isOptionalIn = _catchall.optin === "optional";
  const isOptionalOut = _catchall.optout === "optional";
  for (const key in input) {
    if (key === "__proto__")
      continue;
    if (keySet.has(key))
      continue;
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
    } else {
      handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  if (!desc?.get) {
    const sh = def.shape;
    Object.defineProperty(def, "shape", {
      get: () => {
        const newSh = { ...sh };
        Object.defineProperty(def, "shape", {
          value: newSh
        });
        return newSh;
      }
    });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = new Set);
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = {};
    const proms = [];
    const shape = value.shape;
    for (const key of value.keys) {
      const el = shape[key];
      const isOptionalIn = el._zod.optin === "optional";
      const isOptionalOut = el._zod.optout === "optional";
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
      } else {
        handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {};`);
    for (const key of normalized.keys) {
      const id = ids[key];
      const k = esc(key);
      const schema = shape[key];
      const isOptionalIn = schema?._zod?.optin === "optional";
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(key)};`);
      if (isOptionalIn && isOptionalOut) {
        doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results) => {
      return handleUnionResults(results, payload, inst, ctx);
    });
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left, right]) => {
        return handleIntersectionResults(payload, left, right);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = new Map;
  let unrecIssue;
  for (const iss of left.issues) {
    if (iss.code === "unrecognized_keys") {
      unrecIssue ?? (unrecIssue = iss);
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).l = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  for (const iss of right.issues) {
    if (iss.code === "unrecognized_keys") {
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).r = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length && unrecIssue) {
    result.issues.push({ ...unrecIssue, keys: bothKeys });
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ` + `${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values) {
      payload.value = {};
      const recordKeys = new Set;
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result) => {
              if (result.issues.length) {
                payload.issues.push(...prefixIssues(key, result.issues));
              }
              payload.value[outKey] = result.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          unrecognized = unrecognized ?? [];
          unrecognized.push(key);
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized
        });
      }
    } else {
      payload.value = {};
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result) => {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[keyResult.value] = result.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[keyResult.value] = result.value;
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  if (def.values.length === 0) {
    throw new Error("Cannot create literal schema with no valid values");
  }
  const values = new Set(def.values);
  inst._zod.values = values;
  inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output) => {
        payload.value = output;
        payload.fallback = true;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError;
    }
    payload.value = _out;
    payload.fallback = true;
    return payload;
  };
});
function handleOptionalResult(result, input) {
  if (input === undefined && (result.issues.length || result.fallback)) {
    return { issues: [], value: undefined };
  }
  return result;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, undefined]) : undefined;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      const input = payload.value;
      const result = def.innerType._zod.run(payload, ctx);
      if (result instanceof Promise)
        return result.then((r) => handleOptionalResult(r, input));
      return handleOptionalResult(result, input);
    }
    if (payload.value === undefined) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : undefined;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleDefaultResult(result, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === undefined) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== undefined)) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => handleNonOptionalResult(result, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === undefined) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result) => {
        payload.value = result.value;
        if (result.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
          payload.fallback = true;
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
      payload.fallback = true;
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right) => handlePipeResult(right, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left) => handlePipeResult(left, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues, fallback: left.fallback }, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
  defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r) => handleRefineResult(r, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      path: [...inst._zod.def.path ?? []],
      continue: !inst._zod.def.abort
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/locales/en.js
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    nan: "NaN"
  };
  return (issue) => {
    switch (issue.code) {
      case "invalid_type": {
        const expected = TypeDictionary[issue.expected] ?? issue.expected;
        const receivedType = parsedType(issue.input);
        const received = TypeDictionary[receivedType] ?? receivedType;
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue.values, "|")}`;
      case "too_big": {
        const adj = issue.inclusive ? "<=" : "<";
        const sizing = getSizing(issue.origin);
        if (sizing)
          return `Too big: expected ${issue.origin ?? "value"} to have ${adj}${issue.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue.origin ?? "value"} to be ${adj}${issue.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue.inclusive ? ">=" : ">";
        const sizing = getSizing(issue.origin);
        if (sizing) {
          return `Too small: expected ${issue.origin} to have ${adj}${issue.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue.origin} to be ${adj}${issue.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue.keys.length > 1 ? "s" : ""}: ${joinValues(issue.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue.origin}`;
      case "invalid_union":
        if (issue.options && Array.isArray(issue.options) && issue.options.length > 0) {
          const opts = issue.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error()
  };
}
// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/registries.js
var _a2;
var $output = Symbol("ZodOutput");
var $input = Symbol("ZodInput");

class $ZodRegistry {
  constructor() {
    this._map = new WeakMap;
    this._idmap = new Map;
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = new WeakMap;
    this._idmap = new Map;
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : undefined;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry;
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/api.js
function _string(Class, params) {
  return new Class({
    type: "string",
    ...normalizeParams(params)
  });
}
function _email(Class, params) {
  return new Class({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class, params) {
  return new Class({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class, params) {
  return new Class({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class, params) {
  return new Class({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class, params) {
  return new Class({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class, params) {
  return new Class({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class, params) {
  return new Class({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class, params) {
  return new Class({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class, params) {
  return new Class({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class, params) {
  return new Class({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class, params) {
  return new Class({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class, params) {
  return new Class({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class, params) {
  return new Class({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class, params) {
  return new Class({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class, params) {
  return new Class({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class, params) {
  return new Class({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class, params) {
  return new Class({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class, params) {
  return new Class({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class, params) {
  return new Class({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class, params) {
  return new Class({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class, params) {
  return new Class({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class, params) {
  return new Class({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class, params) {
  return new Class({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
function _int(Class, params) {
  return new Class({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class, params) {
  return new Class({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _unknown(Class) {
  return new Class({
    type: "unknown"
  });
}
function _never(Class, params) {
  return new Class({
    type: "never",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _slugify() {
  return _overwrite((input) => slugify(input));
}
function _array(Class, element, params) {
  return new Class({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _refine(Class, fn, _params) {
  const schema = new Class({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
function _superRefine(fn, params) {
  const ch = _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {}),
    io: params?.io ?? "output",
    counter: 0,
    seen: new Map,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    external: params?.external ?? undefined
  };
}
function process2(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: undefined, path: _params.path };
  ctx.seen.set(schema, result);
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      process2(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema);
  if (meta)
    Object.assign(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a = result.schema).default ?? (_a.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const idToSchema = new Map;
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id) => id);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}` };
    }
    if (entry[1] === root) {
      return { ref: "#" };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + defId };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema = seen.schema;
    for (const key in schema) {
      delete schema[key];
    }
    schema.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error("Cycle detected: " + `#/${seen.cycle?.join("/")}/<root>` + '\n\nSet the `cycles` parameter to `"ref"` to resolve cyclical schemas with defs.');
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
        continue;
      }
    }
  }
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema = seen.def ?? seen.schema;
    const _cached = { ...schema };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema.allOf = schema.allOf ?? [];
        schema.allOf.push(refSchema);
      } else {
        Object.assign(schema, refSchema);
      }
      Object.assign(schema, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema,
      path: seen.path ?? []
    });
  };
  for (const entry of [...ctx.seen.entries()].reverse()) {
    flattenRef(entry[0]);
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {}
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  Object.assign(result, root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== undefined && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (seen.def && seen.defId) {
      if (seen.def.id === seen.defId)
        delete seen.def.id;
      defs[seen.defId] = seen.def;
    }
  }
  if (ctx.external) {} else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: new Set };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
};
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time") {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const regexes = [...patterns];
    if (regexes.length === 1)
      json.pattern = regexes[0].source;
    else if (regexes.length > 1) {
      json.allOf = [
        ...regexes.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
  if (typeof format === "string" && format.includes("int"))
    json.type = "integer";
  else
    json.type = "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (typeof multipleOf === "number")
    json.multipleOf = multipleOf;
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var literalProcessor = (schema, ctx, json, _params) => {
  const def = schema._zod.def;
  const vals = [];
  for (const val of def.values) {
    if (val === undefined) {
      if (ctx.unrepresentable === "throw") {
        throw new Error("Literal `undefined` cannot be represented in JSON Schema");
      }
    } else if (typeof val === "bigint") {
      if (ctx.unrepresentable === "throw") {
        throw new Error("BigInt literals cannot be represented in JSON Schema");
      } else {
        vals.push(Number(val));
      }
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {} else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var customProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Custom types cannot be represented in JSON Schema");
  }
};
var transformProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Transforms cannot be represented in JSON Schema");
  }
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = process2(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  json.properties = {};
  const shape = def.shape;
  for (const key in shape) {
    json.properties[key] = process2(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    });
  }
  const allKeys = new Set(Object.keys(shape));
  const requiredKeys = new Set([...allKeys].filter((key) => {
    const v = def.shape[key]._zod;
    if (ctx.io === "input") {
      return v.optin === undefined;
    } else {
      return v.optout === undefined;
    }
  }));
  if (requiredKeys.size > 0) {
    json.required = Array.from(requiredKeys);
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = process2(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => process2(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = process2(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = process2(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => ("allOf" in val) && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
};
var recordProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  const keyType = def.keyType;
  const keyBag = keyType._zod.bag;
  const patterns = keyBag?.patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = process2(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json.patternProperties = {};
    for (const pattern of patterns) {
      json.patternProperties[pattern.source] = valueSchema;
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = process2(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
    }
    json.additionalProperties = process2(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  if (keyValues) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json.required = validKeyValues;
    }
  }
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io === "input")
    json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(undefined);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  process2(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/classic/iso.js
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date2(params) {
  return _isoDate(ZodISODate, params);
}
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}

// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/classic/errors.js
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
    },
    addIssue: {
      value: (issue) => {
        inst.issues.push(issue);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    addIssues: {
      value: (issues) => {
        inst.issues.push(...issues);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
    }
  });
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, {
  Parent: Error
});

// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/classic/parse.js
var parse3 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
var _installedGroups = /* @__PURE__ */ new WeakMap;
function _installLazyMethods(inst, group, methods) {
  const proto = Object.getPrototypeOf(inst);
  let installed = _installedGroups.get(proto);
  if (!installed) {
    installed = new Set;
    _installedGroups.set(proto, installed);
  }
  if (installed.has(group))
    return;
  installed.add(group);
  for (const key in methods) {
    const fn = methods[key];
    Object.defineProperty(proto, key, {
      configurable: true,
      enumerable: false,
      get() {
        const bound = fn.bind(this);
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: bound
        });
        return bound;
      },
      set(v) {
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: v
        });
      }
    });
  }
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  Object.assign(inst["~standard"], {
    jsonSchema: {
      input: createStandardJSONSchemaMethod(inst, "input"),
      output: createStandardJSONSchemaMethod(inst, "output")
    }
  });
  inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
  inst.def = def;
  inst.type = def.type;
  Object.defineProperty(inst, "_def", { value: def });
  inst.parse = (data, params) => parse3(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse2(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync2(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.encode = (data, params) => encode(inst, data, params);
  inst.decode = (data, params) => decode(inst, data, params);
  inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
  inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
  inst.safeEncode = (data, params) => safeEncode(inst, data, params);
  inst.safeDecode = (data, params) => safeDecode(inst, data, params);
  inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
  inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
  _installLazyMethods(inst, "ZodType", {
    check(...chks) {
      const def = this.def;
      return this.clone(mergeDefs(def, {
        checks: [
          ...def.checks ?? [],
          ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
        ]
      }), { parent: true });
    },
    with(...chks) {
      return this.check(...chks);
    },
    clone(def, params) {
      return clone(this, def, params);
    },
    brand() {
      return this;
    },
    register(reg, meta) {
      reg.add(this, meta);
      return this;
    },
    refine(check, params) {
      return this.check(refine(check, params));
    },
    superRefine(refinement, params) {
      return this.check(superRefine(refinement, params));
    },
    overwrite(fn) {
      return this.check(_overwrite(fn));
    },
    optional() {
      return optional(this);
    },
    exactOptional() {
      return exactOptional(this);
    },
    nullable() {
      return nullable(this);
    },
    nullish() {
      return optional(nullable(this));
    },
    nonoptional(params) {
      return nonoptional(this, params);
    },
    array() {
      return array(this);
    },
    or(arg) {
      return union([this, arg]);
    },
    and(arg) {
      return intersection(this, arg);
    },
    transform(tx) {
      return pipe(this, transform(tx));
    },
    default(d) {
      return _default(this, d);
    },
    prefault(d) {
      return prefault(this, d);
    },
    catch(params) {
      return _catch(this, params);
    },
    pipe(target) {
      return pipe(this, target);
    },
    readonly() {
      return readonly(this);
    },
    describe(description) {
      const cl = this.clone();
      globalRegistry.add(cl, { description });
      return cl;
    },
    meta(...args) {
      if (args.length === 0)
        return globalRegistry.get(this);
      const cl = this.clone();
      globalRegistry.add(cl, args[0]);
      return cl;
    },
    isOptional() {
      return this.safeParse(undefined).success;
    },
    isNullable() {
      return this.safeParse(null).success;
    },
    apply(fn) {
      return fn(this);
    }
  });
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  return inst;
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  _installLazyMethods(inst, "_ZodString", {
    regex(...args) {
      return this.check(_regex(...args));
    },
    includes(...args) {
      return this.check(_includes(...args));
    },
    startsWith(...args) {
      return this.check(_startsWith(...args));
    },
    endsWith(...args) {
      return this.check(_endsWith(...args));
    },
    min(...args) {
      return this.check(_minLength(...args));
    },
    max(...args) {
      return this.check(_maxLength(...args));
    },
    length(...args) {
      return this.check(_length(...args));
    },
    nonempty(...args) {
      return this.check(_minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(_lowercase(params));
    },
    uppercase(params) {
      return this.check(_uppercase(params));
    },
    trim() {
      return this.check(_trim());
    },
    normalize(...args) {
      return this.check(_normalize(...args));
    },
    toLowerCase() {
      return this.check(_toLowerCase());
    },
    toUpperCase() {
      return this.check(_toUpperCase());
    },
    slugify() {
      return this.check(_slugify());
    }
  });
});
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(_email(ZodEmail, params));
  inst.url = (params) => inst.check(_url(ZodURL, params));
  inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(_emoji2(ZodEmoji, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(_xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(_e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime2(params));
  inst.date = (params) => inst.check(date2(params));
  inst.time = (params) => inst.check(time2(params));
  inst.duration = (params) => inst.check(duration2(params));
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
  _installLazyMethods(inst, "ZodNumber", {
    gt(value, params) {
      return this.check(_gt(value, params));
    },
    gte(value, params) {
      return this.check(_gte(value, params));
    },
    min(value, params) {
      return this.check(_gte(value, params));
    },
    lt(value, params) {
      return this.check(_lt(value, params));
    },
    lte(value, params) {
      return this.check(_lte(value, params));
    },
    max(value, params) {
      return this.check(_lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(_gt(0, params));
    },
    nonnegative(params) {
      return this.check(_gte(0, params));
    },
    negative(params) {
      return this.check(_lt(0, params));
    },
    nonpositive(params) {
      return this.check(_lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(_multipleOf(value, params));
    },
    step(value, params) {
      return this.check(_multipleOf(value, params));
    },
    finite() {
      return this;
    }
  });
  const bag = inst._zod.bag;
  inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
  inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
  inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
  inst.isFinite = true;
  inst.format = bag.format ?? null;
});
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
  _installLazyMethods(inst, "ZodArray", {
    min(n, params) {
      return this.check(_minLength(n, params));
    },
    nonempty(params) {
      return this.check(_minLength(1, params));
    },
    max(n, params) {
      return this.check(_maxLength(n, params));
    },
    length(n, params) {
      return this.check(_length(n, params));
    },
    unwrap() {
      return this.element;
    }
  });
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  defineLazy(inst, "shape", () => {
    return def.shape;
  });
  _installLazyMethods(inst, "ZodObject", {
    keyof() {
      return _enum(Object.keys(this._zod.def.shape));
    },
    catchall(catchall) {
      return this.clone({ ...this._zod.def, catchall });
    },
    passthrough() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    loose() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    strict() {
      return this.clone({ ...this._zod.def, catchall: never() });
    },
    strip() {
      return this.clone({ ...this._zod.def, catchall: undefined });
    },
    extend(incoming) {
      return extend(this, incoming);
    },
    safeExtend(incoming) {
      return safeExtend(this, incoming);
    },
    merge(other) {
      return merge(this, other);
    },
    pick(mask) {
      return pick(this, mask);
    },
    omit(mask) {
      return omit(this, mask);
    },
    partial(...args) {
      return partial(ZodOptional, this, args[0]);
    },
    required(...args) {
      return required(ZodNonOptional, this, args[0]);
    }
  });
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...normalizeParams(params)
  };
  return new ZodObject(def);
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string2(),
      valueType: keyType,
      ...normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output) => {
        payload.value = output;
        payload.fallback = true;
        return payload;
      });
    }
    payload.value = output;
    payload.fallback = true;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
// ../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/classic/external.js
config(en_default());
// ../plugin/src/agents/language-directive.ts
var ENGLISH_LANGUAGE_NAMES = new Intl.DisplayNames(["en"], {
  type: "language",
  fallback: "none"
});
function resolveLanguageName(language) {
  const code = typeof language === "string" ? language.trim().toLowerCase() : "";
  if (!/^[a-z]{2}$/.test(code))
    return "";
  let english;
  try {
    english = ENGLISH_LANGUAGE_NAMES.of(code) ?? undefined;
  } catch {
    return "";
  }
  if (!english)
    return "";
  let endonym;
  try {
    endonym = new Intl.DisplayNames([code], { type: "language", fallback: "none" }).of(code) ?? undefined;
  } catch {
    endonym = undefined;
  }
  return endonym && endonym !== english ? `${english} (${endonym})` : english;
}
function isValidLanguageCode(language) {
  return resolveLanguageName(language) !== "";
}
function buildContentLanguageDirective(language, options = {}) {
  const target = resolveLanguageName(language);
  if (!target)
    return "";
  const lines = [
    "## Output language",
    "",
    `Write human-readable prose you author in: ${target}.`,
    "",
    "Do not translate or rename structural tokens. Copy required output schemas exactly:",
    "- XML tag names, XML attribute names, JSON keys, tool names, tool-call argument keys, enum values, booleans/null, and required sentinel strings stay in English exactly as shown.",
    "- Keep code identifiers, file paths, commands, config keys, CLI flags, URLs, commit hashes, model/provider IDs, stack traces, diagnostics, and transcript role markers such as U:, A:, and TC: verbatim.",
    "- Localize only free-text prose values/content: summaries, memory text, explanations, titles, observations, and answers — unless the prompt says to preserve original wording.",
    "",
    "These literal values must remain English when used:",
    "PROJECT_RULES, ARCHITECTURE, CONSTRAINTS, CONFIG_VALUES, NAMING;",
    "causal_incident, trajectory_correction;",
    "feature, design, docs, release, investigation, bug, refactor, infra;",
    "memory, observation; true, false; No relevant memories found.",
    "",
    "Preserve the required output shape. Do not add commentary outside the requested XML/JSON/tool output."
  ];
  if (options.preserveUserQuotes) {
    lines.push("", `Preserve U: lines and directly quoted user text in their original source language; write the surrounding summary prose in ${target}.`);
  }
  if (options.retrospective) {
    lines.push("", `Write the lesson text in ${target}; paraphrase source text and never quote the user.`);
  }
  return lines.join(`
`);
}
function withContentLanguageDirective(systemPrompt, language, options = {}) {
  const directive = buildContentLanguageDirective(language, options);
  return directive ? `${systemPrompt}

${directive}` : systemPrompt;
}
function buildPrimaryLanguageDirective(language) {
  const target = resolveLanguageName(language);
  if (!target)
    return "";
  return `Use ${target} for your natural-language replies to the user unless the user explicitly asks for another language. Keep code, identifiers, file paths, commands, logs, and quoted text verbatim.`;
}

// ../plugin/src/features/magic-context/dreamer/cron.ts
var FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 }
];
var MINUTE_MS = 60000;
var MAX_SEARCH_MS = 4 * 366 * 24 * 60 * MINUTE_MS;
function parseField(token, spec) {
  const values = new Set;
  const normalize = (n) => spec.name === "day-of-week" && n === 7 ? 0 : n;
  for (const part of token.split(",")) {
    const piece = part.trim();
    if (piece.length === 0)
      return null;
    const [rangePart, stepPart, ...extra] = piece.split("/");
    if (extra.length > 0)
      return null;
    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart))
        return null;
      step = Number(stepPart);
      if (step < 1)
        return null;
    }
    let lo;
    let hi;
    if (rangePart === "*") {
      lo = spec.min;
      hi = spec.max;
    } else if (rangePart.includes("-")) {
      const [loStr, hiStr, ...rest] = rangePart.split("-");
      if (rest.length > 0)
        return null;
      if (!/^\d+$/.test(loStr) || !/^\d+$/.test(hiStr))
        return null;
      lo = Number(loStr);
      hi = Number(hiStr);
    } else {
      if (!/^\d+$/.test(rangePart))
        return null;
      lo = Number(rangePart);
      hi = stepPart !== undefined ? spec.max : lo;
    }
    if (lo < spec.min || lo > spec.max || hi < spec.min || hi > spec.max)
      return null;
    if (lo > hi)
      return null;
    for (let v = lo;v <= hi; v += step) {
      values.add(normalize(v));
    }
  }
  return values.size > 0 ? values : null;
}
function parseCron(expression) {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "empty cron expression" };
  }
  const tokens = trimmed.split(/\s+/);
  if (tokens.length !== 5) {
    return {
      ok: false,
      error: `expected 5 fields (minute hour day-of-month month day-of-week), got ${tokens.length}`
    };
  }
  const sets = [];
  for (let i = 0;i < FIELDS.length; i++) {
    const parsed = parseField(tokens[i], FIELDS[i]);
    if (!parsed) {
      return {
        ok: false,
        error: `invalid ${FIELDS[i].name} field "${tokens[i]}" (allowed ${FIELDS[i].min}-${FIELDS[i].max})`
      };
    }
    sets.push(parsed);
  }
  return {
    ok: true,
    cron: {
      minute: sets[0],
      hour: sets[1],
      dom: sets[2],
      month: sets[3],
      dow: sets[4],
      domRestricted: !tokens[2].startsWith("*"),
      dowRestricted: !tokens[4].startsWith("*")
    }
  };
}
function isValidCron(expression) {
  return parseCron(expression).ok;
}
function matchesDay(cron, date) {
  const dom = cron.dom.has(date.getDate());
  const dow = cron.dow.has(date.getDay());
  if (cron.domRestricted && cron.dowRestricted)
    return dom || dow;
  return dom && dow;
}
var MAX_DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function dayOfMonthCanOccur(cron) {
  if (cron.domRestricted && cron.dowRestricted)
    return true;
  for (const month of cron.month) {
    for (const day of cron.dom) {
      if (day <= MAX_DAYS_IN_MONTH[month - 1])
        return true;
    }
  }
  return false;
}
function matchesCron(cron, date) {
  return cron.minute.has(date.getMinutes()) && cron.hour.has(date.getHours()) && cron.month.has(date.getMonth() + 1) && matchesDay(cron, date);
}
function civilMinuteKey(date) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(date.getFullYear(), 4)}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}
function nextOccurrence(cron, after, excludeCivilMinute, maxSearchMs = MAX_SEARCH_MS) {
  if (!dayOfMonthCanOccur(cron))
    return null;
  const afterMs = after.getTime();
  let cursorMs = Math.floor(afterMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const capMs = afterMs + Math.max(0, Math.min(MAX_SEARCH_MS, maxSearchMs));
  while (cursorMs <= capMs) {
    const candidate = new Date(cursorMs);
    if (matchesCron(cron, candidate)) {
      if (!excludeCivilMinute || civilMinuteKey(candidate) !== excludeCivilMinute) {
        return candidate;
      }
    }
    cursorMs += MINUTE_MS;
  }
  return null;
}
function nextDueAtMs(expression, afterMs, consumedScheduledAtMs, maxSearchMs = MAX_SEARCH_MS) {
  if (expression.trim().length === 0)
    return null;
  const parsed = parseCron(expression);
  if (!parsed.ok)
    return null;
  const exclude = consumedScheduledAtMs !== undefined ? civilMinuteKey(new Date(consumedScheduledAtMs)) : undefined;
  const next = nextOccurrence(parsed.cron, new Date(afterMs), exclude, maxSearchMs);
  return next ? next.getTime() : null;
}

// ../plugin/src/shared/prompt-surface.ts
function isValidPromptSurfaceModelKey(key) {
  if (key.length === 0 || key.trim() !== key)
    return false;
  const slash = key.indexOf("/");
  if (slash < 0)
    return !key.includes("*");
  if (slash === 0 || slash === key.length - 1)
    return false;
  const provider = key.slice(0, slash);
  const modelID = key.slice(slash + 1);
  if (provider.trim() !== provider || modelID.trim() !== modelID || provider.includes("*") || modelID.includes("*") && modelID !== "*") {
    return false;
  }
  if (modelID === "*")
    return true;
  return modelID.length > 0 && !modelID.startsWith("/") && !modelID.endsWith("/") && !modelID.includes("//");
}
function modelKeyLookupOrder(modelKey) {
  if (!modelKey)
    return [];
  const slash = modelKey.indexOf("/");
  if (slash <= 0 || slash === modelKey.length - 1)
    return [];
  const provider = modelKey.slice(0, slash);
  let modelID = modelKey.slice(slash + 1);
  const providerRefs = modelRefLookupOrder(`${provider}/${modelID}`);
  const candidates = [];
  while (modelID.length > 0) {
    for (const providerRef of providerRefs) {
      const providerSlash = providerRef.indexOf("/");
      const providerPrefix = providerRef.slice(0, providerSlash);
      candidates.push({ key: `${providerPrefix}/${modelID}`, source: "exact" });
    }
    candidates.push({ key: modelID, source: "bare" });
    const lastDash = modelID.lastIndexOf("-");
    if (lastDash <= 0)
      break;
    modelID = modelID.slice(0, lastDash);
  }
  for (const providerRef of providerRefs) {
    const providerSlash = providerRef.indexOf("/");
    const providerPrefix = providerRef.slice(0, providerSlash);
    candidates.push({ key: `${providerPrefix}/*`, source: "wildcard" });
  }
  const seen = new Set;
  return candidates.filter((candidate) => {
    if (seen.has(candidate.key))
      return false;
    seen.add(candidate.key);
    return true;
  });
}
function resolveModelConfigValue(values, modelKey) {
  if (!values)
    return;
  for (const candidate of modelKeyLookupOrder(modelKey)) {
    const value = values[candidate.key];
    if (value !== undefined) {
      return { value, source: candidate.source };
    }
  }
  return;
}
function resolvePromptSurface(config, modelKey) {
  const fallback = config?.default ?? "full";
  const match = resolveModelConfigValue(config?.models, modelKey);
  if (match) {
    return { preset: match.value, source: match.source };
  }
  return { preset: fallback, source: "default" };
}

// ../plugin/src/config/schema/agent-overrides.ts
var PermissionValueSchema = _enum(["ask", "allow", "deny"]);
var PermissionSchema = object({
  edit: PermissionValueSchema.optional(),
  bash: union([PermissionValueSchema, record(string2(), PermissionValueSchema)]).optional(),
  webfetch: PermissionValueSchema.optional(),
  doom_loop: PermissionValueSchema.optional(),
  external_directory: PermissionValueSchema.optional()
}).optional();
var AgentOverrideConfigSchema = object({
  model: string2().optional().describe("Primary model ID (e.g. 'claude-sonnet-4-6')"),
  temperature: number2().min(0).max(2).optional().describe("Sampling temperature (0-2)"),
  top_p: number2().min(0).max(1).optional().describe("Nucleus sampling top_p (0-1)"),
  prompt: string2().optional().describe("Additional system prompt text"),
  tools: record(string2(), boolean2()).optional().describe("Tool enable/disable overrides"),
  disable: boolean2().optional().describe("Disable this agent"),
  description: string2().optional().describe("Agent description"),
  mode: _enum(["subagent", "primary", "all"]).optional().describe("Agent mode (subagent, primary, or all)"),
  color: string2().regex(/^#[0-9A-Fa-f]{6}$/).optional().describe("Hex color for the agent (e.g. '#a1b2c3')"),
  maxSteps: number2().optional().describe("Maximum tool-call steps per invocation"),
  permission: PermissionSchema.describe("Per-tool permission overrides"),
  maxTokens: number2().optional().describe("Maximum output tokens"),
  variant: string2().optional().describe("OpenCode reasoning variant (e.g. for extended thinking)"),
  fallback_models: union([string2(), array(string2())]).optional().describe("Fallback model IDs if primary is unavailable")
});

// ../plugin/src/config/schema/magic-context.ts
var DEFAULT_EXECUTE_THRESHOLD_PERCENTAGE = 65;
var EXECUTE_THRESHOLD_CAP_MESSAGE = "execute_threshold is capped at 90% for cache safety: output capacity is reserved from the usable context window, and the remaining 10% absorbs mid-turn growth before the absolute 95% emergency wall. Use a value between 20 and 90.";
var DEFAULT_HISTORIAN_TIMEOUT_MS = 600000;
var DEFAULT_HISTORY_BUDGET_PERCENTAGE = 0.15;
var PROTECTED_TOKENS_MIN = 4000;
var DEFAULT_LOCAL_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
var PiThinkingLevelSchema = _enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).optional();
var OmpThinkingLevelSchema = _enum(["off", "minimal", "low", "medium", "high", "xhigh", "max", "inherit", "auto"]).optional();
var PiConfigSchema = object({
  subagent_extensions: array(string2().trim().min(1)).optional().describe("User-only allowlist of Pi extensions for Magic Context subagent children. When set, children use --no-extensions and load only these entries (plus Magic Context's scoped child extension where applicable). Relative paths resolve from ~/.pi/agent, matching Pi's settings.json package location. Unset preserves normal Pi extension discovery.")
}).optional();
var PromptSurfacePresetSchema = _enum(["full", "light"]);
var PromptSurfaceModelKeySchema = string2().refine(isValidPromptSurfaceModelKey, {
  message: "Use a non-empty bare model key, provider/model key, or the literal provider/* wildcard; model IDs may contain additional slashes and matching is case-sensitive."
});
var PromptSurfaceToolKeySchema = string2().refine((value) => value.trim().length > 0, {
  message: "tool description keys must not be empty or whitespace-only"
});
var PromptSurfaceConfigSchema = object({
  default: PromptSurfacePresetSchema.default("full").describe('Fallback prompt-surface preset ("full" or "light").'),
  models: record(PromptSurfaceModelKeySchema, PromptSurfacePresetSchema).optional().describe("Literal per-model routing. Keys are bare model IDs, provider/model, or provider/*; matching is case-sensitive and preserves additional slashes in model IDs."),
  guidance_override_path: string2().refine((value) => value.trim().length > 0, {
    message: "guidance_override_path must not be empty or whitespace-only"
  }).optional().describe("USER-LEVEL ONLY path to a complete primary guidance section. Relative paths resolve from the user config file."),
  tool_descriptions: record(PromptSurfaceToolKeySchema, string2().refine((value) => value.trim().length > 0, {
    message: "tool description values must not be empty or whitespace-only"
  })).optional().describe("USER-LEVEL ONLY top-level description overrides keyed by ctx_* tool ID; parameter schemas and descriptions are unchanged.")
}).describe("Prompt-surface preset routing. Project config may select default/models, while guidance_override_path and tool_descriptions are user-level only.");
var PER_HARNESS_MIGRATION_INVENTORY = {
  historian: {
    retained: [
      "temperature",
      "top_p",
      "prompt",
      "tools",
      "disable",
      "description",
      "mode",
      "color",
      "maxSteps",
      "permission",
      "maxTokens",
      "two_pass",
      "disallowed_tools"
    ],
    migrated_execution: ["model", "fallback_models", "variant", "thinking_level"]
  },
  dreamer: {
    retained: [
      "temperature",
      "top_p",
      "prompt",
      "tools",
      "disable",
      "description",
      "mode",
      "color",
      "maxSteps",
      "permission",
      "maxTokens",
      "inject_docs"
    ],
    migrated_execution: ["model", "fallback_models", "variant", "thinking_level"]
  },
  task: {
    retained: ["schedule", "promotion_threshold", "recency_days"],
    migrated_execution: [
      "model",
      "fallback_models",
      "variant",
      "thinking_level",
      "timeout_minutes"
    ]
  }
};
var PER_HARNESS_MODEL_KEYS = ["opencode", "pi", "omp"];
var OcEntryObjectSchema = object({
  model: string2().describe("OpenCode model ID (for example, provider/model)."),
  variant: string2().optional().describe("OpenCode reasoning variant for this entry.")
}).strict();
var OcEntrySchema = union([string2(), OcEntryObjectSchema]);
var PiEntryObjectSchema = object({
  model: string2().describe("Pi model ID (for example, provider/model)."),
  thinking_level: PiThinkingLevelSchema.describe("Pi thinking level for this entry.")
}).strict();
var PiEntrySchema = union([string2(), PiEntryObjectSchema]);
var OmpEntryObjectSchema = object({
  model: string2().describe("OMP model ID (for example, provider/model)."),
  thinking_level: OmpThinkingLevelSchema.describe("OMP thinking level for this entry.")
}).strict();
var OmpEntrySchema = union([string2(), OmpEntryObjectSchema]);
var OpenCodeHarnessBlockSchema = object({
  model: OcEntrySchema.optional().describe("Primary OpenCode model entry."),
  fallback_models: array(OcEntrySchema).optional().describe("Ordered fallback OpenCode entries. New-shape configuration requires an array; legacy singleton values migrate to a one-element array."),
  variant: string2().optional().describe("OpenCode reasoning variant for the primary entry when it declares none. Fallback entries declare variants per-entry.")
}).strict().describe("Strict OpenCode model-resolution block. It accepts no Pi vocabulary.");
var PiHarnessBlockSchema = object({
  model: PiEntrySchema.optional().describe("Primary Pi model entry."),
  fallback_models: array(PiEntrySchema).optional().describe("Ordered fallback Pi entries. New-shape configuration requires an array; legacy singleton values migrate to a one-element array."),
  thinking_level: PiThinkingLevelSchema.describe("Pi thinking level for the primary entry when it declares none. Fallback entries declare thinking levels per-entry.")
}).strict().describe("Strict Pi model-resolution block. It accepts no OpenCode vocabulary.");
var OmpHarnessBlockSchema = object({
  model: OmpEntrySchema.optional().describe("Primary OMP model entry."),
  fallback_models: array(OmpEntrySchema).optional().describe("Ordered fallback OMP entries."),
  thinking_level: OmpThinkingLevelSchema.describe("OMP thinking level for the primary entry when it declares none. Fallback entries declare thinking levels per-entry.")
}).strict().describe("Strict OMP model-resolution block. It accepts no OpenCode vocabulary.");
var OpenCodeTaskExecutionSchema = object({
  model: OcEntrySchema.optional().describe("OpenCode model entry for this task."),
  fallback_models: array(OcEntrySchema).optional().describe("Ordered OpenCode fallback entries for this task."),
  variant: string2().optional().describe("OpenCode reasoning variant for this task's primary entry when it declares none. Fallback entries declare variants per-entry."),
  timeout_minutes: number2().min(5).optional().describe("Minutes allowed for this task before it is aborted.")
}).strict();
var PiTaskExecutionSchema = object({
  model: PiEntrySchema.optional().describe("Pi model entry for this task."),
  fallback_models: array(PiEntrySchema).optional().describe("Ordered Pi fallback entries for this task."),
  thinking_level: PiThinkingLevelSchema.describe("Pi thinking level for this task's primary entry when it declares none. Fallback entries declare thinking levels per-entry."),
  timeout_minutes: number2().min(5).optional().describe("Minutes allowed for this task before it is aborted.")
}).strict();
var OmpTaskExecutionSchema = object({
  model: OmpEntrySchema.optional().describe("OMP model entry for this task."),
  fallback_models: array(OmpEntrySchema).optional().describe("Ordered OMP fallback entries for this task."),
  thinking_level: OmpThinkingLevelSchema.describe("OMP thinking level for this task's primary entry when it declares none. Fallback entries declare thinking levels per-entry."),
  timeout_minutes: number2().min(5).optional().describe("Minutes allowed for this task before it is aborted.")
}).strict();
var DreamerOpenCodeHarnessBlockSchema = object({
  model: OcEntrySchema.optional().describe("Primary OpenCode model entry."),
  fallback_models: array(OcEntrySchema).optional().describe("Ordered fallback OpenCode entries. New-shape configuration requires an array; legacy singleton values migrate to a one-element array."),
  variant: string2().optional().describe("OpenCode reasoning variant for the primary entry when it declares none. Fallback entries declare variants per-entry."),
  tasks: record(string2(), OpenCodeTaskExecutionSchema).optional().describe("OpenCode task execution overrides. Each named task accepts only model, fallback_models, variant, and timeout_minutes.")
}).strict().describe("Strict OpenCode dreamer model-resolution block. It accepts no Pi vocabulary.");
var DreamerPiHarnessBlockSchema = object({
  model: PiEntrySchema.optional().describe("Primary Pi model entry."),
  fallback_models: array(PiEntrySchema).optional().describe("Ordered fallback Pi entries. New-shape configuration requires an array; legacy singleton values migrate to a one-element array."),
  thinking_level: PiThinkingLevelSchema.describe("Pi thinking level for the primary entry when it declares none. Fallback entries declare thinking levels per-entry."),
  tasks: record(string2(), PiTaskExecutionSchema).optional().describe("Pi task execution overrides. Each named task accepts only model, fallback_models, thinking_level, and timeout_minutes.")
}).strict().describe("Strict Pi dreamer model-resolution block. It accepts no OpenCode vocabulary.");
var DreamerOmpHarnessBlockSchema = object({
  model: OmpEntrySchema.optional().describe("Primary OMP model entry."),
  fallback_models: array(OmpEntrySchema).optional().describe("Ordered fallback OMP entries."),
  thinking_level: OmpThinkingLevelSchema.describe("OMP thinking level for the primary entry when it declares none. Fallback entries declare thinking levels per-entry."),
  tasks: record(string2(), OmpTaskExecutionSchema).optional().describe("OMP task execution overrides. Each named task accepts only model, fallback_models, thinking_level, and timeout_minutes.")
}).strict().describe("Strict OMP dreamer model-resolution block. It accepts no OpenCode vocabulary.");
var ProfileOpenCodeModelBlockSchema = object({
  model: OcEntrySchema.optional().describe("Primary OpenCode model entry."),
  fallback_models: array(OcEntrySchema).optional().describe("Ordered fallback OpenCode model entries."),
  variant: string2().optional().describe("OpenCode reasoning variant for the primary model entry.")
}).strict().describe("Strict profile-only OpenCode model-selection block.");
var ProfilePiModelBlockSchema = object({
  model: PiEntrySchema.optional().describe("Primary Pi model entry."),
  fallback_models: array(PiEntrySchema).optional().describe("Ordered fallback Pi model entries."),
  thinking_level: PiThinkingLevelSchema.describe("Pi thinking level for the primary model entry.")
}).strict().describe("Strict profile-only Pi model-selection block.");
var ProfileOmpModelBlockSchema = object({
  model: OmpEntrySchema.optional().describe("Primary OMP model entry."),
  fallback_models: array(OmpEntrySchema).optional().describe("Ordered fallback OMP model entries."),
  thinking_level: OmpThinkingLevelSchema.describe("OMP thinking level for the primary model entry.")
}).strict().describe("Strict profile-only OMP model-selection block.");
var ProfileHistorianSchema = object({
  opencode: ProfileOpenCodeModelBlockSchema.optional(),
  pi: ProfilePiModelBlockSchema.optional(),
  omp: ProfileOmpModelBlockSchema.optional()
}).strict();
var ProfileDreamerSchema = object({
  opencode: ProfileOpenCodeModelBlockSchema.optional(),
  pi: ProfilePiModelBlockSchema.optional(),
  omp: ProfileOmpModelBlockSchema.optional()
}).strict();
var ConfigProfileSchema = object({
  historian: ProfileHistorianSchema.optional(),
  dreamer: ProfileDreamerSchema.optional()
}).strict().describe("User-owned model-selection overlay. Only historian/dreamer harness model blocks are allowed.");
var ConfigProfilesSchema = record(string2().trim().min(1, "Profile names must not be empty or whitespace-only."), ConfigProfileSchema);
var CronScheduleSchema = string2().refine((s) => s.trim() === "" || isValidCron(s), {
  message: 'Invalid schedule: use a 5-field cron expression (e.g. "0 3 * * *" for 3am daily, "0 3 * * 0" for Sunday 3am, "0 */6 * * *" every 6h) or "" to disable.'
}).describe('5-field cron schedule (e.g. "0 3 * * *"), or "" to disable this task.');
var DreamTaskBaseConfigSchema = object({
  schedule: CronScheduleSchema.default(""),
  token_budget: number2().int().positive().optional().describe("Cumulative prompt-token investigation budget (input + cache read + cache write) for one tool-loop child. Defaults: 2,500,000 for map-memories and verify; 3,000,000 for verify-broad; other tool-loop tasks vary. Completed answers are retained even if their usage crosses the budget.")
}).strict();
var DREAM_TASK_PROMOTION_DEFAULTS = {
  "review-user-memories": 3,
  "promote-primers": 2
};
var PromotionThresholdSchema = number2().min(2).max(20).default(DREAM_TASK_PROMOTION_DEFAULTS["review-user-memories"]).describe("review-user-memories: min candidate observations before promotion is considered (default: 3)");
var PrimerPromotionThresholdSchema = number2().min(2).max(20).default(DREAM_TASK_PROMOTION_DEFAULTS["promote-primers"]).describe("promote-primers: min recurring source days before promotion is considered (default: 2)");
var DreamTaskConfigSchema = DreamTaskBaseConfigSchema.extend({
  promotion_threshold: PromotionThresholdSchema
});
var ReviewUserMemoriesTaskConfigSchema = DreamTaskBaseConfigSchema.extend({
  promotion_threshold: PromotionThresholdSchema
});
var PromotePrimersTaskConfigSchema = DreamTaskBaseConfigSchema.extend({
  promotion_threshold: PrimerPromotionThresholdSchema
});
var RetrospectiveTaskConfigSchema = DreamTaskBaseConfigSchema.extend({
  recency_days: number2().int().min(1).max(3650).default(30).describe("retrospective: collect source messages from only the most recent N days")
});
var DEFAULT_TASK_SCHEDULES = {
  "map-memories": "0 2 * * *",
  verify: "0 3 * * *",
  "verify-broad": "0 4 * * 0",
  curate: "0 4 * * 0",
  "compress-cues": "0 4 * * *",
  "classify-memories": "0 6 * * *",
  retrospective: "0 5 * * *",
  "maintain-docs": "",
  "evaluate-smart-notes": "0 3 * * *",
  "review-user-memories": "0 3 * * *",
  "promote-primers": "0 3 * * *",
  "refresh-primers": "0 3 * * *"
};
function defaultTaskConfig(task) {
  const base = { schedule: DEFAULT_TASK_SCHEDULES[task] };
  if (task === "review-user-memories")
    base.promotion_threshold = DREAM_TASK_PROMOTION_DEFAULTS["review-user-memories"];
  if (task === "promote-primers")
    base.promotion_threshold = DREAM_TASK_PROMOTION_DEFAULTS["promote-primers"];
  return base;
}
var DreamTasksSchema = object({
  "map-memories": DreamTaskBaseConfigSchema.default(() => DreamTaskBaseConfigSchema.parse(defaultTaskConfig("map-memories"))),
  verify: DreamTaskBaseConfigSchema.default(() => DreamTaskBaseConfigSchema.parse(defaultTaskConfig("verify"))),
  "verify-broad": DreamTaskBaseConfigSchema.default(() => DreamTaskBaseConfigSchema.parse(defaultTaskConfig("verify-broad"))),
  curate: DreamTaskBaseConfigSchema.default(() => DreamTaskBaseConfigSchema.parse(defaultTaskConfig("curate"))),
  "compress-cues": DreamTaskBaseConfigSchema.default(() => DreamTaskBaseConfigSchema.parse(defaultTaskConfig("compress-cues"))),
  "classify-memories": DreamTaskBaseConfigSchema.default(() => DreamTaskBaseConfigSchema.parse(defaultTaskConfig("classify-memories"))),
  retrospective: RetrospectiveTaskConfigSchema.default(() => RetrospectiveTaskConfigSchema.parse(defaultTaskConfig("retrospective"))),
  "maintain-docs": DreamTaskBaseConfigSchema.extend({
    max_tokens: number2().int().positive().default(12000).describe("Maximum combined token count of proposed ARCHITECTURE.md and STRUCTURE.md")
  }).default(() => ({
    ...DreamTaskBaseConfigSchema.parse(defaultTaskConfig("maintain-docs")),
    max_tokens: 12000
  })),
  "evaluate-smart-notes": DreamTaskBaseConfigSchema.default(() => DreamTaskBaseConfigSchema.parse(defaultTaskConfig("evaluate-smart-notes"))),
  "review-user-memories": ReviewUserMemoriesTaskConfigSchema.default(() => ReviewUserMemoriesTaskConfigSchema.parse(defaultTaskConfig("review-user-memories"))),
  "promote-primers": PromotePrimersTaskConfigSchema.default(() => PromotePrimersTaskConfigSchema.parse(defaultTaskConfig("promote-primers"))),
  "refresh-primers": DreamTaskBaseConfigSchema.default(() => DreamTaskBaseConfigSchema.parse(defaultTaskConfig("refresh-primers")))
}).describe("Harness-independent task metadata. schedule, promotion_threshold, and other task metadata remain here; execution settings live under dreamer.opencode.tasks, dreamer.pi.tasks, or dreamer.omp.tasks.");
var AgentMetadataSchema = AgentOverrideConfigSchema.pick({
  temperature: true,
  top_p: true,
  prompt: true,
  tools: true,
  disable: true,
  description: true,
  mode: true,
  color: true,
  maxSteps: true,
  permission: true,
  maxTokens: true
});
var DreamerConfigSchema = AgentMetadataSchema.extend({
  disable: boolean2().optional().describe("Disable this agent"),
  runner: _enum(["broca", "host"]).optional().describe(`Which side runs the dreamer completions the Rust module routes (classify-memories) in Rust transform mode: "host" runs them on this process's carrier, "broca" routes them to the Broca module. When unset, historian.runner applies, and when that is unset too the harness decides the same way it does for the historian. User-level config only.`),
  opencode: DreamerOpenCodeHarnessBlockSchema.optional(),
  pi: DreamerPiHarnessBlockSchema.optional(),
  omp: DreamerOmpHarnessBlockSchema.optional(),
  tasks: DreamTasksSchema.default(() => DreamTasksSchema.parse({})),
  inject_docs: boolean2().default(true).describe("Inject ARCHITECTURE.md and STRUCTURE.md into the m[0] `<project-docs>` block (default true)")
});
var HistorianConfigSchema = AgentMetadataSchema.extend({
  expand_tools: record(string2(), union([
    string2().superRefine((value, ctx) => {
      const error = toolTemplateError(value);
      if (error)
        ctx.addIssue({ code: "custom", message: error });
    }),
    literal(false)
  ])).optional().describe('Readable historian tool expansions, keyed by exact host tool name. Templates override built-in defaults; false disables an expansion. Supports ${input.path}, ${output.path}, bare ${output}, array [N], [*].field, .each("${field}"), .join("separator"), .count and final .truncate(N). Missing fields are empty. Historian text and lists have no implicit caps; explicit .truncate(N) keeps complete sentences and marks omitted characters, or emits only the marker if no sentence fits. When the ctx_expand history-recovery tool is called in verbose mode, its tool-call previews retain their original built-in templates and limits (300 characters per placeholder, 10 list elements, 1000 characters per expansion). Valid in user and project config; never changes the wire or default ctx_expand transcript.'),
  opencode: OpenCodeHarnessBlockSchema.optional(),
  pi: PiHarnessBlockSchema.optional(),
  omp: OmpHarnessBlockSchema.optional(),
  runner: _enum(["broca", "host"]).optional().describe('Which side runs the historian completion in Rust transform mode: "host" queues it for this process to run on the configured historian model, "broca" routes it to the Broca module. When unset the harness decides: OpenCode 1 and OpenCode 2 use "host", Claude Code (through the Thalamus gateway, which has no host to run a completion) uses "broca". User-level config only — it decides whose provider account pays for the call.'),
  host_runner: object({
    enabled: boolean2().optional().describe("Whether this process answers historian runs queued for a claimant (default true). Setting it to false stops the pull loop without changing historian.runner, so an operator can take one machine out of the lane and leave the queued runs for another claimant or for the runner setting to be changed deliberately.")
  }).optional().describe("Controls for this process's historian pull loop, which answers runs the Rust module queues for the host runner (`historian.runner: \"host\"`, or unset on OpenCode 1 and OpenCode 2). User-level config only — it decides whether this machine's provider account is spent on folds."),
  two_pass: boolean2().default(false).describe("Run a second editor pass over historian output to clean low-signal U: lines and cross-compartment duplicates. Adds ~1 extra API call and ~1.3x cost per historian run. Useful for models without extended thinking support. (default: false)"),
  disallowed_tools: array(_enum(["*", "read", "aft_outline", "aft_zoom", "aft_search"])).default([]).describe("Legacy compatibility setting. Historians, recomp and editor passes always run with zero tools and locked permissions; this list no longer changes their tool surface. (default: [])")
}).optional();
var EmbeddingFallbackProviderSchema = _enum(["local", "openai-compatible", "off"]);
function expandConfigPath(value) {
  const trimmed = value.trim();
  if (trimmed === "~")
    return homedir();
  if (trimmed.startsWith("~/"))
    return `${homedir()}/${trimmed.slice(2)}`;
  return trimmed;
}
var BaseEmbeddingConfigSchema = object({
  provider: _enum(["local", "openai-compatible", "off", "synapse"]).default("local").describe("Embedding provider. 'local' uses Xenova/all-MiniLM-L6-v2, 'openai-compatible' requires endpoint and model, 'synapse' uses the certified local Synapse lane with an explicit fallback provider, and 'off' disables embeddings. Session history is embedded for semantic ctx_search whenever the provider is not 'off', regardless of memory.enabled; memories are embedded only while memory.enabled is true."),
  fallback_provider: EmbeddingFallbackProviderSchema.optional().describe("Fallback provider for the Synapse lane. Required when provider is 'synapse'; local, openai-compatible, and off are valid."),
  model: string2().optional().describe("Embedding model name. Required for openai-compatible, ignored for local."),
  endpoint: string2().optional().describe("API endpoint URL. Required when provider is openai-compatible."),
  api_key: string2().optional().describe("API key for remote embedding provider (optional)"),
  input_type: string2().optional().describe("Default input_type for stored/indexed (passage) embeddings in the request body. Required by some openai-compatible providers (e.g. NVIDIA NIM). Omitted from the request when unset."),
  query_input_type: string2().optional().describe("Optional input_type for query (search) embeddings on asymmetric models (e.g. NVIDIA NIM 'query'). When unset, query embeddings use embedding.input_type. Passage/stored content always uses embedding.input_type."),
  query_instruction: union([string2(), literal(false)]).optional().describe("OpenAI-compatible query prefix override. A string is prepended verbatim to search queries; false disables the built-in model-family instruction. Qwen3-Embedding, gte-Qwen instruct, e5 instruct, and Nomic families have built-in recipes. Query-only changes do not re-embed stored content. User-level only; project values are ignored."),
  document_prefix: string2().optional().describe("OpenAI-compatible stored-document prefix override, prepended verbatim. Defaults to the model-family recipe (empty for Qwen3/gte/e5 instruct; 'search_document: ' for Nomic). Changing it changes stored vectors and triggers re-embedding. User-level only; project values are ignored."),
  truncate: string2().optional().describe("Optional truncate mode sent in the embedding request body (e.g. NVIDIA NIM accepts 'NONE' | 'START' | 'END'). Omitted from the request when unset."),
  max_input_tokens: number2().int().positive().optional().describe("Optional maximum input tokens for chunk embeddings. Defaults conservatively to 512 when omitted."),
  local_runtime: _enum(["auto", "native", "wasm"]).default("auto").describe("Local provider only: ONNX runtime selection. 'auto' uses native under Node and uses WASM under Bun versions before 1.4.0, where Bun's NAPI teardown race can panic on quit; native is restored automatically on Bun 1.4.0+. Inference runs in a dedicated worker. On Bun before 1.4.0, even explicit 'native' uses WASM because native worker teardown can crash the process. Set 'wasm' to avoid loading the native addon on newer hosts too."),
  local_dtype: _enum([
    "auto",
    "fp32",
    "fp16",
    "q8",
    "int8",
    "uint8",
    "q4",
    "bnb4",
    "q4f16",
    "q2",
    "q2f16",
    "q1",
    "q1f16"
  ]).optional().describe("Local provider only: ONNX model dtype passed to the transformers.js feature-extraction pipeline. Accepts the @huggingface/transformers DataType strings (auto, fp32, fp16, q8, int8, uint8, q4, bnb4, q4f16, q2, q2f16, q1, q1f16). Omitted keeps today's behavior (fp32). A non-default value changes the produced vectors and folds into the embedding model identity, so switching dtype re-embeds rather than mixing vector spaces. Useful for selecting a quantized variant (e.g. q8) of a larger multilingual model to cut memory and CPU cost; see issue #259.")
}).superRefine((data, ctx) => {
  const validationProvider = data.provider === "synapse" ? data.fallback_provider : data.provider;
  if (validationProvider === "openai-compatible" && !data.endpoint?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["endpoint"],
      message: "endpoint is required when embedding.provider is openai-compatible"
    });
  }
  if (validationProvider === "openai-compatible" && !data.model?.trim()) {
    ctx.addIssue({
      code: "custom",
      path: ["model"],
      message: "model is required when embedding.provider is openai-compatible"
    });
  }
});
var EmbeddingConfigSchema = BaseEmbeddingConfigSchema.transform((data) => {
  if (data.provider === "synapse") {
    const model = data.model?.trim();
    const endpoint = data.endpoint?.trim();
    const apiKey = data.api_key?.trim();
    const inputType = data.input_type?.trim();
    const queryInputType = data.query_input_type?.trim();
    const truncate = data.truncate?.trim();
    return {
      provider: "synapse",
      ...data.fallback_provider ? { fallback_provider: data.fallback_provider } : {},
      ...model ? { model } : {},
      ...endpoint ? { endpoint } : {},
      ...apiKey ? { api_key: apiKey } : {},
      ...inputType ? { input_type: inputType } : {},
      ...queryInputType ? { query_input_type: queryInputType } : {},
      ...data.query_instruction !== undefined ? { query_instruction: data.query_instruction } : {},
      ...data.document_prefix !== undefined ? { document_prefix: data.document_prefix } : {},
      ...truncate ? { truncate } : {},
      ...data.max_input_tokens ? { max_input_tokens: data.max_input_tokens } : {}
    };
  }
  if (data.provider === "local") {
    return {
      provider: "local",
      model: data.model?.trim() || DEFAULT_LOCAL_EMBEDDING_MODEL,
      local_runtime: data.local_runtime,
      ...data.max_input_tokens ? { max_input_tokens: data.max_input_tokens } : {},
      ...data.local_dtype ? { local_dtype: data.local_dtype } : {}
    };
  }
  if (data.provider === "openai-compatible") {
    const apiKey = data.api_key?.trim();
    const inputType = data.input_type?.trim();
    const queryInputType = data.query_input_type?.trim();
    const truncate = data.truncate?.trim();
    return {
      provider: "openai-compatible",
      model: data.model?.trim() ?? "",
      endpoint: data.endpoint?.trim() ?? "",
      ...apiKey ? { api_key: apiKey } : {},
      ...inputType ? { input_type: inputType } : {},
      ...queryInputType ? { query_input_type: queryInputType } : {},
      ...data.query_instruction !== undefined ? { query_instruction: data.query_instruction } : {},
      ...data.document_prefix !== undefined ? { document_prefix: data.document_prefix } : {},
      ...truncate ? { truncate } : {},
      ...data.max_input_tokens ? { max_input_tokens: data.max_input_tokens } : {}
    };
  }
  return { provider: "off" };
});
var MagicContextConfigSchema = object({
  enabled: boolean2().default(true).describe("Enable magic context (default: true)"),
  allow_home_project: boolean2().default(false).describe("Allow Magic Context sessions launched from the exact canonical home directory. A non-git home uses its deterministic dir: identity; a home repository uses its git: identity. USER-LEVEL ONLY: project config is ignored. The home identity is excluded from registry seed exports, never resolves descendants by containment, and cannot join a workspace."),
  mural: object({
    enabled: boolean2().default(false),
    model: unknown().optional().describe("Deprecated: ignored. compress-cues now uses the dreamer model for each harness, like every other dreamer task; override it with dreamer.opencode.tasks.compress-cues.model (or the pi/omp equivalent). Remove this key; it no longer does anything.").meta({ deprecated: true })
  }).default({ enabled: false }).describe("Experimental mural: a single deterministically-rendered image of project memories that did not fit the context budget. Cues are compressed per-memory by the compress-cues dreamer task."),
  transform_mode: _enum(["ts", "rust"]).default("ts").describe('Experimental: routes the entire Magic Context runtime for the project through the ck-mc Rust module over subc (requires user-level `subc` config); "ts" is the current TypeScript pipeline.'),
  auto_update: boolean2().optional().describe("Enable automatic npm self-update checks for the OpenCode plugin. Security: USER-only in config loader, so hostile project configs cannot suppress updates."),
  language: string2().trim().toLowerCase().refine((s) => isValidLanguageCode(s), 'language must be a 2-letter ISO 639-1 code (e.g. "tr", "es", "de")').optional().describe("Output language for Magic Context's generated content and guidance, as a " + '2-letter ISO 639-1 code (e.g. "tr", "es", "de", "ja", "pt"). When set, the ' + "historian, dreamer, and the agent-guidance block instruct the model to " + "write its PROSE in this language while keeping all structural tokens (XML tags, " + "the five memory category names, code identifiers, file paths) in English. " + "USER-LEVEL ONLY (ignored in project config for security). Unset = today's " + "behavior (model mirrors the conversation; English scaffolding). Changing it " + "triggers one cache re-materialization; existing compartments/memories keep their " + "original language until naturally rewritten."),
  profile: string2().trim().min(1).optional().describe("Select a named user-owned model profile. A valid project name overrides this user default; an empty string, null, or other non-string project value is ignored with a warning so the user selection still applies. Unknown names warn and use the base configuration."),
  profiles: ConfigProfilesSchema.optional().describe("User-level named model profiles. A profile may contain only historian/dreamer model, fallback_models, OpenCode variant, and Pi/OMP thinking_level fields; task execution policy (including timeout_minutes) is excluded. Project configs may select a name but cannot define profiles."),
  historian: HistorianConfigSchema.describe("Historian metadata plus independent strict OpenCode, Pi, and OMP execution blocks. Retained metadata stays at historian; model, fallback_models, variant, and thinking_level belong only in historian.opencode, historian.pi, or historian.omp."),
  dreamer: DreamerConfigSchema.optional().describe("Dreamer metadata and scheduling plus independent strict OpenCode, Pi, and OMP execution blocks. schedule and promotion_threshold stay at dreamer.tasks; model, fallback_models, variant, thinking_level, and timeout_minutes belong only in the matching harness block."),
  smart_notes: object({
    enabled: boolean2().default(true).describe("Enable smart-note authoring and condition evaluation. User-level only: tool definitions are process-wide. Changes require a host restart and rebuild each session's cached prompt once. Pending notes remain stored and unchecked; already-ready notes still surface."),
    retina_handoff: boolean2().default(false).describe("When true, dreamer skips smart notes whose surface conditions compiled to retina provider configs at authoring time. Default false keeps both paths active until the retina consumer is deployed.")
  }).default({ enabled: true, retina_handoff: false }).describe("Smart-note ownership transition controls."),
  cache_ttl: union([string2(), object({ default: string2() }).catchall(string2())]).default("5m").describe(`How long Magic Context assumes the provider's cached prefix stays valid. This is MC's own deferral gate — it does not change the provider's actual cache lifetime. String (e.g. "5m", "1h", "30s") or per-model object ({ default: "5m", "provider/model": "1h", "provider/*": "never" }); keys resolve most-specific first (exact provider/model, bare model ID, shorter dash-prefixes, then the provider/* wildcard, then default). User and project settings, including an explicit "5m" or object default, apply on the next pass. Only built-in defaults are frozen per session, including across restarts: when unset, GPT-5.6 and later (including gpt-6*, through any provider prefix) use 30m, other models use 5m. /ctx-status shows the effective TTL and whether it comes from your config or a frozen built-in default. Editing the TTL does not itself rewrite prompt bytes; a lowered TTL rebuilds only after normal idle expiry. OpenAI documents at least 30 minutes since the latest write or reuse: https://developers.openai.com/api/docs/guides/prompt-caching (Cache lifetime and Summary of model differences). Set to "never" to mean MC never assumes expiry (for lanes kept warm externally by a cache-keep tool) — disables the idle-TTL heuristic so MC never initiates a rebuild based on elapsed time. Provider-side extended TTL is a separate request-level concern (cache_control: { ttl } in the request body).`),
  prompt_surface: PromptSurfaceConfigSchema.default({ default: "full" }).describe("Prompt-surface presets: default is full; models use bare model IDs, provider/model, or provider/* routing keys. Guidance and tool-description overrides are user-level only. OpenCode 1.x, Pi, and OMP register tool descriptions once per process (they follow the default preset). OpenCode 2 rewrites the five ctx_* descriptions per request from the draft model."),
  output_reserve: union([
    number2().min(0),
    object({ default: number2().min(0) }).catchall(number2().min(0))
  ]).optional().describe('User-only output-token reservation override. Number or per-model object ({ default: 16384, "provider/model": 8192 }); 0 disables reservation. Takes precedence over every derived source: an explicit value here always wins against catalog output limits, provider window-geometry facts, and the 25%-of-context fallback (usable window = context window minus this reserve). When unset, Magic Context reserves the catalog output limit (capped at 25% of context) for shared-window providers and keeps proven separate-quota Google/Gemini windows unchanged.'),
  models: object({
    window_overlay_path: string2().trim().min(1).optional()
  }).optional().describe("User-only Fusiform window-overlay settings. The path defaults to <dataDir>/fusiform/window-overlay.json."),
  toast_duration_ms: number2().min(0).max(60000).default(5000).describe("TUI toast lifetime in milliseconds for Magic Context notifications. Set to 0 to disable Magic Context toasts entirely (min: 0, max: 60000, default: 5000)"),
  execute_threshold_percentage: union([
    number2().min(20).max(90, EXECUTE_THRESHOLD_CAP_MESSAGE),
    object({ default: number2().min(20).max(90, EXECUTE_THRESHOLD_CAP_MESSAGE) }).catchall(number2().min(20).max(90, EXECUTE_THRESHOLD_CAP_MESSAGE))
  ]).default(DEFAULT_EXECUTE_THRESHOLD_PERCENTAGE).describe('Context percentage that forces queued operations to execute. Number or per-model object ({ default: 65, "provider/model": 45 }). Values above 90 are rejected because the runtime caps at 90% of the output-reserved safe window (MAX_EXECUTE_THRESHOLD). Default: DEFAULT_EXECUTE_THRESHOLD_PERCENTAGE'),
  execute_threshold_tokens: object({
    default: number2().min(5000).max(2000000).optional()
  }).catchall(number2().min(5000).max(2000000)).optional().describe("Absolute token thresholds per model. When matched, overrides execute_threshold_percentage for that model. Accepts `default` for all models or per-model keys. Values above 90% × context_limit are clamped with a warning log. Min 5_000, max 2_000_000."),
  protected_tokens: number2().int().min(PROTECTED_TOKENS_MIN).max(1e6).optional().describe("Positive integer token floor to protect from automatic reclaim (min: 4_000, max: 1_000_000). When omitted, the derived default is clamp(round(0.05 × usableSoft), min(16_000, round(0.08 × usableSoft)), 64_000)."),
  protected_tags: unknown().optional().describe("Deprecated: number of recent tags to protect. Ignored for behaviour; use protected_tokens instead.").meta({ deprecated: true }),
  clear_reasoning_age: unknown().optional().describe("Deprecated and ignored. Use keep_reasoning_tokens instead.").meta({ deprecated: true }),
  keep_reasoning_tokens: union([
    number2().int().min(0).max(1e6),
    object({ default: number2().int().min(0).max(1e6).optional() }).catchall(number2().int().min(0).max(1e6))
  ]).optional().describe("Reasoning tokens to keep on rebuilding passes. Number or per-model object; exact, shorter model keys, provider/*, then default. Omitted: fixed 10,000. 0 removes all eligible historical reasoning; newest and exempt steps always stay."),
  history_budget_percentage: number2().min(0.05).max(0.5).default(DEFAULT_HISTORY_BUDGET_PERCENTAGE).describe("Fraction of usable context (context_limit × execute_threshold) reserved for the session history block (default: 0.15)"),
  historian_timeout_ms: number2().min(60000).default(DEFAULT_HISTORIAN_TIMEOUT_MS).describe("Timeout for each historian prompt call in both TypeScript and Rust transform modes, in milliseconds (default: 600000)"),
  commit_cluster_trigger: object({
    enabled: boolean2().default(true).describe("Enable commit-cluster based historian triggering (default: true)"),
    min_clusters: number2().min(1).default(3).describe("Minimum commit clusters required to trigger historian (min: 1, default: 3)")
  }).default({ enabled: true, min_clusters: 3 }).describe("Commit-cluster trigger: fire historian when enough commit clusters accumulate in the unsummarized tail"),
  system_prompt_injection: object({
    enabled: boolean2().default(true).describe("When false, NO injection happens for ANY agent — global escape hatch. (default: true)"),
    skip_signatures: array(string2()).default(["<!-- magic-context: skip -->"]).describe(`Substring opt-out list. If the agent's system prompt contains any of these strings, skip ALL Magic Context injection for that call. Default "<!-- magic-context: skip -->" is meant to be added inside a user's custom agent prompt to opt that agent out.`)
  }).default({
    enabled: true,
    skip_signatures: ["<!-- magic-context: skip -->"]
  }).describe("Controls whether and where Magic Context augments the system prompt. Lets users opt specific agents out of the Magic Context guidance and the surrounding project-docs / user-profile blocks. OpenCode's internal hidden agents — title, summary, and compaction — are always skipped automatically."),
  sqlite: object({
    cache_size_mb: number2().min(2).max(2048).default(64).describe("Page-cache size in MiB per connection (PRAGMA cache_size). Larger keeps more hot pages resident, cutting re-reads on repeated full-table scans. (min 2, max 2048, default 64)"),
    mmap_size_mb: number2().min(0).max(8192).default(0).describe("Memory-mapped I/O size in MiB (PRAGMA mmap_size). 0 disables mmap (SQLite default). Raising it can cut read overhead on large DBs at the cost of address space. (min 0, max 8192, default 0)")
  }).default({ cache_size_mb: 64, mmap_size_mb: 0 }).describe("SQLite connection tuning for Magic Context's own context.db. These are per-connection PRAGMAs applied at open; they do not change the schema or what is stored."),
  storage: object({
    enforce_private_permissions: boolean2().default(true).describe("When true (default), Magic Context creates and re-tightens its TypeScript-mode storage directories to owner-only 0700 and storage files to owner-only 0600. Set false only for a deliberate trusted-group deployment whose operator manages those files externally; in TypeScript mode Magic Context then skips its own creation modes and recursive tightening. In Rust transform mode, ck-mc's store library always keeps the shared data directory owner-only 0700, regardless of this setting. USER-LEVEL ONLY — ignored in project config for security. On Windows, POSIX chmod modes are already meaningless, so this setting is a no-op.")
  }).default({ enforce_private_permissions: true }).describe("Storage permission policy. The default keeps session content and memories owner-private. Disabling enforcement is for trusted shared-group storage managed externally; TypeScript mode follows that policy, but Rust transform mode always keeps its shared data directory owner-only because ck-mc's store library enforces it."),
  embedding: EmbeddingConfigSchema.default({
    provider: "local",
    model: DEFAULT_LOCAL_EMBEDDING_MODEL,
    local_runtime: "auto"
  }).describe("Embedding provider configuration"),
  subc: object({
    connection_file: string2().trim().min(1).transform(expandConfigPath).describe("Path to the owner-only subc connection file.")
  }).optional().describe("User-only Synapse daemon connection settings."),
  shadow_embedding: object({
    enabled: boolean2().default(false).describe("Developer-only Synapse shadow embedding lane switch.")
  }).default({ enabled: false }).describe("Developer-only Synapse shadow embedding lane."),
  temporal_awareness: boolean2().default(true).describe('Inject wall-clock gap markers (<!-- +Xm -->) between user messages where > 5 min elapsed since the previous message, and add compact date ranges to compartment headings. Gives the agent a sense of session pacing and "how long ago" across multi-day sessions. Graduated from experimental.temporal_awareness; default: true (set false to opt out).'),
  keep_subagents: boolean2().default(false).describe("Debug: keep every settled Magic Context child session instead of deleting it after success: historian, all Dreamer tasks, smart-note evaluation and compilation, user-memory review, and memory migration. Kept Dreamer children can contain memory-pool text and user messages from other sessions of the same operator; their full transcript (prompt, tool calls, token usage, output) stays in the host session store. Kept sessions accumulate until manually cleared; leave false for normal use. Requires a restart to take effect. On OpenCode 2, one hidden session holds many runs; it is kept once any of its runs settled, and only a Dreamer session none of whose runs settled is still deleted."),
  debug_rpc: boolean2().default(false).describe("Developer-only: enable authenticated loopback RPCs for memory counters and heap snapshots. Disabled by default. USER-LEVEL ONLY and requires a restart."),
  fail_closed_blocking: boolean2().default(true).describe("When Magic Context cannot operate (schema fence mismatch, storage open/migration failure), block the primary-session prompt with a loud recovery error instead of silently degrading to native compaction. Default true. Set false only to restore the old degrade-silently behavior (not recommended). USER-LEVEL ONLY — ignored in project config for security. Requires a restart."),
  compaction: object({
    enabled: boolean2().default(true).describe("When false, Magic Context stops managing the context window and keeps its knowledge layer: memory and docs/user-profile/key-files injection through additive m[0]/m[1], raw-message FTS indexing, dreamer, notes, ctx_search, ctx_expand, ctx_memory, and /ctx-embed remain available. MC's historian/compartment preparation, tagging, markers, pruning, folding, drops, strips, splicing, synthetic context-management todos, temporal markers, nudges, and fail-closed blocking stop; ctx_expand remains a knowledge-surface tool. fail_closed_blocking is inert: a transform failure passes the input messages through without blocking or cancelling. This setting does not enable native compaction: OpenCode's compaction.auto / compaction.prune or Pi's equivalent owns the window, or nothing does. MC's compaction.enabled in magic-context.jsonc is distinct from OpenCode's compaction.auto / compaction.prune in opencode.jsonc; they are different files and different owners. On the first turn after disabling, a long session may trigger one native compaction cycle; MC removes only its own marker boundary, leaves native boundaries and stored compartments intact, and does no pre-trimming mitigation. Marker cleanup is lazy per session, so an unresumed session is cleaned when it is next resumed. If compaction is enabled again, run /ctx-wrapup when the historian is runnable to catch up. OpenCode peer verification against v1.18.4 confirms native compaction covers child sessions: subagents receive additive memory/docs injection and no MC reclaim in this mode, so keep subagent tasks small or leave compaction.enabled on for long subagent runs. This is boot-resolved and requires a process restart; project-tier compaction.enabled is stripped so a cloned repository cannot disable the user's setting. The sidebar reports raw usage as Context: <pct>% · native compaction or Context: <pct>% · no active compaction and does not show an MC execute-threshold fill. /ctx-wrapup, /ctx-recomp, and /ctx-flush refuse without context-management side effects; /ctx-embed remains functional. Raw content hidden by a native boundary before Magic Context's first pass is not retroactively indexed.")
  }).default({ enabled: true }).describe("Compaction-off mode gate. Default true (MC manages the context window as today). Set compaction.enabled=false to keep the knowledge layer while letting native compaction (or nothing) own the window. Boot-resolved; requires a restart to change."),
  todowrite: object({
    enabled: boolean2().default(false).describe("Pi only: off by default. Set todowrite.enabled=true to register Magic Context's todowrite task-list tool and /todos command. OpenCode ships its own built-in todowrite; this setting has no effect there."),
    overlay: boolean2().default(true).describe("Pi only: show the persistent todo overlay above the editor while tasks are active.")
  }).default({ enabled: false, overlay: true }).describe("Pi-only todowrite tool and overlay controls. Pi registers tools and widgets at extension boot, so changing this after /cd requires /reload or restart."),
  pi: PiConfigSchema.describe("Pi-only child-process extension controls. This setting is user-level only; project configuration cannot choose which extensions a user's subagent children load."),
  smart_drops: unknown().optional().describe("Deprecated: ignored. Content-aware supersession reclaim is always on, only on passes already rebuilding the cache. Remove this key; it no longer does anything.").meta({ deprecated: true }),
  protected_tools: record(string2(), number2().int().nonnegative()).default({ ...DEFAULT_PROTECTED_TOOLS }).transform((map) => mergeProtectedTools(map)).describe("Keep each tool's newest N still-active results in every automatic drop lane (issue 621). User and project maps merge over defaults {todowrite: 1, ctx_reduce: 3}; 0 turns protection off. Names are case-insensitive and ignore leading mcp_. Holds even at 95% pressure, with no byte cap: large protected outputs can reach refusal sooner. Queued drops, from the agent or historian publication, are held until newer calls displace the result and a later cache-rebuilding pass applies them. The historian's summary is unaffected; the raw result leaves at the next fold. Frozen strips are unaffected. Changes and rotation never originate a bust; dropped results are never restored."),
  caveman_text_compression: object({
    enabled: boolean2().default(false).describe("Apply deterministic caveman-style text compression to old conversation text. Active for primary sessions when enabled; never for subagents. Compresses user/assistant text in oldest-first tiers: ultra (oldest 20%), full, lite, untouched (newest 40%)."),
    min_chars: number2().min(100).max(1e4).default(500).describe("Text parts shorter than this (characters) stay untouched. Min 100, max 10000. Default: 500.")
  }).default({ enabled: false, min_chars: 500 }).describe("Age-tier caveman compression for long user/assistant text parts. Active for primary sessions when enabled; never for subagents. Oldest 20% of eligible tags (outside protected tail) go to ultra, next 20% to full, next 20% to lite, newest 40% untouched. Graduated from experimental.caveman_text_compression; opt-in, default off (lossy)."),
  memory: object({
    enabled: boolean2().default(true).describe("Enable cross-session memory (default: true). Does not affect history embedding or semantic ctx_search over session history; set embedding.provider to 'off' to stop all embedding."),
    injection_budget_tokens: number2().min(500).max(20000).default(4000).describe("Token budget for memory injection on session start (min: 500, max: 20000, default: 4000)"),
    auto_promote: boolean2().default(true).describe("Automatically promote eligible session facts into memory (default: true)"),
    retrieval_count_promotion_threshold: number2().min(1).default(3).describe("retrieval_count threshold for promoting memory to permanent status (min: 1, default: 3)"),
    auto_search: object({
      enabled: boolean2().default(true).describe("Automatically append a compact <ctx-search-hint> to eligible user messages when relevant memories, conversation, or commits are found. Graduated from experimental.auto_search; on by default (set false to opt out). Independent of memory.enabled."),
      score_threshold: number2().min(0.3).max(0.95).default(0.6).describe("Top hit score must exceed this threshold for the hint to fire (min: 0.3, max: 0.95, default: 0.60)"),
      min_prompt_chars: number2().min(5).max(500).default(20).describe("Skip hint when user message is shorter than this (min: 5, max: 500, default: 20)")
    }).default({ enabled: true, score_threshold: 0.6, min_prompt_chars: 20 }).describe("Auto-search hint: transform-time ctx_search on each new user message; when the top hit clears the threshold, append a compact <ctx-search-hint> block of vague fragments to that user message. Does NOT inject full content. Graduated from experimental.auto_search; enabled by default (set enabled: false to opt out). Independent of memory.enabled."),
    git_commit_indexing: object({
      enabled: boolean2().default(false).describe("Index HEAD git commits for ctx_search (git_commit source). Graduated from experimental.git_commit_indexing; opt-in, default off. Independent of memory.enabled."),
      since_days: number2().min(7).max(3650).default(365).describe("Days of HEAD history to index (min: 7, max: 3650, default: 365)"),
      max_commits: number2().min(100).max(20000).default(2000).describe("Max commits kept per project; oldest evicted (min: 100, max: 20000, default: 2000)")
    }).default({ enabled: false, since_days: 365, max_commits: 2000 }).describe("Index git commit messages from HEAD into ctx_search. Commits become a 4th searchable source alongside memories and session history. Graduated from experimental.git_commit_indexing; opt-in, default off (per-project embedding cost). Independent of memory.enabled.")
  }).default({
    enabled: true,
    injection_budget_tokens: 4000,
    auto_promote: true,
    retrieval_count_promotion_threshold: 3,
    auto_search: { enabled: true, score_threshold: 0.6, min_prompt_chars: 20 },
    git_commit_indexing: { enabled: false, since_days: 365, max_commits: 2000 }
  }).describe("Cross-session memory configuration")
}).transform((data) => {
  return {
    ...data,
    protected_tags: data.protected_tags
  };
});
var LIVE_RELOAD_CONFIG_PATHS = [
  "cache_ttl",
  "toast_duration_ms",
  "historian.opencode.model",
  "historian.opencode.fallback_models",
  "historian.opencode.variant",
  "historian.pi.model",
  "historian.pi.fallback_models",
  "historian.pi.thinking_level",
  "historian.omp.model",
  "historian.omp.fallback_models",
  "historian.omp.thinking_level",
  "historian.two_pass",
  "historian.expand_tools",
  "historian.maxTokens",
  "historian_timeout_ms",
  "commit_cluster_trigger.enabled",
  "commit_cluster_trigger.min_clusters",
  "memory.auto_promote",
  "dreamer.disable",
  "dreamer.maxTokens",
  "dreamer.opencode.model",
  "dreamer.opencode.fallback_models",
  "dreamer.opencode.variant",
  "dreamer.opencode.tasks",
  "dreamer.pi.model",
  "dreamer.pi.fallback_models",
  "dreamer.pi.thinking_level",
  "dreamer.pi.tasks",
  "dreamer.omp.model",
  "dreamer.omp.fallback_models",
  "dreamer.omp.thinking_level",
  "dreamer.omp.tasks",
  "dreamer.tasks.map-memories.schedule",
  "dreamer.tasks.verify.schedule",
  "dreamer.tasks.verify-broad.schedule",
  "dreamer.tasks.curate.schedule",
  "dreamer.tasks.compress-cues.schedule",
  "dreamer.tasks.classify-memories.schedule",
  "dreamer.tasks.retrospective.schedule",
  "dreamer.tasks.retrospective.recency_days",
  "dreamer.tasks.maintain-docs.schedule",
  "dreamer.tasks.evaluate-smart-notes.schedule",
  "dreamer.tasks.review-user-memories.schedule",
  "dreamer.tasks.review-user-memories.promotion_threshold",
  "dreamer.tasks.promote-primers.schedule",
  "dreamer.tasks.promote-primers.promotion_threshold",
  "dreamer.tasks.refresh-primers.schedule",
  "memory.git_commit_indexing.enabled",
  "memory.git_commit_indexing.since_days",
  "memory.git_commit_indexing.max_commits"
];
for (const path of LIVE_RELOAD_CONFIG_PATHS) {
  let node = MagicContextConfigSchema._def.in;
  for (const part of path.split(".")) {
    while (node instanceof ZodOptional || node instanceof ZodDefault || node instanceof ZodNullable) {
      node = node.unwrap();
    }
    if (!(node instanceof ZodObject) || !(part in node.shape)) {
      throw new Error(`Unknown live config path: ${path}`);
    }
    node = node.shape[part];
  }
  globalRegistry.add(node, { ...node.meta(), "x-mc-live-reload": true });
}
function deriveDefaultProtectedTokens(usableSoft) {
  const clampedUsable = Math.max(0, usableSoft);
  const lowerBound = Math.min(16000, Math.round(0.08 * clampedUsable));
  const target = Math.round(0.05 * clampedUsable);
  return Math.min(64000, Math.max(lowerBound, target));
}

// ../plugin/src/features/magic-context/memory/embedding-model-match.ts
function parseEmbeddingModel(model) {
  const lastColon = model.lastIndexOf(":");
  if (lastColon > model.lastIndexOf("/")) {
    return { base: model.slice(0, lastColon), tag: model.slice(lastColon + 1) };
  }
  return { base: model };
}
function normalizeEmbeddingModelId(model) {
  return parseEmbeddingModel(model.trim().toLowerCase()).base;
}
function matchNormalizedEmbeddingModels(a, b) {
  if (a.length === 0 || b.length === 0)
    return true;
  if (a === b)
    return true;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  const isBoundary = (ch) => ch === "-" || ch === "/";
  if (longer.startsWith(shorter) && isBoundary(longer.charAt(shorter.length)))
    return true;
  if (longer.endsWith(shorter) && isBoundary(longer.charAt(longer.length - shorter.length - 1)))
    return true;
  return false;
}
function embeddingModelsMatch(served, requested) {
  const servedNormalized = served.trim().toLowerCase();
  const requestedNormalized = requested.trim().toLowerCase();
  const servedModel = parseEmbeddingModel(servedNormalized);
  const requestedModel = parseEmbeddingModel(requestedNormalized);
  if (servedModel.tag !== undefined && requestedModel.tag !== undefined && servedModel.tag !== requestedModel.tag) {
    return false;
  }
  return matchNormalizedEmbeddingModels(servedModel.base, requestedModel.base);
}
var QWEN3_QUERY_INSTRUCTION = `Instruct: Given a web search query, retrieve relevant passages that answer the query
Query: `;
var INSTRUCT_WEB_SEARCH_QUERY_PREFIX = QWEN3_QUERY_INSTRUCTION;
var EMBEDDING_MODEL_PREFIX_FAMILIES = [
  {
    family: "qwen3-embedding",
    basenamePattern: /^qwen3-embedding(?:-|$)/,
    prefixes: { queryPrefix: QWEN3_QUERY_INSTRUCTION, documentPrefix: "" }
  },
  {
    family: "gte-qwen-instruct",
    basenamePattern: /^gte-qwen.*-instruct(?:-|$)/,
    prefixes: { queryPrefix: INSTRUCT_WEB_SEARCH_QUERY_PREFIX, documentPrefix: "" }
  },
  {
    family: "e5-instruct",
    basenamePattern: /^(?:multilingual-)?e5-.*-instruct(?:-|$)/,
    prefixes: { queryPrefix: INSTRUCT_WEB_SEARCH_QUERY_PREFIX, documentPrefix: "" }
  },
  {
    family: "nomic-embed-text",
    basenamePattern: /^nomic-embed-text(?:-|$)/,
    prefixes: { queryPrefix: "search_query: ", documentPrefix: "search_document: " }
  }
];
function modelBasename(model) {
  const normalized = normalizeEmbeddingModelId(model);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
function resolveEmbeddingTextPrefixes(model, queryInstruction, documentPrefix) {
  const family = EMBEDDING_MODEL_PREFIX_FAMILIES.find(({ basenamePattern }) => basenamePattern.test(modelBasename(model)));
  return {
    queryPrefix: queryInstruction === false ? "" : queryInstruction !== undefined ? queryInstruction : family?.prefixes.queryPrefix ?? "",
    documentPrefix: documentPrefix ?? family?.prefixes.documentPrefix ?? ""
  };
}

// ../plugin/src/features/magic-context/memory/embedding-identity.ts
function normalizeEndpoint(endpoint) {
  return endpoint?.trim().replace(/\/+$/, "") ?? "";
}
var LOCAL_EMBEDDING_RUNTIME_FINGERPRINT = "transformers@4.3.0;onnxruntime-node@1.30.0;onnxruntime-web@1.26.0-dev.20260416-b7804b056c";
function getEmbeddingProviderIdentity(config) {
  if (config.provider === "off") {
    return "embedding-provider:off";
  }
  if (config.provider === "synapse") {
    const resolved = config;
    if (!resolved.model || !resolved.synapse_fingerprint)
      return "synapse:v1:pending";
    return getSynapseLaneIdentity(resolved.model, resolved.synapse_fingerprint);
  }
  if (config.provider !== "local" && config.provider !== "openai-compatible") {
    throw new Error("Unknown embedding provider");
  }
  const truncate = config.provider === "openai-compatible" ? config.truncate?.trim() : undefined;
  const documentPrefix = config.provider === "openai-compatible" ? resolveEmbeddingTextPrefixes(config.model, config.query_instruction, config.document_prefix).documentPrefix : "";
  const localDtype = config.provider === "local" && config.local_dtype && config.local_dtype !== "fp32" ? config.local_dtype : undefined;
  const identityInput = config.provider === "openai-compatible" ? {
    provider: "openai-compatible",
    model: config.model.trim(),
    endpoint: normalizeEndpoint(config.endpoint),
    apiKeyPresent: Boolean(config.api_key?.trim()),
    inputType: config.input_type?.trim() || "",
    ...documentPrefix ? { documentPrefix } : {},
    ...truncate ? { truncate } : {}
  } : {
    provider: "local",
    model: config.model?.trim() || DEFAULT_LOCAL_EMBEDDING_MODEL,
    endpoint: "",
    apiKeyPresent: false,
    runtimeFingerprint: LOCAL_EMBEDDING_RUNTIME_FINGERPRINT,
    ...localDtype ? { localDtype } : {}
  };
  return `embedding-provider:${computeNormalizedHash(JSON.stringify(identityInput))}`;
}

// ../plugin/src/features/magic-context/memory/embedding-failure.ts
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}
function nestedMessages(error) {
  const messages = [errorMessage(error)];
  if (error && typeof error === "object" && "cause" in error) {
    const cause = error.cause;
    if (cause !== undefined)
      messages.push(...nestedMessages(cause));
  }
  return messages;
}
function safeErrorDetail(message) {
  return message.replace(/https?:\/\/[^\s"']+/gi, "<remote URL>").replace(/\/(?:Users|home)\/[^/\s]+/g, "~").replace(/\s+/g, " ").trim().slice(0, 240);
}
function hasAny(messages, patterns) {
  return messages.some((message) => {
    const lower = message.toLowerCase();
    return patterns.some((pattern) => lower.includes(pattern));
  });
}
function classifyLocalEmbeddingFailure(error, context = {}) {
  const primaryMessages = nestedMessages(error);
  const nativeMessages = context.nativeError === undefined ? [] : nestedMessages(context.nativeError);
  if (hasAny(primaryMessages, [
    "mc_embedding_fs_unavailable",
    "file system cache is not available"
  ]) || context.usesWasm && hasAny(primaryMessages, ["unable to get model file path or buffer"])) {
    return {
      class: "local_fs_unavailable",
      reason: "the WASM model cache cannot access the Node filesystem",
      retryable: false
    };
  }
  if (hasAny(primaryMessages, [
    "failed to fetch",
    "fetch failed",
    "network error",
    "enotfound",
    "econnreset",
    "econnrefused",
    "certificate",
    "unable to load file",
    "unauthorized access to file",
    "forbidden access to file",
    "not found at"
  ]) || primaryMessages.some((message) => /\bHTTP\s+[45]\d\d\b/i.test(message))) {
    return {
      class: "local_download_failure",
      reason: `the embedding model download failed: ${safeErrorDetail(primaryMessages[0])}`,
      retryable: true
    };
  }
  const bindingMessages = [...primaryMessages, ...nativeMessages];
  if (hasAny(bindingMessages, [
    "onnxruntime_binding.node",
    "cannot find package 'onnxruntime-node'",
    'cannot find package "onnxruntime-node"',
    "cannot find module 'onnxruntime-node'",
    'cannot find module "onnxruntime-node"',
    "could not resolve: onnxruntime-node"
  ])) {
    const platform = context.platform ?? process.platform;
    const arch = context.arch ?? process.arch;
    return {
      class: "local_binding_missing",
      reason: platform === "darwin" && arch === "x64" ? "onnxruntime-node has no darwin/x64 native binding and the WASM fallback could not complete" : `onnxruntime-node has no usable native binding for ${platform}/${arch} and the WASM fallback could not complete`,
      retryable: false
    };
  }
  return {
    class: "local_runtime_error",
    reason: `the local embedding runtime failed: ${safeErrorDetail(primaryMessages[0])}`,
    retryable: false
  };
}
function dominantEmbeddingFailure(failures) {
  const counts = new Map;
  for (const failure of failures) {
    const key = `${failure.class}\x00${failure.reason}`;
    const current = counts.get(key);
    if (current)
      current.count += 1;
    else
      counts.set(key, { failure, count: 1 });
  }
  let dominant;
  for (const candidate of counts.values()) {
    if (!dominant || candidate.count > dominant.count)
      dominant = candidate;
  }
  return dominant?.failure;
}

// ../plugin/src/features/magic-context/memory/embedding-local.ts
import { readdirSync, statSync } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { workerData } from "node:worker_threads";

// ../plugin/src/features/magic-context/memory/embedding-worker-client.ts
import { Worker } from "node:worker_threads";
class EmbeddingWorkerClient {
  data;
  entry;
  timeoutMs;
  worker = null;
  nextId = 1;
  pending = new Map;
  disposed = false;
  constructor(data, entry = new URL(new URL(import.meta.url).pathname.endsWith(".ts") ? "./embedding-worker.ts" : "./embedding-worker.js", import.meta.url), timeoutMs = 5 * 60000) {
    this.data = data;
    this.entry = entry;
    this.timeoutMs = timeoutMs;
  }
  start() {
    if (this.disposed)
      throw new Error("embedding worker disposed");
    if (this.worker)
      return this.worker;
    const worker = new Worker(this.entry, { workerData: this.data });
    this.worker = worker;
    worker.unref();
    worker.on("message", (reply) => {
      if (this.worker !== worker)
        return;
      const request = this.pending.get(reply.id);
      if (!request)
        return;
      clearTimeout(request.timer);
      this.pending.delete(reply.id);
      if (reply.error)
        request.reject(new Error(reply.error));
      else
        request.resolve(reply);
      if (this.pending.size === 0)
        worker.unref();
    });
    const fail = (error) => {
      if (this.worker !== worker)
        return;
      this.worker = null;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
      log2("[magic-context] embedding worker exited unexpectedly:", error);
      worker.terminate();
    };
    worker.on("error", fail);
    worker.on("exit", (code) => fail(new Error(`embedding worker exited (${code})`)));
    return worker;
  }
  isRunning() {
    return this.worker !== null;
  }
  request(texts, signal) {
    if (signal?.aborted)
      return Promise.reject(new Error("embedding request aborted"));
    return new Promise((resolve, reject) => {
      const worker = this.start();
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.stop(new Error("embedding worker request timed out"));
      }, this.timeoutMs);
      const abort = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        signal?.removeEventListener("abort", abort);
        reject(new Error("embedding request aborted"));
        if (this.pending.size === 0)
          worker.unref();
      };
      signal?.addEventListener("abort", abort, { once: true });
      const cleanup = () => signal?.removeEventListener("abort", abort);
      this.pending.set(id, {
        timer,
        resolve: (reply) => {
          cleanup();
          resolve(reply);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        }
      });
      worker.ref();
      try {
        worker.postMessage({ id, texts });
      } catch (error) {
        this.stop(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  async stop(error) {
    const worker = this.worker;
    this.worker = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    await worker?.terminate();
  }
  async dispose() {
    this.disposed = true;
    await this.stop(new Error("embedding worker disposed"));
  }
}

// ../plugin/src/features/magic-context/memory/transformers-remote-host.ts
var DEFAULT_TRANSFORMERS_REMOTE_HOST = "https://huggingface.co/";
function readHuggingFaceEndpoint() {
  return globalThis.process?.env?.HF_ENDPOINT;
}
function configureTransformersRemoteHost(env, endpoint = readHuggingFaceEndpoint()) {
  const normalized = endpoint?.trim().replace(/\/+$/, "");
  env.remoteHost = normalized ? `${normalized}/` : DEFAULT_TRANSFORMERS_REMOTE_HOST;
}

// ../plugin/src/features/magic-context/memory/embedding-local.ts
var BUN_NAPI_TEARDOWN_FIX_VERSION = [1, 4, 0];
function currentLocalEmbeddingHost() {
  const bun = globalThis.Bun;
  const hasProcess = typeof process !== "undefined";
  const bunVersion = hasProcess && typeof process.versions?.bun === "string" ? process.versions.bun : undefined;
  return {
    isElectron: hasProcess && Boolean(process.versions?.electron),
    isBun: Boolean(bun) || Boolean(bunVersion),
    bunVersion,
    hasNodeFilesystem: hasProcess && (typeof process.versions?.node === "string" || typeof bunVersion === "string")
  };
}
function bunHasNapiTeardownFix(version) {
  const match = version?.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match || match[4])
    return false;
  const parsed = [Number(match[1]), Number(match[2]), Number(match[3])];
  return parsed.some((part) => !Number.isSafeInteger(part)) ? false : parsed[0] > BUN_NAPI_TEARDOWN_FIX_VERSION[0] || parsed[0] === BUN_NAPI_TEARDOWN_FIX_VERSION[0] && (parsed[1] > BUN_NAPI_TEARDOWN_FIX_VERSION[1] || parsed[1] === BUN_NAPI_TEARDOWN_FIX_VERSION[1] && parsed[2] >= BUN_NAPI_TEARDOWN_FIX_VERSION[2]);
}
function resolveLocalEmbeddingRuntime(preference = "auto", host = currentLocalEmbeddingHost()) {
  if (preference === "native" || preference === "wasm")
    return preference;
  if (host.isElectron)
    return "electron";
  if (host.isBun && !bunHasNapiTeardownFix(host.bunVersion))
    return "wasm";
  return "native";
}
function resolveLocalEmbeddingWorkerRuntime(preference = "auto", host = currentLocalEmbeddingHost()) {
  if (host.isBun && !bunHasNapiTeardownFix(host.bunVersion) && preference === "native")
    return "wasm";
  return resolveLocalEmbeddingRuntime(preference, host);
}
var LOCK_POLL_MS = 150;
var STALE_LOCK_MS = 3 * 60000;
var MAX_LOCK_WAIT_MS = 5 * 60000;
async function acquireModelLoadLock(lockPath) {
  const waitStart = Date.now();
  while (true) {
    try {
      const handle = await createStorageFileHandleAsync(lockPath, "wx");
      try {
        await writeStorageFileHandleAsync(handle, `pid=${process.pid} started=${Date.now()}
`);
      } catch {}
      await handle.close();
      return async () => {
        try {
          await unlink(lockPath);
        } catch {}
      };
    } catch (error) {
      const code = error.code;
      if (code !== "EEXIST" && code !== "EPERM") {
        throw error;
      }
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > STALE_LOCK_MS) {
          log2(`[magic-context] embedding-load lock stale (>${STALE_LOCK_MS}ms), taking over`);
          try {
            await unlink(lockPath);
          } catch {}
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - waitStart > MAX_LOCK_WAIT_MS) {
        throw new Error(`[magic-context] embedding-load lock wait exceeded ${MAX_LOCK_WAIT_MS}ms; another process is still loading the model. Skipping this init attempt to avoid an unsynchronized native load.`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
  }
}
function startLockHeartbeat(lockPath) {
  const HEARTBEAT_MS = Math.floor(STALE_LOCK_MS / 3);
  const timer = setInterval(() => {
    writeStorageFileAsync(lockPath, `pid=${process.pid} alive=${Date.now()}
`).catch(() => {});
  }, HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
var ONNX_RUNTIME_WEB_SPECIFIER = "onnxruntime-web";
var useInThreadTestRuntime = false;
var workerFactoryForTests;
var localEmbeddingRuntimeMode = "native";
var localEmbeddingProcessFailure = null;
var wasmRuntimeInjected = false;
var localEmbeddingHostForRuntime = currentLocalEmbeddingHost;
var resolveWasmOrtForRuntime = () => {
  try {
    return typeof import.meta.resolve === "function" ? import.meta.resolve(ONNX_RUNTIME_WEB_SPECIFIER) : undefined;
  } catch {
    return;
  }
};
var importWasmOrtModule = async (specifier) => await import(specifier);
var importWasmOrtModuleForRuntime = importWasmOrtModule;
var importWasmOrtForRuntime = async () => {
  const { createRequire: createRequireFn } = await import("node:module");
  const requireFn = createRequireFn(import.meta.url);
  const ortEntry = requireFn.resolve(ONNX_RUNTIME_WEB_SPECIFIER);
  const ortSpecifier = resolveWasmOrtForRuntime() ?? ONNX_RUNTIME_WEB_SPECIFIER;
  return {
    module: await importWasmOrtModuleForRuntime(ortSpecifier),
    entryPath: ortEntry
  };
};
var importTransformersForRuntime = async () => {
  return await importPluginModule(() => import("./transformers.node-4ydajnhd.js"));
};
var importTransformersWasmFallbackForRuntime = async () => {
  const webEntry = new URL(new URL(import.meta.url).pathname.endsWith(".ts") ? "../../../../dist/transformers-web.js" : "./transformers-web.js", import.meta.url).href;
  return await importPluginModule(() => import(webEntry));
};
var importTransformersNodeWasmFallbackForRuntime = async () => {
  const nodeWasmEntry = new URL(new URL(import.meta.url).pathname.endsWith(".ts") ? "../../../../dist/transformers-node-wasm.js" : "./transformers-node-wasm.js", import.meta.url).href;
  return await importPluginModule(() => import(nodeWasmEntry));
};
var modelCacheDirForRuntime = () => workerData?.magicContextEmbeddingWorker && typeof workerData.modelCacheDir === "string" ? workerData.modelCacheDir : join(getMagicContextStorageDir(), "models");
var logForRuntime = log2;
var injectWasmOrtForRuntime = injectWasmOrt;
var loadedLocalEmbeddingRuntimes = new Map;
var nextLocalEmbeddingRuntimeId = 1;
function directoryBytes(path) {
  let total = 0;
  try {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        const childBytes = directoryBytes(entryPath);
        if (childBytes === null)
          return null;
        total += childBytes;
      } else if (entry.isFile()) {
        total += statSync(entryPath).size;
      }
    }
    return total;
  } catch (error) {
    return error.code === "ENOENT" ? 0 : null;
  }
}
function getLocalEmbeddingNativeMemoryStats() {
  const loaded = [...loadedLocalEmbeddingRuntimes.values()];
  return {
    loaded: loaded.length > 0,
    providerCount: loaded.length,
    models: [...new Set(loaded.map((entry) => entry.model))].sort(),
    runtimes: [...new Set(loaded.map((entry) => entry.runtime))].sort(),
    modelCacheBytes: loaded.length > 0 ? directoryBytes(modelCacheDirForRuntime()) : 0,
    rssDeltaAtLoad: loaded.reduce((sum, entry) => sum + entry.rssDeltaAtLoad, 0),
    externalDeltaAtLoad: loaded.reduce((sum, entry) => sum + entry.externalDeltaAtLoad, 0),
    arrayBuffersDeltaAtLoad: loaded.reduce((sum, entry) => sum + entry.arrayBuffersDeltaAtLoad, 0)
  };
}
async function ensureWasmOrtInjected() {
  if (wasmRuntimeInjected)
    return true;
  if (!await injectWasmOrtForRuntime())
    return false;
  wasmRuntimeInjected = true;
  return true;
}
async function injectWasmOrt() {
  if (wasmRuntimeInjected)
    return true;
  try {
    const { module: ortWeb, entryPath } = await importWasmOrtForRuntime();
    if (ortWeb.env?.wasm) {
      ortWeb.env.wasm.numThreads = 1;
      ortWeb.env.wasm.wasmPaths = `${pathToFileURL(dirname(entryPath)).href}/`;
    }
    globalThis[Symbol.for("onnxruntime")] = ortWeb;
    wasmRuntimeInjected = true;
    return true;
  } catch (error) {
    log2("[magic-context] failed to inject onnxruntime-web:", error instanceof Error ? error.message : String(error));
    return false;
  }
}
function likelyMuslHint() {
  if (process.platform !== "linux" || typeof process.report?.getReport !== "function")
    return "";
  try {
    const report = process.report.getReport();
    return typeof report.header?.glibcVersionRuntime === "string" ? "" : " Linux process report has no glibc runtime version (musl likely).";
  } catch {
    return "";
  }
}
function localEmbeddingRuntimeIsDisabled() {
  return localEmbeddingRuntimeMode === "disabled";
}

class LocalEmbeddingFallbackError extends Error {
  nativeError;
  constructor(nativeError, wasmError) {
    super("the native local embedding runtime and its WASM fallback both failed", {
      cause: wasmError
    });
    this.name = "LocalEmbeddingFallbackError";
    this.nativeError = nativeError;
  }
}

class LocalEmbeddingFsUnavailableError extends Error {
  code = "MC_EMBEDDING_FS_UNAVAILABLE";
  constructor() {
    super("MC_EMBEDDING_FS_UNAVAILABLE: Node WASM bundle has no filesystem cache");
    this.name = "LocalEmbeddingFsUnavailableError";
  }
}
async function importWasmTransformersForHost() {
  const host = localEmbeddingHostForRuntime();
  if (host.isElectron) {
    return importTransformersForRuntime();
  }
  return host.hasNodeFilesystem ? importTransformersNodeWasmFallbackForRuntime() : importTransformersWasmFallbackForRuntime();
}
function disableLocalEmbeddingsAfterRuntimeFailure(detail) {
  localEmbeddingRuntimeMode = "disabled";
  logForRuntime(`[magic-context] local embeddings are disabled because both the onnxruntime-node native binding and the onnxruntime-web (WASM) fallback failed to load. Native failure: ${detail}. Run \`npx @cortexkit/magic-context@latest doctor\` for diagnostics; reinstalling repairs missing package files but cannot add a native binding that upstream does not ship. Alternatively, configure an \`openai-compatible\` embedding HTTP endpoint. Existing memories are unaffected.`);
}
async function loadTransformersForLocalEmbedding(runtimePreference) {
  if (localEmbeddingRuntimeMode === "disabled") {
    throw new Error("local embedding runtime is disabled");
  }
  const resolvedRuntime = resolveLocalEmbeddingRuntime(runtimePreference, localEmbeddingHostForRuntime());
  if (resolvedRuntime === "wasm") {
    if (!await ensureWasmOrtInjected()) {
      disableLocalEmbeddingsAfterRuntimeFailure("the selected WASM runtime is unavailable");
      throw new Error("onnxruntime-web failed to load");
    }
    return { module: await importWasmTransformersForHost(), usesWasm: true };
  }
  if (localEmbeddingRuntimeMode === "wasm") {
    if (!await ensureWasmOrtInjected()) {
      disableLocalEmbeddingsAfterRuntimeFailure("the previously selected WASM runtime is unavailable");
      throw new Error("onnxruntime-web failed to load");
    }
    try {
      return { module: await importWasmTransformersForHost(), usesWasm: true };
    } catch (wasmError) {
      disableLocalEmbeddingsAfterRuntimeFailure("the previously selected WASM runtime failed to load");
      throw wasmError;
    }
  }
  const electron = resolvedRuntime === "electron";
  if (electron) {
    const wasInjected = wasmRuntimeInjected;
    if (await ensureWasmOrtInjected()) {
      if (!wasInjected) {
        logForRuntime("[magic-context] Electron detected — using onnxruntime-web (WASM) for embeddings (bypasses onnxruntime-node native load)");
      }
      return { module: await importTransformersForRuntime(), usesWasm: true };
    }
  }
  try {
    return { module: await importTransformersForRuntime(), usesWasm: false };
  } catch (nativeError) {
    if (!isNativeRuntimeMissingError(nativeError) || electron) {
      throw nativeError;
    }
    if (!await ensureWasmOrtInjected()) {
      disableLocalEmbeddingsAfterRuntimeFailure(nativeError instanceof Error ? nativeError.message : String(nativeError));
      throw nativeError;
    }
    localEmbeddingRuntimeMode = "wasm";
    try {
      const module = await importWasmTransformersForHost();
      logForRuntime("[magic-context] onnxruntime-node failed to load; using onnxruntime-web (WASM) for local embeddings. WASM inference is slower than native; a remote `openai-compatible` provider may be faster." + likelyMuslHint());
      return { module, usesWasm: true };
    } catch (wasmError) {
      disableLocalEmbeddingsAfterRuntimeFailure(nativeError instanceof Error ? nativeError.message : String(nativeError));
      throw new LocalEmbeddingFallbackError(nativeError, wasmError);
    }
  }
}
var DEFAULT_LOCAL_DTYPE = "fp32";
async function withQuietConsole(fn) {
  const origWarn = console.warn;
  const origError = console.error;
  const redirect = (...args) => {
    const message = args.map((a) => typeof a === "string" ? a : String(a)).join(" ");
    log2(`[transformers] ${message}`);
  };
  console.warn = redirect;
  console.error = redirect;
  try {
    return await fn();
  } finally {
    console.warn = origWarn;
    console.error = origError;
  }
}
function isNativeRuntimeMissingError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  const code = error?.code;
  const name = error?.name;
  if (code === "ERR_DLOPEN_FAILED" && lower.includes("onnxruntime")) {
    return true;
  }
  if (lower.includes('could not load the "sharp" module'))
    return true;
  const mentionsNativeRuntime = lower.includes("onnxruntime-node") || lower.includes("onnxruntime_binding");
  if (!mentionsNativeRuntime)
    return false;
  return code === "ERR_MODULE_NOT_FOUND" || name === "ResolveMessage" || lower.includes("cannot find package") || lower.includes("cannot find module") || lower.includes("err_module_not_found");
}
function isTransientLoadError(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message)
    return false;
  const lower = message.toLowerCase();
  return lower.includes("protobuf parsing failed") || lower.includes("unable to get model file path or buffer") || lower.includes("ebusy") || lower.includes("resource busy") || lower.includes("resource temporarily unavailable");
}
function isArrayLikeNumber(value) {
  if (typeof value !== "object" || value === null || !("length" in value)) {
    return false;
  }
  const arr = value;
  if (typeof arr.length !== "number") {
    return false;
  }
  return arr.length === 0 || typeof arr[0] === "number";
}
function toFloat32Array(values) {
  return values instanceof Float32Array ? new Float32Array(values) : Float32Array.from(Array.from(values));
}
function extractBatchEmbeddings(result, expectedCount) {
  const { data } = result;
  if (Array.isArray(data) && data.length === expectedCount && data.every((entry) => typeof entry !== "number" && isArrayLikeNumber(entry))) {
    return data.map((entry) => toFloat32Array(entry));
  }
  if (!isArrayLikeNumber(data)) {
    log2("[magic-context] embedding batch returned unexpected data shape");
    return Array.from({ length: expectedCount }, () => null);
  }
  const flatData = toFloat32Array(data);
  const dimension = result.dims?.at(-1) ?? flatData.length / expectedCount;
  if (!Number.isInteger(dimension) || dimension <= 0 || flatData.length !== expectedCount * dimension) {
    log2("[magic-context] embedding batch returned invalid dimensions");
    return Array.from({ length: expectedCount }, () => null);
  }
  const embeddings = [];
  for (let index = 0;index < expectedCount; index++) {
    embeddings.push(flatData.slice(index * dimension, (index + 1) * dimension));
  }
  return embeddings;
}

class LocalEmbeddingProvider {
  modelId;
  maxInputTokens;
  memoryStatsId = nextLocalEmbeddingRuntimeId++;
  model;
  dtype;
  runtimePreference;
  pipeline = null;
  workerClient;
  workerLoaded = false;
  initPromise = null;
  lastFailureReason = null;
  usesWasm = false;
  inFlight = 0;
  disposing = false;
  disposePromise = null;
  inFlightWaiters = [];
  constructor(model = DEFAULT_LOCAL_EMBEDDING_MODEL, maxInputTokens = 512, dtype = DEFAULT_LOCAL_DTYPE, runtimePreference = "auto") {
    this.model = model;
    this.maxInputTokens = maxInputTokens;
    this.dtype = dtype || DEFAULT_LOCAL_DTYPE;
    this.runtimePreference = runtimePreference;
    this.workerClient = !workerData?.magicContextEmbeddingWorker && !useInThreadTestRuntime ? (workerFactoryForTests ?? ((data) => new EmbeddingWorkerClient(data)))({
      magicContextEmbeddingWorker: true,
      modelCacheDir: modelCacheDirForRuntime(),
      enforcePrivateStoragePermissions: shouldEnforcePrivateStoragePermissions(),
      harness: getHarness2(),
      model,
      maxInputTokens,
      dtype: this.dtype,
      runtimePreference
    }) : null;
    this.modelId = getEmbeddingProviderIdentity({
      provider: "local",
      model,
      local_runtime: runtimePreference,
      ...dtype && dtype !== DEFAULT_LOCAL_DTYPE ? { local_dtype: dtype } : {}
    });
  }
  async initialize() {
    if (this.workerClient && !this.disposing) {
      if (this.workerLoaded && this.workerClient.isRunning())
        return true;
      try {
        const reply = await this.workerClient.request();
        this.recordWorkerReply(reply);
        return reply.loaded;
      } catch (error) {
        this.recordWorkerFailure(error);
        return false;
      }
    }
    if (this.disposing) {
      return false;
    }
    if (this.pipeline) {
      return true;
    }
    if (localEmbeddingRuntimeMode === "disabled") {
      this.lastFailureReason = localEmbeddingProcessFailure ?? classifyLocalEmbeddingFailure(new Error("local embedding runtime is disabled"));
      return false;
    }
    if (this.initPromise) {
      await this.initPromise;
      return this.pipeline !== null;
    }
    const memoryBeforeLoad = process.memoryUsage();
    this.initPromise = (async () => {
      try {
        if (this.disposing) {
          return;
        }
        const { module: transformersModule, usesWasm } = await loadTransformersForLocalEmbedding(this.runtimePreference);
        this.usesWasm = usesWasm;
        const env = transformersModule.env;
        configureTransformersRemoteHost(env);
        const LogLevel = transformersModule.LogLevel;
        if (LogLevel && "ERROR" in LogLevel) {
          env.logLevel = LogLevel.ERROR;
        }
        const host = localEmbeddingHostForRuntime();
        if (usesWasm && host.hasNodeFilesystem && !host.isElectron && (env.useFS !== true || env.useFSCache !== true)) {
          throw new LocalEmbeddingFsUnavailableError;
        }
        const modelCacheDir = modelCacheDirForRuntime();
        try {
          ensureStorageDirectorySync(modelCacheDir);
          env.cacheDir = modelCacheDir;
        } catch {
          log2("[magic-context] could not create model cache dir, using library default");
        }
        const createPipeline = transformersModule.pipeline;
        const lockPath = join(modelCacheDir, ".load.lock");
        const releaseLock = await acquireModelLoadLock(lockPath);
        const stopHeartbeat = startLockHeartbeat(lockPath);
        try {
          const MAX_ATTEMPTS = 3;
          let lastError;
          for (let attempt = 1;attempt <= MAX_ATTEMPTS; attempt++) {
            try {
              const pipeline = await withQuietConsole(() => createPipeline("feature-extraction", this.model, {
                dtype: this.dtype,
                ...usesWasm ? { device: "auto" } : {}
              }));
              if (this.disposing) {
                await pipeline.dispose?.();
                this.pipeline = null;
              } else {
                this.pipeline = pipeline;
              }
              lastError = undefined;
              break;
            } catch (error) {
              lastError = error;
              if (!isTransientLoadError(error) || attempt === MAX_ATTEMPTS) {
                break;
              }
              const delayMs = 300 * attempt + Math.floor(Math.random() * 200);
              log2(`[magic-context] embedding model load attempt ${attempt}/${MAX_ATTEMPTS} failed transiently, retrying in ${delayMs}ms`);
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
          }
          if (this.pipeline) {
            this.lastFailureReason = null;
            localEmbeddingProcessFailure = null;
            const memoryAfterLoad = process.memoryUsage();
            loadedLocalEmbeddingRuntimes.set(this.memoryStatsId, {
              model: this.model,
              runtime: this.usesWasm ? "wasm" : "native",
              rssDeltaAtLoad: memoryAfterLoad.rss - memoryBeforeLoad.rss,
              externalDeltaAtLoad: memoryAfterLoad.external - memoryBeforeLoad.external,
              arrayBuffersDeltaAtLoad: memoryAfterLoad.arrayBuffers - memoryBeforeLoad.arrayBuffers
            });
            log2(`[magic-context] embedding model loaded: ${this.model}`);
          } else if (this.disposing) {
            return;
          } else {
            throw lastError ?? new Error("unknown embedding load failure");
          }
        } finally {
          stopHeartbeat();
          await releaseLock();
        }
      } catch (error) {
        const nativeError = error instanceof LocalEmbeddingFallbackError ? error.nativeError : undefined;
        const failure = classifyLocalEmbeddingFailure(error, {
          platform: process.platform,
          arch: process.arch,
          usesWasm: this.usesWasm,
          nativeError
        });
        this.lastFailureReason = failure;
        localEmbeddingProcessFailure = failure;
        if (!localEmbeddingRuntimeIsDisabled() && isNativeRuntimeMissingError(error)) {
          disableLocalEmbeddingsAfterRuntimeFailure(error instanceof Error ? error.message : String(error));
        }
        logForRuntime(`[magic-context] embedding model failed to load (${failure.class}: ${failure.reason}):`, error);
        this.pipeline = null;
      } finally {
        this.initPromise = null;
      }
    })();
    await this.initPromise;
    return this.pipeline !== null;
  }
  waitForInFlightToDrain() {
    if (this.inFlight === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.inFlightWaiters.push(resolve);
    });
  }
  finishInFlight() {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (this.inFlight !== 0)
      return;
    const waiters = this.inFlightWaiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }
  async embed(text, signal, _purpose) {
    if (this.workerClient)
      return (await this.embedBatch([text], signal, _purpose))[0] ?? null;
    if (signal?.aborted)
      return null;
    if (this.disposing)
      return null;
    this.inFlight += 1;
    try {
      if (!await this.initialize()) {
        return null;
      }
      const pipeline = this.pipeline;
      if (!pipeline) {
        return null;
      }
      const result = await withQuietConsole(() => pipeline(text, {
        pooling: "mean",
        normalize: true
      }));
      const embedding = extractBatchEmbeddings(result, 1)[0] ?? null;
      if (!embedding) {
        this.lastFailureReason = classifyLocalEmbeddingFailure(new Error("local embedding pipeline returned no vector"), { usesWasm: this.usesWasm });
      } else {
        this.lastFailureReason = null;
      }
      return embedding;
    } catch (error) {
      const failure = classifyLocalEmbeddingFailure(error, { usesWasm: this.usesWasm });
      this.lastFailureReason = failure;
      logForRuntime(`[magic-context] embedding failed (${failure.class}: ${failure.reason}):`, error);
      return null;
    } finally {
      this.finishInFlight();
    }
  }
  async embedBatch(texts, signal, _purpose) {
    if (this.workerClient) {
      if (!texts.length)
        return [];
      if (signal?.aborted || this.disposing)
        return texts.map(() => null);
      try {
        const reply = await this.workerClient.request(texts, signal);
        this.recordWorkerReply(reply);
        return reply.vectors ?? texts.map(() => null);
      } catch (error) {
        this.recordWorkerFailure(error);
        return texts.map(() => null);
      }
    }
    if (texts.length === 0) {
      return [];
    }
    if (signal?.aborted) {
      return Array.from({ length: texts.length }, () => null);
    }
    if (this.disposing) {
      return Array.from({ length: texts.length }, () => null);
    }
    this.inFlight += 1;
    try {
      if (!await this.initialize()) {
        return Array.from({ length: texts.length }, () => null);
      }
      const pipeline = this.pipeline;
      if (!pipeline) {
        return Array.from({ length: texts.length }, () => null);
      }
      const result = await withQuietConsole(() => pipeline(texts, {
        pooling: "mean",
        normalize: true
      }));
      const embeddings = extractBatchEmbeddings(result, texts.length);
      if (embeddings.every((embedding) => embedding === null)) {
        this.lastFailureReason = classifyLocalEmbeddingFailure(new Error("local embedding pipeline returned no vectors"), { usesWasm: this.usesWasm });
      } else {
        this.lastFailureReason = null;
      }
      return embeddings;
    } catch (error) {
      const failure = classifyLocalEmbeddingFailure(error, { usesWasm: this.usesWasm });
      this.lastFailureReason = failure;
      logForRuntime(`[magic-context] embedding batch failed (${failure.class}: ${failure.reason}):`, error);
      return Array.from({ length: texts.length }, () => null);
    } finally {
      this.finishInFlight();
    }
  }
  recordWorkerReply(reply) {
    this.workerLoaded = reply.loaded;
    this.lastFailureReason = reply.failure ?? null;
    if (reply.loaded && reply.stats) {
      loadedLocalEmbeddingRuntimes.set(this.memoryStatsId, {
        model: this.model,
        runtime: reply.stats.runtimes[0] ?? "wasm",
        rssDeltaAtLoad: reply.stats.rssDeltaAtLoad,
        externalDeltaAtLoad: reply.stats.externalDeltaAtLoad,
        arrayBuffersDeltaAtLoad: reply.stats.arrayBuffersDeltaAtLoad
      });
    } else
      loadedLocalEmbeddingRuntimes.delete(this.memoryStatsId);
  }
  recordWorkerFailure(error) {
    loadedLocalEmbeddingRuntimes.delete(this.memoryStatsId);
    this.workerLoaded = false;
    this.lastFailureReason = classifyLocalEmbeddingFailure(error);
    logForRuntime("[magic-context] embedding worker failed:", error);
  }
  async dispose() {
    if (this.workerClient) {
      this.disposing = true;
      this.workerLoaded = false;
      loadedLocalEmbeddingRuntimes.delete(this.memoryStatsId);
      await this.workerClient.dispose();
      return;
    }
    if (this.disposePromise) {
      return this.disposePromise;
    }
    this.disposing = true;
    this.disposePromise = (async () => {
      if (this.initPromise) {
        await this.initPromise;
      }
      await this.waitForInFlightToDrain();
      const pipelineToDispose = this.pipeline;
      this.pipeline = null;
      this.initPromise = null;
      loadedLocalEmbeddingRuntimes.delete(this.memoryStatsId);
      if (!pipelineToDispose) {
        return;
      }
      try {
        await pipelineToDispose.dispose?.();
      } catch (error) {
        log2("[magic-context] embedding model dispose failed:", error);
      }
    })();
    return this.disposePromise;
  }
  isLoaded() {
    return this.workerClient ? this.workerLoaded && this.workerClient.isRunning() : this.pipeline !== null;
  }
  getLastFailureReason() {
    return this.lastFailureReason;
  }
}

export { isValidLanguageCode, withContentLanguageDirective, buildPrimaryLanguageDirective, parseCron, nextOccurrence, nextDueAtMs, resolveModelConfigValue, resolvePromptSurface, DEFAULT_EXECUTE_THRESHOLD_PERCENTAGE, DEFAULT_HISTORIAN_TIMEOUT_MS, PROTECTED_TOKENS_MIN, DEFAULT_LOCAL_EMBEDDING_MODEL, PER_HARNESS_MIGRATION_INVENTORY, PER_HARNESS_MODEL_KEYS, ConfigProfilesSchema, DREAM_TASK_PROMOTION_DEFAULTS, MagicContextConfigSchema, LIVE_RELOAD_CONFIG_PATHS, deriveDefaultProtectedTokens, embeddingModelsMatch, resolveEmbeddingTextPrefixes, getEmbeddingProviderIdentity, dominantEmbeddingFailure, resolveLocalEmbeddingWorkerRuntime, getLocalEmbeddingNativeMemoryStats, LocalEmbeddingProvider };
