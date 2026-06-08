export function createConnectionShellController({
  getClient,
  getTransport,
  getIsBusy,
  getIsConnectionVerified,
  getConnectionDialogController,
  getConnectionDialogStateController,
  getConnectionEntryController,
  getConnectionReconnectService,
  getConnectionTransportSession,
  getConnectionMemoryService,
  connectionKindAvailable,
  connectionKindLabel,
  connectionKindIcon,
  isWebRtcConnectionKind,
  isMqttConnectionKind,
  usbStartupOptions,
  alphaEnableWebSocketConnect,
  alphaEnableWebRtcConnect,
} = {}) {
  function openConnectDialog() {
    void getConnectionDialogController().open();
  }

  function renderConnectionOptions() {
    getConnectionDialogController().renderOptions();
  }

  function toggleConnection() {
    if (getIsBusy() && !getIsConnectionVerified?.()) {
      cancelConnectionAttempt();
    } else if (getClient() || getTransport()) {
      disconnectTransport();
    } else {
      openConnectDialog();
    }
  }

  function closeConnectDialog() {
    getConnectionDialogController().close();
  }

  function showNewWsField() {
    getConnectionDialogController().showWebSocketField();
  }

  function showNewPeerField() {
    getConnectionDialogController().showPeerField();
  }

  function renderConnectionHistory() {
    getConnectionDialogController().renderHistory();
  }

  function isConnectionKindAvailable(kind) {
    return connectionKindAvailable(kind, {
      enableWebSocket: alphaEnableWebSocketConnect,
      enableWebRtc: alphaEnableWebRtcConnect,
    });
  }

  function connectionHistoryDisplayLabel(item) {
    return getConnectionDialogStateController().connectionHistoryDisplayLabel(item);
  }

  function isWebRtcKind(kind) {
    return isWebRtcConnectionKind(kind);
  }

  function isMqttKind(kind) {
    return isMqttConnectionKind(kind);
  }

  function isBinaryTransportKind(kind) {
    if (kind === "usb") return Boolean(getTransport()?.kind === "usb" && getTransport()?.msgPackMode);
    return kind === "mqtt" || kind === "webrtc";
  }

  function forgetConnectionHistoryItem(item) {
    getConnectionDialogStateController().forgetConnectionHistoryItem(item);
  }

  async function refreshKnownUsbPorts() {
    await getConnectionDialogStateController().refreshKnownUsbPorts();
  }

  async function connectWebSocket(value) {
    await getConnectionEntryController().connectWebSocket(value);
  }

  async function connectPeerJs(value) {
    await getConnectionEntryController().connectPeerJs(value);
  }

  async function connectMqtt(value, mqttConfig = null) {
    await getConnectionEntryController().connectMqtt(value, mqttConfig);
  }

  async function connectUsb() {
    await getConnectionEntryController().connectUsb();
  }

  async function connectRecentUsb(hint = null) {
    await getConnectionEntryController().connectRecentUsb(hint);
  }

  function applyGuestUiShell() {
    getConnectionEntryController().applyGuestUiShell();
  }

  async function autoConnectFromUrlParams() {
    return await getConnectionEntryController().autoConnectFromUrlParams();
  }

  async function autoReconnectLastConnection({ reconnecting = false } = {}) {
    return await getConnectionReconnectService().autoReconnectLastConnection({ reconnecting });
  }

  async function connectTransport(nextTransport, options, kind, label, {
    quiet = false,
    lightStartup = false,
    includeScript = true,
    startupTimeoutMs = 15000,
    startupAttempts = 1,
    startupRetryDelayMs = 450,
    preserveUrl = false,
    busyLabelText = "connecting",
  } = {}) {
    return await getConnectionTransportSession().connectTransport(nextTransport, options, kind, label, {
      quiet,
      lightStartup,
      includeScript,
      startupTimeoutMs,
      startupAttempts,
      startupRetryDelayMs,
      preserveUrl,
      busyLabelText,
    });
  }

  function rememberActiveConnection(kind, options = {}) {
    getConnectionMemoryService().rememberActiveConnection(kind, options);
  }

  async function cancelConnectionAttempt() {
    return await getConnectionTransportSession().cancelConnectionAttempt();
  }

  function migrateConnectionHistory() {
    getConnectionMemoryService().migrateConnectionHistory();
  }

  async function disconnectTransport(options = {}) {
    return await getConnectionTransportSession().disconnectTransport(options);
  }

  return {
    applyGuestUiShell,
    autoConnectFromUrlParams,
    autoReconnectLastConnection,
    cancelConnectionAttempt,
    closeConnectDialog,
    connectMqtt,
    connectPeerJs,
    connectRecentUsb,
    connectTransport,
    connectUsb,
    connectWebSocket,
    connectionHistoryDisplayLabel,
    connectionKindIcon,
    connectionKindLabel,
    disconnectTransport,
    forgetConnectionHistoryItem,
    isBinaryTransportKind,
    isConnectionKindAvailable,
    isMqttKind,
    isWebRtcKind,
    migrateConnectionHistory,
    openConnectDialog,
    refreshKnownUsbPorts,
    rememberActiveConnection,
    renderConnectionHistory,
    renderConnectionOptions,
    showNewPeerField,
    showNewWsField,
    toggleConnection,
    usbStartupOptions,
  };
}
