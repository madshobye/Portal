import { valueType } from "../../node-engine/node-types.js";
import { isMesh } from "../mesh-types.js";

export const MeshCollectionType = valueType("mesh-collection", {
  contractVersion: 1,
  description: "Named canonical meshes sharing one collection-local coordinate space and independent material slots.",
});

export function createMeshCollection(value = {}) {
  const id = String(value.id || "mesh-collection");
  const parts = (value.parts || []).map((part, index) =>
    normalizeMeshCollectionPart(part, index, id)
  );
  if (!parts.length) throw new Error(`MESH_COLLECTION_EMPTY:${id}`);
  const ids = new Set();
  for (const part of parts) {
    if (ids.has(part.id)) throw new Error(`MESH_COLLECTION_PART_DUPLICATE:${id}:${part.id}`);
    ids.add(part.id);
  }
  return Object.freeze({
    kind: "mesh-collection",
    contractVersion: 1,
    id,
    parts: Object.freeze(parts),
    bounds: aggregateBounds(parts.map((part) => part.mesh.bounds)),
    sourceBounds: aggregateBounds(parts.map((part) => part.mesh.sourceBounds)),
    metadata: Object.freeze({ ...(value.metadata || {}) }),
  });
}

export function isMeshCollection(value) {
  return value?.kind === "mesh-collection" &&
    value.contractVersion === 1 &&
    Array.isArray(value.parts) &&
    value.parts.length > 0 &&
    value.parts.every((part) => typeof part.id === "string" && isMesh(part.mesh));
}

function normalizeMeshCollectionPart(part = {}, index, collectionId) {
  if (!isMesh(part.mesh)) {
    throw new Error(`MESH_COLLECTION_PART_MESH_INVALID:${collectionId}:${part.id || index}`);
  }
  return Object.freeze({
    id: String(part.id || `part-${index + 1}`),
    mesh: part.mesh,
    materialSlot: String(part.materialSlot || "default"),
    visible: part.visible !== false,
    metadata: Object.freeze({ ...(part.metadata || {}) }),
  });
}

function aggregateBounds(values = []) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const bounds of values) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], finite(bounds?.min?.[axis], 0));
      max[axis] = Math.max(max[axis], finite(bounds?.max?.[axis], 0));
    }
  }
  return Object.freeze({
    min: Object.freeze(min),
    max: Object.freeze(max),
  });
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
