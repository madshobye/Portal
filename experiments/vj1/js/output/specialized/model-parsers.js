import { attachLegacyTriangleView } from "./model-lod.js?v=model-qem-4";

export function parseStlMesh(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer?.buffer || buffer || []);
  if (bytes.byteLength < 15) throw new Error("STL file is empty");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredTriangles = bytes.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const expectedBinarySize = 84 + declaredTriangles * 50;
  if (declaredTriangles > 0 && expectedBinarySize === bytes.byteLength) {
    return parseBinaryStl(view, declaredTriangles);
  }
  const triangles = parseAsciiStl(new TextDecoder("utf-8").decode(bytes));
  if (!triangles.length) throw new Error("STL contained no triangles");
  return normalizeParsedMesh(triangles);
}

export function parseObjMesh(text = "") {
  const source = String(text || "");
  const vertexValues = [];
  const triangleIndices = [];
  const sourceBounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  let cursor = 0;
  while (cursor < source.length) {
    const newline = source.indexOf("\n", cursor);
    const line = source.slice(cursor, newline < 0 ? source.length : newline).trim();
    cursor = newline < 0 ? source.length : newline + 1;
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const type = parts.shift();
    if (type === "v" && parts.length >= 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = Number(parts[axis]) || 0;
        vertexValues.push(value);
        sourceBounds.min[axis] = Math.min(sourceBounds.min[axis], value);
        sourceBounds.max[axis] = Math.max(sourceBounds.max[axis], value);
      }
    } else if (type === "f" && parts.length >= 3) {
      const vertexCount = vertexValues.length / 3;
      const face = parts.map((token) => resolveObjIndex(token.split("/", 1)[0], vertexCount));
      for (let index = 1; index + 1 < face.length; index++) {
        const a = face[0];
        const b = face[index];
        const c = face[index + 1];
        if (a < 0 || b < 0 || c < 0 || a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;
        if (a === b || b === c || c === a) continue;
        triangleIndices.push(a, b, c);
      }
    }
  }
  if (!triangleIndices.length || !vertexValues.length) throw new Error("OBJ contained no polygon faces");
  const center = sourceBounds.min.map((min, axis) => (min + sourceBounds.max[axis]) * 0.5);
  const extent = Math.max(...sourceBounds.max.map((max, axis) => Math.abs(max - sourceBounds.min[axis])), 0.0001);
  const scale = 100 / extent;
  const vertexPositions = new Float32Array(vertexValues.length);
  for (let index = 0; index < vertexValues.length; index++) {
    const axis = index % 3;
    vertexPositions[index] = (vertexValues[index] - center[axis]) * scale;
  }
  return attachLegacyTriangleView({
    vertexPositions,
    triangleIndices: new Uint32Array(triangleIndices),
    triangleCount: triangleIndices.length / 3,
    bounds: {
      min: sourceBounds.min.map((value, axis) => (value - center[axis]) * scale),
      max: sourceBounds.max.map((value, axis) => (value - center[axis]) * scale),
    },
    sourceBounds,
  });
}

function resolveObjIndex(token, length) {
  const value = Number.parseInt(token, 10);
  if (!Number.isFinite(value) || value === 0) return -1;
  return value < 0 ? length + value : value - 1;
}

