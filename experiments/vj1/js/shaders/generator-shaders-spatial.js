export const SPATIAL_GENERATOR_SHADER_COMPONENTS = Object.freeze({
  shadertoyBaseWarp: {
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
  },
  cellularCircles: {
    id: "generator.cellularCircles",
    name: "Cellular Circles Generator",
    type: "shadertoy",
    code: `
/*
 * "Cellular Circles" by Jan Mróz (jaszunio15)
 * License: Creative Commons Attribution 3.0 (CC BY 3.0)
 * Original shader: https://www.shadertoy.com/view/tsfGDM
 * Rotation and random optimizations credited by the author to FabriceNyret2.
 * Adapted for VJ1 with controls, premultiplied alpha, and a single nearest-pair pass.
 */

uniform float scale;
uniform float searchRadius;
uniform float orbitRadius;
uniform float cellMotion;
uniform float rotationSpeed;
uniform float offsetX;
uniform float offsetY;
uniform float circularity;
uniform float glowPower;
uniform vec4 cellColor;
uniform vec4 backgroundColor;
uniform float amount;

const float CELL_DOUBLE_PI = 6.283185;

vec2 cellularRandom(vec2 value) {
  return fract(sin(value * mat2(0.7400775, -0.6725215, 0.1241045, 0.9922691)) * vec2(541.9283, 638.1429));
}

vec2 cellularCenter(vec2 root) {
  vec2 randomValue = cellularRandom(root);
  float angle = iTime * cellMotion * randomValue.x * 0.3;
  return root + vec2(cos(angle), sin(angle)) * randomValue.y * orbitRadius;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / min(iResolution.x, iResolution.y);
  uv += vec2(offsetX, offsetY);
  float rotation = iTime * rotationSpeed;
  uv = mat2(cos(rotation), sin(rotation), -sin(rotation), cos(rotation)) * uv;
  uv *= scale;

  vec2 root = floor(uv);
  float nearestDistance = 99999.0;
  float secondDistance = 99999.0;
  for (int x = -5; x <= 5; x++) {
    for (int y = -5; y <= 5; y++) {
      if (abs(float(x)) > searchRadius || abs(float(y)) > searchRadius) continue;
      vec2 center = cellularCenter(root + vec2(float(x), float(y)));
      vec2 delta = uv - center;
      float distanceSquared = dot(delta, delta);
      if (distanceSquared < nearestDistance) {
        secondDistance = nearestDistance;
        nearestDistance = distanceSquared;
      } else if (distanceSquared < secondDistance && distanceSquared > nearestDistance) {
        secondDistance = distanceSquared;
      }
    }
  }

  float centralDistance = (sqrt(nearestDistance) + sqrt(secondDistance)) * 0.5;
  centralDistance = mix(centralDistance, min(centralDistance, 0.5), circularity);
  float wave = sin(fract(centralDistance) * CELL_DOUBLE_PI) * 0.5 + 0.5;
  float effect = pow(max(wave, 0.0), glowPower);
  vec4 color = mix(backgroundColor, cellColor, effect);
  float alpha = clamp(color.a * amount, 0.0, 1.0);
  fragColor = vec4(clamp(color.rgb, 0.0, 1.0) * alpha, alpha);
}
`,
  },
  seascape: {
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
  },
});
