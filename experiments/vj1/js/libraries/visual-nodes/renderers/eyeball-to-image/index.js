import {
  defineNode,
  NODE_EDIT_ACTIVATION,
  NODE_EXECUTION_CLASSES,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import { GazeBlinkUniformsType } from "../../shared/specialized-compound-types.js";
import {
  CONTROLLED_IMAGE_VERTEX_SHADER,
  EYEBALL_FRAGMENT_SHADER,
} from "./shader.js";

export const EyeballToImageNode = defineNode({
  id: "core.visual.eyeball-to-image",
  name: "Eyeball to Image",
  version: "0.1.0",
  description: "Renders an eyeball from connected gaze/blink uniforms in one retained shader pass.",
  implementation: {
    kind: NODE_IMPLEMENTATION_KINDS.NATIVE,
    compiler: "vj1.visual.specialized-compound",
    kernel: "controlled-shader",
  },
  inlets: {
    uniforms: { type: GazeBlinkUniformsType, required: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "eyeball-shader" },
    enabled: { type: "boolean", defaultValue: true },
    irisSize: { type: "number", defaultValue: 1, allowedRange: [0.5, 1.6], clamp: true },
    pupilSize: { type: "number", defaultValue: 1, allowedRange: [0.5, 1.8], clamp: true },
    lidAmount: { type: "number", defaultValue: 1, allowedRange: [0, 1.5], clamp: true },
    veinAmount: { type: "number", defaultValue: 0.6, allowedRange: [0, 1], clamp: true },
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
    reason: "The retained p5 shader target is host-bound; shader source, connected controller, and visual parameters remain independently editable.",
  },
  capabilities: [
    "render-operation",
    "controlled-shader",
    "character",
    "specialized-visual-stage",
    "graph-placeable",
    "compiled-only",
  ],
  presentation: {
    catalogs: ["node-graph", "character", "image", "render", "specialized-visual"],
    placeableOn: ["native-visual-graph"],
    previewOutput: "texture",
  },
  metadata: {
    nativeKernel: "controlled-shader",
    nativeRenderer: "output/specialized:controlledShader",
    allocationStable: true,
    nativeArtifactRequirements: {
      moduleExports: ["applyControlledShaderUniforms"],
      shaders: ["controlled-shader-vertex", "controlled-shader-fragment"],
    },
  },
  parts: [
    {
      id: "controlled-shader-uniform-module",
      name: "Eyeball shader uniform binding",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["applyControlledShaderUniforms"],
      source: applyControlledShaderUniforms.toString(),
    },
    {
      id: "controlled-shader-vertex",
      name: "Controlled image vertex shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "vertex",
      program: "controlled-shader",
      editable: true,
      source: CONTROLLED_IMAGE_VERTEX_SHADER,
    },
    {
      id: "controlled-shader-fragment",
      name: "Eyeball fragment shader",
      kind: NODE_PART_KINDS.SHADER,
      language: "glsl",
      stage: "fragment",
      program: "controlled-shader",
      editable: true,
      source: EYEBALL_FRAGMENT_SHADER,
    },
  ],
  moduleExports: {
    applyControlledShaderUniforms,
  },
});

export function applyControlledShaderUniforms(shader, uniforms = {}, params = {}) {
  shader.setUniform("irisSize", Math.max(0.05, Number(params.irisSize) || 1));
  shader.setUniform("pupilSize", Math.max(0.05, Number(params.pupilSize) || 1));
  shader.setUniform("lidAmount", Math.max(0, Number(params.lidAmount) || 0));
  shader.setUniform("veinAmount", Math.max(0, Number(params.veinAmount) || 0));
  shader.setUniform("eyeGazeDir", uniforms.gazeDir);
  shader.setUniform("eyeIrisRight", uniforms.irisRight);
  shader.setUniform("eyeIrisUp", uniforms.irisUp);
  shader.setUniform("eyeBlink", Math.max(0, Math.min(1, Number(uniforms.blink) || 0)));
}
