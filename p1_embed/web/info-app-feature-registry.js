import { createInfoFeatureRegistry } from "./info-feature-registry.js?v=0.1.87-ui723";

export function createInfoAppFeatureRegistry({
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
  let infoFeatureRegistry = null;

  function getInfoFeatureRegistry() {
    if (infoFeatureRegistry) return infoFeatureRegistry;
    infoFeatureRegistry = createInfoFeatureRegistry({
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
    });
    return infoFeatureRegistry;
  }

  return {
    getGuinoController: () => getInfoFeatureRegistry().getGuinoController(),
    getGuinoShellService: () => getInfoFeatureRegistry().getGuinoShellService(),
    getInfoFeatureRegistry,
    getInfoGuinoRegistry: () => getInfoFeatureRegistry().getInfoGuinoRegistry(),
    getInfoPanelController: () => getInfoFeatureRegistry().getInfoPanelController(),
    getInfoPanelRenderer: () => getInfoFeatureRegistry().getInfoPanelRenderer(),
  };
}
