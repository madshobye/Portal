import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { listType } from "../../node-engine/node-types.js";
import { Camera3dType, createScene3d, Object3dType, Scene3dType } from "../scene-types.js?v=editable-inlet-literals-1";

export const Scene3dNode = defineNode({
  id: "core.scene3d.scene",
  name: "3D Scene Data",
  version: "0.1.0",
  description: "Optionally bundles reusable 3D values as data without becoming a mandatory renderer.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    objects: { type: listType(Object3dType), defaultValue: [] },
    camera: { type: Camera3dType, optional: true },
    background: { type: "color", defaultValue: "#00000000" },
  },
  outlets: { scene: { type: Scene3dType } },
  execution: { trigger: "input-change", domain: "main", pure: true },
  capabilities: [
    "scene-3d",
    "data-bundle",
    "retained-value-provider",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["graph", "mesh", "scene-3d", "visual"],
    placeableOn: ["visual-graph", "node-graph"],
  },
  process: (inputs) => ({ scene: createScene3d(inputs) }),
});
