import {
  estimateTokens
} from "./index-xwgrhenf.js";
import {
  getHarness2
} from "./index-0h2mkab2.js";
import {
  log2
} from "./index-f956htf3.js";

// ../plugin/src/features/magic-context/memory/embedding-synapse.ts
import { createHash } from "node:crypto";

// ../../node_modules/.bun/@cortexkit+subc-client@0.11.1/node_modules/@cortexkit/subc-client/dist/client.js
import { promises as fs2 } from "node:fs";
import { debuglog } from "node:util";

// ../../node_modules/.bun/@cortexkit+subc-client@0.11.1/node_modules/@cortexkit/subc-client/dist/auth.js
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ../../node_modules/.bun/@cortexkit+subc-client@0.11.1/node_modules/@cortexkit/subc-client/dist/socket.js
import net from "node:net";

// ../../node_modules/.bun/@cortexkit+subc-client@0.11.1/node_modules/@cortexkit/subc-client/dist/envelope.js
var PROTOCOL_VERSION = 2;
var HEADER_LEN = 21;
var FROZEN_PREFIX_LEN = 5;
var MAX_FRAME_BODY_LEN = 64 * 1024 * 1024;
var FrameType;
(function(FrameType) {
  FrameType[FrameType["Request"] = 0] = "Request";
  FrameType[FrameType["Response"] = 1] = "Response";
  FrameType[FrameType["Push"] = 2] = "Push";
  FrameType[FrameType["StreamData"] = 3] = "StreamData";
  FrameType[FrameType["StreamEnd"] = 4] = "StreamEnd";
  FrameType[FrameType["Error"] = 5] = "Error";
  FrameType[FrameType["Cancel"] = 6] = "Cancel";
  FrameType[FrameType["Ping"] = 7] = "Ping";
  FrameType[FrameType["Pong"] = 8] = "Pong";
  FrameType[FrameType["Hello"] = 9] = "Hello";
  FrameType[FrameType["HelloAck"] = 10] = "HelloAck";
  FrameType[FrameType["Goodbye"] = 11] = "Goodbye";
})(FrameType || (FrameType = {}));
var FRAME_TYPE_MAX = FrameType.Goodbye;
function isPureHeader(ty) {
  return ty === FrameType.Cancel || ty === FrameType.Ping || ty === FrameType.Pong || ty === FrameType.Goodbye;
}
var Priority;
(function(Priority) {
  Priority[Priority["Passive"] = 0] = "Passive";
  Priority[Priority["Interactive"] = 1] = "Interactive";
  Priority[Priority["Background"] = 2] = "Background";
})(Priority || (Priority = {}));
var AdmissionClass;
(function(AdmissionClass) {
  AdmissionClass[AdmissionClass["Normal"] = 0] = "Normal";
  AdmissionClass[AdmissionClass["Expedite"] = 1] = "Expedite";
  AdmissionClass[AdmissionClass["Sheddable"] = 2] = "Sheddable";
})(AdmissionClass || (AdmissionClass = {}));
var FLAG_BINARY = 1;
var FLAG_PRIORITY_MASK = 6;
var FLAG_PRIORITY_SHIFT = 1;
var FLAG_LAST = 8;
var FLAG_ADMISSION_MASK = 48;
var FLAG_ADMISSION_SHIFT = 4;
var FLAG_RESERVED_MASK = 128;
function buildFlags(binary, priority, last, admissionClass = AdmissionClass.Normal) {
  let flags = 0;
  if (binary)
    flags |= FLAG_BINARY;
  flags |= priority << FLAG_PRIORITY_SHIFT;
  if (last)
    flags |= FLAG_LAST;
  flags |= admissionClass << FLAG_ADMISSION_SHIFT;
  return flags;
}
function hasBinary(flags) {
  return (flags & FLAG_BINARY) !== 0;
}
function encodeHeader(header) {
  const buffer = new Uint8Array(HEADER_LEN);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, header.len, true);
  buffer[4] = header.ver;
  buffer[5] = header.ty;
  buffer[6] = header.flags;
  view.setUint16(7, header.channel, true);
  view.setUint32(9, header.epoch, true);
  view.setBigUint64(13, header.corr, true);
  return buffer;
}

class DecodeError extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "DecodeError";
  }
}
function validateHeaderFields(header) {
  const len = header.len >>> 0;
  const ver = header.ver >>> 0 & 255;
  const typeByte = header.ty >>> 0 & 255;
  const flags = header.flags >>> 0 & 255;
  const channel = header.channel >>> 0 & 65535;
  const epoch = header.epoch >>> 0;
  BigInt.asUintN(64, header.corr);
  if (ver !== PROTOCOL_VERSION)
    throw new DecodeError(`unsupported envelope version ${ver}`, "unsupported_version");
  if (typeByte > FRAME_TYPE_MAX)
    throw new DecodeError(`unknown frame type byte ${typeByte}`, "unknown_frame_type");
  const ty = typeByte;
  if ((flags & FLAG_RESERVED_MASK) !== 0) {
    throw new DecodeError(`reserved flag bits set in flags 0b${flags.toString(2).padStart(8, "0")}`, "reserved_flag_bits");
  }
  if ((flags & FLAG_PRIORITY_MASK) >> FLAG_PRIORITY_SHIFT === 3) {
    throw new DecodeError(`reserved priority bits set in flags 0b${flags.toString(2).padStart(8, "0")}`, "reserved_priority_bits");
  }
  const admission = (flags & FLAG_ADMISSION_MASK) >> FLAG_ADMISSION_SHIFT;
  if (admission === 3) {
    throw new DecodeError(`reserved admission class set in flags 0b${flags.toString(2).padStart(8, "0")}`, "reserved_admission_class");
  }
  if (admission === AdmissionClass.Sheddable && ty !== FrameType.Push && ty !== FrameType.StreamData) {
    throw new DecodeError(`SHEDDABLE admission class is illegal on ${FrameType[ty]} in flags 0b${flags.toString(2).padStart(8, "0")}`, "sheddable_illegal_frame_type");
  }
  if (channel === 0 && epoch !== 0) {
    throw new DecodeError(`control channel carried nonzero epoch ${epoch}`, "nonzero_epoch_on_control_channel");
  }
  if (isPureHeader(ty) && len !== 0) {
    throw new DecodeError(`pure-header frame ${FrameType[ty]} declared non-zero body length ${len}`, "pure_header_frame_with_body");
  }
}
function decodeHeader(bytes) {
  if (bytes.length < FROZEN_PREFIX_LEN) {
    throw new DecodeError(`header shorter than frozen prefix: have ${bytes.length} bytes`, "too_short_for_prefix");
  }
  const ver = bytes[4];
  if (ver !== PROTOCOL_VERSION)
    throw new DecodeError(`unsupported envelope version ${ver}`, "unsupported_version");
  if (bytes.length < HEADER_LEN) {
    throw new DecodeError(`header too short for version: have ${bytes.length} bytes, need ${HEADER_LEN}`, "too_short_for_header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = view.getUint32(0, true);
  const typeByte = bytes[5];
  if (typeByte > FRAME_TYPE_MAX)
    throw new DecodeError(`unknown frame type byte ${typeByte}`, "unknown_frame_type");
  const ty = typeByte;
  const flags = bytes[6];
  if ((flags & FLAG_RESERVED_MASK) !== 0) {
    throw new DecodeError(`reserved flag bits set in flags 0b${flags.toString(2).padStart(8, "0")}`, "reserved_flag_bits");
  }
  if ((flags & FLAG_PRIORITY_MASK) >> FLAG_PRIORITY_SHIFT === 3) {
    throw new DecodeError(`reserved priority bits set in flags 0b${flags.toString(2).padStart(8, "0")}`, "reserved_priority_bits");
  }
  const admission = (flags & FLAG_ADMISSION_MASK) >> FLAG_ADMISSION_SHIFT;
  if (admission === 3) {
    throw new DecodeError(`reserved admission class set in flags 0b${flags.toString(2).padStart(8, "0")}`, "reserved_admission_class");
  }
  if (admission === AdmissionClass.Sheddable && ty !== FrameType.Push && ty !== FrameType.StreamData) {
    throw new DecodeError(`SHEDDABLE admission class is illegal on ${FrameType[ty]} in flags 0b${flags.toString(2).padStart(8, "0")}`, "sheddable_illegal_frame_type");
  }
  const channel = view.getUint16(7, true);
  const epoch = view.getUint32(9, true);
  if (channel === 0 && epoch !== 0) {
    throw new DecodeError(`control channel carried nonzero epoch ${epoch}`, "nonzero_epoch_on_control_channel");
  }
  if (isPureHeader(ty) && len !== 0) {
    throw new DecodeError(`pure-header frame ${FrameType[ty]} declared non-zero body length ${len}`, "pure_header_frame_with_body");
  }
  return { len, ver, ty, flags, channel, epoch, corr: view.getBigUint64(13, true) };
}
function buildFrame(ty, flags, channel, epoch, corr, body) {
  return buildFrameWithVersion(PROTOCOL_VERSION, ty, flags, channel, epoch, corr, body);
}
function buildFrameWithVersion(ver, ty, flags, channel, epoch, corr, body) {
  if (body.length > MAX_FRAME_BODY_LEN) {
    throw new DecodeError(`frame body ${body.length} exceeds max ${MAX_FRAME_BODY_LEN}`, "frame_body_too_large");
  }
  const header = { len: body.length, ver, ty, flags, channel, epoch, corr };
  validateHeaderFields(header);
  return { header, body };
}
function encodeFrame(frame) {
  if (frame.header.len !== frame.body.length) {
    throw new DecodeError(`frame header length ${frame.header.len} does not match body length ${frame.body.length}`, "frame_length_mismatch");
  }
  const header = encodeHeader(frame.header);
  const output = new Uint8Array(header.length + frame.body.length);
  output.set(header, 0);
  output.set(frame.body, header.length);
  return output;
}

// ../../node_modules/.bun/@cortexkit+subc-client@0.11.1/node_modules/@cortexkit/subc-client/dist/socket.js
class SocketClosedError extends Error {
}

class SocketTimeoutError extends Error {
}

class SocketWriteNotQueuedError extends Error {
  cause;
  constructor(message, cause) {
    super(message);
    this.cause = cause;
  }
}

class SocketWriteQueuedError extends Error {
  cause;
  constructor(message, cause) {
    super(message);
    this.cause = cause;
  }
}
function toWriteBuffer(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
var WRITE_BORROWED = Symbol("subc.socket.writeBorrowed");
var WRITE_TRACKED_BORROWED = Symbol("subc.socket.writeTrackedBorrowed");
function writeBorrowed(socket, bytes, deadlineMs) {
  const borrowed = socket[WRITE_BORROWED];
  return borrowed ? borrowed.call(socket, bytes, deadlineMs) : socket.write(bytes, deadlineMs);
}
function writeTrackedBorrowed(socket, bytes, deadlineMs) {
  const borrowed = socket[WRITE_TRACKED_BORROWED];
  return borrowed ? borrowed.call(socket, bytes, deadlineMs) : socket.writeTracked(bytes, deadlineMs);
}

class SubcSocket {
  sock;
  chunks = [];
  buffered = 0;
  waiter = null;
  closedErr = null;
  bufferedBytes() {
    return this.buffered;
  }
  constructor(sock) {
    this.sock = sock;
    sock.on("data", (chunk) => {
      this.chunks.push(chunk);
      this.buffered += chunk.length;
      this.tryServe();
    });
    const fail = (err) => {
      if (!this.closedErr)
        this.closedErr = err;
      this.tryServe();
    };
    sock.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
    sock.on("end", () => fail(new SocketClosedError("subc closed the connection")));
    sock.on("close", () => fail(new SocketClosedError("subc connection closed")));
  }
  localPort() {
    return this.sock.localPort ?? null;
  }
  static connect(host, port, deadlineMs) {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host, port });
      sock.setNoDelay(true);
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new SocketTimeoutError(`timed out connecting to ${host}:${port}`));
      }, Math.max(0, deadlineMs - Date.now()));
      sock.once("connect", () => {
        clearTimeout(timer);
        resolve(new SubcSocket(sock));
      });
      sock.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
  async readFrame(headerDeadlineMs, bodyDeadline, onHeader) {
    const prefix = await this.readExact(FROZEN_PREFIX_LEN, headerDeadlineMs);
    const version = prefix[4];
    if (version !== PROTOCOL_VERSION)
      throw new DecodeError(`unsupported envelope version ${version}`, "unsupported_version");
    const remainder = await this.readExact(HEADER_LEN - FROZEN_PREFIX_LEN, headerDeadlineMs);
    const headerBytes = new Uint8Array(HEADER_LEN);
    headerBytes.set(prefix);
    headerBytes.set(remainder, FROZEN_PREFIX_LEN);
    const header = decodeHeader(headerBytes);
    if (header.len > MAX_FRAME_BODY_LEN) {
      throw new DecodeError(`frame body ${header.len} exceeds max ${MAX_FRAME_BODY_LEN}`, "frame_body_too_large");
    }
    onHeader?.();
    const bodyDeadlineMs = typeof bodyDeadline === "number" ? bodyDeadline : Date.now() + bodyDeadline.afterHeaderMs;
    const body = header.len === 0 ? new Uint8Array(0) : await this.readExact(header.len, bodyDeadlineMs);
    return { header, body };
  }
  readExact(n, deadlineMs) {
    if (this.waiter) {
      return Promise.reject(new Error("concurrent readExact is not supported"));
    }
    if (n === 0)
      return Promise.resolve(new Uint8Array(0));
    return new Promise((resolve, reject) => {
      let timer = null;
      if (Number.isFinite(deadlineMs)) {
        const remaining = deadlineMs - Date.now();
        if (remaining <= 0) {
          reject(new SocketTimeoutError(`timed out waiting for ${n} bytes`));
          return;
        }
        timer = setTimeout(() => {
          this.waiter = null;
          reject(new SocketTimeoutError(`timed out waiting for ${n} bytes`));
        }, remaining);
      }
      this.waiter = { need: n, resolve, reject, timer };
      this.tryServe();
    });
  }
  async write(bytes, deadlineMs) {
    await this.writeBuffer(Buffer.from(bytes), deadlineMs);
  }
  writeTracked(bytes, deadlineMs) {
    return this.writeTrackedBuffer(Buffer.from(bytes), deadlineMs);
  }
  async[WRITE_BORROWED](bytes, deadlineMs) {
    await this.writeBuffer(toWriteBuffer(bytes), deadlineMs);
  }
  [WRITE_TRACKED_BORROWED](bytes, deadlineMs) {
    return this.writeTrackedBuffer(toWriteBuffer(bytes), deadlineMs);
  }
  async writeBuffer(buffer, deadlineMs) {
    try {
      await this.writeTrackedBuffer(buffer, deadlineMs).completed;
    } catch (err) {
      if (err instanceof SocketWriteNotQueuedError || err instanceof SocketWriteQueuedError) {
        throw err.cause ?? err;
      }
      throw err;
    }
  }
  writeTrackedBuffer(buffer, deadlineMs) {
    if (this.closedErr) {
      return {
        queued: false,
        completed: Promise.reject(new SocketWriteNotQueuedError("subc socket was closed before bytes could be queued", this.closedErr))
      };
    }
    let queued = false;
    let settled = false;
    let timer = null;
    const completed = new Promise((resolve, reject) => {
      const settle = (run) => {
        if (settled)
          return;
        settled = true;
        if (timer)
          clearTimeout(timer);
        run();
      };
      const remaining = deadlineMs - Date.now();
      if (remaining <= 0) {
        settle(() => reject(new SocketWriteNotQueuedError("timed out before bytes could be queued to subc", new SocketTimeoutError("timed out writing to subc"))));
        return;
      }
      timer = setTimeout(() => {
        const timeout = new SocketTimeoutError("timed out writing to subc");
        settle(() => reject(queued ? new SocketWriteQueuedError("timed out after bytes were handed to the subc socket", timeout) : new SocketWriteNotQueuedError("timed out before bytes could be queued to subc", timeout)));
      }, remaining);
      try {
        this.sock.write(buffer, (err) => {
          settle(() => {
            if (err) {
              reject(new SocketWriteQueuedError("subc socket reported a write error after bytes were handed to the socket", err instanceof Error ? err : new Error(String(err))));
            } else {
              resolve();
            }
          });
        });
        queued = true;
      } catch (err) {
        settle(() => reject(new SocketWriteNotQueuedError("subc socket write threw before bytes could be queued", err instanceof Error ? err : new Error(String(err)))));
      }
    });
    return { queued, completed };
  }
  close() {
    this.sock.destroy();
  }
  tryServe() {
    const w = this.waiter;
    if (!w)
      return;
    if (this.buffered >= w.need) {
      const out = this.take(w.need);
      this.waiter = null;
      if (w.timer)
        clearTimeout(w.timer);
      w.resolve(out);
      return;
    }
    if (this.closedErr) {
      this.waiter = null;
      if (w.timer)
        clearTimeout(w.timer);
      w.reject(this.closedErr);
    }
  }
  take(n) {
    const out = Buffer.allocUnsafe(n);
    let off = 0;
    while (off < n) {
      const head = this.chunks[0];
      const want = n - off;
      if (head.length <= want) {
        head.copy(out, off);
        off += head.length;
        this.chunks.shift();
      } else {
        head.copy(out, off, 0, want);
        this.chunks[0] = head.subarray(want);
        off += want;
      }
    }
    this.buffered -= n;
    return out;
  }
}

