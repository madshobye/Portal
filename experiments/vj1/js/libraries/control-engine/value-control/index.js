import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const ValueControlNode = defineNode({
  id: "core.control.value",
  name: "Value Control",
  version: "0.1.0",
  description: "Publishes a typed non-numeric parameter value through an inspector-selected editor.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: { value: { type: "any", optional: true } },
  parameters: { value: { type: "any", optional: true, editor: { type: "input" } } },
  outlets: { value: { type: "any" } },
  execution: { trigger: "input-change", domain: "main", pure: true },
  capabilities: ["value-control", "graph-placeable", "inspector-control"],
  presentation: {
    catalogs: ["controls", "graph"],
    placeableOn: ["control-canvas", "node-graph"],
    hiddenFrom: ["component-canvas", "component-catalog"],
    previewOutput: "value",
  },
  parts: [{
    id: "value-control",
    name: "Value editor",
    kind: NODE_PART_KINDS.UI,
    editable: true,
    control: "auto",
    parameter: "value",
  }],
  process: valueControlProcess,
});

export function valueControlProcess({ value }, { output = {} } = {}) {
  output.value = value;
  return output;
}
