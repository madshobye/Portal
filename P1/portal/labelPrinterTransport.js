// Unified BLE/USB label printer transport for sketches that print TSPL bitmaps.
// Requires labelPrinterProtocol.js, bleLabelPrinter.js, and usbLabelPrinter.js.
// Star WebUSB support is used when starUsbPrinter.js is also loaded and webusb options are provided.

class LabelPrinterTransport {
  constructor({
    ble = {},
    usb = {},
    webusb = false,
    peer = false,
    defaultTransport = "ble",
    onState = null,
    onError = null,
  } = {}) {
    this.bleOptions = ble === false ? null : (ble || {});
    this.usbOptions = usb === false ? null : (usb || {});
    this.webUsbOptions = webusb === false ? null : (webusb || {});
    this.peerOptions = peer === false ? null : (peer || {});
    this.activeTransport = ["usb", "webusb", "peer"].includes(defaultTransport) ? defaultTransport : "ble";
    this.printer = null;
    this.blePrinter = null;
    this.usbPrinter = null;
    this.webUsbPrinter = null;
    this.peerPrinter = null;
    this.usbAvailable = false;
    this.webUsbAvailable = false;
    this.peerAvailable = false;
    this.ready = false;
    this._onState = typeof onState === "function" ? onState : null;
    this._onError = typeof onError === "function" ? onError : null;
    this._encoder = new TextEncoder();
  }

  async init() {
    if (this.bleOptions) {
      this.blePrinter = await new BleLabelPrinter({
        protocol: "tspl",
        chunkSize: 488,
        chunkDelayMs: 0,
        preferWriteWithResponse: true,
        autoReconnectOnRefresh: false,
        autoReconnectOnDisconnect: false,
        waitForAutoReconnect: false,
        autoReconnectAttempts: 1,
        reconnectDelayMs: 700,
        ...this.bleOptions,
        onState: (state) => this._handleState("ble", state),
        onError: (error) => this._handleError("ble", error),
      }).init();
    }

    if (this.usbOptions && typeof UsbLabelPrinter !== "undefined") {
      try {
        this.usbPrinter = await new UsbLabelPrinter({
          protocol: "tspl",
          chunkSize: 4096,
          chunkDelayMs: 2,
          autoReconnectOnRefresh: true,
          debug: false,
          ...this.usbOptions,
          onState: (state) => this._handleState("usb", state),
          onConnect: () => this.activate("usb"),
          onError: (error) => this._handleError("usb", error),
        }).init();
        this.usbAvailable = true;
      } catch (error) {
        this.usbPrinter = null;
        this.usbAvailable = false;
        this._handleError("usb", error, { passive: true });
      }
    }

    if (this.webUsbOptions && typeof StarUsbPrinter !== "undefined") {
      try {
        this.webUsbPrinter = await new StarUsbPrinter({
          vendorId: 0x0416,
          productId: 0x5011,
          chunkSize: 4096,
          chunkDelayMs: 0,
          debug: false,
          ...this.webUsbOptions,
          onState: (state) => this._handleState("webusb", state),
          onConnect: () => this.activate("webusb"),
          onError: (error) => this._handleError("webusb", error),
        }).init();
        const requestedChunkSize = Number(this.webUsbOptions.chunkSize);
        this.webUsbPrinter.chunkSize = Number.isFinite(requestedChunkSize)
          ? Math.max(8, Math.round(requestedChunkSize))
          : 4096;
        this._addProtocolMethods(this.webUsbPrinter);
        this.webUsbAvailable = true;
      } catch (error) {
        this.webUsbPrinter = null;
        this.webUsbAvailable = false;
        this._handleError("webusb", error, { passive: true });
      }
    }

    if (this.peerOptions && typeof PeerLabelPrinter !== "undefined") {
      try {
        this.peerPrinter = await new PeerLabelPrinter({
          protocol: "tspl",
          chunkSize: 1200,
          debug: false,
          ...this.peerOptions,
          onState: (state) => this._handleState("peer", state),
          onConnect: () => this.activate("peer"),
          onError: (error) => this._handleError("peer", error),
        }).init();
        this.peerAvailable = true;
      } catch (error) {
        this.peerPrinter = null;
        this.peerAvailable = false;
        this._handleError("peer", error, { passive: true });
      }
    }

    this.activate(this.activeTransport);
    this.ready = true;
    return this;
  }

