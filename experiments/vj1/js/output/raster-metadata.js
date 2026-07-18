const HEADER_BYTES = 256 * 1024;

export async function readRasterDimensions(file) {
  if (!file?.slice) return null;
  const buffer = await file.slice(0, HEADER_BYTES).arrayBuffer();
  return rasterDimensionsFromBytes(new Uint8Array(buffer));
}

export function rasterDimensionsFromBytes(bytes) {
  if (!bytes || bytes.length < 10) return null;
  return pngDimensions(bytes) || jpegDimensions(bytes) || gifDimensions(bytes) ||
    webpDimensions(bytes) || bmpDimensions(bytes);
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || !matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  return validDimensions(readU32be(bytes, 16), readU32be(bytes, 20));
}

function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (!marker || marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) return null;
    if (offset + 1 >= bytes.length) return null;
    const length = readU16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (isJpegStartOfFrame(marker) && length >= 7) {
      return validDimensions(readU16be(bytes, offset + 5), readU16be(bytes, offset + 3));
    }
    offset += length;
  }
  return null;
}

function gifDimensions(bytes) {
  if (bytes.length < 10 || (!matchesAscii(bytes, 0, "GIF87a") && !matchesAscii(bytes, 0, "GIF89a"))) return null;
  return validDimensions(readU16le(bytes, 6), readU16le(bytes, 8));
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || !matchesAscii(bytes, 0, "RIFF") || !matchesAscii(bytes, 8, "WEBP")) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    return validDimensions(1 + readU24le(bytes, 24), 1 + readU24le(bytes, 27));
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const b1 = bytes[21];
    const b2 = bytes[22];
    const b3 = bytes[23];
    const b4 = bytes[24];
    return validDimensions(1 + (((b2 & 0x3f) << 8) | b1), 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6)));
  }
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return validDimensions(readU16le(bytes, 26) & 0x3fff, readU16le(bytes, 28) & 0x3fff);
  }
  return null;
}

function bmpDimensions(bytes) {
  if (bytes.length < 26 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) return null;
  return validDimensions(Math.abs(readI32le(bytes, 18)), Math.abs(readI32le(bytes, 22)));
}

function isJpegStartOfFrame(marker) {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
}

function validDimensions(width, height) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? { width, height } : null;
}

function matches(bytes, offset, values) {
  return values.every((value, index) => bytes[offset + index] === value);
}

function matchesAscii(bytes, offset, value) {
  return ascii(bytes, offset, value.length) === value;
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function readU16be(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readU16le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU24le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU32be(bytes, offset) {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function readI32le(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24));
}
