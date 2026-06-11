export const CHAT_DEFAULT_MAX_OUTPUT_TOKENS = 8000;
export const CHAT_MIN_MAX_OUTPUT_TOKENS = 1024;
export const CHAT_HARD_MAX_OUTPUT_TOKENS = 32000;
export const ALPHA_ENABLE_WEBSOCKET_CONNECT = false;
export const ALPHA_ENABLE_WEBRTC_CONNECT = false;

export const product = {
  name: "XOBIT",
  firmwareName: "xobit",
  boardLabel: "XOBIT board",
  logLabel: "XOBIT web",
  mqttLogLabel: "XOBIT mqtt",
  mqttTopicPrefix: "xobit",
  mqttClientPrefix: "xobit",
  deviceIdPrefix: "xobit",
  legacyDeviceIdPrefix: "p1-embed",
  circuitCommentPrefix: "xobit-circuit",
  legacyCircuitCommentPrefix: "p1e-circuit",
  keySharePrefix: "xobit-key:v1:",
  legacyKeySharePrefix: "p1e-key:v1:",
};

export const defaultCode = `function setup() {
  pinMode(2, 1);
  println("XOBIT ready");
}

function loop() {
  digitalWrite(2, 1);
  delay(120);
  digitalWrite(2, 0);
  delay(880);
}`;

const browserStorageNamespace = "xobit";
const legacyBrowserStorageNamespace = "p1_embed";

function storageKey(namespace, suffix) {
  return `${namespace}.${suffix}`;
}

function makeStorage(namespace) {
  return {
    code: storageKey(namespace, "editor.code"),
    wsUrl: storageKey(namespace, "websocket.url"),
    wsName: storageKey(namespace, "websocket.name"),
    wsHistory: storageKey(namespace, "websocket.history"),
    peerId: storageKey(namespace, "peerjs.remoteId"),
    peerHistory: storageKey(namespace, "peerjs.history"),
    mqttHost: storageKey(namespace, "mqtt.host"),
    mqttPort: storageKey(namespace, "mqtt.port"),
    mqttRoot: storageKey(namespace, "mqtt.root.v2"),
    mqttUser: storageKey(namespace, "mqtt.user"),
    mqttPassword: storageKey(namespace, "mqtt.password"),
    usbHint: storageKey(namespace, "serial.hint"),
    usbHistory: storageKey(namespace, "serial.history"),
    lastConnection: storageKey(namespace, "connection.last"),
    connectionIntent: storageKey(namespace, "connection.intent"),
    reconnectOnLoad: storageKey(namespace, "connection.reconnectOnLoad"),
    activeTab: storageKey(namespace, "workspace.activeTab"),
    logLevel: storageKey(namespace, "console.logLevel"),
    consoleTimestamps: storageKey(namespace, "console.timestamps"),
    sketchHistory: storageKey(namespace, "editor.history"),
    projectId: storageKey(namespace, "project.activeId"),
    projectSchemaMigration: storageKey(namespace, "project.schemaMigrated"),
    projectFallback: storageKey(namespace, "project.fallback"),
    chatApiKey: storageKey(namespace, "chat.apiKey"),
    chatModel: storageKey(namespace, "chat.model"),
    chatModelList: storageKey(namespace, "chat.modelList"),
    chatMaxOutputTokens: storageKey(namespace, "chat.maxOutputTokens"),
    chatHistory: storageKey(namespace, "chat.history"),
    chatDebugPrompt: storageKey(namespace, "chat.debugPrompt"),
    specificationDraft: storageKey(namespace, "project.specificationDraft"),
    revisionDraft: storageKey(namespace, "project.revisionDraft"),
    specificationMode: storageKey(namespace, "project.specificationMode"),
    appTheme: storageKey(namespace, "app.theme"),
    circuitArtMode: storageKey(namespace, "circuit.artMode"),
    circuitRoutingMode: storageKey(namespace, "circuit.routingMode"),
    circuitBoardType: storageKey(namespace, "circuit.boardType"),
  };
}

export const storage = makeStorage(browserStorageNamespace);
export const legacyStorage = makeStorage(legacyBrowserStorageNamespace);

function migrateLegacyTextValue(value) {
  return String(value || "")
    .replace(/\bp1-embed-([0-9a-f]{6})\b/ig, `${product.deviceIdPrefix}-$1`)
    .replace(/\bP1\.E\b/g, product.name)
    .replace(/\bP1E\b/g, product.name);
}

export function migrateLegacyBrowserStorage(storageArea = globalThis.localStorage) {
  if (!storageArea) return;
  const marker = storageKey(browserStorageNamespace, "migration.p1eToXobit.v1");
  try {
    if (storageArea.getItem(marker) === "done") return;
    for (const key of Object.keys(storage)) {
      const nextKey = storage[key];
      const oldKey = legacyStorage[key];
      if (!nextKey || !oldKey || storageArea.getItem(nextKey) !== null) continue;
      const oldValue = storageArea.getItem(oldKey);
      if (oldValue !== null) {
        const migrated = ["peerId", "mqttRoot", "wsUrl", "wsName"].includes(key) ? migrateLegacyTextValue(oldValue) : oldValue;
        storageArea.setItem(nextKey, migrated);
      }
    }
    storageArea.setItem(marker, "done");
  } catch {
    // Storage may be unavailable in private browser contexts.
  }
};

export const builtInChatModelOptions = [
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

export const defaultChatModel = "gpt-5.4-mini";
export const chatHistoryLimit = 15;
export const sketchHistoryLimit = 50;
export const projectLimit = 80;
export const connectionHistoryLimit = 12;
// Kept for browser project-history continuity. Do not rename without an IndexedDB migration.
export const sketchDbName = "p1_embed";
export const sketchDbVersion = 2;
export const sketchStoreName = "sketch_history";
export const projectStoreName = "projects";
export const projectSchemaMigrationVersion = "2";
export const legacySketchMigrationId = "sketch-history-to-projects";
export const legacySketchMigrationVersion = "2";
export const revisionDraftVersion = "2";
