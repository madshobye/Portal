import { createBooleanParam, createNumberParam, defineVisualComponent, textureInlet, textureOutlet } from "../graph/component-schema.js";

const effectInlets = Object.freeze([textureInlet("texture", "Texture")]);
const effectOutlets = Object.freeze([textureOutlet("texture", "Texture")]);

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
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
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
    ],
    code: `
vec3 applySaturation(vec3 rgb, float sat) {
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(luma), rgb, sat);
}

vec4 runEffect(vec2 uv, vec4 color) {
  vec2 gradeUv = uv;
  if (distort > 0.001) {
    float n = hash(floor(uv * resolution * 0.12) + vec2(time * 11.0, time * 7.0));
    vec2 wobble = vec2(
      sin((uv.y + n) * 38.0 + time * 2.2),
      cos((uv.x - n) * 31.0 - time * 1.7)
    ) * distort * 0.006;
    gradeUv = clamp(uv + wobble, vec2(0.0), vec2(1.0));
    color = sampleSource(gradeUv);
  }

  float alpha = color.a;
  vec3 original = alpha > 0.0001 ? color.rgb / alpha : color.rgb;
  vec3 rgb = original;
  rgb *= exp2(exposure);
  rgb += brightness;
  rgb = (rgb - 0.5) * (1.0 + contrast * 1.45) + 0.5;

  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  float shadowMask = 1.0 - smoothstep(0.18, 0.74, luma);
  float highlightMask = smoothstep(0.35, 0.92, luma);
  rgb += shadows * shadowMask * 0.38;
  rgb += highlights * highlightMask * 0.34;

  rgb.r += temperature * 0.10;
  rgb.b -= temperature * 0.10;
  rgb.g += tint * 0.075;
  rgb.r -= tint * 0.035;
  rgb.b -= tint * 0.035;

  float sat = 1.0 + saturation * 1.35;
  rgb = applySaturation(rgb, max(0.0, sat));
  float chroma = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
  float vibranceBoost = vibrance * (1.0 - clamp(chroma, 0.0, 1.0)) * (1.0 - smoothstep(0.72, 1.0, luma));
  rgb = applySaturation(rgb, max(0.0, 1.0 + vibranceBoost * 1.4));

  float gammaValue = exp2(-gamma);
  rgb = pow(max(rgb, vec3(0.0)), vec3(gammaValue));
  rgb = mix(rgb, rgb * 0.82 + vec3(0.055), fade);

  float grainValue = hash(uv * resolution + vec2(time * 37.0, time * 19.0)) - 0.5;
  float coarseNoise = hash(floor(uv * resolution * 0.14) + vec2(time * 3.0, -time * 2.0)) - 0.5;
  rgb += grainValue * grain * 0.16;
  rgb += coarseNoise * noise * 0.18;

  vec2 p = (uv - 0.5) * vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  float vignetteMask = smoothstep(0.86, 0.18, length(p));
  rgb *= mix(1.0, mix(0.62, 1.0, vignetteMask), vignette);

  rgb = clamp(rgb, 0.0, 1.0);
  vec3 mixed = mix(original, rgb, amount);
  return vec4(mixed * alpha, alpha);
}`,
  },
  labelChromatic: {
    id: "labelChromatic",
    name: "Label Chromatic",
    category: "color",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 px = vec2(1.0 / max(resolution.x, 1.0), 1.0 / max(resolution.y, 1.0));
  vec2 offset = vec2(px.x * mix(2.0, 28.0, amount), 0.0);
  vec4 redColor = sampleSource(uv - offset);
  vec4 blueColor = sampleSource(uv + offset);
  return vec4(redColor.r, color.g, blueColor.b, color.a);
}`,
  },
  labelGrain: {
    id: "labelGrain",
    name: "Label Grain",
    category: "texture",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float fine = hash(uv * vec2(16000.0, 12000.0) + time);
  float rough = hash(uv * vec2(1700.0, 2100.0) + vec2(19.0, 73.0 + time * 0.37));
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
    code: `
float fastThresholdGrain(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec4 runEffect(vec2 uv, vec4 color) {
  float alpha = color.a;
  vec3 straight = alpha > 0.0001 ? color.rgb / alpha : vec3(0.0);
  vec2 grainCell = floor(uv * resolution * mix(0.9, 1.8, amount));
  float grain = fastThresholdGrain(grainCell + floor(time * 24.0)) - 0.5;
  float luma = dot(straight, vec3(0.299, 0.587, 0.114)) + grain * mix(0.35, 1.05, amount);
  float threshold = mix(0.28, 0.74, amount);
  float ink = step(threshold, luma);
  float scanline = step(0.82, fract(uv.y * 900.0)) * 0.2;
  return vec4(vec3(clamp(ink - scanline, 0.0, 1.0)) * alpha, alpha);
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
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.45 }),
      createNumberParam("blocks", "Blocks", { min: 4, max: 80, step: 1, defaultValue: 24 }),
      createNumberParam("colorSplit", "Color Split", { min: 0, max: 1, step: 0.01, defaultValue: 0.42 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  float row = floor(localUv.y * blocks);
  float rowNoise = hash(vec2(row, floor(time * 18.0)));
  float burst = step(0.58, rowNoise) * rowNoise;
  float jitter = (hash(vec2(row * 13.7, floor(time * 9.0))) - 0.5) * amount * 0.17 * burst;
  float tear = (hash(vec2(floor(localUv.y * 9.0), floor(time * 3.0))) - 0.5) * amount * 0.045;
  vec2 warped = localUv + vec2(jitter + tear, sin(localUv.y * 80.0 + time * 12.0) * amount * 0.0025);
  float scan = step(0.985 - amount * 0.18, fract(localUv.y * resolution.y * 0.5 + time * 20.0));
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
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.34 }),
      createNumberParam("frequency", "Frequency", { min: 2, max: 48, step: 1, defaultValue: 18 }),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  float n = hash(floor(localUv * vec2(42.0, 24.0)) + floor(time * 14.0));
  vec2 wave = vec2(
    sin(localUv.y * frequency + time * 4.3 + n * 6.28318),
    cos(localUv.x * frequency * 0.7 - time * 3.1 + n * 6.28318)
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
  return defineVisualComponent({
    ...component,
    kind: "effect",
    family: "shader",
    processor: "shader",
    scheduler: "frame",
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
