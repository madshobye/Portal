import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";
import { animationCurveValue } from "../animation-curve/index.js";

export const DEFAULT_ENVELOPE_SEGMENTS = Object.freeze([
  Object.freeze({ duration: 0.1, value: 1, curve: "quad-out" }),
  Object.freeze({ duration: 0.3, value: 0, curve: "quad-in" }),
]);

export const SegmentEnvelopeControlNode = defineNode({
  id: "core.control.segment-envelope",
  name: "Segment Envelope",
  version: "0.1.0",
  description: "Runs an editable finite sequence of value, duration, and curve segments when its event input changes.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    time: { type: "number", required: true },
    trigger: { type: "event", required: true },
    triggerTime: { type: "number", optional: true },
  },
  parameters: {
    initial: { type: "number", defaultValue: 0 },
    segments: { type: "any", defaultValue: DEFAULT_ENVELOPE_SEGMENTS },
    retrigger: {
      type: { type: "enum", values: ["restart", "ignore"] },
      defaultValue: "restart",
      editor: { type: "select" },
    },
  },
  outlets: {
    value: { type: "number" },
    progress: { type: "number", expectedRange: [0, 1] },
    running: { type: "boolean" },
  },
  execution: { trigger: "frame", domain: "main", stateful: true, asynchronous: false },
  capabilities: ["motion", "envelope", "event-control", "numeric-control", "graph-placeable", "live-fast-path"],
  presentation: {
    catalogs: ["controls", "graph", "motion"],
    placeableOn: ["control-canvas", "node-graph"],
    previewOutput: "value",
  },
  parts: [{
    id: "segment-envelope-process",
    name: "Segment envelope process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "segmentEnvelopeControlProcess",
    source: [
      segmentEnvelopeControlProcess,
      normalizeEnvelopeSegments,
      envelopeSegmentAt,
      isEnvelopeCurve,
      animationCurveValue,
    ].map((fn) => fn.toString()).join("\n\n"),
  }],
  process: segmentEnvelopeControlProcess,
});

export function segmentEnvelopeControlProcess(
  {
    time = 0,
    trigger = null,
    triggerTime,
    initial = 0,
    segments = DEFAULT_ENVELOPE_SEGMENTS,
    retrigger = "restart",
  } = {},
  { output = {}, state = {} } = {},
) {
  const now = Math.max(0, Number(time) || 0);
  if (state.segmentSource !== segments) {
    state.segmentSource = segments;
    state.segments = normalizeEnvelopeSegments(segments);
    state.totalDuration = state.segments.reduce((total, segment) => total + segment.duration, 0);
  }
  const firstEvaluation = !state.initialized || now < state.lastTime;
  if (firstEvaluation) {
    state.initialized = true;
    state.running = false;
    state.startedAt = now;
    state.lastTrigger = null;
    state.hasTriggered = false;
    state.value = Number(initial) || 0;
  }
  const triggerChanged = trigger !== null && trigger !== undefined && trigger !== state.lastTrigger;
  if (triggerChanged && (!state.running || retrigger !== "ignore")) {
    state.startedAt = Number.isFinite(Number(triggerTime))
      ? Math.min(now, Math.max(0, Number(triggerTime)))
      : now;
    state.running = state.totalDuration > 0;
    state.hasTriggered = true;
    state.value = Number(initial) || 0;
  }
  state.lastTrigger = trigger;
  state.lastTime = now;

  if (!state.running || state.segments.length === 0) {
    output.value = state.hasTriggered ? state.value : Number(initial) || 0;
    output.progress = state.hasTriggered ? 1 : 0;
    output.running = false;
    return output;
  }

  const elapsed = Math.max(0, now - state.startedAt);
  if (elapsed >= state.totalDuration) {
    state.value = state.segments[state.segments.length - 1].value;
    output.value = state.value;
    output.progress = 1;
    output.running = false;
    state.running = false;
    return output;
  }

  const active = envelopeSegmentAt(
    state.segments,
    elapsed,
    Number(initial) || 0,
    state.active || (state.active = {}),
  );
  state.value = active.from + (active.to - active.from) *
    animationCurveValue(active.curve, active.progress);
  output.value = state.value;
  output.progress = state.totalDuration > 0 ? elapsed / state.totalDuration : 1;
  output.running = true;
  return output;
}

export function normalizeEnvelopeSegments(segments = DEFAULT_ENVELOPE_SEGMENTS) {
  const source = Array.isArray(segments) ? segments : DEFAULT_ENVELOPE_SEGMENTS;
  return source.slice(0, 32).map((segment) => ({
    duration: Math.max(0.001, Math.min(3600, Number(segment?.duration) || 0.1)),
    value: Number.isFinite(Number(segment?.value)) ? Number(segment.value) : 0,
    curve: isEnvelopeCurve(segment?.curve) ? segment.curve : "linear",
  }));
}

function isEnvelopeCurve(value) {
  switch (value) {
    case "linear":
    case "smoothstep":
    case "smootherstep":
    case "quad-in":
    case "quad-out":
    case "quad-in-out":
    case "cubic-in":
    case "cubic-out":
    case "cubic-in-out":
    case "quart-in":
    case "quart-out":
    case "quart-in-out":
    case "sine-in":
    case "sine-out":
    case "sine-in-out":
      return true;
    default:
      return false;
  }
}

function envelopeSegmentAt(segments, elapsed, initial, output = {}) {
  let offset = 0;
  let from = initial;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const end = offset + segment.duration;
    if (elapsed < end || index === segments.length - 1) {
      output.from = from;
      output.to = segment.value;
      output.curve = segment.curve;
      output.progress = Math.min(1, Math.max(0, (elapsed - offset) / segment.duration));
      return output;
    }
    offset = end;
    from = segment.value;
  }
  output.from = from;
  output.to = from;
  output.curve = "linear";
  output.progress = 1;
  return output;
}
