import {
  assertSync2,
  EvalFlags2,
  IntrinsicsFlags2,
  JSPromiseStateEnum2,
  GetOwnPropertyNamesFlags2,
  IsEqualOp2,
  setDebugMode2,
  debugLog2,
  errors_exports,
  QuickJSMemoryLeakDetected,
  QuickJSEmscriptenModuleError,
  UsingDisposable2,
  Lifetime2,
  StaticLifetime2,
  WeakLifetime2,
  Scope2,
  createDisposableArray2,
  DisposableSuccess2,
  DisposableFail2,
  DisposableResult2,
  QuickJSDeferredPromise2,
  DefaultIntrinsics2,
  QuickJSContext2,
  QuickJSRuntime2,
  QuickJSWASMModule2,
  QuickJSAsyncContext2,
  QuickJSAsyncRuntime2,
  QuickJSAsyncWASMModule2
} from "./index-g20jdh0p.js";

// ../../node_modules/.bun/quickjs-emscripten-core@0.32.0/node_modules/quickjs-emscripten-core/dist/index.mjs
async function newQuickJSWASMModuleFromVariant(variantOrPromise) {
  let variant = smartUnwrap(await variantOrPromise), [wasmModuleLoader, QuickJSFFI, { QuickJSWASMModule: QuickJSWASMModule2 }] = await Promise.all([variant.importModuleLoader().then(smartUnwrap), variant.importFFI(), import("./module-ES6BEMUI-3cet1pyp.js").then(smartUnwrap)]), wasmModule = await wasmModuleLoader();
  wasmModule.type = "sync";
  let ffi = new QuickJSFFI(wasmModule);
  return new QuickJSWASMModule2(wasmModule, ffi);
}
async function newQuickJSAsyncWASMModuleFromVariant(variantOrPromise) {
  let variant = smartUnwrap(await variantOrPromise), [wasmModuleLoader, QuickJSAsyncFFI, { QuickJSAsyncWASMModule: QuickJSAsyncWASMModule2 }] = await Promise.all([variant.importModuleLoader().then(smartUnwrap), variant.importFFI(), import("./module-asyncify-2EFITU5U-c2razzd9.js").then(smartUnwrap)]), wasmModule = await wasmModuleLoader();
  wasmModule.type = "async";
  let ffi = new QuickJSAsyncFFI(wasmModule);
  return new QuickJSAsyncWASMModule2(wasmModule, ffi);
}
function memoizePromiseFactory(fn) {
  let promise;
  return () => promise ?? (promise = fn());
}
function smartUnwrap(val) {
  return val && "default" in val && val.default ? val.default && "default" in val.default && val.default.default ? val.default.default : val.default : val;
}
function newVariant(baseVariant, options) {
  return { ...baseVariant, async importModuleLoader() {
    let moduleLoader = smartUnwrap(await baseVariant.importModuleLoader());
    return async function() {
      let moduleLoaderArg = options.emscriptenModule ? { ...options.emscriptenModule } : {}, log = options.log ?? ((...args) => debugLog2("newVariant moduleLoader:", ...args)), tapValue = (message, val) => (log(...message, val), val), force = (val) => typeof val == "function" ? val() : val;
      (options.wasmLocation || options.wasmSourceMapLocation || options.locateFile) && (moduleLoaderArg.locateFile = (fileName, relativeTo) => {
        let args = { fileName, relativeTo };
        if (fileName.endsWith(".wasm") && options.wasmLocation !== undefined)
          return tapValue(["locateFile .wasm: provide wasmLocation", args], options.wasmLocation);
        if (fileName.endsWith(".map")) {
          if (options.wasmSourceMapLocation !== undefined)
            return tapValue(["locateFile .map: provide wasmSourceMapLocation", args], options.wasmSourceMapLocation);
          if (options.wasmLocation && !options.locateFile)
            return tapValue(["locateFile .map: infer from wasmLocation", args], options.wasmLocation + ".map");
        }
        return options.locateFile ? tapValue(["locateFile: use provided fn", args], options.locateFile(fileName, relativeTo)) : tapValue(["locateFile: unhandled, passthrough", args], fileName);
      }), options.wasmBinary && (moduleLoaderArg.wasmBinary = await force(options.wasmBinary)), options.wasmMemory && (moduleLoaderArg.wasmMemory = await force(options.wasmMemory));
      let optionsWasmModule = options.wasmModule, modulePromise;
      optionsWasmModule && (moduleLoaderArg.instantiateWasm = async (imports, onSuccess) => {
        modulePromise ?? (modulePromise = Promise.resolve(force(optionsWasmModule)));
        let wasmModule = await modulePromise;
        if (!wasmModule)
          throw new QuickJSEmscriptenModuleError(`options.wasmModule returned ${String(wasmModule)}`);
        let instance = await WebAssembly.instantiate(wasmModule, imports);
        return onSuccess(instance), instance.exports;
      }), moduleLoaderArg.monitorRunDependencies = (left) => {
        log("monitorRunDependencies:", left);
      }, moduleLoaderArg.quickjsEmscriptenInit = () => newMockExtensions(log);
      let resultPromise = moduleLoader(moduleLoaderArg), extensions = moduleLoaderArg.quickjsEmscriptenInit?.(log);
      if (optionsWasmModule && extensions?.receiveWasmOffsetConverter && !extensions.existingWasmOffsetConverter) {
        let wasmBinary = await force(options.wasmBinary) ?? new ArrayBuffer(0);
        modulePromise ?? (modulePromise = Promise.resolve(force(optionsWasmModule)));
        let wasmModule = await modulePromise;
        if (!wasmModule)
          throw new QuickJSEmscriptenModuleError(`options.wasmModule returned ${String(wasmModule)}`);
        extensions.receiveWasmOffsetConverter(wasmBinary, wasmModule);
      }
      if (extensions?.receiveSourceMapJSON) {
        let loadedSourceMapData = await force(options.wasmSourceMapData);
        typeof loadedSourceMapData == "string" ? extensions.receiveSourceMapJSON(JSON.parse(loadedSourceMapData)) : loadedSourceMapData ? extensions.receiveSourceMapJSON(loadedSourceMapData) : extensions.receiveSourceMapJSON({ version: 3, names: [], sources: [], mappings: "" });
      }
      return resultPromise;
    };
  } };
}
function newMockExtensions(log) {
  let mockMessage = "mock called, emscripten module may not be initialized yet";
  return { mock: true, removeRunDependency(name) {
    log(`${mockMessage}: removeRunDependency called:`, name);
  }, receiveSourceMapJSON(data) {
    log(`${mockMessage}: receiveSourceMapJSON called:`, data);
  }, WasmOffsetConverter: undefined, receiveWasmOffsetConverter(bytes, mod) {
    log(`${mockMessage}: receiveWasmOffsetConverter called:`, bytes, mod);
  } };
}
function isSuccess(successOrFail) {
  return !("error" in successOrFail);
}
function isFail(successOrFail) {
  return "error" in successOrFail;
}
function shouldInterruptAfterDeadline(deadline) {
  let deadlineAsNumber = typeof deadline == "number" ? deadline : deadline.getTime();
  return function() {
    return Date.now() > deadlineAsNumber;
  };
}
var TestQuickJSWASMModule = class {
  constructor(parent) {
    this.parent = parent;
    this.contexts = new Set;
    this.runtimes = new Set;
  }
  newRuntime(options) {
    let runtime = this.parent.newRuntime({ ...options, ownedLifetimes: [new Lifetime2(undefined, undefined, () => this.runtimes.delete(runtime)), ...options?.ownedLifetimes ?? []] });
    return this.runtimes.add(runtime), runtime;
  }
  newContext(options) {
    let context = this.parent.newContext({ ...options, ownedLifetimes: [new Lifetime2(undefined, undefined, () => this.contexts.delete(context)), ...options?.ownedLifetimes ?? []] });
    return this.contexts.add(context), context;
  }
  evalCode(code, options) {
    return this.parent.evalCode(code, options);
  }
  disposeAll() {
    let allDisposables = [...this.contexts, ...this.runtimes];
    this.runtimes.clear(), this.contexts.clear(), allDisposables.forEach((d) => {
      d.alive && d.dispose();
    });
  }
  assertNoMemoryAllocated() {
    if (this.getFFI().QTS_RecoverableLeakCheck())
      throw new QuickJSMemoryLeakDetected("Leak sanitizer detected un-freed memory");
    if (this.contexts.size > 0)
      throw new QuickJSMemoryLeakDetected(`${this.contexts.size} contexts leaked`);
    if (this.runtimes.size > 0)
      throw new QuickJSMemoryLeakDetected(`${this.runtimes.size} runtimes leaked`);
  }
  getWasmMemory() {
    return this.parent.getWasmMemory();
  }
  getFFI() {
    return this.parent.getFFI();
  }
};

