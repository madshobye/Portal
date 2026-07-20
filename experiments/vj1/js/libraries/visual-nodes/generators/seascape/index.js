import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "seascape",
    name: "Seascape",
    category: "shadertoy",
    runtime: timeParamRuntime("speed"),
    params: [
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("waveHeight", "Wave height", { min: 0.05, max: 2.5, step: 0.01, defaultValue: 0.6, scale: "log" }),
      createNumberParam("choppiness", "Choppiness", { min: 0.5, max: 8, step: 0.01, defaultValue: 4 }),
      createNumberParam("waveScale", "Wave scale", { min: 0.03, max: 0.8, step: 0.01, defaultValue: 0.16, scale: "log" }),
      createNumberParam("seaDetail", "Sea detail", { min: 1, max: 5, step: 1, defaultValue: 5 }),
      createNumberParam("raySteps", "Ray steps", { min: 6, max: 32, step: 1, defaultValue: 18 }),
      createNumberParam("cameraHeight", "Camera height", { min: 0.5, max: 10, step: 0.01, defaultValue: 3.5, scale: "log" }),
      createNumberParam("cameraPitch", "Camera pitch", { min: -0.5, max: 1.2, step: 0.01, defaultValue: 0.3 }),
      createNumberParam("cameraMotion", "Camera motion", { min: 0, max: 2, step: 0.01, defaultValue: 1 }),
      createNumberParam("fieldOfView", "Field of view", { min: 0.8, max: 4, step: 0.01, defaultValue: 2 }),
      createNumberParam("horizonCurve", "Horizon curve", { min: 0, max: 0.5, step: 0.01, defaultValue: 0.14 }),
      createColorParam("waterBaseColor", "Deep water", "#00172eff"),
      createColorParam("waterLightColor", "Lit water", "#7a8a5cff"),
      createColorParam("skyTint", "Sky tint", "#ffffffff"),
      createNumberParam("skyBrightness", "Sky brightness", { min: 0, max: 2, step: 0.01, defaultValue: 1 }),
      createNumberParam("sunAngle", "Sun direction", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("sunElevation", "Sun elevation", { min: 0.05, max: 1.5, step: 0.01, defaultValue: 0.9 }),
      createNumberParam("specularStrength", "Highlights", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("saturation", "Saturation", { min: 0, max: 2, step: 0.01, defaultValue: 1 }),
      createNumberParam("gamma", "Gamma", { min: 0.2, max: 1.5, step: 0.01, defaultValue: 0.65 }),
    ],
  });

