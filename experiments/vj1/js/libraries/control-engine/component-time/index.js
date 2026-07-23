import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const ComponentTimeControlNode = defineNode({
  id: "core.control.component-time",
  name: "Component Time",
  version: "0.1.0",
  description: "Publishes the current Component time as a reusable modulation signal.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  parameters: {
    scale: { type: "number", defaultValue: 1, allowedRange: [-100, 100], editor: { type: "number" } },
    offset: { type: "number", defaultValue: 0, editor: { type: "number" } },
  },
  outlets: { time: { type: "number" } },
  execution: { trigger: "frame", domain: "main", pure: true, asynchronous: false },
  capabilities: ["timing", "numeric-control", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["controls", "graph", "timing"], placeableOn: ["control-canvas", "node-graph"], previewOutput: "time" },
  parts: [{
    id: "component-time-process",
    name: "Component time process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "componentTimeControlProcess",
    source: componentTimeControlProcess.toString(),
  }],
  process: componentTimeControlProcess,
});

export function componentTimeControlProcess({ scale = 1, offset = 0 } = {}, { componentTime = 0, output = {} } = {}) {
  output.time = Number(componentTime) * Number(scale) + Number(offset);
  return output;
}
