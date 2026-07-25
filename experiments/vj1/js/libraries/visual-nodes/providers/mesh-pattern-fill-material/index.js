import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import {
  meshPatternPalette,
  meshPatternPaletteModuleSource,
} from "../../generators/mesh-patterns/palette.js";
import {
  MaterialBinding3dListType,
} from "../../../mesh-engine/material-binding-3d/index.js?v=mesh-collection-2";
import {
  createMaterial3d,
} from "../../../mesh-engine/scene-types.js?v=editable-inlet-literals-1";
import { VisualMaterialProviderType } from "../../shared/visual-stage-types.js";

const FILL_SETTING_IDS = Object.freeze([
  "palette",
  "colorCount",
  "baseColor",
  "colorB",
  "colorC",
  "colorD",
  "fillOpacity",
  "backgroundColor",
]);

export const MeshPatternFillMaterialProviderNode = defineNode({
  id: "core.visual.mesh-pattern-fill-material",
  name: "Mesh Pattern Fill Material",
  version: "0.1.0",
  description: "Owns Mesh Patterns' editable palette algorithm and canonical fill-material values independently from topology and rendering.",
  implementation: NODE_IMPLEMENTATION_KINDS.SHADER,
  inlets: {
    providerId: { type: "string", defaultValue: "mesh-pattern-fill" },
    settings: { type: "record", defaultValue: {} },
    palette: {
      type: { type: "enum", values: ["custom", "analogous", "complementary", "triadic", "split complementary", "tetradic", "monochrome"] },
      defaultValue: "triadic",
    },
    colorCount: { type: "number", defaultValue: 4, allowedRange: [2, 4], clamp: true },
    baseColor: { type: "color", defaultValue: "#e34b7fff" },
    colorB: { type: "color", defaultValue: "#27c7c7ff" },
    colorC: { type: "color", defaultValue: "#f0c541ff" },
    colorD: { type: "color", defaultValue: "#45246dff" },
    fillOpacity: { type: "number", defaultValue: 0.82, allowedRange: [0, 1], clamp: true },
    backgroundColor: { type: "color", defaultValue: "#08070cff" },
  },
  parameters: {
    providerId: { type: "string", defaultValue: "mesh-pattern-fill" },
    enabled: { type: "boolean", defaultValue: true },
    settings: { type: "record", defaultValue: {} },
  },
  outlets: {
    material: { type: VisualMaterialProviderType },
    materialBindings: { type: MaterialBinding3dListType },
  },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: [
    "material",
    "material-binding",
    "shader",
    "mesh-pattern",
    "scene-3d",
    "retained-value-provider",
    "visual-stage",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["node-graph", "mesh-pattern", "material", "scene-3d", "visual-stage"],
    placeableOn: ["visual-graph", "node-graph", "native-visual-graph"],
  },
  metadata: {
    nativeArtifactRequirements: {
      moduleExports: ["meshPatternPalette"],
      shaders: [],
    },
  },
  parts: [
    {
      id: "mesh-pattern-palette-module",
      name: "2D Mesh Patterns palette algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      exports: ["meshPatternPalette"],
      source: meshPatternPaletteModuleSource(),
    },
    {
      id: "mesh-pattern-fill-material-process",
      name: "Mesh Pattern Fill Material provider",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "meshPatternFillMaterialProcess",
      entry: "process",
      dependsOn: ["mesh-pattern-palette-module"],
      source: [
        meshPatternFillMaterialProcess,
        effectiveFillSettings,
        createPaletteMaterialBindings,
        byteColor,
        sameSettings,
        record,
      ].map(String).join("\n\n"),
    },
  ],
  moduleBindings: {
    FILL_SETTING_IDS,
    createMaterial3d,
  },
  moduleExports: { meshPatternPalette },
  process: meshPatternFillMaterialProcess,
});

export function meshPatternFillMaterialProcess(inputs = {}, { state = {}, output = null } = {}) {
  const settings = record(inputs.settings);
  const effectiveSettings = effectiveFillSettings(
    inputs,
    settings,
    state.effectiveSettings || (state.effectiveSettings = {}),
  );
  if (!sameSettings(state.paletteSettings, effectiveSettings)) {
    state.paletteSettings = { ...effectiveSettings };
    state.palette = Object.freeze(meshPatternPalette(effectiveSettings).map((color) => Object.freeze([...color])));
    state.materialBindings = createPaletteMaterialBindings(state.palette, effectiveSettings);
  }
  const result = output || state.output || (state.output = {
    material: null,
    materialBindings: null,
  });
  const material = result.material || (result.material = {});
  material.kind = "material";
  material.providerId = String(inputs.providerId || "mesh-pattern-fill");
  material.resourceIdentity = material.providerId;
  material.resourceRevision = JSON.stringify(effectiveSettings);
  material.settings = settings;
  material.enabled = inputs.enabled !== false;
  material.palette = state.palette;
  material.shaderProgram = "mesh-pattern-fill";
  material.materialBindings = state.materialBindings;
  result.materialBindings = state.materialBindings;
  return result;
}

function effectiveFillSettings(inputs, settings, result) {
  for (const id of FILL_SETTING_IDS) {
    const value = settings[id] === undefined ? inputs[id] : settings[id];
    if (value === undefined) delete result[id];
    else result[id] = value;
  }
  return result;
}

function createPaletteMaterialBindings(palette, settings) {
  const opacity = Math.max(0, Math.min(1, Number(settings.fillOpacity) || 0));
  return Object.freeze(palette.map((color, slot) => {
    const material = createMaterial3d({
      id: `mesh-pattern-fill-${slot}`,
      renderMode: "surface",
      surfaceColor: byteColor(color, opacity),
      wireColor: byteColor(color, opacity),
      metadata: {
        paletteSlot: slot,
        sourceNodeId: "core.visual.mesh-pattern-fill-material",
      },
    });
    return Object.freeze({
      kind: "material-binding3d",
      contractVersion: 1,
      slot: `palette-${slot}`,
      material,
    });
  }));
}

function byteColor(color, opacity) {
  return [0, 1, 2, 3].map((index) => {
    const channel = Number(color?.[index]);
    const normalized = Number.isFinite(channel) ? Math.max(0, Math.min(1, channel)) : index === 3 ? 1 : 0;
    return Math.round(normalized * (index === 3 ? opacity : 1) * 255);
  });
}

function sameSettings(previous, next) {
  if (!previous) return false;
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  return previousKeys.length === nextKeys.length &&
    nextKeys.every((key) => previous[key] === next[key]);
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
