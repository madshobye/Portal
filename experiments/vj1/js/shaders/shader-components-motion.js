import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../graph/component-schema.js?v=adaptive-component-demand-29";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "./shader-component-common.js?v=shader-component-catalog-extraction-1";

export const MOTION_SHADER_COMPONENTS = Object.freeze({
  alphaVignette: {
    id: "alphaVignette",
    name: "Alpha Vignette",
    category: "key",
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.55 }),
      createNumberParam("radius", "Radius", { min: 0.1, max: 1.2, step: 0.01, defaultValue: 0.78 }),
      createNumberParam("softness", "Softness", { min: 0.02, max: 0.8, step: 0.01, defaultValue: 0.28 }),
      createNumberParam("cornerRound", "Corner round", { min: 0, max: 0.8, step: 0.01, defaultValue: 0.18 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 p = (uv - 0.5) * 2.0;
  float corner = min(max(cornerRound, 0.0), max(radius - 0.001, 0.0));
  vec2 q = abs(p) - vec2(max(radius - corner, 0.001));
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
  float matte = 1.0 - smoothstep(-softness, softness, d);
  float alpha = color.a * mix(1.0, matte, amount);
  return vec4(color.rgb * (alpha / max(color.a, 0.0001)), alpha);
}`,
  },
  glitchDistort: {
    id: "glitchDistort",
    name: "Glitch Distort",
    category: "warp",
    spatial: true,
    transformSource: false,
    runtime: animatedSeedRuntime(),
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.45 }),
      createNumberParam("blocks", "Blocks", { min: 4, max: 80, step: 1, defaultValue: 24 }),
      createNumberParam("colorSplit", "Color Split", { min: 0, max: 1, step: 0.01, defaultValue: 0.42 }),
      ...noiseSeedParams(51),
    ],
    code: `
float smoothGlitchNoise(float coordinate, float frame) {
  float cell = floor(coordinate);
  float local = fract(coordinate);
  float blend = local * local * (3.0 - 2.0 * local);
  return mix(hash(vec2(cell, frame)), hash(vec2(cell + 1.0, frame)), blend);
}

vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  float noiseClock = seedMode < 0.5 ? time : seed;
  float noiseFrame = seed + (seedMode < 0.5 ? floor(time * 18.0) : 0.0);
  float rowCoord = localUv.y * blocks;
  float rowNoise = smoothGlitchNoise(rowCoord, noiseFrame);
  float burst = smoothstep(0.52, 0.66, rowNoise) * rowNoise;
  float jitter = (smoothGlitchNoise(rowCoord * 13.7, noiseFrame * 0.5) - 0.5) * amount * 0.17 * burst;
  float tear = (hash(vec2(floor(localUv.y * 9.0), noiseFrame * 0.17)) - 0.5) * amount * 0.045;
  vec2 warped = localUv + vec2(jitter + tear, sin(localUv.y * 80.0 + noiseClock * 12.0) * amount * 0.0025);
  float scan = step(0.985 - amount * 0.18, fract(localUv.y * resolution.y * 0.5 + noiseClock * 20.0));
  vec2 split = vec2((0.002 + 0.018 * amount) * colorSplit, 0.0);
  vec4 r = sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(warped + split)));
  vec4 g = sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(warped)));
  vec4 b = sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(warped - split)));
  vec4 mixedColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
  mixedColor.rgb += scan * vec3(0.24, 0.08, 0.18) * mixedColor.a;
  return mix(color, mixedColor, amount * field);
}`,
  },
  spinRotate: {
    id: "spinRotate",
    name: "Spin Rotate",
    category: "geometry",
    spatial: true,
    transformSource: false,
    runtime: {
      timeDependent: (params = {}) => Math.abs(Number(params.speed) || 0) > 0.0001,
    },
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      createNumberParam("turns", "Turns", { min: -2, max: 2, step: 0.01, defaultValue: 0.25 }),
      createNumberParam("speed", "Speed", { min: -3, max: 3, step: 0.01, defaultValue: 0.2 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 p = (localUv - 0.5) * aspect;
  float angle = amount * turns * 6.28318530718 + time * speed;
  float c = cos(angle);
  float s = sin(angle);
  vec2 rotated = (vec2(c * p.x - s * p.y, s * p.x + c * p.y) / aspect) + 0.5;
  return mix(color, sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(rotated))), field);
}`,
  },
  flip: {
    id: "flip",
    name: "Flip",
    category: "geometry",
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createBooleanParam("flipX", "Flip X", true),
      createBooleanParam("flipY", "Flip Y", false),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 flippedUv = vec2(
    flipX ? 1.0 - uv.x : uv.x,
    flipY ? 1.0 - uv.y : uv.y
  );
  vec4 flipped = sampleSource(flippedUv);
  return mix(color, flipped, amount);
}`,
  },
  echoFade: {
    id: "echoFade",
    name: "Echo Fade",
    category: "motion",
    spatial: true,
    transformSource: false,
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.42 }),
      createNumberParam("distance", "Distance", { min: 0, max: 0.35, step: 0.01, defaultValue: 0.12 }),
      createNumberParam("twist", "Twist", { min: -1, max: 1, step: 0.01, defaultValue: 0.18 }),
    ],
    code: `
