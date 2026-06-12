import { createInstallFeatureRegistry } from "./install-feature-registry.js?v=0.1.87-ui755";

export function createInstallAppFeatureRegistry({
  fields,
  getAppBusy,
  getClient,
  getCommandConsoleService,
  getConnectionAddressService,
  getConnectionShellController,
  getConnectionUiStateController,
  getConsoleController,
  getDeviceRefreshService,
  getDeviceStateController,
  getInstallDomainHelpers,
  getLastInfo,
  getLastStatus,
  getTransport,
  localStorageRef,
  navigatorRef,
  setConnectionIntentWanted,
  setLastInfo,
  setLastStatus,
  settle,
  storage,
  windowRef,
} = {}) {
  let installFeatureRegistry = null;

  function getInstallFeatureRegistry() {
    if (installFeatureRegistry) return installFeatureRegistry;
    installFeatureRegistry = createInstallFeatureRegistry({
      ...getInstallDomainHelpers(),
      fields,
      getAppBusy,
      getClient,
      getCommandConsoleService,
      getConnectionAddressService,
      getConnectionShellController,
      getConnectionUiStateController,
      getConsoleController,
      getDeviceRefreshService,
      getDeviceStateController,
      getLastInfo,
      getLastStatus,
      getTransport,
      localStorageRef,
      navigatorRef,
      setConnectionIntentWanted,
      setLastInfo,
      setLastStatus,
      settle,
      storage,
      windowRef,
    });
    return installFeatureRegistry;
  }

  return {
    getFirmwareUpdateController: () => getInstallFeatureRegistry().getFirmwareUpdateController(),
    getInstallFeatureRegistry,
    getInstallPanelController: () => getInstallFeatureRegistry().getInstallPanelController(),
    getInstallWorkflowController: () => getInstallFeatureRegistry().getInstallWorkflowController(),
  };
}
