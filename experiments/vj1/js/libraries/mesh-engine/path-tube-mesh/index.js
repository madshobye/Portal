import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { MeshType } from "../mesh-types.js";
import {
  createPathTubeMesh,
  proceduralMeshSignature,
} from "../procedural-mesh-primitives/index.js?v=procedural-mesh-primitives-2";

export const PathTubeMeshNode = defineNode({
  id: "core.scene3d.path-tube-mesh",
  name: "Path Tube Mesh",
  version: "0.1.0",
  description: "Creates a retained tapered tube mesh from serializable path points and per-point radii.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    path: { type: "list", defaultValue: [] },
    segments: { type: "number", defaultValue: 8, allowedRange: [3, 256], clamp: true },
    capStart: { type: "boolean", defaultValue: true },
    capEnd: { type: "boolean", defaultValue: true },
    transform: { type: "transform3d", optional: true },
  },
  outlets: { mesh: { type: MeshType } },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: ["scene-3d", "mesh-source", "procedural-mesh", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh", "scene-3d"], placeableOn: ["node-graph"] },
  process: pathTubeMeshNodeProcess,
});

export function pathTubeMeshNodeProcess(inputs = {}, { state = {}, output = null } = {}) {
  const signature = proceduralMeshSignature(inputs);
  if (state.signature !== signature || !state.mesh) {
    state.signature = signature;
    state.mesh = createPathTubeMesh(inputs);
  }
  const result = output || state.output || (state.output = { mesh: null });
  result.mesh = state.mesh;
  return result;
}
