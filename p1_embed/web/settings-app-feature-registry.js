import { createSettingsFeatureRegistry } from "./settings-feature-registry.js?v=0.1.87-ui748";

export function createSettingsAppFeatureRegistry(options = {}) {
  let settingsFeatureRegistry = null;

  function getSettingsFeatureRegistry() {
    if (settingsFeatureRegistry) return settingsFeatureRegistry;
    settingsFeatureRegistry = createSettingsFeatureRegistry(options);
    return settingsFeatureRegistry;
  }

  return {
    getDeviceSettingsController: () => getSettingsFeatureRegistry().getDeviceSettingsController(),
    getMqttSettingsPanelController: () => getSettingsFeatureRegistry().getMqttSettingsPanelController(),
    getMqttShellService: () => getSettingsFeatureRegistry().getMqttShellService(),
    getMqttSigninDialogController: () => getSettingsFeatureRegistry().getMqttSigninDialogController(),
    getOnlineAuthListRenderer: () => getSettingsFeatureRegistry().getOnlineAuthListRenderer(),
    getSettingsDeviceRegistry: () => getSettingsFeatureRegistry().getSettingsDeviceRegistry(),
    getSettingsFeatureRegistry,
    getWifiNetworkListRenderer: () => getSettingsFeatureRegistry().getWifiNetworkListRenderer(),
  };
}
