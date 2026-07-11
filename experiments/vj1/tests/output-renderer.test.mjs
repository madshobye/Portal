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

test("composition groups render isolated from earlier parent layers", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const groupRenderSource = source.slice(
    source.indexOf('      if (item.kind === "group") {'),
    source.indexOf("  renderThumbnailCompositions()")
  );

  assert.ok(groupRenderSource.includes("groupOutput.clear();"));
  assert.ok(groupRenderSource.includes("this.renderCompositionChainItems(composition, item.chain || [], groupOutput"));
  assert.ok(groupRenderSource.includes("this.drawChainLayer(output, groupOutput, item);"));
  assert.ok(!groupRenderSource.includes("drawBuffer(groupOutput, output"));
  assert.ok(!groupRenderSource.includes("output.clear();"));
});

test("scene surfaces render compositions within surface texture budget while preserving frame aspect", () => {
  const source = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const drawSurfaceRoute = source.slice(
    source.indexOf("  drawSurfaceRoute(pg, surface)"),
    source.indexOf("  drawSurfaceThumbnailRoute(pg, surface)")
  );
  const surfaceRouteRenderRequest = source.slice(
    source.indexOf("  surfaceRouteRenderRequest(surface, composition = null)"),
    source.indexOf("  getSurfaceTexture(request")
  );

  assert.ok(surfaceRouteRenderRequest.includes("stableSurfaceRenderRequest(this.state.render"));
  assert.ok(!drawSurfaceRoute.includes("stableFrameRenderRequest(this.state.render"));
  assert.ok(source.includes("function aspectPreservingSurfaceTextureSize(render = {})"));
  assert.ok(source.includes("maxTexture.width / Math.max(1, frame.width)"));
  assert.ok(source.includes("maxTexture.height / Math.max(1, frame.height)"));
  assert.ok(source.includes("getSurfaceTexture(request)"));
  assert.ok(source.includes("createGraphics(widthPx, heightPx)"));
});

test("projection mapper uses actual texture size for surface sampling math", () => {
  const source = readFileSync(new URL("../js/output/vj-mapper.js", import.meta.url), "utf8");

  assert.ok(source.includes("texture.width || surface.w"));
  assert.ok(source.includes("texture.height || surface.h"));
});

test("media renditions are saved without lossy jpeg compression", () => {
  const rendererSource = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const renditionSource = readFileSync(new URL("../js/services/media-rendition-service.js", import.meta.url), "utf8");

  assert.ok(rendererSource.includes('canvas.toBlob(resolve, "image/png")'));
  assert.ok(!rendererSource.includes('"image/jpeg"'));
  assert.ok(renditionSource.includes(".png"));
  assert.ok(renditionSource.includes("png|jpe?g"));
});

test("projection mapper uses high precision for homography sampling", () => {
  const source = readFileSync(new URL("../js/output/vj-mapper.js", import.meta.url), "utf8");
  const shaderSource = source.slice(source.indexOf("  _ensureShader()"));

  assert.ok(shaderSource.includes("precision highp float;"));
  assert.ok(!shaderSource.includes("precision mediump float;"));
});
