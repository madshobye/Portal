// USB serial transport for TSPL/ZPL/CPCL label printers.
// Uses LabelPrinterProtocol for command generation and Web Serial for transport.

class UsbLabelPrinter {
  constructor({
    protocol = "tspl",
    baudRate = 9600,
    dataBits = 8,
    stopBits = 1,
    parity = "none",
    flowControl = "none",
    chunkSize = 4096,
    chunkDelayMs = 2,
    debug = true,
    autoReconnectOnRefresh = true,
    storageKey = "portal.usbLabelPrinter.deviceHint",
    onState = null,
    onConnect = null,
    onDisconnect = null,
    onError = null,
  } = {}) {
    this.protocol = String(protocol || "tspl").toLowerCase();
    this.baudRate = Math.max(1200, Number(baudRate) || 9600);
    this.dataBits = Number(dataBits) === 7 ? 7 : 8;
    this.stopBits = Number(stopBits) === 2 ? 2 : 1;
    this.parity = ["none", "even", "odd"].includes(parity) ? parity : "none";
    this.flowControl = flowControl === "hardware" ? "hardware" : "none";
    this.chunkSize = Math.max(64, Math.min(65536, Number(chunkSize) || 4096));
    this.chunkDelayMs = Math.max(0, Number(chunkDelayMs) || 2);
    this.debug = debug !== false;
    this.autoReconnectOnRefresh = !!autoReconnectOnRefresh;
    this.storageKey = storageKey || "portal.usbLabelPrinter.deviceHint";

    this._onState = typeof onState === "function" ? onState : null;
    this._onConnect = typeof onConnect === "function" ? onConnect : null;
    this._onDisconnect = typeof onDisconnect === "function" ? onDisconnect : null;
    this._onError = typeof onError === "function" ? onError : null;

    this.ready = false;
    this.connected = false;
    this.connecting = false;
    this.state = "idle";
    this.port = null;
    this.writer = null;
    this._connectPromise = null;
    this._writeQueue = Promise.resolve();
    this._encoder = new TextEncoder();
    this._protocol = new LabelPrinterProtocol();
    this._deviceHint = this._loadDeviceHint();
    this._debugCounters = {};
    this._boundDisconnect = this._handlePortDisconnected.bind(this);
    this._boundConnect = this._handlePortConnected.bind(this);
  }

  async init() {
    if (!navigator.serial) {
      throw new Error("UsbLabelPrinter: Web Serial is not available in this browser");
    }
    if (!window.LabelPrinterProtocol) {
      throw new Error("UsbLabelPrinter: load portal/labelPrinterProtocol.js first");
    }

    this.ready = true;
    this._setState("ready");
    try {
      navigator.serial.addEventListener("disconnect", this._boundDisconnect);
      navigator.serial.addEventListener("connect", this._boundConnect);
    } catch {}

    if (this.autoReconnectOnRefresh) {
      this.tryReconnectKnown().catch((err) => this._handleError(err));
    }
    return this;
  }

  async connect() {
    return await this.connectWithPicker();
  }

  async connectWithPicker() {
    this._ensureReady();
    if (this.connecting) return await this._connectPromise;
    if (this.connected) {
      await this._safeClosePort();
      this.connected = false;
      this.connecting = false;
      this._setState("ready");
    }

    this._setState("requesting_port");
    this._debug("requestPort");
    const port = await navigator.serial.requestPort();
    this._rememberDeviceHint(port);
    return await this._openPort(port, "picker");
  }

  async tryReconnectKnown() {
    this._ensureReady();
    if (this.connecting) return await this._connectPromise;
    if (this.connected) return true;

    const ports = await navigator.serial.getPorts();
    this._debug("known ports", ports.map((port) => this._describePort(port)));
    if (!ports?.length) {
      this._setState("needs_port_permission");
      return false;
    }

    const port = this._pickPortFromHint(ports) || ports[0];
    if (!port) {
      this._setState("needs_port_permission");
      return false;
    }

    this._rememberDeviceHint(port);
    return await this._openPort(port, "known");
  }

