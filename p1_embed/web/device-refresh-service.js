export function createDeviceRefreshService({
  windowRef,
  getClient,
  getTransport,
  isBusy,
  sendCommand,
  setLastInfo,
  updateStatus,
  renderFields,
} = {}) {
  let statusTimer = null;

  function startStatusPolling() {
    stopStatusPolling();
    statusTimer = windowRef.setInterval(async () => {
      if (!getClient() || isBusy()) return;
      try {
        const guestUi = Boolean(getTransport()?.isGuestUiOpen?.());
        await refreshStatus({ quiet: true, timeoutMs: 6000, live: !guestUi, light: guestUi });
      } catch {
      }
    }, 5000);
  }

  function stopStatusPolling() {
    if (!statusTimer) return;
    windowRef.clearInterval(statusTimer);
    statusTimer = null;
  }

  async function refreshInfo(options = {}) {
    const data = await sendCommand("system.info", {}, options);
    setLastInfo(data);
    renderFields();
    return data;
  }

  async function refreshStatus(options = {}) {
    const { full = false, light = false, ...requestOptions } = options;
    delete requestOptions.live;
    const command = light ? "status.light" : (full ? "status.full" : "status.live");
    const data = await sendCommand(command, {}, requestOptions);
    updateStatus(data);
    renderFields();
    return data;
  }

  return {
    refreshInfo,
    refreshStatus,
    startStatusPolling,
    stopStatusPolling,
  };
}