// ../../node_modules/.bun/@cortexkit+subc-client@0.11.1/node_modules/@cortexkit/subc-client/dist/auth.js
var NONCE_LEN = 32;
var MAX_AUTH_MESSAGE_LEN = 4096;
var SERVER_PROOF_DOMAIN = "subc-server-v1";
var CLIENT_AUTH_DOMAIN = "subc-client-v1";
var DEFAULT_CLIENT_ROLE = "client";

class AuthError extends Error {
}
function computeProof(key, domain, clientNonce, serverNonce, daemonId) {
  const mac = createHmac("sha256", Buffer.from(key));
  mac.update(Buffer.from(domain, "utf8"));
  mac.update(Buffer.from(clientNonce));
  mac.update(Buffer.from(serverNonce));
  mac.update(Buffer.from(daemonId));
  return new Uint8Array(mac.digest());
}
function constantTimeEq(a, b) {
  if (a.length !== b.length)
    return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
async function writeMessage(sock, value, deadlineMs) {
  const json = Buffer.from(JSON.stringify(value), "utf8");
  if (json.length > MAX_AUTH_MESSAGE_LEN) {
    throw new AuthError(`auth message too large: ${json.length} > ${MAX_AUTH_MESSAGE_LEN}`);
  }
  const lenPrefix = new Uint8Array(4);
  new DataView(lenPrefix.buffer).setUint32(0, json.length, true);
  await writeBorrowed(sock, lenPrefix, deadlineMs);
  await writeBorrowed(sock, json, deadlineMs);
}
async function readMessage(sock, deadlineMs) {
  const lenBytes = await sock.readExact(4, deadlineMs);
  const len = new DataView(lenBytes.buffer, lenBytes.byteOffset, 4).getUint32(0, true);
  if (len > MAX_AUTH_MESSAGE_LEN) {
    throw new AuthError(`auth message too large: ${len} > ${MAX_AUTH_MESSAGE_LEN}`);
  }
  const body = len === 0 ? new Uint8Array(0) : await sock.readExact(len, deadlineMs);
  try {
    return JSON.parse(Buffer.from(body).toString("utf8"));
  } catch (err) {
    throw new AuthError(`auth message JSON decode failed: ${String(err)}`);
  }
}
function authBytes(value, field) {
  if (!Array.isArray(value)) {
    throw new AuthError(`auth field '${field}' must be a byte array`);
  }
  for (const byte of value) {
    if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new AuthError(`auth field '${field}' has invalid byte ${String(byte)}`);
    }
  }
  return Uint8Array.from(value);
}
async function authenticateClient(sock, conn, deadlineMs) {
  const clientNonce = new Uint8Array(randomBytes(NONCE_LEN));
  await writeMessage(sock, { client_nonce: Array.from(clientNonce), role: DEFAULT_CLIENT_ROLE }, deadlineMs);
  const proof = await readMessage(sock, deadlineMs);
  const serverNonce = authBytes(proof.server_nonce, "server_nonce");
  const daemonId = authBytes(proof.daemon_id, "daemon_id");
  const serverProof = authBytes(proof.server_proof, "server_proof");
  const expected = computeProof(conn.key, SERVER_PROOF_DOMAIN, clientNonce, serverNonce, daemonId);
  if (!constantTimeEq(expected, serverProof)) {
    throw new AuthError("server proof mismatch — wrong key or impostor daemon");
  }
  if (!constantTimeEq(daemonId, conn.daemonId)) {
    throw new AuthError("daemon id mismatch — connection file points at a different daemon");
  }
  const clientAuth = computeProof(conn.key, CLIENT_AUTH_DOMAIN, clientNonce, serverNonce, daemonId);
  await writeMessage(sock, { client_auth: Array.from(clientAuth) }, deadlineMs);
}

// ../../node_modules/.bun/@cortexkit+subc-client@0.11.1/node_modules/@cortexkit/subc-client/dist/connection-file.js
import { promises as fs } from "node:fs";
var SCHEMA_VERSION = 1;
var MIN_KEY_LEN = 32;
var DAEMON_ID_LEN = 16;

class ConnectionFileError extends Error {
}
function toBytes(value, field) {
  if (!Array.isArray(value)) {
    throw new ConnectionFileError(`connection file field '${field}' must be a JSON array of bytes`);
  }
  for (const byte of value) {
    if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new ConnectionFileError(`connection file field '${field}' has invalid byte ${String(byte)}`);
    }
  }
  return Uint8Array.from(value);
}
function validate(info) {
  if (info.schema !== SCHEMA_VERSION) {
    throw new ConnectionFileError(`unsupported connection file schema ${info.schema}; expected ${SCHEMA_VERSION}`);
  }
  if (info.endpoints.length === 0) {
    throw new ConnectionFileError("connection file must include at least one endpoint");
  }
  if (info.key.length < MIN_KEY_LEN) {
    throw new ConnectionFileError(`connection file key is too short: ${info.key.length} bytes, need at least ${MIN_KEY_LEN}`);
  }
  if (info.daemonId.length !== DAEMON_ID_LEN) {
    throw new ConnectionFileError(`connection file daemon_id must be ${DAEMON_ID_LEN} bytes, got ${info.daemonId.length}`);
  }
}
async function verifyOwnerOnly(path) {
  if (process.platform === "win32")
    return;
  const stat = await fs.stat(path);
  const mode = stat.mode & 511;
  if ((mode & 63) !== 0) {
    throw new ConnectionFileError(`connection file ${path} has insecure permissions 0o${mode.toString(8)}; expected owner-only 0600`);
  }
}
async function readConnectionFile(path) {
  await verifyOwnerOnly(path);
  const raw = await fs.readFile(path, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConnectionFileError(`connection file JSON read failed for ${path}: ${String(err)}`);
  }
  const wireVersion = parsed.wire_version;
  if (wireVersion !== undefined && wireVersion !== PROTOCOL_VERSION) {
    throw new ConnectionFileError(`connection file wire_version ${String(wireVersion)} but this client speaks ${PROTOCOL_VERSION}; the client library must be upgraded`);
  }
  const endpointsRaw = parsed.endpoints;
  if (!Array.isArray(endpointsRaw)) {
    throw new ConnectionFileError("connection file 'endpoints' must be an array");
  }
  const endpoints = endpointsRaw.map((e) => {
    const ep = e;
    if (typeof ep.host !== "string" || typeof ep.port !== "number") {
      throw new ConnectionFileError("connection file endpoint must be { host: string, port: number }");
    }
    return { host: ep.host, port: ep.port };
  });
  const info = {
    schema: parsed.schema,
    endpoints,
    key: toBytes(parsed.key, "key"),
    daemonId: toBytes(parsed.daemon_id, "daemon_id"),
    pid: parsed.pid,
    daemonVer: parsed.daemon_ver ?? ""
  };
  validate(info);
  return info;
}

