import GeneratorAnatomy from "./generators/anatomy/index.js";
import GeneratorAdditiveLightOrbs from "./generators/additive-light-orbs/index.js";
import GeneratorAnimatedDazzleStripes from "./generators/animated-dazzle-stripes/index.js";
import GeneratorBezierStrokes from "./generators/bezier-strokes/index.js";
import GeneratorBiomineLite from "./generators/biomine-lite/index.js";
import GeneratorCameraInput from "./generators/camera-input/index.js";
import GeneratorCellularCircles from "./generators/cellular-circles/index.js";
import GeneratorChainFollowerTrails from "./generators/chain-follower-trails/index.js";
import GeneratorChecker from "./generators/checker/index.js";
import GeneratorCherenkovVolume from "./generators/cherenkov-volume/index.js";
import GeneratorCloudyTunnel from "./generators/cloudy-tunnel/index.js";
import GeneratorEyeball from "./generators/eyeball/index.js";
import GeneratorEyeballRender from "./generators/eyeball-render/index.js";
import GeneratorFeatureMorphV2 from "./generators/feature-morph-v2/index.js";
import GeneratorFeatureMorph from "./generators/feature-morph/index.js";
import GeneratorFireflies from "./generators/fireflies/index.js";
import GeneratorFog from "./generators/fog/index.js";
import GeneratorGalaxy from "./generators/galaxy/index.js";
import GeneratorGradient from "./generators/gradient/index.js";
import GeneratorGestureReticle from "./generators/gesture-reticle/index.js";
import GeneratorLightning from "./generators/lightning/index.js";
import GeneratorMediaImage from "./generators/media-image/index.js";
import GeneratorMeshPatterns from "./generators/mesh-patterns/index.js";
import GeneratorModelMedia from "./generators/model-media/index.js";
import GeneratorNoise from "./generators/noise/index.js";
import GeneratorNestedOrbitMotion from "./generators/nested-orbit-motion/index.js";
import GeneratorPaintDrips from "./generators/paint-drips/index.js";
import GeneratorPlasma from "./generators/plasma/index.js";
import GeneratorScreenShare from "./generators/screen-share/index.js";
import GeneratorSdfSketch from "./generators/sdf-sketch/index.js";
import GeneratorSeascape from "./generators/seascape/index.js";
import GeneratorShadertoyBaseWarp from "./generators/shadertoy-base-warp/index.js";
import GeneratorSunRays from "./generators/sun-rays/index.js";
import GeneratorSwayingTrees from "./generators/swaying-trees/index.js";
import GeneratorTerrainFlyover from "./generators/terrain-flyover/index.js";
import GeneratorExpressiveRibbonBrush from "./generators/expressive-ribbon-brush/index.js";
import GeneratorTestPattern from "./generators/test-pattern/index.js";
import GeneratorText from "./generators/text/index.js";
import GeneratorTileTexture from "./generators/tile-texture/index.js";
import GeneratorVolumetricClouds from "./generators/volumetric-clouds/index.js";
import GeneratorWaves from "./generators/waves/index.js";
import EffectAlphaFeather from "./effects/alpha-feather/index.js";
import EffectAlphaVignette from "./effects/alpha-vignette/index.js";
import EffectBlur from "./effects/blur/index.js";
import EffectBrokenFluorescent from "./effects/broken-fluorescent/index.js";
import EffectCrayonStroke from "./effects/crayon-stroke/index.js";
import EffectCustom from "./effects/custom/index.js";
import EffectDilate from "./effects/dilate/index.js";
import EffectEchoFade from "./effects/echo-fade/index.js";
import EffectErode from "./effects/erode/index.js";
import EffectFlip from "./effects/flip/index.js";
import EffectGlitchDistort from "./effects/glitch-distort/index.js";
import EffectHardBlack from "./effects/hard-black/index.js";
import EffectHeartbeatPulse from "./effects/heartbeat-pulse/index.js";
import EffectHeatShimmer from "./effects/heat-shimmer/index.js";
import EffectHsvAlphaKey from "./effects/hsv-alpha-key/index.js";
import EffectKaleido from "./effects/kaleido/index.js";
import EffectLabelChromatic from "./effects/label-chromatic/index.js";
import EffectLabelGrain from "./effects/label-grain/index.js";
import EffectLabelThresholdGrain from "./effects/label-threshold-grain/index.js";
import EffectLumaKey from "./effects/luma-key/index.js";
import EffectMirrorFold from "./effects/mirror-fold/index.js";
import EffectPhotoGrade from "./effects/photo-grade/index.js";
import EffectPixelArtUpscale from "./effects/pixel-art-upscale/index.js";
import EffectPixelate from "./effects/pixelate/index.js";
import EffectPlasma from "./effects/plasma/index.js";
import EffectPowerFlicker from "./effects/power-flicker/index.js";
import EffectProbe from "./effects/probe/index.js";
import EffectRgbSplit from "./effects/rgb-split/index.js";
import EffectRipple from "./effects/ripple/index.js";
import EffectSmear from "./effects/smear/index.js";
import EffectSpinRotate from "./effects/spin-rotate/index.js";
import EffectTileRepeat from "./effects/tile-repeat/index.js";

