import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "threshold",
    name: "Threshold",
    category: "filter",
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.65 }),
      createNumberParam("cutoff", "Cutoff", { min: 0, max: 1, step: 0.01, defaultValue: 0.5 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec3 visibleRgb = color.a > 0.001 ? color.rgb / color.a : color.rgb;
  float gray = dot(visibleRgb, vec3(0.2126, 0.7152, 0.0722));
  float threshold = floor(cutoff * 255.0) / 255.0;
  float ink = step(threshold, gray);
  vec3 thresholdRgb = vec3(ink) * color.a;
  return vec4(mix(color.rgb, thresholdRgb, amount), color.a);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
