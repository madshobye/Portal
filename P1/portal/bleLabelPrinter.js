// Web Bluetooth helper for BLE label printers.
// Starts with ZPL support, with a small protocol boundary for adding TSPL/CPCL later.
//
// Example:
//   await loadScript("portal/bleLabelPrinter.js");
//   const printer = await new BleLabelPrinter().init();
//   await printer.connect(); // must be called from a user gesture in most browsers
//   await printer.printZplText("Hello label");

class BleLabelPrinter {
  constructor({
    protocol = "zpl",
    serviceUuid = null,
    characteristicUuid = null,
    optionalServices = null,
    namePrefixes = null,
    chunkSize = 180,
    chunkDelayMs = 8,
    parallelServiceLookup = false,
    debug = true,
    connectTimeoutMs = 12000,
    gattConnectAttempts = 1,
    gattConnectRetryDelayMs = 500,
    operationTimeoutMs = 6000,
    autoReconnectOnRefresh = true,
    autoReconnectOnDisconnect = true,
    reconnectDelayMs = 1200,
    autoReconnectAttempts = 5,
    waitForAutoReconnect = false,
    storageKey = "portal.bleLabelPrinter.deviceId",
    onState = null,
    onConnect = null,
    onDisconnect = null,
    onError = null,
  } = {}) {
    this.protocol = String(protocol || "zpl").toLowerCase();
    this.serviceUuid = serviceUuid;
    this.characteristicUuid = characteristicUuid;
    this.optionalServices = optionalServices || BleLabelPrinter.COMMON_SERVICE_UUIDS;
    this.namePrefixes = namePrefixes || [
      "BlueTooth Printer",
      "Bluetooth Printer",
      "BlueTooth",
      "Bluetooth",
      "Printer",
      "Zebra",
      "ZQ",
      "QLn",
      "ZD",
      "GK",
      "GX",
      "LP",
      "JK",
      "JK-",
      "BLE",
      "NIIMBOT",
      "Niimbot",
      "niimbot",
      "D110",
      "D11",
      "B21",
      "B1",
      "B3S",
      "B18",
      "M2",
      "JingChen",
    ];
    this.chunkSize = Math.max(20, Math.min(512, Number(chunkSize) || 180));
    const parsedChunkDelayMs = Number(chunkDelayMs);
    this.chunkDelayMs = chunkDelayMs == null || Number.isNaN(parsedChunkDelayMs)
      ? 8
      : Math.max(0, parsedChunkDelayMs);
    this.parallelServiceLookup = !!parallelServiceLookup;
    this.debug = debug !== false;
    this.connectTimeoutMs = Math.max(2000, Number(connectTimeoutMs) || 12000);
    this.gattConnectAttempts = Math.max(1, Math.round(Number(gattConnectAttempts) || 1));
    this.gattConnectRetryDelayMs = Math.max(0, Number(gattConnectRetryDelayMs) || 500);
    this.operationTimeoutMs = Math.max(1000, Number(operationTimeoutMs) || 6000);
    this.autoReconnectOnRefresh = !!autoReconnectOnRefresh;
    this.autoReconnectOnDisconnect = !!autoReconnectOnDisconnect;
    this.reconnectDelayMs = Math.max(300, Number(reconnectDelayMs) || 1200);
    this.autoReconnectAttempts = Math.max(1, Math.round(Number(autoReconnectAttempts) || 5));
    this.waitForAutoReconnect = !!waitForAutoReconnect;
    this.storageKey = storageKey || "portal.bleLabelPrinter.deviceId";

    this._onState = typeof onState === "function" ? onState : null;
    this._onConnect = typeof onConnect === "function" ? onConnect : null;
    this._onDisconnect = typeof onDisconnect === "function" ? onDisconnect : null;
    this._onError = typeof onError === "function" ? onError : null;

    this.ready = false;
    this.connected = false;
    this.connecting = false;
    this.state = "idle";

    this.device = null;
    this.server = null;
    this.service = null;
    this.characteristic = null;
    this.notificationCharacteristic = null;

    this._knownDeviceId = null;
    this._connectPromise = null;
    this._disconnectRequested = false;
    this._reconnectTimer = null;
    this._autoReconnectPromise = null;
    this._writeQueue = Promise.resolve();
    this._encoder = new TextEncoder();
    this._effectiveChunkSize = this.chunkSize;
    this._debugCounters = {};
    this._boundOnDisconnected = this._handleDisconnected.bind(this);
    this._boundOnCharacteristicValueChanged = this._handleCharacteristicValueChanged.bind(this);
    this._rxBytes = [];
    this._responseWaiters = [];
  }

  async init() {
    if (!navigator.bluetooth) {
      throw new Error("BleLabelPrinter: Web Bluetooth is not available in this browser");
    }

    this._knownDeviceId = this._loadKnownDeviceId();
    await this._debugBluetoothEnvironment();
    this.ready = true;
    this._setState("ready");

    if (this.autoReconnectOnRefresh) {
      const autoReconnect = this.reconnectKnown({
        reason: "refresh",
        attempts: this.autoReconnectAttempts,
        delayMs: this.reconnectDelayMs,
      }).catch((err) => {
        this._handleError(err);
        return false;
      });
      if (this.waitForAutoReconnect) {
        await autoReconnect;
      }
    }

    return this;
  }