// ../../node_modules/.bun/@cortexkit+subc-client@0.11.1/node_modules/@cortexkit/subc-client/dist/route-handle.js
var connectionToken = new WeakMap;

class RouteHandle {
  channel;
  epoch;
  constructor(channel, epoch, token) {
    if (!Number.isInteger(channel) || channel <= 0 || channel > 65535) {
      throw new RangeError(`route channel must be an integer in 1..65535, got ${channel}`);
    }
    if (!Number.isInteger(epoch) || epoch <= 0 || epoch > 4294967295) {
      throw new RangeError(`route epoch must be an integer in 1..4294967295, got ${epoch}`);
    }
    this.channel = channel;
    this.epoch = epoch;
    connectionToken.set(this, token);
    Object.freeze(this);
  }
  static create(channel, epoch, token) {
    return new RouteHandle(channel, epoch, token);
  }
}
function createRouteHandle(channel, epoch, token) {
  const factory = RouteHandle;
  return factory.create(channel, epoch, token);
}

class StaleRouteHandleError extends Error {
  handle;
  code = "stale_route_handle";
  constructor(handle) {
    super(`route handle (${handle.channel}, ${handle.epoch}) is not live on the current connection`);
    this.handle = handle;
    this.name = "StaleRouteHandleError";
  }
}
function newConnectionToken() {
  return Object.freeze({});
}
function belongsToConnection(handle, token) {
  return connectionToken.get(handle) === token;
}
function sameRouteHandle(left, right) {
  return left === right;
}

// ../../node_modules/.bun/@cortexkit+subc-client@0.11.1/node_modules/@cortexkit/subc-client/dist/client.js
var debug = debuglog("subc-client");
var DEFAULT_HANDSHAKE_TIMEOUT_MS = 1e4;
var DEFAULT_REQUEST_TIMEOUT_MS = 30000;
var TIMEOUT_ARBITRATION_GRACE_MS = 50;
var LIVENESS_PROBE_WINDOW_MS = 2000;
var REQUEST_DEADLINE_MARKER = "request_deadline";
var DEADLINE_NO_DROP_CODE = "deadline_exceeded_no_drop_observed";
var ROUTE_OPEN_RETRY_DEADLINE_MS = 30000;
var BODY_READ_TIMEOUT_MS = 30000;
var EMPTY_BODY = new Uint8Array(0);
var DEFAULT_MANAGED_TARGET_KIND = "management_surface";
var SUBC_MODULE_ID_ENV = "SUBC_MODULE_ID";
var SUBC_LAUNCH_NONCE_ENV = "SUBC_LAUNCH_NONCE";
var DEFAULT_RECONNECT_BACKOFF = {
  baseMs: 100,
  capMs: 2000,
  maxAttempts: 6
};

class SubcCallError extends Error {
  kind;
  code;
  cause;
  constructor(kind, message, code, cause) {
    super(message);
    this.kind = kind;
    this.code = code;
    this.cause = cause;
    this.name = "SubcCallError";
  }
  get detail() {
    return this.cause instanceof SubcError ? this.cause.detail : undefined;
  }
}

class SubcError extends Error {
  code;
  detail;
  constructor(message, code, detail) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}
