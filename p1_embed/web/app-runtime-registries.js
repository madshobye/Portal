import { inferCircuitLayout } from "./circuit.js?v=0.1.87-ui554";
import { settle } from "./timing.js?v=0.1.87-ui723";
import { isMqttKind } from "./connection-kinds.js?v=0.1.87-ui723";
import { defaultPeerIdFromWebSocket } from "./connection-address-utils.js?v=0.1.87-ui723";
import { createTransferAppFeatureRegistry } from "./transfer-app-feature-registry.js?v=0.1.87-ui723";
import { normalizeChatMessages } from "./revision-chat-model.js?v=0.1.87-ui723";
import { createAppRuntimeAppFeatureRegistry } from "./app-runtime-app-feature-registry.js?v=0.1.87-ui723";
import { createAppRuntimeAppDependencies } from "./app-runtime-app-dependencies.js?v=0.1.87-ui723";
import { createTransferAppDependencies } from "./transfer-app-dependencies.js?v=0.1.87-ui723";
import { product, storage } from "./app-config.js?v=0.1.87-ui723";

export function createRuntimeRegistries({
  context,
  connectionIntentWanted,
  getEditorFeatureRegistry,
  getProjectDomainFeatureRegistry,
  mqttVersion,
  updateViewportHeight,
  webVersion,
} = {}) {
  const {
    accessor,
    connectionState,
    documentRef,
    fields,
    localStorageRef,
    registryCache,
    windowRef,
  } = context;

  function getAppRuntimeAppFeatureRegistry() {
    return registryCache.get("appRuntimeAppFeatureRegistry", () => createAppRuntimeAppFeatureRegistry(createAppRuntimeAppDependencies({
      defaultPeerIdFromWebSocket,
      fields,
      product,
      getChatSettings: accessor("getChatSettings"),
      getChatShellController: accessor("getChatShellController"),
      getCircuitShellController: accessor("getCircuitShellController"),
      getCircuitWorkspaceController: accessor("getCircuitWorkspaceController"),
      getCodeEditorShellController: accessor("getCodeEditorShellController"),
      getCommandConsoleService: accessor("getCommandConsoleService"),
      getConnectionShellController: accessor("getConnectionShellController"),
      getConnectionTransportSession: accessor("getConnectionTransportSession"),
      getConnectionUiStateController: accessor("getConnectionUiStateController"),
      getConsoleController: accessor("getConsoleController"),
      getConsolePreferences: accessor("getConsolePreferences"),
      getDeviceRefreshService: accessor("getDeviceRefreshService"),
      getDeviceSettingsController: accessor("getDeviceSettingsController"),
      getEditorRegistry: getEditorFeatureRegistry,
      getFirmwareUpdateController: accessor("getFirmwareUpdateController"),
      getGenerativePanelController: accessor("getGenerativePanelController"),
      getGuinoController: accessor("getGuinoController"),
      getGuinoShellService: accessor("getGuinoShellService"),
      getInfoPanelController: accessor("getInfoPanelController"),
      getInstallWorkflowController: accessor("getInstallWorkflowController"),
      getLowerPanelController: accessor("getLowerPanelController"),
      getProjectActionsController: accessor("getProjectActionsController"),
      getProjectDownloadService: accessor("getProjectDownloadService"),
      getProjectHistoryView: accessor("getProjectHistoryView"),
      getProjectToolbarController: accessor("getProjectToolbarController"),
      getRevisionDraftStore: accessor("getRevisionDraftStore"),
      getScriptDownloadService: accessor("getScriptDownloadService"),
      getScriptUploadService: accessor("getScriptUploadService"),
      getSettingsShellController: accessor("getSettingsShellController"),
      getSettingsTabs: accessor("getSettingsTabs"),
      getSpecificationEditorController: accessor("getSpecificationEditorController"),
      getUiActionRunner: accessor("getUiActionRunner"),
      getViewShellController: accessor("getViewShellController"),
      connectionIntentWanted,
      mqttVersion,
      scriptToolbars: accessor("scriptToolbars"),
      state: connectionState,
      storage,
      storageArea: localStorageRef,
      updateViewportHeight,
      webVersion,
      windowRef,
      documentRef,
      workspaceToolbars: accessor("workspaceToolbars"),
    })));
  }

  function getTransferAppFeatureRegistry() {
    return registryCache.get("transferAppFeatureRegistry", () => createTransferAppFeatureRegistry(createTransferAppDependencies({
      getCodeEditorShellController: accessor("getCodeEditorShellController"),
      getCommandConsoleService: accessor("getCommandConsoleService"),
      getConnectionShellController: accessor("getConnectionShellController"),
      getConsoleController: accessor("getConsoleController"),
      getDeviceRefreshService: accessor("getDeviceRefreshService"),
      getDeviceStateController: accessor("getDeviceStateController"),
      getGuinoController: accessor("getGuinoController"),
      getProjectController: accessor("getProjectController"),
      getProjectDomainFeatureRegistry,
      getProjectLibraryService: accessor("getProjectLibraryService"),
      getProjectRevisionService: accessor("getProjectRevisionService"),
      getUploadStatusController: accessor("getUploadStatusController"),
      inferCircuitLayout,
      isMqttKind,
      normalizeChatMessages,
      settle,
      state: connectionState,
    })));
  }

  return {
    getAppRuntimeAppFeatureRegistry,
    getTransferAppFeatureRegistry,
  };
}
