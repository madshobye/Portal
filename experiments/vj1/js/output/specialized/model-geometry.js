export function normalizeModelVector(vector = [0, 0, 1]) {
  const length = Math.hypot(
    Number(vector[0]) || 0,
    Number(vector[1]) || 0,
    Number(vector[2]) || 0,
  );
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

export function buildParsedModelSurfaceVertices(mesh = {}) {
  const triangleCount = modelTriangleCount(mesh);
  if (!triangleCount) return new Float32Array(0);
  const vertices = new Float32Array(triangleCount * 18);
  if (mesh.positions instanceof Float32Array && mesh.faceNormals instanceof Float32Array) {
    let write = 0;
    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
      const positionOffset = triangleIndex * 9;
      const normalOffset = triangleIndex * 3;
      const nx = mesh.faceNormals[normalOffset];
      const ny = mesh.faceNormals[normalOffset + 1];
      const nz = mesh.faceNormals[normalOffset + 2];
      for (let corner = 0; corner < 9; corner += 3) {
        vertices[write++] = mesh.positions[positionOffset + corner];
        vertices[write++] = mesh.positions[positionOffset + corner + 1];
        vertices[write++] = mesh.positions[positionOffset + corner + 2];
        vertices[write++] = nx;
        vertices[write++] = ny;
        vertices[write++] = nz;
      }
    }
    return vertices;
  }
  let write = 0;
  forEachModelTriangle(mesh, (triangle) => {
    const normal = normalizeModelVector(triangle.normal || modelTriangleNormal(triangle.vertices || []));
    for (const vertex of triangle.vertices || []) {
      vertices[write++] = Number(vertex[0]) || 0;
      vertices[write++] = Number(vertex[1]) || 0;
      vertices[write++] = Number(vertex[2]) || 0;
      vertices[write++] = normal[0];
      vertices[write++] = normal[1];
      vertices[write++] = normal[2];
    }
  });
  return vertices.subarray(0, write);
}
import { forEachModelTriangle, modelTriangleCount } from "./model-lod.js?v=model-lod-1";
