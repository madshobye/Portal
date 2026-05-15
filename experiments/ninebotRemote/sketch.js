let remote;
let canvas;
let shellEl;
let adminEl;
let canvasHostEl;
let canvasHostResizeObserver = null;
let statusEl;
let infoEl;
let consoleEl;
let toggleBtn;
let authKeyInputEl;
let panelHidden = false;
let targetButtons = [];
let hitRegions = [];
let logLines = [];
let activePointerControl = null;
let currentVector = null;
let lastSendAt = 0;
let lastRemoteEnableAt = 0;
let forwardByte = 32767;
let backwardByte = 32767;
let steerByte = 8192;
let straightTurnBias = 0;
let maxRemoteSpeedRaw = 3000;
let selectedControlTargetId = 0x0a;
let remotePayloadMode = "p1-i16-speed-turn";
let reversePayloadMode = "negative-forward";
let protocolMode = 1;
let writeMode = "response";
let autoTest2Report = "";
let autoTest2Running = false;
let activeBeepProbeLabel = "";
let gamepadController = null;
const pressedControlKeys = new Set();

const BUTTON_RADIUS = 20;
const LOG_LIMIT = 240;
const SEND_INTERVAL_MS = 80;
const REMOTE_ENABLE_KEEPALIVE_MS = 900;
const GAMEPAD_DEADZONE = 0.12;
const GAMEPAD_ANALOG_CURVE = 1.35;
const KEYBOARD_CONTROL_KEYS = new Set([
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "w",
  "a",
  "s",
  "d",
  " ",
]);
const REMOTE_COMMAND_WORD_MIN = 256;
const REMOTE_COMMAND_WORD_MAX = 32767;
const REMOTE_COMMAND_WORD_STEP = 256;
const REMOTE_PAYLOAD_LOG_MS = 600;
const ALLOW_EXTENDED_REMOTE_SPEED_PAYLOADS = false;
const SAFE_REMOTE_PAYLOAD_MODES = ["p1-i16-speed-turn", "p1-i16-turn-speed"];
const REMOTE_COMMAND_PRESETS = [
  ["Slow", 2048],
  ["Medium", 8192],
  ["Fast", 16384],
  ["Max", 32767],
];
const MAX_REMOTE_SPEED_PRESETS = [
  ["2 km/h", 2000],
  ["3 km/h", 3000],
  ["6 km/h", 6000],
];
const REMOTE_PAYLOAD_MODES = [
  "hybrid-2b-drive-4b-turn",
  "p1-i16-pitch-turn-forward",
  "p1-i16-zero-turn-forward",
  "p1-turn-speed",
  "p1-speed-turn",
  "p1-3b-turn-speed-zero",
  "p1-3b-speed-turn-zero",
  "p1-3b-zero-turn-speed",
  "p1-i16-speed-turn",
  "p1-i16-turn-speed",
  "p1-i16-speed-turn-zero",
  "p1-i16-speed-zero-turn",
  "p1-i16-zero-speed-turn",
  "p1-i16-turn-speed-zero",
];
const REMOTE_PAYLOAD_MODE_LABELS = {
  "hybrid-2b-drive-4b-turn": "Hybrid: 2B drive, 4B turn",
  "p1-i16-pitch-turn-forward": "6B [pitch16,turn16,forward16]",
  "p1-i16-zero-turn-forward": "6B [0,turn16,forward16]",
  "p1-turn-speed": "2B [turn,speed]",
  "p1-speed-turn": "2B [speed,turn]",
  "p1-3b-turn-speed-zero": "3B [turn,speed,0]",
  "p1-3b-speed-turn-zero": "3B [speed,turn,0]",
  "p1-3b-zero-turn-speed": "3B [0,turn,speed]",
  "p1-i16-speed-turn": "4B [forward16,turn16]",
  "p1-i16-turn-speed": "4B [turn16,forward16]",
  "p1-i16-speed-turn-zero": "6B [forward16,turn16,0]",
  "p1-i16-speed-zero-turn": "6B [forward16,0,turn16]",
  "p1-i16-zero-speed-turn": "6B [0,forward16,turn16]",
  "p1-i16-turn-speed-zero": "6B [turn16,forward16,0]",
};
const REVERSE_PAYLOAD_MODES = [
  "negative-forward",
  "positive-forward",
  "third-word-negative",
  "third-word-positive",
];
const REVERSE_PAYLOAD_MODE_LABELS = {
  "negative-forward": "reverse: -forward16",
  "positive-forward": "reverse: +forward16 probe",
  "third-word-negative": "reverse: third word -",
  "third-word-positive": "reverse: third word +",
};
const AUTO_PASSIVE_LISTEN_MS = 12000;
const AUTO_TEST2_PASSIVE_LISTEN_MS = 2500;
const AUTO_TEST2_RESPONSE_WAIT_MS = 520;
const AUTO_TEST2_INTER_STEP_MS = 120;
const AUTO_TEST2_ENABLE_CONTROL_PROBES = false;
const AUTO_TEST2_ENABLE_TINY_REMOTE_TEST = false;
const AUTO_TEST2_TINY_REMOTE_FORWARD_BYTE = 2048;
const AUTO_TEST2_TINY_REMOTE_PULSE_MS = 350;
const AUTO_TEST2_TINY_REMOTE_VARIANT_INDEX = 0;
const DIS_TARGET_ID = 0x01;
const APP_DISCOVERED_BLE_TARGET_ID = 0x0a;
const APP_DISCOVERED_REPLY_TARGET_ID = 0x0d;
const AUTO_TEST2_TINY_REMOTE_TARGET = APP_DISCOVERED_BLE_TARGET_ID;
const NINEBOT_S_SERVER_ID = 0x03;
const NINEBOT_S2_SERVER_ID = 0x21;
const NINEBOT_S_PROTO1_TARGETS = [
  ["App-discovered BLE/auth 0x0A", APP_DISCOVERED_BLE_TARGET_ID],
  ["Ninebot-S hw3", NINEBOT_S_SERVER_ID],
  ["Ninebot S 2 hw30", NINEBOT_S2_SERVER_ID],
];
const CMD_READ = 0x01;
const CMD_WRITE_NR = 0x03;
const CMD_ACTIVE = 0x57;
const CMD_PRE_COMM = 0x5b;
const E2_PRE_COMM_FRAMES = [
  ["C++ NinebotCrypto 0x3E->0x21", [0x5a, 0xa5, 0x00, 0x3e, 0x21, CMD_PRE_COMM, 0x00]],
  ["docs 0x3E->0x04", [0x5a, 0xa5, 0x00, 0x3e, 0x04, CMD_PRE_COMM, 0x00]],
];
const REG_ENABLE_REMOTE = 0x7a;
const REG_SET_REMOTE_SPEED = 0x7b;
const REG_REMOTE_INFO = 0xb2;
const REG_MAX_REMOTE_SPEED = 0x7d;
const REG_LIMIT_SPEED = 0x74;
const REG_SERIAL = 0x10;
const REG_RANGE = 0x25;
const REG_ODOMETER = 0xb7;
const REG_DIS_BATTERY = 0xb5;
const REG_CTRL_BATTERY = 0x22;
const REG_BLE_PASSWORD = 0x17;
const REG_BLE_VERSION = 0x68;
const REG_CTRL_VERSION = 0x1a;
const REG_BMS_VERSION = 0x67;
const REG_DRV_VOLT = 0x47;
const REG_ERROR_CODE = 0xb0;
const CANDIDATE_CONTROL_TARGETS = [APP_DISCOVERED_BLE_TARGET_ID, 0x03, 0x21, 0x01, 0x02, 0x04, 0x09, 0x20];
const CANDIDATE_READ_TARGETS = [APP_DISCOVERED_BLE_TARGET_ID, 0x03, 0x21, 0x01, 0x02, 0x04, 0x09, 0x10, 0x13, 0x20, 0xff];
const BLE_TARGET_ID = 0x04;
const BMS_TARGET_ID = 0x22;
const BFG_ECHO_TARGET_ID = 0x10;
const AUTO_TEST2_CONTROL_TARGET_PREFERENCE = [NINEBOT_S_SERVER_ID, NINEBOT_S2_SERVER_ID, 0x09, 0x20];
const AUTO_TEST2_READ_ONLY_TARGETS = new Set([APP_DISCOVERED_BLE_TARGET_ID, BLE_TARGET_ID, DIS_TARGET_ID, BMS_TARGET_ID]);
const FW_DATA_GEN2 = [
  0x97, 0xcf, 0xb8, 0x02, 0x84, 0x41, 0x43, 0xde,
  0x56, 0x00, 0x2b, 0x3b, 0x34, 0x78, 0x0a, 0x5d,
];
const SCREENSHOT_DEVICE_FACTS = {
  model: "Ninebot-S",
  appName: "NinebotS2674",
  serial: "20048/00012674",
  serialCompact: "2004800012674",
  masterControlVersion: "1.9.10",
  batteryVersion: "2.5.0",
  bluetoothVersion: "1.0.9",
};
const DEVICE_INFO_SERVICE = "device_information";
const DEVICE_INFO_CHARACTERISTICS = [
  ["manufacturer", "00002a29-0000-1000-8000-00805f9b34fb"],
  ["model", "00002a24-0000-1000-8000-00805f9b34fb"],
  ["serial", "00002a25-0000-1000-8000-00805f9b34fb"],
  ["hardware", "00002a27-0000-1000-8000-00805f9b34fb"],
  ["firmware", "00002a26-0000-1000-8000-00805f9b34fb"],
  ["software", "00002a28-0000-1000-8000-00805f9b34fb"],
];
const AUTO_TEST2_PROTOCOL_VARIANTS = [
  [1, "P1 csum16"],
  [7, "P1 csum15 legacy"],
  [4, "P1 len+index csum15"],
  [5, "P1 len+index csum16"],
  [2, "P2 payload-len"],
  [3, "P2 doc-len"],
];
const AUTO_TEST2_PRIMARY_ROUTE_PROBES = [
  ["App-discovered battery", APP_DISCOVERED_BLE_TARGET_ID, REG_CTRL_BATTERY, 2],
  ["Ninebot-S battery", NINEBOT_S_SERVER_ID, REG_CTRL_BATTERY, 2],
  ["Ninebot S 2 battery", NINEBOT_S2_SERVER_ID, REG_CTRL_BATTERY, 2],
];
const AUTO_TEST2_PACO_LEGACY_PACKETS = [
  ["Paco BLE pwd/version exact", [0x55, 0xaa, 0x03, 0x09, 0x01, 0x17, 0x08, 0xd3, 0xff], REG_BLE_PASSWORD],
  ["Paco serial exact", [0x55, 0xaa, 0x03, 0x09, 0x01, 0x10, 0x0e, 0xd4, 0xff], REG_SERIAL],
  ["Paco odometer exact", [0x55, 0xaa, 0x03, 0x09, 0x01, 0xb7, 0x04, 0x37, 0xff], REG_ODOMETER],
];
const AUTO_TEST2_BMS_SERIAL_PACKETS = [
  ["BMS UART info 0x10 size=32", [0x5a, 0xa5, 0x01, 0x3d, BMS_TARGET_ID, CMD_READ, 0x10, 0x20, 0x6e, 0xff], 0x10],
  ["BMS UART status 0x30 size=32", [0x5a, 0xa5, 0x01, 0x3d, BMS_TARGET_ID, CMD_READ, 0x30, 0x20, 0x4e, 0xff], 0x30],
  ["BMS UART cells 0x40 size=32", [0x5a, 0xa5, 0x01, 0x3d, BMS_TARGET_ID, CMD_READ, 0x40, 0x20, 0x3e, 0xff], 0x40],
];
const frameObservers = new Set();
const rawNotifyObservers = new Set();
window.PORTAL_CANVAS_RESIZE_MODE = "none";

const SERVICE_PROFILES = [
  {
    name: "ninebot-custom",
    service: "6e400001-0000-0000-006e-696e65626f74",
    write: "6e400002-0000-0000-006e-696e65626f74",
    notify: "6e400004-0000-0000-006e-696e65626f74",
  },
  {
    name: "nordic-uart",
    service: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
    write: "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
    notify: "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
  },
  {
    name: "hmsoft",
    service: "0000ffe0-0000-1000-8000-00805f9b34fb",
    write: "0000ffe1-0000-1000-8000-00805f9b34fb",
    notify: "0000ffe1-0000-1000-8000-00805f9b34fb",
  },
];

class NinebotBleRemote {
  constructor() {
    this.device = null;
    this.server = null;
    this.service = null;
    this.writeCharacteristic = null;
    this.writeChannels = [];
    this.activeWriteChannelId = "";
    this.notifyCharacteristic = null;
    this.profile = null;
    this.connected = false;
    this.remoteEnabled = false;
    this.rxBuffer = [];
    this.lastTxHex = "";
    this.lastRxHex = "";
    this.lastNotifyHex = "";
    this.lastRemoteInfo = null;
    this.lastRemotePayloadHex = "";
    this.lastRemotePayloadLogAt = 0;
    this.lastError = "";
    this.rxFrameCount = 0;
    this.echoFrameCount = 0;
    this.realRxFrameCount = 0;
    this.recentTxHex = [];
    this.deviceInfo = null;
    this.onFrame = null;
    this.onState = null;
    this._writeQueue = Promise.resolve();
    this._boundNotify = this._handleNotify.bind(this);
    this._boundDisconnect = this._handleDisconnect.bind(this);
  }

