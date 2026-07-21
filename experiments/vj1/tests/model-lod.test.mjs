import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildAutomaticModelLods,
  modelLodTargetTriangles,
  selectModelLod,
  simplifyMeshByQuadricError,
  simplifyMeshByVertexClustering,
} from "../js/libraries/mesh-engine/mesh-resolution/index.js";
import { modelTriangleCount } from "../js/libraries/mesh-engine/mesh-types.js";
import { weldedMeshTopology } from "../js/libraries/mesh-engine/meshoptimizer-simplifier.js";
import {
  deserializeDerivedModel,
  modelDerivedCacheKey,
  serializeDerivedModel,
} from "../js/output/specialized/model-derived-cache.js";
import { parseObjMesh } from "../js/libraries/mesh-engine/obj-parser/index.js";
import { parseStlMesh } from "../js/libraries/mesh-engine/stl-parser/index.js";
import { parseObjPreviewMesh } from "../js/libraries/mesh-engine/obj-parser/index.js";
import { parseStlPreviewMesh } from "../js/libraries/mesh-engine/stl-parser/index.js";

test("routine model cache and LOD success paths stay quiet", () => {
  const source = [
    readFileSync(new URL("../js/output/specialized/model-derived-cache.js", import.meta.url), "utf8"),
    readFileSync(new URL("../js/output/output-media-runtime.js", import.meta.url), "utf8"),
  ].join("\n");

  assert.doesNotMatch(source, /VJ1_MODEL_CACHE_HIT|VJ1_MODEL_CACHE_WRITTEN|VJ1_MODEL_LOD_READY/);
  assert.match(source, /VJ1_MODEL_CACHE_READ_FAILED/);
  assert.match(source, /VJ1_MODEL_CACHE_WRITE_FAILED/);
  assert.match(source, /VJ1_MODEL_TOPOLOGY_WARNING/);
  assert.match(source, /VJ1_MODEL_SIMPLIFICATION_LIMITED/);
});

test("slow model processing warns without cancelling the requested import", () => {
  const source = readFileSync(new URL("../js/output/specialized/model-processing-client.js", import.meta.url), "utf8");
  const slowHandler = source.slice(
    source.indexOf("const slowWarning = setTimeout"),
    source.indexOf("pending.set(requestId", source.indexOf("const slowWarning = setTimeout"))
  );
  assert.match(slowHandler, /VJ1_MODEL_PROCESSING_SLOW/);
  assert.match(slowHandler, /still active/);
  assert.doesNotMatch(slowHandler, /failWorker|reject\(/);
  assert.doesNotMatch(source, /VJ1_MODEL_PROCESSING_TIMEOUT/);
});

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
  for (const lod of lodMesh.lods) {
    const topology = weldedMeshTopology(lod);
    assert.equal(topology.triangleCount, modelTriangleCount(lod), "LOD metadata must match its actual geometry");
    assert.ok(topology.triangleCount > 0, "every progressive LOD must contain renderable triangles");
    assert.equal(lod.simplification, "meshoptimizer-qem");
  }
  assert.equal(selectModelLod(lodMesh, 4000), lodMesh.lods.find((lod) => modelTriangleCount(lod) <= 4000));
});

test("model LOD demand is stricter for perceptual outlines", () => {
  const request = { width: 1280, height: 720, renderQuality: 0.5 };
  assert.ok(modelLodTargetTriangles({ ...request, renderMode: "outline" })
    < modelLodTargetTriangles({ ...request, renderMode: "surface" }));
  assert.equal(
    modelLodTargetTriangles({ ...request, renderMode: "xrayOutline" }),
    modelLodTargetTriangles({ ...request, renderMode: "outline" })
  );
  assert.equal(
    modelLodTargetTriangles({ ...request, renderMode: "outline", edgeBudget: 20000 }),
    modelLodTargetTriangles({ ...request, width: 2560, height: 1440, renderMode: "outline", edgeBudget: 20000 }),
    "2x resolution must not select more outline edges than the complete-edge budget can hold"
  );
  assert.ok(
    modelLodTargetTriangles({ ...request, renderMode: "outline", edgeBudget: 50000 })
      > modelLodTargetTriangles({ ...request, renderMode: "outline", edgeBudget: 20000 }),
    "raising the explicit edge budget may select a denser outline LOD"
  );
});

test("wire detail selects a complete resolution-independent construction mesh", () => {
  const low = modelLodTargetTriangles({ width: 640, height: 360, renderMode: "wireframe", wireDetail: 0 });
  const medium = modelLodTargetTriangles({ width: 640, height: 360, renderMode: "wireframe", wireDetail: 0.25 });
  const high = modelLodTargetTriangles({ width: 640, height: 360, renderMode: "wireframe", wireDetail: 1 });
  assert.equal(low, 3000);
  assert.ok(medium > low && medium < high);
  assert.equal(high, 25000);
  assert.equal(
    medium,
    modelLodTargetTriangles({ width: 2560, height: 1440, renderMode: "wireframe", wireDetail: 0.25 }),
    "render resolution must not replace the authored wire detail"
  );
});

test("QEM simplification preserves the closed topology of a welded STL surface", () => {
  const source = subdividedCubeMesh(14);
  const before = weldedMeshTopology(source);
  const simplified = simplifyMeshByQuadricError(source, 700);
  const after = weldedMeshTopology(simplified);

  assert.equal(before.boundaryEdges, 0);
  assert.equal(before.nonManifoldEdges, 0);
  assert.equal(after.boundaryEdges, 0, "simplification must not punch holes into a closed model");
  assert.equal(after.nonManifoldEdges, 0, "simplification must not create non-manifold edges");
  assert.ok(modelTriangleCount(simplified) <= 700);
  assert.equal(simplified.simplification, "meshoptimizer-qem");
});

