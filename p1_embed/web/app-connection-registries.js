import { settle } from "./timing.js?v=0.1.87-ui755";
import {
  connectionKindIcon as connectionKindIconFor,
  connectionKindLabel as connectionKindLabelFor,
  isConnectionKindAvailable as connectionKindAvailable,
  isMqttKind,
  isWebRtcKind,
} from "./connection-kinds.js?v=0.1.87-ui755";
import { normalizeMqttHistoryConfig } from "./mqtt-settings-model.js?v=0.1.87-ui755";
import {
  defaultPeerIdFromWebSocket,
  isLoopbackHost,
  normalizePeerId,
  normalizeUsbHint,
  normalizeWebSocketUrl,
  pickPortFromHint,
  usbHintFromParams,
  usbHintLabel,
  wsDisplayName,
} from "./connection-address-utils.js?v=0.1.87-ui755";
import { createConnectionAppFeatureRegistry } from "./connection-app-feature-registry.js?v=0.1.87-ui755";
import { usbStartupOptions as usbStartupOptionsFor } from "./connection-lifecycle-model.js?v=0.1.87-ui755";
import { currentDeviceDisplayName as currentDeviceDisplayNameFor } from "./status-model.js?v=0.1.87-ui755";
import { createConnectionShellFeatureRegistry } from "./connection-shell-feature-registry.js?v=0.1.87-ui755";
import { createConnectionAppDependencies } from "./connection-app-dependencies.js?v=0.1.87-ui755";
import { createConnectionShellDependencies } from "./connection-shell-dependencies.js?v=0.1.87-ui755";
import { createDeviceRegistries } from "./app-device-registries.js?v=0.1.87-ui755";
import {
  ALPHA_ENABLE_WEBRTC_CONNECT,
  ALPHA_ENABLE_WEBSOCKET_CONNECT,
  connectionHistoryLimit,
  storage,
} from "./app-config.js?v=0.1.87-ui755";

export function createConnectionRegistries({
  context,
  connectionIntentWanted,
  getProjectDomainFeatureRegistry,
  markConnectionAttemptFailed,
  markConnectionAttemptStarted,
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
  const {
    getDeviceAppFeatureRegistry,
    getInfoAppFeatureRegistry,
    getInstallAppFeatureRegistry,
    getSettingsAppFeatureRegistry,
  } = createDeviceRegistries({
    context,
    getProjectDomainFeatureRegistry,
    setConnectionIntentWanted,
    webVersion,
  });

  function getConnectionShellFeatureRegistry() {
    return registryCache.get("connectionShellFeatureRegistry", () => createConnectionShellFeatureRegistry(createConnectionShellDependencies({
      alphaEnableWebRtcConnect: ALPHA_ENABLE_WEBRTC_CONNECT,
      alphaEnableWebSocketConnect: ALPHA_ENABLE_WEBSOCKET_CONNECT,
      connectionHistoryLimit,
      connectionKindAvailable,
      connectionKindIcon: connectionKindIconFor,
      connectionKindLabel: connectionKindLabelFor,
      currentDeviceDisplayName: currentDeviceDisplayNameFor,
      defaultPeerIdFromWebSocket,
      documentRef,
      fields,
      getConnectionHistoryActions: accessor("getConnectionHistoryActions"),
      getConnectionMemoryService: accessor("getConnectionMemoryService"),
      getConnectionReconnectService: accessor("getConnectionReconnectService"),
      getConnectionTransportSession: accessor("getConnectionTransportSession"),
      getConsoleController: accessor("getConsoleController"),
      getMqttShellService: accessor("getMqttShellService"),
      isLoopbackHost,
      isMqttKind,
      isWebRtcKind,
      localStorageRef,
      markConnectionAttemptFailed,
      markConnectionAttemptStarted,
      navigatorRef,
      normalizeMqttHistoryConfig,
      normalizePeerId,
      normalizeUsbHint,
      normalizeWebSocketUrl,
      pickPortFromHint,
      state: connectionState,
      storage,
      usbHintFromParams,
      usbHintLabel,
      usbStartupOptions: usbStartupOptionsFor,
      windowRef,
      wsDisplayName,
    })));
  }

  function getConnectionAppFeatureRegistry() {
    return registryCache.get("connectionAppFeatureRegistry", () => createConnectionAppFeatureRegistry(createConnectionAppDependencies({
      connectionIntentWanted,
      documentRef,
      els: fields,
      getCommandConsoleService: accessor("getCommandConsoleService"),
      getConnectionAddressService: accessor("getConnectionAddressService"),
      getConnectionHistoryStore: accessor("getConnectionHistoryStore"),
      getConnectionMemoryService: accessor("getConnectionMemoryService"),
      getConnectionShellController: accessor("getConnectionShellController"),
      getConnectionStartupService: accessor("getConnectionStartupService"),
      getConnectionUiStateController: accessor("getConnectionUiStateController"),
      getConsoleController: accessor("getConsoleController"),
      getDeviceRefreshService: accessor("getDeviceRefreshService"),
      getDeviceStateController: accessor("getDeviceStateController"),
      getMqttShellService: accessor("getMqttShellService"),
      getScriptDownloadService: accessor("getScriptDownloadService"),
      isMqttKind,
      isWebRtcKind,
      localStorageRef,
      markConnectionAttemptFailed,
      markConnectionAttemptStarted,
      navigatorRef,
      normalizePeerId,
      normalizeWebSocketUrl,
      setConnectionIntentWanted,
      settle,
      state: connectionState,
      storage,
      windowRef,
      wsDisplayName,
    })));
  }

  return {
    getConnectionAppFeatureRegistry,
    getConnectionShellFeatureRegistry,
    getDeviceAppFeatureRegistry,
    getInfoAppFeatureRegistry,
    getInstallAppFeatureRegistry,
    getSettingsAppFeatureRegistry,
  };
}
