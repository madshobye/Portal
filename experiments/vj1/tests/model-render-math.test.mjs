import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applyModelViewportProjection,
  modelCameraClipPlanes,
  modelCameraFov,
  modelDepthCutoff,
  modelDepthSliceEnabled,
  modelImportBasis,
  modelNormalMatrix,
  modelOutlineThickness,
  modelRotation,
  modelViewportMetrics,
  modelWireThickness,
  rawModelMatrices,
  transformedModelDepthRange,
} from "../js/libraries/mesh-engine/mesh-render-math.js";
import { buildParsedModelPerceptualEdges, buildParsedModelPointCloud, buildParsedModelWireLines } from "../js/libraries/mesh-engine/mesh-render-cache.js";

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
    renderWidth: 320,
    renderHeight: 200,
    logicalWidth: 640,
    logicalHeight: 400,
    uvRect: [0, 0, 1, 1],
    cameraZ: 184,
    unitScale: 1.3,
  });
  assert.equal(matrices.model.length, 16);
  assert.equal(matrices.mvp.length, 16);
  assert.deepEqual(transformedModelDepthRange(bounds), { min: -3, max: 7 });
  assert.equal(modelDepthCutoff({ visibleDepth: 0.5 }, bounds), 2);
  assert.ok(modelDepthCutoff({ visibleDepth: 1 }, bounds) < -3);
  assert.equal(modelDepthSliceEnabled({ visibleDepth: 1 }), false);
  assert.equal(modelDepthSliceEnabled({ visibleDepth: 0.999 }), true);
  assert.equal(modelWireThickness({ wireThickness: 99 }), 12);
  assert.equal(modelOutlineThickness({ wireThickness: 2 }), 2.7);
  assert.ok(Math.abs(modelCameraFov({}) - Math.PI / 3) < 0.000001);
  assert.ok(modelCameraFov({ focalLength: 100 }) < modelCameraFov({ focalLength: 20.8 }));
  assert.deepEqual(Array.from(modelNormalMatrix(new Float32Array([
    2, 0, 0, 0,
    0, 4, 0, 0,
    0, 0, 5, 0,
    0, 0, 0, 1,
  ]))), [0.5, 0, 0, 0, 0.25, 0, 0, 0, 0.20000000298023224]);
  assert.deepEqual(modelImportBasis({ file: { name: "mesh.stl" } }), [0, 0, Math.PI]);
  assert.deepEqual(modelImportBasis({ file: { name: "mesh.obj" } }), [0, 0, 0]);
  assert.match(renderer, /from "\.\.\/libraries\/mesh-engine\/mesh-render-math\.js"/);
  assert.doesNotMatch(renderer, /function rawModelMatrices\(/);
  assert.doesNotMatch(renderer, /function transformedModelDepthRange\(/);
});

test("model ROI keeps the full boundary camera and uses an off-axis projection", () => {
  const viewport = modelViewportMetrics(
    { width: 200, height: 100 },
    { width: 200, height: 100, logicalWidth: 400, logicalHeight: 100, uvRect: [0.5, 0, 0.5, 1] }
  );
  assert.equal(viewport.width, 400);
  assert.equal(viewport.height, 100);
  assert.equal(viewport.renderWidth, 200);
  assert.equal(viewport.cameraZ, 92);

  let frustum = null;
  let perspectiveCalls = 0;
  applyModelViewportProjection({
    frustum: (...args) => { frustum = args; },
    perspective: () => perspectiveCalls++,
  }, Math.PI / 3, viewport);
  assert.ok(frustum);
  assert.equal(perspectiveCalls, 0);
  assert.ok(frustum[0] >= 0, "right-half ROI starts at the full projection center");
  assert.ok(frustum[1] > frustum[0]);

  const matrices = rawModelMatrices(400, 100, 1, 1, [0, 0, 0], {}, Math.PI / 3, [0.5, 0, 0.5, 1]);
  assert.ok(Math.abs(matrices.mvp[12] / matrices.mvp[15] + 1) < 1e-6, "full-boundary center maps to the ROI's left edge");
});

test("model camera clipping stays proportional to render resolution", () => {
  assert.deepEqual(modelCameraClipPlanes(200), { near: 0.1, far: 5000 });
  assert.deepEqual(modelCameraClipPlanes(800), { near: 0.4, far: 20000 });

  let lowPerspective = null;
  let highPerspective = null;
  applyModelViewportProjection({
    perspective: (...args) => { lowPerspective = args; },
  }, Math.PI / 3, { width: 320, height: 200 });
  applyModelViewportProjection({
    perspective: (...args) => { highPerspective = args; },
  }, Math.PI / 3, { width: 1280, height: 800 });

  assert.deepEqual(lowPerspective.slice(2), [0.1, 5000]);
  assert.deepEqual(highPerspective.slice(2), [0.4, 20000]);

  const low = rawModelMatrices(320, 200, 1.3, 1.5);
  const high = rawModelMatrices(1280, 800, 5.2, 1.5);
  const lowProjected = projectNdc(low.mvp, [10, 20, 30]);
  const highProjected = projectNdc(high.mvp, [10, 20, 30]);
  for (let index = 0; index < lowProjected.length; index++) {
    assert.ok(Math.abs(lowProjected[index] - highProjected[index]) < 0.000001, `projected coordinate ${index} remains resolution invariant`);
  }
});