function requireBinaryBody(body) {
  if (body instanceof Uint8Array)
    return body;
  const type = body === null ? "null" : Array.isArray(body) ? "array" : typeof body;
  throw new SubcError(`binary request body must be a Uint8Array; got ${type}`, "binary_body_required");
}
class SubcClient {
  sock;
  currentConn;
  opts;
  nextCorr = 1n;
  pending = new Map;
  lateResponses = new Map;
  routes = new Map;
  liveRoutes = new Map;
  connectionToken = newConnectionToken();
  ingressEpochDropCount = 0;
  closedErr = null;
  closeStarted = false;
  reconnecting = null;
  generation = 1;
  readerActive = false;
  constructor(sock, currentConn, opts) {
    this.sock = sock;
    this.currentConn = currentConn;
    this.opts = opts;
    this.readLoop(sock, this.generation);
  }
  get conn() {
    return this.currentConn;
  }
  static async connect(opts) {
    const normalized = normalizeConnectOptions(opts);
    const opened = await SubcClient.openConnection(normalized);
    return new SubcClient(opened.sock, opened.conn, normalized);
  }
  async catalogList(moduleId) {
    const body = this.encode(moduleId === undefined ? { op: "catalog.list" } : { op: "catalog.list", module_id: moduleId });
    const reply = await this.controlRpc(body);
    const parsed = this.parseJson(reply);
    return parsed.modules ?? [];
  }
  async resolveProvider(capability) {
    const claimants = await this.resolveProviders(capability);
    if (claimants.length === 0) {
      throw new SubcError(`no catalog claimant for capability ${capability}`, "capability_unprovided");
    }
    if (claimants.length > 1) {
      throw new SubcError(`multiple catalog claimants for capability ${capability}: ${claimants.join(", ")}`, "capability_ambiguous");
    }
    return claimants[0];
  }
  async resolveProviders(capability) {
    if (!isValidCapabilityIdentifier(capability)) {
      throw new SubcError(`malformed capability identifier ${JSON.stringify(capability)}`, "invalid_capability_identifier");
    }
    const modules = await this.catalogList();
    return modules.filter((module) => module.capabilities?.provides.includes(capability) ?? false).map((module) => module.module_id).sort();
  }
  async routeOpen(target, identity, opts = {}) {
    const consumerIdentity = routeOpenConsumerIdentity(opts);
    const consumerCapabilities = opts.consumerCapabilities;
    const body = this.encode({
      op: "route.open",
      target,
      identity,
      ...consumerIdentity ? { consumer_identity: consumerIdentity } : {},
      ...consumerCapabilities !== undefined ? { consumer_capabilities: consumerCapabilities } : {}
    });
    let installed = null;
    const install = (frame) => {
      if (frame.header.ty !== FrameType.Response)
        return true;
      const parsed = this.parseJson(frame);
      if (typeof parsed.route_channel !== "number" || typeof parsed.route_epoch !== "number") {
        throw new SubcError(`route.open returned no route handle: ${JSON.stringify(parsed)}`);
      }
      installed = this.installRoute(parsed.route_channel, parsed.route_epoch);
      return true;
    };
    const closeLateRoute = (frame) => {
      if (frame.header.ty !== FrameType.Response)
        return;
      try {
        const parsed = this.parseJson(frame);
        if (typeof parsed.route_channel !== "number" || typeof parsed.route_epoch !== "number")
          return;
        const lateHandle = this.installRoute(parsed.route_channel, parsed.route_epoch);
        this.failHandle(lateHandle, new SubcError("late route.open was closed", "route_closed"));
        this.liveRoutes.delete(lateHandle.channel);
        this.sendRouteGoodbye(lateHandle, true);
      } catch {
        this.closeConnectionAfterCleanupFailure();
      }
    };
    await this.controlRpc(body, install, closeLateRoute);
    if (!installed)
      throw new SubcError("route.open response was not installed");
    return installed;
  }
  async request(handle, body, opts = {}) {
    this.assertLiveHandle(handle);
    const binary = opts.binary ?? false;
    const bytes = binary ? requireBinaryBody(body) : body instanceof Uint8Array ? body : this.encode(body);
    const priority = opts.priority ?? Priority.Interactive;
    const admission = opts.admissionClass ?? AdmissionClass.Normal;
    const reply = await this.send(handle, bytes, priority, admission, opts.timeoutMs, opts.onProgress, undefined, undefined, binary);
    return this.decodeReply(reply);
  }
  async call(moduleId, method, params, opts = {}) {
    if (opts.binary) {
      throw new SubcError("call() builds a JSON body and cannot send a binary request; use callBinary(moduleId, body, opts) with a Uint8Array", "binary_call_requires_call_binary");
    }
    const body = params === undefined ? { method } : { method, params };
    return await this.managedCall(moduleId, body, opts);
  }
  async callBinary(moduleId, body, opts = {}) {
    const bytes = requireBinaryBody(body);
    return this.managedCall(moduleId, bytes, { ...opts, binary: true });
  }
  async managedCall(moduleId, body, opts) {
    let retriedUnknownChannel = false;
    for (;; ) {
      const routeHandle = await this.cachedRouteHandle(moduleId, opts);
      try {
        return await this.managedRequest(routeHandle, body, opts);
      } catch (err) {
        if (!(err instanceof SubcCallError))
          throw this.terminalCallError("managed call failed", err);
        const deadBindCode = err.code === "unknown_channel" || err.code === "stale_route_epoch";
        if (deadBindCode && !retriedUnknownChannel && !this.closeStarted) {
          retriedUnknownChannel = true;
          this.evictRouteHandle(routeHandle);
          continue;
        }
        if (deadBindCode && retriedUnknownChannel) {
          this.evictRouteHandle(routeHandle);
        }
        if (err.kind === "not_sent") {
          try {
            await this.reconnectAfterDrop(err);
          } catch (reconnectErr) {
            throw this.notSentRecoveryError("managed call was not sent", reconnectErr);
          }
          continue;
        }
        if (err.kind === "outcome_unknown" && err.code !== DEADLINE_NO_DROP_CODE) {
          this.scheduleReconnectAfterDrop(err);
        } else if (err.kind === "outcome_unknown" && err.code === DEADLINE_NO_DROP_CODE) {
          this.probeLivenessAfterDeadline();
        }
        throw err;
      }
    }
  }
  subscribe(handle, body, onEvent, opts = {}) {
    this.assertLiveHandle(handle);
    const bytes = body instanceof Uint8Array ? body : this.encode(body);
    const priority = opts.priority ?? Priority.Interactive;
    const admission = opts.admissionClass ?? AdmissionClass.Normal;
    const corr = this.allocateCorr();
    const key = pendingKey(handle, corr);
    let subscriptionPending = null;
    let resolveClosed = null;
    const closed = new Promise((resolve, reject) => {
      if (this.closedErr) {
        reject(this.closedErr);
        return;
      }
      resolveClosed = resolve;
      subscriptionPending = {
        handle,
        resolve: () => resolve(),
        reject,
        onProgress: onEvent,
        timer: null,
        subscription: true
      };
      this.pending.set(key, subscriptionPending);
      const frame = buildFrame(FrameType.Request, buildFlags(false, priority, false, admission), handle.channel, handle.epoch, corr, bytes);
      writeBorrowed(this.sock, encodeFrame(frame), Date.now() + DEFAULT_REQUEST_TIMEOUT_MS).catch((err) => {
        const pending = this.pending.get(key);
        if (pending)
          this.rejectPending(key, pending, err instanceof Error ? err : new SubcError(String(err)));
      });
    });
    let cancelled = false;
    const unsubscribe = () => {
      if (cancelled)
        return;
      cancelled = true;
      if (subscriptionPending && resolveClosed)
        this.settle(key, subscriptionPending, resolveClosed);
      if (this.isLiveHandle(handle))
        this.cancel(handle, corr, priority);
    };
    return { unsubscribe, closed };
  }
  cancel(handle, corr, priority = Priority.Interactive) {
    this.assertLiveHandle(handle);
    const cancel = buildFrame(FrameType.Cancel, buildFlags(false, priority, false), handle.channel, handle.epoch, corr, EMPTY_BODY);
    writeBorrowed(this.sock, encodeFrame(cancel), Date.now() + DEFAULT_REQUEST_TIMEOUT_MS).catch(() => {
      return;
    });
  }
  async routePoll(handle, kind) {
    this.assertLiveHandle(handle);
    const body = this.encode({
      op: "route.poll",
      route_channel: handle.channel,
      route_epoch: handle.epoch,
      kind
    });
    const reply = await this.controlRpc(body, (frame) => {
      if (frame.header.ty !== FrameType.Response)
        return true;
      const parsed = this.parseJson(frame);
      return parsed.route_channel === handle.channel && parsed.route_epoch === handle.epoch;
    });
    return this.parseJson(reply);
  }
  async closeRoute(handle, opts = {}) {
    this.assertLiveHandle(handle);
    for (const [key, cached] of this.routes) {
      if (cached.handle && sameRouteHandle(cached.handle, handle)) {
        cached.closed = true;
        cached.handle = null;
        this.routes.delete(key);
      }
    }
    if (opts.drain)
      await this.drainUnaryOnHandle(handle);
    this.failHandle(handle, new SubcError("route closed by closeRoute", "route_closed"));
    if (this.liveRoutes.get(handle.channel) === handle)
      this.liveRoutes.delete(handle.channel);
    this.sendRouteGoodbye(handle);
  }
  async closeManagedRoute(target, identity, opts = {}) {
    const key = routeCacheKey(target, identity, routeOpenConsumerIdentity(opts));
    const cached = this.routes.get(key);
    if (!cached)
      return;
    cached.closed = true;
    this.routes.delete(key);
    const handle = cached.handle;
    cached.handle = null;
    if (handle)
      await this.closeRoute(handle, opts);
  }
  async closeRouteChannel(handle, opts = {}) {
    await this.closeRoute(handle, opts);
  }
  close() {
    this.closeStarted = true;
    this.fail(new SubcError("client closed"));
    this.sock.close();
  }
  drainUnaryOnHandle(handle) {
    const waiters = [];
    for (const pending of this.pending.values()) {
      if (pending.handle === handle && !pending.subscription) {
        waiters.push(new Promise((resolve) => {
          const previous = pending.onSettle;
          pending.onSettle = () => {
            previous?.();
            resolve();
          };
        }));
      }
    }
    return Promise.all(waiters).then(() => {
      return;
    });
  }
  sendRouteGoodbye(handle, closeOnQueueFailure = false) {
    this.assertLiveConnection(handle);
    if (this.closedErr) {
      if (closeOnQueueFailure)
        this.closeConnectionAfterCleanupFailure();
      return;
    }
    const goodbye = buildFrame(FrameType.Goodbye, buildFlags(false, Priority.Interactive, false), handle.channel, handle.epoch, 0n, EMPTY_BODY);
    const write = writeTrackedBorrowed(this.sock, encodeFrame(goodbye), Date.now() + DEFAULT_REQUEST_TIMEOUT_MS);
    if (!write.queued && closeOnQueueFailure)
      this.closeConnectionAfterCleanupFailure();
    write.completed.catch(() => {
      if (closeOnQueueFailure && !write.queued)
        this.closeConnectionAfterCleanupFailure();
    });
  }
  static async openConnection(opts) {
    const conn = await readConnectionFile(opts.connectionFile);
    const deadline = Date.now() + (opts.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS);
    const endpoint = conn.endpoints[0];
    const sock = await SubcSocket.connect(endpoint.host, endpoint.port, deadline);
    try {
      await authenticateClient(sock, conn, deadline);
    } catch (err) {
      sock.close();
      throw err;
    }
    return { sock, conn };
  }
  async controlRpc(body, acceptFrame, onLateResponse) {
    return this.send(null, body, Priority.Interactive, AdmissionClass.Normal, undefined, undefined, acceptFrame, onLateResponse);
  }
  send(handle, body, priority, admission, timeoutMs, onProgress, acceptFrame, onLateResponse, binary = false) {
    if (handle)
      this.assertLiveHandle(handle);
    if (this.closedErr)
      return Promise.reject(this.closedErr);
    let corr;
    try {
      corr = this.allocateCorr();
    } catch (error) {
      return Promise.reject(error);
    }
    const key = pendingKey(handle, corr);
    const channel = handle?.channel ?? 0;
    const epoch = handle?.epoch ?? 0;
    const frame = buildFrame(FrameType.Request, buildFlags(binary, priority, false, admission), channel, epoch, corr, body);
    return new Promise((resolve, reject) => {
      const ms = timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const pending = {
        handle,
        resolve,
        reject,
        onProgress,
        timer: null,
        acceptFrame,
        onLateResponse
      };
      pending.timer = setTimeout(() => this.arbitrateTimeout(key, pending, channel, corr, ms), ms);
      this.pending.set(key, pending);
      writeBorrowed(this.sock, encodeFrame(frame), Date.now() + ms).catch((error) => {
        const current = this.pending.get(key);
        if (current)
          this.rejectPending(key, current, error instanceof Error ? error : new SubcError(String(error)));
      });
    });
  }
  arbitrateTimeout(key, pending, channel, corr, ms) {
    const settleAsTimeout = () => {
      if (pending.onLateResponse)
        this.lateResponses.set(key, pending.onLateResponse);
      this.rejectPending(key, pending, new SubcError(this.timeoutMessage(channel, corr, ms), REQUEST_DEADLINE_MARKER));
    };
    const graceDeadline = Date.now() + this.opts.timeoutArbitrationGraceMs;
    const arbitrate = () => {
      if (this.pending.get(key) !== pending)
        return;
      const readerDraining = this.readerActive || this.sock.bufferedBytes() > 0;
      if (readerDraining && Date.now() < graceDeadline) {
        setImmediate(arbitrate);
        return;
      }
      settleAsTimeout();
    };
    setImmediate(arbitrate);
  }
  async managedRequest(handle, body, opts) {
    const binary = opts.binary ?? false;
    const bytes = binary ? requireBinaryBody(body) : body instanceof Uint8Array ? body : this.encode(body);
    const priority = opts.priority ?? Priority.Interactive;
    const admission = opts.admissionClass ?? AdmissionClass.Normal;
    try {
      const reply = await this.sendManaged(handle, bytes, priority, admission, opts.timeoutMs, opts.onProgress, binary);
      return this.decodeReply(reply);
    } catch (error) {
      if (error instanceof SubcCallError)
        throw error;
      throw this.terminalCallError("managed call failed", error);
    }
  }
  sendManaged(handle, body, priority, admission, timeoutMs, onProgress, binary = false) {
    try {
      this.assertLiveHandle(handle);
    } catch (error) {
      return Promise.reject(this.notSentCallError("request used a stale route handle", error));
    }
    if (this.closedErr) {
      return Promise.reject(this.notSentCallError("request was not sent because the subc connection was already closed", this.closedErr));
    }
    let corr;
    try {
      corr = this.allocateCorr();
    } catch (error) {
      return Promise.reject(this.notSentCallError("request correlation allocator was exhausted", error));
    }
    const key = pendingKey(handle, corr);
    const frame = buildFrame(FrameType.Request, buildFlags(binary, priority, false, admission), handle.channel, handle.epoch, corr, body);
    let handedToSocket = false;
    const classifyFailure = (error) => {
      if (!handedToSocket)
        return this.notSentCallError("request bytes were not queued to the subc socket", error);
      if (error instanceof SubcError && error.code === REQUEST_DEADLINE_MARKER) {
        return new SubcCallError("outcome_unknown", `managed call deadline exceeded after request bytes were queued to the local socket; no terminal response was observed; outcome unknown${causeMessage(error)}`, DEADLINE_NO_DROP_CODE, error);
      }
      return this.outcomeUnknownCallError("connection dropped before the managed call returned a response", error);
    };
    return new Promise((resolve, reject) => {
      const ms = timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const pending = {
        handle,
        resolve,
        reject,
        onProgress,
        timer: null,
        classifyFailure
      };
      pending.timer = setTimeout(() => this.arbitrateTimeout(key, pending, handle.channel, corr, ms), ms);
      this.pending.set(key, pending);
      const write = writeTrackedBorrowed(this.sock, encodeFrame(frame), Date.now() + ms);
      handedToSocket = write.queued;
      write.completed.catch((error) => {
        const current = this.pending.get(key);
        if (current)
          this.rejectPending(key, current, error instanceof Error ? error : new SubcError(String(error)));
      });
    });
  }
  async cachedRouteHandle(moduleId, opts) {
    const identity = opts.identity ?? this.opts.identity;
    if (!identity) {
      throw new SubcCallError("terminal", "managed call requires a BindIdentity in SubcClient.connect({ identity }) or call(..., { identity })", "missing_identity");
    }
    const target = { kind: opts.targetKind ?? this.opts.targetKind, module_id: moduleId };
    const consumerIdentity = routeOpenConsumerIdentity(opts);
    const key = routeCacheKey(target, identity, consumerIdentity);
    let cached = this.routes.get(key);
    if (!cached) {
      cached = {
        key,
        moduleId,
        target,
        identity,
        consumerIdentity,
        handle: null,
        opening: null
      };
      this.routes.set(key, cached);
    }
    if (cached.handle && this.isLiveHandle(cached.handle))
      return cached.handle;
    if (!cached.opening) {
      cached.opening = this.openCachedRoute(cached).finally(() => {
        cached.opening = null;
      });
    }
    return cached.opening;
  }
  async openCachedRoute(cached) {
    const routeRetryDeadline = Date.now() + this.opts.routeOpenRetryDeadlineMs;
    let routeRetryDelay = this.opts.reconnectBackoff.baseMs;
    let routeRetryAttempt = 0;
    for (;; ) {
      if (cached.closed)
        throw this.routeClosedDuringOpen();
      try {
        await this.ensureConnectedForManaged();
      } catch (error) {
        throw this.notSentRecoveryError("route.open could not run because reconnect failed", error);
      }
      if (cached.handle && this.isLiveHandle(cached.handle))
        return cached.handle;
      try {
        const handle = await this.routeOpen(cached.target, cached.identity, {
          consumerIdentity: cached.consumerIdentity ?? null
        });
        if (cached.closed) {
          this.liveRoutes.delete(handle.channel);
          this.sendRouteGoodbye(handle);
          throw this.routeClosedDuringOpen();
        }
        cached.handle = handle;
        return handle;
      } catch (error) {
        if (error instanceof SubcCallError && error.code === "route_closed")
          throw error;
        if (!this.closeStarted && isConsumerReconnectTransient(error)) {
          try {
            await this.reconnectAfterDrop(error);
          } catch (reconnectError) {
            throw this.notSentRecoveryError("route.open was not sent and reconnect failed", reconnectError);
          }
          continue;
        }
        if (!this.closeStarted && error instanceof SubcError && isRetryableRouteOpenCode(error.code)) {
          routeRetryAttempt += 1;
          if (Date.now() < routeRetryDeadline) {
            await this.opts.sleep(routeRetryDelay);
            routeRetryDelay = Math.min(routeRetryDelay * 2, this.opts.reconnectBackoff.capMs);
            continue;
          }
          throw this.notSentCallError(`route.open failed for module ${cached.moduleId}: ${error.code} (retry deadline exhausted after ${routeRetryAttempt} attempts)`, error);
        }
        throw this.terminalCallError(`route.open failed for module ${cached.moduleId}`, error);
      }
    }
  }
  lastInboundAtMs = 0;
  livenessProbe = null;
  hasControlPending() {
    for (const pending of this.pending.values()) {
      if (pending.handle === null)
        return true;
    }
    return false;
  }
  probeLivenessAfterDeadline() {
    if (this.livenessProbe || this.closeStarted || this.closedErr)
      return;
    if (this.hasControlPending())
      return;
    const sock = this.sock;
    const generation = this.generation;
    let corr;
    try {
      corr = this.allocateCorr();
    } catch {
      return;
    }
    const t0 = Date.now();
    const ping = buildFrame(FrameType.Ping, buildFlags(false, Priority.Interactive, false, AdmissionClass.Normal), 0, 0, corr, new Uint8Array);
    const probe = (async () => {
      await writeBorrowed(sock, encodeFrame(ping), t0 + this.opts.livenessProbeWindowMs).catch(() => {});
      await this.opts.sleep(this.opts.livenessProbeWindowMs);
      if (this.sock !== sock || this.generation !== generation || this.closeStarted)
        return;
      if (this.lastInboundAtMs >= t0)
        return;
      if (this.hasControlPending())
        return;
      this.fail(new SocketClosedError(`liveness probe convicted a half-open socket: no inbound frame for ${this.opts.livenessProbeWindowMs}ms after a channel-0 Ping (deadline-no-drop settles preceded this); closing so the next call reconnects`));
      sock.close();
    })().finally(() => {
      this.livenessProbe = null;
    });
    this.livenessProbe = probe;
  }
  async ensureConnectedForManaged() {
    if (this.closeStarted)
      throw new SubcError("client closed");
    if (this.reconnecting)
      await this.reconnecting;
    if (this.closedErr)
      await this.reconnectAfterDrop(this.closedErr);
  }
  scheduleReconnectAfterDrop(err) {
    if (this.closeStarted || this.reconnecting)
      return;
    this.reconnectAfterDrop(err).catch(() => {});
  }
  reconnectAfterDrop(trigger) {
    if (this.closeStarted)
      return Promise.reject(new SubcError("client closed"));
    if (this.reconnecting)
      return this.reconnecting;
    const promise = this.reconnectWithRetry(trigger).finally(() => {
      if (this.reconnecting === promise)
        this.reconnecting = null;
    });
    this.reconnecting = promise;
    return promise;
  }
  async reconnectWithRetry(_trigger) {
    let attempt = 0;
    let delay = this.opts.reconnectBackoff.baseMs;
    for (;; ) {
      if (this.closeStarted)
        throw new SubcError("client closed");
      attempt += 1;
      try {
        const opened = await SubcClient.openConnection(this.opts);
        if (this.closeStarted) {
          opened.sock.close();
          throw new SubcError("client closed");
        }
        this.replaceConnection(opened);
        await this.reopenCachedRoutes();
        return;
      } catch (err) {
        if (!isConsumerReconnectTransient(err) || attempt >= this.opts.reconnectBackoff.maxAttempts) {
          if (err instanceof AuthError && attempt > 1) {
            throw new AuthError(`reconnect gave up after ${attempt} attempts: ${err.message} — the connection file and the daemon's key disagree persistently ` + `(daemon restarting in a loop, split connection-file paths, or a genuinely foreign daemon on this port); ` + `check the daemon, then restart this host app`);
          }
          throw err;
        }
        await this.opts.sleep(delay);
        delay = Math.min(delay * 2, this.opts.reconnectBackoff.capMs);
      }
    }
  }
  replaceConnection(opened) {
    this.sock.close();
    this.sock = opened.sock;
    this.currentConn = opened.conn;
    this.closedErr = null;
    this.generation += 1;
    this.connectionToken = newConnectionToken();
    this.liveRoutes.clear();
    this.lateResponses.clear();
    this.nextCorr = 1n;
    this.readLoop(opened.sock, this.generation);
  }
  async reopenCachedRoutes() {
    const routeKeys = [...this.routes.keys()];
    for (const key of routeKeys) {
      const cached = this.routes.get(key);
      if (cached)
        cached.handle = null;
    }
    for (const key of routeKeys) {
      const cached = this.routes.get(key);
      if (!cached || cached.closed)
        continue;
      try {
        const handle = await this.routeOpen(cached.target, cached.identity, {
          consumerIdentity: cached.consumerIdentity ?? null
        });
        if (cached.closed) {
          this.liveRoutes.delete(handle.channel);
          this.sendRouteGoodbye(handle);
          continue;
        }
        cached.handle = handle;
      } catch (error) {
        if (isRouteOpenRefusal(error)) {
          this.routes.delete(key);
          continue;
        }
        throw error;
      }
    }
  }
  timeoutMessage(channel, corr, ms) {
    const port = this.sock.localPort();
    const where = port === null ? "channel" : `local_port=${port} channel`;
    return `request on ${where} ${channel} corr ${corr} timed out after ${ms}ms`;
  }
  routeClosedDuringOpen() {
    return new SubcCallError("not_sent", "route was closed before route.open completed", "route_closed");
  }
  async readLoop(sock, generation) {
    try {
      for (;; ) {
        this.readerActive = false;
        const frame = await sock.readFrame(Number.POSITIVE_INFINITY, { afterHeaderMs: BODY_READ_TIMEOUT_MS }, () => {
          this.readerActive = true;
        });
        try {
          if (this.sock === sock && this.generation === generation)
            this.dispatch(frame);
        } finally {
          this.readerActive = false;
        }
      }
    } catch (error) {
      if (this.sock === sock && this.generation === generation) {
        this.fail(error instanceof Error ? error : new SubcError(String(error)));
      }
    }
  }
  dispatch(frame) {
    this.lastInboundAtMs = Date.now();
    if (frame.header.channel === 0 && frame.header.ty === FrameType.Push) {
      const observer = this.opts.onControlPush;
      if (observer) {
        let parsed = null;
        try {
          const body = this.parseJson(frame);
          if (body && typeof body.op === "string")
            parsed = { op: body.op, body };
        } catch {}
        if (parsed) {
          try {
            observer(parsed);
          } catch {}
        }
      }
      return;
    }
    let handle = null;
    if (frame.header.channel !== 0) {
      handle = this.liveRoutes.get(frame.header.channel) ?? null;
      if (!handle || handle.epoch !== frame.header.epoch) {
        this.ingressEpochDropCount += 1;
        return;
      }
    }
    const key = pendingKey(handle, frame.header.corr);
    const pending = this.pending.get(key);
    if (pending) {
      if (pending.acceptFrame && !pending.acceptFrame(frame))
        return;
      switch (frame.header.ty) {
        case FrameType.Push:
        case FrameType.StreamData:
          try {
            pending.onProgress?.(frame.body);
          } catch {}
          return;
        case FrameType.Response:
        case FrameType.StreamEnd:
          this.settle(key, pending, () => pending.resolve(frame));
          return;
        case FrameType.Error:
          this.settle(key, pending, () => pending.reject(this.errorFromFrame(frame)));
          return;
        default:
          return;
      }
    }
    const late = this.lateResponses.get(key);
    if (late && (frame.header.ty === FrameType.Response || frame.header.ty === FrameType.Error)) {
      this.lateResponses.delete(key);
      late(frame);
      return;
    }
    if (frame.header.ty === FrameType.Goodbye && handle) {
      this.failHandle(handle, new SubcError("route closed by subc (GOODBYE)", "route_closed"));
      if (this.liveRoutes.get(handle.channel) === handle)
        this.liveRoutes.delete(handle.channel);
      this.evictRouteHandle(handle);
      return;
    }
    if (frame.header.ty === FrameType.Response || frame.header.ty === FrameType.Error || frame.header.ty === FrameType.StreamEnd) {
      debug("dropped terminal frame with no waiter: type=%d channel=%d epoch=%d corr=%s port=%s", frame.header.ty, frame.header.channel, frame.header.epoch, frame.header.corr, this.sock.localPort() ?? "?");
    }
  }
  settle(key, pending, run) {
    if (this.pending.get(key) !== pending)
      return false;
    this.pending.delete(key);
    if (pending.timer)
      clearTimeout(pending.timer);
    run();
    pending.onSettle?.();
    return true;
  }
  rejectPending(key, pending, err) {
    this.settle(key, pending, () => pending.reject(pending.classifyFailure?.(err) ?? err));
  }
  errorFromFrame(frame) {
    try {
      const parsed = JSON.parse(Buffer.from(frame.body).toString("utf8"));
      return new SubcError(parsed.message ?? "subc error", parsed.code, parsed.detail);
    } catch {
      return new SubcError(Buffer.from(frame.body).toString("utf8") || "subc error");
    }
  }
  evictRouteHandle(handle) {
    for (const cached of this.routes.values()) {
      if (cached.handle && sameRouteHandle(cached.handle, handle))
        cached.handle = null;
    }
  }
  failHandle(handle, error) {
    for (const [key, pending] of this.pending) {
      if (pending.handle && sameRouteHandle(pending.handle, handle))
        this.rejectPending(key, pending, error);
    }
  }
  fail(err) {
    if (!this.closedErr)
      this.closedErr = err;
    for (const [key, pending] of this.pending) {
      this.rejectPending(key, pending, err);
    }
  }
  notSentCallError(message, cause) {
    return new SubcCallError("not_sent", `${message}${causeMessage(cause)}`, errorCode(cause), cause);
  }
  outcomeUnknownCallError(message, cause) {
    return new SubcCallError("outcome_unknown", `${message}${causeMessage(cause)}`, errorCode(cause), cause);
  }
  terminalCallError(message, cause) {
    if (cause instanceof SubcCallError)
      return cause;
    return new SubcCallError("terminal", `${message}${causeMessage(cause)}`, errorCode(cause), cause);
  }
  notSentRecoveryError(message, cause) {
    if (cause instanceof SubcCallError)
      return cause;
    if (isConsumerReconnectTransient(cause))
      return this.notSentCallError(message, cause);
    return this.terminalCallError(message, cause);
  }
  get droppedIngressFrames() {
    return this.ingressEpochDropCount;
  }
  installRoute(channel, epoch) {
    const handle = createRouteHandle(channel, epoch, this.connectionToken);
    this.liveRoutes.set(channel, handle);
    return handle;
  }
  isLiveHandle(handle) {
    return belongsToConnection(handle, this.connectionToken) && this.liveRoutes.get(handle.channel) === handle;
  }
  assertLiveConnection(handle) {
    if (!belongsToConnection(handle, this.connectionToken))
      throw new StaleRouteHandleError(handle);
  }
  assertLiveHandle(handle) {
    if (!this.isLiveHandle(handle))
      throw new StaleRouteHandleError(handle);
  }
  allocateCorr() {
    const maximum = 0xffffffffffffffffn;
    if (this.nextCorr > maximum) {
      const error = new SubcError("channel-0 correlation id allocator exhausted", "corr_exhausted");
      this.fail(error);
      this.sock.close();
      this.scheduleReconnectAfterDrop(error);
      throw error;
    }
    const corr = this.nextCorr;
    this.nextCorr += 1n;
    return corr;
  }
  closeConnectionAfterCleanupFailure() {
    const error = new SubcError("late route cleanup could not be queued", "late_route_cleanup_failed");
    this.fail(error);
    this.sock.close();
    this.scheduleReconnectAfterDrop(error);
  }
  encode(value) {
    return Buffer.from(JSON.stringify(value), "utf8");
  }
  decodeReply(frame) {
    return hasBinary(frame.header.flags) ? frame.body : this.parseJson(frame);
  }
  parseJson(frame) {
    const b = frame.body;
    return JSON.parse(Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("utf8"));
  }
}
function isConsumerReconnectTransient(err) {
  if (err instanceof SocketClosedError || err instanceof SocketTimeoutError)
    return true;
  if (err instanceof SocketWriteNotQueuedError || err instanceof SocketWriteQueuedError)
    return true;
  if (err instanceof SubcCallError)
    return err.kind === "not_sent" || err.kind === "outcome_unknown";
  if (err instanceof AuthError)
    return true;
  if (err instanceof SubcError || err instanceof ConnectionFileError)
    return false;
  const code = errorCode(err);
  return code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EPIPE" || code === "ETIMEDOUT" || code === "ENOENT";
}
function isRouteOpenRefusal(err) {
  return err instanceof SubcError && typeof err.code === "string";
}
function isRetryableRouteOpenCode(code) {
  if (code === "capability_forbidden")
    return false;
  return code === "unknown_module" || code === "module_reloading" || code === "module_warming" || code === "target_unavailable" || code === "module_timeout";
}
async function connectionFileExists(path) {
  try {
    await fs2.access(path);
    return true;
  } catch {
    return false;
  }
}
function normalizeConnectOptions(opts) {
  return {
    connectionFile: opts.connectionFile,
    handshakeTimeoutMs: opts.handshakeTimeoutMs,
    identity: opts.identity,
    targetKind: opts.targetKind ?? DEFAULT_MANAGED_TARGET_KIND,
    reconnectBackoff: opts.reconnectBackoff ?? DEFAULT_RECONNECT_BACKOFF,
    sleep: opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    routeOpenRetryDeadlineMs: opts.routeOpenRetryDeadlineMs ?? ROUTE_OPEN_RETRY_DEADLINE_MS,
    timeoutArbitrationGraceMs: opts.timeoutArbitrationGraceMs ?? TIMEOUT_ARBITRATION_GRACE_MS,
    livenessProbeWindowMs: opts.livenessProbeWindowMs ?? LIVENESS_PROBE_WINDOW_MS,
    onControlPush: opts.onControlPush
  };
}
function isValidCapabilityIdentifier(identifier) {
  if (/\s/u.test(identifier))
    return false;
  const separator = identifier.indexOf("/v");
  if (separator <= 0 || identifier.indexOf("/v", separator + 1) !== -1)
    return false;
  const name = identifier.slice(0, separator);
  const version = identifier.slice(separator + 2);
  if (new TextEncoder().encode(name).byteLength > 64 || version.length === 0)
    return false;
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/u.test(name) && !/^[a-z]$/u.test(name))
    return false;
  if (name.includes("--"))
    return false;
  if (!/^\d+$/u.test(version) || version.length > 1 && version.startsWith("0"))
    return false;
  const numericVersion = Number(version);
  return Number.isSafeInteger(numericVersion) && numericVersion >= 1 && numericVersion <= 4294967295;
}
function routeCacheKey(target, identity, consumerIdentity) {
  const consumerPart = consumerIdentity ? `${consumerIdentity.module_id}\x00${consumerIdentity.launch_nonce}` : "";
  return `${target.kind}\x00${target.module_id}\x00${identity.project_root}\x00${identity.harness}\x00${identity.session}\x00${consumerPart}`;
}
function routeOpenConsumerIdentity(opts = {}) {
  if (opts.consumerIdentity !== undefined)
    return opts.consumerIdentity ?? undefined;
  const moduleId = process.env[SUBC_MODULE_ID_ENV];
  const launchNonce = process.env[SUBC_LAUNCH_NONCE_ENV];
  if (!moduleId || !launchNonce)
    return;
  return { module_id: moduleId, launch_nonce: launchNonce };
}
function errorCode(err) {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = err.code;
    if (typeof code === "string")
      return code;
  }
  return;
}
function causeMessage(cause) {
  if (cause === undefined)
    return "";
  return `: ${cause instanceof Error ? cause.message : String(cause)}`;
}
function pendingKey(handle, corr) {
  return handle ? `${handle.channel}:${handle.epoch}:${corr}` : `0:0:${corr}`;
}
// ../plugin/src/features/magic-context/memory/embedding-synapse.ts
var SYNAPSE_DEFAULT_MODEL = "gte-modernbert-base-f16";
var SYNAPSE_DEFAULT_QUERY_TIMEOUT_MS = 3000;
var SYNAPSE_DEFAULT_BATCH_TIMEOUT_MS = 120000;
var SYNAPSE_CERTIFICATION_REFUSAL_REASONS = new Set([
  "not_certified",
  "probe_required",
  "migration_required"
]);
var embeddingRowMetadata = new WeakMap;
function isSynapseEmbeddingTruncated(vector) {
  return embeddingRowMetadata.get(vector)?.truncated === true;
}
function toSynapseLaneDescriptor(metadata) {
  const tokenBudget = metadata.recommended_token_budget;
  return {
    lane: metadata.model,
    ...metadata.device_class ? { device_class: metadata.device_class } : {},
    max_tokens: metadata.max_tokens,
    max_tokens_source: metadata.max_tokens_source,
    ...metadata.bucket_ladder ? { bucket_ladder: [...metadata.bucket_ladder] } : {},
    ...metadata.dims ? { dims: metadata.dims } : {},
    ...metadata.dtype ? { dtype: metadata.dtype } : {},
    ...typeof metadata.certified === "boolean" ? { certified: metadata.certified } : {},
    ...metadata.warm_load_cost_hint_ms !== undefined ? { warm_load_cost_hint_ms: metadata.warm_load_cost_hint_ms } : {},
    ...metadata.recommended_batch ? {
      recommended_batch: {
        rows: metadata.recommended_batch,
        ...tokenBudget !== undefined ? { token_budget: tokenBudget } : {}
      }
    } : {},
    warm: metadata.max_tokens_source === "runtime_bucket" || metadata.max_tokens_source === "worker_bucket"
  };
}
function formatSynapseLaneDescriptor(descriptor) {
  const certified = descriptor.certified === undefined ? "unknown" : String(descriptor.certified);
  return `lane=${descriptor.lane}; device_class=${descriptor.device_class ?? "unknown"}; ` + `max_tokens=${descriptor.max_tokens} (${descriptor.max_tokens_source}); ` + `certified=${certified}; warm=${descriptor.warm ? "yes" : "no"}; ` + `warm_load_cost_hint_ms=${descriptor.warm_load_cost_hint_ms ?? "unknown"}`;
}

