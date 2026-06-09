import { createConnectionStatusRenderer } from "./connection-status-renderer.js?v=0.1.87-ui725";
import { createUiEnabledStateController } from "./ui-enabled-state-controller.js?v=0.1.87-ui725";
import { createConnectionUiStateController } from "./connection-ui-state-controller.js?v=0.1.87-ui725";
import { createUiActionRunner } from "./ui-action-runner.js?v=0.1.87-ui725";
import { createDeviceRefreshService } from "./device-refresh-service.js?v=0.1.87-ui725";
import { createUploadStatusController } from "./upload-status-controller.js?v=0.1.87-ui725";
import { createEventLogFilter } from "./event-status-model.js?v=0.1.87-ui725";
import { createDeviceStateController } from "./device-state-controller.js?v=0.1.87-ui725";

export function createDeviceShellRegistry({
  connectionDeviceLabel,
  documentRef,
  eventLogLevel,
  eventMessage,
  fields,
  getBusyLabel,
  getChatShellController,
  getClient,
  getCodeEditorShellController,
  getCommandConsoleService,
  getConnectionShellController,
  getConnectionVerified,
  getConsoleController,
  getFirmwareUpdateController,
  getGuinoController,
  getInfoPanelController,
  getInstallWorkflowController,
  getLastConfig,
  getLastInfo,
  getLastLoggedScriptErrorCount,
  getLastStatus,
  getMqttSettingsPanelController,
  getMqttShellService,
  getProjectToolbarController,
  getTransport,
  getWifiDraftDirty,
  getWifiNetworkListRenderer,
  isBusy,
  isMqttKind,
  isWebRtcKind,
  localStorageRef,
  memoryStatusLabel,
  mergeStatusSnapshot,
  nextScriptErrorReport,
  parseWrenchErrorLocation,
  scriptStatusLabel,
  setBusy,
  setBusyLabel,
  setLastConfig,
  setLastInfo,
  setLastLoggedScriptErrorCount,
  setLastStatus,
  setTimezoneSelectValue,
  statusFpsLabel,
  storage,
  transportProtocolLabel,
  wifiStatusLabel,
  windowRef,
} = {}) {
  let connectionStatusRenderer = null;
  let uiEnabledStateController = null;
  let connectionUiStateController = null;
  let uiActionRunner = null;
  let deviceRefreshService = null;
  let uploadStatusController = null;
  let eventLogFilter = null;
  let deviceStateController = null;

  function getConnectionStatusRenderer() {
    if (connectionStatusRenderer) return connectionStatusRenderer;
    connectionStatusRenderer = createConnectionStatusRenderer({
      connection: fields.connection,
      getClient,
      getTransport: () => {
        const transport = getTransport();
        return transport ? { ...transport, verified: getConnectionVerified() } : null;
      },
      isBusy,
      getBusyLabel,
      connectionDeviceLabel,
      transportProtocolLabel,
      scriptStatusLabel,
      statusFpsLabel,
      wifiStatusLabel,
      memoryStatusLabel,
    });
    return connectionStatusRenderer;
  }

  function getUiEnabledStateController() {
    if (uiEnabledStateController) return uiEnabledStateController;
    uiEnabledStateController = createUiEnabledStateController({
      fields,
      getProjectToolbarController,
      getEditorValue: () => getCodeEditorShellController().getValue(),
      isDeviceConnected: () => getConnectionUiStateController().isDeviceConnected(),
      hasClient: () => Boolean(getClient()),
      hasTransport: () => Boolean(getTransport()),
      isBusy,
      syncGuinoConnectionState: () => getConnectionUiStateController().syncGuinoConnectionState(),
      renderWifiNetworkList: () => getConnectionUiStateController().renderWifiNetworkList(),
      updateChatEnabledState: () => getChatShellController().updateChatEnabledState(),
      renderConnectionHistory: () => getConnectionShellController().renderConnectionHistory(),
      renderConnectionState: (transportState = "") => getConnectionUiStateController().renderConnectionState(transportState),
      updateInstallEnabledState: () => getInstallWorkflowController().updateInstallEnabledState(),
      renderFirmwareUpdatePanel: () => getFirmwareUpdateController().renderFirmwareUpdatePanel(),
    });
    return uiEnabledStateController;
  }

  function getConnectionUiStateController() {
    if (connectionUiStateController) return connectionUiStateController;
    connectionUiStateController = createConnectionUiStateController({
      fields,
      getClient,
      getTransport,
      getConnectionVerified,
      getLastConfig,
      getWifiNetworkListRenderer,
      getInfoPanelController,
      getConnectionStatusRenderer,
      getUiEnabledStateController,
      getConnectionShellController,
      getGuinoController,
    });
    return connectionUiStateController;
  }

  function getUiActionRunner() {
    if (uiActionRunner) return uiActionRunner;
    uiActionRunner = createUiActionRunner({
      getBusy: isBusy,
      setBusy,
      getBusyLabel,
      setBusyLabel,
      updateEnabledState: () => getConnectionUiStateController().updateEnabledState(),
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return uiActionRunner;
  }

  function getDeviceRefreshService() {
    if (deviceRefreshService) return deviceRefreshService;
    deviceRefreshService = createDeviceRefreshService({
      windowRef,
      getClient,
      getTransport,
      isBusy,
      sendCommand: (...args) => getCommandConsoleService().sendCommand(...args),
      setLastInfo,
      updateStatus: (status = {}) => getDeviceStateController().updateStatus(status),
      renderFields: () => getConnectionUiStateController().renderFields(),
    });
    return deviceRefreshService;
  }

  function getUploadStatusController() {
    if (uploadStatusController) return uploadStatusController;
    uploadStatusController = createUploadStatusController({
      statusRows: [
        [fields.uploadStatus, fields.uploadStatusLabel, fields.uploadStatusProgress],
        [fields.chatUploadStatus, fields.chatUploadStatusLabel, fields.chatUploadStatusProgress],
      ],
      setRunWorking: (working) => getProjectToolbarController().setRunWorking(working),
    });
    return uploadStatusController;
  }

  function getEventLogFilter() {
    if (eventLogFilter) return eventLogFilter;
    eventLogFilter = createEventLogFilter({ getBusyLabel });
    return eventLogFilter;
  }

  function getDeviceStateController() {
    if (deviceStateController) return deviceStateController;
    deviceStateController = createDeviceStateController({
      fields,
      documentRef,
      storage,
      storageArea: localStorageRef,
      getLastInfo,
      setLastInfo,
      getLastStatus,
      setLastStatus,
      getLastConfig,
      setLastConfig,
      getLastLoggedScriptErrorCount,
      setLastLoggedScriptErrorCount,
      getWifiDraftDirty,
      getEditorValue: () => getCodeEditorShellController().getValue(),
      getCodeView: () => getCodeEditorShellController().view(),
      getGuinoController,
      getUploadStatusController,
      getEventLogFilter,
      logLine: (level, message) => getConsoleController().logLine(level, message),
      renderConnectionState: (transportState = "") => getConnectionUiStateController().renderConnectionState(transportState),
      renderFields: () => getConnectionUiStateController().renderFields(),
      renderWifiNetworkList: () => getConnectionUiStateController().renderWifiNetworkList(),
      populateMqttSettings: () => getMqttSettingsPanelController().populate(),
      setTimezoneSelectValue,
      parseWrenchErrorLocation,
      storeMqttConfigFields: (config = {}) => getMqttShellService().storeConfigFields(config),
      eventLogLevel,
      eventMessage,
      mergeStatusSnapshot,
      nextScriptErrorReport,
    });
    return deviceStateController;
  }

  return {
    getConnectionStatusRenderer,
    getConnectionUiStateController,
    getDeviceRefreshService,
    getDeviceStateController,
    getEventLogFilter,
    getUiActionRunner,
    getUiEnabledStateController,
    getUploadStatusController,
  };
}
