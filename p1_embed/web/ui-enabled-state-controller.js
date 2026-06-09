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
  const localSettingsTabs = new Set(["generative"]);
  const boardSettingsControls = () => [
    fields.deviceNameInput,
    fields.timezoneInput,
    fields.wifiSsid,
    fields.wifiPassword,
    fields.mqttHost,
    fields.mqttPort,
    fields.mqttRoot,
    fields.mqttUser,
    fields.mqttPassword,
    fields.mqttEnabled,
    fields.allowUnauthenticatedAccess,
    fields.accessGuestUi,
    fields.accessGuestScript,
    fields.onlineAuthUsername,
    fields.onlineAuthPassword,
  ];

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
    fields.settings.disabled = busy;
    updateSettingsAvailability({ connected, busy });
    [
      fields.getScript,
      fields.reboot,
      fields.deviceNameSave,
      fields.wifiSave,
      fields.mqttSave,
      fields.accessSave,
      fields.onlineAuthAdd,
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

  function updateSettingsAvailability({ connected, busy }) {
    fields.settingsTabs?.forEach((tab) => {
      const local = localSettingsTabs.has(tab.dataset.settingsTab);
      tab.disabled = busy || (!connected && !local);
    });
    boardSettingsControls().forEach((field) => {
      if (field) field.disabled = !connected || busy;
    });
    if (!connected && fields.settingsDialog?.open) switchSettingsTab("generative");
  }

  function switchSettingsTab(name) {
    fields.settingsTabs?.forEach((tab) => {
      const active = tab.dataset.settingsTab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    fields.settingsPanels?.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.settingsPanel === name);
    });
  }

  return {
    update,
  };
}