function parseBinaryStl(view, count) {
  const sourceBounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  let scanOffset = 84;
  for (let index = 0; index < count && scanOffset + 50 <= view.byteLength; index++, scanOffset += 50) {
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
      const vertexOffset = scanOffset + 12 + vertexIndex * 12;
      for (let axis = 0; axis < 3; axis++) {
        const value = view.getFloat32(vertexOffset + axis * 4, true);
        sourceBounds.min[axis] = Math.min(sourceBounds.min[axis], value);
        sourceBounds.max[axis] = Math.max(sourceBounds.max[axis], value);
      }
    }
  }
  const center = sourceBounds.min.map((min, axis) => (min + sourceBounds.max[axis]) * 0.5);
  const extent = Math.max(...sourceBounds.max.map((max, axis) => Math.abs(max - sourceBounds.min[axis])), 0.0001);
  const scale = 100 / extent;
  const positions = new Float32Array(count * 9);
  const faceNormals = new Float32Array(count * 3);
  let positionWrite = 0;
  let normalWrite = 0;
  let offset = 84;
  for (let index = 0; index < count && offset + 50 <= view.byteLength; index++) {
    const sourceNormal = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ];
    offset += 12;
    const vertices = [];
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
      const vertex = [0, 1, 2].map((axis) => (view.getFloat32(offset + axis * 4, true) - center[axis]) * scale);
      vertices.push(vertex);
      for (let axis = 0; axis < 3; axis++) positions[positionWrite++] = vertex[axis];
      offset += 12;
    }
    const normal = vectorLength(sourceNormal) > 0.0001 ? normalizeModelVector(sourceNormal) : modelTriangleNormal(vertices);
    for (let axis = 0; axis < 3; axis++) faceNormals[normalWrite++] = normal[axis];
    offset += 2;
  }
  return attachLegacyTriangleView({
    positions,
    faceNormals,
    triangleCount: count,
    bounds: {
      min: sourceBounds.min.map((value, axis) => (value - center[axis]) * scale),
      max: sourceBounds.max.map((value, axis) => (value - center[axis]) * scale),
    },
    sourceBounds,
  });
}

function parseAsciiStl(text = "") {
  const values = [];
  const vertexRe = /vertex\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let match;
  while ((match = vertexRe.exec(text))) {
    values.push([Number(match[1]), Number(match[2]), Number(match[3])]);
  }
  const triangles = [];
  for (let index = 0; index + 2 < values.length; index += 3) {
    const vertices = [values[index], values[index + 1], values[index + 2]];
    triangles.push({ normal: modelTriangleNormal(vertices), vertices });
  }
  return triangles;
}

function normalizeParsedMesh(triangles) {
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const triangle of triangles) {
    for (const vertex of triangle.vertices) {
      for (let axis = 0; axis < 3; axis++) {
        bounds.min[axis] = Math.min(bounds.min[axis], vertex[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], vertex[axis]);
      }
    }
  }
  const center = bounds.min.map((min, axis) => (min + bounds.max[axis]) * 0.5);
  const extent = Math.max(...bounds.max.map((max, axis) => Math.abs(max - bounds.min[axis])), 0.0001);
  const scale = 100 / extent;
  const positions = new Float32Array(triangles.length * 9);
  const faceNormals = new Float32Array(triangles.length * 3);
  let positionWrite = 0;
  let normalWrite = 0;
  for (const triangle of triangles) {
    const vertices = triangle.vertices.map((vertex) => vertex.map((value, axis) => (value - center[axis]) * scale));
    const normal = normalizeModelVector(vectorLength(triangle.normal) > 0.0001 ? triangle.normal : modelTriangleNormal(vertices));
    for (const vertex of vertices) for (let axis = 0; axis < 3; axis++) positions[positionWrite++] = vertex[axis];
    for (let axis = 0; axis < 3; axis++) faceNormals[normalWrite++] = normal[axis];
  }
  return attachLegacyTriangleView({
    positions,
    faceNormals,
    triangleCount: triangles.length,
    bounds: {
      min: bounds.min.map((value, axis) => (value - center[axis]) * scale),
      max: bounds.max.map((value, axis) => (value - center[axis]) * scale),
    },
    sourceBounds: bounds,
  });
}

function vectorLength(vector = []) {
  return Math.hypot(Number(vector[0]) || 0, Number(vector[1]) || 0, Number(vector[2]) || 0);
}
import { modelTriangleNormal, normalizeModelVector } from "./model-geometry.js?v=model-geometry-fix-30";
