import {
  defineNode,
  NODE_EXECUTION_CLASSES,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../node-engine/node-definition.js";

export const RenderDemandNode = defineNode({
  id: "core.render.demand",
  name: "Render Demand",
  version: "0.1.0",
  description: "Publishes the current retained render request as explicit graph values.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  outlets: {
    // Allocation dimensions are the pixels actually requested for this ROI.
    width: { type: "number" },
    height: { type: "number" },
    // Domain dimensions recover the complete physical node boundary. Layout
    // and procedural algorithms use these so cropping never changes their
    // geometry; uvRect only selects the allocated window.
    domainWidth: { type: "number" },
    domainHeight: { type: "number" },
    logicalWidth: { type: "number" },
    logicalHeight: { type: "number" },
    renderIdentity: { type: "string" },
  },
  execution: {
    trigger: "input-change",
    domain: "main",
    pure: true,
    stateful: true,
    asynchronous: false,
    workload: NODE_EXECUTION_CLASSES.LIVE_FRAME,
  },
  capabilities: ["render-demand", "retained-value-provider", "graph-placeable"],
  presentation: {
    catalogs: ["node-graph", "render"],
    placeableOn: ["visual-graph", "node-graph"],
    previewOutput: "width",
  },
  parts: [{
    id: "render-demand-process",
    name: "Render demand projection",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "renderDemandProcess",
    source: [
      renderDemandProcess,
      renderDemandUvRect,
    ].map(String).join("\n\n"),
  }],
  process: renderDemandProcess,
});

export function renderDemandProcess(_inputs = {}, {
  renderRequest = {},
  output = {},
} = {}) {
  output.width = Math.max(1, Number(renderRequest.width) || 1);
  output.height = Math.max(1, Number(renderRequest.height) || 1);
  const uvRect = renderDemandUvRect(renderRequest.uvRect);
  output.domainWidth = output.width / uvRect[2];
  output.domainHeight = output.height / uvRect[3];
  output.logicalWidth = Math.max(1, Number(renderRequest.logicalWidth) || output.width);
  output.logicalHeight = Math.max(1, Number(renderRequest.logicalHeight) || output.height);
  output.renderIdentity = String(renderRequest.renderIdentity || "");
  return output;
}

function renderDemandUvRect(value) {
  if (!Array.isArray(value) || value.length < 4) return [0, 0, 1, 1];
  const width = Math.max(1e-9, Math.min(1, Number(value[2]) || 1));
  const height = Math.max(1e-9, Math.min(1, Number(value[3]) || 1));
  return [
    Math.max(0, Math.min(1 - width, Number(value[0]) || 0)),
    Math.max(0, Math.min(1 - height, Number(value[1]) || 0)),
    width,
    height,
  ];
}
