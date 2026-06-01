import { ProtocolClient } from "./protocol/ProtocolClient.js?v=0.1.87-ui280";
import { canEncodeCommand } from "./protocol/P1MsgPack.js?v=0.1.87-ui280";
import { WebSerialTransport } from "./protocol/WebSerialTransport.js?v=0.1.87-ui280";
import { WebSocketTransport } from "./protocol/WebSocketTransport.js";
import { MqttWebRtcTransport, MQTT_WEBRTC_TRANSPORT_VERSION } from "./protocol/MqttWebRtcTransport.js?v=0.1.87-ui280";
import { MqttTransport, MQTT_TRANSPORT_VERSION, clearOnlineAuthKey, deriveOnlineAuthKeyHex, storeOnlineAuthKey } from "./protocol/MqttTransport.js?v=0.1.87-ui280";
import { P1WebFlasher } from "./web-flasher.js?v=0.1.87-ui280";
import { inferCircuitLayout, initCircuitView, normalizeCircuitLayout } from "./circuit.js?v=0.1.87-ui280";
import { initGuinoView } from "./guino.js?v=0.1.87-ui280";

const WEB_UI_VERSION = "0.1.87-ui280";
const CHAT_DEFAULT_MAX_OUTPUT_TOKENS = 8000;
const CHAT_MIN_MAX_OUTPUT_TOKENS = 1024;
const CHAT_HARD_MAX_OUTPUT_TOKENS = 32000;
const ALPHA_ENABLE_WEBSOCKET_CONNECT = false;
const ALPHA_ENABLE_WEBRTC_CONNECT = false;
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
  projectId: "p1_embed.project.activeId",
  projectMigration: "p1_embed.project.migrated",
  projectFallback: "p1_embed.project.fallback",
  chatApiKey: "p1_embed.chat.apiKey",
  chatModel: "p1_embed.chat.model",
  chatModelList: "p1_embed.chat.modelList",
  chatMaxOutputTokens: "p1_embed.chat.maxOutputTokens",
  chatHistory: "p1_embed.chat.history",
  chatDebugPrompt: "p1_embed.chat.debugPrompt",
  specificationDraft: "p1_embed.project.specificationDraft",
  revisionDraft: "p1_embed.project.revisionDraft",
  specificationMode: "p1_embed.project.specificationMode",
};

const builtInChatModelOptions = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
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
const projectLimit = 80;
const connectionHistoryLimit = 12;
const sketchDbName = "p1_embed";
const sketchDbVersion = 2;
const sketchStoreName = "sketch_history";
const projectStoreName = "projects";

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
  newRevision: document.querySelector("#new-revision-button"),
  chatNewSketch: document.querySelector("#chat-new-sketch-button"),
  chatNewRevision: document.querySelector("#chat-new-revision-button"),
  chatRun: document.querySelector("#chat-run-button"),
  chatStop: document.querySelector("#chat-stop-button"),
  reboot: document.querySelector("#reboot-button"),
  run: document.querySelector("#run-button"),
  stop: document.querySelector("#stop-button"),
  uploadStatus: document.querySelector("#upload-status"),
  uploadStatusLabel: document.querySelector("#upload-status-label"),
  uploadStatusProgress: document.querySelector("#upload-status-progress"),
  downloadCode: document.querySelector("#download-code-button"),
  chatDownloadCode: document.querySelector("#chat-download-code-button"),
  projectSelect: document.querySelector("#project-select"),
  sketchHistory: document.querySelector("#sketch-history"),
  settings: document.querySelector("#settings-button"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsTabs: document.querySelectorAll("[data-settings-tab]"),
  settingsPanels: document.querySelectorAll("[data-settings-panel]"),
  deviceNameInput: document.querySelector("#device-name-input"),
  timezoneInput: document.querySelector("#timezone-input"),
  deviceNameSave: document.querySelector("#device-name-save-button"),
  wifiSave: document.querySelector("#wifi-save-button"),
  wifiNetworkList: document.querySelector("#wifi-network-list"),
  mqttHost: document.querySelector("#mqtt-host"),
  mqttPort: document.querySelector("#mqtt-port"),
  mqttRoot: document.querySelector("#mqtt-root"),
  mqttUser: document.querySelector("#mqtt-user"),
  mqttPassword: document.querySelector("#mqtt-password"),
  mqttEnabled: document.querySelector("#mqtt-enabled"),
  accessGuestUi: document.querySelector("#access-guest-ui"),
  accessGuestScript: document.querySelector("#access-guest-script"),
  accessSave: document.querySelector("#access-save-button"),
  onlineAuthList: document.querySelector("#online-auth-list"),
  onlineAuthUsername: document.querySelector("#online-auth-username"),
  onlineAuthPassword: document.querySelector("#online-auth-password"),
  onlineAuthAdd: document.querySelector("#online-auth-add-button"),
  mqttSigninDialog: document.querySelector("#mqtt-signin-dialog"),
  mqttSigninTitle: document.querySelector("#mqtt-signin-title"),
  mqttSigninUsername: document.querySelector("#mqtt-signin-username"),
  mqttSigninPassword: document.querySelector("#mqtt-signin-password"),
  mqttSigninButton: document.querySelector("#mqtt-signin-button"),
  mqttSigninCancel: document.querySelector("#mqtt-signin-cancel-button"),
  revisionNameDialog: document.querySelector("#revision-name-dialog"),
  revisionNameInput: document.querySelector("#revision-name-input"),
  revisionNameCreate: document.querySelector("#revision-name-create-button"),
  revisionNameCancel: document.querySelector("#revision-name-cancel-button"),
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
  chatApiKeyInput: document.querySelector("#chat-api-key-input"),
  chatApiKeySave: document.querySelector("#chat-api-key-save-button"),
  chatKeySharePassword: document.querySelector("#chat-key-share-password"),
  chatKeyShareDays: document.querySelector("#chat-key-share-days"),
  chatKeyShare: document.querySelector("#chat-key-share-button"),
  chatKeyShareOutput: document.querySelector("#chat-key-share-output"),
  chatModel: document.querySelector("#chat-model"),
  chatModelsRefresh: document.querySelector("#chat-models-refresh-button"),
  chatMaxOutputTokens: document.querySelector("#chat-max-output-tokens"),
  chatDebugPrompt: document.querySelector("#chat-debug-prompt-button"),
  chatClear: document.querySelector("#chat-clear-button"),
  chatTranscript: document.querySelector("#chat-transcript"),
  chatForm: document.querySelector("#chat-form"),
  chatInput: document.querySelector("#chat-input"),
  chatSend: document.querySelector("#chat-send-button"),
  generativeProjectSelect: document.querySelector("#generative-project-select"),
  generativeRevisionSelect: document.querySelector("#generative-revision-select"),
  generativeTabs: document.querySelectorAll("[data-generative-tab]"),
  generativePanels: document.querySelectorAll("[data-generative-panel]"),
  specification: document.querySelector("#project-specification"),
  specificationEditor: document.querySelector("#project-specification-editor"),
  specificationTools: document.querySelectorAll("[data-spec-format]"),
  specificationMode: document.querySelector("#spec-mode"),
  specificationGenerate: document.querySelector("#spec-generate-button"),
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
  installClearData: document.querySelector("#install-clear-data"),
  installGoCode: document.querySelector("#install-go-code-button"),
  installManifest: document.querySelector("#install-manifest-input"),
  installFirmwareVersion: document.querySelector("#install-firmware-version"),
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
let localUploadActiveUntil = 0;
let currentProjectId = "";
let currentRevisionId = "";
let projectCache = [];
let currentSketchName = "";
let currentSketchSource = "";
let currentSketchVersionName = "";
let currentSketchDirty = false;
let currentSketchSaved = true;
let currentProjectDescription = "";
let currentProjectDescriptionSource = "";
let currentProjectSpecificationMode = "middle";
let currentProjectSpecificationModeSource = "middle";
let currentProjectCircuit = null;
let circuitView = null;
let circuitChatLayout = null;
let circuitUpdateTimer = null;
let revisionDraftSaveTimer = null;
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
  refreshInstallManifestInfo();
  setConnected(false);
  renderFields();
  applyGuestUiShell();
  restoreActiveTab();
  autoConnectFromUrlParams().then((handled) => {
    if (!handled) autoReconnectLastConnection();
  });
}

function bindLifecycle() {
  const markUnload = () => {
    writeCurrentRevisionDraft();
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
  scheduleCurrentRevisionDraftSave();
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
  identityProject = null,
  identityRevision = null,
  markUnsaved = false,
} = {}) {
  const nextCode = String(value ?? "");
  if (saveCurrent) await shelveEditorSketchIfNeeded({ incomingCode: nextCode });
  setEditorValueRaw(nextCode, { persist });
  if (identityName || identityProject || identityRevision) {
    const project = identityProject ? normalizeProjectRecord(identityProject) : null;
    const revision = identityRevision || activeRevision(project);
    setCurrentSketchIdentity(identityName || revision?.name || "", nextCode, project, revision);
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
  els.newRevision.addEventListener("click", () => runUiAction(createCleanRevision, "new revision"));
  els.chatNewSketch.addEventListener("click", () => runUiAction(createNewSketch, "new sketch"));
  els.chatNewRevision.addEventListener("click", () => runUiAction(createCleanRevision, "new revision"));
  els.reboot.addEventListener("click", () => runUiAction(() => sendCommand("device.reboot"), "rebooting"));
  els.run.addEventListener("click", runScriptFromToolbar);
  els.stop.addEventListener("click", () => runUiAction(() => sendCommand("script.stop").then(refreshStatus), "stopping"));
  els.chatRun.addEventListener("click", runScriptFromToolbar);
  els.chatStop.addEventListener("click", () => runUiAction(() => sendCommand("script.stop").then(refreshStatus), "stopping"));
  els.downloadCode.addEventListener("click", () => runUiAction(downloadProject, "download"));
  els.chatDownloadCode.addEventListener("click", () => runUiAction(downloadProject, "download"));
  els.projectSelect.addEventListener("change", () => selectProject(els.projectSelect.value));
  els.sketchHistory.addEventListener("change", () => selectRevision(els.sketchHistory.value));
  els.generativeProjectSelect.addEventListener("change", () => selectProject(els.generativeProjectSelect.value));
  els.generativeRevisionSelect.addEventListener("change", () => selectRevision(els.generativeRevisionSelect.value));
  bindSketchDrop();
  els.settings.addEventListener("click", openSettingsDialog);
  els.settingsTabs.forEach((tab) => tab.addEventListener("click", () => switchSettingsTab(tab.dataset.settingsTab)));
  els.deviceNameSave.addEventListener("click", () => runUiAction(saveDeviceName, "rename"));
  els.wifiSave.addEventListener("click", () => runUiAction(saveWifi, "wifi"));
  els.mqttSave.addEventListener("click", () => runUiAction(saveMqtt, "mqtt"));
  els.accessSave.addEventListener("click", () => runUiAction(saveMqtt, "access"));
  els.onlineAuthAdd.addEventListener("click", () => runUiAction(addOnlineAuthUser, "online user"));
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
  els.chatKeyShare.addEventListener("click", () => runUiAction(createEncryptedChatKeyShare, "sharing"));
  els.chatModel.addEventListener("change", () => {
    localStorage.setItem(storage.chatModel, els.chatModel.value);
  });
  els.chatModelsRefresh.addEventListener("click", () => runUiAction(refreshChatModels, "refreshing"));
  els.chatMaxOutputTokens.addEventListener("change", () => {
    const value = chatMaxOutputTokens();
    els.chatMaxOutputTokens.value = String(value);
    localStorage.setItem(storage.chatMaxOutputTokens, String(value));
  });
  els.chatDebugPrompt.addEventListener("click", toggleChatDebugPrompt);
  els.chatClear.addEventListener("click", clearChat);
  els.generativeTabs.forEach((tab) => tab.addEventListener("click", () => toggleGenerativePanel(tab.dataset.generativeTab)));
  els.specificationEditor?.addEventListener("input", handleSpecificationInput);
  els.specificationEditor?.addEventListener("paste", handleSpecificationPaste);
  els.specificationTools.forEach((button) => button.addEventListener("click", () => applySpecificationFormat(button.dataset.specFormat)));
  els.specificationMode.addEventListener("change", handleSpecificationModeChange);
  els.specificationGenerate.addEventListener("click", () => runUiAction(generateCodeFromSpecification, "generating"));
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

function toggleGenerativePanel(name) {
  const panel = els.views.chat?.querySelector(`[data-generative-panel="${name}"]`);
  if (!panel) return;
  const active = panel.classList.contains("is-active");
  const activeCount = [...els.generativePanels].filter((item) => item.classList.contains("is-active")).length;
  if (active && activeCount <= 1) return;
  panel.classList.toggle("is-active", !active);
  syncGenerativePanelState();
}

function syncGenerativePanelState() {
  const chatVisible = Boolean(els.views.chat?.querySelector('[data-generative-panel="chat"]')?.classList.contains("is-active"));
  const specVisible = Boolean(els.views.chat?.querySelector('[data-generative-panel="specification"]')?.classList.contains("is-active"));
  els.generativeTabs.forEach((tab) => {
    const visible = tab.dataset.generativeTab === "chat" ? chatVisible : specVisible;
    tab.classList.toggle("is-active", visible);
    tab.setAttribute("aria-pressed", visible ? "true" : "false");
  });
  els.views.chat?.classList.toggle("is-chat-visible", chatVisible);
  els.views.chat?.classList.toggle("is-specification-visible", specVisible);
  els.views.chat?.classList.toggle("is-single-chat", chatVisible && !specVisible);
  els.views.chat?.classList.toggle("is-single-specification", specVisible && !chatVisible);
  els.chatClear?.classList.toggle("is-hidden", !chatVisible);
  if (chatVisible) renderChatTranscript();
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
  if (name === "chat") {
    syncGenerativePanelState();
    renderChatTranscript();
  }
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
    const guestKey = await ensureGuestUiShareKey();
    if (guestKey && isMqttKind(kind)) {
      url.searchParams.set("guest", "ui");
      url.searchParams.set("guestKey", guestKey);
    }
    await navigator.clipboard.writeText(url.toString());
    logLine("info", "UI link copied");
  } catch (error) {
    logLine("warn", `UI link not ready: ${error.message}`);
  }
}

async function ensureGuestUiShareKey() {
  if (!lastConfig?.mqttAllowAnonymousUi) return "";
  const existing = String(lastConfig?.mqttGuestUiKey || "").trim();
  if (existing.length >= 16) return existing;
  if (!client || !isDeviceConnected()) return "";
  const key = generateGuestKey();
  const config = await sendCommand("config.set", { mqttGuestUiKey: key, mqttAllowAnonymousUi: true }, { quiet: true, timeoutMs: 10000 });
  updateConfig(config);
  return String(config?.mqttGuestUiKey || key).trim();
}

function generateGuestKey() {
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    const displayLabel = connectionHistoryDisplayLabel(item);
    const row = document.createElement("div");
    row.className = "connection-history-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "button suggestion-button";
    button.title = connectionHistoryTitle(item, displayLabel);
    button.setAttribute("aria-label", button.title);
    button.disabled = Boolean(client) || isBusy;

    const icon = document.createElement("span");
    icon.className = "material-symbols-rounded";
    icon.textContent = connectionKindIcon(item.kind);
    const label = document.createElement("span");
    label.textContent = item.kind === "usb" ? `USB ${displayLabel}` : displayLabel;
    button.append(icon, label);

    button.addEventListener("click", () => {
      if (item.kind === "usb") {
        connectRecentUsb(item.hint);
      } else if (isMqttKind(item.kind)) {
        connectMqtt(item.peerId, item.mqtt);
      } else if (isWebRtcKind(item.kind)) {
        connectPeerJs(item.peerId);
      } else {
        connectWebSocket(item.url);
      }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "connection-history-remove icon-button";
    remove.title = `Remove ${displayLabel}`;
    remove.setAttribute("aria-label", remove.title);
    remove.disabled = isBusy;
    const removeIcon = document.createElement("span");
    removeIcon.className = "material-symbols-rounded";
    removeIcon.textContent = "close";
    remove.append(removeIcon);
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      forgetConnectionHistoryItem(item);
    });

    row.append(button, remove);
    els.connectionHistory.append(row);
  });
}

