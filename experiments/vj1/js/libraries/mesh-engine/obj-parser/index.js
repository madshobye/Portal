import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { attachLegacyTriangleView, MeshType } from "../mesh-types.js";

export const DEFAULT_OBJ_PREVIEW_TRIANGLES = 600;

export function parseObjMesh(text = "") {
  const source = String(text || "");
  const vertexValues = [];
  const triangleIndices = [];
  const sourceBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
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
        const [a, b, c] = [face[0], face[index], face[index + 1]];
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

// OBJ vertex references require retaining the vertex table, but preview mode
// keeps only a bounded reservoir of faces and never expands the full mesh.
export function parseObjPreviewMesh(text = "", limit = DEFAULT_OBJ_PREVIEW_TRIANGLES) {
  const source = String(text || "");
  const vertices = [];
  const samples = [];
  const bounds = previewEmptyBounds();
  let triangleSerial = 0;
  let randomState = 0x9e3779b9;
  let cursor = 0;
  while (cursor < source.length) {
    const newline = source.indexOf("\n", cursor);
    const line = source.slice(cursor, newline < 0 ? source.length : newline).trim();
    cursor = newline < 0 ? source.length : newline + 1;
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const type = parts.shift();
    if (type === "v" && parts.length >= 3) {
      const vertex = [0, 1, 2].map((axis) => Number(parts[axis]) || 0);
      vertices.push(...vertex);
      includePreviewBounds(bounds, vertex);
      continue;
    }
    if (type !== "f" || parts.length < 3) continue;
    const vertexCount = vertices.length / 3;
    const face = parts.map((token) => resolveObjIndex(token.split("/", 1)[0], vertexCount));
    for (let index = 1; index + 1 < face.length; index++) {
      const triangle = [face[0], face[index], face[index + 1]];
      if (triangle.some((value) => value < 0 || value >= vertexCount) || new Set(triangle).size < 3) continue;
      randomState = previewXorshift32(randomState + triangleSerial + 1);
      reservoirPreviewTriangle(samples, triangle, triangleSerial++, limit, randomState);
    }
  }
  if (!vertices.length || !samples.length) throw new Error("OBJ contained no previewable polygon faces");
  return indexedPreviewMesh(vertices, samples, bounds);
}

export const ObjParserNode = defineNode({
  id: "core.mesh.obj-parser",
  name: "OBJ Parser",
  version: "0.1.0",
  description: "Parses OBJ vertex and polygon data into the canonical indexed mesh contract.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    source: {
      type: "any",
      required: true,
      description: "OBJ text, Blob, File, ArrayBuffer, or typed-array source.",
    },
  },
  parameters: {
    profile: {
      type: { type: "enum", values: ["full", "preview"] },
      defaultValue: "full",
      editor: { type: "select" },
    },
    triangleLimit: {
      type: "number",
      defaultValue: DEFAULT_OBJ_PREVIEW_TRIANGLES,
      allowedRange: [1, 10000],
      clamp: true,
    },
  },
  outlets: { mesh: { type: MeshType, description: "Normalized indexed OBJ mesh." } },
  execution: { trigger: "input-change", domain: "worker", pure: true, asynchronous: true },
  capabilities: ["mesh-parser", "obj-parser", "worker-safe", "graph-placeable"],
  moduleBindings: { attachLegacyTriangleView, DEFAULT_OBJ_PREVIEW_TRIANGLES },
  presentation: { catalogs: ["graph", "mesh"], placeableOn: ["node-graph"], previewOutput: "mesh" },
  parts: [
    {
      id: "obj-parser",
      name: "OBJ parser algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["parseObjMesh", "parseObjPreviewMesh"],
      source: [
        parseObjMesh,
        parseObjPreviewMesh,
        resolveObjIndex,
        indexedPreviewMesh,
        previewTriangleMesh,
        previewTriangleNormal,
        reservoirPreviewTriangle,
        previewTriangleLimit,
        previewXorshift32,
        previewEmptyBounds,
        includePreviewBounds,
      ].map((fn) => fn.toString()).join("\n\n"),
    },
    {
      id: "obj-source-reader",
      name: "OBJ source reader",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "textSource",
      source: textSource.toString(),
    },
    {
      id: "obj-process",
      name: "OBJ process entry",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "objParserNodeProcess",
      entry: "process",
      dependsOn: ["obj-parser", "obj-source-reader"],
      source: objParserNodeProcess.toString(),
    },
  ],
  process: objParserNodeProcess,
});

