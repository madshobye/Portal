import { copyTextToClipboard } from "./clipboard.js?v=0.1.87-ui729";
import { setSelectValueOrFallback } from "./settings-fields.js?v=0.1.87-ui729";
import { createUiServicesRegistry } from "./ui-services-registry.js?v=0.1.87-ui729";

export function createUiFeatureRegistry({
  fields,
  formatBytes,
  getChatShellController,
  getCircuitShellController,
  getCircuitView,
  getCodeEditorShellController,
  getConnectionUiStateController,
  getConsolePreferences,
  getCurrentRevisionSession,
  getFirmwareUpdateController,
  getGenerativePanelController,
  getGuinoController,
  getLastConfig,
  getLastInfo,
  getLastStatus,
  getLowerPanelController,
  getMqttSettingsPanelController,
  getMqttSigninDialogController,
  getOnlineAuthListRenderer,
  getProjectActionsController,
  getSettingsTabs,
  getTransport,
  getViewRouting,
  isMqttKind,
  normalizePeerId,
  normalizeSketchName,
  projectSelectControls,
  requestAnimationFrameRef,
  revisionSelectControls,
  setWifiDraftDirty,
  workspaceToolbars,
} = {}) {
  let uiServicesRegistry = null;

  function getUiServicesRegistry() {
    if (uiServicesRegistry) return uiServicesRegistry;
    uiServicesRegistry = createUiServicesRegistry({
      copyText: copyTextToClipboard,
      fields: {
        ...fields,
        getSettingsTabs,
        projectSelectControls,
        revisionSelectControls,
        workspaceToolbars,
      },
      formatBytes,
      getChatShellController,
      getCircuitShellController,
      getCircuitView,
      getCodeEditorShellController,
      getConnectionUiStateController,
      getConsolePreferences,
      getCurrentRevisionSession,
      getFirmwareUpdateController,
      getGenerativePanelController,
      getGuinoController,
      getLastConfig,
      getLastInfo,
      getLastStatus,
      getLowerPanelController,
      getMqttSettingsPanelController,
      getMqttSigninDialogController,
      getOnlineAuthListRenderer,
      getProjectActionsController,
      getTransport,
      getViewRouting,
      isMqttKind,
      normalizePeerId,
      normalizeSketchName,
      populateMqttSettings: () => getMqttSettingsPanelController().populate(),
      requestAnimationFrameRef,
      requestGuinoRefresh: (options) => getGuinoController().requestRefresh(options),
      renderWifiNetworkList: () => getConnectionUiStateController().renderWifiNetworkList(),
      revisionNameCreateButton: fields.revisionNameCreate,
      setTimezoneSelectValue: (value) => setSelectValueOrFallback(fields.timezoneInput, value, "UTC0"),
      setWifiDraftDirty,
    });
    return uiServicesRegistry;
  }

  return {
    getCommandConsoleService: (...args) => getUiServicesRegistry().getCommandConsoleService(...args),
    getConsoleController: () => getUiServicesRegistry().getConsoleController(),
    getProjectToolbarController: () => getUiServicesRegistry().getProjectToolbarController(),
    getRevisionNameDialog: () => getUiServicesRegistry().getRevisionNameDialog(),
    getSettingsShellController: () => getUiServicesRegistry().getSettingsShellController(),
    getUiServicesRegistry,
    getViewShellController: () => getUiServicesRegistry().getViewShellController(),
  };
}
