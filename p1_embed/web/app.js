import { ProtocolClient } from "./protocol/ProtocolClient.js?v=0.1.87-ui179";
import { canEncodeCommand } from "./protocol/P1MsgPack.js?v=0.1.87-ui179";
import { WebSerialTransport } from "./protocol/WebSerialTransport.js?v=0.1.87-ui179";
import { WebSocketTransport } from "./protocol/WebSocketTransport.js";
import { MqttWebRtcTransport, MQTT_WEBRTC_TRANSPORT_VERSION } from "./protocol/MqttWebRtcTransport.js?v=0.1.87-ui179";
import { MqttTransport, MQTT_TRANSPORT_VERSION } from "./protocol/MqttTransport.js?v=0.1.87-ui179";
import { P1WebFlasher } from "./web-flasher.js?v=0.1.87-ui179";
import { inferCircuitLayout, initCircuitView, normalizeCircuitLayout } from "./circuit.js?v=0.1.87-ui179";
import { initGuinoView } from "./guino.js?v=0.1.87-ui179";

const WEB_UI_VERSION = "0.1.87-ui179";
const CHAT_MAX_OUTPUT_TOKENS = 8000;
console.info(`[P1E web] loaded ${WEB_UI_VERSION}`, { mqtt: MQTT_TRANSPORT_VERSION, mqttWebRtc: MQTT_WEBRTC_TRANSPORT_VERSION });

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
  wsHistory: "p1_embed.websocket.history",
  peerId: "p1_embed.peerjs.remoteId",
  peerHistory: "p1_embed.peerjs.history",
  mqttHost: "p1_embed.mqtt.host",
  mqttPort: "p1_embed.mqtt.port",
  mqttRoot: "p1_embed.mqtt.root.v2",
  mqttUser: "p1_embed.mqtt.user",
  mqttPassword: "p1_embed.mqtt.password",
  usbHint: "p1_embed.serial.hint",
  usbHistory: "p1_embed.serial.history",
  lastConnection: "p1_embed.connection.last",
  reconnectOnLoad: "p1_embed.connection.reconnectOnLoad",
  activeTab: "p1_embed.workspace.activeTab",
  logLevel: "p1_embed.console.logLevel",
  consoleTimestamps: "p1_embed.console.timestamps",
  sketchHistory: "p1_embed.editor.history",
  chatApiKey: "p1_embed.chat.apiKey",
  chatModel: "p1_embed.chat.model",
  chatHistory: "p1_embed.chat.history",
  chatDebugPrompt: "p1_embed.chat.debugPrompt",
};

const chatModelOptions = [
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.4-nano",
  "gpt-5.4-mini",
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4.1-mini",
];

const defaultChatModel = "gpt-5.4-mini";
const chatHistoryLimit = 15;
const sketchHistoryLimit = 50;
const connectionHistoryLimit = 12;
const sketchDbName = "p1_embed";
const sketchDbVersion = 1;
const sketchStoreName = "sketch_history";

const els = {
  tabs: [...document.querySelectorAll(".tab")],
  lowerTabs: [...document.querySelectorAll(".lower-tab")],
  lowerPanels: {
    console: document.querySelector("#console-panel"),
    info: document.querySelector("#info-panel"),
  },
  views: {
    coding: document.querySelector("#coding-view"),
    chat: document.querySelector("#chat-view"),
    circuit: document.querySelector("#circuit-view"),
    ui: document.querySelector("#ui-view"),
    install: document.querySelector("#install-view"),
  },
  brandVersion: document.querySelector("#brand-version"),
  connect: document.querySelector("#connect-button"),
  chatConnect: document.querySelector("#chat-connect-button"),
  chatUploadStatus: document.querySelector("#chat-upload-status"),
  chatUploadStatusLabel: document.querySelector("#chat-upload-status-label"),
  chatUploadStatusProgress: document.querySelector("#chat-upload-status-progress"),
  connectDialog: document.querySelector("#connect-dialog"),
  connectionHistory: document.querySelector("#connection-history"),
  usbConnect: document.querySelector("#usb-connect-button"),
  newWsToggle: document.querySelector("#new-ws-toggle-button"),
  newWsConnect: document.querySelector("#new-ws-connect-button"),
  newWsField: document.querySelector("#new-ws-field"),
  websocketUrl: document.querySelector("#websocket-url"),
  newPeerToggle: document.querySelector("#new-peer-toggle-button"),
  newPeerConnect: document.querySelector("#new-peer-connect-button"),
  newPeerField: document.querySelector("#new-peer-field"),
  peerId: document.querySelector("#peer-id"),
  getScript: document.querySelector("#get-script-button"),
  newSketch: document.querySelector("#new-sketch-button"),
  reboot: document.querySelector("#reboot-button"),
  run: document.querySelector("#run-button"),
  stop: document.querySelector("#stop-button"),
  uploadStatus: document.querySelector("#upload-status"),
  uploadStatusLabel: document.querySelector("#upload-status-label"),
  uploadStatusProgress: document.querySelector("#upload-status-progress"),
  downloadCode: document.querySelector("#download-code-button"),
  sketchHistory: document.querySelector("#sketch-history"),
  settings: document.querySelector("#settings-button"),
  settingsDialog: document.querySelector("#settings-dialog"),
  deviceNameInput: document.querySelector("#device-name-input"),
  deviceNameSave: document.querySelector("#device-name-save-button"),
  wifiSave: document.querySelector("#wifi-save-button"),
  wifiNetworkList: document.querySelector("#wifi-network-list"),
  mqttHost: document.querySelector("#mqtt-host"),
  mqttPort: document.querySelector("#mqtt-port"),
  mqttRoot: document.querySelector("#mqtt-root"),
  mqttUser: document.querySelector("#mqtt-user"),
  mqttPassword: document.querySelector("#mqtt-password"),
  mqttSave: document.querySelector("#mqtt-save-button"),
  consoleActions: document.querySelector("#console-actions"),
  consoleTimestamps: document.querySelector("#console-timestamps-button"),
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
  infoShare: document.querySelector("#info-share"),
  infoQr: document.querySelector("#info-qr"),
  wifiSsid: document.querySelector("#wifi-ssid"),
  wifiPassword: document.querySelector("#wifi-password"),
  chatApiKey: document.querySelector("#chat-api-key-button"),
  chatApiKeyDialog: document.querySelector("#chat-api-key-dialog"),
  chatApiKeyInput: document.querySelector("#chat-api-key-input"),
  chatApiKeySave: document.querySelector("#chat-api-key-save-button"),
  chatModel: document.querySelector("#chat-model"),
  chatDebugPrompt: document.querySelector("#chat-debug-prompt-button"),
  chatClear: document.querySelector("#chat-clear-button"),
  chatTranscript: document.querySelector("#chat-transcript"),
  chatForm: document.querySelector("#chat-form"),
  chatInput: document.querySelector("#chat-input"),
  chatSend: document.querySelector("#chat-send-button"),
  circuitRefresh: document.querySelector("#circuit-refresh-button"),
  circuitDownload: document.querySelector("#circuit-download-button"),
  circuitStatus: document.querySelector("#circuit-status"),
  circuitCanvas: document.querySelector("#circuit-canvas"),
  circuitComponents: document.querySelector("#circuit-components"),
  circuitAssumptions: document.querySelector("#circuit-assumptions"),
  circuitPinInfo: document.querySelector("#circuit-pin-info"),
  uiConnect: document.querySelector("#ui-connect-button"),
  uiCopyLink: document.querySelector("#ui-copy-link-button"),
  uiCanvas: document.querySelector("#ui-canvas"),
  installConnect: document.querySelector("#install-connect-button"),
  installFlashManifest: document.querySelector("#install-flash-manifest-button"),
  installGoCode: document.querySelector("#install-go-code-button"),
  installManifest: document.querySelector("#install-manifest-input"),
  installDeviceName: document.querySelector("#install-device-name"),
  installWifiSsid: document.querySelector("#install-wifi-ssid"),
  installWifiPassword: document.querySelector("#install-wifi-password"),
  installProgress: document.querySelector("#install-progress"),
  installStatus: document.querySelector("#install-status"),
  installLog: document.querySelector("#install-log"),
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
let connectionVerified = false;
let statusTimer = null;
let editorErrorMarker = null;
let editorErrorGutterRow = null;
let recentPressHandled = false;
let chatMessages = [];
let chatBusy = false;
let wrenchChatContext = "";
let lastLoggedScriptErrorCount = 0;
let lastConsoleEventSignature = "";
let lastConsoleEventAt = 0;
let lastWifiConsoleKey = "";
let lastWifiConsoleAt = 0;
let flasher = null;
let flasherBusy = false;
let wifiDraftDirty = false;
let lastConfig = null;
let uploadState = { phase: "", label: "", progress: 0 };
let uploadClearTimer = null;
let currentSketchName = "";
let currentSketchSource = "";
let currentSketchVersionName = "";
let currentSketchDirty = false;
let currentSketchSaved = true;
let circuitView = null;
let circuitChatLayout = null;
let circuitUpdateTimer = null;
let guinoView = null;

boot();

function boot() {
  initEditor();
  setEditorValueRaw("", { persist: false });
  els.websocketUrl.value = localStorage.getItem(storage.wsUrl) || els.websocketUrl.value;
  els.peerId.value = localStorage.getItem(storage.peerId) || defaultPeerIdFromWebSocket(els.websocketUrl.value);
  els.debugLevel.value = localStorage.getItem(storage.logLevel) || els.debugLevel.value;
  updateConsoleTimestampButton();
  bindControls();
  bindLifecycle();
  initChat();
  initCircuit();
  initGuino();
  migrateConnectionHistory();
  renderConnectionHistory();
  renderSketchHistory();
  logLine("info", `P1E web ${WEB_UI_VERSION} / mqtt ${MQTT_TRANSPORT_VERSION}`);
  refreshKnownUsbPorts();
  setConnected(false);
  renderFields();
  restoreActiveTab();
  autoConnectFromUrlParams().then((handled) => {
    if (!handled) autoReconnectLastConnection();
  });
}

function bindLifecycle() {
  const markUnload = () => {
    isUnloading = true;
    localStorage.setItem(storage.reconnectOnLoad, client && transport?.connected && connectionVerified ? "1" : "0");
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
      handleEditorInput();
    });
    els.aceHost.classList.add("is-active");
    els.code.classList.add("is-hidden");
  } else {
    els.code.addEventListener("input", () => {
      handleEditorInput();
    });
  }
}

function handleEditorInput() {
  clearEditorError();
  if (suppressEditorPersist) return;
  localStorage.setItem(storage.code, getEditorValue());
  circuitChatLayout = null;
  scheduleCircuitUpdate();
  updateCurrentSketchDirty();
  updateEnabledState();
}

function getEditorValue() {
  return editor ? editor.getValue() : els.code.value;
}

function setEditorValueRaw(value, { persist = true } = {}) {
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
  scheduleCircuitUpdate();
  updateCurrentSketchDirty();
  updateEnabledState();
}

async function replaceEditorCode(value, {
  persist = true,
  saveCurrent = true,
  identityName = "",
  identityHistory = null,
  markUnsaved = false,
} = {}) {
  const nextCode = String(value ?? "");
  if (saveCurrent) await shelveEditorSketchIfNeeded({ incomingCode: nextCode });
  setEditorValueRaw(nextCode, { persist });
  if (identityName || identityHistory) {
    setCurrentSketchIdentity(identityName, nextCode, identityHistory || await readSketchHistory());
  } else if (markUnsaved) {
    clearCurrentSketchIdentity();
    updateCurrentSketchDirty();
  }
}

function bindControls() {
  els.tabs.forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
  els.lowerTabs.forEach((tab) => tab.addEventListener("click", () => switchLowerPanel(tab.dataset.panel)));
  els.connect.addEventListener("click", toggleConnection);
  els.chatConnect.addEventListener("click", toggleConnection);
  els.usbConnect.addEventListener("click", connectUsb);
  els.newWsToggle.addEventListener("click", showNewWsField);
  els.newWsConnect.addEventListener("click", () => connectWebSocket(els.websocketUrl.value));
  els.websocketUrl.addEventListener("input", () => renderConnectionHistory());
  els.newPeerToggle.addEventListener("click", showNewPeerField);
  els.newPeerConnect.addEventListener("click", () => connectMqtt(els.peerId.value));
  els.peerId.addEventListener("input", () => renderConnectionHistory());
  els.getScript.addEventListener("click", () => runUiAction(getScript, "reading"));
  els.newSketch.addEventListener("click", () => runUiAction(createNewSketch, "new sketch"));
  els.reboot.addEventListener("click", () => runUiAction(() => sendCommand("device.reboot"), "rebooting"));
  els.run.addEventListener("click", runScriptFromToolbar);
  els.stop.addEventListener("click", () => runUiAction(() => sendCommand("script.stop").then(refreshStatus), "stopping"));
  els.downloadCode.addEventListener("click", downloadCode);
  els.sketchHistory.addEventListener("change", () => recoverSketchHistory());
  bindSketchDrop();
  els.settings.addEventListener("click", openSettingsDialog);
  els.deviceNameSave.addEventListener("click", () => runUiAction(saveDeviceName, "rename"));
  els.wifiSave.addEventListener("click", () => runUiAction(saveWifi, "wifi"));
  els.mqttSave.addEventListener("click", () => runUiAction(saveMqtt, "mqtt"));
  els.wifiSsid.addEventListener("input", () => {
    wifiDraftDirty = true;
  });
  els.wifiPassword.addEventListener("input", () => {
    wifiDraftDirty = true;
  });
  els.settingsDialog.addEventListener("close", () => {
    wifiDraftDirty = false;
  });
  els.consoleTimestamps.addEventListener("click", toggleConsoleTimestamps);
  els.copyConsole.addEventListener("click", copyConsole);
  els.infoQr.addEventListener("click", copyInfoShareLink);
  els.infoQr.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    copyInfoShareLink();
  });
  els.clearConsole.addEventListener("click", clearConsole);
  els.rawForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runUiAction(sendRaw, "sending");
  });
  els.debugLevel.addEventListener("change", () => {
    localStorage.setItem(storage.logLevel, els.debugLevel.value);
    if (client) runUiAction(() => sendCommand("debug.set", { level: els.debugLevel.value }), "debug");
  });
  els.chatApiKey.addEventListener("click", toggleChatApiKey);
  els.chatApiKeySave.addEventListener("click", saveChatApiKey);
  els.chatModel.addEventListener("change", () => {
    localStorage.setItem(storage.chatModel, els.chatModel.value);
  });
  els.chatDebugPrompt.addEventListener("click", toggleChatDebugPrompt);
  els.chatClear.addEventListener("click", clearChat);
  els.circuitRefresh?.addEventListener("click", () => {
    circuitChatLayout = null;
    updateCircuitView("inferred from code");
  });
  els.circuitDownload?.addEventListener("click", downloadCircuitDiagram);
  els.uiConnect?.addEventListener("click", toggleConnection);
  els.uiCopyLink?.addEventListener("click", copyGuinoLink);
  els.installConnect?.addEventListener("click", () => runInstallAction(connectFlasher));
  els.installFlashManifest.addEventListener("click", () => runInstallAction(flashInstallManifest));
  els.installGoCode.addEventListener("click", () => switchTab("coding"));
  els.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendChatPrompt();
  });
  els.chatInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    sendChatPrompt();
  });
  els.chatInput.addEventListener("input", updateEnabledState);
}

function switchTab(name) {
  if (!els.views[name]) name = "coding";
  els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.tab === name));
  Object.entries(els.views).forEach(([key, view]) => view.classList.toggle("is-active", key === name));
  localStorage.setItem(storage.activeTab, name);
  updateViewUrlParam(name);
  if (name === "coding" && editor) {
    requestAnimationFrame(() => {
      editor.resize(true);
      editor.renderer?.updateFull?.();
    });
  }
  if (name === "chat") renderChatTranscript();
  if (name === "circuit") {
    updateCircuitView();
    requestAnimationFrame(() => circuitView?.resize?.());
  }
  if (name === "ui") {
    requestAnimationFrame(() => guinoView?.resize?.());
    if (isDeviceConnected()) requestGuinoRefresh({ quiet: true });
  }
}

function restoreActiveTab() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("view") || params.get("tab");
  switchTab(requested || localStorage.getItem(storage.activeTab) || "chat");
}

