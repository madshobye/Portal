import test from "node:test";
import assert from "node:assert/strict";
import { componentTextureSize } from "../js/domain/render-resolution.js";
import {
  disposeRenderTarget,
  nodeBoundaryPixelRect,
  nodeBoundaryUniformScale,
  nodeBoundaryWithUniformScale,
  nodeRoiRequest,
  renderView,
} from "../js/libraries/render-engine/index.js";
import { testPatternRenderView } from "../js/libraries/visual-nodes/generators/test-pattern/index.js";

import {
  canvasSizeForMode,
  createRenderRequest,
  defaultProjectSurfaceMapping,
  instanceInvariantRenderRequest,
  mappingWorldRender,
  outputFrameForId,
  outputFrames,
  outputSpanRect,
  renderRequestKey,
  renderRequestStateKey,
  RECORDING_FRAME_DEMAND_SCALE,
  sourceRenderDemand,
  SURFACE_DEMAND_OVERSCAN,
  visibleMappedSurfaceSize,
} from "../js/output/render-geometry.js";

test("mapping geometry is independent from the current browser host proportions", () => {
  const render = {
    outputs: [{ id: "output-main", aspectRatio: 16 / 9 }],
  };
  const wideHost = mappingWorldRender({
    ...render,
    hostViewport: { width: 1445, height: 855 },
  });
  const shortHost = mappingWorldRender({
    ...render,
    hostViewport: { width: 1327, height: 204 },
  });

  assert.deepEqual(wideHost.hostViewport, shortHost.hostViewport);
  assert.equal(wideHost.hostViewport.width / wideHost.hostViewport.height, 16 / 9);
});

test("adaptive sampling safety multipliers are named render-contract constants", () => {
  assert.equal(SURFACE_DEMAND_OVERSCAN, 1);
  assert.equal(RECORDING_FRAME_DEMAND_SCALE, 1);
});

test("boundary scale preserves the authored ROI proportion", () => {
  const boundary = { x: 0.2, y: -0.1, width: 0.8, height: 0.4 };
  const scaled = nodeBoundaryWithUniformScale(boundary, nodeBoundaryUniformScale(boundary) * 2);
  assert.equal(scaled.x, boundary.x);
  assert.equal(scaled.y, boundary.y);
  assert.equal(scaled.width / scaled.height, 2);
  assert.equal(scaled.width, 1.6);
  assert.equal(scaled.height, 0.8);
});

test("an off-screen boundary keeps its full logical domain while allocating only visible pixels", () => {
  const request = nodeRoiRequest(
    { role: "component", width: 1000, height: 500, logicalWidth: 1000, logicalHeight: 500 },
    { x: -0.5, y: 0, width: 1, height: 1 }
  );
  assert.equal(request.width, 750);
  assert.equal(request.height, 500);
  assert.equal(request.logicalWidth, 1000);
  assert.equal(request.logicalHeight, 500);
  assert.deepEqual(request.uvRect, [0.25, 0, 0.75, 1]);
  assert.deepEqual(testPatternRenderView({ width: request.width, height: request.height }, request), {
    x: 250,
    y: 0,
    width: 1000,
    height: 500,
    allocationWidth: 750,
    allocationHeight: 500,
    logicalWidth: 1000,
    logicalHeight: 500,
    uvRect: [0.25, 0, 0.75, 1],
    cropped: true,
  });
});

test("media fit and procedural sources share one complete-boundary render view", () => {
  const view = renderView(
    { width: 200, height: 100 },
    { logicalWidth: 400, logicalHeight: 100, uvRect: [0.5, 0, 0.5, 1] }
  );
  assert.deepEqual(view, {
    x: 200,
    y: 0,
    width: 400,
    height: 100,
    allocationWidth: 200,
    allocationHeight: 100,
    logicalWidth: 400,
    logicalHeight: 100,
    uvRect: [0.5, 0, 0.5, 1],
    cropped: true,
  });
});

test("standalone WebGL targets release their context before removal", () => {
  let lost = 0;
  let removed = 0;
  const target = {
    _renderer: { GL: { getExtension: (name) => name === "WEBGL_lose_context" ? { loseContext: () => lost++ } : null } },
    remove: () => removed++,
  };
  disposeRenderTarget(target);
  disposeRenderTarget(target);
  assert.equal(lost, 1);
  assert.equal(removed, 2);

  const shared = {
    __vj1SharedFramebuffer: true,
    drawingContext: { getExtension: () => ({ loseContext: () => lost++ }) },
    remove: () => removed++,
  };
  disposeRenderTarget(shared);
  assert.equal(lost, 1, "shared framebuffer must retain the main context");
  assert.equal(removed, 3);
});

test("nested boundaries are positioned in the parent's full domain rather than its cropped allocation", () => {
  const parent = nodeRoiRequest(
    { width: 1000, height: 500, logicalWidth: 1000, logicalHeight: 500 },
    { x: -0.5, y: 0, width: 1, height: 1 }
  );
  const child = nodeRoiRequest(parent, { x: -0.5, y: 0, width: 0.5, height: 1 });
  assert.equal(child.roi.x, 0);
  assert.equal(child.width, 250);
  assert.equal(child.logicalWidth, 500);
  assert.deepEqual(child.uvRect, [0.5, 0, 0.5, 1]);
});

test("a fully invisible boundary has no visible ROI", () => {
  const roi = nodeBoundaryPixelRect(
    { x: -2, y: 0, width: 0.5, height: 0.5 },
    { width: 1000, height: 500 }
  );
  assert.equal(roi.empty, true);
  assert.equal(roi.width, 0);
});

