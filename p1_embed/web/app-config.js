export const CHAT_DEFAULT_MAX_OUTPUT_TOKENS = 8000;
export const CHAT_MIN_MAX_OUTPUT_TOKENS = 1024;
export const CHAT_HARD_MAX_OUTPUT_TOKENS = 32000;
export const ALPHA_ENABLE_WEBSOCKET_CONNECT = false;
export const ALPHA_ENABLE_WEBRTC_CONNECT = false;

export const defaultCode = `function setup() {
  pinMode(2, 1);
  println("p1_embed ready");
}

function loop() {
  digitalWrite(2, 1);
  delay(120);
  digitalWrite(2, 0);
  delay(880);
}`;

export const storage = {
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
  connectionIntent: "p1_embed.connection.intent",
  reconnectOnLoad: "p1_embed.connection.reconnectOnLoad",
  activeTab: "p1_embed.workspace.activeTab",
  logLevel: "p1_embed.console.logLevel",
  consoleTimestamps: "p1_embed.console.timestamps",
  sketchHistory: "p1_embed.editor.history",
  projectId: "p1_embed.project.activeId",
  projectSchemaMigration: "p1_embed.project.schemaMigrated",
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
  editorTheme: "p1_embed.editor.theme",
  circuitArtMode: "p1_embed.circuit.artMode",
  circuitRoutingMode: "p1_embed.circuit.routingMode",
  circuitBoardType: "p1_embed.circuit.boardType",
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
export const sketchDbName = "p1_embed";
export const sketchDbVersion = 2;
export const sketchStoreName = "sketch_history";
export const projectStoreName = "projects";
export const projectSchemaMigrationVersion = "2";
export const legacySketchMigrationId = "sketch-history-to-projects";
export const legacySketchMigrationVersion = "2";
export const revisionDraftVersion = "2";
