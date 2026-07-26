import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../../node-engine/node-definition.js";
import {
  Camera3dType,
  createCamera3d,
} from "../../../mesh-engine/scene-types.js";
import { modelCameraFov } from "../../../mesh-engine/mesh-render-math.js";

export const ModelFitCameraNode = defineNode({
  id: "core.visual.model-fit-camera",
  name: "Model Fit Camera",
  version: "0.1.0",
  description: "Produces a perspective Camera3d for renderers that fit normalized model bounds to the requested image boundary.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  parameters: {
    fieldOfView: {
      type: "number",
      defaultValue: Math.PI / 3,
      allowedRange: [20 * Math.PI / 180, 120 * Math.PI / 180],
      clamp: true,
    },
    focalLength: {
      type: "number",
      defaultValue: 0,
      allowedRange: [0, 200],
      clamp: true,
      description: "Optional 36x24 mm full-frame focal length. Zero uses fieldOfView.",
    },
  },
  outlets: { camera: { type: Camera3dType } },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: [
    "camera",
    "model-fit-camera",
    "scene-3d",
    "retained-value-provider",
    "visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "camera", "mesh", "scene-3d", "visual-stage"],
    placeableOn: ["visual-graph", "node-graph", "native-visual-graph"],
    previewOutput: "camera",
  },
  process: modelFitCameraProcess,
});

export function modelFitCameraProcess(inputs = {}, { state = {}, output = null } = {}) {
  const fieldOfView = Number(inputs.focalLength) > 0
    ? modelCameraFov({ focalLength: inputs.focalLength })
    : bounded(
        inputs.fieldOfView,
        20 * Math.PI / 180,
        120 * Math.PI / 180,
        Math.PI / 3,
      );
  if (state.fieldOfView !== fieldOfView || !state.camera) {
    state.fieldOfView = fieldOfView;
    state.camera = createCamera3d({
      projection: "perspective",
      position: [0, 0, 0.92],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fieldOfView,
      near: 0.0005,
      far: 25,
    });
  }
  const result = output || state.output || (state.output = { camera: null });
  result.camera = state.camera;
  return result;
}

function bounded(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}
