import {
  defineNode,
  NODE_EDIT_ACTIVATION,
  NODE_EXECUTION_CLASSES,
  NODE_IMPLEMENTATION_KINDS,
} from "../../../node-engine/node-definition.js";
import { Camera3dType } from "../../../mesh-engine/scene-types.js?v=editable-inlet-literals-1";
import {
  GeometryProviderType,
  VisualMaterialProviderType,
} from "../../shared/specialized-compound-types.js";

export const AnatomyToImageNode = defineNode({
  id: "core.visual.anatomy-to-image",
  name: "Anatomy to Image",
  version: "0.1.0",
  description: "Lowers canonical Anatomy geometry, transform, material, and model-fit camera values into the retained Anatomy GPU operation.",
  implementation: {
    kind: NODE_IMPLEMENTATION_KINDS.NATIVE,
    compiler: "vj1.visual.specialized-compound",
    kernel: "anatomy-retained-webgl",
  },
  inlets: {
    geometry: { type: GeometryProviderType, required: true },
    transform: { type: "transform3d", required: true },
    material: { type: VisualMaterialProviderType, required: true },
    camera: { type: Camera3dType, required: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "anatomy-retained-webgl" },
    enabled: { type: "boolean", defaultValue: true },
    renderQuality: { type: "number", defaultValue: 0.5, allowedRange: [0, 1], clamp: true },
  },
  outlets: { texture: { type: "texture" } },
  execution: {
    trigger: "frame",
    domain: "gpu",
    stateful: true,
    asynchronous: false,
    workload: NODE_EXECUTION_CLASSES.LIVE_FRAME,
    roi: { mode: "local", mapping: "projective-model-fit" },
  },
  authoring: {
    activation: NODE_EDIT_ACTIVATION.READ_ONLY,
    reason: "The node is the explicit compiler boundary for retained context-bound Anatomy buffers; its geometry, transform, material, camera, and quality remain editable.",
  },
  capabilities: [
    "render-operation",
    "retained-render-target",
    "anatomy",
    "anatomy-render-kernel",
    "specialized-visual-stage",
    "graph-placeable",
    "compiled-only",
  ],
  presentation: {
    catalogs: ["node-graph", "anatomy", "render", "specialized-visual"],
    placeableOn: ["native-visual-graph"],
    previewOutput: "texture",
  },
  metadata: {
    nativeKernel: "anatomy-retained-webgl",
    nativeRenderer: "output/specialized:anatomy",
    allocationStable: true,
  },
});
