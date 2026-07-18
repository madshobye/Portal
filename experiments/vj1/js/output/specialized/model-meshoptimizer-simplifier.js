import { MeshoptSimplifier } from "../../vendor/meshopt-simplifier.js?v=meshoptimizer-0.25";

await MeshoptSimplifier.ready;

const WELD_TOLERANCE = 1e-7;

export function buildMeshoptimizerLods(mesh = {}, targetLevels = []) {
  const indexed = compactIndexedMesh(mesh);
  const sourceTriangleCount = Math.floor(indexed.indices.length / 3);
  const targets = Array.from(new Set((Array.isArray(targetLevels) ? targetLevels : [targetLevels])
    .map((value) => Math.max(256, Math.floor(Number(value) || 0)))
    .filter((value) => value < sourceTriangleCount)))
    .sort((a, b) => b - a);
  if (!targets.length) return [indexedToTriangleSoup(indexed, mesh, {
    simplification: "source-indexed",
    sourceTriangleCount,
  })];

  let indices = indexed.indices;
  const lods = [];
  for (const target of targets) {
    const targetIndexCount = Math.min(indices.length, target * 3);
    const [simplified, error] = MeshoptSimplifier.simplify(
      indices,
      indexed.positions,
      3,
      targetIndexCount,
      1,
      []
    );
    indices = simplified;
    lods.push(indexedToTriangleSoup({ positions: indexed.positions, indices }, mesh, {
      simplification: "meshoptimizer-qem",
      simplificationError: error,
      sourceTriangleCount,
      requestedTriangleCount: target,
      topologyLimited: indices.length > targetIndexCount,
    }));
  }
  return lods;
}

export function indexedMeshToTriangleSoup(mesh = {}) {
  if (mesh.positions instanceof Float32Array && !mesh.triangleIndices) return mesh;
  const indexed = compactIndexedMesh(mesh);
  return indexedToTriangleSoup(indexed, mesh, {
    simplification: mesh.simplification || "source-indexed",
  });
}

export function weldedMeshTopology(mesh = {}) {
  const indexed = compactIndexedMesh(mesh);
  const edges = new Map();
  const vertices = new Set();
  const faces = new Set();
  let triangleCount = 0;
  for (let offset = 0; offset + 2 < indexed.indices.length; offset += 3) {
    const a = indexed.indices[offset];
    const b = indexed.indices[offset + 1];
    const c = indexed.indices[offset + 2];
    if (a === b || b === c || c === a) continue;
    const faceKey = [a, b, c].sort((left, right) => left - right).join(":");
    if (faces.has(faceKey)) continue;
    faces.add(faceKey);
    triangleCount++;
    vertices.add(a);
    vertices.add(b);
    vertices.add(c);
    for (const [start, end] of [[a, b], [b, c], [c, a]]) {
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  for (const incidence of edges.values()) {
    if (incidence === 1) boundaryEdges++;
    else if (incidence > 2) nonManifoldEdges++;
  }
  return { vertexCount: vertices.size, triangleCount, boundaryEdges, nonManifoldEdges };
}

function compactIndexedMesh(mesh) {
  if (mesh.vertexPositions instanceof Float32Array && mesh.triangleIndices instanceof Uint32Array) {
    return { positions: mesh.vertexPositions, indices: mesh.triangleIndices };
  }
  const count = meshTriangleCount(mesh);
  const bounds = mesh.bounds || computedBounds(mesh.positions);
  const diagonal = Math.max(1e-9, Math.hypot(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2]
  ));
  const tolerance = Math.max(Number.EPSILON * diagonal * 8, diagonal * WELD_TOLERANCE);
  const values = [];
  const indices = new Uint32Array(count * 3);
  const buckets = new Map();
  for (let vertexIndex = 0; vertexIndex < count * 3; vertexIndex++) {
    const offset = vertexIndex * 3;
    const x = mesh.positions[offset];
    const y = mesh.positions[offset + 1];
    const z = mesh.positions[offset + 2];
    const key = `${Math.round((x - bounds.min[0]) / tolerance)},${Math.round((y - bounds.min[1]) / tolerance)},${Math.round((z - bounds.min[2]) / tolerance)}`;
    let index = buckets.get(key);
    if (index === undefined) {
      index = values.length / 3;
      buckets.set(key, index);
      values.push(x, y, z);
    }
    indices[vertexIndex] = index;
  }
  return { positions: new Float32Array(values), indices };
}

function indexedToTriangleSoup(indexed, source, metadata = {}) {
  const triangleCount = Math.floor(indexed.indices.length / 3);
  const positions = new Float32Array(triangleCount * 9);
  const faceNormals = new Float32Array(triangleCount * 3);
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const outputOffset = triangle * 9;
    for (let corner = 0; corner < 3; corner++) {
      const sourceOffset = indexed.indices[triangle * 3 + corner] * 3;
      positions[outputOffset + corner * 3] = indexed.positions[sourceOffset];
      positions[outputOffset + corner * 3 + 1] = indexed.positions[sourceOffset + 1];
      positions[outputOffset + corner * 3 + 2] = indexed.positions[sourceOffset + 2];
    }
    const ax = positions[outputOffset];
    const ay = positions[outputOffset + 1];
    const az = positions[outputOffset + 2];
    const abx = positions[outputOffset + 3] - ax;
    const aby = positions[outputOffset + 4] - ay;
    const abz = positions[outputOffset + 5] - az;
    const acx = positions[outputOffset + 6] - ax;
    const acy = positions[outputOffset + 7] - ay;
    const acz = positions[outputOffset + 8] - az;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    faceNormals[triangle * 3] = nx;
    faceNormals[triangle * 3 + 1] = ny;
    faceNormals[triangle * 3 + 2] = nz;
  }
  return {
    positions,
    faceNormals,
    triangleCount,
    bounds: source.bounds,
    sourceBounds: source.sourceBounds,
    ...metadata,
  };
}

function meshTriangleCount(mesh) {
  if (Number.isFinite(Number(mesh.triangleCount))) return Math.max(0, Math.floor(Number(mesh.triangleCount)));
  if (mesh.triangleIndices instanceof Uint32Array) return Math.floor(mesh.triangleIndices.length / 3);
  return mesh.positions instanceof Float32Array ? Math.floor(mesh.positions.length / 9) : 0;
}

function computedBounds(positions = new Float32Array()) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index + 2 < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  return { min, max };
}
