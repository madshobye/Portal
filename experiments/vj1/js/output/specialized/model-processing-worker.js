import { parseObjMesh, parseStlMesh } from "./model-parsers.js?v=model-lod-1";
import { buildAutomaticModelLods } from "./model-lod.js?v=model-lod-1";

self.onmessage = (event) => {
  const { requestId, type, buffer, text, levels } = event.data || {};
  try {
    const parsed = type === "obj" ? parseObjMesh(text || "") : parseStlMesh(buffer);
    const mesh = buildAutomaticModelLods(parsed, levels);
    const transfer = transferableMeshArrays(mesh);
    self.postMessage({ requestId, mesh }, transfer);
  } catch (error) {
    self.postMessage({ requestId, error: error?.message || String(error || "model processing failed") });
  }
};

function transferableMeshArrays(mesh) {
  const buffers = new Set();
  for (const lod of mesh?.lods || [mesh]) {
    if (lod?.positions?.buffer) buffers.add(lod.positions.buffer);
    if (lod?.faceNormals?.buffer) buffers.add(lod.faceNormals.buffer);
  }
  return Array.from(buffers);
}