function updateViewUrlParam(name) {
  if (!window.history?.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.set("view", name);
  window.history.replaceState(null, "", url.toString());
}

function switchLowerPanel(name) {
  els.lowerTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.panel === name));
  Object.entries(els.lowerPanels).forEach(([key, panel]) => panel.classList.toggle("is-active", key === name));
  els.consoleActions.classList.toggle("is-hidden", name !== "console");
}

function initCircuit() {
  circuitView = initCircuitView({
    mount: els.circuitCanvas,
    componentList: els.circuitComponents,
    assumptions: els.circuitAssumptions,
    pinInfo: els.circuitPinInfo,
  });
  updateCircuitView("inferred from code");
}

function scheduleCircuitUpdate() {
  window.clearTimeout(circuitUpdateTimer);
  circuitUpdateTimer = window.setTimeout(() => {
    if (els.views.circuit?.classList.contains("is-active")) updateCircuitView();
  }, 360);
}

function updateCircuitView(status = "") {
  if (!circuitView) return;
  const model = inferCircuitLayout(getEditorValue(), circuitChatLayout);
  circuitView.setModel(model);
  if (els.circuitStatus) {
    const count = model.components?.length || 0;
    els.circuitStatus.textContent = status || `${count} part${count === 1 ? "" : "s"} inferred`;
  }
}

function downloadCircuitDiagram() {
  const ok = circuitView?.downloadPng?.(`p1e-circuit-${timestampForFilename()}.png`);
  logLine(ok ? "info" : "warn", ok ? "circuit diagram downloaded" : "circuit diagram not ready");
}

function initGuino() {
  guinoView = initGuinoView({
    canvas: els.uiCanvas,
    sendInput: sendGuinoInput,
    requestRefresh: () => requestGuinoRefresh({ quiet: false }),
  });
}

async function sendGuinoInput({ id, type, value }) {
  if (!isDeviceConnected()) throw new Error("UI is not connected");
  const channel = `ui.${String(id || "system").trim() || "system"}`;
  const message = type === "set" ? `set:${Math.round(Number(value) || 0)}` : String(type || "press");
  await sendCommand("script.input", { channel, message }, { timeoutMs: 5000, quiet: true });
}

async function requestGuinoRefresh({ quiet = false } = {}) {
  if (!isDeviceConnected()) return;
  try {
    await sendCommand("script.input", { channel: "ui.system", message: "hello" }, { timeoutMs: 5000, quiet: true });
    if (!quiet) logLine("info", "asked sketch to redraw UI");
  } catch (error) {
    if (!quiet) logLine("warn", `UI refresh failed: ${error.message}`);
  }
}

async function copyGuinoLink() {
  try {
    const peerId = normalizePeerId(els.peerId.value || transport?.remoteId || lastStatus?.webrtc?.peerId || "");
    const hint = transport?.kind === "usb" ? readUsbHint() : null;
    const kind = isMqttKind(transport?.kind) || peerId ? "mqtt" : transport?.kind === "usb" ? "usb" : "websocket";
    const url = new URL(sharePageUrl(kind, transport?.url || els.websocketUrl.value, hint, peerId));
    url.searchParams.set("view", "ui");
    await navigator.clipboard.writeText(url.toString());
    logLine("info", "UI link copied");
  } catch (error) {
    logLine("warn", `UI link not ready: ${error.message}`);
  }
}

function openConnectDialog() {
  renderConnectionHistory();
  refreshKnownUsbPorts();
  renderConnectionOptions();
  els.newWsField.classList.add("is-hidden");
  els.newWsConnect.classList.add("is-hidden");
  els.newPeerField.classList.add("is-hidden");
  els.newPeerConnect.classList.add("is-hidden");
  els.connectDialog.showModal();
}

function renderConnectionOptions() {
  els.usbConnect.classList.toggle("is-hidden", !isConnectionKindAvailable("usb"));
  els.newPeerToggle.classList.toggle("is-hidden", !isConnectionKindAvailable("mqtt"));
  els.newWsToggle.classList.toggle("is-hidden", !isConnectionKindAvailable("websocket"));
}

function toggleConnection() {
  if (client || transport) {
    disconnectTransport();
  } else if (isBusy) {
    cancelConnectionAttempt();
  } else {
    openConnectDialog();
  }
}

function closeConnectDialog() {
  if (els.connectDialog.open) els.connectDialog.close();
}

function showNewWsField() {
  els.newPeerField.classList.add("is-hidden");
  els.newPeerConnect.classList.add("is-hidden");
  els.newWsField.classList.remove("is-hidden");
  els.newWsConnect.classList.remove("is-hidden");
  els.websocketUrl.focus();
  els.websocketUrl.select();
}

function showNewPeerField() {
  els.newWsField.classList.add("is-hidden");
  els.newWsConnect.classList.add("is-hidden");
  els.newPeerField.classList.remove("is-hidden");
  els.newPeerConnect.classList.remove("is-hidden");
  els.peerId.focus();
  els.peerId.select();
}

function renderConnectionHistory() {
  const items = [...readPeerHistory(), ...readWebSocketHistory(), ...readUsbHistory()]
    .filter((item) => isConnectionKindAvailable(item.kind))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  els.connectionHistory.replaceChildren();
  els.connectionHistory.classList.toggle("is-hidden", items.length === 0);

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button suggestion-button";
    button.title = `${connectionKindLabel(item.kind)}: ${item.label}`;
    button.setAttribute("aria-label", button.title);
    button.disabled = Boolean(client) || isBusy;

    const icon = document.createElement("span");
    icon.className = "material-symbols-rounded";
    icon.textContent = connectionKindIcon(item.kind);
    const label = document.createElement("span");
    label.textContent = item.kind === "usb" ? `USB ${item.label}` : item.label;
    button.append(icon, label);

    bindLongPressDelete(button, () => forgetConnectionHistoryItem(item));
    button.addEventListener("click", () => {
      if (consumeRecentLongPress()) return;
      if (item.kind === "usb") {
        connectRecentUsb(item.hint);
      } else if (isMqttKind(item.kind)) {
        connectMqtt(item.peerId);
      } else if (isWebRtcKind(item.kind)) {
        connectPeerJs(item.peerId);
      } else {
        connectWebSocket(item.url);
      }
    });
    els.connectionHistory.append(button);
  });
}

function isConnectionKindAvailable(kind) {
  if (kind === "usb") return "serial" in navigator;
  if (isMqttKind(kind)) return "mqtt" in window;
  if (isWebRtcKind(kind)) return ("RTCPeerConnection" in window) && ("mqtt" in window);
  if (kind === "websocket") return "WebSocket" in window;
  return false;
}

function connectionKindLabel(kind) {
  if (kind === "usb") return "USB";
  if (isMqttKind(kind)) return "MQTT";
  if (isWebRtcKind(kind)) return "WebRTC";
  return "WebSocket";
}

function connectionKindIcon(kind) {
  if (kind === "usb") return "settings_input_component";
  if (isMqttKind(kind)) return "hub";
  if (isWebRtcKind(kind)) return "hub";
  return "lan";
}

function isWebRtcKind(kind) {
  return kind === "webrtc" || kind === "peerjs";
}

function isMqttKind(kind) {
  return kind === "mqtt";
}

function isBinaryTransportKind(kind) {
  return isMqttKind(kind) || isWebRtcKind(kind);
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

function forgetConnectionHistoryItem(item) {
  if (item.kind === "websocket") {
    const url = normalizeWebSocketUrl(item.url);
    writeWebSocketHistory(readWebSocketHistory().filter((entry) => normalizeWebSocketUrl(entry.url) !== url));
    if (localStorage.getItem(storage.wsUrl) === url) {
      const next = readWebSocketHistory()[0];
      if (next) {
        localStorage.setItem(storage.wsUrl, next.url);
        localStorage.setItem(storage.wsName, next.label);
      } else {
        localStorage.removeItem(storage.wsUrl);
        localStorage.removeItem(storage.wsName);
      }
    }
  } else if (isMqttKind(item.kind) || isWebRtcKind(item.kind)) {
    const peerId = normalizePeerId(item.peerId);
    writePeerHistory(readPeerHistory().filter((entry) => normalizePeerId(entry.peerId) !== peerId));
    if (normalizePeerId(localStorage.getItem(storage.peerId)) === peerId) {
      const next = readPeerHistory()[0];
      if (next) localStorage.setItem(storage.peerId, next.peerId);
      else localStorage.removeItem(storage.peerId);
    }
  } else {
    const key = usbHistoryKey(item.hint);
    writeUsbHistory(readUsbHistory().filter((entry) => usbHistoryKey(entry.hint) !== key));
    if (usbHistoryKey(readUsbHint()) === key) {
      const next = readUsbHistory()[0];
      if (next) localStorage.setItem(storage.usbHint, JSON.stringify(next.hint));
      else localStorage.removeItem(storage.usbHint);
    }
  }

  if (!readPeerHistory().length && !readWebSocketHistory().length && !readUsbHistory().length) {
    localStorage.removeItem(storage.lastConnection);
    localStorage.setItem(storage.reconnectOnLoad, "0");
  }
  renderConnectionHistory();
  logLine("info", "removed recent connection");
}

async function refreshKnownUsbPorts() {
  if (!("serial" in navigator)) {
    knownUsbPortCount = 0;
    knownUsbLabel = "";
    renderConnectionHistory();
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
  renderConnectionHistory();
}

async function runUiAction(action, label = "busy") {
  if (isBusy) {
    logLine("warn", `busy: ${busyLabel || "working"}`);
    return false;
  }
  isBusy = true;
  busyLabel = label;
  updateEnabledState();
  try {
    await action();
    return true;
  } catch (error) {
    logLine("error", error.message || String(error));
    return false;
  } finally {
    isBusy = false;
    busyLabel = "";
    updateEnabledState();
  }
}

function runScriptFromToolbar() {
  logLine("info", "upload requested");
  runUiAction(() => setScript({ run: true, save: true }), "uploading");
}

async function connectWebSocket(value) {
  const url = normalizeWebSocketUrl(value);
  warnIfPlainWebSocketFromSecurePage(url);
  await connectTransport(new WebSocketTransport(), { url }, "websocket", wsDisplayName(url));
  els.websocketUrl.value = url;
  renderConnectionHistory();
}

async function connectPeerJs(value) {
  const peerId = normalizePeerId(value);
  if (!peerId) {
    logLine("warn", "WebRTC device id is required");
    return;
  }
  await connectTransport(new MqttWebRtcTransport({ connectTimeoutMs: 90000 }), { remoteId: peerId }, "webrtc", peerId, { startupTimeoutMs: 30000 });
  els.peerId.value = peerId;
  renderConnectionHistory();
}

async function connectMqtt(value) {
  const peerId = normalizePeerId(value);
  if (!peerId) {
    logLine("warn", "MQTT device id is required");
    return;
  }
  await connectTransport(new MqttTransport({ ...mqttTransportOptions(), connectTimeoutMs: 15000 }), { remoteId: peerId }, "mqtt", peerId, { startupTimeoutMs: 15000 });
  els.peerId.value = peerId;
  renderConnectionHistory();
}

async function connectUsb() {
  await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), {}, "usb", "USB");
  await refreshKnownUsbPorts();
  renderConnectionHistory();
}

async function connectRecentUsb(hint = null) {
  if (hint) localStorage.setItem(storage.usbHint, JSON.stringify(hint));
  await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), { pickPort: false }, "usb", "USB");
  await refreshKnownUsbPorts();
  renderConnectionHistory();
}

async function autoConnectFromUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const requested = (params.get("connect") || params.get("transport") || "").toLowerCase();
  if (!requested) return false;

  if (requested === "ws" || requested === "websocket") {
    const value = params.get("ws") || params.get("url") || "";
    if (!value) {
      logLine("warn", "connect=ws is missing a ws URL");
      return true;
    }
    try {
      const url = normalizeWebSocketUrl(value);
      els.websocketUrl.value = url;
      warnIfPlainWebSocketFromSecurePage(url);
      await connectTransport(new WebSocketTransport(), { url }, "websocket", wsDisplayName(url), { lightStartup: true, includeScript: true });
    } catch (error) {
      logLine("error", error.message);
    }
    return true;
  }

  if (requested === "mqtt") {
    const peerId = normalizePeerId(params.get("peer") || params.get("id") || params.get("device") || "");
    if (!peerId) {
      logLine("warn", "connect=mqtt needs a device id");
      return true;
    }
    try {
      applyMqttParams(params);
      els.peerId.value = peerId;
      await connectTransport(new MqttTransport({ ...mqttTransportOptions(), connectTimeoutMs: 15000 }), { remoteId: peerId }, "mqtt", peerId, { lightStartup: true, includeScript: true, startupTimeoutMs: 15000 });
    } catch (error) {
      logLine("error", error.message);
    }
    return true;
  }

  if (requested === "peer" || requested === "peerjs" || requested === "webrtc") {
    const peerId = normalizePeerId(params.get("peer") || params.get("id") || params.get("device") || "");
    if (!peerId) {
      logLine("warn", "connect=webrtc needs a WebRTC device id");
      return true;
    }
    try {
      els.peerId.value = peerId;
      await connectTransport(new MqttWebRtcTransport({ connectTimeoutMs: 90000 }), { remoteId: peerId }, "webrtc", peerId, { lightStartup: true, includeScript: true, startupTimeoutMs: 30000 });
    } catch (error) {
      logLine("error", error.message);
    }
    return true;
  }

  if (requested === "usb" || requested === "serial") {
    if (!("serial" in navigator)) {
      logLine("warn", "connect=usb needs Web Serial");
      return true;
    }
    const urlHint = usbHintFromParams(params);
    if (urlHint) localStorage.setItem(storage.usbHint, JSON.stringify(urlHint));
    if (!readUsbHint()) {
      logLine("warn", "connect=usb needs a previously approved USB device in this browser");
      return true;
    }
    try {
      await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), { pickPort: false }, "usb", "USB", { lightStartup: true, includeScript: true });
      await refreshKnownUsbPorts();
    } catch (error) {
      logLine("error", error.message);
    }
    return true;
  }

  return false;
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

  if (isMqttKind(last)) {
    const peerId = normalizePeerId(localStorage.getItem(storage.peerId) || "");
    if (!peerId || !("mqtt" in window)) return;
    await connectTransport(new MqttTransport({ ...mqttTransportOptions(), connectTimeoutMs: 15000 }), { remoteId: peerId }, "mqtt", peerId, { quiet: true, lightStartup: true, includeScript: true, startupTimeoutMs: 15000 });
    return;
  }

  if (isWebRtcKind(last)) {
    const peerId = normalizePeerId(localStorage.getItem(storage.peerId) || "");
    if (!peerId || !(("RTCPeerConnection" in window) && ("mqtt" in window))) return;
    await connectTransport(new MqttWebRtcTransport({ connectTimeoutMs: 90000 }), { remoteId: peerId }, "webrtc", peerId, { quiet: true, lightStartup: true, includeScript: true, startupTimeoutMs: 30000 });
    return;
  }

  if (last === "usb") {
    if (!("serial" in navigator) || !readUsbHint()) return;
    await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), { pickPort: false }, "usb", "USB", { quiet: true, lightStartup: true, includeScript: true });
    await refreshKnownUsbPorts();
  }
}

async function connectTransport(nextTransport, options, kind, label, { quiet = false, lightStartup = false, includeScript = true, startupTimeoutMs = 15000 } = {}) {
  const generation = connectionGeneration + 1;
  connectionGeneration = generation;
  connectionVerified = false;
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
      return false;
    }
    if (!ok) throw new Error(`${label} device was not available`);
    closeConnectDialog();
    setConnected(true);
    if (kind === "websocket" && options.url) updateConnectionUrlParams("websocket", options.url);
    if (isMqttKind(kind) && options.remoteId) updateConnectionUrlParams("mqtt", "", null, options.remoteId);
    if (isWebRtcKind(kind) && options.remoteId) updateConnectionUrlParams("webrtc", "", null, options.remoteId);
    if (kind === "usb") updateConnectionUrlParams("usb", "", readUsbHint());
    if (!quiet) logLine("info", isBinaryTransportKind(kind) ? `Connected to ${label}` : `${label} connected`);

    if (lightStartup) await settle(450);
    if (generation !== connectionGeneration) return false;
    const verified = await startupRefresh({ quiet, includeScript, timeoutMs: startupTimeoutMs, expectedGeneration: generation });
    if (generation === connectionGeneration && verified) {
      connectionVerified = true;
      rememberSuccessfulConnection(kind, label, options);
      startStatusPolling();
      return true;
    } else if (generation === connectionGeneration) {
      if (!quiet) logLine("warn", `${label} connected but did not answer protocol checks`);
      forgetUnverifiedConnection(kind, options);
      await disconnectTransport({ quiet: true, keepGeneration: true });
      setConnected(false);
      return false;
    }
  } catch (error) {
    if (generation !== connectionGeneration) return false;
    if (!quiet) logLine("error", error.message);
    if (transport === nextTransport) {
      forgetUnverifiedConnection(kind, options);
      await disconnectTransport({ quiet: true, keepGeneration: true });
    }
    setConnected(false);
    return false;
  } finally {
    if (generation === connectionGeneration) {
      suppressConnectionLogs = false;
      isBusy = false;
      busyLabel = "";
      updateEnabledState();
    }
  }
  return false;
}