function isConnectionKindAvailable(kind) {
  if (kind === "usb") return "serial" in navigator;
  if (isMqttKind(kind)) return "mqtt" in window;
  if (isWebRtcKind(kind)) return ALPHA_ENABLE_WEBRTC_CONNECT && ("RTCPeerConnection" in window) && ("mqtt" in window);
  if (kind === "websocket") return ALPHA_ENABLE_WEBSOCKET_CONNECT && "WebSocket" in window;
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
  if (isMqttKind(kind)) return "cloud";
  if (isWebRtcKind(kind)) return "hub";
  return "lan";
}

function connectionHistoryDisplayLabel(item) {
  if (!item) return "";
  if (item.kind === "usb") return item.label || "USB";
  const activeRemote = normalizePeerId(transport?.remoteId || "");
  const itemRemote = normalizePeerId(item.peerId || "");
  const friendly = currentDeviceDisplayName();
  if (friendly && itemRemote && itemRemote === activeRemote) return friendly;
  return item.label || item.peerId || item.url || "";
}

function connectionHistoryTitle(item, displayLabel) {
  const type = connectionKindLabel(item.kind);
  const detail = item.kind === "websocket" ? item.url : item.kind === "usb" ? item.label : item.peerId;
  return detail && detail !== displayLabel ? `${type}: ${displayLabel} (${detail})` : `${type}: ${displayLabel}`;
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
  logLine("debug", "upload requested");
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

async function connectMqtt(value, mqttConfig = null) {
  const peerId = normalizePeerId(value);
  if (!peerId) {
    logLine("warn", "MQTT device id is required");
    return;
  }
  if (mqttConfig) applyMqttConfig(mqttConfig);
  const historyConfig = mqttConfigFromStorageAndDevice();
  await connectTransport(new MqttTransport({ ...mqttTransportOptions(historyConfig), connectTimeoutMs: 15000 }), { remoteId: peerId, mqttConfig: historyConfig }, "mqtt", peerId, { startupTimeoutMs: 15000 });
  els.peerId.value = peerId;
  renderConnectionHistory();
}

async function connectUsb() {
  await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), {}, "usb", "USB", usbStartupOptions());
  await refreshKnownUsbPorts();
  renderConnectionHistory();
}

async function connectRecentUsb(hint = null) {
  if (hint) localStorage.setItem(storage.usbHint, JSON.stringify(hint));
  await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), { pickPort: false }, "usb", "USB", usbStartupOptions());
  await refreshKnownUsbPorts();
  renderConnectionHistory();
}

function usbStartupOptions(extra = {}) {
  return {
    lightStartup: true,
    startupAttempts: 4,
    startupTimeoutMs: 6000,
    startupRetryDelayMs: 650,
    ...extra,
  };
}

function isGuestUiLink(params = new URLSearchParams(window.location.search)) {
  return String(params.get("guest") || "").toLowerCase() === "ui"
    || String(params.get("mode") || "").toLowerCase() === "guest-ui";
}

function guestKeyFromParams(params = new URLSearchParams(window.location.search)) {
  return String(params.get("guestKey") || params.get("key") || "").trim();
}

function applyGuestUiShell() {
  const params = new URLSearchParams(window.location.search);
  document.body.classList.toggle("is-guest-ui", isGuestUiLink(params));
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
      await connectTransport(new WebSocketTransport(), { url }, "websocket", wsDisplayName(url), { lightStartup: true, includeScript: true, preserveUrl: true });
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
      const historyConfig = mqttConfigFromStorageAndDevice();
      const guestUi = isGuestUiLink(params);
      await connectTransport(
        new MqttTransport({
          ...mqttTransportOptions(historyConfig),
          connectTimeoutMs: 15000,
          authMode: guestUi ? "guest-ui" : "control",
          guestKey: guestUi ? guestKeyFromParams(params) : "",
        }),
        { remoteId: peerId, mqttConfig: historyConfig },
        "mqtt",
        peerId,
        { lightStartup: true, includeScript: !guestUi, startupTimeoutMs: 15000, preserveUrl: true },
      );
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
      await connectTransport(new MqttWebRtcTransport({ connectTimeoutMs: 90000 }), { remoteId: peerId }, "webrtc", peerId, { lightStartup: true, includeScript: true, startupTimeoutMs: 30000, preserveUrl: true });
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
      await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), { pickPort: false }, "usb", "USB", usbStartupOptions({ includeScript: true, preserveUrl: true }));
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
    await connectTransport(new MqttTransport({ ...mqttTransportOptions(), connectTimeoutMs: 15000 }), { remoteId: peerId, mqttConfig: mqttConfigFromStorageAndDevice() }, "mqtt", peerId, { quiet: true, lightStartup: true, includeScript: true, startupTimeoutMs: 15000 });
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
    await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), { pickPort: false }, "usb", "USB", usbStartupOptions({ quiet: true, includeScript: true }));
    await refreshKnownUsbPorts();
  }
}

async function connectTransport(nextTransport, options, kind, label, { quiet = false, lightStartup = false, includeScript = true, startupTimeoutMs = 15000, startupAttempts = 1, startupRetryDelayMs = 450, preserveUrl = false } = {}) {
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
    updateEnabledState();
    rememberActiveConnection(kind, options);
    if (!preserveUrl) clearConnectionUrlParams();
    if (!quiet && kind !== "usb") logLine("info", isBinaryTransportKind(kind) ? `Connected to ${label}` : `${label} connected`);

    if (lightStartup) await settle(450);
    if (generation !== connectionGeneration) return false;
    const verified = await startupRefresh({
      quiet,
      includeScript,
      timeoutMs: startupTimeoutMs,
      attempts: startupAttempts,
      retryDelayMs: startupRetryDelayMs,
      expectedGeneration: generation,
    });
    if (generation === connectionGeneration && verified) {
      connectionVerified = true;
      rememberSuccessfulConnection(kind, label, options);
      if (!quiet && kind === "usb") logLine("info", `${label} connected`);
      setConnected(true);
      startStatusPolling();
      return true;
    } else if (generation === connectionGeneration) {
      if (!quiet) logLine("warn", `${label} connected but did not answer protocol checks`);
      await disconnectTransport({ quiet: true, keepGeneration: true });
      setConnected(false);
      return false;
    }
  } catch (error) {
    if (generation !== connectionGeneration) return false;
    if (!quiet) logLine("error", error.message);
    if (transport === nextTransport) {
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

function rememberActiveConnection(kind, options = {}) {
  localStorage.setItem(storage.lastConnection, kind);

  if (kind === "websocket" && options.url) {
    localStorage.setItem(storage.wsUrl, normalizeWebSocketUrl(options.url));
  }

  if ((isMqttKind(kind) || isWebRtcKind(kind)) && options.remoteId) {
    localStorage.setItem(storage.peerId, normalizePeerId(options.remoteId));
  }

  if (kind === "usb") {
    const hint = readUsbHint();
    if (hint) localStorage.setItem(storage.usbHint, JSON.stringify(hint));
  }
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
  const friendlyLabel = currentDeviceDisplayName() || label;

  if (kind === "websocket" && options.url) {
    const url = normalizeWebSocketUrl(options.url);
    localStorage.setItem(storage.wsUrl, url);
    const label = friendlyLabel || wsDisplayName(url);
    localStorage.setItem(storage.wsName, label);
    rememberWebSocketHistory(url, label);
    els.websocketUrl.value = url;
    renderConnectionHistory();
  }

  if ((isMqttKind(kind) || isWebRtcKind(kind)) && options.remoteId) {
    const peerId = normalizePeerId(options.remoteId);
    localStorage.setItem(storage.peerId, peerId);
    rememberPeerHistory(peerId, friendlyLabel || peerId, isMqttKind(kind) ? "mqtt" : "webrtc", options.mqttConfig);
    els.peerId.value = peerId;
    renderConnectionHistory();
  }

  if (kind === "usb") {
    const hint = readUsbHint();
    if (hint) rememberUsbHistory(hint);
    refreshKnownUsbPorts();
    renderConnectionHistory();
  }
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
      const kind = isMqttKind(entry.kind) ? "mqtt" : "webrtc";
      return {
        kind,
        peerId,
        label: entry.label || peerId,
        mqtt: kind === "mqtt" ? normalizeMqttHistoryConfig(entry.mqtt || entry) : null,
        at: Number(entry.at) || 0,
      };
    })
    .filter(Boolean);
}

function writePeerHistory(entries) {
  writeHistoryArray(storage.peerHistory, entries.map((entry) => {
    const peerId = normalizePeerId(entry.peerId);
    const kind = isMqttKind(entry.kind) ? "mqtt" : "webrtc";
    return {
      kind,
      peerId,
      label: entry.label || peerId,
      mqtt: kind === "mqtt" ? normalizeMqttHistoryConfig(entry.mqtt || entry) : null,
      at: Number(entry.at) || Date.now(),
    };
  }).filter((entry) => entry.peerId));
}

