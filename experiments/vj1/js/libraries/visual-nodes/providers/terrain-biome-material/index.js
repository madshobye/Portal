import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import {
  createMaterial3d,
  Material3dType,
} from "../../../mesh-engine/scene-types.js?v=editable-inlet-literals-1";
import { VisualMaterialProviderType } from "../../shared/specialized-compound-types.js";
import {
  TERRAIN_SURFACE_FRAGMENT_SHADER,
  TERRAIN_SURFACE_VERTEX_SHADER,
} from "../../generators/terrain-flyover/shaders.js?v=source-roi-view-3";

const TERRAIN_BIOME_SURFACE_SOURCE = `
vec4 vj1Surface(vec3 normal, vec3 position, vec2 uv, vec4 baseColor) {
  float height = position.y - terrainLakeLevel;
  float slope = 1.0 - clamp(abs(normal.y), 0.0, 1.0);
  float grassBand = smoothstep(0.01, 0.20, height);
  vec4 color = mix(terrainRockColor, terrainGrassColor, grassBand);
  color = mix(color, terrainRockColor, smoothstep(0.35, 0.82, slope));
  color = mix(color, terrainSnowColor, smoothstep(0.72, 1.18, height) * (1.0 - slope));
  color = mix(terrainWaterColor, color, step(0.0, height));
  return color * vec4(vec3(mix(1.02, 0.58, slope)), 1.0);
}`;

export const TerrainBiomeMaterialProviderNode = defineNode({
  id: "core.visual.terrain-biome-material",
  name: "Terrain Biome Material",
  version: "0.1.0",
  description: "Produces a reusable height/slope biome Material3d and the descriptor consumed by Terrain's specialized surface kernel.",
  implementation: NODE_IMPLEMENTATION_KINDS.SHADER,
  inlets: {
    providerId: { type: "string", defaultValue: "terrain-biome" },
    settings: { type: "record", defaultValue: {} },
    waterColor: { type: "color", defaultValue: "#147bc1ff" },
    grassColor: { type: "color", defaultValue: "#23843bff" },
    rockColor: { type: "color", defaultValue: "#4c4037ff" },
    snowColor: { type: "color", defaultValue: "#e8edf1ff" },
    downSlopeColor: { type: "color", defaultValue: "#202a38aa" },
    directionColor: { type: "color", defaultValue: "#d88a42aa" },
    skyColor: { type: "color", defaultValue: "#6ca5d4ff" },
    textureGrain: { type: "number", defaultValue: 0, allowedRange: [0, 2], clamp: true },
    textureDepth: { type: "number", defaultValue: 0, allowedRange: [0, 3], clamp: true },
    colorDirection: { type: "number", defaultValue: 0, allowedRange: [-3.14, 3.14], clamp: true },
    lakeLevel: { type: "number", defaultValue: -0.12, allowedRange: [-100, 100], clamp: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "terrain-biome" },
    enabled: { type: "boolean", defaultValue: true },
    settings: { type: "record", defaultValue: {} },
  },
  outlets: {
    material: { type: VisualMaterialProviderType },
    sceneMaterial: { type: Material3dType },
  },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: ["material", "shader", "terrain", "scene-3d", "specialized-visual-stage", "graph-placeable"],
  presentation: {
    catalogs: ["node-graph", "material", "terrain", "scene-3d", "specialized-visual"],
    placeableOn: ["node-graph", "native-visual-graph"],
  },
  metadata: {
    nativeArtifactRequirements: {
      moduleExports: [],
      shaders: ["terrain-surface-vertex", "terrain-surface-fragment"],
    },
  },
  parts: [
    terrainShaderPart(
      "terrain-surface-vertex",
      "Terrain surface vertex shader",
      "vertex",
      TERRAIN_SURFACE_VERTEX_SHADER,
    ),
    terrainShaderPart(
      "terrain-surface-fragment",
      "Terrain surface fragment shader",
      "fragment",
      TERRAIN_SURFACE_FRAGMENT_SHADER,
    ),
  ],
  process: terrainBiomeMaterialProviderProcess,
});

export function terrainBiomeMaterialProviderProcess(inputs = {}, { state = {}, output = null } = {}) {
  const settings = record(inputs.settings);
  const providerId = String(inputs.providerId || "terrain-biome");
  const values = {
    waterColor: setting(settings, inputs, "waterColor"),
    grassColor: setting(settings, inputs, "grassColor"),
    rockColor: setting(settings, inputs, "rockColor"),
    snowColor: setting(settings, inputs, "snowColor"),
    lakeLevel: finite(setting(settings, inputs, "lakeLevel"), -0.12),
  };
  const signature = JSON.stringify(values);
  if (state.signature !== signature || !state.sceneMaterial) {
    state.signature = signature;
    state.sceneMaterial = createMaterial3d({
      id: providerId,
      renderMode: "surface",
      surfaceColor: values.grassColor,
      shaderSource: TERRAIN_BIOME_SURFACE_SOURCE,
      uniforms: {
        terrainWaterColor: uniform("vec4", normalizedColor(values.waterColor, "#147bc1ff")),
        terrainGrassColor: uniform("vec4", normalizedColor(values.grassColor, "#23843bff")),
        terrainRockColor: uniform("vec4", normalizedColor(values.rockColor, "#4c4037ff")),
        terrainSnowColor: uniform("vec4", normalizedColor(values.snowColor, "#e8edf1ff")),
        terrainLakeLevel: uniform("float", values.lakeLevel),
      },
      metadata: {
        providerId,
        sourceNodeId: TerrainBiomeMaterialProviderNode.id,
        semanticScope: "height-and-slope biome; native Terrain adds directional texture and fog",
      },
    });
  }
  const result = output || state.output || (state.output = { material: null, sceneMaterial: null });
  const descriptor = result.material || (result.material = {});
  descriptor.kind = "material";
  descriptor.providerId = providerId;
  descriptor.settings = settings;
  descriptor.enabled = inputs.enabled !== false;
  descriptor.sceneMaterial = state.sceneMaterial;
  result.sceneMaterial = state.sceneMaterial;
  return result;
}

function uniform(type, value) {
  return { type, value };
}

function normalizedColor(value, fallback) {
  const text = /^#[0-9a-f]{8}$/i.test(String(value || "")) ? String(value) : fallback;
  return [1, 3, 5, 7].map((offset) => Number.parseInt(text.slice(offset, offset + 2), 16) / 255);
}

function setting(settings, inputs, id) {
  return settings[id] === undefined ? inputs[id] : settings[id];
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function terrainShaderPart(id, name, stage, source) {
  return {
    id,
    name,
    kind: NODE_PART_KINDS.SHADER,
    language: "glsl",
    stage,
    program: "surface",
    editable: true,
    source,
  };
}
