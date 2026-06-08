export function createInfoPanelController({
  renderer,
  webVersion,
  getLastInfo,
  getLastStatus,
  getLastConfig,
  getScriptStateText,
  hasClient,
  getTransport,
  readUsbHint,
  sharePageUrl,
  renderFirmwareUpdatePanel,
  formatDuration,
  isConnectionKindAvailable,
  isScriptRunning,
  scriptStatusLabel,
  memoryStatusLabel,
  scriptRuntimeLabel,
  wrenchFpsLabel,
  wifiSignalLabel,
  mqttSharePeerId,
  activePeerId,
  copyText,
  logLine,
} = {}) {
  let currentShareUrl = "";

  function render() {
    const lastInfo = getLastInfo();
    const lastStatus = getLastStatus();
    const lastConfig = getLastConfig();
    const wifi = lastStatus?.wifi || {};
    const mqtt = lastStatus?.mqtt || {};
    const scriptRunning = isScriptRunning();
    const peerId = hasClient() ? activePeerId(lastStatus?.webrtc || {}, mqtt) : "";
    const shareTarget = bestInfoShareTarget({ mqtt });
    const shareUrl = shareTarget ? sharePageUrl(shareTarget.kind, shareTarget.wsUrl, shareTarget.usbHint, shareTarget.peerId) : "";
    currentShareUrl = shareUrl;

    renderBrand(lastInfo);
    renderFirmwareUpdatePanel();
    renderer.renderShare(shareUrl);
    renderer.renderCards([
      { icon: "developer_board", title: lastInfo?.deviceName || lastStatus?.deviceName || "P1.E board", metrics: [
        metric("Firmware", [lastInfo?.firmwareName, lastInfo?.firmwareVersion].filter(Boolean).join(" ") || "-"),
        metric("Uptime", formatDuration(lastStatus?.uptimeMs) || "-"),
        metric("Time", lastStatus?.timeSynced ? lastStatus.localTime || "-" : "not synced"),
        metric("Timezone", lastStatus?.timezone || lastConfig?.timezone || "-"),
      ] },
      { icon: scriptRunning ? "play_circle" : "stop_circle", title: scriptStatusLabel(), metrics: [
        metric("Script", compactScriptLabel()),
        metric("Speed", wrenchFpsLabel() || "-"),
        metric("Loop", scriptRunning ? (lastStatus?.wrenchLoopCount ?? "-") : "-"),
      ] },
      { icon: "memory", title: memoryStatusLabel() || "Memory", metrics: [
        metric("Free heap", lastStatus?.freeHeap ? `${lastStatus.freeHeap} bytes` : "-"),
        metric("Max alloc", lastStatus?.maxAllocHeap ? `${lastStatus.maxAllocHeap} bytes` : "-"),
        metric("Worker", scriptRuntimeLabel() || "-"),
        metric("Protocol", lastInfo?.protocolVersion || "-"),
      ], options: { compact: true } },
      { icon: "share", title: "Connect", metrics: [
        metric("WiFi name", wifi.connected ? wifi.ssid || "connected" : "offline"),
        metric("IP", wifi.ip || "-"),
        metric("Signal", wifiSignalLabel(wifi)),
        metric("MQTT", mqttSharePeerId(mqtt) || "-"),
        metric("Share", shareUrl || "-"),
      ], options: { compact: true, links: { peerId: mqttSharePeerId(mqtt) || peerId, shareUrl } } },
    ]);
  }

  function renderBrand(lastInfo = null) {
    renderer.renderBrand({
      webVersion,
      firmwareVersion: lastInfo?.firmwareVersion || "",
    });
  }

  function bestInfoShareTarget({ mqtt = {} } = {}) {
    const mqttPeer = mqttSharePeerId(mqtt);
    if (mqttPeer && isConnectionKindAvailable("mqtt")) {
      return { kind: "mqtt", peerId: mqttPeer };
    }
    if (getTransport()?.kind === "usb" && isConnectionKindAvailable("usb")) {
      return { kind: "usb", usbHint: readUsbHint() };
    }
    return null;
  }

  function metric(label, value) {
    return renderer.metric(label, value);
  }

  function compactScriptLabel() {
    const state = String(getScriptStateText() || "");
    return state.replace(/\s*\/\s*/g, " / ") || "-";
  }

  async function copyShareLink() {
    if (!currentShareUrl) return;
    try {
      await copyText(currentShareUrl);
      logLine("info", "share link copied");
    } catch (error) {
      logLine("error", error.message || "copy failed");
    }
  }

  return {
    copyShareLink,
    render,
  };
}
