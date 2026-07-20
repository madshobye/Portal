import { prepare3dAsset } from "../../libraries/mesh-engine/prepare-3d-asset/index.js";

self.onmessage = async (event) => {
  const { requestId, type, levels } = event.data || {};
  try {
    let buffer = event.data?.buffer;
    let text = event.data?.text;
    if (type === "obj" && text == null) {
      text = new TextDecoder("utf-8").decode(buffer);
      event.data.buffer = null;
      buffer = null;
    }
    const mesh = (await prepare3dAsset({
      source: type === "obj" ? (text || "") : buffer,
      format: type,
      resolution: "automatic",
      levels,
    })).mesh;
    text = null;
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
