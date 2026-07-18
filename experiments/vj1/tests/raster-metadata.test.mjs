import test from "node:test";
import assert from "node:assert/strict";

import { rasterDimensionsFromBytes } from "../js/output/raster-metadata.js";

test("raster header parsing reads PNG dimensions without decoding pixels", () => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(16, 7952);
  new DataView(bytes.buffer).setUint32(20, 5304);
  assert.deepEqual(rasterDimensionsFromBytes(bytes), { width: 7952, height: 5304 });
});

test("raster header parsing reads JPEG start-of-frame dimensions", () => {
  const bytes = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc2, 0x00, 0x0b, 0x08, 0x14, 0xb8, 0x1f, 0x10, 0x03, 0x00, 0x00, 0x00,
  ]);
  assert.deepEqual(rasterDimensionsFromBytes(bytes), { width: 7952, height: 5304 });
});

test("raster header parsing reads extended WebP canvas dimensions", () => {
  const bytes = new Uint8Array(30);
  bytes.set(Array.from("RIFF").map((value) => value.charCodeAt(0)), 0);
  bytes.set(Array.from("WEBP").map((value) => value.charCodeAt(0)), 8);
  bytes.set(Array.from("VP8X").map((value) => value.charCodeAt(0)), 12);
  const widthMinusOne = 4095;
  const heightMinusOne = 2160;
  bytes.set([widthMinusOne & 255, (widthMinusOne >> 8) & 255, (widthMinusOne >> 16) & 255], 24);
  bytes.set([heightMinusOne & 255, (heightMinusOne >> 8) & 255, (heightMinusOne >> 16) & 255], 27);
  assert.deepEqual(rasterDimensionsFromBytes(bytes), { width: 4096, height: 2161 });
});
