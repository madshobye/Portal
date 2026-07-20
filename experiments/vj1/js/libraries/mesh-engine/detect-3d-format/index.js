import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

const FORMATS = Object.freeze(["stl", "obj"]);

export const Detect3dFormatNode = defineNode({
  id: "core.mesh.detect-3d-format",
  name: "Detect 3D Format",
  version: "0.1.0",
  description: "Detects STL or OBJ input from an explicit hint, filename, or source content.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    source: { type: "any", required: true, description: "3D object source." },
    name: { type: "string", optional: true, defaultValue: "", description: "Optional filename." },
    format: { type: { type: "enum", values: ["", ...FORMATS] }, optional: true, defaultValue: "" },
  },
  outlets: { format: { type: { type: "enum", values: FORMATS } } },
  execution: { trigger: "input-change", domain: "worker", pure: true, asynchronous: true },
  capabilities: ["format-detection", "mesh-parser", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh"], placeableOn: ["node-graph"] },
  parts: [{
    id: "format-detector",
    name: "Format detector",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "detect3dFormat",
    source: detect3dFormat.toString(),
  }],
  process: async ({ source, name, format }) => ({ format: await detect3dFormat(source, { name, format }) }),
});

export async function detect3dFormat(source, { name = "", format = "" } = {}) {
  const explicit = String(format || "").toLowerCase();
  if (FORMATS.includes(explicit)) return explicit;
  const filename = String(name || source?.name || source?.relativePath || source?.webkitRelativePath || "").toLowerCase();
  if (/\.stl$/.test(filename)) return "stl";
  if (/\.obj$/.test(filename)) return "obj";
  const prefix = await sourcePrefix(source);
  if (/^\s*(?:#.*\n\s*)*(?:v|o|g|mtllib|usemtl)\s+/im.test(prefix) && /^\s*(?:#.*\n\s*)*v\s+/im.test(prefix)) return "obj";
  if (/^\s*solid(?:\s|$)/i.test(prefix) || /\bfacet\s+normal\b/i.test(prefix)) return "stl";
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source) || typeof source?.arrayBuffer === "function") return "stl";
  throw new Error("Could not detect a supported 3D object format");
}

async function sourcePrefix(source) {
  if (typeof source === "string") return source.slice(0, 8192);
  if (source && typeof source.text === "function") return (await source.text()).slice(0, 8192);
  let buffer = source;
  if (source && typeof source.arrayBuffer === "function") buffer = await source.arrayBuffer();
  if (buffer instanceof ArrayBuffer) return new TextDecoder("utf-8").decode(new Uint8Array(buffer, 0, Math.min(8192, buffer.byteLength)));
  if (ArrayBuffer.isView(buffer)) return new TextDecoder("utf-8").decode(new Uint8Array(buffer.buffer, buffer.byteOffset, Math.min(8192, buffer.byteLength)));
  return "";
}
