export function createInstallPanelController({
  connectButton,
  flashButton,
  clearDataInput,
  slowBaudInput,
  goCodeButton,
  manifestInput,
  firmwareVersion,
  deviceNameInput,
  wifiSsidInput,
  wifiPasswordInput,
  progress,
  status,
  log,
} = {}) {
  function setStatus(text) {
    status.textContent = text || "";
    if (text === "Upload complete" || text === "Flash erased") progress.value = 100;
    if (text === "Connecting" || text === "Preparing firmware" || text === "Uploading" || text === "Erasing flash") progress.removeAttribute("value");
  }

  function formatState(detail = {}) {
    const chip = detail.chipName ? ` / ${detail.chipName}` : "";
    const labels = {
      connecting: "Connecting",
      connected: `Connected${chip}`,
      loading: "Preparing firmware",
      flashing: "Uploading",
      resetting: "Restarting board",
      done: "Upload complete",
      erasing: "Erasing flash",
      erased: "Flash erased",
      disconnected: "Disconnected",
    };
    return labels[detail.state] || detail.state || "";
  }

  function readSetup() {
    const deviceName = deviceNameInput.value.trim();
    const wifiSsid = wifiSsidInput.value.trim();
    const wifiPassword = wifiPasswordInput.value;
    const data = {};
    if (deviceName) data.deviceName = deviceName;
    if (wifiSsid) data.wifiSsid = wifiSsid;
    if (wifiPassword) data.wifiPassword = wifiPassword;
    return data;
  }

  function appendLog(message) {
    const text = String(message || "").trimEnd();
    if (!text) return;
    log.textContent += `${text}\n`;
    log.scrollTop = log.scrollHeight;
  }

  function setEnabled({ busy = false, available = "serial" in navigator } = {}) {
    [
      connectButton,
      flashButton,
      clearDataInput,
      slowBaudInput,
      goCodeButton,
      manifestInput,
    ].forEach((el) => {
      if (el) el.disabled = busy || !available;
    });
  }

  function clearLog() {
    log.textContent = "";
  }

  function hideGoCode() {
    goCodeButton?.classList.add("is-hidden");
  }

  function showGoCode() {
    goCodeButton?.classList.remove("is-hidden");
  }

  function setProgress(value) {
    progress.value = value;
  }

  function clearWifiPassword() {
    wifiPasswordInput.value = "";
  }

  function manifestValue(fallback) {
    return manifestInput?.value?.trim() || fallback;
  }

  function baudrateValue() {
    return slowBaudInput?.checked ? 115200 : 921600;
  }

  function setFirmwareVersion(text) {
    if (firmwareVersion) firmwareVersion.textContent = text;
  }

  return {
    appendLog,
    clearLog,
    clearWifiPassword,
    formatState,
    hideGoCode,
    baudrateValue,
    manifestValue,
    readSetup,
    setEnabled,
    setFirmwareVersion,
    setProgress,
    setStatus,
    showGoCode,
  };
}
