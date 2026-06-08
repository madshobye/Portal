export function isWebRtcKind(kind) {
  return kind === "webrtc" || kind === "peerjs";
}

export function isMqttKind(kind) {
  return kind === "mqtt";
}

export function isConnectionKindAvailable(kind, {
  enableWebSocket = false,
  enableWebRtc = false,
} = {}) {
  if (kind === "usb") return "serial" in navigator;
  if (isMqttKind(kind)) return "mqtt" in window;
  if (isWebRtcKind(kind)) return enableWebRtc && ("RTCPeerConnection" in window) && ("mqtt" in window);
  if (kind === "websocket") return enableWebSocket && "WebSocket" in window;
  return false;
}

export function connectionKindLabel(kind) {
  if (kind === "usb") return "USB";
  if (isMqttKind(kind)) return "MQTT";
  if (isWebRtcKind(kind)) return "WebRTC";
  return "WebSocket";
}

export function connectionKindIcon(kind) {
  if (kind === "usb") return "settings_input_component";
  if (isMqttKind(kind)) return "cloud";
  if (isWebRtcKind(kind)) return "hub";
  return "lan";
}