// ../../node_modules/.bun/@jitl+quickjs-wasmfile-debug-sync@0.32.0/node_modules/@jitl/quickjs-wasmfile-debug-sync/dist/index.mjs
var variant = { type: "sync", importFFI: () => import("./ffi-bpvkebwr.js").then((mod) => mod.QuickJSFFI), importModuleLoader: () => import("./emscripten-module-pj1vyb44.js").then((mod) => mod.default) };
var src_default = variant;

// ../../node_modules/.bun/@jitl+quickjs-wasmfile-release-sync@0.32.0/node_modules/@jitl/quickjs-wasmfile-release-sync/dist/index.mjs
var variant2 = { type: "sync", importFFI: () => import("./ffi-3cx1cxpk.js").then((mod) => mod.QuickJSFFI), importModuleLoader: () => import("./emscripten-module-e67xwsp3.js").then((mod) => mod.default) };
var src_default2 = variant2;

// ../../node_modules/.bun/@jitl+quickjs-wasmfile-debug-asyncify@0.32.0/node_modules/@jitl/quickjs-wasmfile-debug-asyncify/dist/index.mjs
var variant3 = { type: "async", importFFI: () => import("./ffi-7e6gryj5.js").then((mod) => mod.QuickJSAsyncFFI), importModuleLoader: () => import("./emscripten-module-0pekdjxz.js").then((mod) => mod.default) };
var src_default3 = variant3;

