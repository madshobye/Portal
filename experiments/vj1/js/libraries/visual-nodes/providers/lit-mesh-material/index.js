import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../../node-engine/node-definition.js";
import {
  createMaterial3d,
  Material3dType,
} from "../../../mesh-engine/scene-types.js?v=editable-inlet-literals-1";
import { VisualMaterialProviderType } from "../../shared/visual-stage-types.js";

export const LitMeshMaterialProviderNode = defineNode({
  id: "core.visual.lit-mesh-material-provider",
  name: "Lit Mesh Material",
  version: "0.1.0",
  description: "Produces one canonical 3D mesh material plus the descriptor consumed by retained specialized mesh renderers.",
  implementation: NODE_IMPLEMENTATION_KINDS.SHADER,
  inlets: {
    providerId: { type: "string", defaultValue: "lit-mesh" },
    settings: { type: "record", defaultValue: {} },
    surfaceColor: { type: "color", defaultValue: "#dce1dcff" },
    wireColor: { type: "color", defaultValue: "#141414dc" },
    shaderSource: {
      type: "string",
      optional: true,
      defaultValue: "",
      editor: { type: "code", language: "glsl" },
    },
    uniforms: { type: "record", optional: true, defaultValue: {} },
    renderMode: {
      type: {
        type: "enum",
        values: ["surface", "points", "wireframe", "surfaceWire", "outline", "surfaceOutline", "xrayOutline"],
      },
      defaultValue: "surface",
      editor: { type: "select" },
    },
    wireThickness: { type: "number", defaultValue: 1, allowedRange: [0.5, 12], clamp: true },
    pointBudget: { type: "number", defaultValue: 4000, allowedRange: [128, 75000], clamp: true },
    visibleDepth: { type: "number", defaultValue: 1, allowedRange: [0.02, 1], clamp: true },
    edgeAngle: { type: "number", defaultValue: 35, allowedRange: [0, 180], clamp: true },
    edgeBudget: { type: "number", defaultValue: 20000, allowedRange: [1000, 50000], clamp: true },
    wireDetail: { type: "number", defaultValue: 0.25, allowedRange: [0, 1], clamp: true },
    renderQuality: { type: "number", defaultValue: 0.5, allowedRange: [0, 1], clamp: true },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "lit-mesh" },
    enabled: { type: "boolean", defaultValue: true },
    settings: { type: "record", defaultValue: {} },
  },
  outlets: {
    material: { type: VisualMaterialProviderType },
    sceneMaterial: { type: Material3dType },
  },
  execution: {
    trigger: "input-change",
    domain: "main",
    pure: true,
    asynchronous: false,
  },
  capabilities: [
    "material",
    "shader",
    "scene-3d",
    "retained-value-provider",
    "visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "material", "mesh", "scene-3d", "visual-stage"],
    placeableOn: ["visual-graph", "node-graph", "native-visual-graph"],
  },
  process: litMeshMaterialProviderProcess,
});

export function litMeshMaterialProviderProcess(inputs = {}, { state = {}, output = null } = {}) {
  const settings = isRecord(inputs.settings) ? inputs.settings : {};
  const providerId = String(inputs.providerId || "lit-mesh");
  const materialValues = {
    id: providerId,
    renderMode: setting(settings, inputs, "renderMode"),
    surfaceColor: setting(settings, inputs, "surfaceColor"),
    wireColor: setting(settings, inputs, "wireColor"),
    wireThickness: setting(settings, inputs, "wireThickness"),
    pointBudget: setting(settings, inputs, "pointBudget"),
    visibleDepth: setting(settings, inputs, "visibleDepth"),
    edgeAngle: setting(settings, inputs, "edgeAngle"),
    edgeBudget: setting(settings, inputs, "edgeBudget"),
    wireDetail: setting(settings, inputs, "wireDetail"),
    renderQuality: setting(settings, inputs, "renderQuality"),
    shaderSource: setting(settings, inputs, "shaderSource"),
    uniforms: setting(settings, inputs, "uniforms"),
    metadata: {
      providerId,
      sourceNodeId: LitMeshMaterialProviderNode.id,
    },
  };
  const signature = materialSignature(materialValues);
  if (state.materialSignature !== signature || !state.sceneMaterial) {
    state.materialSignature = signature;
    state.sceneMaterial = createMaterial3d(materialValues);
  }

  const result = output || state.output || (state.output = {
    material: null,
    sceneMaterial: null,
  });
  const descriptor = result.material || (result.material = {});
  descriptor.kind = "material";
  descriptor.providerId = providerId;
  descriptor.settings = settings;
  descriptor.enabled = inputs.enabled !== false;
  descriptor.sceneMaterial = state.sceneMaterial;
  result.sceneMaterial = state.sceneMaterial;
  return result;
}

function setting(settings, inputs, id) {
  return settings[id] === undefined ? inputs[id] : settings[id];
}

function materialSignature(values = {}) {
  return JSON.stringify([
    values.id,
    values.renderMode,
    values.surfaceColor,
    values.wireColor,
    values.wireThickness,
    values.pointBudget,
    values.visibleDepth,
    values.edgeAngle,
    values.edgeBudget,
    values.wireDetail,
    values.renderQuality,
    values.shaderSource,
    values.uniforms,
  ]);
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
