import { parseObjMesh, parseStlMesh } from "./model-parsers.js?v=model-qem-4";
import { buildAutomaticModelLods } from "./model-lod.js?v=model-wire-detail-2";

self.onmessage = (event) => {
  const { requestId, type, levels } = event.data || {};
  try {
    let buffer = event.data?.buffer;
    let text = event.data?.text;
    if (type === "obj" && text == null) {
      text = new TextDecoder("utf-8").decode(buffer);
      event.data.buffer = null;
      buffer = null;
    }
    const parsed = type === "obj" ? parseObjMesh(text || "") : parseStlMesh(buffer);
    text = null;
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
