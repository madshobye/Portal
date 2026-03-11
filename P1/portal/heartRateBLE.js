// Web Bluetooth Heart Rate helper for Portal sketches.
// Features:
// - first-time connect via picker
// - auto reconnect on disconnect
// - reconnect after refresh using navigator.bluetooth.getDevices()
//
// Example:
//   await loadScript("portal/heartRateBLE.js");
//   const hr = await new HeartRateBLE().init();
//   await hr.connect(); // first time requires user gesture
//   // On later refreshes, init() can auto-reconnect to the same device.

class HeartRateBLE {
  constructor({
    autoReconnect = true,
    autoReconnectOnRefresh = true,
    reconnectDelayMs = 1200,
    reconnectMaxDelayMs = 30000,
    reconnectJitterMs = 350,
    storageKey = "portal.heartRateBLE.deviceId",
    onReading = null,
    onConnect = null,
    onDisconnect = null,
    onError = null,
    onState = null,
  } = {}) {
    this.autoReconnect = !!autoReconnect;
    this.autoReconnectOnRefresh = !!autoReconnectOnRefresh;
    this.reconnectDelayMs = Math.max(300, Number(reconnectDelayMs) || 1200);
    this.reconnectMaxDelayMs = Math.max(
      this.reconnectDelayMs,
      Number(reconnectMaxDelayMs) || 30000
    );
    this.reconnectJitterMs = Math.max(0, Number(reconnectJitterMs) || 350);
    this.storageKey = storageKey || "portal.heartRateBLE.deviceId";

    this._onReading = typeof onReading === "function" ? onReading : null;
    this._onConnect = typeof onConnect === "function" ? onConnect : null;
    this._onDisconnect = typeof onDisconnect === "function" ? onDisconnect : null;
    this._onError = typeof onError === "function" ? onError : null;
    this._onState = typeof onState === "function" ? onState : null;

    this.ready = false;
    this.connected = false;
    this.connecting = false;
    this.state = "idle";

    this.device = null;
    this.server = null;
    this.service = null;
    this.measurementCharacteristic = null;
    this.bodySensorLocationCharacteristic = null;

    this._knownDeviceId = null;
    this._disconnectRequested = false;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;
    this._connectPromise = null;
    this._boundOnDisconnected = this._handleDisconnected.bind(this);
    this._boundOnValueChanged = this._handleValueChanged.bind(this);

    this._hasResult = false;
    this._hasNew = false;
    this._result = null;
  }

  async init() {
    if (!navigator.bluetooth) {
      throw new Error("HeartRateBLE: Web Bluetooth is not available in this browser");
    }
    this._knownDeviceId = this._loadKnownDeviceId();
    this.ready = true;
    this._setState("ready");

    if (this.autoReconnectOnRefresh) {
      this.tryReconnectKnown().catch((err) => {
        this._handleError(err);
      });
    }

    return this;
  }

  async connect() {
    return await this.connectWithPicker();
  }

