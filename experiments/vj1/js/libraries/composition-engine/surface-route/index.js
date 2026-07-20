import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const SurfaceRouteNode = defineNode({
  id: "core.composition.surface-route",
  name: "Surface Route",
  version: "0.1.0",
  description: "Routes one Component or Canvas texture into a named projection surface.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: { texture: { type: "texture", optional: true }, surface: { type: "any", required: true } },
  outlets: { route: { type: "any" } },
  execution: { trigger: "input-change", domain: "main", pure: true },
  capabilities: ["surface-routing", "scene-program", "graph-placeable"],
  presentation: { catalogs: ["node-graph", "scene"], placeableOn: ["scene-graph"], previewOutput: "route" },
  parts: [{
    id: "surface-route",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    name: "Surface routing",
    export: "surfaceRouteNodeProcess",
    entry: "process",
    source: surfaceRouteNodeProcess.toString(),
  }],
  process: surfaceRouteNodeProcess,
});

export function surfaceRouteNodeProcess({ texture, surface } = {}) {
  return { route: { texture, surface } };
}
