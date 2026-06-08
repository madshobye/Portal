export function createSettingsAppDependencies({
  fields,
  getCommandConsoleService,
  getConnectionUiStateController,
  getConsoleController,
  getDeviceRefreshService,
  getDeviceStateController,
  getSettingsShellController,
  getUiActionRunner,
  isSecurePage,
  localStorageRef,
  normalizePeerId,
  state,
  storage,
} = {}) {
  return {
    fields,
    getCommandConsoleService,
    getConnectionUiStateController,
    getConsoleController,
    getDeviceRefreshService,
    getDeviceStateController,
    getLastConfig: () => state.lastConfig,
    getLastInfo: () => state.lastInfo,
    getLastStatus: () => state.lastStatus,
    getSettingsShellController,
    getUiActionRunner,
    isBusy: () => state.isBusy,
    isSecurePage,
    localStorageRef,
    normalizePeerId,
    setLastInfo: (value) => {
      state.lastInfo = value;
    },
    setLastStatus: (value) => {
      state.lastStatus = value;
    },
    setWifiDraftDirty: (dirty) => {
      state.wifiDraftDirty = Boolean(dirty);
    },
    storage,
  };
}