  async disconnect() {
    await this._safeClosePort();
    this.connected = false;
    this.connecting = false;
    this._setState("disconnected");
  }

  setProtocol(protocol) {
    const nextProtocol = String(protocol || "").toLowerCase();
    if (!LabelPrinterProtocol.PROTOCOLS[nextProtocol]) {
      throw new Error(`UsbLabelPrinter: unsupported protocol "${protocol}"`);
    }
    this.protocol = nextProtocol;
  }

  async print(data, { protocol = this.protocol } = {}) {
    const encoded = this._protocol.encode(data, { protocol });
    this._debug("print", {
      protocol,
      bytes: encoded.length,
      preview: String(data || "").slice(0, 160),
    });
    await this.writeBytes(encoded);
  }

  async printZpl(zpl) {
    await this.print(zpl, { protocol: "zpl" });
  }

  async printZplText(text, options = {}) {
    await this.printZpl(LabelPrinterProtocol.makeZplTextLabel(text, options));
  }

  async printTspl(tspl) {
    await this.print(tspl, { protocol: "tspl" });
  }

  async printTsplText(text, options = {}) {
    await this.printTspl(LabelPrinterProtocol.makeTsplTextLabel(text, options));
  }

  async printTsplBitmap(imageData, options = {}) {
    const bytes = LabelPrinterProtocol.makeTsplBitmapLabel(imageData, options, this._encoder);
    this._debug("print bitmap", {
      protocol: "tspl",
      bytes: bytes.length,
      width: imageData?.width || 0,
      height: imageData?.height || 0,
    });
    await this.writeBytes(bytes);
  }

  async printNiimbotB1Bitmap(imageData, options = {}) {
    const bytes = LabelPrinterProtocol.makeNiimbotB1BitmapPrint(imageData, options);
    this._debug("print niimbot b1 bitmap", {
      bytes: bytes.length,
      width: imageData?.width || 0,
      height: imageData?.height || 0,
    });
    await this.writeBytes(bytes);
  }

  async printCpcl(cpcl) {
    await this.print(cpcl, { protocol: "cpcl" });
  }

  async printCpclText(text, options = {}) {
    await this.printCpcl(LabelPrinterProtocol.makeCpclTextLabel(text, options));
  }

  async printEscposText(text, options = {}) {
    const bytes = LabelPrinterProtocol.makeEscposTextReceipt(text, options, this._encoder);
    this._debug("print escpos text", {
      bytes: bytes.length,
      preview: String(text || "").slice(0, 160),
    });
    await this.writeBytes(bytes);
  }

  async feedEscpos(lines = 4) {
    const bytes = LabelPrinterProtocol.makeEscposFeed(lines);
    this._debug("feed escpos", {
      lines,
      bytes: bytes.length,
    });
    await this.writeBytes(bytes);
  }

  async writeText(text) {
    await this.writeBytes(this._encoder.encode(String(text || "")));
  }

  async writeBytes(bytes) {
    this._ensureConnected();
    const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    this._writeQueue = this._writeQueue.then(() => this._writeBytesNow(payload));
    await this._writeQueue;
  }

  getConnectionState() {
    return {
      ready: this.ready,
      connecting: this.connecting,
      connected: this.connected,
      state: this.state,
      protocol: this.protocol,
      transport: "usb",
      portInfo: this.port ? this._describePort(this.port) : this._deviceHint,
    };
  }

  async _openPort(port, source) {
    this.connecting = true;
    this._setState(source === "picker" ? "connecting_picker" : "connecting_known");
    this._connectPromise = (async () => {
      try {
        this.port = port;
        this._debug("opening port", this._describePort(port));
        await port.open({
          baudRate: this.baudRate,
          dataBits: this.dataBits,
          stopBits: this.stopBits,
          parity: this.parity,
          flowControl: this.flowControl,
        });

        this.writer = port.writable.getWriter();
        this.connected = true;
        this.connecting = false;
        this._setState("connected");
        this._onConnect?.(this);
        return true;
      } catch (error) {
        this.connected = false;
        this.connecting = false;
        await this._safeClosePort();
        this._handleError(error);
        throw error;
      } finally {
        this._connectPromise = null;
      }
    })();
    return await this._connectPromise;
  }