  async connectWithPicker() {
    this._ensureReady();
    if (this.connecting) return await this._connectPromise;
    if (this.connected && this.server?.connected) return true;

    this._disconnectRequested = false;
    this._clearReconnectTimer();
    this._setState("requesting_device");

    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ["heart_rate"] }],
      optionalServices: ["battery_service"],
    });

    this._rememberDeviceId(device?.id);
    return await this._connectDevice(device, "picker");
  }

  async tryReconnectKnown() {
    this._ensureReady();
    if (this.connected && this.server?.connected) return true;
    if (this.connecting) return await this._connectPromise;

    // Reuse the current device object for same-session reconnects.
    if (this.device?.gatt) {
      try {
        this._rememberDeviceId(this.device.id);
        return await this._connectDevice(this.device, "known");
      } catch {}
    }

    if (typeof navigator.bluetooth.getDevices !== "function") return false;

    const devices = await navigator.bluetooth.getDevices();
    if (!devices || !devices.length) return false;

    let device = null;
    if (this._knownDeviceId) {
      device = devices.find((d) => d.id === this._knownDeviceId) || null;
    }
    if (!device) {
      device = devices.find((d) => d?.name) || devices[0];
    }
    if (!device) return false;

    this._rememberDeviceId(device.id);
    return await this._connectDevice(device, "known");
  }

  disconnect() {
    this._disconnectRequested = true;
    this.autoReconnect = false;
    this._clearReconnectTimer();
    this._stopNotifications();

    try {
      if (this.server?.connected) this.server.disconnect();
    } catch {}

    this.connected = false;
    this.connecting = false;
    this._setState("disconnected");
  }

  enableAutoReconnect(enabled = true) {
    this.autoReconnect = !!enabled;
    if (this.autoReconnect && !this.connected && !this.connecting && !this._disconnectRequested) {
      this._scheduleReconnect();
    }
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

  resetNewFlag() {
    this._hasNew = false;
  }

  consumeNew() {
    const wasNew = this._hasNew;
    this._hasNew = false;
    return { wasNew, result: this._result };
  }

  consumenew() {
    return this.consumeNew();
  }

  getResult() {
    return this._result;
  }

  getresult() {
    return this.getResult();
  }

  getBPM() {
    return Number(this._result?.heartRate || 0);
  }

  getRRIntervals() {
    return this._result?.rrIntervals || [];
  }

  getConnectionState() {
    return {
      ready: this.ready,
      connecting: this.connecting,
      connected: this.connected,
      state: this.state,
      deviceName: this.device?.name || "",
      deviceId: this.device?.id || this._knownDeviceId || null,
    };
  }

  async resetEnergyExpended() {
    if (!this.service) {
      throw new Error("HeartRateBLE: no heart_rate service available");
    }
    const controlPoint = await this.service.getCharacteristic("heart_rate_control_point");
    const resetEnergyExpended = new Uint8Array([1]);
    await controlPoint.writeValue(resetEnergyExpended);
    return true;
  }

  async _connectDevice(device, source = "unknown") {
    if (!device) throw new Error("HeartRateBLE: device is required");
    if (this.connecting) return await this._connectPromise;

    this._connectPromise = (async () => {
      this.connecting = true;
      this._setState(source === "picker" ? "connecting_picker" : "connecting_known");
      this._disconnectRequested = false;
      this._clearReconnectTimer();

      if (this.device && this.device !== device) {
        try {
          this.device.removeEventListener(
            "gattserverdisconnected",
            this._boundOnDisconnected
          );
        } catch {}
      }

      this.device = device;
      this.device.addEventListener("gattserverdisconnected", this._boundOnDisconnected);

      this.server = await this.device.gatt.connect();
      this.service = await this.server.getPrimaryService("heart_rate");

      this.bodySensorLocationCharacteristic = null;
      this.measurementCharacteristic = null;

      try {
        this.bodySensorLocationCharacteristic = await this.service.getCharacteristic(
          "body_sensor_location"
        );
      } catch {}
      this.measurementCharacteristic = await this.service.getCharacteristic(
        "heart_rate_measurement"
      );

      if (this.measurementCharacteristic) {
        this.measurementCharacteristic.removeEventListener(
          "characteristicvaluechanged",
          this._boundOnValueChanged
        );
        this.measurementCharacteristic.addEventListener(
          "characteristicvaluechanged",
          this._boundOnValueChanged
        );
        await this.measurementCharacteristic.startNotifications();
      }

      let bodySensorLocation = "Unknown";
      if (this.bodySensorLocationCharacteristic) {
        try {
          const sensorLocationData = await this.bodySensorLocationCharacteristic.readValue();
          bodySensorLocation = this._parseBodySensorLocation(sensorLocationData);
        } catch {}
      }

      this.connected = true;
      this.connecting = false;
      this._reconnectAttempt = 0;
      this._setState("connected");

      if (this._onConnect) {
        try {
          this._onConnect({
            device,
            bodySensorLocation,
            source,
          });
        } catch (e) {
          console.warn("HeartRateBLE onConnect callback error:", e);
        }
      }
      return true;
    })();

    try {
      return await this._connectPromise;
    } catch (err) {
      this.connected = false;
      this.connecting = false;
      this._handleError(err);
      if (this.autoReconnect && !this._disconnectRequested) {
        this._scheduleReconnect();
      }
      throw err;
    } finally {
      this._connectPromise = null;
    }
  }

  _handleDisconnected() {
    this.connected = false;
    this.connecting = false;
    this._setState("disconnected");

    if (this._onDisconnect) {
      try {
        this._onDisconnect({
          device: this.device,
        });
      } catch (e) {
        console.warn("HeartRateBLE onDisconnect callback error:", e);
      }
    }

    if (this.autoReconnect && !this._disconnectRequested) {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    this._clearReconnectTimer();
    if (this.connected || this.connecting || this._disconnectRequested) return;

    const baseDelay = Math.min(
      this.reconnectMaxDelayMs,
      this.reconnectDelayMs * Math.pow(1.8, this._reconnectAttempt)
    );
    const jitter = Math.random() * this.reconnectJitterMs;
    const delay = Math.round(baseDelay + jitter);
    this._reconnectAttempt += 1;

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
    }, delay);
  }

  _clearReconnectTimer() {
    if (!this._reconnectTimer) return;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }

  _handleValueChanged(event) {
    const characteristic = event?.target;
    if (!characteristic?.value) return;
    const reading = this._parseHeartRate(characteristic.value);
    reading.timestamp = Date.now();

    this._result = reading;
    this._hasResult = true;
    this._hasNew = true;

    if (this._onReading) {
      try {
        this._onReading(reading);
      } catch (e) {
        console.warn("HeartRateBLE onReading callback error:", e);
      }
    }
  }

  _parseBodySensorLocation(dataView) {
    const sensorLocation = dataView.getUint8(0);
    switch (sensorLocation) {
      case 0:
        return "Other";
      case 1:
        return "Chest";
      case 2:
        return "Wrist";
      case 3:
        return "Finger";
      case 4:
        return "Hand";
      case 5:
        return "Ear Lobe";
      case 6:
        return "Foot";
      default:
        return "Unknown";
    }
  }

  _parseHeartRate(data) {
    const flags = data.getUint8(0);
    const rate16Bits = flags & 0x1;
    const result = {};

    let index = 1;
    if (rate16Bits) {
      result.heartRate = data.getUint16(index, true);
      index += 2;
    } else {
      result.heartRate = data.getUint8(index);
      index += 1;
    }

    const contactDetected = flags & 0x2;
    const contactSensorPresent = flags & 0x4;
    if (contactSensorPresent) {
      result.contactDetected = !!contactDetected;
    }

    const energyPresent = flags & 0x8;
    if (energyPresent) {
      result.energyExpended = data.getUint16(index, true);
      index += 2;
    }

    const rrIntervalPresent = flags & 0x10;
    if (rrIntervalPresent) {
      const rrIntervals = [];
      for (; index + 1 < data.byteLength; index += 2) {
        rrIntervals.push(data.getUint16(index, true));
      }
      result.rrIntervals = rrIntervals;
    } else {
      result.rrIntervals = [];
    }

    return result;
  }

  _stopNotifications() {
    if (!this.measurementCharacteristic) return;
    try {
      this.measurementCharacteristic.removeEventListener(
        "characteristicvaluechanged",
        this._boundOnValueChanged
      );
    } catch {}
    try {
      this.measurementCharacteristic.stopNotifications();
    } catch {}
  }

  _rememberDeviceId(deviceId) {
    this._knownDeviceId = deviceId || null;
    if (!deviceId) return;
    try {
      localStorage.setItem(this.storageKey, deviceId);
    } catch {}
  }

  _loadKnownDeviceId() {
    try {
      return localStorage.getItem(this.storageKey);
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
        console.warn("HeartRateBLE onState callback error:", e);
      }
    }
  }

  _handleError(err) {
    if (this._onError) {
      try {
        this._onError(err);
      } catch (e) {
        console.warn("HeartRateBLE onError callback error:", e);
      }
    } else {
      console.warn("HeartRateBLE:", err);
    }
  }

  _ensureReady() {
    if (!this.ready) throw new Error("Call init() before connecting");
  }
}
