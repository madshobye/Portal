import {
  featureMorphNodeModuleParts,
  imageFitUniform,
} from "../feature-morph/runtime.js?v=source-roi-view-3";
import {
  buildMobileNetMorphField,
  buildRigidMlsMorphField,
  featureMorphV2AnalysisModuleSource,
  matchMobileNetFeatures,
  mobileNetMorphFieldForStrategy,
} from "./analysis.js";

export function featureMorphV2NodeProcess(inputs = {}, context = {}) {
  if (typeof context.renderNativeVisualNode !== "function") throw new Error("FEATURE_MORPH_V2_NODE_RENDER_HOST_MISSING");
  return context.renderNativeVisualNode({ inputs, context });
}

export function featureMorphV2NodeModuleParts() {
  return featureMorphNodeModuleParts({
    process: featureMorphV2NodeProcess,
    moduleUrl: import.meta.url,
    analysisPart: {
      id: "feature-morph-v2-analysis-module",
      name: "Feature Morph V2 matching and field algorithm",
      exports: [
        "matchMobileNetFeatures",
        "buildMobileNetMorphField",
        "mobileNetMorphFieldForStrategy",
        "buildRigidMlsMorphField",
      ],
      source: featureMorphV2AnalysisModuleSource(),
    },
  });
}

export const FeatureMorphV2NodeModuleExports = Object.freeze({
  imageFitUniform,
  matchMobileNetFeatures,
  buildMobileNetMorphField,
  mobileNetMorphFieldForStrategy,
  buildRigidMlsMorphField,
});
