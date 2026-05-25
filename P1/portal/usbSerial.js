// Generic Web Serial helper for Portal sketches.
// Sends text lines to a connected serial device and stays optional:
// sketches can run normally even when no serial device is connected.

class PortalUsbSerial {
  constructor({
    baudRate = 115200,
    dataBits = 8,
    stopBits = 1,
    parity = "none",
    flowControl = "none",
    bufferSize = 255,
    autoReconnect = true,
    autoReconnectOnRefresh = true,
    reconnectDelayMs = 1200,
    lineEnding = "\n",
    storageKey = "portal.usbSerial.deviceHint",
    onState = null,
    onConnect = null,
    onDisconnect = null,
    onError = null,
    onText = null,
    onLine = null,
    onMessage = null,
  } = {}) {
    this.baudRate = Math.max(300, Number(baudRate) || 115200);
    this.dataBits = Number(dataBits) === 7 ? 7 : 8;
    this.stopBits = Number(stopBits) === 2 ? 2 : 1;
    this.parity = parity || "none";
    this.flowControl = flowControl || "none";
    this.bufferSize = Math.max(64, Number(bufferSize) || 255);
    this.autoReconnect = !!autoReconnect;
    this.autoReconnectOnRefresh = !!autoReconnectOnRefresh;
    this.reconnectDelayMs = Math.max(200, Number(reconnectDelayMs) || 1200);
    this.lineEnding = typeof lineEnding === "string" ? lineEnding : "\n";
    this.storageKey = storageKey || "portal.usbSerial.deviceHint";

    this._onState = typeof onState === "function" ? onState : null;
    this._onConnect = typeof onConnect === "function" ? onConnect : null;
    this._onDisconnect = typeof onDisconnect === "function" ? onDisconnect : null;
    this._onError = typeof onError === "function" ? onError : null;
    this._onText = typeof onText === "function" ? onText : null;
    this._onLine = typeof onLine === "function" ? onLine : null;
    this._onMessage = typeof onMessage === "function" ? onMessage : null;

    this.ready = false;
    this.connected = false;
    this.connecting = false;
    this.state = "idle";

    this.port = null;
    this.reader = null;
    this.writer = null;
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder();
    this._readBuffer = "";
    this._connectPromise = null;
    this._disconnectRequested = false;
    this._readLoopActive = false;
    this._reconnectTimer = null;
    this._writeQueue = Promise.resolve();
    this._deviceHint = this._loadDeviceHint();

    this._boundDisconnect = this._handlePortDisconnected.bind(this);
    this._boundConnect = this._handlePortConnected.bind(this);
  }

