import { product } from "./app-config.js?v=0.1.87-ui755";

export function createInstallWorkflowController({
  P1WebFlasher,
  WebSerialTransport,
  storage,
  storageArea,
  navigatorRef,
  windowRef,
  manifestDefault,
  installPanel,
  hasFirmwareVersionField,
  shouldEraseAll,
  getFlasher,
  setFlasher,
  getBusy,
  setBusy,
  getClient,
  getTransport,
  getLastInfo,
  setLastInfo,
  getLastStatus,
  setLastStatus,
  setConnectionIntentWanted,
  disconnectTransport,
  connectTransport,
  refreshKnownUsbPorts,
  readUsbHint,
  normalizeUsbHint,
  sendCommand,
  updateConfig,
  refreshStatus,
  settle,
} = {}) {
  async function runInstallAction(action) {
    if (getBusy()) return;
    setBusy(true);
    updateInstallEnabledState();
    try {
      await action();
    } catch (error) {
      const message = `Error: ${error.message || error}`;
      installLog(message);
      installStatus(message);
    } finally {
      setBusy(false);
      updateInstallEnabledState();
    }
  }

  async function connectFlasher() {
    const flasher = ensureFlasher();
    await releaseDeviceTransportForInstall();
    const chipName = await flasher.connect();
    installStatus(chipName ? `connected / ${chipName}` : "connected");
  }

  async function flashInstallManifest(options = {}) {
    const flasher = ensureFlasher();
    installPanel.clearLog();
    installPanel.hideGoCode();
    await releaseDeviceTransportForInstall();
    const manifest = installPanel.manifestValue(manifestDefault);
    const eraseAll = Boolean(options.eraseAll || shouldEraseAll());
    if (eraseAll) {
      const ok = windowRef.confirm("Clear old data erases WiFi, users, projects, and stored scripts before installing. Continue?");
      if (!ok) return;
    }
    installPanel.setProgress(0);
    installStatus("Choose your ESP32 serial port");
    installLog(`Using ${flasher.baudrate} baud`);
    await flasher.flashManifest(manifest, { ...options, eraseAll });
    const hint = normalizeUsbHint(flasher.port?.getInfo?.() || null);
    installStatus("Upload complete. Waiting for board...");
    await flasher.disconnect();
    await settle(eraseAll ? 4500 : 2600);
    await applyInstallSetupAfterUpload(hint);
  }

  async function refreshInstallManifestInfo() {
    if (!hasFirmwareVersionField()) return;
    const manifest = installPanel.manifestValue(manifestDefault);
    try {
      const response = await fetch(manifest, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      const name = data.name || `${product.name} firmware`;
      const version = data.version || "unknown";
      installPanel.setFirmwareVersion(`${name} ${version}`);
    } catch {
      installPanel.setFirmwareVersion("Firmware manifest unavailable");
    }
  }

  async function releaseDeviceTransportForInstall() {
    setConnectionIntentWanted(false);
    if (getClient() || getTransport()) {
      await disconnectTransport({ quiet: true });
      installLog("Disconnected coding transport");
    }
  }

  function ensureFlasher() {
    const baudrate = installPanel.baudrateValue();
    const existing = getFlasher();
    if (existing) {
      existing.baudrate = baudrate;
      return existing;
    }
    const flasher = new P1WebFlasher({ baudrate });
    setFlasher(flasher);
    flasher.addEventListener("state", (event) => installStatus(formatInstallState(event.detail)));
    flasher.addEventListener("log", (event) => installLog(event.detail.message || ""));
    flasher.addEventListener("progress", (event) => {
      const { written, total } = event.detail;
      const pct = total > 0 ? Math.round((written / total) * 100) : 0;
      installPanel.setProgress(pct);
      installStatus(`Uploading ${pct}%`);
    });
    return flasher;
  }

  function installStatus(text) {
    installPanel.setStatus(text);
  }

  function formatInstallState(detail = {}) {
    return installPanel.formatState(detail);
  }

  function readInstallSetup() {
    return installPanel.readSetup();
  }

  async function applyInstallSetupAfterUpload(hint) {
    if (hint) storageArea.setItem(storage.usbHint, JSON.stringify(hint));
    const setup = readInstallSetup();
    const connected = await connectUsbAfterInstall();
    if (!connected) {
      installStatus("Uploaded. Open Code when the board is ready.");
      installPanel.showGoCode();
      return;
    }

    if (Object.keys(setup).length) {
      try {
        installStatus("Applying setup");
        const config = await sendCommand("config.set", setup, { quiet: true, timeoutMs: 12000 });
        updateConfig(config);
        if (setup.deviceName) {
          setLastInfo({ ...(getLastInfo() || {}), deviceName: setup.deviceName });
          setLastStatus({ ...(getLastStatus() || {}), deviceName: setup.deviceName });
        }
        installPanel.clearWifiPassword();
        await refreshStatus({ quiet: true, timeoutMs: 8000 });
      } catch (error) {
        installLog(`Setup warning: ${error.message || error}`);
        installStatus("Ready. Setup was not applied.");
        installPanel.showGoCode();
        return;
      }
    }

    installStatus("Ready");
    installPanel.showGoCode();
  }

  async function connectUsbAfterInstall() {
    if (!("serial" in navigatorRef) || !readUsbHint()) return false;
    const attempts = 7;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      installStatus(attempt ? `Checking ${product.name} (${attempt + 1}/${attempts})` : `Checking ${product.name}`);
      await settle(attempt ? 2200 : 1200);
      const ok = await connectTransport(
        new WebSerialTransport({ storageKey: storage.usbHint }),
        { pickPort: false },
        "usb",
        "USB",
        { quiet: true, lightStartup: true, includeScript: false, startupTimeoutMs: 7000 },
      );
      await refreshKnownUsbPorts();
      if (ok && getClient()) return true;
    }
    installLog(`${product.name} did not answer the automatic post-upload probe.`);
    return false;
  }

  function installLog(message) {
    installPanel.appendLog(message);
  }

  function updateInstallEnabledState() {
    installPanel.setEnabled({ busy: getBusy() });
  }

  return {
    applyInstallSetupAfterUpload,
    connectFlasher,
    connectUsbAfterInstall,
    ensureFlasher,
    flashInstallManifest,
    formatInstallState,
    installLog,
    installStatus,
    readInstallSetup,
    refreshInstallManifestInfo,
    releaseDeviceTransportForInstall,
    runInstallAction,
    updateInstallEnabledState,
  };
}
