import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const OrbitMotionNode = defineNode({
  id: "core.motion.orbit",
  name: "Orbit Motion",
  version: "0.1.0",
  description: "Produces normalized X/Y coordinates from a primary orbit with an optional nested secondary orbit.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    time: { type: "number", required: true },
    centerX: { type: "number", defaultValue: 0.5, expectedRange: [0, 1] },
    centerY: { type: "number", defaultValue: 0.5, expectedRange: [0, 1] },
    radius: { type: "number", defaultValue: 0.25, allowedRange: [0, 1], clamp: true },
    secondaryRadius: { type: "number", defaultValue: 0.08, allowedRange: [0, 1], clamp: true },
    speed: { type: "number", defaultValue: 1, allowedRange: [-20, 20], clamp: true },
    phase: { type: "number", defaultValue: 0 },
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
    id: "orbit-motion-algorithm",
    name: "Orbit motion algorithm",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "orbitMotionNodeProcess",
    source: orbitMotionNodeProcess.toString(),
  }],
  process: orbitMotionNodeProcess,
});

export function orbitMotionNodeProcess({
  time = 0, centerX = 0.5, centerY = 0.5, radius = 0.25,
  secondaryRadius = 0.08, speed = 1, phase = 0,
} = {}, { output = {} } = {}) {
  const clock = Number(time) * Number(speed) + Number(phase);
  const x = Number(centerX) + Math.cos(clock) * Number(radius) + Math.cos(clock * -2.17) * Number(secondaryRadius);
  const y = Number(centerY) + Math.sin(clock) * Number(radius) + Math.sin(clock * -2.17) * Number(secondaryRadius);
  const position = output.position || (output.position = [0, 0]);
  position[0] = x;
  position[1] = y;
  output.x = x;
  output.y = y;
  return output;
}
