// WebUSB transport for Star Micronics USB printers.
// Initial target: TSP700 / STR_T-U001 in STAR Line mode.

class StarUsbPrinter {
  constructor({
    vendorId = 0x0519,
    productId = null,
    chunkSize = 32,
    chunkDelayMs = 25,
    debug = true,
    onState = null,
    onConnect = null,
    onDisconnect = null,
    onError = null,
  } = {}) {
    this.vendorId = vendorId;
    this.productId = productId;
    this.chunkSize = Math.max(8, Math.min(64, Number(chunkSize) || 32));
    this.chunkDelayMs = Math.max(0, Number(chunkDelayMs) || 25);
    this.debug = debug !== false;
    this._onState = typeof onState === "function" ? onState : null;
    this._onConnect = typeof onConnect === "function" ? onConnect : null;
    this._onDisconnect = typeof onDisconnect === "function" ? onDisconnect : null;
    this._onError = typeof onError === "function" ? onError : null;

    this.ready = false;
    this.connected = false;
    this.connecting = false;
    this.state = "idle";
    this.device = null;
    this.interfaceNumber = null;
    this.alternateSetting = null;
    this.endpointOut = null;
    this.endpointIn = null;
    this._writeQueue = Promise.resolve();
    this._encoder = new TextEncoder();
    this._boundDisconnect = this._handleDisconnect.bind(this);
    this._boundConnect = this._handleConnect.bind(this);
  }

  async init() {
    if (!navigator.usb) {
      throw new Error("StarUsbPrinter: WebUSB is not available in this browser");
    }
    this.ready = true;
    this._setState("ready");
    try {
      navigator.usb.addEventListener("disconnect", this._boundDisconnect);
      navigator.usb.addEventListener("connect", this._boundConnect);
    } catch {}
    this.tryReconnectKnown().catch((err) => this._handleError(err));
    return this;
  }

  async connect() {
    return await this.connectWithPicker();
  }

  async connectWithPicker() {
    this._ensureReady();
    if (this.connected) return true;
    if (this.connecting) return false;

    this.connecting = true;
    this._setState("requesting_device");
    try {
      const filters = [{ vendorId: this.vendorId }];
      if (this.productId != null) filters[0].productId = this.productId;
      this._debug("requestDevice", filters);
      const device = await navigator.usb.requestDevice({ filters });
      return await this._openDevice(device, "picker");
    } catch (error) {
      this.connecting = false;
      this._handleError(error);
      throw error;
    }
  }

  async tryReconnectKnown() {
    this._ensureReady();
    if (this.connected) return true;
    if (this.connecting) return false;
    const devices = await navigator.usb.getDevices();
    this._debug("known usb devices", devices.map((device) => this._describeDevice(device)));
    const device = devices.find((entry) => {
      if (entry.vendorId !== this.vendorId) return false;
      return this.productId == null || entry.productId === this.productId;
    });
    if (!device) {
      this._setState("needs_usb_permission");
      return false;
    }
    this.connecting = true;
    return await this._openDevice(device, "known");
  }

  async disconnect() {
    await this._safeClose();
    this.connected = false;
    this.connecting = false;
    this._setState("disconnected");
  }

  async printText(text, { cut = true, feedLines = 5 } = {}) {
    const bytes = StarUsbPrinter.makeStarLineTextReceipt(text, { cut, feedLines }, this._encoder);
    this._debug("print text", {
      bytes: bytes.length,
      preview: String(text || "").slice(0, 160),
    });
    await this.writeBytes(bytes);
  }

  async testPrint() {
    await this.printText([
      "Portal WebUSB Star",
      "TSP700 / STR_T-U001",
      new Date().toLocaleString(),
      "",
      "If this prints, WebUSB works.",
    ].join("\n"));
  }

  async resetPrinter({ feedLines = 2 } = {}) {
    const bytes = StarUsbPrinter.makeStarLineReset({ feedLines }, this._encoder);
    this._debug("reset printer", { bytes: bytes.length });
    await this.writeBytes(bytes);
  }

