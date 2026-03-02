// DMX over Web Serial helper for Portal sketches.
// Features:
// - connect() with user picker
// - auto reconnect on refresh when permission already exists (getPorts)
// - optional reconnect on disconnect
//
// Example:
//   await loadScript("portal/dmxSerial.js");
//   const dmx = await new DmxSerial({ channels: 30 }).init();
//   await dmx.connect(); // first time requires user gesture
//   dmx.setChannel(1, 255);
//   await dmx.sendFrame();

class DmxSerial {
  constructor({
    channels = 30,
    baudRate = 250000,
    stopBits = 2,
    bufferSize = 512,
    breakDurationMs = 1,
    mabDurationMs = 0,
    autoReconnect = true,
    autoReconnectOnRefresh = true,
    autoStream = true,
    frameIntervalMs = 30,
    prependStartCode = true,
    startCode = 0,
    reconnectDelayMs = 1200,
    storageKey = "portal.dmxSerial.deviceHint",
    onState = null,
    onConnect = null,
    onDisconnect = null,
    onError = null,
  } = {}) {
    this.channels = Math.max(1, Math.min(512, Number(channels) || 30));
    this.baudRate = Math.max(9600, Number(baudRate) || 250000);
    this.stopBits = Number(stopBits) === 1 ? 1 : 2;
    this.bufferSize = Math.max(64, Number(bufferSize) || 512);
    const breakMs = Number(breakDurationMs);
    const mabMs = Number(mabDurationMs);
    this.breakDurationMs = Math.max(0, Number.isFinite(breakMs) ? breakMs : 1);
    this.mabDurationMs = Math.max(0, Number.isFinite(mabMs) ? mabMs : 0);

    this.autoReconnect = !!autoReconnect;
    this.autoReconnectOnRefresh = !!autoReconnectOnRefresh;
    this.autoStream = !!autoStream;
    this.streamEnabled = !!autoStream;
    this.frameIntervalMs = this._clampFrameInterval(frameIntervalMs);
    this.prependStartCode = prependStartCode !== false;
    this.startCode = this._clampByte(startCode);
    this.reconnectDelayMs = Math.max(200, Number(reconnectDelayMs) || 1200);
    this.storageKey = storageKey || "portal.dmxSerial.deviceHint";

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
    this.frame = new Uint8Array(this.channels);
    this._txFrame = new Uint8Array(this.channels + 1);

    this._hasResult = false;
    this._hasNew = false;
    this._result = null;

    this._connectPromise = null;
    this._disconnectRequested = false;
    this._reconnectTimer = null;
    this._streamTimer = null;
    this._sending = false;
    this._pendingSend = false;
    this._deviceHint = this._loadDeviceHint();

    this._boundDisconnect = this._handlePortDisconnected.bind(this);
    this._boundConnect = this._handlePortConnected.bind(this);
  }

