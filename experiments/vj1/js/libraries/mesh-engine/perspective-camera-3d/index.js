import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { Camera3dType, createCamera3d } from "../scene-types.js";

export const PerspectiveCamera3dNode = defineNode({
  id: "core.scene3d.perspective-camera",
  name: "Perspective Camera",
  version: "0.1.0",
  description: "Creates a camera that can be connected independently to mesh-to-image operations.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    position: { type: "vector3", defaultValue: [0, 0, 0.92] },
    target: { type: "vector3", defaultValue: [0, 0, 0] },
    up: { type: "vector3", defaultValue: [0, 1, 0] },
  },
  parameters: {
    fieldOfView: { type: "number", defaultValue: Math.PI / 3, allowedRange: [0.05, Math.PI - 0.05], clamp: true },
    near: { type: "number", defaultValue: 0.0005, allowedRange: [0.00001, 10], clamp: true },
    far: { type: "number", defaultValue: 25, allowedRange: [0.001, 1000], clamp: true },
  },
  outlets: { camera: { type: Camera3dType } },
  execution: { trigger: "input-change", domain: "main", pure: true },
  capabilities: ["scene-3d", "camera", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh", "scene-3d"], placeableOn: ["node-graph"] },
  process: (inputs) => ({ camera: createCamera3d(inputs) }),
});
