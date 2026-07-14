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
uniform float time;
uniform float irisSize;
uniform float pupilSize;
uniform float gazeRange;
uniform float motionSpeed;
uniform float pauseAmount;
uniform float jitter;
uniform float blinkRate;
uniform float lidAmount;
uniform float veinAmount;
varying vec2 vTexCoord;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 randomGaze(float seed) {
  vec2 raw = vec2(hash(vec2(seed, 2.31)), hash(vec2(seed, 7.77))) * 2.0 - 1.0;
  raw.x *= 0.72;
  raw.y *= 0.38;
  return raw;
}

float easeHold(float f, float pause) {
  float movePortion = mix(0.98, 0.08, clamp(pause, 0.0, 1.0));
  float m = clamp(f / movePortion, 0.0, 1.0);
  return m * m * (3.0 - 2.0 * m);
}

float pulse(float f, float start, float end) {
  return smoothstep(start, start + 0.025, f) * (1.0 - smoothstep(end - 0.025, end, f));
}

float shutterBlink(float f) {
  float close = smoothstep(0.015, 0.045, f);
  float open = 1.0 - smoothstep(0.078, 0.125, f);
  return close * open;
}

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

  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 normal = normalize(vec3(p, z));
  vec3 light = normalize(vec3(-0.42, -0.58, 0.72));
  float diffuse = clamp(dot(normal, light) * 0.5 + 0.5, 0.0, 1.0);
  float limbShade = smoothstep(0.02, 0.82, z);
  vec3 sclera = mix(vec3(0.44, 0.42, 0.39), vec3(1.0, 0.96, 0.86), diffuse);
  sclera *= mix(0.50, 1.08, limbShade);
  float speed = max(motionSpeed, 0.05);
  float gazeClock = time * speed * 0.85;
  float gazeSeg = floor(gazeClock);
  float gazeF = fract(gazeClock);
  vec2 gaze = mix(randomGaze(gazeSeg), randomGaze(gazeSeg + 1.0), easeHold(gazeF, pauseAmount));
  vec2 micro = vec2(
    sin(time * 18.7 + hash(vec2(gazeSeg, 1.2)) * 6.28318530718),
    sin(time * 23.1 + hash(vec2(gazeSeg, 8.2)) * 6.28318530718)
  ) * 0.018 * jitter;
  gaze = (gaze + micro) * gazeRange;
  vec3 gazeDir = normalize(vec3(gaze, 1.0));
  vec3 irisRight = normalize(vec3(gazeDir.z, 0.0, -gazeDir.x));
  vec3 irisUp = normalize(cross(irisRight, gazeDir));
  float facing = max(0.001, dot(normal, gazeDir));
  vec2 surfaceUv = vec2(dot(normal, irisRight), dot(normal, irisUp));
  float veinWave = sin((surfaceUv.x * 5.4 + sin(surfaceUv.y * 8.0) * 0.18) * 8.5);
  float veins = smoothstep(0.985, 1.0, veinWave) * smoothstep(0.18, 0.92, r) * smoothstep(0.92, 0.42, r);
  sclera = mix(sclera, vec3(0.55, 0.16, 0.13), veins * 0.13 * veinAmount);
  vec2 irisUv = vec2(dot(normal, irisRight), dot(normal, irisUp)) / facing;
  irisUv.y *= 1.08;
  float irisR = length(irisUv);
  float onCornea = smoothstep(0.80, 0.90, facing);
  float irisScale = max(0.05, irisSize);
  float pupilScale = max(0.05, pupilSize);
  float irisMask = smoothstep(0.850 * irisScale, 0.756 * irisScale, irisR) * onCornea * sphere;
  float pupilMask = smoothstep(0.252 * pupilScale, 0.190 * pupilScale, irisR) * onCornea * sphere;
  float angle = atan(irisUv.y, irisUv.x);
  float irisUnit = irisR / irisScale;
  float fibers = hash(floor(vec2(angle * 44.0, irisUnit * 22.0)));
  float radial = smoothstep(0.806, 0.101, irisUnit);
  float limbus = smoothstep(0.850, 0.720, irisUnit) - smoothstep(0.655, 0.569, irisUnit);
  float innerRing = smoothstep(0.418, 0.310, irisUnit) - smoothstep(0.238, 0.170, irisUnit);
  vec3 iris = mix(vec3(0.045, 0.12, 0.14), vec3(0.12, 0.66, 0.58), radial);
  iris += vec3(0.75, 0.54, 0.28) * innerRing * 0.35;
  iris += vec3(0.95, 0.85, 0.48) * fibers * radial * 0.10;
  iris = mix(iris, vec3(0.01, 0.025, 0.025), limbus * 0.78);
  iris *= mix(0.62, 1.12, diffuse);

  vec3 color = mix(sclera, iris, irisMask);
  color = mix(color, vec3(0.005, 0.003, 0.002), pupilMask);
  float wet = pow(max(dot(reflect(-light, normal), vec3(0.0, 0.0, 1.0)), 0.0), 34.0);
  vec2 glintDelta = p - vec2(-0.32, -0.30);
  float corneaGlint = 1.0 - smoothstep(0.0, 0.0049, dot(glintDelta, glintDelta));
  color += vec3(1.0) * (wet * 0.42 + corneaGlint * 0.55);

  float blinkClock = time * max(blinkRate, 0.0) * 0.55;
  float blinkSeg = floor(blinkClock);
  float blinkPhase = fract(blinkClock);
  float blinkChance = step(0.34, hash(vec2(blinkSeg, 11.1))) * step(0.001, blinkRate);
  float blink = shutterBlink(blinkPhase) * blinkChance;
  blink = max(blink, shutterBlink(blinkPhase - 0.20) * step(0.78, hash(vec2(blinkSeg, 19.4))) * blinkChance);
  float blinkMask = smoothstep(0.02, 0.16, blink);
  float lidCurve = (1.0 - p.x * p.x) * 0.12;
  float lidSoftness = mix(0.024, 0.052, clamp(lidAmount / 1.5, 0.0, 1.0));
  float openHalf = mix(1.08, -0.12, clamp(blink, 0.0, 1.0));
  float upperLid = -openHalf - lidCurve;
  float lowerLid = openHalf + lidCurve * 0.72;
  float lidTop = 1.0 - smoothstep(upperLid - lidSoftness, upperLid + lidSoftness, p.y);
  float lidBottom = smoothstep(lowerLid - lidSoftness, lowerLid + lidSoftness, p.y);
  float lid = max(lidTop, lidBottom) * sphere * blinkMask;
  vec3 lidColor = mix(vec3(0.18, 0.08, 0.065), vec3(0.48, 0.21, 0.18), diffuse);
  color = mix(color, lidColor, lid);

  float edge = smoothstep(1.0, 0.985, r);
  float alpha = sphere * edge;
  gl_FragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
}`,
  },
  terrainFlyover: {
    id: "generator.terrainFlyover",
    name: "Terrain Flyover Generator",
    type: "fragment",
    code: `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float style;