  async init() {
    if (!navigator.serial) {
      throw new Error("PortalUsbSerial: Web Serial is not available in this browser");
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
    this._ensureReady();
    return await this.connectWithPicker();
  }

  async connectWithPicker() {
    this._ensureReady();
    if (this.connecting) return await this._connectPromise;
    if (this.connected) return true;

    this._disconnectRequested = false;
    this._clearReconnectTimer();
    this._setState("requesting_port");

    const port = await navigator.serial.requestPort();
    this._rememberDeviceHint(port);
    return await this._openPort(port, "picker");
  }

  async tryReconnectKnown() {
    this._ensureReady();
    if (this.connecting) return await this._connectPromise;
    if (this.connected) return true;

    const ports = await navigator.serial.getPorts();
    if (!ports?.length) return false;

    const hinted = this._pickPortFromHint(ports);
    const port = hinted || ports[0];
    if (!port) return false;

    this._rememberDeviceHint(port);
    return await this._openPort(port, "known");
  }

  disconnect() {
    this._disconnectRequested = true;
    this._clearReconnectTimer();
    this._safeClosePort();
    this.connected = false;
    this.connecting = false;
    this._setState("disconnected");
  }

  async sendText(text = "") {
    if (!this.connected || !this.writer) return false;
    const payload = this.encoder.encode(String(text ?? ""));
    return await this._queueWrite(payload);
  }

  async sendLine(text = "") {
    return await this.sendText(String(text ?? "") + this.lineEnding);
  }

  getConnectionState() {
    return {
      ready: this.ready,
      connecting: this.connecting,
      connected: this.connected,
      state: this.state,
      portInfo: this.port?.getInfo?.() || null,
    };
  }

  async _queueWrite(payload) {
    let ok = false;
    this._writeQueue = this._writeQueue.then(async () => {
      try {
        await this.writer.write(payload);
        ok = true;
      } catch (err) {
        this._handleError(err);
        ok = false;
      }
    });
    await this._writeQueue;
    return ok;
  }

  async _openPort(port, source) {
    if (!port) throw new Error("PortalUsbSerial: port is required");
    if (this.connecting) return await this._connectPromise;

    this._connectPromise = (async () => {
      this.connecting = true;
      this._setState(source === "picker" ? "connecting_picker" : "connecting_known");
      this._disconnectRequested = false;
      this._clearReconnectTimer();

      if (this.port && this.port !== port) {
        this._safeClosePort();
      }

      this.port = port;
      await this.port.open({
        baudRate: this.baudRate,
        dataBits: this.dataBits,
        stopBits: this.stopBits,
        parity: this.parity,
        flowControl: this.flowControl,
        bufferSize: this.bufferSize,
      });

      this.writer = this.port.writable?.getWriter?.() || null;
      if (!this.writer) throw new Error("PortalUsbSerial: failed to acquire serial writer");

      this.connected = true;
      this.connecting = false;
      this._setState("connected");
      this._startReadLoop();
      if (this._onConnect) {
        try {
          this._onConnect(this.getConnectionState(), source);
        } catch (e) {
          console.warn("PortalUsbSerial onConnect callback error:", e);
        }
      }
      return true;
    })();

    try {
      return await this._connectPromise;
    } catch (err) {
      this.connecting = false;
      this.connected = false;
      this._safeClosePort();
      this._handleError(err);
      if (this.autoReconnect && !this._disconnectRequested) this._scheduleReconnect();
      throw err;
    } finally {
      this._connectPromise = null;
    }
  }

  _handlePortDisconnected(event) {
    const disconnectedPort = event?.port || event?.target || null;
    if (this.port && disconnectedPort && disconnectedPort !== this.port) return;

    this.connected = false;
    this.connecting = false;
    this._safeClosePort();
    this._setState("disconnected");

    if (this._onDisconnect) {
      try {
        this._onDisconnect(this.getConnectionState());
      } catch (e) {
        console.warn("PortalUsbSerial onDisconnect callback error:", e);
      }
    }

    if (this.autoReconnect && !this._disconnectRequested) this._scheduleReconnect();
  }

  _handlePortConnected() {
    if (this.connected || this.connecting || !this.autoReconnect) return;
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    this._clearReconnectTimer();
    if (this.connected || this.connecting || this._disconnectRequested) return;

    this._setState("reconnecting");
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this.connected || this.connecting || this._disconnectRequested) return;
      try {
        const ok = await this.tryReconnectKnown();
        if (!ok) this._scheduleReconnect();
      } catch {
        this._scheduleReconnect();
      }
    }, this.reconnectDelayMs);
  }

  _clearReconnectTimer() {
    if (!this._reconnectTimer) return;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }

  _safeClosePort() {
    try {
      if (this.reader) {
        const promise = this.reader.cancel();
        if (promise?.catch) promise.catch(() => {});
      }
    } catch {}
    try {
      if (this.reader) this.reader.releaseLock();
    } catch {}
    this.reader = null;
    this._readLoopActive = false;

    try {
      if (this.writer) this.writer.releaseLock();
    } catch {}
    this.writer = null;

    try {
      if (this.port?.close) {
        const promise = this.port.close();
        if (promise?.catch) promise.catch(() => {});
      }
    } catch {}
    this.port = null;
  }

  async _startReadLoop() {
    if (this._readLoopActive || !this.port?.readable) return;
    this._readLoopActive = true;

    while (this.connected && this.port?.readable && !this._disconnectRequested) {
      try {
        this.reader = this.port.readable.getReader();
        while (this.connected && !this._disconnectRequested) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) this._acceptReadChunk(value);
        }
      } catch (err) {
        if (this.connected && !this._disconnectRequested) this._handleError(err);
      } finally {
        try {
          if (this.reader) this.reader.releaseLock();
        } catch {}
        this.reader = null;
      }
    }

    this._readLoopActive = false;
    if (this.connected && !this._disconnectRequested) {
      this._handlePortDisconnected({ port: this.port });
    }
  }

  _acceptReadChunk(value) {
    const text = this.decoder.decode(value, { stream: true });
    if (!text) return;

    if (this._onText) {
      try {
        this._onText(text);
      } catch (e) {
        console.warn("PortalUsbSerial onText callback error:", e);
      }
    }

    this._readBuffer += text;
    const lines = this._readBuffer.split(/\r?\n/);
    this._readBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (this._onLine) {
        try {
          this._onLine(trimmed);
        } catch (e) {
          console.warn("PortalUsbSerial onLine callback error:", e);
        }
      }
      if (this._onMessage) this._emitMessage(trimmed);
    }
  }

  _emitMessage(line) {
    try {
      this._onMessage(JSON.parse(line), line);
    } catch (err) {
      this._handleError(err);
    }
  }

  _pickPortFromHint(ports) {
    if (!this._deviceHint || !Array.isArray(ports)) return null;
    const { usbVendorId, usbProductId } = this._deviceHint;
    if (!Number.isFinite(usbVendorId) || !Number.isFinite(usbProductId)) return null;

    return (
      ports.find((port) => {
        const info = port?.getInfo?.() || {};
        return info.usbVendorId === usbVendorId && info.usbProductId === usbProductId;
      }) || null
    );
  }

  _rememberDeviceHint(port) {
    try {
      const info = port?.getInfo?.() || {};
      const hint = {
        usbVendorId: Number(info.usbVendorId),
        usbProductId: Number(info.usbProductId),
      };
      this._deviceHint = hint;
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

  _setState(nextState) {
    this.state = nextState;
    if (this._onState) {
      try {
        this._onState(nextState, this.getConnectionState());
      } catch (e) {
        console.warn("PortalUsbSerial onState callback error:", e);
      }
    }
  }

  _handleError(err) {
    if (this._onError) {
      try {
        this._onError(err);
      } catch (e) {
        console.warn("PortalUsbSerial onError callback error:", e);
      }
    } else {
      console.warn("PortalUsbSerial:", err);
    }
  }

  _ensureReady() {
    if (!this.ready) throw new Error("Call init() before connecting");
  }
}

window.PortalUsbSerial = PortalUsbSerial;
