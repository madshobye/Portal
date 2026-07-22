import assert from "node:assert/strict";
import test from "node:test";

import {
  SceneFrameGuideNode,
  sceneFrameGuideNodeProcess,
  sourceUvToSurfaceUv,
} from "../js/libraries/composition-engine/scene-frame-guides/index.js";
import { projectSurfaceUv } from "../js/libraries/mapping-engine/mapping-engine/index.js";

test("Scene Frame guide node includes output and user Frames without changing its route space", () => {
  const result = sceneFrameGuideNodeProcess({
    frames: [
      { id: "main-output", kind: "output", x: 0, y: 0, width: 1, height: 1 },
      { id: "output-2", kind: "output", x: 0.5, y: 0, width: 0.5, height: 1 },
      { id: "frame-1", kind: "user", x: 0.2, y: 0.25, width: 0.4, height: 0.5 },
    ],
    logicalSize: { width: 1600, height: 900 },
    sampleRect: { x: 0, y: 0, width: 1600, height: 900 },
    sourceAspect: 16 / 9,
    targetAspect: 16 / 9,
  });
  assert.equal(result.paths.length, 3);
  const expected = [
    { x: 0.2, y: 0.25 },
    { x: 0.6, y: 0.25 },
    { x: 0.6, y: 0.75 },
    { x: 0.2, y: 0.75 },
  ];
  result.paths[2].forEach((point, index) => {
    assert.ok(Math.abs(point.x - expected[index].x) < 1e-8);
    assert.ok(Math.abs(point.y - expected[index].y) < 1e-8);
  });
  assert.equal(SceneFrameGuideNode.capabilities.includes("zero-buffer"), true);
});

test("Scene Frame guide fit conversion is the inverse of projection sampling", () => {
  assert.deepEqual(sourceUvToSurfaceUv({ x: 0, y: 0.5 }, 2, 1, "cover"), { x: -0.5, y: 0.5 });
  assert.deepEqual(sourceUvToSurfaceUv({ x: 0, y: 0.5 }, 2, 1, "contain"), { x: 0, y: 0.5 });
  assert.deepEqual(sourceUvToSurfaceUv({ x: 0, y: 0.5 }, 1, 2, "contain"), { x: 0.25, y: 0.5 });
});

test("Surface guide paths use the same projective corner geometry as Mapping", () => {
  const corners = [
    { x: 20, y: 10 },
    { x: 220, y: 30 },
    { x: 180, y: 150 },
    { x: 40, y: 130 },
  ];
  const expected = [corners[0], corners[1], corners[2], corners[3]];
  const actual = [
    projectSurfaceUv(corners, { x: 0, y: 0 }),
    projectSurfaceUv(corners, { x: 1, y: 0 }),
    projectSurfaceUv(corners, { x: 1, y: 1 }),
    projectSurfaceUv(corners, { x: 0, y: 1 }),
  ];
  actual.forEach((point, index) => {
    assert.ok(Math.abs(point.x - expected[index].x) < 1e-8);
    assert.ok(Math.abs(point.y - expected[index].y) < 1e-8);
  });
});
