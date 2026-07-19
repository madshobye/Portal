import { buildMeshoptimizerLods, indexedMeshToTriangleSoup } from "./model-meshoptimizer-simplifier.js?v=model-qem-4";

export const MODEL_LOD_TRIANGLE_LEVELS = Object.freeze([120000, 80000, 50000, 25000, 12000, 6000, 3000]);

export function modelTriangleCount(mesh = {}) {
  if (Number.isFinite(Number(mesh.triangleCount))) return Math.max(0, Math.floor(Number(mesh.triangleCount)));
  if (mesh.triangleIndices instanceof Uint32Array) return Math.floor(mesh.triangleIndices.length / 3);
  if (mesh.positions instanceof Float32Array) return Math.floor(mesh.positions.length / 9);
  return Array.isArray(mesh.triangles) ? mesh.triangles.length : 0;
}

export function modelTriangle(mesh = {}, index = 0) {
  if (mesh.vertexPositions instanceof Float32Array && mesh.triangleIndices instanceof Uint32Array) {
    const indexOffset = index * 3;
    if (indexOffset + 2 >= mesh.triangleIndices.length) return null;
    const vertices = [0, 1, 2].map((corner) => {
      const offset = mesh.triangleIndices[indexOffset + corner] * 3;
      return [mesh.vertexPositions[offset], mesh.vertexPositions[offset + 1], mesh.vertexPositions[offset + 2]];
    });
    return { normal: modelTriangleNormal(vertices), vertices };
  }
  if (mesh.positions instanceof Float32Array) {
    const offset = index * 9;
    const normalOffset = index * 3;
    if (offset + 8 >= mesh.positions.length) return null;
    return {
      normal: mesh.faceNormals instanceof Float32Array
        ? [mesh.faceNormals[normalOffset], mesh.faceNormals[normalOffset + 1], mesh.faceNormals[normalOffset + 2]]
        : modelTriangleNormal([
            [mesh.positions[offset], mesh.positions[offset + 1], mesh.positions[offset + 2]],
            [mesh.positions[offset + 3], mesh.positions[offset + 4], mesh.positions[offset + 5]],
            [mesh.positions[offset + 6], mesh.positions[offset + 7], mesh.positions[offset + 8]],
          ]),
      vertices: [0, 3, 6].map((corner) => [
        mesh.positions[offset + corner],
        mesh.positions[offset + corner + 1],
        mesh.positions[offset + corner + 2],
      ]),
    };
  }
  return Array.isArray(mesh.triangles) ? mesh.triangles[index] || null : null;
}

export function forEachModelTriangle(mesh = {}, callback) {
  const count = modelTriangleCount(mesh);
  for (let index = 0; index < count; index++) {
    const triangle = modelTriangle(mesh, index);
    if (triangle) callback(triangle, index);
  }
}

export function attachLegacyTriangleView(mesh = {}) {
  if (!mesh || Object.prototype.hasOwnProperty.call(mesh, "triangles")) return mesh;
  let legacy = null;
  Object.defineProperty(mesh, "triangles", {
    configurable: true,
    enumerable: false,
    get() {
      if (!legacy) {
        legacy = [];
        forEachModelTriangle(mesh, (triangle) => legacy.push(triangle));
      }
      return legacy;
    },
  });
  return mesh;
}

export function buildAutomaticModelLods(mesh = {}, levels = MODEL_LOD_TRIANGLE_LEVELS) {
  const sourceTriangleCount = modelTriangleCount(mesh);
  if (!sourceTriangleCount) return attachLegacyTriangleView(mesh);
  const requested = Array.from(new Set(levels.map((value) => Math.max(256, Math.floor(Number(value) || 0)))))
    .filter((value) => value < sourceTriangleCount)
    .sort((a, b) => b - a);
  if (!requested.length) {
    const lod = { ...indexedMeshToTriangleSoup(mesh), sourceTriangleCount, lodLevel: 0 };
    const result = { ...lod, lods: [lod] };
    attachLegacyTriangleView(lod);
    return attachLegacyTriangleView(result);
  }
  const lods = buildMeshoptimizerLods(mesh, requested);
  lods.forEach((lod, index) => {
    lod.sourceTriangleCount = sourceTriangleCount;
    lod.lodLevel = index;
  });
  const result = { ...lods[0], lods };
  for (const lod of lods) attachLegacyTriangleView(lod);
  return attachLegacyTriangleView(result);
}

