import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { createTransform3d } from "../scene-types.js";

export const Transform3dNode = defineNode({
  id: "core.scene3d.transform",
  name: "3D Transform",
  version: "0.1.0",
  description: "Creates a reusable 3D object transform in normalized Scene coordinates.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    position: { type: "vector3", defaultValue: [0, 0, 0] },
    rotation: { type: "vector3", defaultValue: [0, 0, 0] },
    scale: { type: "vector3", defaultValue: [1, 1, 1] },
  },
  outlets: { transform: { type: "transform3d" } },
  execution: { trigger: "input-change", domain: "main", pure: true },
  capabilities: ["scene-3d", "transform", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh", "scene-3d"], placeableOn: ["node-graph"] },
  process: (inputs) => ({ transform: createTransform3d(inputs) }),
});
