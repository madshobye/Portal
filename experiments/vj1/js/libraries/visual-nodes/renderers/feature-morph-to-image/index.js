import {
  defineNode,
  NODE_EDIT_ACTIVATION,
  NODE_EXECUTION_CLASSES,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import {
  FeatureMorphAnalysisType,
  MediaImageResourceType,
} from "../../shared/specialized-compound-types.js";
import {
  FEATURE_MORPH_FRAGMENT_SHADER,
  FEATURE_MORPH_VERTEX_SHADER,
  imageFitUniform,
} from "../../generators/feature-morph/runtime.js";

export const FeatureMorphToImageNode = defineNode({
  id: "core.visual.feature-morph-to-image",
  name: "Feature Morph to Image",
  version: "0.1.0",
  description: "Combines two image resources and a feature-analysis field through the retained morph shader.",
  implementation: {
    kind: NODE_IMPLEMENTATION_KINDS.NATIVE,
    compiler: "vj1.visual.specialized-compound",
    kernel: "feature-morph",
  },
  inlets: {
    imageA: { type: MediaImageResourceType, required: true },
    imageB: { type: MediaImageResourceType, required: true },
    analysis: { type: FeatureMorphAnalysisType, required: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "feature-morph-pass" },
    enabled: { type: "boolean", defaultValue: true },
    morph: { type: "number", defaultValue: 0, allowedRange: [0, 1], clamp: true },
    autoSpeed: { type: "number", defaultValue: 0, allowedRange: [0, 2], clamp: true },
    morphStrategy: {
      type: { type: "enum", values: ["elastic", "rigid", "flow", "fluid"] },
      defaultValue: "flow",
    },
    warpStrength: { type: "number", defaultValue: 1, allowedRange: [0, 4], clamp: true },
    influence: { type: "number", defaultValue: 0.2, allowedRange: [0, 0.5], clamp: true },
    fit: {
      type: { type: "enum", values: ["cover", "contain", "stretch"] },
      defaultValue: "cover",
    },
    renderQuality: { type: "number", defaultValue: 0.5, allowedRange: [0, 1], clamp: true },
  },
  outlets: {
    texture: { type: "texture" },
  },
  execution: {
    trigger: "frame",
    domain: "gpu",
    stateful: true,
    asynchronous: false,
    workload: NODE_EXECUTION_CLASSES.LIVE_FRAME,
    roi: { mode: "local", mapping: "content-transform" },
  },
  authoring: {
    activation: NODE_EDIT_ACTIVATION.READ_ONLY,
    reason: "The retained ML field texture and shader target are context-bound; connected images, analysis algorithms, shader source, and controls remain editable.",
  },
  capabilities: [
    "render-operation",
    "retained-render-target",
    "feature-morph",
    "feature-morph-render-kernel",
    "specialized-visual-stage",
    "graph-placeable",
    "compiled-only",
  ],
  presentation: {
    catalogs: ["node-graph", "image", "ai", "render", "specialized-visual"],
    placeableOn: ["native-visual-graph"],
    previewOutput: "texture",
  },
  metadata: {
    nativeKernel: "feature-morph",
    nativeRenderer: "output/specialized:featureMorph",
    nodeOwnedNativeModule: true,
    allocationStable: true,
    runtimePolicy: Object.freeze({
      timeDependent: (params = {}) => Math.abs(Number(params.autoSpeed) || 0) > 0.0001,
      rateParam: "autoSpeed",
    }),
    nativeArtifactRequirements: {
      moduleExports: ["imageFitUniform"],
      shaders: ["feature-morph-vertex", "feature-morph-fragment"],
    },
  },
  parts: [
    {
      id: "feature-morph-fit-module",
      name: "Feature Morph image-fit algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["imageFitUniform"],
      source: imageFitUniform.toString(),
    },
    {
      id: "feature-morph-vertex",
      name: "Feature Morph vertex shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "vertex",
      program: "feature-morph",
      editable: true,
      source: FEATURE_MORPH_VERTEX_SHADER,
    },
    {
      id: "feature-morph-fragment",
      name: "Feature Morph fragment shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "fragment",
      program: "feature-morph",
      editable: true,
      source: FEATURE_MORPH_FRAGMENT_SHADER,
    },
  ],
  moduleExports: {
    imageFitUniform,
  },
});
