export function createUiEnabledStateController({
  fields,
  getProjectToolbarController,
  getEditorValue,
  isDeviceConnected,
  hasClient,
  hasTransport,
  isBusy,
  syncGuinoConnectionState,
  renderWifiNetworkList,
  updateChatEnabledState,
  renderConnectionHistory,
  renderConnectionState,
  updateInstallEnabledState,
  renderFirmwareUpdatePanel,
} = {}) {
  function update() {
    const busy = isBusy();
    const connected = isDeviceConnected();
    const editorHasCode = Boolean(getEditorValue().trim());
    const canDisconnectOrCancel = Boolean(hasClient() || hasTransport() || busy);

    syncGuinoConnectionState();
    getProjectToolbarController().setConnectionState({
      connected,
      connecting: busy && !connected,
      busy,
      canDisconnectOrCancel,
      hasTransport: hasTransport(),
    });
    getProjectToolbarController().setDownloadEnabled(editorHasCode);
    fields.formatCode.disabled = busy || !editorHasCode;
    getProjectToolbarController().setScriptControlsEnabled(connected && !busy);
    [
      fields.getScript,
      fields.reboot,
      fields.settings,
      fields.deviceNameSave,
      fields.wifiSave,
      fields.raw,
      fields.rawSend,
    ].forEach((field) => {
      field.disabled = !connected || busy;
    });
    getProjectToolbarController().setProjectCreationBusy(busy);
    renderWifiNetworkList();
    updateChatEnabledState();
    renderConnectionHistory();
    renderConnectionState();
    updateInstallEnabledState();
    renderFirmwareUpdatePanel();
  }

  return {
    update,
  };
}
