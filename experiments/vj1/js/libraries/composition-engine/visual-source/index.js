import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const VisualSourceNode = defineNode({
  id: "core.visual.source",
  name: "Visual Source",
  version: "0.1.0",
  description: "Produces a texture from media, camera, component-reference, or another host-provided visual input.",
  implementation: NODE_IMPLEMENTATION_KINDS.NATIVE,
  inlets: { texture: { type: "texture", optional: true }, source: { type: "any", required: true } },
  outlets: { texture: { type: "texture" } },
  execution: { trigger: "frame", domain: "main", stateful: true },
  capabilities: ["visual-node", "visual-source", "produces-image", "live-fast-path"],
  presentation: { catalogs: ["node-graph", "visual-source"], placeableOn: ["visual-graph"], previewOutput: "texture" },
  parts: [{
    id: "host-source-contract",
    name: "Host source contract",
    kind: NODE_PART_KINDS.DOCUMENTATION,
    source: "The source node owns typed source state; the render host supplies browser/GPU resources through renderVisualSource.",
  }],
  process: (inputs, context) => {
    if (typeof context.renderVisualSource !== "function") throw new Error("VISUAL_SOURCE_RENDER_HOST_MISSING");
    return { texture: context.renderVisualSource(inputs, context) };
  },
});
