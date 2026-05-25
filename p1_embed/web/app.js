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

const storage = {
  code: "p1_embed.editor.code",
  wsUrl: "p1_embed.websocket.url",
  wsName: "p1_embed.websocket.name",
  usbHint: "p1_embed.serial.hint",
  lastConnection: "p1_embed.connection.last",
  reconnectOnLoad: "p1_embed.connection.reconnectOnLoad",
  logLevel: "p1_embed.console.logLevel",
  sketchHistory: "p1_embed.editor.history",
};

const els = {
  tabs: [...document.querySelectorAll(".tab")],
  lowerTabs: [...document.querySelectorAll(".lower-tab")],
  lowerPanels: {
    console: document.querySelector("#console-panel"),
    info: document.querySelector("#info-panel"),
  },
  views: {
    coding: document.querySelector("#coding-view"),
    install: document.querySelector("#install-view"),
  },
  connect: document.querySelector("#connect-button"),
  connectDialog: document.querySelector("#connect-dialog"),
  recentWs: document.querySelector("#recent-ws-button"),
  recentWsLabel: document.querySelector("#recent-ws-label"),
  recentUsb: document.querySelector("#recent-usb-button"),
  recentUsbLabel: document.querySelector("#recent-usb-label"),
  usbConnect: document.querySelector("#usb-connect-button"),
  newWsToggle: document.querySelector("#new-ws-toggle-button"),
  newWsConnect: document.querySelector("#new-ws-connect-button"),
  newWsField: document.querySelector("#new-ws-field"),
  websocketUrl: document.querySelector("#websocket-url"),
  getScript: document.querySelector("#get-script-button"),
  reboot: document.querySelector("#reboot-button"),
  run: document.querySelector("#run-button"),
  stop: document.querySelector("#stop-button"),
  downloadCode: document.querySelector("#download-code-button"),
  sketchHistory: document.querySelector("#sketch-history"),
  rename: document.querySelector("#rename-button"),
  renameDialog: document.querySelector("#rename-dialog"),
  deviceNameInput: document.querySelector("#device-name-input"),
  deviceNameSave: document.querySelector("#device-name-save-button"),
  wifi: document.querySelector("#wifi-button"),
  wifiDialog: document.querySelector("#wifi-dialog"),
  wifiSave: document.querySelector("#wifi-save-button"),
  consoleActions: document.querySelector("#console-actions"),
  copyConsole: document.querySelector("#copy-console-button"),
  clearConsole: document.querySelector("#clear-console-button"),
  rawForm: document.querySelector("#raw-form"),
  rawSend: document.querySelector("#raw-send-button"),
  debugLevel: document.querySelector("#debug-level"),
  editorWrap: document.querySelector(".editor-wrap"),
  aceHost: document.querySelector("#ace-editor"),
  code: document.querySelector("#code-editor"),
  console: document.querySelector("#console-output"),
  raw: document.querySelector("#raw-input"),
  connection: document.querySelector("#connection-state"),
  scriptState: document.querySelector("#script-state"),
  fields: document.querySelector("#device-fields"),
  wifiSsid: document.querySelector("#wifi-ssid"),
  wifiPassword: document.querySelector("#wifi-password"),
};

let transport = null;
let client = null;
let editor = null;
let lastInfo = null;
let lastStatus = null;
let consoleLines = [];
let isBusy = false;
let knownUsbPortCount = 0;
let knownUsbLabel = "";
let suppressConnectionLogs = false;
let isUnloading = false;
let busyLabel = "";
let suppressEditorPersist = false;
let connectionGeneration = 0;
let statusTimer = null;
let editorErrorMarker = null;
let recentPressHandled = false;

boot();

function boot() {
  initEditor();
  setEditorValue("", { persist: false });
  els.websocketUrl.value = localStorage.getItem(storage.wsUrl) || els.websocketUrl.value;
  els.debugLevel.value = localStorage.getItem(storage.logLevel) || els.debugLevel.value;
  bindControls();
  bindLifecycle();
  renderRecentWebSocket();
  renderRecentUsb();
  renderSketchHistory();
  refreshKnownUsbPorts();
  setConnected(false);
  renderFields();
  autoReconnectLastConnection();

  if (!("serial" in navigator)) {
    logLine("warn", "Web Serial is not available in this browser");
  }
}

function bindLifecycle() {
  const markUnload = () => {
    isUnloading = true;
    localStorage.setItem(storage.reconnectOnLoad, client && transport?.connected ? "1" : "0");
  };
  window.addEventListener("beforeunload", markUnload);
  window.addEventListener("pagehide", markUnload);
}

