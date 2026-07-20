import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { attachLegacyTriangleView, MeshType } from "../mesh-types.js";

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
  outlets: { mesh: { type: MeshType, description: "Normalized indexed OBJ mesh." } },
  execution: { trigger: "input-change", domain: "worker", pure: true, asynchronous: true },
  capabilities: ["mesh-parser", "obj-parser", "worker-safe", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh"], placeableOn: ["node-graph"], previewOutput: "mesh" },
  parts: [{
    id: "obj-parser",
    name: "OBJ parser",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "parseObjMesh",
    source: [parseObjMesh, resolveObjIndex, textSource].map((fn) => fn.toString()).join("\n\n"),
  }],
  process: async ({ source }) => ({ mesh: parseObjMesh(await textSource(source)) }),
});

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
