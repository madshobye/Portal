import { createNumberParam } from "../../shared/component-schema.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import { EYEBALL_SCALAR_FRAGMENT_SHADER } from "../../renderers/eyeball-to-image/shader.js";

const manifest = Object.freeze({
  id: "eyeballRender",
  name: "Eyeball Render",
  category: "character",
  description: "Renders an eyeball from an explicitly supplied gaze basis and blink value.",
  runtime: { timeDependent: () => false },
  params: [
    createNumberParam("irisSize", "Iris size", { min: 0.5, max: 1.6, step: 0.01, defaultValue: 1 }),
    createNumberParam("pupilSize", "Pupil size", { min: 0.5, max: 1.8, step: 0.01, defaultValue: 1 }),
    createNumberParam("lidAmount", "Lid amount", { min: 0, max: 1.5, step: 0.01, defaultValue: 1 }),
    createNumberParam("veinAmount", "Veins", { min: 0, max: 1, step: 0.01, defaultValue: 0.6 }),
    createNumberParam("gazeX", "Gaze X", { min: -1, max: 1, step: 0.001, defaultValue: 0 }),
    createNumberParam("gazeY", "Gaze Y", { min: -1, max: 1, step: 0.001, defaultValue: 0 }),
    createNumberParam("gazeZ", "Gaze Z", { min: -1, max: 1, step: 0.001, defaultValue: 1 }),
    createNumberParam("irisRightX", "Iris right X", { min: -1, max: 1, step: 0.001, defaultValue: 1 }),
    createNumberParam("irisRightY", "Iris right Y", { min: -1, max: 1, step: 0.001, defaultValue: 0 }),
    createNumberParam("irisRightZ", "Iris right Z", { min: -1, max: 1, step: 0.001, defaultValue: 0 }),
    createNumberParam("irisUpX", "Iris up X", { min: -1, max: 1, step: 0.001, defaultValue: 0 }),
    createNumberParam("irisUpY", "Iris up Y", { min: -1, max: 1, step: 0.001, defaultValue: 1 }),
    createNumberParam("irisUpZ", "Iris up Z", { min: -1, max: 1, step: 0.001, defaultValue: 0 }),
    createNumberParam("blink", "Blink", { min: 0, max: 1, step: 0.001, defaultValue: 0 }),
  ],
});

const shader = Object.freeze({
  id: "generator.eyeball-render",
  name: "Eyeball Render shader",
  type: "fragment",
  code: EYEBALL_SCALAR_FRAGMENT_SHADER,
});

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
