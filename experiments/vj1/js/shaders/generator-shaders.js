const GENERATOR_SHADER_COMPONENTS = Object.freeze({
  waves: {
    id: "generator.waves",
    name: "Waves Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float time;
varying vec2 vTexCoord;

float waveLine(vec2 uv, float index) {
  float baseY = 0.12 + index * 0.024;
  float y = baseY
    + sin(uv.x * resolution.x * 0.018 + time * (1.4 + index * 0.04)) * 34.0 / max(resolution.y, 1.0)
    + sin(uv.x * resolution.x * 0.006 - time * 0.8 + index) * 58.0 / max(resolution.y, 1.0);
  float distanceToLine = abs(uv.y - y);
  float width = 2.1 / max(resolution.y, 1.0);
  return 1.0 - smoothstep(width, width * 3.0, distanceToLine);
}

void main() {
  vec2 uv = vTexCoord;
  vec3 color = vec3(0.02, 0.024, 0.032);
  for (int i = 0; i < 34; i++) {
    float index = float(i);
    float hue = index / 34.0;
    vec3 stroke = vec3(
      70.0 + 150.0 * sin(time + hue * 6.28),
      100.0 + 110.0 * sin(time * 0.7 + hue * 4.1),
      150.0 + 95.0 * cos(time * 0.8 + hue * 5.0)
    ) / 255.0;
    float line = waveLine(uv, index);
    color = mix(color, stroke, line * 0.82);
  }
  gl_FragColor = vec4(color, 1.0);
}`,
  },
  noise: {
    id: "generator.noise",
    name: "Noise Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float time;
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
  float amplitude = 0.58;
  value += amplitude * simplexNoise(p);
  p = mat2(1.62, 1.18, -1.18, 1.62) * p + vec2(11.7, 4.3);
  amplitude *= 0.46;
  value += amplitude * simplexNoise(p);
  return value * 0.5 + 0.5;
}

void main() {
  vec2 uv = vTexCoord;
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 p = uv * aspect * 5.2 + vec2(time * 0.11, -time * 0.08);
  float n = clamp(fbm(p), 0.0, 1.0);
  float fine = simplexNoise(p * 3.7 + vec2(5.0, time * 0.2)) * 0.08;
  vec3 color = vec3(30.0, 35.0, 70.0) / 255.0 + (n + fine) * vec3(210.0, 120.0, 175.0) / 255.0;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`,
  },
  plasma: {
    id: "generator.plasma",
    name: "Plasma Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float time;
varying vec2 vTexCoord;

void main() {
  vec2 uv = vTexCoord;
  float q = sin((uv.x + time * 0.08) * 18.0)
    + sin((uv.y - time * 0.06) * 21.0)
    + sin((uv.x + uv.y + time * 0.05) * 16.0);
  vec3 color = vec3(
    120.0 + 90.0 * sin(q),
    80.0 + 130.0 * sin(q + 2.1),
    130.0 + 90.0 * sin(q + 4.2)
  ) / 255.0;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`,
  },
});

export function getGeneratorShaderComponent(id) {
  return GENERATOR_SHADER_COMPONENTS[id] || null;
}

export function hasGeneratorShader(id) {
  return !!getGeneratorShaderComponent(id);
}
