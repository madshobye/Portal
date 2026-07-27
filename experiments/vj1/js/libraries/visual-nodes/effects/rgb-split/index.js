import { createNumberParam } from "../../shared/component-schema.js";
import {
  createPeriodicAnimationParam,
  FULL_TURN_RADIANS,
} from "../../shared/periodic-animation-parameter.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "rgbSplit",
    name: "RGB Split",
    category: "color",
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      createNumberParam("angle", "Angle", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createPeriodicAnimationParam("phase", "Motion phase", {
        duration: FULL_TURN_RADIANS / 1.7,
        animationLabel: "Continuous orbit",
        legacyRate: {
          parameterId: "motion",
          defaultValue: 1,
          unitsPerSecond: 1.7,
          skipWhenZero: true,
        },
      }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float a = angle + phase;
  vec2 dir = vec2(cos(a), sin(a)) * amount * 0.035;
  float r = sampleSource(uv + dir).r;
  float g = color.g;
  float b = sampleSource(uv - dir).b;
  return vec4(r, g, b, color.a);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