function initEditor() {
  if (window.ace) {
    editor = window.ace.edit(els.aceHost);
    editor.setTheme("ace/theme/chaos");
    editor.session.setMode("ace/mode/javascript");
    editor.session.setUseWorker(false);
    editor.session.setUseWrapMode(true);
    editor.session.setTabSize(2);
    editor.session.setUseSoftTabs(true);
    editor.setOptions({
      fontSize: "13px",
      showPrintMargin: false,
      useWorker: false,
      wrap: false,
    });
    editor.session.on("change", () => {
      clearEditorError();
      if (suppressEditorPersist) return;
      localStorage.setItem(storage.code, getEditorValue());
      updateEnabledState();
    });
    els.aceHost.classList.add("is-active");
    els.code.classList.add("is-hidden");
  } else {
    els.code.addEventListener("input", () => {
      clearEditorError();
      localStorage.setItem(storage.code, getEditorValue());
      updateEnabledState();
    });
  }
}

function getEditorValue() {
  return editor ? editor.getValue() : els.code.value;
}

function setEditorValue(value, { persist = true } = {}) {
  suppressEditorPersist = !persist;
  try {
    if (editor) {
      editor.setValue(value, -1);
    }
    els.code.value = value;
  } finally {
    suppressEditorPersist = false;
  }
  if (persist) localStorage.setItem(storage.code, value);
  updateEnabledState();
}

function bindControls() {
  els.tabs.forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
  els.lowerTabs.forEach((tab) => tab.addEventListener("click", () => switchLowerPanel(tab.dataset.panel)));
  els.connect.addEventListener("click", toggleConnection);
  bindLongPressDelete(els.recentWs, forgetRecentWebSocket);
  bindLongPressDelete(els.recentUsb, forgetRecentUsb);
  els.recentWs.addEventListener("click", () => {
    if (consumeRecentLongPress()) return;
    connectWebSocket(localStorage.getItem(storage.wsUrl) || "");
  });
  els.recentUsb.addEventListener("click", () => {
    if (consumeRecentLongPress()) return;
    connectRecentUsb();
  });
  els.usbConnect.addEventListener("click", connectUsb);
  els.newWsToggle.addEventListener("click", showNewWsField);
  els.newWsConnect.addEventListener("click", () => connectWebSocket(els.websocketUrl.value));
  els.websocketUrl.addEventListener("input", () => renderRecentWebSocket());
  els.getScript.addEventListener("click", () => runUiAction(getScript, "reading"));
  els.reboot.addEventListener("click", () => runUiAction(() => sendCommand("device.reboot"), "rebooting"));
  els.run.addEventListener("click", () => runUiAction(() => setScript({ run: true, save: true }), "uploading"));
  els.stop.addEventListener("click", () => runUiAction(() => sendCommand("script.stop").then(refreshStatus), "stopping"));
  els.downloadCode.addEventListener("click", downloadCode);
  els.sketchHistory.addEventListener("change", recoverSketchHistory);
  bindSketchDrop();
  els.rename.addEventListener("click", openRenameDialog);
  els.deviceNameSave.addEventListener("click", () => runUiAction(saveDeviceName, "rename"));
  els.wifi.addEventListener("click", openWifiDialog);
  els.wifiSave.addEventListener("click", () => runUiAction(saveWifi, "wifi"));
  els.copyConsole.addEventListener("click", copyConsole);
  els.clearConsole.addEventListener("click", clearConsole);
  els.rawForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runUiAction(sendRaw, "sending");
  });
  els.debugLevel.addEventListener("change", () => {
    localStorage.setItem(storage.logLevel, els.debugLevel.value);
    if (client) runUiAction(() => sendCommand("debug.set", { level: els.debugLevel.value }), "debug");
  });
}

function switchTab(name) {
  els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === name));
  Object.entries(els.views).forEach(([key, view]) => view.classList.toggle("is-active", key === name));
  if (name === "coding" && editor) {
    requestAnimationFrame(() => editor.resize());
  }
}

function switchLowerPanel(name) {
  els.lowerTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.panel === name));
  Object.entries(els.lowerPanels).forEach(([key, panel]) => panel.classList.toggle("is-active", key === name));
  els.consoleActions.classList.toggle("is-hidden", name !== "console");
}

function openConnectDialog() {
  renderRecentWebSocket();
  refreshKnownUsbPorts();
  els.newWsField.classList.add("is-hidden");
  els.newWsConnect.classList.add("is-hidden");
  els.connectDialog.showModal();
}

function toggleConnection() {
  if (client) {
    disconnectTransport();
  } else {
    openConnectDialog();
  }
}

function closeConnectDialog() {
  if (els.connectDialog.open) els.connectDialog.close();
}

function showNewWsField() {
  els.newWsField.classList.remove("is-hidden");
  els.newWsConnect.classList.remove("is-hidden");
  els.websocketUrl.focus();
  els.websocketUrl.select();
}