class SynapseEmbeddingError extends Error {
  code;
  retryAfterMs;
  permanent;
  refusalReason;
  constructor(code, message, options) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SynapseEmbeddingError";
    this.code = code;
    this.permanent = options?.permanent ?? isPermanentSynapseCode(code);
    this.retryAfterMs = options?.retryAfterMs ?? (this.permanent ? undefined : 100);
    this.refusalReason = options?.refusalReason;
  }
}
function isPermanentSynapseCode(code) {
  return code === "artifact_invalid" || code === "substitution_rejected" || code === "not_certified" || code === "probe_required" || code === "idempotency_conflict" || code === "schema_violation" || code === "certification_refused" || code === "needs_reauth";
}
function asRecord(value) {
  return value !== null && typeof value === "object" ? value : null;
}
function responseBody(value) {
  const record = asRecord(value);
  const result = asRecord(record?.result);
  const payload = asRecord(result?.payload ?? record?.payload);
  return {
    ...record ?? {},
    ...result ?? {},
    ...payload ?? {}
  };
}
function readRetryAfter(value) {
  const record = asRecord(value);
  const candidate = record?.retry_after_ms ?? record?.retryAfterMs;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0)
    return;
  return Math.ceil(candidate);
}
function readErrorCode(value) {
  const record = asRecord(value);
  if (typeof record?.code === "string")
    return record.code;
  if (value instanceof Error && "code" in value && typeof value.code === "string") {
    return value.code;
  }
  return;
}
function readCertificationRefusalReason(value) {
  if (!(value instanceof SubcCallError))
    return;
  const detail = value.detail;
  if (typeof detail === "string")
    return detail;
  const record = asRecord(detail);
  return typeof record?.reason === "string" ? record.reason : undefined;
}
function classifyError(value) {
  if (value instanceof SynapseEmbeddingError)
    return value;
  const code = readErrorCode(value) ?? (value instanceof Error ? value.name : "transport");
  const normalized = code.toLowerCase();
  const refusalReason = readCertificationRefusalReason(value);
  let mapped = "transport";
  if (normalized.includes("queue_full"))
    mapped = "queue_full";
  else if (normalized.includes("model_loading"))
    mapped = "model_loading";
  else if (normalized.includes("timeout") || normalized.includes("deadline"))
    mapped = "timeout";
  else if (normalized.includes("artifact_invalid"))
    mapped = "artifact_invalid";
  else if (normalized.includes("substitution"))
    mapped = "substitution_rejected";
  else if (normalized === "certification_refused")
    mapped = "certification_refused";
  else if (normalized.includes("not_certified"))
    mapped = "not_certified";
  else if (normalized.includes("probe_required"))
    mapped = "probe_required";
  else if (normalized.includes("idempotency_conflict"))
    mapped = "idempotency_conflict";
  else if (normalized.includes("needs_reauth"))
    mapped = "needs_reauth";
  else if (normalized.includes("schema"))
    mapped = "schema_violation";
  else if (normalized.includes("module_restarted") || normalized.includes("module restarted"))
    mapped = "module_restarted";
  const message = value instanceof Error ? value.message : String(value);
  return new SynapseEmbeddingError(mapped, message, {
    retryAfterMs: readRetryAfter(value) ?? (isPermanentSynapseCode(mapped) ? undefined : 100),
    cause: value,
    refusalReason
  });
}
function embeddingFailureFor(error) {
  const typedReason = error.refusalReason;
  if (typedReason !== undefined && SYNAPSE_CERTIFICATION_REFUSAL_REASONS.has(typedReason) || error.code === "not_certified" || error.code === "probe_required") {
    return {
      class: "certification_refusal",
      reason: `SYNAPSE certification refused embedding: ${typedReason ?? error.code}`,
      retryable: false
    };
  }
  if (error.code === "certification_refused") {
    return {
      class: "certification_refusal",
      reason: `SYNAPSE certification refused embedding: ${typedReason ?? "unknown reason"}`,
      retryable: false
    };
  }
  if (typedReason === "needs_reauth" || typedReason === "needs_reauth_expired") {
    return {
      class: "credential_required",
      reason: "SYNAPSE requires reauthentication",
      retryable: false
    };
  }
  if (error.code === "substitution_rejected") {
    return { class: "substitution_rejected", reason: error.message, retryable: false };
  }
  if (error.code === "schema_violation" || error.code === "artifact_invalid") {
    return { class: "invalid_envelope", reason: error.message, retryable: false };
  }
  return { class: "transport_error", reason: error.message, retryable: !error.permanent };
}
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function stableJson(value) {
  if (Array.isArray(value))
    return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function getSynapseLaneIdentity(model, fingerprint) {
  return `synapse:v1:${sha256(stableJson({ model, fingerprint }))}`;
}
function getSynapseBatchRequestKey(args) {
  return sha256(stableJson({
    op: "embed.batch",
    model: args.model,
    required_fingerprint: args.fingerprint,
    required_epoch: args.tableEpoch,
    allow_equivalent: false,
    accept_declared: false,
    ids: args.items.map((item) => item.id),
    content_sha256: args.items.map((item) => item.contentSha256),
    ...args.purpose === "query" ? { purpose: args.purpose } : {}
  }));
}
function hashContent(text) {
  return sha256(text);
}
function extractCatalogEntries(value) {
  const body = responseBody(value);
  const raw = Array.isArray(body.models) ? body.models : Array.isArray(body.entries) ? body.entries : Array.isArray(value) ? value : [];
  const envelopeEpoch = typeof body.table_epoch === "number" && Number.isInteger(body.table_epoch) ? body.table_epoch : undefined;
  const maxTokenSources = new Set([
    "runtime_bucket",
    "worker_bucket",
    "catalog",
    "catalog_unloaded"
  ]);
  return raw.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record)
      return [];
    const model = typeof record.model === "string" && record.model.length > 0 ? record.model : typeof record.model_id === "string" ? record.model_id : "";
    const fingerprint = typeof record.fingerprint === "string" && record.fingerprint.length > 0 ? record.fingerprint : Array.isArray(record.fingerprints) && typeof record.fingerprints[0] === "string" ? record.fingerprints[0] : "";
    const entryEpoch = record.table_epoch ?? record.tableEpoch;
    const tableEpoch = typeof entryEpoch === "number" && Number.isInteger(entryEpoch) ? entryEpoch : envelopeEpoch;
    const maxTokens = record.max_tokens;
    const maxTokensSource = record.max_tokens_source;
    if (model.length === 0 || fingerprint.length === 0 || typeof tableEpoch !== "number" || !Number.isInteger(tableEpoch) || typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens <= 0 || typeof maxTokensSource !== "string" || !maxTokenSources.has(maxTokensSource)) {
      return [];
    }
    const dims = record.dims ?? record.dimensions;
    const rawBatch = record.recommended_batch ?? record.recommendedBatch;
    const batchRecord = asRecord(rawBatch);
    const recommendedBatch = typeof rawBatch === "number" ? rawBatch : batchRecord ? batchRecord.rows : undefined;
    const recommendedTokenBudget = batchRecord ? batchRecord.token_budget : undefined;
    const bucketLadder = Array.isArray(record.bucket_ladder) ? record.bucket_ladder.filter((bucket) => typeof bucket === "number" && Number.isInteger(bucket) && bucket > 0) : undefined;
    const state = typeof record.state === "string" ? record.state : undefined;
    const warmLoadCostHint = record.warm_load_cost_hint_ms;
    return [
      {
        model,
        fingerprint,
        table_epoch: tableEpoch,
        max_tokens: maxTokens,
        max_tokens_source: maxTokensSource,
        ...bucketLadder && bucketLadder.length > 0 ? { bucket_ladder: [...new Set(bucketLadder)].sort((a, b) => a - b) } : {},
        ...typeof dims === "number" && Number.isInteger(dims) && dims > 0 ? { dims } : {},
        ...typeof record.dtype === "string" && record.dtype.length > 0 ? { dtype: record.dtype } : {},
        ...typeof record.device_class === "string" && record.device_class.length > 0 ? { device_class: record.device_class } : {},
        ...typeof recommendedBatch === "number" && recommendedBatch > 0 ? { recommended_batch: Math.floor(recommendedBatch) } : {},
        ...typeof recommendedTokenBudget === "number" && recommendedTokenBudget > 0 ? { recommended_token_budget: Math.floor(recommendedTokenBudget) } : {},
        ...record.provenance !== undefined ? { provenance: record.provenance } : {},
        ...typeof record.certified === "boolean" ? { certified: record.certified } : {},
        ...typeof warmLoadCostHint === "number" && Number.isFinite(warmLoadCostHint) && warmLoadCostHint >= 0 ? { warm_load_cost_hint_ms: warmLoadCostHint } : {},
        ...typeof record.status === "string" ? { status: record.status } : state ? { status: state } : {}
      }
    ];
  });
}
function extractVector(value) {
  const body = responseBody(value);
  const item = Array.isArray(body.vectors) ? asRecord(body.vectors[0]) : null;
  const raw = item?.vector;
  if (!item || !Array.isArray(raw) || raw.some((component) => typeof component !== "number" || !Number.isFinite(component))) {
    return null;
  }
  const disclosure = Array.isArray(body.truncation_disclosures) ? asRecord(body.truncation_disclosures[0]) : null;
  return { vector: Float32Array.from(raw), item, disclosure, metadata: body };
}
function extractBatchItems(value) {
  const body = responseBody(value);
  const raw = Array.isArray(body.vectors) ? body.vectors : Array.isArray(body.items) ? body.items : Array.isArray(body.results) ? body.results : [];
  return raw.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}
