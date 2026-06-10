export function generateGuestKey() {
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (!bytes.some(Boolean)) {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function guinoShareUrl({
  transport,
  peerInputValue = "",
  webRtcPeerId = "",
  websocketUrl = "",
  normalizePeerId,
  isMqttKind,
  isWebRtcKind,
  readUsbHint,
  sharePageUrl,
  ensureGuestKey,
} = {}) {
  const activeKind = transport?.kind || "";
  const peerId = normalizePeerId(isMqttKind(activeKind) || isWebRtcKind(activeKind)
    ? transport?.remoteId || peerInputValue || webRtcPeerId || ""
    : peerInputValue || webRtcPeerId || "");
  const hint = activeKind === "usb" ? readUsbHint() : null;
  const kind = activeKind === "usb"
    ? "usb"
    : isMqttKind(activeKind)
      ? "mqtt"
      : isWebRtcKind(activeKind)
        ? "webrtc"
        : peerId
          ? "mqtt"
          : "websocket";
  const url = new URL(sharePageUrl(kind, transport?.url || websocketUrl, hint, peerId));
  url.searchParams.set("view", "ui");
  url.searchParams.set("ui", "1");
  const guestKey = await ensureGuestKey();
  if (guestKey && isMqttKind(kind)) {
    url.searchParams.set("guest", "ui");
    url.searchParams.set("guestKey", guestKey);
  }
  return url.toString();
}
