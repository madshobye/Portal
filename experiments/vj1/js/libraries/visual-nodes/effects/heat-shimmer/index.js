import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
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
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
