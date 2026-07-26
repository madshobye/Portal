import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import {
  createMaterial3d,
  Material3dType,
} from "../../../mesh-engine/scene-types.js";
import { VisualMaterialProviderType } from "../../shared/visual-stage-types.js";
import {
  TERRAIN_WIRE_FRAGMENT_SHADER,
  TERRAIN_WIRE_VERTEX_SHADER,
} from "../../generators/terrain-flyover/shaders.js";

export const TerrainWireMaterialProviderNode = defineNode({
  id: "core.visual.terrain-wire-material",
  name: "Terrain Wire Material",
  version: "0.1.0",
  description: "Produces a reusable wireframe Material3d plus Terrain's retained expanded-line material descriptor.",
  implementation: NODE_IMPLEMENTATION_KINDS.SHADER,
  inlets: {
    providerId: { type: "string", defaultValue: "terrain-wire" },
    settings: { type: "record", defaultValue: {} },
    wireColor: { type: "color", defaultValue: "#f2f5efff" },
    wireWidth: { type: "number", defaultValue: 0.85, allowedRange: [0.1, 8], clamp: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "terrain-wire" },
    enabled: { type: "boolean", defaultValue: true },
    settings: { type: "record", defaultValue: {} },
  },
  outlets: {
    material: { type: VisualMaterialProviderType },
    sceneMaterial: { type: Material3dType },
  },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: [
    "material",
    "wireframe",
    "terrain",
    "scene-3d",
    "retained-value-provider",
    "visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "material", "terrain", "scene-3d", "visual-stage"],
    placeableOn: ["visual-graph", "node-graph", "native-visual-graph"],
  },
  metadata: {
    nativeArtifactRequirements: {
      moduleExports: [],
      shaders: ["terrain-wire-vertex", "terrain-wire-fragment"],
    },
  },
  parts: [
    terrainShaderPart(
      "terrain-wire-vertex",
      "Terrain wire vertex shader",
      "vertex",
      TERRAIN_WIRE_VERTEX_SHADER,
    ),
    terrainShaderPart(
      "terrain-wire-fragment",
      "Terrain wire fragment shader",
      "fragment",
      TERRAIN_WIRE_FRAGMENT_SHADER,
    ),
  ],
  process: terrainWireMaterialProviderProcess,
});

export function terrainWireMaterialProviderProcess(inputs = {}, { state = {}, output = null } = {}) {
  const settings = record(inputs.settings);
  const providerId = String(inputs.providerId || "terrain-wire");
  const wireColor = setting(settings, inputs, "wireColor");
  const wireWidth = bounded(setting(settings, inputs, "wireWidth"), 0.1, 8, 0.85);
  const signature = `${wireColor}:${wireWidth}`;
  if (state.signature !== signature || !state.sceneMaterial) {
    state.signature = signature;
    state.sceneMaterial = createMaterial3d({
      id: providerId,
      renderMode: "wireframe",
      wireColor,
      wireThickness: wireWidth,
      metadata: {
        providerId,
        sourceNodeId: TerrainWireMaterialProviderNode.id,
        nativeLineContract: "screen-space expanded terrain edges",
      },
    });
  }
  const result = output || state.output || (state.output = { material: null, sceneMaterial: null });
  const descriptor = result.material || (result.material = {});
  descriptor.kind = "material";
  descriptor.providerId = providerId;
  descriptor.settings = settings;
  descriptor.runtimeSettings = { wireColor, wireWidth };
  descriptor.enabled = inputs.enabled !== false;
  descriptor.sceneMaterial = state.sceneMaterial;
  result.sceneMaterial = state.sceneMaterial;
  return result;
}

function setting(settings, inputs, id) {
  return settings[id] === undefined ? inputs[id] : settings[id];
}

function bounded(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
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
    program: "wire",
    editable: true,
    source,
  };
}
