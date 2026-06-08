export function createDeviceAppDependencies({
  documentRef,
  fields,
  getChatShellController,
  getCodeEditorShellController,
  getCommandConsoleService,
  getConnectionShellController,
  getConsoleController,
  getFirmwareUpdateController,
  getGuinoController,
  getInfoPanelController,
  getInstallWorkflowController,
  getMqttSettingsPanelController,
  getMqttShellService,
  getProjectToolbarController,
  getWifiNetworkListRenderer,
  isMqttKind,
  isWebRtcKind,
  localStorageRef,
  state,
  storage,
  windowRef,
} = {}) {
  return {
    documentRef,
    fields,
    getBusyLabel: () => state.busyLabel,
    getChatShellController,
    getClient: () => state.client,
    getCodeEditorShellController,
    getCommandConsoleService,
    getConnectionShellController,
    getConnectionVerified: () => state.connectionVerified,
    getConsoleController,
    getFirmwareUpdateController,
    getGuinoController,
    getInfoPanelController,
    getInstallWorkflowController,
    getLastConfig: () => state.lastConfig,
    getLastInfo: () => state.lastInfo,
    getLastLoggedScriptErrorCount: () => state.lastLoggedScriptErrorCount,
    getLastStatus: () => state.lastStatus,
    getMqttSettingsPanelController,
    getMqttShellService,
    getProjectToolbarController,
    getTransport: () => state.transport,
    getWifiDraftDirty: () => state.wifiDraftDirty,
    getWifiNetworkListRenderer,
    isBusy: () => state.isBusy,
    isMqttKind,
    isWebRtcKind,
    localStorageRef,
    setBusy: (value) => {
      state.isBusy = value;
    },
    setBusyLabel: (value) => {
      state.busyLabel = value;
    },
    setLastConfig: (value) => {
      state.lastConfig = value;
    },
    setLastInfo: (value) => {
      state.lastInfo = value;
    },
    setLastLoggedScriptErrorCount: (value) => {
      state.lastLoggedScriptErrorCount = value;
    },
    setLastStatus: (value) => {
      state.lastStatus = value;
    },
    storage,
    windowRef,
  };
}
