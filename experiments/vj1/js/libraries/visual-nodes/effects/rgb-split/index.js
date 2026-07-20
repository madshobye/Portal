import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "rgbSplit",
    name: "RGB Split",
    category: "color",
    runtime: {
      timeDependent: (params = {}) => (Number(params.motion) || 0) > 0.0001,
    },
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      createNumberParam("angle", "Angle", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("motion", "Motion", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float a = angle + time * mix(0.0, 1.7, motion);
  vec2 dir = vec2(cos(a), sin(a)) * amount * 0.035;
  float r = sampleSource(uv + dir).r;
  float g = color.g;
  float b = sampleSource(uv - dir).b;
  return vec4(r, g, b, color.a);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
