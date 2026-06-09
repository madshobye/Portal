import { createProjectToolbarController } from "./project-toolbar-controller.js?v=0.1.87-ui726";
import { createViewShellController } from "./view-shell-controller.js?v=0.1.87-ui726";
import { createSettingsShellController } from "./settings-shell-controller.js?v=0.1.87-ui726";
import { createRevisionNameDialog } from "./revision-name-dialog.js?v=0.1.87-ui726";
import { createConsoleController } from "./console-controller.js?v=0.1.87-ui726";
import { createCommandConsoleService } from "./command-console-service.js?v=0.1.87-ui726";
import { product } from "./app-config.js?v=0.1.87-ui726";

export function createUiServicesRegistry({
  copyText,
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
  getTransport,
  getViewRouting,
  getWifiNetworkListRenderer,
  isMqttKind,
  normalizePeerId,
  normalizeSketchName,
  populateMqttSettings,
  requestAnimationFrameRef,
  requestGuinoRefresh,
  renderWifiNetworkList,
  revisionNameCreateButton,
  setTimezoneSelectValue,
  setWifiDraftDirty,
} = {}) {
  let projectToolbarController = null;
  let viewShellController = null;
  let settingsShellController = null;
  let revisionNameDialog = null;
  let consoleController = null;
  let commandConsoleService = null;

  function getProjectToolbarController() {
    if (projectToolbarController) return projectToolbarController;
    projectToolbarController = createProjectToolbarController({
      toolbars: fields.workspaceToolbars(),
      projectSelects: fields.projectSelectControls(),
      revisionSelects: fields.revisionSelectControls(),
      formatBytes,
      normalizeSketchName,
      onProjectSelect: (id) => getProjectActionsController().scheduleProjectSelect(id),
      onRevisionSelect: (id) => getProjectActionsController().scheduleRevisionSelect(id),
      onRenderedRevisionSelectors: () => getCurrentRevisionSession().renderCurrentSketchName(),
    });
    return projectToolbarController;
  }

  function getViewShellController() {
    if (viewShellController) return viewShellController;
    viewShellController = createViewShellController({
      fields,
      routing: getViewRouting(),
      lowerPanelController: getLowerPanelController(),
      generativePanelController: getGenerativePanelController(),
      getCodeView: () => getCodeEditorShellController().view(),
      getCircuitView,
      getGuinoController,
      renderChatTranscript: () => getChatShellController().renderChatTranscript(),
      updateCircuitView: (status = "") => getCircuitShellController().update(status),
      requestGuinoRefresh,
      isDeviceConnected: () => getConnectionUiStateController().isDeviceConnected(),
      requestFrame: requestAnimationFrameRef,
    });
    return viewShellController;
  }

  function getSettingsShellController() {
    if (settingsShellController) return settingsShellController;
    settingsShellController = createSettingsShellController({
      fields,
      product,
      getLastInfo,
      getLastStatus,
      getLastConfig,
      getTransport,
      normalizePeerId,
      isMqttKind,
      setTimezoneSelectValue,
      populateMqttSettings,
      renderWifiNetworkList,
      refreshFirmwareReleaseInfo: (options) => getFirmwareUpdateController().refreshFirmwareReleaseInfo(options),
      firmwareLog: (message) => getFirmwareUpdateController().firmwareLog(message),
      renderFirmwareUpdatePanel: () => getFirmwareUpdateController().renderFirmwareUpdatePanel(),
      getSettingsTabs: fields.getSettingsTabs,
      getMqttSettingsPanelController,
      getMqttSigninDialogController,
      getOnlineAuthListRenderer,
      setWifiDraftDirty,
    });
    return settingsShellController;
  }

  function getRevisionNameDialog() {
    if (revisionNameDialog) return revisionNameDialog;
    revisionNameDialog = createRevisionNameDialog({
      dialog: fields.revisionNameDialog,
      input: fields.revisionNameInput,
      createButton: revisionNameCreateButton,
      cancelButton: fields.revisionNameCancel,
      normalizeName: normalizeSketchName,
    });
    return revisionNameDialog;
  }

  function getConsoleController() {
    if (consoleController) return consoleController;
    consoleController = createConsoleController({
      consoleElement: fields.console,
      debugLevel: fields.debugLevel,
      timestampsEnabled: () => getConsolePreferences().timestampsEnabled(),
      copyText,
      onLog: (level, message) => getConsoleController().logLine(level, message),
    });
    return consoleController;
  }

  function getCommandConsoleService({ getClient } = {}) {
    if (commandConsoleService) return commandConsoleService;
    commandConsoleService = createCommandConsoleService({
      fields,
      getClient,
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return commandConsoleService;
  }

  return {
    getCommandConsoleService,
    getConsoleController,
    getProjectToolbarController,
    getRevisionNameDialog,
    getSettingsShellController,
    getViewShellController,
  };
}
