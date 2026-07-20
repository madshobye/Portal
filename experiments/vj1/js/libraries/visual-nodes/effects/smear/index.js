import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "smear",
    name: "Smear",
    category: "texture",
    runtime: animatedSeedRuntime({
      active: (params = {}) => ["cctvAmount", "screenPrintAmount", "dotMatrixAmount", "receiptAmount", "ditherAmount", "smearAmount"]
        .some((id) => (Number(params[id]) || 0) > 0.0001),
      fps: 18,
    }),
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("cctvAmount", "CCTV", { min: 0, max: 1, step: 0.01, defaultValue: 0.45 }),
      createNumberParam("screenPrintAmount", "Screen print", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("dotMatrixAmount", "Dot matrix", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("receiptAmount", "Receipt", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("ditherAmount", "Dither", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("smearAmount", "Smear", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("scale", "Scale", { min: 0.25, max: 4, step: 0.01, defaultValue: 1 }),
      ...noiseSeedParams(83),
    ],
    code: `
float stableSmearNoise(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float smoothSmearNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = stableSmearNoise(cell);
  float b = stableSmearNoise(cell + vec2(1.0, 0.0));
  float c = stableSmearNoise(cell + vec2(0.0, 1.0));
  float d = stableSmearNoise(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

float dotPattern(vec2 uv, float density, float luma) {
  vec2 grid = uv * density;
  vec2 cell = fract(grid) - 0.5;
  float radius = mix(0.42, 0.10, clamp(luma, 0.0, 1.0));
  float radius2 = radius * radius;
  float outer = radius + 0.035;
  return 1.0 - smoothstep(radius2, outer * outer, dot(cell, cell));
}

vec4 runEffect(vec2 uv, vec4 color) {
  if (amount <= 0.0001) return color;
  float totalLocal = cctvAmount + screenPrintAmount + dotMatrixAmount + receiptAmount + ditherAmount + smearAmount;
  if (totalLocal <= 0.0001) return color;
  float alpha = color.a;
  vec3 straight = alpha > 0.0001 ? color.rgb / alpha : vec3(0.0);
  float luma = dot(straight, vec3(0.299, 0.587, 0.114));
  float noiseFrame = seed + (seedMode < 0.5 ? floor(time * 18.0) : 0.0);
  float density = mix(90.0, 360.0, clamp(scale, 0.25, 4.0) / 4.0);
  float line = fract(uv.y * resolution.y * mix(0.45, 1.35, scale));
  float grain = smoothSmearNoise(uv * resolution * mix(0.45, 1.8, scale) + noiseFrame) - 0.5;
  vec3 effected = straight;

  if (cctvAmount > 0.001) {
    float localAmount = amount * cctvAmount;
    float scan = smoothstep(0.52, 1.0, line) * 0.22;
    vec3 smearTap = sampleSource(clamp(uv - vec2((grain + 0.5) * localAmount * 0.018, 0.0), vec2(0.0), vec2(1.0))).rgb;
    effected = mix(effected, smearTap + grain * 0.10 - scan, localAmount);
  }
  if (screenPrintAmount > 0.001) {
    float localAmount = amount * screenPrintAmount;
    float dots = dotPattern(uv, density * 0.42, luma);
    vec3 ink = mix(vec3(0.08), effected, dots);
    effected = mix(effected, ink + grain * 0.06, localAmount);
  }
  if (dotMatrixAmount > 0.001) {
    float localAmount = amount * dotMatrixAmount;
    vec2 cellUv = (floor(uv * density * 0.32) + 0.5) / (density * 0.32);
    vec3 block = sampleSource(clamp(cellUv, vec2(0.0), vec2(1.0))).rgb;
    float dots = dotPattern(uv, density * 0.32, dot(block, vec3(0.299, 0.587, 0.114)));
    effected = mix(effected, block * dots, localAmount);
  }
  if (receiptAmount > 0.001) {
    float localAmount = amount * receiptAmount;
    float threshold = stableSmearNoise(floor(uv * resolution * 0.72) + noiseFrame);
    float ink = step(threshold, luma + grain * 0.25);
    float receiptLine = 1.0 - step(0.88, line) * 0.28;
    effected = mix(effected, vec3(ink * receiptLine), localAmount);
  }
  if (ditherAmount > 0.001) {
    float localAmount = amount * ditherAmount;
    float dither = smoothSmearNoise(uv * resolution * mix(0.55, 1.7, scale) + noiseFrame);
    float levels = floor((luma + (dither - 0.5) * localAmount * 0.65) * 5.0) / 4.0;
    effected = mix(effected, vec3(clamp(levels, 0.0, 1.0)), localAmount);
  }
  if (smearAmount > 0.001) {
    float localAmount = amount * smearAmount;
    float offset = localAmount * mix(0.004, 0.035, scale / 4.0);
    vec3 smearA = sampleSource(clamp(uv - vec2(offset, 0.0), vec2(0.0), vec2(1.0))).rgb;
    vec3 smearB = sampleSource(clamp(uv - vec2(offset * 2.1, 0.0), vec2(0.0), vec2(1.0))).rgb;
    effected = mix(effected, effected * 0.55 + smearA * 0.30 + smearB * 0.15 + grain * 0.08, localAmount);
  }

  effected = clamp(effected, 0.0, 1.0);
  return vec4(effected * alpha, alpha);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
