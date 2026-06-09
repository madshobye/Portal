import { createInfoGuinoRegistry } from "./info-guino-registry.js?v=0.1.87-ui725";
import { formatDuration } from "./display-formatters.js?v=0.1.87-ui725";
import {
  activePeerId as activePeerIdFor,
  memoryStatusLabel as memoryStatusLabelFor,
  mqttSharePeerId as mqttSharePeerIdFor,
  scriptRuntimeLabel as scriptRuntimeLabelFor,
  scriptStatusLabel as scriptStatusLabelFor,
  wifiSignalLabel as wifiSignalLabelFor,
  wrenchFpsLabel as wrenchFpsLabelFor,
} from "./status-model.js?v=0.1.87-ui725";

export function createInfoFeatureRegistry({
  brandVersion,
  copyText,
  fields,
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
  infoQr,
  infoShare,
  isMqttKind,
  isWebRtcKind,
  normalizePeerId,
  uiCanvas,
  webVersion,
} = {}) {
  let infoGuinoRegistry = null;

  function lastStatus() {
    return getLastStatus?.() || null;
  }

  function lastInfo() {
    return getLastInfo?.() || null;
  }

  function transport() {
    return getTransport?.() || null;
  }

  function isScriptRunning() {
    return String(lastStatus()?.scriptState || "").toLowerCase() === "running";
  }

  function getInfoGuinoRegistry() {
    if (infoGuinoRegistry) return infoGuinoRegistry;
    infoGuinoRegistry = createInfoGuinoRegistry({
      activePeerId: (webrtc = {}, mqtt = {}) => activePeerIdFor({ webrtc, mqtt, transport: transport(), normalizePeerId, isMqttKind, isWebRtcKind }),
      brandVersion,
      connectMqtt: (value, mqttConfig = null) => getConnectionShellController().connectMqtt(value, mqttConfig),
      connectWebSocket: (value) => getConnectionShellController().connectWebSocket(value),
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
      infoQr,
      infoShare,
      isMqttKind,
      isScriptRunning,
      isWebRtcKind,
      memoryStatusLabel: () => memoryStatusLabelFor({ lastStatus: lastStatus(), lastInfo: lastInfo() }),
      mqttSharePeerId: (mqtt = {}) => mqttSharePeerIdFor({ mqtt, transport: transport(), normalizePeerId, isMqttKind }),
      normalizePeerId,
      scriptRuntimeLabel: () => scriptRuntimeLabelFor(lastStatus()),
      scriptStatusLabel: () => scriptStatusLabelFor(lastStatus()),
      sharePageUrl: (...args) => getConnectionAddressService().sharePageUrl(...args),
      uiCanvas,
      webVersion,
      wifiSignalLabel: (wifi) => wifiSignalLabelFor(wifi),
      wrenchFpsLabel: () => wrenchFpsLabelFor(lastStatus(), isScriptRunning()),
    });
    return infoGuinoRegistry;
  }

  return {
    getGuinoController: () => getInfoGuinoRegistry().getGuinoController(),
    getGuinoShellService: () => getInfoGuinoRegistry().getGuinoShellService(),
    getInfoGuinoRegistry,
    getInfoPanelController: () => getInfoGuinoRegistry().getInfoPanelController(),
    getInfoPanelRenderer: () => getInfoGuinoRegistry().getInfoPanelRenderer(),
  };
}
