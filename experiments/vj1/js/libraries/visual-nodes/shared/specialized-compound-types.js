import { valueType } from "../../node-engine/node-types.js";

export const GeometryProviderType = valueType("geometry-provider", {
  contractVersion: 1,
  description: "A declarative geometry-producing stage lowered by a specialized visual compiler.",
});

export const TopologyProviderType = valueType("topology-provider", {
  contractVersion: 1,
  description: "A declarative 2D topology-producing stage lowered by a specialized visual compiler.",
});

export const VisualMaterialProviderType = valueType("visual-material-provider", {
  contractVersion: 1,
  description: "A reusable material and shader-program selection for a compiled visual stage.",
});

export const VisualCameraProviderType = valueType("visual-camera-provider", {
  contractVersion: 1,
  description: "A reusable camera contract for a compiled visual stage.",
});

export const MediaImageResourceType = valueType("media-image-resource", {
  contractVersion: 1,
  description: "A declared project-media image dependency resolved by the retained visual host.",
});

export const FeatureMorphAnalysisType = valueType("feature-morph-analysis", {
  contractVersion: 1,
  description: "A reusable feature-correspondence and flow-field analysis request for two image resources.",
});

export const TextMaskProviderType = valueType("text-mask-provider", {
  contractVersion: 1,
  description: "A retained browser-rasterized alpha mask and layout identity for text rendering.",
});

export const DrawableMediaResourceType = valueType("drawable-media-resource", {
  contractVersion: 1,
  description: "A host-resolved drawable media resource identity that can be sampled by a retained image operation.",
});

export const GazeBlinkUniformsType = valueType("gaze-blink-uniforms", {
  contractVersion: 1,
  description: "A retained gaze basis and blink value produced independently from a character or eye shader.",
});