const shader = Object.freeze({
    id: "generator.seascape",
    name: "Seascape Generator",
    type: "shadertoy",
    code: `
/*
 * "Seascape" by Alexander Alekseev aka TDM - 2014
 * License Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
 * Contact: tdmaav@gmail.com
 * Original shader: https://www.shadertoy.com/view/Ms2SD1
 */

uniform float waveHeight;
uniform float choppiness;
uniform float waveScale;
uniform float seaDetail;
uniform float raySteps;
uniform float cameraHeight;
uniform float cameraPitch;
uniform float cameraMotion;
uniform float fieldOfView;
uniform float horizonCurve;
uniform vec4 waterBaseColor;
uniform vec4 waterLightColor;
uniform vec4 skyTint;
uniform float skyBrightness;
uniform float sunAngle;
uniform float sunElevation;
uniform float specularStrength;
uniform float saturation;
uniform float gamma;

const int NUM_STEPS = 32;
const int ITER_GEOMETRY = 3;
const int ITER_FRAGMENT = 5;
const float PI = 3.141592;
const float EPSILON = 1e-3;
#define EPSILON_NRM (0.1 / iResolution.x)
#define SEA_TIME (1.0 + iTime * 0.8)
const mat2 octave_m = mat2(1.6, 1.2, -1.2, 1.6);

mat3 fromEuler(vec3 ang) {
  vec2 a1 = vec2(sin(ang.x), cos(ang.x));
  vec2 a2 = vec2(sin(ang.y), cos(ang.y));
  vec2 a3 = vec2(sin(ang.z), cos(ang.z));
  mat3 m;
  m[0] = vec3(a1.y * a3.y + a1.x * a2.x * a3.x, a1.y * a2.x * a3.x + a3.y * a1.x, -a2.y * a3.x);
  m[1] = vec3(-a2.y * a1.x, a1.y * a2.y, a2.x);
  m[2] = vec3(a3.y * a1.x * a2.x + a1.y * a3.x, a1.x * a3.x - a1.y * a3.y * a2.x, a2.y * a3.y);
  return m;
}

float hash(vec2 p) {
  float h = dot(p, vec2(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return -1.0 + 2.0 * mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float diffuse(vec3 n, vec3 l, float p) {
  return pow(dot(n, l) * 0.4 + 0.6, p);
}

float specular(vec3 n, vec3 l, vec3 e, float s) {
  float nrm = (s + 8.0) / (PI * 8.0);
  return pow(max(dot(reflect(e, n), l), 0.0), s) * nrm;
}

vec3 getSkyColor(vec3 e) {
  e.y = (max(e.y, 0.0) * 0.8 + 0.2) * 0.8;
  vec3 sky = vec3(pow(1.0 - e.y, 2.0), 1.0 - e.y, 0.6 + (1.0 - e.y) * 0.4) * 1.1;
  return sky * skyTint.rgb * skyBrightness;
}

float sea_octave(vec2 uv, float choppy) {
  uv += noise(uv);
  vec2 wv = 1.0 - abs(sin(uv));
  vec2 swv = abs(cos(uv));
  wv = mix(wv, swv, wv);
  return pow(1.0 - pow(wv.x * wv.y, 0.65), choppy);
}

float map(vec3 p) {
  float freq = waveScale;
  float amp = waveHeight;
  float choppy = choppiness;
  vec2 uv = p.xz;
  uv.x *= 0.75;
  float d;
  float h = 0.0;
  for (int i = 0; i < ITER_GEOMETRY; i++) {
    if (float(i) >= min(seaDetail, 3.0)) break;
    d = sea_octave((uv + SEA_TIME) * freq, choppy);
    d += sea_octave((uv - SEA_TIME) * freq, choppy);
    h += d * amp;
    uv *= octave_m;
    freq *= 1.9;
    amp *= 0.22;
    choppy = mix(choppy, 1.0, 0.2);
  }
  return p.y - h;
}

float map_detailed(vec3 p) {
  float freq = waveScale;
  float amp = waveHeight;
  float choppy = choppiness;
  vec2 uv = p.xz;
  uv.x *= 0.75;
  float d;
  float h = 0.0;
  for (int i = 0; i < ITER_FRAGMENT; i++) {
    if (float(i) >= seaDetail) break;
    d = sea_octave((uv + SEA_TIME) * freq, choppy);
    d += sea_octave((uv - SEA_TIME) * freq, choppy);
    h += d * amp;
    uv *= octave_m;
    freq *= 1.9;
    amp *= 0.22;
    choppy = mix(choppy, 1.0, 0.2);
  }
  return p.y - h;
}

vec3 getSeaColor(vec3 p, vec3 n, vec3 l, vec3 eye, vec3 dist) {
  float fresnel = clamp(1.0 - dot(n, -eye), 0.0, 1.0);
  fresnel = min(fresnel * fresnel * fresnel, 0.5);
  vec3 reflected = getSkyColor(reflect(eye, n));
  vec3 refracted = waterBaseColor.rgb + diffuse(n, l, 80.0) * waterLightColor.rgb * 0.12;
  vec3 color = mix(refracted, reflected, fresnel);
  float atten = max(1.0 - dot(dist, dist) * 0.001, 0.0);
  color += waterLightColor.rgb * (p.y - waveHeight) * 0.18 * atten;
  color += specular(n, l, eye, 600.0 * inversesqrt(max(dot(dist, dist), 0.0001))) * specularStrength;
  return color;
}

vec3 getNormal(vec3 p, float eps) {
  vec3 n;
  n.y = map_detailed(p);
  n.x = map_detailed(vec3(p.x + eps, p.y, p.z)) - n.y;
  n.z = map_detailed(vec3(p.x, p.y, p.z + eps)) - n.y;
  n.y = eps;
  return normalize(n);
}

float heightMapTracing(vec3 ori, vec3 dir, out vec3 p) {
  float tm = 0.0;
  float tx = 1000.0;
  float hx = map(ori + dir * tx);
  if (hx > 0.0) {
    p = ori + dir * tx;
    return tx;
  }
  float hm = map(ori);
  for (int i = 0; i < NUM_STEPS; i++) {
    if (float(i) >= raySteps) break;
    float tmid = mix(tm, tx, hm / (hm - hx));
    p = ori + dir * tmid;
    float hmid = map(p);
    if (hmid < 0.0) {
      tx = tmid;
      hx = hmid;
    } else {
      tm = tmid;
      hm = hmid;
    }
    if (abs(hmid) < EPSILON) break;
  }
  return mix(tm, tx, hm / (hm - hx));
}

vec3 getPixel(vec2 coord, float time) {
  vec2 uv = coord / iResolution.xy;
  uv = uv * 2.0 - 1.0;
  uv.x *= iResolution.x / iResolution.y;
  vec3 ang = vec3(
    sin(time * 3.0) * 0.1 * cameraMotion,
    sin(time) * 0.2 * cameraMotion + cameraPitch,
    time * cameraMotion
  );
  vec3 ori = vec3(0.0, cameraHeight, time * 5.0 * cameraMotion);
  vec3 dir = normalize(vec3(uv.xy, -fieldOfView));
  dir.z += length(uv) * horizonCurve;
  dir = normalize(dir) * fromEuler(ang);
  vec3 sky = getSkyColor(dir);
  float seaBlend = pow(smoothstep(0.0, -0.02, dir.y), 0.2);
  if (seaBlend <= 0.0001) return sky;
  vec3 p;
  heightMapTracing(ori, dir, p);
  vec3 dist = p - ori;
  vec3 n = getNormal(p, dot(dist, dist) * EPSILON_NRM);
  float elevationCos = cos(sunElevation);
  vec3 light = normalize(vec3(sin(sunAngle) * elevationCos, sin(sunElevation), cos(sunAngle) * elevationCos));
  return mix(
    sky,
    getSeaColor(p, n, light, dir, dist),
    seaBlend
  );
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  float time = iTime * 0.3 + iMouse.x * 0.01;
  vec3 color = getPixel(fragCoord, time);
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luminance), color, saturation);
  fragColor = vec4(pow(max(color, vec3(0.0)), vec3(gamma)), 1.0);
}
`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