function renderRecentWebSocket() {
  const saved = localStorage.getItem(storage.wsUrl) || "";
  const label = localStorage.getItem(storage.wsName) || wsDisplayName(saved);
  els.recentWsLabel.textContent = label || "WebSocket";
  els.recentWs.title = saved ? `Recent WebSocket: ${label}` : "Recent WebSocket";
  els.recentWs.setAttribute("aria-label", els.recentWs.title);
  els.recentWs.disabled = !saved || Boolean(client) || isBusy;
}

function renderRecentUsb() {
  const hint = readUsbHint();
  const label = knownUsbLabel || (hint ? usbHintLabel(hint) : "");
  els.recentUsbLabel.textContent = label ? `USB ${label}` : "USB";
  els.recentUsb.title = label ? `Recent USB: ${label}` : "Recent USB";
  els.recentUsb.setAttribute("aria-label", els.recentUsb.title);
  els.recentUsb.disabled = (!label && knownUsbPortCount <= 0) || Boolean(client) || isBusy || !("serial" in navigator);
}

function bindLongPressDelete(button, onDelete) {
  let timer = null;

  const clear = () => {
    if (!timer) return;
    window.clearTimeout(timer);
    timer = null;
  };

  button.addEventListener("pointerdown", () => {
    if (button.disabled) return;
    clear();
    timer = window.setTimeout(() => {
      timer = null;
      recentPressHandled = true;
      onDelete();
    }, 3000);
  });

  ["pointerup", "pointerleave", "pointercancel", "lostpointercapture"].forEach((name) => {
    button.addEventListener(name, clear);
  });
}

function consumeRecentLongPress() {
  if (!recentPressHandled) return false;
  recentPressHandled = false;
  return true;
}

function forgetRecentWebSocket() {
  localStorage.removeItem(storage.wsUrl);
  localStorage.removeItem(storage.wsName);
  if (localStorage.getItem(storage.lastConnection) === "websocket") {
    localStorage.removeItem(storage.lastConnection);
    localStorage.setItem(storage.reconnectOnLoad, "0");
  }
  renderRecentWebSocket();
  logLine("info", "removed recent WebSocket");
}

function forgetRecentUsb() {
  localStorage.removeItem(storage.usbHint);
  if (localStorage.getItem(storage.lastConnection) === "usb") {
    localStorage.removeItem(storage.lastConnection);
    localStorage.setItem(storage.reconnectOnLoad, "0");
  }
  knownUsbLabel = "";
  knownUsbPortCount = 0;
  renderRecentUsb();
  logLine("info", "removed recent USB");
}

async function refreshKnownUsbPorts() {
  if (!("serial" in navigator)) {
    knownUsbPortCount = 0;
    knownUsbLabel = "";
    renderRecentUsb();
    return;
  }
  try {
    const ports = await navigator.serial.getPorts();
    knownUsbPortCount = ports.length;
    const hinted = pickPortFromHint(ports, readUsbHint());
    const port = hinted || ports[0] || null;
    knownUsbLabel = port ? usbHintLabel(port.getInfo?.() || {}) : "";
  } catch {
    knownUsbPortCount = 0;
    knownUsbLabel = "";
  }
  renderRecentUsb();
}

async function runUiAction(action, label = "busy") {
  if (isBusy) return;
  isBusy = true;
  busyLabel = label;
  updateEnabledState();
  try {
    await action();
  } catch {
  } finally {
    isBusy = false;
    busyLabel = "";
    updateEnabledState();
  }
}

async function connectWebSocket(value) {
  const url = normalizeWebSocketUrl(value);
  await connectTransport(new WebSocketTransport(), { url }, "websocket", wsDisplayName(url));
  els.websocketUrl.value = url;
  renderRecentWebSocket();
}

async function connectUsb() {
  await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), {}, "usb", "USB");
  await refreshKnownUsbPorts();
  renderRecentUsb();
}

async function connectRecentUsb() {
  await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), { pickPort: false }, "usb", "USB");
  await refreshKnownUsbPorts();
  renderRecentUsb();
}

async function autoReconnectLastConnection() {
  const last = localStorage.getItem(storage.lastConnection);
  const shouldReconnect = localStorage.getItem(storage.reconnectOnLoad) === "1";
  if (client || isBusy || !last || !shouldReconnect) return;

  if (last === "websocket") {
    const url = localStorage.getItem(storage.wsUrl) || "";
    if (!url) return;
    await connectTransport(new WebSocketTransport(), { url }, "websocket", wsDisplayName(url), { quiet: true, lightStartup: true, includeScript: true });
    return;
  }

  if (last === "usb") {
    if (!("serial" in navigator) || !readUsbHint()) return;
    await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), { pickPort: false }, "usb", "USB", { quiet: true, lightStartup: true, includeScript: true });
    await refreshKnownUsbPorts();
  }
}