export function simplifyMeshByVertexClustering(mesh = {}, targetTriangles = 50000) {
  return buildMeshoptimizerLods(mesh, [targetTriangles])[0];
}

export function simplifyMeshByQuadricError(mesh = {}, targetTriangles = 50000) {
  return buildMeshoptimizerLods(mesh, [targetTriangles])[0];
}

export function selectModelLod(mesh = {}, targetTriangles = Infinity) {
  const lods = Array.isArray(mesh.lods) && mesh.lods.length ? mesh.lods : [mesh];
  const target = Number.isFinite(Number(targetTriangles)) ? Math.max(1, Number(targetTriangles)) : Infinity;
  let selected = lods[0];
  for (const lod of lods) {
    selected = lod;
    if (modelTriangleCount(lod) <= target) break;
  }
  return selected;
}

export function modelLodTargetTriangles({ width = 1, height = 1, renderMode = "surface", renderQuality = 0.5, edgeBudget = 20000, wireDetail = 0.25 } = {}) {
  const pixels = Math.max(1, Number(width) || 1) * Math.max(1, Number(height) || 1);
  const quality = 0.45 + Math.max(0, Math.min(1, Number(renderQuality) || 0)) * 1.1;
  const perceptualOutline = renderMode === "outline" || renderMode === "surfaceOutline" || renderMode === "xrayOutline";
  const constructionWire = renderMode === "wireframe" || renderMode === "surfaceWire";
  if (constructionWire) {
    // Wireframe must use every edge of one coherent LOD. Sampling isolated
    // edges from a denser mesh produces disconnected rectangular confetti.
    const detail = Math.max(0, Math.min(1, Number(wireDetail) || 0));
    return Math.round(3000 + detail * 22000);
  }
  const pixelsPerTriangle = perceptualOutline
    ? 20
    : 6;
  const rasterTarget = Math.max(12000, Math.min(120000, Math.round((pixels / pixelsPerTriangle) * quality)));
  if (!perceptualOutline) return rasterTarget;

  // A closed triangle mesh has roughly 1.5 unique edges per triangle. The
  // perceptual outline buffer must contain complete edges: choosing a denser
  // LOD and then taking every Nth edge turns silhouettes into dotted lines.
  // Cap outline geometry by its edge budget so changing render resolution
  // cannot silently switch from continuous contours to sampled fragments.
  const completeEdgeTriangleBudget = Math.max(1000, Math.floor(
    Math.max(1000, Math.min(50000, Number(edgeBudget) || 20000)) / 1.6
  ));
  return Math.min(rasterTarget, completeEdgeTriangleBudget);
}

function cloneMeshReference(mesh) {
  return {
    positions: mesh.positions,
    faceNormals: mesh.faceNormals,
    triangleCount: modelTriangleCount(mesh),
    bounds: mesh.bounds,
    sourceBounds: mesh.sourceBounds,
  };
}

function normalizeModelVector(vector = [0, 0, 1]) {
  const length = Math.hypot(Number(vector[0]) || 0, Number(vector[1]) || 0, Number(vector[2]) || 0);
  if (length <= 0.0001) return [0, 0, 1];
  return vector.map((value) => (Number(value) || 0) / length);
}

function modelTriangleNormal(vertices = []) {
  const a = vertices[0] || [0, 0, 0];
  const b = vertices[1] || [0, 0, 0];
  const c = vertices[2] || [0, 0, 0];
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return normalizeModelVector([
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ]);
}
