import test from "node:test";
import assert from "node:assert/strict";

import {
  canvasSizeForMode,
  createRenderRequest,
  defaultProjectSurfaceMapping,
  outputFrameForId,
  outputFrames,
  renderRequestKey,
} from "../js/output/render-geometry.js";

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

test("embedded preview sizing keeps composition aspect independent from surface texture", () => {
  const render = {
    frameWidth: 1280,
    frameHeight: 720,
    worldWidth: 1920,
    worldHeight: 1080,
    surfaceWidth: 1024,
    surfaceHeight: 1024,
  };

  assert.deepEqual(canvasSizeForMode("preview", render), { width: 1920, height: 1080 });
  assert.deepEqual(canvasSizeForMode("composition", render), { width: 1280, height: 720 });
  assert.deepEqual(canvasSizeForMode("output", render), { width: 1280, height: 720 });
});

test("default project surface mapping uses world-centered frame coordinates", () => {
  const render = {
    frameWidth: 1000,
    frameHeight: 500,
    worldWidth: 1500,
    worldHeight: 900,
    surfaceWidth: 200,
    surfaceHeight: 100,
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
  const surfaceA = createRenderRequest("surface", size, { surfaceId: "surface-a", renderIdentity: "composition-a" });
  const surfaceB = createRenderRequest("surface", size, { surfaceId: "surface-b", renderIdentity: "composition-a" });
  const explicitInstance = createRenderRequest("surface", size, {
    instanceId: "manual-instance",
    surfaceId: "surface-a",
  });

  assert.equal(renderRequestKey(surfaceA), "surface:640x360:composition-a");
  assert.equal(renderRequestKey(surfaceB), "surface:640x360:composition-a");
  assert.equal(renderRequestKey(surfaceA), renderRequestKey(surfaceB));
  assert.equal(renderRequestKey(explicitInstance), "surface:640x360:manual-instance");
});
