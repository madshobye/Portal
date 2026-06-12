import { createConnectionHistoryActions } from "./connection-history-actions.js?v=0.1.87-ui755";
import { createConnectionMemoryService } from "./connection-memory-service.js?v=0.1.87-ui755";
import { createConnectionStartupService } from "./connection-startup-service.js?v=0.1.87-ui755";
import { createConnectionReconnectService } from "./connection-reconnect-service.js?v=0.1.87-ui755";
import { createConnectionTransportSession } from "./connection-transport-session.js?v=0.1.87-ui755";

export function createConnectionRuntimeRegistry({
  ProtocolClient,
  WebSerialTransport,
  WebSocketTransport,
  MqttTransport,
  MqttWebRtcTransport,
  canEncodeCommand,
  clearConnectionUrlParams,
  closeConnectDialog,
  connectionIntentWanted,
  currentDeviceDisplayName,
  documentRef,
  getClient,
  getConnectionAddressService,
  getConnectionHistoryStore,
  getConnectionMemoryService: getExternalConnectionMemoryService,
  getConnectionShellController,
  getConnectionStartupService: getExternalConnectionStartupService,
  getConnectionUiStateController,
  getConnectionVerified,
  getCommandConsoleService,
  getConsoleController,
  getDeviceRefreshService,
  getDeviceStateController,
  getScriptDownloadService,
  getGeneration,
  getIsBusy,
  getIsUnloading,
  getMqttShellService,
  getReconnectAfterReturn,
  getReconnectAfterReturnAttempted,
  getSuppressConnectionLogs,
  getTransport,
  isDroppedTransportState,
  isMqttKind,
  isWebRtcKind,
  localStorageRef,
  markConnectionAttemptFailed,
  markConnectionAttemptStarted,
  navigatorRef,
  normalizePeerId,
  normalizeWebSocketUrl,
  readRequestedLogLevel,
  readStoredLogLevel,
  renderConnectionState,
  setBusy,
  setBusyLabel,
  setClient,
  setConnected,
  setConnectionIntentWanted,
  setConnectionVerified,
  setGeneration,
  setPeerInput,
  setReconnectAfterReturn,
  setReconnectAfterReturnAttempted,
  setSuppressConnectionLogs,
  setTransport,
  setWebSocketInput,
  settle,
  startStatusPolling,
  stopStatusPolling,
  storage,
  transportStateLogEntries,
  updateEnabledState,
  windowRef,
  writeRequestedLogLevel,
  wsDisplayName,
} = {}) {
  let connectionHistoryActions = null;
  let connectionMemoryService = null;
  let connectionStartupService = null;
  let connectionReconnectService = null;
  let connectionTransportSession = null;

  function getConnectionHistoryActions() {
    if (connectionHistoryActions) return connectionHistoryActions;
    connectionHistoryActions = createConnectionHistoryActions({
      storage,
      storageArea: localStorageRef,
      historyStore: getConnectionHistoryStore(),
      normalizeWebSocketUrl,
      normalizePeerId,
      readUsbHint: () => getConnectionAddressService().readUsbHint(),
      isMqttKind,
      isWebRtcKind,
      setConnectionIntentWanted,
    });
    return connectionHistoryActions;
  }

  function getConnectionMemoryService() {
    if (connectionMemoryService) return connectionMemoryService;
    connectionMemoryService = createConnectionMemoryService({
      storage,
      storageArea: localStorageRef,
      historyStore: getConnectionHistoryStore(),
      normalizeWebSocketUrl,
      wsDisplayName,
      normalizePeerId,
      readUsbHint: () => getConnectionAddressService().readUsbHint(),
      isMqttKind,
      isWebRtcKind,
      setConnectionIntentWanted,
      currentDeviceDisplayName,
      setWebSocketInput,
      setPeerInput,
      renderConnectionHistory: () => getConnectionShellController().renderConnectionHistory(),
      refreshKnownUsbPorts: () => getConnectionShellController().refreshKnownUsbPorts(),
    });
    return connectionMemoryService;
  }

  function getConnectionStartupService() {
    if (connectionStartupService) return connectionStartupService;
    connectionStartupService = createConnectionStartupService({
      getClient,
      getTransport,
      getGeneration,
      refreshInfo: (options) => getDeviceRefreshService().refreshInfo(options),
      refreshStatus: (options) => getDeviceRefreshService().refreshStatus(options),
      getScript: (options) => getScriptDownloadService().getScript(options),
      sendCommand: (...args) => getCommandConsoleService().sendCommand(...args),
      updateConfig: (config = {}) => getDeviceStateController().updateConfig(config),
      readStoredLogLevel,
      readRequestedLogLevel,
      writeRequestedLogLevel,
      settle,
      logLine: (level, message) => getConsoleController().logLine(level, message),
    });
    return connectionStartupService;
  }

  function getConnectionReconnectService() {
    if (connectionReconnectService) return connectionReconnectService;
    connectionReconnectService = createConnectionReconnectService({
      storage,
      storageArea: localStorageRef,
      navigatorRef,
      windowRef,
      getClient,
      isBusy: getIsBusy,
      connectionIntentWanted,
      connectTransport: (...args) => getConnectionShellController().connectTransport(...args),
      refreshKnownUsbPorts: () => getConnectionShellController().refreshKnownUsbPorts(),
      readUsbHint: () => getConnectionAddressService().readUsbHint(),
      normalizePeerId: (value) => getConnectionAddressService().normalizePeerId(value),
      wsDisplayName: (url) => getConnectionAddressService().wsDisplayName(url),
      mqttConfigFromStorageAndDevice: () => getMqttShellService().configFromStorageAndDevice(),
      mqttTransportOptions: (config = null) => getMqttShellService().transportOptions(config),
      usbStartupOptions: (extra) => getConnectionShellController().usbStartupOptions(extra),
      isMqttKind,
      isWebRtcKind,
      createWebSocketTransport: () => new WebSocketTransport(),
      createMqttTransport: (options) => new MqttTransport(options),
      createMqttWebRtcTransport: (options) => new MqttWebRtcTransport(options),
      createWebSerialTransport: (options) => new WebSerialTransport(options),
    });
    return connectionReconnectService;
  }

  function getConnectionTransportSession() {
    if (connectionTransportSession) return connectionTransportSession;
    connectionTransportSession = createConnectionTransportSession({
      ProtocolClient,
      canEncodeCommand,
      getClient,
      setClient,
      getTransport,
      setTransport,
      getGeneration,
      setGeneration,
      getConnectionVerified,
      setConnectionVerified,
      getSuppressConnectionLogs,
      setSuppressConnectionLogs,
      setBusy,
      setBusyLabel,
      getReconnectAfterReturn,
      setReconnectAfterReturn,
      getReconnectAfterReturnAttempted,
      setReconnectAfterReturnAttempted,
      isBusy: getIsBusy,
      isUnloading: getIsUnloading,
      documentRef,
      markConnectionAttemptStarted,
      markConnectionAttemptFailed,
      setConnectionIntentWanted,
      connectionIntentWanted,
      clearConnectionUrlParams,
      closeConnectDialog,
      updateEnabledState,
      setConnected,
      renderConnectionState,
      stopStatusPolling,
      startStatusPolling,
      rememberActiveConnection: (kind, options = {}) => getConnectionShellController().rememberActiveConnection(kind, options),
      rememberSuccessfulConnection: (kind, label, options = {}) => getExternalConnectionMemoryService().rememberSuccessfulConnection(kind, label, options),
      startupRefresh: (options) => getExternalConnectionStartupService().startupRefresh(options),
      autoReconnectLastConnection: (options) => getConnectionShellController().autoReconnectLastConnection(options),
      settle,
      logLine: (level, message) => getConsoleController().logLine(level, message),
      logJson: (level, data) => getConsoleController().logJson(level, data),
      acceptEvent: (event) => getDeviceStateController().acceptEvent(event),
      isBinaryTransportKind: (kind) => getConnectionShellController().isBinaryTransportKind(kind),
      isMqttKind,
      isDroppedTransportState,
      transportStateLogEntries,
    });
    return connectionTransportSession;
  }

  return {
    getConnectionHistoryActions,
    getConnectionMemoryService,
    getConnectionReconnectService,
    getConnectionStartupService,
    getConnectionTransportSession,
  };
}
