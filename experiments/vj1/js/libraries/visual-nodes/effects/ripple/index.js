import { createNumberParam } from "../../shared/component-schema.js";
import {
  createPeriodicAnimationParam,
  FULL_TURN_RADIANS,
} from "../../shared/periodic-animation-parameter.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "ripple",
    name: "Ripple",
    category: "warp",
    spatial: true,
    transformSource: false,
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      createPeriodicAnimationParam("phase", "Wave phase", {
        duration: FULL_TURN_RADIANS / 4.5,
        animationLabel: "Continuous ripple",
      }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 p = localUv - 0.5;
  float d = length(p);
  float wave = sin(d * 48.0 - phase) * 0.012 * amount;
  vec2 warped = inverseTransformEffectUv(localUv + normalize(p + 0.0001) * wave);
  return mix(color, sampleSource(textureUvFromEffectScreenUv(warped)), field);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
