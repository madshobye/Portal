import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../../node-engine/node-definition.js";
import {
  MaterialBinding3dListType,
} from "../../../mesh-engine/material-binding-3d/index.js";
import {
  createMaterial3d,
  Material3dType,
} from "../../../mesh-engine/scene-types.js";

const SLOT_STYLES = Object.freeze({
  surface: Object.freeze({ source: "surface", brightness: 1, wireScale: 1 }),
  feature: Object.freeze({ source: "wire", brightness: 0.62, wireScale: 1 }),
  lip: Object.freeze({ source: "surface", brightness: 0.46, wireScale: 1 }),
  eye: Object.freeze({ color: [244, 243, 232, 255], wireScale: 1 }),
  pupil: Object.freeze({ source: "wire", brightness: 0.22, wireScale: 1 }),
  vessel: Object.freeze({ source: "surface", brightness: 0.78, wireScale: 1 }),
  coronary: Object.freeze({ source: "surface", brightness: 0.48, wireScale: 0.72 }),
});

export const AnatomyMaterialPaletteNode = defineNode({
  id: "core.visual.anatomy-material-palette",
  name: "Anatomy Material Palette",
  version: "0.1.0",
  description: "Expands two authored colors into typed Material3d slot bindings for canonical Anatomy mesh collections.",
  implementation: NODE_IMPLEMENTATION_KINDS.DATA,
  inlets: {
    renderMode: {
      type: {
        type: "enum",
        values: ["surface", "points", "wireframe", "surfaceWire", "outline", "surfaceOutline", "xrayOutline"],
      },
      defaultValue: "surface",
    },
    surfaceColor: { type: "color", defaultValue: "#d9d4c9ff" },
    wireColor: { type: "color", defaultValue: "#4b4944cc" },
    wireThickness: { type: "number", defaultValue: 1.6 },
  },
  outlets: {
    defaultMaterial: { type: Material3dType },
    bindings: { type: MaterialBinding3dListType },
  },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: [
    "scene-3d",
    "material",
    "material-binding",
    "retained-value-provider",
    "graph-placeable",
  ],
  presentation: {
    catalogs: ["graph", "mesh", "material", "scene-3d"],
    placeableOn: ["visual-graph", "node-graph"],
  },
  parts: [{
    id: "anatomy-material-palette",
    name: "Anatomy material palette",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "anatomyMaterialPaletteProcess",
    entry: "process",
    source: [
      `const SLOT_STYLES = Object.freeze(${JSON.stringify(SLOT_STYLES)});`,
      anatomyMaterialPaletteProcess,
      shade,
      color,
      boundedByte,
      finite,
    ].map(String).join("\n\n"),
  }],
  moduleBindings: { createMaterial3d },
  process: anatomyMaterialPaletteProcess,
});

export function anatomyMaterialPaletteProcess(inputs = {}, { state = {}, output = null } = {}) {
  const signature = JSON.stringify([
    inputs.renderMode,
    inputs.surfaceColor,
    inputs.wireColor,
    inputs.wireThickness,
  ]);
  if (state.signature !== signature || !state.bindings) {
    const surfaceColor = color(inputs.surfaceColor, [217, 212, 201, 255]);
    const wireColor = color(inputs.wireColor, [75, 73, 68, 204]);
    const renderMode = String(inputs.renderMode || "surface");
    const wireThickness = Math.max(0.5, finite(inputs.wireThickness, 1.6));
    const materials = new Map();
    for (const [slot, style] of Object.entries(SLOT_STYLES)) {
      const base = style.color || (style.source === "wire" ? wireColor : surfaceColor);
      materials.set(slot, createMaterial3d({
        id: `anatomy-${slot}`,
        renderMode,
        surfaceColor: shade(base, style.brightness ?? 1),
        wireColor,
        wireThickness: wireThickness * style.wireScale,
      }));
    }
    state.signature = signature;
    state.defaultMaterial = materials.get("surface");
    state.bindings = Object.freeze([...materials].map(([slot, material]) => Object.freeze({
      kind: "material-binding3d",
      contractVersion: 1,
      slot,
      material,
    })));
  }
  const result = output || state.output || (state.output = {
    defaultMaterial: null,
    bindings: null,
  });
  result.defaultMaterial = state.defaultMaterial;
  result.bindings = state.bindings;
  return result;
}

function shade(value, brightness) {
  return Object.freeze([
    boundedByte(value[0] * brightness),
    boundedByte(value[1] * brightness),
    boundedByte(value[2] * brightness),
    boundedByte(value[3]),
  ]);
}

function color(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (match) {
    const expanded = match[1].length <= 4
      ? [...match[1]].map((digit) => `${digit}${digit}`).join("")
      : match[1];
    const rgba = expanded.length === 6 ? `${expanded}ff` : expanded;
    return [0, 2, 4, 6].map((offset) => Number.parseInt(rgba.slice(offset, offset + 2), 16));
  }
  const source = Array.isArray(value) || ArrayBuffer.isView(value) ? value : fallback;
  return [0, 1, 2, 3].map((index) => boundedByte(finite(source[index], fallback[index])));
}

function boundedByte(value) {
  return Math.max(0, Math.min(255, Math.round(finite(value, 0))));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
