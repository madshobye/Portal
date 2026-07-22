import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const NestedNoiseMotionNode = defineNode({
  id: "core.motion.nested-noise",
  name: "Nested Noise Motion",
  version: "0.1.0",
  description: "Produces smooth normalized X/Y motion from layered deterministic value-noise fields.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    time: { type: "number", required: true },
    centerX: { type: "number", defaultValue: 0.5, expectedRange: [0, 1] },
    centerY: { type: "number", defaultValue: 0.5, expectedRange: [0, 1] },
    amount: { type: "number", defaultValue: 0.35, allowedRange: [0, 1], clamp: true },
    speed: { type: "number", defaultValue: 1, allowedRange: [-20, 20], clamp: true },
    detail: { type: "number", defaultValue: 0.45, allowedRange: [0, 1], clamp: true },
    seed: { type: "number", defaultValue: 0 },
  },
  outlets: {
    x: { type: "number", expectedRange: [0, 1] },
    y: { type: "number", expectedRange: [0, 1] },
    position: { type: "vector2" },
  },
  execution: { trigger: "frame", domain: "main", pure: true, asynchronous: false },
  capabilities: ["motion", "coordinate-generator", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["graph", "motion"], placeableOn: ["node-graph"] },
  parts: [{
    id: "nested-noise-motion-algorithm",
    name: "Nested noise motion algorithm",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "nestedNoiseMotionNodeProcess",
    source: nestedNoiseMotionNodeProcess.toString(),
  }],
  process: nestedNoiseMotionNodeProcess,
});

export function nestedNoiseMotionNodeProcess({
  time = 0, centerX = 0.5, centerY = 0.5, amount = 0.35,
  speed = 1, detail = 0.45, seed = 0,
} = {}) {
  const clock = Number(time) * Number(speed);
  const layer = (value, offset) => {
    const base = Math.sin(value * 0.73 + offset) * 0.62;
    const secondary = Math.sin(value * 1.91 + offset * 2.17) * 0.28 * Number(detail);
    const tertiary = Math.cos(value * 3.07 - offset * 0.61) * 0.1 * Number(detail) * Number(detail);
    return base + secondary + tertiary;
  };
  const x = Number(centerX) + layer(clock, Number(seed) + 1.7) * Number(amount);
  const y = Number(centerY) + layer(clock * 0.91, Number(seed) + 13.1) * Number(amount);
  return { x, y, position: [x, y] };
}
