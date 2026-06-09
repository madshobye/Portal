import { createPageLifecycleController } from "./page-lifecycle-controller.js?v=0.1.87-ui726";
import { createAppBootstrapController } from "./app-bootstrap-controller.js?v=0.1.87-ui726";
import { createAppControlBindingsController } from "./app-control-bindings-controller.js?v=0.1.87-ui726";

export function createAppRuntimeRegistry({
  defaultPeerIdFromWebSocket,
  fields,
  getChatSettings,
  getChatShellController,
  getCircuitShellController,
  getCircuitWorkspaceController,
  getCodeEditorShellController,
  getCommandConsoleService,
  getConnectionShellController,
  getConnectionTransportSession,
  getConnectionUiStateController,
  getConsoleController,
  getConsolePreferences,
  getDeviceRefreshService,
  getDeviceSettingsController,
  getEditorRegistry,
  getFirmwareUpdateController,
  getGenerativePanelController,
  getGuinoController,
  getGuinoShellService,
  getInfoPanelController,
  getInstallWorkflowController,
  getLowerPanelController,
  getProjectActionsController,
  getProjectDownloadService,
  getProjectHistoryView,
  getProjectToolbarController,
  getRevisionDraftStore,
  getScriptDownloadService,
  getScriptUploadService,
  getSettingsShellController,
  getSettingsTabs,
  getSpecificationEditorController,
  getUiActionRunner,
  getViewShellController,
  isBusy,
  isConnectionVerified,
  connectionIntentWanted,
  getClient,
  getTransport,
  mqttVersion,
  scriptToolbars,
  setReconnectAfterReturn,
  setUnloading,
  setWifiDraftDirty,
  storage,
  storageArea,
  syncGenerativePanelState,
  updateViewportHeight,
  webVersion,
  windowRef,
  documentRef,
  workspaceToolbars,
} = {}) {
  let pageLifecycleController = null;
  let appBootstrapController = null;
  let appControlBindingsController = null;

  function getPageLifecycleController() {
    if (pageLifecycleController) return pageLifecycleController;
    pageLifecycleController = createPageLifecycleController({
      windowRef,
      documentRef,
      writeCurrentRevisionDraft: () => getRevisionDraftStore().write(),
      isBusy,
      connectionIntentWanted,
      getClient,
      getTransport,
      isConnectionVerified,
      handleTransportDropped: (droppedClient, options) => getConnectionTransportSession().handleTransportDropped(droppedClient, options),
      maybeReconnectAfterReturn: () => getConnectionTransportSession().maybeReconnectAfterReturn(),
      setUnloading,
      setReconnectAfterReturn,
    });
    return pageLifecycleController;
  }

  function getAppBootstrapController() {
    if (appBootstrapController) return appBootstrapController;
    appBootstrapController = createAppBootstrapController({
      fields,
      storage,
      storageArea,
      webVersion,
      mqttVersion,
      updateViewportHeight,
      initEditor: () => getCodeEditorShellController().init(),
      setEditorValueRaw: (value, options) => getCodeEditorShellController().setValueRaw(value, options),
      defaultPeerIdFromWebSocket,
      getConsolePreferences,
      updateConsoleTimestampButton: () => getConsolePreferences().updateTimestampButton(),
      bindControls: () => getAppControlBindingsController().bind(),
      syncGenerativePanelState,
      bindLifecycle: () => getPageLifecycleController().bind(),
      initChat: () => getChatShellController().initChat(),
      initCircuit: () => getCircuitShellController().init(),
      initGuino: () => getGuinoController().init(),
      migrateConnectionHistory: () => getConnectionShellController().migrateConnectionHistory(),
      renderConnectionHistory: () => getConnectionShellController().renderConnectionHistory(),
      renderSketchHistory: () => getProjectHistoryView().renderSketchHistory(),
      logLine: (level, message) => getConsoleController().logLine(level, message),
      refreshKnownUsbPorts: () => getConnectionShellController().refreshKnownUsbPorts(),
      refreshInstallManifestInfo: () => getInstallWorkflowController().refreshInstallManifestInfo(),
      refreshFirmwareReleaseInfo: (options) => getFirmwareUpdateController().refreshFirmwareReleaseInfo(options),
      firmwareLog: (message) => getFirmwareUpdateController().firmwareLog(message),
      renderFirmwareUpdatePanel: () => getFirmwareUpdateController().renderFirmwareUpdatePanel(),
      setConnected: (connected) => getConnectionUiStateController().setConnected(connected),
      renderFields: () => getConnectionUiStateController().renderFields(),
      applyGuestUiShell: () => getConnectionShellController().applyGuestUiShell(),
      restoreActiveTab: () => getViewShellController().restoreActiveTab(),
      autoConnectFromUrlParams: () => getConnectionShellController().autoConnectFromUrlParams(),
      autoReconnectLastConnection: (options) => getConnectionShellController().autoReconnectLastConnection(options),
    });
    return appBootstrapController;
  }

  function getAppControlBindingsController() {
    if (appControlBindingsController) return appControlBindingsController;
    appControlBindingsController = createAppControlBindingsController({
      fields,
      actions: {
        switchTab: (name) => getViewShellController().switchTab(name),
        toggleConnection: () => getConnectionShellController().toggleConnection(),
        createNewSketch: () => getProjectActionsController().createNewSketch(),
        createCleanRevision: () => getProjectActionsController().createCleanRevision(),
        downloadProject: () => getProjectDownloadService().downloadProject(),
        runScriptFromToolbar: () => {
          getConsoleController().logLine("debug", "upload requested");
          getUiActionRunner().run(() => getScriptUploadService().setScript({ run: true, save: true }), "uploading");
        },
        refreshStatus: (options) => getDeviceRefreshService().refreshStatus(options),
        connectUsb: () => getConnectionShellController().connectUsb(),
        showNewWsField: () => getConnectionShellController().showNewWsField(),
        connectWebSocket: (value) => getConnectionShellController().connectWebSocket(value),
        renderConnectionHistory: () => getConnectionShellController().renderConnectionHistory(),
        showNewPeerField: () => getConnectionShellController().showNewPeerField(),
        connectMqtt: (value, mqttConfig = null) => getConnectionShellController().connectMqtt(value, mqttConfig),
        runUiAction: (action, label = "busy") => getUiActionRunner().run(action, label),
        getScript: (options) => getScriptDownloadService().getScript(options),
        sendCommand: (...args) => getCommandConsoleService().sendCommand(...args),
        formatEditorCode: () => getCodeEditorShellController().formatCode(),
        toggleEditorTheme: () => getCodeEditorShellController().toggleTheme(),
        bindSketchDrop: () => getEditorRegistry().bindCodeDrop(),
        openSettingsDialog: () => getSettingsShellController().openSettingsDialog(),
        saveDeviceName: () => getDeviceSettingsController().saveDeviceName(),
        saveWifi: () => getDeviceSettingsController().saveWifi(),
        saveMqtt: () => getDeviceSettingsController().saveMqtt(),
        updateAccessSaveVisibility: (baseline = null) => getSettingsShellController().updateAccessSaveVisibility(baseline),
        addOnlineAuthUser: () => getDeviceSettingsController().addOnlineAuthUser(),
        toggleConsoleTimestamps: () => {
          getConsolePreferences().toggleTimestamps();
          getConsoleController().render();
        },
        copyConsole: () => getConsoleController().copy(),
        copyInfoShareLink: () => getInfoPanelController().copyShareLink(),
        clearConsole: () => getConsoleController().clear(),
        sendRaw: () => getCommandConsoleService().sendRaw(),
        toggleChatApiKey: () => getChatShellController().toggleChatApiKey(),
        saveChatApiKey: () => getChatShellController().saveChatApiKey(),
        createEncryptedChatKeyShare: () => getChatShellController().createEncryptedChatKeyShare(),
        refreshChatModels: () => getChatShellController().refreshChatModels(),
        toggleChatDebugPrompt: () => getChatShellController().toggleChatDebugPrompt(),
        runFirmwareUpdate: () => getFirmwareUpdateController().runFirmwareUpdate(),
        clearChat: () => getChatShellController().clearChat(),
        handleSpecificationInput: () => getSpecificationEditorController().handleInput(),
        handleSpecificationPaste: (event) => getSpecificationEditorController().handlePaste(event),
        applySpecificationFormat: (format = "") => getSpecificationEditorController().applyFormat(format),
        handleSpecificationModeChange: () => getSpecificationEditorController().handleModeChange(),
        generateCodeFromSpecification: () => getChatShellController().generateCodeFromSpecification(),
        resetCircuitLayoutPositions: () => getCircuitShellController().resetLayoutPositions(),
        copyGuinoLink: () => getGuinoShellService().copyLink(),
        runInstallAction: (action) => getInstallWorkflowController().runInstallAction(action),
        connectFlasher: () => getInstallWorkflowController().connectFlasher(),
        flashInstallManifest: (options) => getInstallWorkflowController().flashInstallManifest(options),
        sendChatPrompt: () => getChatShellController().sendChatPrompt(),
        updateEnabledState: () => getConnectionUiStateController().updateEnabledState(),
      },
      state: {
        hasClient: () => Boolean(getClient()),
        workspaceToolbars,
        scriptToolbars,
        setWifiDraftDirty,
      },
      controllers: {
        lowerPanel: getLowerPanelController,
        projectToolbar: getProjectToolbarController,
        circuitWorkspace: getCircuitWorkspaceController,
        settingsTabs: getSettingsTabs,
        consolePreferences: getConsolePreferences,
        chatSettings: getChatSettings,
        generativePanel: getGenerativePanelController,
      },
    });
    return appControlBindingsController;
  }

  return {
    getAppBootstrapController,
    getAppControlBindingsController,
    getPageLifecycleController,
  };
}
