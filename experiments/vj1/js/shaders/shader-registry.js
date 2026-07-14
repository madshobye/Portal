import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams, defineVisualComponent, textureInlet, textureOutlet } from "../graph/component-schema.js?v=range-pair-1";

const effectInlets = Object.freeze([textureInlet("texture", "Texture")]);
const effectOutlets = Object.freeze([textureOutlet("texture", "Texture")]);
const SEED_MODE_VALUES = ["animated", "fixed"];
const ALWAYS_TIME_RUNTIME = Object.freeze({ timeDependent: () => true });

function animatedSeedRuntime({ active = () => true, fps = 0 } = {}) {
  return Object.freeze({
    timeDependent: (params = {}) => params.seedMode !== "fixed" && active(params),
    timeKey: (_params, context = {}) => fps > 0
      ? Math.floor((Number(context.time) || 0) * fps)
      : context.time,
  });
}

function noiseSeedParams(defaultSeed = 0) {
  return [
    createEnumParam("seedMode", "Seed mode", SEED_MODE_VALUES, "animated"),
    createNumberParam("seed", "Seed", { min: 0, max: 999, step: 1, defaultValue: defaultSeed }),
  ];
}

export const SHADER_COMPONENTS = Object.freeze({
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
  alphaVignette: {
    id: "alphaVignette",
    name: "Alpha Vignette",
    category: "key",
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.55 }),
      createNumberParam("radius", "Radius", { min: 0.1, max: 1.2, step: 0.01, defaultValue: 0.78 }),
      createNumberParam("softness", "Softness", { min: 0.02, max: 0.8, step: 0.01, defaultValue: 0.28 }),
      createNumberParam("cornerRound", "Corner round", { min: 0, max: 0.8, step: 0.01, defaultValue: 0.18 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 p = (uv - 0.5) * 2.0;
  float corner = min(max(cornerRound, 0.0), max(radius - 0.001, 0.0));
  vec2 q = abs(p) - vec2(max(radius - corner, 0.001));
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
  float matte = 1.0 - smoothstep(-softness, softness, d);
  float alpha = color.a * mix(1.0, matte, amount);
  return vec4(color.rgb * (alpha / max(color.a, 0.0001)), alpha);
}`,
  },
  glitchDistort: {
    id: "glitchDistort",
    name: "Glitch Distort",
    category: "warp",
    spatial: true,
    transformSource: false,
    runtime: animatedSeedRuntime(),
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.45 }),
      createNumberParam("blocks", "Blocks", { min: 4, max: 80, step: 1, defaultValue: 24 }),
      createNumberParam("colorSplit", "Color Split", { min: 0, max: 1, step: 0.01, defaultValue: 0.42 }),
      ...noiseSeedParams(51),
    ],
    code: `
float smoothGlitchNoise(float coordinate, float frame) {
  float cell = floor(coordinate);
  float local = fract(coordinate);
  float blend = local * local * (3.0 - 2.0 * local);
  return mix(hash(vec2(cell, frame)), hash(vec2(cell + 1.0, frame)), blend);
}

vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  float noiseClock = seedMode < 0.5 ? time : seed;
  float noiseFrame = seed + (seedMode < 0.5 ? floor(time * 18.0) : 0.0);
  float rowCoord = localUv.y * blocks;
  float rowNoise = smoothGlitchNoise(rowCoord, noiseFrame);
  float burst = smoothstep(0.52, 0.66, rowNoise) * rowNoise;
  float jitter = (smoothGlitchNoise(rowCoord * 13.7, noiseFrame * 0.5) - 0.5) * amount * 0.17 * burst;
  float tear = (hash(vec2(floor(localUv.y * 9.0), noiseFrame * 0.17)) - 0.5) * amount * 0.045;
  vec2 warped = localUv + vec2(jitter + tear, sin(localUv.y * 80.0 + noiseClock * 12.0) * amount * 0.0025);
  float scan = step(0.985 - amount * 0.18, fract(localUv.y * resolution.y * 0.5 + noiseClock * 20.0));
  vec2 split = vec2((0.002 + 0.018 * amount) * colorSplit, 0.0);
  vec4 r = sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(warped + split)));
  vec4 g = sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(warped)));
  vec4 b = sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(warped - split)));
  vec4 mixedColor = vec4(r.r, g.g, b.b, max(max(r.a, g.a), b.a));
  mixedColor.rgb += scan * vec3(0.24, 0.08, 0.18) * mixedColor.a;
  return mix(color, mixedColor, amount * field);
}`,
  },
  spinRotate: {
    id: "spinRotate",
    name: "Spin Rotate",
    category: "geometry",
    spatial: true,
    transformSource: false,
    runtime: {
      timeDependent: (params = {}) => Math.abs(Number(params.speed) || 0) > 0.0001,
    },
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
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
  },
  flip: {
    id: "flip",
    name: "Flip",
    category: "geometry",
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createBooleanParam("flipX", "Flip X", true),
      createBooleanParam("flipY", "Flip Y", false),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 flippedUv = vec2(
    flipX ? 1.0 - uv.x : uv.x,
    flipY ? 1.0 - uv.y : uv.y
  );
  vec4 flipped = sampleSource(flippedUv);
  return mix(color, flipped, amount);
}`,
  },
  echoFade: {
    id: "echoFade",
    name: "Echo Fade",
    category: "motion",
    spatial: true,
    transformSource: false,
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.42 }),
      createNumberParam("distance", "Distance", { min: 0, max: 0.35, step: 0.01, defaultValue: 0.12 }),
      createNumberParam("twist", "Twist", { min: -1, max: 1, step: 0.01, defaultValue: 0.18 }),
    ],
    code: `
vec2 rotateAroundCenter(vec2 uv, float angle, float scale) {
  vec2 p = (uv - 0.5) / max(scale, 0.001);
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
}

vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 dir = normalize(vec2(cos(time * 0.33), sin(time * 0.27)) + vec2(0.01));
  vec4 sum = color * 0.46;
  float total = 0.46;
  for (int i = 1; i <= 5; i++) {
    float f = float(i) / 5.0;
    vec2 shifted = rotateAroundCenter(localUv - dir * distance * f * amount, twist * amount * f, 1.0 + amount * 0.035 * f);
    float tapField = effectFieldMask(shifted);
    float weight = pow(1.0 - f, 1.65) * 0.42 * tapField;
    vec4 tap = sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(shifted)));
    sum += tap * weight;
    total += weight;
  }
  vec4 echoed = sum / max(total, 0.0001);
  return mix(color, echoed, amount * field);
}`,
  },
  mirrorFold: {
    id: "mirrorFold",
    name: "Mirror Fold",
    category: "geometry",
    spatial: true,
    transformSource: false,
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.55 }),
      createNumberParam("folds", "Folds", { min: 2, max: 12, step: 1, defaultValue: 6 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  vec2 p = localUv - 0.5;
  float radius = length(p);
  float angle = atan(p.y, p.x) + time * amount * 0.25;
  float sector = 6.28318530718 / max(2.0, folds);
  angle = mod(angle, sector);
  angle = abs(angle - sector * 0.5);
  vec2 folded = 0.5 + vec2(cos(angle), sin(angle)) * radius;
  return mix(color, sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(folded))), amount * field);
}`,
  },
  heatShimmer: {
    id: "heatShimmer",
    name: "Heat Shimmer",
    category: "warp",
    spatial: true,
    transformSource: false,
    runtime: animatedSeedRuntime(),
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.34 }),
      createNumberParam("frequency", "Frequency", { min: 2, max: 48, step: 1, defaultValue: 18 }),
      ...noiseSeedParams(67),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  float shimmerTime = seedMode < 0.5 ? time : 0.0;
  float phase = seed * 0.071;
  float waveA = sin(localUv.y * frequency + shimmerTime * 4.1 + phase);
  float waveB = sin((localUv.y + localUv.x * 0.35) * frequency * 0.62 - shimmerTime * 2.7 + phase * 1.7);
  float waveC = cos((localUv.x - localUv.y * 0.22) * frequency * 0.48 + shimmerTime * 1.9 + phase * 2.3);
  vec2 wave = vec2(
    waveA * 0.62 + waveB * 0.28,
    waveC * 0.22 + waveB * 0.10
  );
  vec2 warped = localUv + wave * amount * 0.018;
  return mix(color, sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(warped))), field);
}`,
  },
  heartbeatPulse: {
    id: "heartbeatPulse",
    name: "Heartbeat Pulse",
    category: "warp",
    spatial: true,
    transformSource: false,
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.45 }),
      createNumberParam("rate", "Rate", { min: 0.2, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("ringWidth", "Ring width", { min: 0.04, max: 0.45, step: 0.01, defaultValue: 0.18 }),
      createNumberParam("spread", "Spread", { min: 0.4, max: 2.2, step: 0.01, defaultValue: 1 }),
    ],
    code: `
float beatImpulse(float beatTime, float center, float width, float strength) {
  float d = abs(beatTime - center);
  return exp(-(d * d) / max(width * width, 0.0001)) * strength;
}

vec4 runEffect(vec2 uv, vec4 color) {
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 screenUv = effectScreenUv();
  vec2 center = vec2(0.5) + effectTransform.xy * 0.5;
  float fieldScale = max(effectTransform.z, 0.0001);
  vec2 p = (screenUv - center) * aspect / fieldScale;
  float radius = length(p);
  vec2 dir = radius > 0.0001 ? p / radius : vec2(0.0);

  float cycleDuration = 1.0 / max(rate, 0.001);
  float beatTime = mod(time, cycleDuration);
  float beat = beatImpulse(beatTime, 0.08, 0.035, 1.0) +
    beatImpulse(beatTime, 0.27, 0.050, 0.62);
  float after = exp(-beatTime * 3.2) * 0.18;
  float pulse = beat + after;

  float ringPhase = radius * mix(3.2, 1.05, clamp(spread, 0.0, 2.2) / 2.2) - beatTime * 1.75;
  float ring = exp(-(ringPhase * ringPhase) / max(ringWidth * ringWidth, 0.0001));
  if (renderQuality > 0.65) {
    float detailPhase = ringPhase * 1.8 + beatTime * 2.4;
    ring += exp(-(detailPhase * detailPhase) / max(ringWidth * ringWidth * 0.55, 0.0001))
      * mix(0.0, 0.28, (renderQuality - 0.65) / 0.35);
  }
  float falloff = smoothstep(1.35, 0.02, radius);
  float displacement = amount * pulse * ring * falloff * 0.055;
  vec2 warped = screenUv + (dir * displacement * fieldScale) / aspect;
  return sampleSource(textureUvFromEffectScreenUv(warped));
}`,
  },
  custom: {
    id: "custom",
    name: "Custom",
    category: "user",
    runtime: ALWAYS_TIME_RUNTIME,
    defaultAmount: 0.5,
    code: null,
  },
});

