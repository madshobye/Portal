import { settle } from "./timing.js?v=0.1.87-ui729";
import { copyTextToClipboard } from "./clipboard.js?v=0.1.87-ui729";
import { createInstallAppFeatureRegistry } from "./install-app-feature-registry.js?v=0.1.87-ui729";
import { isMqttKind, isWebRtcKind } from "./connection-kinds.js?v=0.1.87-ui729";
import { createInfoAppFeatureRegistry } from "./info-app-feature-registry.js?v=0.1.87-ui729";
import { createSettingsAppFeatureRegistry } from "./settings-app-feature-registry.js?v=0.1.87-ui729";
import { normalizePeerId } from "./connection-address-utils.js?v=0.1.87-ui729";
import { createDeviceAppFeatureRegistry } from "./device-app-feature-registry.js?v=0.1.87-ui729";
import { createDeviceAppDependencies } from "./device-app-dependencies.js?v=0.1.87-ui729";
import { createSettingsAppDependencies } from "./settings-app-dependencies.js?v=0.1.87-ui729";
import { createInstallAppDependencies } from "./install-app-dependencies.js?v=0.1.87-ui729";
import { createInfoAppDependencies } from "./info-app-dependencies.js?v=0.1.87-ui729";
import { storage } from "./app-config.js?v=0.1.87-ui729";

export function createDeviceRegistries({
  context,
  getProjectDomainFeatureRegistry,
  setConnectionIntentWanted,
  webVersion,
} = {}) {
  const {
    accessor,
    connectionState,
    documentRef,
    fields,
    localStorageRef,
    navigatorRef,
    registryCache,
    windowRef,
  } = context;

  function getInstallAppFeatureRegistry() {
    return registryCache.get("installAppFeatureRegistry", () => createInstallAppFeatureRegistry(createInstallAppDependencies({
      fields,
      getCommandConsoleService: accessor("getCommandConsoleService"),
      getConnectionAddressService: accessor("getConnectionAddressService"),
      getConnectionShellController: accessor("getConnectionShellController"),
      getConnectionUiStateController: accessor("getConnectionUiStateController"),
      getConsoleController: accessor("getConsoleController"),
      getDeviceRefreshService: accessor("getDeviceRefreshService"),
      getDeviceStateController: accessor("getDeviceStateController"),
      getProjectDomainFeatureRegistry,
      localStorageRef,
      navigatorRef,
      setConnectionIntentWanted,
      settle,
      state: connectionState,
      storage,
      windowRef,
    })));
  }

  function getInfoAppFeatureRegistry() {
    return registryCache.get("infoAppFeatureRegistry", () => createInfoAppFeatureRegistry(createInfoAppDependencies({
      copyText: copyTextToClipboard,
      els: fields,
      getCommandConsoleService: accessor("getCommandConsoleService"),
      getConnectionAddressService: accessor("getConnectionAddressService"),
      getConnectionShellController: accessor("getConnectionShellController"),
      getConnectionUiStateController: accessor("getConnectionUiStateController"),
      getConsoleController: accessor("getConsoleController"),
      getDeviceStateController: accessor("getDeviceStateController"),
      getFirmwareUpdateController: accessor("getFirmwareUpdateController"),
      isMqttKind,
      isWebRtcKind,
      normalizePeerId,
      state: connectionState,
      webVersion,
    })));
  }

  function getDeviceAppFeatureRegistry() {
    return registryCache.get("deviceAppFeatureRegistry", () => createDeviceAppFeatureRegistry(createDeviceAppDependencies({
      documentRef,
      fields,
      getChatShellController: accessor("getChatShellController"),
      getCodeEditorShellController: accessor("getCodeEditorShellController"),
      getCommandConsoleService: accessor("getCommandConsoleService"),
      getConnectionShellController: accessor("getConnectionShellController"),
      getConsoleController: accessor("getConsoleController"),
      getFirmwareUpdateController: accessor("getFirmwareUpdateController"),
      getGuinoController: accessor("getGuinoController"),
      getInfoPanelController: accessor("getInfoPanelController"),
      getInstallWorkflowController: accessor("getInstallWorkflowController"),
      getMqttSettingsPanelController: accessor("getMqttSettingsPanelController"),
      getMqttShellService: accessor("getMqttShellService"),
      getProjectToolbarController: accessor("getProjectToolbarController"),
      getWifiNetworkListRenderer: accessor("getWifiNetworkListRenderer"),
      isMqttKind,
      isWebRtcKind,
      localStorageRef,
      state: connectionState,
      storage,
      windowRef,
    })));
  }

  function getSettingsAppFeatureRegistry() {
    return registryCache.get("settingsAppFeatureRegistry", () => createSettingsAppFeatureRegistry(createSettingsAppDependencies({
      fields,
      getCommandConsoleService: accessor("getCommandConsoleService"),
      getConnectionUiStateController: accessor("getConnectionUiStateController"),
      getConsoleController: accessor("getConsoleController"),
      getDeviceRefreshService: accessor("getDeviceRefreshService"),
      getDeviceStateController: accessor("getDeviceStateController"),
      getSettingsShellController: accessor("getSettingsShellController"),
      getUiActionRunner: accessor("getUiActionRunner"),
      isSecurePage: () => windowRef.location.protocol === "https:",
      localStorageRef,
      normalizePeerId,
      state: connectionState,
      storage,
    })));
  }

  return {
    getDeviceAppFeatureRegistry,
    getInfoAppFeatureRegistry,
    getInstallAppFeatureRegistry,
    getSettingsAppFeatureRegistry,
  };
}
