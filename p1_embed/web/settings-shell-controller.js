export function createSettingsShellController({
  fields,
  getLastInfo,
  getLastStatus,
  getLastConfig,
  getTransport,
  normalizePeerId,
  isMqttKind,
  setTimezoneSelectValue,
  populateMqttSettings,
  renderWifiNetworkList,
  refreshFirmwareReleaseInfo,
  firmwareLog,
  renderFirmwareUpdatePanel,
  getSettingsTabs,
  getMqttSettingsPanelController,
  getMqttSigninDialogController,
  getOnlineAuthListRenderer,
  setWifiDraftDirty,
} = {}) {
  function openSettingsDialog() {
    const lastInfo = getLastInfo();
    const lastStatus = getLastStatus();
    const lastConfig = getLastConfig();
    fields.deviceNameInput.value = lastInfo?.deviceName || lastStatus?.deviceName || "";
    setTimezoneSelectValue(lastConfig?.timezone || "UTC0");
    fields.wifiSsid.value = "";
    fields.wifiPassword.value = "";
    populateMqttSettings();
    renderWifiNetworkList();
    setWifiDraftDirty(false);
    refreshFirmwareReleaseInfo({ quiet: true }).catch((error) => {
      firmwareLog(`manifest: ${error.message || error}`);
      renderFirmwareUpdatePanel();
    });
    switchSettingsTab("general");
    fields.settingsDialog.showModal();
    fields.deviceNameInput.focus();
    fields.deviceNameInput.select();
  }

  function switchSettingsTab(name) {
    getSettingsTabs().switchTab(name);
  }

  function updateAccessSaveVisibility(baseline = null) {
    getMqttSettingsPanelController().updateAccessSaveVisibility(baseline);
  }

  function mqttRemoteIdForAuth() {
    const transport = getTransport();
    const lastConfig = getLastConfig();
    const lastInfo = getLastInfo();
    const lastStatus = getLastStatus();
    if (isMqttKind(transport?.kind) && transport?.remoteId) return normalizePeerId(transport.remoteId);
    const deviceId = lastConfig?.deviceId || lastInfo?.deviceId || lastStatus?.deviceId || "";
    if (deviceId && deviceId.length >= 6) return `p1-embed-${deviceId.slice(-6)}`.toLowerCase();
    const explicit = normalizePeerId(fields.peerId?.value || "");
    if (explicit) return explicit;
    return normalizePeerId(lastConfig?.deviceName || lastInfo?.deviceName || "");
  }

  function requestMqttSignIn({ remoteId } = {}) {
    return getMqttSigninDialogController().request({ remoteId });
  }

  function renderOnlineAuthUsersFromConfig() {
    const lastConfig = getLastConfig();
    const users = Array.isArray(lastConfig?.onlineAuthUsers) ? lastConfig.onlineAuthUsers : [];
    getOnlineAuthListRenderer().render(users);
  }

  return {
    mqttRemoteIdForAuth,
    openSettingsDialog,
    renderOnlineAuthUsersFromConfig,
    requestMqttSignIn,
    updateAccessSaveVisibility,
  };
}
