import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  featureMorphNodeModuleParts,
  featureMorphNodeProcess,
  FeatureMorphNodeModuleExports,
} from "./runtime.js";

const manifest = Object.freeze({
    id: "featureMorph",
    name: "Feature Morph",
    category: "ai",
    runtime: timeParamRuntime("autoSpeed"),
    params: [
      createNumberParam("morph", "Morph", { min: 0, max: 1, step: 0.001, defaultValue: 0 }),
      createNumberParam("autoSpeed", "Auto speed", { min: 0, max: 2, step: 0.01, defaultValue: 0 }),
      createNumberParam("warpStrength", "Warp strength", { min: 0, max: 2, step: 0.01, defaultValue: 1 }),
      createNumberParam("landmarkCount", "Landmarks", { min: 8, max: 300, step: 1, defaultValue: 64 }),
      createNumberParam("matchThreshold", "Match confidence", { min: 0.5, max: 0.95, step: 0.01, defaultValue: 0.72 }),
      createNumberParam("influence", "Landmark influence", { min: 0.03, max: 0.5, step: 0.01, defaultValue: 0.18 }),
      createEnumParam("fit", "Image fit", ["cover", "contain", "stretch"], "cover"),
    ],
  });

export const VisualComponent = defineGeneratorNode(manifest, null, {
  direct: false,
  process: featureMorphNodeProcess,
  exports: FeatureMorphNodeModuleExports,
  parts: featureMorphNodeModuleParts(),
});
export default VisualComponent;
