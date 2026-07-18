import { renderQualityScale, renderQualityValue } from "../graph/component-schema.js?v=adaptive-component-demand-29";
import { componentRenderInstanceKey } from "./component-render-layout.js?v=instance-sync-60";
import { contentTransformUvMatrices } from "./content-coordinate-space.js?v=render-coordinate-scope-3";

export function qualityScaledRenderRequest(request = {}, params = {}, minimum = 0.35) {
  const scale = renderQualityScale(params, { minimum });
  if (scale >= 0.999) return request;
  const logicalWidth = Math.max(1, Number(request.logicalWidth) || Number(request.width) || 1);
  const logicalHeight = Math.max(1, Number(request.logicalHeight) || Number(request.height) || 1);
  const physicalWidth = Math.max(1, Number(request.width) || logicalWidth);
  const physicalHeight = Math.max(1, Number(request.height) || logicalHeight);
  return {
    ...request,
    width: Math.max(32, Math.round(physicalWidth * scale)),
    height: Math.max(32, Math.round(physicalHeight * scale)),
    logicalWidth,
    logicalHeight,
    qualityScale: scale,
  };
}

export function qualityAdjustedGeneratorParams(generatorId, params = {}) {
  const multiplier = qualityComputeMultiplier(params, { minimum: 0.35, maximum: 1.5 });
  const adjusted = { ...params };
  if (["seascape", "cloudyTunnel", "cherenkovVolume", "biomineLite"].includes(generatorId)) {
    adjusted.raySteps = Math.max(1, Math.round((Number(params.raySteps) || 1) * multiplier));
  }
  if (generatorId === "seascape") {
    adjusted.seaDetail = Math.max(1, Math.round((Number(params.seaDetail) || 1) * qualityComputeMultiplier(params, {
      minimum: 0.5,
      maximum: 1.2,
    })));
  }
  if (generatorId === "cloudyTunnel") {
    adjusted.cloudDetail = Math.max(1, Math.round((Number(params.cloudDetail) || 1) * qualityComputeMultiplier(params, {
      minimum: 0.5,
      maximum: 1.25,
    })));
  }
  if (generatorId === "biomineLite") {
    adjusted.surfaceDetail = Math.max(0, Math.round((Number(params.surfaceDetail) || 0) * qualityComputeMultiplier(params, {
      minimum: 0.5,
      maximum: 1.25,
    })));
  }
  if (generatorId === "cellularCircles") {
    adjusted.searchRadius = Math.max(1, Math.min(5, Math.round((Number(params.searchRadius) || 1) * multiplier)));
  }
  return adjusted;
}

export function eyeballFrameUniforms(timeSeconds = 0, params = {}) {
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
  const gazeA = shaderRandomGaze(gazeSegment);
  const gazeB = shaderRandomGaze(gazeSegment + 1);
  const gaze = [
    (mixNumber(gazeA[0], gazeB[0], eased) + Math.sin(time * 18.7 + shaderHash2(gazeSegment, 1.2) * Math.PI * 2) * 0.018 * jitter) * range,
    (mixNumber(gazeA[1], gazeB[1], eased) + Math.sin(time * 23.1 + shaderHash2(gazeSegment, 8.2) * Math.PI * 2) * 0.018 * jitter) * range,
  ];
  const gazeDir = normalizeVector3([gaze[0], gaze[1], 1]);
  const irisRight = normalizeVector3([gazeDir[2], 0, -gazeDir[0]]);
  const irisUp = normalizeVector3(crossVector3(irisRight, gazeDir));

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
      shutterBlinkNumber(blinkPhase - 0.2) * doubleChance
    ) * blinkChance;
  }

  return { gazeDir, irisRight, irisUp, blink };
}

export function componentInstanceTime(component = {}, baseTime = 0, instanceId = "") {
  if (component?.syncInstances !== false) return Number(baseTime) || 0;
  return instanceTime(componentRenderInstanceKey(component, instanceId), baseTime);
}

export function advanceRateClock(previous, baseTime, rate) {
  const now = Number(baseTime) || 0;
  const speed = Math.max(0, Number(rate) || 0);
  if (!previous || now < previous.baseTime) {
    return { baseTime: now, time: now * speed };
  }
  return {
    baseTime: now,
    time: previous.time + Math.max(0, now - previous.baseTime) * speed,
  };
}

export function advanceSpatialScale(previous, scale, anchor = [0, 0]) {
  const nextScale = Math.max(0.02, Number(scale) || 0.62);
  const point = [Number(anchor[0]) || 0, Number(anchor[1]) || 0];
  if (!previous) return { scale: nextScale, phase: [0, 0] };
  const delta = previous.scale - nextScale;
  return {
    scale: nextScale,
    phase: [
      previous.phase[0] + point[0] * delta,
      previous.phase[1] + point[1] * delta,
    ],
  };
}

export function generatorRateParam(generatorId) {
  if (generatorId === "fireflies" || generatorId === "bezierStrokes" || generatorId === "shadertoyBaseWarp" || generatorId === "cellularCircles" || generatorId === "seascape" || generatorId === "paintDrips" || generatorId === "cloudyTunnel" || generatorId === "cherenkovVolume" || generatorId === "biomineLite") return "speed";
  return "";
}

export function usesShadertoyInterface(component = {}) {
  if (component.type === "shadertoy") return true;
  const code = String(component.code || "");
  return /\bvoid\s+mainImage\s*\(/.test(code) && !/\bvoid\s+main\s*\(/.test(code);
}

export function globalVisualTimeScale(global = {}) {
  const stretch = Number(global?.timeStretch);
  if (Number.isFinite(stretch)) {
    const bounded = Math.max(-4, Math.min(4, stretch));
    return bounded <= -4 ? 0 : 2 ** bounded;
  }
  return 1;
}

export function effectTransformUniforms(transform = {}) {
  const matrices = contentTransformUvMatrices(transform);
  return {
    transform: [matrices.value.x, matrices.value.y, matrices.value.scale, matrices.value.rotation],
    forward: matrices.sampling,
    inverse: matrices.placement,
  };
}

export function qualityComputeMultiplier(params = {}, { minimum = 0.35, maximum = 1.5 } = {}) {
  const quality = renderQualityValue(params);
  if (quality <= 0.5) return minimum + (1 - minimum) * (quality / 0.5);
  return 1 + (maximum - 1) * ((quality - 0.5) / 0.5);
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

function shaderRandomGaze(seed) {
  return [
    (shaderHash2(seed, 2.31) * 2 - 1) * 0.72,
    (shaderHash2(seed, 7.77) * 2 - 1) * 0.38,
  ];
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

function normalizeVector3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function crossVector3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function instanceTime(instanceId, baseTime = 0) {
  return Number(baseTime) + instanceTimeOffset(instanceId);
}

function instanceTimeOffset(instanceId = "") {
  const text = String(instanceId || "");
  if (!text) return 0;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967295) * 97.0;
}
