import { ProtocolClient } from "./protocol/ProtocolClient.js";
import { WebSerialTransport } from "./protocol/WebSerialTransport.js";
import { WebSocketTransport } from "./protocol/WebSocketTransport.js";

const defaultCode = `function setup() {
  pinMode(2, 1);
  println("p1_embed ready");
}

function loop() {
  digitalWrite(2, 1);
  delay(120);
  digitalWrite(2, 0);
  delay(880);
}`;

const els = {
  connect: document.querySelector("#connect-button"),
  disconnect: document.querySelector("#disconnect-button"),
  info: document.querySelector("#info-button"),
  status: document.querySelector("#status-button"),
  getScript: document.querySelector("#get-script-button"),
  reboot: document.querySelector("#reboot-button"),
  run: document.querySelector("#run-button"),
  save: document.querySelector("#save-button"),
  saveRun: document.querySelector("#save-run-button"),
  stop: document.querySelector("#stop-button"),
  restart: document.querySelector("#restart-button"),
  clearConsole: document.querySelector("#clear-console-button"),
  wifiStatus: document.querySelector("#wifi-status-button"),
  wifiSave: document.querySelector("#wifi-save-button"),
  rawSend: document.querySelector("#raw-send-button"),
  debugLevel: document.querySelector("#debug-level"),
  transportMode: document.querySelector("#transport-mode"),
  websocketUrl: document.querySelector("#websocket-url"),
  code: document.querySelector("#code-editor"),
  console: document.querySelector("#console-output"),
  raw: document.querySelector("#raw-input"),
  version: document.querySelector("#firmware-version"),
  connection: document.querySelector("#connection-state"),
  deviceName: document.querySelector("#device-name"),
  wifiState: document.querySelector("#wifi-state"),
  scriptState: document.querySelector("#script-state"),
  fields: document.querySelector("#device-fields"),
  wifiSsid: document.querySelector("#wifi-ssid"),
  wifiPassword: document.querySelector("#wifi-password"),
};

let transport = null;
let client = null;
let lastInfo = null;
let lastStatus = null;
let consoleLines = [];

boot();

function boot() {
  els.code.value = localStorage.getItem("p1_embed.editor.code") || defaultCode;
  els.transportMode.value = localStorage.getItem("p1_embed.transport.mode") || "websocket";
  els.websocketUrl.value = localStorage.getItem("p1_embed.websocket.url") || els.websocketUrl.value;
  els.code.addEventListener("input", () => {
    localStorage.setItem("p1_embed.editor.code", els.code.value);
  });
  els.transportMode.addEventListener("change", () => {
    localStorage.setItem("p1_embed.transport.mode", els.transportMode.value);
    updateTransportControls();
  });
  els.websocketUrl.addEventListener("input", () => {
    localStorage.setItem("p1_embed.websocket.url", els.websocketUrl.value.trim());
  });

  bindControls();
  setConnected(false);
  updateTransportControls();
  renderFields();

  if (!("serial" in navigator)) {
    logLine("error", "Web Serial is not available");
    els.transportMode.querySelector("option[value='serial']").disabled = true;
    if (els.transportMode.value === "serial") els.transportMode.value = "websocket";
  }
}

function bindControls() {
  els.connect.addEventListener("click", connectSelectedTransport);
  els.disconnect.addEventListener("click", disconnectTransport);
  els.info.addEventListener("click", () => refreshInfo());
  els.status.addEventListener("click", () => refreshStatus());
  els.getScript.addEventListener("click", getScript);
  els.reboot.addEventListener("click", () => sendCommand("device.reboot"));
  els.run.addEventListener("click", () => setScript({ run: true, save: false }));
  els.save.addEventListener("click", () => setScript({ run: false, save: true }));
  els.saveRun.addEventListener("click", () => setScript({ run: true, save: true }));
  els.stop.addEventListener("click", () => sendCommand("script.stop").then(refreshStatus));
  els.restart.addEventListener("click", () => sendCommand("script.restart").then(refreshStatus));
  els.clearConsole.addEventListener("click", clearConsole);
  els.wifiStatus.addEventListener("click", () => sendCommand("wifi.status").then(updateWifi));
  els.wifiSave.addEventListener("click", saveWifi);
  els.rawSend.addEventListener("click", sendRaw);
  els.debugLevel.addEventListener("change", () => sendCommand("debug.set", { level: els.debugLevel.value }));
}

