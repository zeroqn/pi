import {
  DEFAULT_LOCAL_EMBEDDING_MODEL
} from "./index-cyrnv16r.js";
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
} from "./index-81nthk8j.js";

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
import { fork } from "node:child_process";
import { Worker } from "node:worker_threads";

// ../plugin/src/features/magic-context/memory/onnx-telemetry.ts
import { isMainThread } from "node:worker_threads";
var FFI_SPECIFIER = "bun:ffi";
async function prepareNativeOnnxTelemetry() {
  if (process.platform === "win32")
    return true;
  if (!process.versions.bun) {
    if (!isMainThread)
      return false;
    process.env.ORT_DISABLE_TELEMETRY = "1";
    return true;
  }
  let ffi;
  try {
    ffi = await import(FFI_SPECIFIER);
  } catch {
    return false;
  }
  const { dlopen, FFIType } = ffi;
  const paths = process.platform === "darwin" ? ["/usr/lib/libSystem.B.dylib"] : ["libc.so.6", `/lib/ld-musl-${process.arch === "arm64" ? "aarch64" : "x86_64"}.so.1`];
  for (const path of paths) {
    try {
      const library = dlopen(path, {
        setenv: {
          args: [FFIType.cstring, FFIType.cstring, FFIType.i32],
          returns: FFIType.i32
        },
        getenv: { args: [FFIType.cstring], returns: FFIType.cstring }
      });
      try {
        const name = Buffer.from("ORT_DISABLE_TELEMETRY\x00");
        const value = Buffer.from("1\x00");
        const disabled = library.symbols.setenv(name, value, 1) === 0 && String(library.symbols.getenv(name)) === "1";
        if (disabled)
          process.env.ORT_DISABLE_TELEMETRY = "1";
        return disabled;
      } finally {
        library.close();
      }
    } catch {}
  }
  return false;
}

// ../plugin/src/features/magic-context/memory/embedding-worker-client.ts
var warnedWindowsTelemetry = false;

class EmbeddingWorkerClient {
  data;
  entry;
  timeoutMs;
  prepareTelemetry;
  worker = null;
  startPromise = null;
  nextId = 1;
  pending = new Map;
  disposed = false;
  constructor(data, entry = new URL(new URL(import.meta.url).pathname.endsWith(".ts") ? "./embedding-worker.ts" : "./embedding-worker.js", import.meta.url), timeoutMs = 5 * 60000, prepareTelemetry = prepareNativeOnnxTelemetry) {
    this.data = data;
    this.entry = entry;
    this.timeoutMs = timeoutMs;
    this.prepareTelemetry = prepareTelemetry;
  }
  start() {
    if (this.startPromise)
      return this.startPromise;
    this.startPromise = this.startOwner().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }
  async startOwner() {
    if (this.disposed)
      throw new Error("embedding worker disposed");
    if (this.worker)
      return this.worker;
    const compiledBun = process.versions.bun && globalThis.Bun?.isStandaloneExecutable;
    const inProcess = !compiledBun && await this.prepareTelemetry();
    if (this.disposed)
      throw new Error("embedding worker disposed");
    const worker = inProcess ? new Worker(this.entry, { workerData: this.data }) : fork(new URL(new URL(import.meta.url).pathname.endsWith(".ts") ? "./embedding-worker-process.ts" : "./embedding-worker-process.js", import.meta.url), [], {
      env: {
        ...process.env,
        ORT_DISABLE_TELEMETRY: "1",
        ...process.versions.bun ? { BUN_BE_BUN: "1" } : {}
      },
      execArgv: [],
      serialization: "json",
      ...{ windowsHide: true },
      stdio: ["ignore", "inherit", "inherit", "ipc"]
    });
    if (process.platform === "win32" && this.data.runtimePreference !== "wasm") {
      if (!warnedWindowsTelemetry) {
        warnedWindowsTelemetry = true;
        const warning = "[magic-context] ORT_DISABLE_TELEMETRY=1 prevents ONNX uploads on POSIX. Windows native ONNX uses OS-controlled ETW diagnostics instead and exposes no JavaScript telemetry-disable API; Windows diagnostic settings and trace collectors govern collection.";
        log2(warning);
      }
    }
    this.worker = worker;
    worker.unref();
    if (!(worker instanceof Worker))
      worker.channel?.unref?.();
    worker.on("message", (wire) => {
      const reply = worker instanceof Worker ? wire : {
        ...wire,
        vectors: wire.vectors?.map((vector) => vector === null ? null : new Float32Array(Uint8Array.from(Buffer.from(vector, "base64")).buffer))
      };
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
      if (this.pending.size === 0) {
        worker.unref();
        if (!(worker instanceof Worker))
          worker.channel?.unref?.();
      }
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
      if (worker instanceof Worker)
        worker.terminate();
      else
        worker.kill();
    };
    worker.on("error", fail);
    worker.on("exit", (code, signal) => fail(new Error(`embedding worker exited (${signal ?? code})`)));
    if (!(worker instanceof Worker))
      worker.send({ entry: this.entry.href, data: this.data });
    return worker;
  }
  isRunning() {
    return this.worker !== null;
  }
  async request(texts, signal) {
    if (signal?.aborted)
      return Promise.reject(new Error("embedding request aborted"));
    const worker = await this.start();
    if (this.disposed)
      throw new Error("embedding worker disposed");
    if (signal?.aborted)
      throw new Error("embedding request aborted");
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.stop(new Error("embedding worker request timed out"));
      }, this.timeoutMs);
      const abort = () => {
        clearTimeout(timer);
        this.pending.delete(id);
        signal?.removeEventListener("abort", abort);
        reject(new Error("embedding request aborted"));
        if (this.pending.size === 0) {
          worker.unref();
          if (!(worker instanceof Worker))
            worker.channel?.unref?.();
        }
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
      if (!(worker instanceof Worker))
        worker.channel?.ref?.();
      try {
        if (worker instanceof Worker)
          worker.postMessage({ id, texts });
        else
          worker.send({ id, texts }, (error) => {
            if (error && this.worker === worker)
              this.stop(error);
          });
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
    if (worker instanceof Worker) {
      await worker.terminate();
    } else if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.ref();
      worker.channel?.ref?.();
      await new Promise((resolve) => {
        worker.once("exit", () => resolve());
        worker.kill();
      });
    }
  }
  async dispose() {
    this.disposed = true;
    await this.startPromise?.catch(() => {});
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
function getLoadedLocalEmbeddingRuntimes() {
  return [
    ...new Set([...loadedLocalEmbeddingRuntimes.values()].map((entry) => entry.runtime))
  ].sort();
}
function getLocalEmbeddingNativeMemoryStats() {
  const loaded = [...loadedLocalEmbeddingRuntimes.values()];
  return {
    loaded: loaded.length > 0,
    providerCount: loaded.length,
    models: [...new Set(loaded.map((entry) => entry.model))].sort(),
    runtimes: getLoadedLocalEmbeddingRuntimes(),
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

export { embeddingModelsMatch, resolveEmbeddingTextPrefixes, getEmbeddingProviderIdentity, dominantEmbeddingFailure, resolveLocalEmbeddingWorkerRuntime, getLoadedLocalEmbeddingRuntimes, getLocalEmbeddingNativeMemoryStats, LocalEmbeddingProvider };
