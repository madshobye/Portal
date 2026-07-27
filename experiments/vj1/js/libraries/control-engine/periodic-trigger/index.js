import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const PeriodicTriggerControlNode = defineNode({
  id: "core.control.periodic-trigger",
  name: "Periodic Trigger",
  version: "0.1.0",
  description: "Produces stable component-time event tokens at a configurable interval.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: { time: { type: "number", required: true } },
  parameters: {
    interval: { type: "number", defaultValue: 1, allowedRange: [0.01, 3600], clamp: true },
    phase: { type: "number", defaultValue: 0, allowedRange: [0, 1], clamp: true },
  },
  outlets: {
    event: { type: "event" },
    eventTime: { type: "number" },
  },
  execution: { trigger: "frame", domain: "main", pure: true, asynchronous: false },
  capabilities: ["event-control", "timing", "graph-placeable", "live-fast-path"],
  presentation: {
    catalogs: ["controls", "graph", "motion"],
    placeableOn: ["control-canvas", "node-graph"],
    previewOutput: "event",
  },
  parts: [{
    id: "periodic-trigger-process",
    name: "Periodic trigger process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "periodicTriggerControlProcess",
    source: [periodicTriggerControlProcess].map((fn) => fn.toString()).join("\n\n"),
  }],
  process: periodicTriggerControlProcess,
});

export function periodicTriggerControlProcess(
  { time = 0, interval = 1, phase = 0 } = {},
  { output = {} } = {},
) {
  const period = Math.max(0.01, Number(interval) || 1);
  const offset = Math.min(1, Math.max(0, Number(phase) || 0)) * period;
  const now = Math.max(0, Number(time) || 0);
  const bucket = Math.floor((now + offset) / period);
  output.event = bucket + 1;
  output.eventTime = bucket * period - offset;
  return output;
}
