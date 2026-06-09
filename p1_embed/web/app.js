import { MQTT_WEBRTC_TRANSPORT_VERSION } from "./protocol/MqttWebRtcTransport.js?v=0.1.87-ui348";
import { MQTT_TRANSPORT_VERSION } from "./protocol/MqttTransport.js?v=0.1.87-ui349";
import { renderProjectControlClusters } from "./ide-toolbar.js?v=0.1.87-ui729";
import { createDomRefs } from "./dom-refs.js?v=0.1.87-ui729";
import { createAppState } from "./app-state.js?v=0.1.87-ui729";
import { createAppControllerAccessors } from "./app-controller-accessors.js?v=0.1.87-ui729";
import { createAppRegistries } from "./app-registry-factory.js?v=0.1.87-ui729";
import { migrateLegacyBrowserStorage, product } from "./app-config.js?v=0.1.87-ui729";

const WEB_UI_VERSION = "0.1.87-ui729";
console.info(`[${product.logLabel}] loaded ${WEB_UI_VERSION}`, { mqtt: MQTT_TRANSPORT_VERSION, mqttWebRtc: MQTT_WEBRTC_TRANSPORT_VERSION });

const narrowGenerativeQuery = window.matchMedia?.("(max-width: 760px)");

migrateLegacyBrowserStorage(localStorage);
renderProjectControlClusters();

const els = createDomRefs(document);

const { chatState, connectionState, projectState } = createAppState();
let circuitView = null;
let appAccessors = null;

const appRegistries = createAppRegistries({
  chatState,
  connectionIntentWanted,
  connectionState,
  documentRef: document,
  fields: els,
  fetchRef: (...args) => fetch(...args),
  getAccessors: () => appAccessors,
  getCircuitView: () => circuitView,
  localStorageRef: localStorage,
  markConnectionAttemptFailed,
  markConnectionAttemptStarted,
  mqttVersion: MQTT_TRANSPORT_VERSION,
  narrowGenerativeQuery,
  navigatorRef: navigator,
  projectState,
  requestAnimationFrameRef: requestAnimationFrame,
  setCircuitView: (value) => {
    circuitView = value;
  },
  setConnectionIntentWanted,
  updateViewportHeight,
  URLRef: URL,
  webVersion: WEB_UI_VERSION,
  windowRef: window,
});

const {
  getAppBootstrapController,
  getAppControlBindingsController,
  getBoardDownloadService,
  getChatCompletionService,
  getChatCredentialActions,
  getChatCredentials,
  getChatSettings,
  getChatShellController,
  getChatTranscript,
  getChatWorkflowController,
  getCircuitEditorActions,
  getCircuitShellController,
  getCircuitWorkspaceController,
  getCodeEditorShellController,
  getCommandConsoleService,
  getConnectionAddressService,
  getConnectionDialogController,
  getConnectionDialogStateController,
  getConnectionEntryController,
  getConnectionHistoryActions,
  getConnectionHistoryStore,
  getConnectionIntentStore,
  getConnectionMemoryService,
  getConnectionReconnectService,
  getConnectionShellController,
  getConnectionStartupService,
  getConnectionStatusRenderer,
  getConnectionTransportSession,
  getConnectionUiStateController,
  getConnectionUrlManager,
  getConsoleController,
  getConsolePreferences,
  getCurrentRevisionSession,
  getDeviceRefreshService,
  getDeviceSettingsController,
  getDeviceShellRegistry,
  getDeviceStateController,
  getEventLogFilter,
  getFirmwareUpdateController,
  getGenerativePanelController,
  getGuinoController,
  getGuinoShellService,
  getInfoGuinoRegistry,
  getInfoPanelController,
  getInfoPanelRenderer,
  getInstallFirmwareRegistry,
  getInstallPanelController,
  getInstallWorkflowController,
  getLegacyProjectMigrationService,
  getLowerPanelController,
  getMqttSettingsPanelController,
  getMqttShellService,
  getMqttSigninDialogController,
  getOnlineAuthListRenderer,
  getPageLifecycleController,
  getProjectActionsController,
  getProjectController,
  getProjectDedupeService,
  getProjectDownloadService,
  getProjectHistoryView,
  getProjectImporter,
  getProjectLibraryService,
  getProjectRevisionService,
  getProjectSchemaMigrationService,
  getProjectStore,
  getProjectToolbarController,
  getRevisionDraftStore,
  getRevisionNameDialog,
  getScriptDownloadService,
  getScriptUploadService,
  getSettingsDeviceRegistry,
  getSettingsShellController,
  getSettingsTabs,
  getSpecificationEditorController,
  getStartupStepRunner,
  getStorageDiagnostics,
  getUiActionRunner,
  getUiEnabledStateController,
  getUploadStatusController,
  getViewRouting,
  getViewShellController,
  getWifiNetworkListRenderer,
  projectSelectControls,
  projectToolbars,
  revisionSelectControls,
  scriptToolbars,
  workspaceToolbars,
} = appAccessors = createAppControllerAccessors({
  ...appRegistries,
  getClient: () => connectionState.client,
});

boot();

function connectionIntentWanted() {
  return getConnectionIntentStore().wanted();
}

function setConnectionIntentWanted(wanted) {
  getConnectionIntentStore().setWanted(wanted);
}

function markConnectionAttemptStarted() {
  setConnectionIntentWanted(true);
  connectionState.reconnectAfterReturn = false;
  connectionState.reconnectAfterReturnAttempted = false;
}

function markConnectionAttemptFailed() {
  setConnectionIntentWanted(false);
  connectionState.reconnectAfterReturn = false;
  connectionState.reconnectAfterReturnAttempted = false;
}

function boot() {
  getAppBootstrapController().boot();
}

function bindLifecycle() {
  getPageLifecycleController().bind();
}

function updateViewportHeight() {
  getPageLifecycleController().updateViewportHeight();
}

function recoverReturnedConnection() {
  getPageLifecycleController().recoverReturnedConnection();
}