  async _writeBytesNow(payload) {
    this._ensureConnected();
    this._setState("printing");
    for (let offset = 0; offset < payload.length; offset += this.chunkSize) {
      const chunk = payload.slice(offset, offset + this.chunkSize);
      this._debug("write chunk", {
        offset,
        bytes: chunk.length,
      });
      await this.writer.write(chunk);
      if (this.chunkDelayMs > 0) await this._sleep(this.chunkDelayMs);
    }
    this._setState("connected");
    this._debug("write complete", { bytes: payload.length });
  }

  async _safeClosePort() {
    try {
      if (this.writer) {
        this.writer.releaseLock();
      }
    } catch {}
    this.writer = null;

    try {
      if (this.port?.readable || this.port?.writable) {
        await this.port.close();
      }
    } catch {}
  }

  _handlePortDisconnected(event) {
    if (event?.target && this.port && event.target !== this.port) return;
    this._debug("disconnected");
    this.writer = null;
    this.connected = false;
    this.connecting = false;
    this._setState("disconnected");
    this._onDisconnect?.(this);
  }

  _handlePortConnected() {
    if (!this.connected && !this.connecting && this.autoReconnectOnRefresh) {
      this.tryReconnectKnown().catch((err) => this._handleError(err));
    }
  }

  _pickPortFromHint(ports) {
    if (!this._deviceHint) return null;
    return ports.find((port) => {
      const info = this._describePort(port);
      return (
        info.usbVendorId === this._deviceHint.usbVendorId &&
        info.usbProductId === this._deviceHint.usbProductId
      );
    }) || null;
  }

  _rememberDeviceHint(port) {
    const hint = this._describePort(port);
    this._deviceHint = hint;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(hint));
    } catch {}
  }

  _loadDeviceHint() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  _describePort(port) {
    const info = port?.getInfo?.() || {};
    return {
      usbVendorId: info.usbVendorId ?? null,
      usbProductId: info.usbProductId ?? null,
    };
  }

  _ensureReady() {
    if (!this.ready) throw new Error("UsbLabelPrinter: call init() first");
  }

  _ensureConnected() {
    this._ensureReady();
    if (!this.connected || !this.writer) {
      throw new Error("UsbLabelPrinter: not connected to a writable USB serial printer");
    }
  }

  _setState(state) {
    this.state = state;
    this._onState?.(this.getConnectionState());
  }

  _handleError(error) {
    this._debug("error", error?.message || String(error));
    this._setState("error");
    this._onError?.(error, this);
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _debug(label, payload = "") {
    if (!this.debug) return;
    if (this._isNoisyDebugLabel(label)) {
      this._debugThrottled(label, payload);
      return;
    }
    if (payload === "") {
      console.log(`[UsbLabelPrinter] ${label}`);
      return;
    }
    console.log(`[UsbLabelPrinter] ${label}`, payload);
  }

  _debugThrottled(label, payload = "") {
    const counter = this._debugCounters[label] || {
      seen: 0,
      lastPayload: "",
    };
    counter.seen += 1;
    counter.lastPayload = payload;
    this._debugCounters[label] = counter;

    const shouldPrint = counter.seen <= 3 || counter.seen % 100 === 0;
    if (!shouldPrint) return;

    const summary = {
      sample: counter.seen,
      suppressed: Math.max(0, counter.seen - 3),
      latest: payload,
    };
    console.log(`[UsbLabelPrinter] ${label}`, summary);
  }

  _isNoisyDebugLabel(label) {
    return label === "write chunk";
  }
}

window.UsbLabelPrinter = UsbLabelPrinter;