  async connectWithPicker() {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not available in this browser");
    }
    this._emitState("requesting device");
    const optionalServices = [
      ...new Set([...SERVICE_PROFILES.map((entry) => entry.service), DEVICE_INFO_SERVICE]),
    ];
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices,
    });
    await this._connectDevice(device);
    return true;
  }

  async disconnect() {
    if (this.connected && this._getActiveWriteCharacteristic()) {
      try {
        await this.stopRemote();
        await sleep(80);
        await this.enableRemoteControl(false);
      } catch (error) {
        this._emitState(`disconnect RC-off best effort failed: ${error?.message || error}`);
      }
    }
    this.remoteEnabled = false;
    if (this.notifyCharacteristic) {
      try {
        this.notifyCharacteristic.removeEventListener(
          "characteristicvaluechanged",
          this._boundNotify
        );
      } catch {}
    }
    if (this.device) {
      try {
        this.device.removeEventListener("gattserverdisconnected", this._boundDisconnect);
      } catch {}
    }
    if (this.server?.connected) {
      this.server.disconnect();
    }
    this.device = null;
    this.server = null;
    this.service = null;
    this.writeCharacteristic = null;
    this.writeChannels = [];
    this.activeWriteChannelId = "";
    this.notifyCharacteristic = null;
    this.profile = null;
    this.connected = false;
    this._emitState("disconnected");
  }

  async reconnectExisting(delayMs = 1200) {
    const device = this.device;
    if (!device?.gatt) {
      throw new Error("No previously selected BLE device to reconnect");
    }

    this._emitState(`reconnecting ${device?.name || "device"}`);
    this.remoteEnabled = false;
    if (this.notifyCharacteristic) {
      try {
        this.notifyCharacteristic.removeEventListener(
          "characteristicvaluechanged",
          this._boundNotify
        );
      } catch {}
      try {
        if (typeof this.notifyCharacteristic.stopNotifications === "function") {
          await this.notifyCharacteristic.stopNotifications();
        }
      } catch {}
    }
    try {
      device.removeEventListener("gattserverdisconnected", this._boundDisconnect);
    } catch {}
    try {
      if (this.server?.connected) this.server.disconnect();
    } catch {}

    this.server = null;
    this.service = null;
    this.writeCharacteristic = null;
    this.writeChannels = [];
    this.activeWriteChannelId = "";
    this.notifyCharacteristic = null;
    this.profile = null;
    this.connected = false;
    this.rxBuffer = [];
    this._writeQueue = Promise.resolve();

    await sleep(delayMs);
    await this._connectDevice(device);
    return true;
  }

  async enableRemoteControl(enable = true) {
    this._ensureConnected();
    await this.writeRegisterNR(selectedControlTargetId, REG_ENABLE_REMOTE, [enable ? 1 : 0]);
    this.remoteEnabled = !!enable;
    this._emitState(
      `${enable ? "remote enabled" : "remote disabled"} on target 0x${toHexByte(selectedControlTargetId)}`
    );
  }

  async setMaxRemoteSpeed(rawValue = maxRemoteSpeedRaw) {
    this._ensureConnected();
    const raw = Math.max(1000, Math.min(10000, Math.round(rawValue)));
    const payload = this._u16le(raw);
    await this.writeRegisterNR(selectedControlTargetId, REG_MAX_REMOTE_SPEED, payload);
    this._emitState(`max remote speed raw=${raw} on 0x${toHexByte(selectedControlTargetId)}`);
  }

  async setLimitSpeed(tenths) {
    this._ensureConnected();
    const limited = Math.max(0, Math.min(600, Math.round(Number(tenths) || 0)));
    const payload = this._u16le(limited);
    await this.writeRegisterNR(selectedControlTargetId, REG_LIMIT_SPEED, payload);
    this._emitState(
      limited === 0
        ? `speed limit disabled on 0x${toHexByte(selectedControlTargetId)}`
        : `speed limit ${(limited / 10).toFixed(1)} km/h on 0x${toHexByte(selectedControlTargetId)}`
    );
  }

  async setRemoteSpeed(forward, steer) {
    this._ensureConnected();
    const payload = this._remoteSpeedPayload(forward, steer);
    const payloadHex = this._bytesToHex(payload);
    const now = Date.now();
    if (
      payloadHex !== this.lastRemotePayloadHex ||
      now - this.lastRemotePayloadLogAt >= REMOTE_PAYLOAD_LOG_MS
    ) {
      this.lastRemotePayloadHex = payloadHex;
      this.lastRemotePayloadLogAt = now;
      this._emitState(`remote speed payload ${remotePayloadMode}=${payloadHex}`);
    }
    await this.writeRegisterNR(selectedControlTargetId, REG_SET_REMOTE_SPEED, payload);
  }

  async stopRemote() {
    if (!this.connected) return;
    await this.setRemoteSpeed(0, 0);
  }

  async readRemoteInfo() {
    return await this.readRegister(selectedControlTargetId, REG_REMOTE_INFO, 8);
  }

  async readMaxRemoteSpeed() {
    return await this.readRegister(selectedControlTargetId, REG_MAX_REMOTE_SPEED, 2);
  }

  async readSpeed() {
    return await this.readRegister(DIS_TARGET_ID, REG_DIS_BATTERY, 2);
  }

  async readLimitSpeed() {
    return await this.readRegister(selectedControlTargetId, REG_LIMIT_SPEED, 2);
  }

  async readBattery() {
    return await this.readRegister(DIS_TARGET_ID, REG_DIS_BATTERY, 2);
  }

  async readDisBatteryPercent() {
    return await this.readRegister(DIS_TARGET_ID, REG_DIS_BATTERY, 2);
  }

  async readDisRange() {
    return await this.readRegister(DIS_TARGET_ID, REG_RANGE, 2);
  }

  async readDisOdometer() {
    return await this.readRegister(DIS_TARGET_ID, REG_ODOMETER, 4);
  }

  async readDisSerial() {
    return await this.readRegister(DIS_TARGET_ID, REG_SERIAL, 14);
  }

  async readBlePassword(target = selectedControlTargetId) {
    return await this.readRegister(target, REG_BLE_PASSWORD, 6);
  }

  async readBleVersion(target = BLE_TARGET_ID) {
    return await this.readRegister(target, REG_BLE_VERSION, 2);
  }

  async readGattDeviceInfo() {
    if (!this.server?.connected) {
      addLog("BLE device info skipped: not connected");
      return null;
    }
    const info = {};
    try {
      const service = await this.server.getPrimaryService(DEVICE_INFO_SERVICE);
      const decoder = new TextDecoder();
      for (const [label, uuid] of DEVICE_INFO_CHARACTERISTICS) {
        try {
          const characteristic = await service.getCharacteristic(uuid);
          const value = await characteristic.readValue();
          const text = decoder.decode(value.buffer).replace(/\0/g, "").trim();
          info[label] = text;
          addLog(`BLE info ${label}: ${text || "-"}`);
        } catch (error) {
          addLog(`BLE info ${label}: unavailable`);
        }
      }
      this.deviceInfo = info;
      return info;
    } catch (error) {
      addLog(`BLE device info unavailable: ${error?.message || error}`);
      this.deviceInfo = info;
      return info;
    }
  }

  async logGattOverview() {
    if (!this.server?.connected) {
      addLog("GATT overview skipped: not connected");
      return;
    }
    try {
      const services = await this.server.getPrimaryServices();
      addLog(`GATT services visible: ${services.length}`);
      for (const service of services) {
        try {
          const characteristics = await service.getCharacteristics();
          addLog(`GATT service ${service.uuid} chars=${characteristics.length}`);
          for (const characteristic of characteristics) {
            addLog(
              `  char ${characteristic.uuid} props ${formatCharacteristicProps(characteristic)}`
            );
          }
        } catch (error) {
          addLog(`GATT service ${service.uuid} chars unavailable`);
        }
      }
    } catch (error) {
      addLog(`GATT overview failed: ${error?.message || error}`);
    }
  }

  async readRegister(target, index, size) {
    const frame = this._buildFrame(target, CMD_READ, index, [size & 0xff]);
    await this._sendBytes(frame);
    return true;
  }

  async readRegisterNoSize(target, index) {
    const frame = this._buildFrame(target, CMD_READ, index, []);
    await this._sendBytes(frame);
    return true;
  }

  async writeRegisterNR(target, index, payload = []) {
    const frame = this._buildFrame(target, CMD_WRITE_NR, index, payload);
    await this._sendBytes(frame);
    return true;
  }

  async sendCommand(target, cmd, index = 0, payload = []) {
    const frame = this._buildFrame(target, cmd, index, payload);
    await this._sendBytes(frame);
    return true;
  }

  async sendRawBytes(bytes) {
    await this._sendBytes(bytes);
    return true;
  }

  async sendRawBytesChunked(bytes, chunkSize = 20, delayMs = 20) {
    const data = Array.from(bytes || []);
    for (let offset = 0; offset < data.length; offset += chunkSize) {
      await this._sendBytes(data.slice(offset, offset + chunkSize));
      if (offset + chunkSize < data.length) await sleep(delayMs);
    }
    return true;
  }

  async sendEncryptedPreComm(gen = "gen2", nameOverride = null, cryptoVariant = {}) {
    const keyName = nameOverride == null ? this.device?.name || "" : String(nameOverride);
    const frame = await buildEncryptedPreCommFrame(keyName, gen, cryptoVariant);
    addLog(
      `PRE_COMM ${gen}/${cryptoVariant.label || "default"} src=0x${toHexByte(cryptoVariant.source ?? 0x3e)} dst=0x${toHexByte(cryptoVariant.target ?? BLE_TARGET_ID)} keyName="${keyName}" bytes=${formatBytes(frame)}`
    );
    await this._sendBytes(frame);
    return true;
  }

  async refreshNotifications() {
    if (!this.notifyCharacteristic?.startNotifications) {
      addLog("notification refresh skipped: notify characteristic unavailable");
      return false;
    }
    try {
      this.notifyCharacteristic.removeEventListener(
        "characteristicvaluechanged",
        this._boundNotify
      );
      if (typeof this.notifyCharacteristic.stopNotifications === "function") {
        await this.notifyCharacteristic.stopNotifications();
        await sleep(300);
      }
      await this.notifyCharacteristic.startNotifications();
      this.notifyCharacteristic.addEventListener(
        "characteristicvaluechanged",
        this._boundNotify
      );
      addLog("notification subscription refreshed");
      return true;
    } catch (error) {
      addLog(`notification refresh failed: ${error?.message || error}`);
      return false;
    }
  }

  setActiveWriteChannel(channelId) {
    if (!channelId) return false;
    const match = this.writeChannels.find((entry) => entry.id === channelId);
    if (!match) return false;
    this.activeWriteChannelId = match.id;
    return true;
  }

  getActiveWriteChannel() {
    return this._getActiveWriteChannel();
  }

  async _connectDevice(device) {
    this.device = device;
    this.device.addEventListener("gattserverdisconnected", this._boundDisconnect);
    this._emitState(`connecting ${device?.name || "device"}`);
    this.server = await device.gatt.connect();

    let found = null;
    for (const profile of SERVICE_PROFILES) {
      try {
        const service = await this.server.getPrimaryService(profile.service);
        const writeCharacteristic = await service.getCharacteristic(profile.write);
        const notifyCharacteristic = await service.getCharacteristic(profile.notify);
        found = {
          profile,
          service,
          writeCharacteristic,
          notifyCharacteristic,
        };
        break;
      } catch {}
    }

    if (!found) {
      throw new Error("Could not find a supported Ninebot BLE service");
    }

    this.profile = found.profile;
    this.service = found.service;
    this.writeCharacteristic = found.writeCharacteristic;
    this.notifyCharacteristic = found.notifyCharacteristic;
    const characteristics = await this.service.getCharacteristics();
    this.writeChannels = this._buildWriteChannels(
      characteristics,
      found.writeCharacteristic,
      found.notifyCharacteristic
    );
    this.activeWriteChannelId = this.writeChannels[0]?.id || "";

    if (this.notifyCharacteristic?.startNotifications) {
      await this.notifyCharacteristic.startNotifications();
      this.notifyCharacteristic.addEventListener(
        "characteristicvaluechanged",
        this._boundNotify
      );
      addLog(`notifications enabled ${this.notifyCharacteristic.uuid}`);
    }

    this.connected = true;
    this.remoteEnabled = false;
    this._emitState(`connected via ${this.profile.name}`);
    addLog(
      `write ${this.writeCharacteristic.uuid} props ${formatCharacteristicProps(this.writeCharacteristic)}`
    );
    addLog(
      `write channels ${this.writeChannels.map((entry) => `${entry.label}:${entry.uuid}`).join(", ") || "-"}`
    );
    addLog(
      `notify ${this.notifyCharacteristic.uuid} props ${formatCharacteristicProps(this.notifyCharacteristic)}`
    );
    await this.readGattDeviceInfo();
  }

  async _sendBytes(bytes) {
    this._ensureConnected();
    const activeWriteCharacteristic = this._getActiveWriteCharacteristic();
    if (!activeWriteCharacteristic) {
      throw new Error("No active write characteristic");
    }
    const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.lastTxHex = this._bytesToHex(payload);
    this.recentTxHex.push(this.lastTxHex);
    this.recentTxHex = this.recentTxHex.slice(-24);
    addLog(`TX ${this.lastTxHex}`);

    this._writeQueue = this._writeQueue.then(async () => {
      if (
        writeMode === "no-response" &&
        typeof activeWriteCharacteristic.writeValueWithoutResponse === "function"
      ) {
        await activeWriteCharacteristic.writeValueWithoutResponse(payload);
      } else if (typeof activeWriteCharacteristic.writeValueWithResponse === "function") {
        await activeWriteCharacteristic.writeValueWithResponse(payload);
      } else if (typeof activeWriteCharacteristic.writeValue === "function") {
        await activeWriteCharacteristic.writeValue(payload);
      } else if (typeof activeWriteCharacteristic.writeValueWithoutResponse === "function") {
        await activeWriteCharacteristic.writeValueWithoutResponse(payload);
      } else {
        throw new Error("write characteristic has no supported write method");
      }
    });
    return await this._writeQueue;
  }

  _handleNotify(event) {
    const data = new Uint8Array(event.target.value.buffer.slice(0));
    this.lastNotifyHex = this._bytesToHex(data);
    const isEcho = this._isRecentTxHex(this.lastNotifyHex);
    if (isEcho) this.echoFrameCount += 1;
    addLog(`${isEcho ? "ECHO" : "NOTIFY"} ${this.lastNotifyHex}`);
    emitRawNotifyObservers({
      bytes: Array.from(data),
      hex: this.lastNotifyHex,
      isEcho,
    });
    for (const value of data) this.rxBuffer.push(value);
    this._parseFrames();
  }

  _parseFrames() {
    while (this.rxBuffer.length >= 8) {
      if (this.rxBuffer[0] === 0x55 && this.rxBuffer[1] === 0xaa) {
        if (!this._parseProtocol1Frame()) return;
        continue;
      }
      if (this.rxBuffer[0] === 0x5a && this.rxBuffer[1] === 0xa5) {
        if (!this._parseProtocol2Frame()) return;
        continue;
      }
      const dropped = this.rxBuffer.shift();
      addLog(`RX drop stray byte ${toHexByte(dropped)}`);
    }
  }

  _parseProtocol1Frame() {
    const length = this.rxBuffer[2];
    let frameLength = length + 6;
    if (this.rxBuffer.length < frameLength && this.rxBuffer.length >= length + 5) {
      frameLength = length + 5;
    }
    if (this.rxBuffer.length < frameLength) return false;
    const frame = this.rxBuffer.splice(0, frameLength);
    const checksum = (frame[frameLength - 1] << 8) | frame[frameLength - 2];
    const expected = this._protocolChecksum(frame.slice(2, frameLength - 2), 0xffff);
    if (checksum !== expected) {
      addLog(
        `RX P1 checksum mismatch got=${checksum.toString(16)} expected=${expected.toString(16)}`
      );
    }

    const target = frame[3];
    const cmd = frame[4];
    const index = frame[5];
    const payload = frame.slice(6, frameLength - 2);
    this._emitFrame("P1", { target, cmd, index, payload, frame });
    return true;
  }

  _parseProtocol2Frame() {
    const length = this.rxBuffer[2];
    const encryptedFrameLength = length + 13;
    if (this.rxBuffer.length >= encryptedFrameLength) {
      const frame = this.rxBuffer.splice(0, encryptedFrameLength);
      this._emitEncryptedFrame(frame);
      return true;
    }
    const frameLength = length + 9;
    if (this.rxBuffer.length < frameLength) return false;
    const frame = this.rxBuffer.splice(0, frameLength);
    const checksum = (frame[frameLength - 1] << 8) | frame[frameLength - 2];
    const expected = this._protocolChecksum(frame.slice(2, frameLength - 2));
    if (checksum !== expected) {
      addLog(
        `RX P2 checksum mismatch got=${checksum.toString(16)} expected=${expected.toString(16)}`
      );
    }

    const btId = frame[3];
    const target = frame[4];
    const cmd = frame[5];
    const index = frame[6];
    const payload = frame.slice(7, frameLength - 2);
    if (btId !== 0x3e) addLog(`RX P2 unexpected BT_ID 0x${toHexByte(btId)}`);
    this._emitFrame("P2", { target, cmd, index, payload, frame });
    return true;
  }

  _emitEncryptedFrame(frame) {
    this.lastRxHex = this._bytesToHex(frame);
    const isEcho = this._isRecentTxHex(this.lastRxHex);
    this.rxFrameCount += 1;
    if (!isEcho) this.realRxFrameCount += 1;
    addLog(`RX ENC2${isEcho ? " ECHO" : ""} ${this.lastRxHex}`);
    if (typeof this.onFrame === "function") {
      this.onFrame({
        target: null,
        cmd: null,
        index: null,
        payload: frame.slice(3, -6),
        frame,
        protocol: "ENC2",
        isEcho,
      });
    }
  }

  _emitFrame(protocol, parsed) {
    const { target, cmd, index, payload, frame } = parsed;
    this.lastRxHex = this._bytesToHex(frame);
    const isEcho = this._isRecentTxHex(this.lastRxHex);
    this.rxFrameCount += 1;
    if (!isEcho) this.realRxFrameCount += 1;
    addLog(`RX ${protocol}${isEcho ? " ECHO" : ""} ${this.lastRxHex}`);

    if (index === REG_REMOTE_INFO) this.lastRemoteInfo = payload.slice();
    if (typeof this.onFrame === "function") {
      this.onFrame({ target, cmd, index, payload, frame, protocol, isEcho });
    }
  }

  _isRecentTxHex(hex) {
    return !!hex && Array.isArray(this.recentTxHex) && this.recentTxHex.includes(hex);
  }

  _buildFrame(target, cmd, index, payload = []) {
    if (protocolMode === 3) {
      return this._buildProtocol2Frame(target, cmd, index, payload, {
        lengthOverride: cmd === CMD_READ ? payload[0] : null,
      });
    }
    if (protocolMode === 4) {
      return this._buildProtocol1Frame(target, cmd, index, payload, {
        lengthIncludesIndex: true,
      });
    }
    if (protocolMode === 5) {
      return this._buildProtocol1Frame(target, cmd, index, payload, {
        lengthIncludesIndex: true,
        checksumMask: 0xffff,
      });
    }
    if (protocolMode === 6) {
      return this._buildProtocol1Frame(target, cmd, index, payload, {
        checksumMask: 0xffff,
      });
    }
    if (protocolMode === 7) {
      return this._buildProtocol1Frame(target, cmd, index, payload, {
        checksumMask: 0x7fff,
      });
    }
    return protocolMode === 2
      ? this._buildProtocol2Frame(target, cmd, index, payload)
      : this._buildProtocol1Frame(target, cmd, index, payload);
  }

  _buildProtocol1Frame(target, cmd, index, payload = [], options = {}) {
    const length = payload.length + (options.lengthIncludesIndex ? 3 : 2);
    const body = [length & 0xff, target & 0xff, cmd & 0xff, index & 0xff, ...payload];
    const checksum = this._protocolChecksum(body, options.checksumMask || 0xffff);
    return new Uint8Array([0x55, 0xaa, ...body, checksum & 0xff, (checksum >> 8) & 0xff]);
  }

  _buildProtocol2Frame(target, cmd, index, payload = [], options = {}) {
    const length = Number.isFinite(options.lengthOverride)
      ? options.lengthOverride & 0xff
      : payload.length;
    const body = [length, 0x3e, target & 0xff, cmd & 0xff, index & 0xff, ...payload];
    const checksum = this._protocolChecksum(body);
    return new Uint8Array([0x5a, 0xa5, ...body, checksum & 0xff, (checksum >> 8) & 0xff]);
  }

  _protocolChecksum(bytes, mask = 0x7fff) {
    let total = 0;
    for (const value of bytes) total += value & 0xff;
    return (~total) & mask;
  }

  _buildWriteChannels(characteristics, primaryWriteCharacteristic, notifyCharacteristic) {
    const channels = [];
    const seen = new Set();
    const pushChannel = (label, characteristic) => {
      if (!characteristic?.uuid || seen.has(characteristic.uuid)) return;
      seen.add(characteristic.uuid);
      channels.push({
        id: label,
        label,
        uuid: characteristic.uuid,
        characteristic,
      });
    };
    pushChannel("write-0002", primaryWriteCharacteristic);
    for (const characteristic of characteristics || []) {
      if (!characteristic?.uuid || characteristic.uuid === notifyCharacteristic?.uuid) continue;
      if (!characteristic.properties?.write && !characteristic.properties?.writeWithoutResponse) {
        continue;
      }
      const shortUuid = shortUuidLabel(characteristic.uuid);
      const label =
        characteristic.uuid === primaryWriteCharacteristic?.uuid
          ? "write-0002"
          : shortUuid === "0003"
            ? "rctp-0003"
            : shortUuid === "0005"
              ? "test-0005"
              : `write-${shortUuid}`;
      pushChannel(label, characteristic);
    }
    return channels;
  }

  _getActiveWriteChannel() {
    return (
      this.writeChannels.find((entry) => entry.id === this.activeWriteChannelId) ||
      this.writeChannels[0] ||
      null
    );
  }

  _getActiveWriteCharacteristic() {
    return this._getActiveWriteChannel()?.characteristic || this.writeCharacteristic;
  }

  /*
  _parseFramesOld() {
    while (this.rxBuffer.length >= 8) {
      if (!(this.rxBuffer[0] === 0x55 && this.rxBuffer[1] === 0xaa)) {
        this.rxBuffer.shift();
        continue;
      }
      const length = this.rxBuffer[2];
      const frameLength = length + 6;
      if (this.rxBuffer.length < frameLength) return;
      const frame = this.rxBuffer.splice(0, frameLength);
      const checksum = (frame[frameLength - 1] << 8) | frame[frameLength - 2];
      const expected = this._protocol1Checksum(frame.slice(2, frameLength - 2));
      if (checksum !== expected) {
        addLog(
          `RX checksum mismatch got=${checksum.toString(16)} expected=${expected.toString(16)}`
        );
      }

      const target = frame[3];
      const cmd = frame[4];
      const index = frame[5];
      const payload = frame.slice(6, frameLength - 2);

      this.lastRxHex = this._bytesToHex(frame);
      addLog(`RX ${this.lastRxHex}`);

      if (index === REG_REMOTE_INFO) this.lastRemoteInfo = payload.slice();
      if (typeof this.onFrame === "function") {
        this.onFrame({ target, cmd, index, payload, frame });
      }
    }
  }
  */

  _toSignedByte(value) {
    const clipped = Math.max(-127, Math.min(127, Math.round(value)));
    return clipped < 0 ? 256 + clipped : clipped;
  }

  _u16le(value) {
    return [value & 0xff, (value >> 8) & 0xff];
  }

  _i16le(value) {
    const clipped = Math.max(-32767, Math.min(32767, Math.round(Number(value) || 0)));
    const word = clipped < 0 ? 0x10000 + clipped : clipped;
    return [word & 0xff, (word >> 8) & 0xff];
  }

  _raw16le(value) {
    const word = Math.round(Number(value) || 0) & 0xffff;
    return [word & 0xff, (word >> 8) & 0xff];
  }

  _remoteCommandWord(value) {
    return Math.max(-32767, Math.min(32767, Math.round(Number(value) || 0)));
  }

  _remoteSpeedPayload(forward, steer) {
    const deviceSteer = -steer;
    const speedByte = this._toSignedByte(forward / REMOTE_COMMAND_WORD_STEP);
    const turnByte = this._toSignedByte(deviceSteer / REMOTE_COMMAND_WORD_STEP);
    const pitchWord = this._remoteCommandWord(forward);
    const turnWord = this._remoteCommandWord(deviceSteer);
    if (!ALLOW_EXTENDED_REMOTE_SPEED_PAYLOADS) {
      return remotePayloadMode === "p1-i16-turn-speed"
        ? [...this._i16le(turnWord), ...this._i16le(pitchWord)]
        : [...this._i16le(pitchWord), ...this._i16le(turnWord)];
    }
    const forwardWord = this._remoteCommandWord(forward);
    const zeroWord = 0;
    const reverseWord = this._remoteCommandWord(-Math.abs(forward));
    const reverseProbeWord = this._remoteCommandWord(Math.abs(forward));

    if (forward < 0 && remotePayloadMode === "p1-i16-speed-turn-zero") {
      if (reversePayloadMode === "positive-forward") {
        return [...this._i16le(reverseProbeWord), ...this._i16le(turnWord), ...this._i16le(zeroWord)];
      }
      if (reversePayloadMode === "third-word-negative") {
        return [...this._i16le(zeroWord), ...this._i16le(turnWord), ...this._i16le(reverseWord)];
      }
      if (reversePayloadMode === "third-word-positive") {
        return [...this._i16le(zeroWord), ...this._i16le(turnWord), ...this._i16le(reverseProbeWord)];
      }
    }

    if (remotePayloadMode === "hybrid-2b-drive-4b-turn") {
      // Replay the known forward-moving 2B command for straight drive; use 4B for clean yaw.
      if (!steer) return [0, speedByte];
      return [...this._i16le(pitchWord), ...this._i16le(turnWord)];
    }
    if (remotePayloadMode === "p1-i16-pitch-turn-forward") {
      return [...this._i16le(pitchWord), ...this._i16le(turnWord), ...this._i16le(forwardWord)];
    }
    if (remotePayloadMode === "p1-i16-zero-turn-forward") {
      return [...this._i16le(zeroWord), ...this._i16le(turnWord), ...this._i16le(forwardWord)];
    }
    if (remotePayloadMode === "p1-3b-turn-speed-zero") {
      return [turnByte, speedByte, 0];
    }
    if (remotePayloadMode === "p1-3b-speed-turn-zero") {
      return [speedByte, turnByte, 0];
    }
    if (remotePayloadMode === "p1-3b-zero-turn-speed") {
      return [0, turnByte, speedByte];
    }
    if (remotePayloadMode === "p1-i16-speed-turn") {
      // Word 0 behaves as pitch/lean on the balancing board; word 1 is clean yaw/turn.
      return [...this._i16le(pitchWord), ...this._i16le(turnWord)];
    }
    if (remotePayloadMode === "p1-i16-turn-speed") {
      // Experimental inverse mapping. Your hardware turns when "forward" lands in word 0.
      return [...this._i16le(turnWord), ...this._i16le(pitchWord)];
    }
    if (remotePayloadMode === "p1-i16-speed-turn-zero") {
      return [...this._i16le(pitchWord), ...this._i16le(turnWord), ...this._i16le(zeroWord)];
    }
    if (remotePayloadMode === "p1-i16-speed-zero-turn") {
      return [...this._i16le(pitchWord), ...this._i16le(zeroWord), ...this._i16le(turnWord)];
    }
    if (remotePayloadMode === "p1-i16-zero-speed-turn") {
      return [...this._i16le(zeroWord), ...this._i16le(pitchWord), ...this._i16le(turnWord)];
    }
    if (remotePayloadMode === "p1-i16-turn-speed-zero") {
      return [...this._i16le(turnWord), ...this._i16le(pitchWord), ...this._i16le(zeroWord)];
    }
    if (remotePayloadMode === "p1-speed-turn") {
      return [speedByte, turnByte];
    }
    // Generated Ninebot-S docs and the official app capture both match 2B writes:
    // byte 0 = turn, byte 1 = forward/back, signed as two's complement.
    return [turnByte, speedByte];
  }

  _bytesToHex(bytes) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(" ");
  }

  _ensureConnected() {
    if (!this.connected || !this._getActiveWriteCharacteristic()) {
      throw new Error("Ninebot is not connected");
    }
  }

  _handleDisconnect() {
    this.connected = false;
    this.remoteEnabled = false;
    const probeContext = activeBeepProbeLabel ? ` during ${activeBeepProbeLabel}` : "";
    const txContext = this.lastTxHex ? ` lastTX=${this.lastTxHex}` : "";
    this._emitState(`device disconnected${probeContext}${txContext}`);
  }

  _emitState(text) {
    if (typeof this.onState === "function") this.onState(String(text || ""));
  }
}

