export function createConnectionReconnectService({
  storage,
  storageArea,
  navigatorRef,
  windowRef,
  getClient,
  isBusy,
  connectionIntentWanted,
  connectTransport,
  refreshKnownUsbPorts,
  readUsbHint,
  normalizePeerId,
  wsDisplayName,
  mqttConfigFromStorageAndDevice,
  mqttTransportOptions,
  usbStartupOptions,
  isMqttKind,
  isWebRtcKind,
  createWebSocketTransport,
  createMqttTransport,
  createMqttWebRtcTransport,
  createWebSerialTransport,
} = {}) {
  async function autoReconnectLastConnection({ reconnecting = false } = {}) {
    const last = storageArea.getItem(storage.lastConnection);
    if (getClient() || isBusy() || !last || !connectionIntentWanted()) return;
    const reconnectOptions = reconnecting ? { quiet: false, busyLabelText: "reconnecting" } : { quiet: true };

    if (last === "websocket") {
      const url = storageArea.getItem(storage.wsUrl) || "";
      if (!url) return;
      await connectTransport(createWebSocketTransport(), { url }, "websocket", wsDisplayName(url), { ...reconnectOptions, lightStartup: true, includeScript: true });
      return;
    }

    if (isMqttKind(last)) {
      const peerId = normalizePeerId(storageArea.getItem(storage.peerId) || "");
      if (!peerId || !("mqtt" in windowRef)) return;
      await connectTransport(createMqttTransport({ ...mqttTransportOptions(), connectTimeoutMs: 15000 }), { remoteId: peerId, mqttConfig: mqttConfigFromStorageAndDevice() }, "mqtt", peerId, { ...reconnectOptions, lightStartup: true, includeScript: true, startupTimeoutMs: 15000 });
      return;
    }

    if (isWebRtcKind(last)) {
      const peerId = normalizePeerId(storageArea.getItem(storage.peerId) || "");
      if (!peerId || !(("RTCPeerConnection" in windowRef) && ("mqtt" in windowRef))) return;
      await connectTransport(createMqttWebRtcTransport({ connectTimeoutMs: 90000 }), { remoteId: peerId }, "webrtc", peerId, { ...reconnectOptions, lightStartup: true, includeScript: true, startupTimeoutMs: 30000 });
      return;
    }

    if (last === "usb") {
      if (!("serial" in navigatorRef) || !readUsbHint()) return;
      await connectTransport(createWebSerialTransport({ storageKey: storage.usbHint }), { pickPort: false }, "usb", "USB", usbStartupOptions({ ...reconnectOptions, includeScript: true }));
      await refreshKnownUsbPorts();
    }
  }

  return {
    autoReconnectLastConnection,
  };
}
