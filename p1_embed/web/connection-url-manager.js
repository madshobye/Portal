const connectionUrlParams = [
  "connect",
  "transport",
  "ws",
  "url",
  "peer",
  "id",
  "device",
  "usb",
  "vid",
  "pid",
  "mqttHost",
  "mqttPort",
  "mqttRoot",
  "mqttUser",
  "guest",
  "guestKey",
  "key",
];

export function createConnectionUrlManager({
  normalizeWebSocketUrl,
  normalizePeerId,
  normalizeUsbHint,
  mqttConfig,
  isMqttKind,
  isWebRtcKind,
  readUsbHint,
} = {}) {
  function clearParams(url) {
    connectionUrlParams.forEach((name) => url.searchParams.delete(name));
  }

  function sharePageUrl(kind, wsUrl = "", usbHint = null, peerId = "") {
    const url = new URL(window.location.href);
    clearParams(url);

    if (kind === "websocket") {
      url.searchParams.set("connect", "ws");
      url.searchParams.set("ws", normalizeWebSocketUrl(wsUrl));
    } else if (isMqttKind(kind)) {
      url.searchParams.set("connect", "mqtt");
      url.searchParams.set("peer", normalizePeerId(peerId));
      const cfg = mqttConfig();
      if (cfg.mqttHost) url.searchParams.set("mqttHost", cfg.mqttHost);
      if (cfg.mqttPort) url.searchParams.set("mqttPort", String(cfg.mqttPort));
      if (cfg.mqttRoot) url.searchParams.set("mqttRoot", cfg.mqttRoot);
      if (cfg.mqttUser) url.searchParams.set("mqttUser", cfg.mqttUser);
    } else if (isWebRtcKind(kind)) {
      url.searchParams.set("connect", "webrtc");
      url.searchParams.set("peer", normalizePeerId(peerId));
    } else if (kind === "usb") {
      url.searchParams.set("connect", "usb");
      const hint = normalizeUsbHint(usbHint || readUsbHint());
      if (hint) {
        const vid = hint.usbVendorId.toString(16).padStart(4, "0");
        const pid = hint.usbProductId.toString(16).padStart(4, "0");
        url.searchParams.set("usb", `${vid}:${pid}`);
      }
    }

    return url.toString();
  }

  function updateParams(kind, wsUrl = "", usbHint = null, peerId = "") {
    if (!window.history?.replaceState) return;
    window.history.replaceState(null, "", sharePageUrl(kind, wsUrl, usbHint, peerId));
  }

  function clearCurrentParams() {
    if (!window.history?.replaceState) return;
    const url = new URL(window.location.href);
    clearParams(url);
    window.history.replaceState(null, "", url.toString());
  }

  return {
    clearCurrentParams,
    sharePageUrl,
    updateParams,
  };
}