async function connectSelectedTransport() {
  try {
    const mode = els.transportMode.value;
    transport = createTransport(mode);
    client = new ProtocolClient(transport);
    bindClient(client);
    if (mode === "websocket") {
      await transport.connect({ url: normalizeWebSocketUrl(els.websocketUrl.value) });
    } else {
      await transport.connect();
    }
    setConnected(true);
    logLine("info", `${transportLabel()} connected`);
    await startupRefresh();
  } catch (error) {
    logLine("error", error.message);
    setConnected(false);
  }
}

function createTransport(mode) {
  if (mode === "websocket") return new WebSocketTransport();
  return new WebSerialTransport();
}

function normalizeWebSocketUrl(value) {
  const url = value.trim();
  if (!url) throw new Error("WebSocket URL is required");
  if (!/^wss?:\/\//i.test(url)) return `ws://${url}`;
  return url;
}

function transportLabel() {
  return els.transportMode.value === "websocket" ? "websocket" : "serial";
}

async function disconnectTransport() {
  try {
    await transport?.disconnect();
  } finally {
    setConnected(false);
    client = null;
    transport = null;
  }
}

function bindClient(nextClient) {
  nextClient.addEventListener("state", (event) => {
    els.connection.textContent = `${transportLabel()} ${event.detail.state}`;
  });

  nextClient.addEventListener("message", (event) => {
    logJson("trace", event.detail.message);
  });

  nextClient.addEventListener("event", (event) => {
    acceptEvent(event.detail.event);
  });

  nextClient.addEventListener("raw", (event) => {
    logLine("debug", event.detail.line);
  });

  nextClient.addEventListener("error", (event) => {
    logLine("error", event.detail.error?.message || "transport error");
  });
}

async function startupRefresh() {
  await refreshInfo();
  await refreshStatus();
  await sendCommand("config.get").then(updateConfig);
  await sendCommand("debug.get").then((data) => {
    if (data.levelName) els.debugLevel.value = data.levelName;
  });
}

async function refreshInfo() {
  const data = await sendCommand("system.info");
  lastInfo = data;
  els.version.textContent = data.firmwareVersion || "connected";
  els.deviceName.textContent = data.deviceName || data.deviceId || "device";
  renderFields();
  return data;
}

async function refreshStatus() {
  const data = await sendCommand("status.get");
  lastStatus = data;
  updateStatus(data);
  renderFields();
  return data;
}

async function getScript() {
  const data = await sendCommand("script.get");
  if (typeof data.code === "string" && data.code.length) {
    els.code.value = data.code;
    localStorage.setItem("p1_embed.editor.code", data.code);
  }
  updateScriptState(data);
}

async function setScript({ run, save }) {
  const data = await sendCommand("script.set", {
    code: els.code.value,
    run,
    save,
  });
  updateScriptState(data);
  await refreshStatus();
}

async function saveWifi() {
  const wifiSsid = els.wifiSsid.value.trim();
  const wifiPassword = els.wifiPassword.value;
  if (!wifiSsid && !wifiPassword) return;

  const data = {};
  if (wifiSsid) data.wifiSsid = wifiSsid;
  if (wifiPassword) data.wifiPassword = wifiPassword;

  const config = await sendCommand("config.set", data, { timeoutMs: 10000 });
  els.wifiPassword.value = "";
  updateConfig(config);
  await refreshStatus();
}

async function sendRaw() {
  try {
    JSON.parse(els.raw.value);
    await client?.sendRaw(els.raw.value);
    logLine("debug", `> ${els.raw.value}`);
  } catch (error) {
    logLine("error", error.message);
  }
}

async function sendCommand(name, data = {}, options = {}) {
  if (!client) throw new Error("No device connection");
  try {
    const response = await client.request(name, data, options);
    logLine("debug", `< ${name} ok`);
    return response;
  } catch (error) {
    logLine("error", `${name}: ${error.message}`);
    throw error;
  }
}

function acceptEvent(event) {
  const data = event.data || {};
  const level = data.level || (event.name?.includes("error") ? "error" : "info");
  const message = data.message || data.code || event.name;
  logLine(level, `${event.name}: ${message}`);

  if (event.name === "device.status" && data.status) updateStatus(data.status);
  if (event.name === "wifi.status") updateWifi(data.wifi || data);
  if (event.name === "script.state") updateScriptState(data);
  if (event.name === "device.boot") {
    if (data.info) lastInfo = data.info;
    if (data.status) updateStatus(data.status);
    renderFields();
  }
}

function updateStatus(status) {
  lastStatus = status;
  updateScriptState(status);
  updateWifi(status.wifi);
  if (status.deviceName) els.deviceName.textContent = status.deviceName;
}

function updateScriptState(data = {}) {
  const state = data.scriptState || data.state || "unknown";
  const stored = data.scriptStored ?? data.stored;
  const bytes = data.scriptBytes;
  els.scriptState.textContent = [
    state,
    stored === true ? "stored" : "",
    Number.isFinite(bytes) ? `${bytes} bytes` : "",
  ].filter(Boolean).join(" / ");
}

function updateWifi(wifi = {}) {
  if (!wifi) return;
  const state = wifi.connected ? `wifi ${wifi.ssid || "connected"}` : `wifi ${wifi.state || "offline"}`;
  els.wifiState.textContent = state;
  els.wifiState.classList.toggle("is-online", Boolean(wifi.connected));
  if (wifi.ssid) els.wifiSsid.value = wifi.ssid;
}

function updateConfig(config = {}) {
  if (config.deviceName) els.deviceName.textContent = config.deviceName;
  if (Array.isArray(config.wifiNetworks) && config.wifiNetworks[0]?.ssid) {
    els.wifiSsid.value = config.wifiNetworks[0].ssid;
  } else if (config.wifiSsid) {
    els.wifiSsid.value = config.wifiSsid;
  }
  renderFields();
}

function renderFields() {
  const rows = {
    name: lastInfo?.deviceName || lastStatus?.deviceName || "",
    id: lastInfo?.deviceId || lastStatus?.deviceId || "",
    firmware: [lastInfo?.firmwareName, lastInfo?.firmwareVersion].filter(Boolean).join(" "),
    protocol: lastInfo?.protocolVersion || "",
    wrench: lastInfo?.wrenchEngineVersion || "",
    heap: lastStatus?.freeHeap ? `${lastStatus.freeHeap} free` : "",
    loop: lastStatus?.wrenchLoopCount ?? "",
    task: lastStatus?.wrenchTaskRunning === true ? "running" : lastStatus?.wrenchTaskRunning === false ? "stopped" : "",
  };

  els.fields.replaceChildren(
    ...Object.entries(rows).flatMap(([key, value]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = key;
      dd.textContent = String(value || "-");
      return [dt, dd];
    }),
  );
}

function setConnected(isConnected) {
  els.connect.disabled = isConnected;
  els.disconnect.disabled = !isConnected;
  els.transportMode.disabled = isConnected;
  els.websocketUrl.disabled = isConnected || els.transportMode.value !== "websocket";
  els.connection.textContent = isConnected ? `${transportLabel()} connected` : "idle";
  els.connection.classList.toggle("is-online", isConnected);
}

function updateTransportControls() {
  const isWebSocket = els.transportMode.value === "websocket";
  els.websocketUrl.disabled = !isWebSocket || Boolean(client);
}

function logLine(level, message) {
  const stamp = new Date().toLocaleTimeString();
  consoleLines.push({ level, text: `[${stamp}] ${level.toUpperCase()} ${message}` });
  if (consoleLines.length > 500) consoleLines = consoleLines.slice(-500);
  renderConsole();
}

function logJson(level, data) {
  if (level === "trace" && els.debugLevel.value !== "trace") return;
  logLine(level, JSON.stringify(data));
}

function renderConsole() {
  els.console.replaceChildren(
    ...consoleLines.map((line) => {
      const span = document.createElement("span");
      span.className = `line-${line.level}`;
      span.textContent = `${line.text}\n`;
      return span;
    }),
  );
  els.console.scrollTop = els.console.scrollHeight;
}

function clearConsole() {
  consoleLines = [];
  renderConsole();
}