function addLog(text) {
  logLines.push(`[${new Date().toLocaleTimeString("en-GB", { hour12: false })}] ${text}`);
  logLines = logLines.slice(-LOG_LIMIT);
  if (consoleEl) {
    consoleEl.html(logLines.join("\n"));
    consoleEl.elt.scrollTop = consoleEl.elt.scrollHeight;
  }
  refreshDebugInfo();
  print(text);
}

class GamepadController {
  constructor() {
    this.enabled = true;
    this.index = null;
    this.id = "";
    this.lastConnected = false;
    this.lastVector = null;
  }

  install() {
    window.addEventListener("gamepadconnected", (event) => {
      this.index = event.gamepad.index;
      this.id = event.gamepad.id || `Gamepad ${event.gamepad.index}`;
      this.lastConnected = true;
      addLog(`gamepad connected: ${this.id}`);
      refreshDebugInfo();
    });
    window.addEventListener("gamepaddisconnected", (event) => {
      if (this.index === event.gamepad.index) {
        this.index = null;
        this.lastVector = null;
      }
      this.lastConnected = false;
      addLog(`gamepad disconnected: ${event.gamepad.id || event.gamepad.index}`);
      refreshDebugInfo();
    });
  }

  get label() {
    return this.id || (this.connected ? "gamepad" : "-");
  }

  get connected() {
    return !!this._currentGamepad();
  }

  pollVector() {
    if (!this.enabled) return null;
    const gamepad = this._currentGamepad();
    if (!gamepad) {
      this.lastVector = null;
      return null;
    }

    this.id = gamepad.id || this.id || `Gamepad ${gamepad.index}`;
    const leftX = this._axis(gamepad, 0);
    const leftY = this._axis(gamepad, 1);
    const rightX = this._axis(gamepad, 2);
    const triggerReverse = this._button(gamepad, 6);
    const triggerForward = this._button(gamepad, 7);
    const dpadX = this._button(gamepad, 15) - this._button(gamepad, 14);
    const dpadY = this._button(gamepad, 13) - this._button(gamepad, 12);

    let driveUnit = this._shape(-leftY);
    let steerUnit = this._shape(leftX);
    if (!steerUnit) steerUnit = this._shape(rightX);
    const triggerDrive = triggerForward - triggerReverse;
    if (Math.abs(triggerDrive) > Math.abs(driveUnit)) driveUnit = this._shape(triggerDrive);
    if (!driveUnit && dpadY) driveUnit = -Math.sign(dpadY);
    if (!steerUnit && dpadX) steerUnit = Math.sign(dpadX);

    const vector = this._unitsToVector(driveUnit, steerUnit);
    this.lastVector = vector;
    return vector;
  }

  _currentGamepad() {
    const gamepads = navigator.getGamepads?.();
    if (!gamepads) return null;
    if (this.index != null && gamepads[this.index]?.connected) return gamepads[this.index];
    const first = Array.from(gamepads).find((entry) => entry?.connected);
    if (!first) return null;
    this.index = first.index;
    this.id = first.id || `Gamepad ${first.index}`;
    return first;
  }

  _axis(gamepad, index) {
    return Number(gamepad.axes?.[index] || 0);
  }

  _button(gamepad, index) {
    return Number(gamepad.buttons?.[index]?.value || 0);
  }

  _shape(value) {
    const clipped = Math.max(-1, Math.min(1, Number(value) || 0));
    const absValue = Math.abs(clipped);
    if (absValue < GAMEPAD_DEADZONE) return 0;
    const normalized = (absValue - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE);
    return Math.sign(clipped) * Math.pow(normalized, GAMEPAD_ANALOG_CURVE);
  }

  _unitsToVector(driveUnit, steerUnit) {
    const drive = driveUnit >= 0
      ? driveUnit * forwardByte
      : driveUnit * backwardByte;
    const steer = steerUnit * steerByte;
    const x = Math.round(drive);
    const y = Math.round(steer);
    if (!x && !y) return null;
    return { x, y, source: "gamepad" };
  }
}

function installKeyboardControlTracker() {
  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const keyName = String(event.key || "").toLowerCase();
    if (!KEYBOARD_CONTROL_KEYS.has(keyName)) return;
    pressedControlKeys.add(keyName);
    event.preventDefault();
  });
  window.addEventListener("keyup", (event) => {
    const keyName = String(event.key || "").toLowerCase();
    if (KEYBOARD_CONTROL_KEYS.has(keyName)) pressedControlKeys.delete(keyName);
  });
  window.addEventListener("blur", () => {
    pressedControlKeys.clear();
  });
}

async function setup() {
  buildUi();
  createCanvasInHost();
  observeCanvasHost();
  requestAnimationFrame(resizeCanvasToHost);
  textFont("Helvetica");
  installKeyboardControlTracker();
  gamepadController = new GamepadController();
  gamepadController.install();
  remote = new NinebotBleRemote();
  remote.onState = (text) => addLog(text);
  remote.onFrame = (frame) => {
    emitFrameObservers(frame);
    if (frame.isEcho) {
      addLog(
        `echo frame target=0x${toHexByte(frame.target)} cmd=0x${toHexByte(frame.cmd)} idx=0x${toHexByte(frame.index)}`
      );
      return;
    }
    if (isShutdownStateBroadcast(frame)) {
      addLog(
        `shutdown/state broadcast target=0x${toHexByte(frame.target)} cmd=0x${toHexByte(frame.cmd)} idx=0x${toHexByte(frame.index)}`
      );
    } else if (frame.protocol === "ENC2") {
      addLog(`encrypted/auth frame payload=${formatBytes(frame.payload) || "-"}`);
    } else if (frame.index === REG_REMOTE_INFO) {
      addLog(`remote info payload ${formatBytes(frame.payload)}`);
    } else if (isReadReplyCommand(frame.cmd) && frame.index === REG_SERIAL) {
      addLog(`serial target=0x${toHexByte(frame.target)} "${asciiFromBytes(frame.payload)}"`);
    } else if (isReadReplyCommand(frame.cmd) && frame.index === REG_RANGE) {
      addLog(`range target=0x${toHexByte(frame.target)} ${u16le(frame.payload)} x0.1km`);
    } else if (isReadReplyCommand(frame.cmd) && frame.index === REG_ODOMETER) {
      addLog(`odometer target=0x${toHexByte(frame.target)} ${u32le(frame.payload)} x0.001km`);
    } else if (frame.target === DIS_TARGET_ID && isReadReplyCommand(frame.cmd) && frame.index === REG_DIS_BATTERY) {
      addLog(`battery ${u16le(frame.payload)} raw`);
    } else if (frame.index === REG_BLE_VERSION || frame.index === REG_CTRL_VERSION || frame.index === REG_BMS_VERSION) {
      addLog(
        `version idx=0x${toHexByte(frame.index)} target=0x${toHexByte(frame.target)} value=${formatVersionPayload(frame.payload)} raw=${formatBytes(frame.payload)}`
      );
    } else if (frame.index === REG_CTRL_BATTERY) {
      addLog(`battery target=0x${toHexByte(frame.target)} ${u16le(frame.payload)} raw`);
    } else if (frame.index === REG_MAX_REMOTE_SPEED) {
      addLog(`max remote speed target=0x${toHexByte(frame.target)} ${(u16le(frame.payload) / 1000).toFixed(1)} km/h raw=${u16le(frame.payload)}`);
    } else if (frame.index === REG_LIMIT_SPEED) {
      addLog(`limit/mode target=0x${toHexByte(frame.target)} raw=${u16le(frame.payload)} bytes=${formatBytes(frame.payload)}`);
    } else if (frame.index === REG_BLE_PASSWORD) {
      addLog(`ble password target=0x${toHexByte(frame.target)} ${formatBytes(frame.payload)}`);
    } else {
      addLog(
        `frame ${frame.protocol || "?"} target=0x${toHexByte(frame.target)} cmd=0x${toHexByte(frame.cmd)} idx=0x${toHexByte(frame.index)} payload=${formatBytes(frame.payload) || "-"}`
      );
    }
  };
  refreshDebugInfo();
}

function draw() {
  background(9, 16, 19);
  hitRegions = [];
  drawRemoteButtons();
  updateHeldControl();
}

function buildUi() {
  shellEl = createDiv("");
  shellEl.class("nb-shell");

  adminEl = createDiv("");
  adminEl.class("nb-admin");
  adminEl.parent(shellEl);

  const title = createDiv("Ninebot Remote");
  title.class("nb-title");
  title.parent(adminEl);

  const subtitle = createDiv("4-byte RC control / safe max-speed recovery");
  subtitle.class("nb-subtitle");
  subtitle.parent(adminEl);

  statusEl = createDiv("Idle");
  statusEl.class("nb-status");
  statusEl.parent(adminEl);

  const section1 = createDiv("Connection");
  section1.class("nb-section");
  section1.parent(adminEl);
  buildButtonRow(adminEl, [
    ["Connect", async () => {
      try {
        await remote.connectWithPicker();
        seedAuthKeyFromDeviceName();
      } catch (error) {
        addLog(`connect failed: ${error?.message || error}`);
      }
    }],
    ["Disconnect", async () => {
      try {
        await remote.disconnect();
      } catch (error) {
        addLog(`disconnect failed: ${error?.message || error}`);
      }
    }],
    ["Enable RC", async () => {
      try {
        await armRemoteControl();
      } catch (error) {
        addLog(`enable failed: ${error?.message || error}`);
      }
    }],
    ["RC Off", safeRemoteOff],
  ]);

  const section2 = createDiv("Status");
  section2.class("nb-section");
  section2.parent(adminEl);
  buildButtonRow(adminEl, [
    ["Read Battery", async () => {
      try {
        await remote.readRegister(APP_DISCOVERED_BLE_TARGET_ID, REG_CTRL_BATTERY, 2);
      } catch (error) {
        addLog(`battery read failed: ${error?.message || error}`);
      }
    }],
    ["Read Max", readMaxRemoteSpeed],
  ]);

  const section4 = createDiv("Remote Params");
  section4.class("nb-section");
  section4.parent(adminEl);
  const drivePresetLabel = createDiv("Drive word");
  drivePresetLabel.class("nb-section");
  drivePresetLabel.parent(adminEl);
  buildButtonRow(adminEl, [
    ...REMOTE_COMMAND_PRESETS.map(([label, value]) => [
      label,
      () => setDriveCommandPreset(label, value),
    ]),
  ]);
  const turnPresetLabel = createDiv("Turn word");
  turnPresetLabel.class("nb-section");
  turnPresetLabel.parent(adminEl);
  buildButtonRow(adminEl, [
    ...REMOTE_COMMAND_PRESETS.map(([label, value]) => [
      label,
      () => setTurnCommandPreset(label, value),
    ]),
  ]);
  const maxPresetLabel = createDiv("Max RC speed");
  maxPresetLabel.class("nb-section");
  maxPresetLabel.parent(adminEl);
  buildButtonRow(adminEl, [
    ...MAX_REMOTE_SPEED_PRESETS.map(([label, raw]) => [
      label,
      () => setMaxRemoteSpeedPreset(label, raw),
    ]),
    ["Read Max", readMaxRemoteSpeed],
  ]);

  infoEl = createDiv("");
  infoEl.class("nb-info");
  infoEl.parent(adminEl);

  const consoleTitle = createDiv("Console");
  consoleTitle.class("nb-section");
  consoleTitle.parent(adminEl);

  buildButtonRow(adminEl, [
    ["Copy Console", copyConsoleLog],
  ]);

  consoleEl = createDiv("");
  consoleEl.class("nb-console");
  consoleEl.parent(adminEl);

  const mainEl = createDiv("");
  mainEl.class("nb-main");
  mainEl.parent(shellEl);

  toggleBtn = createButton("▸");
  toggleBtn.class("nb-toggle");
  toggleBtn.parent(mainEl);
  toggleBtn.mousePressed(() => {
    panelHidden = !panelHidden;
    applyPanelVisibility();
    requestAnimationFrame(() => {
      resizeCanvasToHost();
      requestAnimationFrame(resizeCanvasToHost);
    });
  });

  canvasHostEl = createDiv("");
  canvasHostEl.class("nb-canvas-host");
  canvasHostEl.parent(mainEl);

  applyPanelVisibility();
}

function buildButtonRow(parentEl, entries) {
  const row = createDiv("");
  row.class("nb-button-grid");
  row.parent(parentEl);
  for (const [label, handler] of entries) {
    const btn = createButton(label);
    btn.class("nb-btn");
    btn.parent(row);
    btn.mousePressed(() => {
      void handler();
    });
  }
}

async function copyConsoleLog() {
  const content = logLines.join("\n");
  try {
    await navigator.clipboard.writeText(content);
    addLog("console copied");
  } catch (error) {
    addLog(`copy console failed: ${error?.message || error}`);
  }
}

function markPhysicalBeep() {
  addLog(
    `BEEP MARK physical beep heard; active=${activeBeepProbeLabel || "-"} previousTX=${remote?.lastTxHex || "-"}`
  );
}

async function runBootPassiveListen() {
  addLog("boot listen: with no writes, power the Ninebot off/on during the next 90s");
  await runPassiveListen(90000, "boot passive listen");
}

