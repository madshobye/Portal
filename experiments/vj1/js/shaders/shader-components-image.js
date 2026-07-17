import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../graph/component-schema.js?v=adaptive-component-demand-29";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "./shader-component-common.js?v=shader-component-catalog-extraction-1";

export const IMAGE_SHADER_COMPONENTS = Object.freeze({
  hardBlack: {
    id: "hardBlack",
    name: "Hard Black",
    category: "key",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  float threshold = mix(0.34, 0.82, amount);
  float ink = step(threshold, luma);
  return vec4(vec3(ink) * color.a, color.a);
}`,
  },
  blur: {
    id: "blur",
    name: "Blur",
    category: "filter",
    code: `
vec4 sampleBlur(vec2 uv) {
  return sampleSource(uv);
}

vec4 runEffect(vec2 uv, vec4 color) {
  float radius = mix(0.0, 12.0, amount);
  vec2 px = radius / max(resolution, vec2(1.0));
  vec4 sum = color * 0.20;
  sum += sampleBlur(uv + px * vec2( 1.0,  0.0)) * 0.12;
  sum += sampleBlur(uv + px * vec2(-1.0,  0.0)) * 0.12;
  sum += sampleBlur(uv + px * vec2( 0.0,  1.0)) * 0.12;
  sum += sampleBlur(uv + px * vec2( 0.0, -1.0)) * 0.12;
  sum += sampleBlur(uv + px * vec2( 0.707,  0.707)) * 0.07;
  sum += sampleBlur(uv + px * vec2(-0.707,  0.707)) * 0.07;
  sum += sampleBlur(uv + px * vec2( 0.707, -0.707)) * 0.07;
  sum += sampleBlur(uv + px * vec2(-0.707, -0.707)) * 0.07;
  sum += sampleBlur(uv + px * vec2( 2.0,  0.0)) * 0.01;
  sum += sampleBlur(uv + px * vec2(-2.0,  0.0)) * 0.01;
  sum += sampleBlur(uv + px * vec2( 0.0,  2.0)) * 0.01;
  sum += sampleBlur(uv + px * vec2( 0.0, -2.0)) * 0.01;
  return sum;
}`,
  },
  erode: {
    id: "erode",
    name: "Erode",
    category: "filter",
    code: `
vec4 sampleMorph(vec2 uv) {
  return sampleSource(uv);
}

float morphLuma(vec3 rgb) {
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

vec4 darkerOf(vec4 current, vec4 candidate) {
  return morphLuma(candidate.rgb) < morphLuma(current.rgb) ? candidate : current;
}

vec4 runEffect(vec2 uv, vec4 color) {
  vec2 px = mix(1.0, 3.0, amount) / max(resolution, vec2(1.0));
  vec4 selected = color;
  selected = darkerOf(selected, sampleMorph(uv + px * vec2(-1.0, -1.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2( 0.0, -1.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2( 1.0, -1.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2(-1.0,  0.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2( 1.0,  0.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2(-1.0,  1.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2( 0.0,  1.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2( 1.0,  1.0)));
  return mix(color, selected, amount);
}`,
  },
  dilate: {
    id: "dilate",
    name: "Dilate",
    category: "filter",
    code: `
vec4 sampleMorph(vec2 uv) {
  return sampleSource(uv);
}

float morphLuma(vec3 rgb) {
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

vec4 lighterOf(vec4 current, vec4 candidate) {
  return morphLuma(candidate.rgb) > morphLuma(current.rgb) ? candidate : current;
}

vec4 runEffect(vec2 uv, vec4 color) {
  vec2 px = mix(1.0, 3.0, amount) / max(resolution, vec2(1.0));
  vec4 selected = color;
  selected = lighterOf(selected, sampleMorph(uv + px * vec2(-1.0, -1.0)));
  selected = lighterOf(selected, sampleMorph(uv + px * vec2( 0.0, -1.0)));
  selected = lighterOf(selected, sampleMorph(uv + px * vec2( 1.0, -1.0)));
  selected = lighterOf(selected, sampleMorph(uv + px * vec2(-1.0,  0.0)));
  selected = lighterOf(selected, sampleMorph(uv + px * vec2( 1.0,  0.0)));
  selected = lighterOf(selected, sampleMorph(uv + px * vec2(-1.0,  1.0)));
  selected = lighterOf(selected, sampleMorph(uv + px * vec2( 0.0,  1.0)));
  selected = lighterOf(selected, sampleMorph(uv + px * vec2( 1.0,  1.0)));
  return mix(color, selected, amount);
}`,
  },
  gray: {
    id: "gray",
    name: "Gray",
    category: "filter",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float alpha = color.a;
  vec3 straight = alpha > 0.0001 ? color.rgb / alpha : vec3(0.0);
  float gray = dot(straight, vec3(0.2126, 0.7152, 0.0722));
  return vec4(mix(straight, vec3(gray), amount) * alpha, alpha);
}`,
  },
  threshold: {
    id: "threshold",
    name: "Threshold",
    category: "filter",
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.65 }),
      createNumberParam("cutoff", "Cutoff", { min: 0, max: 1, step: 0.01, defaultValue: 0.5 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec3 visibleRgb = color.a > 0.001 ? color.rgb / color.a : color.rgb;
  float gray = dot(visibleRgb, vec3(0.2126, 0.7152, 0.0722));
  float threshold = floor(cutoff * 255.0) / 255.0;
  float ink = step(threshold, gray);
  vec3 thresholdRgb = vec3(ink) * color.a;
  return vec4(mix(color.rgb, thresholdRgb, amount), color.a);
}`,
  },
  invert: {
    id: "invert",
    name: "Invert",
    category: "color",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float alpha = color.a;
  vec3 straight = alpha > 0.0001 ? color.rgb / alpha : vec3(0.0);
  return vec4(mix(straight, 1.0 - straight, amount) * alpha, alpha);
}`,
  },
  kaleido: {
    id: "kaleido",
    name: "Kaleido",
    category: "geometry",
    spatial: true,
    transformSource: false,
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 p = localUv - 0.5;
  float angle = atan(p.y, p.x);
  float radius = length(p);
  float slices = floor(mix(3.0, 10.0, amount));
  angle = mod(angle, 6.28318530718 / slices);
  angle = abs(angle - 3.14159265359 / slices);
  vec2 k = 0.5 + vec2(cos(angle), sin(angle)) * radius;
  return mix(color, sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(k))), field);
}`,
  },
  pixelate: {
    id: "pixelate",
    name: "Pixelate",
    category: "texture",
    spatial: true,
    transformSource: false,
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  float cells = mix(220.0, 18.0, amount);
  vec2 grid = vec2(cells, cells * resolution.y / resolution.x);
  vec2 blockUv = (floor(localUv * grid) + 0.5) / grid;
  return mix(color, sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(blockUv))), field);
}`,
  },
  pixelArtUpscale: {
    id: "pixelArtUpscale",
    name: "Pixel Art Upscale",
    category: "texture",
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("upscale", "Pixel size", { min: 2, max: 32, step: 1, defaultValue: 10 }),
      createNumberParam("colorThreshold", "Color threshold", { min: 0.01, max: 1, step: 0.01, defaultValue: 0.1 }),
      createNumberParam("lineThickness", "Line thickness", { min: 0.05, max: 0.8, step: 0.01, defaultValue: 0.4 }),
      createNumberParam("antiAlias", "Antialiasing", { min: 0.1, max: 3, step: 0.01, defaultValue: 1 }),
    ],
    code: `
/*
Copyright 2020 Ethan Alexander Shulman

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Original shader: https://www.shadertoy.com/view/tsdcRM
The WebGL2 texelFetch operations are expressed through Portal's normalized
source sampler so the effect works in the existing WebGL shader pipeline.
*/

vec4 pixelArtSample(vec2 logicalPixel, vec2 grid) {
  return sampleSource((floor(logicalPixel) + 0.5) / grid);
}

bool pixelArtDiagonal(
  inout vec4 sum,
  vec2 logicalPixel,
  vec2 grid,
  vec2 p1,
  vec2 p2,
  float thickness
) {
  vec4 v1 = pixelArtSample(logicalPixel + p1, grid);
  vec4 v2 = pixelArtSample(logicalPixel + p2, grid);
  if (length(v1 - v2) < colorThreshold) {
    vec2 direction = p2 - p1;
    vec2 linePosition = logicalPixel - (floor(logicalPixel + p1) + 0.5);
    direction = normalize(vec2(direction.y, -direction.x));
    float line = clamp(
      (thickness - dot(linePosition, direction)) * upscale * antiAlias,
      0.0,
      1.0
    );
    sum = mix(sum, v1, line);
    return true;
  }
  return false;
}

vec4 runEffect(vec2 uv, vec4 color) {
  vec2 grid = max(resolution / max(upscale, 1.0), vec2(1.0));
  vec2 logicalPixel = uv * grid;
  vec4 result = pixelArtSample(logicalPixel, grid);
  float primary = lineThickness;
  float secondary = lineThickness * 0.75;

  if (pixelArtDiagonal(result, logicalPixel, grid, vec2(-1.0, 0.0), vec2(0.0, 1.0), primary)) {
    pixelArtDiagonal(result, logicalPixel, grid, vec2(-1.0, 0.0), vec2(1.0, 1.0), secondary);
    pixelArtDiagonal(result, logicalPixel, grid, vec2(-1.0, -1.0), vec2(0.0, 1.0), secondary);
  }
  if (pixelArtDiagonal(result, logicalPixel, grid, vec2(0.0, 1.0), vec2(1.0, 0.0), primary)) {
    pixelArtDiagonal(result, logicalPixel, grid, vec2(0.0, 1.0), vec2(1.0, -1.0), secondary);
    pixelArtDiagonal(result, logicalPixel, grid, vec2(-1.0, 1.0), vec2(1.0, 0.0), secondary);
  }
  if (pixelArtDiagonal(result, logicalPixel, grid, vec2(1.0, 0.0), vec2(0.0, -1.0), primary)) {
    pixelArtDiagonal(result, logicalPixel, grid, vec2(1.0, 0.0), vec2(-1.0, -1.0), secondary);
    pixelArtDiagonal(result, logicalPixel, grid, vec2(1.0, 1.0), vec2(0.0, -1.0), secondary);
  }
  if (pixelArtDiagonal(result, logicalPixel, grid, vec2(0.0, -1.0), vec2(-1.0, 0.0), primary)) {
    pixelArtDiagonal(result, logicalPixel, grid, vec2(0.0, -1.0), vec2(-1.0, 1.0), secondary);
    pixelArtDiagonal(result, logicalPixel, grid, vec2(1.0, -1.0), vec2(-1.0, 0.0), secondary);
  }

  return mix(color, result, amount);
}
`,
  },
  plasma: {
    id: "plasma",
    name: "Plasma Tint",
    category: "color",
    spatial: true,
    transformSource: false,
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 p = (localUv - 0.5) * 2.0;
  float v = sin((p.x + time * 0.25) * 8.0);
  v += sin((p.y - time * 0.18) * 11.0);
  v += sin((p.x + p.y + time * 0.2) * 7.0);
  v = v / 3.0 * 0.5 + 0.5;
  vec3 plasma = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + v + time * 0.05));
  float alpha = color.a;
  vec3 straight = alpha > 0.0001 ? color.rgb / alpha : vec3(0.0);
  vec4 tinted = vec4(mix(straight, plasma, amount) * alpha, alpha);
  return mix(color, tinted, field);
}`,
  },
  lumaKey: {
    id: "lumaKey",
    name: "Luma Key",
    category: "key",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  float matte = smoothstep(amount * 0.85, amount + 0.18, luma);
  return vec4(color.rgb * matte, matte);
}`,
  },
  hsvAlphaKey: {
    id: "hsvAlphaKey",
    name: "HSV Alpha Key",
    category: "key",
    params: [
      ...createRangePairParams("hue", "Hue", {
        min: 0,
        max: 360,
        step: 1,
        defaultMin: 200,
        defaultMax: 260,
        kind: "hue",
        display: "degrees",
      }),
      ...createRangePairParams("saturation", "Saturation", {
        defaultMin: 0.4,
        defaultMax: 1,
        kind: "saturation",
        display: "percent",
      }),
      ...createRangePairParams("value", "Value", {
        defaultMin: 0,
        defaultMax: 0.45,
        kind: "value",
        display: "percent",
      }),
      createNumberParam("feather", "Feather", { min: 0, max: 0.5, step: 0.001, defaultValue: 0.08 }),
    ],
    code: `
vec3 rgbToHsv(vec3 rgb) {
  float high = max(max(rgb.r, rgb.g), rgb.b);
  float low = min(min(rgb.r, rgb.g), rgb.b);
  float delta = high - low;
  float hue = 0.0;
  if (delta > 0.00001) {
    if (high == rgb.r) hue = mod((rgb.g - rgb.b) / delta, 6.0);
    else if (high == rgb.g) hue = (rgb.b - rgb.r) / delta + 2.0;
    else hue = (rgb.r - rgb.g) / delta + 4.0;
    hue = fract(hue / 6.0);
  }
  float saturation = high > 0.00001 ? delta / high : 0.0;
  return vec3(hue, saturation, high);
}

float distanceOutsideRange(float value, float low, float high) {
  return max(max(low - value, value - high), 0.0);
}

vec4 runEffect(vec2 uv, vec4 color) {
  if (color.a <= 0.00001) return color;
  vec3 straight = clamp(color.rgb / color.a, 0.0, 1.0);
  vec3 hsv = rgbToHsv(straight);
  float hueDistance = distanceOutsideRange(hsv.x, hueMin / 360.0, hueMax / 360.0);
  float saturationDistance = distanceOutsideRange(hsv.y, saturationMin, saturationMax);
  float valueDistance = distanceOutsideRange(hsv.z, valueMin, valueMax);
  float keyDistance = max(hueDistance, max(saturationDistance, valueDistance));
  float keep = feather <= 0.00001
    ? step(0.000001, keyDistance)
    : smoothstep(0.0, feather, keyDistance);
  return vec4(color.rgb * keep, color.a * keep);
}`,
  },
});
