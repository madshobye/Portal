import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { attachLegacyTriangleView, MeshType, modelTriangleNormal, normalizeModelVector } from "../mesh-types.js";

export function parseStlMesh(source) {
  const bytes = sourceBytes(source);
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

export const StlParserNode = defineNode({
  id: "core.mesh.stl-parser",
  name: "STL Parser",
  version: "0.1.0",
  description: "Parses binary and ASCII STL data into the canonical mesh contract.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    source: {
      type: "any",
      required: true,
      description: "An ArrayBuffer, typed array, Blob, File, or file-like STL source.",
    },
  },
  outlets: {
    mesh: {
      type: MeshType,
      description: "Normalized STL triangle mesh.",
    },
  },
  execution: {
    trigger: "input-change",
    domain: "worker",
    pure: true,
    asynchronous: true,
  },
  capabilities: ["mesh-parser", "stl-parser", "worker-safe", "graph-placeable"],
  presentation: {
    catalogs: ["graph", "mesh"],
    placeableOn: ["node-graph"],
    previewOutput: "mesh",
  },
  parts: [{
    id: "stl-parser",
    name: "STL parser",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "parseStlMesh",
    source: stlParserSource(),
  }],
  process: async ({ source }) => ({ mesh: parseStlMesh(await binarySource(source)) }),
});

export async function binarySource(source) {
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return source;
  if (source && typeof source.arrayBuffer === "function") return source.arrayBuffer();
  throw new TypeError("STL source is not binary-readable");
}

function sourceBytes(source) {
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  return new Uint8Array(source || []);
}

function parseBinaryStl(view, count) {
  const sourceBounds = emptyBounds();
  let scanOffset = 84;
  for (let index = 0; index < count && scanOffset + 50 <= view.byteLength; index++, scanOffset += 50) {
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
      const vertexOffset = scanOffset + 12 + vertexIndex * 12;
      for (let axis = 0; axis < 3; axis++) includeBounds(sourceBounds, axis, view.getFloat32(vertexOffset + axis * 4, true));
    }
  }
  const { center, scale } = normalizationTransform(sourceBounds);
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
      for (const value of vertex) positions[positionWrite++] = value;
      offset += 12;
    }
    const normal = vectorLength(sourceNormal) > 0.0001 ? normalizeModelVector(sourceNormal) : modelTriangleNormal(vertices);
    for (const value of normal) faceNormals[normalWrite++] = value;
    offset += 2;
  }
  return attachLegacyTriangleView({
    positions,
    faceNormals,
    triangleCount: count,
    bounds: normalizedBounds(sourceBounds, center, scale),
    sourceBounds,
  });
}

function parseAsciiStl(text = "") {
  const values = [];
  const vertexRe = /vertex\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let match;
  while ((match = vertexRe.exec(text))) values.push([Number(match[1]), Number(match[2]), Number(match[3])]);
  const triangles = [];
  for (let index = 0; index + 2 < values.length; index += 3) {
    const vertices = [values[index], values[index + 1], values[index + 2]];
    triangles.push({ normal: modelTriangleNormal(vertices), vertices });
  }
  return triangles;
}

function normalizeParsedMesh(triangles) {
  const sourceBounds = emptyBounds();
  for (const triangle of triangles) {
    for (const vertex of triangle.vertices) for (let axis = 0; axis < 3; axis++) includeBounds(sourceBounds, axis, vertex[axis]);
  }
  const { center, scale } = normalizationTransform(sourceBounds);
  const positions = new Float32Array(triangles.length * 9);
  const faceNormals = new Float32Array(triangles.length * 3);
  let positionWrite = 0;
  let normalWrite = 0;
  for (const triangle of triangles) {
    const vertices = triangle.vertices.map((vertex) => vertex.map((value, axis) => (value - center[axis]) * scale));
    const normal = normalizeModelVector(vectorLength(triangle.normal) > 0.0001 ? triangle.normal : modelTriangleNormal(vertices));
    for (const vertex of vertices) for (const value of vertex) positions[positionWrite++] = value;
    for (const value of normal) faceNormals[normalWrite++] = value;
  }
  return attachLegacyTriangleView({
    positions,
    faceNormals,
    triangleCount: triangles.length,
    bounds: normalizedBounds(sourceBounds, center, scale),
    sourceBounds,
  });
}

function emptyBounds() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

function includeBounds(bounds, axis, value) {
  bounds.min[axis] = Math.min(bounds.min[axis], value);
  bounds.max[axis] = Math.max(bounds.max[axis], value);
}

function normalizationTransform(bounds) {
  const center = bounds.min.map((min, axis) => (min + bounds.max[axis]) * 0.5);
  const extent = Math.max(...bounds.max.map((max, axis) => Math.abs(max - bounds.min[axis])), 0.0001);
  return { center, scale: 100 / extent };
}

function normalizedBounds(bounds, center, scale) {
  return {
    min: bounds.min.map((value, axis) => (value - center[axis]) * scale),
    max: bounds.max.map((value, axis) => (value - center[axis]) * scale),
  };
}

function vectorLength(vector = []) {
  return Math.hypot(Number(vector[0]) || 0, Number(vector[1]) || 0, Number(vector[2]) || 0);
}

function stlParserSource() {
  return [
    parseStlMesh,
    sourceBytes,
    parseBinaryStl,
    parseAsciiStl,
    normalizeParsedMesh,
    emptyBounds,
    includeBounds,
    normalizationTransform,
    normalizedBounds,
    vectorLength,
  ].map((fn) => fn.toString()).join("\n\n");
}