  async init() {
    if (!navigator.serial) {
      throw new Error("DmxSerial: Web Serial is not available in this browser");
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
    if (this.connected) {
      // Allow explicit port switching from the picker.
      this._stopStreamLoop();
      this._safeClosePort();
      this.connected = false;
      this.connecting = false;
      this._setState("ready");
    }

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
    this.stopOutput();
    this._safeClosePort();
    this.connected = false;
    this.connecting = false;
    this._setState("disconnected");
  }

  stop() {
    this.stopOutput();
  }

  setChannel(channel, value) {
    const idx = Math.round(Number(channel)) - 1;
    if (idx < 0 || idx >= this.frame.length) return false;
    this.frame[idx] = this._clampByte(value);
    return true;
  }

  setchannel(channel, value) {
    return this.setChannel(channel, value);
  }

  set(channel, value) {
    return this.setChannel(channel, value);
  }

  setValue(channel, value) {
    return this.setChannel(channel, value);
  }

  getChannel(channel) {
    const idx = Math.round(Number(channel)) - 1;
    if (idx < 0 || idx >= this.frame.length) return 0;
    return this.frame[idx];
  }

  fill(value = 0) {
    const v = this._clampByte(value);
    this.frame.fill(v);
    return true;
  }

  clear() {
    this.frame.fill(0);
    return true;
  }

  setChannels(values = [], startChannel = 1) {
    if (!Array.isArray(values)) return false;
    let ch = Math.max(1, Math.round(Number(startChannel) || 1));
    for (let i = 0; i < values.length; i++) {
      this.setChannel(ch + i, values[i]);
    }
    return true;
  }

  sampleCount() {
    return this.frame.length;
  }

  startOutput() {
    this.streamEnabled = true;
    this._startStreamLoop();
  }

  stopOutput() {
    this.streamEnabled = false;
    this._stopStreamLoop();
  }

  setFrameRate(hz = 33.3333333333) {
    const n = Number(hz);
    if (!Number.isFinite(n) || n <= 0) return this.getFrameRate();
    this.frameIntervalMs = this._clampFrameInterval(1000 / n);
    if (this._streamTimer) {
      this._stopStreamLoop();
      this._startStreamLoop();
    }
    return this.getFrameRate();
  }

  setFrameInterval(ms = 30) {
    this.frameIntervalMs = this._clampFrameInterval(ms);
    if (this._streamTimer) {
      this._stopStreamLoop();
      this._startStreamLoop();
    }
    return this.frameIntervalMs;
  }

  getFrameRate() {
    return 1000 / this.frameIntervalMs;
  }

  async sendFrame() {
    if (!this.connected || !this.port || !this.writer) return false;
    if (this._sending) {
      this._pendingSend = true;
      return false;
    }

    this._sending = true;
    try {
      await this.port.setSignals({ break: true });
      if (this.breakDurationMs > 0) await this._sleep(this.breakDurationMs);

      await this.port.setSignals({ break: false });
      if (this.mabDurationMs > 0) await this._sleep(this.mabDurationMs);

      const payload = this._getWritePayload();
      await this.writer.write(payload);

      this._result = {
        timestamp: Date.now(),
        bytesSent: payload.length,
      };
      this._hasResult = true;
      this._hasNew = true;
      return true;
    } catch (err) {
      this._handleError(err);
      return false;
    } finally {
      this._sending = false;
      if (this._pendingSend) {
        this._pendingSend = false;
        this.sendFrame();
      }
    }
  }

  async sendframe() {
    return await this.sendFrame();
  }

  hasResult() {
    return this._hasResult;
  }

  hasNewResult() {
    return this._hasNew;
  }

  hasnewresult() {
    return this.hasNewResult();
  }

  consumeNew() {
    const wasNew = this._hasNew;
    this._hasNew = false;
    return { wasNew, result: this._result };
  }

  consumenew() {
    return this.consumeNew();
  }

  getConnectionState() {
    return {
      ready: this.ready,
      connecting: this.connecting,
      connected: this.connected,
      state: this.state,
      channels: this.frame.length,
      prependStartCode: this.prependStartCode,
      startCode: this.startCode,
      frameIntervalMs: this.frameIntervalMs,
      frameRateHz: 1000 / this.frameIntervalMs,
      streamEnabled: this.streamEnabled,
      streaming: !!this._streamTimer,
      portInfo: this.port?.getInfo?.() || null,
    };
  }

  async _openPort(port, source) {
    if (!port) throw new Error("DmxSerial: port is required");
    if (this.connecting) return await this._connectPromise;

    this._connectPromise = (async () => {
      this.connecting = true;
      this._setState(source === "picker" ? "connecting_picker" : "connecting_known");
      this._disconnectRequested = false;
      this._clearReconnectTimer();
      this._stopStreamLoop();

      // Ensure previous port/writer are closed before opening a new one.
      if (this.port && this.port !== port) {
        this._safeClosePort();
      }

      this.port = port;
      await this.port.open({
        baudRate: this.baudRate,
        dataBits: 8,
        stopBits: this.stopBits,
        parity: "none",
        flowControl: "none",
        bufferSize: this.bufferSize,
      });

      this.writer = this.port.writable?.getWriter?.() || null;
      if (!this.writer) throw new Error("DmxSerial: failed to acquire serial writer");

      this.connected = true;
      this.connecting = false;
      this._setState("connected");
      if (this.streamEnabled) this._startStreamLoop();

      if (this._onConnect) {
        try {
          this._onConnect(this.getConnectionState(), source);
        } catch (e) {
          console.warn("DmxSerial onConnect callback error:", e);
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
    this._stopStreamLoop();
    this._safeClosePort();
    this._setState("disconnected");

    if (this._onDisconnect) {
      try {
        this._onDisconnect(this.getConnectionState());
      } catch (e) {
        console.warn("DmxSerial onDisconnect callback error:", e);
      }
    }

    if (this.autoReconnect && !this._disconnectRequested) this._scheduleReconnect();
  }

  _handlePortConnected() {
    if (this.connected || this.connecting || !this.autoReconnect) return;
    this._stopStreamLoop();
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
      if (this.writer) {
        this.writer.releaseLock();
      }
    } catch {}
    this.writer = null;

    try {
      if (this.port?.close) {
        const p = this.port.close();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
    } catch {}
    this.port = null;
  }

  _pickPortFromHint(ports) {
    if (!this._deviceHint || !Array.isArray(ports)) return null;
    const { usbVendorId, usbProductId } = this._deviceHint;
    if (!Number.isFinite(usbVendorId) || !Number.isFinite(usbProductId)) return null;

    return (
      ports.find((p) => {
        const info = p?.getInfo?.() || {};
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
        console.warn("DmxSerial onState callback error:", e);
      }
    }
  }

  _handleError(err) {
    if (this._onError) {
      try {
        this._onError(err);
      } catch (e) {
        console.warn("DmxSerial onError callback error:", e);
      }
    } else {
      console.warn("DmxSerial:", err);
    }
  }

  _clampByte(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(255, Math.round(n)));
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _getWritePayload() {
    if (!this.prependStartCode) return this.frame;
    this._txFrame[0] = this.startCode;
    this._txFrame.set(this.frame, 1);
    return this._txFrame;
  }

  _startStreamLoop() {
    if (this._streamTimer) return;
    this._streamTimer = setInterval(() => {
      if (!this.connected || !this.port || !this.writer) return;
      this.sendFrame();
    }, this.frameIntervalMs);
  }

  _stopStreamLoop() {
    if (!this._streamTimer) return;
    clearInterval(this._streamTimer);
    this._streamTimer = null;
  }

  _clampFrameInterval(v) {
    const ms = Number(v);
    if (!Number.isFinite(ms)) return 30;
    return Math.max(20, Math.min(200, Math.round(ms)));
  }

  _ensureReady() {
    if (!this.ready) throw new Error("Call init() before connecting");
  }
}
