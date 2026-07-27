import { createNumberParam } from "../../shared/component-schema.js";
import {
  createPeriodicAnimationParam,
  FULL_TURN_RADIANS,
} from "../../shared/periodic-animation-parameter.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "mirrorFold",
    name: "Mirror Fold",
    category: "geometry",
    spatial: true,
    transformSource: false,
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.55 }),
      createNumberParam("folds", "Folds", { min: 2, max: 12, step: 1, defaultValue: 6 }),
      createPeriodicAnimationParam("phase", "Rotation phase", {
        duration: FULL_TURN_RADIANS / (0.55 * 0.25),
        animationLabel: "Continuous fold rotation",
        legacyRate: {
          parameterId: "amount",
          defaultValue: 0.55,
          unitsPerSecond: 0.25,
          skipWhenZero: true,
        },
      }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 p = localUv - 0.5;
  float radius = length(p);
  float angle = atan(p.y, p.x) + phase;
  float sector = 6.28318530718 / max(2.0, folds);
  angle = mod(angle, sector);
  angle = abs(angle - sector * 0.5);
  vec2 folded = 0.5 + vec2(cos(angle), sin(angle)) * radius;
  return mix(color, sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(folded))), amount * field);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