async function cancelConnectionAttempt() {
  connectionGeneration += 1;
  localStorage.setItem(storage.reconnectOnLoad, "0");
  clearConnectionUrlParams();
  try {
    await transport?.disconnect?.();
  } finally {
    client = null;
    transport = null;
    connectionVerified = false;
    closeConnectDialog();
    stopStatusPolling();
    suppressConnectionLogs = false;
    isBusy = false;
    busyLabel = "";
    setConnected(false);
    logLine("info", "connection cancelled");
    updateEnabledState();
  }
}

function rememberSuccessfulConnection(kind, label, options = {}) {
  localStorage.setItem(storage.lastConnection, kind);
  localStorage.setItem(storage.reconnectOnLoad, "1");

  if (kind === "websocket" && options.url) {
    const url = normalizeWebSocketUrl(options.url);
    localStorage.setItem(storage.wsUrl, url);
    const label = wsDisplayName(url);
    localStorage.setItem(storage.wsName, label);
    rememberWebSocketHistory(url, label);
    els.websocketUrl.value = url;
    updateConnectionUrlParams("websocket", url);
    renderConnectionHistory();
  }

  if ((isMqttKind(kind) || isWebRtcKind(kind)) && options.remoteId) {
    const peerId = normalizePeerId(options.remoteId);
    localStorage.setItem(storage.peerId, peerId);
    rememberPeerHistory(peerId, label || peerId);
    els.peerId.value = peerId;
    updateConnectionUrlParams(isMqttKind(kind) ? "mqtt" : "webrtc", "", null, peerId);
    renderConnectionHistory();
  }

  if (kind === "usb") {
    const hint = readUsbHint();
    if (hint) rememberUsbHistory(hint);
    updateConnectionUrlParams("usb", "", hint);
    refreshKnownUsbPorts();
    renderConnectionHistory();
  }
}

function forgetUnverifiedConnection(kind, options = {}) {
  if (kind === "websocket" && options.url) {
    const attempted = normalizeWebSocketUrl(options.url);
    writeWebSocketHistory(readWebSocketHistory().filter((entry) => normalizeWebSocketUrl(entry.url) !== attempted));
    if (localStorage.getItem(storage.wsUrl) === attempted) {
      const next = readWebSocketHistory()[0];
      if (next) {
        localStorage.setItem(storage.wsUrl, next.url);
        localStorage.setItem(storage.wsName, next.label);
      } else {
        localStorage.removeItem(storage.wsUrl);
        localStorage.removeItem(storage.wsName);
      }
    }
  }
  if ((isMqttKind(kind) || isWebRtcKind(kind)) && options.remoteId) {
    const attempted = normalizePeerId(options.remoteId);
    writePeerHistory(readPeerHistory().filter((entry) => normalizePeerId(entry.peerId) !== attempted));
    if (normalizePeerId(localStorage.getItem(storage.peerId)) === attempted) {
      const next = readPeerHistory()[0];
      if (next) localStorage.setItem(storage.peerId, next.peerId);
      else localStorage.removeItem(storage.peerId);
    }
  }
  if (kind === "usb") {
    const key = usbHistoryKey(readUsbHint());
    if (key) writeUsbHistory(readUsbHistory().filter((entry) => usbHistoryKey(entry.hint) !== key));
  }
  if (localStorage.getItem(storage.lastConnection) === kind) {
    localStorage.removeItem(storage.lastConnection);
    localStorage.setItem(storage.reconnectOnLoad, "0");
  }
  renderConnectionHistory();
}

function migrateConnectionHistory() {
  if (!readWebSocketHistory().length) {
    const url = localStorage.getItem(storage.wsUrl) || "";
    if (url) {
      try {
        rememberWebSocketHistory(url, localStorage.getItem(storage.wsName) || wsDisplayName(url));
      } catch {}
    }
  }

  if (!readPeerHistory().length) {
    const peerId = normalizePeerId(localStorage.getItem(storage.peerId) || "");
    if (peerId) rememberPeerHistory(peerId, peerId);
  }

  if (!readUsbHistory().length) {
    const hint = readUsbHint();
    if (hint) rememberUsbHistory(hint);
  }
}

function readHistoryArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistoryArray(key, entries) {
  localStorage.setItem(key, JSON.stringify(entries.slice(0, connectionHistoryLimit)));
}