export async function objParserNodeProcess(inputs = {}) {
  const text = await textSource(inputs.source);
  return { mesh: inputs.profile === "preview"
    ? parseObjPreviewMesh(text, inputs.triangleLimit)
    : parseObjMesh(text) };
}

export async function textSource(source) {
  if (typeof source === "string") return source;
  if (source && typeof source.text === "function") return source.text();
  if (source instanceof ArrayBuffer) return new TextDecoder("utf-8").decode(source);
  if (ArrayBuffer.isView(source)) return new TextDecoder("utf-8").decode(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
  throw new TypeError("OBJ source is not text-readable");
}

function resolveObjIndex(token, length) {
  const value = Number.parseInt(token, 10);
  if (!Number.isFinite(value) || value === 0) return -1;
  return value < 0 ? length + value : value - 1;
}

function indexedPreviewMesh(vertexValues, triangles, sourceBounds) {
  const raw = triangles.map((indices) => indices.map((index) => {
    const offset = index * 3;
    return [vertexValues[offset], vertexValues[offset + 1], vertexValues[offset + 2]];
  }));
  return previewTriangleMesh(raw, sourceBounds);
}

function previewTriangleMesh(triangles, suppliedBounds = null) {
  const bounds = suppliedBounds || previewEmptyBounds();
  if (!suppliedBounds) for (const triangle of triangles) for (const vertex of triangle) includePreviewBounds(bounds, vertex);
  const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) * 0.5);
  const extent = Math.max(...bounds.max.map((value, axis) => Math.abs(value - bounds.min[axis])), 0.0001);
  const scale = 100 / extent;
  const positions = new Float32Array(triangles.length * 9);
  const faceNormals = new Float32Array(triangles.length * 3);
  let positionOffset = 0;
  let normalOffset = 0;
  for (const triangle of triangles) {
    const normalized = triangle.map((vertex) => vertex.map((value, axis) => (value - center[axis]) * scale));
    for (const vertex of normalized) for (const value of vertex) positions[positionOffset++] = value;
    const normal = previewTriangleNormal(normalized);
    for (const value of normal) faceNormals[normalOffset++] = value;
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

function previewTriangleNormal(vertices) {
  const [a, b, c] = vertices;
  const ab = b.map((value, axis) => value - a[axis]);
  const ac = c.map((value, axis) => value - a[axis]);
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(...normal) || 1;
  return normal.map((value) => value / length);
}

function reservoirPreviewTriangle(samples, triangle, serial, limit, randomState) {
  const capacity = previewTriangleLimit(limit);
  if (samples.length < capacity) {
    samples.push(triangle);
    return;
  }
  const slot = randomState % (serial + 1);
  if (slot < capacity) samples[slot] = triangle;
}

function previewTriangleLimit(limit) {
  return Math.max(1, Math.floor(Number(limit) || DEFAULT_OBJ_PREVIEW_TRIANGLES));
}

function previewXorshift32(value) {
  let result = value >>> 0;
  result ^= result << 13;
  result ^= result >>> 17;
  result ^= result << 5;
  return result >>> 0;
}

function previewEmptyBounds() {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

function includePreviewBounds(bounds, vertex) {
  for (let axis = 0; axis < 3; axis++) {
    bounds.min[axis] = Math.min(bounds.min[axis], vertex[axis]);
    bounds.max[axis] = Math.max(bounds.max[axis], vertex[axis]);
  }
}
