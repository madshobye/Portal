import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { createObject3d, Material3dType, Object3dType } from "../scene-types.js";
import { MeshType } from "../mesh-types.js";

export const SceneObject3dNode = defineNode({
  id: "core.scene3d.object",
  name: "3D Object",
  version: "0.1.0",
  description: "Instantiates a canonical mesh with an independent transform and material.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    id: { type: "string", defaultValue: "object" },
    mesh: { type: MeshType, required: true },
    material: { type: Material3dType, optional: true },
    transform: { type: "transform3d", optional: true },
    visible: { type: "boolean", defaultValue: true },
  },
  outlets: { object: { type: Object3dType } },
  execution: { trigger: "input-change", domain: "main", pure: true },
  capabilities: [
    "scene-3d",
    "mesh-instance",
    "retained-value-provider",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["graph", "mesh", "scene-3d", "visual"],
    placeableOn: ["visual-graph", "node-graph"],
  },
  process: (inputs) => ({ object: createObject3d(inputs) }),
});