uniform float flightSpeed;
uniform float turn;
uniform float altitude;
uniform float pitch;
uniform float mountainHeight;
uniform float terrainScale;
uniform float lakeLevel;
uniform float viewDistance;
uniform float gridDensity;
uniform float wireWidth;
uniform vec4 waterColor;
uniform vec4 grassColor;
uniform vec4 rockColor;
uniform vec4 snowColor;
uniform vec4 wireColor;
uniform vec4 skyColor;
varying vec2 vTexCoord;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float simplexLikeNoise(vec2 p) {
  const float skew = 0.36602540378;
  const float unskew = 0.2113248654;
  vec2 cell = floor(p + (p.x + p.y) * skew);
  vec2 local0 = p - cell + (cell.x + cell.y) * unskew;
  vec2 corner = local0.x > local0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 local1 = local0 - corner + unskew;
  vec2 local2 = local0 - 1.0 + 2.0 * unskew;
  vec3 weight = max(0.5 - vec3(dot(local0, local0), dot(local1, local1), dot(local2, local2)), 0.0);
  weight *= weight;
  weight *= weight;
  vec3 value = vec3(hash12(cell), hash12(cell + corner), hash12(cell + 1.0));
  return dot(weight, value) / max(dot(weight, vec3(1.0)), 0.0001);
}

float terrainHeight(vec2 world) {
  vec2 p = world * max(terrainScale, 0.02);
  float base = simplexLikeNoise(p * 0.34);
  float ridge = 1.0 - abs(base * 2.0 - 1.0);
  return (base * 1.05 + ridge * ridge * 0.45 - 0.72) * max(mountainHeight, 0.01);
}

float surfaceHeight(vec2 world) {
  return max(terrainHeight(world), lakeLevel);
}

