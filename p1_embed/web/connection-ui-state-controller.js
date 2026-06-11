export function createConnectionUiStateController({
  fields,
  getClient,
  getTransport,
  getConnectionVerified,
  getLastConfig,
  getWifiNetworkListRenderer,
  getInfoPanelController,
  getConnectionStatusRenderer,
  getUiEnabledStateController,
  getConnectionShellController,
  getGuinoController,
  refreshViewAvailability,
} = {}) {
  function isDeviceConnected() {
    return Boolean(getClient() && getTransport()?.connected && getConnectionVerified());
  }

  function renderWifiNetworkList() {
    const networks = Array.isArray(getLastConfig()?.wifiNetworks) ? getLastConfig().wifiNetworks : [];
    getWifiNetworkListRenderer().render(networks);
  }

  function renderFields() {
    getInfoPanelController().render();
  }

  function setConnected(connected) {
    fields.connection.classList.toggle("is-online", connected);
    syncGuinoConnectionState();
    renderConnectionState();
    updateEnabledState();
    getConnectionShellController().renderConnectionHistory();
    renderFields();
    if (connected) {
      getGuinoController().requestRefresh({ quiet: true });
      refreshViewAvailability?.();
    }
  }

  function syncGuinoConnectionState() {
    const connected = isDeviceConnected();
    fields.views.ui?.classList.toggle("is-disconnected", !connected);
    getGuinoController().syncConnectionState(connected);
  }

  function renderConnectionState(transportState = "") {
    getConnectionStatusRenderer().render(transportState);
  }

  function updateEnabledState() {
    getUiEnabledStateController().update();
  }

  return {
    isDeviceConnected,
    renderConnectionState,
    renderFields,
    renderWifiNetworkList,
    setConnected,
    syncGuinoConnectionState,
    updateEnabledState,
  };
}
