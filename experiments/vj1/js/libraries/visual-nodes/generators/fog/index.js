import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "fog",
    name: "Fog",
    category: "atmosphere",
    runtime: {
      timeDependent: (params = {}) => params.motionMode !== "steady" && Math.abs(Number(params.speed) || 0) > 0.0001,
    },
    primaryParamIds: ["density", "coverage", "noisiness", "scale", "detail", "fromBelow", "fromAbove", "fogColor"],
    detailParamIds: ["motionMode", "speed", "billow", "variation", "falloff", "softness", "driftAngle", "seed", "amount"],
    params: [
      createEnumParam("motionMode", "Motion", ["steady", "drift", "billow"], "drift"),
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 0.35 }),
      createNumberParam("density", "Density", { min: 0, max: 2, step: 0.01, defaultValue: 0.9 }),
      createNumberParam("coverage", "Coverage", { min: 0, max: 1, step: 0.01, defaultValue: 0.58 }),
      createNumberParam("noisiness", "Noisiness", { min: 0, max: 1, step: 0.01, defaultValue: 0.72 }),
      createNumberParam("scale", "Scale", { min: 0.2, max: 16, step: 0.01, defaultValue: 2.8, scale: "log" }),
      createNumberParam("detail", "Detail", { min: 1, max: 5, step: 1, defaultValue: 4 }),
      createNumberParam("fromBelow", "Height from below", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("fromAbove", "Height from above", { min: 0, max: 1, step: 0.01, defaultValue: 0.08 }),
      createNumberParam("billow", "Billow", { min: 0, max: 1, step: 0.01, defaultValue: 0.55 }),
      createNumberParam("variation", "Bank variation", { min: 0, max: 1, step: 0.01, defaultValue: 0.58 }),
      createNumberParam("falloff", "Height falloff", { min: 0.05, max: 8, step: 0.01, defaultValue: 2, scale: "log" }),
      createNumberParam("softness", "Softness", { min: 0.005, max: 0.5, step: 0.005, defaultValue: 0.12, scale: "log" }),
      createNumberParam("driftAngle", "Drift angle", { min: -3.1416, max: 3.1416, step: 0.01, defaultValue: 0 }),
      createNumberParam("seed", "Seed", { min: 0, max: 1000, step: 1, defaultValue: 31 }),
      createColorParam("fogColor", "Fog color", "#d8e1e8cc"),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
  });

