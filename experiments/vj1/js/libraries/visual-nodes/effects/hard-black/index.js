import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "hardBlack",
    name: "Hard Black",
    category: "key",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  float threshold = mix(0.34, 0.82, amount);
  float ink = step(threshold, luma);
  return vec4(vec3(ink) * color.a, color.a);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
