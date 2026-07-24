import {
  defineNode,
  NODE_EDIT_ACTIVATION,
  NODE_EXECUTION_CLASSES,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import { TextMaskProviderType } from "../../shared/specialized-compound-types.js";
import {
  TEXT_GENERATOR_FRAGMENT_SHADER,
  TEXT_GENERATOR_VERTEX_SHADER,
} from "../../generators/text/runtime.js";

export const TextMaskToImageNode = defineNode({
  id: "core.visual.text-mask-to-image",
  name: "Text Mask to Image",
  version: "0.1.0",
  description: "Applies fill, outline, and background styling to a connected retained text mask.",
  implementation: {
    kind: NODE_IMPLEMENTATION_KINDS.NATIVE,
    compiler: "vj1.visual.specialized-compound",
    kernel: "text-mask",
  },
  inlets: {
    mask: { type: TextMaskProviderType, required: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "text-mask-pass" },
    enabled: { type: "boolean", defaultValue: true },
    fillEnabled: { type: "boolean", defaultValue: true },
    outlineEnabled: { type: "boolean", defaultValue: false },
    fillColor: { type: "color", defaultValue: "#ffffffff" },
    outlineColor: { type: "color", defaultValue: "#ffffffff" },
    outlineWidth: { type: "number", defaultValue: 0.012, allowedRange: [0, 0.16], clamp: true },
    backgroundColor: { type: "color", defaultValue: "#00000000" },
    renderQuality: { type: "number", defaultValue: 0.5, allowedRange: [0, 1], clamp: true },
  },
  outlets: {
    texture: { type: "texture" },
  },
  execution: {
    trigger: "input-change",
    domain: "gpu",
    stateful: true,
    asynchronous: false,
    workload: NODE_EXECUTION_CLASSES.LIVE_FRAME,
    roi: { mode: "local", mapping: "content-transform", halo: "outlineWidth" },
  },
  authoring: {
    activation: NODE_EDIT_ACTIVATION.READ_ONLY,
    reason: "The mask upload and retained shader target are context-bound; the connected mask, shader source, and style controls remain editable.",
  },
  capabilities: [
    "render-operation",
    "retained-render-target",
    "text",
    "text-render-kernel",
    "specialized-visual-stage",
    "graph-placeable",
    "compiled-only",
  ],
  presentation: {
    catalogs: ["node-graph", "text", "image", "render", "specialized-visual"],
    placeableOn: ["native-visual-graph"],
    previewOutput: "texture",
  },
  metadata: {
    nativeKernel: "text-mask",
    nativeRenderer: "output/specialized:text",
    allocationStable: true,
    nativeArtifactRequirements: {
      moduleExports: [],
      shaders: ["vertex-shader", "fragment-shader"],
    },
  },
  parts: [
    {
      id: "vertex-shader",
      name: "Text vertex shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "vertex",
      program: "text-mask",
      editable: true,
      source: TEXT_GENERATOR_VERTEX_SHADER,
    },
    {
      id: "fragment-shader",
      name: "Text fill and outline shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "fragment",
      program: "text-mask",
      editable: true,
      source: TEXT_GENERATOR_FRAGMENT_SHADER,
    },
  ],
});
