import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

const LIVE_CONTROL = Object.freeze({
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  presentation: {
    catalogs: ["controls", "graph"],
    placeableOn: ["control-canvas", "node-graph"],
    previewOutput: "value",
  },
});

export const Vector2ControlNode = controlNode({
  id: "core.control.vector2",
  name: "Vector 2",
  description: "Combines two numeric control signals into one reusable two-dimensional vector.",
  inlets: {
    x: { type: "number", defaultValue: 0 },
    y: { type: "number", defaultValue: 0 },
  },
  outlets: { value: { type: "vector2" } },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: ["vector-control", "graph-placeable", "live-fast-path"],
  process: vector2ControlProcess,
});

export const Vector3ControlNode = controlNode({
  id: "core.control.vector3",
  name: "Vector 3",
  description: "Combines three numeric control signals into one reusable three-dimensional vector.",
  inlets: {
    x: { type: "number", defaultValue: 0 },
    y: { type: "number", defaultValue: 0 },
    z: { type: "number", defaultValue: 0 },
  },
  outlets: { value: { type: "vector3" } },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: ["vector-control", "graph-placeable", "live-fast-path"],
  process: vector3ControlProcess,
});

export const SmoothControlNode = controlNode({
  id: "core.control.smooth",
  name: "Smooth",
  description: "Applies time-correct exponential smoothing to a numeric control signal.",
  inlets: { value: { type: "number", required: true } },
  parameters: {
    timeConstant: { type: "number", defaultValue: 0.12, allowedRange: [0, 60], editor: { type: "number" } },
  },
  outlets: { value: { type: "number" } },
  execution: { trigger: "frame", domain: "main", stateful: true, asynchronous: false },
  capabilities: ["numeric-control", "smoothing", "graph-placeable", "live-fast-path"],
  process: smoothControlProcess,
});

export const SelectControlNode = controlNode({
  id: "core.control.select",
  name: "Select",
  description: "Selects one of four typed control values using a numeric index.",
  inlets: {
    index: { type: "number", defaultValue: 0 },
    a: { type: "any", optional: true },
    b: { type: "any", optional: true },
    c: { type: "any", optional: true },
    d: { type: "any", optional: true },
  },
  outlets: { value: { type: "any" } },
  execution: { trigger: "input-change", domain: "main", pure: true, asynchronous: false },
  capabilities: ["value-control", "selection", "graph-placeable", "live-fast-path"],
  process: selectControlProcess,
});

export const FrameDelayControlNode = controlNode({
  id: "core.control.frame-delay",
  name: "Frame Delay",
  description: "Publishes the preceding evaluation's value without allocating a per-frame packet.",
  inlets: { value: { type: "any", optional: true } },
  parameters: { initial: { type: "any", optional: true } },
  outlets: { value: { type: "any" } },
  execution: { trigger: "frame", domain: "main", stateful: true, asynchronous: false },
  capabilities: ["value-control", "delay", "graph-placeable", "live-fast-path"],
  process: frameDelayControlProcess,
});

export const EventTriggerControlNode = controlNode({
  id: "core.control.event-trigger",
  name: "Event Trigger",
  description: "Turns a rising numeric threshold crossing into a stable monotonic event token.",
  inlets: { value: { type: "number", required: true } },
  parameters: { threshold: { type: "number", defaultValue: 0.5 } },
  outlets: {
    event: { type: "event" },
    gate: { type: "boolean" },
    value: { type: "number" },
  },
  execution: { trigger: "frame", domain: "main", stateful: true, asynchronous: false },
  capabilities: ["event-control", "numeric-control", "graph-placeable", "live-fast-path"],
  process: eventTriggerControlProcess,
});

