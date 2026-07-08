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
