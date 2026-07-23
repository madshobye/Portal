import { defineNodeGroup } from "../../node-engine/node-group.js";

export const LayerGroupNode = defineNodeGroup({
  id: "core.composition.layer-group",
  name: "Layer Group",
  version: "0.1.0",
  description: "An isolated, expandable visual subprogram with transform, opacity, and blend at its parent boundary.",
  executionModel: "compiled-graph",
  authoring: { activation: "recompile" },
  inlets: { texture: { type: "texture", optional: true } },
  outlets: { texture: { type: "texture" } },
  parameters: {
    opacity: { type: "number", defaultValue: 1, expectedRange: [0, 1], allowedRange: [0, 1], clamp: true },
    blend: { type: "string", defaultValue: "normal" },
    transform: { type: "transform2d", defaultValue: {} },
  },
  execution: { trigger: "frame", domain: "main", stateful: true },
  capabilities: ["visual-program", "layer-composition", "expandable-group"],
  presentation: { catalogs: ["node-graph", "structure"], placeableOn: ["visual-graph"], expandable: true, previewOutput: "texture" },
  nodes: [],
  connections: [],
  program: async (inputs, context) => {
    if (typeof context.executeLayerGroup !== "function") throw new Error("LAYER_GROUP_RENDER_HOST_MISSING");
    return { texture: await context.executeLayerGroup(inputs, context) };
  },
});
