const P1E_SERIAL_DEBUG = (() => {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("debug")) localStorage.setItem("p1_embed.debug.console", "1");
    return params.has("debug") || localStorage.getItem("p1_embed.debug.console") === "1";
  } catch {
    return false;
  }
})();

function p1eSerialDebug(label, data = {}) {
  if (!P1E_SERIAL_DEBUG) return;
  console.debug("[P1E serial]", label, {
    at: new Date().toISOString(),
    ...data,
  });
}

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
    this.lineCount = 0;
  }

  get available() {
    return Boolean(window.PortalUsbSerial && navigator.serial);
  }

  async connect({ pickPort = true } = {}) {
    if (!this.available) {
      throw new Error("PortalUsbSerial or Web Serial is not available");
    }
    if (this.connected) return true;
    p1eSerialDebug("connect-begin", {
      pickPort,
      baudRate: this.baudRate,
      bufferSize: this.bufferSize,
    });

    this.serial = new window.PortalUsbSerial({
      baudRate: this.baudRate,
      bufferSize: this.bufferSize,
      lineEnding: this.lineEnding,
      storageKey: this.storageKey,
      autoReconnect: false,
      autoReconnectOnRefresh: false,
      onState: (state) => this.setState(state),
      onLine: (line) => {
        this.lineCount += 1;
        if (this.lineCount <= 12 || this.lineCount % 25 === 0 || String(line).includes("\"type\":\"res\"")) {
          p1eSerialDebug("line", {
            lineCount: this.lineCount,
            sample: String(line).slice(0, 180),
          });
        }
        this.emit("line", { line });
      },
      onError: (error) => {
        p1eSerialDebug("error", { message: error?.message || String(error) });
        this.emit("error", { error });
      },
      onConnect: () => {
        this.connected = true;
        p1eSerialDebug("connected");
        this.setState("connected");
      },
      onDisconnect: () => {
        this.connected = false;
        p1eSerialDebug("disconnected");
        this.setState("disconnected");
      },
    });

    await this.serial.init();
    const ok = pickPort ? await this.serial.connectWithPicker() : await this.serial.tryReconnectKnown();
    this.connected = Boolean(ok);
    if (this.connected) await releaseSerialBootSignals(this.serial.port);
    p1eSerialDebug("connect-end", {
      ok: this.connected,
      state: this.state,
      portInfo: this.serial?.port?.getInfo?.() || null,
    });
    return this.connected;
  }

  async reconnectKnown() {
    return await this.connect({ pickPort: false });
  }

  async disconnect() {
    this.connected = false;
    this.serial?.disconnect();
    this.serial = null;
    this.setState("disconnected");
  }

  async sendLine(line) {
    if (!this.connected || !this.serial) {
      throw new Error("Serial transport is not connected");
    }
    p1eSerialDebug("write", {
      bytes: new TextEncoder().encode(String(line ?? "") + this.lineEnding).length,
      sample: String(line).slice(0, 180),
    });
    const ok = await this.serial.sendLine(line);
    p1eSerialDebug("write-result", { ok });
    if (!ok) throw new Error("Serial write failed");
  }

  setState(state) {
    this.state = state;
    p1eSerialDebug("state", { state });
    this.emit("state", { state });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

async function releaseSerialBootSignals(port) {
  try {
    await port?.setSignals?.({
      dataTerminalReady: false,
      requestToSend: false,
    });
  } catch {
  }
}
