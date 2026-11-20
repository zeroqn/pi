import {
  registerExitAbort,
  unregisterExitAbort
} from "./index-8sqebjzk.js";
import {
  inRootAsyncContext2
} from "./index-2qtx0q6h.js";

// ../plugin/src/shared/reusable-worker.ts
import { EventEmitter } from "node:events";
import * as timers from "node:timers";
import {
  MessageChannel,
  receiveMessageOnPort,
  Worker
} from "node:worker_threads";
var pools = new Map;
var liveSlots = new Set;
var nextId = 0;
var IDLE_MS = 60000;
var sharedCloneWorks = (() => {
  const source = new SharedArrayBuffer(1);
  const clone = structuredClone(source);
  new Uint8Array(source)[0] = 1;
  return new Uint8Array(clone)[0] === 1;
})();
var cloneChannel;
function cloneJobValue(value, transferList) {
  if (sharedCloneWorks)
    return structuredClone(value, { transfer: transferList });
  if (!cloneChannel) {
    cloneChannel = inRootAsyncContext2(() => new MessageChannel);
    cloneChannel.port1.unref();
    cloneChannel.port2.unref();
  }
  cloneChannel.port1.postMessage(value, transferList);
  const packet = receiveMessageOnPort(cloneChannel.port2);
  if (!packet)
    throw new Error("worker input clone did not arrive synchronously");
  return packet.message;
}

class Lease extends EventEmitter {
  slot;
  data;
  id = ++nextId;
  ended = false;
  referenced = true;
  outbox = [];
  constructor(slot, data) {
    super();
    this.slot = slot;
    this.data = data;
  }
  postMessage(value, transferList) {
    if (this.ended)
      return;
    if (this.slot.active === this)
      this.slot.worker.postMessage({ jobId: this.id, value }, transferList);
    else
      this.outbox.push(cloneJobValue({ value, transferList }, transferList));
  }
  start() {
    if (this.referenced)
      this.slot.worker.ref();
    else
      this.slot.worker.unref();
    this.emit("online");
    this.slot.worker.postMessage({ jobId: this.id, start: this.data });
    for (const { value, transferList } of this.outbox.splice(0))
      this.postMessage(value, transferList);
  }
  ref() {
    this.referenced = true;
    if (this.slot.active === this)
      this.slot.worker.ref();
    return this;
  }
  unref() {
    this.referenced = false;
    if (this.slot.active === this)
      this.slot.worker.unref();
    return this;
  }
  async terminate() {
    if (this.ended)
      return 0;
    if (this.slot.active === this)
      return await this.slot.worker.terminate();
    this.ended = true;
    this.slot.queue.splice(this.slot.queue.indexOf(this), 1);
    this.emit("exit", 0);
    return 0;
  }
}
function reuseWorker(entry, options, idleMs = IDLE_MS) {
  const data = cloneJobValue(options.workerData);
  const slot = acquireSlot(entry, options, idleMs);
  const lease = new Lease(slot, data);
  enqueue(slot, lease);
  return lease;
}
function enqueue(slot, lease) {
  timers.clearTimeout(slot.idle);
  lease.slot = slot;
  slot.queue.push(lease);
  queueMicrotask(() => slot.advance());
}
function acquireSlot(entry, options, idleMs) {
  const data = options.workerData;
  const key = JSON.stringify([
    String(entry),
    data?.path ?? data?.dbPath,
    data?.harness,
    data?.job
  ]);
  let slot = pools.get(key);
  if (!slot) {
    const worker = inRootAsyncContext2(() => new Worker(entry, { ...options, workerData: { reusableWorker: true } }));
    const controller = new AbortController;
    slot = { worker, controller, queue: [], advance: () => {} };
    pools.set(key, slot);
    liveSlots.add(slot);
    const owned = slot;
    const advance = () => {
      if (controller.signal.aborted || owned.active)
        return;
      timers.clearTimeout(owned.idle);
      const lease = owned.queue.shift();
      owned.active = lease;
      if (!lease) {
        worker.unref();
        owned.idle = timers.setTimeout(() => {
          if (pools.get(key) === owned)
            pools.delete(key);
          worker.terminate();
        }, idleMs);
        owned.idle.unref();
        return;
      }
      lease.start();
    };
    owned.advance = advance;
    worker.on("message", (message) => {
      const lease = owned.active;
      if (!lease || message.jobId !== lease.id)
        return;
      if (!message.finished) {
        lease.emit("message", message.value);
        return;
      }
      lease.ended = true;
      owned.active = undefined;
      if (message.code) {
        if (pools.get(key) === owned)
          pools.delete(key);
        lease.emit("exit", message.code);
        worker.terminate();
        return;
      }
      lease.emit("exit", 0);
      advance();
    });
    worker.on("error", (error) => {
      if (pools.get(key) === owned)
        pools.delete(key);
      owned.active?.emit("error", error);
    });
    worker.on("exit", (code) => {
      liveSlots.delete(owned);
      timers.clearTimeout(owned.idle);
      if (pools.get(key) === owned)
        pools.delete(key);
      const active = owned.active;
      owned.active = undefined;
      if (active && !active.ended) {
        active.ended = true;
        active.emit("exit", code);
      }
      for (const lease of owned.queue.splice(0)) {
        if (controller.signal.aborted) {
          lease.ended = true;
          lease.emit("exit", code);
        } else {
          try {
            enqueue(acquireSlot(entry, options, idleMs), lease);
          } catch (error) {
            lease.ended = true;
            lease.emit("error", error);
            lease.emit("exit", 1);
          }
        }
      }
    });
    controller.signal.addEventListener("abort", () => {
      worker.terminate();
    }, { once: true });
    registerExitAbort(controller);
    worker.once("exit", () => unregisterExitAbort(controller));
  }
  return slot;
}

export { reuseWorker };
