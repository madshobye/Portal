import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { OutputRenderer } from "../js/output/output-renderer.js";

test("output resize keeps render buffers tied to configured frame size", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const render = {
    frameWidth: 1280,
    frameHeight: 720,
  };
  const renderer = new OutputRenderer({ mode: "output" });

  try {
    globalThis.width = 1920;
    globalThis.height = 300;
    renderer.state = { render };

    assert.deepEqual(renderer.outputFrameSize(render), { width: 1280, height: 720 });
    assert.deepEqual(renderer.displayCanvasSize(render), { width: 1920, height: 300 });
    assert.deepEqual(renderer.renderResolutionSize(render), { width: 1280, height: 720, density: 1 });
    assert.equal(renderer.renderResolutionLabel(render), "1280x720");
    assert.deepEqual(renderer.outputFrameTransform(), {
      scale: 1.5,
      x: 0,
      y: -390,
    });
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("hud render resolution reports GPU render pixels, not window size", () => {
  const previousWidth = globalThis.width;
  const previousHeight = globalThis.height;
  const render = {
    frameWidth: 1280,
    frameHeight: 720,
    pixelDensity: 1.5,
  };
  const renderer = new OutputRenderer({ mode: "output" });

  try {
    globalThis.width = 3840;
    globalThis.height = 2160;
    renderer.state = { render };

    assert.deepEqual(renderer.displayCanvasSize(render), { width: 3840, height: 2160 });
    assert.deepEqual(renderer.renderResolutionSize(render), { width: 1920, height: 1080, density: 1.5 });
    assert.equal(renderer.renderResolutionLabel(render), "1920x1080 @1.5x");
  } finally {
    if (previousWidth === undefined) delete globalThis.width;
    else globalThis.width = previousWidth;
    if (previousHeight === undefined) delete globalThis.height;
    else globalThis.height = previousHeight;
  }
});

test("composition thumbnails preserve more detail with high quality webp", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");

  assert.ok(source.includes("const COMPOSITION_THUMBNAIL_WIDTH = 768;"));
  assert.ok(source.includes("const COMPOSITION_THUMBNAIL_HEIGHT = 432;"));
  assert.ok(source.includes("const COMPOSITION_THUMBNAIL_QUALITY = 0.92;"));
  assert.ok(source.includes('canvas.toDataURL("image/webp", COMPOSITION_THUMBNAIL_QUALITY)'));
  assert.ok(source.includes('return canvas.toDataURL("image/png");'));
});
