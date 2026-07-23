import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const MapRangeControlNode = defineNode({
  id: "core.control.map-range",
  name: "Map Range",
  version: "0.1.0",
  description: "Maps a numeric signal between arbitrary ranges with optional clamping.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: { value: { type: "number", required: true } },
  parameters: {
    inputMin: { type: "number", defaultValue: 0 },
    inputMax: { type: "number", defaultValue: 1 },
    outputMin: { type: "number", defaultValue: 0 },
    outputMax: { type: "number", defaultValue: 1 },
    clamp: { type: "boolean", defaultValue: false },
  },
  outlets: { value: { type: "number" } },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: ["numeric-control", "mapping", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["controls", "graph"], placeableOn: ["control-canvas", "node-graph"], previewOutput: "value" },
  parts: [{
    id: "map-range-process",
    name: "Map range process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "mapRangeControlProcess",
    source: mapRangeControlProcess.toString(),
  }],
  process: mapRangeControlProcess,
});

export function mapRangeControlProcess({
  value = 0,
  inputMin = 0,
  inputMax = 1,
  outputMin = 0,
  outputMax = 1,
  clamp = false,
} = {}, { output = {} } = {}) {
  const denominator = Number(inputMax) - Number(inputMin);
  let progress = denominator === 0 ? 0 : (Number(value) - Number(inputMin)) / denominator;
  if (clamp) progress = Math.max(0, Math.min(1, progress));
  output.value = Number(outputMin) + progress * (Number(outputMax) - Number(outputMin));
  return output;
}
