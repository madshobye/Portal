import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  featureMorphV2NodeModuleParts,
  FeatureMorphV2NodeModuleExports,
  featureMorphV2NodeProcess,
} from "./runtime.js";

const manifest = Object.freeze({
    id: "featureMorphV2",
    name: "Feature Morph V2",
    category: "ai",
    runtime: timeParamRuntime("autoSpeed"),
    params: [
      createNumberParam("morph", "Morph", { min: 0, max: 1, step: 0.001, defaultValue: 0 }),
      createNumberParam("autoSpeed", "Auto speed", { min: 0, max: 2, step: 0.01, defaultValue: 0 }),
      createEnumParam("morphStrategy", "Morph strategy", ["elastic", "rigid", "flow", "fluid"], "elastic"),
      createNumberParam("warpStrength", "Warp strength", { min: 0, max: 4, step: 0.01, defaultValue: 1.5 }),
      createNumberParam("featureGrid", "Feature grid", { min: 3, max: 48, step: 1, defaultValue: 8 }),
      createNumberParam("patchScale", "Patch scale", { min: 0.75, max: 12, step: 0.01, defaultValue: 1 }),
      createNumberParam("matchThreshold", "Match confidence", { min: 0, max: 0.95, step: 0.01, defaultValue: 0.2 }),
      createNumberParam("spatialCoherence", "Spatial coherence", { min: 0, max: 1, step: 0.01, defaultValue: 0.12 }),
      createNumberParam("influence", "Feature influence", { min: 0.05, max: 0.5, step: 0.01, defaultValue: 0.2 }),
      createEnumParam("fit", "Image fit", ["cover", "contain", "stretch"], "cover"),
    ],
  });

export const VisualComponent = defineGeneratorNode(manifest, null, {
  direct: false,
  process: featureMorphV2NodeProcess,
  exports: FeatureMorphV2NodeModuleExports,
  parts: featureMorphV2NodeModuleParts(),
});
export default VisualComponent;
