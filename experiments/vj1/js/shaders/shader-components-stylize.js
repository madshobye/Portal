import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../graph/component-schema.js?v=adaptive-component-demand-29";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "./shader-component-common.js?v=shader-component-catalog-extraction-1";

export const STYLIZE_SHADER_COMPONENTS = Object.freeze({
  ripple: {
    id: "ripple",
    name: "Ripple",
    category: "warp",
    spatial: true,
    transformSource: false,
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 p = localUv - 0.5;
  float d = length(p);
  float wave = sin(d * 48.0 - time * 4.5) * 0.012 * amount;
  vec2 warped = inverseTransformEffectUv(localUv + normalize(p + 0.0001) * wave);
  return mix(color, sampleSource(textureUvFromEffectScreenUv(warped)), field);
}`,
  },
  rgbSplit: {
    id: "rgbSplit",
    name: "RGB Split",
    category: "color",
    runtime: {
      timeDependent: (params = {}) => (Number(params.motion) || 0) > 0.0001,
    },
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      createNumberParam("angle", "Angle", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("motion", "Motion", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float a = angle + time * mix(0.0, 1.7, motion);
  vec2 dir = vec2(cos(a), sin(a)) * amount * 0.035;
  float r = sampleSource(uv + dir).r;
  float g = color.g;
  float b = sampleSource(uv - dir).b;
  return vec4(r, g, b, color.a);
}`,
  },
  photoGrade: {
    id: "photoGrade",
    name: "Photo Grade",
    category: "color",
    runtime: {
      timeDependent: (params = {}) => params.seedMode !== "fixed" && (
        (Number(params.grain) || 0) > 0.0001 ||
        (Number(params.noise) || 0) > 0.0001 ||
        (Number(params.distort) || 0) > 0.0001
      ),
      timeKey: (params = {}, context = {}) => (Number(params.distort) || 0) > 0.0001
        ? context.time
        : Math.floor((Number(context.time) || 0) * 24),
    },
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("invert", "Invert", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("exposure", "Exposure", { min: -2, max: 2, step: 0.01, defaultValue: 0 }),
      createNumberParam("brightness", "Brightness", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("contrast", "Contrast", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("saturation", "Saturation", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("vibrance", "Vibrance", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("temperature", "Temperature", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("tint", "Tint", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("highlights", "Highlights", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("shadows", "Shadows", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("gamma", "Gamma", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("fade", "Fade", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("ditherAmount", "Print dither", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createEnumParam("ditherStyle", "Print style", ["offset color", "offset mono", "laser"], "offset color"),
      createNumberParam("ditherDotSize", "Dot size", { min: 2, max: 20, step: 0.1, defaultValue: 5 }),
      createNumberParam("ditherAngle", "Screen angle", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("ditherInkGain", "Ink gain", { min: 0.5, max: 1.5, step: 0.01, defaultValue: 1 }),
      createNumberParam("grain", "Grain", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("noise", "Noise", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("distort", "Distort", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("vignette", "Vignette", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      ...noiseSeedParams(11),
    ],
    code: `
vec3 applySaturation(vec3 rgb, float sat) {
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(luma), rgb, sat);
}

float photoGradePrintDot(vec2 p, vec2 direction, float coverage, float cellSize) {
  vec2 perpendicular = vec2(-direction.y, direction.x);
  vec2 cell = vec2(dot(p, direction), dot(p, perpendicular)) / max(cellSize, 1.0);
  float radius = sqrt(clamp(coverage, 0.0, 1.0)) * 0.69;
  float distanceToCenter = length(fract(cell) - 0.5);
  float edge = max(0.035, 0.72 / max(cellSize, 2.0));
  return 1.0 - smoothstep(radius - edge, radius + edge, distanceToCenter);
}

float photoGradeBayer2(vec2 p) {
  return p.x * 2.0 + p.y * 3.0 - p.x * p.y * 4.0;
}

float photoGradeBayer4(vec2 pixel) {
  vec2 p = mod(floor(pixel), 4.0);
  vec2 low = mod(p, 2.0);
  vec2 high = floor(p * 0.5);
  return (4.0 * photoGradeBayer2(low) + photoGradeBayer2(high) + 0.5) / 16.0;
}

vec3 photoGradePrintDither(vec3 rgb, vec2 uv) {
  vec2 pixel = uv * resolution;
  float baseCos = cos(ditherAngle);
  float baseSin = sin(ditherAngle);
  pixel = mat2(baseCos, -baseSin, baseSin, baseCos) * pixel;
  float gain = max(0.01, ditherInkGain);

  if (ditherStyle < 0.5) {
    float key = 1.0 - max(rgb.r, max(rgb.g, rgb.b));
    float remaining = max(0.0001, 1.0 - key);
    vec3 cmy = clamp((1.0 - rgb - key) / remaining, 0.0, 1.0);
    float cyan = photoGradePrintDot(pixel, vec2(0.965926, 0.258819), cmy.x * gain, ditherDotSize);
    float magenta = photoGradePrintDot(pixel, vec2(0.258819, 0.965926), cmy.y * gain, ditherDotSize);
    float yellow = photoGradePrintDot(pixel, vec2(1.0, 0.0), cmy.z * gain, ditherDotSize);
    float black = photoGradePrintDot(pixel, vec2(0.707107, 0.707107), key * gain, ditherDotSize);
    return clamp(vec3(1.0 - cyan, 1.0 - magenta, 1.0 - yellow) * (1.0 - black), 0.0, 1.0);
  }

  float ink = clamp((1.0 - dot(rgb, vec3(0.2126, 0.7152, 0.0722))) * gain, 0.0, 1.0);
  if (ditherStyle < 1.5) {
    float black = photoGradePrintDot(pixel, vec2(0.707107, 0.707107), ink, ditherDotSize);
    return vec3(1.0 - black);
  }
  float toner = step(photoGradeBayer4(pixel / max(ditherDotSize * 0.25, 1.0)), ink);
  return vec3(1.0 - toner);
}

vec4 runEffect(vec2 uv, vec4 color) {
  if (amount <= 0.0001) return color;
  vec2 gradeUv = uv;
  float noiseClock = seedMode < 0.5 ? time : seed;
  float noiseFrame = seed + (seedMode < 0.5 ? floor(time * 24.0) : 0.0);
  if (distort > 0.001) {
    float n = hash(floor(uv * resolution * 0.12) + vec2(noiseFrame * 11.0, noiseFrame * 7.0));
    vec2 wobble = vec2(
      sin((uv.y + n) * 38.0 + noiseClock * 2.2),
      cos((uv.x - n) * 31.0 - noiseClock * 1.7)
    ) * distort * 0.006;
    gradeUv = clamp(uv + wobble, vec2(0.0), vec2(1.0));
    color = sampleSource(gradeUv);
  }

  float alpha = color.a;
  vec3 original = alpha > 0.0001 ? color.rgb / alpha : color.rgb;
  vec3 rgb = original;
  if (abs(exposure) > 0.001) rgb *= exp2(exposure);
  if (abs(brightness) > 0.001) rgb += brightness;
  if (abs(contrast) > 0.001) rgb = (rgb - 0.5) * (1.0 + contrast * 1.45) + 0.5;

  if (abs(shadows) > 0.001 || abs(highlights) > 0.001) {
    float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float shadowMask = 1.0 - smoothstep(0.18, 0.74, luma);
    float highlightMask = smoothstep(0.35, 0.92, luma);
    rgb += shadows * shadowMask * 0.38;
    rgb += highlights * highlightMask * 0.34;
  }

  if (abs(temperature) > 0.001 || abs(tint) > 0.001) {
    rgb.r += temperature * 0.10;
    rgb.b -= temperature * 0.10;
    rgb.g += tint * 0.075;
    rgb.r -= tint * 0.035;
    rgb.b -= tint * 0.035;
  }

  if (abs(saturation) > 0.001) {
    float sat = 1.0 + saturation * 1.35;
    rgb = applySaturation(rgb, max(0.0, sat));
  }
  if (abs(vibrance) > 0.001) {
    float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float chroma = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
    float vibranceBoost = vibrance * (1.0 - clamp(chroma, 0.0, 1.0)) * (1.0 - smoothstep(0.72, 1.0, luma));
    rgb = applySaturation(rgb, max(0.0, 1.0 + vibranceBoost * 1.4));
  }

  if (abs(gamma) > 0.001) {
    float gammaValue = exp2(-gamma);
    rgb = pow(max(rgb, vec3(0.0)), vec3(gammaValue));
  }
  if (fade > 0.001) rgb = mix(rgb, rgb * 0.82 + vec3(0.055), fade);
  if (invert > 0.001) rgb = mix(rgb, 1.0 - rgb, invert);

  if (grain > 0.001) {
    float grainValue = cachedNoise(uv * resolution + vec2(noiseFrame * 37.0, noiseFrame * 19.0)) - 0.5;
    rgb += grainValue * grain * 0.16;
  }
  if (noise > 0.001) {
    float coarseNoise = cachedNoise(floor(uv * resolution * 0.14) + vec2(noiseFrame * 3.0, -noiseFrame * 2.0)) - 0.5;
    rgb += coarseNoise * noise * 0.18;
  }

  if (ditherAmount > 0.001) {
    rgb = mix(rgb, photoGradePrintDither(clamp(rgb, 0.0, 1.0), gradeUv), ditherAmount);
  }

  if (vignette > 0.001) {
    vec2 p = (uv - 0.5) * vec2(resolution.x / max(resolution.y, 1.0), 1.0);
    float vignetteMask = 1.0 - smoothstep(0.0324, 0.7396, dot(p, p));
    rgb *= mix(1.0, mix(0.62, 1.0, vignetteMask), vignette);
  }

  rgb = clamp(rgb, 0.0, 1.0);
  vec3 mixed = mix(original, rgb, amount);
  return vec4(mixed * alpha, alpha);
}`,
  },
  labelChromatic: {
    id: "labelChromatic",
    name: "Label Chromatic",
    category: "color",
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      createBooleanParam("fullSplit", "Full split", false),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  if (amount <= 0.0001) return color;
  vec2 px = vec2(1.0 / max(resolution.x, 1.0), 1.0 / max(resolution.y, 1.0));
  vec2 offset = vec2(px.x * mix(2.0, 28.0, amount), 0.0);
  vec4 redColor = sampleSource(uv - offset);
  if (!fullSplit) return vec4(redColor.r, color.g, color.b, color.a);
  vec4 blueColor = sampleSource(uv + offset);
  return vec4(redColor.r, color.g, blueColor.b, color.a);
}`,
  },
  labelGrain: {
    id: "labelGrain",
    name: "Label Grain",
    category: "texture",
    runtime: animatedSeedRuntime({ fps: 24 }),
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      ...noiseSeedParams(23),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float noiseFrame = seed + (seedMode < 0.5 ? floor(time * 24.0) : 0.0);
  float fine = cachedNoise(uv * vec2(16000.0, 12000.0) + noiseFrame);
  float rough = cachedNoise(uv * vec2(1700.0, 2100.0) + vec2(19.0, 73.0 + noiseFrame * 0.37));
  float grain = ((fine - 0.5) * 0.75 + (rough - 0.5) * 0.55) * mix(0.08, 0.55, amount);
  float scanline = step(0.82, fract(uv.y * 900.0)) * mix(0.02, 0.22, amount);
  float alpha = color.a;
  vec3 straight = alpha > 0.0001 ? color.rgb / alpha : vec3(0.0);
  vec3 nextColor = straight + vec3(grain) - vec3(scanline);
  return vec4(clamp(nextColor, 0.0, 1.0) * alpha, alpha);
}`,
  },
  labelThresholdGrain: {
    id: "labelThresholdGrain",
    name: "Grain Threshold",
    category: "key",
    runtime: animatedSeedRuntime({ fps: 24 }),
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      ...noiseSeedParams(37),
    ],
    code: `
float fastThresholdGrain(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float smoothThresholdGrain(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = fastThresholdGrain(cell);
  float b = fastThresholdGrain(cell + vec2(1.0, 0.0));
  float c = fastThresholdGrain(cell + vec2(0.0, 1.0));
  float d = fastThresholdGrain(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

vec4 runEffect(vec2 uv, vec4 color) {
  float alpha = color.a;
  vec3 straight = alpha > 0.0001 ? color.rgb / alpha : vec3(0.0);
  vec2 grainCoord = uv * resolution * mix(0.9, 1.8, amount);
  float noiseFrame = seed + (seedMode < 0.5 ? floor(time * 24.0) : 0.0);
  float grain = smoothThresholdGrain(grainCoord + noiseFrame) - 0.5;
  float luma = dot(straight, vec3(0.299, 0.587, 0.114)) + grain * mix(0.35, 1.05, amount);
  float threshold = mix(0.28, 0.74, amount);
  float ink = step(threshold, luma);
  float scanline = step(0.82, fract(uv.y * 900.0)) * 0.2;
  return vec4(vec3(clamp(ink - scanline, 0.0, 1.0)) * alpha, alpha);
}`,
  },
  smear: {
    id: "smear",
    name: "Smear",
    category: "texture",
    runtime: animatedSeedRuntime({
      active: (params = {}) => ["cctvAmount", "screenPrintAmount", "dotMatrixAmount", "receiptAmount", "ditherAmount", "smearAmount"]
        .some((id) => (Number(params[id]) || 0) > 0.0001),
      fps: 18,
    }),
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("cctvAmount", "CCTV", { min: 0, max: 1, step: 0.01, defaultValue: 0.45 }),
      createNumberParam("screenPrintAmount", "Screen print", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("dotMatrixAmount", "Dot matrix", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("receiptAmount", "Receipt", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("ditherAmount", "Dither", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("smearAmount", "Smear", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("scale", "Scale", { min: 0.25, max: 4, step: 0.01, defaultValue: 1 }),
      ...noiseSeedParams(83),
    ],
    code: `
float stableSmearNoise(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float smoothSmearNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = stableSmearNoise(cell);
  float b = stableSmearNoise(cell + vec2(1.0, 0.0));
  float c = stableSmearNoise(cell + vec2(0.0, 1.0));
  float d = stableSmearNoise(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

float dotPattern(vec2 uv, float density, float luma) {
  vec2 grid = uv * density;
  vec2 cell = fract(grid) - 0.5;
  float radius = mix(0.42, 0.10, clamp(luma, 0.0, 1.0));
  float radius2 = radius * radius;
  float outer = radius + 0.035;
  return 1.0 - smoothstep(radius2, outer * outer, dot(cell, cell));
}

vec4 runEffect(vec2 uv, vec4 color) {
  if (amount <= 0.0001) return color;
  float totalLocal = cctvAmount + screenPrintAmount + dotMatrixAmount + receiptAmount + ditherAmount + smearAmount;
  if (totalLocal <= 0.0001) return color;
  float alpha = color.a;
  vec3 straight = alpha > 0.0001 ? color.rgb / alpha : vec3(0.0);
  float luma = dot(straight, vec3(0.299, 0.587, 0.114));
  float noiseFrame = seed + (seedMode < 0.5 ? floor(time * 18.0) : 0.0);
  float density = mix(90.0, 360.0, clamp(scale, 0.25, 4.0) / 4.0);
  float line = fract(uv.y * resolution.y * mix(0.45, 1.35, scale));
  float grain = smoothSmearNoise(uv * resolution * mix(0.45, 1.8, scale) + noiseFrame) - 0.5;
  vec3 effected = straight;

  if (cctvAmount > 0.001) {
    float localAmount = amount * cctvAmount;
    float scan = smoothstep(0.52, 1.0, line) * 0.22;
    vec3 smearTap = sampleSource(clamp(uv - vec2((grain + 0.5) * localAmount * 0.018, 0.0), vec2(0.0), vec2(1.0))).rgb;
    effected = mix(effected, smearTap + grain * 0.10 - scan, localAmount);
  }
  if (screenPrintAmount > 0.001) {
    float localAmount = amount * screenPrintAmount;
    float dots = dotPattern(uv, density * 0.42, luma);
    vec3 ink = mix(vec3(0.08), effected, dots);
    effected = mix(effected, ink + grain * 0.06, localAmount);
  }
  if (dotMatrixAmount > 0.001) {
    float localAmount = amount * dotMatrixAmount;
    vec2 cellUv = (floor(uv * density * 0.32) + 0.5) / (density * 0.32);
    vec3 block = sampleSource(clamp(cellUv, vec2(0.0), vec2(1.0))).rgb;
    float dots = dotPattern(uv, density * 0.32, dot(block, vec3(0.299, 0.587, 0.114)));
    effected = mix(effected, block * dots, localAmount);
  }
  if (receiptAmount > 0.001) {
    float localAmount = amount * receiptAmount;
    float threshold = stableSmearNoise(floor(uv * resolution * 0.72) + noiseFrame);
    float ink = step(threshold, luma + grain * 0.25);
    float receiptLine = 1.0 - step(0.88, line) * 0.28;
    effected = mix(effected, vec3(ink * receiptLine), localAmount);
  }
  if (ditherAmount > 0.001) {
    float localAmount = amount * ditherAmount;
    float dither = smoothSmearNoise(uv * resolution * mix(0.55, 1.7, scale) + noiseFrame);
    float levels = floor((luma + (dither - 0.5) * localAmount * 0.65) * 5.0) / 4.0;
    effected = mix(effected, vec3(clamp(levels, 0.0, 1.0)), localAmount);
  }
  if (smearAmount > 0.001) {
    float localAmount = amount * smearAmount;
    float offset = localAmount * mix(0.004, 0.035, scale / 4.0);
    vec3 smearA = sampleSource(clamp(uv - vec2(offset, 0.0), vec2(0.0), vec2(1.0))).rgb;
    vec3 smearB = sampleSource(clamp(uv - vec2(offset * 2.1, 0.0), vec2(0.0), vec2(1.0))).rgb;
    effected = mix(effected, effected * 0.55 + smearA * 0.30 + smearB * 0.15 + grain * 0.08, localAmount);
  }

  effected = clamp(effected, 0.0, 1.0);
  return vec4(effected * alpha, alpha);
}`,
  },
  crayonStroke: {
    id: "crayonStroke",
    name: "Crayon / Pen Stroke",
    category: "texture",
    params: [
      createEnumParam("style", "Style", ["crayon", "pen", "ink"], "crayon"),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("strokeScale", "Stroke scale", { min: 0.25, max: 4, step: 0.01, defaultValue: 1 }),
      createNumberParam("roughness", "Roughness", { min: 0, max: 1, step: 0.01, defaultValue: 0.7 }),
      createNumberParam("contrast", "Contrast", { min: 0.25, max: 3, step: 0.01, defaultValue: 1.35 }),
      createNumberParam("edgeStrength", "Edges", { min: 0, max: 2, step: 0.01, defaultValue: 0.65 }),
      createNumberParam("angle", "Direction", { min: -3.14, max: 3.14, step: 0.01, defaultValue: -0.12 }),
      createNumberParam("sourceColor", "Source color", { min: 0, max: 1, step: 0.01, defaultValue: 0.12 }),
      createColorParam("strokeColor", "Stroke color", "#111111ff"),
      createColorParam("paperColor", "Paper color", "#ffffffff"),
    ],
    code: `
float crayonLuma(vec4 sampleColor) {
  float alpha = sampleColor.a;
  vec3 straight = alpha > 0.0001 ? sampleColor.rgb / alpha : vec3(0.0);
  return dot(straight, vec3(0.299, 0.587, 0.114));
}

float crayonHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float smoothCrayonNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = crayonHash(cell);
  float b = crayonHash(cell + vec2(1.0, 0.0));
  float c = crayonHash(cell + vec2(0.0, 1.0));
  float d = crayonHash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

vec4 runEffect(vec2 uv, vec4 color) {
  if (amount <= 0.0001 || color.a <= 0.0001) return color;
  vec2 pixel = 1.0 / max(resolution, vec2(1.0));
  float luma = crayonLuma(color);
  float edge = abs(crayonLuma(sampleSource(uv + vec2(pixel.x, 0.0))) - crayonLuma(sampleSource(uv - vec2(pixel.x, 0.0))))
    + abs(crayonLuma(sampleSource(uv + vec2(0.0, pixel.y))) - crayonLuma(sampleSource(uv - vec2(0.0, pixel.y))));
  float c = cos(angle);
  float s = sin(angle);
  vec2 p = mat2(c, -s, s, c) * ((uv - 0.5) * vec2(resolution.x / max(resolution.y, 1.0), 1.0));
  float density = mix(95.0, 430.0, clamp(strokeScale, 0.25, 4.0) / 4.0);
  vec2 grainCoord = p * density * vec2(0.42, 1.0);
  float coarse = smoothCrayonNoise(grainCoord + vec2(17.0, 43.0));
  float fine = smoothCrayonNoise(uv * resolution * mix(0.48, 1.8, strokeScale) + vec2(71.0, 19.0));
  float fiber = abs(fract((p.y + (coarse - 0.5) * roughness * 0.035) * density) - 0.5);
  float line = 1.0 - smoothstep(mix(0.18, 0.42, roughness), 0.5, fiber);
  float darkness = pow(clamp(1.0 - luma, 0.0, 1.0), max(0.15, contrast));
  float crayonCoverage = clamp(darkness + edge * edgeStrength, 0.0, 1.0) * mix(0.72, 1.0, line);
  crayonCoverage *= step(mix(0.58, 0.18, crayonCoverage), mix(coarse, fine, 0.55 + roughness * 0.35));
  float penCoverage = clamp(edge * edgeStrength * 2.4 + darkness * line * 0.72, 0.0, 1.0);
  float inkBreak = 1.0 - smoothstep(0.02, max(0.03, roughness * 0.48), abs(fine - 0.5));
  float inkCoverage = clamp((darkness - 0.22 / max(contrast, 0.1)) * 2.2 + edge * edgeStrength, 0.0, 1.0);
  inkCoverage *= mix(1.0, 1.0 - inkBreak * 0.65, roughness);
  float coverage = style < 0.5 ? crayonCoverage : style < 1.5 ? penCoverage : inkCoverage;
  vec3 straight = color.rgb / max(color.a, 0.0001);
  vec3 paper = mix(straight, paperColor.rgb, paperColor.a);
  vec3 ink = mix(strokeColor.rgb, straight * strokeColor.rgb, sourceColor);
  vec3 effected = mix(paper, ink, clamp(coverage * strokeColor.a, 0.0, 1.0));
  return vec4(mix(straight, effected, amount) * color.a, color.a);
}`,
  },
});
