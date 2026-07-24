import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { MeshType } from "../mesh-types.js";
import {
  createProfileMesh,
  proceduralMeshSignature,
} from "../procedural-mesh-primitives/index.js?v=procedural-mesh-primitives-2";

export const ProfileMeshNode = defineNode({
  id: "core.scene3d.profile-mesh",
  name: "Profile Mesh",
  version: "0.1.0",
  description: "Creates a retained capped mesh from serializable elliptical profile slices.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    profile: { type: "list", defaultValue: [] },
    segments: { type: "number", defaultValue: 8, allowedRange: [3, 256], clamp: true },
    capStart: { type: "boolean", defaultValue: true },
    capEnd: { type: "boolean", defaultValue: true },
    transform: { type: "transform3d", optional: true },
  },
  outlets: { mesh: { type: MeshType } },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: ["scene-3d", "mesh-source", "procedural-mesh", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh", "scene-3d"], placeableOn: ["node-graph"] },
  process: profileMeshNodeProcess,
});

export function profileMeshNodeProcess(inputs = {}, { state = {}, output = null } = {}) {
  const signature = proceduralMeshSignature(inputs);
  if (state.signature !== signature || !state.mesh) {
    state.signature = signature;
    state.mesh = createProfileMesh(inputs);
  }
  const result = output || state.output || (state.output = { mesh: null });
  result.mesh = state.mesh;
  return result;
}