export const SampleHoldControlNode = controlNode({
  id: "core.control.sample-hold",
  name: "Sample and Hold",
  description: "Captures a value when an event token changes or a gate rises, then retains it.",
  inlets: {
    value: { type: "any", optional: true },
    event: { type: "event", optional: true },
    gate: { type: "boolean", optional: true },
  },
  parameters: { initial: { type: "any", optional: true } },
  outlets: { value: { type: "any" } },
  execution: { trigger: "frame", domain: "main", stateful: true, asynchronous: false },
  capabilities: ["value-control", "event-control", "sample-hold", "graph-placeable", "live-fast-path"],
  process: sampleHoldControlProcess,
});

export function vector2ControlProcess({ x = 0, y = 0 } = {}, { output = {}, state = {} } = {}) {
  const value = state.value || (state.value = [0, 0]);
  value[0] = Number(x) || 0;
  value[1] = Number(y) || 0;
  output.value = value;
  return output;
}

export function vector3ControlProcess({ x = 0, y = 0, z = 0 } = {}, { output = {}, state = {} } = {}) {
  const value = state.value || (state.value = [0, 0, 0]);
  value[0] = Number(x) || 0;
  value[1] = Number(y) || 0;
  value[2] = Number(z) || 0;
  output.value = value;
  return output;
}

export function smoothControlProcess(
  { value = 0, timeConstant = 0.12 } = {},
  { timestamp = 0, output = {}, state = {} } = {},
) {
  const next = Number(value) || 0;
  const now = Number(timestamp) || 0;
  if (!state.initialized || Number(timeConstant) <= 0 || now < state.timestamp) {
    state.value = next;
    state.initialized = true;
  } else {
    const elapsed = Math.max(0, now - state.timestamp);
    const alpha = 1 - Math.exp(-elapsed / Math.max(1e-6, Number(timeConstant)));
    state.value += (next - state.value) * alpha;
  }
  state.timestamp = now;
  output.value = state.value;
  return output;
}

export function selectControlProcess({ index = 0, a, b, c, d } = {}, { output = {} } = {}) {
  const selected = Math.max(0, Math.min(3, Math.round(Number(index) || 0)));
  output.value = selected === 0 ? a : selected === 1 ? b : selected === 2 ? c : d;
  return output;
}

export function frameDelayControlProcess({ value, initial } = {}, { output = {}, state = {} } = {}) {
  output.value = state.initialized ? state.previous : initial;
  state.previous = value;
  state.initialized = true;
  return output;
}

export function eventTriggerControlProcess(
  { value = 0, threshold = 0.5 } = {},
  { output = {}, state = {} } = {},
) {
  const numeric = Number(value) || 0;
  const gate = numeric >= Number(threshold);
  if (!state.initialized) {
    state.sequence = 0;
    state.previousGate = false;
    state.initialized = true;
  }
  if (gate && !state.previousGate) state.sequence += 1;
  state.previousGate = gate;
  output.event = state.sequence > 0 ? state.sequence : null;
  output.gate = gate;
  output.value = numeric;
  return output;
}

export function sampleHoldControlProcess(
  { value, event, gate = false, initial } = {},
  { output = {}, state = {} } = {},
) {
  const hasEvent = event !== undefined && event !== null;
  const eventChanged = hasEvent && (!state.hasEvent || event !== state.event);
  const gateRaised = !!gate && !state.gate;
  if (!state.initialized) {
    state.value = initial;
    state.initialized = true;
  }
  if (eventChanged || gateRaised) state.value = value;
  state.hasEvent = hasEvent;
  state.event = event;
  state.gate = !!gate;
  output.value = state.value;
  return output;
}

function controlNode(definition) {
  const process = definition.process;
  return defineNode({
    ...LIVE_CONTROL,
    ...definition,
    version: "0.1.0",
    presentation: { ...LIVE_CONTROL.presentation, ...definition.presentation },
    parts: [{
      id: `${definition.id.split(".").pop()}-process`,
      name: `${definition.name} process`,
      kind: NODE_PART_KINDS.JAVASCRIPT,
      language: "javascript",
      editable: true,
      module: import.meta.url,
      export: process.name,
      source: process.toString(),
    }],
  });
}
