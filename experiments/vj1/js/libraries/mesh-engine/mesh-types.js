import { valueType } from "../node-engine/node-types.js";

export const MeshType = valueType("mesh", {
  name: "triangle-mesh",
  contractVersion: 1,
  representations: ["triangle-soup", "indexed"],
  description: "A normalized triangle mesh stored as triangle soup or indexed vertex data.",
});

export function isMesh(value) {
  return !!value && typeof value === "object" && modelTriangleCount(value) > 0 &&
    !!value.bounds && !!value.sourceBounds;
}

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
    const vertices = [0, 3, 6].map((corner) => [
      mesh.positions[offset + corner],
      mesh.positions[offset + corner + 1],
      mesh.positions[offset + corner + 2],
    ]);
    return {
      normal: mesh.faceNormals instanceof Float32Array
        ? [mesh.faceNormals[normalOffset], mesh.faceNormals[normalOffset + 1], mesh.faceNormals[normalOffset + 2]]
        : modelTriangleNormal(vertices),
      vertices,
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

export function normalizeModelVector(vector = [0, 0, 1]) {
  const length = Math.hypot(Number(vector[0]) || 0, Number(vector[1]) || 0, Number(vector[2]) || 0);
  if (length <= 0.0001) return [0, 0, 1];
  return vector.map((value) => (Number(value) || 0) / length);
}

export function modelTriangleNormal(vertices = []) {
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
