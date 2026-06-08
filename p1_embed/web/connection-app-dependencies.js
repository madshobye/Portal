export function createConnectionAppDependencies({
  connectionIntentWanted,
  documentRef,
  els,
  getCommandConsoleService,
  getConnectionAddressService,
  getConnectionHistoryStore,
  getConnectionMemoryService,
  getConnectionShellController,
  getConnectionStartupService,
  getConnectionUiStateController,
  getConsoleController,
  getDeviceRefreshService,
  getDeviceStateController,
  getMqttShellService,
  getScriptDownloadService,
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
  state,
  storage,
  windowRef,
  wsDisplayName,
} = {}) {
  return {
    clearConnectionUrlParams: () => getConnectionAddressService().clearConnectionUrlParams(),
    closeConnectDialog: () => getConnectionShellController().closeConnectDialog(),
    connectionIntentWanted,
    documentRef,
    getClient: () => state.client,
    getCommandConsoleService,
    getConnectionAddressService,
    getConnectionHistoryStore,
    getConnectionMemoryService,
    getConnectionShellController,
    getConnectionStartupService,
    getConnectionUiStateController,
    getConnectionVerified: () => state.connectionVerified,
    getConsoleController,
    getDeviceRefreshService,
    getDeviceStateController,
    getGeneration: () => state.connectionGeneration,
    getIsBusy: () => state.isBusy,
    getIsUnloading: () => state.isUnloading,
    getLastConfig: () => state.lastConfig,
    getLastInfo: () => state.lastInfo,
    getLastStatus: () => state.lastStatus,
    getMqttShellService,
    getReconnectAfterReturn: () => state.reconnectAfterReturn,
    getReconnectAfterReturnAttempted: () => state.reconnectAfterReturnAttempted,
    getScriptDownloadService,
    getSuppressConnectionLogs: () => state.suppressConnectionLogs,
    getTransport: () => state.transport,
    isMqttKind,
    isWebRtcKind,
    localStorageRef,
    markConnectionAttemptFailed,
    markConnectionAttemptStarted,
    navigatorRef,
    normalizePeerId,
    normalizeWebSocketUrl,
    readRequestedLogLevel: () => els.debugLevel.value,
    readStoredLogLevel: () => localStorageRef.getItem(storage.logLevel),
    renderConnectionState: (transportState = "") => getConnectionUiStateController().renderConnectionState(transportState),
    setBusy: (value) => {
      state.isBusy = value;
    },
    setBusyLabel: (value) => {
      state.busyLabel = value;
    },
    setClient: (value) => {
      state.client = value;
    },
    setConnected: (connected) => getConnectionUiStateController().setConnected(connected),
    setConnectionIntentWanted,
    setConnectionVerified: (value) => {
      state.connectionVerified = value;
    },
    setGeneration: (value) => {
      state.connectionGeneration = value;
    },
    setPeerInput: (peerId) => {
      els.peerId.value = peerId;
    },
    setReconnectAfterReturn: (value) => {
      state.reconnectAfterReturn = value;
    },
    setReconnectAfterReturnAttempted: (value) => {
      state.reconnectAfterReturnAttempted = value;
    },
    setSuppressConnectionLogs: (value) => {
      state.suppressConnectionLogs = value;
    },
    setTransport: (value) => {
      state.transport = value;
    },
    setWebSocketInput: (url) => {
      els.websocketUrl.value = url;
    },
    settle,
    startStatusPolling: () => getDeviceRefreshService().startStatusPolling(),
    stopStatusPolling: () => getDeviceRefreshService().stopStatusPolling(),
    storage,
    updateEnabledState: () => getConnectionUiStateController().updateEnabledState(),
    windowRef,
    writeRequestedLogLevel: (level) => {
      els.debugLevel.value = level;
    },
    wsDisplayName,
  };
}
