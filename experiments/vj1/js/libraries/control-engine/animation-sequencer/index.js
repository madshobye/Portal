import { defineNode, NODE_IMPLEMENTATION_KINDS, NODE_PART_KINDS } from "../../node-engine/node-definition.js";

export const AnimationSequencerControlNode = defineNode({
  id: "core.control.animation-sequencer",
  name: "Animation Sequencer",
  version: "0.1.0",
  description: "Produces retained animation-leg progress for automatic or event-triggered loop and ping-pong sequences.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    time: { type: "number", required: true },
    trigger: { type: "event", optional: true },
    randomTrigger: { type: "event", optional: true },
    randomTriggerTime: { type: "number", optional: true },
  },
  parameters: {
    runMode: {
      type: { type: "enum", values: ["automatic", "triggered"] },
      defaultValue: "automatic",
      editor: { type: "select" },
    },
    pattern: {
      type: { type: "enum", values: ["loop", "ping-pong"] },
      defaultValue: "loop",
      editor: { type: "select" },
    },
    triggerBehavior: {
      type: { type: "enum", values: ["full-sequence", "next-leg"] },
      defaultValue: "full-sequence",
      editor: { type: "select" },
    },
    duration: { type: "number", defaultValue: 2, allowedRange: [0.05, 3600], clamp: true },
    pause: { type: "number", defaultValue: 0, allowedRange: [0, 3600], clamp: true },
    phase: { type: "number", defaultValue: 0, allowedRange: [0, 1], clamp: true },
  },
  outlets: {
    progress: { type: "number", expectedRange: [0, 1] },
    direction: { type: "number", expectedRange: [-1, 1] },
    value: { type: "number", expectedRange: [0, 1] },
    running: { type: "boolean" },
    holding: { type: "boolean" },
  },
  execution: { trigger: "frame", domain: "main", stateful: true, asynchronous: false },
  capabilities: ["motion", "timing", "event-control", "numeric-control", "graph-placeable", "live-fast-path"],
  presentation: { catalogs: ["controls", "graph", "motion"], placeableOn: ["control-canvas", "node-graph"], previewOutput: "value" },
  parts: [{
    id: "animation-sequencer-process",
    name: "Animation sequencer process",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "animationSequencerControlProcess",
    source: [
      animationSequencerControlProcess,
      automaticAnimationState,
      initializeTriggeredState,
      startTriggeredSequence,
      advanceTriggeredState,
      publishSequencerOutput,
      normalizedPhase,
      positiveModulo,
    ].map((fn) => fn.toString()).join("\n\n"),
  }],
  process: animationSequencerControlProcess,
});

export function animationSequencerControlProcess(
  {
    time = 0,
    trigger = null,
    randomTrigger = null,
    randomTriggerTime,
    runMode = "automatic",
    pattern = "loop",
    triggerBehavior = "full-sequence",
    duration = 2,
    pause = 0,
    phase = 0,
  } = {},
  { output = {}, state = {} } = {},
) {
  const now = Math.max(0, Number(time) || 0);
  const safeDuration = Math.max(0.05, Number(duration) || 2);
  const safePause = Math.max(0, Number(pause) || 0);
  const safePattern = pattern === "ping-pong" ? "ping-pong" : "loop";
  if (runMode !== "triggered") {
    automaticAnimationState(output, now, safePattern, safeDuration, safePause, normalizedPhase(phase));
    state.lastTime = now;
    state.lastManualTrigger = trigger;
    state.lastRandomTrigger = randomTrigger;
    state.initialized = true;
    return output;
  }

  if (!state.initialized || now < state.lastTime) {
    initializeTriggeredState(state, now, trigger, randomTrigger);
  }
  const manualChanged = trigger !== null && trigger !== undefined && trigger !== state.lastManualTrigger;
  const randomChanged = randomTrigger !== null && randomTrigger !== undefined && randomTrigger !== state.lastRandomTrigger;
  state.lastManualTrigger = trigger;
  state.lastRandomTrigger = randomTrigger;
  if (state.status === "idle" && (manualChanged || randomChanged)) {
    const requestedAt = randomChanged && Number.isFinite(Number(randomTriggerTime))
      ? Math.min(now, Math.max(0, Number(randomTriggerTime)))
      : now;
    startTriggeredSequence(state, requestedAt, safePattern, triggerBehavior);
  }
  advanceTriggeredState(state, now, safePattern, safeDuration, safePause);
  state.lastTime = now;
  publishSequencerOutput(output, state);
  return output;
}