void main() {
  vec2 screen = vTexCoord * 2.0 - 1.0;
  screen.x *= resolution.x / max(resolution.y, 1.0);

  float yaw = clamp(turn, -1.0, 1.0) * 0.72;
  vec3 travel = vec3(sin(yaw), 0.0, cos(yaw));
  vec3 rayForward = normalize(vec3(travel.x, -max(pitch, 0.01), travel.z));
  vec3 rayRight = normalize(cross(vec3(0.0, 1.0, 0.0), rayForward));
  vec3 rayUp = normalize(cross(rayForward, rayRight));
  vec3 rayOrigin = vec3(0.0, max(altitude, 0.1), 0.0) + travel * time * max(flightSpeed, 0.0) * 2.3;
  vec3 rayDirection = normalize(rayForward * 1.28 + rayRight * screen.x + rayUp * screen.y);

  float maximumDistance = mix(18.0, 62.0, clamp(viewDistance, 0.0, 1.5) / 1.5);
  float distanceAlongRay = 0.0;
  float hit = 0.0;
  vec3 position = rayOrigin;
  float rawHeight = 0.0;

  // Height fields can be intersected directly: solve the ray distance from the
  // sampled elevation, then repeat a few times to converge on steep terrain.
  // This avoids the many samples and ridge skipping of a conventional ray march.
  if (rayDirection.y < -0.002) {
    distanceAlongRay = (rayOrigin.y - lakeLevel) / -rayDirection.y;
  }
  for (int step = 0; step < 5; step++) {
    position = rayOrigin + rayDirection * distanceAlongRay;
    rawHeight = terrainHeight(position.xz);
    float targetHeight = max(rawHeight, lakeLevel);
    float nextDistance = (rayOrigin.y - targetHeight) / max(-rayDirection.y, 0.002);
    distanceAlongRay = mix(distanceAlongRay, nextDistance, 0.72);
  }
  position = rayOrigin + rayDirection * distanceAlongRay;
  rawHeight = terrainHeight(position.xz);
  float surfaceDelta = abs(position.y - max(rawHeight, lakeLevel));
  if (rayDirection.y < -0.002 && distanceAlongRay > 0.0 && distanceAlongRay <= maximumDistance && surfaceDelta < 0.16) hit = 1.0;

  vec3 sky = mix(skyColor.rgb * 0.48, min(vec3(1.0), skyColor.rgb * 1.22 + vec3(0.12)), clamp(screen.y * 0.35 + 0.55, 0.0, 1.0));
  bool wireOnly = style > 0.5 && style < 1.5;
  if (hit < 0.5) {
    gl_FragColor = vec4(wireOnly ? vec3(0.0) : sky, 1.0);
    return;
  }

  bool water = rawHeight < lakeLevel + 0.018;
  float normalStep = 0.10 + distanceAlongRay * 0.003;
  float centerHeight = max(rawHeight, lakeLevel);
  float rightHeight = surfaceHeight(position.xz + vec2(normalStep, 0.0));
  float frontHeight = surfaceHeight(position.xz + vec2(0.0, normalStep));
  vec3 normal = water
    ? vec3(0.0, 1.0, 0.0)
    : normalize(vec3(centerHeight - rightHeight, normalStep, centerHeight - frontHeight));
  float slope = 1.0 - clamp(normal.y, 0.0, 1.0);
  vec3 lightDirection = normalize(vec3(-0.42, 0.78, -0.46));
  float lighting = clamp(dot(normal, lightDirection) * 0.55 + 0.58, 0.22, 1.15);

  vec3 shoreColor = mix(rockColor.rgb, snowColor.rgb, 0.58);
  float aboveWater = rawHeight - lakeLevel;
  float grassBand = smoothstep(0.015, 0.20, aboveWater);
  vec3 terrainColor = mix(shoreColor, grassColor.rgb, grassBand);
  float rockBand = clamp(smoothstep(0.30, 0.78, aboveWater) + slope * 0.78, 0.0, 1.0);
  terrainColor = mix(terrainColor, rockColor.rgb, rockBand);
  float snowBand = smoothstep(0.76, 1.16, aboveWater) * smoothstep(0.72, 0.18, slope);
  terrainColor = mix(terrainColor, snowColor.rgb, snowBand);

  vec3 color = terrainColor * lighting;
  if (water) {
    float viewLight = pow(max(dot(reflect(-lightDirection, normal), -rayDirection), 0.0), 22.0);
    color = waterColor.rgb * mix(0.62, 1.08, lighting) + snowColor.rgb * viewLight * 0.42;
  }

  vec2 gridCell = abs(fract(position.xz * max(gridDensity, 0.05)) - 0.5);
  float nearestGrid = min(gridCell.x, gridCell.y);
  float depthRatio = clamp(distanceAlongRay / maximumDistance, 0.0, 1.0);
  float lineSize = max(wireWidth, 0.05) * mix(0.012, 0.036, depthRatio);
  float gridLine = 1.0 - smoothstep(lineSize, lineSize * 1.75, nearestGrid);
  float fog = 1.0 - exp(-distanceAlongRay / max(maximumDistance * 0.42, 0.01));
  vec3 fogColor = wireOnly ? vec3(0.0) : sky * 0.82;
  color = mix(color, fogColor, fog * 0.72);

  if (wireOnly) color = wireColor.rgb * gridLine * (1.0 - fog * 0.78);
  else if (style > 1.5) color = mix(color, wireColor.rgb, gridLine * wireColor.a * (1.0 - fog * 0.66));

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`,
  },
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
  paintDrips: {
    id: "generator.paintDrips",
    name: "Paint Drips Generator",
    type: "shadertoy",
    code: `
/*
 * Adapted from the Simple Paint Drip shader:
 * https://www.shadertoy.com/view/WdBXD1
 * The texture-based random source is replaced with a deterministic hash so the
 * generator is self-contained, and the original unbounded scan is kept finite.
 */

uniform float variation;
uniform float dripSpacing;
uniform float dripDensity;
uniform float dripThickness;
uniform float bounceCurve;
uniform float cycleLength;
uniform float bounceRange;
uniform float fallSpeed;
uniform float ceilingDepth;
uniform float ceilingRoughness;
uniform float edgeSoftness;
uniform vec4 paintColor;
uniform vec4 backgroundColor;
uniform float amount;

float dripHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32 + variation);
  return fract(p.x * p.y);
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  return length(pa - ba * h);
}

float paintMask(vec2 uv) {
  float spacing = max(dripSpacing, 0.002);
  float cycle = max(cycleLength, 0.05);
  float baseColumn = floor(uv.x / spacing);
  float nearestDrip = 999.0;
  float nearestFallingDrip = 999.0;

  // A bounded neighbourhood is much cheaper than the original 1,000-iteration
  // scan while still covering the widest available drip setting.
  for (int i = -24; i <= 24; i++) {
    float column = baseColumn + float(i);
    float x = (column + 0.5) * spacing;
    if (abs(x - uv.x) > dripThickness * 1.6 + spacing) continue;

    float active = step(1.0 - dripDensity, dripHash(vec2(column, variation + 1.7)));
    if (active < 0.5) continue;

    float randomHeight = dripHash(vec2(variation + 4.1, column)) * 0.68 + 0.10;
    float phase = mod(iTime + randomHeight * 10.0, cycle);
    float bounce = -(bounceCurve * phase) * exp(1.0 - bounceCurve * phase);
    float localCeiling = clamp(
      ceilingDepth + (dripHash(vec2(column, variation + 9.3)) - 0.5) * ceilingRoughness,
      0.01,
      0.94
    );
    float tipY = clamp(max(localCeiling, randomHeight + bounce * bounceRange), localCeiling, 0.98);
    float taper = mix(0.34, 1.0, clamp(tipY - uv.y + 0.12, 0.0, 1.0));
    float radius = max(dripThickness * taper, 0.002);

    float attached = segmentDistance(uv, vec2(x, localCeiling), vec2(x, tipY)) / radius;
    nearestDrip = min(nearestDrip, attached);

    float fallingY = tipY + phase * fallSpeed * bounceRange;
    float fallingRadius = radius * mix(0.82, 0.28, clamp(phase / cycle, 0.0, 1.0));
    nearestFallingDrip = min(
      nearestFallingDrip,
      distance(uv, vec2(x, fallingY)) / max(fallingRadius, 0.002)
    );
  }

  float ceilingNoise = dripHash(vec2(floor(uv.x / spacing), variation + 15.7)) - 0.5;
  float ceiling = clamp(ceilingDepth + ceilingNoise * ceilingRoughness, 0.01, 0.94);
  float softness = max(edgeSoftness, 0.0005);
  float ceilingShape = 1.0 - smoothstep(ceiling, ceiling + softness, uv.y);
  float dripShape = 1.0 - smoothstep(1.0, 1.0 + softness * 12.0, min(nearestDrip, nearestFallingDrip));
  return max(ceilingShape, dripShape);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  uv.x *= iResolution.x / max(iResolution.y, 1.0);
  float mask = paintMask(uv);
  vec3 color = mix(backgroundColor.rgb, paintColor.rgb, mask * paintColor.a);
  float alpha = mix(backgroundColor.a, paintColor.a, mask) * amount;
  fragColor = vec4(color, alpha);
}
`,
  },
  cloudyTunnel: {
    id: "generator.cloudyTunnel",
    name: "Cloudy Tunnel Generator",
    type: "shadertoy",
    code: `
