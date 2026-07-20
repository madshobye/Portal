import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "plasma",
    name: "Plasma",
    category: "color",
    runtime: {
      timeDependent: (params = {}) => params.motionMode !== "steady" && (
        Math.abs(Number(params.speed) || 0) > 0.0001 ||
        Math.abs(Number(params.colorSpeed) || 0) > 0.0001
      ),
    },
    params: [
      createEnumParam("motionMode", "Motion", ["steady", "drift", "orbit", "turbulence"], "drift"),
      createNumberParam("speed", "Motion speed", { min: 0, max: 4, step: 0.01, defaultValue: 0.65 }),
      createNumberParam("direction", "Direction", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0.65 }),
      createNumberParam("frequency", "Cell scale", { min: 1, max: 24, step: 0.01, defaultValue: 8 }),
      createNumberParam("complexity", "Complexity", { min: 0, max: 1, step: 0.01, defaultValue: 0.7 }),
      createNumberParam("distortion", "Distortion", { min: 0, max: 2, step: 0.01, defaultValue: 0.55 }),
      createNumberParam("colorSpeed", "Color motion", { min: -2, max: 2, step: 0.01, defaultValue: 0.22 }),
      createNumberParam("hueShift", "Hue shift", { min: 0, max: 1, step: 0.001, defaultValue: 0 }),
    ],
  });

const shader = Object.freeze({
    id: "generator.plasma",
    name: "Plasma Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform float motionMode;
uniform float speed;
uniform float direction;
uniform float frequency;
uniform float complexity;
uniform float distortion;
uniform float colorSpeed;
uniform float hueShift;
varying vec2 vTexCoord;

void main() {
  vec2 p = (vTexCoord - 0.5) * vec2(resolution.x / max(resolution.y, 1.0), 1.0);
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
  float q = sin(p.x + clock * 0.9) + sin(p.y - clock * 0.7);
  q += complexity * sin((p.x + p.y) * 0.73 + clock * 0.55);
  q += complexity * sin(length(p + distortion * vec2(sin(clock), cos(clock))) * 1.17 - clock);
  q *= 0.25;
  float phase = q + hueShift + (motionMode < 0.5 ? 0.0 : time * colorSpeed * 0.08);
  vec3 color = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.333, 0.667) + phase));
  gl_FragColor = vec4(color, 1.0);
}`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