function rememberPeerHistory(peerId, label = "", kind = "webrtc", mqttConfig = null) {
  const normalized = normalizePeerId(peerId);
  if (!normalized) return;
  const normalizedKind = isMqttKind(kind) ? "mqtt" : "webrtc";
  const entry = { kind: normalizedKind, peerId: normalized, label: label || normalized, at: Date.now() };
  if (normalizedKind === "mqtt") entry.mqtt = normalizeMqttHistoryConfig(mqttConfig || mqttConfigFromStorageAndDevice());
  const next = [
    entry,
    ...readPeerHistory().filter((entry) => !(normalizePeerId(entry.peerId) === normalized && entry.kind === normalizedKind)),
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
  url.searchParams.delete("guest");
  url.searchParams.delete("guestKey");
  url.searchParams.delete("key");

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
  url.searchParams.delete("guest");
  url.searchParams.delete("guestKey");
  url.searchParams.delete("key");
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
  } else if (state === "auth_required") {
    logLine("info", `Sign in to ${target}`);
  } else if (state === "session_lost") {
    logLine("debug", `${prefix} session expired; signing in again`);
  } else if (state === "session_restored") {
    logLine("debug", `${prefix} session restored`);
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

async function startupRefresh({ quiet = false, includeScript = true, timeoutMs = 15000, attempts = 1, retryDelayMs = 450, expectedGeneration = null } = {}) {
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const logAttempt = attempt === maxAttempts ? quiet : true;
    const verified = await startupRefreshOnce({ quiet: logAttempt, includeScript, timeoutMs, expectedGeneration });
    if (verified) return true;
    if (expectedGeneration !== null && expectedGeneration !== connectionGeneration) return false;
    if (attempt < maxAttempts) await settle(retryDelayMs);
  }
  return false;
}

async function startupRefreshOnce({ quiet = false, includeScript = true, timeoutMs = 15000, expectedGeneration = null } = {}) {
  const stale = () => expectedGeneration !== null && expectedGeneration !== connectionGeneration;
  if (stale()) return false;
  const infoOk = await bestEffortStartupStep(() => refreshInfo({ quiet, timeoutMs }), quiet);
  if (!client || stale()) return false;
  const statusOk = await bestEffortStartupStep(() => refreshStatus({ quiet, timeoutMs }), quiet);
  if (!client || stale()) return infoOk || statusOk;
  if (!infoOk && !statusOk) return false;
  if (transport?.isGuestUiOpen?.()) return infoOk || statusOk;
  await bestEffortStartupStep(() => syncDeviceEventLevel({ quiet, timeoutMs }), quiet);
  if (!client || stale()) return infoOk || statusOk;
  await bestEffortStartupStep(() => sendCommand("config.get", {}, { quiet, timeoutMs }).then(updateConfig), quiet);
  if (!client || stale()) return infoOk || statusOk;
  if (includeScript) await bestEffortStartupStep(() => getScript({ quiet, timeoutMs }), quiet);
  return infoOk || statusOk;
}

async function syncDeviceEventLevel({ quiet = false, timeoutMs = 15000 } = {}) {
  const data = await sendCommand("debug.get", {}, { quiet, timeoutMs });
  const deviceLevel = data.levelName || data.level || "";
  if (deviceLevel && !localStorage.getItem(storage.logLevel)) {
    els.debugLevel.value = deviceLevel;
  }
  const requestedLevel = els.debugLevel.value || "info";
  await sendCommand("debug.set", { level: requestedLevel }, { quiet, timeoutMs });
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
  const maxBytes = isMqttKind(transport?.kind) ? 3000 : 512;
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
    await activateDeviceProjectForFetchedScript(data);
    await replaceEditorCode(data.code, { persist: false, saveCurrent: true });
    await rememberUploadedSketch(data.code, data.scriptName || "", { source: "download" });
  }
  updateScriptState(data);
}

async function activateDeviceProjectForFetchedScript(data = {}) {
  let config = lastConfig || {};
  const hasDataProject = data.projectId || data.projectName;
  if (!hasDataProject && client) {
    try {
      config = await sendCommand("config.get", {}, { quiet: true, timeoutMs: 6000 });
      updateConfig(config);
    } catch {
    }
  }
  const projectId = String(data.projectId || config.projectId || "").trim();
  const projectName = normalizeProjectName(data.projectName || config.projectName || "");
  if (!projectId && !projectName) return null;

  const projects = await readProjects();
  let project = projectId ? projects.find((item) => item.id === projectId) : null;
  if (!project && projectName) {
    project = projects.find((item) => normalizeProjectName(item.name).toLowerCase() === projectName.toLowerCase());
  }
  if (!project) {
    project = normalizeProjectRecord({
      id: projectId || createProjectId(),
      name: projectName || "Board Project",
      revisions: [],
      activeRevisionId: "",
      chat: [],
    });
  } else if (projectName && project.name !== projectName) {
    project = { ...project, name: projectName };
    await saveProject(project);
  }
  currentProjectId = project.id;
  localStorage.setItem(storage.projectId, project.id);
  return project;
}

async function setScript({ run, save }) {
  await uploadScriptCode(getEditorValue(), { run, save });
}

