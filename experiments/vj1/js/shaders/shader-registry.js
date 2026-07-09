import { createNumberParam, defineVisualComponent, textureInlet, textureOutlet } from "../graph/component-schema.js";

const effectInlets = Object.freeze([textureInlet("texture", "Texture")]);
const effectOutlets = Object.freeze([textureOutlet("texture", "Texture")]);

export const SHADER_COMPONENTS = Object.freeze({
  ripple: {
    id: "ripple",
    name: "Ripple",
    category: "warp",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 p = uv - 0.5;
  float d = length(p);
  float wave = sin(d * 48.0 - time * 4.5) * 0.012 * amount;
  vec2 warped = uv + normalize(p + 0.0001) * wave;
  return sampleSource(warped);
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
  vec3 nextColor = color.rgb + vec3(grain) - vec3(scanline);
  return vec4(clamp(nextColor, 0.0, 1.0), color.a);
}`,
  },
  labelThresholdGrain: {
    id: "labelThresholdGrain",
    name: "Grain Threshold",
    category: "key",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float fine = hash(uv * vec2(16000.0, 12000.0) + time);
  float rough = hash(uv * vec2(2200.0, 2200.0) + vec2(37.0, 91.0 + time * 0.41));
  float grain = (fine - 0.5) * 0.9 + (rough - 0.5) * 0.55;
  vec3 noisy = clamp(color.rgb + vec3(grain * mix(0.25, 1.15, amount)), 0.0, 1.0);
  float luma = dot(noisy, vec3(0.299, 0.587, 0.114));
  float threshold = mix(0.28, 0.74, amount);
  float ink = step(threshold, luma);
  float scanline = step(0.82, fract(uv.y * 900.0)) * 0.2;
  return vec4(vec3(clamp(ink - scanline, 0.0, 1.0)), color.a);
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
  return vec4(vec3(ink), color.a);
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
  float gray = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  return vec4(mix(color.rgb, vec3(gray), amount), color.a);
}`,
  },
  threshold: {
    id: "threshold",
    name: "Threshold",
    category: "filter",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float gray = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  float threshold = floor(mix(0.05, 0.95, amount) * 255.0) / 255.0;
  float ink = step(threshold, gray);
  return vec4(vec3(ink), color.a);
}`,
  },
  invert: {
    id: "invert",
    name: "Invert",
    category: "color",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  return vec4(mix(color.rgb, 1.0 - color.rgb, amount), color.a);
}`,
  },
  kaleido: {
    id: "kaleido",
    name: "Kaleido",
    category: "geometry",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 p = uv - 0.5;
  float angle = atan(p.y, p.x);
  float radius = length(p);
  float slices = floor(mix(3.0, 10.0, amount));
  angle = mod(angle, 6.28318530718 / slices);
  angle = abs(angle - 3.14159265359 / slices);
  vec2 k = 0.5 + vec2(cos(angle), sin(angle)) * radius;
  return sampleSource(k);
}`,
  },
  pixelate: {
    id: "pixelate",
    name: "Pixelate",
    category: "texture",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  float cells = mix(220.0, 18.0, amount);
  vec2 grid = vec2(cells, cells * resolution.y / resolution.x);
  vec2 blockUv = (floor(uv * grid) + 0.5) / grid;
  return sampleSource(blockUv);
}`,
  },
  plasma: {
    id: "plasma",
    name: "Plasma Tint",
    category: "color",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 p = (uv - 0.5) * 2.0;
  float v = sin((p.x + time * 0.25) * 8.0);
  v += sin((p.y - time * 0.18) * 11.0);
  v += sin((p.x + p.y + time * 0.2) * 7.0);
  v = v / 3.0 * 0.5 + 0.5;
  vec3 plasma = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + v + time * 0.05));
  return vec4(mix(color.rgb, plasma, amount), color.a);
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
