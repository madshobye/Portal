export function createInstallAppDependencies({
  fields,
  getCommandConsoleService,
  getConnectionAddressService,
  getConnectionShellController,
  getConnectionUiStateController,
  getConsoleController,
  getDeviceRefreshService,
  getDeviceStateController,
  getProjectDomainFeatureRegistry,
  localStorageRef,
  navigatorRef,
  setConnectionIntentWanted,
  settle,
  state,
  storage,
  windowRef,
} = {}) {
  return {
    fields,
    getAppBusy: () => state.isBusy,
    getClient: () => state.client,
    getCommandConsoleService,
    getConnectionAddressService,
    getConnectionShellController,
    getConnectionUiStateController,
    getConsoleController,
    getDeviceRefreshService,
    getDeviceStateController,
    getInstallDomainHelpers: () => getProjectDomainFeatureRegistry().installFeatureHelpers(),
    getLastInfo: () => state.lastInfo,
    getLastStatus: () => state.lastStatus,
    getTransport: () => state.transport,
    localStorageRef,
    navigatorRef,
    setConnectionIntentWanted,
    setLastInfo: (value) => {
      state.lastInfo = value;
    },
    setLastStatus: (value) => {
      state.lastStatus = value;
    },
    settle,
    storage,
    windowRef,
  };
}
