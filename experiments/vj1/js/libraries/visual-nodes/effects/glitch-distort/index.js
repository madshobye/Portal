import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
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
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