// ../../node_modules/.bun/@jitl+quickjs-wasmfile-release-asyncify@0.32.0/node_modules/@jitl/quickjs-wasmfile-release-asyncify/dist/index.mjs
var variant4 = { type: "async", importFFI: () => import("./ffi-7bqqe4cd.js").then((mod) => mod.QuickJSAsyncFFI), importModuleLoader: () => import("./emscripten-module-0g8f45e6.js").then((mod) => mod.default) };
var src_default4 = variant4;

// ../../node_modules/.bun/quickjs-emscripten@0.32.0/node_modules/quickjs-emscripten/dist/chunk-OHAYRCBA.mjs
async function newQuickJSWASMModule(variantOrPromise = src_default2) {
  return newQuickJSWASMModuleFromVariant(variantOrPromise);
}
async function newQuickJSAsyncWASMModule(variantOrPromise = src_default4) {
  return newQuickJSAsyncWASMModuleFromVariant(variantOrPromise);
}

// ../../node_modules/.bun/quickjs-emscripten@0.32.0/node_modules/quickjs-emscripten/dist/index.mjs
var singleton;
var singletonPromise;
async function getQuickJS() {
  return singletonPromise ?? (singletonPromise = newQuickJSWASMModule().then((instance) => (singleton = instance, instance))), await singletonPromise;
}
function getQuickJSSync() {
  if (!singleton)
    throw new Error("QuickJS not initialized. Await getQuickJS() at least once.");
  return singleton;
}
async function newAsyncRuntime(options) {
  return (await newQuickJSAsyncWASMModule()).newRuntime(options);
}
async function newAsyncContext(options) {
  return (await newQuickJSAsyncWASMModule()).newContext(options);
}
export {
  src_default3 as DEBUG_ASYNC,
  src_default as DEBUG_SYNC,
  DefaultIntrinsics2 as DefaultIntrinsics,
  DisposableFail2 as DisposableFail,
  DisposableResult2 as DisposableResult,
  DisposableSuccess2 as DisposableSuccess,
  EvalFlags2 as EvalFlags,
  GetOwnPropertyNamesFlags2 as GetOwnPropertyNamesFlags,
  IntrinsicsFlags2 as IntrinsicsFlags,
  IsEqualOp2 as IsEqualOp,
  JSPromiseStateEnum2 as JSPromiseStateEnum,
  Lifetime2 as Lifetime,
  QuickJSAsyncContext2 as QuickJSAsyncContext,
  QuickJSAsyncRuntime2 as QuickJSAsyncRuntime,
  QuickJSAsyncWASMModule2 as QuickJSAsyncWASMModule,
  QuickJSContext2 as QuickJSContext,
  QuickJSDeferredPromise2 as QuickJSDeferredPromise,
  QuickJSRuntime2 as QuickJSRuntime,
  QuickJSWASMModule2 as QuickJSWASMModule,
  src_default4 as RELEASE_ASYNC,
  src_default2 as RELEASE_SYNC,
  Scope2 as Scope,
  StaticLifetime2 as StaticLifetime,
  TestQuickJSWASMModule,
  UsingDisposable2 as UsingDisposable,
  WeakLifetime2 as WeakLifetime,
  assertSync2 as assertSync,
  createDisposableArray2 as createDisposableArray,
  debugLog2 as debugLog,
  errors_exports as errors,
  getQuickJS,
  getQuickJSSync,
  isFail,
  isSuccess,
  memoizePromiseFactory,
  newAsyncContext,
  newAsyncRuntime,
  newQuickJSAsyncWASMModule,
  newQuickJSAsyncWASMModuleFromVariant,
  newQuickJSWASMModule,
  newQuickJSWASMModuleFromVariant,
  newVariant,
  setDebugMode2 as setDebugMode,
  shouldInterruptAfterDeadline
};
