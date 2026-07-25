import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const VISUAL_SOURCE_RENDERERS = Object.freeze({
  COMPONENT: "output/source:component",
  GENERATOR: "output/source:generator",
});

// Source-kind dispatch is part of the node contract and is resolved while the
// visual program compiles. The output host still supplies browser media and GPU
// resources, but it does not decide what conceptual source node was authored.
export function visualSourceRenderer(source = {}) {
  if (source.type === "component") return "output/source:component";
  if (source.type === "generator") return "output/source:generator";
  throw new Error(
    `VJ1_AUTHORED_VISUAL_SOURCE_REQUIRED:${String(source.type || "missing")}`
  );
}

export const VisualSourceNode = defineNode({
  id: "core.visual.source",
  name: "Visual Source",
  version: "0.1.0",
  description: "Produces a texture from a semantic visual generator or Component reference.",
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
  }, {
    id: "source-renderer-dispatch",
    name: "Source renderer dispatch",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "visualSourceRenderer",
    source: visualSourceRenderer.toString(),
  }],
  process: (inputs, context) => {
    if (typeof context.renderVisualSource !== "function") throw new Error("VISUAL_SOURCE_RENDER_HOST_MISSING");
    return { texture: context.renderVisualSource(inputs, context) };
  },
});
