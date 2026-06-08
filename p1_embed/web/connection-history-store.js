export function createConnectionHistoryStore({
  keys,
  limit = 12,
  normalizeWebSocketUrl,
  webSocketDisplayName,
  normalizePeerId,
  isMqttKind,
  normalizeMqttHistoryConfig,
  mqttConfigFromStorageAndDevice,
  normalizeUsbHint,
  usbHintLabel,
} = {}) {
  function readArray(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeArray(key, entries) {
    localStorage.setItem(key, JSON.stringify(entries.slice(0, limit)));
  }

  function readWebSocketHistory() {
    return readArray(keys.ws)
      .map((entry) => {
        try {
          const url = normalizeWebSocketUrl(entry.url || "");
          return {
            kind: "websocket",
            url,
            label: entry.label || webSocketDisplayName(url),
            at: Number(entry.at) || 0,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function writeWebSocketHistory(entries) {
    writeArray(keys.ws, entries.map((entry) => ({
      kind: "websocket",
      url: normalizeWebSocketUrl(entry.url),
      label: entry.label || webSocketDisplayName(entry.url),
      at: Number(entry.at) || Date.now(),
    })));
  }

  function rememberWebSocketHistory(url, label = "") {
    const normalized = normalizeWebSocketUrl(url);
    const next = [
      { kind: "websocket", url: normalized, label: label || webSocketDisplayName(normalized), at: Date.now() },
      ...readWebSocketHistory().filter((entry) => normalizeWebSocketUrl(entry.url) !== normalized),
    ];
    writeWebSocketHistory(next);
  }

  function readPeerHistory() {
    return readArray(keys.peer)
      .map((entry) => {
        const peerId = normalizePeerId(entry.peerId || entry.id || entry);
        if (!peerId) return null;
        const kind = isMqttKind(entry.kind) ? "mqtt" : "webrtc";
        return {
          kind,
          peerId,
          label: entry.label || peerId,
          mqtt: kind === "mqtt" ? normalizeMqttHistoryConfig(entry.mqtt || entry) : null,
          at: Number(entry.at) || 0,
        };
      })
      .filter(Boolean);
  }

  function writePeerHistory(entries) {
    writeArray(keys.peer, entries.map((entry) => {
      const peerId = normalizePeerId(entry.peerId);
      const kind = isMqttKind(entry.kind) ? "mqtt" : "webrtc";
      return {
        kind,
        peerId,
        label: entry.label || peerId,
        mqtt: kind === "mqtt" ? normalizeMqttHistoryConfig(entry.mqtt || entry) : null,
        at: Number(entry.at) || Date.now(),
      };
    }).filter((entry) => entry.peerId));
  }

  function rememberPeerHistory(peerId, label = "", kind = "webrtc", mqttConfig = null) {
    const normalized = normalizePeerId(peerId);
    if (!normalized) return;
    const normalizedKind = isMqttKind(kind) ? "mqtt" : "webrtc";
    const entry = { kind: normalizedKind, peerId: normalized, label: label || normalized, at: Date.now() };
    if (normalizedKind === "mqtt") entry.mqtt = normalizeMqttHistoryConfig(mqttConfig || mqttConfigFromStorageAndDevice());
    const next = [
      entry,
      ...readPeerHistory().filter((entry) => !(normalizePeerId(entry.peerId) === normalized && entry.kind === normalizedKind)),
    ];
    writePeerHistory(next);
  }

  function readUsbHistory() {
    return readArray(keys.usb)
      .map((entry) => {
        const hint = normalizeUsbHint(entry.hint || entry);
        if (!hint) return null;
        return {
          kind: "usb",
          hint,
          label: entry.label || usbHintLabel(hint),
          at: Number(entry.at) || 0,
        };
      })
      .filter(Boolean);
  }

  function writeUsbHistory(entries) {
    writeArray(keys.usb, entries.map((entry) => ({
      kind: "usb",
      hint: normalizeUsbHint(entry.hint),
      label: entry.label || usbHintLabel(entry.hint),
      at: Number(entry.at) || Date.now(),
    })).filter((entry) => entry.hint));
  }

  function rememberUsbHistory(hint) {
    const normalized = normalizeUsbHint(hint);
    if (!normalized) return;
    const key = usbHistoryKey(normalized);
    const next = [
      { kind: "usb", hint: normalized, label: usbHintLabel(normalized), at: Date.now() },
      ...readUsbHistory().filter((entry) => usbHistoryKey(entry.hint) !== key),
    ];
    writeUsbHistory(next);
  }

  function usbHistoryKey(hint) {
    const normalized = normalizeUsbHint(hint);
    return normalized ? `${normalized.usbVendorId}:${normalized.usbProductId}` : "";
  }

  return {
    readPeerHistory,
    readUsbHistory,
    readWebSocketHistory,
    rememberPeerHistory,
    rememberUsbHistory,
    rememberWebSocketHistory,
    usbHistoryKey,
    writePeerHistory,
    writeUsbHistory,
    writeWebSocketHistory,
  };
}
