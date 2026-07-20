import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "brokenFluorescent",
    name: "Broken Fluorescent",
    category: "motion",
    runtime: animatedSeedRuntime({
      active: (params = {}) => (
        (Number(params.flicker) || 0) > 0.0001 &&
        Math.abs(Number(params.speed) || 0) > 0.0001
      ),
    }),
    primaryParamIds: ["amount", "brightness", "glow", "flicker", "speed", "threshold"],
    detailParamIds: ["glowSize", "noiseScale", "tubeColor", "seedMode", "renderQuality"],
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("brightness", "Brightness", { min: 0.25, max: 6, step: 0.01, defaultValue: 2.4, scale: "log" }),
      createNumberParam("glow", "Glow", { min: 0, max: 3, step: 0.01, defaultValue: 1.15 }),
      createNumberParam("flicker", "Flicker", { min: 0, max: 1, step: 0.01, defaultValue: 0.78 }),
      createNumberParam("speed", "Flicker speed", { min: 0, max: 12, step: 0.01, defaultValue: 3.2 }),
      createNumberParam("threshold", "Break threshold", { min: 0, max: 1, step: 0.01, defaultValue: 0.48 }),
      createNumberParam("glowSize", "Glow size", { min: 0, max: 48, step: 0.1, defaultValue: 12 }),
      createNumberParam("noiseScale", "Noise scale", { min: 0.25, max: 40, step: 0.01, defaultValue: 7 }),
      createColorParam("tubeColor", "Tube color", "#d9fff2ff"),
      ...noiseSeedParams(83),
    ],
    code: `
vec3 fluorescentMod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 fluorescentMod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 fluorescentPermute(vec3 x) {
  return fluorescentMod289(((x * 34.0) + 1.0) * x);
}

float fluorescentSimplex(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
   -0.577350269189626,
    0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = x0.x > x0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = fluorescentMod289(i);
  vec3 p = fluorescentPermute(
    fluorescentPermute(i.y + vec3(0.0, i1.y, 1.0)) +
    i.x + vec3(0.0, i1.x, 1.0)
  );
  vec3 m = max(
    0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)),
    0.0
  );
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fluorescentEnergy(vec4 sampleColor) {
  float alpha = sampleColor.a;
  vec3 straight = alpha > 0.0001 ? sampleColor.rgb / alpha : vec3(0.0);
  return dot(max(straight, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722)) * alpha;
}

vec4 runEffect(vec2 uv, vec4 color) {
  if (amount <= 0.0001) return color;

  float seedValue = seed * 0.071;
  float clock = seedMode < 0.5 ? time * speed : seed * 0.131;
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 noiseUv = (uv - 0.5) * aspect * noiseScale;
  float localNoise = 0.5 + 0.5 * fluorescentSimplex(
    noiseUv + vec2(seedValue + clock * 0.19, -seedValue + clock * 0.31)
  );
  float segmentNoise = 0.5 + 0.5 * fluorescentSimplex(
    vec2(noiseUv.x * 0.37 + seedValue * 1.7, clock * 0.43 + floor(noiseUv.y * 2.0))
  );
  float powerNoise = 0.5 + 0.5 * fluorescentSimplex(vec2(clock * 0.23, seedValue + 19.7));
  float edge = 0.045;
  float localPower = smoothstep(threshold - edge, threshold + edge, mix(localNoise, segmentNoise, 0.45));
  float supplyPower = mix(0.18, 1.0, smoothstep(threshold - 0.12, threshold + 0.08, powerNoise));
  float drive = mix(1.0, localPower * supplyPower, flicker);

  float baseEnergy = fluorescentEnergy(color);
  vec2 texel = 1.0 / max(resolution, vec2(1.0));
  vec2 radius = texel * glowSize;
  float halo = 0.0;
  halo += fluorescentEnergy(sampleSource(uv + vec2(radius.x, 0.0)));
  halo += fluorescentEnergy(sampleSource(uv - vec2(radius.x, 0.0)));
  halo += fluorescentEnergy(sampleSource(uv + vec2(0.0, radius.y)));
  halo += fluorescentEnergy(sampleSource(uv - vec2(0.0, radius.y)));
  halo *= 0.25;
  if (renderQuality > 0.55 && glowSize > 0.01) {
    vec2 diagonal = radius * 0.70710678;
    float diagonalHalo = 0.0;
    diagonalHalo += fluorescentEnergy(sampleSource(uv + diagonal));
    diagonalHalo += fluorescentEnergy(sampleSource(uv - diagonal));
    diagonalHalo += fluorescentEnergy(sampleSource(uv + vec2(diagonal.x, -diagonal.y)));
    diagonalHalo += fluorescentEnergy(sampleSource(uv + vec2(-diagonal.x, diagonal.y)));
    halo = mix(halo, diagonalHalo * 0.25, 0.45);
  }

  vec3 tint = tubeColor.rgb;
  vec3 hotCore = mix(tint, vec3(1.0), clamp(baseEnergy * 1.7, 0.0, 1.0) * 0.72);
  float corePower = baseEnergy * drive * brightness;
  float haloPower = halo * drive * glow;
  vec3 litRgb = hotCore * corePower + tint * haloPower;
  float litAlpha = clamp(max(color.a * drive, haloPower * tubeColor.a * 0.52), 0.0, 1.0);
  vec4 lit = vec4(litRgb, litAlpha);
  return mix(color, lit, amount);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