const shader = Object.freeze({
    id: "generator.fog",
    name: "Fog Generator",
    type: "shadertoy",
    code: `
/*
 * Adapted for transparent real-time layering from:
 * https://www.shadertoy.com/view/XtfSW4
 *
 * Simplex noise by Ian McEwan / Ashima Arts, distributed under the MIT
 * license: https://github.com/ashima/webgl-noise
 *
 * The original eight-octave opaque cloud pass is reduced to a quality-aware
 * maximum of five octaves and emits premultiplied alpha for VJ compositing.
 */

uniform float motionMode;
uniform float density;
uniform float coverage;
uniform float noisiness;
uniform float scale;
uniform float detail;
uniform float fromBelow;
uniform float fromAbove;
uniform float falloff;
uniform float softness;
uniform float driftAngle;
uniform float billow;
uniform float variation;
uniform float seed;
uniform float renderQuality;
uniform vec4 fogColor;
uniform float amount;

vec3 fogMod289(vec3 value) {
  return value - floor(value * (1.0 / 289.0)) * 289.0;
}

vec4 fogMod289(vec4 value) {
  return value - floor(value * (1.0 / 289.0)) * 289.0;
}

vec4 fogPermute(vec4 value) {
  return fogMod289(((value * 34.0) + 1.0) * value);
}

vec4 fogTaylorInvSqrt(vec4 value) {
  return 1.79284291400159 - 0.85373472095314 * value;
}

float fogSimplex3(vec3 point) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 cell = floor(point + dot(point, C.yyy));
  vec3 x0 = point - cell + dot(cell, C.xxx);
  vec3 order = step(x0.yzx, x0.xyz);
  vec3 inverseOrder = 1.0 - order;
  vec3 i1 = min(order.xyz, inverseOrder.zxy);
  vec3 i2 = max(order.xyz, inverseOrder.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  cell = fogMod289(cell);
  vec4 permutation = fogPermute(fogPermute(fogPermute(
    cell.z + vec4(0.0, i1.z, i2.z, 1.0))
    + cell.y + vec4(0.0, i1.y, i2.y, 1.0))
    + cell.x + vec4(0.0, i1.x, i2.x, 1.0));

  float seventh = 1.0 / 7.0;
  vec3 ns = seventh * D.wyz - D.xzx;
  vec4 j = permutation - 49.0 * floor(permutation * ns.z * ns.z);
  vec4 xGrid = floor(j * ns.z);
  vec4 yGrid = floor(j - 7.0 * xGrid);
  vec4 x = xGrid * ns.x + ns.yyyy;
  vec4 y = yGrid * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 normalization = fogTaylorInvSqrt(vec4(
    dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)
  ));
  p0 *= normalization.x;
  p1 *= normalization.y;
  p2 *= normalization.z;
  p3 *= normalization.w;
  vec4 influence = max(0.6 - vec4(
    dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)
  ), 0.0);
  influence *= influence;
  return 42.0 * dot(influence * influence, vec4(
    dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)
  ));
}

float fogFbm(vec3 point) {
  float sum = 0.0;
  float weight = 0.5;
  float normalization = 0.0;
  float octaveBudget = min(clamp(detail, 1.0, 5.0), mix(2.0, 5.0, clamp(renderQuality, 0.0, 1.0)));
  for (int octave = 0; octave < 5; octave++) {
    if (float(octave) < octaveBudget) {
      sum += fogSimplex3(point) * weight;
      normalization += weight;
    }
    point = point * 2.03 + vec3(13.1, 7.7, 5.3);
    weight *= 0.5;
  }
  return sum / max(normalization, 0.001);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  uv.y = 1.0 - uv.y;
  vec2 centered = uv - 0.5;
  centered.x *= iResolution.x / max(iResolution.y, 1.0);

  float animated = step(0.5, motionMode);
  float billowMode = step(1.5, motionMode);
  vec2 driftDirection = vec2(cos(driftAngle), sin(driftAngle));
  float clock = iTime * animated;
  vec2 drift = driftDirection * clock * 0.12;
  float billowAmount = max(clamp(billow, 0.0, 1.0), billowMode) * animated;
  float variationAmount = clamp(variation, 0.0, 1.0);
  float macroNoise = 0.5 + 0.5 * fogSimplex3(vec3(
    centered * max(scale * 0.22, 0.08) + drift * 0.16,
    seed * 0.013 + clock * 0.035
  ));
  float macroCentered = macroNoise - 0.5;
  vec2 billowWarp = vec2(macroCentered, -macroCentered) * billowAmount * 0.42;
  float depthDrift = clock * mix(0.035, 0.16, billowAmount);
  vec3 noisePoint = vec3(centered * max(scale, 0.01) + drift + billowWarp, seed * 0.071 + depthDrift);
  float noiseValue = 0.5 + 0.5 * fogFbm(noisePoint);

  float noiseMix = clamp(noisiness, 0.0, 1.0);
  float fogField = mix(1.0, noiseValue, noiseMix);
  float threshold = mix(0.92, 0.08, clamp(coverage + macroCentered * variationAmount * 0.42, 0.0, 1.0));
  float edge = max(softness, 0.001);
  float cloud = smoothstep(threshold - edge, threshold + edge, fogField);
  float bankMask = mix(1.0, smoothstep(0.2, 0.8, macroNoise), variationAmount);
  float displacedY = uv.y
    + (noiseValue - 0.5) * noisiness * 0.22
    + macroCentered * variationAmount * 0.24;
  float heightEdge = edge / max(falloff, 0.05);
  float lowerEdge = clamp(fromBelow, 0.0, 1.0);
  float upperEdge = clamp(1.0 - fromAbove, 0.0, 1.0);
  float lowerMask = smoothstep(lowerEdge - heightEdge, lowerEdge + heightEdge, displacedY);
  float upperMask = 1.0 - smoothstep(upperEdge - heightEdge, upperEdge + heightEdge, displacedY);
  float heightMask = lowerMask * upperMask;
  float densityVariation = mix(1.0, 0.35 + macroNoise * 1.15, variationAmount);
  float alpha = clamp(cloud * bankMask * heightMask * densityVariation * density * fogColor.a * amount, 0.0, 1.0);
  fragColor = vec4(fogColor.rgb * alpha, alpha);
}
`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
