import { generateGuestKey, guinoShareUrl } from "./guino-share-link.js?v=0.1.87-ui749";

export function createGuinoShellService({
  getTransport,
  getPeerInputValue,
  getWebRtcPeerId,
  getWebSocketUrl,
  getLastConfig,
  getClient,
  isDeviceConnected,
  normalizePeerId,
  isMqttKind,
  isWebRtcKind,
  readUsbHint,
  sharePageUrl,
  sendCommand,
  updateConfig,
  copyText,
  logLine,
} = {}) {
  async function copyLink() {
    try {
      const url = await shareUrl();
      await copyText(url);
      logLine("info", "UI link copied");
    } catch (error) {
      logLine("warn", `UI link not ready: ${error.message}`);
    }
  }

  async function shareUrl() {
    const transport = getTransport();
    return await guinoShareUrl({
      transport,
      peerInputValue: getPeerInputValue(),
      webRtcPeerId: getWebRtcPeerId(),
      websocketUrl: getWebSocketUrl(),
      normalizePeerId,
      isMqttKind,
      isWebRtcKind,
      readUsbHint,
      sharePageUrl,
      ensureGuestKey,
    });
  }

  async function ensureGuestKey() {
    const lastConfig = getLastConfig();
    if (!lastConfig?.mqttAllowAnonymousUi) return "";
    const existing = String(lastConfig?.mqttGuestUiKey || "").trim();
    if (existing.length >= 16) return existing;
    if (!getClient() || !isDeviceConnected()) return "";
    const key = generateGuestKey();
    const config = await sendCommand("config.set", { mqttGuestUiKey: key, mqttAllowAnonymousUi: true }, { quiet: true, timeoutMs: 10000 });
    updateConfig(config);
    return String(config?.mqttGuestUiKey || key).trim();
  }

  return {
    copyLink,
    ensureGuestKey,
    shareUrl,
  };
}
