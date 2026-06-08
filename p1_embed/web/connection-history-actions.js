export function createConnectionHistoryActions({
  storage,
  storageArea,
  historyStore,
  normalizeWebSocketUrl,
  normalizePeerId,
  readUsbHint,
  isMqttKind,
  isWebRtcKind,
  setConnectionIntentWanted,
} = {}) {
  function forgetConnectionHistoryItem(item) {
    if (item.kind === "websocket") {
      forgetWebSocket(item);
    } else if (isMqttKind(item.kind) || isWebRtcKind(item.kind)) {
      forgetPeer(item);
    } else {
      forgetUsb(item);
    }

    if (!historyStore.readPeerHistory().length && !historyStore.readWebSocketHistory().length && !historyStore.readUsbHistory().length) {
      storageArea.removeItem(storage.lastConnection);
      setConnectionIntentWanted(false);
    }
  }

  function forgetWebSocket(item) {
    const url = normalizeWebSocketUrl(item.url);
    historyStore.writeWebSocketHistory(historyStore.readWebSocketHistory().filter((entry) => normalizeWebSocketUrl(entry.url) !== url));
    if (storageArea.getItem(storage.wsUrl) === url) {
      const next = historyStore.readWebSocketHistory()[0];
      if (next) {
        storageArea.setItem(storage.wsUrl, next.url);
        storageArea.setItem(storage.wsName, next.label);
      } else {
        storageArea.removeItem(storage.wsUrl);
        storageArea.removeItem(storage.wsName);
      }
    }
  }

  function forgetPeer(item) {
    const peerId = normalizePeerId(item.peerId);
    historyStore.writePeerHistory(historyStore.readPeerHistory().filter((entry) => normalizePeerId(entry.peerId) !== peerId));
    if (normalizePeerId(storageArea.getItem(storage.peerId)) === peerId) {
      const next = historyStore.readPeerHistory()[0];
      if (next) storageArea.setItem(storage.peerId, next.peerId);
      else storageArea.removeItem(storage.peerId);
    }
  }

  function forgetUsb(item) {
    const key = historyStore.usbHistoryKey(item.hint);
    historyStore.writeUsbHistory(historyStore.readUsbHistory().filter((entry) => historyStore.usbHistoryKey(entry.hint) !== key));
    if (historyStore.usbHistoryKey(readUsbHint()) === key) {
      const next = historyStore.readUsbHistory()[0];
      if (next) storageArea.setItem(storage.usbHint, JSON.stringify(next.hint));
      else storageArea.removeItem(storage.usbHint);
    }
  }

  return { forgetConnectionHistoryItem };
}
