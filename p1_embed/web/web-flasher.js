const DEFAULT_ESPTOOL_MODULE = "https://esm.sh/esptool-js@0.5.7?bundle";

export class P1WebFlasher extends EventTarget {
  constructor({
    esptoolModuleUrl = DEFAULT_ESPTOOL_MODULE,
    baudrate = 921600,
    debugLogging = false,
    filters = [],
  } = {}) {
    super();
    this.esptoolModuleUrl = esptoolModuleUrl;
    this.baudrate = baudrate;
    this.debugLogging = debugLogging;
    this.filters = filters;
    this.port = null;
    this.transport = null;
    this.loader = null;
    this.chipName = "";
  }

  get available() {
    return Boolean(navigator.serial);
  }

  async connect({ port = null, filters = this.filters } = {}) {
    if (!this.available) throw new Error("Web Serial is not available in this browser");

    const { ESPLoader, Transport } = await this.loadEsptool();
    this.port = port || await navigator.serial.requestPort(filters.length ? { filters } : {});
    this.transport = new Transport(this.port, false);
    this.loader = new ESPLoader({
      transport: this.transport,
      baudrate: this.baudrate,
      terminal: this.terminal(),
      debugLogging: this.debugLogging,
    });
    this.setState("connecting");
    this.chipName = await this.loader.main();
    this.setState("connected", { chipName: this.chipName });
    return this.chipName;
  }

  async flashManifest(manifestUrl = "bin/p1e-firmware.json", options = {}) {
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load firmware manifest: ${response.status}`);
    const manifest = await response.json();
    const baseUrl = new URL(manifestUrl, window.location.href);
    return await this.flashFiles(manifestToFiles(manifest, baseUrl), {
      flashMode: manifest.flashMode,
      flashFreq: manifest.flashFreq,
      flashSize: manifest.flashSize,
      eraseAll: manifest.eraseAll,
      compress: manifest.compress,
      ...options,
    });
  }

  async flashFiles(files, {
    flashMode = "dio",
    flashFreq = "40m",
    flashSize = "detect",
    eraseAll = false,
    compress = true,
  } = {}) {
    if (!this.loader) await this.connect();
    if (!Array.isArray(files) || files.length === 0) throw new Error("No firmware files provided");

    this.setState("loading");
    const fileArray = [];
    for (const file of files) {
      fileArray.push({
        address: parseFlashAddress(file.address ?? file.offset),
        data: await firmwareData(file),
      });
    }

    this.setState("flashing");
    await this.loader.writeFlash({
      fileArray,
      flashMode,
      flashFreq,
      flashSize,
      eraseAll,
      compress,
      reportProgress: (fileIndex, written, total) => {
        this.emit("progress", { fileIndex, written, total });
      },
    });
    this.setState("resetting");
    await this.loader.after("hard_reset");
    await this.resetToAppMode();
    this.setState("done");
  }

  async eraseFlash() {
    if (!this.loader) await this.connect();
    this.setState("erasing");
    await this.loader.eraseFlash();
    this.setState("erased");
  }

  async disconnect() {
    await this.releaseBootSignals();
    await this.transport?.disconnect?.();
    this.loader = null;
    this.transport = null;
    this.port = null;
    this.chipName = "";
    this.setState("disconnected");
  }

  async loadEsptool() {
    return await import(this.esptoolModuleUrl);
  }

  async releaseBootSignals() {
    try {
      await this.port?.setSignals?.({
        dataTerminalReady: false,
        requestToSend: false,
      });
    } catch {
    }
  }

  async resetToAppMode() {
    try {
      await this.port?.setSignals?.({
        dataTerminalReady: false,
        requestToSend: false,
      });
      await sleep(50);
      await this.port?.setSignals?.({
        dataTerminalReady: false,
        requestToSend: true,
      });
      await sleep(120);
      await this.port?.setSignals?.({
        dataTerminalReady: false,
        requestToSend: false,
      });
      await sleep(250);
    } catch {
      await this.releaseBootSignals();
    }
  }

  terminal() {
    return {
      clean: () => this.emit("log", { message: "" }),
      write: (message) => this.emit("log", { message: String(message) }),
      writeLine: (message) => this.emit("log", { message: String(message), newline: true }),
    };
  }

  setState(state, data = {}) {
    this.emit("state", { state, ...data });
  }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function manifestToFiles(manifest, baseUrl) {
  const files = manifest.files || manifest.parts || manifest.builds?.[0]?.parts || [];
  return files.map((part) => {
    const path = part.url || part.path || part.file || part.name;
    if (!path) throw new Error("Firmware manifest part is missing a path/url");
    return {
      address: part.address ?? part.offset,
      url: new URL(path, baseUrl).toString(),
    };
  });
}

async function firmwareData(file) {
  if (file.data) return toBinaryString(toUint8Array(file.data));
  if (file.file instanceof File || file.blob instanceof Blob) {
    return toBinaryString(new Uint8Array(await (file.file || file.blob).arrayBuffer()));
  }
  if (!file.url) throw new Error("Firmware file needs data, file, blob, or url");
  const response = await fetch(file.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${file.url}: ${response.status}`);
  return toBinaryString(new Uint8Array(await response.arrayBuffer()));
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("Firmware data must be Uint8Array, ArrayBuffer, or typed array");
}

function toBinaryString(bytes) {
  let out = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    out += String.fromCharCode(...chunk);
  }
  return out;
}

function parseFlashAddress(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim();
  if (!text) throw new Error("Firmware part is missing a flash address");
  const address = text.toLowerCase().startsWith("0x") ? parseInt(text, 16) : Number(text);
  if (!Number.isFinite(address) || address < 0) throw new Error(`Invalid flash address: ${value}`);
  return address;
}