import { defaultParamValues, normalizeParamValues } from "./shared/component-schema.js";
import {
  defineVisualLibraryLayer,
  resolveVisualLibrary,
  VISUAL_IMPLEMENTATION_FORMATS,
  VISUAL_LIBRARY_LAYER_KINDS,
} from "../visual-library/index.js";
import { BuiltInIsfRepository } from "../visual-library/built-in-isf-repository.js";
export { componentFromNodeDefinition } from "./shared/visual-node-factory.js";

const builtInIsfByVisualId = new Map(
  BuiltInIsfRepository.records.map((record) => [
    record.visualId,
    record,
  ]),
);
const GeneratorBlack = requiredBuiltInIsfComponent("black", "generator");
const EffectInvert = requiredBuiltInIsfComponent("invert", "effect");
const EffectGray = requiredBuiltInIsfComponent("gray", "effect");
const EffectThreshold = requiredBuiltInIsfComponent("threshold", "effect");
const additionalBuiltInIsfGenerators = BuiltInIsfRepository.components.filter(
  (component) => component.kind === "generator" && component.id !== "black",
);
const additionalBuiltInIsfEffects = BuiltInIsfRepository.components.filter(
  (component) =>
    component.kind === "effect" &&
    !["invert", "gray", "threshold"].includes(component.id),
);