  activate(transport) {
    if (transport === "usb" && this.usbPrinter) {
      this.activeTransport = "usb";
      this.printer = this.usbPrinter;
    } else if (transport === "webusb" && this.webUsbPrinter) {
      this.activeTransport = "webusb";
      this.printer = this.webUsbPrinter;
    } else if (transport === "peer" && this.peerPrinter) {
      this.activeTransport = "peer";
      this.printer = this.peerPrinter;
    } else {
      this.activeTransport = "ble";
      this.printer = this.blePrinter;
    }
    this.syncState();
  }

  canConnect(transport) {
    if (transport === "usb") return !!this.usbPrinter;
    if (transport === "webusb") return !!this.webUsbPrinter;
    if (transport === "peer") return !!this.peerPrinter;
    return !!this.blePrinter;
  }

  async connect(transport = this.activeTransport) {
    this.activate(transport);
    if (!this.printer) {
      throw new Error(`${this.formatTransport(this.activeTransport)} printer is unavailable in this browser`);
    }
    if (this.activeTransport === "ble") {
      await this.printer.connectWithPicker({ acceptAllDevices: false });
    } else {
      await this.printer.connect();
    }
    this.syncState();
    return true;
  }

  async disconnect() {
    await this.printer?.disconnect?.();
    this.syncState();
  }

  getConnectionState() {
    return this.printer?.getConnectionState?.() || {
      ready: this.ready,
      connected: false,
      state: "unavailable",
      transport: this.activeTransport,
    };
  }

  getSuggestedOutputMode() {
    if (this.activeTransport === "usb" || this.activeTransport === "webusb" || this.activeTransport === "peer") return "label";
    return this.printer?.getSuggestedOutputMode?.() || "label";
  }

  printTsplBitmapAsync(imageData, options = {}) {
    if (this.activeTransport === "ble") {
      return this.printer.printTsplBitmapAsync(imageData, options);
    }

    let cancelled = false;
    const promise = (async () => {
      const bytes = LabelPrinterProtocol.makeTsplBitmapLabel(imageData, options, this._encoder);
      await this.printer.writeBytes(bytes, { onProgress: options.onProgress });
      if (!cancelled) options.onProgress?.({ ratio: 1 });
    })();

    return {
      promise,
      cancel: () => {
        cancelled = true;
      },
    };
  }

  async withWriteSettings(settings, callback) {
    if (typeof this.printer?.withWriteSettings === "function") {
      return await this.printer.withWriteSettings(settings, callback);
    }
    return await callback();
  }

  async printEscposBitmap(imageData, options = {}) {
    if (typeof this.printer?.printEscposBitmap !== "function") {
      throw new Error(`${this.formatTransport(this.activeTransport)} does not support ESC/POS bitmap printing`);
    }
    await this.printer.printEscposBitmap(imageData, options);
  }

  formatTransport(transport = this.activeTransport) {
    if (transport === "peer") return "Peer";
    return transport === "usb" || transport === "webusb" ? "USB" : "BLE";
  }

  formatUsbId(vendorId, productId) {
    if (vendorId == null && productId == null) return "none";
    const vendor = vendorId == null ? "????" : vendorId.toString(16).padStart(4, "0");
    const product = productId == null ? "????" : productId.toString(16).padStart(4, "0");
    return `${vendor}:${product}`;
  }

  syncState() {
    const state = this.getConnectionState();
    this._handleState(this.activeTransport, state);
  }

  _handleState(transport, state) {
    if (transport !== this.activeTransport) return;
    this._onState?.({
      ...state,
      transport,
      transportLabel: this.formatTransport(transport),
      suggestedOutputMode: transport === "usb" || transport === "webusb" || transport === "peer" ? "label" : state?.suggestedOutputMode,
    });
  }

  _handleError(transport, error, { passive = false } = {}) {
    if (!passive) console.error(`[LabelPrinterTransport] ${transport} error`, error);
    if (transport !== this.activeTransport && passive) return;
    this._onError?.(error, { transport, transportLabel: this.formatTransport(transport) });
  }

  _addProtocolMethods(target) {
    if (!target || target.__labelPrinterTransportProtocolMethods) return;
    target.printTsplBitmap = async (imageData, options = {}) => {
      const bytes = LabelPrinterProtocol.makeTsplBitmapLabel(imageData, options, this._encoder);
      await target.writeBytes(bytes);
    };
    target.__labelPrinterTransportProtocolMethods = true;
  }
}

window.LabelPrinterTransport = LabelPrinterTransport;
