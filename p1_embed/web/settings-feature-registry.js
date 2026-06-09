import { deriveOnlineAuthKeyHex } from "./protocol/MqttTransport.js?v=0.1.87-ui348";
import { generateGuestKey } from "./guino-share-link.js?v=0.1.87-ui725";
import {
  mqttConfigFromStorageAndDevice as mqttConfigFromStorageAndDeviceFor,
  mqttTransportOptions as mqttTransportOptionsFor,
  storeMqttConfigFields,
  storeMqttHistoryConfig,
  storeMqttParams,
} from "./mqtt-settings-model.js?v=0.1.87-ui725";
import { createSettingsDeviceRegistry } from "./settings-device-registry.js?v=0.1.87-ui725";

export function createSettingsFeatureRegistry({
  fields,
  getCommandConsoleService,
  getConnectionUiStateController,
  getConsoleController,
  getDeviceRefreshService,
  getDeviceStateController,
  getLastConfig,
  getLastInfo,
  getLastStatus,
  getSettingsShellController,
  getUiActionRunner,
  isBusy,
  isSecurePage,
  localStorageRef,
  normalizePeerId,
  setLastInfo,
  setLastStatus,
  setWifiDraftDirty,
  storage,
} = {}) {
  let settingsDeviceRegistry = null;

  function setLastDeviceName(deviceName) {
    setLastInfo({ ...(getLastInfo?.() || {}), deviceName });
    setLastStatus({ ...(getLastStatus?.() || {}), deviceName });
  }

  function getSettingsDeviceRegistry() {
    if (settingsDeviceRegistry) return settingsDeviceRegistry;
    settingsDeviceRegistry = createSettingsDeviceRegistry({
      deriveOnlineAuthKeyHex,
      fields,
      generateGuestKey,
      getCommandConsoleService,
      getConnectionUiStateController,
      getConsoleController,
      getDeviceRefreshService,
      getDeviceStateController,
      getLastConfig,
      getSettingsShellController,
      getUiActionRunner,
      isBusy,
      isSecurePage,
      localStorageRef,
      mqttConfigFromStorageAndDevice: mqttConfigFromStorageAndDeviceFor,
      mqttTransportOptions: mqttTransportOptionsFor,
      normalizePeerId,
      setLastDeviceName,
      setWifiDraftDirty,
      storage,
      storeMqttConfigFields,
      storeMqttHistoryConfig,
      storeMqttParams,
    });
    return settingsDeviceRegistry;
  }

  return {
    getDeviceSettingsController: () => getSettingsDeviceRegistry().getDeviceSettingsController(),
    getMqttSettingsPanelController: () => getSettingsDeviceRegistry().getMqttSettingsPanelController(),
    getMqttShellService: () => getSettingsDeviceRegistry().getMqttShellService(),
    getMqttSigninDialogController: () => getSettingsDeviceRegistry().getMqttSigninDialogController(),
    getOnlineAuthListRenderer: () => getSettingsDeviceRegistry().getOnlineAuthListRenderer(),
    getSettingsDeviceRegistry,
    getWifiNetworkListRenderer: () => getSettingsDeviceRegistry().getWifiNetworkListRenderer(),
  };
}
