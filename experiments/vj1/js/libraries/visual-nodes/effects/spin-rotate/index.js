import { createNumberParam } from "../../shared/component-schema.js";
import {
  createPeriodicAnimationParam,
  FULL_TURN_RADIANS,
} from "../../shared/periodic-animation-parameter.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "spinRotate",
    name: "Spin Rotate",
    category: "geometry",
    spatial: true,
    transformSource: false,
    params: [
      createNumberParam("amount", "Amount", {
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: 0.35,
        suggestedAnimations: [{
          id: "pulse",
          label: "Pulse amount",
          mode: "ping-pong",
          from: 0,
          to: 0.7,
          duration: 2,
          curve: "sine-in-out",
        }],
      }),
      createNumberParam("turns", "Turns", { min: -2, max: 2, step: 0.01, defaultValue: 0.25 }),
      createPeriodicAnimationParam("phase", "Rotation phase", {
        duration: FULL_TURN_RADIANS / 0.2,
        animationLabel: "Continuous rotation",
        legacyRate: {
          parameterId: "speed",
          defaultValue: 0.2,
          unitsPerSecond: 1,
          skipWhenZero: true,
        },
      }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 p = (localUv - 0.5) * aspect;
  float angle = amount * turns * 6.28318530718 + phase;
  float c = cos(angle);
  float s = sin(angle);
  vec2 rotated = (vec2(c * p.x - s * p.y, s * p.x + c * p.y) / aspect) + 0.5;
  return mix(color, sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(rotated))), field);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
