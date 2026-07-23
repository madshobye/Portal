import { defineNode, NODE_IMPLEMENTATION_KINDS } from "../../node-engine/node-definition.js";
import { createMaterial3d, Material3dType } from "../scene-types.js";

export const Material3dNode = defineNode({
  id: "core.scene3d.material",
  name: "3D Material",
  version: "0.1.0",
  description: "Creates a reusable mesh material, optionally backed by a vj1Surface fragment function.",
  implementation: NODE_IMPLEMENTATION_KINDS.SHADER,
  inlets: {
    id: { type: "string", defaultValue: "material" },
    surfaceColor: { type: "color", defaultValue: [220, 225, 220, 255] },
    wireColor: { type: "color", defaultValue: [20, 20, 20, 220] },
    shaderSource: { type: "string", optional: true, defaultValue: "" },
    uniforms: { type: "record", optional: true, defaultValue: {} },
  },
  parameters: {
    renderMode: {
      type: { type: "enum", values: ["surface", "points", "wireframe", "surfaceWire", "outline", "surfaceOutline", "xrayOutline"] },
      defaultValue: "surface",
      editor: { type: "select" },
    },
    wireThickness: { type: "number", defaultValue: 1, allowedRange: [0.5, 12], clamp: true },
    pointBudget: { type: "number", defaultValue: 4000, allowedRange: [128, 75000], clamp: true },
    visibleDepth: { type: "number", defaultValue: 1, allowedRange: [0.02, 1], clamp: true },
  },
  outlets: { material: { type: Material3dType } },
  execution: { trigger: "input-change", domain: "main", pure: true },
  capabilities: ["scene-3d", "material", "shader", "graph-placeable"],
  presentation: { catalogs: ["graph", "mesh", "scene-3d"], placeableOn: ["node-graph"] },
  process: (inputs) => ({ material: createMaterial3d(inputs) }),
});