/*
 * Created by Stephane Cuillerdier - Aiekick/2015
 * Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License.
 * Original shader: https://www.shadertoy.com/view/XlSSzV
 * Cloud technique derived from Duke: https://www.shadertoy.com/view/MljXDw
 * The iChannel0 noise texture is replaced by procedural value noise so this
 * generator remains self-contained in Portal.
 */

uniform float raySteps;
uniform float cloudDensity;
uniform float cloudScale;
uniform float cloudDetail;
uniform float tunnelRadius;
uniform float tunnelSpread;
uniform float pathBend;
uniform float pathFrequency;
uniform float cameraSway;
uniform float fieldOfView;
uniform float fogStrength;
uniform float vignette;
uniform vec4 tunnelColor;
uniform vec4 fogColor;
uniform float amount;

float tunnelTime;

float tunnelHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float tunnelNoise(vec3 x) {
  vec3 cell = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = tunnelHash(cell + vec3(0.0, 0.0, 0.0));
  float n100 = tunnelHash(cell + vec3(1.0, 0.0, 0.0));
  float n010 = tunnelHash(cell + vec3(0.0, 1.0, 0.0));
  float n110 = tunnelHash(cell + vec3(1.0, 1.0, 0.0));
  float n001 = tunnelHash(cell + vec3(0.0, 0.0, 1.0));
  float n101 = tunnelHash(cell + vec3(1.0, 0.0, 1.0));
  float n011 = tunnelHash(cell + vec3(0.0, 1.0, 1.0));
  float n111 = tunnelHash(cell + vec3(1.0, 1.0, 1.0));
  return -1.0 + 2.4 * mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float tunnelFbm(vec3 p) {
  p += tunnelTime * 5.0;
  float n = tunnelNoise(p * 0.02 * cloudScale) * 1.98;
  if (cloudDetail > 1.5) n += tunnelNoise(p * 0.045 * cloudScale) * 0.62;
  if (cloudDetail > 2.5) n += tunnelNoise(p * 0.09 * cloudScale) * 0.39;
  return n;
}

vec2 tunnelCylinder(vec3 p, vec2 position, float radius, vec3 cosinePath, vec3 sinePath) {
  float cx = cosinePath.x * cos(p.z * cosinePath.y + cosinePath.z);
  float sy = sinePath.x * sin(p.z * sinePath.y + sinePath.z);
  return p.xy - position - vec2(cx, sy);
}

float tunnelMap(vec3 p) {
  float cloud = tunnelFbm(p * 13.0) * cloudDensity;
  float path = pathBend * sin(p.z * pathFrequency);
  float field = 0.0;
  vec2 previousCylinder = vec2(0.0);
  for (int i = 0; i < 6; i++) {
    float index = float(i);
    float x = index;
    float y = 0.88 + 0.0102 * index;
    float z = -0.02 - 0.16 * index;
    float radius = tunnelRadius + 2.45 * index;
    vec2 cylinder = tunnelCylinder(
      p,
      vec2(path, tunnelSpread * index),
      radius,
      vec3(x, y, z),
      vec3(z, x, y)
    );
    if (i > 0) {
      // The source shader builds each section from the current and previous
      // cylinder, with the final pair defining the tunnel field. Treating all
      // six as one union creates the hard four-quadrant pattern.
      field = radius - min(length(cylinder), length(previousCylinder));
    }
    previousCylinder = cylinder;
  }
  return min(field + cloud, p.y + cloud);
}

vec3 tunnelCamera(vec2 uv, vec3 origin, vec3 target) {
  vec3 forward = normalize(target - origin);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 up = normalize(cross(forward, right));
  return normalize(forward + fieldOfView * right * uv.x + fieldOfView * up * uv.y);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  tunnelTime = iTime * 2.5;
  vec2 size = iResolution.xy;
  vec2 uv = (2.0 * fragCoord - size) / min(size.x, size.y);
  vec3 origin = vec3(
    sin(tunnelTime * 0.5) * 5.0 * cameraSway,
    sin(tunnelTime * 0.2) * 15.0 * cameraSway + 15.0,
    tunnelTime * 5.0
  );
  vec3 ray = tunnelCamera(uv, origin, origin + vec3(0.0, 0.0, 1.0));
  vec3 p = origin;
  vec3 color = tunnelColor.rgb;
  float stepSize = 1.0;
  float opticalDepth = 0.0;
  float distanceTravelled = 1.0;
  float divisor = 0.0;

  for (int i = 0; i < 160; i++) {
    if (float(i) >= raySteps || stepSize < 0.01 || distanceTravelled > 500.0 || opticalDepth > 0.95) break;
    stepSize = tunnelMap(p) * (stepSize > 0.001 ? 0.03 : 0.2);
    if (stepSize < 0.15) {
      float weight = (1.0 - opticalDepth) * (0.15 - stepSize) * float(i) / max(raySteps, 1.0);
      color += vec3(weight);
      opticalDepth += weight;
    }
    divisor += 0.012;
    opticalDepth += 0.005;
    stepSize = max(stepSize, 0.05);
    distanceTravelled += stepSize;
    p = origin + ray * distanceTravelled;
  }

  float fogMix = 1.0 - exp(-fogStrength * distanceTravelled * distanceTravelled);
  color = mix(color, fogColor.rgb, fogMix) / max(divisor, 0.15);
  vec2 q = fragCoord / size;
  float edge = pow(max(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.0), 0.25);
  color *= mix(1.0, 0.5 + 0.5 * edge, vignette);
  float alpha = mix(tunnelColor.a, fogColor.a, fogMix) * amount;
  fragColor = vec4(max(color, vec3(0.0)), alpha);
}
`,
  },
  cherenkovVolume: {
    id: "generator.cherenkovVolume",
    name: "Cherenkov Volume Generator",
    type: "shadertoy",
    code: `
/*
 * Created by carandiru / supersinfulsilicon
 * Creative Commons Attribution-ShareAlike 4.0 International License.
 * Original shader: https://www.shadertoy.com/view/l3yBzV
 * Based on: https://www.shadertoy.com/view/tsdfDf
 * Permissions beyond the license: http://bit.ly/supersinfulsilicon
 */

uniform float raySteps;
uniform float zoom;
uniform float rotationSpeed;
uniform float verticalOffset;
uniform float patternScale;
uniform float emissionStrength;
uniform float absorption;
uniform float brightness;
uniform vec4 farColor;
uniform vec4 nearColor;
uniform vec4 backgroundColor;
uniform float amount;

const float CHERENKOV_PI = 3.141592653589793;
const float CHERENKOV_EPSILON = 0.0000001;
const float CHERENKOV_MIN_STEP = 0.00005;

float cherenkovTime;
vec3 cherenkovEye;

vec2 cherenkovIntersectBox(vec3 origin, vec3 direction) {
  vec3 inverseDirection = 1.0 / direction;
  vec3 nearPlane = (vec3(-1.0) - origin) * inverseDirection;
  vec3 farPlane = (vec3(1.0) - origin) * inverseDirection;
  vec3 tmin = min(nearPlane, farPlane);
  vec3 tmax = max(nearPlane, farPlane);
  return vec2(max(tmin.x, max(tmin.y, tmin.z)), min(tmax.x, min(tmax.y, tmax.z)));
}

vec3 cherenkovRotate(vec3 p, float angle) {
  vec2 orientation = vec2(cos(angle), sin(angle));
  return vec3(
    p.x * orientation.x - p.y * orientation.y,
    p.x * orientation.y + p.y * orientation.x,
    p.z
  );
}

float cherenkovDistance(vec3 uv) {
  float safeZ = uv.z >= 0.0 ? max(uv.z, 0.0001) : min(uv.z, -0.0001);
  vec2 x0 = uv.xy * (0.25 * CHERENKOV_PI * patternScale) / safeZ;
  vec2 c = fract(x0 - cherenkovTime);
  vec4 y0;
  y0.xy = abs(c * 2.0 - 1.0);
  y0.zw = y0.xy / (0.5 + pow((2.0 * CHERENKOV_PI) - uv.x, 2.0));
  vec2 j = abs(vec2(sin(cherenkovTime), cos(cherenkovTime)));
  vec4 a = vec4(j.y + y0.xy * j.x, -j.x + y0.xy * j.y) * uv.z;
  vec4 b = vec4(j.y + y0.zw * j.x, -j.x + y0.zw * j.y) * uv.z;
  vec2 y1 = (b.xy - a.zw) + (b.zw - a.xy);
  return length(y1 - y0.xy) - length(y1 - y0.zw);
}

vec3 cherenkovNormal(vec3 p, float dt, float centerDistance) {
  // Forward differences reuse the center sample: four field evaluations per
  // ray step instead of the original seven central-difference evaluations.
  vec3 gradient = vec3(
    cherenkovDistance(p + vec3(dt, 0.0, 0.0)) - centerDistance,
    cherenkovDistance(p + vec3(0.0, dt, 0.0)) - centerDistance,
    cherenkovDistance(p + vec3(0.0, 0.0, dt)) - centerDistance
  );
  return -normalize(gradient + CHERENKOV_EPSILON);
}

vec3 cherenkovCamera(vec3 v) {
  v.y -= verticalOffset;
  vec3 iso = vec3(v.x - v.y - v.z, -v.x - v.y - v.z, v.y - v.z);
  float angle = cherenkovTime * rotationSpeed;
  vec3 eyePosition = vec3(-120.0, -120.0, -84.851589) * 0.1 * zoom;
  cherenkovEye = cherenkovRotate(eyePosition, angle);
  return cherenkovRotate(iso, angle) * eyePosition;
}

float cherenkovRadiation(out float blueEmission, float height, float dt) {
  const float lightSpeed = 299792458.0;
  const float refractiveIndex = 1.33;
  const float totalEnergy = 1000000.0;
  const float particleEnergy = 24000.0;
  float velocity = lightSpeed / refractiveIndex;
  velocity = min(velocity + height * velocity * dt, lightSpeed);
  blueEmission = 1.0 / (refractiveIndex * (velocity / lightSpeed));
  float numerator = particleEnergy * particleEnergy
    * (refractiveIndex * refractiveIndex * velocity * velocity - lightSpeed * lightSpeed);
  float denominator = 4.0 * totalEnergy * CHERENKOV_PI
    * refractiveIndex * refractiveIndex * velocity * velocity;
  return numerator / max(denominator, CHERENKOV_EPSILON);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  cherenkovTime = iTime;
  vec2 uv = fragCoord / iResolution.xy;
  vec2 view = uv * 2.0 - 1.0;
  vec3 rayOrigin = cherenkovCamera(vec3(view, 1.0));
  vec3 rayDirection = normalize(-rayOrigin);
  vec2 hit = cherenkovIntersectBox(rayOrigin, rayDirection);
  if (hit.x > hit.y) {
    fragColor = vec4(backgroundColor.rgb, backgroundColor.a * amount);
    return;
  }

  hit.x = max(hit.x, 0.0);
  float intervalLength = hit.y - hit.x;
  float stepCount = max(raySteps, 1.0);
  float inverseSteps = 1.0 / length(stepCount * abs(rayDirection));
  float dt = max(CHERENKOV_MIN_STEP, intervalLength * inverseSteps);
  vec3 p = cherenkovEye + hit.x * rayDirection + 0.25 * rayDirection * dt;
  vec3 accumulatedLight = vec3(0.0);
  float transmittance = 1.0;
  float intervalRemaining = intervalLength;

  for (int i = 0; i < 199; i++) {
    if (float(i) >= raySteps || intervalRemaining < 0.0 || transmittance < 0.1) break;
    float distanceField = cherenkovDistance(p);
    vec3 normal = cherenkovNormal(p, dt, distanceField);
    float wave = distanceField + 0.5;
    float emitted = 0.0;
    float radiation = cherenkovRadiation(emitted, -distanceField, dt);
    float fresnel = pow(1.0 - max(0.0, dot(rayDirection, normal)), 5.0);
    vec3 radiationColor = mix(farColor.rgb, nearColor.rgb, fresnel);
    vec3 lightColor = radiationColor * emitted * radiation * emissionStrength;
    float scattering = wave;
    float extinction = max(CHERENKOV_EPSILON, scattering * absorption);
    float sigmaDt = exp2(extinction * sqrt(stepCount) * dt * -2.0);
    vec3 incoming = lightColor * scattering;
    vec3 integrated = (incoming - incoming * sigmaDt) / extinction;
    accumulatedLight += transmittance * integrated;
    transmittance *= sigmaDt;
    p += dt * rayDirection;
    intervalRemaining -= dt;
  }

  float volumeAlpha = pow(clamp(1.0 - transmittance, 0.0, 1.0), 2.0);
  vec3 volumeColor = accumulatedLight * (1.0 - transmittance) * brightness;
  vec3 color = mix(backgroundColor.rgb, volumeColor, volumeAlpha);
  float alpha = mix(backgroundColor.a, 1.0, volumeAlpha) * amount;
  fragColor = vec4(max(color, vec3(0.0)), alpha);
}
`,
  },
  biomineLite: {
    id: "generator.biomineLite",
    name: "Biomine Lite Generator",
    type: "shadertoy",
    code: `
/*
 * Biomine by Shane, adapted as a reduced-cost version for Portal.
 * Original shader and full description: https://www.shadertoy.com/view/4lyGzR
 * Related cellular work: https://www.shadertoy.com/view/4scXz2
 * The original is texture-free. This version retains the gyroid geometry while
 * replacing its costly bump, AO, thickness and environment passes with a
 * compact material approximation.
 */

uniform float raySteps;
uniform float viewDistance;
uniform float fieldOfView;
uniform float pathAmount;
uniform float organicMotion;
uniform float gyroidScale;
uniform float tubeThickness;
uniform float tunnelRadius;
uniform float surfaceDetail;
uniform float specularStrength;
uniform float fogStrength;
uniform vec4 tubeColor;
uniform vec4 wallColor;
uniform vec4 glowColor;
uniform vec4 skyColor;
uniform float amount;

float biomineObjectId = 0.0;

mat2 biomineRotation(float angle) {
  vec2 v = sin(vec2(1.570796, 0.0) + angle);
  return mat2(v, -v.y, v.x);
}

vec2 biominePath(float z) {
  float a = sin(z * 0.11);
  float b = cos(z * 0.14);
  return vec2(a * 4.0 - b * 1.5, b * 1.7 + a * 1.5) * pathAmount;
}

float biomineSmoothMaximum(float a, float b, float softness) {
  float h = clamp(0.5 + 0.5 * (a - b) / softness, 0.0, 1.0);
  return mix(b, a, h) + h * (1.0 - h) * softness;
}

float biomineSphereTile(vec3 p) {
  p = fract(p) - 0.5;
  return dot(p, p);
}

float biomineCellTile(vec3 p) {
  vec4 d;
  d.x = biomineSphereTile(p - vec3(0.81, 0.62, 0.53));
  p.xy = vec2(p.y - p.x, p.y + p.x) * 0.7071;
  d.y = biomineSphereTile(p - vec3(0.39, 0.20, 0.11));
  p.yz = vec2(p.z - p.y, p.z + p.y) * 0.7071;
  d.z = biomineSphereTile(p - vec3(0.62, 0.24, 0.06));
  p.xz = vec2(p.z - p.x, p.z + p.x) * 0.7071;
  d.w = biomineSphereTile(p - vec3(0.20, 0.82, 0.64));
  vec4 v;
  v.xy = min(d.xz, d.yw);
  v.z = min(max(d.x, d.y), max(d.z, d.w));
  v.w = max(v.x, v.y);
  return (min(v.z, v.w) - min(v.x, v.y)) * 2.66;
}

float biomineMap(vec3 p) {
  p.xy -= biominePath(p.z);
  p += cos(p.zxy * 1.5707963) * 0.2 * organicMotion;
  vec3 q = p * gyroidScale;
  float gyroid = dot(cos(q * 1.5707963), sin(q.yzx * 1.5707963)) + 1.0;
  float pulse = dot(
    sin(q + iTime * 6.283 * organicMotion + sin(q.yzx * 0.5)),
    vec3(0.033)
  );
  float tubes = gyroid + tubeThickness + pulse;
  float tunnel = biomineSmoothMaximum(
    tunnelRadius - length(p.xy - vec2(0.0, 1.0)) + 0.5 * cos(p.z * 3.14159 / 32.0),
    0.75 - gyroid,
    1.0
  ) - abs(1.5 - gyroid) * 0.375;
  biomineObjectId = step(tunnel, tubes);
  return min(tunnel, tubes);
}

float biomineTrace(vec3 origin, vec3 ray) {
  float travel = 0.0;
  for (int i = 0; i < 72; i++) {
    if (float(i) >= raySteps) break;
    float distanceField = biomineMap(origin + ray * travel);
    if (abs(distanceField) < 0.002 * (travel * 0.125 + 1.0) || travel > viewDistance) break;
    travel += max(abs(distanceField) * 0.55, 0.02);
  }
  return min(travel, viewDistance);
}

vec3 biomineNormal(vec3 p) {
  // Tetrahedral normal: four scene evaluations versus the original six.
  const float e = 0.0025;
  vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * biomineMap(p + k.xyy * e)
    + k.yyx * biomineMap(p + k.yyx * e)
    + k.yxy * biomineMap(p + k.yxy * e)
    + k.xxx * biomineMap(p + k.xxx * e)
  );
}

