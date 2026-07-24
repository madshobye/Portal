import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  defineSpecializedVisualCompound,
  PlanarGridGeometryProviderNode,
  TerrainBiomeMaterialProviderNode,
  TerrainFlightCameraProviderNode,
  TerrainHeightFieldGeometryProviderNode,
  TerrainSurfaceToImageNode,
  TerrainWireMaterialProviderNode,
  TerrainWireToImageNode,
} from "../../shared/specialized-compound.js?v=mesh-pattern-node-authority-1";
import { TerrainFlightControllerNode } from "../../../terrain-engine/flight-controller/index.js";
import {
  terrainNodeModuleParts,
  terrainNodeProcess,
} from "./runtime.js?v=semantic-terrain-node-ownership-1";

const manifest = Object.freeze({
    id: "terrainFlyover",
    name: "Terrain Flyover",
    category: "organic",
    runtime: timeParamRuntime("flightSpeed"),
    params: [
      createEnumParam("style", "Style", ["biome", "wire", "hybrid"], "hybrid"),
      createEnumParam("flightMode", "Flight mode", ["free", "terrainFollow"], "free"),
      createNumberParam("flightSpeed", "Flight speed", { min: 0, max: 3, step: 0.01, defaultValue: 0.65 }),
      createNumberParam("turn", "Direction", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("altitude", "Altitude", { min: 0.2, max: 10000, step: 0.01, defaultValue: 2.5, scale: "log" }),
      createNumberParam("pitch", "View pitch", { min: -1.4, max: 1.4, step: 0.01, defaultValue: 0.28 }),
      createNumberParam("fieldOfView", "Field of view", { min: 20, max: 120, step: 0.1, defaultValue: 60 }),
      createNumberParam("nearClip", "Near clip minimum", { min: 0.01, max: 20, step: 0.01, defaultValue: 0.1, scale: "log" }),
      createNumberParam("farClip", "Far clip", { min: 100, max: 50000, step: 10, defaultValue: 20000, scale: "log" }),
      createNumberParam("lookAhead", "Follow look ahead", { min: 2, max: 60, step: 0.1, defaultValue: 14 }),
      createNumberParam("noseFollow", "Nose response", { min: 0, max: 2, step: 0.01, defaultValue: 1 }),
      createNumberParam("mountainHeight", "Mountain height", { min: 0.05, max: 100, step: 0.1, defaultValue: 2.4, scale: "log" }),
      createNumberParam("terrainScale", "Terrain scale", { min: 0.02, max: 5, step: 0.01, defaultValue: 0.62, scale: "log" }),
      createNumberParam("textureGrain", "Texture grain", { min: 0, max: 2, step: 0.01, defaultValue: 0 }),
      createNumberParam("textureDepth", "Texture depth", { min: 0, max: 3, step: 0.01, defaultValue: 0 }),
      createNumberParam("colorDirection", "Color direction", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("lakeLevel", "Lake level", { min: -100, max: 100, step: 0.1, defaultValue: -0.12 }),
      createNumberParam("viewDistance", "View distance", { min: 0.1, max: 3, step: 0.01, defaultValue: 0.85 }),
      createNumberParam("globeRadius", "Globe radius", { min: 60, max: 10000, step: 5, defaultValue: 280, scale: "log" }),
      createNumberParam("gridWidth", "Grid width", { min: 8, max: 144, step: 1, defaultValue: 48 }),
      createNumberParam("gridDepth", "Grid depth", { min: 8, max: 144, step: 1, defaultValue: 48 }),
      createNumberParam("gridDensity", "Grid density", { min: 0.25, max: 4, step: 0.01, defaultValue: 1, scale: "log" }),
      createNumberParam("gridScale", "Grid scale", { min: 0.1, max: 20, step: 0.01, defaultValue: 1, scale: "log" }),
      createNumberParam("gridJitter", "Grid irregularity", { min: 0, max: 1, step: 0.01, defaultValue: 0.62 }),
      createNumberParam("wireWidth", "Wire width", { min: 0.1, max: 8, step: 0.01, defaultValue: 0.85 }),
      createColorParam("waterColor", "Water", "#147bc1ff"),
      createColorParam("grassColor", "Grass", "#23843bff"),
      createColorParam("rockColor", "Rock", "#4c4037ff"),
      createColorParam("snowColor", "Snow", "#e8edf1ff"),
      createColorParam("downSlopeColor", "Down-slope color", "#202a38aa"),
      createColorParam("directionColor", "Direction color", "#d88a42aa"),
      createColorParam("wireColor", "Wire", "#f2f5efff"),
      createColorParam("skyColor", "Sky", "#6ca5d4ff"),
    ],
  });

const NativeVisualComponent = defineGeneratorNode(manifest, null, {
  direct: false,
  process: terrainNodeProcess,
  exports: {},
  parts: terrainNodeModuleParts(),
});

export const VisualComponent = defineSpecializedVisualCompound(NativeVisualComponent, {
  compoundKind: "terrain-flyover",
  nativeRenderer: "output/specialized:terrainFlyover",
  nodes: [
    { id: "flight", type: TerrainFlightControllerNode.id },
    { id: "geometry", type: TerrainHeightFieldGeometryProviderNode.id, parameters: { providerId: "terrain-height-field" } },
    { id: "surface-material", type: TerrainBiomeMaterialProviderNode.id, parameters: { providerId: "terrain-biome" } },
    { id: "wire-material", type: TerrainWireMaterialProviderNode.id, parameters: { providerId: "terrain-wire" } },
    {
      id: "camera",
      type: TerrainFlightCameraProviderNode.id,
      parameters: {
        providerId: "terrain-flight-camera",
        settings: { projection: "perspective" },
      },
    },
    { id: "surface-render", type: TerrainSurfaceToImageNode.id, parameters: { providerId: "terrain-surface-pass" } },
    { id: "wire-render", type: TerrainWireToImageNode.id, parameters: { providerId: "terrain-wire-pass" } },
  ],
  connections: [
    { from: "flight.flight", to: "camera.flight", type: "terrain-flight-state" },
    { from: "flight.flight", to: "surface-render.controller", type: "terrain-flight-state" },
    { from: "flight.flight", to: "wire-render.controller", type: "terrain-flight-state" },
    { from: "geometry.geometry", to: "surface-render.geometry", type: "geometry-provider" },
    { from: "geometry.geometry", to: "wire-render.geometry", type: "geometry-provider" },
    { from: "surface-material.material", to: "surface-render.material", type: "visual-material-provider" },
    { from: "wire-material.material", to: "wire-render.material", type: "visual-material-provider" },
    { from: "camera.camera", to: "surface-render.camera", type: "visual-camera-provider" },
    { from: "camera.camera", to: "wire-render.camera", type: "visual-camera-provider" },
    { from: "surface-render.texture", to: "wire-render.target", type: "texture" },
  ],
  output: "wire-render.texture",
  parameterBindings: {
    flight: ["flightMode", "flightSpeed", "turn", "altitude", "terrainScale"],
    geometry: ["mountainHeight", "terrainScale", "lakeLevel", "viewDistance", "globeRadius", "gridWidth", "gridDepth", "gridDensity", "gridScale", "gridJitter"],
    camera: ["pitch", "fieldOfView", "nearClip", "farClip", "lookAhead", "noseFollow"],
    "surface-material": ["waterColor", "grassColor", "rockColor", "snowColor", "downSlopeColor", "directionColor", "skyColor", "textureGrain", "textureDepth", "colorDirection"],
    "wire-material": ["wireColor", "wireWidth"],
    "surface-render": ["style", "renderQuality"],
    "wire-render": ["style", "renderQuality"],
  },
  parameterPresentation: {
    flight: { label: "Flight", order: 10, omitParameterIds: ["terrainScale"] },
    geometry: { label: "Geometry", order: 20 },
    camera: { label: "Camera", order: 30 },
    "surface-material": { label: "Surface material", order: 40 },
    "wire-material": { label: "Wire material", order: 50 },
    "surface-render": { sectionId: "render", label: "Render", order: 60 },
    "wire-render": { sectionId: "render", label: "Render", order: 60 },
  },
  providerAlternatives: {
    geometry: [{
      nodeId: PlanarGridGeometryProviderNode.id,
      providerId: "planar-grid",
      label: "Planar grid",
    }],
  },
});
export default VisualComponent;