async function runPassiveListen(durationMs = 60000, label = "passive listen") {
  if (!remote?.connected) {
    addLog(`${label} skipped: not connected`);
    return;
  }
  const previousBeepProbeLabel = activeBeepProbeLabel;
  activeBeepProbeLabel = label;
  const frames = [];
  const rawNotifications = [];
  const cleanup = addFrameObserver((frame) => {
    frames.push({
      target: frame.target,
      cmd: frame.cmd,
      index: frame.index,
      payload: Array.from(frame.payload || []),
      protocol: frame.protocol,
      isEcho: !!frame.isEcho,
    });
  });
  const cleanupRaw = addRawNotifyObserver((notification) => {
    rawNotifications.push({
      hex: notification.hex || formatBytes(notification.bytes || []),
      isEcho: !!notification.isEcho,
    });
  });
  try {
    addLog(`${label} start ${(durationMs / 1000).toFixed(0)}s; no writes will be sent`);
    await sleep(durationMs);
    const realFrames = frames.filter((frame) => !frame.isEcho);
    const counts = new Map();
    for (const frame of realFrames) {
      const key = frameSignature(frame);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    addLog(
      `${label} done raw=${rawNotifications.length} realFrames=${realFrames.length} echoFrames=${frames.length - realFrames.length}`
    );
    for (const [signature, count] of Array.from(counts.entries()).slice(0, 8)) {
      addLog(`${label} frame ${count}x ${signature}`);
    }
  } finally {
    cleanup();
    cleanupRaw();
    activeBeepProbeLabel = previousBeepProbeLabel;
  }
}

function frameSignature(frame) {
  return `${frame.protocol || "?"} target=0x${toHexByte(frame.target ?? 0)} cmd=0x${toHexByte(frame.cmd ?? 0)} idx=0x${toHexByte(frame.index ?? 0)} payload=${formatBytes(frame.payload) || "-"}`;
}

function seedAuthKeyFromDeviceName() {
  const rawName = String(remote?.device?.name || "");
  const cleanName = rawName.trim();
  if (!cleanName || !authKeyInputEl?.value) return "";
  if (!String(authKeyInputEl.value() || "").trim()) {
    authKeyInputEl.value(cleanName);
    addLog(`auth key auto-filled "${cleanName}"`);
    if (rawName !== cleanName) {
      addLog(`raw BLE name included whitespace; using trimmed auth key "${cleanName}"`);
    }
  }
  return String(authKeyInputEl.value() || "").trim();
}

function currentAuthKeyCandidates(limit = 2) {
  const manualName = String(authKeyInputEl?.value?.() || "").trim();
  const deviceName = String(remote?.device?.name || "").trim();
  return uniqueStrings([manualName, deviceName])
    .filter(Boolean)
    .slice(0, limit);
}

function applyPanelVisibility() {
  if (!shellEl?.elt || !adminEl?.elt) return;
  shellEl.elt.classList.toggle("is-panel-hidden", panelHidden);
  adminEl.elt.classList.toggle("is-hidden", panelHidden);
  if (toggleBtn) toggleBtn.html(panelHidden ? "◂" : "▸");
}

function createCanvasInHost() {
  const rect = canvasHostEl?.elt?.getBoundingClientRect?.() || {};
  const cw = Math.max(260, Math.floor(rect.width || windowWidth || 260));
  const ch = Math.max(260, Math.floor(rect.height || windowHeight || 260));
  canvas = createCanvas(cw, ch);
  if (canvasHostEl?.elt && canvas?.elt) {
    canvasHostEl.elt.appendChild(canvas.elt);
  }
  requestAnimationFrame(resizeCanvasToHost);
}

function resizeCanvasToHost() {
  if (!canvasHostEl?.elt || typeof resizeCanvas !== "function") return;
  const rect = canvasHostEl.elt.getBoundingClientRect();
  const cw = Math.max(260, Math.floor(rect.width || width || 260));
  const ch = Math.max(260, Math.floor(rect.height || height || 260));
  if (cw !== width || ch !== height) resizeCanvas(cw, ch);
}

function observeCanvasHost() {
  if (!canvasHostEl?.elt) return;
  if (canvasHostResizeObserver) return;
  if (typeof ResizeObserver === "undefined") return;

  canvasHostResizeObserver = new ResizeObserver(() => {
    resizeCanvasToHost();
  });
  canvasHostResizeObserver.observe(canvasHostEl.elt);
}

function refreshTargetButtons() {
  for (const entry of targetButtons) {
    entry.btn.elt.classList.toggle("is-active", entry.targetId === selectedControlTargetId);
  }
}

function refreshDebugInfo() {
  if (statusEl) {
    const status = remote?.connected
      ? `Connected: ${remote.device?.name || "Ninebot"}`
      : "Not connected";
    statusEl.html(status);
  }
  if (infoEl) {
    const lines = [
      `Device: ${remote?.device?.name || "-"}`,
      `Remote enabled: ${remote?.remoteEnabled ? "yes" : "no"}`,
      `Forward word: ${forwardByte}`,
      `Backward word: ${backwardByte}`,
      `Steer word: ${steerByte}`,
      `Payload: 4B forward16/turn16`,
      `Max remote speed: ${(maxRemoteSpeedRaw / 1000).toFixed(1)} km/h raw=${maxRemoteSpeedRaw}`,
      `Gamepad: ${gamepadController?.connected ? gamepadController.label : "-"}`,
      `Last event: ${logLines.at(-1) || "-"}`,
    ];
    infoEl.html(lines.join("\n"));
  }
  refreshTargetButtons();
}

function drawHeader() {
  noStroke();
  fill(235);
  textAlign(LEFT, TOP);
  textSize(34);
  text("Ninebot Remote", 28, 24);
  textSize(15);
  fill(160, 190, 198);
  text(
    "Protocol1 / 55 AA / ctrl target 0x20 assumption. Test unloaded first.",
    30,
    66
  );
}

function drawTransportCard() {
  const x = 28;
  const y = 100;
  const w = min(width * 0.42, 460);
  const h = 310;
  drawCard(x, y, w, h);

  fill(255);
  textSize(20);
  text("BLE Link", x + 18, y + 18);

  fill(170, 205, 210);
  textSize(14);
  textLeading(8);
  const status = remote?.connected
    ? `Connected: ${remote.device?.name || "device"}`
    : "Not connected";
  text(status, x + 18, y + 52);
  text(`Transport: ${remote?.profile?.name || "-"}`, x + 18, y + 76);
  text(`Control target: 0x${toHexByte(selectedControlTargetId)}`, x + 18, y + 100);
  text(`Remote enabled: ${remote?.remoteEnabled ? "yes" : "no"}`, x + 18, y + 124);
  text(`Last TX: ${remote?.lastTxHex || "-"}`, x + 18, y + 148, w - 36, 30);
  text(`Last notify: ${remote?.lastNotifyHex || "-"}`, x + 18, y + 184, w - 36, 34);
  text(`Last RX frame: ${remote?.lastRxHex || "-"}`, x + 18, y + 224, w - 36, 34);

  const upperButtonY = y + 236;
  const lowerButtonY = y + 272;

  drawActionButton("Test DIS", x + 18, upperButtonY, 94, 30, async () => {
    await runBasicCommTest();
  });
  drawActionButton("Read SN", x + 122, upperButtonY, 84, 30, async () => {
    try {
      await remote.readDisSerial();
    } catch (error) {
      addLog(`serial read failed: ${error?.message || error}`);
    }
  });
  drawActionButton("Read Range", x + 216, upperButtonY, 96, 30, async () => {
    try {
      await remote.readDisRange();
    } catch (error) {
      addLog(`range read failed: ${error?.message || error}`);
    }
  });
  drawActionButton("Read Odo", x + 322, upperButtonY, 82, 30, async () => {
    try {
      await remote.readDisOdometer();
    } catch (error) {
      addLog(`odometer read failed: ${error?.message || error}`);
    }
  });

  drawActionButton("Connect", x + 18, lowerButtonY, 104, 36, async () => {
    try {
      await remote.connectWithPicker();
    } catch (error) {
      addLog(`connect failed: ${error?.message || error}`);
    }
  });
  drawActionButton("Disconnect", x + 132, lowerButtonY, 104, 36, async () => {
    try {
      await remote.disconnect();
    } catch (error) {
      addLog(`disconnect failed: ${error?.message || error}`);
    }
  });
  drawActionButton("Enable RC", x + 246, lowerButtonY, 94, 36, async () => {
    try {
      await armRemoteControl();
    } catch (error) {
      addLog(`enable failed: ${error?.message || error}`);
    }
  });
  drawActionButton("RC Off", x + 350, lowerButtonY, 72, 36, safeRemoteOff);
}

function drawRemoteButtons() {
  const centerX = width * 0.5;
  const centerY = height * 0.44;
  const size = min(width, height) * 0.12;
  const gap = size * 0.12;
  const diagonalSize = size * 0.62;
  const diagonalOffset = size * 0.86;

  drawHoldButton("forward", centerX, centerY - size - gap, size, size, "▲", {
    x: forwardByte,
    y: 0,
  });
  drawHoldButton("forward-left", centerX - diagonalOffset, centerY - diagonalOffset, diagonalSize, diagonalSize, "↖", {
    x: forwardByte,
    y: -steerByte,
  });
  drawHoldButton("forward-right", centerX + diagonalOffset, centerY - diagonalOffset, diagonalSize, diagonalSize, "↗", {
    x: forwardByte,
    y: steerByte,
  });
  drawHoldButton("left", centerX - size - gap, centerY, size, size, "◀", {
    x: 0,
    y: -steerByte,
  });
  drawHoldButton("right", centerX + size + gap, centerY, size, size, "▶", {
    x: 0,
    y: steerByte,
  });
  drawHoldButton("back", centerX, centerY + size + gap, size, size, "▼", {
    x: -backwardByte,
    y: 0,
  });
  drawHoldButton("back-left", centerX - diagonalOffset, centerY + diagonalOffset, diagonalSize, diagonalSize, "↙", {
    x: -backwardByte,
    y: -steerByte,
  });
  drawHoldButton("back-right", centerX + diagonalOffset, centerY + diagonalOffset, diagonalSize, diagonalSize, "↘", {
    x: -backwardByte,
    y: steerByte,
  });
  drawHoldButton("halt", centerX, centerY, size * 0.94, size * 0.94, "■", {
    x: 0,
    y: 0,
  });

  fill(180, 216, 223);
  noStroke();
  textAlign(CENTER, CENTER);
  textSize(18);
  text("Hold buttons or use arrow keys / WASD.", centerX, centerY + size * 2.2);
  textSize(14);
  fill(126, 162, 170);
  text(
    `4B RC payload  •  F/R/T [${forwardByte},${backwardByte},${steerByte}]  •  max ${(maxRemoteSpeedRaw / 1000).toFixed(1)} km/h`,
    centerX,
    centerY + size * 2.65
  );
}

function adjustForwardByte(delta) {
  forwardByte = max(REMOTE_COMMAND_WORD_MIN, min(REMOTE_COMMAND_WORD_MAX, forwardByte + delta));
  addLog(`forward word now ${forwardByte}`);
  refreshDebugInfo();
}

function adjustBackwardByte(delta) {
  backwardByte = max(REMOTE_COMMAND_WORD_MIN, min(REMOTE_COMMAND_WORD_MAX, backwardByte + delta));
  addLog(`backward word now ${backwardByte}`);
  refreshDebugInfo();
}

function adjustSteerByte(delta) {
  steerByte = max(REMOTE_COMMAND_WORD_MIN, min(REMOTE_COMMAND_WORD_MAX, steerByte + delta));
  addLog(`steer word now ${steerByte}`);
  refreshDebugInfo();
}

function setDriveCommandPreset(label, value) {
  const word = max(REMOTE_COMMAND_WORD_MIN, min(REMOTE_COMMAND_WORD_MAX, Math.round(value)));
  forwardByte = word;
  backwardByte = word;
  addLog(`drive preset ${label}: forward/reverse word=${word}`);
  refreshDebugInfo();
}

function setTurnCommandPreset(label, value) {
  const word = max(REMOTE_COMMAND_WORD_MIN, min(REMOTE_COMMAND_WORD_MAX, Math.round(value)));
  steerByte = word;
  addLog(`turn preset ${label}: turn word=${word}`);
  refreshDebugInfo();
}

function adjustStraightTurnBias(delta) {
  straightTurnBias = max(0, min(16, straightTurnBias + delta));
  addLog(`straight turn bias now ${straightTurnBias}`);
  refreshDebugInfo();
}

function remotePayloadModeLabel() {
  return REMOTE_PAYLOAD_MODE_LABELS[remotePayloadMode] || remotePayloadMode;
}

function reversePayloadModeLabel() {
  return REVERSE_PAYLOAD_MODE_LABELS[reversePayloadMode] || reversePayloadMode;
}

function cycleRemotePayloadMode() {
  const modes = ALLOW_EXTENDED_REMOTE_SPEED_PAYLOADS
    ? REMOTE_PAYLOAD_MODES
    : SAFE_REMOTE_PAYLOAD_MODES;
  const currentIndex = modes.indexOf(remotePayloadMode);
  const nextIndex = (currentIndex + 1) % modes.length;
  remotePayloadMode = modes[nextIndex];
  if (remote) {
    remote.lastRemotePayloadHex = "";
    remote.lastRemotePayloadLogAt = 0;
  }
  addLog(`remote payload mode now ${remotePayloadModeLabel()}`);
  refreshDebugInfo();
}

function cycleReversePayloadMode() {
  const currentIndex = REVERSE_PAYLOAD_MODES.indexOf(reversePayloadMode);
  const nextIndex = (currentIndex + 1) % REVERSE_PAYLOAD_MODES.length;
  reversePayloadMode = REVERSE_PAYLOAD_MODES[nextIndex];
  if (remote) {
    remote.lastRemotePayloadHex = "";
    remote.lastRemotePayloadLogAt = 0;
  }
  addLog(`reverse payload mode now ${reversePayloadModeLabel()}`);
  refreshDebugInfo();
}

async function adjustMaxRemoteSpeedRaw(delta) {
  maxRemoteSpeedRaw = max(1000, min(10000, maxRemoteSpeedRaw + delta));
  addLog(`max remote speed value now ${(maxRemoteSpeedRaw / 1000).toFixed(1)} km/h raw=${maxRemoteSpeedRaw}; press Apply M to write 0x7D`);
  refreshDebugInfo();
}

async function setMaxRemoteSpeedPreset(label, rawValue) {
  maxRemoteSpeedRaw = max(1000, min(10000, Math.round(rawValue)));
  addLog(`max remote speed preset ${label}: raw=${maxRemoteSpeedRaw}`);
  refreshDebugInfo();
  if (remote?.connected) {
    await applyMaxRemoteSpeed();
  }
}

async function applyMaxRemoteSpeed() {
  if (!remote?.connected) {
    addLog("apply max remote speed skipped: not connected");
    return;
  }
  try {
    await remote.setMaxRemoteSpeed(maxRemoteSpeedRaw);
  } catch (error) {
    addLog(`max speed apply failed: ${error?.message || error}`);
  }
}

async function readMaxRemoteSpeed() {
  if (!remote?.connected) {
    addLog("read max remote speed skipped: not connected");
    return;
  }
  try {
    await remote.readMaxRemoteSpeed();
  } catch (error) {
    addLog(`max speed read failed: ${error?.message || error}`);
  }
}

async function readLimitModeState() {
  if (!remote?.connected) {
    addLog("read limit/mode skipped: not connected");
    return;
  }
  const previousTarget = selectedControlTargetId;
  try {
    selectedControlTargetId = APP_DISCOVERED_BLE_TARGET_ID;
    await remote.readLimitSpeed();
    await sleep(120);
    await remote.readRegister(DIS_TARGET_ID, REG_LIMIT_SPEED, 2);
  } catch (error) {
    addLog(`limit/mode read failed: ${error?.message || error}`);
  } finally {
    selectedControlTargetId = previousTarget;
    refreshDebugInfo();
  }
}

async function safeRemoteOff() {
  if (!remote?.connected) {
    addLog("RC off skipped: not connected");
    return;
  }
  const previousWriteMode = writeMode;
  const previousProtocolMode = protocolMode;
  const previousTarget = selectedControlTargetId;
  writeMode = "no-response";
  protocolMode = 1;
  selectedControlTargetId = APP_DISCOVERED_BLE_TARGET_ID;
  refreshDebugInfo();
  try {
    await remote.stopRemote();
    await sleep(160);
    await remote.enableRemoteControl(false);
    lastRemoteEnableAt = 0;
    addLog("RC off sent: stop + disable on target 0x0A");
  } catch (error) {
    addLog(`RC off failed: ${error?.message || error}`);
  } finally {
    selectedControlTargetId = previousTarget;
    writeMode = previousWriteMode;
    protocolMode = previousProtocolMode;
    refreshDebugInfo();
  }
}

async function armRemoteControl() {
  if (!remote?.connected) {
    addLog("enable skipped: not connected");
    return;
  }
  const previousWriteMode = writeMode;
  const previousProtocolMode = protocolMode;
  if (selectedControlTargetId !== APP_DISCOVERED_BLE_TARGET_ID) {
    selectedControlTargetId = APP_DISCOVERED_BLE_TARGET_ID;
    refreshTargetButtons();
  }
  writeMode = "no-response";
  protocolMode = 1;
  refreshDebugInfo();
  addLog(
    `arming RC on target 0x${toHexByte(selectedControlTargetId)}: stop -> disable -> enable; max speed is not auto-written`
  );
  try {
    await remote.stopRemote();
    await sleep(140);
    await remote.enableRemoteControl(false);
    await sleep(260);
    await remote.enableRemoteControl(true);
    lastRemoteEnableAt = millis();
  } finally {
    writeMode = previousWriteMode;
    protocolMode = previousProtocolMode;
    refreshDebugInfo();
  }
}

function drawTuningCard() {
  const w = min(width - 56, min(width * 0.42, 460));
  const x = 28;
  const y = 430;
  const h = 386;
  drawCard(x, y, w, h);

  fill(255);
  textSize(20);
  textAlign(LEFT, TOP);
  text("Remote Params", x + 18, y + 18);
  fill(172, 204, 212);
  textSize(14);
  textLeading(8);
  text(`Forward command word: ${forwardByte}`, x + 18, y + 54);
  text(`Backward command word: ${backwardByte}`, x + 18, y + 82);
  text(`Steer command word: ${steerByte}`, x + 18, y + 110);
  text(`Payload mode: ${remotePayloadModeLabel()}`, x + 18, y + 138);
  text(`Reverse map: ${reversePayloadModeLabel()}`, x + 18, y + 166);
  text(`Max remote speed: ${(maxRemoteSpeedRaw / 1000).toFixed(1)} km/h raw=${maxRemoteSpeedRaw}`, x + 18, y + 194);
  text(
    `Read target ids:\nSelected 0x${toHexByte(selectedControlTargetId)}  DIS 0x${toHexByte(DIS_TARGET_ID)}`,
    x + 18,
    y + 222,
    w - 36,
    34
  );

  text("Target test:", x + 18, y + 250);
  let tx = x + 98;
  for (const targetId of CANDIDATE_CONTROL_TARGETS) {
    const isSelected = selectedControlTargetId === targetId;
    drawActionButton(`0x${toHexByte(targetId)}`, tx, y + 242, 58, 28, () => {
      selectedControlTargetId = targetId;
      addLog(`selected control target 0x${toHexByte(targetId)}`);
    }, isSelected);
    tx += 64;
  }

  drawActionButton("Probe", x + 18, y + 274, 82, 30, async () => {
    await probeCandidateTargets();
  });
  drawActionButton("Enable All", x + 108, y + 274, 92, 30, async () => {
    await enableRemoteOnAllCandidates();
  });

  const row1 = [
    ["-F", 48, () => {
      adjustForwardByte(-REMOTE_COMMAND_WORD_STEP);
    }],
    ["+F", 48, () => {
      adjustForwardByte(REMOTE_COMMAND_WORD_STEP);
    }],
    ["-R", 48, () => {
      adjustBackwardByte(-REMOTE_COMMAND_WORD_STEP);
    }],
    ["+R", 48, () => {
      adjustBackwardByte(REMOTE_COMMAND_WORD_STEP);
    }],
    ["-T", 48, () => {
      adjustSteerByte(-REMOTE_COMMAND_WORD_STEP);
    }],
    ["+T", 48, () => {
      adjustSteerByte(REMOTE_COMMAND_WORD_STEP);
    }],
  ];
  const row2 = [
    ["-B", 48, () => {
      adjustStraightTurnBias(-1);
    }],
    ["+B", 48, () => {
      adjustStraightTurnBias(1);
    }],
    ["-M", 48, () => {
      adjustMaxRemoteSpeedRaw(-1000);
    }],
    ["+M", 48, () => {
      adjustMaxRemoteSpeedRaw(1000);
    }],
    ["Mode", 58, () => {
      cycleRemotePayloadMode();
    }],
    ["Rev", 48, () => {
      cycleReversePayloadMode();
    }],
    ["Read", 52, async () => {
      try {
        await remote.readRemoteInfo();
        await remote.readSpeed();
        await remote.readBattery();
      } catch (error) {
        addLog(`read failed: ${error?.message || error}`);
      }
    }],
  ];
  drawControlRow(row1, x + 18, y + 314, w - 36);
  drawControlRow(row2, x + 18, y + 352, w - 36);
}

function drawSpeedLimitCard() {
  const w = min(width - 56, min(width * 0.42, 460));
  const x = 28;
  const y = 830;
  const h = 136;
  drawCard(x, y, w, h);

  fill(255);
  textSize(20);
  textAlign(LEFT, TOP);
  text("Persistent State Checks", x + 18, y + 18);
  fill(172, 204, 212);
  textSize(14);
  textLeading(8);
  text("Read-only checks. 0x74 writes are disabled because they can affect ride mode/limits.", x + 18, y + 50, w - 36, 38);

  const buttons = [
    ["Read 0x74", 92, readLimitModeState],
    ["Read 0x7D", 92, readMaxRemoteSpeed],
    ["RC Off", 82, safeRemoteOff],
  ];
  const rowY = y + 78;
  const speedGap = max(4, floor((w - 36 - buttons.reduce((sum, entry) => sum + entry[1], 0)) / 4));
  let bx = x + 18;
  for (const [label, bw, action] of buttons) {
    drawActionButton(label, bx, rowY, bw, 34, action);
    bx += bw + speedGap;
  }
}

async function setDocumentedLimitSpeed(tenths) {
  addLog(`blocked 0x74 write request (${tenths}); use official app for ride/limit settings`);
}

function drawLogCard() {
  const x = width * 0.5;
  const y = height * 0.72;
  const w = width * 0.46;
  const h = height * 0.24;
  drawCard(x, y, w, h);
  fill(255);
  textSize(20);
  textAlign(LEFT, TOP);
  text("Console", x + 18, y + 16);
  fill(174, 204, 210);
  textSize(13);
  textLeading(7);
  const body = logLines.length ? logLines.join("\n") : "No BLE traffic yet.";
  text(body, x + 18, y + 48, w - 36, h - 64);
}

function drawCard(x, y, w, h) {
  noStroke();
  fill(17, 28, 32, 235);
  rect(x, y, w, h, 20);
  stroke(72, 104, 112, 140);
  noFill();
  rect(x, y, w, h, 20);
}

function drawControlRow(controls, x, y, availableWidth) {
  const totalButtonWidth = controls.reduce((sum, entry) => sum + entry[1], 0);
  const gap = controls.length > 1
    ? max(6, floor((availableWidth - totalButtonWidth) / (controls.length - 1)))
    : 0;
  let cx = x;
  for (const [label, bw, action] of controls) {
    drawActionButton(label, cx, y, bw, 32, action);
    cx += bw + gap;
  }
}

function drawActionButton(label, x, y, w, h, action) {
  return drawActionButtonWithState(label, x, y, w, h, action, false);
}

function drawActionButtonWithState(label, x, y, w, h, action, active = false) {
  const hovered = isInside(mouseX, mouseY, x, y, w, h);
  noStroke();
  fill(active ? color(92, 214, 120) : hovered ? color(56, 175, 156) : color(42, 126, 118));
  rect(x, y, w, h, BUTTON_RADIUS);
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(14);
  text(label, x + w * 0.5, y + h * 0.52);
  hitRegions.push({ type: "button", x, y, w, h, action });
}

function drawActionButton(label, x, y, w, h, action, active = false) {
  return drawActionButtonWithState(label, x, y, w, h, action, active);
}

function drawHoldButton(id, cx, cy, w, h, label, vector) {
  const x = cx - w * 0.5;
  const y = cy - h * 0.5;
  const isActive = activePointerControl === id || isKeyboardControlActive(id);
  noStroke();
  fill(isActive ? color(72, 222, 146) : color(36, 72, 78));
  rect(x, y, w, h, 24);
  fill(isActive ? 8 : 245);
  textAlign(CENTER, CENTER);
  textSize(w * 0.32);
  text(label, cx, cy + 2);
  hitRegions.push({ type: "hold", id, x, y, w, h, vector });
}

function updateHeldControl() {
  const active = getDesiredVector();
  if (!remote?.connected || !remote?.remoteEnabled) {
    currentVector = null;
    return;
  }

  const now = millis();
  const vectorChanged =
    !sameVector(active, currentVector) ||
    (!active && currentVector) ||
    (active && !currentVector);

  if (active) {
    if (now - lastRemoteEnableAt >= REMOTE_ENABLE_KEEPALIVE_MS) {
      sendRemoteEnableKeepalive();
      lastRemoteEnableAt = now;
    }
    if (vectorChanged || now - lastSendAt >= SEND_INTERVAL_MS) {
      sendRemoteVector(active);
      currentVector = { ...active };
      lastSendAt = now;
    }
  } else if (currentVector && (vectorChanged || now - lastSendAt >= SEND_INTERVAL_MS)) {
    sendRemoteVector({ x: 0, y: 0 });
    currentVector = null;
    lastSendAt = now;
  }
}

function getDesiredVector() {
  const keyVector = getKeyboardVector();
  if (keyVector) return keyVector;
  if (activePointerControl) {
    const region = hitRegions.find((entry) => entry.type === "hold" && entry.id === activePointerControl);
    if (region?.vector) return region.vector;
  }
  return gamepadController?.pollVector() || null;
}

function getKeyboardVector() {
  let drive = 0;
  let steer = 0;
  if (isControlKeyDown("arrowup", UP_ARROW, "w")) drive += forwardByte;
  if (isControlKeyDown("arrowdown", DOWN_ARROW, "s")) drive -= backwardByte;
  if (isControlKeyDown("arrowleft", LEFT_ARROW, "a")) steer -= steerByte;
  if (isControlKeyDown("arrowright", RIGHT_ARROW, "d")) steer += steerByte;
  if (!drive && !steer) return null;
  return { x: drive, y: steer };
}

function isControlKeyDown(keyName, keyCodeValue, letterName = keyName) {
  return pressedControlKeys.has(keyName) || pressedControlKeys.has(letterName) || keyIsDown(keyCodeValue);
}

function isKeyboardControlActive(id) {
  const up = isControlKeyDown("arrowup", UP_ARROW, "w");
  const down = isControlKeyDown("arrowdown", DOWN_ARROW, "s");
  const left = isControlKeyDown("arrowleft", LEFT_ARROW, "a");
  const right = isControlKeyDown("arrowright", RIGHT_ARROW, "d");
  if (id === "forward") return up;
  if (id === "back") return down;
  if (id === "left") return left;
  if (id === "right") return right;
  if (id === "forward-left") return up && left;
  if (id === "forward-right") return up && right;
  if (id === "back-left") return down && left;
  if (id === "back-right") return down && right;
  if (id === "halt") return pressedControlKeys.has(" ") || keyIsDown(32);
  return false;
}

async function sendRemoteVector(vector) {
  try {
    await remote.setRemoteSpeed(vector.x, vector.y);
  } catch (error) {
    addLog(`remote write failed: ${error?.message || error}`);
  }
}

async function sendRemoteEnableKeepalive() {
  try {
    await remote.writeRegisterNR(selectedControlTargetId, REG_ENABLE_REMOTE, [1]);
  } catch (error) {
    addLog(`remote keepalive failed: ${error?.message || error}`);
  }
}

function mousePressed(event) {
  if (!isCanvasPointerEvent(event)) return true;
  for (let i = hitRegions.length - 1; i >= 0; i -= 1) {
    const region = hitRegions[i];
    if (!isInside(mouseX, mouseY, region.x, region.y, region.w, region.h)) continue;
    if (region.type === "button") {
      region.action();
      return false;
    }
    if (region.type === "hold") {
      activePointerControl = region.id;
      return false;
    }
  }
  return false;
}

function mouseReleased(event) {
  if (!isCanvasPointerEvent(event)) return true;
  activePointerControl = null;
  return false;
}

function touchStarted(event) {
  if (!isCanvasPointerEvent(event)) return true;
  return mousePressed(event);
}

function touchEnded(event) {
  if (!isCanvasPointerEvent(event)) return true;
  activePointerControl = null;
  return false;
}

function keyPressed(event) {
  if (shouldIgnoreGlobalShortcut(event)) return true;
  if (key === " ") {
    sendRemoteVector({ x: 0, y: 0 });
    currentVector = null;
    return false;
  }
  if (key === "c" || key === "C") {
    remote.connectWithPicker().catch((error) => addLog(`connect failed: ${error?.message || error}`));
    return false;
  }
  if (key === "e" || key === "E") {
    (async () => {
      try {
        await armRemoteControl();
      } catch (error) {
        addLog(`enable failed: ${error?.message || error}`);
      }
    })();
    return false;
  }
  if (key === "f") {
    fullScreenToggle();
    return false;
  }
  return true;
}

function windowResized() {
  resizeCanvasToHost();
}

function isInside(px, py, x, y, w, h) {
  return px >= x && px <= x + w && py >= y && py <= y + h;
}

function sameVector(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y;
}

function shouldIgnoreGlobalShortcut(event) {
  if (event?.metaKey || event?.ctrlKey || event?.altKey) return true;
  const selection = typeof window !== "undefined" && window.getSelection ? window.getSelection() : null;
  if (selection && String(selection).trim()) return true;
  const active = typeof document !== "undefined" ? document.activeElement : null;
  if (!active) return false;
  const tag = String(active.tagName || "").toLowerCase();
  if (active.isContentEditable) return true;
  return tag === "input" || tag === "textarea" || tag === "select" || tag === "button";
}

function isCanvasPointerEvent(event) {
  const target = event?.target || null;
  const canvasEl = canvas?.elt || null;
  if (!target || !canvasEl) return false;
  return target === canvasEl || canvasEl.contains?.(target);
}

function formatBytes(values) {
  return Array.from(values || [], (value) => value.toString(16).padStart(2, "0")).join(" ");
}

function asciiBytes(text) {
  return Array.from(String(text || ""), (char) => char.charCodeAt(0) & 0xff);
}

function shortUuidLabel(uuid) {
  const text = String(uuid || "").toLowerCase();
  return text.slice(4, 8) || text;
}

function pad16(bytes) {
  const output = Array.from(bytes || []).slice(0, 16);
  while (output.length < 16) output.push(0);
  return output;
}

async function sha1Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-1", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest));
}

