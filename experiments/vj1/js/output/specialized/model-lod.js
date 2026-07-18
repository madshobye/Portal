export const MODEL_LOD_TRIANGLE_LEVELS = Object.freeze([120000, 80000, 50000, 25000, 12000]);

export function modelTriangleCount(mesh = {}) {
  if (Number.isFinite(Number(mesh.triangleCount))) return Math.max(0, Math.floor(Number(mesh.triangleCount)));
  if (mesh.positions instanceof Float32Array) return Math.floor(mesh.positions.length / 9);
  return Array.isArray(mesh.triangles) ? mesh.triangles.length : 0;
}

export function modelTriangle(mesh = {}, index = 0) {
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
  const lods = [];
  let current = mesh;
  if (!requested.length) {
    const lod = { ...mesh, sourceTriangleCount, lodLevel: 0 };
    const result = { ...lod, lods: [lod] };
    attachLegacyTriangleView(lod);
    return attachLegacyTriangleView(result);
  }
  for (const target of requested) {
    current = simplifyMeshByVertexClustering(current, target);
    current.sourceTriangleCount = sourceTriangleCount;
    current.lodLevel = lods.length;
    lods.push(current);
  }
  const result = { ...lods[0], lods };
  for (const lod of lods) attachLegacyTriangleView(lod);
  return attachLegacyTriangleView(result);
}

export function simplifyMeshByVertexClustering(mesh = {}, targetTriangles = 50000) {
  const inputCount = modelTriangleCount(mesh);
  const target = Math.max(256, Math.floor(Number(targetTriangles) || 50000));
  if (!inputCount || inputCount <= target) return cloneMeshReference(mesh);
  let resolution = Math.max(4, Math.round(Math.sqrt(target * 0.62)));
  let simplified = clusterMesh(mesh, resolution);
  // Triangle survival is model-dependent: dense curved meshes retain far more
  // faces per grid cell than flat meshes. Refine the grid until the result is
  // genuinely within the requested budget instead of treating the target as a
  // vague hint. This work runs in the model worker.
  for (let attempt = 0; attempt < 6 && modelTriangleCount(simplified) > target * 1.08 && resolution > 4; attempt++) {
    const ratio = Math.sqrt(target / Math.max(1, modelTriangleCount(simplified)));
    const nextResolution = Math.max(4, Math.floor(resolution * Math.min(0.88, ratio)));
    if (nextResolution >= resolution) break;
    resolution = nextResolution;
    simplified = clusterMesh(mesh, resolution);
  }
  return simplified;
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

export function modelLodTargetTriangles({ width = 1, height = 1, renderMode = "surface", renderQuality = 0.5 } = {}) {
  const pixels = Math.max(1, Number(width) || 1) * Math.max(1, Number(height) || 1);
  const quality = 0.45 + Math.max(0, Math.min(1, Number(renderQuality) || 0)) * 1.1;
  const pixelsPerTriangle = renderMode === "outline" || renderMode === "surfaceOutline"
    ? 20
    : renderMode === "wireframe" || renderMode === "surfaceWire" ? 12 : 6;
  return Math.max(12000, Math.min(120000, Math.round((pixels / pixelsPerTriangle) * quality)));
}

function clusterMesh(mesh, resolution) {
  const count = modelTriangleCount(mesh);
  const min = mesh.bounds?.min || [-50, -50, -50];
  const max = mesh.bounds?.max || [50, 50, 50];
  const extent = [0, 1, 2].map((axis) => Math.max(0.000001, (Number(max[axis]) || 0) - (Number(min[axis]) || 0)));
  const clusterByKey = new Map();
  const vertexClusters = new Uint32Array(count * 3);
  const representatives = [];
  let vertexIndex = 0;
  forEachModelTriangle(mesh, (triangle) => {
    for (const vertex of triangle.vertices) {
      const cell = [0, 1, 2].map((axis) => Math.max(0, Math.min(resolution - 1,
        Math.floor(((Number(vertex[axis]) || 0) - min[axis]) / extent[axis] * resolution)
      )));
      const key = cell[0] + resolution * (cell[1] + resolution * cell[2]);
      let cluster = clusterByKey.get(key);
      if (cluster === undefined) {
        cluster = representatives.length;
        clusterByKey.set(key, cluster);
        representatives.push(vertex.slice(0, 3));
      }
      vertexClusters[vertexIndex++] = cluster;
    }
  });
  const kept = [];
  for (let triangleIndex = 0; triangleIndex < count; triangleIndex++) {
    const offset = triangleIndex * 3;
    const a = vertexClusters[offset];
    const b = vertexClusters[offset + 1];
    const c = vertexClusters[offset + 2];
    if (a === b || b === c || c === a) continue;
    kept.push(a, b, c);
  }
  const triangleCount = Math.floor(kept.length / 3);
  const positions = new Float32Array(triangleCount * 9);
  const faceNormals = new Float32Array(triangleCount * 3);
  let positionWrite = 0;
  let normalWrite = 0;
  for (let index = 0; index + 2 < kept.length; index += 3) {
    const vertices = [representatives[kept[index]], representatives[kept[index + 1]], representatives[kept[index + 2]]];
    const normal = normalizeModelVector(modelTriangleNormal(vertices));
    for (const vertex of vertices) for (let axis = 0; axis < 3; axis++) positions[positionWrite++] = vertex[axis];
    for (let axis = 0; axis < 3; axis++) faceNormals[normalWrite++] = normal[axis];
  }
  return {
    positions,
    faceNormals,
    triangleCount,
    bounds: mesh.bounds,
    sourceBounds: mesh.sourceBounds,
  };
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
