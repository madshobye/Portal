import { prepare3dAsset } from "../../libraries/mesh-engine/prepare-3d-asset/index.js";
import { buildParsedModelSurfaceVertices } from "../../libraries/mesh-engine/mesh-geometry.js";

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
    prepareHighestDetailSurface(mesh);
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
    if (lod?.surfaceVertices?.buffer) buffers.add(lod.surfaceVertices.buffer);
  }
  return Array.from(buffers);
}

function prepareHighestDetailSurface(mesh) {
  // Geometry Detail selects progressively smaller retained LODs. Only the
  // highest one creates a material first-frame risk large enough to disturb a
  // transition, so prepare that interleaved GPU payload off the presentation
  // thread without multiplying every cached LOD's memory footprint.
  const lod = mesh?.lods?.[0] || mesh;
  if (!lod) return;
  lod.surfaceVertices = buildParsedModelSurfaceVertices(lod);
  if (mesh !== lod && mesh?.positions === lod.positions) {
    mesh.surfaceVertices = lod.surfaceVertices;
  }
}
