import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "anatomy",
    name: "Low Poly Anatomy",
    category: "character",
    runtime: {
      timeDependent: (params = {}) =>
        Math.abs(Number(params.spinX) || 0) +
          Math.abs(Number(params.spinY) || 0) +
          Math.abs(Number(params.spinZ) || 0) > 0.0001 ||
        (params.part === "heart" && (Number(params.heartPulse) || 0) > 0.0001),
    },
    params: [
      createEnumParam("part", "Part", ["face", "body", "hand", "arm", "leg", "heart"], "face"),
      createEnumParam("renderMode", "Draw mode", ["surface", "wireframe", "surfaceWire", "points"], "surface"),
      createColorParam("surfaceColor", "Surface color", "#d9d4c9ff"),
      createColorParam("wireColor", "Wire color", "#4b4944cc"),
      createNumberParam("modelScale", "Scale", { min: 0.1, max: 5, step: 0.01, defaultValue: 1 }),
      createNumberParam("rotationX", "Rotate X", { min: -3.14, max: 3.14, step: 0.01, defaultValue: -0.18 }),
      createNumberParam("rotationY", "Rotate Y", { min: -3.14, max: 3.14, step: 0.01, defaultValue: -0.45 }),
      createNumberParam("rotationZ", "Rotate Z", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("spinX", "Spin X", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
      createNumberParam("spinY", "Spin Y", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
      createNumberParam("spinZ", "Spin Z", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
      createNumberParam("depth", "Depth", { min: 0.2, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("wireThickness", "Wire thickness", { min: 0.5, max: 12, step: 0.1, defaultValue: 1.6 }),
      createNumberParam("detail", "Polygon detail", { min: 4, max: 14, step: 1, defaultValue: 8 }),
      createNumberParam("expression", "Expression", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("mouthOpen", "Mouth open", { min: 0, max: 1, step: 0.01, defaultValue: 0.1 }),
      createNumberParam("brow", "Brow", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("eyeSquint", "Eye squint", { min: 0, max: 1, step: 0.01, defaultValue: 0.15 }),
      createNumberParam("fingerBend", "Finger bend", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      createNumberParam("limbBend", "Limb bend", { min: -1, max: 1, step: 0.01, defaultValue: 0.25 }),
      createNumberParam("heartPulse", "Heart pulse", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
    ],
  });

export const VisualComponent = defineGeneratorNode(manifest, null);
export default VisualComponent;
