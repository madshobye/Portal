export function createConnectionStartupService({
  getClient,
  getTransport,
  getGeneration,
  refreshInfo,
  refreshStatus,
  getScript,
  sendCommand,
  updateConfig,
  readStoredLogLevel,
  readRequestedLogLevel,
  writeRequestedLogLevel,
  settle,
  logLine,
} = {}) {
  async function startupRefresh({ quiet = false, includeScript = true, timeoutMs = 15000, attempts = 1, retryDelayMs = 450, expectedGeneration = null } = {}) {
    const maxAttempts = Math.max(1, Number(attempts) || 1);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const logAttempt = attempt === maxAttempts ? quiet : true;
      const verified = await startupRefreshOnce({ quiet: logAttempt, includeScript, timeoutMs, expectedGeneration });
      if (verified) return true;
      if (expectedGeneration !== null && expectedGeneration !== getGeneration()) return false;
      if (attempt < maxAttempts) await settle(retryDelayMs);
    }
    return false;
  }

  async function startupRefreshOnce({ quiet = false, includeScript = true, timeoutMs = 15000, expectedGeneration = null } = {}) {
    const stale = () => expectedGeneration !== null && expectedGeneration !== getGeneration();
    if (stale()) return false;
    const infoOk = await bestEffortStartupStep(() => refreshInfo({ quiet, timeoutMs }), quiet);
    if (!getClient() || stale()) return false;
    const guestUi = Boolean(getTransport()?.isGuestUiOpen?.());
    const statusOk = await bestEffortStartupStep(() => refreshStatus({ quiet, timeoutMs, full: !guestUi, light: guestUi }), quiet);
    if (!getClient() || stale()) return infoOk || statusOk;
    if (!infoOk && !statusOk) return false;
    if (getTransport()?.isGuestUiOpen?.()) return infoOk || statusOk;
    await bestEffortStartupStep(() => syncDeviceEventLevel({ quiet, timeoutMs }), quiet);
    if (!getClient() || stale()) return infoOk || statusOk;
    await bestEffortStartupStep(() => sendCommand("config.get", {}, { quiet, timeoutMs }).then(updateConfig), quiet);
    if (!getClient() || stale()) return infoOk || statusOk;
    if (includeScript) {
      const scriptOk = await startupScriptSync({ quiet, timeoutMs });
      if (!getClient() || stale()) return false;
      if (!scriptOk) return false;
    }
    return infoOk || statusOk;
  }

  async function startupScriptSync({ quiet = false, timeoutMs = 15000 } = {}) {
    try {
      if (!quiet) logLine("debug", "startup: downloading board sketch");
      await getScript({ quiet, timeoutMs });
      return true;
    } catch (error) {
      if (!quiet) logLine("warn", `startup script sync failed: ${error.message || error}`);
      return false;
    }
  }

  async function syncDeviceEventLevel({ quiet = false, timeoutMs = 15000 } = {}) {
    const data = await sendCommand("debug.get", {}, { quiet, timeoutMs });
    const deviceLevel = data.levelName || data.level || "";
    if (deviceLevel && !readStoredLogLevel()) {
      writeRequestedLogLevel(deviceLevel);
    }
    const requestedLevel = readRequestedLogLevel() || "info";
    await sendCommand("debug.set", { level: requestedLevel }, { quiet, timeoutMs });
  }

  async function bestEffortStartupStep(action, quiet) {
    try {
      await action();
      return true;
    } catch (error) {
      if (error.code === "request_canceled") return false;
      if (!quiet) logLine("warn", `startup: ${error.message}`);
      return false;
    }
  }

  return {
    bestEffortStartupStep,
    startupRefresh,
    startupRefreshOnce,
    startupScriptSync,
    syncDeviceEventLevel,
  };
}
