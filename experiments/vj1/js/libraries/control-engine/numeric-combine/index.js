import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const NUMERIC_COMBINATION_MODES = Object.freeze([
  "replace",
  "add",
  "multiply",
]);

export const NumericCombineControlNode = defineNode({
  id: "core.control.numeric-combine",
  name: "Numeric Combine",
  version: "0.1.0",
  description: "Combines a numeric modulation with an authored base value using explicit replacement, addition, or multiplication.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    base: { type: "number", required: true },
    modulation: { type: "number", required: true },
    available: { type: "boolean", required: false },
  },
  parameters: {
    mode: {
      type: { type: "enum", values: NUMERIC_COMBINATION_MODES },
      defaultValue: "replace",
      editor: { type: "select" },
    },
    clamp: { type: "boolean", defaultValue: false },
    minimum: { type: "number", defaultValue: 0 },
    maximum: { type: "number", defaultValue: 1 },
  },
  outlets: { value: { type: "number" } },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: ["numeric-control", "modulation-combination", "graph-placeable", "live-fast-path"],
  presentation: {
    catalogs: ["controls", "graph", "motion"],
    placeableOn: ["control-canvas", "node-graph"],
    previewOutput: "value",
  },
  parts: [{
    id: "numeric-combine-process",
    name: "Numeric combine process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "numericCombineControlProcess",
    source: numericCombineControlProcess.toString(),
  }],
  process: numericCombineControlProcess,
});

export function numericCombineControlProcess({
  base = 0,
  modulation = 0,
  available = true,
  mode = "replace",
  clamp = false,
  minimum = 0,
  maximum = 1,
} = {}, { output = {} } = {}) {
  const authored = finiteNumber(base, 0);
  const signal = finiteNumber(modulation, 0);
  let value = available === false
    ? authored
    : mode === "add"
      ? authored + signal
      : mode === "multiply"
        ? authored * signal
        : signal;
  if (clamp) {
    const low = Math.min(finiteNumber(minimum, value), finiteNumber(maximum, value));
    const high = Math.max(finiteNumber(minimum, value), finiteNumber(maximum, value));
    value = Math.min(high, Math.max(low, value));
  }
  output.value = value;
  return output;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