function readWebSocketHistory() {
  return readHistoryArray(storage.wsHistory)
    .map((entry) => {
      try {
        const url = normalizeWebSocketUrl(entry.url || "");
        return {
          kind: "websocket",
          url,
          label: entry.label || wsDisplayName(url),
          at: Number(entry.at) || 0,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeWebSocketHistory(entries) {
  writeHistoryArray(storage.wsHistory, entries.map((entry) => ({
    kind: "websocket",
    url: normalizeWebSocketUrl(entry.url),
    label: entry.label || wsDisplayName(entry.url),
    at: Number(entry.at) || Date.now(),
  })));
}

function rememberWebSocketHistory(url, label = "") {
  const normalized = normalizeWebSocketUrl(url);
  const next = [
    { kind: "websocket", url: normalized, label: label || wsDisplayName(normalized), at: Date.now() },
    ...readWebSocketHistory().filter((entry) => normalizeWebSocketUrl(entry.url) !== normalized),
  ];
  writeWebSocketHistory(next);
}

function readPeerHistory() {
  return readHistoryArray(storage.peerHistory)
    .map((entry) => {
      const peerId = normalizePeerId(entry.peerId || entry.id || entry);
      if (!peerId) return null;
      return {
        kind: "webrtc",
        peerId,
        label: entry.label || peerId,
        at: Number(entry.at) || 0,
      };
    })
    .filter(Boolean);
}

function writePeerHistory(entries) {
  writeHistoryArray(storage.peerHistory, entries.map((entry) => {
    const peerId = normalizePeerId(entry.peerId);
    return {
      kind: "webrtc",
      peerId,
      label: entry.label || peerId,
      at: Number(entry.at) || Date.now(),
    };
  }).filter((entry) => entry.peerId));
}

function rememberPeerHistory(peerId, label = "") {
  const normalized = normalizePeerId(peerId);
  if (!normalized) return;
  const next = [
    { kind: "webrtc", peerId: normalized, label: label || normalized, at: Date.now() },
    ...readPeerHistory().filter((entry) => normalizePeerId(entry.peerId) !== normalized),
  ];
  writePeerHistory(next);
}

function normalizePeerId(value) {
  return String(value || "").trim().toLowerCase();
}

function defaultPeerIdFromWebSocket(value) {
  try {
    const host = new URL(normalizeWebSocketUrl(value)).hostname;
    return normalizePeerId(host.replace(/\.local$/i, ""));
  } catch {
    return "p1-embed-f7a608";
  }
}

function readUsbHistory() {
  return readHistoryArray(storage.usbHistory)
    .map((entry) => {
      const hint = normalizeUsbHint(entry.hint || entry);
      if (!hint) return null;
      return {
        kind: "usb",
        hint,
        label: entry.label || usbHintLabel(hint),
        at: Number(entry.at) || 0,
      };
    })
    .filter(Boolean);
}

function writeUsbHistory(entries) {
  writeHistoryArray(storage.usbHistory, entries.map((entry) => ({
    kind: "usb",
    hint: normalizeUsbHint(entry.hint),
    label: entry.label || usbHintLabel(entry.hint),
    at: Number(entry.at) || Date.now(),
  })).filter((entry) => entry.hint));
}

function rememberUsbHistory(hint) {
  const normalized = normalizeUsbHint(hint);
  if (!normalized) return;
  const key = usbHistoryKey(normalized);
  const next = [
    { kind: "usb", hint: normalized, label: usbHintLabel(normalized), at: Date.now() },
    ...readUsbHistory().filter((entry) => usbHistoryKey(entry.hint) !== key),
  ];
  writeUsbHistory(next);
}

function normalizeUsbHint(hint) {
  const vendor = Number(hint?.usbVendorId);
  const product = Number(hint?.usbProductId);
  if (!Number.isFinite(vendor) || !Number.isFinite(product)) return null;
  return { usbVendorId: vendor, usbProductId: product };
}

function usbHistoryKey(hint) {
  const normalized = normalizeUsbHint(hint);
  return normalized ? `${normalized.usbVendorId}:${normalized.usbProductId}` : "";
}

function usbHintFromParams(params) {
  const usb = String(params.get("usb") || "").trim();
  const usbMatch = usb.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (usbMatch) {
    return normalizeUsbHint({
      usbVendorId: parseInt(usbMatch[1], 16),
      usbProductId: parseInt(usbMatch[2], 16),
    });
  }

  const vid = String(params.get("vid") || "").trim();
  const pid = String(params.get("pid") || "").trim();
  if (!vid || !pid) return null;
  return normalizeUsbHint({
    usbVendorId: parseInt(vid, 16),
    usbProductId: parseInt(pid, 16),
  });
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

function warnIfPlainWebSocketFromSecurePage(url) {
  if (window.location.protocol !== "https:") return;
  try {
    const parsed = new URL(normalizeWebSocketUrl(url));
    if (parsed.protocol !== "ws:") return;
    if (isLoopbackHost(parsed.hostname)) return;
    logLine("warn", "HTTPS pages can be blocked from opening local ws:// device links on iOS/WebKit. Open this UI from an http:// page on the same network, or use WSS when the firmware supports it.");
  } catch {
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function sharePageUrl(kind, wsUrl = "", usbHint = null, peerId = "") {
  const url = new URL(window.location.href);
  url.searchParams.delete("connect");
  url.searchParams.delete("transport");
  url.searchParams.delete("ws");
  url.searchParams.delete("url");
  url.searchParams.delete("peer");
  url.searchParams.delete("id");
  url.searchParams.delete("device");
  url.searchParams.delete("usb");
  url.searchParams.delete("vid");
  url.searchParams.delete("pid");
  url.searchParams.delete("mqttHost");
  url.searchParams.delete("mqttPort");
  url.searchParams.delete("mqttRoot");
  url.searchParams.delete("mqttUser");

  if (kind === "websocket") {
    url.searchParams.set("connect", "ws");
    url.searchParams.set("ws", normalizeWebSocketUrl(wsUrl));
  } else if (isMqttKind(kind)) {
    url.searchParams.set("connect", "mqtt");
    url.searchParams.set("peer", normalizePeerId(peerId));
    const cfg = mqttConfigFromStorageAndDevice();
    if (cfg.mqttHost) url.searchParams.set("mqttHost", cfg.mqttHost);
    if (cfg.mqttPort) url.searchParams.set("mqttPort", String(cfg.mqttPort));
    if (cfg.mqttRoot) url.searchParams.set("mqttRoot", cfg.mqttRoot);
    if (cfg.mqttUser) url.searchParams.set("mqttUser", cfg.mqttUser);
  } else if (isMqttKind(kind) || isWebRtcKind(kind)) {
    url.searchParams.set("connect", "webrtc");
    url.searchParams.set("peer", normalizePeerId(peerId));
  } else if (kind === "usb") {
    url.searchParams.set("connect", "usb");
    const hint = normalizeUsbHint(usbHint || readUsbHint());
    if (hint) {
      const vid = hint.usbVendorId.toString(16).padStart(4, "0");
      const pid = hint.usbProductId.toString(16).padStart(4, "0");
      url.searchParams.set("usb", `${vid}:${pid}`);
    }
  }

  return url.toString();
}

function updateConnectionUrlParams(kind, wsUrl = "", usbHint = null, peerId = "") {
  if (!window.history?.replaceState) return;
  const nextUrl = sharePageUrl(kind, wsUrl, usbHint, peerId);
  window.history.replaceState(null, "", nextUrl);
}

function clearConnectionUrlParams() {
  if (!window.history?.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.delete("connect");
  url.searchParams.delete("transport");
  url.searchParams.delete("ws");
  url.searchParams.delete("url");
  url.searchParams.delete("peer");
  url.searchParams.delete("id");
  url.searchParams.delete("device");
  url.searchParams.delete("usb");
  url.searchParams.delete("vid");
  url.searchParams.delete("pid");
  url.searchParams.delete("mqttHost");
  url.searchParams.delete("mqttPort");
  url.searchParams.delete("mqttRoot");
  url.searchParams.delete("mqttUser");
  window.history.replaceState(null, "", url.toString());
}

async function disconnectTransport({ quiet = false, keepGeneration = false } = {}) {
  if (!keepGeneration) connectionGeneration += 1;
  try {
    await transport?.disconnect();
  } finally {
    client = null;
    transport = null;
    connectionVerified = false;
    closeConnectDialog();
    stopStatusPolling();
    if (!isUnloading) localStorage.setItem(storage.reconnectOnLoad, "0");
    if (!quiet && !keepGeneration && !isUnloading) clearConnectionUrlParams();
    if (!keepGeneration) {
      isBusy = false;
      busyLabel = "";
      suppressConnectionLogs = false;
    }
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
    logTransportState(event.detail);
    renderConnectionState(event.detail.state);
    if (event.detail.state === "connected") closeConnectDialog();
    if (isDroppedTransportState(event.detail.state) && !isUnloading) {
      localStorage.setItem(storage.reconnectOnLoad, "0");
      handleTransportDropped(nextClient);
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
      logLine("debug", `< late response id=${response.id ?? "?"}`);
    }
  });

  nextClient.addEventListener("error", (event) => {
    if (nextClient !== client) return;
    if (suppressConnectionLogs) return;
    logLine("error", event.detail.error?.message || "transport error");
  });
}

function logTransportState(detail = {}) {
  if (suppressConnectionLogs || !isBinaryTransportKind(transport?.kind)) return;
  const state = detail.state || "";
  const target = detail.remoteId || transport?.remoteId || transport?.label || "device";
  const prefix = isMqttKind(transport?.kind) ? "MQTT" : "WebRTC";
  if (state === "signaling_connecting") {
    logLine("info", `Connecting to ${target}`);
    logLine("debug", isMqttKind(transport?.kind) ? "MQTT opening binary channel" : "WebRTC opening MQTT signaling");
  } else if (state === "signaling_connected") {
    logLine("debug", `${prefix} signaling connected`);
  } else if (state === "offer_sent") {
    logLine("debug", `${prefix} trying ${target}`);
  } else if (state === "answer_received") {
    logLine("info", `Got a path to ${target}`);
    logLine("debug", `${prefix} answer received`);
  } else if (state === "diagnostic") {
    logLine("debug", `${prefix} ${detail.message || "diagnostic"}`);
  } else if (state === "device_timeout") {
    logLine("warn", `${prefix} timed out ${detail.remoteId || "device"}`);
  } else if (state === "device_closed") {
    logLine("warn", `${prefix} closed ${detail.remoteId || "device"}`);
  } else if (state === "device_error") {
    logLine("error", `${prefix} ${detail.remoteId || "device"}: ${detail.message || "connection error"}`);
  } else if (state === "signaling_error" || state === "signal_error") {
    logLine("error", `${prefix} signaling: ${detail.message || "connection error"}`);
  } else if (state === "connected") {
    logLine("debug", isMqttKind(transport?.kind) ? "MQTT binary channel open" : "WebRTC data channel open");
  } else if (state === "signaling_closed") {
    logLine("debug", `${prefix} signaling closed`);
  } else if (state === "disconnected" || state === "rtc_disconnected" || state === "rtc_failed" || state === "rtc_closed") {
    logLine("debug", `${prefix} disconnected`);
  }
}

function isDroppedTransportState(state = "") {
  return [
    "disconnected",
    "hub_disconnected",
    "hub_closed",
    "device_closed",
    "data_channel_closed",
    "rtc_disconnected",
    "rtc_failed",
    "rtc_closed",
    "remote_left",
  ].includes(state);
}

function handleTransportDropped(droppedClient) {
  if (droppedClient !== client) return;
  const droppedTransport = droppedClient.transport;
  stopStatusPolling();
  client = null;
  transport = null;
  connectionVerified = false;
  isBusy = false;
  busyLabel = "";
  suppressConnectionLogs = false;
  setConnected(false);
  updateEnabledState();
  droppedTransport?.disconnect?.();
}

async function startupRefresh({ quiet = false, includeScript = true, timeoutMs = 15000, expectedGeneration = null } = {}) {
  const stale = () => expectedGeneration !== null && expectedGeneration !== connectionGeneration;
  if (stale()) return false;
  const infoOk = await bestEffortStartupStep(() => refreshInfo({ quiet, timeoutMs }), quiet);
  if (!client || stale()) return false;
  const statusOk = await bestEffortStartupStep(() => refreshStatus({ quiet, timeoutMs }), quiet);
  if (!client || stale()) return infoOk || statusOk;
  if (!infoOk && !statusOk) return false;
  if (includeScript) await bestEffortStartupStep(() => getScript({ quiet, timeoutMs }), quiet);
  if (!client || stale()) return infoOk || statusOk;
  await bestEffortStartupStep(() => sendCommand("config.get", {}, { quiet, timeoutMs }).then(updateConfig), quiet);
  if (!client || stale()) return infoOk || statusOk;
  await bestEffortStartupStep(async () => {
    const data = await sendCommand("debug.get", {}, { quiet, timeoutMs });
    if (data.levelName && !localStorage.getItem(storage.logLevel)) {
      els.debugLevel.value = data.levelName;
    }
    await sendCommand("debug.set", { level: els.debugLevel.value }, { quiet, timeoutMs });
  }, quiet);
  return infoOk || statusOk;
}

async function bestEffortStartupStep(action, quiet) {
  try {
    await action();
    return true;
  } catch (error) {
    if (!quiet) logLine("warn", `startup: ${error.message}`);
    return false;
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
  const command = isBinaryTransportKind(transport?.kind) ? "status.light" : "status.get";
  const data = await sendCommand(command, {}, options);
  updateStatus(data);
  renderFields();
  return data;
}

async function getScript(options = {}) {
  const data = isBinaryTransportKind(transport?.kind)
    ? await getScriptChunked(options)
    : await sendCommand("script.get", {}, options);
  await applyFetchedScript(data);
}

async function getScriptChunked(options = {}) {
  let offset = 0;
  let code = "";
  let last = {};
  const maxBytes = isMqttKind(transport?.kind) ? 6000 : 512;
  for (let guard = 0; guard < 80; guard += 1) {
    const data = await sendCommand("script.chunk.get", { offset, maxBytes }, options);
    const chunk = String(data.chunk ?? "");
    const nextOffset = Number(data.nextOffset ?? (offset + chunk.length));
    code += chunk;
    last = data;
    if (data.done || nextOffset <= offset) break;
    offset = nextOffset;
  }
  return {
    ...last,
    code,
    stored: true,
  };
}

async function applyFetchedScript(data) {
  if (typeof data.code === "string") {
    await replaceEditorCode(data.code, { persist: false, saveCurrent: true, markUnsaved: true });
    await rememberUploadedSketch(data.code, "", { promoteExisting: false, preferAutoName: true });
  }
  updateScriptState(data);
}

async function setScript({ run, save }) {
  await uploadScriptCode(getEditorValue(), { run, save });
}

async function uploadScriptCode(code, { run, save, name = "" }) {
  let data;
  setUploadState("uploading", "Uploading code", 8);
  try {
    clearEditorError();
    data = await uploadScriptCodeChunked(code, { run, save });
  } catch (error) {
    setUploadState("error", uploadErrorLabel(error.message), 100, { autoClear: true });
    await rememberUploadedSketch(code, name);
    markEditorError(error.message);
    throw error;
  }
  await rememberUploadedSketch(code, name);
  updateScriptState(data);
  try {
    await refreshStatus({ quiet: true, timeoutMs: 8000 });
  } catch {
    // Status events arrive periodically; a missed post-upload poll should not
    // look like a failed upload when the script is already running.
  }
}

async function uploadScriptCodeChunked(code, { run, save }) {
  const encoder = new TextEncoder();
  const codeData = encoder.encode(code);
  const codeBytes = codeData.length;
  const codeHash = fnv1aHex(code);
  const binaryChunkSize = isMqttKind(transport?.kind) ? 6000 : 320;
  const textChunkSize = uploadTextChunkEnvelopeBytes();
  const chunkPauseMs = uploadChunkPauseMs();
  const chunks = isBinaryTransportKind(transport?.kind) && transport?.sendBytes
    ? chunkBytesForWebRtc(codeData, binaryChunkSize)
    : chunkScriptForWebRtc(code, textChunkSize);
  setUploadState("uploading", "Uploading code", 5);
  logLine("info", `uploading script in ${chunks.length} chunks`);
  await sendCommand("script.chunk.begin", {
    codeBytes,
    codeHash,
    run,
    save,
  }, { quiet: true, timeoutMs: 10000 });

  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const isBinaryChunk = chunk instanceof Uint8Array;
    const response = await sendCommand("script.chunk.add", isBinaryChunk ? {
      offset,
      chunkBytes: chunk,
    } : {
      offset,
      chunk,
    }, { quiet: true, timeoutMs: 10000 });
    const received = Number(response.received);
    offset = Number.isFinite(received) ? received : offset + (isBinaryChunk ? chunk.length : encoder.encode(chunk).length);
    setUploadState("uploading", `Uploading ${index + 1}/${chunks.length}`, Math.round(((index + 1) / chunks.length) * 82));
    if (chunkPauseMs > 0) await settle(chunkPauseMs);
  }

  setUploadState("uploading", "Finalizing upload", 88);
  const response = await sendCommand("script.chunk.commit", {}, { timeoutMs: 10000 });
  if (response.state === "queued") {
    logLine("info", "script upload received; queued on device");
    setUploadState("queued", "Upload received", 90);
    updateScriptState({ state: "queued", scriptBytes: response.scriptBytes });
  } else {
    logLine("info", "script upload complete");
    setUploadState(run ? "running" : "saved", run ? "Running" : "Saved", 100, { autoClear: true });
  }
  return response;
}

function uploadTextChunkEnvelopeBytes() {
  if (transport?.kind === "usb") return 1600;
  if (transport?.kind === "websocket") return 1600;
  return 360;
}

function uploadChunkPauseMs() {
  if (isMqttKind(transport?.kind)) return 0;
  if (transport?.kind === "usb") return 0;
  if (transport?.kind === "websocket") return 0;
  return 12;
}

function chunkScriptForWebRtc(text, maxEnvelopeBytes) {
  const encoder = new TextEncoder();
  const chunks = [];
  let current = "";
  let offset = 0;
  for (const char of String(text ?? "")) {
    const candidate = current + char;
    if (current && scriptChunkEnvelopeBytes(offset, candidate) > maxEnvelopeBytes) {
      chunks.push(current);
      offset += encoder.encode(current).length;
      current = "";
    }
    current += char;
  }
  if (current) chunks.push(current);
  return chunks;
}

function chunkBytesForWebRtc(bytes, maxBytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += maxBytes) {
    chunks.push(bytes.slice(offset, Math.min(offset + maxBytes, bytes.length)));
  }
  return chunks;
}

function scriptChunkEnvelopeBytes(offset, chunk) {
  const payload = {
    type: "cmd",
    id: "999",
    name: "script.chunk.add",
    data: { offset, chunk },
    offset,
    chunk,
  };
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

function fnv1aHex(text) {
  const bytes = new TextEncoder().encode(String(text ?? ""));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
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

function openSketchDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(sketchDbName, sketchDbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(sketchStoreName)) {
        const store = db.createObjectStore(sketchStoreName, { keyPath: "id", autoIncrement: true });
        store.createIndex("at", "at");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open sketch history database"));
  });
}

function sketchDbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function sketchDbTransactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

async function readSketchHistory() {
  try {
    await migrateSketchHistoryToDb();
    const db = await openSketchDb();
    try {
      const tx = db.transaction(sketchStoreName, "readonly");
      const items = await sketchDbRequest(tx.objectStore(sketchStoreName).getAll());
      return items
        .filter((item) => typeof item?.code === "string")
        .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
        .slice(0, sketchHistoryLimit);
    } finally {
      db.close();
    }
  } catch {
    return readSketchHistoryFallback();
  }
}

function readSketchHistoryFallback() {
  try {
    const value = JSON.parse(localStorage.getItem(storage.sketchHistory) || "[]");
    return Array.isArray(value)
      ? value.filter((item) => typeof item?.code === "string").slice(0, sketchHistoryLimit)
      : [];
  } catch {
    return [];
  }
}

async function rememberUploadedSketch(code, name = "", { promoteExisting = true, autoName = true, preferAutoName = false } = {}) {
  const current = String(code ?? "");
  if (!current.trim()) return;

  const history = await readSketchHistory();
  const sketchName = resolveSketchNameForSave(current, name, history, { autoName, preferAutoName });
  const unchangedCurrentSketch = currentSketchSource && current === currentSketchSource;
  const existingByCode = history.find((item) => item?.code === current);

  if (unchangedCurrentSketch) {
    const existing = history.find((item) => {
      if (item?.code !== current) return false;
      if (!currentSketchName) return true;
      return normalizeSketchName(item.name || "") === currentSketchName;
    }) || existingByCode;

    if (existing) {
      const explicitName = normalizeSketchName(name);
      const nextName = explicitName || existing.name || sketchName || currentSketchName;
      if (promoteExisting) {
        const promoted = await promoteSketchHistoryEntry(existing, nextName);
        setCurrentSketchIdentity(
          normalizeSketchName(promoted.name || "") || sketchName || currentSketchName,
          current,
          [promoted, ...history],
        );
      } else {
        if (explicitName && existing.name !== explicitName) {
          existing.name = explicitName;
          await updateSketchHistoryEntry(existing);
          await renderSketchHistory();
        }
        setCurrentSketchIdentity(normalizeSketchName(nextName), current, history);
      }
      return;
    }
  }

  if (existingByCode) {
    const explicitName = normalizeSketchName(name);
    const nextName = explicitName || existingByCode.name || sketchName;
    if (promoteExisting) {
      const promoted = await promoteSketchHistoryEntry(existingByCode, nextName);
      setCurrentSketchIdentity(normalizeSketchName(promoted.name || "") || sketchName, current, [promoted, ...history]);
    } else {
      if (explicitName && existingByCode.name !== explicitName) {
        existingByCode.name = explicitName;
        await updateSketchHistoryEntry(existingByCode);
        await renderSketchHistory();
      } else {
        renderCurrentSketchName();
      }
      setCurrentSketchIdentity(normalizeSketchName(nextName), current, history);
    }
    return;
  }

  if (history[0]?.code === current) {
    if (sketchName && history[0].name !== sketchName) {
      history[0].name = sketchName;
      await updateSketchHistoryEntry(history[0]);
      await renderSketchHistory();
    }
    setCurrentSketchIdentity(sketchName || normalizeSketchName(history[0].name || ""), current, history);
    return;
  }

  const entry = {
    at: new Date().toISOString(),
    bytes: new Blob([current]).size,
    code: current,
    name: sketchName,
  };

  try {
    const db = await openSketchDb();
    try {
      const tx = db.transaction(sketchStoreName, "readwrite");
      const store = tx.objectStore(sketchStoreName);
      store.add(entry);
      await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
          const stale = request.result
            .filter((item) => typeof item?.code === "string")
            .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
            .slice(sketchHistoryLimit);
          stale.forEach((item) => {
            if (item.id !== undefined) store.delete(item.id);
          });
          resolve();
        };
        request.onerror = () => reject(request.error || new Error("Could not trim sketch history"));
      });
      await sketchDbTransactionDone(tx);
    } finally {
      db.close();
    }
    await renderSketchHistory();
    setCurrentSketchIdentity(entry.name, current, [entry, ...history]);
    return;
  } catch {
  }

  rememberUploadedSketchFallback(entry, history);
  await renderSketchHistory();
  setCurrentSketchIdentity(entry.name, current, [entry, ...history]);
}

async function updateSketchHistoryEntry(entry) {
  if (entry?.id === undefined) {
    const history = readSketchHistoryFallback();
    const index = history.findIndex((item) => (
      item?.code === entry?.code
      && normalizeSketchName(item.name || "") === normalizeSketchName(entry.name || "")
    ));
    const fallbackIndex = index >= 0 ? index : history.findIndex((item) => item?.code === entry?.code);
    if (fallbackIndex >= 0) {
      const rest = history.slice();
      rest.splice(fallbackIndex, 1);
      rememberUploadedSketchFallback(entry, rest);
    }
    return;
  }
  try {
    const db = await openSketchDb();
    try {
      const tx = db.transaction(sketchStoreName, "readwrite");
      tx.objectStore(sketchStoreName).put(entry);
      await sketchDbTransactionDone(tx);
    } finally {
      db.close();
    }
  } catch {
  }
}

async function promoteSketchHistoryEntry(entry, name = "") {
  const code = String(entry?.code || "");
  const promoted = {
    ...entry,
    at: new Date().toISOString(),
    bytes: new Blob([code]).size,
    code,
    name: normalizeSketchName(name || entry?.name || ""),
  };
  await updateSketchHistoryEntry(promoted);
  await renderSketchHistory();
  return promoted;
}

function rememberUploadedSketchFallback(entry, history) {
  let next = [entry, ...history].slice(0, sketchHistoryLimit);
  while (next.length) {
    try {
      localStorage.setItem(storage.sketchHistory, JSON.stringify(next));
      return;
    } catch {
      next = next.slice(0, -1);
    }
  }
}

async function migrateSketchHistoryToDb() {
  if (localStorage.getItem(`${storage.sketchHistory}.migrated`) === "1") return;
  const oldHistory = readSketchHistoryFallback();
  if (!oldHistory.length) {
    localStorage.setItem(`${storage.sketchHistory}.migrated`, "1");
    return;
  }

  const db = await openSketchDb();
  try {
    const tx = db.transaction(sketchStoreName, "readwrite");
    const store = tx.objectStore(sketchStoreName);
    oldHistory.slice().reverse().forEach((item) => {
      store.add({
        at: item.at || new Date().toISOString(),
        bytes: item.bytes || new Blob([item.code || ""]).size,
        code: String(item.code || ""),
        name: normalizeSketchName(item.name || ""),
      });
    });
    await sketchDbTransactionDone(tx);
    localStorage.removeItem(storage.sketchHistory);
    localStorage.setItem(`${storage.sketchHistory}.migrated`, "1");
  } finally {
    db.close();
  }
}

async function renderSketchHistory() {
  const history = await readSketchHistory();
  els.sketchHistory.replaceChildren(new Option(sketchHistoryPlaceholderLabel(), ""));
  history.forEach((item, index) => {
    const date = new Date(item.at);
    const when = Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const name = normalizeSketchName(item.name || "");
    const label = name
      ? `${name} / ${when} / ${formatBytes(item.bytes || item.code.length)}`
      : `${when} / ${formatBytes(item.bytes || item.code.length)}`;
    els.sketchHistory.append(new Option(label, String(index)));
  });
  els.sketchHistory.disabled = history.length === 0;
  els.sketchHistory.value = "";
  renderCurrentSketchName();
}

async function recoverSketchHistory() {
  const index = Number(els.sketchHistory.value);
  const history = await readSketchHistory();
  const entry = history[index];
  els.sketchHistory.value = "";
  if (!entry) return;
  await replaceEditorCode(entry.code, {
    saveCurrent: true,
    identityName: entry.name || "",
    identityHistory: history,
  });
  const sketchName = normalizeSketchName(entry.name || "");
  logLine("info", `recovered ${sketchName || "sketch"} from ${new Date(entry.at).toLocaleString()}`);
}

async function createNewSketch() {
  const code = newSketchTemplate();
  await replaceEditorCode(code, { saveCurrent: true, markUnsaved: true });
  clearEditorError();
  logLine("info", "new sketch");
}

async function shelveEditorSketchIfNeeded({ incomingCode = "" } = {}) {
  const current = String(getEditorValue() || "");
  if (!current.trim()) return;
  if (incomingCode && current === String(incomingCode || "")) return;
  const history = await readSketchHistory();
  const alreadySaved = history.some((item) => item?.code === current);
  if (currentSketchSaved && alreadySaved) return;
  await rememberUploadedSketch(current, "", {
    promoteExisting: false,
    preferAutoName: !currentSketchName,
  });
}

function newSketchTemplate() {
  return `// New P1E sketch.
function setup() {
  println("new sketch ready");
}

function loop() {
  delay(20);
}
`;
}

function normalizeSketchName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .replace(/[^\w .:/+-]/g, "")
    .trim()
    .slice(0, 32);
}

function resolveSketchNameForSave(code, requestedName = "", history = [], { autoName = true, preferAutoName = false } = {}) {
  const explicitName = normalizeSketchName(requestedName);
  if (explicitName) return explicitName;
  if (preferAutoName) return autoName ? autoSketchName(code, history) : "";
  if (String(code ?? "") === currentSketchSource) return currentSketchName;
  if (!currentSketchName) return autoName ? autoSketchName(code, history) : "";
  if (currentSketchVersionName) return currentSketchVersionName;
  return autoName ? autoSketchName(code, history) : "";
}

function setCurrentSketchIdentity(name = "", code = "", history = []) {
  currentSketchName = normalizeSketchName(name);
  currentSketchSource = String(code ?? "");
  currentSketchVersionName = currentSketchName ? nextSketchVersionName(currentSketchName, history) : "";
  currentSketchDirty = false;
  currentSketchSaved = true;
  renderCurrentSketchName();
}

function clearCurrentSketchIdentity() {
  currentSketchName = "";
  currentSketchSource = "";
  currentSketchVersionName = "";
  currentSketchDirty = Boolean(String(getEditorValue() || "").trim());
  currentSketchSaved = !currentSketchDirty;
  renderCurrentSketchName();
}

function updateCurrentSketchDirty() {
  const code = getEditorValue();
  currentSketchDirty = currentSketchName
    ? code !== currentSketchSource
    : Boolean(String(code || "").trim());
  currentSketchSaved = !currentSketchDirty;
  renderCurrentSketchName();
}

function renderCurrentSketchName() {
  const option = els.sketchHistory.options[0];
  if (option) option.textContent = sketchHistoryPlaceholderLabel();
  const label = sketchHistoryPlaceholderLabel();
  els.sketchHistory.title = currentSketchName
    ? `Current sketch: ${label}`
    : "Recover uploaded sketch";
}

function sketchHistoryPlaceholderLabel() {
  if (!currentSketchName) return currentSketchDirty ? "unsaved" : "history";
  return currentSketchDirty ? (currentSketchVersionName || currentSketchName) : currentSketchName;
}

function autoSketchName(code, history = []) {
  const base = inferSketchBaseName(code);
  const existing = history.some((item) => normalizeSketchName(item?.name || "").toLowerCase() === base.toLowerCase());
  return existing ? nextSketchVersionName(base, history) : base;
}

function inferSketchBaseName(code) {
  const source = String(code || "");
  const uiTitle = source.match(/\buiBegin\s*\(\s*["']([^"']{2,48})["']/);
  if (uiTitle) return normalizeSketchName(uiTitle[1]) || "Untitled Sketch";

  const printReady = source.match(/\bprintln\s*\(\s*["']([^"']{2,48}?\bready)\b[^"']*["']/i);
  if (printReady) {
    const name = wordsToSketchName(printReady[1].replace(/\bready\b/i, ""));
    if (isMeaningfulAutoSketchName(name)) return name;
  }

  const comment = source.match(/^\s*\/\/\s*([^\n.]{4,90})/m);
  if (comment) {
    const name = wordsToSketchName(comment[1]);
    if (isMeaningfulAutoSketchName(name)) return name;
  }

  if (/\bfetchJson\b|\bgetJsonValue\b|\bhttpGet\b|openweathermap|weather/i.test(source)) return uniqueGenericName("Weather LEDs");
  if (/\bui(Button|Toggle|Slider|Value|Graph|Begin)\b/.test(source)) return uniqueGenericName("UI Controls");
  if (/\bledSetHsv\b|rainbow|hsv|sparkle|chase/i.test(source)) return uniqueGenericName("LED Animation");
  if (/\bledConfig\b|\bledFill\b|\bledSet\b/.test(source)) return uniqueGenericName("LED Sketch");
  if (/\bdigitalRead\b|INPUT_PULLUP|button/i.test(source)) return uniqueGenericName("Button Input");
  if (/\banalogRead\b|sensor|pot/i.test(source)) return uniqueGenericName("Sensor Read");
  return generatedSketchName(source);
}

function uniqueGenericName(name) {
  return normalizeSketchName(name) || "Untitled Sketch";
}

function wordsToSketchName(text) {
  const stop = new Set(["a", "an", "and", "around", "by", "for", "from", "of", "on", "the", "to", "with", "shows", "show", "simple", "using"]);
  const words = String(text || "")
    .replace(/[_/.-]+/g, " ")
    .replace(/[^\w ]+/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => !stop.has(word.toLowerCase()))
    .slice(0, 4);
  if (!words.length) return "";
  return normalizeSketchName(words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(" "));
}

function isMeaningfulAutoSketchName(name) {
  const normalized = normalizeSketchName(name).toLowerCase();
  if (!normalized) return false;
  return ![
    "new sketch",
    "new p1e sketch",
    "p1e sketch",
    "sketch",
    "untitled sketch",
  ].includes(normalized);
}

function generatedSketchName(code) {
  const syllables = [
    "ba", "be", "bo", "da", "de", "do", "fa", "fe", "fi", "go", "la", "le",
    "li", "lo", "ma", "me", "mi", "na", "ne", "no", "ra", "re", "ri", "sa",
    "se", "so", "ta", "te", "to", "va", "ve", "vi", "za", "ze", "zo",
  ];
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(String(code || `${Date.now()}`));
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const makeWord = (count) => {
    let word = "";
    for (let i = 0; i < count; i += 1) {
      hash = Math.imul(hash ^ (i + 17), 0x01000193) >>> 0;
      word += syllables[hash % syllables.length];
    }
    return word[0].toUpperCase() + word.slice(1);
  };
  return normalizeSketchName(`${makeWord(4)} ${makeWord(3)}`);
}

function nextSketchVersionName(name, history = []) {
  const parts = splitSketchVersion(name);
  if (!parts.base) return "";
  let maxVersion = parts.version;
  history.forEach((item) => {
    const itemParts = splitSketchVersion(item?.name || "");
    if (itemParts.base.toLowerCase() === parts.base.toLowerCase()) {
      maxVersion = Math.max(maxVersion, itemParts.version);
    }
  });
  return formatSketchVersion(parts.base, maxVersion + 1);
}

function splitSketchVersion(name) {
  const normalized = normalizeSketchName(name);
  const match = normalized.match(/^(.*?)\s+v(\d+)$/i);
  if (!match) return { base: normalized, version: normalized ? 1 : 0 };
  const base = normalizeSketchName(match[1]);
  const version = Math.max(1, Number(match[2]) || 1);
  return { base, version };
}

function formatSketchVersion(base, version) {
  const suffix = ` v${version}`;
  const room = Math.max(1, 32 - suffix.length);
  return normalizeSketchName(`${normalizeSketchName(base).slice(0, room).trim()}${suffix}`);
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
    await replaceEditorCode(text, { saveCurrent: true, markUnsaved: true });
    logLine("info", file ? `loaded ${file.name}` : "loaded dropped text");
  });
}

function formatBytes(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} KB`;
}

function openSettingsDialog() {
  els.deviceNameInput.value = lastInfo?.deviceName || lastStatus?.deviceName || "";
  els.wifiSsid.value = "";
  els.wifiPassword.value = "";
  populateMqttSettings();
  renderWifiNetworkList();
  wifiDraftDirty = false;
  els.settingsDialog.showModal();
  els.deviceNameInput.focus();
  els.deviceNameInput.select();
}

function mqttDefaults() {
  return {
    mqttHost: "public.cloud.shiftr.io",
    mqttPort: 1883,
    mqttRoot: "",
    mqttUser: "public",
    mqttPassword: "public",
  };
}

function mqttConfigFromStorageAndDevice() {
  const defaults = mqttDefaults();
  const storedRoot = mqttRootOrEmpty(localStorage.getItem(storage.mqttRoot));
  const deviceRoot = mqttRootOrEmpty(lastConfig?.mqttRoot);
  return {
    mqttHost: localStorage.getItem(storage.mqttHost) || lastConfig?.mqttHost || defaults.mqttHost,
    mqttPort: Number(localStorage.getItem(storage.mqttPort) || lastConfig?.mqttPort || defaults.mqttPort),
    mqttRoot: storedRoot || deviceRoot || defaults.mqttRoot,
    mqttUser: localStorage.getItem(storage.mqttUser) || lastConfig?.mqttUser || defaults.mqttUser,
    mqttPassword: localStorage.getItem(storage.mqttPassword) || defaults.mqttPassword,
  };
}

function mqttRootOrEmpty(value) {
  return String(value || "").trim();
}

function mqttTransportOptions() {
  const cfg = mqttConfigFromStorageAndDevice();
  const host = String(cfg.mqttHost || "").trim();
  const isSecurePage = window.location.protocol === "https:";
  const mqttUrl = host.startsWith("ws://") || host.startsWith("wss://")
    ? host
    : `${isSecurePage ? "wss" : "ws"}://${host}`;
  return {
    mqttUrl,
    username: cfg.mqttUser,
    password: cfg.mqttPassword,
    root: cfg.mqttRoot,
  };
}

function applyMqttParams(params) {
  const host = String(params.get("mqttHost") || "").trim();
  const port = Number(params.get("mqttPort") || 0);
  const root = mqttRootOrEmpty(params.get("mqttRoot"));
  const user = String(params.get("mqttUser") || "").trim();
  if (host) localStorage.setItem(storage.mqttHost, host);
  if (Number.isFinite(port) && port > 0) localStorage.setItem(storage.mqttPort, String(port));
  if (root) localStorage.setItem(storage.mqttRoot, root);
  if (user) localStorage.setItem(storage.mqttUser, user);
}

function populateMqttSettings() {
  const cfg = mqttConfigFromStorageAndDevice();
  els.mqttHost.value = cfg.mqttHost;
  els.mqttPort.value = String(cfg.mqttPort || 1883);
  els.mqttRoot.value = cfg.mqttRoot;
  els.mqttUser.value = cfg.mqttUser;
  els.mqttPassword.value = "";
  els.mqttPassword.placeholder = lastConfig?.mqttPasswordSet ? "saved" : "default";
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
  wifiDraftDirty = false;
  updateConfig(config);
  await refreshStatus();
}

async function saveMqtt() {
  const mqttHost = els.mqttHost.value.trim();
  const mqttPort = Number(els.mqttPort.value || 0);
  const mqttRoot = els.mqttRoot.value.trim();
  const mqttUser = els.mqttUser.value.trim();
  const mqttPassword = els.mqttPassword.value;
  const data = {};
  if (mqttHost) data.mqttHost = mqttHost;
  if (Number.isFinite(mqttPort) && mqttPort > 0) data.mqttPort = mqttPort;
  data.mqttRoot = mqttRoot;
  if (mqttUser) data.mqttUser = mqttUser;
  if (mqttPassword) data.mqttPassword = mqttPassword;

  const config = await sendCommand("config.set", data, { timeoutMs: 10000 });
  if (data.mqttHost) localStorage.setItem(storage.mqttHost, data.mqttHost);
  if (data.mqttPort) localStorage.setItem(storage.mqttPort, String(data.mqttPort));
  if (data.mqttRoot) localStorage.setItem(storage.mqttRoot, data.mqttRoot);
  else localStorage.removeItem(storage.mqttRoot);
  if (data.mqttUser) localStorage.setItem(storage.mqttUser, data.mqttUser);
  if (data.mqttPassword) localStorage.setItem(storage.mqttPassword, data.mqttPassword);
  els.mqttPassword.value = "";
  updateConfig(config);
  await refreshStatus({ quiet: true, timeoutMs: 6000 });
  logLine("info", "MQTT settings saved");
}

async function forgetWifiNetwork(index) {
  const config = await sendCommand("wifi.forget", { index }, { timeoutMs: 10000 });
  wifiDraftDirty = false;
  updateConfig(config);
  await refreshStatus({ quiet: true, timeoutMs: 6000 });
}

async function sendRaw() {
  try {
    const line = els.raw.value.trim();
    const parsed = JSON.parse(line);
    if (isBinaryTransportKind(transport?.kind) && parsed?.type === "cmd" && parsed.name) {
      if (!canEncodeCommand(parsed.name)) throw new Error(`No MessagePack opcode for ${parsed.name}`);
      const data = { ...(parsed.data || {}) };
      for (const [key, value] of Object.entries(parsed)) {
        if (!["type", "id", "name", "data"].includes(key)) data[key] = value;
      }
      await sendCommand(parsed.name, data);
      logLine("debug", `> ${parsed.name} msgpack`);
      return;
    }
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
    const useMsgPack = isBinaryTransportKind(transport?.kind);
    if (useMsgPack && !transport?.sendBytes) throw new Error(`${connectionKindLabel(transport?.kind)} transport has no binary channel`);
    if (useMsgPack && !canEncodeCommand(name)) throw new Error(`No MessagePack opcode for ${name}`);
    let response;
    response = useMsgPack
      ? await client.requestMsgPack(name, data, requestOptions)
      : await client.request(name, data, requestOptions);
    if (useMsgPack && !quiet) logLine("debug", `< ${name} msgpack ok`);
    if (!quiet) logLine("debug", `< ${name} ok`);
    return response;
  } catch (error) {
    if (!quiet) logLine("error", `${name}: ${error.message}`);
    throw error;
  }
}

function acceptEvent(event) {
  const data = event.data || {};
  const level = eventLogLevel(event.name, data);

  if (event.name === "device.status" && data.status) {
    updateStatus(data.status);
    return;
  }

  if (event.name?.startsWith("ui.")) {
    guinoView?.acceptEvent(event.name, data);
  }

  const message = eventMessage(event.name, data);
  if (shouldLogEvent(event.name, data, message)) {
    logLine(level, `${event.name}: ${message}`);
  }

  if (event.name === "script.error") {
    const errorData = data.error || data;
    const count = Number(errorData?.count);
    if (Number.isFinite(count)) lastLoggedScriptErrorCount = Math.max(lastLoggedScriptErrorCount, count);
    markEditorError(message);
  }
  if (event.name === "wifi.status") updateWifi(data.wifi || data);
  if (event.name === "script.state") updateScriptState(data);
  if (event.name === "script.upload") {
    updateUploadFromEvent(data);
    updateScriptState(data);
  }
  if (event.name === "device.boot") {
    if (data.info) lastInfo = data.info;
    if (data.status) updateStatus(data.status);
    renderFields();
  }
}

function eventLogLevel(name = "", data = {}) {
  if (name?.startsWith("ui.")) return "debug";
  if (data.level) return data.level;
  if (name?.includes("error")) return "error";
  if (name === "script.upload") {
    const state = String(data.state || data.phase || "").toLowerCase();
    return state === "error" ? "error" : "debug";
  }
  if (name?.startsWith("webrtc.")) {
    const state = String(data.state || data.status || "").toLowerCase();
    if (state.includes("fail") || state.includes("error")) return "error";
    return "debug";
  }
  return "info";
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
    return wifiConsoleState(data).message;
  }

  if (name === "led.status") {
    return data.status || data.message || data.code || "updated";
  }

  if (name === "script.upload") {
    return [
      data.state || "upload",
      data.phase ? `phase ${data.phase}` : "",
      data.scriptBytes ? `${data.scriptBytes} bytes` : "",
      data.message || "",
    ].filter(Boolean).join(" / ");
  }

  if (name === "ui.item") {
    return [data.type || "item", data.id || "", data.label || ""].filter(Boolean).join(" / ");
  }

  if (name === "ui.value") {
    return [data.id || "", data.value ?? ""].filter((part) => part !== "").join(" = ");
  }

  return data.message || data.code || data.status || data.state || name;
}

function shouldLogEvent(name, data = {}, message = "") {
  if (name === "wifi.status") {
    return shouldLogWifiEvent(data);
  }

  if (name === "script.state") {
    const state = data.state || data.scriptState || "";
    if (busyLabel === "uploading" && (state === "stopped" || state === "compiled")) return false;
  }

  if (name === "ui.value" || name === "ui.text") return false;

  const signature = `${name}:${message}`;
  const now = Date.now();
  if (signature === lastConsoleEventSignature && now - lastConsoleEventAt < 2500) return false;
  lastConsoleEventSignature = signature;
  lastConsoleEventAt = now;
  return true;
}

function updateUploadFromEvent(data = {}) {
  const state = String(data.state || data.phase || "").toLowerCase();
  if (state === "queued") {
    setUploadState("queued", "Upload received", 90);
  } else if (state === "compiling") {
    setUploadState("compiling", "Compiling on board", 94);
  } else if (state === "running") {
    setUploadState("running", "Running", 100, { autoClear: true });
  } else if (state === "saved" || state === "stored") {
    setUploadState("saved", "Saved", 100, { autoClear: true });
  } else if (state === "error") {
    setUploadState("error", uploadErrorLabel(data.message || data.code), 100, { autoClear: true });
  }
}

function uploadErrorLabel(message = "") {
  const text = String(message || "");
  if (/not enough contiguous heap|compile_memory_low|memory_low/i.test(text)) return "No Heap";
  return text || "Upload failed";
}

function setUploadState(phase = "", label = "", progress = 0, { autoClear = false } = {}) {
  if (uploadClearTimer) {
    window.clearTimeout(uploadClearTimer);
    uploadClearTimer = null;
  }

  uploadState = {
    phase,
    label,
    progress: Math.max(0, Math.min(100, Number(progress) || 0)),
  };
  renderUploadState();

  if (autoClear) {
    uploadClearTimer = window.setTimeout(() => {
      uploadClearTimer = null;
      uploadState = { phase: "", label: "", progress: 0 };
      renderUploadState();
    }, phase === "error" ? 5200 : 2600);
  }
}

function renderUploadState() {
  const active = Boolean(uploadState.phase);
  const label = uploadState.label || uploadState.phase || "";
  const progress = uploadState.progress || 0;
  [
    [els.uploadStatus, els.uploadStatusLabel, els.uploadStatusProgress],
    [els.chatUploadStatus, els.chatUploadStatusLabel, els.chatUploadStatusProgress],
  ].forEach(([wrap, labelEl, progressEl]) => {
    if (!wrap) return;
    const iconEl = wrap.querySelector(".upload-status-icon");
    wrap.classList.toggle("is-hidden", !active);
    wrap.classList.toggle("is-error", uploadState.phase === "error");
    wrap.classList.toggle("is-complete", uploadState.phase === "running" || uploadState.phase === "saved");
    wrap.classList.toggle("is-active", active && uploadState.phase !== "error");
    if (iconEl) {
      iconEl.textContent = uploadState.phase === "error" ? "error" : (uploadState.phase === "running" || uploadState.phase === "saved" ? "check_circle" : "progress_activity");
    }
    if (labelEl) labelEl.textContent = label;
    if (progressEl) progressEl.value = progress;
  });

  const runIcon = els.run?.querySelector(".material-symbols-rounded");
  if (runIcon) {
    const working = active && !["running", "saved", "error"].includes(uploadState.phase);
    runIcon.classList.toggle("is-spinning", working);
    runIcon.textContent = working ? "progress_activity" : "play_arrow";
  }
}

function shouldLogWifiEvent(data = {}) {
  const wifi = wifiConsoleState(data);
  const now = Date.now();
  const changed = wifi.key !== lastWifiConsoleKey;
  const canRepeat = wifi.repeatMs > 0 && now - lastWifiConsoleAt >= wifi.repeatMs;
  if (!changed && !canRepeat) return false;
  lastWifiConsoleKey = wifi.key;
  lastWifiConsoleAt = now;
  return true;
}

function wifiConsoleState(data = {}) {
  const rawStatus = String(data.status || data.state || "").toLowerCase();
  const ssid = String(data.ssid || "").trim();
  const ip = String(data.ip || "").trim();
  const connected = data.connected === true || rawStatus === "connected";
  let group = rawStatus || "unknown";
  let label = rawStatus || "unknown";
  let repeatMs = 0;

  if (connected) {
    group = "connected";
    label = "connected";
  } else if (rawStatus.includes("connecting") || rawStatus === "reconnecting") {
    group = "connecting";
    label = "connecting";
    repeatMs = 30000;
  } else if (rawStatus.includes("fail")) {
    group = "failed";
    label = "connect failed";
  } else if (["disconnected", "no_ssid", "idle", "off"].includes(rawStatus)) {
    group = "disconnected";
    label = "disconnected";
  }

  const parts = [label, ssid, connected && ip && ip !== "0.0.0.0" ? ip : ""].filter(Boolean);
  return {
    key: `wifi:${group}:${ssid}:${connected ? ip : ""}`,
    message: parts.join(" / "),
    repeatMs,
  };
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
    editor.session.addGutterDecoration(row, "wrench-error-gutter");
    editorErrorGutterRow = row;
    editor.scrollToLine(row, true, true, () => {});
    requestAnimationFrame(() => {
      editor.resize(true);
      editor.renderer?.updateFull?.();
    });
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
    if (editorErrorGutterRow !== null) {
      editor.session.removeGutterDecoration(editorErrorGutterRow, "wrench-error-gutter");
      editorErrorGutterRow = null;
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
  lastStatus = mergeStatusSnapshot(lastStatus, status);
  reportStatusScriptError(status.lastError);
  updateScriptState(lastStatus);
  if (Object.prototype.hasOwnProperty.call(status, "wifi")) updateWifi(status.wifi, { render: false });
  renderConnectionState();
  renderFields();
}

function mergeStatusSnapshot(previous = {}, next = {}) {
  const merged = { ...(previous || {}), ...(next || {}) };
  for (const key of ["wifi", "web", "webrtc", "led", "memory", "lastError", "wrenchRuntime"]) {
    if (!Object.prototype.hasOwnProperty.call(next, key) && previous?.[key]) {
      merged[key] = previous[key];
    }
  }
  return merged;
}

function reportStatusScriptError(error = {}) {
  const count = Number(error?.count);
  if (!error?.hasError || !Number.isFinite(count) || count <= lastLoggedScriptErrorCount) return;
  lastLoggedScriptErrorCount = count;
  const message = error.message || error.code || "script error";
  logLine("error", `script.error: ${message}`);
  markEditorError(message);
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

function updateWifi(wifi = {}, options = {}) {
  if (!wifi) return;
  lastStatus = {
    ...(lastStatus || {}),
    wifi: { ...(lastStatus?.wifi || {}), ...wifi },
  };
  setWifiSsidFromDevice(wifi.ssid);
  if (options.render !== false) {
    renderConnectionState();
    renderFields();
  }
}

function updateConfig(config = {}) {
  lastConfig = config;
  if (config.mqttHost) localStorage.setItem(storage.mqttHost, config.mqttHost);
  if (config.mqttPort) localStorage.setItem(storage.mqttPort, String(config.mqttPort));
  const mqttRoot = mqttRootOrEmpty(config.mqttRoot);
  if (mqttRoot) localStorage.setItem(storage.mqttRoot, mqttRoot);
  else localStorage.removeItem(storage.mqttRoot);
  if (config.mqttUser) localStorage.setItem(storage.mqttUser, config.mqttUser);
  if (els.settingsDialog.open) populateMqttSettings();
  if (config.deviceName) {
    lastInfo = { ...(lastInfo || {}), deviceName: config.deviceName };
    lastStatus = { ...(lastStatus || {}), deviceName: config.deviceName };
    if (els.deviceNameInput && document.activeElement !== els.deviceNameInput) {
      els.deviceNameInput.value = config.deviceName;
    }
  }
  if (Array.isArray(config.wifiNetworks) && config.wifiNetworks[0]?.ssid) {
    setWifiSsidFromDevice(config.wifiNetworks[0].ssid);
  } else if (config.wifiSsid) {
    setWifiSsidFromDevice(config.wifiSsid);
  }
  renderWifiNetworkList();
  renderFields();
}

function setWifiSsidFromDevice(ssid) {
  if (!ssid) return;
  if (els.settingsDialog.open) return;
  const active = document.activeElement;
  const editingWifi =
    els.settingsDialog.open &&
    (wifiDraftDirty || active === els.wifiSsid || active === els.wifiPassword);
  if (editingWifi) return;
  els.wifiSsid.value = ssid;
}

function renderWifiNetworkList() {
  if (!els.wifiNetworkList) return;
  const networks = Array.isArray(lastConfig?.wifiNetworks) ? lastConfig.wifiNetworks : [];
  els.wifiNetworkList.replaceChildren();
  if (!networks.length) {
    const empty = document.createElement("div");
    empty.className = "wifi-network-empty";
    empty.textContent = "No saved networks";
    els.wifiNetworkList.append(empty);
    return;
  }
  networks.forEach((network, index) => {
    const row = document.createElement("div");
    row.className = "wifi-network-row";
    const icon = document.createElement("span");
    icon.className = "material-symbols-rounded";
    icon.textContent = "wifi";
    const label = document.createElement("span");
    label.className = "wifi-network-name";
    label.textContent = network?.ssid || `Network ${index + 1}`;
    const meta = document.createElement("span");
    meta.className = "wifi-network-meta";
    meta.textContent = network?.passwordSet ? "saved" : "open";
    const remove = document.createElement("button");
    remove.className = "button compact icon-buttonish";
    remove.type = "button";
    remove.title = `Forget ${network?.ssid || "network"}`;
    remove.setAttribute("aria-label", remove.title);
    remove.innerHTML = '<span class="material-symbols-rounded">close</span>';
    remove.disabled = !isDeviceConnected() || isBusy;
    remove.addEventListener("click", () => runUiAction(() => forgetWifiNetwork(index), "wifi"));
    row.append(icon, label, meta, remove);
    els.wifiNetworkList.append(row);
  });
}

function renderFields() {
  const wifi = lastStatus?.wifi || {};
  const web = lastStatus?.web || {};
  const webrtc = lastStatus?.webrtc || {};
  const mqtt = lastStatus?.mqtt || {};
  const scriptRunning = isScriptRunning();
  const wsUrl = client ? activeWebSocketUrl(web) : "";
  const peerId = client ? activePeerId(webrtc, mqtt) : "";
  const shareTarget = bestInfoShareTarget({ web, webrtc, mqtt });
  const shareUrl = shareTarget ? sharePageUrl(shareTarget.kind, shareTarget.wsUrl, shareTarget.usbHint, shareTarget.peerId) : "";
  syncConnectedShareParams();
  if (els.brandVersion) {
    els.brandVersion.textContent = lastInfo?.firmwareVersion || "0.1.87";
  }
  renderInfoShare(shareUrl);
  els.fields.replaceChildren(
    infoCard("developer_board", lastInfo?.deviceName || lastStatus?.deviceName || "P1E board", [
      infoMetric("Firmware", [lastInfo?.firmwareName, lastInfo?.firmwareVersion].filter(Boolean).join(" ") || "-"),
      infoMetric("Uptime", formatDuration(lastStatus?.uptimeMs) || "-"),
    ]),
    infoCard(scriptRunning ? "play_circle" : "stop_circle", scriptStatusLabel(), [
      infoMetric("Script", compactScriptLabel()),
      infoMetric("Speed", wrenchFpsLabel() || "-"),
      infoMetric("Loop", scriptRunning ? (lastStatus?.wrenchLoopCount ?? "-") : "-"),
    ]),
    infoCard("memory", memoryStatusLabel() || "Memory", [
      infoMetric("Free heap", lastStatus?.freeHeap ? `${lastStatus.freeHeap} bytes` : "-"),
      infoMetric("Max alloc", lastStatus?.maxAllocHeap ? `${lastStatus.maxAllocHeap} bytes` : "-"),
      infoMetric("Worker", scriptRuntimeLabel() || "-"),
      infoMetric("Protocol", lastInfo?.protocolVersion || "-"),
    ], { compact: true }),
    infoCard("share", "Connect", [
      infoMetric("WiFi", wifi.connected ? wifi.ssid || "connected" : "offline"),
      infoMetric("IP", wifi.ip || "-"),
      infoMetric("Signal", wifiSignalLabel(wifi)),
      infoMetric("MQTT", mqttSharePeerId(mqtt) || "-"),
      infoMetric("WebSocket", wsUrl || "-"),
      infoMetric("Share", shareUrl || "-"),
    ], { compact: true, links: { peerId: mqttSharePeerId(mqtt) || peerId, wsUrl, shareUrl } }),
  );
}

function bestInfoShareTarget({ web = {}, webrtc = {}, mqtt = {} } = {}) {
  const mqttPeer = mqttSharePeerId(mqtt);
  if (mqttPeer && isConnectionKindAvailable("mqtt")) {
    return { kind: "mqtt", peerId: mqttPeer };
  }
  const wsUrl = activeWebSocketUrl(web);
  if (wsUrl && isConnectionKindAvailable("websocket")) {
    return { kind: "websocket", wsUrl };
  }
  const rtcPeer = activeWebRtcSharePeerId(webrtc);
  if (rtcPeer && isConnectionKindAvailable("webrtc")) {
    return { kind: "webrtc", peerId: rtcPeer };
  }
  if (transport?.kind === "usb" && isConnectionKindAvailable("usb")) {
    return { kind: "usb", usbHint: readUsbHint() };
  }
  return null;
}

function mqttSharePeerId(mqtt = {}) {
  if (isMqttKind(transport?.kind) && transport?.remoteId) return normalizePeerId(transport.remoteId);
  if (mqtt?.connected && mqtt.deviceId) return normalizePeerId(mqtt.deviceId);
  return "";
}

function activeWebRtcSharePeerId(webrtc = {}) {
  if (isWebRtcKind(transport?.kind) && transport?.remoteId) return normalizePeerId(transport.remoteId);
  return normalizePeerId(webrtc.peerId || "");
}

function infoCard(icon, title, metrics = [], options = {}) {
  const card = document.createElement("section");
  card.className = `info-card${options.compact ? " info-card-compact" : ""}`;
  const header = document.createElement("header");
  const iconEl = document.createElement("span");
  iconEl.className = "material-symbols-rounded info-card-icon";
  iconEl.textContent = icon;
  const titleEl = document.createElement("strong");
  titleEl.textContent = title || "-";
  header.append(iconEl, titleEl);
  const body = document.createElement("div");
  body.className = "info-card-body";
  metrics.forEach((metric) => body.append(renderInfoMetric(metric, options.links || {})));
  card.append(header, body);
  return card;
}

function infoMetric(label, value) {
  return { label, value };
}

function renderInfoMetric(metric, links = {}) {
  const row = document.createElement("div");
  row.className = "info-metric";
  const label = document.createElement("span");
  label.textContent = metric.label;
  const value = document.createElement("strong");
  const text = String(metric.value || "-");
  if (metric.label === "MQTT" && links.peerId) {
    value.append(infoActionLink(text, () => connectMqtt(links.peerId), "Connect MQTT"));
  } else if (metric.label === "WebSocket" && links.wsUrl) {
    value.append(infoActionLink(text, () => connectWebSocket(links.wsUrl), "Connect WebSocket"));
  } else if (metric.label === "Share" && links.shareUrl) {
    const link = document.createElement("a");
    link.className = "info-link";
    link.href = links.shareUrl;
    link.textContent = links.shareUrl;
    link.title = "Open this interface and connect to this device";
    value.append(link);
  } else {
    value.textContent = text;
  }
  row.append(label, value);
  return row;
}

function infoActionLink(text, action, title) {
  const button = document.createElement("button");
  button.className = "info-link";
  button.type = "button";
  button.textContent = text;
  button.title = title;
  button.addEventListener("click", action);
  return button;
}

function compactScriptLabel() {
  const state = String(els.scriptState.textContent || "");
  return state.replace(/\s*\/\s*/g, " / ") || "-";
}

function wifiSignalLabel(wifi = {}) {
  if (!wifi.connected) return "-";
  const rssi = Number(wifi.rssi);
  if (!Number.isFinite(rssi) || rssi === 0) return "connected";
  if (rssi >= -55) return `strong (${rssi} dBm)`;
  if (rssi >= -70) return `ok (${rssi} dBm)`;
  return `weak (${rssi} dBm)`;
}

function renderInfoShare(shareUrl = "") {
  const url = String(shareUrl || "");
  els.infoShare.classList.toggle("is-hidden", !url);
  if (!url) {
    els.infoQr.replaceChildren();
    delete els.infoQr.dataset.url;
    return;
  }

  if (els.infoQr.dataset.url === url) return;
  els.infoQr.dataset.url = url;
  els.infoQr.replaceChildren(renderQrCanvas(url));
}

function renderQrCanvas(text) {
  if (typeof window.createQRCode !== "function") {
    const fallback = document.createElement("div");
    fallback.className = "info-qr-fallback";
    fallback.textContent = "QR unavailable";
    return fallback;
  }

  try {
    const qr = window.createQRCode(text);
    const quiet = 4;
    const scale = Math.max(2, Math.floor(150 / (qr.size + quiet * 2)));
    const pixels = (qr.size + quiet * 2) * scale;
    const canvas = document.createElement("canvas");
    canvas.width = pixels;
    canvas.height = pixels;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pixels, pixels);
    ctx.fillStyle = "#000000";
    for (let y = 0; y < qr.size; y += 1) {
      for (let x = 0; x < qr.size; x += 1) {
        if (qr.getModule(x, y)) {
          ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
        }
      }
    }
    return canvas;
  } catch (error) {
    const fallback = document.createElement("div");
    fallback.className = "info-qr-fallback";
    fallback.textContent = error.message || "QR failed";
    return fallback;
  }
}

async function copyInfoShareLink() {
  const url = els.infoQr.dataset.url || "";
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    logLine("info", "share link copied");
  } catch (error) {
    logLine("error", error.message || "copy failed");
  }
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

function activeWebSocketUrl(web = {}) {
  if (transport?.kind === "websocket" && transport?.url) {
    try {
      return normalizeWebSocketUrl(transport.url);
    } catch {}
  }
  if (transport?.kind === "usb") return websocketUrlFromStatus(web);
  return "";
}

function activePeerId(webrtc = {}, mqtt = {}) {
  if ((isMqttKind(transport?.kind) || isWebRtcKind(transport?.kind)) && transport?.remoteId) return normalizePeerId(transport.remoteId);
  if (transport?.kind === "usb" || transport?.kind === "websocket") {
    if (mqtt.deviceId) return normalizePeerId(mqtt.deviceId);
    return normalizePeerId(webrtc.peerId || "");
  }
  return "";
}

function syncConnectedShareParams() {
  if (!client || !window.history?.replaceState) return;
  const target = bestInfoShareTarget({
    web: lastStatus?.web || {},
    webrtc: lastStatus?.webrtc || {},
    mqtt: lastStatus?.mqtt || {},
  });
  if (target) {
    updateConnectionUrlParams(target.kind, target.wsUrl, target.usbHint, target.peerId);
    return;
  }
  if (transport?.kind === "websocket" && transport?.url) {
    updateConnectionUrlParams("websocket", transport.url);
    return;
  }
  if ((isMqttKind(transport?.kind) || isWebRtcKind(transport?.kind)) && transport?.remoteId) {
    updateConnectionUrlParams(isMqttKind(transport?.kind) ? "mqtt" : "webrtc", "", null, transport.remoteId);
    return;
  }
  if (transport?.kind === "usb") {
    updateConnectionUrlParams("usb", "", readUsbHint());
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

function isScriptRunning() {
  return String(lastStatus?.scriptState || "").toLowerCase() === "running";
}

function scriptRuntimeLabel() {
  const state = String(lastStatus?.scriptState || "").toLowerCase();
  if (state === "running") return "running";
  if (state === "compiled" || state === "stored") return "ready";
  if (state === "error") return "error";
  if (state === "empty") return "";
  if (state) return "stopped";
  return "";
}

function wrenchFpsLabel() {
  if (!isScriptRunning()) return "";

  const fps = Number(lastStatus?.wrenchLoopFps);
  if (Number.isFinite(fps) && fps > 0) {
    return `${Math.round(fps)} fps`;
  }

  const loops = Number(lastStatus?.wrenchLoopCount);
  const uptimeMs = Number(lastStatus?.uptimeMs);
  if (Number.isFinite(loops) && loops > 0 && Number.isFinite(uptimeMs) && uptimeMs > 0) {
    return `${Math.round(loops / (uptimeMs / 1000))} fps avg`;
  }

  return "";
}

function setConnected(isConnected) {
  els.connection.classList.toggle("is-online", isConnected);
  syncGuinoConnectionState();
  renderConnectionState();
  updateEnabledState();
  renderConnectionHistory();
  renderFields();
  if (isConnected && els.views.ui?.classList.contains("is-active")) requestGuinoRefresh({ quiet: true });
}

function isDeviceConnected() {
  return Boolean(client && transport?.connected);
}

function syncGuinoConnectionState() {
  const connected = isDeviceConnected();
  els.views.ui?.classList.toggle("is-disconnected", !connected);
  els.uiCanvas?.setAttribute("aria-disabled", connected ? "false" : "true");
  guinoView?.setConnected(connected);
}

function renderConnectionState(transportState = "") {
  const transportOnline = Boolean(client && transport?.connected);
  els.connection.classList.toggle("is-online", transportOnline);
  if (!client || (!transportOnline && !isBusy)) {
    els.connection.textContent = "not connected";
    return;
  }

  const parts = [connectionDeviceLabel(), transportProtocolLabel()];
  if (isBusy && busyLabel) {
    parts.push(busyLabel);
  } else {
    parts.push(scriptStatusLabel());
  }
  parts.push(statusFpsLabel());
  parts.push(wifiStatusLabel());
  parts.push(memoryStatusLabel());

  const state = transportState && !["connected", "connecting", "hub_open", "trying_device"].includes(transportState) ? transportState : "";
  if (state) parts.push(state);
  els.connection.textContent = parts.filter(Boolean).join(" | ");
}

function connectionDeviceLabel() {
  return lastInfo?.deviceName || lastStatus?.deviceName || transport?.label || "device";
}

function transportProtocolLabel() {
  const kind = transport?.kind;
  if (isMqttKind(kind)) return "MQTT";
  if (isWebRtcKind(kind)) return "WebRTC";
  if (kind === "usb") return "USB";
  if (kind === "websocket") return "WS";
  return "";
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

function statusFpsLabel() {
  return wrenchFpsLabel();
}

function memoryStatusLabel() {
  const free = Number(lastStatus?.freeHeap);
  const total = Number(lastStatus?.heapSize || lastInfo?.heapSize || 327680);
  if (Number.isFinite(free) && Number.isFinite(total) && total > 0) {
    const usedPct = Math.max(0, Math.min(100, Math.round((1 - free / total) * 100)));
    return `${usedPct}%`;
  }
  return "";
}

function initChat() {
  els.chatModel.replaceChildren(...chatModelOptions.map((model) => new Option(model, model)));
  const savedModel = localStorage.getItem(storage.chatModel);
  els.chatModel.value = chatModelOptions.includes(savedModel) ? savedModel : defaultChatModel;
  if (!els.chatModel.value) els.chatModel.value = chatModelOptions[0] || "";
  chatMessages = readChatHistory();
  renderChatTranscript();
  updateChatKeyButton();
  updateChatDebugPromptButton();
  updateChatEnabledState();
}

function readChatHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storage.chatHistory) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => ["user", "assistant", "error"].includes(item?.role) && typeof item?.content === "string")
      .slice(-60);
  } catch {
    return [];
  }
}

function saveChatHistory() {
  localStorage.setItem(storage.chatHistory, JSON.stringify(chatMessages.slice(-60)));
}

function clearChat() {
  chatMessages = [];
  localStorage.removeItem(storage.chatHistory);
  renderChatTranscript();
  updateChatEnabledState();
}

async function runInstallAction(action) {
  if (flasherBusy) return;
  flasherBusy = true;
  updateInstallEnabledState();
  try {
    await action();
  } catch (error) {
    const message = `Error: ${error.message || error}`;
    installLog(message);
    installStatus(message);
  } finally {
    flasherBusy = false;
    updateInstallEnabledState();
  }
}

async function connectFlasher() {
  ensureFlasher();
  await releaseDeviceTransportForInstall();
  const chipName = await flasher.connect();
  installStatus(chipName ? `connected / ${chipName}` : "connected");
}

async function flashInstallManifest() {
  ensureFlasher();
  els.installLog.textContent = "";
  els.installGoCode.classList.add("is-hidden");
  await releaseDeviceTransportForInstall();
  const manifest = els.installManifest.value.trim() || "bin/p1e-firmware.json";
  els.installProgress.value = 0;
  installStatus("Choose your ESP32 serial port");
  await flasher.flashManifest(manifest);
  const hint = normalizeUsbHint(flasher.port?.getInfo?.() || null);
  installStatus("Upload complete. Waiting for board...");
  await flasher.disconnect();
  await settle(1800);
  await applyInstallSetupAfterUpload(hint);
}

async function releaseDeviceTransportForInstall() {
  localStorage.setItem(storage.reconnectOnLoad, "0");
  if (client || transport) {
    await disconnectTransport({ quiet: true });
    installLog("Disconnected coding transport");
  }
}

function ensureFlasher() {
  if (flasher) return flasher;
  flasher = new P1WebFlasher();
  flasher.addEventListener("state", (event) => installStatus(formatInstallState(event.detail)));
  flasher.addEventListener("log", (event) => installLog(event.detail.message || ""));
  flasher.addEventListener("progress", (event) => {
    const { fileIndex, written, total } = event.detail;
    const pct = total > 0 ? Math.round((written / total) * 100) : 0;
    els.installProgress.value = pct;
    installStatus(`Uploading ${pct}%`);
  });
  return flasher;
}

function installStatus(text) {
  els.installStatus.textContent = text || "";
  if (text === "Upload complete" || text === "Flash erased") els.installProgress.value = 100;
  if (text === "Connecting" || text === "Preparing firmware" || text === "Uploading" || text === "Erasing flash") els.installProgress.removeAttribute("value");
}

function formatInstallState(detail = {}) {
  const chip = detail.chipName ? ` / ${detail.chipName}` : "";
  const labels = {
    connecting: "Connecting",
    connected: `Connected${chip}`,
    loading: "Preparing firmware",
    flashing: "Uploading",
    resetting: "Restarting board",
    done: "Upload complete",
    erasing: "Erasing flash",
    erased: "Flash erased",
    disconnected: "Disconnected",
  };
  return labels[detail.state] || detail.state || "";
}

function readInstallSetup() {
  const deviceName = els.installDeviceName.value.trim();
  const wifiSsid = els.installWifiSsid.value.trim();
  const wifiPassword = els.installWifiPassword.value;
  const data = {};
  if (deviceName) data.deviceName = deviceName;
  if (wifiSsid) data.wifiSsid = wifiSsid;
  if (wifiPassword) data.wifiPassword = wifiPassword;
  return data;
}

async function applyInstallSetupAfterUpload(hint) {
  if (hint) localStorage.setItem(storage.usbHint, JSON.stringify(hint));
  const setup = readInstallSetup();
  const connected = await connectUsbAfterInstall();
  if (!connected) {
    installStatus("Uploaded. Open Code when the board is ready.");
    els.installGoCode.classList.remove("is-hidden");
    return;
  }

  if (Object.keys(setup).length) {
    try {
      installStatus("Applying setup");
      const config = await sendCommand("config.set", setup, { quiet: true, timeoutMs: 12000 });
      updateConfig(config);
      if (setup.deviceName) {
        lastInfo = { ...(lastInfo || {}), deviceName: setup.deviceName };
        lastStatus = { ...(lastStatus || {}), deviceName: setup.deviceName };
      }
      els.installWifiPassword.value = "";
      await refreshStatus({ quiet: true, timeoutMs: 8000 });
    } catch (error) {
      installLog(`Setup warning: ${error.message || error}`);
      installStatus("Ready. Setup was not applied.");
      els.installGoCode.classList.remove("is-hidden");
      return;
    }
  }

  installStatus("Ready");
  els.installGoCode.classList.remove("is-hidden");
}

async function connectUsbAfterInstall() {
  if (!("serial" in navigator) || !readUsbHint()) return false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    installStatus(attempt ? `Checking P1E (${attempt + 1}/4)` : "Checking P1E");
    await settle(attempt ? 1600 : 800);
    const ok = await connectTransport(
      new WebSerialTransport({ storageKey: storage.usbHint }),
      { pickPort: false },
      "usb",
      "USB",
      { quiet: true, lightStartup: true, includeScript: false, startupTimeoutMs: 2500 },
    );
    await refreshKnownUsbPorts();
    if (ok && client) return true;
  }
  installLog("P1E did not answer the automatic post-upload probe.");
  return false;
}

function installLog(message) {
  const text = String(message || "").trimEnd();
  if (!text) return;
  els.installLog.textContent += `${text}\n`;
  els.installLog.scrollTop = els.installLog.scrollHeight;
}

function updateInstallEnabledState() {
  const available = "serial" in navigator;
  [
    els.installConnect,
    els.installFlashManifest,
    els.installGoCode,
    els.installManifest,
  ].forEach((el) => {
    if (el) el.disabled = flasherBusy || !available;
  });
}

function hasChatApiKey() {
  return Boolean(localStorage.getItem(storage.chatApiKey));
}

function chatDebugPromptEnabled() {
  return localStorage.getItem(storage.chatDebugPrompt) === "1";
}

function toggleChatDebugPrompt() {
  localStorage.setItem(storage.chatDebugPrompt, chatDebugPromptEnabled() ? "0" : "1");
  updateChatDebugPromptButton();
}

function updateChatDebugPromptButton() {
  const enabled = chatDebugPromptEnabled();
  els.chatDebugPrompt.classList.toggle("is-active", enabled);
  els.chatDebugPrompt.title = enabled ? "Download prompt debug: on" : "Download prompt debug: off";
  els.chatDebugPrompt.setAttribute("aria-label", els.chatDebugPrompt.title);
}

function updateChatKeyButton() {
  const hasKey = hasChatApiKey();
  els.chatApiKey.title = hasKey ? "Clear API key" : "Set API key";
  els.chatApiKey.setAttribute("aria-label", els.chatApiKey.title);
  els.chatApiKey.querySelector(".material-symbols-rounded").textContent = hasKey ? "key_off" : "key";
}

function updateChatEnabledState() {
  const hasKey = hasChatApiKey();
  els.chatForm.classList.toggle("is-hidden", !hasKey);
  els.chatInput.disabled = !hasKey || chatBusy;
  els.chatSend.disabled = !hasKey || chatBusy || !els.chatInput.value.trim();
  els.chatModel.disabled = chatBusy;
  els.chatApiKey.disabled = chatBusy;
  els.chatDebugPrompt.disabled = chatBusy;
  els.chatClear.disabled = chatBusy || chatMessages.length === 0;
}

function toggleChatApiKey() {
  if (hasChatApiKey()) {
    localStorage.removeItem(storage.chatApiKey);
    updateChatKeyButton();
    updateChatEnabledState();
    renderChatTranscript();
    logLine("info", "OpenAI API key cleared");
    return;
  }

  els.chatApiKeyInput.value = "";
  els.chatApiKeyDialog.showModal();
  els.chatApiKeyInput.focus();
}

function saveChatApiKey() {
  const apiKey = els.chatApiKeyInput.value.trim();
  if (!apiKey) return;
  localStorage.setItem(storage.chatApiKey, apiKey);
  els.chatApiKeyInput.value = "";
  if (els.chatApiKeyDialog.open) els.chatApiKeyDialog.close();
  updateChatKeyButton();
  updateChatEnabledState();
  renderChatTranscript();
  logLine("info", "OpenAI API key stored in this browser");
}

function renderChatTranscript() {
  els.chatTranscript.replaceChildren();

  if (!hasChatApiKey()) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "Set an API key to start.";
    els.chatTranscript.append(empty);
    return;
  }

  if (chatMessages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "Ready.";
    els.chatTranscript.append(empty);
    return;
  }

  chatMessages.forEach((message, index) => {
    els.chatTranscript.append(renderChatMessage(message, index));
  });
  els.chatTranscript.scrollTop = els.chatTranscript.scrollHeight;
}

function renderChatMessage(message, index) {
  const article = document.createElement("article");
  article.className = `chat-message chat-${message.role}`;

  if (message.content) {
    const body = document.createElement("p");
    body.textContent = message.content;
    article.append(body);
  }

  const structured = message.structured || null;
  if (structured?.notes?.length) article.append(renderChatList("notes", structured.notes));
  if (structured?.warnings?.length) article.append(renderChatList("warnings", structured.warnings));

  if (structured?.code) {
    const codeHeader = document.createElement("div");
    codeHeader.className = "chat-code-header";
    const toggle = document.createElement("button");
    toggle.className = "button compact icon-buttonish";
    toggle.type = "button";
    toggle.title = "Show code";
    toggle.setAttribute("aria-label", "Show code");
    toggle.innerHTML = '<span class="material-symbols-rounded">code</span>';
    const run = document.createElement("button");
    run.className = "button compact icon-buttonish";
    run.type = "button";
    run.title = "Save and run on board";
    run.setAttribute("aria-label", "Save and run on board");
    run.innerHTML = '<span class="material-symbols-rounded">play_arrow</span>';
    run.addEventListener("click", () => runChatCode(index));
    codeHeader.append(toggle, run);

    const pre = document.createElement("pre");
    pre.className = "chat-code is-hidden";
    pre.textContent = structured.code;
    toggle.addEventListener("click", () => {
      const hidden = pre.classList.toggle("is-hidden");
      toggle.title = hidden ? "Show code" : "Hide code";
      toggle.setAttribute("aria-label", toggle.title);
      toggle.querySelector(".material-symbols-rounded").textContent = hidden ? "code" : "code_off";
    });
    article.append(codeHeader, pre);
  }

  return article;
}

function renderChatList(label, values) {
  const wrap = document.createElement("div");
  wrap.className = "chat-list";
  const strong = document.createElement("strong");
  strong.textContent = label;
  const ul = document.createElement("ul");
  values.slice(0, 8).forEach((value) => {
    const li = document.createElement("li");
    li.textContent = String(value);
    ul.append(li);
  });
  wrap.append(strong, ul);
  return wrap;
}

async function applyChatCode(index) {
  const message = chatMessages[index];
  const code = message?.structured?.code;
  if (!code) return;
  await replaceEditorFromChat(code, "chat code applied to editor", message.structured?.sketch_name || "", message.structured?.circuit_layout || null);
}

async function runChatCode(index) {
  const message = chatMessages[index];
  const code = message?.structured?.code;
  if (!code) return;
  await runUiAction(async () => {
    const name = message.structured?.sketch_name || "";
    await replaceEditorFromChat(code, "chat code prepared", name, message.structured?.circuit_layout || null);
    await uploadScriptCode(code, { run: true, save: true, name });
    logLine("info", "chat code saved and running");
  }, "uploading");
}

async function replaceEditorFromChat(code, message, name = "", layout = null) {
  circuitChatLayout = normalizeCircuitLayout(layout);
  await replaceEditorCode(code, { saveCurrent: true, markUnsaved: true });
  updateCircuitView(circuitChatLayout ? "chat layout + code inference" : "inferred from code");
  await rememberUploadedSketch(code, name, { preferAutoName: !normalizeSketchName(name) });
  logLine("info", message);
}

async function sendChatPrompt() {
  const prompt = els.chatInput.value.trim();
  if (!prompt || chatBusy || !hasChatApiKey()) return;

  chatBusy = true;
  updateChatEnabledState();
  chatMessages.push({ role: "user", content: prompt, at: new Date().toISOString() });
  els.chatInput.value = "";
  renderChatTranscript();
  saveChatHistory();

  try {
    const result = await requestChatCompletion(prompt);
    const content = result.reply || "Done.";
    if (result.code_action === "replace" && result.code.trim()) {
      await replaceEditorFromChat(result.code, "chat code replaced editor", result.sketch_name, result.circuit_layout);
    } else if (result.circuit_layout) {
      circuitChatLayout = result.circuit_layout;
      updateCircuitView("chat layout + code inference");
    }
    chatMessages.push({
      role: "assistant",
      content,
      structured: result,
      at: new Date().toISOString(),
    });
    saveChatHistory();
  } catch (error) {
    chatMessages.push({ role: "error", content: error.message || String(error), at: new Date().toISOString() });
    saveChatHistory();
  } finally {
    chatBusy = false;
    renderChatTranscript();
    updateChatEnabledState();
  }
}

async function requestChatCompletion(prompt) {
  const apiKey = localStorage.getItem(storage.chatApiKey) || "";
  const model = els.chatModel.value || defaultChatModel;
  const context = await getWrenchChatContext();
  const conversation = chatMessages.slice(-chatHistoryLimit).map((message) => ({
    role: message.role,
    content: message.content,
    code: message.structured?.code ? "[code omitted from transcript; current code is provided separately]" : undefined,
  }));
  const payloadContext = {
    currentCode: getEditorValue(),
    recentLog: consoleLines.slice(-100).map((line) => formatConsoleLine(line)),
    lastError: lastStatus?.lastError || null,
    deviceInfo: lastInfo || {},
    deviceStatus: lastStatus || {},
    conversation,
  };
  const instructions = buildChatInstructions(context);
  const userInputText = [
    `User request:\n${prompt}`,
    `P1E context JSON:\n${JSON.stringify(payloadContext)}`,
  ].join("\n\n");

  const body = {
    model,
    instructions,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: userInputText,
          },
        ],
      },
    ],
    max_output_tokens: CHAT_MAX_OUTPUT_TOKENS,
    text: {
      format: {
        type: "json_schema",
        name: "p1e_wrench_assistant_response",
        strict: false,
        schema: chatResponseSchema(),
      },
    },
  };

  if (chatDebugPromptEnabled()) {
    downloadChatPromptDebug({ model, prompt, instructions, userInputText, payloadContext, body });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `OpenAI request failed (${response.status})`);
  }

  const text = extractResponseText(data);
  return parseChatStructuredText(text);
}