function extractTruncationDisclosures(value) {
  const body = responseBody(value);
  if (!Array.isArray(body.truncation_disclosures))
    return [];
  return body.truncation_disclosures.map((disclosure) => asRecord(disclosure));
}
function validateWireRow(item, disclosure, expected) {
  const submittedSha256 = item.submitted_sha256;
  const contentSha256 = item.content_sha256;
  const expectedSubmittedSha256 = hashContent(expected.text);
  if (typeof submittedSha256 !== "string") {
    throw new SynapseEmbeddingError("schema_violation", `Synapse item ${expected.id} omitted submitted_sha256`);
  }
  if (submittedSha256 !== expectedSubmittedSha256) {
    throw new SynapseEmbeddingError("schema_violation", `Synapse submitted hash mismatch for item ${expected.id}`);
  }
  if (typeof contentSha256 !== "string") {
    throw new SynapseEmbeddingError("schema_violation", `Synapse item ${expected.id} omitted content_sha256`);
  }
  const hashesDiffer = contentSha256 !== submittedSha256;
  const disclosedTruncation = disclosure?.truncated === true;
  const effectiveTokens = disclosure?.effective_tokens;
  if (disclosure && (typeof disclosure.truncated !== "boolean" || typeof effectiveTokens !== "number" || !Number.isInteger(effectiveTokens) || effectiveTokens < 0)) {
    throw new SynapseEmbeddingError("schema_violation", `Synapse item ${expected.id} returned an invalid truncation disclosure`);
  }
  if (hashesDiffer) {
    if (!disclosedTruncation || typeof effectiveTokens !== "number" || !Number.isInteger(effectiveTokens) || effectiveTokens < 0) {
      throw new SynapseEmbeddingError("schema_violation", `Synapse item ${expected.id} changed content without a valid truncation disclosure`);
    }
  } else if (disclosedTruncation) {
    throw new SynapseEmbeddingError("schema_violation", `Synapse item ${expected.id} disclosed truncation but returned matching hashes`);
  }
  return {
    truncated: hashesDiffer,
    submittedSha256,
    contentSha256,
    ...typeof effectiveTokens === "number" && Number.isInteger(effectiveTokens) && effectiveTokens >= 0 ? { effectiveTokens } : {}
  };
}
var sharedClient = null;
var sharedClientFile = null;
var sharedClientPromise = null;
var factoryClients = new WeakMap;
async function getSharedClient(options) {
  if (options.clientFactory) {
    let promise = factoryClients.get(options.clientFactory);
    if (!promise) {
      promise = options.clientFactory();
      factoryClients.set(options.clientFactory, promise);
    }
    return promise;
  }
  if (sharedClient && sharedClientFile === options.connectionFile)
    return sharedClient;
  if (sharedClientPromise && sharedClientFile === options.connectionFile)
    return sharedClientPromise;
  sharedClientFile = options.connectionFile;
  sharedClientPromise = SubcClient.connect({ connectionFile: options.connectionFile }).then((client) => {
    sharedClient = client;
    return client;
  });
  return sharedClientPromise;
}

