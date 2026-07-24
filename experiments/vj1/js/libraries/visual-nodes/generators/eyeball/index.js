import { createNumberParam } from "../../shared/component-schema.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  defineSpecializedVisualCompound,
  EyeballToImageNode,
  GazeBlinkControllerNode,
} from "../../shared/specialized-compound.js?v=gaze-blink-semantic-1";

const manifest = Object.freeze({
  id: "eyeball",
  name: "3D Eyeball",
  category: "character",
  runtime: {
    timeDependent: (params = {}) =>
      (Number(params.gazeRange) || 0) > 0.0001 ||
      (Number(params.blinkRate) || 0) > 0.0001,
  },
  params: [
    createNumberParam("irisSize", "Iris size", { min: 0.5, max: 1.6, step: 0.01, defaultValue: 1 }),
    createNumberParam("pupilSize", "Pupil size", { min: 0.5, max: 1.8, step: 0.01, defaultValue: 1 }),
    createNumberParam("gazeRange", "Gaze range", { min: 0, max: 1.5, step: 0.01, defaultValue: 1 }),
    createNumberParam("motionSpeed", "Motion speed", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
    createNumberParam("pauseAmount", "Pause", { min: 0, max: 1, step: 0.01, defaultValue: 0.82 }),
    createNumberParam("jitter", "Jitter", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
    createNumberParam("blinkRate", "Blink rate", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
    createNumberParam("lidAmount", "Lid amount", { min: 0, max: 1.5, step: 0.01, defaultValue: 1 }),
    createNumberParam("veinAmount", "Veins", { min: 0, max: 1, step: 0.01, defaultValue: 0.6 }),
  ],
});

const NativeVisualComponent = defineGeneratorNode(manifest);

export const VisualComponent = defineSpecializedVisualCompound(NativeVisualComponent, {
  compoundKind: "eyeball",
  nativeRenderer: "output/specialized:controlledShader",
  nodes: [
    { id: "motion", type: GazeBlinkControllerNode.id },
    {
      id: "render",
      type: EyeballToImageNode.id,
      parameters: { providerId: "eyeball-shader" },
    },
  ],
  connections: [
    { from: "motion.uniforms", to: "render.uniforms", type: "gaze-blink-uniforms" },
  ],
  output: "render.texture",
  parameterBindings: {
    motion: ["motionSpeed", "gazeRange", "pauseAmount", "jitter", "blinkRate"],
    render: ["irisSize", "pupilSize", "lidAmount", "veinAmount", "renderQuality"],
  },
  parameterPresentation: {
    motion: { label: "Gaze and blink", order: 10 },
    render: { label: "Eyeball appearance", order: 20 },
  },
  parts: [],
});

export default VisualComponent;
