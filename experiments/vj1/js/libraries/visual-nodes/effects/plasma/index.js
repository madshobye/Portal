import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "plasma",
    name: "Plasma Tint",
    category: "color",
    spatial: true,
    transformSource: false,
    runtime: {
      timeDependent: (params = {}) => params.motionMode !== "steady" && (
        Math.abs(Number(params.speed) || 0) > 0.0001 ||
        Math.abs(Number(params.colorSpeed) || 0) > 0.0001
      ),
    },
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.65 }),
      createEnumParam("motionMode", "Motion", ["steady", "drift", "orbit", "turbulence"], "drift"),
      createNumberParam("speed", "Motion speed", { min: 0, max: 4, step: 0.01, defaultValue: 0.65 }),
      createNumberParam("direction", "Direction", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0.65 }),
      createNumberParam("frequency", "Cell scale", { min: 1, max: 24, step: 0.01, defaultValue: 8 }),
      createNumberParam("complexity", "Complexity", { min: 0, max: 1, step: 0.01, defaultValue: 0.7 }),
      createNumberParam("distortion", "Distortion", { min: 0, max: 2, step: 0.01, defaultValue: 0.55 }),
      createNumberParam("colorSpeed", "Color motion", { min: -2, max: 2, step: 0.01, defaultValue: 0.22 }),
      createNumberParam("hueShift", "Hue shift", { min: 0, max: 1, step: 0.001, defaultValue: 0 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 p = (localUv - 0.5) * vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  float clock = motionMode < 0.5 ? 0.0 : time * speed;
  vec2 heading = vec2(cos(direction), sin(direction));
  if (motionMode > 0.5 && motionMode < 1.5) {
    p += heading * clock * 0.18;
  } else if (motionMode >= 1.5 && motionMode < 2.5) {
    float angle = clock * 0.22;
    p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p;
  } else if (motionMode >= 2.5) {
    p += distortion * 0.11 * vec2(sin(clock * 0.71 + p.y * 3.0), cos(clock * 0.53 + p.x * 3.4));
  }
  p *= frequency;
  float v = sin(p.x + clock * 0.9) + sin(p.y - clock * 0.7);
  v += complexity * sin((p.x + p.y) * 0.73 + clock * 0.55);
  v += complexity * sin(length(p + distortion * vec2(sin(clock), cos(clock))) * 1.17 - clock);
  v *= 0.25;
  float phase = v + hueShift + (motionMode < 0.5 ? 0.0 : time * colorSpeed * 0.08);
  vec3 plasma = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.333, 0.667) + phase));
  float alpha = color.a;
  vec3 straight = alpha > 0.0001 ? color.rgb / alpha : vec3(0.0);
  vec4 tinted = vec4(mix(straight, plasma, amount) * alpha, alpha);
  return mix(color, tinted, field);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