vec3 biomineMaterial(vec3 p, float objectId) {
  vec3 baseColor = objectId > 0.5 ? wallColor.rgb : tubeColor.rgb;
  if (surfaceDetail < 0.5) return baseColor;
  float scale = objectId > 0.5 ? 1.5 : 2.0;
  float cells = biomineCellTile(p * scale);
  if (surfaceDetail > 1.5) {
    cells = cells * 0.7 + biomineCellTile(p * scale * 3.0) * 0.3;
  }
  float pattern = smoothstep(-0.12, 0.42, cells);
  return baseColor * mix(0.28, 1.1, pattern);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - iResolution.xy * 0.5) / iResolution.y;
  vec3 cameraPosition = vec3(0.0, 1.0, iTime * 2.0);
  vec3 lookAt = cameraPosition + vec3(0.0, 0.0, 0.1);
  vec3 lightPosition = cameraPosition + vec3(0.0, 0.5, 5.0);
  lookAt.xy += biominePath(lookAt.z);
  cameraPosition.xy += biominePath(cameraPosition.z);
  lightPosition.xy += biominePath(lightPosition.z);
  vec3 forward = normalize(lookAt - cameraPosition);
  vec3 right = normalize(vec3(forward.z, 0.0, -forward.x));
  vec3 up = cross(forward, right);
  vec3 ray = normalize(forward + fieldOfView * uv.x * right + fieldOfView * uv.y * up);
  ray.xy = biomineRotation(biominePath(lookAt.z).x / 16.0) * ray.xy;

  float travel = biomineTrace(cameraPosition, ray);
  float savedObjectId = biomineObjectId;
  bool hit = travel < viewDistance;
  vec3 sceneColor = skyColor.rgb;
  float surfaceAlpha = skyColor.a;

  if (hit) {
    vec3 surfacePosition = cameraPosition + ray * travel;
    vec3 normal = biomineNormal(surfacePosition);
    vec3 lightVector = lightPosition - surfacePosition;
    float lightDistance = max(length(lightVector), 0.001);
    vec3 lightDirection = lightVector / lightDistance;
    float attenuation = 1.0 / (1.0 + lightDistance * 0.25);
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float specular = pow(max(dot(reflect(-lightDirection, normal), -ray), 0.0), 32.0);
    float fresnel = pow(clamp(dot(normal, ray) + 1.0, 0.0, 1.0), 4.0);
    float backLight = pow(max(dot(ray, lightDirection), 0.0), 4.0);
    vec3 material = biomineMaterial(surfacePosition, savedObjectId);
    sceneColor = material * (0.5 + diffuse) * attenuation;
    sceneColor += glowColor.rgb * specular * specularStrength;
    sceneColor += material * glowColor.rgb * fresnel * 1.4;
    if (savedObjectId < 0.5) {
      vec3 environment = mix(skyColor.rgb, glowColor.rgb, 0.5 + 0.5 * reflect(ray, normal).y);
      sceneColor += environment * 0.35 + glowColor.rgb * backLight * 0.3;
    }
    surfaceAlpha = mix(savedObjectId < 0.5 ? tubeColor.a : wallColor.a, 1.0, specular * 0.2);
  }

  float distanceRatio = clamp(travel / max(viewDistance, 0.001), 0.0, 1.0);
  float fog = 1.0 - exp(-fogStrength * distanceRatio * distanceRatio * 2.0);
  sceneColor = mix(sceneColor, skyColor.rgb, fog);
  float alpha = mix(surfaceAlpha, skyColor.a, fog) * amount;
  fragColor = vec4(sqrt(clamp(sceneColor, 0.0, 1.0)), alpha);
}
`,
  },
  swayingTrees: {
    id: "generator.swayingTrees",
    name: "Swaying Trees Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float time;
varying vec2 vTexCoord;

float hash(float n) {
  vec3 p3 = fract(vec3(n, n + 19.19, n + 47.77) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float sdSegment2(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  vec2 delta = pa - ba * h;
  return dot(delta, delta);
}

float softLine(vec2 p, vec2 a, vec2 b, float width) {
  float d2 = sdSegment2(p, a, b);
  float outer = width * 2.65;
  return 1.0 - smoothstep(width * width, outer * outer, d2);
}

float leafShape(vec2 p, vec2 center, vec2 scale, float angle, float seed) {
  float c = cos(angle);
  float s = sin(angle);
  vec2 q = p - center;
  q = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
  q /= scale;
  float body = 1.0 - smoothstep(0.5476, 1.0, dot(q, q));
  float taper = smoothstep(-0.98, -0.08, q.y) * (1.0 - smoothstep(0.16, 0.98, q.y));
  float vein = (1.0 - smoothstep(0.012, 0.055, abs(q.x))) * body * 0.14;
  float fleck = hash(floor((q.x + 2.0) * 13.0 + floor((q.y + 2.0) * 17.0) + seed));
  return clamp(body * taper * (0.86 + fleck * 0.18) + vein, 0.0, 1.0);
}

void main() {
  vec2 uv = vTexCoord;
  float aspect = resolution.x / max(resolution.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec3 premul = vec3(0.0);
  float alpha = 0.0;

  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float seed = fi + 1.0;
    float slot = (fi + 0.5) / 7.0;
    float rootJitter = (hash(seed * 3.17) - 0.5) * 0.09;
    vec2 root = vec2(clamp(slot * aspect + rootJitter, 0.06, aspect - 0.06), 0.02);
    float height = mix(0.36, 0.86, hash(seed * 4.71));
    float bend = (hash(seed * 8.63) - 0.5) * 0.12;
    float swayPhase = time * mix(0.42, 0.74, hash(seed * 6.19)) + seed * 2.37;
    float sway = sin(swayPhase) * mix(0.018, 0.052, hash(seed * 5.41));
    vec2 top = root + vec2(bend + sway, height);
    float trunkWidth = mix(0.012, 0.026, hash(seed * 9.83));
    float trunk = softLine(p, root, top, trunkWidth);
    vec3 bark = mix(vec3(0.15, 0.08, 0.035), vec3(0.30, 0.18, 0.08), hash(seed * 2.0));
    premul += bark * trunk * 0.78;
    alpha = max(alpha, trunk * 0.9);

    for (int j = 0; j < 5; j++) {
      float fj = float(j);
      float k = 0.30 + fj * 0.13 + hash(seed * 11.0 + fj) * 0.055;
      vec2 branchRoot = mix(root, top, k);
      float side = mod(fi + fj, 2.0) < 1.0 ? -1.0 : 1.0;
      float branchLength = mix(0.10, 0.24, hash(seed * 13.0 + fj)) * aspect;
      float branchRise = mix(0.045, 0.16, hash(seed * 17.0 + fj));
      float branchSway = sin(swayPhase + fj * 0.9) * 0.030 * (0.5 + k);
      vec2 branchTip = branchRoot + vec2(side * branchLength + branchSway, branchRise);
      float branchMask = softLine(p, branchRoot, branchTip, trunkWidth * mix(0.36, 0.58, k));
      premul += bark * branchMask * 0.62;
      alpha = max(alpha, branchMask * 0.78);

      for (int l = 0; l < 3; l++) {
        float fl = float(l);
        float lk = 0.36 + fl * 0.25 + hash(seed * 23.0 + fj * 5.0 + fl) * 0.12;
        vec2 leafCenter = mix(branchRoot, branchTip, lk);
        leafCenter += vec2(
          sin(swayPhase * 1.24 + fj * 1.7 + fl) * 0.026,
          cos(swayPhase * 0.83 + fl * 2.0) * 0.015
        );
        float leafSize = mix(0.026, 0.064, hash(seed * 29.0 + fj * 3.0 + fl));
        float leafAngle = side * 0.68 + sin(time * 0.8 + seed + fj + fl) * 0.22;
        float leaf = leafShape(p, leafCenter, vec2(leafSize * 0.72, leafSize * 1.18), leafAngle, seed * 31.0 + fj * 7.0 + fl);
        vec3 leafColor = mix(
          vec3(0.10, 0.38, 0.13),
          vec3(0.55, 0.76, 0.22),
          hash(seed * 37.0 + fj * 11.0 + fl)
        );
        leafColor = mix(leafColor, vec3(0.84, 0.62, 0.20), smoothstep(0.62, 1.0, hash(seed * 43.0 + fj * 4.0 + fl)) * 0.35);
        premul += leafColor * leaf * 0.8;
        alpha = max(alpha, leaf * 0.82);
      }
    }
  }

  float ground = 1.0 - smoothstep(0.0, 0.03, uv.y);
  premul += vec3(0.08, 0.16, 0.07) * ground * 0.35;
  alpha = max(alpha, ground * 0.32);
  alpha = clamp(alpha, 0.0, 1.0);
  premul = clamp(premul, 0.0, 1.0) * alpha;
  gl_FragColor = vec4(premul, alpha);
}`,
  },
});

export function getGeneratorShaderComponent(id) {
  return GENERATOR_SHADER_COMPONENTS[id] || null;
}

export function hasGeneratorShader(id) {
  return !!getGeneratorShaderComponent(id);
}
