import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import {
  FeatureMorphAnalysisType,
  MediaImageResourceType,
} from "../../shared/specialized-compound-types.js";
import {
  buildFeatureMorphField,
  buildFeatureMorphMesh,
  featureMorphAnalysisModuleSource,
  matchSuperPointFeatures,
} from "../../generators/feature-morph/analysis.js";
import {
  buildMobileNetMorphField,
  buildRigidMlsMorphField,
  featureMorphV2AnalysisModuleSource,
  matchMobileNetFeatures,
  mobileNetMorphFieldForStrategy,
} from "../../generators/feature-morph-v2/analysis.js";

const SUPERPOINT_SETTING_IDS = Object.freeze([
  "landmarkCount",
  "matchThreshold",
  "influence",
]);
const MOBILENET_SETTING_IDS = Object.freeze([
  "featureGrid",
  "patchScale",
  "matchThreshold",
  "spatialCoherence",
  "influence",
]);

export const SuperPointMorphAnalysisNode = featureMorphAnalysisNode({
  id: "core.visual.superpoint-morph-analysis",
  name: "SuperPoint Morph Analysis",
  providerId: "superpoint",
  description: "Matches local SuperPoint features and requests one retained flow field for two image resources.",
  settingIds: SUPERPOINT_SETTING_IDS,
  parameters: {
    landmarkCount: { type: "number", defaultValue: 64, allowedRange: [8, 300], clamp: true },
    matchThreshold: { type: "number", defaultValue: 0.72, allowedRange: [0.5, 0.95], clamp: true },
    influence: { type: "number", defaultValue: 0.18, allowedRange: [0.03, 0.5], clamp: true },
  },
  algorithmPart: {
    id: "feature-morph-analysis-module",
    name: "SuperPoint matching and flow-field algorithm",
    exports: ["matchSuperPointFeatures", "buildFeatureMorphField", "buildFeatureMorphMesh"],
    source: featureMorphAnalysisModuleSource(),
  },
  moduleExports: {
    matchSuperPointFeatures,
    buildFeatureMorphField,
    buildFeatureMorphMesh,
  },
});

export const MobileNetMorphAnalysisNode = featureMorphAnalysisNode({
  id: "core.visual.mobilenet-morph-analysis",
  name: "MobileNet Morph Analysis",
  providerId: "mobilenet",
  description: "Matches semantic MobileNet regions and requests reusable flow, elastic, rigid, or fluid fields.",
  settingIds: MOBILENET_SETTING_IDS,
  parameters: {
    featureGrid: { type: "number", defaultValue: 8, allowedRange: [3, 48], clamp: true },
    patchScale: { type: "number", defaultValue: 1, allowedRange: [0.75, 12], clamp: true },
    matchThreshold: { type: "number", defaultValue: 0.2, allowedRange: [0, 0.95], clamp: true },
    spatialCoherence: { type: "number", defaultValue: 0.12, allowedRange: [0, 1], clamp: true },
    influence: { type: "number", defaultValue: 0.2, allowedRange: [0.05, 0.5], clamp: true },
  },
  algorithmPart: {
    id: "feature-morph-v2-analysis-module",
    name: "MobileNet matching and flow-field algorithm",
    exports: [
      "matchMobileNetFeatures",
      "buildMobileNetMorphField",
      "mobileNetMorphFieldForStrategy",
      "buildRigidMlsMorphField",
    ],
    source: featureMorphV2AnalysisModuleSource(),
  },
  moduleExports: {
    matchMobileNetFeatures,
    buildMobileNetMorphField,
    mobileNetMorphFieldForStrategy,
    buildRigidMlsMorphField,
  },
});

function featureMorphAnalysisNode({
  id,
  name,
  providerId,
  description,
  settingIds,
  parameters,
  algorithmPart,
  moduleExports,
}) {
  return defineNode({
    id,
    name,
    version: "0.1.0",
    description,
    implementation: NODE_IMPLEMENTATION_KINDS.CODE,
    inlets: {
      imageA: { type: MediaImageResourceType, required: true },
      imageB: { type: MediaImageResourceType, required: true },
      settings: { type: "record", defaultValue: {} },
      ...parameters,
    },
    parameters: {
      providerId: { type: "string", defaultValue: providerId },
      settings: { type: "record", defaultValue: {} },
      ...parameters,
    },
    outlets: {
      analysis: { type: FeatureMorphAnalysisType },
    },
    execution: {
      trigger: "input-change",
      domain: "main",
      pure: true,
      asynchronous: false,
    },
    capabilities: [
      "feature-analysis",
      "image-analysis",
      `${providerId}-analysis`,
      "specialized-visual-provider",
      "specialized-visual-stage",
      "graph-placeable",
    ],
    presentation: {
      catalogs: ["node-graph", "image", "analysis", "ai", "specialized-visual"],
      placeableOn: ["node-graph", "native-visual-graph"],
    },
    metadata: {
      nativeArtifactRequirements: {
        moduleExports: [...algorithmPart.exports],
        shaders: [],
      },
    },
    parts: [
      {
        ...algorithmPart,
        kind: NODE_PART_KINDS.JAVASCRIPT,
        language: "javascript",
        editable: true,
        module: import.meta.url,
      },
      {
        id: `${providerId}-morph-analysis-process`,
        name: `${name} provider process`,
        kind: NODE_PART_KINDS.JAVASCRIPT,
        language: "javascript",
        editable: true,
        module: import.meta.url,
        export: "featureMorphAnalysisProviderProcess",
        entry: "process",
        dependsOn: [algorithmPart.id],
        source: [
          featureMorphAnalysisProviderProcess,
          record,
        ].map(String).join("\n\n"),
      },
    ],
    moduleExports,
    process: featureMorphAnalysisProviderProcess,
  });
}

export function featureMorphAnalysisProviderProcess(inputs = {}, { output = null, state = {} } = {}) {
  const sourceSettings = record(inputs.settings);
  const settings = state.settings || (state.settings = {});
  for (const id of Object.keys(inputs)) {
    if (id === "imageA" || id === "imageB" || id === "settings" || id === "providerId" || id === "enabled") continue;
    const value = sourceSettings[id] === undefined ? inputs[id] : sourceSettings[id];
    if (value === undefined) delete settings[id];
    else settings[id] = value;
  }
  const result = output || state.output || (state.output = { analysis: null });
  const analysis = result.analysis || (result.analysis = {});
  analysis.kind = "feature-morph-analysis";
  analysis.providerId = String(inputs.providerId || "");
  analysis.imageA = inputs.imageA || null;
  analysis.imageB = inputs.imageB || null;
  settings.imageAId = String(inputs.imageA?.mediaId || "");
  settings.imageBId = String(inputs.imageB?.mediaId || "");
  analysis.settings = settings;
  return result;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
