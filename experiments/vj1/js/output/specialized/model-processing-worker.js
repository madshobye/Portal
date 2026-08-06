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
    prepareLodSurfaces(mesh);
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

function prepareLodSurfaces(mesh) {
  // Geometry Detail and requested raster size may select any retained LOD.
  // Every selectable surface payload must therefore be expanded in the worker;
  // preparing only LOD 0 merely moved the long task to the first presentation
  // frame whenever the authored detail selected another level.
  const lods = mesh?.lods?.length ? mesh.lods : [mesh];
  for (const lod of lods) {
    if (!lod) continue;
    lod.surfaceVertices = buildParsedModelSurfaceVertices(lod);
  }
  const first = lods[0];
  if (mesh !== first && mesh?.positions === first?.positions) {
    mesh.surfaceVertices = first.surfaceVertices;
  }
}
