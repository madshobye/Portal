import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "shadertoyBaseWarp",
    name: "Base Warp",
    category: "shadertoy",
    runtime: timeParamRuntime("speed"),
    params: [
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("scale", "Scale", { min: 0.2, max: 8, step: 0.01, defaultValue: 1, scale: "log" }),
      createNumberParam("rotation", "Rotation", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("offsetX", "Position X", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
      createNumberParam("offsetY", "Position Y", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
      createNumberParam("warpAmount", "Warp", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("contrast", "Contrast", { min: 0.1, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("brightness", "Brightness", { min: -0.5, max: 0.5, step: 0.01, defaultValue: 0 }),
      createNumberParam("paletteShift", "Palette shift", { min: -0.5, max: 0.5, step: 0.01, defaultValue: 0 }),
      createNumberParam("paletteBalance", "Palette balance", { min: -0.3, max: 0.3, step: 0.01, defaultValue: 0 }),
      createColorParam("shadowColor", "Shadow color", "#360036ff"),
      createColorParam("midtoneColor", "Midtone color", "#ff007fff"),
      createColorParam("highlightColor", "Highlight color", "#ffffffff"),
      createNumberParam("saturation", "Saturation", { min: 0, max: 2, step: 0.01, defaultValue: 1 }),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
  });

const shader = Object.freeze({
    id: "generator.shadertoyBaseWarp",
    name: "Base Warp Generator",
    type: "shadertoy",
    code: `
// Original shader: https://www.shadertoy.com/view/tdG3Rd
uniform float scale;
uniform float rotation;
uniform float offsetX;
uniform float offsetY;
uniform float warpAmount;
uniform float contrast;
uniform float brightness;
uniform float paletteShift;
uniform float paletteBalance;
uniform vec4 shadowColor;
uniform vec4 midtoneColor;
uniform vec4 highlightColor;
uniform float saturation;
uniform float amount;

float colormap_red(float x) {
  if (x < 0.0) {
    return 54.0 / 255.0;
  } else if (x < 20049.0 / 82979.0) {
    return (829.79 * x + 54.51) / 255.0;
  }
  return 1.0;
}

float colormap_green(float x) {
  if (x < 20049.0 / 82979.0) {
    return 0.0;
  } else if (x < 327013.0 / 810990.0) {
    return (8546482679670.0 / 10875673217.0 * x - 2064961390770.0 / 10875673217.0) / 255.0;
  } else if (x <= 1.0) {
    return (103806720.0 / 483977.0 * x + 19607415.0 / 483977.0) / 255.0;
  }
  return 1.0;
}

float colormap_blue(float x) {
  if (x < 0.0) {
    return 54.0 / 255.0;
  } else if (x < 7249.0 / 82979.0) {
    return (829.79 * x + 54.51) / 255.0;
  } else if (x < 20049.0 / 82979.0) {
    return 127.0 / 255.0;
  } else if (x < 327013.0 / 810990.0) {
    return (792.02249341361393720147485376583 * x - 64.364790735602331034989206222672) / 255.0;
  }
  return 1.0;
}

vec4 colormap(float x) {
  return vec4(colormap_red(x), colormap_green(x), colormap_blue(x), 1.0);
}

// Domain-warped fBM based on https://iquilezles.org/articles/warp
float rand(vec2 n) {
  return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 ip = floor(p);
  vec2 u = fract(p);
  u = u * u * (3.0 - 2.0 * u);
  float res = mix(
    mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x),
    mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x),
    u.y
  );
  return res * res;
}

const mat2 mtx = mat2(0.80, 0.60, -0.60, 0.80);

float fbm(vec2 p) {
  float f = 0.0;
  f += 0.500000 * noise(p + iTime); p = mtx * p * 2.02;
  f += 0.031250 * noise(p); p = mtx * p * 2.01;
  f += 0.250000 * noise(p); p = mtx * p * 2.03;
  f += 0.125000 * noise(p); p = mtx * p * 2.01;
  f += 0.062500 * noise(p); p = mtx * p * 2.04;
  f += 0.015625 * noise(p + sin(iTime));
  return f / 0.96875;
}

float pattern(vec2 p) {
  float firstWarp = fbm(p);
  float secondWarp = fbm(p + firstWarp * warpAmount);
  return fbm(p + secondWarp * warpAmount);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.x;
  vec2 center = vec2(0.5, 0.5 * iResolution.y / iResolution.x);
  uv -= center;
  float c = cos(rotation);
  float s = sin(rotation);
  uv = mat2(c, -s, s, c) * uv;
  uv = uv * scale + center + vec2(offsetX, offsetY);
  float shade = pattern(uv);
  shade = clamp((shade - 0.5) * contrast + 0.5 + brightness, 0.0, 1.0);
  float paletteValue = clamp(shade + paletteShift, 0.0, 1.0);
  float paletteMidpoint = clamp(0.38 + paletteBalance, 0.05, 0.95);
  vec3 color = mix(
    shadowColor.rgb,
    midtoneColor.rgb,
    smoothstep(0.0, paletteMidpoint, paletteValue)
  );
  color = mix(
    color,
    highlightColor.rgb,
    smoothstep(paletteMidpoint, 1.0, paletteValue)
  );
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, saturation);
  fragColor = vec4(clamp(color, 0.0, 1.0), shade * amount);
}
`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
