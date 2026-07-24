import {
  defineNode,
  NODE_IMPLEMENTATION_KINDS,
  NODE_PART_KINDS,
} from "../../../node-engine/node-definition.js";
import { GazeBlinkUniformsType } from "../../shared/specialized-compound-types.js";

export const GazeBlinkControllerNode = defineNode({
  id: "core.visual.gaze-blink-controller",
  name: "Gaze and Blink Controller",
  version: "0.1.0",
  description: "Produces a reusable phase-stable gaze basis and blink envelope independently from image rendering.",
  implementation: NODE_IMPLEMENTATION_KINDS.CODE,
  inlets: {
    componentTime: { type: "number", required: true },
    motionSpeed: { type: "number", defaultValue: 1, allowedRange: [0, 3], clamp: true },
    gazeRange: { type: "number", defaultValue: 1, allowedRange: [0, 1.5], clamp: true },
    pauseAmount: { type: "number", defaultValue: 0.82, allowedRange: [0, 1], clamp: true },
    jitter: { type: "number", defaultValue: 0.35, allowedRange: [0, 1], clamp: true },
    blinkRate: { type: "number", defaultValue: 1, allowedRange: [0, 3], clamp: true },
  },
  parameters: {
    motionSpeed: { type: "number", defaultValue: 1, allowedRange: [0, 3], clamp: true },
    gazeRange: { type: "number", defaultValue: 1, allowedRange: [0, 1.5], clamp: true },
    pauseAmount: { type: "number", defaultValue: 0.82, allowedRange: [0, 1], clamp: true },
    jitter: { type: "number", defaultValue: 0.35, allowedRange: [0, 1], clamp: true },
    blinkRate: { type: "number", defaultValue: 1, allowedRange: [0, 3], clamp: true },
  },
  outlets: {
    uniforms: { type: GazeBlinkUniformsType },
  },
  execution: {
    trigger: "frame",
    domain: "main",
    stateful: true,
    asynchronous: false,
  },
  capabilities: [
    "motion",
    "controller",
    "gaze",
    "blink",
    "specialized-visual-provider",
    "specialized-visual-stage",
    "graph-placeable",
    "live-fast-path",
  ],
  presentation: {
    catalogs: ["node-graph", "motion", "character", "controller", "specialized-visual"],
    placeableOn: ["node-graph", "native-visual-graph"],
    previewOutput: "uniforms",
  },
  parts: [{
    id: "gaze-blink-controller",
    name: "Gaze and blink motion",
    kind: NODE_PART_KINDS.JAVASCRIPT,
    language: "javascript",
    editable: true,
    module: import.meta.url,
    export: "gazeBlinkControllerProcess",
    entry: "process",
    source: [
      gazeBlinkControllerProcess,
      gazeBlinkUniforms,
      boundedNumber,
      mixNumber,
      smoothstepNumber,
      shaderHash2,
      shutterBlinkNumber,
      smoothstepRange,
      fractNumber,
      normalizeVector3Into,
      crossNormalizedVector3Into,
      reusableGazeBlinkUniforms,
    ].map(String).join("\n\n"),
  }],
  moduleExports: {
    gazeBlinkUniforms,
  },
  process: gazeBlinkControllerProcess,
});

export function gazeBlinkControllerProcess(inputs = {}, { state = {}, output = null } = {}) {
  state.uniforms = gazeBlinkUniforms(inputs.componentTime, inputs, state.uniforms);
  const result = output || state.output || (state.output = { uniforms: null });
  result.uniforms = state.uniforms;
  return result;
}