async function uploadScriptCode(code, { run, save, name = "" }) {
  let data;
  localUploadActiveUntil = Date.now() + 120000;
  guinoView?.clear?.();
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
  const binaryChunkSize = isMqttKind(transport?.kind) ? 3000 : 320;
  const textChunkSize = uploadTextChunkEnvelopeBytes();
  const chunkPauseMs = uploadChunkPauseMs();
  const chunks = isBinaryTransportKind(transport?.kind) && transport?.sendBytes
    ? chunkBytesForWebRtc(codeData, binaryChunkSize)
    : chunkScriptForWebRtc(code, textChunkSize);
  setUploadState("uploading", "Uploading code", 5);
  logLine("debug", `uploading script in ${chunks.length} chunks`);
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
    logLine("debug", "script upload received; queued on device");
    setUploadState("queued", "Upload received", 90);
    updateScriptState({ state: "queued", scriptBytes: response.scriptBytes });
  } else {
    logLine("debug", "script upload complete");
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

async function downloadProject() {
  const project = await projectSnapshotForDownload();
  if (!project?.revisions?.length) return;
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugForFilename(project.name || "p1e-project")}.p1e.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function projectSnapshotForDownload() {
  const project = await getActiveProject();
  const code = getEditorValue();
  if (!project) {
    const revision = buildRevision({ code, name: currentSketchName || "Draft", source: "download" });
    return normalizeProjectRecord({
      id: createProjectId(),
      name: currentSketchName || autoProjectName(code),
      revisions: revision.code.trim() ? [revision] : [],
      activeRevisionId: revision.id,
      chat: [],
    });
  }
  const snapshot = normalizeProjectRecord(project);
  const revision = activeRevision(snapshot);
  if (revision) {
    revision.code = code;
    revision.specification = currentProjectDescription;
    revision.specificationMode = currentProjectSpecificationMode;
    revision.circuit = projectCircuitForCurrentCode(code) || revision.circuit;
    revision.chat = chatMessages.slice(-60);
    revision.bytes = new Blob([code]).size;
  }
  snapshot.chat = [];
  snapshot.updatedAt = new Date().toISOString();
  return snapshot;
}

function buildProject({ name = "", code = "", circuit = undefined, description = undefined, specificationMode = currentProjectSpecificationMode } = {}) {
  const source = String(code ?? "");
  const explicitCircuit = circuit === undefined ? projectCircuitForCurrentCode(source) : normalizeCircuitLayout(circuit);
  const revision = buildRevision({
    code: source,
    name: name || "Draft",
    specification: String(description ?? currentProjectDescription ?? ""),
    specificationMode,
    circuit: explicitCircuit || inferCircuitLayout(source, null),
    source: "import",
  });
  return normalizeProjectRecord({
    id: createProjectId(),
    name: normalizeProjectName(name) || autoProjectName(source),
    revisions: source.trim() ? [revision] : [],
    activeRevisionId: revision.id,
    chat: [],
  });
}

function normalizeProject(project, fallbackName = "") {
  if (!project || typeof project !== "object") return null;
  if (Array.isArray(project.revisions)) {
    return normalizeProjectRecord({ ...project, name: project.name || fallbackName });
  }
  if (typeof project.code !== "string") return null;
  return buildProject({
    name: project.name || fallbackName,
    code: project.code,
    circuit: project.circuit,
    description: project.description ?? project.specification,
    specificationMode: project.specificationMode || project.descriptionMode,
  });
}

function forkImportedProjectIfNeeded(project) {
  const normalized = normalizeProjectRecord(project);
  const collides = projectCache.some((item) => item.id === normalized.id);
  if (!collides) return normalized;

  let activeRevisionId = "";
  const revisions = normalized.revisions.map((revision) => {
    const forkedId = createRevisionId();
    if (revision.id === normalized.activeRevisionId) activeRevisionId = forkedId;
    return {
      ...revision,
      id: forkedId,
      source: "import",
    };
  });

  return normalizeProjectRecord({
    ...normalized,
    id: createProjectId(),
    name: nextProjectImportName(normalized.name),
    revisions,
    activeRevisionId: activeRevisionId || revisions[0]?.id || "",
  });
}

function nextProjectImportName(name = "") {
  const root = revisionNameRoot(name) || normalizeProjectName(name) || "Imported Project";
  let maxVersion = 1;
  projectCache.forEach((project) => {
    const parsed = splitRevisionNumber(project?.name || "");
    if (parsed.root.toLowerCase() === root.toLowerCase()) {
      maxVersion = Math.max(maxVersion, parsed.version);
    }
  });
  return normalizeProjectName(`${root} ${maxVersion + 1}`);
}

function projectFromCode(code, name = "", circuit = null, description = "", specificationMode = currentProjectSpecificationMode) {
  return buildProject({ name, code, circuit, description, specificationMode });
}

function createProjectId() {
  return `p1e-prj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createRevisionId() {
  return `rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeProjectName(name) {
  return normalizeSketchName(name);
}

function autoProjectName(code) {
  const inferred = inferSketchBaseName(code);
  if (isMeaningfulAutoSketchName(inferred)) return inferred;
  return generatedSketchName(code || `${Date.now()}`);
}

function normalizeProjectRecord(project = {}) {
  const now = new Date().toISOString();
  const projectChat = normalizeChatMessages(project.chat);
  const revisions = Array.isArray(project.revisions)
    ? project.revisions
      .map((revision) => normalizeRevisionRecord(revision))
      .filter((revision) => revision.code.trim() || revision.specification.trim() || revision.source === "new-revision")
    : [];
  const active = revisions.find((revision) => revision.id === project.activeRevisionId) || revisions[0] || null;
  if (active && projectChat.length && !active.chat.length) active.chat = projectChat;
  return {
    type: "p1e-project",
    version: 2,
    id: String(project.id || createProjectId()),
    name: normalizeProjectName(project.name) || autoProjectName(active?.code || ""),
    createdAt: String(project.createdAt || now),
    updatedAt: String(project.updatedAt || now),
    activeRevisionId: active?.id || "",
    chat: [],
    revisions,
  };
}

function normalizeChatMessages(messages) {
  return Array.isArray(messages)
    ? messages
      .filter((item) => ["user", "assistant", "error"].includes(item?.role) && typeof item?.content === "string")
      .slice(-60)
    : [];
}

function normalizeRevisionRecord(revision = {}) {
  const code = String(revision.code ?? "");
  const specification = String(revision.specification ?? revision.description ?? "");
  const circuit = normalizeCircuitLayout(revision.circuit)
    || (code.trim() ? inferCircuitLayout(code, null) : null);
  return {
    id: String(revision.id || createRevisionId()),
    name: normalizeSketchName(revision.name) || "Revision",
    code,
    specification,
    specificationMode: normalizeSpecificationMode(revision.specificationMode || revision.descriptionMode || "middle"),
    circuit,
    chat: normalizeChatMessages(revision.chat),
    source: String(revision.source || "manual"),
    createdAt: String(revision.createdAt || revision.at || new Date().toISOString()),
    bytes: Number(revision.bytes) || new Blob([code]).size,
  };
}

function buildRevision({
  id = "",
  name = "",
  code = "",
  specification = currentProjectDescription,
  specificationMode = currentProjectSpecificationMode,
  circuit = undefined,
  chat = chatMessages,
  source = "manual",
  createdAt = "",
} = {}) {
  const text = String(code ?? "");
  return normalizeRevisionRecord({
    id: id || createRevisionId(),
    name: name || "Revision",
    code: text,
    specification,
    specificationMode,
    circuit: circuit === undefined ? projectCircuitForCurrentCode(text) : circuit,
    chat,
    source,
    createdAt,
  });
}

function revisionEquivalent(left, right) {
  if (!left || !right) return false;
  return String(left.code || "") === String(right.code || "")
    && String(left.specification || "") === String(right.specification || "")
    && normalizeSpecificationMode(left.specificationMode) === normalizeSpecificationMode(right.specificationMode)
    && JSON.stringify(normalizeCircuitLayout(left.circuit) || null) === JSON.stringify(normalizeCircuitLayout(right.circuit) || null);
}

function revisionContentEquivalent(left, right) {
  if (!left || !right) return false;
  return String(left.code || "") === String(right.code || "")
    && String(left.specification || "") === String(right.specification || "")
    && normalizeSpecificationMode(left.specificationMode) === normalizeSpecificationMode(right.specificationMode);
}

function revisionCodeEquivalent(left, right) {
  if (!left || !right) return false;
  return String(left.code || "") === String(right.code || "");
}

function moveRevisionToFront(project, revisionId) {
  if (!project?.revisions?.length || !revisionId) return project;
  const index = project.revisions.findIndex((revision) => revision.id === revisionId);
  if (index <= 0) return project;
  const revisions = project.revisions.slice();
  const [revision] = revisions.splice(index, 1);
  revisions.unshift(revision);
  return {
    ...project,
    revisions,
  };
}

function nextRevisionName(project) {
  const count = Array.isArray(project?.revisions) ? project.revisions.length + 1 : 1;
  return `Revision ${count}`;
}

function nextNamedRevisionName(project, name = "") {
  if (isGenericRevisionName(name)) return nextRevisionName(project);
  const root = revisionNameRoot(name);
  if (!root) return nextRevisionName(project);
  let maxVersion = 1;
  (project?.revisions || []).forEach((revision) => {
    const parsed = splitRevisionNumber(revision?.name || "");
    if (parsed.root.toLowerCase() === root.toLowerCase()) {
      maxVersion = Math.max(maxVersion, parsed.version);
    }
  });
  return normalizeSketchName(`${root} ${maxVersion + 1}`);
}

function isGenericRevisionName(name = "") {
  const clean = normalizeSketchName(name).toLowerCase();
  return /^(initial revision|revision|new sketch)( \d+)?$/.test(clean);
}

function revisionNameRoot(name = "") {
  return splitRevisionNumber(name).root;
}

function splitRevisionNumber(name = "") {
  const normalized = normalizeSketchName(name);
  const match = normalized.match(/^(.*?)\s+(?:v)?(\d+)$/i);
  if (!match) return { root: normalized, version: normalized ? 1 : 0 };
  return {
    root: normalizeSketchName(match[1]),
    version: Math.max(1, Number(match[2]) || 1),
  };
}

async function ensureProjectForWrite({ code = "", nameHint = "" } = {}) {
  const existing = await getActiveProject();
  if (existing) return normalizeProjectRecord(existing);
  const configuredId = currentProjectId || localStorage.getItem(storage.projectId) || lastConfig?.projectId || "";
  const configuredName = lastConfig?.projectName || "";
  const project = normalizeProjectRecord({
    id: configuredId || createProjectId(),
    name: normalizeProjectName(nameHint) || normalizeProjectName(configuredName) || autoProjectName(code),
    revisions: [],
    activeRevisionId: "",
    chat: [],
  });
  currentProjectId = project.id;
  localStorage.setItem(storage.projectId, project.id);
  return project;
}

async function persistProjectMetadataToDevice(project) {
  if (!client || !project?.id) return;
  try {
    const revision = activeRevision(project);
    await sendCommand("config.set", {
      projectId: project.id,
      projectName: project.name,
      scriptName: revision?.name || "",
    }, { quiet: true, timeoutMs: 2500 });
  } catch {
  }
}

function projectCircuitForCurrentCode(code) {
  if (String(code ?? "") === currentSketchSource && currentProjectCircuit) return normalizeCircuitLayout(currentProjectCircuit);
  if (circuitChatLayout) return normalizeCircuitLayout(circuitChatLayout);
  const viewModel = circuitView?.getModel?.();
  return normalizeCircuitLayout(viewModel);
}

function slugForFilename(name) {
  const slug = normalizeSketchName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `p1e-${timestampForFilename()}`;
}

function sketchNameFromFilename(filename = "") {
  const base = String(filename || "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.(p1e\.json|json|wrench|txt)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeSketchName(base);
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
      if (!db.objectStoreNames.contains(projectStoreName)) {
        const store = db.createObjectStore(projectStoreName, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
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

async function readProjects() {
  try {
    await migrateLegacySketchesToProjects();
    const db = await openSketchDb();
    try {
      const tx = db.transaction(projectStoreName, "readonly");
      const store = tx.objectStore(projectStoreName);
      const items = await sketchDbRequest(store.getAll());
      projectCache = items
        .map((item) => normalizeProjectRecord(item))
        .filter((item) => item.revisions.length)
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
        .slice(0, projectLimit);
      return projectCache;
    } finally {
      db.close();
    }
  } catch {
    projectCache = readProjectsFallback();
    return projectCache;
  }
}

function readProjectsFallback() {
  try {
    const value = JSON.parse(localStorage.getItem(storage.projectFallback) || "[]");
    return Array.isArray(value)
      ? value.map((item) => normalizeProjectRecord(item)).filter((item) => item.revisions.length).slice(0, projectLimit)
      : [];
  } catch {
    return [];
  }
}

async function saveProject(project) {
  const normalized = normalizeProjectRecord(project);
  normalized.updatedAt = new Date().toISOString();
  projectCache = [
    normalized,
    ...projectCache.filter((item) => item.id !== normalized.id),
  ].slice(0, projectLimit);
  localStorage.setItem(storage.projectId, normalized.id);
  try {
    const db = await openSketchDb();
    try {
      const tx = db.transaction(projectStoreName, "readwrite");
      tx.objectStore(projectStoreName).put(normalized);
      await sketchDbTransactionDone(tx);
    } finally {
      db.close();
    }
  } catch {
    localStorage.setItem(storage.projectFallback, JSON.stringify(projectCache));
  }
  return normalized;
}

async function getActiveProject() {
  const projects = projectCache.length ? projectCache : await readProjects();
  const id = currentProjectId || localStorage.getItem(storage.projectId) || "";
  return projects.find((project) => project.id === id) || null;
}

function activeRevision(project) {
  if (!project?.revisions?.length) return null;
  return project.revisions.find((revision) => revision.id === project.activeRevisionId) || project.revisions[0];
}

async function rememberUploadedSketch(code, name = "", {
  circuit = undefined,
  description = undefined,
  specificationMode = currentProjectSpecificationMode,
  source = "upload",
} = {}) {
  const current = String(code ?? "");
  if (!current.trim()) return;
  let project = await ensureProjectForWrite({ code: current, nameHint: name });
  const revisionName = normalizeSketchName(name)
    || (source === "manual" || source === "upload" ? nextNamedRevisionName(project, currentSketchName) : nextRevisionName(project));
  const revision = buildRevision({
    name: revisionName,
    code: current,
    specification: description ?? currentProjectDescription,
    specificationMode,
    circuit: circuit === undefined ? projectCircuitForCurrentCode(current) : circuit,
    source,
  });
  const matchingRevision = project.revisions.find((item) => revisionContentEquivalent(item, revision))
    || (source === "upload" ? project.revisions.find((item) => revisionCodeEquivalent(item, revision)) : null);
  if (matchingRevision) {
    const keepExistingSpec = !revisionContentEquivalent(matchingRevision, revision)
      && revisionCodeEquivalent(matchingRevision, revision)
      && source === "upload"
      && description === undefined
      && currentProjectDescription === currentProjectDescriptionSource;
    const updatedMatching = {
      ...matchingRevision,
      specification: keepExistingSpec ? matchingRevision.specification : revision.specification,
      specificationMode: keepExistingSpec ? matchingRevision.specificationMode : revision.specificationMode,
      circuit: revision.circuit,
      chat: normalizeChatMessages(revision.chat),
      bytes: revision.bytes,
    };
    project.revisions = project.revisions.map((item) => item.id === matchingRevision.id ? updatedMatching : item);
    project = moveRevisionToFront(project, matchingRevision.id);
    project.activeRevisionId = matchingRevision.id;
    const saved = await saveProject(project);
    await persistProjectMetadataToDevice(saved);
    await openProjectRevision(saved, updatedMatching, { saveCurrent: false });
    return;
  }
  const previous = project.revisions.find((item) => item.id === currentRevisionId) || activeRevision(project);
  if (previous && revisionContentEquivalent(previous, revision)) {
    const updatedPrevious = {
      ...previous,
      circuit: revision.circuit,
      chat: normalizeChatMessages(revision.chat),
      bytes: revision.bytes,
    };
    project.revisions = project.revisions.map((item) => item.id === previous.id ? updatedPrevious : item);
    project.activeRevisionId = previous.id;
    const saved = await saveProject(project);
    await persistProjectMetadataToDevice(saved);
    await openProjectRevision(saved, updatedPrevious, { saveCurrent: false });
    return;
  }
  project.revisions.unshift(revision);
  project.activeRevisionId = revision.id;
  const saved = await saveProject(project);
  await persistProjectMetadataToDevice(saved);
  await renderSketchHistory();
  await openProjectRevision(saved, revision, { saveCurrent: false });
}

async function migrateLegacySketchesToProjects() {
  if (localStorage.getItem(storage.projectMigration) === "1") return;
  const legacy = [];
  try {
    const value = JSON.parse(localStorage.getItem(storage.sketchHistory) || "[]");
    if (Array.isArray(value)) legacy.push(...value.filter((item) => typeof item?.code === "string"));
  } catch {
  }
  try {
    const db = await openSketchDb();
    try {
      const tx = db.transaction(sketchStoreName, "readonly");
      const items = await sketchDbRequest(tx.objectStore(sketchStoreName).getAll());
      legacy.push(...items.filter((item) => typeof item?.code === "string"));
    } finally {
      db.close();
    }
  } catch {
  }
  if (!legacy.length) {
    localStorage.setItem(storage.projectMigration, "1");
    return;
  }
  const seen = new Set();
  const revisions = legacy
    .filter((item) => {
      const key = String(item.code || "");
      if (!key.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => buildRevision({
      id: createRevisionId(),
      name: item.name || "Imported revision",
      code: String(item.code || ""),
      specification: String(item.description || ""),
      specificationMode: item.specificationMode || "middle",
      circuit: normalizeCircuitLayout(item.circuit),
      source: "migration",
      createdAt: item.at || new Date().toISOString(),
    }));
  if (!revisions.length) {
    localStorage.setItem(storage.projectMigration, "1");
    return;
  }
  const project = normalizeProjectRecord({
    id: createProjectId(),
    name: "Imported Sketches",
    revisions,
    activeRevisionId: revisions[0].id,
    chat: [],
  });
  await saveProject(project);
  localStorage.removeItem(storage.sketchHistory);
  localStorage.setItem(storage.projectMigration, "1");
}

async function renderSketchHistory() {
  const projects = await readProjects();
  renderProjectSelectors(projects);
  const project = projects.find((item) => item.id === currentProjectId)
    || projects.find((item) => item.id === localStorage.getItem(storage.projectId))
    || projects[0]
    || null;
  if (!currentProjectId && project && !getEditorValue().trim()) {
    await openProjectRevision(project, activeRevision(project), { saveCurrent: false });
  }
}

function renderProjectSelectors(projects = projectCache) {
  const options = [new Option("project", "")];
  projects.forEach((project) => {
    options.push(new Option(project.name || "Untitled Project", project.id));
  });
  [els.projectSelect, els.generativeProjectSelect].forEach((select) => {
    select.replaceChildren(...options.map((option) => new Option(option.textContent, option.value)));
    select.value = currentProjectId || "";
    select.disabled = projects.length === 0;
  });
  const project = projects.find((item) => item.id === currentProjectId) || null;
  renderRevisionSelectors(project);
}

function renderRevisionSelectors(project) {
  const revisions = project?.revisions || [];
  const options = [new Option("revision", "")];
  revisions.forEach((revision) => {
    const name = normalizeSketchName(revision.name || "");
    const size = formatBytes(revision.bytes || revision.code.length);
    const label = name ? `${name} / ${size}` : size;
    options.push(new Option(label, revision.id));
  });
  [els.sketchHistory, els.generativeRevisionSelect].forEach((select) => {
    select.replaceChildren(...options.map((option) => new Option(option.textContent, option.value)));
    select.value = currentRevisionId || "";
    select.disabled = revisions.length === 0;
  });
  renderCurrentSketchName();
}

async function selectProject(id) {
  const projects = projectCache.length ? projectCache : await readProjects();
  const project = projects.find((item) => item.id === id);
  if (!project) return;
  await shelveEditorSketchIfNeeded();
  await openProjectRevision(project, activeRevision(project), { saveCurrent: false });
  logLine("info", `opened project ${project.name || "Untitled Project"}`);
}

async function selectRevision(id) {
  const project = await getActiveProject();
  const revision = project?.revisions?.find((item) => item.id === id);
  if (!project || !revision) return;
  await shelveEditorSketchIfNeeded();
  await openProjectRevision(project, revision, { saveCurrent: false });
  logLine("info", `opened revision ${revision.name || "revision"}`);
}

async function openProjectRevision(project, revision, { saveCurrent = true } = {}) {
  if (!project || !revision) return;
  if (saveCurrent) await shelveEditorSketchIfNeeded({ incomingCode: revision.code });
  revision = applyStoredRevisionDraft(project, revision);
  currentProjectId = project.id;
  currentRevisionId = revision.id;
  localStorage.setItem(storage.projectId, project.id);
  project.activeRevisionId = revision.id;
  chatMessages = normalizeChatMessages(revision.chat);
  circuitChatLayout = normalizeCircuitLayout(revision.circuit);
  setEditorValueRaw(revision.code || "", { persist: true });
  setCurrentSketchIdentity(revision.name || "", revision.code || "", project, revision);
  await saveProject(project);
  renderProjectSelectors(projectCache);
  renderChatTranscript();
  updateCircuitView(circuitChatLayout ? "project circuit + code inference" : "inferred from code");
}

function applyStoredRevisionDraft(project, revision) {
  const draft = readCurrentRevisionDraft();
  if (!draft || draft.projectId !== project.id || draft.revisionId !== revision.id) return revision;
  const nextRevision = {
    ...revision,
    code: String(draft.code ?? revision.code ?? ""),
    specification: String(draft.specification ?? revision.specification ?? ""),
    specificationMode: normalizeSpecificationMode(draft.specificationMode || revision.specificationMode),
    bytes: Number(draft.bytes) || new Blob([String(draft.code ?? revision.code ?? "")]).size,
  };
  project.revisions = project.revisions.map((item) => item.id === revision.id ? nextRevision : item);
  return nextRevision;
}

function scheduleCurrentRevisionDraftSave() {
  writeCurrentRevisionDraft();
  window.clearTimeout(revisionDraftSaveTimer);
  revisionDraftSaveTimer = window.setTimeout(() => {
    revisionDraftSaveTimer = null;
    void persistCurrentRevisionDraft();
  }, 500);
}

function writeCurrentRevisionDraft() {
  if (!currentProjectId || !currentRevisionId) return;
  const code = getEditorValue();
  const draft = {
    projectId: currentProjectId,
    revisionId: currentRevisionId,
    code,
    specification: currentProjectDescription,
    specificationMode: currentProjectSpecificationMode,
    bytes: new Blob([code]).size,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(storage.revisionDraft, JSON.stringify(draft));
}

function readCurrentRevisionDraft() {
  try {
    return JSON.parse(localStorage.getItem(storage.revisionDraft) || "null");
  } catch {
    return null;
  }
}

async function persistCurrentRevisionDraft() {
  const draft = readCurrentRevisionDraft();
  if (!draft?.projectId || !draft?.revisionId) return;
  const project = await getActiveProject();
  if (!project || project.id !== draft.projectId) return;
  const index = project.revisions.findIndex((revision) => revision.id === draft.revisionId);
  if (index < 0) return;
  project.revisions[index] = {
    ...project.revisions[index],
    code: String(draft.code ?? ""),
    specification: String(draft.specification ?? ""),
    specificationMode: normalizeSpecificationMode(draft.specificationMode || "middle"),
    circuit: projectCircuitForCurrentCode(String(draft.code ?? "")),
    bytes: Number(draft.bytes) || new Blob([String(draft.code ?? "")]).size,
  };
  await saveProject(project);
}

async function createNewSketch() {
  const requested = window.prompt("Project name", "");
  if (requested === null) return;
  await shelveEditorSketchIfNeeded();
  const name = normalizeProjectName(requested) || autoProjectName("");
  const code = newSketchTemplate();
  const revision = buildRevision({
    code,
    name: "Revision",
    specification: "",
    specificationMode: "middle",
    circuit: null,
    chat: [],
    source: "new",
  });
  const project = normalizeProjectRecord({
    id: createProjectId(),
    name,
    revisions: [revision],
    activeRevisionId: revision.id,
    chat: [],
  });
  const saved = await saveProject(project);
  await openProjectRevision(saved, revision, { saveCurrent: false });
  clearEditorError();
  logLine("info", `new project ${saved.name}`);
}

function requestRevisionName(defaultName = "Revision") {
  const fallback = normalizeSketchName(defaultName) || "Revision";
  const dialog = els.revisionNameDialog;
  const input = els.revisionNameInput;
  if (!dialog || !input) {
    const requested = window.prompt("Revision name", fallback);
    return Promise.resolve(requested === null ? null : (normalizeSketchName(requested) || fallback));
  }
  input.value = fallback;
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      dialog.removeEventListener("close", onClose);
      dialog.removeEventListener("cancel", onCancel);
      input.removeEventListener("keydown", onKeydown);
      els.revisionNameCreate?.removeEventListener("click", onCreate);
      els.revisionNameCancel?.removeEventListener("click", onCancel);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const onClose = () => {
      if (dialog.returnValue === "ok") {
        finish(normalizeSketchName(input.value) || fallback);
      } else {
        finish(null);
      }
    };
    const onCancel = (event) => {
      event?.preventDefault?.();
      if (dialog.open) dialog.close("cancel");
    };
    const onCreate = () => {
      if (dialog.open) dialog.close("ok");
    };
    const onKeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onCreate();
      }
    };
    dialog.addEventListener("close", onClose);
    dialog.addEventListener("cancel", onCancel);
    input.addEventListener("keydown", onKeydown);
    els.revisionNameCreate?.addEventListener("click", onCreate);
    els.revisionNameCancel?.addEventListener("click", onCancel);
    dialog.showModal();
    window.setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  });
}

async function createCleanRevision() {
  const activeProjectBeforeShelve = normalizeProjectRecord(await getActiveProject() || {});
  const defaultName = nextRevisionName(activeProjectBeforeShelve);
  const revisionName = await requestRevisionName(defaultName);
  if (revisionName === null) return;
  await shelveEditorSketchIfNeeded();
  let project = await getActiveProject();
  if (!project) {
    project = await ensureProjectForWrite({ code: "", nameHint: "Untitled Project" });
  }
  project = normalizeProjectRecord(project);
  const revision = buildRevision({
    code: "",
    name: revisionName,
    specification: "",
    specificationMode: "middle",
    circuit: null,
    chat: [],
    source: "new-revision",
  });
  project.revisions.unshift(revision);
  project.activeRevisionId = revision.id;
  const saved = await saveProject(project);
  await persistProjectMetadataToDevice(saved);
  await openProjectRevision(saved, revision, { saveCurrent: false });
  clearEditorError();
  logLine("info", `new revision ${revision.name}`);
}

async function shelveEditorSketchIfNeeded({ incomingCode = "" } = {}) {
  const current = String(getEditorValue() || "");
  const specDirty = currentProjectDescription !== currentProjectDescriptionSource
    || currentProjectSpecificationMode !== currentProjectSpecificationModeSource;
  if (!current.trim() && !specDirty) return;
  if (incomingCode && current === String(incomingCode || "")) return;
  if (currentSketchSaved) return;
  await rememberUploadedSketch(current, "", {
    source: "manual",
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

function setCurrentSketchIdentity(name = "", code = "", project = null, revision = null) {
  currentSketchName = normalizeSketchName(name);
  currentSketchSource = String(code ?? "");
  currentSketchVersionName = project ? nextRevisionName(project) : "";
  currentSketchDirty = false;
  currentSketchSaved = true;
  currentProjectDescription = String(revision?.specification || "");
  currentProjectSpecificationMode = normalizeSpecificationMode(revision?.specificationMode || "middle");
  currentProjectDescriptionSource = currentProjectDescription;
  currentProjectSpecificationModeSource = currentProjectSpecificationMode;
  currentProjectCircuit = normalizeCircuitLayout(revision?.circuit);
  circuitChatLayout = currentProjectCircuit;
  setProjectSpecification(currentProjectDescription, currentProjectSpecificationMode, { markSaved: true });
  renderCurrentSketchName();
}

function clearCurrentSketchIdentity() {
  currentSketchName = "";
  currentSketchSource = "";
  currentSketchVersionName = "";
  currentProjectDescription = "";
  currentProjectDescriptionSource = "";
  currentProjectSpecificationMode = "middle";
  currentProjectSpecificationModeSource = "middle";
  currentProjectCircuit = null;
  circuitChatLayout = null;
  setProjectSpecification("", currentProjectSpecificationMode, { markSaved: true });
  currentSketchDirty = Boolean(String(getEditorValue() || "").trim());
  currentSketchSaved = !currentSketchDirty;
  renderCurrentSketchName();
}

function updateCurrentSketchDirty() {
  const code = getEditorValue();
  const codeDirty = currentSketchName
    ? code !== currentSketchSource
    : Boolean(String(code || "").trim());
  const specDirty = currentProjectDescription !== currentProjectDescriptionSource
    || currentProjectSpecificationMode !== currentProjectSpecificationModeSource;
  currentSketchDirty = codeDirty || specDirty;
  currentSketchSaved = !currentSketchDirty;
  renderCurrentSketchName();
}

function renderCurrentSketchName() {
  const option = els.sketchHistory.options[0];
  if (option) option.textContent = sketchHistoryPlaceholderLabel();
  const label = sketchHistoryPlaceholderLabel();
  els.sketchHistory.title = currentSketchName
    ? `Current revision: ${label}`
    : "Revision";
}

function sketchHistoryPlaceholderLabel() {
  if (!currentSketchName) return currentSketchDirty ? "unsaved revision" : "revision";
  return currentSketchDirty ? `${currentSketchName} *` : currentSketchName;
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
    const project = parseDroppedProject(text, file);
    const revision = activeRevision(project);
    if (!project || !revision?.code?.trim()) return;
    await shelveEditorSketchIfNeeded({ incomingCode: revision.code });
    const saved = await saveProject(project);
    await openProjectRevision(saved, activeRevision(saved), { saveCurrent: false });
    updateCircuitView(circuitChatLayout ? "project circuit + code inference" : "inferred from code");
    logLine("info", saved.name ? `loaded ${saved.name}` : (file ? `loaded ${file.name}` : "loaded dropped text"));
  });
}

function parseDroppedProject(text, file = null) {
  const fallbackName = sketchNameFromFilename(file?.name || "");
  try {
    const parsed = JSON.parse(String(text || ""));
    const project = normalizeProject(parsed, fallbackName);
    if (project) return forkImportedProjectIfNeeded(project);
  } catch {
  }
  return projectFromCode(String(text || ""), fallbackName);
}

function formatBytes(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${size} B`;
  return `${(size / 1024).toFixed(1)} KB`;
}

function setTimezoneSelectValue(value) {
  if (!els.timezoneInput) return;
  const timezone = String(value || "UTC0").trim() || "UTC0";
  const existing = Array.from(els.timezoneInput.options).find((option) => option.value === timezone);
  els.timezoneInput.value = existing ? timezone : "UTC0";
}

function openSettingsDialog() {
  els.deviceNameInput.value = lastInfo?.deviceName || lastStatus?.deviceName || "";
  setTimezoneSelectValue(lastConfig?.timezone || "UTC0");
  els.wifiSsid.value = "";
  els.wifiPassword.value = "";
  populateMqttSettings();
  renderWifiNetworkList();
  wifiDraftDirty = false;
  switchSettingsTab("general");
  els.settingsDialog.showModal();
  els.deviceNameInput.focus();
  els.deviceNameInput.select();
}

function switchSettingsTab(name) {
  const target = name || "general";
  els.settingsTabs.forEach((tab) => {
    const active = tab.dataset.settingsTab === target;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  els.settingsPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.settingsPanel === target);
  });
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
    mqttEnabled: lastConfig?.mqttEnabled !== false,
    mqttAllowAnonymousUi: Boolean(lastConfig?.mqttAllowAnonymousUi),
    mqttAllowAnonymousScript: Boolean(lastConfig?.mqttAllowAnonymousScript),
  };
}

function mqttRootOrEmpty(value) {
  return String(value || "").trim();
}

function mqttTransportOptions(config = null) {
  const cfg = config || mqttConfigFromStorageAndDevice();
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
    authProvider: requestMqttSignIn,
  };
}

function normalizeMqttHistoryConfig(config = {}) {
  const defaults = mqttDefaults();
  const host = String(config.mqttHost || config.host || defaults.mqttHost).trim() || defaults.mqttHost;
  const port = Number(config.mqttPort || config.port || defaults.mqttPort);
  return {
    mqttHost: host,
    mqttPort: Number.isFinite(port) && port > 0 ? port : defaults.mqttPort,
    mqttRoot: mqttRootOrEmpty(config.mqttRoot ?? config.root ?? ""),
    mqttUser: String(config.mqttUser || config.user || defaults.mqttUser).trim() || defaults.mqttUser,
    mqttPassword: String(config.mqttPassword || config.password || defaults.mqttPassword),
  };
}

function applyMqttConfig(config = {}) {
  const cfg = normalizeMqttHistoryConfig(config);
  if (cfg.mqttHost) localStorage.setItem(storage.mqttHost, cfg.mqttHost);
  if (cfg.mqttPort) localStorage.setItem(storage.mqttPort, String(cfg.mqttPort));
  if (cfg.mqttRoot) localStorage.setItem(storage.mqttRoot, cfg.mqttRoot);
  else localStorage.removeItem(storage.mqttRoot);
  if (cfg.mqttUser) localStorage.setItem(storage.mqttUser, cfg.mqttUser);
  if (cfg.mqttPassword) localStorage.setItem(storage.mqttPassword, cfg.mqttPassword);
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
  els.mqttEnabled.checked = cfg.mqttEnabled;
  els.accessGuestUi.checked = cfg.mqttAllowAnonymousUi;
  els.accessGuestScript.checked = cfg.mqttAllowAnonymousScript;
  renderOnlineAuthUsers();
}

function mqttRemoteIdForAuth() {
  const explicit = normalizePeerId(els.peerId?.value || "");
  if (explicit) return explicit;
  const deviceId = lastConfig?.deviceId || lastInfo?.deviceId || lastStatus?.deviceId || "";
  if (deviceId && deviceId.length >= 6) return `p1-embed-${deviceId.slice(-6)}`.toLowerCase();
  return normalizePeerId(lastConfig?.deviceName || lastInfo?.deviceName || "");
}

function requestMqttSignIn({ remoteId } = {}) {
  return new Promise((resolve, reject) => {
    const dialog = els.mqttSigninDialog;
    if (!dialog) {
      reject(new Error("MQTT sign in required"));
      return;
    }
    const target = normalizePeerId(remoteId || mqttRemoteIdForAuth());
    if (!target) {
      reject(new Error("MQTT board id is required for sign in"));
      return;
    }

    els.mqttSigninTitle.textContent = `MQTT sign in: ${target}`;
    els.mqttSigninUsername.value = "";
    els.mqttSigninPassword.value = "";

    const cleanup = () => {
      els.mqttSigninButton.removeEventListener("click", submit);
      els.mqttSigninCancel.removeEventListener("click", cancel);
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("close", onClose);
    };
    const cancel = () => {
      cleanup();
      if (dialog.open) dialog.close("cancel");
      reject(new Error("MQTT sign in cancelled"));
    };
    const onClose = () => {
      if (dialog.returnValue === "ok") return;
      cleanup();
      reject(new Error("MQTT sign in cancelled"));
    };
    const submit = async () => {
      const username = els.mqttSigninUsername.value.trim();
      const password = els.mqttSigninPassword.value;
      if (!username || !password) return;
      try {
        const keyHex = await deriveOnlineAuthKeyHex(target, username, password);
        storeOnlineAuthKey(target, username, keyHex);
        cleanup();
        if (dialog.open) dialog.close("ok");
        resolve({ username, keyHex });
      } catch (error) {
        cleanup();
        if (dialog.open) dialog.close("cancel");
        reject(error);
      } finally {
        els.mqttSigninPassword.value = "";
      }
    };

    els.mqttSigninButton.addEventListener("click", submit);
    els.mqttSigninCancel.addEventListener("click", cancel);
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
    els.mqttSigninUsername.focus();
  });
}

function renderOnlineAuthUsers() {
  if (!els.onlineAuthList) return;
  const users = Array.isArray(lastConfig?.onlineAuthUsers) ? lastConfig.onlineAuthUsers : [];
  els.onlineAuthList.innerHTML = "";
  if (!users.length) {
    const empty = document.createElement("div");
    empty.className = "settings-muted";
    empty.textContent = "No online sign-in users";
    els.onlineAuthList.append(empty);
    return;
  }
  for (const user of users) {
    const row = document.createElement("div");
    row.className = "online-auth-row";
    const name = document.createElement("span");
    name.className = "wifi-network-name";
    name.textContent = user?.username || "user";
    const remove = document.createElement("button");
    remove.className = "button compact icon-buttonish";
    remove.type = "button";
    remove.title = "Remove online user";
    remove.innerHTML = `<span class="material-symbols-rounded">close</span>`;
    remove.addEventListener("click", () => runUiAction(() => removeOnlineAuthUser(user?.username || ""), "online user"));
    row.append(name, remove);
    els.onlineAuthList.append(row);
  }
}

async function saveDeviceName() {
  const deviceName = els.deviceNameInput.value.trim();
  if (!deviceName) return;
  const timezone = els.timezoneInput?.value.trim() || "UTC0";
  const config = await sendCommand("config.set", { deviceName, timezone }, { timeoutMs: 10000 });
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
  data.mqttEnabled = Boolean(els.mqttEnabled.checked);
  data.mqttAllowAnonymousUi = Boolean(els.accessGuestUi.checked);
  data.mqttAllowAnonymousScript = Boolean(els.accessGuestScript.checked);
  if (data.mqttAllowAnonymousUi && !String(lastConfig?.mqttGuestUiKey || "").trim()) {
    data.mqttGuestUiKey = generateGuestKey();
  }
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
  logLine("info", "settings saved");
}

async function addOnlineAuthUser() {
  const username = els.onlineAuthUsername.value.trim();
  const password = els.onlineAuthPassword.value;
  if (!username || !password) return;
  const remoteId = mqttRemoteIdForAuth();
  if (!remoteId) throw new Error("Connect or enter a board id before adding an online user");
  const keyHex = await deriveOnlineAuthKeyHex(remoteId, username, password);
  const config = await sendCommand("config.set", { onlineAuthUsername: username, onlineAuthKey: keyHex }, { timeoutMs: 10000 });
  storeOnlineAuthKey(remoteId, username, keyHex);
  els.onlineAuthPassword.value = "";
  updateConfig(config);
  renderOnlineAuthUsers();
  logLine("info", `Online user ${username} saved`);
}

async function removeOnlineAuthUser(username) {
  if (!username) return;
  const config = await sendCommand("config.set", { onlineAuthUserRemove: username }, { timeoutMs: 10000 });
  clearOnlineAuthKey(mqttRemoteIdForAuth());
  updateConfig(config);
  renderOnlineAuthUsers();
  logLine("info", `Online user ${username} removed`);
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
    clearGuinoForUploadEvent(data);
    updateUploadFromEvent(data);
    updateScriptState(data);
  }
  if (event.name === "device.boot") {
    if (data.info) lastInfo = data.info;
    if (data.status) updateStatus(data.status);
    renderFields();
  }
}

function clearGuinoForUploadEvent(data = {}) {
  const state = String(data.state || "").toLowerCase();
  const phase = String(data.phase || "").toLowerCase();
  if (state === "queued" || state === "compiling" || phase === "compile") guinoView?.clear?.();
}

function eventLogLevel(name = "", data = {}) {
  if (name?.startsWith("ui.")) return "debug";
  if (data.consoleLevel) return data.consoleLevel;
  if (data.level === "system") return "debug";
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
  if (Date.now() > localUploadActiveUntil) return;
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
      localUploadActiveUntil = 0;
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

  [els.run, els.chatRun].forEach((button) => {
    const runIcon = button?.querySelector(".material-symbols-rounded");
    if (!runIcon) return;
    const working = active && !["running", "saved", "error"].includes(uploadState.phase);
    runIcon.classList.toggle("is-spinning", working);
    runIcon.textContent = working ? "progress_activity" : "play_arrow";
  });
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
  if (config.projectId) {
    currentProjectId = String(config.projectId);
    localStorage.setItem(storage.projectId, currentProjectId);
  }
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
  if (config.timezone && els.timezoneInput && document.activeElement !== els.timezoneInput) {
    setTimezoneSelectValue(config.timezone);
  }
  if (Array.isArray(config.wifiNetworks) && config.wifiNetworks[0]?.ssid) {
    setWifiSsidFromDevice(config.wifiNetworks[0].ssid);
  } else if (config.wifiSsid) {
    setWifiSsidFromDevice(config.wifiSsid);
  }
  renderWifiNetworkList();
  if (config.projectId || config.projectName) void renderSketchHistory();
  renderFields();
}

function currentDeviceDisplayName() {
  const name = String(lastInfo?.deviceName || lastStatus?.deviceName || lastConfig?.deviceName || "").trim();
  if (!name) return "";
  const normalized = normalizePeerId(name);
  const id = normalizePeerId(lastInfo?.deviceId || lastStatus?.deviceId || lastConfig?.deviceId || "");
  if (id && normalized === id) return "";
  if (/^p1-embed-[0-9a-f]{6}$/i.test(name)) return "";
  if (/^p1-[0-9a-f: -]{6,}$/i.test(name)) return "";
  return name;
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
  if (els.brandVersion) {
    els.brandVersion.textContent = lastInfo?.firmwareVersion || "0.1.87";
  }
  renderInfoShare(shareUrl);
  els.fields.replaceChildren(
    infoCard("developer_board", lastInfo?.deviceName || lastStatus?.deviceName || "P1E board", [
      infoMetric("Firmware", [lastInfo?.firmwareName, lastInfo?.firmwareVersion].filter(Boolean).join(" ") || "-"),
      infoMetric("Uptime", formatDuration(lastStatus?.uptimeMs) || "-"),
      infoMetric("Time", lastStatus?.timeSynced ? lastStatus.localTime || "-" : "not synced"),
      infoMetric("Timezone", lastStatus?.timezone || lastConfig?.timezone || "-"),
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
      infoMetric("WiFi name", wifi.connected ? wifi.ssid || "connected" : "offline"),
      infoMetric("IP", wifi.ip || "-"),
      infoMetric("Signal", wifiSignalLabel(wifi)),
      infoMetric("MQTT", mqttSharePeerId(mqtt) || "-"),
      infoMetric("Share", shareUrl || "-"),
    ], { compact: true, links: { peerId: mqttSharePeerId(mqtt) || peerId, shareUrl } }),
  );
}

function bestInfoShareTarget({ web = {}, webrtc = {}, mqtt = {} } = {}) {
  const mqttPeer = mqttSharePeerId(mqtt);
  if (mqttPeer && isConnectionKindAvailable("mqtt")) {
    return { kind: "mqtt", peerId: mqttPeer };
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
  return Boolean(client && transport?.connected && connectionVerified);
}

function syncGuinoConnectionState() {
  const connected = isDeviceConnected();
  els.views.ui?.classList.toggle("is-disconnected", !connected);
  els.uiCanvas?.setAttribute("aria-disabled", connected ? "false" : "true");
  guinoView?.setConnected(connected);
}

function renderConnectionState(transportState = "") {
  const transportOpen = Boolean(client && transport?.connected);
  const transportOnline = Boolean(transportOpen && connectionVerified);
  els.connection.classList.toggle("is-online", transportOnline);
  if (!client || (!transportOpen && !isBusy)) {
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
  renderChatModelOptions();
  const savedModel = localStorage.getItem(storage.chatModel);
  const options = chatModelOptions();
  els.chatModel.value = options.includes(savedModel) ? savedModel : defaultChatModel;
  if (!els.chatModel.value) els.chatModel.value = options[0] || "";
  els.chatMaxOutputTokens.value = String(chatMaxOutputTokens());
  currentProjectDescription = localStorage.getItem(storage.specificationDraft) || "";
  currentProjectSpecificationMode = normalizeSpecificationMode(localStorage.getItem(storage.specificationMode) || "middle");
  setProjectSpecification(currentProjectDescription, currentProjectSpecificationMode);
  chatMessages = readChatHistory();
  renderChatTranscript();
  updateChatKeyButton();
  updateChatDebugPromptButton();
  updateChatEnabledState();
}

function chatModelOptions() {
  try {
    const stored = JSON.parse(localStorage.getItem(storage.chatModelList) || "[]");
    if (Array.isArray(stored)) {
      const cleaned = cleanChatModelList(stored);
      if (cleaned.length) return cleaned;
    }
  } catch {
  }
  return builtInChatModelOptions.slice();
}

function renderChatModelOptions() {
  const current = els.chatModel?.value || localStorage.getItem(storage.chatModel) || defaultChatModel;
  const options = chatModelOptions();
  els.chatModel.replaceChildren(...options.map((model) => new Option(model, model)));
  if (options.includes(current)) els.chatModel.value = current;
}

function cleanChatModelList(models = []) {
  const ids = [...new Set(models.map((model) => String(model?.id || model || "").trim()).filter(Boolean))]
    .filter(isSupportedChatModelId)
    .sort(compareChatModelIds);
  return ids.length ? ids : [];
}

function isSupportedChatModelId(id = "") {
  if (/\d{4}-\d{2}-\d{2}/.test(id)) return false;
  return /^gpt-(?:5(?:\.\d+)?(?:-(?:mini|nano|pro))?|4\.1(?:-(?:mini|nano))?)$/i.test(id);
}

function compareChatModelIds(a, b) {
  const score = (id) => {
    const version = id.match(/^gpt-(\d+(?:\.\d+)?)/i)?.[1] || "0";
    const [major, minor = "0"] = version.split(".").map(Number);
    const size = id.includes("-nano") ? 0 : id.includes("-mini") ? 1 : id.includes("-pro") ? 3 : 2;
    return major * 10000 + minor * 100 + size;
  };
  return score(b) - score(a) || a.localeCompare(b);
}

async function refreshChatModels() {
  const apiKey = localStorage.getItem(storage.chatApiKey) || "";
  if (!apiKey) {
    logLine("warn", "store an OpenAI API key before refreshing models");
    updateChatEnabledState();
    return;
  }
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `Model refresh failed (${response.status})`);
  }
  const models = cleanChatModelList(data.data || []);
  if (!models.length) throw new Error("No compatible GPT models found");
  localStorage.setItem(storage.chatModelList, JSON.stringify(models));
  renderChatModelOptions();
  if (!models.includes(els.chatModel.value)) {
    els.chatModel.value = models.includes(defaultChatModel) ? defaultChatModel : models[0];
    localStorage.setItem(storage.chatModel, els.chatModel.value);
  }
  logLine("info", `model list refreshed / ${models.length} models`);
}

function chatMaxOutputTokens() {
  const raw = Number(els.chatMaxOutputTokens?.value || localStorage.getItem(storage.chatMaxOutputTokens));
  if (!Number.isFinite(raw) || raw <= 0) return CHAT_DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.max(CHAT_MIN_MAX_OUTPUT_TOKENS, Math.min(CHAT_HARD_MAX_OUTPUT_TOKENS, Math.round(raw)));
}

function handleSpecificationInput() {
  currentProjectDescription = readSpecificationMarkdown();
  if (els.specification) els.specification.value = currentProjectDescription;
  localStorage.setItem(storage.specificationDraft, currentProjectDescription);
  updateCurrentSketchDirty();
  scheduleCurrentRevisionDraftSave();
  updateEnabledState();
}

function handleSpecificationPaste(event) {
  event.preventDefault();
  const html = event.clipboardData?.getData("text/html") || "";
  const text = event.clipboardData?.getData("text/plain") || "";
  const markdown = html ? specificationHtmlToMarkdown(html) : text;
  insertSpecificationMarkdown(markdown || text);
  handleSpecificationInput();
}

function insertSpecificationMarkdown(markdown = "") {
  const text = String(markdown || "");
  if (!text.trim()) return;
  document.execCommand("insertHTML", false, markdownToSpecificationHtml(text));
}

function applySpecificationFormat(format = "") {
  els.specificationEditor?.focus();
  const command = {
    normal: ["formatBlock", "P"],
    h1: ["formatBlock", "H1"],
    h2: ["formatBlock", "H2"],
    h3: ["formatBlock", "H3"],
    h4: ["formatBlock", "H4"],
    bold: ["bold"],
    italic: ["italic"],
    underline: ["underline"],
    bullet: ["insertUnorderedList"],
    number: ["insertOrderedList"],
  }[format];
  if (!command) return;
  document.execCommand(command[0], false, command[1] || null);
  handleSpecificationInput();
}

function handleSpecificationModeChange() {
  currentProjectSpecificationMode = normalizeSpecificationMode(els.specificationMode.value);
  els.specificationMode.value = currentProjectSpecificationMode;
  localStorage.setItem(storage.specificationMode, currentProjectSpecificationMode);
  updateCurrentSketchDirty();
  scheduleCurrentRevisionDraftSave();
}

function setProjectSpecification(text = "", mode = currentProjectSpecificationMode, { markSaved = false } = {}) {
  currentProjectDescription = String(text || "");
  currentProjectSpecificationMode = normalizeSpecificationMode(mode);
  if (markSaved) {
    currentProjectDescriptionSource = currentProjectDescription;
    currentProjectSpecificationModeSource = currentProjectSpecificationMode;
  }
  if (els.specification) els.specification.value = currentProjectDescription;
  if (els.specificationEditor) els.specificationEditor.innerHTML = markdownToSpecificationHtml(currentProjectDescription);
  if (els.specificationMode) els.specificationMode.value = currentProjectSpecificationMode;
  localStorage.setItem(storage.specificationDraft, currentProjectDescription);
  localStorage.setItem(storage.specificationMode, currentProjectSpecificationMode);
  updateEnabledState();
}

function readSpecificationMarkdown() {
  if (!els.specificationEditor) return els.specification?.value || "";
  return specificationNodesToMarkdown([...els.specificationEditor.childNodes]).trim();
}

function specificationNodesToMarkdown(nodes = []) {
  const lines = [];
  nodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text) lines.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (/^h[1-4]$/.test(tag)) {
      lines.push(`${"#".repeat(Number(tag.slice(1)))} ${inlineMarkdown(node).trim()}`);
    } else if (tag === "ul" || tag === "ol") {
      [...node.children].forEach((child, index) => {
        if (child.tagName?.toLowerCase() !== "li") return;
        const marker = tag === "ol" ? `${index + 1}.` : "-";
        lines.push(`${marker} ${inlineMarkdown(child).trim()}`);
      });
    } else if (tag === "br") {
      lines.push("");
    } else {
      const text = inlineMarkdown(node).trim();
      if (text) lines.push(text);
    }
  });
  return lines.join("\n\n");
}

function specificationHtmlToMarkdown(html = "") {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  return specificationNodesToMarkdown([...doc.body.childNodes]).trim();
}

function inlineMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\s+/g, " ");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "\n";
  const text = [...node.childNodes].map(inlineMarkdown).join("");
  if (!text) return "";
  const weight = String(node.style?.fontWeight || "").toLowerCase();
  const isBold = tag === "strong" || tag === "b" || weight === "bold" || Number(weight) >= 600;
  const style = String(node.style?.fontStyle || "").toLowerCase();
  const isItalic = tag === "em" || tag === "i" || style === "italic";
  if (isBold) return `**${text}**`;
  if (isItalic) return `*${text}*`;
  if (tag === "u" || node.style?.textDecorationLine?.includes("underline") || node.style?.textDecoration?.includes("underline")) return `<u>${text}</u>`;
  return text;
}

function markdownToSpecificationHtml(markdown = "") {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listType = "";
  const closeList = () => {
    if (!listType) return;
    html.push(`</${listType}>`);
    listType = "";
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      return;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      return;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        html.push("<ul>");
        listType = "ul";
      }
      html.push(`<li>${inlineMarkdownToHtml(bullet[1])}</li>`);
      return;
    }
    const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      if (listType !== "ol") {
        closeList();
        html.push("<ol>");
        listType = "ol";
      }
      html.push(`<li>${inlineMarkdownToHtml(numbered[1])}</li>`);
      return;
    }
    closeList();
    html.push(`<p>${inlineMarkdownToHtml(trimmed)}</p>`);
  });
  closeList();
  return html.join("");
}

function inlineMarkdownToHtml(text = "") {
  return escapeHtml(String(text || ""))
    .replace(/&lt;u&gt;([\s\S]+?)&lt;\/u&gt;/g, "<u>$1</u>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeSpecificationMode(mode = "middle") {
  return ["overview", "middle", "structured"].includes(mode) ? mode : "middle";
}

function specificationModeLabel(mode = "middle") {
  if (mode === "overview") return "Overarching Description";
  if (mode === "structured") return "Programming-Like Plain Text";
  return "Middle-Level Description";
}

function specificationModePrompt(mode = "middle") {
  if (mode === "overview") {
    return "Describe the program at a high level in plain language. Focus on what the program does, what hardware it uses, and how it behaves over time. Do not describe every variable or every line of logic. Write it as a short human-readable explanation.";
  }
  if (mode === "structured") {
    return "Describe the program as structured plain text that follows the same shape as the code. Use sections like Program, Global values, Setup, and Main loop. Describe conditions, state updates, and actions step by step, but do not write actual code syntax unless naming functions, pins, or values is necessary.";
  }
  return "Describe the program in plain language, but include the important implementation details needed to recreate it. Mention key pins, hardware setup, state variables, timing, conditions, and behavior changes. Do not write pseudocode or step-by-step code instructions. The result should sit between a summary and a code plan.";
}

function readChatHistory() {
  const project = projectCache.find((item) => item.id === currentProjectId)
    || projectCache.find((item) => item.id === localStorage.getItem(storage.projectId));
  const revision = activeRevision(project);
  if (revision?.chat?.length) return normalizeChatMessages(revision.chat);
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
  const project = projectCache.find((item) => item.id === currentProjectId);
  if (project) {
    const revision = project.revisions.find((item) => item.id === currentRevisionId) || activeRevision(project);
    if (revision) revision.chat = chatMessages.slice(-60);
    project.chat = [];
    void saveProject(project);
    return;
  }
  localStorage.setItem(storage.chatHistory, JSON.stringify(chatMessages.slice(-60)));
}

function clearChat() {
  chatMessages = [];
  const project = projectCache.find((item) => item.id === currentProjectId);
  if (project) {
    const revision = project.revisions.find((item) => item.id === currentRevisionId) || activeRevision(project);
    if (revision) revision.chat = [];
    project.chat = [];
    void saveProject(project);
  } else {
    localStorage.removeItem(storage.chatHistory);
  }
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

async function flashInstallManifest(options = {}) {
  ensureFlasher();
  els.installLog.textContent = "";
  els.installGoCode.classList.add("is-hidden");
  await releaseDeviceTransportForInstall();
  const manifest = els.installManifest.value.trim() || "bin/p1e-firmware.json";
  const eraseAll = Boolean(options.eraseAll || els.installClearData?.checked);
  if (eraseAll) {
    const ok = window.confirm("Clear old data erases WiFi, users, projects, and stored scripts before installing. Continue?");
    if (!ok) return;
  }
  els.installProgress.value = 0;
  installStatus("Choose your ESP32 serial port");
  await flasher.flashManifest(manifest, { ...options, eraseAll });
  const hint = normalizeUsbHint(flasher.port?.getInfo?.() || null);
  installStatus("Upload complete. Waiting for board...");
  await flasher.disconnect();
  await settle(eraseAll ? 4500 : 2600);
  await applyInstallSetupAfterUpload(hint);
}

async function refreshInstallManifestInfo() {
  if (!els.installFirmwareVersion) return;
  const manifest = els.installManifest?.value?.trim() || "bin/p1e-firmware.json";
  try {
    const response = await fetch(manifest, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    const name = data.name || "P1E firmware";
    const version = data.version || "unknown";
    els.installFirmwareVersion.textContent = `${name} ${version}`;
  } catch {
    els.installFirmwareVersion.textContent = "Firmware manifest unavailable";
  }
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
  const attempts = 7;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    installStatus(attempt ? `Checking P1E (${attempt + 1}/${attempts})` : "Checking P1E");
    await settle(attempt ? 2200 : 1200);
    const ok = await connectTransport(
      new WebSerialTransport({ storageKey: storage.usbHint }),
      { pickPort: false },
      "usb",
      "USB",
      { quiet: true, lightStartup: true, includeScript: false, startupTimeoutMs: 7000 },
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
    els.installClearData,
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
  if (!els.chatDebugPrompt) return;
  els.chatDebugPrompt.classList.toggle("is-active", enabled);
  els.chatDebugPrompt.title = enabled ? "Download prompt debug: on" : "Download prompt debug: off";
  els.chatDebugPrompt.setAttribute("aria-label", els.chatDebugPrompt.title);
}

function updateChatKeyButton() {
  const hasKey = hasChatApiKey();
  if (!els.chatApiKey) return;
  els.chatApiKey.title = hasKey ? "Clear API key" : "No API key stored";
  els.chatApiKey.setAttribute("aria-label", els.chatApiKey.title);
  els.chatApiKey.textContent = hasKey ? "Clear key" : "No key";
}

function updateChatEnabledState() {
  const hasKey = hasChatApiKey();
  els.chatForm.classList.toggle("is-hidden", !hasKey);
  els.chatInput.disabled = !hasKey || chatBusy;
  els.chatSend.disabled = !hasKey || chatBusy || !els.chatInput.value.trim();
  els.specificationGenerate.disabled = !hasKey || chatBusy || !currentProjectDescription.trim();
  if (els.chatModel) els.chatModel.disabled = chatBusy;
  if (els.chatModelsRefresh) els.chatModelsRefresh.disabled = chatBusy || !hasKey;
  if (els.chatMaxOutputTokens) els.chatMaxOutputTokens.disabled = chatBusy;
  if (els.chatApiKey) els.chatApiKey.disabled = chatBusy || !hasKey;
  if (els.chatApiKeySave) els.chatApiKeySave.disabled = chatBusy;
  if (els.chatKeyShare) els.chatKeyShare.disabled = chatBusy || !hasKey || !cryptoAvailable();
  if (els.chatDebugPrompt) els.chatDebugPrompt.disabled = chatBusy;
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

  els.chatApiKeyInput?.focus();
}

function saveChatApiKey() {
  const apiKey = els.chatApiKeyInput.value.trim();
  if (!apiKey) return;
  if (isEncryptedChatKeyShare(apiKey)) {
    void importEncryptedChatKeyShare(apiKey).catch((error) => logLine("error", error.message || "encrypted key import failed"));
    return;
  }
  localStorage.setItem(storage.chatApiKey, apiKey);
  els.chatApiKeyInput.value = "";
  updateChatKeyButton();
  updateChatEnabledState();
  renderChatTranscript();
  logLine("info", "OpenAI API key stored in this browser");
}

function cryptoAvailable() {
  return Boolean(globalThis.crypto?.subtle && globalThis.crypto?.getRandomValues);
}

function isEncryptedChatKeyShare(text = "") {
  return String(text || "").trim().startsWith("p1e-key:v1:");
}

async function createEncryptedChatKeyShare() {
  if (!cryptoAvailable()) throw new Error("WebCrypto is not available");
  const apiKey = localStorage.getItem(storage.chatApiKey) || "";
  if (!apiKey) throw new Error("No API key stored");
  const password = els.chatKeySharePassword.value;
  if (!password) throw new Error("Enter a share password");
  const days = Math.max(1, Math.min(365, Math.round(Number(els.chatKeyShareDays.value) || 7)));
  els.chatKeyShareDays.value = String(days);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveChatKeyShareCryptoKey(password, salt);
  const payload = {
    apiKey,
    exp: Date.now() + days * 24 * 60 * 60 * 1000,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded));
  const share = {
    v: 1,
    alg: "PBKDF2-SHA256+A256GCM",
    iter: 150000,
    salt: base64UrlEncode(salt),
    iv: base64UrlEncode(iv),
    ct: base64UrlEncode(cipher),
  };
  const token = `p1e-key:v1:${base64UrlEncode(new TextEncoder().encode(JSON.stringify(share)))}`;
  els.chatKeyShareOutput.value = token;
  await navigator.clipboard?.writeText?.(token).catch(() => {});
  logLine("info", `encrypted API key share created / ${days} days`);
}

async function importEncryptedChatKeyShare(token) {
  if (!cryptoAvailable()) throw new Error("WebCrypto is not available");
  const password = window.prompt("Password for encrypted API key");
  if (!password) return;
  const share = parseEncryptedChatKeyShare(token);
  const salt = base64UrlDecode(share.salt);
  const iv = base64UrlDecode(share.iv);
  const cipher = base64UrlDecode(share.ct);
  const key = await deriveChatKeyShareCryptoKey(password, salt, Number(share.iter) || 150000);
  let decrypted;
  try {
    decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  } catch {
    throw new Error("Encrypted key password did not work");
  }
  const payload = JSON.parse(new TextDecoder().decode(decrypted));
  if (!payload?.apiKey || typeof payload.apiKey !== "string") throw new Error("Encrypted key payload is invalid");
  if (Number(payload.exp) && Date.now() > Number(payload.exp)) throw new Error("Encrypted key share has expired");
  localStorage.setItem(storage.chatApiKey, payload.apiKey);
  els.chatApiKeyInput.value = "";
  updateChatKeyButton();
  updateChatEnabledState();
  renderChatTranscript();
  logLine("info", "encrypted OpenAI API key imported");
}

function parseEncryptedChatKeyShare(token) {
  const raw = String(token || "").trim();
  if (!isEncryptedChatKeyShare(raw)) throw new Error("Not a P1E encrypted key share");
  const json = new TextDecoder().decode(base64UrlDecode(raw.slice("p1e-key:v1:".length)));
  const share = JSON.parse(json);
  if (!share || share.v !== 1 || !share.salt || !share.iv || !share.ct) {
    throw new Error("Encrypted key share is invalid");
  }
  return share;
}

async function deriveChatKeyShareCryptoKey(password, salt, iterations = 150000) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function base64UrlEncode(bytes) {
  const chars = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(chars).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(text) {
  const normalized = String(text || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
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
  await replaceEditorFromChat(
    code,
    "chat code applied to editor",
    message.structured?.sketch_name || "",
    message.structured?.circuit_layout || null,
    message.structured?.project_specification || "",
    message.structured?.specification_mode || "",
  );
}

async function runChatCode(index) {
  const message = chatMessages[index];
  const code = message?.structured?.code;
  if (!code) return;
  await runUiAction(async () => {
    const name = message.structured?.sketch_name || "";
    await replaceEditorFromChat(
      code,
      "chat code prepared",
      name,
      message.structured?.circuit_layout || null,
      message.structured?.project_specification || "",
      message.structured?.specification_mode || "",
    );
    await uploadScriptCode(code, { run: true, save: true, name });
    logLine("info", "chat code saved and running");
  }, "uploading");
}

async function replaceEditorFromChat(code, message, name = "", layout = null, specification = "", specificationMode = "") {
  circuitChatLayout = normalizeCircuitLayout(layout);
  const nextSpecification = String(specification || currentProjectDescription || "");
  const nextMode = normalizeSpecificationMode(specificationMode || currentProjectSpecificationMode);
  const current = String(code ?? "");
  await shelveEditorSketchIfNeeded({ incomingCode: current });
  const project = await ensureProjectForWrite({ code: current, nameHint: name });
  const revision = buildRevision({
    name: normalizeSketchName(name) || nextRevisionName(project),
    code: current,
    specification: nextSpecification,
    specificationMode: nextMode,
    circuit: circuitChatLayout,
    source: "generative",
  });
  const previous = activeRevision(project);
  let saved = project;
  let selected = revision;
  if (previous && revisionEquivalent(previous, revision)) {
    selected = previous;
  } else {
    project.revisions.unshift(revision);
    project.activeRevisionId = revision.id;
    saved = await saveProject(project);
  }
  await openProjectRevision(saved, selected, { saveCurrent: false });
  updateCircuitView(circuitChatLayout ? "chat layout + code inference" : "inferred from code");
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
      await replaceEditorFromChat(
        result.code,
        "chat code replaced editor",
        result.sketch_name,
        result.circuit_layout,
        result.project_specification,
        result.specification_mode,
      );
    } else if (result.circuit_layout) {
      circuitChatLayout = result.circuit_layout;
      updateCircuitView("chat layout + code inference");
    }
    if (result.project_specification) setProjectSpecification(result.project_specification, result.specification_mode);
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

async function generateCodeFromSpecification() {
  const specification = readSpecificationMarkdown().trim();
  if (!specification || chatBusy || !hasChatApiKey()) return;

  chatBusy = true;
  updateChatEnabledState();
  try {
    const result = await requestChatCompletion(buildSpecificationGeneratePrompt(specification), {
      purpose: "specification",
      specification,
      specificationMode: currentProjectSpecificationMode,
    });
    if (result.project_specification) setProjectSpecification(result.project_specification, result.specification_mode);
    if (result.code.trim()) {
      const name = result.sketch_name || "";
      await replaceEditorFromChat(
        result.code,
        "generated code from specification",
        name,
        result.circuit_layout,
        result.project_specification || specification,
        result.specification_mode || currentProjectSpecificationMode,
      );
      if (isDeviceConnected()) {
        await uploadScriptCode(result.code, { run: true, save: true, name });
        logLine("info", "generated code deployed");
      } else {
        logLine("info", "generated code ready; connect to deploy");
      }
    } else {
      logLine("warn", "specification generate returned no code");
    }
    chatMessages.push({
      role: "assistant",
      content: result.reply || "Generated from specification.",
      structured: result,
      at: new Date().toISOString(),
    });
    saveChatHistory();
    renderChatTranscript();
  } catch (error) {
    chatMessages.push({ role: "error", content: error.message || String(error), at: new Date().toISOString() });
    saveChatHistory();
    renderChatTranscript();
  } finally {
    chatBusy = false;
    updateChatEnabledState();
  }
}

function buildSpecificationGeneratePrompt(specification) {
  return [
    "Specification Generate mode.",
    "Update the current code to match the specification.",
    "Generate a complete P1E Wrench script from the project specification below.",
    "The specification is the source of truth. Existing editor code is only a starting point or reusable material.",
    "If the existing code conflicts with the specification, change the code to match the specification.",
    "Return code_action=\"replace\" and provide complete replacement code.",
    "Also return an updated project_specification that preserves the user's intent and accurately describes the generated code.",
    "",
    `Specification mode: ${specificationModeLabel(currentProjectSpecificationMode)}`,
    "",
    "Project specification:",
    specification,
  ].join("\n");
}

async function requestChatCompletion(prompt, options = {}) {
  const apiKey = localStorage.getItem(storage.chatApiKey) || "";
  const model = els.chatModel.value || defaultChatModel;
  const context = await getWrenchChatContext();
  const purpose = options.purpose || "chat";
  const activeProject = projectCache.find((item) => item.id === currentProjectId) || null;
  const activeProjectRevision = activeRevision(activeProject);
  const rawRevisionName = normalizeSketchName(currentSketchName || activeProjectRevision?.name || "");
  const currentRevisionName = isGenericRevisionName(rawRevisionName) ? "" : rawRevisionName;
  const namingContext = {
    projectName: normalizeProjectName(activeProject?.name || ""),
    currentRevisionName,
    suggestedSmallIterationName: currentRevisionName
      ? nextNamedRevisionName(activeProject, currentRevisionName)
      : "choose a short descriptive name",
    maxNameChars: 32,
    rule: "Small iterations keep the current base name and increment the trailing number. Larger reframings may use a new short descriptive name.",
  };
  const conversation = purpose === "specification" ? [] : chatMessages.slice(-chatHistoryLimit).map((message) => ({
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
    projectSpecification: options.specification ?? currentProjectDescription,
    specificationMode: normalizeSpecificationMode(options.specificationMode || currentProjectSpecificationMode),
    naming: namingContext,
    purpose,
    conversation,
  };
  const instructions = buildChatInstructions(context);
  const userInputText = [
    buildInteractionPriorityInstructions(payloadContext.purpose),
    [
      "Current project naming:",
      `Project: ${namingContext.projectName || "(untitled project)"}`,
      `Current revision: ${namingContext.currentRevisionName || "(unnamed revision)"}`,
      `Suggested name for a small iteration: ${namingContext.suggestedSmallIterationName}`,
      `Maximum sketch_name length: ${namingContext.maxNameChars} characters`,
    ].join("\n"),
    `User request:\n${prompt}`,
    `Current project specification mode:\n${specificationModeLabel(payloadContext.specificationMode)}\n${specificationModePrompt(payloadContext.specificationMode)}`,
    `Current project specification:\n${payloadContext.projectSpecification || "(empty)"}`,
    payloadContext.purpose === "specification"
      ? `Current code to revise. Keep useful structure, names, pins, and working behavior only when they do not conflict with the specification:\n${payloadContext.currentCode || "(empty)"}`
      : "",
    `P1E context JSON:\n${JSON.stringify(payloadContext)}`,
  ].filter(Boolean).join("\n\n");

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
    max_output_tokens: chatMaxOutputTokens(),
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

function buildInteractionPriorityInstructions(purpose = "chat") {
  if (purpose === "specification") {
    return [
      "Interaction mode: Specification Generate.",
      "Main task: update the current code to match the specification.",
      "Priority order:",
      "1. The current project specification is the dominant source of truth.",
      "2. Current editor code is the implementation base to revise, not an equal source of intent.",
      "3. Preserve useful existing code structure, names, pins, and stable behavior only when it does not conflict with the specification.",
      "4. If current code conflicts with the specification, change the code to satisfy the specification.",
      "5. Ignore previous chat for intent; it is not included as authority in this mode.",
      "Output requirement: return code_action=\"replace\" with complete code unless the specification is impossible to implement.",
      "The returned project_specification should refine and clarify the specification, not silently change its intent to match old code.",
    ].join("\n");
  }
  return [
    "Interaction mode: Chat.",
    "Priority order:",
    "1. The newest user request is the dominant instruction.",
    "2. Current editor code and current specification are context to edit from.",
    "3. If the user asks for a code change, adjust the code to follow the chat request and update project_specification to match the resulting code.",
    "4. If the user asks only a question, use code_action=\"none\" and keep project_specification unchanged unless an explicit clarification is useful.",
  ].join("\n");
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
    "Respect the interaction-mode priority rules in the user input. They define whether chat request or project specification is the source of truth.",
    "When producing code, provide a complete Wrench script that can replace the editor contents.",
    "Every generated sketch must start with a short // comment explaining what the sketch does.",
    "When producing code, also provide sketch_name: a short project revision title, 2-5 words and at most 32 characters.",
    "Naming rule: for small iterations, keep the current revision base name and increment its trailing number, such as LED Chase -> LED Chase 2 -> LED Chase 3. For larger reframings, choose a new short descriptive name. Do not invent a random unrelated name when the current name still describes the work. Avoid dates, New Sketch, generic Revision names, and decorative punctuation.",
    "When producing or changing code, also provide project_specification as simple Markdown that matches the resulting code and follows the requested specification_mode.",
    "Use only this Markdown subset in project_specification: # through #### headings, **bold**, *italic*, <u>underline</u>, numbered lists, and bullet lists.",
    "Specification modes: overview means high-level human description; middle means important implementation details without pseudocode; structured means sections like Program, Global values, Setup, and Main loop in Markdown/plain text.",
    "Also provide circuit_layout: a best-effort JSON layout for the Circuit view with components, connections, assumptions, and notes. Use an empty object if no hardware is involved.",
    "GPIO rule: pinMode uses firmware constants such as INPUT, OUTPUT, INPUT_PULLUP, and INPUT_PULLDOWN when available. Write pinMode(powerPin, OUTPUT), never pinMode(powerPin, \"OUTPUT\"). digitalWrite should use HIGH/LOW if available or 1/0, never string values.",
    "Declare scratch variables at the top of each function and assign them inside while/if blocks. Avoid new var declarations inside tight loops or nested blocks, especially LED render loops.",
    "When the user asks for a live interface, dashboard, or controls, use the documented firmware-driven UI bindings in a Guino-style lifecycle: declare the interface in a drawUi() function from setup() and on hello, read slider/toggle state with uiGet(), use while (uiPoll()) plus uiEventIs(type, id) for buttons and hello redraw events, update ordinary values with uiUpdate(), and stream every graph/sample with uiPush(). Do not call uiBegin() after every control change.",
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
      project_specification: { type: "string" },
      specification_mode: { type: "string", enum: ["overview", "middle", "structured"] },
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
    required: ["reply", "code", "code_action", "sketch_name", "project_specification", "specification_mode", "notes", "warnings", "circuit_layout"],
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
    return {
      reply: raw,
      code: "",
      code_action: "none",
      sketch_name: "",
      project_specification: "",
      specification_mode: currentProjectSpecificationMode,
      notes: [],
      warnings: ["Response was not structured JSON."],
      circuit_layout: null,
    };
  }

  return {
    reply: String(parsed.reply || ""),
    code: String(parsed.code || ""),
    code_action: parsed.code_action === "replace" ? "replace" : "none",
    sketch_name: normalizeSketchName(parsed.sketch_name || parsed.name || parsed.title || ""),
    project_specification: String(parsed.project_specification || parsed.specification || parsed.description || ""),
    specification_mode: normalizeSpecificationMode(parsed.specification_mode || parsed.descriptionMode || currentProjectSpecificationMode),
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
  els.chatDownloadCode.disabled = els.downloadCode.disabled;
  [
    els.getScript,
    els.reboot,
    els.run,
    els.stop,
    els.chatRun,
    els.chatStop,
    els.settings,
    els.deviceNameSave,
    els.wifiSave,
    els.raw,
    els.rawSend,
  ].forEach((el) => {
    el.disabled = !connected || isBusy;
  });
  [els.newSketch, els.chatNewSketch].forEach((button) => {
    button.disabled = isBusy;
  });
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
