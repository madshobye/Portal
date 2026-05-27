export const P1_MSGPACK_VERSION = "0.1.87-ui137";

const FRAME_CMD = 0;
const FRAME_RES = 1;
const FRAME_EVT = 2;

const OPS = {
  ping: 1,
  "status.light": 2,
  "system.info": 3,
  "config.get": 4,
  "config.set": 5,
  "debug.get": 6,
  "debug.set": 7,
  "script.get": 8,
  "wifi.status": 9,
  "wifi.connect": 10,
  "wifi.disconnect": 11,
  "script.error.get": 12,
  "script.error.clear": 13,
  "script.input": 14,
  "wrench.input": 14,
  "script.chunk.begin": 19,
  "script.chunk.add": 20,
  "script.chunk.commit": 21,
  "script.stop": 22,
  "script.restart": 24,
  "device.reboot": 30,
};

export function canEncodeCommand(name) {
  return Object.prototype.hasOwnProperty.call(OPS, name);
}

export function encodeCommand(id, name, data = {}) {
  const op = OPS[name];
  if (!op) throw new Error(`No MessagePack opcode for ${name}`);
  if (name === "config.set") return encodeConfigSet(id, op, data);
  if (name === "debug.set") return encodeDebugSet(id, op, data);
  if (name === "script.input" || name === "wrench.input") return encodeScriptInput(id, op, data);
  if (name === "script.chunk.begin") return encodeScriptChunkBegin(id, op, data);
  if (name === "script.chunk.add") return encodeScriptChunkAdd(id, op, data);
  const writer = new MsgPackWriter(32);
  writer.array(3);
  writer.uint(FRAME_CMD);
  writer.uint(Number(id));
  writer.uint(op);
  return writer.bytes();
}

function encodeConfigSet(id, op, data = {}) {
  const writer = new MsgPackWriter(256);
  writer.array(9);
  writer.uint(FRAME_CMD);
  writer.uint(Number(id));
  writer.uint(op);
  writer.bool(Object.prototype.hasOwnProperty.call(data, "deviceName"));
  writer.string(data.deviceName || "");
  writer.bool(Object.prototype.hasOwnProperty.call(data, "wifiSsid"));
  writer.string(data.wifiSsid || "");
  writer.bool(Object.prototype.hasOwnProperty.call(data, "wifiPassword"));
  writer.string(data.wifiPassword || "");
  return writer.bytes();
}

function encodeDebugSet(id, op, data = {}) {
  const writer = new MsgPackWriter(64);
  writer.array(4);
  writer.uint(FRAME_CMD);
  writer.uint(Number(id));
  writer.uint(op);
  writer.string(data.level || "info");
  return writer.bytes();
}

function encodeScriptInput(id, op, data = {}) {
  const writer = new MsgPackWriter(256);
  writer.array(5);
  writer.uint(FRAME_CMD);
  writer.uint(Number(id));
  writer.uint(op);
  writer.string(data.channel || "");
  writer.string(data.message || "");
  return writer.bytes();
}

function encodeScriptChunkBegin(id, op, data = {}) {
  const writer = new MsgPackWriter(80);
  writer.array(7);
  writer.uint(FRAME_CMD);
  writer.uint(Number(id));
  writer.uint(op);
  writer.uint(Number(data.codeBytes || 0));
  writer.string(data.codeHash || "");
  writer.bool(Boolean(data.run));
  writer.bool(Boolean(data.save));
  return writer.bytes();
}

function encodeScriptChunkAdd(id, op, data = {}) {
  const chunkBytes = data.chunkBytes || new TextEncoder().encode(String(data.chunk ?? ""));
  const writer = new MsgPackWriter(chunkBytes.length + 24);
  writer.array(5);
  writer.uint(FRAME_CMD);
  writer.uint(Number(id));
  writer.uint(op);
  writer.uint(Number(data.offset || 0));
  writer.bin(chunkBytes);
  return writer.bytes();
}

export function decodeFrame(bytesLike) {
  const reader = new MsgPackReader(bytesLike);
  const count = reader.array();
  if (count < 3) throw new Error("MessagePack frame is too short");
  const frameType = reader.uint();
  if (frameType === FRAME_EVT) {
    const name = reader.value();
    const data = reader.value();
    return { type: "evt", name: String(name || ""), data: data || {} };
  }
  if (frameType !== FRAME_RES) throw new Error(`Unsupported MessagePack frame type ${frameType}`);
  if (count < 4) throw new Error("MessagePack response frame is too short");
  const id = String(reader.uint());
  const ok = reader.bool();
  const data = reader.value();
  if (!ok) return { type: "res", id, ok, error: data || {}, data: data || {} };
  return { type: "res", id, ok, data: data || {} };
}

class MsgPackWriter {
  constructor(capacity = 128) {
    this.data = new Uint8Array(capacity);
    this.length = 0;
  }

  bytes() {
    return this.data.slice(0, this.length);
  }

  ensure(extra) {
    if (this.length + extra <= this.data.length) return;
    const next = new Uint8Array(Math.max(this.data.length * 2, this.length + extra));
    next.set(this.data);
    this.data = next;
  }

  byte(value) {
    this.ensure(1);
    this.data[this.length++] = value & 0xff;
  }

  array(count) {
    if (count <= 15) this.byte(0x90 | count);
    else throw new Error("array too large for P1 MessagePack writer");
  }