async function connectTransport(nextTransport, options, kind, label, { quiet = false, lightStartup = false, includeScript = true } = {}) {
  const generation = connectionGeneration + 1;
  connectionGeneration = generation;
  suppressConnectionLogs = quiet;
  isBusy = true;
  busyLabel = "connecting";
  updateEnabledState();
  try {
    await disconnectTransport({ quiet: true, keepGeneration: true });
    transport = nextTransport;
    transport.kind = kind;
    transport.label = label;
    client = new ProtocolClient(transport);
    bindClient(client);
    const ok = await transport.connect(options);
    if (generation !== connectionGeneration) {
      await nextTransport.disconnect?.();
      return;
    }
    if (!ok) throw new Error(`${label} device was not available`);
    closeConnectDialog();
    setConnected(true);
    startStatusPolling();
    if (!quiet) logLine("info", `${label} connected`);
  } catch (error) {
    if (generation !== connectionGeneration) return;
    if (!quiet) logLine("error", error.message);
    await disconnectTransport({ quiet: true, keepGeneration: true });
    setConnected(false);
    return;
  } finally {
    if (generation === connectionGeneration) {
      suppressConnectionLogs = false;
      isBusy = false;
      busyLabel = "";
      updateEnabledState();
    }
  }

  try {
    if (lightStartup) await settle(450);
    if (generation !== connectionGeneration) return;
    await startupRefresh({ quiet, includeScript });
    if (generation === connectionGeneration) rememberSuccessfulConnection(kind, label, options);
  } catch (error) {
    if (generation === connectionGeneration && !quiet) logLine("error", `startup refresh: ${error.message}`);
    if (generation === connectionGeneration) forgetUnverifiedConnection(kind, options);
  }
}

function rememberSuccessfulConnection(kind, label, options = {}) {
  localStorage.setItem(storage.lastConnection, kind);
  localStorage.setItem(storage.reconnectOnLoad, "1");

  if (kind === "websocket" && options.url) {
    const url = normalizeWebSocketUrl(options.url);
    localStorage.setItem(storage.wsUrl, url);
    localStorage.setItem(storage.wsName, wsDisplayName(url));
    els.websocketUrl.value = url;
    renderRecentWebSocket();
  }

  if (kind === "usb") {
    refreshKnownUsbPorts();
    renderRecentUsb();
  }
}

function forgetUnverifiedConnection(kind, options = {}) {
  if (kind !== "websocket" || !options.url) return;
  const attempted = normalizeWebSocketUrl(options.url);
  if (localStorage.getItem(storage.wsUrl) === attempted) {
    localStorage.removeItem(storage.wsUrl);
    localStorage.removeItem(storage.wsName);
    renderRecentWebSocket();
  }
  if (localStorage.getItem(storage.lastConnection) === kind) {
    localStorage.removeItem(storage.lastConnection);
    localStorage.setItem(storage.reconnectOnLoad, "0");
  }
}