async function getWrenchChatContext() {
  if (wrenchChatContext) return wrenchChatContext;
  try {
    const response = await fetch("wrench_chat_context.md", { cache: "no-cache" });
    wrenchChatContext = await response.text();
  } catch {
    wrenchChatContext = "P1E Wrench context unavailable.";
  }
  return wrenchChatContext;
}

function buildChatInstructions(context) {
  return [
    "You are the P1E Wrench coding assistant inside a browser tool for an ESP32 classic firmware.",
    "Return only JSON matching the requested schema.",
    "When producing code, provide a complete Wrench script that can replace the editor contents.",
    "Every generated sketch must start with a short // comment explaining what the sketch does.",
    "When producing code, also provide sketch_name: a short 2-5 word title suitable for a history dropdown.",
    "Also provide circuit_layout: a best-effort JSON layout for the Circuit view with components, connections, assumptions, and notes. Use an empty object if no hardware is involved.",
    "When the user asks for a live interface, dashboard, or controls, use the documented firmware-driven UI bindings in a Guino-style lifecycle: declare the interface in a drawUi() function from setup() and on hello, read slider/toggle state with uiGet(), use while (uiPoll()) for buttons and hello redraw events, update ordinary values with uiUpdate(), and stream every graph/sample with uiPush(). Do not call uiBegin() after every control change.",
    "Prefer setup() and loop(). Keep loop non-blocking where reasonable. Use short delay() only when it is intentional.",
    "Avoid factory reset or destructive device actions. Do not invent firmware bindings beyond the documented P1E bindings.",
    "If the user's request is ambiguous, explain the assumption in reply and notes.",
    "Use warnings only for immediate, concrete risks such as unsafe pins, high current, blocking code, destructive commands, missing credentials, or likely firmware/resource failure.",
    "Do not include generic warnings such as code will be replaced, test before use, or backup your work. Put ordinary caveats in notes, or leave arrays empty.",
    "",
    context,
  ].join("\n");
}

function chatResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      reply: { type: "string" },
      code: { type: "string" },
      code_action: { type: "string", enum: ["replace", "none"] },
      sketch_name: { type: "string" },
      notes: { type: "array", items: { type: "string" } },
      warnings: { type: "array", items: { type: "string" } },
      circuit_layout: {
        type: "object",
        additionalProperties: true,
        properties: {
          version: { type: "string" },
          board: { type: "object", additionalProperties: true },
          components: { type: "array", items: { type: "object", additionalProperties: true } },
          connections: { type: "array", items: { type: "object", additionalProperties: true } },
          assumptions: { type: "array", items: { type: "string" } },
          notes: { type: "array", items: { type: "string" } },
        },
      },
    },
    required: ["reply", "code", "code_action", "sketch_name", "notes", "warnings", "circuit_layout"],
  };
}

function downloadChatPromptDebug({ model, prompt, instructions, userInputText, payloadContext, body }) {
  const code = payloadContext.currentCode || "";
  const log = Array.isArray(payloadContext.recentLog) ? payloadContext.recentLog.join("\n") : "";
  const conversation = Array.isArray(payloadContext.conversation)
    ? payloadContext.conversation.map((item, index) => {
      const content = String(item.content || "").trim();
      return `${index + 1}. ${item.role}: ${content}`;
    }).join("\n")
    : "";
  const lastError = payloadContext.lastError ? JSON.stringify(payloadContext.lastError, null, 2) : "none";
  const md = [
    "# P1E Chat Prompt Debug",
    "",
    `Time: ${new Date().toISOString()}`,
    `Model: ${model}`,
    "",
    "## User Request",
    "",
    "```text",
    prompt,
    "```",
    "",
    "## Instructions",
    "",
    "```text",
    instructions,
    "```",
    "",
    "## User Input Sent To Model",
    "",
    "```text",
    userInputText,
    "```",
    "",
    "## Current Code",
    "",
    "```wrench",
    code,
    "```",
    "",
    "## Recent Chat History",
    "",
    conversation || "none",
    "",
    "## Last Device Error",
    "",
    "```json",
    lastError,
    "```",
    "",
    "## Recent Log",
    "",
    "```text",
    log || "none",
    "```",
    "",
    "## Full Request Body",
    "",
    "```json",
    JSON.stringify(body, null, 2),
    "```",
  ].join("\n");

  downloadTextFile(md, `p1e-chat-prompt-${timestampForFilename()}.md`, "text/markdown;charset=utf-8");
}