  async storeContinuousDefaults() {
    const reset = StarUsbPrinter.makeStarLineReset({ feedLines: 0 }, this._encoder);
    const store = StarUsbPrinter.makeStoreContinuousDefaults();
    this._debug("store continuous defaults", {
      bytes: reset.length + store.length,
      warning: "writes Star memory switch data to EEPROM",
    });
    await this.writeBytes(reset);
    await this._sleep(250);
    await this.writeBytes(store);
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
      transport: "webusb",
      device: this.device ? this._describeDevice(this.device) : null,
      interfaceNumber: this.interfaceNumber,
      alternateSetting: this.alternateSetting,
      endpointOut: this.endpointOut,
      endpointIn: this.endpointIn,
    };
  }

  async _openDevice(device, source) {
    try {
      this.device = device;
      this._setState(source === "picker" ? "connecting_picker" : "connecting_known");
      this._debug("opening device", this._describeDevice(device));
      await device.open();
      if (!device.configuration) {
        await device.selectConfiguration(1);
      }

      this._debug("configuration", this._describeConfiguration(device));
      const endpointInfo = this._findWritableEndpoint(device);
      if (!endpointInfo) {
        throw new Error("StarUsbPrinter: no writable USB endpoint found");
      }

      this.interfaceNumber = endpointInfo.interfaceNumber;
      this.alternateSetting = endpointInfo.alternateSetting;
      this.endpointOut = endpointInfo.endpointOut;
      this.endpointIn = endpointInfo.endpointIn;

      try {
        if (device.isKernelDriverActive?.(this.interfaceNumber)) {
          await device.detachKernelDriver(this.interfaceNumber);
        }
      } catch {}

      await device.claimInterface(this.interfaceNumber);
      if (this.alternateSetting != null) {
        try {
          await device.selectAlternateInterface(this.interfaceNumber, this.alternateSetting);
        } catch (error) {
          this._debug("selectAlternateInterface failed", {
            interfaceNumber: this.interfaceNumber,
            alternateSetting: this.alternateSetting,
            error: error?.message || String(error),
          });
        }
      }
      this.connected = true;
      this.connecting = false;
      this._setState("connected");
      this._onConnect?.(this);
      this._debug("connected", this.getConnectionState());
      return true;
    } catch (error) {
      this.connected = false;
      this.connecting = false;
      await this._safeClose();
      this._handleError(error);
      throw error;
    }
  }

  _findWritableEndpoint(device) {
    const candidates = [];
    for (const usbInterface of device.configuration?.interfaces || []) {
      for (const alternate of usbInterface.alternates || []) {
        const outEndpoint = alternate.endpoints.find((endpoint) => endpoint.direction === "out" && endpoint.type === "bulk") ||
          alternate.endpoints.find((endpoint) => endpoint.direction === "out");
        if (!outEndpoint) continue;
        const inEndpoint = alternate.endpoints.find((endpoint) => endpoint.direction === "in");
        candidates.push({
          interfaceNumber: usbInterface.interfaceNumber,
          alternateSetting: alternate.alternateSetting,
          interfaceClass: alternate.interfaceClass,
          interfaceSubclass: alternate.interfaceSubclass,
          interfaceProtocol: alternate.interfaceProtocol,
          endpointOut: outEndpoint.endpointNumber,
          endpointOutType: outEndpoint.type,
          packetSize: outEndpoint.packetSize,
          endpointIn: inEndpoint?.endpointNumber || null,
        });
      }
    }
    this._debug("endpoint candidates", candidates);
    return (
      candidates.find((entry) => entry.interfaceClass === 7 && entry.endpointOutType === "bulk") ||
      candidates.find((entry) => entry.endpointOutType === "bulk") ||
      candidates[0] ||
      null
    );
  }

  async _writeBytesNow(payload) {
    this._ensureConnected();
    this._setState("printing");
    const chunkSize = this.chunkSize;
    for (let offset = 0; offset < payload.length; offset += chunkSize) {
      const chunk = payload.slice(offset, offset + chunkSize);
      this._debug("transferOut", {
        endpoint: this.endpointOut,
        offset,
        bytes: chunk.length,
      });
      const result = await this.device.transferOut(this.endpointOut, chunk);
      this._debug("transferOut result", {
        status: result.status,
        bytesWritten: result.bytesWritten,
      });
      if (this.chunkDelayMs > 0 && offset + chunkSize < payload.length) {
        await this._sleep(this.chunkDelayMs);
      }
    }
    this._setState("connected");
  }

  async _safeClose() {
    try {
      if (this.device?.opened && this.interfaceNumber != null) {
        await this.device.releaseInterface(this.interfaceNumber);
      }
    } catch {}
    try {
      if (this.device?.opened) await this.device.close();
    } catch {}
    this.interfaceNumber = null;
    this.alternateSetting = null;
    this.endpointOut = null;
    this.endpointIn = null;
  }

  _handleDisconnect(event) {
    if (event?.device && this.device && event.device !== this.device) return;
    this.connected = false;
    this.connecting = false;
    this._setState("disconnected");
    this._onDisconnect?.(this);
  }

  _handleConnect(event) {
    if (event?.device?.vendorId === this.vendorId && !this.connected && !this.connecting) {
      this.tryReconnectKnown().catch((err) => this._handleError(err));
    }
  }

  _describeDevice(device) {
    return {
      productName: device?.productName || "",
      manufacturerName: device?.manufacturerName || "",
      serialNumber: device?.serialNumber || "",
      vendorId: device?.vendorId ?? null,
      productId: device?.productId ?? null,
      opened: !!device?.opened,
    };
  }

  _describeConfiguration(device) {
    return {
      configurationValue: device.configuration?.configurationValue ?? null,
      interfaces: (device.configuration?.interfaces || []).map((usbInterface) => ({
        interfaceNumber: usbInterface.interfaceNumber,
        claimed: !!usbInterface.claimed,
        alternates: usbInterface.alternates.map((alternate) => ({
          alternateSetting: alternate.alternateSetting,
          interfaceClass: alternate.interfaceClass,
          interfaceSubclass: alternate.interfaceSubclass,
          interfaceProtocol: alternate.interfaceProtocol,
          interfaceName: alternate.interfaceName || "",
          endpoints: alternate.endpoints.map((endpoint) => ({
            endpointNumber: endpoint.endpointNumber,
            direction: endpoint.direction,
            type: endpoint.type,
            packetSize: endpoint.packetSize,
          })),
        })),
      })),
    };
  }

  _ensureReady() {
    if (!this.ready) throw new Error("StarUsbPrinter: call init() first");
  }

  _ensureConnected() {
    this._ensureReady();
    if (!this.connected || !this.device?.opened || this.endpointOut == null) {
      throw new Error("StarUsbPrinter: not connected to a writable WebUSB printer");
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

  _debug(label, payload = "") {
    if (!this.debug) return;
    if (payload === "") {
      console.log(`[StarUsbPrinter] ${label}`);
      return;
    }
    console.log(`[StarUsbPrinter] ${label}`, payload);
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static makeStarLineTextReceipt(text, { cut = true, feedLines = 5 } = {}, encoder = new TextEncoder()) {
    const lines = String(text ?? "").replace(/\r?\n/g, "\n");
    const init = StarUsbPrinter.makeStarLineReset({ feedLines: 0 }, encoder);
    const body = encoder.encode(`${lines}\n${"\n".repeat(Math.max(0, Math.round(feedLines)))}`);
    const bodyWithInit = new Uint8Array(init.length + body.length);
    bodyWithInit.set(init, 0);
    bodyWithInit.set(body, init.length);
    if (!cut) return body;

    const cutCommand = new Uint8Array([0x1b, 0x64, 0x32]); // ESC d "2": full cut after feed to cutter in Star Line mode.
    const bytes = new Uint8Array(bodyWithInit.length + cutCommand.length);
    bytes.set(bodyWithInit, 0);
    bytes.set(cutCommand, bodyWithInit.length);
    return bytes;
  }

  static makeStarLineReset({ feedLines = 2 } = {}, encoder = new TextEncoder()) {
    const commands = [
      0x1b, 0x40, // ESC @ initialize printer.
      0x1b, 0x2d, 0x00, // ESC - 0: underline off.
      0x1b, 0x45, 0x00, // ESC E 0: emphasized off.
    ];
    const feed = encoder.encode("\n".repeat(Math.max(0, Math.round(feedLines))));
    const bytes = new Uint8Array(commands.length + feed.length);
    bytes.set(commands, 0);
    bytes.set(feed, commands.length);
    return bytes;
  }

  static makeStoreContinuousDefaults() {
    // Star Line memory switch write for TSP600/700/800 family.
    // MSW1 parameters: n1=0, n2=0 start-position detect OFF, n3=0 normal zero, n4=0 USA.
    // Sequence: define MSW1 as "0000", write memory switch data, then reset.
    return new Uint8Array([
      0x1b, 0x1d, 0x23, 0x2c, 0x01, 0x30, 0x30, 0x30, 0x30, 0x0a, 0x00,
      0x1b, 0x1d, 0x23, 0x57, 0x00, 0x30, 0x30, 0x30, 0x30, 0x0a, 0x00,
      0x1b, 0x3f, 0x0a, 0x00,
    ]);
  }
}

window.StarUsbPrinter = StarUsbPrinter;
