import test from "node:test";
import assert from "node:assert/strict";

import {
  buildParsedModelSurfaceVertices,
  modelTriangleNormal,
  normalizeModelVector,
} from "../js/output/specialized/model-geometry.js";

test("parsed STL surface vertices normalize supplied facet normals", () => {
  const vertices = buildParsedModelSurfaceVertices({
    triangles: [{
      normal: [0, 0, 5],
      vertices: [[0, 0, 0], [2, 0, 0], [0, 2, 0]],
    }],
  });

  assert.deepEqual(Array.from(vertices), [
    0, 0, 0, 0, 0, 1,
    2, 0, 0, 0, 0, 1,
    0, 2, 0, 0, 0, 1,
  ]);
});

test("parsed model normals are derived safely when facet normals are absent", () => {
  assert.deepEqual(modelTriangleNormal([[0, 0, 0], [1, 0, 0], [0, 1, 0]]), [0, 0, 1]);
  assert.deepEqual(normalizeModelVector([0, 0, 0]), [0, 0, 1]);
});
