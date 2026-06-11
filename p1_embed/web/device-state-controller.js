export function createDeviceStateController({
  fields,
  documentRef,
  storage,
  storageArea,
  getLastInfo,
  setLastInfo,
  getLastStatus,
  setLastStatus,
  getLastConfig,
  setLastConfig,
  getLastLoggedScriptErrorCount,
  setLastLoggedScriptErrorCount,
  getWifiDraftDirty,
  getEditorValue,
  getCodeView,
  getGuinoController,
  getUploadStatusController,
  getEventLogFilter,
  logLine,
  renderConnectionState,
  renderFields,
  renderWifiNetworkList,
  populateMqttSettings,
  setTimezoneSelectValue,
  parseWrenchErrorLocation,
  storeMqttConfigFields,
  eventLogLevel,
  eventMessage,
  mergeStatusSnapshot,
  nextScriptErrorReport,
  refreshViewAvailability,
} = {}) {
  function acceptEvent(event) {
    const data = event?.data || {};
    const level = eventLogLevel(event.name, data);
    if (event.name === "device.status" && data.status) {
      updateStatus(data.status);
      return;
    }

    if (event.name?.startsWith("ui.")) {
      getGuinoController().acceptEvent(event.name, data);
      refreshViewAvailability?.();
    }

    const message = eventMessage(event.name, data);
    if (shouldLogEvent(event.name, data, message)) {
      logLine(level, `${event.name}: ${message}`);
    }

    if (event.name === "script.error") {
      const errorData = data.error || data;
      const count = Number(errorData?.count);
      if (Number.isFinite(count)) setLastLoggedScriptErrorCount(Math.max(getLastLoggedScriptErrorCount(), count));
      markEditorError(message);
    }
    if (event.name === "wifi.status") updateWifi(data.wifi || data);
    if (event.name === "script.state") updateScriptState(data);
    if (event.name === "script.upload") {
      clearGuinoForUploadEvent(data);
      updateUploadFromEvent(data);
      updateScriptState(data);
    }
    if (event.name === "device.boot") {
      if (data.info) setLastInfo(data.info);
      if (data.status) updateStatus(data.status);
      renderFields();
    }
  }

  function clearGuinoForUploadEvent(data = {}) {
    getGuinoController().clearForUploadEvent(data);
    refreshViewAvailability?.();
  }

  function shouldLogEvent(name, data = {}, message = "") {
    return getEventLogFilter().shouldLogEvent(name, data, message);
  }

  function updateUploadFromEvent(data = {}) {
    getUploadStatusController().updateFromEvent(data);
  }

  function uploadErrorLabel(message = "") {
    return getUploadStatusController().errorLabel(message);
  }

  function setUploadState(phase = "", label = "", progress = 0, { autoClear = false } = {}) {
    getUploadStatusController().setState(phase, label, progress, { autoClear });
  }

  function renderUploadState() {
    getUploadStatusController().render();
  }

  function markEditorError(message) {
    const parsed = parseWrenchErrorLocation(message, getEditorValue());
    if (!parsed) return;
    getCodeView().markError(parsed);
  }

  function clearEditorError() {
    getCodeView().clearError();
  }

  function updateStatus(status = {}) {
    const nextStatus = mergeStatusSnapshot(getLastStatus(), status);
    setLastStatus(nextStatus);
    reportStatusScriptError(status.lastError);
    updateScriptState(nextStatus);
    if (Object.prototype.hasOwnProperty.call(status, "wifi")) updateWifi(status.wifi, { render: false });
    renderConnectionState();
    renderFields();
  }

  function reportStatusScriptError(error = {}) {
    const report = nextScriptErrorReport(error, getLastLoggedScriptErrorCount());
    if (!report) return;
    setLastLoggedScriptErrorCount(report.count);
    logLine("error", `script.error: ${report.message}`);
    markEditorError(report.message);
  }

  function updateScriptState(data = {}) {
    const state = data.scriptState || data.state || "unknown";
    const stored = data.scriptStored ?? data.stored;
    const bytes = data.scriptBytes;
    const hash = data.scriptHash;
    fields.scriptState.textContent = [
      state,
      stored === true ? "stored" : "",
      Number.isFinite(bytes) ? `${bytes} bytes` : "",
      Number.isFinite(hash) ? `#${hash.toString(16)}` : "",
    ].filter(Boolean).join(" / ");
  }

  function updateWifi(wifi = {}, options = {}) {
    if (!wifi) return;
    setLastStatus({
      ...(getLastStatus() || {}),
      wifi: { ...(getLastStatus()?.wifi || {}), ...wifi },
    });
    setWifiSsidFromDevice(wifi.ssid);
    if (options.render !== false) {
      renderConnectionState();
      renderFields();
    }
  }

  function updateConfig(config = {}) {
    setLastConfig(config);
    storeMqttConfigFields(config, { storage, storageArea });
    if (fields.settingsDialog.open) populateMqttSettings();
    if (config.deviceName) {
      setLastInfo({ ...(getLastInfo() || {}), deviceName: config.deviceName });
      setLastStatus({ ...(getLastStatus() || {}), deviceName: config.deviceName });
      if (fields.deviceNameInput && documentRef.activeElement !== fields.deviceNameInput) {
        fields.deviceNameInput.value = config.deviceName;
      }
    }
    if (config.timezone && fields.timezoneInput && documentRef.activeElement !== fields.timezoneInput) {
      setTimezoneSelectValue(config.timezone);
    }
    if (Array.isArray(config.wifiNetworks) && config.wifiNetworks[0]?.ssid) {
      setWifiSsidFromDevice(config.wifiNetworks[0].ssid);
    } else if (config.wifiSsid) {
      setWifiSsidFromDevice(config.wifiSsid);
    }
    renderWifiNetworkList();
    renderFields();
  }

  function setWifiSsidFromDevice(ssid) {
    if (!ssid) return;
    if (fields.settingsDialog.open) return;
    const active = documentRef.activeElement;
    const editingWifi =
      fields.settingsDialog.open &&
      (getWifiDraftDirty() || active === fields.wifiSsid || active === fields.wifiPassword);
    if (editingWifi) return;
    fields.wifiSsid.value = ssid;
  }

  return {
    acceptEvent,
    clearEditorError,
    clearGuinoForUploadEvent,
    markEditorError,
    renderUploadState,
    reportStatusScriptError,
    setUploadState,
    setWifiSsidFromDevice,
    shouldLogEvent,
    updateConfig,
    updateScriptState,
    updateStatus,
    updateUploadFromEvent,
    updateWifi,
    uploadErrorLabel,
  };
}
