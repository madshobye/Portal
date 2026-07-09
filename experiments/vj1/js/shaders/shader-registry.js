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
  return texture2D(tex0, vec2(warped.x, 1.0 - warped.y));
}`,
  },
  rgbSplit: {
    id: "rgbSplit",
    name: "RGB Split",
    category: "color",
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 dir = vec2(sin(time * 1.3), cos(time * 1.7)) * amount * 0.035;
  float r = texture2D(tex0, vec2(uv.x + dir.x, 1.0 - (uv.y + dir.y))).r;
  float g = color.g;
  float b = texture2D(tex0, vec2(uv.x - dir.x, 1.0 - (uv.y - dir.y))).b;
  return vec4(r, g, b, color.a);
}`,
  },
  labelChromatic: {
    id: "labelChromatic",
    name: "Label Chromatic",
    category: "color",
    type: "fragment",
    code: `
precision highp float;
uniform sampler2D tex0;
uniform vec2 texelSize;
uniform float amount;
varying vec2 vTexCoord;

void main() {
  vec2 uv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
  vec2 offset = vec2(texelSize.x * mix(2.0, 28.0, amount), 0.0);
  vec4 baseColor = texture2D(tex0, uv);
  vec4 redColor = texture2D(tex0, uv - offset);
  vec4 blueColor = texture2D(tex0, uv + offset);
  gl_FragColor = vec4(redColor.r, baseColor.g, blueColor.b, baseColor.a);
}`,
  },
  labelGrain: {
    id: "labelGrain",
    name: "Label Grain",
    category: "texture",
    type: "fragment",
    code: `
precision highp float;
uniform sampler2D tex0;
uniform float amount;
uniform float time;
varying vec2 vTexCoord;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
  vec4 color = texture2D(tex0, uv);
  float fine = hash(uv * vec2(16000.0, 12000.0) + time);
  float rough = hash(uv * vec2(1700.0, 2100.0) + vec2(19.0, 73.0 + time * 0.37));
  float grain = ((fine - 0.5) * 0.75 + (rough - 0.5) * 0.55) * mix(0.08, 0.55, amount);
  float scanline = step(0.82, fract(uv.y * 900.0)) * mix(0.02, 0.22, amount);
  vec3 nextColor = color.rgb + vec3(grain) - vec3(scanline);
  gl_FragColor = vec4(clamp(nextColor, 0.0, 1.0), color.a);
}`,
  },
  labelThresholdGrain: {
    id: "labelThresholdGrain",
    name: "Grain Threshold",
    category: "key",
    type: "fragment",
    code: `
precision highp float;
uniform sampler2D tex0;
uniform float amount;
uniform float time;
varying vec2 vTexCoord;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = vec2(vTexCoord.x, 1.0 - vTexCoord.y);
  vec4 color = texture2D(tex0, uv);
  float fine = hash(uv * vec2(16000.0, 12000.0) + time);
  float rough = hash(uv * vec2(2200.0, 2200.0) + vec2(37.0, 91.0 + time * 0.41));
  float grain = (fine - 0.5) * 0.9 + (rough - 0.5) * 0.55;
  vec3 noisy = clamp(color.rgb + vec3(grain * mix(0.25, 1.15, amount)), 0.0, 1.0);
  float luma = dot(noisy, vec3(0.299, 0.587, 0.114));
  float threshold = mix(0.28, 0.74, amount);
  float ink = step(threshold, luma);
  float scanline = step(0.82, fract(uv.y * 900.0)) * 0.2;
  gl_FragColor = vec4(vec3(clamp(ink - scanline, 0.0, 1.0)), color.a);
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
    type: "p5Filter",
    filter: "BLUR",
    min: 0,
    max: 8,
  },
  erode: {
    id: "erode",
    name: "Erode",
    category: "filter",
    type: "p5Filter",
    filter: "ERODE",
  },
  dilate: {
    id: "dilate",
    name: "Dilate",
    category: "filter",
    type: "p5Filter",
    filter: "DILATE",
  },
  gray: {
    id: "gray",
    name: "Gray",
    category: "filter",
    type: "p5Filter",
    filter: "GRAY",
  },
  threshold: {
    id: "threshold",
    name: "Threshold",
    category: "filter",
    type: "p5Filter",
    filter: "THRESHOLD",
    min: 0.05,
    max: 0.95,
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
  return texture2D(tex0, vec2(k.x, 1.0 - k.y));
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
  return texture2D(tex0, vec2(blockUv.x, 1.0 - blockUv.y));
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
    code: null,
  },
});

export function getShaderComponent(id) {
  return SHADER_COMPONENTS[id] || null;
}

export function listShaderComponents() {
  return Object.values(SHADER_COMPONENTS);
}