function downloadTextFile(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function timestampForFilename() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function extractResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function parseChatStructuredText(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Empty OpenAI response");
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return { reply: raw, code: "", code_action: "none", sketch_name: "", notes: [], warnings: ["Response was not structured JSON."], circuit_layout: null };
  }

  return {
    reply: String(parsed.reply || ""),
    code: String(parsed.code || ""),
    code_action: parsed.code_action === "replace" ? "replace" : "none",
    sketch_name: normalizeSketchName(parsed.sketch_name || parsed.name || parsed.title || ""),
    notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
    warnings: filterChatWarnings(parsed.warnings),
    circuit_layout: hasCircuitLayoutContent(parsed.circuit_layout) ? normalizeCircuitLayout(parsed.circuit_layout) : null,
  };
}

function hasCircuitLayoutContent(layout) {
  if (!layout || typeof layout !== "object") return false;
  return Boolean(
    (Array.isArray(layout.components) && layout.components.length)
    || (Array.isArray(layout.connections) && layout.connections.length)
    || (Array.isArray(layout.assumptions) && layout.assumptions.length)
    || (Array.isArray(layout.notes) && layout.notes.length)
  );
}

function filterChatWarnings(warnings) {
  if (!Array.isArray(warnings)) return [];
  const generic = [
    "code will be replaced",
    "replace the editor",
    "backup",
    "back up",
    "test before",
    "review before",
    "use caution",
  ];
  return warnings
    .map((warning) => String(warning).trim())
    .filter(Boolean)
    .filter((warning) => !generic.some((needle) => warning.toLowerCase().includes(needle)));
}

