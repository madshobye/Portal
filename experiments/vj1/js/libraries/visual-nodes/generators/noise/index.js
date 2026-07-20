import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "noise",
    name: "Noise",
    category: "texture",
    runtime: {
      timeDependent: (params = {}) =>
        params.motionMode !== "steady" &&
        (Number(params.speed) || 0) > 0.0001 &&
        (Number(params.movement) || 0) > 0.0001,
    },
    params: [
      createEnumParam("motionMode", "Motion", ["flow", "turbulence", "pulse", "steady"], "flow"),
      createNumberParam("scale", "Scale", { min: 0.25, max: 20, step: 0.01, defaultValue: 4.5 }),
      createNumberParam("detail", "Detail", { min: 1, max: 5, step: 1, defaultValue: 4 }),
      createNumberParam("roughness", "Roughness", { min: 0.2, max: 0.8, step: 0.01, defaultValue: 0.5 }),
      createNumberParam("distortion", "Distortion", { min: 0, max: 2.5, step: 0.01, defaultValue: 0.65 }),
      createNumberParam("movement", "Movement", { min: 0, max: 2, step: 0.01, defaultValue: 1 }),
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 0.7 }),
      createNumberParam("contrast", "Contrast", { min: 0.2, max: 3, step: 0.01, defaultValue: 1.2 }),
      createNumberParam("balance", "Balance", { min: 0, max: 1, step: 0.01, defaultValue: 0.5 }),
      createNumberParam("ridge", "Ridges", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("seed", "Seed", { min: 0, max: 1000, step: 1, defaultValue: 0 }),
      createColorParam("colorA", "Dark color", "#080b19ff"),
      createColorParam("colorB", "Mid color", "#265ea8ff"),
      createColorParam("colorC", "Light color", "#7ef5d8ff"),
    ],
  });

const shader = Object.freeze({
    id: "generator.noise",
    name: "Noise Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform float motionMode;
uniform float scale;
uniform float detail;
uniform float roughness;
uniform float distortion;
uniform float movement;
uniform float speed;
uniform float contrast;
uniform float balance;
uniform float ridge;
uniform float seed;
uniform vec4 colorA;
uniform vec4 colorB;
uniform vec4 colorC;
varying vec2 vTexCoord;

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 mod289(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

float simplexNoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
   -0.577350269189626,
    0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = x0.x > x0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float value = 0.0;
  float total = 0.0;
  float amplitude = 1.0;
  mat2 octaveRotation = mat2(1.56, 1.14, -1.14, 1.56);
  for (int octave = 0; octave < 5; octave++) {
    if (float(octave) < detail) {
      value += simplexNoise(p) * amplitude;
      total += amplitude;
    }
    p = octaveRotation * p + vec2(13.17, 7.31);
    amplitude *= roughness;
  }
  return value / max(total, 0.0001) * 0.5 + 0.5;
}

void main() {
  vec2 uv = vTexCoord - 0.5;
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  float dynamicMode = 1.0 - step(2.5, motionMode);
  float clock = time * speed * movement * dynamicMode;
  float seedValue = seed * 0.071;
  float angle = seedValue + clock * (0.18 + movement * 0.09);
  mat2 domainRotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 p = domainRotation * (uv * aspect * scale);

  vec2 orbit = vec2(sin(clock * 0.73 + seedValue), cos(clock * 0.61 - seedValue)) * movement;
  if (motionMode < 0.5) {
    p += orbit * 0.8;
  } else if (motionMode < 1.5) {
    p += vec2(sin(clock * 0.37), sin(clock * 0.53 + 1.7)) * movement * 0.35;
  } else if (motionMode < 2.5) {
    p *= 1.0 + sin(clock * 0.9) * 0.18 * movement;
  }

  vec2 warp = vec2(
    simplexNoise(p * 0.58 + vec2(17.3 + seedValue, clock * 0.31)),
    simplexNoise(p * 0.58 + vec2(-clock * 0.27, 41.7 - seedValue))
  );
  if (motionMode > 0.5 && motionMode < 1.5) {
    vec2 secondWarp = vec2(
      simplexNoise(p * 0.31 + warp * 1.7 + vec2(clock * 0.19)),
      simplexNoise(p * 0.31 - warp.yx * 1.7 - vec2(clock * 0.23))
    );
    warp = mix(warp, secondWarp, 0.65);
  }
  p += warp * distortion;

  float n = clamp(fbm(p), 0.0, 1.0);
  float ridged = 1.0 - abs(n * 2.0 - 1.0);
  n = mix(n, ridged, ridge);
  n = clamp((n - 0.5) * contrast + 0.5 + (0.5 - balance), 0.0, 1.0);

  vec4 palette = n < 0.5
    ? mix(colorA, colorB, smoothstep(0.0, 0.5, n))
    : mix(colorB, colorC, smoothstep(0.5, 1.0, n));
  gl_FragColor = vec4(palette.rgb * palette.a, palette.a);
}`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