class SynapseEmbeddingProvider {
  modelId;
  metadata;
  get maxInputTokens() {
    return this.metadata?.max_tokens;
  }
  options;
  client = null;
  initialized = false;
  initializing = null;
  permanentFailure = false;
  lastFailureReason = null;
  batchLimit = 16;
  tokenBudget = null;
  constructor(options) {
    this.options = options;
    const model = options.model || SYNAPSE_DEFAULT_MODEL;
    const fingerprint = options.fingerprint ?? "";
    const descriptor = options.descriptor;
    this.metadata = options.metadata ? {
      ...options.metadata,
      bucket_ladder: options.metadata.bucket_ladder ? [...options.metadata.bucket_ladder] : undefined
    } : fingerprint && Number.isInteger(options.tableEpoch) && descriptor ? {
      model,
      fingerprint,
      table_epoch: options.tableEpoch,
      max_tokens: descriptor.max_tokens,
      max_tokens_source: descriptor.max_tokens_source,
      ...descriptor.bucket_ladder ? { bucket_ladder: [...descriptor.bucket_ladder] } : {},
      ...options.dims ?? descriptor.dims ? { dims: options.dims ?? descriptor.dims } : {},
      ...descriptor.dtype ? { dtype: descriptor.dtype } : {},
      ...descriptor.device_class ? { device_class: descriptor.device_class } : {},
      ...options.recommendedBatch ?? descriptor.recommended_batch?.rows ? {
        recommended_batch: Math.max(1, Math.floor(options.recommendedBatch ?? descriptor.recommended_batch?.rows))
      } : {},
      ...options.recommendedTokenBudget ?? descriptor.recommended_batch?.token_budget ? {
        recommended_token_budget: Math.max(1, Math.floor(options.recommendedTokenBudget ?? descriptor.recommended_batch?.token_budget))
      } : {},
      ...options.provenance !== undefined ? { provenance: options.provenance } : {},
      ...typeof descriptor.certified === "boolean" ? { certified: descriptor.certified } : {},
      ...descriptor.warm_load_cost_hint_ms !== undefined ? { warm_load_cost_hint_ms: descriptor.warm_load_cost_hint_ms } : {},
      laneIdentity: getSynapseLaneIdentity(model, fingerprint)
    } : null;
    this.modelId = this.metadata?.laneIdentity ?? "synapse:v1:pending";
    this.batchLimit = this.metadata?.recommended_batch ?? 16;
    this.tokenBudget = this.metadata?.recommended_token_budget ?? null;
  }
  nextPage(items, start) {
    const hardEnd = Math.min(items.length, start + this.batchLimit);
    if (this.tokenBudget === null)
      return items.slice(start, hardEnd);
    let end = start;
    let tokens = 0;
    while (end < hardEnd) {
      tokens += estimateTokens(items[end].text);
      if (tokens > this.tokenBudget && end > start)
        break;
      end += 1;
    }
    return items.slice(start, Math.max(end, start + 1));
  }
  static async discover(options) {
    const provider = new SynapseEmbeddingProvider(options);
    if (!await provider.initialize() || !provider.metadata) {
      throw new SynapseEmbeddingError("not_certified", "Synapse lane is not ready");
    }
    return provider.metadata;
  }
  async initialize() {
    if (this.initialized)
      return true;
    if (this.permanentFailure)
      return false;
    if (this.initializing)
      return this.initializing;
    this.initializing = (async () => {
      try {
        if (!this.options.clientFactory && !await connectionFileExists(this.options.connectionFile)) {
          throw new SynapseEmbeddingError("transport", `Synapse connection file is unavailable: ${this.options.connectionFile}`);
        }
        this.client = await getSharedClient(this.options);
        if (!this.metadata) {
          const discovered = await this.callWithRetry("models.list", {}, this.options.queryTimeoutMs ?? SYNAPSE_DEFAULT_QUERY_TIMEOUT_MS, false);
          const entries = extractCatalogEntries(discovered);
          const requested = this.options.model?.trim() || SYNAPSE_DEFAULT_MODEL;
          const entry = entries.find((candidate) => candidate.model === requested);
          if (!entry) {
            throw new SynapseEmbeddingError("artifact_invalid", `Synapse models.list did not return requested model ${requested}`);
          }
          if (entry.certified === false || entry.status === "not_certified") {
            throw new SynapseEmbeddingError("not_certified", `Synapse model ${entry.model} is not certified`);
          }
          const metadata = {
            ...entry,
            laneIdentity: getSynapseLaneIdentity(entry.model, entry.fingerprint)
          };
          this.metadata = metadata;
          this.modelId = metadata.laneIdentity;
          this.batchLimit = metadata.recommended_batch ?? this.batchLimit;
          this.tokenBudget = metadata.recommended_token_budget ?? this.tokenBudget;
        }
        this.initialized = true;
        this.recordSuccess();
        return true;
      } catch (error) {
        const classified = classifyError(error);
        this.recordFailure(classified);
        if (classified.permanent) {
          this.permanentFailure = true;
          log2(`[magic-context] Synapse lane disabled: ${classified.code}: ${classified.message}`);
        } else {
          log2(`[magic-context] Synapse lane unavailable: ${classified.message}`);
        }
        this.initialized = false;
        return false;
      } finally {
        this.initializing = null;
      }
    })();
    return this.initializing;
  }
  async embed(text, signal, purpose = "passage") {
    if (!await this.initialize() || signal?.aborted || !this.metadata)
      return null;
    if (estimateTokens(text) > this.metadata.max_tokens)
      return null;
    try {
      const id = "query";
      const value = await this.callWithRetry("embed.query", this.requestConstraints({
        id,
        text,
        purpose,
        deadline_ms: this.options.queryTimeoutMs ?? SYNAPSE_DEFAULT_QUERY_TIMEOUT_MS
      }), this.options.queryTimeoutMs ?? SYNAPSE_DEFAULT_QUERY_TIMEOUT_MS, true, signal);
      const extracted = extractVector(value);
      if (!extracted) {
        throw new SynapseEmbeddingError("schema_violation", "Synapse query returned no vector row");
      }
      if (extracted.item.id !== id) {
        throw new SynapseEmbeddingError("schema_violation", `Synapse query returned unexpected item ${String(extracted.item.id)}`);
      }
      const rowMetadata = validateWireRow(extracted.item, extracted.disclosure, { id, text });
      this.validateResponse(extracted.metadata, extracted.vector.length);
      embeddingRowMetadata.set(extracted.vector, rowMetadata);
      this.recordSuccess();
      return extracted.vector;
    } catch (error) {
      this.logCallFailure(error, "embed.query");
      return null;
    }
  }
  async embedBatch(texts, signal, purpose = "passage") {
    if (texts.length === 0)
      return [];
    const items = texts.map((text, index) => ({
      id: `item:${index}`,
      text,
      contentSha256: hashContent(text)
    }));
    const map = await this.embedItems(items, signal, purpose);
    return items.map((item) => map.get(item.id) ?? null);
  }
  async embedItems(items, signal, purpose = "passage") {
    const output = new Map;
    if (items.length === 0 || !await this.initialize() || !this.metadata || signal?.aborted) {
      return output;
    }
    const maxTokens = this.metadata.max_tokens;
    const eligibleItems = items.filter((item) => estimateTokens(item.text) <= maxTokens).map((item) => ({ ...item, contentSha256: hashContent(item.text) }));
    for (let start = 0;start < eligibleItems.length; ) {
      if (signal?.aborted || this.permanentFailure)
        break;
      const page = this.nextPage(eligibleItems, start);
      start += page.length;
      try {
        const requestKey = this.requestKey(page, purpose);
        let body = {};
        let restarted = false;
        for (;; ) {
          try {
            body = await this.callWithRetry("embed.batch", this.batchRequest(page, requestKey, purpose), this.options.batchTimeoutMs ?? SYNAPSE_DEFAULT_BATCH_TIMEOUT_MS, true, signal);
            const first = responseBody(body);
            const jobId = typeof first.job_id === "string" ? first.job_id : null;
            if (jobId)
              body = await this.pollBatch(jobId, requestKey, signal);
            break;
          } catch (error) {
            const classified = classifyError(error);
            if (classified.code !== "module_restarted" || restarted)
              throw classified;
            restarted = true;
          }
        }
        const batchEnvelope = responseBody(body);
        const disclosures = extractTruncationDisclosures(body);
        for (const [index, item] of extractBatchItems(body).entries()) {
          const id = typeof item.id === "string" ? item.id : "";
          const vector = item.vector ?? item.embedding;
          if (!id || !Array.isArray(vector) || vector.some((component) => typeof component !== "number" || !Number.isFinite(component))) {
            throw new SynapseEmbeddingError("schema_violation", "Synapse batch item is malformed");
          }
          const expected = page.find((candidate) => candidate.id === id);
          if (!expected) {
            throw new SynapseEmbeddingError("schema_violation", `Synapse returned unknown item ${id}`);
          }
          const rowMetadata = validateWireRow(item, disclosures[index] ?? null, expected);
          const vectorArray = Float32Array.from(vector);
          this.validateResponse({ ...batchEnvelope, ...item }, vectorArray.length);
          embeddingRowMetadata.set(vectorArray, rowMetadata);
          output.set(id, vectorArray);
          this.recordSuccess();
        }
      } catch (error) {
        const classified = classifyError(error);
        this.logCallFailure(classified, "embed.batch");
        if (classified.code === "idempotency_conflict" || classified.code === "schema_violation") {
          throw classified;
        }
        if (classified.permanent) {
          this.permanentFailure = true;
          this.initialized = false;
          break;
        }
      }
    }
    return output;
  }
  async dispose() {
    this.initialized = false;
    this.client = null;
  }
  isLoaded() {
    return this.initialized;
  }
  getLastFailureReason() {
    return this.lastFailureReason;
  }
  requestConstraints(extra) {
    const metadata = this.metadata;
    if (!metadata)
      return extra;
    return {
      ...extra,
      model: metadata.model,
      required_fingerprint: metadata.fingerprint,
      required_epoch: metadata.table_epoch,
      allow_equivalent: false,
      accept_declared: false
    };
  }
  batchRequest(items, requestKey, purpose) {
    return this.requestConstraints({
      items: items.map((item) => ({
        id: item.id,
        text: item.text,
        content_sha256: item.contentSha256
      })),
      request_key: requestKey,
      purpose
    });
  }
  requestKey(items, purpose) {
    if (!this.metadata)
      throw new SynapseEmbeddingError("transport", "Synapse metadata is unavailable");
    return getSynapseBatchRequestKey({
      model: this.metadata.model,
      fingerprint: this.metadata.fingerprint,
      tableEpoch: this.metadata.table_epoch,
      items,
      purpose
    });
  }
  async pollBatch(jobId, requestKey, signal) {
    let cursor = null;
    const allItems = [];
    const allDisclosures = [];
    for (;; ) {
      if (signal?.aborted)
        return {};
      const body = await this.callWithRetry("embed.result", this.requestConstraints({
        job_id: jobId,
        cursor,
        request_key: requestKey
      }), this.options.batchTimeoutMs ?? SYNAPSE_DEFAULT_BATCH_TIMEOUT_MS, true, signal);
      const parsed = responseBody(body);
      const items = extractBatchItems(body);
      const disclosures = extractTruncationDisclosures(body);
      allItems.push(...items);
      allDisclosures.push(...items.map((_, index) => disclosures[index] ?? null));
      const nextCursor = parsed.next_cursor ?? parsed.cursor;
      const done = parsed.done === true || parsed.complete === true || nextCursor === undefined || nextCursor === null;
      if (done) {
        return {
          ...parsed,
          vectors: allItems,
          truncation_disclosures: allDisclosures
        };
      }
      cursor = nextCursor;
    }
  }
  async callWithRetry(method, params, timeoutMs, retryEmbeddings, signal) {
    let attempt = 0;
    for (;; ) {
      if (signal?.aborted)
        throw new SynapseEmbeddingError("transport", "Synapse request aborted");
      try {
        if (!this.client)
          throw new SynapseEmbeddingError("transport", "Synapse client is unavailable");
        return await this.client.call(this.options.moduleId ?? "synapse", method, params, {
          timeoutMs,
          targetKind: "management_surface",
          identity: {
            project_root: this.options.projectRoot,
            harness: getHarness2(),
            session: this.options.session
          }
        });
      } catch (error) {
        const classified = classifyError(error);
        if (classified.code === "idempotency_conflict")
          throw classified;
        const outcomeUnknown = error instanceof SubcCallError && error.kind === "outcome_unknown";
        const retryable = !classified.permanent && (retryEmbeddings || !outcomeUnknown);
        if (!retryable || attempt >= 3)
          throw classified;
        const delay = classified.retryAfterMs ?? Math.min(2000, 100 * 2 ** attempt);
        attempt += 1;
        await wait(delay);
      }
    }
  }
  validateResponse(body, dims) {
    const metadata = this.metadata;
    if (!metadata) {
      throw new SynapseEmbeddingError("artifact_invalid", "Synapse lane metadata missing");
    }
    if (metadata.dims === undefined) {
      const envelopeDims = body.dims;
      if (typeof envelopeDims === "number" && envelopeDims !== dims) {
        throw new SynapseEmbeddingError("artifact_invalid", `Synapse envelope declares ${envelopeDims} dimensions but the vector has ${dims}`);
      }
      metadata.dims = dims;
    }
    if (dims !== metadata.dims) {
      throw new SynapseEmbeddingError("artifact_invalid", `Synapse returned ${dims} dimensions, expected ${metadata.dims}`);
    }
    const fingerprint = body.fingerprint ?? body.served_fingerprint;
    if (typeof fingerprint !== "string") {
      throw new SynapseEmbeddingError("artifact_invalid", "Synapse response omitted the served fingerprint");
    }
    if (fingerprint !== metadata.fingerprint) {
      throw new SynapseEmbeddingError("substitution_rejected", `Synapse fingerprint changed from ${metadata.fingerprint} to ${fingerprint}`);
    }
    const epoch = body.table_epoch ?? body.tableEpoch;
    if (typeof epoch !== "number") {
      throw new SynapseEmbeddingError("artifact_invalid", "Synapse response omitted the served table epoch");
    }
    if (epoch !== metadata.table_epoch) {
      throw new SynapseEmbeddingError("substitution_rejected", `Synapse table epoch changed from ${metadata.table_epoch} to ${epoch}`);
    }
  }
  logCallFailure(error, operation) {
    const classified = classifyError(error);
    this.recordFailure(classified);
    if (classified.permanent)
      this.permanentFailure = true;
    const suffix = classified.retryAfterMs === undefined ? "" : ` retry_after_ms=${classified.retryAfterMs}`;
    log2(`[magic-context] Synapse ${operation} failed: ${classified.code}${suffix}: ${classified.message}`);
  }
  recordFailure(error) {
    this.lastFailureReason = embeddingFailureFor(error);
  }
  recordSuccess() {
    this.lastFailureReason = null;
  }
}

export { SubcClient, connectionFileExists, SYNAPSE_DEFAULT_MODEL, isSynapseEmbeddingTruncated, toSynapseLaneDescriptor, formatSynapseLaneDescriptor, getSynapseLaneIdentity, getSynapseBatchRequestKey, SynapseEmbeddingProvider };
