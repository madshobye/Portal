import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "alphaFeather",
    name: "Alpha Feather",
    category: "key",
    runtime: {
      roi: {
        mode: "neighborhood",
        halo: 64,
        coordinateSpace: "boundary",
        pixelEquivalentToFullFrame: true,
      },
    },
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("cut", "Cut edge", { min: 0, max: 32, step: 0.25, defaultValue: 1 }),
      createNumberParam("feather", "Feather", { min: 0, max: 32, step: 0.25, defaultValue: 3 }),
    ],
    code: `
float erodedAlpha8(vec2 uv, float radiusPixels) {
  vec2 px = radiusPixels / max(resolution, vec2(1.0));
  float alpha = sampleSource(uv).a;
  alpha = min(alpha, sampleSource(uv + px * vec2( 1.0,  0.0)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2(-1.0,  0.0)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2( 0.0,  1.0)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2( 0.0, -1.0)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2( 0.70710678,  0.70710678)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2(-0.70710678,  0.70710678)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2( 0.70710678, -0.70710678)).a);
  alpha = min(alpha, sampleSource(uv + px * vec2(-0.70710678, -0.70710678)).a);
  return alpha;
}

vec4 runEffect(vec2 uv, vec4 color) {
  float cutRadius = max(0.0, cut);
  float featherRadius = max(0.0, feather);
  float innerAlpha = cutRadius > 0.001 ? erodedAlpha8(uv, cutRadius) : color.a;
  float featheredAlpha = innerAlpha;
  if (featherRadius > 0.001) {
    float middleAlpha = erodedAlpha8(uv, cutRadius + featherRadius * 0.5);
    float outerAlpha = erodedAlpha8(uv, cutRadius + featherRadius);
    featheredAlpha = (innerAlpha + 2.0 * middleAlpha + outerAlpha) * 0.25;
  }
  float outputAlpha = mix(color.a, featheredAlpha, amount);
  float alphaScale = color.a > 0.00001 ? outputAlpha / color.a : 0.0;
  return vec4(color.rgb * alphaScale, outputAlpha);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
