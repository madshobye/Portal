import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const VisualTimeScaleNode = defineNode({
  id: "core.timing.visual-time-scale",
  name: "Visual Time Scale",
  version: "0.1.0",
  description: "Maps the authored global time-stretch control to a bounded playback multiplier.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: { timeStretch: { type: "number", defaultValue: 0, allowedRange: [-4, 4], clamp: true } },
  outlets: { scale: { type: "number", expectedRange: [0, 16] } },
  execution: { trigger: "input-change", domain: "main", pure: true },
  capabilities: ["timing", "numeric-control", "graph-placeable"],
  presentation: { catalogs: ["graph", "timing"], placeableOn: ["node-graph"] },
  parts: [{
    id: "visual-time-scale",
    name: "Visual time scale",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "globalVisualTimeScale",
    source: globalVisualTimeScale.toString(),
  }],
  process: ({ timeStretch }) => ({ scale: globalVisualTimeScale({ timeStretch }) }),
});

export function globalVisualTimeScale(global = {}) {
  const stretch = Number(global?.timeStretch);
  if (Number.isFinite(stretch)) {
    const bounded = Math.max(-4, Math.min(4, stretch));
    return bounded <= -4 ? 0 : 2 ** bounded;
  }
  return 1;
}
