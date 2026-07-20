import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "labelThresholdGrain",
    name: "Grain Threshold",
    category: "key",
    runtime: animatedSeedRuntime({ fps: 24 }),
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      ...noiseSeedParams(37),
    ],
    code: `
float fastThresholdGrain(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float smoothThresholdGrain(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = fastThresholdGrain(cell);
  float b = fastThresholdGrain(cell + vec2(1.0, 0.0));
  float c = fastThresholdGrain(cell + vec2(0.0, 1.0));
  float d = fastThresholdGrain(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

vec4 runEffect(vec2 uv, vec4 color) {
  float alpha = color.a;
  vec3 straight = alpha > 0.0001 ? color.rgb / alpha : vec3(0.0);
  vec2 grainCoord = uv * resolution * mix(0.9, 1.8, amount);
  float noiseFrame = seed + (seedMode < 0.5 ? floor(time * 24.0) : 0.0);
  float grain = smoothThresholdGrain(grainCoord + noiseFrame) - 0.5;
  float luma = dot(straight, vec3(0.299, 0.587, 0.114)) + grain * mix(0.35, 1.05, amount);
  float threshold = mix(0.28, 0.74, amount);
  float ink = step(threshold, luma);
  float scanline = step(0.82, fract(uv.y * 900.0)) * 0.2;
  return vec4(vec3(clamp(ink - scanline, 0.0, 1.0)) * alpha, alpha);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
