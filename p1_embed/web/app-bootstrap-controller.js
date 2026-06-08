export function createAppBootstrapController({
  fields,
  product,
  storage,
  storageArea,
  webVersion,
  mqttVersion,
  updateViewportHeight,
  initEditor,
  setEditorValueRaw,
  defaultPeerIdFromWebSocket,
  getConsolePreferences,
  updateConsoleTimestampButton,
  bindControls,
  syncGenerativePanelState,
  bindLifecycle,
  initChat,
  initCircuit,
  initGuino,
  migrateConnectionHistory,
  renderConnectionHistory,
  renderSketchHistory,
  logLine,
  refreshKnownUsbPorts,
  refreshInstallManifestInfo,
  refreshFirmwareReleaseInfo,
  firmwareLog,
  renderFirmwareUpdatePanel,
  setConnected,
  renderFields,
  applyGuestUiShell,
  restoreActiveTab,
  autoConnectFromUrlParams,
  autoReconnectLastConnection,
} = {}) {
  function boot() {
    updateViewportHeight();
    initEditor();
    setEditorValueRaw("", { persist: false });
    fields.websocketUrl.value = storageArea.getItem(storage.wsUrl) || fields.websocketUrl.value;
    fields.peerId.value = storageArea.getItem(storage.peerId) || defaultPeerIdFromWebSocket(fields.websocketUrl.value);
    fields.debugLevel.value = getConsolePreferences().readLogLevel(fields.debugLevel.value);
    updateConsoleTimestampButton();
    bindControls();
    syncGenerativePanelState();
    bindLifecycle();
    initChat();
    initCircuit();
    initGuino();
    migrateConnectionHistory();
    renderConnectionHistory();
    renderSketchHistory();
    logLine("info", `${product?.name || "XOBIT"} web ${webVersion} / mqtt ${mqttVersion}`);
    refreshKnownUsbPorts();
    refreshInstallManifestInfo();
    refreshFirmwareReleaseInfo({ quiet: true }).catch((error) => {
      firmwareLog(`manifest: ${error.message || error}`);
      renderFirmwareUpdatePanel();
    });
    setConnected(false);
    renderFields();
    applyGuestUiShell();
    restoreActiveTab();
    autoConnectFromUrlParams().then((handled) => {
      if (!handled) autoReconnectLastConnection();
    });
  }

  return {
    boot,
  };
}
