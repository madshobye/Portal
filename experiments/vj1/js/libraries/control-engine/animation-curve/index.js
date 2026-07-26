import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const ANIMATION_CURVES = Object.freeze([
  "linear",
  "smoothstep",
  "smootherstep",
  "quad-in",
  "quad-out",
  "quad-in-out",
  "cubic-in",
  "cubic-out",
  "cubic-in-out",
  "quart-in",
  "quart-out",
  "quart-in-out",
  "sine-in",
  "sine-out",
  "sine-in-out",
]);

export const AnimationCurveControlNode = defineNode({
  id: "core.control.animation-curve",
  name: "Animation Curve",
  version: "0.1.0",
  description: "Maps normalized animation progress through a bounded easing curve with explicit return behavior.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    progress: { type: "number", required: true, expectedRange: [0, 1] },
    direction: { type: "number", defaultValue: 1, expectedRange: [-1, 1] },
  },
  parameters: {
    curve: {
      type: { type: "enum", values: ANIMATION_CURVES },
      defaultValue: "linear",
      editor: { type: "select" },
    },
    returnMode: {
      type: { type: "enum", values: ["retrace", "repeat"] },
      defaultValue: "retrace",
      editor: { type: "select" },
    },
  },
  outlets: { value: { type: "number", expectedRange: [0, 1] } },
  execution: { trigger: "frame", domain: "main", pure: true, asynchronous: false },
  capabilities: ["motion", "numeric-control", "animation-curve", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["controls", "graph", "motion"], placeableOn: ["control-canvas", "node-graph"], previewOutput: "value" },
  parts: [{
    id: "animation-curve-process",
    name: "Animation curve process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "animationCurveControlProcess",
    source: [animationCurveControlProcess, animationCurveValue].map((fn) => fn.toString()).join("\n\n"),
  }],
  process: animationCurveControlProcess,
});

export function animationCurveControlProcess(
  { progress = 0, direction = 1, curve = "linear", returnMode = "retrace" } = {},
  { output = {} } = {},
) {
  const amount = Math.min(1, Math.max(0, Number(progress) || 0));
  output.value = Number(direction) < 0
    ? returnMode === "repeat"
      ? 1 - animationCurveValue(curve, amount)
      : animationCurveValue(curve, 1 - amount)
    : animationCurveValue(curve, amount);
  return output;
}

export function animationCurveValue(curve = "linear", progress = 0) {
  const t = Math.min(1, Math.max(0, Number(progress) || 0));
  if (t === 0 || t === 1) return t;
  const inverse = 1 - t;
  switch (curve) {
    case "smoothstep": return t * t * (3 - 2 * t);
    case "smootherstep": return t * t * t * (t * (t * 6 - 15) + 10);
    case "quad-in": return t * t;
    case "quad-out": return 1 - inverse * inverse;
    case "quad-in-out": return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
    case "cubic-in": return t * t * t;
    case "cubic-out": return 1 - inverse * inverse * inverse;
    case "cubic-in-out": return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
    case "quart-in": return t * t * t * t;
    case "quart-out": return 1 - inverse * inverse * inverse * inverse;
    case "quart-in-out": return t < 0.5 ? 8 * t * t * t * t : 1 - ((-2 * t + 2) ** 4) / 2;
    case "sine-in": return 1 - Math.cos((t * Math.PI) / 2);
    case "sine-out": return Math.sin((t * Math.PI) / 2);
    case "sine-in-out": return -(Math.cos(Math.PI * t) - 1) / 2;
    default: return t;
  }
}
