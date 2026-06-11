import { createWifiNetworkListRenderer } from "./wifi-network-list-renderer.js?v=0.1.87-ui747";
import { createOnlineAuthListRenderer } from "./online-auth-list-renderer.js?v=0.1.87-ui747";
import { createMqttSigninDialogController } from "./mqtt-signin-dialog-controller.js?v=0.1.87-ui747";
import { createDeviceSettingsController } from "./device-settings-controller.js?v=0.1.87-ui747";
import { createMqttSettingsPanelController } from "./mqtt-settings-panel-controller.js?v=0.1.87-ui747";
import { createMqttShellService } from "./mqtt-shell-service.js?v=0.1.87-ui747";

export function createSettingsDeviceRegistry({
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
  mqttConfigFromStorageAndDevice,
  mqttTransportOptions,
  normalizePeerId,
  setLastDeviceName,
  setWifiDraftDirty,
  storage,
  storeMqttConfigFields,
  storeMqttHistoryConfig,
  storeMqttParams,
} = {}) {
  let wifiNetworkListRenderer = null;
  let onlineAuthListRenderer = null;
  let mqttSigninDialogController = null;
  let deviceSettingsController = null;
  let mqttSettingsPanelController = null;
  let mqttShellService = null;

  function getWifiNetworkListRenderer() {
    if (wifiNetworkListRenderer) return wifiNetworkListRenderer;
    wifiNetworkListRenderer = createWifiNetworkListRenderer({
      list: fields.wifiNetworkList,
      isDeviceConnected: () => getConnectionUiStateController().isDeviceConnected(),
      isBusy,
      onForget: (index) => getUiActionRunner().run(() => getDeviceSettingsController().forgetWifiNetwork(index), "wifi"),
    });
    return wifiNetworkListRenderer;
  }

  function getOnlineAuthListRenderer() {
    if (onlineAuthListRenderer) return onlineAuthListRenderer;
    onlineAuthListRenderer = createOnlineAuthListRenderer({
      list: fields.onlineAuthList,
      onRemove: (username) => getUiActionRunner().run(() => getDeviceSettingsController().removeOnlineAuthUser(username), "online user"),
    });
    return onlineAuthListRenderer;
  }

  function getMqttSigninDialogController() {
    if (mqttSigninDialogController) return mqttSigninDialogController;
    mqttSigninDialogController = createMqttSigninDialogController({
      dialog: fields.mqttSigninDialog,
      title: fields.mqttSigninTitle,
      form: fields.mqttSigninForm,
      usernameInput: fields.mqttSigninUsername,
      passwordInput: fields.mqttSigninPassword,
      cancelButton: fields.mqttSigninCancel,
      remoteIdForAuth: () => getSettingsShellController().mqttRemoteIdForAuth(),
      normalizePeerId,
      deriveOnlineAuthKeyHex,
    });
    return mqttSigninDialogController;
  }

  function getDeviceSettingsController() {
    if (deviceSettingsController) return deviceSettingsController;
    deviceSettingsController = createDeviceSettingsController({
      fields,
      storage,
      storageArea: localStorageRef,
      sendCommand: (...args) => getCommandConsoleService().sendCommand(...args),
      updateConfig: (config = {}) => getDeviceStateController().updateConfig(config),
      refreshStatus: (options) => getDeviceRefreshService().refreshStatus(options),
      renderFields: () => getConnectionUiStateController().renderFields(),
      renderOnlineAuthUsers: () => getSettingsShellController().renderOnlineAuthUsersFromConfig(),
      updateAccessSaveVisibility: (baseline = null) => getSettingsShellController().updateAccessSaveVisibility(baseline),
      storeMqttConfigFields,
      generateGuestKey,
      deriveOnlineAuthKeyHex,
      remoteIdForAuth: () => getSettingsShellController().mqttRemoteIdForAuth(),
      getLastConfig,
      setLastDeviceName,
      setWifiDraftDirty,
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return deviceSettingsController;
  }

  function getMqttSettingsPanelController() {
    if (mqttSettingsPanelController) return mqttSettingsPanelController;
    mqttSettingsPanelController = createMqttSettingsPanelController({
      fields,
      configFromStorageAndDevice: () => getMqttShellService().configFromStorageAndDevice(),
      getLastConfig,
      renderOnlineAuthUsers: () => getSettingsShellController().renderOnlineAuthUsersFromConfig(),
    });
    return mqttSettingsPanelController;
  }

  function getMqttShellService() {
    if (mqttShellService) return mqttShellService;
    mqttShellService = createMqttShellService({
      storage,
      storageArea: localStorageRef,
      getLastConfig,
      isSecurePage,
      authProvider: (options) => getSettingsShellController().requestMqttSignIn(options),
      mqttConfigFromStorageAndDevice,
      mqttTransportOptions,
      storeMqttConfigFields,
      storeMqttHistoryConfig,
      storeMqttParams,
    });
    return mqttShellService;
  }

  return {
    getDeviceSettingsController,
    getMqttSettingsPanelController,
    getMqttShellService,
    getMqttSigninDialogController,
    getOnlineAuthListRenderer,
    getWifiNetworkListRenderer,
  };
}