function projectNdc(matrix, point) {
  const clip = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) {
    clip[row] = matrix[row] * point[0]
      + matrix[4 + row] * point[1]
      + matrix[8 + row] * point[2]
      + matrix[12 + row];
  }
  return clip.slice(0, 3).map((value) => value / clip[3]);
}

test("specialized model mesh cache owns bounded point and wire extraction", () => {
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const meshCache = readFileSync(new URL("../js/libraries/mesh-engine/mesh-render-cache.js", import.meta.url), "utf8");
  const rawRenderer = readFileSync(new URL("../js/libraries/mesh-engine/mesh-render/index.js", import.meta.url), "utf8");
  const specializedRuntime = readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8");

  assert.match(meshCache, /strokeWeight\(wireThickness\)/);
  assert.match(rawRenderer, /uniform1f\(resources\.pointSize, resolutionScaledStrokeWidth\(/);
  assert.match(specializedRuntime, /drawPointCloud\(target, ensureParsedModelPointCloud\(item, pointBudget, modelMesh\), wireColor, wireThickness\)/);
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
  assert.match(renderer, /from "\.\/specialized\/specialized-source-runtime\.js\?v=[^"]+"/);
  assert.match(specializedRuntime, /from "\.\.\/\.\.\/libraries\/mesh-engine\/mesh-render-cache\.js"/);
  assert.doesNotMatch(renderer, /function ensureParsedModelPointCloud\(/);
  assert.doesNotMatch(renderer, /function buildParsedModelWireLines\(/);
});

test("perceptual STL edges merge coplanar triangle diagonals into one logical edge", () => {
  const mesh = {
    bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    triangles: [
      { normal: [0, 0, 1], vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]] },
      { normal: [0, 0, 1], vertices: [[0, 0, 0], [1, 1, 0], [0, 1, 0]] },
    ],
  };
  const edges = buildParsedModelPerceptualEdges(mesh);
  const boundaryFlags = [];
  for (let offset = 12; offset < edges.length; offset += 13) boundaryFlags.push(edges[offset]);

  assert.equal(edges.length, 5 * 13, "four boundary edges plus one shared diagonal");
  assert.equal(boundaryFlags.filter(Boolean).length, 4);
  assert.equal(boundaryFlags.filter((value) => !value).length, 1);
});

test("raw model WebGL programs and context resources live outside the output orchestrator", () => {
  const renderer = readFileSync(new URL("../js/output/output-renderer.js", import.meta.url), "utf8");
  const specializedRuntime = readFileSync(new URL("../js/output/specialized/specialized-source-runtime.js", import.meta.url), "utf8");
  const rawModelRenderer = readFileSync(new URL("../js/libraries/mesh-engine/mesh-render/index.js", import.meta.url), "utf8");

  assert.match(renderer, /from "\.\/specialized\/specialized-source-runtime\.js\?v=[^"]+"/);
  assert.match(specializedRuntime, /from "\.\.\/\.\.\/libraries\/mesh-engine\/mesh-render\/index\.js(?:\?v=[^"]+)?"/);
  assert.match(specializedRuntime, /Intentional allocation-stable fast path/);
  assert.doesNotMatch(specializedRuntime, /new NodeInstance\(/);
  assert.match(rawModelRenderer, /export const MeshRenderNode = defineNode\(/);
  assert.match(rawModelRenderer, /export function drawRawParsedModelMode\(/);
  assert.match(rawModelRenderer, /export function disposeRawModelContextResources\(/);
  assert.match(rawModelRenderer, /export function disposeRawModelItemResources\(/);
  assert.match(rawModelRenderer, /function createRawModelProgram\(/);
  assert.match(rawModelRenderer, /function createRawSurfaceProgram\(/);
  assert.match(rawModelRenderer, /function createRawWireProgram\(/);
  assert.match(rawModelRenderer, /function createRawPerceptualWireProgram\(/);
  assert.match(rawModelRenderer, /half-width cap overlap closes sub-pixel cracks/);
  assert.match(rawModelRenderer, /float coverage = 1\.0 - smoothstep/);
  assert.equal((rawModelRenderer.match(/beginRawWebGlState\(gl,/g) || []).length, 4);
  assert.equal((rawModelRenderer.match(/restoreRawWebGlState\(gl, passState, attributeStates\)/g) || []).length, 4);
  assert.doesNotMatch(rawModelRenderer, /gl\.useProgram\(null\)|gl\.bindBuffer\(gl\.ARRAY_BUFFER, null\)/);
  assert.doesNotMatch(renderer, /function createRawModelProgram\(/);
  assert.doesNotMatch(renderer, /function ensureRawModelContextResources\(/);
});
