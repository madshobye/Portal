import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
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
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
