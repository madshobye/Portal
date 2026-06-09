export function currentDeviceDisplayName({
  lastInfo = null,
  lastStatus = null,
  lastConfig = null,
  normalizePeerId,
} = {}) {
  const name = String(lastInfo?.deviceName || lastStatus?.deviceName || lastConfig?.deviceName || "").trim();
  if (!name) return "";
  const normalized = normalizePeerId(name);
  const id = normalizePeerId(lastInfo?.deviceId || lastStatus?.deviceId || lastConfig?.deviceId || "");
  if (id && normalized === id) return "";
  if (/^(?:xobit|p1-embed)-[0-9a-f]{6}$/i.test(name)) return "";
  if (/^p1-[0-9a-f: -]{6,}$/i.test(name)) return "";
  return name;
}

export function wifiSignalLabel(wifi = {}) {
  if (!wifi.connected) return "-";
  const rssi = Number(wifi.rssi);
  if (!Number.isFinite(rssi) || rssi === 0) return "connected";
  if (rssi >= -55) return `strong (${rssi} dBm)`;
  if (rssi >= -70) return `ok (${rssi} dBm)`;
  return `weak (${rssi} dBm)`;
}

export function scriptRuntimeLabel(lastStatus = {}) {
  const state = String(lastStatus?.scriptState || "").toLowerCase();
  if (state === "running") return "running";
  if (state === "compiled" || state === "stored") return "ready";
  if (state === "error") return "error";
  if (state === "empty") return "";
  if (state) return "stopped";
  return "";
}

export function wrenchFpsLabel(lastStatus = {}, isScriptRunning = false) {
  if (!isScriptRunning) return "";

  const fps = Number(lastStatus?.wrenchLoopFps);
  if (Number.isFinite(fps) && fps > 0) {
    return `${Math.round(fps)} fps`;
  }

  const loops = Number(lastStatus?.wrenchLoopCount);
  const uptimeMs = Number(lastStatus?.uptimeMs);
  if (Number.isFinite(loops) && loops > 0 && Number.isFinite(uptimeMs) && uptimeMs > 0) {
    return `${Math.round(loops / (uptimeMs / 1000))} fps avg`;
  }

  return "";
}

export function scriptStatusLabel(lastStatus = {}) {
  const runtime = lastStatus?.wrenchRuntime || {};
  if (runtime.transitionActive) return runtime.transitionReason ? `paused ${runtime.transitionReason}` : "paused";
  if (runtime.runPending) return "run pending";
  if (lastStatus?.wrenchLoopHung) return "loop hung";

  const state = lastStatus?.scriptState || "connected";
  if (state === "running") return "running";
  if (state === "stopped") return "stopped";
  if (state === "compiled") return "compiled";
  if (state === "empty") return "empty";
  if (state === "error") return "error";
  return state;
}

export function wifiStatusLabel(lastStatus = {}) {
  const wifi = lastStatus?.wifi;
  if (!wifi) return "";
  if (wifi.connected) return wifi.ssid ? `wifi ${wifi.ssid}` : "wifi ok";
  return `wifi ${wifi.state || "off"}`;
}

export function memoryStatusLabel({ lastStatus = null, lastInfo = null } = {}) {
  const free = Number(lastStatus?.freeHeap);
  const total = Number(lastStatus?.heapSize || lastInfo?.heapSize || 327680);
  if (Number.isFinite(free) && Number.isFinite(total) && total > 0) {
    const usedPct = Math.max(0, Math.min(100, Math.round((1 - free / total) * 100)));
    return `${usedPct}%`;
  }
  return "";
}

export function transportProtocolLabel(kind, { isMqttKind, isWebRtcKind } = {}) {
  if (isMqttKind(kind)) return "MQTT";
  if (isWebRtcKind(kind)) return "WebRTC";
  if (kind === "usb") return "USB";
  if (kind === "websocket") return "WS";
  return "";
}

export function mqttSharePeerId({ mqtt = {}, transport = null, normalizePeerId, isMqttKind } = {}) {
  if (isMqttKind(transport?.kind) && transport?.remoteId) return normalizePeerId(transport.remoteId);
  if ((mqtt?.connected || mqtt?.configured || mqtt?.begun) && mqtt.deviceId) return normalizePeerId(mqtt.deviceId);
  return "";
}

export function activeWebRtcSharePeerId({ webrtc = {}, transport = null, normalizePeerId, isWebRtcKind } = {}) {
  if (isWebRtcKind(transport?.kind) && transport?.remoteId) return normalizePeerId(transport.remoteId);
  return normalizePeerId(webrtc.peerId || "");
}

export function websocketUrlFromStatus({ web = {}, lastInfo = null, normalizeWebSocketUrl } = {}) {
  const host = web.host || lastInfo?.web?.host || "";
  if (!host) return "";
  const port = Number(web.port || lastInfo?.web?.port || 81);
  const hostWithPort = host.includes(":") ? host : `${host}:${Number.isFinite(port) ? port : 81}`;
  try {
    return normalizeWebSocketUrl(hostWithPort);
  } catch {
    return hostWithPort;
  }
}

export function activeWebSocketUrl({ web = {}, transport = null, normalizeWebSocketUrl, lastInfo = null } = {}) {
  if (transport?.kind === "websocket" && transport?.url) {
    try {
      return normalizeWebSocketUrl(transport.url);
    } catch {}
  }
  if (transport?.kind === "usb") return websocketUrlFromStatus({ web, lastInfo, normalizeWebSocketUrl });
  return "";
}

export function activePeerId({
  webrtc = {},
  mqtt = {},
  transport = null,
  normalizePeerId,
  isMqttKind,
  isWebRtcKind,
} = {}) {
  if ((isMqttKind(transport?.kind) || isWebRtcKind(transport?.kind)) && transport?.remoteId) return normalizePeerId(transport.remoteId);
  if (transport?.kind === "usb" || transport?.kind === "websocket") {
    if (mqtt.deviceId) return normalizePeerId(mqtt.deviceId);
    return normalizePeerId(webrtc.peerId || "");
  }
  return "";
}
