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
      onState: (state) => this.setState(state),
      onLine: (line) => this.emit("line", { line }),
      onError: (error) => this.emit("error", { error }),
      onConnect: () => {
        this.connected = true;
        this.setState("connected");
      },
      onDisconnect: () => {
        this.connected = false;
        this.setState("disconnected");
      },
    });

    await this.serial.init();
    const ok = pickPort ? await this.serial.connectWithPicker() : await this.serial.tryReconnectKnown();
    this.connected = Boolean(ok);
    if (this.connected) await releaseSerialBootSignals(this.serial.port);
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
    await this.serial.sendLine(line);
  }

  setState(state) {
    this.state = state;
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
