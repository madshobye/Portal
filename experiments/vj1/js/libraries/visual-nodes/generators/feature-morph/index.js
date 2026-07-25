import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  featureMorphNodeProcess,
} from "./runtime.js?v=source-roi-view-3";
import {
  FeatureMorphToImageNode,
  MediaImageResourceNode,
  MobileNetMorphAnalysisNode,
  SuperPointMorphAnalysisNode,
} from "../../shared/visual-stage-nodes.js?v=node-roi-placement-1";
import { defineCompiledVisualCompound } from "../../shared/compiled-visual-compound.js?v=typed-media-render-process-1";

const manifest = Object.freeze({
    id: "featureMorph",
    name: "Feature Morph",
    category: "ai",
    runtime: timeParamRuntime("autoSpeed"),
    params: [
      createTextParam("imageAId", "Image A", ""),
      createTextParam("imageBId", "Image B", ""),
      createNumberParam("morph", "Morph", { min: 0, max: 1, step: 0.001, defaultValue: 0 }),
      createNumberParam("autoSpeed", "Auto speed", { min: 0, max: 2, step: 0.01, defaultValue: 0 }),
      createNumberParam("warpStrength", "Warp strength", { min: 0, max: 2, step: 0.01, defaultValue: 1 }),
      createNumberParam("landmarkCount", "Landmarks", { min: 8, max: 300, step: 1, defaultValue: 64 }),
      createNumberParam("matchThreshold", "Match confidence", { min: 0.5, max: 0.95, step: 0.01, defaultValue: 0.72 }),
      createNumberParam("influence", "Landmark influence", { min: 0.03, max: 0.5, step: 0.01, defaultValue: 0.18 }),
      createEnumParam("fit", "Image fit", ["cover", "contain", "stretch"], "cover"),
    ],
  });

const NativeVisualComponent = defineGeneratorNode(manifest, null, {
  direct: false,
  process: featureMorphNodeProcess,
  exports: {},
  parts: [],
});

export const VisualComponent = defineCompiledVisualCompound(NativeVisualComponent, {
  nodes: [
    { id: "image-a", definition: MediaImageResourceNode, role: "value" },
    { id: "image-b", definition: MediaImageResourceNode, role: "value" },
    {
      id: "analysis",
      definition: SuperPointMorphAnalysisNode,
      role: "value",
      parameters: { providerId: "superpoint" },
    },
    {
      id: "render",
      definition: FeatureMorphToImageNode,
      role: "renderer",
      parameters: { providerId: "feature-morph-pass", morphStrategy: "flow" },
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
    analysis: ["landmarkCount", "matchThreshold", "influence"],
    render: ["morph", "autoSpeed", "warpStrength", "fit", "renderQuality"],
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
