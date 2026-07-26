import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { MeshType } from "../mesh-types.js";
import {
  createEllipsoidMesh,
  proceduralMeshSignature,
} from "../procedural-mesh-primitives/index.js";

export const EllipsoidMeshNode = defineNode({
  id: "core.scene3d.ellipsoid-mesh",
  name: "Ellipsoid Mesh",
  version: "0.1.0",
  description: "Creates a retained ellipsoid mesh with independent radii, rotation, and collection-local transform.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    center: { type: "vector3", defaultValue: [0, 0, 0] },
    radii: { type: "vector3", defaultValue: [1, 1, 1] },
    rotation: { type: "vector3", defaultValue: [0, 0, 0] },
    segments: { type: "number", defaultValue: 8, allowedRange: [3, 256], clamp: true },
    latitudeSegments: { type: "number", defaultValue: 8, allowedRange: [3, 128], clamp: true },
    transform: { type: "transform3d", optional: true },
  },
  outlets: { mesh: { type: MeshType } },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: ["scene-3d", "mesh-source", "procedural-mesh", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh", "scene-3d"], placeableOn: ["node-graph"] },
  process: ellipsoidMeshNodeProcess,
});

export function ellipsoidMeshNodeProcess(inputs = {}, { state = {}, output = null } = {}) {
  const signature = proceduralMeshSignature(inputs);
  if (state.signature !== signature || !state.mesh) {
    state.signature = signature;
    state.mesh = createEllipsoidMesh(inputs);
  }
  const result = output || state.output || (state.output = { mesh: null });
  result.mesh = state.mesh;
  return result;
}
