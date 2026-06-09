import { createConnectionHistoryStore } from "./connection-history-store.js?v=0.1.87-ui723";
import { createConnectionUrlManager } from "./connection-url-manager.js?v=0.1.87-ui723";
import { createConnectionAddressService } from "./connection-address-service.js?v=0.1.87-ui723";
import { createConnectionDialogController } from "./connection-dialog-controller.js?v=0.1.87-ui723";
import { createConnectionDialogStateController } from "./connection-dialog-state-controller.js?v=0.1.87-ui723";
import { createConnectionEntryController } from "./connection-entry-controller.js?v=0.1.87-ui723";
import { createConnectionShellController } from "./connection-shell-controller.js?v=0.1.87-ui723";

export function createConnectionShellRegistry({
  WebSerialTransport,
  WebSocketTransport,
  MqttTransport,
  MqttWebRtcTransport,
  alphaEnableWebRtcConnect,
  alphaEnableWebSocketConnect,
  connectionHistoryLimit,
  connectionKindAvailable,
  connectionKindIcon,
  connectionKindLabel,
  currentDeviceDisplayName,
  defaultPeerIdFromWebSocket,
  documentRef,
  fields,
  getClient,
  getConnectionHistoryActions,
  getConnectionMemoryService,
  getConnectionReconnectService,
  getConnectionTransportSession,
  getConsoleController,
  getMqttShellService,
  getTransport,
  isBusy,
  isConnectionVerified,
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
  setReconnectAfterReturn,
  setReconnectAfterReturnAttempted,
  storage,
  usbHintFromParams,
  usbHintLabel,
  usbStartupOptions,
  windowRef,
  wsDisplayName,
} = {}) {
  let connectionHistoryStore = null;
  let connectionUrlManager = null;
  let connectionAddressService = null;
  let connectionDialogController = null;
  let connectionDialogStateController = null;
  let connectionEntryController = null;
  let connectionShellController = null;

  function getConnectionHistoryStore() {
    if (connectionHistoryStore) return connectionHistoryStore;
    connectionHistoryStore = createConnectionHistoryStore({
      keys: {
        ws: storage.wsHistory,
        peer: storage.peerHistory,
        usb: storage.usbHistory,
      },
      limit: connectionHistoryLimit,
      normalizeWebSocketUrl,
      webSocketDisplayName: wsDisplayName,
      normalizePeerId,
      isMqttKind,
      normalizeMqttHistoryConfig,
      mqttConfigFromStorageAndDevice: () => getMqttShellService().configFromStorageAndDevice(),
      normalizeUsbHint,
      usbHintLabel,
    });
    return connectionHistoryStore;
  }

  function getConnectionUrlManager() {
    if (connectionUrlManager) return connectionUrlManager;
    connectionUrlManager = createConnectionUrlManager({
      normalizeWebSocketUrl,
      normalizePeerId,
      normalizeUsbHint,
      mqttConfig: () => getMqttShellService().configFromStorageAndDevice(),
      isMqttKind,
      isWebRtcKind,
      readUsbHint: () => getConnectionAddressService().readUsbHint(),
    });
    return connectionUrlManager;
  }

  function getConnectionAddressService() {
    if (connectionAddressService) return connectionAddressService;
    connectionAddressService = createConnectionAddressService({
      storage,
      storageArea: localStorageRef,
      windowRef,
      getConnectionHistoryStore,
      getConnectionUrlManager,
      normalizePeerId,
      defaultPeerIdFromWebSocket,
      normalizeUsbHint,
      usbHintFromParams,
      usbHintLabel,
      pickPortFromHint,
      normalizeWebSocketUrl,
      wsDisplayName,
      isLoopbackHost,
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return connectionAddressService;
  }

  function getConnectionDialogController() {
    if (connectionDialogController) return connectionDialogController;
    connectionDialogController = createConnectionDialogController({
      dialog: fields.connectDialog,
      historyList: fields.connectionHistory,
      usbConnect: fields.usbConnect,
      peerToggle: fields.newPeerToggle,
      websocketToggle: fields.newWsToggle,
      peerField: fields.newPeerField,
      peerConnect: fields.newPeerConnect,
      peerInput: fields.peerId,
      websocketField: fields.newWsField,
      websocketConnect: fields.newWsConnect,
      websocketInput: fields.websocketUrl,
      readHistoryItems: () => [
        ...getConnectionAddressService().readPeerHistory(),
        ...getConnectionAddressService().readWebSocketHistory(),
        ...getConnectionAddressService().readUsbHistory(),
      ],
      isKindAvailable: (kind) => getConnectionShellController().isConnectionKindAvailable(kind),
      kindLabel: (kind) => getConnectionShellController().connectionKindLabel(kind),
      kindIcon: (kind) => getConnectionShellController().connectionKindIcon(kind),
      displayLabel: (item) => getConnectionShellController().connectionHistoryDisplayLabel(item),
      isMqttKind,
      isWebRtcKind,
      isBusy,
      hasClient: () => Boolean(getClient()),
      onRefreshUsbPorts: () => getConnectionShellController().refreshKnownUsbPorts(),
      onConnectUsb: (hint) => getConnectionShellController().connectRecentUsb(hint),
      onConnectMqtt: (value, mqttConfig = null) => getConnectionShellController().connectMqtt(value, mqttConfig),
      onConnectWebRtc: (value) => getConnectionShellController().connectPeerJs(value),
      onConnectWebSocket: (value) => getConnectionShellController().connectWebSocket(value),
      onForgetItem: (item) => getConnectionShellController().forgetConnectionHistoryItem(item),
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return connectionDialogController;
  }

  function getConnectionDialogStateController() {
    if (connectionDialogStateController) return connectionDialogStateController;
    connectionDialogStateController = createConnectionDialogStateController({
      navigatorRef,
      getTransport,
      normalizePeerId: (value) => getConnectionAddressService().normalizePeerId(value),
      pickPortFromHint: (ports, hint) => getConnectionAddressService().pickPortFromHint(ports, hint),
      readUsbHint: () => getConnectionAddressService().readUsbHint(),
      usbHintLabel: (hint) => getConnectionAddressService().usbHintLabel(hint),
      currentDeviceDisplayName,
      historyActions: getConnectionHistoryActions(),
      renderConnectionHistory: () => getConnectionShellController().renderConnectionHistory(),
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return connectionDialogStateController;
  }

  function getConnectionEntryController() {
    if (connectionEntryController) return connectionEntryController;
    connectionEntryController = createConnectionEntryController({
      fields,
      storage,
      storageArea: localStorageRef,
      windowRef,
      documentRef,
      navigatorRef,
      WebSocketTransport,
      WebSerialTransport,
      MqttTransport,
      MqttWebRtcTransport,
      normalizeWebSocketUrl: (value) => getConnectionAddressService().normalizeWebSocketUrl(value),
      warnIfPlainWebSocketFromSecurePage: (url) => getConnectionAddressService().warnIfPlainWebSocketFromSecurePage(url),
      wsDisplayName: (url) => getConnectionAddressService().wsDisplayName(url),
      normalizePeerId: (value) => getConnectionAddressService().normalizePeerId(value),
      connectTransport: (...args) => getConnectionShellController().connectTransport(...args),
      renderConnectionHistory: () => getConnectionShellController().renderConnectionHistory(),
      refreshKnownUsbPorts: () => getConnectionShellController().refreshKnownUsbPorts(),
      usbStartupOptions: (extra) => getConnectionShellController().usbStartupOptions(extra),
      mqttConfigFromStorageAndDevice: () => getMqttShellService().configFromStorageAndDevice(),
      mqttTransportOptions: (config = null) => getMqttShellService().transportOptions(config),
      applyMqttConfig: (config = {}) => getMqttShellService().applyConfig(config),
      applyMqttParams: (params) => getMqttShellService().applyParams(params),
      usbHintFromParams: (params) => getConnectionAddressService().usbHintFromParams(params),
      readUsbHint: () => getConnectionAddressService().readUsbHint(),
      markConnectionAttemptFailed,
      setReconnectAfterReturn,
      setReconnectAfterReturnAttempted,
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return connectionEntryController;
  }

  function getConnectionShellController() {
    if (connectionShellController) return connectionShellController;
    connectionShellController = createConnectionShellController({
      getClient,
      getTransport,
      getIsBusy: isBusy,
      getIsConnectionVerified: isConnectionVerified,
      getConnectionDialogController,
      getConnectionDialogStateController,
      getConnectionEntryController,
      getConnectionReconnectService,
      getConnectionTransportSession,
      getConnectionMemoryService,
      connectionKindAvailable,
      connectionKindLabel,
      connectionKindIcon,
      isWebRtcConnectionKind: isWebRtcKind,
      isMqttConnectionKind: isMqttKind,
      usbStartupOptions,
      alphaEnableWebSocketConnect,
      alphaEnableWebRtcConnect,
    });
    return connectionShellController;
  }

  return {
    getConnectionAddressService,
    getConnectionDialogController,
    getConnectionDialogStateController,
    getConnectionEntryController,
    getConnectionHistoryStore,
    getConnectionShellController,
    getConnectionUrlManager,
  };
}