  uint(value) {
    if (value <= 0x7f) this.byte(value);
    else if (value <= 0xff) {
      this.byte(0xcc);
      this.byte(value);
    } else if (value <= 0xffff) {
      this.byte(0xcd);
      this.byte(value >> 8);
      this.byte(value);
    } else {
      this.byte(0xce);
      this.byte(value >> 24);
      this.byte(value >> 16);
      this.byte(value >> 8);
      this.byte(value);
    }
  }

  bool(value) {
    this.byte(value ? 0xc3 : 0xc2);
  }

  string(value = "") {
    const bytes = new TextEncoder().encode(String(value ?? ""));
    if (bytes.length <= 31) {
      this.byte(0xa0 | bytes.length);
    } else if (bytes.length <= 0xff) {
      this.byte(0xd9);
      this.byte(bytes.length);
    } else if (bytes.length <= 0xffff) {
      this.byte(0xda);
      this.byte(bytes.length >> 8);
      this.byte(bytes.length);
    } else {
      throw new Error("string too large for P1 MessagePack writer");
    }
    this.ensure(bytes.length);
    this.data.set(bytes, this.length);
    this.length += bytes.length;
  }

  bin(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (bytes.length <= 0xff) {
      this.byte(0xc4);
      this.byte(bytes.length);
    } else if (bytes.length <= 0xffff) {
      this.byte(0xc5);
      this.byte(bytes.length >> 8);
      this.byte(bytes.length);
    } else {
      throw new Error("bin too large for P1 MessagePack writer");
    }
    this.ensure(bytes.length);
    this.data.set(bytes, this.length);
    this.length += bytes.length;
  }
}

class MsgPackReader {
  constructor(bytesLike) {
    if (bytesLike instanceof ArrayBuffer) this.data = new Uint8Array(bytesLike);
    else if (ArrayBuffer.isView(bytesLike)) this.data = new Uint8Array(bytesLike.buffer, bytesLike.byteOffset, bytesLike.byteLength);
    else throw new Error("Expected MessagePack bytes");
    this.offset = 0;
  }

  byte() {
    if (this.offset >= this.data.length) throw new Error("Unexpected end of MessagePack frame");
    return this.data[this.offset++];
  }

  array() {
    const b = this.byte();
    if ((b & 0xf0) === 0x90) return b & 0x0f;
    if (b === 0xdc) return (this.byte() << 8) | this.byte();
    throw new Error(`Expected MessagePack array, got 0x${b.toString(16)}`);
  }

  map() {
    const b = this.byte();
    if ((b & 0xf0) === 0x80) return b & 0x0f;
    if (b === 0xde) return (this.byte() << 8) | this.byte();
    throw new Error(`Expected MessagePack map, got 0x${b.toString(16)}`);
  }

  uintFromPrefix(b) {
    if (b <= 0x7f) return b;
    if (b === 0xcc) return this.byte();
    if (b === 0xcd) return (this.byte() << 8) | this.byte();
    if (b === 0xce) return (this.byte() * 0x1000000) + ((this.byte() << 16) | (this.byte() << 8) | this.byte());
    throw new Error(`Expected MessagePack uint, got 0x${b.toString(16)}`);
  }

  uint() {
    return this.uintFromPrefix(this.byte());
  }

  bool() {
    const b = this.byte();
    if (b === 0xc2) return false;
    if (b === 0xc3) return true;
    throw new Error(`Expected MessagePack bool, got 0x${b.toString(16)}`);
  }

  stringFromPrefix(b) {
    let len = 0;
    if ((b & 0xe0) === 0xa0) len = b & 0x1f;
    else if (b === 0xd9) len = this.byte();
    else if (b === 0xda) len = (this.byte() << 8) | this.byte();
    else throw new Error(`Expected MessagePack string, got 0x${b.toString(16)}`);
    const end = this.offset + len;
    if (end > this.data.length) throw new Error("MessagePack string exceeds frame");
    const value = new TextDecoder().decode(this.data.slice(this.offset, end));
    this.offset = end;
    return value;
  }

  float32() {
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.offset, 4);
    this.offset += 4;
    return view.getFloat32(0, false);
  }

  value() {
    const b = this.byte();
    if (b >= 0xe0) return b - 0x100;
    if (b <= 0x7f || b === 0xcc || b === 0xcd || b === 0xce) return this.uintFromPrefix(b);
    if (b === 0xd0) {
      const v = this.byte();
      return v & 0x80 ? v - 0x100 : v;
    }
    if (b === 0xd1) {
      const v = (this.byte() << 8) | this.byte();
      return v & 0x8000 ? v - 0x10000 : v;
    }
    if (b === 0xd2) {
      const v = (this.byte() * 0x1000000) + ((this.byte() << 16) | (this.byte() << 8) | this.byte());
      return v > 0x7fffffff ? v - 0x100000000 : v;
    }
    if (b === 0xc2) return false;
    if (b === 0xc3) return true;
    if (b === 0xca) return this.float32();
    if ((b & 0xe0) === 0xa0 || b === 0xd9 || b === 0xda) return this.stringFromPrefix(b);
    if ((b & 0xf0) === 0x80 || b === 0xde) {
      const count = b === 0xde ? ((this.byte() << 8) | this.byte()) : (b & 0x0f);
      const out = {};
      for (let i = 0; i < count; i += 1) out[String(this.value())] = this.value();
      return out;
    }
    if ((b & 0xf0) === 0x90 || b === 0xdc) {
      const count = b === 0xdc ? ((this.byte() << 8) | this.byte()) : (b & 0x0f);
      return Array.from({ length: count }, () => this.value());
    }
    throw new Error(`Unsupported MessagePack value 0x${b.toString(16)}`);
  }
}
