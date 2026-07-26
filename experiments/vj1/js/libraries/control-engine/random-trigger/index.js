import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const RandomTriggerControlNode = defineNode({
  id: "core.control.random-trigger",
  name: "Random Trigger",
  version: "0.1.0",
  description: "Produces deterministic, component-time-aligned random trigger events at an average rate.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: { time: { type: "number", required: true } },
  parameters: {
    ratePerMinute: { type: "number", defaultValue: 0, allowedRange: [0, 120], clamp: true },
    seed: { type: "number", defaultValue: 1 },
  },
  outlets: {
    event: { type: "event" },
    eventTime: { type: "number" },
  },
  execution: { trigger: "frame", domain: "main", pure: true, asynchronous: false },
  capabilities: ["event-control", "random-control", "timing", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["controls", "graph", "motion"], placeableOn: ["control-canvas", "node-graph"], previewOutput: "event" },
  parts: [{
    id: "random-trigger-process",
    name: "Random trigger process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "randomTriggerControlProcess",
    source: [randomTriggerControlProcess, randomTriggerHash].map((fn) => fn.toString()).join("\n\n"),
  }],
  process: randomTriggerControlProcess,
});

export function randomTriggerControlProcess(
  { time = 0, ratePerMinute = 0, seed = 1 } = {},
  { output = {} } = {},
) {
  const quantumSeconds = 0.25;
  const now = Math.max(0, Number(time) || 0);
  const rate = Math.max(0, Math.min(120, Number(ratePerMinute) || 0));
  const bucket = Math.floor(now / quantumSeconds);
  const probability = 1 - Math.exp(-(rate / 60) * quantumSeconds);
  const active = rate > 0 && randomTriggerHash(bucket, seed) < probability;
  output.event = active ? bucket + 1 : null;
  output.eventTime = bucket * quantumSeconds;
  return output;
}

export function randomTriggerHash(bucket = 0, seed = 1) {
  let value = (Math.trunc(Number(bucket) || 0) ^ Math.trunc(Number(seed) || 1)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}
