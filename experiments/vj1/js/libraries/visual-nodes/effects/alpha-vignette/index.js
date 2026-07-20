import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "alphaVignette",
    name: "Alpha Vignette",
    category: "key",
    spatial: true,
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.55 }),
      createNumberParam("radius", "Radius", { min: 0.1, max: 1.2, step: 0.01, defaultValue: 0.78 }),
      createNumberParam("softness", "Softness", { min: 0.02, max: 0.8, step: 0.01, defaultValue: 0.28 }),
      createNumberParam("cornerRound", "Corner round", { min: 0, max: 0.8, step: 0.01, defaultValue: 0.18 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 p = (localUv - 0.5) * 2.0;
  float corner = min(max(cornerRound, 0.0), max(radius - 0.001, 0.0));
  vec2 q = abs(p) - vec2(max(radius - corner, 0.001));
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
  float matte = 1.0 - smoothstep(-softness, softness, d);
  float alpha = color.a * mix(1.0, matte, amount);
  vec4 vignette = vec4(color.rgb * (alpha / max(color.a, 0.0001)), alpha);
  return mix(color, vignette, field);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