async function deriveNinebotAesKey(key1Bytes, key2Bytes) {
  const digest = await sha1Bytes([...pad16(key1Bytes), ...pad16(key2Bytes)]);
  return digest.slice(0, 16);
}

async function aesEcbEncryptBlock(keyBytes, blockBytes) {
  if (!crypto?.subtle) {
    throw new Error("WebCrypto is unavailable");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(keyBytes),
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: new Uint8Array(16) },
    key,
    new Uint8Array(blockBytes)
  );
  return Array.from(new Uint8Array(encrypted)).slice(0, 16);
}

async function buildEncryptedPreCommFrame(deviceName, gen = "gen2", cryptoVariant = {}) {
  const encoder = new TextEncoder();
  const key1 = Array.from(encoder.encode(deviceName || ""));
  const key2 =
    cryptoVariant.key2 === "fw" || (gen === "gen2" && cryptoVariant.key2 !== "zero")
      ? FW_DATA_GEN2
      : [];
  const aesKey = await deriveNinebotAesKey(key1, key2);
  const source = cryptoVariant.source ?? 0x3e;
  const target = cryptoVariant.target ?? BLE_TARGET_ID;
  const plaintext = [0x5a, 0xa5, 0x00, source & 0xff, target & 0xff, CMD_PRE_COMM, 0x00];
  const checksum = (~plaintext.slice(3).reduce((sum, value) => sum + (value & 0xff), 0)) & 0xffff;
  const block = cryptoVariant.block === "fw" ? FW_DATA_GEN2 : new Array(16).fill(0);
  const keystream = await aesEcbEncryptBlock(aesKey, block);
  const encryptedBody = plaintext.slice(3).map((value, index) => value ^ keystream[index % 16]);
  return new Uint8Array([
    ...plaintext.slice(0, 3),
    ...encryptedBody,
    0x00,
    0x00,
    checksum & 0xff,
    (checksum >> 8) & 0xff,
    0x00,
    0x00,
  ]);
}

class MiAuthNbCrypto {
  constructor() {
    this.name = [];
    this.sha1Key = [];
    this.bleData = null;
    this.appData = null;
    this.counter = 0;
  }

  async setName(name) {
    this.name = Array.from(new TextEncoder().encode(String(name || "")));
    this.sha1Key = await deriveNinebotAesKey(this.name, FW_DATA_GEN2);
  }

  async setBleData(bleData) {
    this.bleData = Array.from(bleData || []).slice(0, 16);
    this.sha1Key = await deriveNinebotAesKey(this.name, this.bleData);
  }

  async setAppData(appData) {
    this.appData = Array.from(appData || []).slice(0, 16);
    this.sha1Key = await deriveNinebotAesKey(this.appData, this.bleData || []);
  }

  buildCounterBlock() {
    const block = new Array(16).fill(0);
    block[0] = 1;
    block[1] = (this.counter >>> 24) & 0xff;
    block[2] = (this.counter >>> 16) & 0xff;
    block[3] = (this.counter >>> 8) & 0xff;
    block[4] = this.counter & 0xff;
    block.splice(5, 8, ...(this.bleData || []).slice(0, 8));
    return block;
  }

  async encrypt(plaintext) {
    const data = Array.from(plaintext || []);
    const payload = data.slice(3);
    const result = data.slice(0, 3);
    if (this.counter === 0 || !this.bleData) {
      const encryptedPayload = await this.xorCrypt(payload, null);
      const checksum = crc16le(payload);
      return [
        ...result,
        ...encryptedPayload,
        0x00,
        0x00,
        checksum[0],
        checksum[1],
        0x00,
        0x00,
      ];
    }

    this.counter += 1;
    const counterBlock = this.buildCounterBlock();
    const encryptedPayload = await this.xorCrypt(payload, counterBlock.slice());
    counterBlock[0] = 0x59;
    counterBlock[15] = payload.length;
    const tag = await this.macTag(data, counterBlock);
    return [
      ...result,
      ...encryptedPayload,
      tag[0],
      tag[1],
      tag[2],
      tag[3],
      (this.counter >> 8) & 0xff,
      this.counter & 0xff,
    ];
  }

  async decrypt(frame) {
    const data = Array.from(frame || []);
    if (data.length < 9) throw new Error("MiAuth frame too short");
    const payloadLength = data.length - 9;
    const payload = data.slice(3, 3 + payloadLength);
    this.counter = ((data[data.length - 2] || 0) << 8) | (data[data.length - 1] || 0);
    const decryptedPayload =
      this.counter === 0 || !this.bleData
        ? await this.xorCrypt(payload, null)
        : await this.xorCrypt(payload, this.buildCounterBlock());
    return data.slice(0, 3).concat(decryptedPayload);
  }

  async xorCrypt(input, counterBlock) {
    const bytes = Array.from(input || []);
    const output = [];
    const block = counterBlock ? counterBlock.slice() : null;
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const chunk = bytes.slice(offset, offset + 16);
      if (block) block[15] = (block[15] + 1) & 0xff;
      const keystream = await aesEcbEncryptBlock(this.sha1Key, block || FW_DATA_GEN2);
      for (let i = 0; i < chunk.length; i += 1) output.push(chunk[i] ^ keystream[i]);
    }
    return output;
  }

  async macTag(plaintext, counterBlock) {
    const data = Array.from(plaintext || []);
    let x = await aesEcbEncryptBlock(this.sha1Key, counterBlock);
    x = await aesEcbEncryptBlock(this.sha1Key, xorBlock(data.slice(0, 3), x));
    for (let offset = 3; offset < data.length; offset += 16) {
      x = await aesEcbEncryptBlock(this.sha1Key, xorBlock(data.slice(offset, offset + 16), x));
    }
    counterBlock[0] = 1;
    counterBlock[15] = 0;
    const s0 = await aesEcbEncryptBlock(this.sha1Key, counterBlock);
    return xorBlock(s0.slice(0, 4), x.slice(0, 4)).slice(0, 4);
  }
}

function crc16le(bytes) {
  const value = (~Array.from(bytes || []).reduce((sum, byte) => sum + (byte & 0xff), 0)) & 0xffff;
  return [value & 0xff, (value >> 8) & 0xff];
}

function xorBlock(left, right, size = 16) {
  const output = new Array(size).fill(0);
  for (let i = 0; i < size; i += 1) {
    output[i] = ((left?.[i] || 0) ^ (right?.[i] || 0)) & 0xff;
  }
  return output;
}

function randomBytes(size) {
  const data = new Uint8Array(size);
  crypto.getRandomValues(data);
  return Array.from(data);
}

const MIAUTH_CMD_INIT = [0x5a, 0xa5, 0x00, 0x3d, 0x21, 0x5b, 0x00];
const MIAUTH_ACK_INIT = [0x5a, 0xa5, 0x1e, 0x21, 0x3d, 0x5b, 0x01];
const MIAUTH_ACK_PRE = [0x5a, 0xa5, 0x00, 0x21, 0x3d, 0x5c, 0x00];
const MIAUTH_ACK_PING = [0x5a, 0xa5, 0x00, 0x21, 0x3d, 0x5c, 0x01];
const MIAUTH_ACK_PAIR = [0x5a, 0xa5, 0x00, 0x21, 0x3d, 0x5d, 0x01];

function miauthCmdPing(appKey) {
  return [0x5a, 0xa5, 0x10, 0x3d, 0x21, 0x5c, 0x00, ...appKey.slice(0, 16)];
}

function miauthCmdPair(serial) {
  return [0x5a, 0xa5, 0x0e, 0x3d, 0x21, 0x5d, 0x00, ...serial.slice(0, 14)];
}

