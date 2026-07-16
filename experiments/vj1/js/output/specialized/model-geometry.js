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
  const triangles = Array.isArray(mesh.triangles) ? mesh.triangles : [];
  if (!triangles.length) return new Float32Array(0);
  const vertices = new Float32Array(triangles.length * 18);
  let write = 0;
  for (const triangle of triangles) {
    const normal = normalizeModelVector(triangle.normal || modelTriangleNormal(triangle.vertices || []));
    for (const vertex of triangle.vertices || []) {
      vertices[write++] = Number(vertex[0]) || 0;
      vertices[write++] = Number(vertex[1]) || 0;
      vertices[write++] = Number(vertex[2]) || 0;
      vertices[write++] = normal[0];
      vertices[write++] = normal[1];
      vertices[write++] = normal[2];
    }
  }
  return vertices.subarray(0, write);
}
