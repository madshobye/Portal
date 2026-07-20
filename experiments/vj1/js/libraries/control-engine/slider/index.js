import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { defineNodeArtifact } from "../../node-engine/node-artifact.js";

export const SliderNode = defineNode({
  id: "core.control.slider",
  name: "Slider",
  version: "0.1.0",
  description: "Produces a normalized numeric control value from an editable slider.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  parameters: {
    value: {
      type: "number",
      defaultValue: 0,
      expectedRange: [0, 1],
      allowedRange: [0, 1],
      displayRange: [0, 1],
      clamp: true,
      editor: { type: "slider", step: 0.001 },
    },
  },
  outlets: {
    value: {
      type: "number",
      expectedRange: [0, 1],
      description: "Normalized slider value suitable for automatic range mapping.",
    },
  },
  execution: {
    trigger: "input-change",
    domain: "main",
    pure: true,
  },
  capabilities: ["numeric-control", "graph-placeable", "inspector-control"],
  presentation: {
    catalogs: ["controls", "graph"],
    placeableOn: ["control-canvas", "node-graph"],
    hiddenFrom: ["component-canvas", "component-catalog"],
    previewOutput: "value",
  },
  parts: [
    {
      id: "slider-control",
      name: "Slider control",
      kind: NODE_PART_KINDS.UI,
      editable: true,
      control: "slider",
      parameter: "value",
    },
    {
      id: "slider-algorithm",
      name: "Slider algorithm",
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: "sliderNodeProcess",
      source: sliderNodeProcess.toString(),
    },
  ],
  process: sliderNodeProcess,
});

export const SliderArtifact = defineNodeArtifact({
  id: "core.control.slider",
  name: "Slider",
  description: "A reusable numeric control that is visible in control and graph views, not as a visual component.",
  version: "0.1.0",
  artifactType: "control",
  implementation: {
    nodeType: SliderNode.id,
    nodeVersion: SliderNode.version,
  },
  capabilities: SliderNode.capabilities,
  presentation: SliderNode.presentation,
});

export function sliderNodeProcess({ value }) {
  return { value };
}