export function gazeBlinkUniforms(timeSeconds = 0, params = {}, output = null) {
  const frame = reusableGazeBlinkUniforms(output);
  const time = Number(timeSeconds) || 0;
  const speed = Math.max(0.05, boundedNumber(params.motionSpeed, 1, 0, 3));
  const range = boundedNumber(params.gazeRange, 1, 0, 1.5);
  const pause = boundedNumber(params.pauseAmount, 0.82, 0, 1);
  const jitter = boundedNumber(params.jitter, 0.35, 0, 1);
  const gazeClock = time * speed * 0.85;
  const gazeSegment = Math.floor(gazeClock);
  const gazePhase = gazeClock - gazeSegment;
  const movePortion = mixNumber(0.98, 0.08, pause);
  const eased = smoothstepNumber(Math.min(1, gazePhase / Math.max(0.00001, movePortion)));
  const gazeAx = (shaderHash2(gazeSegment, 2.31) * 2 - 1) * 0.72;
  const gazeAy = (shaderHash2(gazeSegment, 7.77) * 2 - 1) * 0.38;
  const gazeBx = (shaderHash2(gazeSegment + 1, 2.31) * 2 - 1) * 0.72;
  const gazeBy = (shaderHash2(gazeSegment + 1, 7.77) * 2 - 1) * 0.38;
  const gazeX = (mixNumber(gazeAx, gazeBx, eased) +
    Math.sin(time * 18.7 + shaderHash2(gazeSegment, 1.2) * Math.PI * 2) * 0.018 * jitter) * range;
  const gazeY = (mixNumber(gazeAy, gazeBy, eased) +
    Math.sin(time * 23.1 + shaderHash2(gazeSegment, 8.2) * Math.PI * 2) * 0.018 * jitter) * range;
  normalizeVector3Into(frame.gazeDir, gazeX, gazeY, 1);
  normalizeVector3Into(frame.irisRight, frame.gazeDir[2], 0, -frame.gazeDir[0]);
  crossNormalizedVector3Into(frame.irisUp, frame.irisRight, frame.gazeDir);

  const blinkRate = boundedNumber(params.blinkRate, 1, 0, 3);
  let blink = 0;
  if (blinkRate > 0.001) {
    const blinkClock = time * blinkRate * 0.55;
    const blinkSegment = Math.floor(blinkClock);
    const blinkPhase = blinkClock - blinkSegment;
    const blinkChance = shaderHash2(blinkSegment, 11.1) >= 0.34 ? 1 : 0;
    const doubleChance = shaderHash2(blinkSegment, 19.4) >= 0.78 ? 1 : 0;
    blink = Math.max(
      shutterBlinkNumber(blinkPhase),
      shutterBlinkNumber(blinkPhase - 0.2) * doubleChance,
    ) * blinkChance;
  }
  frame.blink = blink;
  return frame;
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
}

function mixNumber(a, b, amount) {
  return a + (b - a) * amount;
}

function smoothstepNumber(value) {
  const amount = Math.min(1, Math.max(0, Number(value) || 0));
  return amount * amount * (3 - 2 * amount);
}

function shaderHash2(x, y) {
  let px = fractNumber((Number(x) || 0) * 0.1031);
  let py = fractNumber((Number(y) || 0) * 0.1031);
  let pz = px;
  const dot = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
  px += dot;
  py += dot;
  pz += dot;
  return fractNumber((px + py) * pz);
}

function shutterBlinkNumber(phase) {
  const close = smoothstepRange(phase, 0.015, 0.045);
  const open = 1 - smoothstepRange(phase, 0.078, 0.125);
  return close * open;
}

function smoothstepRange(value, start, end) {
  return smoothstepNumber(((Number(value) || 0) - start) / Math.max(0.00001, end - start));
}

function fractNumber(value) {
  return value - Math.floor(value);
}

function normalizeVector3Into(output, x, y, z) {
  const length = Math.hypot(x, y, z) || 1;
  output[0] = x / length;
  output[1] = y / length;
  output[2] = z / length;
  return output;
}

function crossNormalizedVector3Into(output, a, b) {
  normalizeVector3Into(
    output,
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  );
}

function reusableGazeBlinkUniforms(output) {
  if (output?.gazeDir?.length >= 3 && output?.irisRight?.length >= 3 && output?.irisUp?.length >= 3) {
    return output;
  }
  return {
    kind: "gaze-blink-uniforms",
    contractVersion: 1,
    gazeDir: [0, 0, 1],
    irisRight: [1, 0, 0],
    irisUp: [0, 1, 0],
    blink: 0,
  };
}