function readUsbHint() {
  try {
    const raw = localStorage.getItem(storage.usbHint);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function usbHintLabel(hint) {
  const vendor = Number(hint?.usbVendorId);
  const product = Number(hint?.usbProductId);
  if (!Number.isFinite(vendor) || !Number.isFinite(product)) return "device";
  return `${vendor.toString(16).padStart(4, "0")}:${product.toString(16).padStart(4, "0")}`;
}

function pickPortFromHint(ports, hint) {
  if (!hint || !Array.isArray(ports)) return null;
  const vendor = Number(hint.usbVendorId);
  const product = Number(hint.usbProductId);
  if (!Number.isFinite(vendor) || !Number.isFinite(product)) return null;
  return ports.find((port) => {
    const info = port.getInfo?.() || {};
    return info.usbVendorId === vendor && info.usbProductId === product;
  }) || null;
}

function normalizeWebSocketUrl(value) {
  const raw = value.trim();
  if (!raw) throw new Error("WebSocket URL is required");
  const withScheme = /^wss?:\/\//i.test(raw) ? raw : `ws://${raw}`;
  const url = new URL(withScheme);
  if (!url.port) url.port = "81";
  if (!url.pathname || url.pathname === "") url.pathname = "/";
  return url.toString();
}

function wsDisplayName(url) {
  if (!url) return "";
  try {
    const parsed = new URL(normalizeWebSocketUrl(url));
    return parsed.host || parsed.hostname || url;
  } catch {
    return url;
  }
}

async function disconnectTransport({ quiet = false, keepGeneration = false } = {}) {
  if (!keepGeneration) connectionGeneration += 1;
  try {
    await transport?.disconnect();
  } finally {
    client = null;
    transport = null;
    stopStatusPolling();
    if (!isUnloading) localStorage.setItem(storage.reconnectOnLoad, "0");
    setConnected(false);
    if (!quiet) logLine("info", "disconnected");
  }
}

function settle(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bindClient(nextClient) {
  nextClient.addEventListener("state", (event) => {
    if (nextClient !== client) return;
    renderConnectionState(event.detail.state);
    if (event.detail.state === "connected") closeConnectDialog();
    if (event.detail.state === "disconnected" && !isUnloading) {
      localStorage.setItem(storage.reconnectOnLoad, "0");
    }
  });

  nextClient.addEventListener("message", (event) => {
    if (nextClient !== client) return;
    logJson("trace", event.detail.message);
  });

  nextClient.addEventListener("event", (event) => {
    if (nextClient !== client) return;
    acceptEvent(event.detail.event);
  });

  nextClient.addEventListener("raw", (event) => {
    if (nextClient !== client) return;
    logJson("trace", event.detail.line);
  });

  nextClient.addEventListener("response", (event) => {
    if (nextClient !== client) return;
    const response = event.detail.response || {};
    if (event.detail.late) {
      logLine("warn", `< late response id=${response.id ?? "?"}`);
    }
  });

  nextClient.addEventListener("error", (event) => {
    if (nextClient !== client) return;
    if (suppressConnectionLogs) return;
    logLine("error", event.detail.error?.message || "transport error");
  });
}

async function startupRefresh({ quiet = false, includeScript = true } = {}) {
  await bestEffortStartupStep(() => refreshInfo({ quiet }), quiet);
  await bestEffortStartupStep(() => refreshStatus({ quiet }), quiet);
  await bestEffortStartupStep(() => sendCommand("config.get", {}, { quiet }).then(updateConfig), quiet);
  await bestEffortStartupStep(async () => {
    const data = await sendCommand("debug.get", {}, { quiet });
    if (data.levelName && !localStorage.getItem(storage.logLevel)) {
      els.debugLevel.value = data.levelName;
    }
    await sendCommand("debug.set", { level: els.debugLevel.value }, { quiet });
  }, quiet);
  if (includeScript) await bestEffortStartupStep(() => getScript({ quiet }), quiet);
}

async function bestEffortStartupStep(action, quiet) {
  try {
    await action();
  } catch (error) {
    if (!quiet) logLine("warn", `startup: ${error.message}`);
  }
}

function startStatusPolling() {
  stopStatusPolling();
  statusTimer = window.setInterval(async () => {
    if (!client || isBusy) return;
    try {
      await refreshStatus({ quiet: true, timeoutMs: 6000 });
    } catch {
    }
  }, 5000);
}

function stopStatusPolling() {
  if (!statusTimer) return;
  window.clearInterval(statusTimer);
  statusTimer = null;
}

async function refreshInfo(options = {}) {
  const data = await sendCommand("system.info", {}, options);
  lastInfo = data;
  renderFields();
  return data;
}

async function refreshStatus(options = {}) {
  const data = await sendCommand("status.get", {}, options);
  updateStatus(data);
  renderFields();
  return data;
}

async function getScript(options = {}) {
  const data = await sendCommand("script.get", {}, options);
  if (typeof data.code === "string") {
    setEditorValue(data.code, { persist: false });
  }
  updateScriptState(data);
}

async function setScript({ run, save }) {
  const code = getEditorValue();
  let data;
  try {
    clearEditorError();
    data = await sendCommand("script.set", {
      code,
      run,
      save,
    }, { timeoutMs: 30000 });
  } catch (error) {
    rememberUploadedSketch(code);
    markEditorError(error.message);
    throw error;
  }
  rememberUploadedSketch(code);
  updateScriptState(data);
  await refreshStatus({ timeoutMs: 20000 });
}

function downloadCode() {
  const code = getEditorValue();
  if (!code.trim()) return;
  const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `p1e-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.wrench`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function readSketchHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(storage.sketchHistory) || "[]");
    return Array.isArray(value) ? value.filter((item) => typeof item?.code === "string") : [];
  } catch {
    return [];
  }
}

function rememberUploadedSketch(code) {
  const current = String(code ?? "");
  if (!current.trim()) return;

  const history = readSketchHistory();
  if (history[0]?.code === current) return;

  const entry = {
    at: new Date().toISOString(),
    bytes: new Blob([current]).size,
    code: current,
  };

  let next = [entry, ...history].slice(0, 20);
  while (next.length) {
    try {
      localStorage.setItem(storage.sketchHistory, JSON.stringify(next));
      renderSketchHistory();
      return;
    } catch {
      next = next.slice(0, -1);
    }
  }
}

function renderSketchHistory() {
  const history = readSketchHistory();
  els.sketchHistory.replaceChildren(new Option("history", ""));
  history.forEach((item, index) => {
    const date = new Date(item.at);
    const when = Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    els.sketchHistory.append(new Option(`${when} / ${formatBytes(item.bytes || item.code.length)}`, String(index)));
  });
  els.sketchHistory.disabled = history.length === 0;
  els.sketchHistory.value = "";
}

function recoverSketchHistory() {
  const index = Number(els.sketchHistory.value);
  const entry = readSketchHistory()[index];
  els.sketchHistory.value = "";
  if (!entry) return;
  setEditorValue(entry.code);
  logLine("info", `recovered sketch from ${new Date(entry.at).toLocaleString()}`);
}

function bindSketchDrop() {
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  ["dragenter", "dragover"].forEach((name) => {
    els.editorWrap.addEventListener(name, (event) => {
      stop(event);
      els.editorWrap.classList.add("is-dragover");
    });
  });

  ["dragleave", "dragend"].forEach((name) => {
    els.editorWrap.addEventListener(name, (event) => {
      stop(event);
      els.editorWrap.classList.remove("is-dragover");
    });
  });

  els.editorWrap.addEventListener("drop", async (event) => {
    stop(event);
    els.editorWrap.classList.remove("is-dragover");
    const file = event.dataTransfer?.files?.[0];
    const text = file ? await file.text() : event.dataTransfer?.getData("text/plain");
    if (!text) return;
    setEditorValue(text);
    logLine("info", file ? `loaded ${file.name}` : "loaded dropped text");
  });
}

function formatBytes(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} KB`;
}

function openWifiDialog() {
  els.wifiDialog.showModal();
}

function openRenameDialog() {
  els.deviceNameInput.value = lastInfo?.deviceName || lastStatus?.deviceName || "";
  els.renameDialog.showModal();
  els.deviceNameInput.focus();
  els.deviceNameInput.select();
}

async function saveDeviceName() {
  const deviceName = els.deviceNameInput.value.trim();
  if (!deviceName) return;
  const config = await sendCommand("config.set", { deviceName }, { timeoutMs: 10000 });
  updateConfig(config);
  lastInfo = { ...(lastInfo || {}), deviceName };
  lastStatus = { ...(lastStatus || {}), deviceName };
  await refreshStatus({ quiet: true, timeoutMs: 6000 });
  renderFields();
  if (els.renameDialog.open) els.renameDialog.close();
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
  if (els.wifiDialog.open) els.wifiDialog.close();
}

async function sendRaw() {
  try {
    const line = els.raw.value.trim();
    JSON.parse(line);
    await client?.sendRaw(line);
    logLine("debug", `> ${line}`);
  } catch (error) {
    logLine("error", error.message);
  }
}

async function sendCommand(name, data = {}, options = {}) {
  if (!client) throw new Error("No device connection");
  const { quiet = false, ...requestOptions } = options;
  try {
    const response = await client.request(name, data, requestOptions);
    if (!quiet) logLine("debug", `< ${name} ok`);
    return response;
  } catch (error) {
    if (!quiet) logLine("error", `${name}: ${error.message}`);
    throw error;
  }
}

function acceptEvent(event) {
  const data = event.data || {};
  const level = data.level || (event.name?.includes("error") ? "error" : "info");

  if (event.name === "device.status" && data.status) {
    updateStatus(data.status);
    return;
  }

  const message = eventMessage(event.name, data);
  logLine(level, `${event.name}: ${message}`);

  if (event.name === "script.error") markEditorError(message);
  if (event.name === "wifi.status") updateWifi(data.wifi || data);
  if (event.name === "script.state") updateScriptState(data);
  if (event.name === "device.boot") {
    if (data.info) lastInfo = data.info;
    if (data.status) updateStatus(data.status);
    renderFields();
  }
}

function eventMessage(name, data = {}) {
  if (name === "script.state") {
    return [
      data.state || data.scriptState || "unknown",
      data.source ? `source ${data.source}` : "",
      data.autorun ? String(data.autorun).replaceAll("_", " ") : "",
      data.bootReason ? String(data.bootReason).replaceAll("_", " ") : "",
    ].filter(Boolean).join(" / ");
  }

  if (name === "wifi.status") {
    return [
      data.status || data.state || "unknown",
      data.ssid || "",
      data.ip || "",
    ].filter(Boolean).join(" / ");
  }

  if (name === "led.status") {
    return data.status || data.message || data.code || "updated";
  }

  return data.message || data.code || data.status || data.state || name;
}

function markEditorError(message) {
  const parsed = parseWrenchErrorLocation(message);
  if (!parsed) return;

  if (editor) {
    clearEditorError();
    const row = Math.max(0, parsed.line - 1);
    editor.session.setAnnotations([{
      row,
      column: Math.max(0, parsed.column),
      text: parsed.text,
      type: "error",
    }]);
    editorErrorMarker = editor.session.addMarker(
      new window.ace.Range(row, 0, row, 1),
      "wrench-error-line",
      "fullLine",
    );
    editor.scrollToLine(row, true, true, () => {});
    return;
  }

  els.code.dataset.errorLine = String(parsed.line);
}

function clearEditorError() {
  if (editor) {
    editor.session.clearAnnotations();
    if (editorErrorMarker !== null) {
      editor.session.removeMarker(editorErrorMarker);
      editorErrorMarker = null;
    }
  }
  delete els.code.dataset.errorLine;
}

function parseWrenchErrorLocation(message = "") {
  const text = String(message);
  const lineMatch = text.match(/\bline:\s*(\d+)/i) || text.match(/^\s*(\d+)\s+/m);
  if (!lineMatch) return null;

  let line = Number(lineMatch[1]);
  if (!Number.isFinite(line) || line <= 0) return null;

  let codeColumnOffset = 0;
  const numberedSourceLine = text.split("\n").find((part) => /^\s*\d+\s+\S/.test(part));
  if (numberedSourceLine) {
    const sourceMatch = numberedSourceLine.match(/^\s*\d+\s+(.*)$/);
    const sourceText = sourceMatch?.[1]?.trimEnd() || "";
    const editorLine = findEditorLine(sourceText);
    if (editorLine > 0) {
      line = editorLine;
      codeColumnOffset = numberedSourceLine.indexOf(sourceMatch[1]);
    }
  }

  const caretLine = text.split("\n").find((part) => part.includes("^")) || "";
  const column = Math.max(0, caretLine.indexOf("^") - codeColumnOffset);
  const errLine = text.split("\n").find((part) => /^err:/i.test(part.trim()));

  return {
    line,
    column,
    text: errLine ? errLine.trim() : text.split("\n")[0] || "Wrench error",
  };
}

function findEditorLine(sourceText) {
  const needle = String(sourceText || "").trim();
  if (!needle) return 0;
  const lines = getEditorValue().split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === needle);
  return index >= 0 ? index + 1 : 0;
}

function updateStatus(status = {}) {
  lastStatus = status;
  updateScriptState(status);
  updateWifi(status.wifi);
  renderConnectionState();
  renderFields();
}

function updateScriptState(data = {}) {
  const state = data.scriptState || data.state || "unknown";
  const stored = data.scriptStored ?? data.stored;
  const bytes = data.scriptBytes;
  const hash = data.scriptHash;
  els.scriptState.textContent = [
    state,
    stored === true ? "stored" : "",
    Number.isFinite(bytes) ? `${bytes} bytes` : "",
    Number.isFinite(hash) ? `#${hash.toString(16)}` : "",
  ].filter(Boolean).join(" / ");
}

