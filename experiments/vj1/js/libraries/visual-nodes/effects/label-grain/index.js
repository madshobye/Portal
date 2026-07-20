import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "labelGrain",
    name: "Label Grain",
    category: "texture",
    runtime: animatedSeedRuntime({ fps: 24 }),
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      ...noiseSeedParams(23),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float noiseFrame = seed + (seedMode < 0.5 ? floor(time * 24.0) : 0.0);
  float fine = cachedNoise(uv * vec2(16000.0, 12000.0) + noiseFrame);
  float rough = cachedNoise(uv * vec2(1700.0, 2100.0) + vec2(19.0, 73.0 + noiseFrame * 0.37));
  float grain = ((fine - 0.5) * 0.75 + (rough - 0.5) * 0.55) * mix(0.08, 0.55, amount);
  float scanline = step(0.82, fract(uv.y * 900.0)) * mix(0.02, 0.22, amount);
  float alpha = color.a;
  vec3 straight = alpha > 0.0001 ? color.rgb / alpha : vec3(0.0);
  vec3 nextColor = straight + vec3(grain) - vec3(scanline);
  return vec4(clamp(nextColor, 0.0, 1.0) * alpha, alpha);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