test("a rotated boundary stays boundary-sized and carries oriented composite geometry", () => {
  const request = nodeRoiRequest(
    { width: 1000, height: 500, logicalWidth: 1000, logicalHeight: 500 },
    { x: 0, y: 0, width: 0.25, height: 0.25, rotation: Math.PI / 4 }
  );
  assert.equal(request.width, 250);
  assert.equal(request.height, 125);
  assert.equal(request.roi.centerX, 500);
  assert.equal(request.roi.centerY, 250);
  assert.equal(request.roi.rotation, Math.PI / 4);
  assert.equal(request.logicalWidth, 250);
  assert.equal(request.logicalHeight, 125);
});

test("render evaluation distinguishes equal allocations showing different logical views", () => {
  const left = { role: "component:roi", width: 500, height: 500, logicalWidth: 1000, logicalHeight: 500, uvRect: [0, 0, 0.5, 1] };
  const right = { ...left, uvRect: [0.5, 0, 0.5, 1] };
  assert.equal(renderRequestKey(left), renderRequestKey(right));
  assert.notEqual(renderRequestStateKey(left), renderRequestStateKey(right));
});

test("instance-invariant requests remove placement identity but preserve the logical view", () => {
  const request = {
    role: "component:roi",
    width: 320,
    height: 180,
    logicalWidth: 1280,
    logicalHeight: 720,
    uvRect: [0.25, 0, 0.5, 1],
    renderIdentity: "component:instance:a",
  };
  const shared = instanceInvariantRenderRequest(request);
  assert.equal(shared.renderIdentity, "");
  assert.equal(renderRequestKey(shared), "component:roi:320x180");
  assert.equal(shared.logicalWidth, request.logicalWidth);
  assert.deepEqual(shared.uvRect, request.uvRect);
  assert.equal(request.renderIdentity, "component:instance:a");
});

test("configured projector outputs form side-by-side viewports in one world", () => {
  const render = {
    outputs: [
      { id: "left", name: "Left", aspectRatio: 16 / 9 },
      { id: "right", name: "Right", aspectRatio: 8 / 5 },
    ],
    hostViewport: { width: 4160, height: 1620, mode: "preview", outputId: "" },
  };
  const frames = outputFrames(render);

  assert.equal(frames[0].width / frames[0].height, 16 / 9);
  assert.equal(frames[1].width / frames[1].height, 8 / 5);
  assert.equal(frames[1].x, frames[0].x + frames[0].width);
  assert.equal(frames[0].y, frames[1].y);
  assert.equal((frames[0].x + frames[1].x + frames[1].width) * 0.5, 4160 * 0.5);
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
    outputs: [{ id: "main", aspectRatio: 16 / 9 }],
    componentAspectRatio: 16 / 9,
    hostViewport: { width: 1920, height: 1080, mode: "preview", outputId: "" },
    surfaceTextureCeiling: { width: 1024, height: 1024 },
  };

  assert.deepEqual(canvasSizeForMode("preview", render), { width: 1920, height: 1080 });
  assert.deepEqual(canvasSizeForMode("component", render), { width: 1920, height: 1080 });
  assert.deepEqual(canvasSizeForMode("output", render), { width: 1920, height: 1080 });
});

test("component dimensions remain independent from the surface sampling policy", () => {
  const render = {
    outputs: [{ id: "main", aspectRatio: 16 / 9 }],
    componentAspectRatio: 16 / 9,
    surfaceTextureCeiling: { width: 320, height: 180 },
  };
  assert.deepEqual(componentTextureSize(render), { width: 1778, height: 1000 });
  assert.deepEqual(componentTextureSize({
    ...render,
    surfaceTextureCeiling: { width: 640, height: 360 },
  }), { width: 1778, height: 1000 });
});

test("default project surface mapping uses world-centered frame coordinates", () => {
  const render = {
    outputs: [{ id: "main", aspectRatio: 2 }],
    componentAspectRatio: 2,
    hostViewport: { width: 1500, height: 900, mode: "preview", outputId: "" },
  };
  const mapping = defaultProjectSurfaceMapping(render, [{ id: "a" }, { id: "b" }]);

  assert.equal(mapping.length, 2);
  assert.equal(mapping[0].id, "a");
  assert.equal(mapping[0].w, 2000);
  assert.equal(mapping[0].h, 1000);
  const left = mapping[0].corners[0].x;
  const right = mapping[1].corners[1].x;
  assert.equal((left + right) * 0.5, 750);
  assert.equal(mapping[0].corners[0].y, mapping[1].corners[0].y);
  assert.equal(mapping[0].corners[1].x < mapping[1].corners[0].x, true);
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

test("a small recording frame keeps mapped-surface detail independent from the shared full Canvas request", () => {
  const demand = sourceRenderDemand({
    logicalSize: { width: 1000, height: 500 },
    sampleRect: { x: 450, y: 225, width: 100, height: 50 },
    maxRasterSize: { width: 1000, height: 500 },
    maxSurfaceSize: { width: 2000, height: 1000 },
    corners: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 0, y: 500 }],
    viewport: { width: 1000, height: 500 },
    overscan: 1,
  });

  assert.deepEqual(demand.rasterSize, { width: 1000, height: 496 });
  assert.deepEqual(demand.surfaceSize, { width: 1008, height: 496 });
  assert.ok(demand.surfaceSize.width > demand.rasterSize.width * 0.1);
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
