import { createNumberParam } from "../../shared/component-schema.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import { defineCompiledVisualCompound } from "../../shared/compiled-visual-compound.js";
import { ComponentTimeControlNode } from "../../../control-engine/index.js?v=architecture-r2-2";
import { GazeBlinkControllerNode } from "../../providers/gaze-blink-controller/index.js?v=gaze-blink-semantic-1";
import EyeballRender from "../eyeball-render/index.js?v=compound-terminal-roi-1";

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

export const VisualComponent = defineCompiledVisualCompound(NativeVisualComponent, {
  nodes: [
    { id: "time", definition: ComponentTimeControlNode, role: "control" },
    { id: "motion", definition: GazeBlinkControllerNode, role: "control" },
    { id: "render", component: EyeballRender },
  ],
  connections: [
    { from: "time.time", to: "motion.componentTime", type: "number" },
    { from: "motion.gazeX", to: "render.$parameter.gazeX", type: "number" },
    { from: "motion.gazeY", to: "render.$parameter.gazeY", type: "number" },
    { from: "motion.gazeZ", to: "render.$parameter.gazeZ", type: "number" },
    { from: "motion.irisRightX", to: "render.$parameter.irisRightX", type: "number" },
    { from: "motion.irisRightY", to: "render.$parameter.irisRightY", type: "number" },
    { from: "motion.irisRightZ", to: "render.$parameter.irisRightZ", type: "number" },
    { from: "motion.irisUpX", to: "render.$parameter.irisUpX", type: "number" },
    { from: "motion.irisUpY", to: "render.$parameter.irisUpY", type: "number" },
    { from: "motion.irisUpZ", to: "render.$parameter.irisUpZ", type: "number" },
    { from: "motion.blink", to: "render.$parameter.blink", type: "number" },
  ],
  output: "render.texture",
  parameterBindings: {
    motion: ["motionSpeed", "gazeRange", "pauseAmount", "jitter", "blinkRate"],
    render: ["irisSize", "pupilSize", "lidAmount", "veinAmount", "renderQuality"],
  },
  parameterPresentation: {
    time: { hidden: true },
    motion: { label: "Gaze and blink", order: 10 },
    render: { label: "Eyeball appearance", order: 20 },
  },
});

export default VisualComponent;