function bytesStartWith(bytes, prefix) {
  if (!bytes || bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function buildEsPlainPacket(source, target, command, index, data = [], checksumMask = 0xffff) {
  const body = [
    data.length & 0xff,
    source & 0xff,
    target & 0xff,
    command & 0xff,
    index & 0xff,
    ...Array.from(data || []),
  ];
  const checksum = (~body.reduce((sum, value) => sum + (value & 0xff), 0)) & checksumMask;
  return [0x5a, 0xa5, ...body, checksum & 0xff, (checksum >> 8) & 0xff];
}

function formatVersionPayload(values) {
  const bytes = Array.from(values || []);
  if (bytes.length >= 2) return `${bytes[1]}.${bytes[0]}`;
  if (bytes.length === 1) return String(bytes[0]);
  return "-";
}

function protocolLabelFromMode(mode) {
  if (mode === 1) return "P1 csum16";
  if (mode === 2) return "P2 payload-len";
  if (mode === 3) return "P2 doc-len";
  if (mode === 4) return "P1 len+index";
  if (mode === 5) return "P1 len+index csum16";
  if (mode === 6) return "P1 csum16";
  if (mode === 7) return "P1 csum15 legacy";
  return `P${mode}`;
}

function getProtocolLabel() {
  return protocolLabelFromMode(protocolMode);
}

function formatCharacteristicProps(characteristic) {
  const props = characteristic?.properties;
  if (!props) return "-";
  const names = [];
  if (props.read) names.push("read");
  if (props.write) names.push("write");
  if (props.writeWithoutResponse) names.push("writeNR");
  if (props.notify) names.push("notify");
  if (props.indicate) names.push("indicate");
  return names.join(",") || "-";
}

function asciiFromBytes(values) {
  return Array.from(values || [], (value) =>
    value >= 32 && value <= 126 ? String.fromCharCode(value) : "."
  ).join("");
}

function isShutdownStateBroadcast(frame) {
  return (
    frame?.protocol === "P1" &&
    !frame.isEcho &&
    frame.index === 0x00 &&
    (
      (frame.target === 0xff && frame.cmd === 0x54) ||
      (frame.target === 0x10 && frame.cmd === 0x13)
    )
  );
}

function addFrameObserver(listener) {
  frameObservers.add(listener);
  return () => frameObservers.delete(listener);
}

function emitFrameObservers(frame) {
  for (const listener of frameObservers) {
    try {
      listener(frame);
    } catch {}
  }
}

function addRawNotifyObserver(listener) {
  rawNotifyObservers.add(listener);
  return () => rawNotifyObservers.delete(listener);
}

function emitRawNotifyObservers(notification) {
  for (const listener of rawNotifyObservers) {
    try {
      listener(notification);
    } catch {}
  }
}

function u16le(values) {
  const bytes = values || [];
  return ((bytes[1] || 0) << 8) | (bytes[0] || 0);
}

function u32le(values) {
  const bytes = values || [];
  return (
    ((bytes[3] || 0) << 24) |
    ((bytes[2] || 0) << 16) |
    ((bytes[1] || 0) << 8) |
    (bytes[0] || 0)
  ) >>> 0;
}

function toHexByte(value) {
  return Number(value).toString(16).padStart(2, "0").toUpperCase();
}

async function probeCandidateTargets() {
  if (!remote?.connected) {
    addLog("probe skipped: not connected");
    return;
  }
  for (const targetId of CANDIDATE_CONTROL_TARGETS) {
    try {
      addLog(`probe target 0x${toHexByte(targetId)}`);
      await remote.readRegister(targetId, REG_REMOTE_INFO, 8);
      await remote.readRegister(targetId, REG_DIS_BATTERY, 2);
      await remote.readRegister(targetId, REG_LIMIT_SPEED, 2);
    } catch (error) {
      addLog(`probe 0x${toHexByte(targetId)} failed: ${error?.message || error}`);
    }
  }
}

async function scanP1Targets() {
  if (!remote?.connected) {
    addLog("P1 scan skipped: not connected");
    return;
  }
  protocolMode = 1;
  refreshDebugInfo();
  addLog("P1 scan: serial/battery/ble-pwd across read targets");
  for (const targetId of CANDIDATE_READ_TARGETS) {
    try {
      addLog(`P1 scan target 0x${toHexByte(targetId)} serial`);
      await remote.readRegister(targetId, REG_SERIAL, 14);
      await sleep(180);
      addLog(`P1 scan target 0x${toHexByte(targetId)} battery`);
      await remote.readRegister(targetId, targetId === DIS_TARGET_ID ? REG_DIS_BATTERY : REG_CTRL_BATTERY, 2);
      await sleep(180);
      addLog(`P1 scan target 0x${toHexByte(targetId)} ble-pwd`);
      await remote.readRegister(targetId, REG_BLE_PASSWORD, 6);
      await sleep(260);
    } catch (error) {
      addLog(`P1 scan 0x${toHexByte(targetId)} failed: ${error?.message || error}`);
    }
  }
}

async function wakeP1Session() {
  if (!remote?.connected) {
    addLog("wake skipped: not connected");
    return;
  }
  protocolMode = 1;
  refreshDebugInfo();
  addLog("wake: send active cmd 0x57 to DIS, Ninebot-S server 0x03, and CTRL 0x20");
  try {
    await remote.sendCommand(DIS_TARGET_ID, CMD_ACTIVE, 0, []);
    await sleep(180);
    await remote.sendCommand(NINEBOT_S_SERVER_ID, CMD_ACTIVE, 0, []);
    await sleep(180);
    await remote.sendCommand(0x20, CMD_ACTIVE, 0, []);
  } catch (error) {
    addLog(`wake failed: ${error?.message || error}`);
  }
}

async function runP1NoSizeReadTest() {
  if (!remote?.connected) {
    addLog("P1 no-size read skipped: not connected");
    return;
  }
  protocolMode = 1;
  refreshDebugInfo();
  addLog("P1 no-size read test: serial/battery/range without size payload");
  try {
    await remote.readRegisterNoSize(DIS_TARGET_ID, REG_SERIAL);
    await sleep(220);
    await remote.readRegisterNoSize(DIS_TARGET_ID, REG_DIS_BATTERY);
    await sleep(220);
    await remote.readRegisterNoSize(DIS_TARGET_ID, REG_RANGE);
    await sleep(220);
    await remote.readRegisterNoSize(0x20, REG_CTRL_BATTERY);
  } catch (error) {
    addLog(`P1 no-size read failed: ${error?.message || error}`);
  }
}

async function runAutoTest() {
  if (!remote?.connected) {
    addLog("auto test skipped: not connected");
    return;
  }
  const previousTarget = selectedControlTargetId;
  addLog("auto test start");
  try {
    protocolMode = 1;
    refreshDebugInfo();
    const realRxStart = remote.realRxFrameCount || 0;
    const echoStart = remote.echoFrameCount || 0;

    addLog("auto 1/11 BLE/GATT info");
    addSourceExpectation();
    await remote.readGattDeviceInfo();
    await remote.logGattOverview();
    await sleep(300);

    const rxBeforeListen = remote.rxFrameCount || 0;
    addLog(`auto 2/10 passive listen ${AUTO_PASSIVE_LISTEN_MS / 1000}s`);
    await sleep(AUTO_PASSIVE_LISTEN_MS);
    addLog(`auto passive listen rx frames: ${(remote.rxFrameCount || 0) - rxBeforeListen}`);

    addLog("auto 3/11 source Protocol1 variant probe");
    await runSourceProtocolVariantProbe();

    addLog("auto 4/12 encrypted PRE_COMM auth probe");
    await runEncryptedPreCommProbe();

    addLog("auto 5/12 wake session");
    await wakeP1Session();
    await sleep(450);

    protocolMode = 1;
    refreshDebugInfo();
    addLog("auto 6/12 Ninebot-S version confirmation probes");
    await runNinebotSVersionProbe();

    addLog("auto 7/12 read DIS basics");
    await remote.readRegister(DIS_TARGET_ID, REG_SERIAL, 14);
    await sleep(220);
    await remote.readRegister(DIS_TARGET_ID, REG_DIS_BATTERY, 2);
    await sleep(220);
    await remote.readRegister(DIS_TARGET_ID, REG_RANGE, 2);
    await sleep(300);

    addLog("auto 8/12 read Ninebot-S server basics");
    await remote.readRegister(NINEBOT_S_SERVER_ID, REG_SERIAL, 14);
    await sleep(220);
    await remote.readRegister(NINEBOT_S_SERVER_ID, REG_CTRL_BATTERY, 2);
    await sleep(220);
    await remote.readRegister(NINEBOT_S_SERVER_ID, REG_REMOTE_INFO, 8);
    await sleep(300);

    addLog("auto 9/12 scan battery targets");
    for (const targetId of CANDIDATE_READ_TARGETS) {
      await remote.readRegister(targetId, targetId === DIS_TARGET_ID ? REG_DIS_BATTERY : REG_CTRL_BATTERY, 2);
      await sleep(180);
    }

    addLog("auto 10/12 scan version targets");
    for (const targetId of CANDIDATE_READ_TARGETS) {
      await remote.readRegister(targetId, REG_BLE_VERSION, 2);
      await sleep(180);
    }

    addLog("auto 11/12 enable remote candidates");
    for (const targetId of CANDIDATE_CONTROL_TARGETS) {
      selectedControlTargetId = targetId;
      refreshDebugInfo();
      await remote.writeRegisterNR(targetId, REG_ENABLE_REMOTE, [1]);
      await sleep(220);
    }

    addLog("auto 12/12 stop remote on candidates");
    for (const targetId of CANDIDATE_CONTROL_TARGETS) {
      await remote.writeRegisterNR(targetId, REG_SET_REMOTE_SPEED, [0, 0, 0, 0]);
      await sleep(140);
    }
    const realRxDelta = (remote.realRxFrameCount || 0) - realRxStart;
    const echoDelta = (remote.echoFrameCount || 0) - echoStart;
    addLog(`auto test done realRx=${realRxDelta} echo=${echoDelta}`);
    if (realRxDelta > 0) {
      addLog("vehicle protocol confirmation: real non-echo RX received");
    } else {
      addLog("vehicle protocol confirmation: still missing; only BLE link/GATT is confirmed");
    }
  } catch (error) {
    addLog(`auto test failed: ${error?.message || error}`);
  } finally {
    selectedControlTargetId = previousTarget;
    refreshDebugInfo();
  }
}

function setAutoTest2Report(lines) {
  autoTest2Report = Array.isArray(lines) ? lines.join("\n") : String(lines || "");
  refreshDebugInfo();
}

function autoTest2StatusLabel(status) {
  if (status === "match") return "confirmed";
  if (status === "rx-other") return "rx-other";
  if (status === "encrypted-rx") return "enc-rx";
  if (status === "rx-raw") return "raw-rx";
  if (status === "echo-only") return "echo-only";
  if (status === "error") return "error";
  return "silent";
}

function scoreAutoTest2Result(result) {
  if (!result) return -1;
  if (result.status === "match") return 5;
  if (result.status === "rx-other") return 4;
  if (result.status === "encrypted-rx") return 3;
  if (result.status === "rx-raw") return 3;
  if (result.status === "echo-only") return 2;
  if (result.status === "silent") return 1;
  return 0;
}

function pickBestAutoTest2Result(results) {
  return (results || []).slice().sort((a, b) => {
    const scoreDelta = scoreAutoTest2Result(b) - scoreAutoTest2Result(a);
    if (scoreDelta) return scoreDelta;
    return (b?.realFrames?.length || 0) - (a?.realFrames?.length || 0);
  })[0] || null;
}

function describeAutoTest2Result(result) {
  if (!result) return "none";
  const parts = [
    result.label || "probe",
    autoTest2StatusLabel(result.status),
    `real=${result.realFrames?.length || 0}`,
    `echo=${result.echoFrames?.length || 0}`,
  ];
  const rawReal = result.rawRealNotifications?.length || 0;
  const rawEcho = result.rawEchoNotifications?.length || 0;
  if (rawReal || rawEcho) parts.push(`raw=${rawReal}`, `rawEcho=${rawEcho}`);
  if (result.error) parts.push(`error=${result.error.message || result.error}`);
  return parts.join(" | ");
}

function batteryValueFromResult(result) {
  const payload = result?.matchedFrames?.[0]?.payload || result?.realFrames?.[0]?.payload || [];
  if (payload.length < 2) return null;
  return u16le(payload);
}

function describeBatteryResult(result) {
  const value = batteryValueFromResult(result);
  if (!Number.isFinite(value)) return "unknown";
  return `${value}% raw=${value}`;
}

function isReadReplyCommand(cmd) {
  return cmd === CMD_READ || cmd === 0x04;
}

function isExpectedReadReplyTarget(requestTarget, replyTarget) {
  if (requestTarget == null) return true;
  if (replyTarget === requestTarget) return true;
  return (
    requestTarget === APP_DISCOVERED_BLE_TARGET_ID &&
    replyTarget === APP_DISCOVERED_REPLY_TARGET_ID
  );
}

function isReadResponseMatch(target, index) {
  return (frame) =>
    !frame.isEcho &&
    isReadReplyCommand(frame.cmd) &&
    frame.index === index &&
    isExpectedReadReplyTarget(target, frame.target);
}

function probeLabelFor(target, index, size) {
  return `0x${toHexByte(target)}/0x${toHexByte(index)} size=${size}`;
}

function isEncryptedFrameMatch(frame) {
  return !frame.isEcho && frame.protocol === "ENC2";
}

function supportedWriteModes(channel) {
  const props = channel?.characteristic?.properties || {};
  const modes = [];
  if (props.write || typeof channel?.characteristic?.writeValueWithResponse === "function") {
    modes.push("response");
  }
  if (
    props.writeWithoutResponse ||
    typeof channel?.characteristic?.writeValueWithoutResponse === "function"
  ) {
    modes.push("no-response");
  }
  return Array.from(new Set(modes.length ? modes : ["response"]));
}

async function runObservedProbe(label, action, options = {}) {
  const waitMs = options.waitMs ?? AUTO_TEST2_RESPONSE_WAIT_MS;
  const matchFrame = typeof options.matchFrame === "function" ? options.matchFrame : null;
  const observed = [];
  const rawObserved = [];
  const cleanup = addFrameObserver((frame) => {
    observed.push({
      target: frame.target,
      cmd: frame.cmd,
      index: frame.index,
      payload: Array.from(frame.payload || []),
      frame: Array.from(frame.frame || []),
      protocol: frame.protocol,
      isEcho: !!frame.isEcho,
    });
  });
  const cleanupRaw = addRawNotifyObserver((notification) => {
    rawObserved.push({
      bytes: Array.from(notification.bytes || []),
      hex: notification.hex || formatBytes(notification.bytes || []),
      isEcho: !!notification.isEcho,
    });
  });
  const previousBeepProbeLabel = activeBeepProbeLabel;
  activeBeepProbeLabel = label;
  let error = null;
  try {
    await action();
  } catch (probeError) {
    error = probeError;
  }
  await sleep(waitMs);
  activeBeepProbeLabel = previousBeepProbeLabel;
  cleanup();
  cleanupRaw();
  const realFrames = observed.filter((frame) => !frame.isEcho);
  const echoFrames = observed.filter((frame) => frame.isEcho);
  const rawRealNotifications = rawObserved.filter((notification) => !notification.isEcho);
  const rawEchoNotifications = rawObserved.filter((notification) => notification.isEcho);
  const matchedFrames = matchFrame ? realFrames.filter((frame) => matchFrame(frame)) : [];
  let status = "silent";
  if (error) {
    status = "error";
  } else if (matchedFrames.length) {
    status = "match";
  } else if (realFrames.some((frame) => frame.protocol === "ENC2")) {
    status = "encrypted-rx";
  } else if (realFrames.length) {
    status = "rx-other";
  } else if (rawRealNotifications.length) {
    status = "rx-raw";
  } else if (echoFrames.length) {
    status = "echo-only";
  } else if (rawEchoNotifications.length) {
    status = "echo-only";
  }
  return {
    label,
    status,
    error,
    observed,
    rawObserved,
    realFrames,
    echoFrames,
    rawRealNotifications,
    rawEchoNotifications,
    matchedFrames,
  };
}

function buildAutoTest2Summary(context) {
  const lines = [];
  lines.push(`Route: ${describeAutoTest2Result(context.bestRoute)}`);
  if (context.batteryResult) {
    lines.push(`Battery: ${describeBatteryResult(context.batteryResult)}`);
  }
  if (context.bestPacoLegacy) {
    lines.push(`9BMetrics exact: ${describeAutoTest2Result(context.bestPacoLegacy)}`);
  }
  if (context.bestMiauth) {
    lines.push(`MiAuth login: ${describeAutoTest2Result(context.bestMiauth)}`);
  }
  if (context.bestEsPlain) {
    lines.push(`ES plain: ${describeAutoTest2Result(context.bestEsPlain)}`);
  }
  if (context.bestPackageRead) {
    lines.push(`Package P1: ${describeAutoTest2Result(context.bestPackageRead)}`);
  }
  if (context.bestBmsSerial) {
    lines.push(`BMS serial-format: ${describeAutoTest2Result(context.bestBmsSerial)}`);
  }
  if (context.bestPreComm) {
    lines.push(`Auth PRE_COMM: ${describeAutoTest2Result(context.bestPreComm)}`);
  }
  if (context.bestProtocol) {
    lines.push(`Protocol: ${describeAutoTest2Result(context.bestProtocol)}`);
  }
  if (context.tinyControlSent) {
    lines.push(
      `Tiny RC: target 0x${toHexByte(context.bestControlTarget)} variant=${AUTO_TEST2_TINY_REMOTE_VARIANT_INDEX} pulse=${AUTO_TEST2_TINY_REMOTE_FORWARD_BYTE} duration=${AUTO_TEST2_TINY_REMOTE_PULSE_MS}ms`
    );
  }
  if (context.readMatches.length) {
    lines.push(
      `Reads: ${context.readMatches
        .map((entry) => `${entry.probeLabel}@0x${toHexByte(entry.target)}`)
        .join(", ")}`
    );
  } else {
    lines.push("Reads: no confirmed register response");
  }
  if (Number.isFinite(context.bestControlTarget)) {
    lines.push(`Control target: 0x${toHexByte(context.bestControlTarget)}`);
  } else if (!AUTO_TEST2_ENABLE_CONTROL_PROBES) {
    lines.push("Control target: disabled (read-only battery mode)");
  } else {
    lines.push("Control target: unresolved");
  }
  if (context.authHint) {
    lines.push(`Encrypted PRE_COMM: ${describeAutoTest2Result(context.authHint)}`);
  }
  if (context.needs.length) {
    lines.push("Need:");
    for (const item of context.needs) lines.push(`- ${item}`);
  }
  return lines;
}

async function runAutoTest2EncryptedHintSweep(channelId, mode) {
  const manualName = authKeyInputEl?.value?.() || "";
  const rawName = remote?.device?.name || "";
  const nameCandidates = uniqueStrings([
    manualName,
    rawName,
    rawName.trim(),
    SCREENSHOT_DEVICE_FACTS.appName,
    SCREENSHOT_DEVICE_FACTS.serial,
    SCREENSHOT_DEVICE_FACTS.serialCompact,
  ]).filter(Boolean);
  const routeProfiles = [
    ["ninebotcrypto-phone-esble", 0x3e, 0x21],
    ["ownbee-pc-esble", 0x3d, 0x21],
    ["ownbee-pc-esc", 0x3d, 0x20],
    ["modern-phone-ble", 0x3e, BLE_TARGET_ID],
  ];
  const variants = [
    ["ninebotcrypto-fw-fw", "gen2", { label: "ninebotcrypto-fw-fw", key2: "fw", block: "fw" }],
    ["gen2/fw-zero", "gen2", { label: "fw-zero", key2: "fw", block: "zero" }],
    ["gen2/zero-fw", "gen2", { label: "zero-fw", key2: "zero", block: "fw" }],
    ["gen3/zero-zero", "gen3", { label: "zero-zero", key2: "zero", block: "zero" }],
  ];
  const results = [];
  if (channelId) remote.setActiveWriteChannel(channelId);
  writeMode = mode || writeMode;
  for (const [routeLabel, source, target] of routeProfiles) {
    for (const keyName of nameCandidates.slice(0, 4)) {
      for (const [variantLabel, gen, cryptoVariant] of variants) {
        const label = `PRE_COMM ${routeLabel} ${variantLabel} key="${keyName}"`;
        const result = await runObservedProbe(
          label,
          async () => {
            await remote.sendEncryptedPreComm(gen, keyName, {
              ...cryptoVariant,
              source,
              target,
            });
          },
          {
            waitMs: 360,
            matchFrame: isEncryptedFrameMatch,
          }
        );
        results.push(result);
        addLog(`auto2 auth ${describeAutoTest2Result(result)}`);
        if (result.status === "match") return result;
        await sleep(AUTO_TEST2_INTER_STEP_MS);
      }
    }
  }
  return pickBestAutoTest2Result(results);
}

async function runAutoTest2PacoLegacyProbe(channelId) {
  if (channelId) remote.setActiveWriteChannel(channelId);
  const modes = ["no-response"];
  const results = [];
  for (const mode of modes) {
    writeMode = mode;
    protocolMode = 6;
    refreshDebugInfo();
    for (const [label, bytes, index] of AUTO_TEST2_PACO_LEGACY_PACKETS) {
      const result = await runObservedProbe(
        `${label} ${mode}`,
        async () => {
          addLog(`auto2 exact ${label} write=${mode} bytes=${formatBytes(bytes)}`);
          await remote.sendRawBytes(bytes);
          await sleep(90);
          await remote.sendRawBytes(bytes);
        },
        {
          waitMs: 950,
          matchFrame: isReadResponseMatch(0x09, index),
        }
      );
      result.protocolMode = 6;
      result.target = 0x09;
      result.index = index;
      result.probeLabel = label;
      results.push(result);
      addLog(`auto2 exact ${describeAutoTest2Result(result)}`);
      if (result.status === "match") return results;
      await sleep(AUTO_TEST2_INTER_STEP_MS);
    }
  }
  return results;
}

async function runEsPlainPacketProbe(channelId) {
  if (channelId) remote.setActiveWriteChannel(channelId);
  writeMode = "no-response";
  const probes = [
    ["ES plain INIT PC->BLE csum16", buildEsPlainPacket(0x3d, 0x21, CMD_PRE_COMM, 0, [], 0xffff)],
    ["ES plain INIT PHONE->BLE csum16", buildEsPlainPacket(0x3e, 0x21, CMD_PRE_COMM, 0, [], 0xffff)],
    ["ES plain INIT APP3F->BLE csum16", buildEsPlainPacket(0x3f, 0x21, CMD_PRE_COMM, 0, [], 0xffff)],
    ["ES plain serial PC->CTRL csum16", buildEsPlainPacket(0x3d, 0x20, CMD_READ, REG_SERIAL, [14], 0xffff)],
    ["ES plain serial PHONE->CTRL csum16", buildEsPlainPacket(0x3e, 0x20, CMD_READ, REG_SERIAL, [14], 0xffff)],
    ["ES plain segMod read APP3F->ECU16 0x2A", buildEsPlainPacket(0x3f, 0x16, CMD_READ, 0x2a, [0x02, 0x00], 0xffff)],
    ["ES plain segMod read PHONE->ECU16 0x2A", buildEsPlainPacket(0x3e, 0x16, CMD_READ, 0x2a, [0x02, 0x00], 0xffff)],
    ["ES plain INIT PC->BLE csum15", buildEsPlainPacket(0x3d, 0x21, CMD_PRE_COMM, 0, [], 0x7fff)],
    ["ES plain serial PC->CTRL csum15", buildEsPlainPacket(0x3d, 0x20, CMD_READ, REG_SERIAL, [14], 0x7fff)],
  ];
  const results = [];
  for (const [label, bytes] of probes) {
    const result = await runObservedProbe(
      label,
      async () => {
        addLog(`auto2 es-plain ${label} bytes=${formatBytes(bytes)}`);
        await remote.sendRawBytes(bytes);
      },
      { waitMs: 1000 }
    );
    result.probeLabel = label;
    results.push(result);
    addLog(`auto2 es-plain ${describeAutoTest2Result(result)}`);
    if (scoreAutoTest2Result(result) >= 4) return results;
    await sleep(AUTO_TEST2_INTER_STEP_MS);
  }
  return results;
}

async function runUartLinkProbe(channelId) {
  if (channelId) remote.setActiveWriteChannel(channelId);
  writeMode = "no-response";
  const probes = [
    ["UART CRLF", [0x0d, 0x0a]],
    ["UART AT", asciiBytes("AT")],
    ["UART AT CRLF", asciiBytes("AT\r\n")],
    ["UART AT+VERSION CRLF", asciiBytes("AT+VERSION\r\n")],
  ];
  const results = [];
  for (const [label, bytes] of probes) {
    const result = await runObservedProbe(
      label,
      async () => {
        addLog(`auto2 uart-link ${label} bytes=${formatBytes(bytes)}`);
        await remote.sendRawBytes(bytes);
      },
      { waitMs: 900 }
    );
    result.probeLabel = label;
    results.push(result);
    addLog(`auto2 uart-link ${describeAutoTest2Result(result)}`);
    if (scoreAutoTest2Result(result) >= 2) return results;
    await sleep(AUTO_TEST2_INTER_STEP_MS);
  }
  return results;
}

async function runPackageStyleP1ReadProbe(channelId) {
  if (channelId) remote.setActiveWriteChannel(channelId);
  writeMode = "no-response";
  protocolMode = 1;
  const readDefs = [
    ["rBattery", REG_CTRL_BATTERY, 2],
  ];
  const probes = [];
  for (const [modelLabel, target] of NINEBOT_S_PROTO1_TARGETS) {
    for (const [readLabel, index, size] of readDefs) {
      probes.push([`pkg ${modelLabel} ${readLabel}`, target, index, size]);
    }
  }
  const results = [];
  for (const [label, target, index, size] of probes) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await runObservedProbe(
        `${label} attempt=${attempt}`,
        async () => {
          addLog(`auto2 pkg-p1 ${label} attempt=${attempt}`);
          await remote.readRegister(target, index, size);
        },
        {
          waitMs: 1000,
          matchFrame: isReadResponseMatch(target, index),
        }
      );
      result.probeLabel = label;
      result.target = target;
      result.index = index;
      result.size = size;
      results.push(result);
      addLog(`auto2 pkg-p1 ${describeAutoTest2Result(result)}`);
      if (result.status === "match") return results;
      await sleep(180);
    }
  }
  return results;
}