  async connect() {
    return await this.connectWithPicker();
  }

  async connectWithPicker({ acceptAllDevices = false } = {}) {
    this._ensureReady();
    if (this.connecting) return await this._connectPromise;
    if (this.connected && this.server?.connected) return true;

    this._disconnectRequested = false;
    this._clearReconnectTimer();
    this._setState("requesting_device");

    const requestOptions = this._getRequestDeviceOptions({ acceptAllDevices });
    this._debug("requestDevice", requestOptions);
    const device = await navigator.bluetooth.requestDevice(requestOptions);
    this._debug("device selected", {
      name: device?.name || "",
      id: device?.id || "",
    });
    this._rememberDeviceId(device?.id);
    return await this._connectDevice(device, "picker");
  }

  async tryReconnectKnown() {
    this._ensureReady();
    this._debug("reconnect known start", {
      knownDeviceId: this._knownDeviceId || null,
      hasGetDevices: typeof navigator.bluetooth.getDevices === "function",
    });
    if (this.connected && this.server?.connected) {
      this._debug("reconnect known skipped", "already connected");
      return true;
    }
    if (this.connecting) {
      this._debug("reconnect known waiting", "connection already in progress");
      return await this._connectPromise;
    }

    if (this.device?.gatt) {
      try {
        this._debug("reconnect known current device", {
          name: this.device?.name || "",
          id: this.device?.id || "",
          gattConnected: !!this.device?.gatt?.connected,
        });
        this._rememberDeviceId(this.device.id);
        return await this._connectDevice(this.device, "known");
      } catch (error) {
        this._debug("reconnect current device failed", error?.message || String(error));
      }
    }

    if (typeof navigator.bluetooth.getDevices !== "function") {
      this._debug("reconnect known unavailable", "navigator.bluetooth.getDevices is unavailable");
      this._setState("needs_picker_after_refresh");
      return false;
    }

    const devices = await navigator.bluetooth.getDevices();
    this._debug("reconnect known devices", devices.map((entry) => ({
      name: entry?.name || "",
      id: entry?.id || "",
      gattConnected: !!entry?.gatt?.connected,
    })));
    if (!devices?.length) {
      this._setState("needs_browser_permission");
      return false;
    }

    let device = null;
    if (this._knownDeviceId) {
      device = devices.find((entry) => entry.id === this._knownDeviceId) || null;
    }
    if (!device) {
      device = devices.find((entry) => entry?.name) || devices[0];
    }
    if (!device) {
      this._debug("reconnect known no matching device", this._knownDeviceId || "");
      this._setState("needs_browser_permission");
      return false;
    }

    this._debug("reconnect known picked", {
      name: device?.name || "",
      id: device?.id || "",
    });
    this._rememberDeviceId(device.id);
    return await this._connectDevice(device, "known");
  }

  async reconnectKnown({
    reason = "manual",
    attempts = this.autoReconnectAttempts,
    delayMs = this.reconnectDelayMs,
  } = {}) {
    this._ensureReady();
    if (this._autoReconnectPromise) return await this._autoReconnectPromise;

    const totalAttempts = Math.max(1, Math.round(Number(attempts) || 1));
    const waitMs = Math.max(0, Number(delayMs) || 0);
    this._autoReconnectPromise = (async () => {
      for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
        if (this.connected && this.server?.connected) return true;
        this._setState(`reconnecting_${reason}`);
        this._debug("auto reconnect attempt", {
          reason,
          attempt,
          attempts: totalAttempts,
        });

        try {
          const connected = await this.tryReconnectKnown();
          if (connected) return true;
        } catch (error) {
          this._debug("auto reconnect attempt failed", {
            reason,
            attempt,
            error: error?.message || String(error),
          });
        }

        if (attempt < totalAttempts && waitMs > 0) {
          await this._sleep(waitMs);
        }
      }

      this._debug("auto reconnect exhausted", {
        reason,
        attempts: totalAttempts,
      });
      if (this.state !== "needs_browser_permission") {
        this._setState("needs_connection");
      }
      return false;
    })();

