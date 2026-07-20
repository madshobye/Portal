import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "gray",
    name: "Gray",
    category: "filter",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float alpha = color.a;
  vec3 straight = alpha > 0.0001 ? color.rgb / alpha : vec3(0.0);
  float gray = dot(straight, vec3(0.2126, 0.7152, 0.0722));
  return vec4(mix(straight, vec3(gray), amount) * alpha, alpha);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
