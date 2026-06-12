import { createGuinoController } from "./guino-controller.js?v=0.1.87-ui749";
import { createGuinoShellService } from "./guino-shell-service.js?v=0.1.87-ui749";
import { createInfoPanelRenderer } from "./info-panel-renderer.js?v=0.1.87-ui749";
import { createInfoPanelController } from "./info-panel-controller.js?v=0.1.87-ui749";

export function createInfoGuinoRegistry({
  activePeerId,
  brandVersion,
  connectMqtt,
  connectWebSocket,
  copyText,
  fields,
  formatDuration,
  getClient,
  getCommandConsoleService,
  getConnectionAddressService,
  getConnectionShellController,
  getConnectionUiStateController,
  getConsoleController,
  getDeviceStateController,
  getFirmwareUpdateController,
  getLastConfig,
  getLastInfo,
  getLastStatus,
  getPeerInputValue,
  getScriptStateText,
  getTransport,
  getWebRtcPeerId,
  getWebSocketUrl,
  isMqttKind,
  isScriptRunning,
  isWebRtcKind,
  memoryStatusLabel,
  mqttSharePeerId,
  normalizePeerId,
  onGuinoAvailabilityChange,
  scriptRuntimeLabel,
  scriptStatusLabel,
  sharePageUrl,
  uiCanvas,
  webVersion,
  wifiSignalLabel,
  wrenchFpsLabel,
} = {}) {
  let guinoController = null;
  let guinoShellService = null;
  let infoPanelRenderer = null;
  let infoPanelController = null;

  function getGuinoController() {
    if (guinoController) return guinoController;
    guinoController = createGuinoController({
      canvas: uiCanvas,
      isConnected: () => getConnectionUiStateController().isDeviceConnected(),
      sendCommand: (...args) => getCommandConsoleService().sendCommand(...args),
      logLine: (level, message) => getConsoleController().logLine(level, message),
      onAvailabilityChange: onGuinoAvailabilityChange,
    });
    return guinoController;
  }

  function getGuinoShellService() {
    if (guinoShellService) return guinoShellService;
    guinoShellService = createGuinoShellService({
      getTransport,
      getPeerInputValue,
      getWebRtcPeerId,
      getWebSocketUrl,
      getLastConfig,
      getClient,
      isDeviceConnected: () => getConnectionUiStateController().isDeviceConnected(),
      normalizePeerId,
      isMqttKind,
      isWebRtcKind,
      readUsbHint: () => getConnectionAddressService().readUsbHint(),
      sharePageUrl,
      sendCommand: (...args) => getCommandConsoleService().sendCommand(...args),
      updateConfig: (config = {}) => getDeviceStateController().updateConfig(config),
      copyText,
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return guinoShellService;
  }

  function getInfoPanelRenderer() {
    if (infoPanelRenderer) return infoPanelRenderer;
    infoPanelRenderer = createInfoPanelRenderer({
      fields,
      brandVersion,
      connectMqtt,
      connectWebSocket,
    });
    return infoPanelRenderer;
  }

  function getInfoPanelController() {
    if (infoPanelController) return infoPanelController;
    infoPanelController = createInfoPanelController({
      renderer: getInfoPanelRenderer(),
      webVersion,
      getLastInfo,
      getLastStatus,
      getLastConfig,
      getScriptStateText,
      hasClient: () => Boolean(getClient()),
      getTransport,
      readUsbHint: () => getConnectionAddressService().readUsbHint(),
      sharePageUrl,
      renderFirmwareUpdatePanel: () => getFirmwareUpdateController().renderFirmwareUpdatePanel(),
      formatDuration,
      isConnectionKindAvailable: (kind) => getConnectionShellController().isConnectionKindAvailable(kind),
      isScriptRunning,
      scriptStatusLabel,
      memoryStatusLabel,
      scriptRuntimeLabel,
      wrenchFpsLabel,
      wifiSignalLabel,
      mqttSharePeerId,
      activePeerId,
      copyText,
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return infoPanelController;
  }

  return {
    getGuinoController,
    getGuinoShellService,
    getInfoPanelController,
    getInfoPanelRenderer,
  };
}