    try {
      return await this._autoReconnectPromise;
    } finally {
      this._autoReconnectPromise = null;
    }
  }

  disconnect() {
    this._disconnectRequested = true;
    this._clearReconnectTimer();
    this._safeDisconnect();
    this.connected = false;
    this.connecting = false;
    this._setState("disconnected");
  }

  async forgetKnownDevice() {
    this.disconnect();
    const knownDeviceId = this._knownDeviceId;
    this._knownDeviceId = null;
    try {
      localStorage.removeItem(this.storageKey);
    } catch {}

    if (typeof navigator.bluetooth.getDevices !== "function") {
      this._debug("forget skipped", "navigator.bluetooth.getDevices is unavailable");
      return false;
    }

    const devices = await navigator.bluetooth.getDevices();
    const matchingDevices = devices.filter((device) => !knownDeviceId || device.id === knownDeviceId);
    this._debug("forget known devices", {
      knownDeviceId,
      available: devices.map((device) => ({
        name: device?.name || "",
        id: device?.id || "",
        canForget: typeof device?.forget === "function",
      })),
    });

    for (const device of matchingDevices) {
      if (typeof device?.forget !== "function") continue;
      try {
        await device.forget();
        this._debug("forgot device", {
          name: device?.name || "",
          id: device?.id || "",
        });
      } catch (error) {
        this._debug("forget failed", {
          name: device?.name || "",
          id: device?.id || "",
          error: error?.message || String(error),
        });
      }
    }

    return true;
  }

  setProtocol(protocol) {
    const nextProtocol = String(protocol || "").toLowerCase();
    if (!BleLabelPrinter.PROTOCOLS[nextProtocol]) {
      throw new Error(`BleLabelPrinter: unsupported protocol "${protocol}"`);
    }
    this.protocol = nextProtocol;
  }

  async print(data, { protocol = this.protocol } = {}) {
    const encoded = this.encode(data, { protocol });
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
    await this.printZpl(BleLabelPrinter.makeZplTextLabel(text, options));
  }

  async printTspl(tspl) {
    await this.print(tspl, { protocol: "tspl" });
  }

  async printTsplText(text, options = {}) {
    await this.printTspl(BleLabelPrinter.makeTsplTextLabel(text, options));
  }

  async printTsplBitmap(imageData, options = {}) {
    const bytes = window.LabelPrinterProtocol
      ? LabelPrinterProtocol.makeTsplBitmapLabel(imageData, options, this._encoder)
      : BleLabelPrinter.makeTsplBitmapLabel(imageData, options, this._encoder);
    this._debug("print bitmap", {
      protocol: "tspl",
      bytes: bytes.length,
      width: imageData?.width || 0,
      height: imageData?.height || 0,
    });
    await this.writeBytes(bytes);
  }

  async printNiimbotB1Bitmap(imageData, options = {}) {
    if (!window.LabelPrinterProtocol) {
      throw new Error("BleLabelPrinter: load portal/labelPrinterProtocol.js first for Niimbot printing");
    }
    const bytes = LabelPrinterProtocol.makeNiimbotB1BitmapPrint(imageData, options);
    this._debug("print niimbot b1 bitmap", {
      bytes: bytes.length,
      width: imageData?.width || 0,
      height: imageData?.height || 0,
    });
    await this.writeBytes(bytes);
  }

  async queryNiimbotB1MediaInfo() {
    await this._ensureNiimbotNotifications();
    const queries = [
      { name: "heartbeat_advanced_2", command: 0xdc, data: [0x04], responseCommands: [0xd9, 0xdd, 0xde, 0xdf] },
      { name: "rfid_info", command: 0x1a, data: [0x01], responseCommands: [0x1b] },
      { name: "rfid_info_2", command: 0x1c, data: [0x01], responseCommands: [0x1d] },
      { name: "printer_status_data", command: 0xa5, data: [0x01], responseCommands: [0xb5] },
    ];
    const responses = [];
    for (const query of queries) {
      try {
        const response = await this.sendNiimbotPacket(query.command, query.data, {
          responseCommands: query.responseCommands,
          timeoutMs: 900,
        });
        responses.push({ name: query.name, response });
      } catch (error) {
        responses.push({ name: query.name, error: error?.message || String(error) });
      }
    }
    const media = this._parseNiimbotMediaInfo(responses);
    this._debug("niimbot media query", {
      media,
      responses: responses.map((entry) => ({
        name: entry.name,
        error: entry.error || null,
        command: entry.response?.command ?? null,
        dataHex: entry.response ? this._bytesToHex(entry.response.data) : null,
      })),
    });
    return { media, responses };
  }

  async sendNiimbotPacket(command, data = [], {
    responseCommands = [],
    timeoutMs = 1000,
  } = {}) {
    if (!window.LabelPrinterProtocol) {
      throw new Error("BleLabelPrinter: load portal/labelPrinterProtocol.js first for Niimbot packets");
    }
    await this._ensureNiimbotNotifications();
    const packet = LabelPrinterProtocol.makeNiimbotPacket(command, data);
    const responsePromise = responseCommands.length
      ? this._waitForNiimbotResponse(responseCommands, timeoutMs)
      : null;
    this._debug("niimbot send", {
      command,
      dataHex: this._bytesToHex(data),
      responseCommands,
    });
    await this.writeBytes(packet);
    return responsePromise ? await responsePromise : null;
  }

  async printCpcl(cpcl) {
    await this.print(cpcl, { protocol: "cpcl" });
  }

  async printCpclText(text, options = {}) {
    await this.printCpcl(BleLabelPrinter.makeCpclTextLabel(text, options));
  }

  async printEscposText(text, options = {}) {
    const bytes = window.LabelPrinterProtocol
      ? LabelPrinterProtocol.makeEscposTextReceipt(text, options, this._encoder)
      : BleLabelPrinter.makeEscposTextReceipt(text, options, this._encoder);
    this._debug("print escpos text", {
      bytes: bytes.length,
      preview: String(text || "").slice(0, 160),
    });
    await this.writeBytes(bytes);
  }

  async feedEscpos(lines = 4) {
    const bytes = window.LabelPrinterProtocol
      ? LabelPrinterProtocol.makeEscposFeed(lines)
      : BleLabelPrinter.makeEscposFeed(lines);
    this._debug("feed escpos", {
      lines,
      bytes: bytes.length,
    });
    await this.writeBytes(bytes);
  }

  encode(data, { protocol = this.protocol } = {}) {
    const encoder = BleLabelPrinter.PROTOCOLS[String(protocol || "").toLowerCase()];
    if (!encoder) {
      throw new Error(`BleLabelPrinter: unsupported protocol "${protocol}"`);
    }
    return encoder.encode(data, this._encoder);
  }

  async writeText(text) {
    await this.writeBytes(this._encoder.encode(String(text || "")));
  }

  async writeBytes(bytes) {
    await this._waitForConnectionIfNeeded();
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
      deviceName: this.device?.name || "",
      deviceId: this.device?.id || this._knownDeviceId || null,
      serviceUuid: this.service?.uuid || this.serviceUuid || null,
      characteristicUuid: this.characteristic?.uuid || this.characteristicUuid || null,
    };
  }

  async _connectDevice(device, source = "unknown") {
    if (!device?.gatt) {
      throw new Error("BleLabelPrinter: selected device does not expose GATT");
    }

    this.connecting = true;
    this._setState(`connecting_${source}`);

    this._connectPromise = (async () => {
      try {
        this.device = device;
        this.device.removeEventListener?.("gattserverdisconnected", this._boundOnDisconnected);
        this.device.addEventListener?.("gattserverdisconnected", this._boundOnDisconnected);

        this._debug("gatt connecting", {
          name: device?.name || "",
          id: device?.id || "",
        });
        this.server = await this._connectGattWithTimeout(device);
        this._debug("gatt connected", {
          name: device?.name || "",
          id: device?.id || "",
        });
        await this._findWritableCharacteristic();
        await this._startNotificationsIfAvailable();

        this.connected = true;
        this.connecting = false;
        this._setState("connected");
        this._onConnect?.(this);
        return true;
      } catch (error) {
        this.connecting = false;
        this.connected = false;
        this._safeDisconnect();
        this._handleError(error);
        throw error;
      } finally {
        this._connectPromise = null;
      }
    })();

    return await this._connectPromise;
  }

  async _findWritableCharacteristic() {
    if (!this.server?.connected) {
      throw new Error("BleLabelPrinter: GATT server is not connected");
    }

    if (this.serviceUuid && this.characteristicUuid) {
      this._debug("explicit service lookup", this.serviceUuid);
      this.service = await this._withTimeout(
        this.server.getPrimaryService(this.serviceUuid),
        `service lookup timed out: ${this.serviceUuid}`
      );
      this._debug("explicit characteristic lookup", this.characteristicUuid);
      this.characteristic = await this._withTimeout(
        this.service.getCharacteristic(this.characteristicUuid),
        `characteristic lookup timed out: ${this.characteristicUuid}`
      );
      this._ensureWritableCharacteristic(this.characteristic);
      this._debug("using explicit characteristic", this._describeCharacteristic(this.characteristic));
      return;
    }

    const services = await this._getCandidateServices();
    this._debug("candidate services", services.map((service) => service.uuid));
    for (const service of services) {
      const characteristic = await this._findWritableCharacteristicInService(service);
      if (characteristic) {
        this.service = service;
        this.characteristic = characteristic;
        this._debug("selected writable characteristic", {
          service: service.uuid,
          characteristic: this._describeCharacteristic(characteristic),
        });
        return;
      }
    }

    throw new Error("BleLabelPrinter: no writable BLE characteristic found. Try passing serviceUuid and characteristicUuid.");
  }

  async _getCandidateServices() {
    if (this.serviceUuid) {
      return [await this.server.getPrimaryService(this.serviceUuid)];
    }

    if (this.parallelServiceLookup) {
      const results = await Promise.all(this.optionalServices.map(async (serviceUuid) => {
        try {
          this._debug("service lookup", serviceUuid);
          const service = await this._withTimeout(
            this.server.getPrimaryService(serviceUuid),
            `service lookup timed out: ${serviceUuid}`
          );
          this._debug("service found", service.uuid);
          return service;
        } catch (error) {
          this._debug("service unavailable", {
            serviceUuid,
            error: error?.message || String(error),
          });
          return null;
        }
      }));
      return results.filter(Boolean);
    }

    const services = [];
    for (const serviceUuid of this.optionalServices) {
      try {
        this._debug("service lookup", serviceUuid);
        const service = await this._withTimeout(
          this.server.getPrimaryService(serviceUuid),
          `service lookup timed out: ${serviceUuid}`
        );
        services.push(service);
        this._debug("service found", service.uuid);
      } catch (error) {
        this._debug("service unavailable", {
          serviceUuid,
          error: error?.message || String(error),
        });
      }
    }
    return services;
  }

  async _findWritableCharacteristicInService(service) {
    let characteristics = [];
    try {
      this._debug("characteristic lookup", service.uuid);
      characteristics = await this._withTimeout(
        service.getCharacteristics(),
        `characteristic lookup timed out: ${service.uuid}`
      );
    } catch (error) {
      this._debug("characteristics unavailable", {
        service: service.uuid,
        error: error?.message || String(error),
      });
      return null;
    }

    this._debug("characteristics", {
      service: service.uuid,
      characteristics: characteristics.map((entry) => this._describeCharacteristic(entry)),
    });

    if (this.characteristicUuid) {
      const exact = characteristics.find((entry) => entry.uuid === this.characteristicUuid);
      if (exact && this._isWritableCharacteristic(exact)) return exact;
      return null;
    }

    return (
      characteristics.find((entry) => (
        this._isWritableCharacteristic(entry) &&
        !entry?.properties?.read &&
        !entry?.properties?.notify
      )) ||
      characteristics.find((entry) => (
        this._isWritableCharacteristic(entry) &&
        !entry?.properties?.read
      )) ||
      characteristics.find((entry) => this._isWritableCharacteristic(entry)) ||
      null
    );
  }

  async _startNotificationsIfAvailable() {
    this.notificationCharacteristic = null;
    const notifyCharacteristic = this.characteristic?.properties?.notify
      ? this.characteristic
      : await this._findNotifyCharacteristicInService(this.service);
    if (!notifyCharacteristic?.properties?.notify) {
      this._debug("notifications unavailable");
      return false;
    }

    try {
      notifyCharacteristic.removeEventListener?.("characteristicvaluechanged", this._boundOnCharacteristicValueChanged);
      notifyCharacteristic.addEventListener?.("characteristicvaluechanged", this._boundOnCharacteristicValueChanged);
      await notifyCharacteristic.startNotifications();
      this.notificationCharacteristic = notifyCharacteristic;
      this._debug("notifications started", this._describeCharacteristic(notifyCharacteristic));
      return true;
    } catch (error) {
      this._debug("notifications failed", error?.message || String(error));
      return false;
    }
  }

  async _findNotifyCharacteristicInService(service) {
    if (!service) return null;
    try {
      const characteristics = await service.getCharacteristics();
      return characteristics.find((entry) => entry?.properties?.notify) || null;
    } catch {
      return null;
    }
  }

  async _ensureNiimbotNotifications() {
    this._ensureConnected();
    if (this.notificationCharacteristic) return;
    const started = await this._startNotificationsIfAvailable();
    if (!started) {
      throw new Error("BleLabelPrinter: connected characteristic does not expose BLE notifications");
    }
  }

  async _writeBytesNow(payload) {
    this._ensureConnected();
    this._setState("printing");

    let offset = 0;
    let activeChunkSize = Math.max(20, Math.min(this.chunkSize, this._effectiveChunkSize || this.chunkSize));

    while (offset < payload.length) {
      const chunk = payload.slice(offset, offset + activeChunkSize);
      this._debug("write chunk", {
        offset,
        bytes: chunk.length,
        requestedChunkSize: this.chunkSize,
        activeChunkSize,
        characteristic: this.characteristic?.uuid || "",
      });
      try {
        await this._writeChunk(chunk);
      } catch (error) {
        if (activeChunkSize <= 20) throw error;
        const nextChunkSize = Math.max(20, Math.floor(activeChunkSize * 0.5));
        this._debug("write chunk fallback", {
          offset,
          failedBytes: chunk.length,
          activeChunkSize,
          nextChunkSize,
          error: error?.message || String(error),
        });
        activeChunkSize = nextChunkSize;
        this._effectiveChunkSize = nextChunkSize;
        continue;
      }

      this._effectiveChunkSize = activeChunkSize;
      offset += chunk.length;
      if (this.chunkDelayMs > 0) {
        await this._sleep(this.chunkDelayMs);
      }
    }

    this._setState("connected");
    this._debug("write complete", {
      bytes: payload.length,
      characteristic: this.characteristic?.uuid || "",
    });
  }

  async _writeChunk(chunk) {
    if (typeof this.characteristic.writeValueWithoutResponse === "function") {
      try {
        await this.characteristic.writeValueWithoutResponse(chunk);
        return;
      } catch {}
    }

    await this.characteristic.writeValue(chunk);
  }

  _handleCharacteristicValueChanged(event) {
    const value = event?.target?.value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    this._debug("notification", this._bytesToHex(bytes));
    this._rxBytes.push(...bytes);
    const packets = this._drainNiimbotPackets();
    for (const packet of packets) {
      this._debug("niimbot recv", {
        command: packet.command,
        dataHex: this._bytesToHex(packet.data),
      });
      this._resolveNiimbotWaiters(packet);
    }
  }

  _drainNiimbotPackets() {
    const packets = [];
    while (this._rxBytes.length >= 7) {
      const start = this._rxBytes.findIndex((byte, index, arr) => byte === 0x55 && arr[index + 1] === 0x55);
      if (start < 0) {
        this._rxBytes = [];
        break;
      }
      if (start > 0) this._rxBytes.splice(0, start);
      if (this._rxBytes.length < 7) break;

      const command = this._rxBytes[2];
      const length = this._rxBytes[3];
      const totalLength = 2 + 1 + 1 + length + 1 + 2;
      if (this._rxBytes.length < totalLength) break;
      if (this._rxBytes[totalLength - 2] !== 0xaa || this._rxBytes[totalLength - 1] !== 0xaa) {
        this._rxBytes.shift();
        continue;
      }

      const data = new Uint8Array(this._rxBytes.slice(4, 4 + length));
      const checksum = this._rxBytes[4 + length];
      const expected = this._niimbotChecksum(command, data);
      packets.push({
        command,
        data,
        checksum,
        checksumOk: checksum === expected,
      });
      this._rxBytes.splice(0, totalLength);
    }
    return packets;
  }

  _waitForNiimbotResponse(commands, timeoutMs) {
    const commandSet = new Set(commands);
    return new Promise((resolve, reject) => {
      const waiter = {
        commandSet,
        resolve,
        reject,
        timer: setTimeout(() => {
          this._responseWaiters = this._responseWaiters.filter((entry) => entry !== waiter);
          reject(new Error(`BleLabelPrinter: timed out waiting for Niimbot response ${commands.join(",")}`));
        }, timeoutMs),
      };
      this._responseWaiters.push(waiter);
    });
  }

  _resolveNiimbotWaiters(packet) {
    const waiter = this._responseWaiters.find((entry) => entry.commandSet.has(packet.command));
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this._responseWaiters = this._responseWaiters.filter((entry) => entry !== waiter);
    waiter.resolve(packet);
  }

  _parseNiimbotMediaInfo(responses) {
    const heartbeat = responses.find((entry) => entry.name === "heartbeat_advanced_2" && entry.response)?.response;
    const media = {
      paperInserted: null,
      paperRfidOk: null,
      ribbonInserted: null,
      ribbonRfidOk: null,
      chargeLevel: null,
      labelWidthMm: null,
      labelHeightMm: null,
    };
    if (heartbeat?.data?.length >= 9) {
      media.chargeLevel = heartbeat.data[1] ?? null;
      media.paperInserted = heartbeat.data[6] === 0;
      media.paperRfidOk = heartbeat.data[7] === 0;
      media.ribbonRfidOk = heartbeat.data[8] === 1;
      media.ribbonInserted = heartbeat.data[9] === 1;
    }
    return media;
  }

  _niimbotChecksum(command, data) {
    let checksum = command ^ data.length;
    for (const byte of data) checksum ^= byte;
    return checksum & 0xff;
  }

  _bytesToHex(bytes) {
    return Array.from(bytes || [])
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(" ");
  }

  async _connectGattWithTimeout(device) {
    let lastError = null;
    for (let attempt = 1; attempt <= this.gattConnectAttempts; attempt += 1) {
      let timeoutId = null;
      try {
        this._debug("gatt connect attempt", {
          attempt,
          attempts: this.gattConnectAttempts,
          timeoutMs: this.connectTimeoutMs,
        });
        return await Promise.race([
          device.gatt.connect(),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error(`BleLabelPrinter: GATT connect timed out after ${this.connectTimeoutMs}ms`));
            }, this.connectTimeoutMs);
          }),
        ]);
      } catch (error) {
        lastError = error;
        this._debug("gatt connect failed", {
          attempt,
          attempts: this.gattConnectAttempts,
          error: error?.message || String(error),
          connected: !!device?.gatt?.connected,
        });
        try {
          if (device?.gatt?.connected) device.gatt.disconnect();
        } catch {}
        if (attempt < this.gattConnectAttempts && this.gattConnectRetryDelayMs > 0) {
          await this._sleep(this.gattConnectRetryDelayMs);
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    }
    throw lastError || new Error("BleLabelPrinter: GATT connect failed");
  }

  _getRequestDeviceOptions({ acceptAllDevices = false } = {}) {
    const optionalServices = this._normalizeUuidList([
      ...this.optionalServices,
      this.serviceUuid,
    ]);

    if (acceptAllDevices) {
      return {
        acceptAllDevices: true,
        optionalServices,
      };
    }

    if (this.serviceUuid) {
      return {
        filters: [{ services: [this.serviceUuid] }],
        optionalServices,
      };
    }

    const filters = this._normalizeUuidList(this.namePrefixes).map((namePrefix) => ({ namePrefix }));
    if (filters.length) {
      return {
        filters,
        optionalServices,
      };
    }

    return {
      acceptAllDevices: true,
      optionalServices,
    };
  }

  _isWritableCharacteristic(characteristic) {
    return !!(
      characteristic?.properties?.write ||
      characteristic?.properties?.writeWithoutResponse
    );
  }

  _ensureWritableCharacteristic(characteristic) {
    if (!this._isWritableCharacteristic(characteristic)) {
      throw new Error(`BleLabelPrinter: characteristic ${characteristic?.uuid || ""} is not writable`);
    }
  }

  _ensureReady() {
    if (!this.ready) {
      throw new Error("BleLabelPrinter: call init() first");
    }
  }

  _ensureConnected() {
    this._ensureReady();
    if (!this.connected || !this.server?.connected || !this.characteristic) {
      throw new Error("BleLabelPrinter: not connected to a writable BLE printer");
    }
  }

  async _waitForConnectionIfNeeded() {
    this._ensureReady();
    if (!this.connecting || !this._connectPromise) return;
    this._debug("waiting for pending connection before write");
    await this._connectPromise;
  }

  _handleDisconnected() {
    this._debug("disconnected");
    this.connected = false;
    this.connecting = false;
    this.service = null;
    this.characteristic = null;
    this._setState("disconnected");
    this._onDisconnect?.(this);

    if (!this._disconnectRequested && this.autoReconnectOnDisconnect) {
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    this._clearReconnectTimer();
    this._reconnectTimer = setTimeout(() => {
      this.reconnectKnown({
        reason: "disconnect",
        attempts: this.autoReconnectAttempts,
        delayMs: this.reconnectDelayMs,
      }).catch((err) => this._handleError(err));
    }, this.reconnectDelayMs);
  }

  _clearReconnectTimer() {
    if (!this._reconnectTimer) return;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
  }

  _safeDisconnect() {
    try {
      if (this.server?.connected) this.server.disconnect();
    } catch {}
    this.server = null;
    this.service = null;
    this.characteristic = null;
  }

  _handleError(error) {
    this._debug("error", error?.message || String(error));
    this._setState("error");
    this._onError?.(error, this);
  }

  _setState(state) {
    this.state = state;
    this._onState?.(this.getConnectionState());
  }

  _rememberDeviceId(deviceId) {
    if (!deviceId) return;
    this._knownDeviceId = deviceId;
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

  _normalizeUuidList(values) {
    return [...new Set((values || []).filter(Boolean).map((value) => String(value)))];
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async _withTimeout(promise, message) {
    let timeoutId = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`BleLabelPrinter: ${message}`)), this.operationTimeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async _debugBluetoothEnvironment() {
    if (!this.debug) return;

    this._debug("stored known device", this._knownDeviceId || null);

    if (typeof navigator.bluetooth.getAvailability === "function") {
      try {
        this._debug("bluetooth availability", await navigator.bluetooth.getAvailability());
      } catch (error) {
        this._debug("bluetooth availability failed", error?.message || String(error));
      }
    }

    if (typeof navigator.bluetooth.getDevices === "function") {
      try {
        const devices = await navigator.bluetooth.getDevices();
        this._debug("known browser devices", devices.map((device) => ({
          name: device?.name || "",
          id: device?.id || "",
          gattConnected: !!device?.gatt?.connected,
          canForget: typeof device?.forget === "function",
        })));
      } catch (error) {
        this._debug("known browser devices failed", error?.message || String(error));
      }
    }
  }

  _describeCharacteristic(characteristic) {
    return {
      uuid: characteristic?.uuid || "",
      properties: {
        write: !!characteristic?.properties?.write,
        writeWithoutResponse: !!characteristic?.properties?.writeWithoutResponse,
        notify: !!characteristic?.properties?.notify,
        read: !!characteristic?.properties?.read,
      },
    };
  }

  _debug(label, payload = "") {
    if (!this.debug) return;
    if (this._isNoisyDebugLabel(label)) {
      this._debugThrottled(label, payload);
      return;
    }
    if (payload === "") {
      console.log(`[BleLabelPrinter] ${label}`);
      return;
    }
    console.log(`[BleLabelPrinter] ${label}`, payload);
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
    console.log(`[BleLabelPrinter] ${label}`, summary);
  }

  _isNoisyDebugLabel(label) {
    return label === "write chunk" || label === "notification";
  }

  static makeZplTextLabel(text, {
    widthDots = 609,
    heightDots = 203,
    x = 32,
    y = 32,
    fontHeight = 42,
    fontWidth = 42,
    copies = 1,
  } = {}) {
    const safeText = BleLabelPrinter.escapeZplText(text);
    return [
      "^XA",
      `^PW${Math.round(widthDots)}`,
      `^LL${Math.round(heightDots)}`,
      `^FO${Math.round(x)},${Math.round(y)}`,
      `^A0N,${Math.round(fontHeight)},${Math.round(fontWidth)}`,
      `^FD${safeText}^FS`,
      `^PQ${Math.max(1, Math.round(copies))}`,
      "^XZ",
      "",
    ].join("\n");
  }

  static makeTsplTextLabel(text, {
    widthMm = 60,
    heightMm = 30,
    gapMm = 2,
    x = 40,
    y = 40,
    font = "3",
    xMul = 1,
    yMul = 1,
    copies = 1,
  } = {}) {
    const safeText = BleLabelPrinter.escapeQuotedText(text);
    return [
      `SIZE ${Number(widthMm) || 60} mm,${Number(heightMm) || 30} mm`,
      `GAP ${Number(gapMm) || 2} mm,0 mm`,
      "DIRECTION 1",
      "CLS",
      `TEXT ${Math.round(x)},${Math.round(y)},"${font}",0,${Math.max(1, Math.round(xMul))},${Math.max(1, Math.round(yMul))},"${safeText}"`,
      `PRINT ${Math.max(1, Math.round(copies))},1`,
      "",
    ].join("\r\n");
  }

  static makeTsplBitmapLabel(imageData, {
    labelWidthMm = 10,
    labelHeightMm = 15,
    gapMm = 2,
    x = 0,
    y = 0,
    threshold = 180,
    mode = 0,
    invert = true,
    dither = true,
    copies = 1,
  } = {}, encoder = new TextEncoder()) {
    if (!imageData?.data || !imageData.width || !imageData.height) {
      throw new Error("BleLabelPrinter: printTsplBitmap needs ImageData");
    }

    const width = Math.max(1, Math.round(imageData.width));
    const height = Math.max(1, Math.round(imageData.height));
    const widthBytes = Math.ceil(width / 8);
    const bitmap = new Uint8Array(widthBytes * height);
    if (invert) bitmap.fill(0xff);

    const luminance = new Float32Array(width * height);
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const pixelIndex = (py * width + px) * 4;
        const red = imageData.data[pixelIndex] || 0;
        const green = imageData.data[pixelIndex + 1] || 0;
        const blue = imageData.data[pixelIndex + 2] || 0;
        const alpha = imageData.data[pixelIndex + 3] ?? 255;
        luminance[py * width + px] = alpha <= 20 ? 255 : 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      }
    }

    if (dither) {
      BleLabelPrinter._applyFloydSteinbergDither(luminance, width, height, threshold);
    }

    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const isBlack = luminance[py * width + px] < threshold;
        if (!isBlack) continue;

        const byteIndex = py * widthBytes + Math.floor(px / 8);
        const bitMask = 0x80 >> (px % 8);
        if (invert) {
          bitmap[byteIndex] &= ~bitMask;
        } else {
          bitmap[byteIndex] |= bitMask;
        }
      }
    }

    const header = [
      `SIZE ${Number(labelWidthMm) || 10} mm,${Number(labelHeightMm) || 15} mm`,
      `GAP ${Number(gapMm) || 2} mm,0 mm`,
      "DIRECTION 1",
      "CLS",
      `BITMAP ${Math.round(x)},${Math.round(y)},${widthBytes},${height},${Math.round(mode)},`,
    ].join("\r\n");
    const footer = `\r\nPRINT ${Math.max(1, Math.round(copies))},1\r\n`;

    const headerBytes = encoder.encode(header);
    const footerBytes = encoder.encode(footer);
    const bytes = new Uint8Array(headerBytes.length + bitmap.length + footerBytes.length);
    bytes.set(headerBytes, 0);
    bytes.set(bitmap, headerBytes.length);
    bytes.set(footerBytes, headerBytes.length + bitmap.length);
    return bytes;
  }

  static _applyFloydSteinbergDither(values, width, height, threshold) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const oldValue = values[index];
        const newValue = oldValue < threshold ? 0 : 255;
        const error = oldValue - newValue;
        values[index] = newValue;

        if (x + 1 < width) values[index + 1] += error * (7 / 16);
        if (y + 1 >= height) continue;
        if (x > 0) values[index + width - 1] += error * (3 / 16);
        values[index + width] += error * (5 / 16);
        if (x + 1 < width) values[index + width + 1] += error * (1 / 16);
      }
    }
  }

  static makeCpclTextLabel(text, {
    widthDots = 384,
    heightDots = 240,
    x = 30,
    y = 40,
    font = 4,
    size = 0,
    copies = 1,
  } = {}) {
    const safeText = BleLabelPrinter.escapeLineText(text);
    return [
      `! 0 200 200 ${Math.round(heightDots)} ${Math.max(1, Math.round(copies))}`,
      `PAGE-WIDTH ${Math.round(widthDots)}`,
      `TEXT ${Math.round(font)} ${Math.round(size)} ${Math.round(x)} ${Math.round(y)} ${safeText}`,
      "FORM",
      "PRINT",
      "",
    ].join("\r\n");
  }

  static makeEscposTextReceipt(text, {
    title = "Portal ESC/POS",
    feedLines = 4,
    align = "center",
  } = {}, encoder = new TextEncoder()) {
    const alignValue = align === "right" ? 2 : align === "left" ? 0 : 1;
    const chunks = [
      new Uint8Array([0x1b, 0x40]),
      new Uint8Array([0x1b, 0x61, alignValue]),
      new Uint8Array([0x1b, 0x45, 0x01]),
      encoder.encode(`${BleLabelPrinter.escapeLineText(title)}\n`),
      new Uint8Array([0x1b, 0x45, 0x00]),
      encoder.encode(`${String(text ?? "").replace(/\r?\n/g, "\n")}\n`),
      BleLabelPrinter.makeEscposFeed(feedLines),
    ];
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  static makeEscposFeed(lines = 4) {
    const count = Math.max(1, Math.min(12, Math.round(Number(lines) || 4)));
    const bytes = new Uint8Array(count);
    bytes.fill(0x0a);
    return bytes;
  }

  static escapeZplText(text) {
    return String(text ?? "")
      .replace(/\^/g, " ")
      .replace(/~/g, " ")
      .replace(/\r?\n/g, "\\&");
  }

  static escapeQuotedText(text) {
    return BleLabelPrinter.escapeLineText(text).replace(/"/g, "'");
  }

  static escapeLineText(text) {
    return String(text ?? "").replace(/\r?\n/g, " ").trim();
  }
}

BleLabelPrinter.COMMON_SERVICE_UUIDS = [
  // Nordic UART Service, used by many BLE serial bridges.
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  // Common HM-10 / transparent serial service.
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000ffe5-0000-1000-8000-00805f9b34fb",
  // Microchip/ISSC transparent UART service used by some serial BLE modules.
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  // Niimbot BLE service used by B-series/D-series printers.
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  // Device info is harmless and often useful when granted.
  "device_information",
];

BleLabelPrinter.PROTOCOLS = {
  zpl: {
    encode(data, encoder) {
      return encoder.encode(String(data || ""));
    },
  },
  tspl: {
    encode(data, encoder) {
      return encoder.encode(String(data || ""));
    },
  },
  cpcl: {
    encode(data, encoder) {
      return encoder.encode(String(data || ""));
    },
  },
  escpos: {
    encode(data, encoder) {
      return encoder.encode(String(data || ""));
    },
  },
};
