export function createConnectionAddressService({
  storage,
  storageArea,
  windowRef,
  getConnectionHistoryStore,
  getConnectionUrlManager,
  normalizePeerId,
  defaultPeerIdFromWebSocket,
  normalizeUsbHint,
  usbHintFromParams,
  usbHintLabel,
  pickPortFromHint,
  normalizeWebSocketUrl,
  wsDisplayName,
  isLoopbackHost,
  logLine,
} = {}) {
  function readWebSocketHistory() {
    return getConnectionHistoryStore().readWebSocketHistory();
  }

  function readPeerHistory() {
    return getConnectionHistoryStore().readPeerHistory();
  }

  function readUsbHistory() {
    return getConnectionHistoryStore().readUsbHistory();
  }

  function usbHistoryKey(hint) {
    return getConnectionHistoryStore().usbHistoryKey(hint);
  }

  function readUsbHint() {
    try {
      const raw = storageArea.getItem(storage.usbHint);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function warnIfPlainWebSocketFromSecurePage(url) {
    if (windowRef.location.protocol !== "https:") return;
    try {
      const parsed = new URL(normalizeWebSocketUrl(url));
      if (parsed.protocol !== "ws:") return;
      if (isLoopbackHost(parsed.hostname)) return;
      logLine("warn", "HTTPS pages can be blocked from opening local ws:// device links on iOS/WebKit. Open this UI from an http:// page on the same network, or use WSS when the firmware supports it.");
    } catch {
    }
  }

  function sharePageUrl(kind, wsUrl = "", usbHint = null, peerId = "") {
    return getConnectionUrlManager().sharePageUrl(kind, wsUrl, usbHint, peerId);
  }

  function updateConnectionUrlParams(kind, wsUrl = "", usbHint = null, peerId = "") {
    getConnectionUrlManager().updateParams(kind, wsUrl, usbHint, peerId);
  }

  function clearConnectionUrlParams() {
    getConnectionUrlManager().clearCurrentParams();
  }

  return {
    clearConnectionUrlParams,
    defaultPeerIdFromWebSocket,
    isLoopbackHost,
    normalizePeerId,
    normalizeUsbHint,
    normalizeWebSocketUrl,
    pickPortFromHint,
    readPeerHistory,
    readUsbHint,
    readUsbHistory,
    readWebSocketHistory,
    sharePageUrl,
    updateConnectionUrlParams,
    usbHintFromParams,
    usbHintLabel,
    usbHistoryKey,
    warnIfPlainWebSocketFromSecurePage,
    wsDisplayName,
  };
}
