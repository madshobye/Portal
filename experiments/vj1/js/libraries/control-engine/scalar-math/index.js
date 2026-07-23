import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const ScalarMathControlNode = defineNode({
  id: "core.control.scalar-math",
  name: "Scalar Math",
  version: "0.1.0",
  description: "Combines two numeric modulation signals with a selectable scalar operation.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    a: { type: "number", defaultValue: 0 },
    b: { type: "number", defaultValue: 1 },
  },
  parameters: {
    operation: {
      type: { type: "enum", values: ["add", "subtract", "multiply", "divide", "min", "max"] },
      defaultValue: "add",
      editor: { type: "select" },
    },
  },
  outlets: { value: { type: "number" } },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: ["numeric-control", "math", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["controls", "graph"], placeableOn: ["control-canvas", "node-graph"], previewOutput: "value" },
  parts: [{
    id: "scalar-math-process",
    name: "Scalar math process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "scalarMathControlProcess",
    source: scalarMathControlProcess.toString(),
  }],
  process: scalarMathControlProcess,
});

export function scalarMathControlProcess({ a = 0, b = 1, operation = "add" } = {}, { output = {} } = {}) {
  const left = Number(a);
  const right = Number(b);
  let value;
  if (operation === "subtract") value = left - right;
  else if (operation === "multiply") value = left * right;
  else if (operation === "divide") value = right === 0 ? 0 : left / right;
  else if (operation === "min") value = Math.min(left, right);
  else if (operation === "max") value = Math.max(left, right);
  else value = left + right;
  output.value = value;
  return output;
}
