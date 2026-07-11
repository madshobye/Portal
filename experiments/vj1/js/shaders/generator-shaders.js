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
  return fract(sin(n) * 43758.5453123);
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

  float activeCount = clamp(floor(count + 0.5), 1.0, 24.0);
  float motionSpeed = max(speed, 0.0);
  float sizeScale = max(glowSize, 0.05);
  float trailAmount = clamp(trail, 0.0, 1.0);
  float lightAmount = max(brightness, 0.0);
  float twinkleAmount = clamp(twinkle, 0.0, 1.0);

  for (int i = 0; i < 24; i++) {
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
    float glow = exp(-dist2 / (size * size * 18.0)) * blink;
    float core = exp(-dist2 / (size * size)) * blink;

    float trailGlow = 0.0;
    if (trailAmount > 0.001) {
      vec2 velocity = normalize(vec2(
        cos(orbit * 0.7 + fi * 1.37) * 0.11 - sin(orbit * 0.31) * 0.03,
        -sin(orbit * 0.9 + fi * 0.73) * 0.13 + cos(orbit * 0.43) * 0.03
      ) + vec2(0.001));
      vec2 trailDelta = delta + velocity * 0.075 * sizeScale;
      float along = clamp(dot(-delta, velocity) / 0.12, 0.0, 1.0);
      trailGlow = exp(-abs(dot(trailDelta, vec2(-velocity.y, velocity.x))) * 70.0 / sizeScale) * along * along * blink * 0.18 * trailAmount;
    }

    float light = (glow * 0.48 + core * 1.8 + trailGlow) * lightAmount;
    color += tintColor.rgb * light;
    alpha += (glow * 0.34 + core + trailGlow * 0.75) * tintColor.a;
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
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
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
  float corneaGlint = smoothstep(0.07, 0.0, length(p - vec2(-0.32, -0.30)));
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
  return fract(sin(n) * 43758.5453123);
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  return length(pa - ba * h);
}

float softLine(vec2 p, vec2 a, vec2 b, float width) {
  float d = sdSegment(p, a, b);
  return 1.0 - smoothstep(width, width * 2.65, d);
}

float leafShape(vec2 p, vec2 center, vec2 scale, float angle, float seed) {
  float c = cos(angle);
  float s = sin(angle);
  vec2 q = p - center;
  q = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
  q /= scale;
  float body = 1.0 - smoothstep(0.74, 1.0, length(q));
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
