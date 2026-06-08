export function createConnectionMemoryService({
  storage,
  storageArea,
  historyStore,
  normalizeWebSocketUrl,
  wsDisplayName,
  normalizePeerId,
  readUsbHint,
  isMqttKind,
  isWebRtcKind,
  setConnectionIntentWanted,
  currentDeviceDisplayName,
  setWebSocketInput,
  setPeerInput,
  renderConnectionHistory,
  refreshKnownUsbPorts,
} = {}) {
  function rememberActiveConnection(kind, options = {}) {
    storageArea.setItem(storage.lastConnection, kind);

    if (kind === "websocket" && options.url) {
      storageArea.setItem(storage.wsUrl, normalizeWebSocketUrl(options.url));
    }

    if ((isMqttKind(kind) || isWebRtcKind(kind)) && options.remoteId) {
      storageArea.setItem(storage.peerId, normalizePeerId(options.remoteId));
    }

    if (kind === "usb") {
      const hint = readUsbHint();
      if (hint) storageArea.setItem(storage.usbHint, JSON.stringify(hint));
    }
  }

  function rememberSuccessfulConnection(kind, label, options = {}) {
    storageArea.setItem(storage.lastConnection, kind);
    setConnectionIntentWanted(true);
    const friendlyLabel = currentDeviceDisplayName() || label;

    if (kind === "websocket" && options.url) {
      const url = normalizeWebSocketUrl(options.url);
      storageArea.setItem(storage.wsUrl, url);
      const displayLabel = friendlyLabel || wsDisplayName(url);
      storageArea.setItem(storage.wsName, displayLabel);
      historyStore.rememberWebSocketHistory(url, displayLabel);
      setWebSocketInput(url);
      renderConnectionHistory();
    }

    if ((isMqttKind(kind) || isWebRtcKind(kind)) && options.remoteId) {
      const peerId = normalizePeerId(options.remoteId);
      storageArea.setItem(storage.peerId, peerId);
      historyStore.rememberPeerHistory(peerId, friendlyLabel || peerId, isMqttKind(kind) ? "mqtt" : "webrtc", options.mqttConfig);
      setPeerInput(peerId);
      renderConnectionHistory();
    }

    if (kind === "usb") {
      const hint = readUsbHint();
      if (hint) historyStore.rememberUsbHistory(hint);
      refreshKnownUsbPorts();
      renderConnectionHistory();
    }
  }

  function migrateConnectionHistory() {
    if (!historyStore.readWebSocketHistory().length) {
      const url = storageArea.getItem(storage.wsUrl) || "";
      if (url) {
        try {
          historyStore.rememberWebSocketHistory(url, storageArea.getItem(storage.wsName) || wsDisplayName(url));
        } catch {}
      }
    }

    if (!historyStore.readPeerHistory().length) {
      const peerId = normalizePeerId(storageArea.getItem(storage.peerId) || "");
      if (peerId) historyStore.rememberPeerHistory(peerId, peerId);
    }

    if (!historyStore.readUsbHistory().length) {
      const hint = readUsbHint();
      if (hint) historyStore.rememberUsbHistory(hint);
    }
  }

  return {
    migrateConnectionHistory,
    rememberActiveConnection,
    rememberSuccessfulConnection,
  };
}