export function getShaderComponent(id) {
  return normalizeShaderComponent(SHADER_COMPONENTS[id]);
}

export function listShaderComponents() {
  return Object.values(SHADER_COMPONENTS).map(normalizeShaderComponent).filter(Boolean);
}

function normalizeShaderComponent(component) {
  if (!component) return null;
  const sampling = component.sampling || inferSampling(component.code);
  return defineVisualComponent({
    ...component,
    sampling,
    requiresBaseSample: component.requiresBaseSample ?? effectUsesBaseColor(component.code),
    fusible: component.fusible ?? (
      sampling === "local" &&
      component.type !== "fragment" &&
      component.type !== "shadertoy" &&
      component.id !== "custom" &&
      component.transformSource !== false
    ),
    kind: "effect",
    family: "shader",
    processor: "shader",
    scheduler: "frame",
    runtime: component.runtime || (component.code?.includes("time") ? ALWAYS_TIME_RUNTIME : undefined),
    inlets: component.inlets || effectInlets,
    outlets: component.outlets || effectOutlets,
    params: component.params || [
      createNumberParam("amount", "Amount", {
        min: 0,
        max: 1,
        step: 0.01,
        defaultValue: component.defaultAmount ?? 0.35,
      }),
    ],
  });
}

function inferSampling(code = "") {
  const sourceSamples = (String(code).match(/\bsampleSource\s*\(/g) || []).length;
  return sourceSamples > 0 ? "neighborhood" : "local";
}

function effectUsesBaseColor(code = "") {
  const body = String(code).replace(/runEffect\s*\(\s*vec2\s+\w+\s*,\s*vec4\s+color\s*\)/, "runEffect()");
  return /\bcolor\b/.test(body);
}