function updateWifi(wifi = {}) {
  if (!wifi) return;
  if (wifi.ssid) els.wifiSsid.value = wifi.ssid;
}

function updateConfig(config = {}) {
  if (config.deviceName) {
    lastInfo = { ...(lastInfo || {}), deviceName: config.deviceName };
    lastStatus = { ...(lastStatus || {}), deviceName: config.deviceName };
  }
  if (Array.isArray(config.wifiNetworks) && config.wifiNetworks[0]?.ssid) {
    els.wifiSsid.value = config.wifiNetworks[0].ssid;
  } else if (config.wifiSsid) {
    els.wifiSsid.value = config.wifiSsid;
  }
  renderFields();
}

function renderFields() {
  const wifi = lastStatus?.wifi || {};
  const web = lastStatus?.web || {};
  const wsUrl = websocketUrlFromStatus(web);
  const rows = {
    name: lastInfo?.deviceName || lastStatus?.deviceName || "",
    id: lastInfo?.deviceId || lastStatus?.deviceId || "",
    firmware: [lastInfo?.firmwareName, lastInfo?.firmwareVersion].filter(Boolean).join(" "),
    protocol: lastInfo?.protocolVersion || "",
    uptime: formatDuration(lastStatus?.uptimeMs),
    script: els.scriptState.textContent || "",
    wrenchFps: wrenchFpsLabel(),
    memory: memoryStatusLabel(),
    heap: lastStatus?.freeHeap ? `${lastStatus.freeHeap} free` : "",
    maxAlloc: lastStatus?.maxAllocHeap || "",
    wifi: wifi.connected ? wifi.ssid || "connected" : wifi.state || "offline",
    ip: wifi.ip || "",
    ws: wsUrl,
    loop: lastStatus?.wrenchLoopCount ?? "",
    task: lastStatus?.wrenchTaskRunning === true ? "running" : lastStatus?.wrenchTaskRunning === false ? "stopped" : "",
  };

  els.fields.replaceChildren(
    ...Object.entries(rows).map(([key, value]) => {
      const row = document.createElement("div");
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      row.className = "field-row";
      dt.textContent = key;
      if (key === "ws" && value) {
        const button = document.createElement("button");
        button.className = "info-link";
        button.type = "button";
        button.textContent = String(value);
        button.title = "Connect WebSocket";
        button.addEventListener("click", () => connectWebSocket(String(value)));
        dd.append(button);
      } else {
        dd.textContent = String(value || "-");
      }
      row.append(dt, dd);
      return row;
    }),
  );
}

