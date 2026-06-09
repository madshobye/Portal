import { createDeviceShellRegistry } from "./device-shell-registry.js?v=0.1.87-ui728";
import {
  eventLogLevel as eventLogLevelFor,
  eventMessage as eventMessageFor,
  mergeStatusSnapshot as mergeStatusSnapshotFor,
  nextScriptErrorReport,
} from "./event-status-model.js?v=0.1.87-ui728";
import { setSelectValueOrFallback } from "./settings-fields.js?v=0.1.87-ui728";
import {
  memoryStatusLabel as memoryStatusLabelFor,
  scriptStatusLabel as scriptStatusLabelFor,
  transportProtocolLabel as transportProtocolLabelFor,
  wifiStatusLabel as wifiStatusLabelFor,
  wrenchFpsLabel as wrenchFpsLabelFor,
} from "./status-model.js?v=0.1.87-ui728";
import { parseWrenchErrorLocation } from "./wrench-error-locator.js?v=0.1.87-ui728";

export function createDeviceFeatureRegistry({
  documentRef,
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
  setBusy,
  setBusyLabel,
  setLastConfig,
  setLastInfo,
  setLastLoggedScriptErrorCount,
  setLastStatus,
  storage,
  windowRef,
} = {}) {
  let deviceShellRegistry = null;

  function lastInfo() {
    return getLastInfo?.() || null;
  }

  function lastStatus() {
    return getLastStatus?.() || null;
  }

  function transport() {
    return getTransport?.() || null;
  }

  function isScriptRunning() {
    return String(lastStatus()?.scriptState || "").toLowerCase() === "running";
  }

  function getDeviceShellRegistry() {
    if (deviceShellRegistry) return deviceShellRegistry;
    deviceShellRegistry = createDeviceShellRegistry({
      connectionDeviceLabel: () => lastInfo()?.deviceName || lastStatus()?.deviceName || transport()?.label || "device",
      documentRef,
      eventLogLevel: eventLogLevelFor,
      eventMessage: eventMessageFor,
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
      memoryStatusLabel: () => memoryStatusLabelFor({ lastStatus: lastStatus(), lastInfo: lastInfo() }),
      mergeStatusSnapshot: mergeStatusSnapshotFor,
      nextScriptErrorReport,
      parseWrenchErrorLocation,
      scriptStatusLabel: () => scriptStatusLabelFor(lastStatus()),
      setBusy,
      setBusyLabel,
      setLastConfig,
      setLastInfo,
      setLastLoggedScriptErrorCount,
      setLastStatus,
      setTimezoneSelectValue: (value) => setSelectValueOrFallback(fields.timezoneInput, value, "UTC0"),
      statusFpsLabel: () => wrenchFpsLabelFor(lastStatus(), isScriptRunning()),
      storage,
      transportProtocolLabel: () => transportProtocolLabelFor(transport()?.kind, { isMqttKind, isWebRtcKind }),
      wifiStatusLabel: () => wifiStatusLabelFor(lastStatus()),
      windowRef,
    });
    return deviceShellRegistry;
  }

  return {
    getConnectionStatusRenderer: () => getDeviceShellRegistry().getConnectionStatusRenderer(),
    getConnectionUiStateController: () => getDeviceShellRegistry().getConnectionUiStateController(),
    getDeviceRefreshService: () => getDeviceShellRegistry().getDeviceRefreshService(),
    getDeviceShellRegistry,
    getDeviceStateController: () => getDeviceShellRegistry().getDeviceStateController(),
    getEventLogFilter: () => getDeviceShellRegistry().getEventLogFilter(),
    getUiActionRunner: () => getDeviceShellRegistry().getUiActionRunner(),
    getUiEnabledStateController: () => getDeviceShellRegistry().getUiEnabledStateController(),
    getUploadStatusController: () => getDeviceShellRegistry().getUploadStatusController(),
  };
}
