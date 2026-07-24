import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import {
  MESH_PATTERN_WIRE_FRAGMENT_SHADER,
  MESH_PATTERN_WIRE_VERTEX_SHADER,
} from "../../generators/mesh-patterns/shaders.js";
import {
  createMaterial3d,
  Material3dType,
} from "../../../mesh-engine/scene-types.js?v=editable-inlet-literals-1";
import { VisualMaterialProviderType } from "../../shared/specialized-compound-types.js";

const WIRE_SETTING_IDS = Object.freeze([
  "wireColor",
  "wireOpacity",
  "wireWidth",
]);

export const MeshPatternWireMaterialProviderNode = defineNode({
  id: "core.visual.mesh-pattern-wire-material",
  name: "Mesh Pattern Wire Material",
  version: "0.1.0",
  description: "Owns Mesh Patterns' editable expanded-line shader and wire appearance independently from topology and rendering.",
  implementation: NODE_IMPLEMENTATION_KINDS.SHADER,
  inlets: {
    providerId: { type: "string", defaultValue: "mesh-pattern-wire" },
    settings: { type: "record", defaultValue: {} },
    wireColor: { type: "color", defaultValue: "#fff4d6ff" },
    wireOpacity: { type: "number", defaultValue: 1, allowedRange: [0, 1], clamp: true },
    wireWidth: { type: "number", defaultValue: 1.5, allowedRange: [0.25, 12], clamp: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "mesh-pattern-wire" },
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
    "shader",
    "wireframe",
    "mesh-pattern",
    "scene-3d",
    "specialized-visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "mesh-pattern", "material", "scene-3d", "specialized-visual"],
    placeableOn: ["node-graph", "native-visual-graph"],
  },
  metadata: {
    nativeArtifactRequirements: {
      moduleExports: [],
      shaders: ["mesh-pattern-wire-vertex", "mesh-pattern-wire-fragment"],
    },
  },
  parts: [
    {
      id: "mesh-pattern-wire-material-process",
      name: "Mesh Pattern Wire Material provider",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "meshPatternWireMaterialProcess",
      entry: "process",
      source: [
        meshPatternWireMaterialProcess,
        effectiveWireSettings,
        opacityColor,
        record,
      ].map(String).join("\n\n"),
    },
    shaderPart("mesh-pattern-wire-vertex", "2D Mesh Patterns wire vertex shader", "vertex", MESH_PATTERN_WIRE_VERTEX_SHADER),
    shaderPart("mesh-pattern-wire-fragment", "2D Mesh Patterns wire fragment shader", "fragment", MESH_PATTERN_WIRE_FRAGMENT_SHADER),
  ],
  moduleBindings: {
    WIRE_SETTING_IDS,
    createMaterial3d,
  },
  process: meshPatternWireMaterialProcess,
});

export function meshPatternWireMaterialProcess(inputs = {}, { output = null, state = {} } = {}) {
  const settings = record(inputs.settings);
  const effectiveSettings = effectiveWireSettings(
    inputs,
    settings,
    state.effectiveSettings || (state.effectiveSettings = {}),
  );
  const signature = JSON.stringify(effectiveSettings);
  if (state.materialSignature !== signature || !state.sceneMaterial) {
    state.materialSignature = signature;
    state.sceneMaterial = createMaterial3d({
      id: "mesh-pattern-wire",
      renderMode: "wireframe",
      surfaceColor: opacityColor(effectiveSettings.wireColor, effectiveSettings.wireOpacity),
      wireColor: opacityColor(effectiveSettings.wireColor, effectiveSettings.wireOpacity),
      wireThickness: Math.max(0.25, Number(effectiveSettings.wireWidth) || 1.5),
      metadata: {
        sourceNodeId: "core.visual.mesh-pattern-wire-material",
      },
    });
  }
  const result = output || state.output || (state.output = {
    material: null,
    sceneMaterial: null,
  });
  const material = result.material || (result.material = {});
  material.kind = "material";
  material.providerId = String(inputs.providerId || "mesh-pattern-wire");
  material.settings = settings;
  material.enabled = inputs.enabled !== false;
  material.shaderProgram = "mesh-pattern-wire";
  material.sceneMaterial = state.sceneMaterial;
  result.sceneMaterial = state.sceneMaterial;
  return result;
}

function effectiveWireSettings(inputs, settings, result) {
  for (const id of WIRE_SETTING_IDS) {
    const value = settings[id] === undefined ? inputs[id] : settings[id];
    if (value === undefined) delete result[id];
    else result[id] = value;
  }
  return result;
}

function opacityColor(value, opacity) {
  const text = String(value || "#fff4d6ff").replace(/^#/, "");
  const normalized = /^[0-9a-f]{8}$/i.test(text)
    ? text
    : /^[0-9a-f]{6}$/i.test(text) ? `${text}ff` : "fff4d6ff";
  const alpha = Math.max(0, Math.min(1, Number(opacity) || 0));
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16))
    .concat(Math.round(Number.parseInt(normalized.slice(6, 8), 16) * alpha));
}

function shaderPart(id, name, stage, source) {
  return {
    id,
    name,
    kind: NODE_PART_KINDS.SHADER,
    language: "glsl",
    stage,
    program: "mesh-pattern-wire",
    editable: true,
    source,
  };
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
