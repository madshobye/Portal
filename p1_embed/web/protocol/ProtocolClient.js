import { canEncodeCommand, decodeFrame, encodeCommand } from "./P1MsgPack.js?v=0.1.87-ui345";

export class ProtocolClient extends EventTarget {
  constructor(transport, { timeoutMs = 15000 } = {}) {
    super();
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();

    this.transport.addEventListener("line", (event) => this.acceptLine(event.detail.line));
    this.transport.addEventListener("frame", (event) => this.acceptFrame(event.detail.data));
    this.transport.addEventListener("state", (event) => {
      this.emit("state", event.detail);
      if (event.detail?.state === "session_restored") this.replayPendingFrames();
    });
    this.transport.addEventListener("error", (event) => this.emit("error", event.detail));
  }

  async request(name, data = {}, options = {}) {
    const encoding = this.preferredEncoding(name, options);
    if (encoding === "msgpack") return await this.requestMsgPack(name, data, options);
    return await this.requestJson(name, data, options);
  }

  async requestJson(name, data = {}, options = {}) {
    const id = String(this.nextId++);
    const timeoutMs = options.timeoutMs || this.timeoutMs;
    const message = {
      type: "cmd",
      id,
      name,
      data,
      ...data,
    };

    const responsePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${name} after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, name, json: JSON.stringify(message) });
    });

    await this.transport.sendLine(JSON.stringify(message));
    return await responsePromise;
  }

  async requestMsgPack(name, data = {}, options = {}) {
    if (!this.transport.sendBytes) throw new Error("Transport does not support MessagePack frames");
    if (!canEncodeCommand(name)) throw new Error(`No MessagePack opcode for ${name}`);
    const id = String(this.nextId++);
    const timeoutMs = options.timeoutMs || this.timeoutMs;
    const payload = typeof this.transport.prepareMsgPackData === "function"
      ? this.transport.prepareMsgPackData(name, data)
      : data;
    const frame = encodeCommand(id, name, payload);

    const responsePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${name} after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, name, frame, replayCount: 0 });
    });

    await this.transport.sendBytes(frame);
    return await responsePromise;
  }

  preferredEncoding(name, options = {}) {
    const requested = String(options.encoding || options.transportEncoding || "auto").toLowerCase();
    if (requested === "json") {
      if (!this.canUseJson()) throw new Error(`JSON channel is not available for ${name}`);
      return "json";
    }
    if (requested === "msgpack") {
      if (!this.canUseMsgPack(name)) throw new Error(`No MessagePack channel for ${name}`);
      return "msgpack";
    }
    if (this.canUseMsgPack(name)) return "msgpack";
    if (this.canUseJson()) return "json";
    throw new Error(`No protocol encoding available for ${name}`);
  }

  canUseMsgPack(name) {
    if (!canEncodeCommand(name)) return false;
    if (this.transport.supportsMsgPack === false) return false;
    if (typeof this.transport.sendBytes !== "function") return false;
    if (this.transport.msgPackMode === false) return false;
    return true;
  }

  canUseJson() {
    if (this.transport.supportsJson === false) return false;
    return typeof this.transport.sendLine === "function";
  }

  async sendRaw(text) {
    await this.transport.sendLine(text);
  }

  acceptLine(line) {
    const message = parseProtocolMessage(line);
    if (!message) {
      this.emit("raw", { line });
      return;
    }

    this.emit("message", { message });

    if (message.type === "res") {
      this.acceptResponse(message);
      return;
    }

    if (message.type === "evt") {
      this.emit("event", { event: message });
      return;
    }

    this.emit("unknown", { message });
  }

  acceptFrame(data) {
    let message;
    try {
      message = decodeFrame(data);
    } catch (error) {
      this.emit("raw", { line: `<msgpack ${data?.byteLength || data?.length || 0} bytes>`, error });
      return;
    }
    if (message.type === "batch") {
      for (const frame of message.frames || []) this.acceptFrame(frame);
      return;
    }
    this.emit("message", { message, binary: true });
    if (message.type === "res") this.acceptResponse(message);
    else if (message.type === "evt") this.emit("event", { event: message, binary: true });
    else this.emit("unknown", { message });
  }

  acceptResponse(message) {
    const id = String(message.id ?? "");
    const pending = this.pending.get(id);
    if (!pending) {
      this.emit("response", { response: message, late: true });
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (message.ok) {
      pending.resolve(message.data || {});
    } else {
      const error = new Error(message.error?.message || "Protocol command failed");
      error.code = message.error?.code || "command_failed";
      error.response = message;
      pending.reject(error);
    }
  }

  replayPendingFrames() {
    for (const [id, pending] of this.pending.entries()) {
      if (!pending.frame || pending.replayCount >= 2) continue;
      pending.replayCount += 1;
      this.transport.sendBytes(pending.frame).catch((error) => {
        const current = this.pending.get(id);
        if (current !== pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
      });
    }
  }

  cancelPending(reason = "request canceled") {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      const error = new Error(reason);
      error.code = "request_canceled";
      pending.reject(error);
    }
  }

  dispose() {
    this.cancelPending("connection closed");
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function parseProtocolMessage(line) {
  const text = String(line ?? "").trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
  }

  const candidates = ['{"type":"res"', '{"type":"evt"', '{"type":"cmd"'];
  let start = -1;
  for (const candidate of candidates) {
    const index = text.indexOf(candidate);
    if (index >= 0 && (start < 0 || index < start)) start = index;
  }
  if (start < 0) return null;

  const end = findJsonObjectEnd(text, start);
  if (end < 0) return null;

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function findJsonObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}
