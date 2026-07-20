import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "gradient",
    name: "Gradient",
    category: "color",
    params: [
      createEnumParam("mode", "Mode", ["linear", "radial", "single"], "linear"),
      createNumberParam("colorCount", "Colors", { min: 2, max: 4, step: 1, defaultValue: 2 }),
      createNumberParam("angle", "Angle", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("offset", "Offset", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("softness", "Softness", { min: 0.1, max: 2, step: 0.01, defaultValue: 1 }),
      createColorParam("colorA", "Color 1", "#ff4f92ff"),
      createColorParam("colorB", "Color 2", "#4ee3e5ff"),
      createColorParam("colorC", "Color 3", "#ffe45eff"),
      createColorParam("colorD", "Color 4", "#00000000"),
    ],
  });

const shader = Object.freeze({
    id: "generator.gradient",
    name: "Gradient Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform float mode;
uniform float colorCount;
uniform float angle;
uniform float offset;
uniform float softness;
uniform vec4 colorA;
uniform vec4 colorB;
uniform vec4 colorC;
uniform vec4 colorD;
varying vec2 vTexCoord;

vec4 mixPremul(vec4 a, vec4 b, float t) {
  vec4 pa = vec4(a.rgb * a.a, a.a);
  vec4 pb = vec4(b.rgb * b.a, b.a);
  vec4 mixedColor = mix(pa, pb, clamp(t, 0.0, 1.0));
  vec3 rgb = mixedColor.a > 0.0001 ? mixedColor.rgb / mixedColor.a : vec3(0.0);
  return vec4(rgb, mixedColor.a);
}

void main() {
  if (mode > 1.5) {
    gl_FragColor = vec4(colorA.rgb * colorA.a, colorA.a);
    return;
  }

  vec2 uv = vTexCoord - 0.5;
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  uv *= aspect;
  float t = 0.0;
  if (mode > 0.5) {
    float maxRadius = max(length(vec2(0.5 * aspect.x, 0.5)), 0.0001);
    t = length(uv) / maxRadius + offset;
  } else {
    vec2 dir = vec2(cos(angle), sin(angle));
    float span = max(abs(dir.x) * aspect.x + abs(dir.y), 0.0001);
    t = dot(uv, dir) / span + 0.5 + offset;
  }
  t = clamp(t, 0.0, 1.0);
  float shaped = pow(t, max(0.05, softness));
  float count = floor(clamp(colorCount + 0.5, 2.0, 4.0));

  vec4 result = mixPremul(colorA, colorB, shaped);
  if (count > 2.5) {
    float segment = shaped * (count - 1.0);
    vec4 first = mixPremul(colorA, colorB, smoothstep(0.0, 1.0, segment));
    vec4 second = mixPremul(colorB, colorC, smoothstep(1.0, 2.0, segment));
    result = segment < 1.0 ? first : second;
    if (count > 3.5) {
      vec4 third = mixPremul(colorC, colorD, smoothstep(2.0, 3.0, segment));
      result = segment < 2.0 ? result : third;
    }
  }

  gl_FragColor = vec4(result.rgb * result.a, result.a);
}`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
