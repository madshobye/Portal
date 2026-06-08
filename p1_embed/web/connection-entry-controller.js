export function createConnectionEntryController({
  fields,
  storage,
  storageArea,
  windowRef,
  documentRef,
  navigatorRef,
  WebSocketTransport,
  WebSerialTransport,
  MqttTransport,
  MqttWebRtcTransport,
  normalizeWebSocketUrl,
  warnIfPlainWebSocketFromSecurePage,
  wsDisplayName,
  normalizePeerId,
  connectTransport,
  renderConnectionHistory,
  refreshKnownUsbPorts,
  usbStartupOptions,
  mqttConfigFromStorageAndDevice,
  mqttTransportOptions,
  applyMqttConfig,
  applyMqttParams,
  usbHintFromParams,
  readUsbHint,
  markConnectionAttemptFailed,
  setReconnectAfterReturn,
  setReconnectAfterReturnAttempted,
  logLine,
} = {}) {
  async function connectWebSocket(value) {
    const url = normalizeWebSocketUrl(value);
    warnIfPlainWebSocketFromSecurePage(url);
    await connectTransport(new WebSocketTransport(), { url }, "websocket", wsDisplayName(url));
    fields.websocketUrl.value = url;
    renderConnectionHistory();
  }

  async function connectPeerJs(value) {
    const peerId = normalizePeerId(value);
    if (!peerId) {
      logLine("warn", "WebRTC device id is required");
      return;
    }
    await connectTransport(new MqttWebRtcTransport({ connectTimeoutMs: 90000 }), { remoteId: peerId }, "webrtc", peerId, { startupTimeoutMs: 30000 });
    fields.peerId.value = peerId;
    renderConnectionHistory();
  }

  async function connectMqtt(value, mqttConfig = null) {
    const peerId = normalizePeerId(value);
    if (!peerId) {
      logLine("warn", "MQTT device id is required");
      return;
    }
    if (mqttConfig) applyMqttConfig(mqttConfig);
    const historyConfig = mqttConfigFromStorageAndDevice();
    await connectTransport(new MqttTransport({ ...mqttTransportOptions(historyConfig), connectTimeoutMs: 15000 }), { remoteId: peerId, mqttConfig: historyConfig }, "mqtt", peerId, { startupTimeoutMs: 15000 });
    fields.peerId.value = peerId;
    renderConnectionHistory();
  }

  async function connectUsb() {
    await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), {}, "usb", "USB", usbStartupOptions());
    await refreshKnownUsbPorts();
    renderConnectionHistory();
  }

  async function connectRecentUsb(hint = null) {
    if (hint) storageArea.setItem(storage.usbHint, JSON.stringify(hint));
    await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), { pickPort: false }, "usb", "USB", usbStartupOptions());
    await refreshKnownUsbPorts();
    renderConnectionHistory();
  }

  function isGuestUiLink(params = new URLSearchParams(windowRef.location.search)) {
    return String(params.get("guest") || "").toLowerCase() === "ui"
      || String(params.get("mode") || "").toLowerCase() === "guest-ui";
  }

  function guestKeyFromParams(params = new URLSearchParams(windowRef.location.search)) {
    return String(params.get("guestKey") || params.get("key") || "").trim();
  }

  function applyGuestUiShell() {
    const params = new URLSearchParams(windowRef.location.search);
    documentRef.body.classList.toggle("is-guest-ui", isGuestUiLink(params));
  }

  async function autoConnectFromUrlParams() {
    const params = new URLSearchParams(windowRef.location.search);
    const requested = (params.get("connect") || params.get("transport") || "").toLowerCase();
    if (!requested) return false;
    setReconnectAfterReturn(false);
    setReconnectAfterReturnAttempted(false);

    if (requested === "ws" || requested === "websocket") {
      const value = params.get("ws") || params.get("url") || "";
      if (!value) {
        logLine("warn", "connect=ws is missing a ws URL");
        markConnectionAttemptFailed();
        return true;
      }
      try {
        const url = normalizeWebSocketUrl(value);
        fields.websocketUrl.value = url;
        warnIfPlainWebSocketFromSecurePage(url);
        await connectTransport(new WebSocketTransport(), { url }, "websocket", wsDisplayName(url), { lightStartup: true, includeScript: true, preserveUrl: true });
      } catch (error) {
        logLine("error", error.message);
      }
      return true;
    }

    if (requested === "mqtt") {
      const peerId = normalizePeerId(params.get("peer") || params.get("id") || params.get("device") || "");
      if (!peerId) {
        logLine("warn", "connect=mqtt needs a device id");
        markConnectionAttemptFailed();
        return true;
      }
      try {
        applyMqttParams(params);
        fields.peerId.value = peerId;
        const historyConfig = mqttConfigFromStorageAndDevice();
        const guestUi = isGuestUiLink(params);
        await connectTransport(
          new MqttTransport({
            ...mqttTransportOptions(historyConfig),
            connectTimeoutMs: 15000,
            authMode: guestUi ? "guest-ui" : "control",
            guestKey: guestUi ? guestKeyFromParams(params) : "",
          }),
          { remoteId: peerId, mqttConfig: historyConfig },
          "mqtt",
          peerId,
          { lightStartup: true, includeScript: !guestUi, startupTimeoutMs: 15000, preserveUrl: true },
        );
      } catch (error) {
        logLine("error", error.message);
      }
      return true;
    }

    if (requested === "peer" || requested === "peerjs" || requested === "webrtc") {
      const peerId = normalizePeerId(params.get("peer") || params.get("id") || params.get("device") || "");
      if (!peerId) {
        logLine("warn", "connect=webrtc needs a WebRTC device id");
        markConnectionAttemptFailed();
        return true;
      }
      try {
        fields.peerId.value = peerId;
        await connectTransport(new MqttWebRtcTransport({ connectTimeoutMs: 90000 }), { remoteId: peerId }, "webrtc", peerId, { lightStartup: true, includeScript: true, startupTimeoutMs: 30000, preserveUrl: true });
      } catch (error) {
        logLine("error", error.message);
      }
      return true;
    }

    if (requested === "usb" || requested === "serial") {
      if (!("serial" in navigatorRef)) {
        logLine("warn", "connect=usb needs Web Serial");
        markConnectionAttemptFailed();
        return true;
      }
      const urlHint = usbHintFromParams(params);
      if (urlHint) storageArea.setItem(storage.usbHint, JSON.stringify(urlHint));
      if (!readUsbHint()) {
        logLine("warn", "connect=usb needs a previously approved USB device in this browser");
        markConnectionAttemptFailed();
        return true;
      }
      try {
        await connectTransport(new WebSerialTransport({ storageKey: storage.usbHint }), { pickPort: false }, "usb", "USB", usbStartupOptions({ includeScript: true, preserveUrl: true }));
        await refreshKnownUsbPorts();
      } catch (error) {
        logLine("error", error.message);
      }
      return true;
    }

    logLine("warn", `Unsupported connect target: ${requested}`);
    markConnectionAttemptFailed();
    return true;
  }

  return {
    applyGuestUiShell,
    autoConnectFromUrlParams,
    connectMqtt,
    connectPeerJs,
    connectRecentUsb,
    connectUsb,
    connectWebSocket,
  };
}