function websocketUrlFromStatus(web = {}) {
  const host = web.host || lastInfo?.web?.host || "";
  if (!host) return "";
  const port = Number(web.port || lastInfo?.web?.port || 81);
  const hostWithPort = host.includes(":") ? host : `${host}:${Number.isFinite(port) ? port : 81}`;
  try {
    return normalizeWebSocketUrl(hostWithPort);
  } catch {
    return hostWithPort;
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(Number(ms) / 1000);
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "";

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function wrenchFpsLabel() {
  const lastLoopMs = Number(lastStatus?.wrenchLastLoopMs);
  if (Number.isFinite(lastLoopMs) && lastLoopMs > 0) {
    return `${(1000 / lastLoopMs).toFixed(lastLoopMs < 100 ? 1 : 2)} fps`;
  }

  const loops = Number(lastStatus?.wrenchLoopCount);
  const uptimeMs = Number(lastStatus?.uptimeMs);
  if (Number.isFinite(loops) && loops > 0 && Number.isFinite(uptimeMs) && uptimeMs > 0) {
    return `${(loops / (uptimeMs / 1000)).toFixed(2)} fps avg`;
  }

  return "";
}

function setConnected(isConnected) {
  els.connection.classList.toggle("is-online", isConnected);
  renderConnectionState();
  updateEnabledState();
  renderRecentWebSocket();
  renderRecentUsb();
}

function renderConnectionState(transportState = "") {
  if (!client) {
    els.connection.textContent = "not connected";
    return;
  }

  const parts = [transport?.label || "device"];
  if (isBusy && busyLabel) {
    parts.push(busyLabel);
  } else {
    parts.push(scriptStatusLabel());
  }
  parts.push(wifiStatusLabel());
  parts.push(memoryStatusLabel());

  const state = transportState && transportState !== "connected" ? transportState : "";
  if (state) parts.push(state);
  els.connection.textContent = parts.filter(Boolean).join(" | ");
}

function scriptStatusLabel() {
  const runtime = lastStatus?.wrenchRuntime || {};
  if (runtime.transitionActive) return runtime.transitionReason ? `paused ${runtime.transitionReason}` : "paused";
  if (runtime.runPending) return "run pending";
  if (lastStatus?.wrenchLoopHung) return "loop hung";

  const state = lastStatus?.scriptState || "connected";
  if (state === "running") return "running";
  if (state === "stopped") return "stopped";
  if (state === "compiled") return "compiled";
  if (state === "empty") return "empty";
  if (state === "error") return "error";
  return state;
}

function wifiStatusLabel() {
  const wifi = lastStatus?.wifi;
  if (!wifi) return "";
  if (wifi.connected) return wifi.ssid ? `wifi ${wifi.ssid}` : "wifi ok";
  return `wifi ${wifi.state || "off"}`;
}

function memoryStatusLabel() {
  const free = Number(lastStatus?.freeHeap);
  const total = Number(lastStatus?.heapSize || lastInfo?.heapSize || 327680);
  if (Number.isFinite(free) && Number.isFinite(total) && total > 0) {
    const usedPct = Math.max(0, Math.min(100, Math.round((1 - free / total) * 100)));
    return `mem ${usedPct}%`;
  }
  return "";
}

function updateEnabledState() {
  const connected = Boolean(client);
  els.connect.disabled = isBusy;
  els.connect.classList.toggle("primary", !connected);
  els.connect.classList.remove("danger");
  els.connect.title = connected ? "Disconnect" : "Connect";
  els.connect.setAttribute("aria-label", els.connect.title);
  els.connect.querySelector(".material-symbols-rounded").textContent = connected ? "link_off" : "link";
  els.downloadCode.disabled = !getEditorValue().trim();
  [
    els.getScript,
    els.reboot,
    els.run,
    els.stop,
    els.rename,
    els.deviceNameSave,
    els.wifi,
    els.wifiSave,
    els.raw,
    els.rawSend,
  ].forEach((el) => {
    el.disabled = !connected || isBusy;
  });
  renderRecentWebSocket();
  renderRecentUsb();
  renderConnectionState();
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

async function copyConsole() {
  const text = consoleLines.map((line) => line.text).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    logLine("info", "console copied");
  } catch (error) {
    logLine("error", error.message || "copy failed");
  }
}
