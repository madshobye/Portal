import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  featureMorphV2NodeProcess,
} from "./runtime.js";
import {
  FeatureMorphToImageNode,
  MediaImageResourceNode,
  MobileNetMorphAnalysisNode,
  SuperPointMorphAnalysisNode,
} from "../../shared/visual-stage-nodes.js";
import { defineCompiledVisualCompound } from "../../shared/compiled-visual-compound.js";

const manifest = Object.freeze({
    id: "featureMorphV2",
    name: "Feature Morph V2",
    category: "ai",
    runtime: timeParamRuntime("autoSpeed"),
    params: [
      createTextParam("imageAId", "Image A", ""),
      createTextParam("imageBId", "Image B", ""),
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

const NativeVisualComponent = defineGeneratorNode(manifest, null, {
  direct: false,
  process: featureMorphV2NodeProcess,
  exports: {},
  parts: [],
});

export const VisualComponent = defineCompiledVisualCompound(NativeVisualComponent, {
  nodes: [
    { id: "image-a", definition: MediaImageResourceNode, role: "value" },
    { id: "image-b", definition: MediaImageResourceNode, role: "value" },
    {
      id: "analysis",
      definition: MobileNetMorphAnalysisNode,
      role: "value",
      parameters: { providerId: "mobilenet" },
    },
    {
      id: "render",
      definition: FeatureMorphToImageNode,
      role: "renderer",
      parameters: { providerId: "feature-morph-pass", morphStrategy: "elastic" },
    },
  ],
  connections: [
    { from: "image-a.image", to: "analysis.imageA", type: "media-image-resource" },
    { from: "image-b.image", to: "analysis.imageB", type: "media-image-resource" },
    { from: "image-a.image", to: "render.imageA", type: "media-image-resource" },
    { from: "image-b.image", to: "render.imageB", type: "media-image-resource" },
    { from: "analysis.analysis", to: "render.analysis", type: "feature-morph-analysis" },
  ],
  output: "render.texture",
  parameterBindings: {
    "image-a": [{ publicParameterId: "imageAId", targetParameterId: "mediaId" }],
    "image-b": [{ publicParameterId: "imageBId", targetParameterId: "mediaId" }],
    analysis: ["featureGrid", "patchScale", "matchThreshold", "spatialCoherence", "influence"],
    render: ["morph", "autoSpeed", "morphStrategy", "warpStrength", "influence", "fit", "renderQuality"],
  },
  parameterPresentation: {
    "image-a": { hidden: true },
    "image-b": { hidden: true },
    analysis: { label: "Feature analysis", order: 10 },
    render: { label: "Morph render", order: 20 },
  },
  providerAlternatives: {
    analysis: [
      { nodeId: SuperPointMorphAnalysisNode.id, providerId: "superpoint", label: "SuperPoint" },
      { nodeId: MobileNetMorphAnalysisNode.id, providerId: "mobilenet", label: "MobileNet" },
    ],
  },
});
export default VisualComponent;