async function runTinyRemoteControlTest(channelId) {
  if (channelId) remote.setActiveWriteChannel(channelId);
  writeMode = "no-response";
  protocolMode = 1;
  const target = AUTO_TEST2_TINY_REMOTE_TARGET;
  const pulse = Math.max(
    REMOTE_COMMAND_WORD_MIN,
    Math.min(REMOTE_COMMAND_WORD_MAX, AUTO_TEST2_TINY_REMOTE_FORWARD_BYTE | 0)
  );
  const pulseByte = Math.max(
    -127,
    Math.min(127, Math.round(pulse / REMOTE_COMMAND_WORD_STEP))
  );
  const pulseMs = AUTO_TEST2_TINY_REMOTE_PULSE_MS;
  const i16le = (value) => {
    const clipped = Math.max(-32767, Math.min(32767, Math.round(Number(value) || 0)));
    const word = clipped < 0 ? 0x10000 + clipped : clipped;
    return [word & 0xff, (word >> 8) & 0xff];
  };
  const word = (value) => Math.max(-32767, Math.min(32767, Math.round(Number(value) || 0)));
  const speedTurn = (speed, turn) => [...i16le(word(speed)), ...i16le(word(turn))];
  const speedTurnZero = (speed, turn) => [...i16le(word(speed)), ...i16le(word(turn)), ...i16le(0)];
  const pitchTurnForward = (pitch, turn, forward) => [
    ...i16le(word(pitch)),
    ...i16le(word(turn)),
    ...i16le(word(forward)),
  ];
  const variants = [
    {
      label: `safe four-byte [speed16=${pulse},turn16=0]`,
      payload: speedTurn(pulse, 0),
      stopPayload: speedTurn(0, 0),
    },
  ];
  if (ALLOW_EXTENDED_REMOTE_SPEED_PAYLOADS) {
    variants.push(
      {
        label: `3x2 forward16/turn16/zero [${pulse},0,0]`,
        payload: speedTurnZero(pulse, 0),
        stopPayload: speedTurnZero(0, 0),
      },
      {
        label: `3x2 pitch16/turn16/forward16 [${pulse},0,${pulse}]`,
        payload: pitchTurnForward(pulse, 0, pulse),
        stopPayload: pitchTurnForward(0, 0, 0),
      },
      {
        label: `3x2 no-pitch turn16/forward16 [0,0,${pulse}]`,
        payload: pitchTurnForward(0, 0, pulse),
        stopPayload: pitchTurnForward(0, 0, 0),
      },
      {
        label: `doc i16 speed forward speed=${pulse} turn=0`,
        payload: speedTurn(pulse, 0),
        stopPayload: speedTurn(0, 0),
      },
      {
        label: `doc i16 speed reverse speed=-${pulse} turn=0`,
        payload: speedTurn(-pulse, 0),
        stopPayload: speedTurn(0, 0),
      },
      {
        label: `doc i16 turn positive speed=0 turn=${pulse}`,
        payload: speedTurn(0, pulse),
        stopPayload: speedTurn(0, 0),
      },
      {
        label: `doc i16 turn negative speed=0 turn=-${pulse}`,
        payload: speedTurn(0, -pulse),
        stopPayload: speedTurn(0, 0),
      }
    );
  }
  const variantIndex = Math.max(
    0,
    Math.min(variants.length - 1, AUTO_TEST2_TINY_REMOTE_VARIANT_INDEX | 0)
  );
  const variant = variants[variantIndex];
  const steps = [
    ["pre-stop", () => remote.writeRegisterNR(target, REG_SET_REMOTE_SPEED, variant.stopPayload), 240],
    ["enable", () => remote.writeRegisterNR(target, REG_ENABLE_REMOTE, [1]), 260],
    [
      `${variant.label} ${pulseMs}ms`,
      () => remote.writeRegisterNR(target, REG_SET_REMOTE_SPEED, variant.payload),
      pulseMs,
    ],
    [
      `post-stop after ${variant.label}`,
      () => remote.writeRegisterNR(target, REG_SET_REMOTE_SPEED, variant.stopPayload),
      320,
    ],
    ["disable", () => remote.writeRegisterNR(target, REG_ENABLE_REMOTE, [0]), 260],
  ];
  const results = [];
  addLog(
    `auto2 tiny-rc single start target=0x${toHexByte(target)} variant=${variantIndex} ${variant.label} payload=${formatBytes(variant.payload)} duration=${pulseMs}ms`
  );
  for (const [label, action, waitMs] of steps) {
    const result = await runObservedProbe(
      `tiny-rc ${label} target=0x${toHexByte(target)}`,
      action,
      { waitMs }
    );
    result.target = target;
    result.probeLabel = label;
    results.push(result);
    addLog(`auto2 tiny-rc ${describeAutoTest2Result(result)}`);
    await sleep(40);
  }
  addLog("auto2 tiny-rc single complete; final command was stop/disable");
  return results;
}

async function runBmsSerialFormatProbe(channelId) {
  if (channelId) remote.setActiveWriteChannel(channelId);
  writeMode = "no-response";
  const results = [];
  for (const [label, bytes, index] of AUTO_TEST2_BMS_SERIAL_PACKETS) {
    const result = await runObservedProbe(
      label,
      async () => {
        addLog(`auto2 bms-serial ${label} bytes=${formatBytes(bytes)}`);
        await remote.sendRawBytes(bytes);
      },
      {
        waitMs: 1000,
        matchFrame: (frame) =>
          !frame.isEcho &&
          frame.protocol === "P2" &&
          frame.cmd === 0x04 &&
          frame.index === index,
      }
    );
    result.probeLabel = label;
    result.target = BMS_TARGET_ID;
    result.index = index;
    results.push(result);
    addLog(`auto2 bms-serial ${describeAutoTest2Result(result)}`);
    if (result.status === "match") return results;
    await sleep(220);
  }
  return results;
}

async function runDocsFaithfulPreCommProbe(channelId) {
  if (channelId) remote.setActiveWriteChannel(channelId);
  writeMode = "no-response";
  const keyNames = currentAuthKeyCandidates(2);
  const results = [];
  for (const keyName of keyNames) {
    for (const [frameLabel, preCommFrame] of E2_PRE_COMM_FRAMES) {
      const nbCrypto = new MiAuthNbCrypto();
      await nbCrypto.setName(keyName);
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const label = `E2 PRE_COMM ${frameLabel} key="${keyName}" attempt=${attempt}`;
        const result = await runObservedProbe(
          label,
          async () => {
            const encrypted = await nbCrypto.encrypt(preCommFrame);
            addLog(
              `auto2 auth-precomm ${label} plain=${formatBytes(preCommFrame)} encrypted=${formatBytes(encrypted)}`
            );
            await remote.sendRawBytesChunked(encrypted, 20, 25);
          },
          {
            waitMs: 2000,
            matchFrame: isEncryptedFrameMatch,
          }
        );
        result.keyName = keyName;
        result.probeLabel = `Encryption2 PRE_COMM ${frameLabel}`;
        results.push(result);
        addLog(`auto2 auth-precomm ${describeAutoTest2Result(result)}`);
        if (result.status === "match") return results;
        await sleep(250);
      }
    }
  }
  return results;
}

async function runAutoTest2TransportRecovery(context) {
  if (context.bestUartLink && scoreAutoTest2Result(context.bestUartLink) > 1) {
    return false;
  }
  addLog("auto2 transport recovery: UART silent, reconnecting same BLE device");
  await remote.reconnectExisting(1400);
  await remote.refreshNotifications();
  await sleep(350);
  const retryResults = await runUartLinkProbe(remote.activeWriteChannelId);
  for (const result of retryResults) {
    result.recovery = true;
    context.uartLinkResults.push(result);
  }
  context.bestUartLink = pickBestAutoTest2Result(context.uartLinkResults);
  addLog(`auto2 transport recovery UART ${describeAutoTest2Result(context.bestUartLink)}`);
  return true;
}

async function runBeepFinder() {
  if (!remote?.connected) {
    addLog("beep finder skipped: not connected");
    return;
  }
  const previousState = {
    protocolMode,
    writeMode,
    activeWriteChannelId: remote.activeWriteChannelId,
  };
  try {
    addLog("beep finder start: slow safe probes only; click Beep Mark on beep");
    await remote.refreshNotifications();
    const keyName = authKeyInputEl?.value?.() || remote?.device?.name || "";
    const rawName = remote?.device?.name || "";
    const keyCandidates = uniqueStrings([keyName, rawName, rawName.trim()]).filter(Boolean);
    const authKey = keyCandidates[0] || "";
    writeMode = "no-response";
    const probes = [
      ["UART CRLF", async () => remote.sendRawBytes([0x0d, 0x0a])],
      ["UART AT+VERSION CRLF", async () => remote.sendRawBytes(asciiBytes("AT+VERSION\r\n"))],
      ["P1 Ninebot-S serial 0x03/0x10", async () => {
        protocolMode = 1;
        await remote.readRegister(NINEBOT_S_SERVER_ID, REG_SERIAL, 14);
      }],
      ["P1 Balance BLE pwd/version 0x09/0x17", async () => {
        protocolMode = 6;
        await remote.sendRawBytes(AUTO_TEST2_PACO_LEGACY_PACKETS[0][1]);
      }],
      ["ES plain INIT PC->BLE", async () => {
        await remote.sendRawBytes(buildEsPlainPacket(0x3d, 0x21, CMD_PRE_COMM, 0, [], 0xffff));
      }],
      [`MiAuth CMD_INIT key="${authKey}"`, async () => {
        const nbCrypto = new MiAuthNbCrypto();
        await nbCrypto.setName(authKey);
        const encrypted = await nbCrypto.encrypt(MIAUTH_CMD_INIT);
        addLog(`beep finder MiAuth encrypted=${formatBytes(encrypted)}`);
        await remote.sendRawBytesChunked(encrypted, 20, 25);
      }],
      [`PRE_COMM phone->ES_BLE key="${authKey}"`, async () => {
        await remote.sendEncryptedPreComm("gen2", authKey, {
          label: "ninebotcrypto-fw-fw",
          key2: "fw",
          block: "fw",
          source: 0x3e,
          target: 0x21,
        });
      }],
      [`PRE_COMM pc->ES_BLE key="${authKey}"`, async () => {
        await remote.sendEncryptedPreComm("gen2", authKey, {
          label: "ninebotcrypto-fw-fw",
          key2: "fw",
          block: "fw",
          source: 0x3d,
          target: 0x21,
        });
      }],
    ];

    for (let index = 0; index < probes.length; index += 1) {
      const [label, action] = probes[index];
      ensureStillConnected(`before beep finder ${label}`);
      addLog(`beep finder ${index + 1}/${probes.length} START ${label}`);
      const result = await runObservedProbe(`beep finder ${label}`, action, { waitMs: 2600 });
      addLog(`beep finder ${index + 1}/${probes.length} END ${describeAutoTest2Result(result)}`);
      if (!remote?.connected) {
        addLog(`beep finder stopped after disconnect on ${label}`);
        break;
      }
      await sleep(1200);
    }
    addLog("beep finder done");
  } catch (error) {
    addLog(`beep finder failed: ${error?.message || error}`);
  } finally {
    protocolMode = previousState.protocolMode;
    writeMode = previousState.writeMode;
    remote.setActiveWriteChannel(previousState.activeWriteChannelId);
    activeBeepProbeLabel = "";
    refreshDebugInfo();
  }
}

function waitForMiauthEncryptedResponse(nbCrypto, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = addFrameObserver((frame) => {
      if (settled || frame.isEcho || frame.protocol !== "ENC2" || !frame.frame?.length) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      (async () => {
        try {
          const decoded = await nbCrypto.decrypt(frame.frame);
          addLog(`miauth RX decoded ${formatBytes(decoded)}`);
          resolve({
            status: "match",
            frame: Array.from(frame.frame),
            decoded,
          });
        } catch (error) {
          resolve({
            status: "error",
            error,
            frame: Array.from(frame.frame || []),
          });
        }
      })();
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ status: "silent" });
    }, timeoutMs);
  });
}

async function sendMiauthCommandAndWait(nbCrypto, plaintext, label, timeoutMs = 2500) {
  const encrypted = await nbCrypto.encrypt(plaintext);
  const response = waitForMiauthEncryptedResponse(nbCrypto, timeoutMs);
  addLog(`miauth TX ${label} plain=${formatBytes(plaintext)} encrypted=${formatBytes(encrypted)}`);
  await remote.sendRawBytesChunked(encrypted, 20, 25);
  return await response;
}

async function sendMiauthInitRequest(nbCrypto, timeoutMs = 5200) {
  const encrypted = await nbCrypto.encrypt(MIAUTH_CMD_INIT);
  const startedAt = Date.now();
  let attempt = 1;
  while (Date.now() - startedAt < timeoutMs) {
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    const response = waitForMiauthEncryptedResponse(
      nbCrypto,
      Math.max(500, Math.min(1100, remainingMs))
    );
    addLog(`miauth TX CMD_INIT attempt=${attempt} encrypted=${formatBytes(encrypted)}`);
    await remote.sendRawBytesChunked(encrypted, 20, 25);
    const result = await response;
    if (result.status !== "silent") return result;
    attempt += 1;
  }
  return { status: "silent" };
}

async function runMiauthLoginProbe(channelId, mode) {
  if (channelId) remote.setActiveWriteChannel(channelId);
  writeMode = mode || "no-response";
  const manualName = authKeyInputEl?.value?.() || "";
  const rawName = remote?.device?.name || "";
  const keyNames = uniqueStrings([
    rawName,
    manualName,
    manualName.trim(),
    rawName.trim(),
    SCREENSHOT_DEVICE_FACTS.appName,
  ]).filter(Boolean);
  const attempts = [];
  for (const keyName of keyNames) {
    const nbCrypto = new MiAuthNbCrypto();
    await nbCrypto.setName(keyName);
    const appKey = randomBytes(16);
    const attempt = {
      label: `MiAuth login key="${keyName}"`,
      status: "silent",
      realFrames: [],
      echoFrames: [],
      keyName,
    };
    attempts.push(attempt);
    addLog(`miauth login start key="${keyName}" write=${writeMode}`);

    const initResponse = await sendMiauthInitRequest(nbCrypto);
    if (initResponse.status !== "match") {
      attempt.status = initResponse.status;
      attempt.error = initResponse.error;
      addLog(`miauth CMD_INIT ${initResponse.status}`);
      continue;
    }

    const initDecoded = initResponse.decoded || [];
    if (!bytesStartWith(initDecoded, MIAUTH_ACK_INIT)) {
      attempt.status = "rx-other";
      addLog(`miauth unexpected init ack ${formatBytes(initDecoded)}`);
      continue;
    }

    const initPayload = initDecoded.slice(MIAUTH_ACK_INIT.length);
    const bleData = initPayload.slice(0, 16);
    const serial = initPayload.slice(16, 30);
    await nbCrypto.setBleData(bleData);
    attempt.status = "match";
    attempt.bleData = bleData;
    attempt.serial = serial;
    addLog(`miauth init ok bleData=${formatBytes(bleData)} serial="${asciiFromBytes(serial)}"`);

    const pingResponse = await sendMiauthCommandAndWait(
      nbCrypto,
      miauthCmdPing(appKey),
      "CMD_PING",
      3200
    );
    if (pingResponse.status !== "match") {
      addLog(`miauth CMD_PING ${pingResponse.status}`);
      return attempts;
    }

    const pingDecoded = pingResponse.decoded || [];
    if (bytesStartWith(pingDecoded, MIAUTH_ACK_PRE)) {
      addLog("miauth device requested confirmation: press POWER, then waiting with PAIR");
    } else if (bytesStartWith(pingDecoded, MIAUTH_ACK_PING)) {
      await nbCrypto.setAppData(appKey);
      addLog("miauth ping accepted; app key installed");
    } else {
      addLog(`miauth unexpected ping ack ${formatBytes(pingDecoded)}`);
      return attempts;
    }

    for (let i = 0; i < 6; i += 1) {
      const pairResponse = await sendMiauthCommandAndWait(
        nbCrypto,
        miauthCmdPair(serial),
        `CMD_PAIR attempt ${i + 1}`,
        3200
      );
      if (pairResponse.status !== "match") {
        addLog(`miauth CMD_PAIR ${pairResponse.status}`);
        continue;
      }
      const pairDecoded = pairResponse.decoded || [];
      if (bytesStartWith(pairDecoded, MIAUTH_ACK_PAIR)) {
        attempt.status = "match";
        attempt.authenticated = true;
        addLog("miauth authentication successful");
        return attempts;
      }
      addLog(`miauth unexpected pair ack ${formatBytes(pairDecoded)}`);
    }
    return attempts;
  }
  return attempts;
}

async function runCommOnlyTest() {
  if (!remote?.connected) {
    addLog("comm-only skipped: not connected");
    return;
  }
  const previousState = {
    protocolMode,
    writeMode,
    activeWriteChannelId: remote.activeWriteChannelId,
  };
  addLog("comm-only start: read/auth-init probes only; no control writes");
  try {
    await remote.refreshNotifications();
    const channelId = remote.writeChannels[0]?.id || remote.activeWriteChannelId;
    if (channelId) remote.setActiveWriteChannel(channelId);

    const manualName = authKeyInputEl?.value?.() || "";
    const rawName = remote?.device?.name || "";
    const keyNames = uniqueStrings([
      manualName.trim(),
      rawName.trim(),
      SCREENSHOT_DEVICE_FACTS.appName,
    ]).filter(Boolean);
    addLog(`comm-only key candidates: ${keyNames.map((name) => `"${name}"`).join(", ") || "(none)"}`);

    const checks = [];
    for (const mode of ["no-response", "response"]) {
      writeMode = mode;
      protocolMode = 6;
      refreshDebugInfo();
      checks.push(
        await runObservedProbe(
          `comm-only exact 9BMetrics pwd ${mode}`,
          async () => {
            await remote.sendRawBytes([0x55, 0xaa, 0x03, 0x09, 0x01, 0x17, 0x08, 0xd3, 0xff]);
          },
          {
            waitMs: 1000,
            matchFrame: isReadResponseMatch(0x09, REG_BLE_PASSWORD),
          }
        )
      );
      addLog(`comm-only result ${describeAutoTest2Result(checks[checks.length - 1])}`);
    }

    for (const mode of ["no-response", "response"]) {
      writeMode = mode;
      refreshDebugInfo();
      for (const keyName of keyNames) {
        const result = await runObservedProbe(
          `comm-only NinebotCrypto init ${mode} key="${keyName}"`,
          async () => {
            await remote.sendEncryptedPreComm("gen2", keyName, {
              label: "ninebotcrypto-fw-fw",
              key2: "fw",
              block: "fw",
              source: 0x3e,
              target: 0x21,
            });
          },
          {
            waitMs: 1000,
            matchFrame: isEncryptedFrameMatch,
          }
        );
        checks.push(result);
        addLog(`comm-only result ${describeAutoTest2Result(result)}`);
        if (result.status === "match") break;
      }
    }

    const best = pickBestAutoTest2Result(checks);
    addLog(`comm-only summary ${describeAutoTest2Result(best)}`);
    if (!best || scoreAutoTest2Result(best) <= 2) {
      addLog("comm-only next: if this stays silent, test with official app fully closed and reconnect the scooter BLE stack before another run");
    }
  } catch (error) {
    addLog(`comm-only failed: ${error?.message || error}`);
  } finally {
    protocolMode = previousState.protocolMode;
    writeMode = previousState.writeMode;
    remote.setActiveWriteChannel(previousState.activeWriteChannelId);
    refreshDebugInfo();
  }
}

function ensureStillConnected(label) {
  if (!remote?.connected) {
    throw new Error(`${label}: disconnected`);
  }
}

