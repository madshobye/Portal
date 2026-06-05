const SERIAL_MSGPACK_MAGIC = new Uint8Array([0x50, 0x31, 0x4d, 0x50]); // P1MP

export class WebSerialTransport extends EventTarget {
  constructor({
    baudRate = 115200,
    bufferSize = 4096,
    lineEnding = "\n",
    storageKey = "p1_embed.serial.hint",
  } = {}) {
    super();
    this.baudRate = baudRate;
    this.bufferSize = bufferSize;
    this.lineEnding = lineEnding;
    this.storageKey = storageKey;
    this.serial = null;
    this.connected = false;
    this.state = "idle";
    this.msgPackMode = false;
    this.frameBuffer = new Uint8Array(0);
    this.supportsJson = true;
    this.supportsMsgPack = true;
  }

  get available() {
    return Boolean(window.PortalUsbSerial && navigator.serial);
  }

  async connect({ pickPort = true } = {}) {
    if (!this.available) {
      throw new Error("PortalUsbSerial or Web Serial is not available");
    }
    if (this.connected) return true;

    this.serial = new window.PortalUsbSerial({
      baudRate: this.baudRate,
      bufferSize: this.bufferSize,
      lineEnding: this.lineEnding,
      storageKey: this.storageKey,
      autoReconnect: false,
      autoReconnectOnRefresh: false,
      releaseBootSignalsOnOpen: false,
      onState: (state) => this.setState(state),
      onLine: (line) => this.emit("line", { line }),
      onBytes: (bytes) => this.acceptBytes(bytes),
      onError: (error) => this.emit("error", { error }),
      onConnect: () => {
        this.connected = true;
        this.setState("connected");
      },
      onDisconnect: () => {
        this.connected = false;
        this.setMsgPackMode(false);
        this.setState("disconnected");
      },
    });

    await this.serial.init();
    const ok = pickPort ? await this.serial.connectWithPicker() : await this.serial.tryReconnectKnown();
    this.connected = Boolean(ok);
    return this.connected;
  }

  async reconnectKnown() {
    return await this.connect({ pickPort: false });
  }

  async disconnect() {
    this.connected = false;
    this.setMsgPackMode(false);
    this.serial?.disconnect();
    this.serial = null;
    this.setState("disconnected");
  }

  async sendLine(line) {
    if (!this.connected || !this.serial) {
      throw new Error("Serial transport is not connected");
    }
    const ok = await this.serial.sendLine(line);
    if (!ok) throw new Error("Serial write failed");
  }

  async sendBytes(bytes) {
    if (!this.connected || !this.serial) {
      throw new Error("Serial transport is not connected");
    }
    if (!this.msgPackMode) {
      throw new Error("Serial MessagePack mode is not active");
    }
    const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (payload.length > 0xffff) throw new Error("Serial MessagePack frame is too large");
    const frame = new Uint8Array(6 + payload.length);
    frame.set(SERIAL_MSGPACK_MAGIC, 0);
    frame[4] = (payload.length >> 8) & 0xff;
    frame[5] = payload.length & 0xff;
    frame.set(payload, 6);
    const ok = await this.serial.sendBytes(frame);
    if (!ok) throw new Error("Serial binary write failed");
  }

  setMsgPackMode(enabled) {
    this.msgPackMode = !!enabled;
    this.frameBuffer = new Uint8Array(0);
    this.serial?.setRawMode?.(this.msgPackMode);
    this.setState(this.msgPackMode ? "msgpack_ready" : this.connected ? "connected" : this.state);
  }

  acceptBytes(bytes) {
    if (!bytes?.length) return;
    const next = new Uint8Array(this.frameBuffer.length + bytes.length);
    next.set(this.frameBuffer, 0);
    next.set(bytes, this.frameBuffer.length);
    this.frameBuffer = next;
    this.drainFrames();
  }

  drainFrames() {
    while (this.frameBuffer.length >= 6) {
      const start = findMagic(this.frameBuffer);
      if (start < 0) {
        this.frameBuffer = this.frameBuffer.slice(Math.max(0, this.frameBuffer.length - 3));
        return;
      }
      if (start > 0) this.frameBuffer = this.frameBuffer.slice(start);
      if (this.frameBuffer.length < 6) return;
      const len = (this.frameBuffer[4] << 8) | this.frameBuffer[5];
      if (len <= 0) {
        this.frameBuffer = this.frameBuffer.slice(1);
        continue;
      }
      if (this.frameBuffer.length < 6 + len) return;
      const data = this.frameBuffer.slice(6, 6 + len);
      this.frameBuffer = this.frameBuffer.slice(6 + len);
      this.emit("frame", { data });
    }
  }

  setState(state) {
    this.state = state;
    this.emit("state", { state });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function findMagic(buffer) {
  for (let i = 0; i <= buffer.length - SERIAL_MSGPACK_MAGIC.length; i += 1) {
    let ok = true;
    for (let j = 0; j < SERIAL_MSGPACK_MAGIC.length; j += 1) {
      if (buffer[i + j] !== SERIAL_MSGPACK_MAGIC[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}
