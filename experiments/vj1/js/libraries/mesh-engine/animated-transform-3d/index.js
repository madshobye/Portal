import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import {
  createRetainedTransform3d,
  updateRetainedTransform3d,
} from "../scene-types.js?v=retained-transform-signal-1";

export const AnimatedTransform3dNode = defineNode({
  id: "core.scene3d.animated-transform",
  name: "Animated 3D Transform",
  version: "0.1.0",
  description: "Creates a reusable Transform3D with frame-time rotation and independent axis scaling.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    componentTime: { type: "number", required: true },
    positionX: { type: "number", defaultValue: 0 },
    positionY: { type: "number", defaultValue: 0 },
    positionZ: { type: "number", defaultValue: 0 },
    rotationX: { type: "number", defaultValue: 0 },
    rotationY: { type: "number", defaultValue: 0 },
    rotationZ: { type: "number", defaultValue: 0 },
    rotationOffset: { type: "vector3", defaultValue: [0, 0, 0] },
    spinX: { type: "number", defaultValue: 0 },
    spinY: { type: "number", defaultValue: 0 },
    spinZ: { type: "number", defaultValue: 0 },
    uniformScale: { type: "number", defaultValue: 1 },
    scaleX: { type: "number", defaultValue: 1 },
    scaleY: { type: "number", defaultValue: 1 },
    scaleZ: { type: "number", defaultValue: 1 },
  },
  outlets: { transform: { type: "transform3d" } },
  execution: {
    trigger: "frame",
    domain: "main",
    pure: true,
    asynchronous: false,
  },
  capabilities: [
    "scene-3d",
    "transform",
    "controller",
    "animation",
    "graph-placeable",
    "live-fast-path",
  ],
  presentation: {
    catalogs: ["graph", "mesh", "scene-3d", "motion"],
    placeableOn: ["node-graph"],
  },
  process: animatedTransform3dProcess,
});

export function animatedTransform3dProcess(inputs = {}, { state = {}, output = null } = {}) {
  const time = finite(inputs.componentTime, 0);
  const uniformScale = Math.max(0.0001, Math.abs(finite(inputs.uniformScale, 1)));
  const transform = state.transform || (state.transform = createRetainedTransform3d());
  const rotationOffset = Array.isArray(inputs.rotationOffset) || ArrayBuffer.isView(inputs.rotationOffset)
    ? inputs.rotationOffset
    : [0, 0, 0];
  updateRetainedTransform3d(transform, {
      position: [
        finite(inputs.positionX, 0),
        finite(inputs.positionY, 0),
        finite(inputs.positionZ, 0),
      ],
      rotation: [
        finite(rotationOffset[0], 0) + finite(inputs.rotationX, 0) + time * finite(inputs.spinX, 0),
        finite(rotationOffset[1], 0) + finite(inputs.rotationY, 0) + time * finite(inputs.spinY, 0),
        finite(rotationOffset[2], 0) + finite(inputs.rotationZ, 0) + time * finite(inputs.spinZ, 0),
      ],
      scale: [
        uniformScale * finite(inputs.scaleX, 1),
        uniformScale * finite(inputs.scaleY, 1),
        uniformScale * finite(inputs.scaleZ, 1),
      ],
  });
  const result = output || state.output || (state.output = { transform: null });
  result.transform = transform;
  return result;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
