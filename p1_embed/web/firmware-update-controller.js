export function createFirmwareUpdateController({
  fields,
  windowRef,
  manifestLabel,
  getManifest,
  setManifest,
  getManifestUrl,
  setManifestUrl,
  getCandidate,
  setCandidate,
  getBusy,
  setBusy,
  isAppBusy,
  isDeviceConnected,
  getClient,
  getLastInfo,
  getLastStatus,
  refreshInfo,
  sendCommand,
  disconnectTransport,
  autoReconnectLastConnection,
  setConnectionIntentWanted,
  settle,
  logLine,
  formatBytes,
  firmwareCurrentVersion,
  firmwareUpdateCandidateFor,
  firmwarePanelState,
  firmwareUpdatePayload,
  firmwareUpdateFailureMessage,
} = {}) {
  async function refreshFirmwareReleaseInfo({ quiet = false } = {}) {
    const url = new URL(manifestLabel, windowRef.location.href).toString();
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`firmware manifest ${response.status}`);
    const manifest = await response.json();
    setManifest(manifest);
    setManifestUrl(url);
    if (!quiet) firmwareLog(`loaded ${manifestLabel}`);
    renderFirmwareUpdatePanel();
    return manifest;
  }

  async function refreshFirmwareUpdateState({ quiet = false } = {}) {
    await refreshFirmwareReleaseInfo({ quiet: true });
    if (isDeviceConnected() && !currentVersion()) {
      try {
        await refreshInfo({ quiet: true, timeoutMs: 10000 });
        if (!quiet) firmwareLog("read board firmware version");
      } catch (error) {
        firmwareLog(`system.info: ${error.message || error}`);
      }
    }
    renderFirmwareUpdatePanel();
  }

  function currentVersion() {
    return firmwareCurrentVersion({ lastInfo: getLastInfo(), lastStatus: getLastStatus() });
  }

  function firmwareUpdateCandidateForCurrentBoard() {
    return firmwareUpdateCandidateFor({
      manifest: getManifest(),
      currentVersion: currentVersion(),
    });
  }

  function renderFirmwareUpdatePanel() {
    if (!fields.firmwareUpdateSummary || !fields.firmwareUpdateButton) return;
    const candidate = firmwareUpdateCandidateForCurrentBoard();
    setCandidate(candidate);
    const connected = isDeviceConnected();
    const version = currentVersion();
    const panel = firmwarePanelState({
      connected,
      manifest: getManifest(),
      manifestLabel,
      currentVersion: version,
      candidate,
      formatBytes,
    });
    fields.firmwareUpdateSummary.textContent = panel.summary;
    fields.firmwareUpdateDetail.textContent = panel.detail;

    fields.firmwareUpdateButton.disabled = getBusy() || isAppBusy() || !connected || !candidate;
    fields.firmwareUpdateButton.textContent = getBusy()
      ? "Updating..."
      : (candidate ? `Update to ${candidate.targetVersion}` : "Update");
  }

  async function updatePayload(candidate) {
    return await firmwareUpdatePayload(candidate, {
      baseUrl: getManifestUrl(),
      fetchJson: async (url) => {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`prepare manifest ${response.status}`);
        return await response.json();
      },
    });
  }

  async function readFirmwareOtaStatus({ quiet = true, timeoutMs = 8000 } = {}) {
    return await sendCommand("firmware.update.status", {}, { quiet, timeoutMs });
  }

  async function reportStoredFirmwareUpdateError({ quiet = false } = {}) {
    if (!isDeviceConnected()) return "";
    try {
      const status = await readFirmwareOtaStatus({ quiet: true, timeoutMs: 8000 });
      const message = firmwareUpdateFailureMessage(status);
      if (!message) return "";
      if (!quiet) firmwareLog(message);
      logLine("error", `firmware update: ${message}`);
      return message;
    } catch (error) {
      if (!quiet) firmwareLog(`firmware.update.status: ${error.message || error}`);
      return "";
    }
  }

  async function runFirmwareUpdate() {
    if (getBusy() || isAppBusy()) return;
    setBusy(true);
    renderFirmwareUpdatePanel();
    try {
      if (!isDeviceConnected()) {
        firmwareLog("connect a board before OTA");
        return;
      }
      if (!getManifest()) await refreshFirmwareReleaseInfo();
      const candidate = firmwareUpdateCandidateForCurrentBoard();
      if (!candidate) {
        firmwareLog("no matching delta update");
        return;
      }

      const ok = windowRef.confirm(`Update firmware ${candidate.currentVersion} to ${candidate.targetVersion} over OTA?`);
      if (!ok) return;

      fields.firmwareUpdateLog.textContent = "";
      setConnectionIntentWanted(true);
      firmwareLog(`preparing ${candidate.currentVersion} -> ${candidate.targetVersion}`);
      const payload = await updatePayload(candidate);
      const patchSize = Number(candidate.delta.size || 0);
      const otaStatus = await readFirmwareOtaStatus({ quiet: true, timeoutMs: 8000 });
      const patchLimit = Number(otaStatus?.patchPartitionSize || 0);
      if (patchLimit > 0 && patchSize > patchLimit) {
        throw new Error(`Delta patch is too large for this board: ${formatBytes(patchSize)} > ${formatBytes(patchLimit)}. Full install required for the larger SafeBoot layout.`);
      }
      firmwareLog(`patch ${formatBytes(patchSize)}`);
      await sendCommand("firmware.update.prepare", payload, { timeoutMs: 30000 });
      firmwareLog("accepted; board will reboot, download, patch, and reboot again");
      await waitForFirmwareUpdateVersion(candidate.targetVersion);
      firmwareLog(`running firmware ${candidate.targetVersion}`);
      await refreshFirmwareReleaseInfo({ quiet: true });
    } catch (error) {
      firmwareLog(`error: ${error.message || error}`);
      logLine("error", `firmware update: ${error.message || error}`);
    } finally {
      setBusy(false);
      renderFirmwareUpdatePanel();
    }
  }

  async function waitForFirmwareUpdateVersion(targetVersion) {
    const deadline = Date.now() + 150000;
    let lastNoteAt = 0;
    let lastErrorMessage = "";
    while (Date.now() < deadline) {
      await settle(2600);
      if (!getClient()) {
        try {
          await autoReconnectLastConnection({ reconnecting: true });
        } catch (error) {
          lastErrorMessage = String(error.message || error);
          if (Date.now() - lastNoteAt > 12000) {
            lastNoteAt = Date.now();
            firmwareLog("board is still updating; waiting for reconnect");
          }
        }
        continue;
      }

      try {
        const info = await refreshInfo({ quiet: true, timeoutMs: 8000 });
        if (String(info?.firmwareVersion || "").trim() === targetVersion) return info;
        const storedError = await reportStoredFirmwareUpdateError();
        if (storedError) throw new Error(storedError);
      } catch (error) {
        const message = String(error.message || error);
        if (/^(download_failed|updater_select_failed|patch_failed|apply_failed):/i.test(message)
          || /Delta patch is too large/i.test(message)) {
          throw error;
        }
        if (/timeout|closed|disconnect|transport/i.test(message) && getClient()) {
          try {
            await disconnectTransport({ quiet: true, keepGeneration: true });
          } catch {
          }
        }
        lastErrorMessage = message;
        if (Date.now() - lastNoteAt > 12000) {
          lastNoteAt = Date.now();
          firmwareLog("board is still updating; waiting for firmware response");
        }
      }
    }
    throw new Error(`Timed out waiting for firmware ${targetVersion}${lastErrorMessage ? ` (${lastErrorMessage})` : ""}`);
  }

  function firmwareLog(message) {
    if (!fields.firmwareUpdateLog) return;
    const stamp = new Date().toLocaleTimeString();
    fields.firmwareUpdateLog.textContent += `[${stamp}] ${message}\n`;
    fields.firmwareUpdateLog.scrollTop = fields.firmwareUpdateLog.scrollHeight;
  }

  return {
    firmwareCurrentVersion: currentVersion,
    firmwareLog,
    firmwareUpdateCandidateForCurrentBoard,
    firmwareUpdatePayload: updatePayload,
    readFirmwareOtaStatus,
    refreshFirmwareReleaseInfo,
    refreshFirmwareUpdateState,
    renderFirmwareUpdatePanel,
    reportStoredFirmwareUpdateError,
    runFirmwareUpdate,
    waitForFirmwareUpdateVersion,
  };
}
