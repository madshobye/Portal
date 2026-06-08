export function createDeviceSettingsController({
  fields,
  storage,
  storageArea,
  sendCommand,
  updateConfig,
  refreshStatus,
  renderFields,
  renderOnlineAuthUsers,
  updateAccessSaveVisibility,
  storeMqttConfigFields,
  generateGuestKey,
  deriveOnlineAuthKeyHex,
  getStoredOnlineAuth,
  remoteIdForAuth,
  getLastConfig,
  setLastDeviceName,
  setWifiDraftDirty,
  logLine,
}) {
  async function saveDeviceName() {
    const deviceName = fields.deviceNameInput.value.trim();
    if (!deviceName) return;
    const timezone = fields.timezoneInput?.value.trim() || "UTC0";
    const config = await sendCommand("config.set", { deviceName, timezone }, { timeoutMs: 10000 });
    updateConfig(config);
    setLastDeviceName(deviceName);
    await refreshStatus({ quiet: true, timeoutMs: 6000 });
    renderFields();
  }

  async function saveWifi() {
    const wifiSsid = fields.wifiSsid.value.trim();
    const wifiPassword = fields.wifiPassword.value;
    if (!wifiSsid && !wifiPassword) return;

    const data = {};
    if (wifiSsid) data.wifiSsid = wifiSsid;
    if (wifiPassword) data.wifiPassword = wifiPassword;

    const config = await sendCommand("config.set", data, { timeoutMs: 10000 });
    fields.wifiPassword.value = "";
    setWifiDraftDirty(false);
    updateConfig(config);
    await refreshStatus();
  }

  async function saveMqtt() {
    const lastConfig = getLastConfig();
    const mqttHost = fields.mqttHost.value.trim();
    const mqttPort = Number(fields.mqttPort.value || 0);
    const mqttRoot = fields.mqttRoot.value.trim();
    const mqttUser = fields.mqttUser.value.trim();
    const mqttPassword = fields.mqttPassword.value;
    const data = {};
    data.mqttEnabled = Boolean(fields.mqttEnabled.checked);
    data.allowUnauthenticatedAccess = Boolean(fields.allowUnauthenticatedAccess.checked);
    data.mqttAllowAnonymousUi = Boolean(fields.accessGuestUi.checked);
    data.mqttAllowAnonymousScript = Boolean(fields.accessGuestScript.checked);
    if (data.mqttAllowAnonymousUi && !String(lastConfig?.mqttGuestUiKey || "").trim()) {
      data.mqttGuestUiKey = generateGuestKey();
    }
    if (mqttHost) data.mqttHost = mqttHost;
    if (Number.isFinite(mqttPort) && mqttPort > 0) data.mqttPort = mqttPort;
    data.mqttRoot = mqttRoot;
    if (mqttUser) data.mqttUser = mqttUser;
    if (mqttPassword) data.mqttPassword = mqttPassword;

    const config = await sendCommand("config.set", data, { timeoutMs: 10000 });
    storeMqttConfigFields(data, { storage, storageArea });
    fields.mqttPassword.value = "";
    updateConfig(config);
    updateAccessSaveVisibility({
      allowUnauthenticatedAccess: Boolean(config?.allowUnauthenticatedAccess),
      mqttAllowAnonymousUi: Boolean(config?.mqttAllowAnonymousUi),
      mqttAllowAnonymousScript: Boolean(config?.mqttAllowAnonymousScript),
    });
    await refreshStatus({ quiet: true, timeoutMs: 6000 });
    logLine("info", "settings saved");
  }

  async function addOnlineAuthUser() {
    const username = fields.onlineAuthUsername.value.trim();
    const password = fields.onlineAuthPassword.value;
    if (!username || !password) return;
    const lastConfig = getLastConfig();
    const users = Array.isArray(lastConfig?.onlineAuthUsers) ? lastConfig.onlineAuthUsers : [];
    const maxUsers = Number(lastConfig?.onlineAuthUserMax || 0);
    const updatesExisting = users.some((user) => String(user?.username || "").trim() === username);
    if (maxUsers > 0 && users.length >= maxUsers && !updatesExisting) {
      throw new Error(`Online user limit reached (${maxUsers})`);
    }
    const remoteId = remoteIdForAuth();
    if (!remoteId) throw new Error("Connect or enter a board id before adding an online user");
    const keyHex = await deriveOnlineAuthKeyHex(remoteId, username, password);
    if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error("Online user key must be 64 hex characters");
    const config = await sendCommand("config.set", { onlineAuthUsername: username, onlineAuthKey: keyHex }, { timeoutMs: 10000 });
    fields.onlineAuthPassword.value = "";
    updateConfig(config);
    renderOnlineAuthUsers();
    logLine("info", `Online user ${username} saved`);
  }

  async function removeOnlineAuthUser(username) {
    if (!username) return;
    const remoteId = remoteIdForAuth();
    const remembered = getStoredOnlineAuth(remoteId);
    if (remembered?.username === username) {
      throw new Error("Sign in as another online user before removing this one");
    }
    const config = await sendCommand("config.set", { onlineAuthUserRemove: username }, { timeoutMs: 10000 });
    updateConfig(config);
    renderOnlineAuthUsers();
    logLine("info", `Online user ${username} removed`);
  }

  async function forgetWifiNetwork(index) {
    const config = await sendCommand("wifi.forget", { index }, { timeoutMs: 10000 });
    setWifiDraftDirty(false);
    updateConfig(config);
    await refreshStatus({ quiet: true, timeoutMs: 6000 });
  }

  return {
    saveDeviceName,
    saveWifi,
    saveMqtt,
    addOnlineAuthUser,
    removeOnlineAuthUser,
    forgetWifiNetwork,
  };
}