test("progressive QEM LODs preserve closed topology at every level", () => {
  const source = subdividedCubeMesh(18);
  const lodMesh = buildAutomaticModelLods(source, [2800, 1600, 800, 400]);
  assert.equal(lodMesh.lods.length, 4);
  for (const lod of lodMesh.lods) {
    const topology = weldedMeshTopology(lod);
    assert.equal(topology.triangleCount, modelTriangleCount(lod));
    assert.equal(topology.boundaryEdges, 0, `LOD ${lod.lodLevel} must remain watertight`);
    assert.equal(topology.nonManifoldEdges, 0, `LOD ${lod.lodLevel} must stay manifold`);
  }
});

test("OBJ parsing retains compact source indices before worker simplification", () => {
  const mesh = parseObjMesh(`
v -1 -1 0
v 1 -1 0
v 1 1 0
v -1 1 0
f 1 2 3 4
`);
  assert.ok(mesh.vertexPositions instanceof Float32Array);
  assert.ok(mesh.triangleIndices instanceof Uint32Array);
  assert.equal(mesh.vertexPositions.length, 12);
  assert.equal(mesh.triangleIndices.length, 6);
  assert.equal(mesh.positions, undefined, "the parser must not expand indexed OBJ geometry into triangle soup");
  assert.equal(modelTriangleCount(mesh), 2);
});

test("derived model cache round-trips progressive LOD geometry and rejects another source", () => {
  const source = subdividedCubeMesh(12);
  const mesh = buildAutomaticModelLods(source, [1200, 600, 300]);
  const cacheKey = modelDerivedCacheKey({ type: "stl", sourceKey: "media/skull.stl:revision-a" });
  const payload = serializeDerivedModel(mesh, cacheKey);
  const restored = deserializeDerivedModel(payload, cacheKey);

  assert.deepEqual(restored.lods.map(modelTriangleCount), mesh.lods.map(modelTriangleCount));
  assert.equal(restored.sourceTriangleCount, mesh.sourceTriangleCount);
  assert.ok(restored.lods.every((lod) => lod.derivedCache === true));
  assert.deepEqual(Array.from(restored.lods.at(-1).positions.slice(0, 18)), Array.from(mesh.lods.at(-1).positions.slice(0, 18)));
  assert.throws(() => deserializeDerivedModel(payload, `${cacheKey}:other-source`), /does not match/);
});

test("model thumbnails sample bounded geometry without entering automatic LOD generation", () => {
  const vertices = [];
  const faces = [];
  for (let index = 0; index < 1000; index++) {
    const base = index * 3 + 1;
    vertices.push(`v ${index} 0 0`, `v ${index} 1 0`, `v ${index} 0 1`);
    faces.push(`f ${base} ${base + 1} ${base + 2}`);
  }
  const objPreview = parseObjPreviewMesh(`${vertices.join("\n")}\n${faces.join("\n")}`, 64);
  assert.equal(objPreview.triangleCount, 64);
  assert.equal(objPreview.lods, undefined);

  const stl = binaryStlWithTriangles(1000);
  const stlPreview = parseStlPreviewMesh(stl, 48);
  assert.equal(stlPreview.triangleCount, 48);
  assert.equal(stlPreview.lods, undefined);
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

function binaryStlWithTriangles(count) {
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  view.setUint32(80, count, true);
  for (let triangle = 0; triangle < count; triangle++) {
    const offset = 84 + triangle * 50;
    const vertices = [[triangle, 0, 0], [triangle, 1, 0], [triangle, 0, 1]];
    for (let corner = 0; corner < 3; corner++) {
      for (let axis = 0; axis < 3; axis++) {
        view.setFloat32(offset + 12 + corner * 12 + axis * 4, vertices[corner][axis], true);
      }
    }
  }
  return buffer;
}

function subdividedCubeMesh(size) {
  const positions = [];
  const normals = [];
  const faces = [
    { origin: [1, -1, -1], u: [0, 2, 0], v: [0, 0, 2] },
    { origin: [-1, -1, 1], u: [0, 2, 0], v: [0, 0, -2] },
    { origin: [-1, 1, 1], u: [2, 0, 0], v: [0, 0, -2] },
    { origin: [-1, -1, -1], u: [2, 0, 0], v: [0, 0, 2] },
    { origin: [-1, -1, 1], u: [2, 0, 0], v: [0, 2, 0] },
    { origin: [-1, 1, -1], u: [2, 0, 0], v: [0, -2, 0] },
  ];
  const point = (face, x, y) => [0, 1, 2].map((axis) =>
    face.origin[axis] + face.u[axis] * x / size + face.v[axis] * y / size
  );
  const write = (a, b, c) => {
    positions.push(...a, ...b, ...c);
    const ab = b.map((value, axis) => value - a[axis]);
    const ac = c.map((value, axis) => value - a[axis]);
    const normal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const length = Math.hypot(...normal) || 1;
    normals.push(...normal.map((value) => value / length));
  };
  for (const face of faces) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const a = point(face, x, y);
        const b = point(face, x + 1, y);
        const c = point(face, x + 1, y + 1);
        const d = point(face, x, y + 1);
        write(a, b, c);
        write(a, c, d);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    faceNormals: new Float32Array(normals),
    triangleCount: positions.length / 9,
    bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    sourceBounds: { min: [-1, -1, -1], max: [1, 1, 1] },
  };
}
