import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAutomaticModelLods,
  modelLodTargetTriangles,
  modelTriangleCount,
  selectModelLod,
  simplifyMeshByVertexClustering,
} from "../js/output/specialized/model-lod.js";
import { parseStlMesh } from "../js/output/specialized/model-parsers.js";

test("binary STL parsing keeps triangles in compact typed storage", () => {
  const buffer = new ArrayBuffer(84 + 50);
  const view = new DataView(buffer);
  view.setUint32(80, 1, true);
  const values = [0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 2, 0];
  values.forEach((value, index) => view.setFloat32(84 + index * 4, value, true));
  const mesh = parseStlMesh(buffer);

  assert.equal(mesh.triangleCount, 1);
  assert.ok(mesh.positions instanceof Float32Array);
  assert.ok(mesh.faceNormals instanceof Float32Array);
  assert.equal(Object.keys(mesh).includes("triangles"), false, "legacy triangle objects stay lazy and non-enumerable");
});

test("automatic model LODs stay within bounded triangle budgets", () => {
  const mesh = gridMesh(110);
  const simplified = simplifyMeshByVertexClustering(mesh, 2400);
  assert.ok(modelTriangleCount(simplified) <= 2600);
  assert.ok(modelTriangleCount(simplified) > 0);

  const lodMesh = buildAutomaticModelLods(mesh, [9000, 4000, 1600]);
  const counts = lodMesh.lods.map(modelTriangleCount);
  assert.equal(counts.length, 3);
  assert.ok(counts.every((count, index) => index === 0 || count <= counts[index - 1]));
  assert.equal(selectModelLod(lodMesh, 4000), lodMesh.lods.find((lod) => modelTriangleCount(lod) <= 4000));
});

test("model LOD demand is stricter for perceptual outlines", () => {
  const request = { width: 1280, height: 720, renderQuality: 0.5 };
  assert.ok(modelLodTargetTriangles({ ...request, renderMode: "outline" })
    < modelLodTargetTriangles({ ...request, renderMode: "surface" }));
});

function gridMesh(size) {
  const triangleCount = (size - 1) * (size - 1) * 2;
  const positions = new Float32Array(triangleCount * 9);
  const faceNormals = new Float32Array(triangleCount * 3);
  let positionWrite = 0;
  let normalWrite = 0;
  const writeTriangle = (a, b, c) => {
    for (const vertex of [a, b, c]) for (const value of vertex) positions[positionWrite++] = value;
    faceNormals[normalWrite++] = 0;
    faceNormals[normalWrite++] = 0;
    faceNormals[normalWrite++] = 1;
  };
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const z = Math.sin(x * 0.2) * Math.cos(y * 0.2);
      writeTriangle([x, y, z], [x + 1, y, z], [x + 1, y + 1, z]);
      writeTriangle([x, y, z], [x + 1, y + 1, z], [x, y + 1, z]);
    }
  }
  return {
    positions,
    faceNormals,
    triangleCount,
    bounds: { min: [0, 0, -1], max: [size - 1, size - 1, 1] },
    sourceBounds: { min: [0, 0, -1], max: [size - 1, size - 1, 1] },
  };
}
