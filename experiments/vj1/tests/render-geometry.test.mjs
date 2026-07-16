import test from "node:test";
import assert from "node:assert/strict";
import { componentTextureSize } from "../js/domain/render-resolution.js";

import {
  canvasSizeForMode,
  createRenderRequest,
  defaultProjectSurfaceMapping,
  outputFrameForId,
  outputFrames,
  outputSpanRect,
  renderRequestKey,
  RECORDING_FRAME_DEMAND_SCALE,
  sourceRenderDemand,
  SURFACE_DEMAND_OVERSCAN,
  visibleMappedSurfaceSize,
} from "../js/output/render-geometry.js";

test("adaptive sampling safety multipliers are named render-contract constants", () => {
  assert.equal(SURFACE_DEMAND_OVERSCAN, 1);
  assert.equal(RECORDING_FRAME_DEMAND_SCALE, 1);
});

test("configured projector outputs form side-by-side viewports in one world", () => {
  const render = {
    outputs: [
      { id: "left", name: "Left", width: 1920, height: 1080 },
      { id: "right", name: "Right", width: 1280, height: 800 },
    ],
    outputGap: 0,
    worldWidth: 4160,
    worldHeight: 1620,
  };
  const frames = outputFrames(render);

  assert.deepEqual(frames[0], { id: "left", name: "Left", width: 1920, height: 1080, x: 480, y: 270 });
  assert.deepEqual(frames[1], { id: "right", name: "Right", width: 1280, height: 800, x: 2400, y: 410 });
  assert.deepEqual(outputFrameForId(render, "right"), frames[1]);
});

test("direct output spans use the union of their configured output frames", () => {
  const render = {
    outputs: [
      { id: "left", name: "Left", width: 1280, height: 720 },
      { id: "right", name: "Right", width: 1920, height: 1080 },
    ],
    worldWidth: 4000,
    worldHeight: 1400,
  };
  const left = outputFrameForId(render, "left");
  const right = outputFrameForId(render, "right");
  assert.deepEqual(outputSpanRect(render, ["left", "right"]), {
    x: left.x,
    y: Math.min(left.y, right.y),
    width: right.x + right.width - left.x,
    height: Math.max(left.y + left.height, right.y + right.height) - Math.min(left.y, right.y),
  });
});

test("direct spans retain full-source demand when only one output slice is visible", () => {
  const options = {
    logicalSize: { width: 2000, height: 1000 },
    sampleRect: { x: 0, y: 0, width: 2000, height: 1000 },
    maxRasterSize: { width: 2000, height: 1000 },
    maxSurfaceSize: { width: 2000, height: 1000 },
    corners: [
      { x: -1000, y: 0 }, { x: 1000, y: 0 },
      { x: 1000, y: 500 }, { x: -1000, y: 500 },
    ],
    viewport: { width: 1000, height: 500 },
    pixelScale: 1,
    overscan: 1,
  };
  assert.ok(Math.abs(sourceRenderDemand(options).rasterScale - 0.5) < 0.01);
  assert.equal(sourceRenderDemand({ ...options, preserveFullFootprint: true }).rasterScale, 1);
});

test("embedded preview sizing keeps component aspect independent from surface texture", () => {
  const render = {
    frameWidth: 1280,
    frameHeight: 720,
    worldWidth: 1920,
    worldHeight: 1080,
    surfaceTexture: { mode: "manual", maxWidth: 1024, maxHeight: 1024 },
  };

  assert.deepEqual(canvasSizeForMode("preview", render), { width: 1920, height: 1080 });
  assert.deepEqual(canvasSizeForMode("component", render), { width: 1280, height: 720 });
  assert.deepEqual(canvasSizeForMode("output", render), { width: 1280, height: 720 });
});

test("component dimensions remain independent from the surface sampling policy", () => {
  const render = {
    outputs: [{ id: "main", width: 1920, height: 1080 }],
    componentTexture: { width: 1280, height: 720 },
    surfaceTexture: { mode: "auto", maxWidth: 320, maxHeight: 180 },
  };
  assert.deepEqual(componentTextureSize(render), { width: 1280, height: 720 });
  assert.deepEqual(componentTextureSize({
    ...render,
    surfaceTexture: { mode: "manual", maxWidth: 640, maxHeight: 360 },
  }), { width: 1280, height: 720 });
});