const generators = Object.freeze([GeneratorAnatomy, GeneratorAdditiveLightOrbs, GeneratorAnimatedDazzleStripes, GeneratorBezierStrokes, GeneratorBiomineLite, GeneratorBlack, ...additionalBuiltInIsfGenerators, GeneratorCameraInput, GeneratorCellularCircles, GeneratorChainFollowerTrails, GeneratorChecker, GeneratorCherenkovVolume, GeneratorCloudyTunnel, GeneratorEyeball, GeneratorEyeballRender, GeneratorExpressiveRibbonBrush, GeneratorFeatureMorphV2, GeneratorFeatureMorph, GeneratorFireflies, GeneratorFog, GeneratorGalaxy, GeneratorGestureReticle, GeneratorGradient, GeneratorLightning, GeneratorMediaImage, GeneratorMeshPatterns, GeneratorModelMedia, GeneratorNestedOrbitMotion, GeneratorNoise, GeneratorPaintDrips, GeneratorPlasma, GeneratorScreenShare, GeneratorSdfSketch, GeneratorSeascape, GeneratorShadertoyBaseWarp, GeneratorSunRays, GeneratorSwayingTrees, GeneratorTerrainFlyover, GeneratorTestPattern, GeneratorText, GeneratorTileTexture, GeneratorVolumetricClouds, GeneratorWaves]);
const effects = Object.freeze([EffectAlphaFeather, EffectAlphaVignette, EffectBlur, EffectBrokenFluorescent, EffectCrayonStroke, EffectCustom, EffectDilate, EffectEchoFade, EffectErode, EffectFlip, EffectGlitchDistort, EffectGray, EffectHardBlack, EffectHeartbeatPulse, EffectHeatShimmer, EffectHsvAlphaKey, EffectInvert, ...additionalBuiltInIsfEffects, EffectKaleido, EffectLabelChromatic, EffectLabelGrain, EffectLabelThresholdGrain, EffectLumaKey, EffectMirrorFold, EffectPhotoGrade, EffectPixelArtUpscale, EffectPixelate, EffectPlasma, EffectPowerFlicker, EffectProbe, EffectRgbSplit, EffectRipple, EffectSmear, EffectSpinRotate, EffectThreshold, EffectTileRepeat]);
const generatorById = new Map(generators.map((component) => [component.id, component]));
const effectById = new Map(effects.map((component) => [component.id, component]));
export const BuiltInTransitionEntries = Object.freeze([
  ...BuiltInIsfRepository.transitions,
]);
export const DefaultBuiltInTransition = BuiltInTransitionEntries.find(
  (entry) => entry.id === "vj1.transition.dissolve",
);
if (!DefaultBuiltInTransition) {
  throw new Error("BUILT_IN_DEFAULT_TRANSITION_MISSING:vj1.transition.dissolve");
}

export const BuiltInVisualLibraryLayer = defineVisualLibraryLayer({
  id: "vj1.built-in.visuals",
  kind: VISUAL_LIBRARY_LAYER_KINDS.BUILT_IN,
  artifacts: [
    ...[...generators, ...effects].map(builtInVisualArtifact),
    ...BuiltInIsfRepository.records
      .filter((record) => record.transition)
      .map(builtInTransitionArtifact),
  ],
  metadata: {
    repositoryVersion: BuiltInIsfRepository.version,
    repositoryManifest: BuiltInIsfRepository.manifestUrl,
  },
});

export const BuiltInVisualLibrary = resolveVisualLibrary([BuiltInVisualLibraryLayer]);

export function listBuiltInVisualArtifacts(options = {}) {
  return BuiltInVisualLibrary.list(options);
}

export function getGeneratorNodeComponent(id) {
  const key = String(id || "");
  const component = generatorById.get(key);
  if (!component) throw new TypeError(`[VJ1_UNKNOWN_GENERATOR] Unknown generator ${key || "missing id"}`);
  return component;
}

export function getEffectNodeComponent(id) {
  return effectById.get(String(id || "")) || null;
}

export function listGeneratorNodeComponents() { return [...generators]; }
export function listEffectNodeComponents() { return [...effects]; }
export function listBuiltInTransitionEntries() {
  return [...BuiltInTransitionEntries];
}

function requiredBuiltInIsfComponent(visualId, kind) {
  const record = builtInIsfByVisualId.get(String(visualId || ""));
  if (!record || record.component?.kind !== kind) {
    throw new Error(
      `BUILT_IN_ISF_COMPONENT_MISSING:${kind}:${visualId || "missing"}`,
    );
  }
  return record.component;
}