async function runAutoTest2() {
  if (!remote?.connected) {
    addLog("auto test 2 skipped: not connected");
    return;
  }
  if (autoTest2Running) {
    addLog("auto test 2 already running");
    return;
  }

  autoTest2Running = true;
  const activeAuthKey = seedAuthKeyFromDeviceName();
  setAutoTest2Report("Preparing structured diagnostics...");
  const previousState = {
    protocolMode,
    writeMode,
    selectedControlTargetId,
    activeWriteChannelId: remote.activeWriteChannelId,
  };
  const context = {
    routeResults: [],
    uartLinkResults: [],
    pacoLegacyResults: [],
    miauthResults: [],
    esPlainResults: [],
    packageReadResults: [],
    bmsSerialResults: [],
    preCommResults: [],
    protocolResults: [],
    readResults: [],
    readMatches: [],
    controlResults: [],
    bestRoute: null,
    bestUartLink: null,
    bestPacoLegacy: null,
    bestMiauth: null,
    bestEsPlain: null,
    bestPackageRead: null,
    bestBmsSerial: null,
    bestPreComm: null,
    bestProtocol: null,
    bestControlTarget: null,
    batteryResult: null,
    tinyControlSent: false,
    authHint: null,
    needs: [],
  };

  try {
    addLog(`auto test 2 start authKey="${activeAuthKey || "-"}"`);
    addLog(
      AUTO_TEST2_ENABLE_TINY_REMOTE_TEST
        ? `auto2 battery first, then tiny RC single-variant probe target=0x${toHexByte(AUTO_TEST2_TINY_REMOTE_TARGET)} variant=${AUTO_TEST2_TINY_REMOTE_VARIANT_INDEX} pulse=${AUTO_TEST2_TINY_REMOTE_FORWARD_BYTE}`
        : "auto2 read-only battery mode: no remote-control writes will be sent"
    );
    addLog("auto2 if the Ninebot beeps during this run, click Beep Mark immediately");
    await remote.refreshNotifications();
    await remote.readGattDeviceInfo();
    await remote.logGattOverview();
    setAutoTest2Report([
      "Preparing structured diagnostics...",
      `Connected profile: ${remote.profile?.name || "-"}`,
      `Write channels: ${remote.writeChannels.map((entry) => entry.label).join(", ") || "-"}`,
    ]);

    const passiveStart = remote.realRxFrameCount || 0;
    addLog(`auto2 passive listen ${AUTO_TEST2_PASSIVE_LISTEN_MS / 1000}s`);
    await sleep(AUTO_TEST2_PASSIVE_LISTEN_MS);
    const passiveDelta = (remote.realRxFrameCount || 0) - passiveStart;
    addLog(`auto2 passive listen realRx=${passiveDelta}`);

    const channels = remote.writeChannels.length
      ? remote.writeChannels
      : [{ id: "write-0002", label: "write-0002", characteristic: remote.writeCharacteristic }];
    let stopAfterBattery = false;
    for (const channel of channels) {
      if (stopAfterBattery) break;
      remote.setActiveWriteChannel(channel.id);
      for (const mode of supportedWriteModes(channel)) {
        if (stopAfterBattery) break;
        writeMode = mode;
        protocolMode = 1;
        refreshDebugInfo();
        for (const [probeName, target, index, size] of AUTO_TEST2_PRIMARY_ROUTE_PROBES) {
          if (stopAfterBattery) break;
          const label = `${channel.label}/${mode} ${probeName} ${probeLabelFor(target, index, size)}`;
          const result = await runObservedProbe(
            label,
            async () => {
              await remote.readRegister(target, index, size);
            },
            { matchFrame: isReadResponseMatch(target, index) }
          );
          result.channelId = channel.id;
          result.writeMode = mode;
          result.protocolMode = 1;
          result.probeLabel = `${probeName} ${probeLabelFor(target, index, size)}`;
          result.target = target;
          result.index = index;
          context.routeResults.push(result);
          if (result.status === "match") {
            context.readResults.push(result);
            context.readMatches.push(result);
            if (index === REG_CTRL_BATTERY) {
              context.batteryResult = result;
              stopAfterBattery = true;
            }
          }
          addLog(`auto2 route ${describeAutoTest2Result(result)}`);
          await sleep(AUTO_TEST2_INTER_STEP_MS);
        }
      }
    }
    context.bestRoute = pickBestAutoTest2Result(context.routeResults);
    if (context.bestRoute) {
      remote.setActiveWriteChannel(context.bestRoute.channelId);
      writeMode = context.bestRoute.writeMode;
    }

    if (!context.batteryResult) {
      ensureStillConnected("before package-style P1 battery probe");
      context.packageReadResults = await runPackageStyleP1ReadProbe(
        remote.activeWriteChannelId || context.bestRoute?.channelId
      );
      context.bestPackageRead = pickBestAutoTest2Result(context.packageReadResults);
      for (const result of context.packageReadResults) {
        context.readResults.push(result);
        if (result.status === "match") {
          context.readMatches.push(result);
          if (result.index === REG_CTRL_BATTERY && !context.batteryResult) {
            context.batteryResult = result;
          }
        }
      }
    }

    if (!context.readMatches.length) {
      ensureStillConnected("before BMS serial-format probe");
      context.bmsSerialResults = await runBmsSerialFormatProbe(
        remote.activeWriteChannelId || context.bestRoute?.channelId
      );
      context.bestBmsSerial = pickBestAutoTest2Result(context.bmsSerialResults);
      for (const result of context.bmsSerialResults) {
        context.readResults.push(result);
        if (result.status === "match") context.readMatches.push(result);
      }
    }

    if (!context.readMatches.length) {
      ensureStillConnected("before docs-faithful Encryption2 PRE_COMM probe");
      context.preCommResults = await runDocsFaithfulPreCommProbe(
        remote.activeWriteChannelId || context.bestRoute?.channelId
      );
      context.bestPreComm = pickBestAutoTest2Result(context.preCommResults);
    }

    context.bestProtocol = context.batteryResult || context.bestPackageRead;
    if (context.bestPackageRead) protocolMode = context.bestPackageRead.protocolMode || 1;

    if (context.batteryResult && AUTO_TEST2_ENABLE_TINY_REMOTE_TEST) {
      ensureStillConnected("before tiny remote-control test");
      context.bestControlTarget = AUTO_TEST2_TINY_REMOTE_TARGET;
      context.controlResults = await runTinyRemoteControlTest(
        remote.activeWriteChannelId || context.bestRoute?.channelId
      );
      context.tinyControlSent = true;
    }

    if (context.readMatches.length && AUTO_TEST2_ENABLE_CONTROL_PROBES) {
      const targetScores = new Map();
      for (const result of context.readMatches) {
        targetScores.set(result.target, (targetScores.get(result.target) || 0) + 1);
      }
      const preferredControlTargets = AUTO_TEST2_CONTROL_TARGET_PREFERENCE;
      const candidateControlTarget =
        preferredControlTargets.find((target) => targetScores.has(target)) ??
        Array.from(targetScores.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (
        Number.isFinite(candidateControlTarget) &&
        !AUTO_TEST2_READ_ONLY_TARGETS.has(candidateControlTarget)
      ) {
        context.bestControlTarget = candidateControlTarget;
        selectedControlTargetId = context.bestControlTarget;
        refreshDebugInfo();
        const controlTarget = context.bestControlTarget;
        const controlPlan = [
          ["enable RC", async () => remote.writeRegisterNR(controlTarget, REG_ENABLE_REMOTE, [1]), null],
          ["read remote info", async () => remote.readRegister(controlTarget, REG_REMOTE_INFO, 8), isReadResponseMatch(controlTarget, REG_REMOTE_INFO)],
          ["read max remote speed", async () => remote.readRegister(controlTarget, REG_MAX_REMOTE_SPEED, 2), isReadResponseMatch(controlTarget, REG_MAX_REMOTE_SPEED)],
          ["stop remote", async () => remote.writeRegisterNR(controlTarget, REG_SET_REMOTE_SPEED, [0, 0, 0, 0]), null],
        ];
        for (const [label, action, matcher] of controlPlan) {
          const result = await runObservedProbe(
            `${label} target=0x${toHexByte(controlTarget)}`,
            action,
            { waitMs: matcher ? AUTO_TEST2_RESPONSE_WAIT_MS : 320, matchFrame: matcher }
          );
          result.target = controlTarget;
          context.controlResults.push(result);
          addLog(`auto2 control ${describeAutoTest2Result(result)}`);
          await sleep(AUTO_TEST2_INTER_STEP_MS);
        }
      } else if (Number.isFinite(candidateControlTarget)) {
        context.needs.push(
          `Read response target 0x${toHexByte(candidateControlTarget)} looks like an app/BLE/auth target, so Auto Test 2 did not send control writes to it.`
        );
      }
    } else if (context.tinyControlSent) {
      context.needs.push("Battery state read successfully. Tiny RC test sent stop, enable, one tiny pulse, stop, then disable.");
    } else if (context.batteryResult) {
      context.needs.push("Battery state read successfully. Auto Test 2 stopped without sending password, serial, or auth probes.");
    } else if (context.readMatches.length) {
      context.needs.push("Auto Test 2 is in read-only battery mode, so it did not send any remote-control writes after reads succeeded.");
    } else {
      context.needs.push("No package-faithful Ninebot-S P1 read was confirmed, so Auto Test 2 stopped before any control writes.");
    }

    if (!context.bestRoute || scoreAutoTest2Result(context.bestRoute) <= 2) {
      context.needs.push("The app-discovered 0x0A route is still silent; GATT write succeeds, but no application-level reply is coming back.");
    }
    if (!context.batteryResult && (!context.bestProtocol || context.bestProtocol.status !== "match")) {
      context.needs.push("No docs-faithful P1 read produced a confirmed response, so keep control writes disabled until the session precondition is understood.");
    }
    if (!context.batteryResult && !context.readMatches.length && context.bestPackageRead?.status !== "match") {
      context.needs.push("The Proto1 target sweep now starts with the official app's 0x0A BLE/auth target, then falls back to 0x03 and 0x21; all stayed silent.");
    }
    if (!context.batteryResult && !context.readMatches.length && context.bestBmsSerial?.status !== "match") {
      context.needs.push("The exact internet BMS UART packets for target 0x22 also stayed silent, so that serial-port path is probably not bridged through this BLE session.");
    }
    if (context.bestBmsSerial?.status === "match") {
      context.needs.push("The BMS serial-format probe got a response. Treat this as a separate read-only BMS path before attempting any control logic.");
    }
    if (!context.batteryResult && !context.readMatches.length && context.bestPreComm?.status === "match") {
      context.needs.push("Encryption2 PRE_COMM received an encrypted response. Next step is a deliberate SET_PWD/AUTH flow with physical button confirmation, not register guessing.");
    }
    if (!context.batteryResult && !context.readMatches.length && context.bestPreComm?.status !== "match") {
      context.needs.push("Both Encryption2 PRE_COMM openers (C++ 0x21 and docs 0x04) stayed silent with the current BLE name, so this is likely app pairing/bonding/state rather than frame bytes.");
    }
    if (!context.batteryResult && !context.readMatches.length) {
      context.needs.push("Power-off broadcasts prove notifications work. Use Boot Listen next to see whether boot emits a seed/state frame before any request writes.");
    }
    if (
      AUTO_TEST2_ENABLE_CONTROL_PROBES &&
      context.readMatches.length &&
      !context.controlResults.some((entry) => entry.status === "match")
    ) {
      context.needs.push("Read communication is partially working. The next gap is control semantics: target board, write command type, or remote-enable preconditions.");
    }

    const summaryLines = buildAutoTest2Summary(context);
    setAutoTest2Report(summaryLines);
    addLog("auto test 2 summary");
    for (const line of summaryLines) addLog(`auto2 ${line}`);
  } catch (error) {
    addLog(`auto test 2 failed: ${error?.message || error}`);
    setAutoTest2Report(`Failed: ${error?.message || error}`);
  } finally {
    protocolMode = context.bestProtocol?.protocolMode || previousState.protocolMode;
    writeMode = context.bestRoute?.writeMode || previousState.writeMode;
    selectedControlTargetId =
      context.bestControlTarget ?? previousState.selectedControlTargetId;
    remote.setActiveWriteChannel(
      context.bestRoute?.channelId || previousState.activeWriteChannelId
    );
    autoTest2Running = false;
    refreshDebugInfo();
  }
}

function addSourceExpectation() {
  const name = remote?.device?.name || "";
  const looksLikeNinebotS = /ninebot\s*s/i.test(name);
  addLog(
    `source map: ${looksLikeNinebotS ? name : "selected device"} -> official app used P1 target 0x${toHexByte(APP_DISCOVERED_BLE_TARGET_ID)} for BLE pwd; fallback targets 0x03/0x21`
  );
  addLog(
    `app info: ${SCREENSHOT_DEVICE_FACTS.model} serial=${SCREENSHOT_DEVICE_FACTS.serial} master=${SCREENSHOT_DEVICE_FACTS.masterControlVersion} battery=${SCREENSHOT_DEVICE_FACTS.batteryVersion} ble=${SCREENSHOT_DEVICE_FACTS.bluetoothVersion}`
  );
  addLog(
    AUTO_TEST2_ENABLE_TINY_REMOTE_TEST
      ? `source map: Auto Test 2 reads battery, then tiny RC single-variant probe target 0x${toHexByte(AUTO_TEST2_TINY_REMOTE_TARGET)} variant=${AUTO_TEST2_TINY_REMOTE_VARIANT_INDEX} pulse=${AUTO_TEST2_TINY_REMOTE_FORWARD_BYTE}`
      : "source map: Auto Test 2 is read-only battery mode: rBattery=0x22 only"
  );
}

async function runSourceProtocolVariantProbe() {
  const previousMode = protocolMode;
  const variants = [
    [1, "source P1: len=payload+2, csum16"],
    [7, "diagnostic P1: len=payload+2, csum15 legacy"],
    [4, "diagnostic P1: len includes index, csum15"],
    [5, "diagnostic P1: len includes index, csum16"],
  ];
  for (const [mode, label] of variants) {
    protocolMode = mode;
    refreshDebugInfo();
    addLog(`variant ${label}`);
    await remote.readRegister(NINEBOT_S_SERVER_ID, REG_SERIAL, 14);
    await sleep(220);
    await remote.readRegister(NINEBOT_S_SERVER_ID, REG_CTRL_BATTERY, 2);
    await sleep(220);
    await remote.readRegister(NINEBOT_S_SERVER_ID, REG_BLE_VERSION, 2);
    await sleep(260);
  }
  protocolMode = previousMode;
  refreshDebugInfo();
}

async function runEncryptedPreCommProbe() {
  const realStart = remote.realRxFrameCount || 0;
  const echoStart = remote.echoFrameCount || 0;
  const rawName = remote?.device?.name || "";
  const manualName = authKeyInputEl?.value?.() || "";
  const nameVariants = uniqueStrings([
    manualName,
    SCREENSHOT_DEVICE_FACTS.appName,
    SCREENSHOT_DEVICE_FACTS.serial,
    SCREENSHOT_DEVICE_FACTS.serialCompact,
    SCREENSHOT_DEVICE_FACTS.serialCompact.slice(-8),
    SCREENSHOT_DEVICE_FACTS.serialCompact.slice(-6),
    SCREENSHOT_DEVICE_FACTS.serialCompact.slice(-5),
    rawName,
    rawName.trim(),
    rawName.replace(/\s+/g, ""),
    rawName.trim().slice(-6),
    rawName.trim().slice(-5),
  ]).filter(Boolean);
  addLog(`auth probe key names: ${nameVariants.map((name) => `"${name}"`).join(", ") || "(none)"}`);
  const cryptoVariants = [
    ["gen2 key=fw block=zero", "gen2", { label: "key-fw_block-zero", key2: "fw", block: "zero" }],
    ["gen2 key=zero block=fw", "gen2", { label: "key-zero_block-fw", key2: "zero", block: "fw" }],
    ["gen2 key=fw block=fw", "gen2", { label: "key-fw_block-fw", key2: "fw", block: "fw" }],
    ["gen3 key=zero block=zero", "gen3", { label: "key-zero_block-zero", key2: "zero", block: "zero" }],
  ];
  const probes = [];
  for (const mode of ["response", "no-response"]) {
    for (const keyName of nameVariants) {
      for (const [label, gen, variant] of cryptoVariants) {
        probes.push([mode, label, gen, keyName, variant]);
      }
    }
  }
  const previousWriteMode = writeMode;
  for (const [mode, label, gen, keyName, variant] of probes) {
    writeMode = mode;
    refreshDebugInfo();
    addLog(`auth probe PRE_COMM ${label} write=${mode} key="${keyName}"`);
    try {
      await remote.sendEncryptedPreComm(gen, keyName, variant);
    } catch (error) {
      addLog(`auth probe ${label} failed: ${error?.message || error}`);
    }
    await sleep(520);
  }
  writeMode = previousWriteMode;
  refreshDebugInfo();
  addLog(
    `auth probe done realRx=${(remote.realRxFrameCount || 0) - realStart} echo=${(remote.echoFrameCount || 0) - echoStart}`
  );
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => String(value || ""))));
}

async function runNinebotSVersionProbe() {
  const probes = [
    ["Ninebot-S server serial", NINEBOT_S_SERVER_ID, REG_SERIAL, 14],
    ["Ninebot-S server BLE version", NINEBOT_S_SERVER_ID, REG_BLE_VERSION, 2],
    ["Ninebot-S server CTRL version", NINEBOT_S_SERVER_ID, REG_CTRL_VERSION, 2],
    ["Ninebot-S server BMS version", NINEBOT_S_SERVER_ID, REG_BMS_VERSION, 2],
    ["Ninebot-S server battery", NINEBOT_S_SERVER_ID, REG_CTRL_BATTERY, 2],
    ["Ninebot-S server BLE pwd", NINEBOT_S_SERVER_ID, REG_BLE_PASSWORD, 6],
    ["Ninebot-S server remote info", NINEBOT_S_SERVER_ID, REG_REMOTE_INFO, 8],
    ["DIS serial fallback", DIS_TARGET_ID, REG_SERIAL, 14],
    ["DIS BLE version fallback", DIS_TARGET_ID, REG_BLE_VERSION, 2],
    ["BLE module version", BLE_TARGET_ID, REG_BLE_VERSION, 2],
    ["BLE module pwd", BLE_TARGET_ID, REG_BLE_PASSWORD, 6],
    ["CTRL 0x20 version fallback", 0x20, REG_CTRL_VERSION, 2],
    ["CTRL 0x20 battery fallback", 0x20, REG_CTRL_BATTERY, 2],
    ["CTRL 0x20 remote info fallback", 0x20, REG_REMOTE_INFO, 8],
    ["BFG echo check", BFG_ECHO_TARGET_ID, REG_BLE_VERSION, 2],
  ];
  for (const [label, targetId, register, size] of probes) {
    addLog(`version probe ${label} target=0x${toHexByte(targetId)} idx=0x${toHexByte(register)}`);
    await remote.readRegister(targetId, register, size);
    await sleep(220);
  }
}

async function enableRemoteOnAllCandidates() {
  if (!remote?.connected) {
    addLog("enable-all skipped: not connected");
    return;
  }
  for (const targetId of CANDIDATE_CONTROL_TARGETS) {
    try {
      addLog(`enable rc target 0x${toHexByte(targetId)}`);
      await remote.writeRegisterNR(targetId, REG_ENABLE_REMOTE, [1]);
    } catch (error) {
      addLog(`enable-all 0x${toHexByte(targetId)} failed: ${error?.message || error}`);
    }
  }
}

async function runBasicCommTest(label = `P${protocolMode}`) {
  if (!remote?.connected) {
    addLog("basic test skipped: not connected");
    return;
  }
  try {
    addLog(`basic comm test ${label}: DIS serial/range/odo`);
    await remote.readDisSerial();
    await sleep(160);
    await remote.readDisRange();
    await sleep(160);
    await remote.readDisOdometer();
  } catch (error) {
    addLog(`basic test failed: ${error?.message || error}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
