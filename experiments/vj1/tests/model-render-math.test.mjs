import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  modelDepthCutoff,
  modelRotation,
  modelViewportMetrics,
  modelWireThickness,
  rawModelMatrices,
  transformedModelDepthRange,
} from "../js/output/specialized/model-render-math.js";
import { buildParsedModelPointCloud, buildParsedModelWireLines } from "../js/output/specialized/model-mesh-cache.js";

test("specialized model math owns viewport rotation depth and matrix calculations", () => {
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const bounds = { min: [-1, -2, -3], max: [4, 5, 7] };
  const rotation = modelRotation({ rotationX: 1, spinX: 0.5, rotationY: 2 }, 4);
  const viewport = modelViewportMetrics({ width: 320, height: 200 }, { logicalWidth: 640, logicalHeight: 400 });
  const matrices = rawModelMatrices(320, 200, 2, 1.5, rotation, { x: 0.2, y: -0.1, scale: 1.1, rotation: 0.3 });

  assert.deepEqual(rotation, [3, 2, 0]);
  assert.deepEqual(viewport, {
    width: 320,
    height: 200,
    logicalWidth: 640,
    logicalHeight: 400,
    cameraZ: 184,
    unitScale: 1.3,
  });
  assert.equal(matrices.model.length, 16);
  assert.equal(matrices.mvp.length, 16);
  assert.deepEqual(transformedModelDepthRange(bounds), { min: -3, max: 7 });
  assert.equal(modelDepthCutoff({ visibleDepth: 0.5 }, bounds), 2);
  assert.equal(modelWireThickness({ wireThickness: 99 }), 12);
  assert.match(renderer, /from "\.\/specialized\/model-render-math\.js\?v=model-render-math-extraction-1"/);
  assert.doesNotMatch(renderer, /function rawModelMatrices\(/);
  assert.doesNotMatch(renderer, /function transformedModelDepthRange\(/);
});

test("specialized model mesh cache owns bounded point and wire extraction", () => {
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const specializedRuntime = readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8");
  const mesh = {
    triangles: [{
      normal: [0, 0, 1],
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    }],
  };

  assert.deepEqual(Array.from(buildParsedModelPointCloud(mesh, 128)), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(Array.from(buildParsedModelWireLines(mesh, 128)), [
    0, 0, 0, 1, 0, 0,
    1, 0, 0, 0, 1, 0,
    0, 1, 0, 0, 0, 0,
  ]);
  assert.match(renderer, /from "\.\/specialized\/specialized-source-runtime\.js\?v=terrain-world-up-1"/);
  assert.match(specializedRuntime, /from "\.\/model-mesh-cache\.js\?v=model-mesh-cache-extraction-1"/);
  assert.doesNotMatch(renderer, /function ensureParsedModelPointCloud\(/);
  assert.doesNotMatch(renderer, /function buildParsedModelWireLines\(/);
});

test("raw model WebGL programs and context resources live outside the output orchestrator", () => {
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const specializedRuntime = readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8");
  const rawModelRenderer = readFileSync(new URL("../js/output/specialized/raw-model-webgl-renderer.js", import.meta.url), "utf8");

  assert.match(renderer, /from "\.\/specialized\/specialized-source-runtime\.js\?v=terrain-world-up-1"/);
  assert.match(specializedRuntime, /from "\.\/raw-model-webgl-renderer\.js\?v=media-resource-disposal-1"/);
  assert.match(rawModelRenderer, /export function drawRawParsedModelMode\(/);
  assert.match(rawModelRenderer, /export function disposeRawModelContextResources\(/);
  assert.match(rawModelRenderer, /export function disposeRawModelItemResources\(/);
  assert.match(rawModelRenderer, /function createRawModelProgram\(/);
  assert.match(rawModelRenderer, /function createRawSurfaceProgram\(/);
  assert.match(rawModelRenderer, /function createRawWireProgram\(/);
  assert.equal((rawModelRenderer.match(/beginRawWebGlState\(gl,/g) || []).length, 3);
  assert.equal((rawModelRenderer.match(/restoreRawWebGlState\(gl, passState, attributeStates\)/g) || []).length, 3);
  assert.doesNotMatch(rawModelRenderer, /gl\.useProgram\(null\)|gl\.bindBuffer\(gl\.ARRAY_BUFFER, null\)/);
  assert.doesNotMatch(renderer, /function createRawModelProgram\(/);
  assert.doesNotMatch(renderer, /function ensureRawModelContextResources\(/);
});