function builtInVisualArtifact(component) {
  const record = builtInIsfByVisualId.get(component.id);
  const implementation = record
    ? {
      format: VISUAL_IMPLEMENTATION_FORMATS.ISF,
      nodeId: component.nodeDefinition.id,
      nodeVersion: component.nodeDefinition.version,
      visualId: component.id,
      resourceId: record.resource,
      ...(record.vertexResource
        ? { vertexResourceId: record.vertexResource }
        : {}),
      lowering: component.nodeDefinition.metadata?.optimizedIsfLowering || "",
    }
    : {
      format: VISUAL_IMPLEMENTATION_FORMATS.NODE,
      nodeId: component.nodeDefinition.id,
      nodeVersion: component.nodeDefinition.version,
      visualId: component.id,
    };
  return {
    id: component.nodeDefinition.id,
    version: component.nodeDefinition.version,
    name: component.name,
    description: component.description,
    artifactType: component.kind,
    implementation,
    capabilities: component.nodeDefinition.capabilities,
    categories: record?.categories || [component.category],
    tags: record?.tags || [],
    ports: {
      inlets: component.nodeDefinition.inlets,
      outlets: component.nodeDefinition.outlets,
    },
    attribution: record?.attribution || {},
    presentation: component.nodeDefinition.presentation,
    metadata: record ? {
      sourceFormat: "isf",
      alpha: component.isf?.metadata?.VJ1?.ALPHA || "",
      roi: component.isf?.metadata?.VJ1?.ROI || "",
    } : {},
  };
}

function builtInTransitionArtifact(record) {
  return {
    id: record.id,
    version: record.version,
    name: record.name,
    description: record.transition.description,
    artifactType: "transition",
    implementation: {
      format: VISUAL_IMPLEMENTATION_FORMATS.ISF,
      nodeId: record.definition.id,
      nodeVersion: record.definition.version,
      visualId: record.visualId,
      resourceId: record.resource,
      transitionKernelId: record.transition.kernel.id,
    },
    capabilities: ["visual-transition", "single-pass", "direct-mapper-pass"],
    categories: record.categories || ["Transition"],
    tags: record.tags || [],
    ports: {
      inlets: record.definition.inlets,
      outlets: record.definition.outlets,
    },
    attribution: record.attribution || {},
    metadata: {
      sourceFormat: "isf",
      alpha: record.definition.metadata?.isf?.alpha || "premultiplied",
      roi: "prepared-endpoints",
    },
  };
}

export function getGeneratorNodeShader(id) {
  const component = getGeneratorNodeComponent(id);
  if (!component?.nodeDefinition?.metadata?.nodeOwnedShader) return null;
  return Object.freeze({ ...component, type: component.shaderInterface || component.type });
}

// Shader-oriented consumers receive the editable shader part while the full
// node remains the catalog authority.
export function getGeneratorShaderComponent(id) {
  const component = getGeneratorNodeComponent(id);
  if (!component?.nodeDefinition?.metadata?.nodeOwnedShader) return null;
  const shaderPart = component?.nodeDefinition?.parts?.find((part) => part.kind === "shader");
  if (!shaderPart) return null;
  return Object.freeze({
    ...component,
    name: shaderPart.name || component.name,
    type: component.shaderInterface || component.type,
    code: shaderPart.source,
  });
}

export function createGeneratorSource(id = "testPattern", params = {}) {
  const component = getGeneratorNodeComponent(id);
  const sourceParams = component.id === "meshPatterns" ? normalizeLegacyMeshPatternParams(params) : params;
  return {
    type: "generator",
    generatorId: component.id,
    params: Object.keys(sourceParams || {}).length
      ? normalizeParamValues(component, sourceParams)
      : defaultParamValues(component),
  };
}

function normalizeLegacyMeshPatternParams(params = {}) {
  const aliases = {
    "tectonic plates": "cells",
    "leaf veins": "veins",
    "topographic contours": "mountains",
    "soap bubble foam": "soap",
    "shattered glass": "cracks",
    "coral skeleton": "coral",
    "fabric tension": "fabric",
    "river delta": "rivers",
    "magnetic field": "magnetic fields",
    "crystalline growth": "cracks",
    "root system": "veins",
    "neural tissue": "veins",
    "spider web": "veins",
    "city blocks": "cells",
    "lava cooling": "cells",
    "constellation graph": "bone",
  };
  const pattern = aliases[String(params?.pattern || "").toLowerCase()] || params?.pattern;
  return pattern === params?.pattern ? params : { ...params, pattern };
}