function updateEnabledState() {
  const connected = isDeviceConnected();
  const canDisconnectOrCancel = Boolean(client || transport || isBusy);
  syncGuinoConnectionState();
  [els.connect, els.chatConnect, els.uiConnect].forEach((button) => {
    if (!button) return;
    const connecting = isBusy && !connected;
    button.disabled = isBusy && !canDisconnectOrCancel;
    button.classList.toggle("primary", !connected && !isBusy);
    button.classList.remove("danger");
    button.classList.toggle("is-connecting", connecting);
    button.title = connected || transport ? "Disconnect" : (connecting ? "Cancel connection" : "Connect");
    button.setAttribute("aria-label", button.title);
    button.querySelector(".material-symbols-rounded").textContent = connecting ? "sync" : (connected || transport ? "link_off" : "link");
  });
  els.downloadCode.disabled = !getEditorValue().trim();
  [
    els.getScript,
    els.reboot,
    els.run,
    els.stop,
    els.settings,
    els.deviceNameSave,
    els.wifiSave,
    els.raw,
    els.rawSend,
  ].forEach((el) => {
    el.disabled = !connected || isBusy;
  });
  els.newSketch.disabled = isBusy;
  renderWifiNetworkList();
  updateChatEnabledState();
  renderConnectionHistory();
  renderConnectionState();
  updateInstallEnabledState();
}

function logLine(level, message) {
  if (!consoleLevelVisible(level)) return;
  const stamp = new Date().toLocaleTimeString();
  consoleLines.push({ level, stamp, message: String(message) });
  if (consoleLines.length > 500) consoleLines = consoleLines.slice(-500);
  renderConsole();
}

function consoleLevelVisible(level) {
  const values = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };
  const current = values[els.debugLevel?.value || "info"] ?? 2;
  const value = values[level] ?? 2;
  return value <= current;
}

function logJson(level, data) {
  if (level === "trace" && els.debugLevel.value !== "trace") return;
  logLine(level, JSON.stringify(data));
}

function renderConsole() {
  els.console.replaceChildren(
    ...consoleLines.map((line) => {
      const row = document.createElement("span");
      const icon = document.createElement("span");
      const time = document.createElement("span");
      const text = document.createElement("span");
      const visual = consoleVisualLine(line);

      row.className = `console-line line-${line.level}`;
      row.title = formatConsoleLine(line);
      icon.className = "material-symbols-rounded console-icon";
      icon.textContent = visual.icon;
      time.className = "console-time";
      time.textContent = consoleTimestampsEnabled() ? line.stamp || "" : "";
      text.className = "console-text";
      text.textContent = `${visual.text}\n`;
      row.append(icon, time, text);
      return row;
    }),
  );
  els.console.scrollTop = els.console.scrollHeight;
}

function consoleVisualLine(line) {
  const level = String(line.level || "info");
  const message = String(line.message || "");
  const icon = consoleIconForLine(level, message);
  return { icon, text: simplifyConsoleMessage(level, message) };
}

function consoleIconForLine(level, message) {
  if (level === "error") return "error";
  if (level === "warn") return "warning";
  if (level === "debug" || level === "trace") return "bug_report";
  if (message.startsWith("script.print:")) return "notes";
  if (message.startsWith("script.state:")) return "radio_button_checked";
  if (message.startsWith("wifi.status:")) return "wifi";
  if (message.startsWith("websocket.")) return "lan";
  if (message.startsWith("webrtc.")) return "hub";
  return "info";
}

function simplifyConsoleMessage(level, message) {
  const raw = String(message || "");
  const body = raw.replace(/^[^:]+:\s*/, "");

  if (raw.startsWith("script.state:")) return titleCaseFirst(body.split(" / ")[0] || body);
  if (raw.startsWith("script.print:")) return body;
  if (raw.startsWith("script.error:")) return `Script error: ${body}`;
  if (raw.startsWith("wifi.status:")) return `WiFi ${body}`;
  if (raw.startsWith("websocket.status:")) return `WebSocket ${body}`;
  if (raw.startsWith("websocket.client:")) return `WebSocket ${body}`;
  if (raw.startsWith("webrtc.")) return `WebRTC ${body}`;
  if (raw.startsWith("device.boot:")) return "Device boot";
  if (level === "error") return raw.startsWith("Error ") ? raw : `Error ${raw}`;
  if (level === "warn") return raw.startsWith("Warning ") ? raw : `Warning ${raw}`;
  return raw;
}

function titleCaseFirst(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `${text[0].toUpperCase()}${text.slice(1)}`;
}

function formatConsoleLine(line) {
  if (line.text) return consoleTimestampsEnabled() ? line.text : line.text.replace(/^\[[^\]]+\]\s+/, "");
  const prefix = consoleTimestampsEnabled() ? `[${line.stamp}] ` : "";
  return `${prefix}${String(line.level || "info").toUpperCase()} ${line.message || ""}`;
}

function consoleTimestampsEnabled() {
  return localStorage.getItem(storage.consoleTimestamps) !== "0";
}

function toggleConsoleTimestamps() {
  localStorage.setItem(storage.consoleTimestamps, consoleTimestampsEnabled() ? "0" : "1");
  updateConsoleTimestampButton();
  renderConsole();
}

function updateConsoleTimestampButton() {
  const enabled = consoleTimestampsEnabled();
  els.consoleTimestamps.classList.toggle("is-active", enabled);
  els.consoleTimestamps.title = enabled ? "Timestamps: on" : "Timestamps: off";
  els.consoleTimestamps.setAttribute("aria-label", els.consoleTimestamps.title);
}

function clearConsole() {
  consoleLines = [];
  renderConsole();
}

async function copyConsole() {
  const text = consoleLines.map((line) => formatConsoleLine(line)).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    logLine("info", "console copied");
  } catch (error) {
    logLine("error", error.message || "copy failed");
  }
}
