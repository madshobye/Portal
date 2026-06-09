import { createDeviceFeatureRegistry } from "./device-feature-registry.js?v=0.1.87-ui728";

export function createDeviceAppFeatureRegistry(options = {}) {
  let deviceFeatureRegistry = null;

  function getDeviceFeatureRegistry() {
    if (deviceFeatureRegistry) return deviceFeatureRegistry;
    deviceFeatureRegistry = createDeviceFeatureRegistry(options);
    return deviceFeatureRegistry;
  }

  return {
    getConnectionStatusRenderer: () => getDeviceFeatureRegistry().getConnectionStatusRenderer(),
    getConnectionUiStateController: () => getDeviceFeatureRegistry().getConnectionUiStateController(),
    getDeviceFeatureRegistry,
    getDeviceRefreshService: () => getDeviceFeatureRegistry().getDeviceRefreshService(),
    getDeviceShellRegistry: () => getDeviceFeatureRegistry().getDeviceShellRegistry(),
    getDeviceStateController: () => getDeviceFeatureRegistry().getDeviceStateController(),
    getEventLogFilter: () => getDeviceFeatureRegistry().getEventLogFilter(),
    getUiActionRunner: () => getDeviceFeatureRegistry().getUiActionRunner(),
    getUiEnabledStateController: () => getDeviceFeatureRegistry().getUiEnabledStateController(),
    getUploadStatusController: () => getDeviceFeatureRegistry().getUploadStatusController(),
  };
}
