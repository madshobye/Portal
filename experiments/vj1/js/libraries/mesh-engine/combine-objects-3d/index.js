import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { combineObjects3d, Object3dListType, Object3dType } from "../scene-types.js";

export const CombineObjects3dNode = defineNode({
  id: "core.scene3d.combine-objects",
  name: "Combine 3D Objects",
  version: "0.1.0",
  description: "Combines objects and object lists so a graph can build multi-object scenes incrementally.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    objects: { type: Object3dListType, optional: true, defaultValue: [] },
    a: { type: Object3dType, optional: true },
    b: { type: Object3dType, optional: true },
  },
  outlets: { objects: { type: Object3dListType } },
  execution: { trigger: "input-change", domain: "main", pure: true },
  capabilities: ["scene-3d", "collection", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh", "scene-3d"], placeableOn: ["node-graph"] },
  process: ({ objects, a, b }) => ({ objects: combineObjects3d(objects, a, b) }),
});
