import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "spinRotate",
    name: "Spin Rotate",
    category: "geometry",
    spatial: true,
    transformSource: false,
    runtime: {
      timeDependent: (params = {}) => Math.abs(Number(params.speed) || 0) > 0.0001,
    },
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
      createNumberParam("speed", "Speed", { min: -3, max: 3, step: 0.01, defaultValue: 0.2 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 p = (localUv - 0.5) * aspect;
  float angle = amount * turns * 6.28318530718 + time * speed;
  float c = cos(angle);
  float s = sin(angle);
  vec2 rotated = (vec2(c * p.x - s * p.y, s * p.x + c * p.y) / aspect) + 0.5;
  return mix(color, sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(rotated))), field);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