test("default project surface mapping uses world-centered frame coordinates", () => {
  const render = {
    frameWidth: 1000,
    frameHeight: 500,
    worldWidth: 1500,
    worldHeight: 900,
    componentTexture: { width: 200, height: 100 },
    surfaceTexture: { mode: "auto", maxWidth: 1000, maxHeight: 500 },
  };
  const mapping = defaultProjectSurfaceMapping(render, [{ id: "a" }, { id: "b" }]);

  assert.equal(mapping.length, 2);
  assert.equal(mapping[0].id, "a");
  assert.equal(mapping[0].w, 200);
  assert.equal(mapping[0].h, 100);
  assert.deepEqual(mapping[0].corners[0], { x: 274, y: 224 });
  assert.deepEqual(mapping[0].corners[2], { x: 738, y: 456 });
  assert.deepEqual(mapping[1].corners[0], { x: 762, y: 224 });
});

test("surface presentation identity is separate from render identity", () => {
  const size = { width: 640, height: 360 };
  const surfaceA = createRenderRequest("surface", size, { surfaceId: "surface-a", renderIdentity: "component-a" });
  const surfaceB = createRenderRequest("surface", size, { surfaceId: "surface-b", renderIdentity: "component-a" });
  const explicitInstance = createRenderRequest("surface", size, {
    instanceId: "manual-instance",
    surfaceId: "surface-a",
  });

  assert.equal(renderRequestKey(surfaceA), "surface:640x360:component-a");
  assert.equal(renderRequestKey(surfaceB), "surface:640x360:component-a");
  assert.equal(renderRequestKey(surfaceA), renderRequestKey(surfaceB));
  assert.equal(renderRequestKey(explicitInstance), "surface:640x360:manual-instance");
});

test("generic source demand follows visible mapped pixels and culls outside viewports", () => {
  const corners = [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 300 }, { x: 100, y: 300 }];
  assert.deepEqual(visibleMappedSurfaceSize(corners, { width: 1000, height: 600 }).width, 400);
  assert.equal(visibleMappedSurfaceSize(corners.map((point) => ({ x: point.x + 1200, y: point.y })), { width: 1000, height: 600 }), null);

  const demand = sourceRenderDemand({
    logicalSize: { width: 3840, height: 2160 },
    sampleRect: { x: 0, y: 0, width: 1920, height: 1080 },
    maxRasterSize: { width: 3840, height: 2160 },
    maxSurfaceSize: { width: 1920, height: 1080 },
    corners,
    viewport: { width: 1000, height: 600 },
    overscan: 1,
  });
  assert.deepEqual(demand.rasterSize, { width: 800, height: 448 });
  assert.deepEqual(demand.surfaceSize, { width: 400, height: 224 });
});

test("generic source demand propagates an upstream sampling requirement", () => {
  const input = {
    logicalSize: { width: 3840, height: 2160 },
    sampleRect: { x: 0, y: 0, width: 960, height: 540 },
    maxRasterSize: { width: 3840, height: 2160 },
    maxSurfaceSize: { width: 8192, height: 8192 },
    corners: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 281 }, { x: 0, y: 281 }],
    viewport: { width: 1000, height: 600 },
    overscan: 1,
  };
  const normal = sourceRenderDemand(input);
  const sampled = sourceRenderDemand({ ...input, samplingScale: 1.5 });
  assert.ok(sampled.rasterSize.width > normal.rasterSize.width);
  assert.ok(sampled.rasterSize.height > normal.rasterSize.height);
  assert.ok(sampled.surfaceSize.width > normal.surfaceSize.width);
  const reduced = sourceRenderDemand({ ...input, samplingScale: 0.5 });
  assert.ok(reduced.rasterSize.width < normal.rasterSize.width);
  assert.ok(reduced.rasterSize.height < normal.rasterSize.height);
});

test("surface overscan can reduce mapped demand to half resolution", () => {
  const input = {
    logicalSize: { width: 1000, height: 500 },
    sampleRect: { x: 0, y: 0, width: 1000, height: 500 },
    maxRasterSize: { width: 2000, height: 1000 },
    maxSurfaceSize: { width: 2000, height: 1000 },
    corners: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 0, y: 500 }],
    viewport: { width: 1000, height: 500 },
    pixelScale: 1,
  };
  const normal = sourceRenderDemand({ ...input, overscan: 1 }).rasterScale;
  const reduced = sourceRenderDemand({ ...input, overscan: 0.5 }).rasterScale;
  assert.ok(Math.abs(reduced / normal - 0.5) < 0.01);
});

test("projective demand follows the longest edge instead of undersampling trapezoids", () => {
  const demand = sourceRenderDemand({
    logicalSize: { width: 1000, height: 500 },
    sampleRect: { x: 0, y: 0, width: 1000, height: 500 },
    maxRasterSize: { width: 2000, height: 1000 },
    maxSurfaceSize: { width: 8192, height: 8192 },
    corners: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 600, y: 300 }, { x: 200, y: 300 }],
    viewport: { width: 1000, height: 600 },
    overscan: 1,
  });
  assert.equal(demand.footprint.width, 800);
  assert.deepEqual(demand.surfaceSize, { width: 800, height: 400 });
});
