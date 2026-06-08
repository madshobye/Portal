export function uploadTextChunkEnvelopeBytes(kind = "") {
  if (kind === "usb") return 1600;
  if (kind === "websocket") return 1600;
  return 360;
}

export function uploadChunkPauseMs(kind = "", isMqttKind = () => false) {
  if (isMqttKind(kind)) return 0;
  if (kind === "usb") return 0;
  if (kind === "websocket") return 0;
  return 12;
}

export function chunkScriptForWebRtc(text, maxEnvelopeBytes) {
  const encoder = new TextEncoder();
  const chunks = [];
  let current = "";
  let offset = 0;
  for (const char of String(text ?? "")) {
    const candidate = current + char;
    if (current && scriptChunkEnvelopeBytes(offset, candidate) > maxEnvelopeBytes) {
      chunks.push(current);
      offset += encoder.encode(current).length;
      current = "";
    }
    current += char;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function chunkBytesForWebRtc(bytes, maxBytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += maxBytes) {
    chunks.push(bytes.slice(offset, Math.min(offset + maxBytes, bytes.length)));
  }
  return chunks;
}

export function scriptChunkEnvelopeBytes(offset, chunk) {
  const payload = {
    type: "cmd",
    id: "999",
    name: "script.chunk.add",
    data: { offset, chunk },
    offset,
    chunk,
  };
  return new TextEncoder().encode(JSON.stringify(payload)).length;
}

export function fnv1aHex(text) {
  const bytes = new TextEncoder().encode(String(text ?? ""));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