export function automaticAnimationState(output, time, pattern, duration, pause, phase) {
  const legDuration = pattern === "ping-pong" ? duration * 0.5 : duration;
  const segment = legDuration + pause;
  const cycle = pattern === "ping-pong" ? segment * 2 : segment;
  const local = positiveModulo(time + phase * cycle, cycle);
  if (local < legDuration) {
    output.progress = local / legDuration;
    output.direction = 1;
    output.value = output.progress;
    output.running = true;
    output.holding = false;
    return output;
  }
  if (pattern === "loop" || local < segment) {
    output.progress = 1;
    output.direction = 1;
    output.value = 1;
    output.running = false;
    output.holding = pause > 0;
    return output;
  }
  const reverse = local - segment;
  if (reverse < legDuration) {
    output.progress = reverse / legDuration;
    output.direction = -1;
    output.value = 1 - output.progress;
    output.running = true;
    output.holding = false;
    return output;
  }
  output.progress = 1;
  output.direction = -1;
  output.value = 0;
  output.running = false;
  output.holding = pause > 0;
  return output;
}

function initializeTriggeredState(state, now, trigger, randomTrigger) {
  state.initialized = true;
  state.lastTime = now;
  state.lastManualTrigger = trigger;
  state.lastRandomTrigger = randomTrigger;
  state.status = "idle";
  state.endpoint = 0;
  state.direction = 1;
  state.progress = 0;
  state.startedAt = now;
  state.holdUntil = now;
  state.legsRemaining = 0;
  state.resetAfterHold = false;
}

function startTriggeredSequence(state, requestedAt, pattern, triggerBehavior) {
  if (pattern === "loop") {
    state.endpoint = 0;
    state.direction = 1;
    state.legsRemaining = 1;
    state.resetAfterHold = true;
  } else {
    state.direction = state.endpoint >= 0.5 ? -1 : 1;
    state.legsRemaining = triggerBehavior === "next-leg" ? 1 : 2;
    state.resetAfterHold = false;
  }
  state.progress = 0;
  state.startedAt = requestedAt;
  state.status = "moving";
}

function advanceTriggeredState(state, now, pattern, duration, pause) {
  const legDuration = pattern === "ping-pong" ? duration * 0.5 : duration;
  for (let transitions = 0; transitions < 6; transitions++) {
    if (state.status === "moving") {
      const elapsed = Math.max(0, now - state.startedAt);
      if (elapsed < legDuration) {
        state.progress = elapsed / legDuration;
        return;
      }
      state.progress = 1;
      state.endpoint = state.direction > 0 ? 1 : 0;
      state.legsRemaining = Math.max(0, state.legsRemaining - 1);
      state.status = "holding";
      state.holdUntil = state.startedAt + legDuration + pause;
      if (now < state.holdUntil) return;
    }
    if (state.status === "holding") {
      if (now < state.holdUntil) return;
      if (state.legsRemaining > 0) {
        state.direction *= -1;
        state.progress = 0;
        state.startedAt = state.holdUntil;
        state.status = "moving";
        continue;
      }
      if (state.resetAfterHold) {
        state.endpoint = 0;
        state.direction = 1;
        state.progress = 0;
        state.resetAfterHold = false;
      } else {
        state.progress = 0;
        state.direction = state.endpoint >= 0.5 ? -1 : 1;
      }
      state.status = "idle";
    }
    return;
  }
}

function publishSequencerOutput(output, state) {
  output.progress = state.progress;
  output.direction = state.direction;
  output.value = state.direction < 0 ? 1 - state.progress : state.progress;
  output.running = state.status === "moving";
  output.holding = state.status === "holding";
  return output;
}

function normalizedPhase(value) {
  const phase = Number(value);
  if (!Number.isFinite(phase)) return 0;
  return phase - Math.floor(phase);
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}
