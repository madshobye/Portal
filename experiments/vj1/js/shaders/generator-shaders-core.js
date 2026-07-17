export const CORE_GENERATOR_SHADER_COMPONENTS = Object.freeze({
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
uniform float motionMode;
uniform float scale;
uniform float detail;
uniform float roughness;
uniform float distortion;
uniform float movement;
uniform float speed;
uniform float contrast;
uniform float balance;
uniform float ridge;
uniform float seed;
uniform vec4 colorA;
uniform vec4 colorB;
uniform vec4 colorC;
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
  float total = 0.0;
  float amplitude = 1.0;
  mat2 octaveRotation = mat2(1.56, 1.14, -1.14, 1.56);
  for (int octave = 0; octave < 5; octave++) {
    if (float(octave) < detail) {
      value += simplexNoise(p) * amplitude;
      total += amplitude;
    }
    p = octaveRotation * p + vec2(13.17, 7.31);
    amplitude *= roughness;
  }
  return value / max(total, 0.0001) * 0.5 + 0.5;
}

void main() {
  vec2 uv = vTexCoord - 0.5;
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  float dynamicMode = 1.0 - step(2.5, motionMode);
  float clock = time * speed * movement * dynamicMode;
  float seedValue = seed * 0.071;
  float angle = seedValue + clock * (0.18 + movement * 0.09);
  mat2 domainRotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 p = domainRotation * (uv * aspect * scale);

  vec2 orbit = vec2(sin(clock * 0.73 + seedValue), cos(clock * 0.61 - seedValue)) * movement;
  if (motionMode < 0.5) {
    p += orbit * 0.8;
  } else if (motionMode < 1.5) {
    p += vec2(sin(clock * 0.37), sin(clock * 0.53 + 1.7)) * movement * 0.35;
  } else if (motionMode < 2.5) {
    p *= 1.0 + sin(clock * 0.9) * 0.18 * movement;
  }

  vec2 warp = vec2(
    simplexNoise(p * 0.58 + vec2(17.3 + seedValue, clock * 0.31)),
    simplexNoise(p * 0.58 + vec2(-clock * 0.27, 41.7 - seedValue))
  );
  if (motionMode > 0.5 && motionMode < 1.5) {
    vec2 secondWarp = vec2(
      simplexNoise(p * 0.31 + warp * 1.7 + vec2(clock * 0.19)),
      simplexNoise(p * 0.31 - warp.yx * 1.7 - vec2(clock * 0.23))
    );
    warp = mix(warp, secondWarp, 0.65);
  }
  p += warp * distortion;

  float n = clamp(fbm(p), 0.0, 1.0);
  float ridged = 1.0 - abs(n * 2.0 - 1.0);
  n = mix(n, ridged, ridge);
  n = clamp((n - 0.5) * contrast + 0.5 + (0.5 - balance), 0.0, 1.0);

  vec4 palette = n < 0.5
    ? mix(colorA, colorB, smoothstep(0.0, 0.5, n))
    : mix(colorB, colorC, smoothstep(0.5, 1.0, n));
  gl_FragColor = vec4(palette.rgb * palette.a, palette.a);
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
  gradient: {
    id: "generator.gradient",
    name: "Gradient Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform float mode;
uniform float colorCount;
uniform float angle;
uniform float offset;
uniform float softness;
uniform vec4 colorA;
uniform vec4 colorB;
uniform vec4 colorC;
uniform vec4 colorD;
varying vec2 vTexCoord;

vec4 mixPremul(vec4 a, vec4 b, float t) {
  vec4 pa = vec4(a.rgb * a.a, a.a);
  vec4 pb = vec4(b.rgb * b.a, b.a);
  vec4 mixedColor = mix(pa, pb, clamp(t, 0.0, 1.0));
  vec3 rgb = mixedColor.a > 0.0001 ? mixedColor.rgb / mixedColor.a : vec3(0.0);
  return vec4(rgb, mixedColor.a);
}

void main() {
  if (mode > 1.5) {
    gl_FragColor = vec4(colorA.rgb * colorA.a, colorA.a);
    return;
  }

  vec2 uv = vTexCoord - 0.5;
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  uv *= aspect;
  float t = 0.0;
  if (mode > 0.5) {
    float maxRadius = max(length(vec2(0.5 * aspect.x, 0.5)), 0.0001);
    t = length(uv) / maxRadius + offset;
  } else {
    vec2 dir = vec2(cos(angle), sin(angle));
    float span = max(abs(dir.x) * aspect.x + abs(dir.y), 0.0001);
    t = dot(uv, dir) / span + 0.5 + offset;
  }
  t = clamp(t, 0.0, 1.0);
  float shaped = pow(t, max(0.05, softness));
  float count = floor(clamp(colorCount + 0.5, 2.0, 4.0));

  vec4 result = mixPremul(colorA, colorB, shaped);
  if (count > 2.5) {
    float segment = shaped * (count - 1.0);
    vec4 first = mixPremul(colorA, colorB, smoothstep(0.0, 1.0, segment));
    vec4 second = mixPremul(colorB, colorC, smoothstep(1.0, 2.0, segment));
    result = segment < 1.0 ? first : second;
    if (count > 3.5) {
      vec4 third = mixPremul(colorC, colorD, smoothstep(2.0, 3.0, segment));
      result = segment < 2.0 ? result : third;
    }
  }

  gl_FragColor = vec4(result.rgb * result.a, result.a);
}`,
  },
  bezierStrokes: {
    id: "generator.bezierStrokes",
    name: "Bezier Strokes Generator",
    type: "fragment",
    code: `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float style;
uniform float count;
uniform float speed;
uniform float lifetime;
uniform float fade;
uniform float width;
uniform float strokeLength;
uniform float curve;
uniform float direction;
uniform float spread;
uniform float roughness;
uniform vec4 strokeColor;
varying vec2 vTexCoord;

float strokeHash(float n) {
  vec3 p3 = fract(vec3(n, n + 17.17, n + 43.31) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float strokeHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float smoothStrokeNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = strokeHash2(cell);
  float b = strokeHash2(cell + vec2(1.0, 0.0));
  float c = strokeHash2(cell + vec2(0.0, 1.0));
  float d = strokeHash2(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

void main() {
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 p = (vTexCoord - 0.5) * aspect;
  float cs = cos(direction);
  float sn = sin(direction);
  p = mat2(cs, -sn, sn, cs) * p;
  float outputAlpha = 0.0;
  float cycle = max(lifetime, 0.4) + 0.75;
  float clock = time * max(speed, 0.0);

  for (int i = 0; i < 8; i++) {
    float index = float(i);
    if (index >= floor(count + 0.5)) continue;
    float seed = index * 19.73 + 4.17;
    float phase = strokeHash(seed + 2.0) * cycle;
    float age = mod(clock + phase, cycle);
    float active = 1.0 - step(lifetime, age);
    float drawProgress = clamp(age / max(lifetime * 0.34, 0.05), 0.0, 1.0);
    float fadeStart = lifetime * (1.0 - clamp(fade, 0.05, 1.0));
    float lifeAlpha = active * (1.0 - smoothstep(fadeStart, lifetime, age));

    float currentLength = max(0.04, strokeLength) * aspect.x;
    float centerX = (strokeHash(seed + 3.0) - 0.5) * aspect.x * 0.18;
    float along = (p.x - centerX) / currentLength + 0.5;
    float startY = (strokeHash(seed + 5.0) - 0.5) * spread * 0.92;
    float endY = startY + (strokeHash(seed + 7.0) - 0.5) * spread * 0.42;
    float controlY = mix(startY, endY, 0.5) + (strokeHash(seed + 11.0) - 0.5) * curve * 0.72;
    float t = clamp(along, 0.0, 1.0);
    float curveY = mix(mix(startY, controlY, t), mix(controlY, endY, t), t);
    float localWidth = width * mix(0.72, 1.32, strokeHash(seed + floor(t * 9.0) + 13.0));
    float grain = smoothStrokeNoise((p + seed) * resolution.y * mix(0.24, 0.9, roughness));
    float distanceToCurve = abs(p.y - curveY) + (grain - 0.5) * localWidth * roughness * 1.7;
    float edgeSoftness = style > 1.5 ? 0.42 : style > 0.5 ? 0.72 : 0.28;
    float stroke = 1.0 - smoothstep(localWidth, localWidth * (1.0 + edgeSoftness), distanceToCurve);
    float taper = smoothstep(0.0, 0.045, along) * smoothstep(1.0, 0.92, along);
    float reveal = 1.0 - smoothstep(drawProgress, drawProgress + 0.035, along);
    float material = 1.0;
    if (style > 0.5 && style < 1.5) material = smoothstep(roughness * 0.72, 1.0, grain);
    if (style > 1.5) material = mix(0.68, 1.0, smoothstep(0.08, 0.68, grain));
    float strokeAlpha = stroke * taper * reveal * lifeAlpha * material * strokeColor.a;
    outputAlpha = 1.0 - (1.0 - outputAlpha) * (1.0 - clamp(strokeAlpha, 0.0, 1.0));
  }

  gl_FragColor = vec4(strokeColor.rgb * outputAlpha, outputAlpha);
}`,
  },
  fireflies: {
    id: "generator.fireflies",
    name: "Fireflies Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform float count;
uniform float glowSize;
uniform float speed;
uniform float trail;
uniform float brightness;
uniform float twinkle;
uniform vec4 tintColor;
varying vec2 vTexCoord;

float hash(float n) {
  vec3 p3 = fract(vec3(n, n + 19.19, n + 47.77) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(float n) {
  return vec2(hash(n * 17.13), hash(n * 41.71));
}

void main() {
  vec2 uv = vTexCoord;
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 p = uv * aspect;
  vec3 color = vec3(0.0);
  float alpha = 0.0;

  float qualityMultiplier = renderQuality <= 0.5
    ? mix(0.35, 1.0, renderQuality * 2.0)
    : mix(1.0, 1.34, (renderQuality - 0.5) * 2.0);
  float activeCount = clamp(floor(count * qualityMultiplier + 0.5), 1.0, 32.0);
  float motionSpeed = max(speed, 0.0);
  float sizeScale = max(glowSize, 0.05);
  float trailAmount = clamp(trail, 0.0, 1.0);
  float lightAmount = max(brightness, 0.0);
  float twinkleAmount = clamp(twinkle, 0.0, 1.0);

  for (int i = 0; i < 32; i++) {
    float fi = float(i);
    if (fi >= activeCount) continue;
    vec2 seed = hash2(fi + 3.0);
    float flySpeed = mix(0.12, 0.52, hash(fi * 9.7)) * motionSpeed;
    float orbit = time * flySpeed + seed.x * 6.28318530718;
    vec2 base = vec2(seed.x * aspect.x, seed.y);
    vec2 drift = vec2(
      sin(orbit * 0.7 + fi * 1.37) * 0.16 + cos(orbit * 0.31) * 0.08,
      cos(orbit * 0.9 + fi * 0.73) * 0.14 + sin(orbit * 0.43) * 0.06
    );
    vec2 pos = mod(base + drift + vec2(time * motionSpeed * 0.018 * (seed.y - 0.5), time * motionSpeed * 0.012 * (seed.x - 0.5)), aspect);
    float blinkWave = sin(time * motionSpeed * mix(2.0, 5.5, seed.x) + fi * 4.1) * 0.5 + 0.5;
    float blink = mix(1.0, smoothstep(0.22, 1.0, blinkWave), twinkleAmount);
    float size = mix(0.0045, 0.014, seed.y) * sizeScale;
    vec2 delta = p - pos;
    float dist2 = dot(delta, delta);
    float core = exp(-dist2 / (size * size)) * blink;
    float glow = renderQuality > 0.12 ? exp(-dist2 / (size * size * 18.0)) * blink : 0.0;
    float wideGlow = renderQuality > 0.72 ? exp(-dist2 / (size * size * 42.0)) * blink : 0.0;

    float trailGlow = 0.0;
    if (trailAmount > 0.001 && renderQuality > 0.22) {
      vec2 velocity = normalize(vec2(
        cos(orbit * 0.7 + fi * 1.37) * 0.11 - sin(orbit * 0.31) * 0.03,
        -sin(orbit * 0.9 + fi * 0.73) * 0.13 + cos(orbit * 0.43) * 0.03
      ) + vec2(0.001));
      vec2 trailDelta = delta + velocity * 0.075 * sizeScale;
      float along = clamp(dot(-delta, velocity) / 0.12, 0.0, 1.0);
      trailGlow = exp(-abs(dot(trailDelta, vec2(-velocity.y, velocity.x))) * 70.0 / sizeScale) * along * along * blink * 0.18 * trailAmount;
    }

    float light = (glow * 0.48 + wideGlow * 0.12 + core * 1.8 + trailGlow) * lightAmount;
    color += tintColor.rgb * light;
    alpha += (glow * 0.34 + wideGlow * 0.08 + core + trailGlow * 0.75) * tintColor.a;
  }

  alpha = clamp(alpha, 0.0, 1.0);
  color = clamp(color, 0.0, 1.0);
  gl_FragColor = vec4(color * alpha, alpha);
}`,
  },
  eyeball: {
    id: "generator.eyeball",
    name: "3D Eyeball Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float irisSize;
uniform float pupilSize;
uniform float lidAmount;
uniform float veinAmount;
uniform vec3 eyeGazeDir;
uniform vec3 eyeIrisRight;
uniform vec3 eyeIrisUp;
uniform float eyeBlink;
varying vec2 vTexCoord;

void main() {
  vec2 uv = vTexCoord;
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect.x, 1.0) * 2.2;
  float r = length(p);
  float sphere = smoothstep(1.02, 0.98, r);
  if (sphere <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 sphereP = p / max(1.0, r);
  float z = sqrt(max(0.0, 1.0 - dot(sphereP, sphereP)));
  vec3 normal = vec3(sphereP, z);
  const vec3 light = vec3(-0.413594, -0.570912, 0.708902);
  float diffuse = clamp(dot(normal, light) * 0.5 + 0.5, 0.0, 1.0);
  float limbShade = smoothstep(0.02, 0.82, z);
  vec3 sclera = mix(vec3(0.44, 0.42, 0.39), vec3(1.0, 0.96, 0.86), diffuse);
  sclera *= mix(0.50, 1.08, limbShade);
  float facing = max(0.001, dot(normal, eyeGazeDir));
  vec2 surfaceUv = vec2(dot(normal, eyeIrisRight), dot(normal, eyeIrisUp));
  if (veinAmount > 0.001) {
    float veinWave = sin((surfaceUv.x * 5.4 + sin(surfaceUv.y * 8.0) * 0.18) * 8.5);
    float veins = smoothstep(0.985, 1.0, veinWave) * smoothstep(0.18, 0.92, r) * smoothstep(0.92, 0.42, r);
    sclera = mix(sclera, vec3(0.55, 0.16, 0.13), veins * 0.13 * veinAmount);
  }
  vec2 irisUv = surfaceUv / facing;
  irisUv.y *= 1.08;
  float irisR = length(irisUv);
  float onCornea = smoothstep(0.80, 0.90, facing);
  float irisScale = max(0.05, irisSize);
  float pupilScale = max(0.05, pupilSize);
  float irisMask = smoothstep(0.850 * irisScale, 0.756 * irisScale, irisR) * onCornea * sphere;
  float pupilMask = smoothstep(0.252 * pupilScale, 0.190 * pupilScale, irisR) * onCornea * sphere;
  vec3 color = sclera;
  if (irisMask > 0.001) {
    float irisUnit = irisR / irisScale;
    float angleWave = sin((irisUv.x * 0.87 + irisUv.y * 1.13) * 48.0 + floor(irisUnit * 22.0) * 1.73);
    float fibers = angleWave * 0.5 + 0.5;
    float radial = smoothstep(0.806, 0.101, irisUnit);
    float limbus = smoothstep(0.850, 0.720, irisUnit) - smoothstep(0.655, 0.569, irisUnit);
    float innerRing = smoothstep(0.418, 0.310, irisUnit) - smoothstep(0.238, 0.170, irisUnit);
    vec3 iris = mix(vec3(0.045, 0.12, 0.14), vec3(0.12, 0.66, 0.58), radial);
    iris += vec3(0.75, 0.54, 0.28) * innerRing * 0.35;
    iris += vec3(0.95, 0.85, 0.48) * fibers * radial * 0.10;
    iris = mix(iris, vec3(0.01, 0.025, 0.025), limbus * 0.78);
    iris *= mix(0.62, 1.12, diffuse);
    color = mix(color, iris, irisMask);
  }
  color = mix(color, vec3(0.005, 0.003, 0.002), pupilMask);
  float wetBase = max(-light.z + 2.0 * dot(normal, light) * normal.z, 0.0);
  float wet2 = wetBase * wetBase;
  float wet4 = wet2 * wet2;
  float wet8 = wet4 * wet4;
  float wet16 = wet8 * wet8;
  float wet = wet16 * wet16 * wet2;
  vec2 glintDelta = p - vec2(-0.32, -0.30);
  float corneaGlint = 1.0 - smoothstep(0.0, 0.0049, dot(glintDelta, glintDelta));
  color += vec3(1.0) * (wet * 0.42 + corneaGlint * 0.55);

  if (eyeBlink > 0.02) {
    float blinkMask = smoothstep(0.02, 0.16, eyeBlink);
    float lidCurve = (1.0 - p.x * p.x) * 0.12;
    float lidSoftness = mix(0.024, 0.052, clamp(lidAmount / 1.5, 0.0, 1.0));
    float openHalf = mix(1.08, -0.12, clamp(eyeBlink, 0.0, 1.0));
    float upperLid = -openHalf - lidCurve;
    float lowerLid = openHalf + lidCurve * 0.72;
    float lidTop = 1.0 - smoothstep(upperLid - lidSoftness, upperLid + lidSoftness, p.y);
    float lidBottom = smoothstep(lowerLid - lidSoftness, lowerLid + lidSoftness, p.y);
    float lid = max(lidTop, lidBottom) * sphere * blinkMask;
    vec3 lidColor = mix(vec3(0.18, 0.08, 0.065), vec3(0.48, 0.21, 0.18), diffuse);
    color = mix(color, lidColor, lid);
  }

  float edge = smoothstep(1.0, 0.985, r);
  float alpha = sphere * edge;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
}`,
  },
});