vec2 rotateAroundCenter(vec2 uv, float angle, float scale) {
  vec2 p = (uv - 0.5) / max(scale, 0.001);
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
}

vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 dir = normalize(vec2(cos(time * 0.33), sin(time * 0.27)) + vec2(0.01));
  vec4 sum = color * 0.46;
  float total = 0.46;
  for (int i = 1; i <= 5; i++) {
    float f = float(i) / 5.0;
    vec2 shifted = rotateAroundCenter(localUv - dir * distance * f * amount, twist * amount * f, 1.0 + amount * 0.035 * f);
    float tapField = effectFieldMask(shifted);
    float weight = pow(1.0 - f, 1.65) * 0.42 * tapField;
    vec4 tap = sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(shifted)));
    sum += tap * weight;
    total += weight;
  }
  vec4 echoed = sum / max(total, 0.0001);
  return mix(color, echoed, amount * field);
}`,
  },
  mirrorFold: {
    id: "mirrorFold",
    name: "Mirror Fold",
    category: "geometry",
    spatial: true,
    transformSource: false,
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.55 }),
      createNumberParam("folds", "Folds", { min: 2, max: 12, step: 1, defaultValue: 6 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 p = localUv - 0.5;
  float radius = length(p);
  float angle = atan(p.y, p.x) + time * amount * 0.25;
  float sector = 6.28318530718 / max(2.0, folds);
  angle = mod(angle, sector);
  angle = abs(angle - sector * 0.5);
  vec2 folded = 0.5 + vec2(cos(angle), sin(angle)) * radius;
  return mix(color, sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(folded))), amount * field);
}`,
  },
  heatShimmer: {
    id: "heatShimmer",
    name: "Heat Shimmer",
    category: "warp",
    spatial: true,
    transformSource: false,
    runtime: animatedSeedRuntime(),
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.34 }),
      createNumberParam("frequency", "Frequency", { min: 2, max: 48, step: 1, defaultValue: 18 }),
      ...noiseSeedParams(67),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  float shimmerTime = seedMode < 0.5 ? time : 0.0;
  float phase = seed * 0.071;
  float waveA = sin(localUv.y * frequency + shimmerTime * 4.1 + phase);
  float waveB = sin((localUv.y + localUv.x * 0.35) * frequency * 0.62 - shimmerTime * 2.7 + phase * 1.7);
  float waveC = cos((localUv.x - localUv.y * 0.22) * frequency * 0.48 + shimmerTime * 1.9 + phase * 2.3);
  vec2 wave = vec2(
    waveA * 0.62 + waveB * 0.28,
    waveC * 0.22 + waveB * 0.10
  );
  vec2 warped = localUv + wave * amount * 0.018;
  return mix(color, sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(warped))), field);
}`,
  },
  heartbeatPulse: {
    id: "heartbeatPulse",
    name: "Heartbeat Pulse",
    category: "warp",
    spatial: true,
    transformSource: false,
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.45 }),
      createNumberParam("rate", "Rate", { min: 0.2, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("ringWidth", "Ring width", { min: 0.04, max: 0.45, step: 0.01, defaultValue: 0.18 }),
      createNumberParam("spread", "Spread", { min: 0.4, max: 2.2, step: 0.01, defaultValue: 1 }),
    ],
    code: `
float beatImpulse(float beatTime, float center, float width, float strength) {
  float d = abs(beatTime - center);
  return exp(-(d * d) / max(width * width, 0.0001)) * strength;
}

vec4 runEffect(vec2 uv, vec4 color) {
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 screenUv = effectScreenUv();
  vec2 center = vec2(0.5) + effectTransform.xy * 0.5;
  float fieldScale = max(effectTransform.z, 0.0001);
  vec2 p = (screenUv - center) * aspect / fieldScale;
  float radius = length(p);
  vec2 dir = radius > 0.0001 ? p / radius : vec2(0.0);

  float cycleDuration = 1.0 / max(rate, 0.001);
  float beatTime = mod(time, cycleDuration);
  float beat = beatImpulse(beatTime, 0.08, 0.035, 1.0) +
    beatImpulse(beatTime, 0.27, 0.050, 0.62);
  float after = exp(-beatTime * 3.2) * 0.18;
  float pulse = beat + after;

  float ringPhase = radius * mix(3.2, 1.05, clamp(spread, 0.0, 2.2) / 2.2) - beatTime * 1.75;
  float ring = exp(-(ringPhase * ringPhase) / max(ringWidth * ringWidth, 0.0001));
  if (renderQuality > 0.65) {
    float detailPhase = ringPhase * 1.8 + beatTime * 2.4;
    ring += exp(-(detailPhase * detailPhase) / max(ringWidth * ringWidth * 0.55, 0.0001))
      * mix(0.0, 0.28, (renderQuality - 0.65) / 0.35);
  }
  float falloff = smoothstep(1.35, 0.02, radius);
  float displacement = amount * pulse * ring * falloff * 0.055;
  vec2 warped = screenUv + (dir * displacement * fieldScale) / aspect;
  return sampleSource(textureUvFromEffectScreenUv(warped));
}`,
  },
  custom: {
    id: "custom",
    name: "Custom",
    category: "user",
    runtime: ALWAYS_TIME_RUNTIME,
    defaultAmount: 0.5,
    code: null,
  },
});
