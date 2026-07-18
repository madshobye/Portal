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
  galaxy: {
    id: "generator.galaxy",
    name: "Galaxy Generator",
    type: "shadertoy",
    code: `
/*
 * Adapted from "Galaxy3" by FabriceNeyret2 and "Galaxy" by Fabrice NEYRET.
 * Original shader: https://www.shadertoy.com/view/MdBSDc
 * The Shadertoy noise, stars, and keyboard channels are replaced with seeded
 * procedural functions so the generator is self-contained and deterministic.
 */

uniform float speed;
uniform float scale;
uniform float rotation;
uniform float arms;
uniform float spiral;
uniform float compression;
uniform float armContrast;
uniform float galaxyRadius;
uniform float bulbRadius;
uniform float blackHoleRadius;
uniform float dustTexture;
uniform float dustScale;
uniform float starDensity;
uniform float starSize;
uniform float brightness;
uniform float seed;
uniform vec4 galaxyColor;
uniform vec4 bulbColor;
uniform vec4 blackHoleColor;
uniform vec4 backgroundColor;
uniform float amount;

const float GALAXY_PI = 3.1415927;

float galaxyHash12(vec2 point) {
  vec3 value = fract(vec3(point.xyx) * 0.1031 + seed * 0.0137);
  value += dot(value, value.yzx + 33.33);
  return fract((value.x + value.y) * value.z);
}

vec2 galaxyHash22(vec2 point) {
  float first = galaxyHash12(point);
  return vec2(first, galaxyHash12(point + vec2(31.17, 17.53)));
}

float galaxyValueNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = galaxyHash12(cell);
  float b = galaxyHash12(cell + vec2(1.0, 0.0));
  float c = galaxyHash12(cell + vec2(0.0, 1.0));
  float d = galaxyHash12(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

float galaxyDustNoise(vec2 point) {
  float coarse = 1.0 - abs(2.0 * galaxyValueNoise(point) - 1.0);
  float coarseSquared = coarse * coarse;
  float coarseFourth = coarseSquared * coarseSquared;
  float textureMix = clamp((dustTexture - 1.0) * 0.5, 0.0, 1.0);
  coarse = mix(coarse, coarseSquared, min(textureMix * 2.0, 1.0));
  coarse = mix(coarse, coarseFourth, max(textureMix * 2.0 - 1.0, 0.0));

  // The second sample is a uniform quality branch. The original seven-octave
  // texture loop performed up to 28 hashes per pixel; this path performs four
  // at Low and eight at normal/high quality, with no loop or transcendental pow.
  if (renderQuality < 0.34) return coarse;
  float fine = 1.0 - abs(2.0 * galaxyValueNoise(point * 2.03 + vec2(13.7, 7.9)) - 1.0);
  float fineSquared = fine * fine;
  float fineFourth = fineSquared * fineSquared;
  fine = mix(fine, fineSquared, min(textureMix * 2.0, 1.0));
  fine = mix(fine, fineFourth, max(textureMix * 2.0 - 1.0, 0.0));
  return coarse * 0.72 + fine * 0.28;
}

float galaxyStars(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  vec2 randomValue = galaxyHash22(cell + 3.1);
  vec2 starPoint = fract(randomValue * vec2(1.0, 1.618) + vec2(0.17, 0.43));
  float enabled = step(1.0 - clamp(starDensity, 0.0, 1.0), fract(randomValue.x + randomValue.y * 1.73));
  float size = mix(0.006, 0.055, clamp(starSize, 0.0, 1.0));
  vec2 starDelta = local - starPoint;
  float core = smoothstep(size * size, 0.0, dot(starDelta, starDelta));
  float rayX = smoothstep(size * 2.8, 0.0, abs(local.x - starPoint.x));
  float rayY = smoothstep(size * 2.8, 0.0, abs(local.y - starPoint.y));
  return enabled * max(core, rayX * rayY * 0.18);
}

float galaxyFastProfile(float radiusSquared, float profileRadius) {
  float safeRadius = max(profileRadius, 0.001);
  float normalized = radiusSquared / (safeRadius * safeRadius);
  return 1.0 / (1.0 + normalized * (1.0 + normalized));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / max(min(iResolution.x, iResolution.y), 1.0);
  float localScale = max(scale, 0.001);
  float rotationAngle = rotation;
  uv = mat2(cos(rotationAngle), -sin(rotationAngle), sin(rotationAngle), cos(rotationAngle)) * uv;
  uv /= localScale;

  float radiusSquared = max(dot(uv, uv), 0.00000025);
  float angle = atan(uv.y, uv.x);
  float shear = 0.5 * spiral * log(radiusSquared);

  float density = galaxyFastProfile(radiusSquared, galaxyRadius);
  float bulb = galaxyFastProfile(radiusSquared, bulbRadius);
  float blackHole = blackHoleRadius <= 0.0001
    ? 0.0
    : galaxyFastProfile(radiusSquared, blackHoleRadius);

  float armCount = max(floor(arms + 0.5), 1.0);
  float phase = armCount * (angle - shear);
  float phaseCosine = cos(phase);
  float armWave = 0.5 + 0.5 * phaseCosine;
  float armShape = armWave * armWave;
  density *= mix(1.0, 0.2 + 1.8 * armShape, clamp(armContrast, 0.0, 1.0));

  // Compose shear, arm compression, and animation into one rotation. This
  // replaces two independent polar reconstructions from the original port.
  float spiralTurn = shear - compression * phaseCosine + iTime * speed * 0.1;
  float spiralCosine = cos(spiralTurn);
  float spiralSine = sin(spiralTurn);
  vec2 spiralUv = mat2(spiralCosine, -spiralSine, spiralSine, spiralCosine) * uv;

  float dust = galaxyDustNoise(spiralUv * max(dustScale, 0.001));
  float gasTransmission = max(1.0 - dust * density, 0.0);
  gasTransmission *= gasTransmission;
  float stars = galaxyStars(spiralUv * 74.0 + vec2(0.5));

  vec3 galaxyLight = gasTransmission * 1.7 * galaxyColor.rgb + 1.2 * stars;
  vec3 color = mix(backgroundColor.rgb, galaxyLight, clamp(density, 0.0, 1.0));
  color = mix(color, 2.0 * bulbColor.rgb, clamp(1.2 * bulb, 0.0, 1.0));
  color = mix(color, blackHoleColor.rgb, clamp(2.0 * blackHole, 0.0, 1.0));
  color = max(color * brightness, 0.0);

  float featureAlpha = max(
    clamp(density * galaxyColor.a, 0.0, 1.0),
    max(clamp(bulb * bulbColor.a, 0.0, 1.0), clamp(stars, 0.0, 1.0))
  );
  featureAlpha = max(featureAlpha, clamp(blackHole * blackHoleColor.a, 0.0, 1.0));
  float alpha = clamp(mix(featureAlpha, 1.0, backgroundColor.a) * amount, 0.0, 1.0);
  fragColor = vec4(clamp(color, 0.0, 1.0) * alpha, alpha);
}
`,
  },
  lightning: {
    id: "generator.lightning",
    name: "Lightning Generator",
    type: "shadertoy",
    code: `
/*
 * Adapted from https://www.shadertoy.com/view/fsdGWf
 * The landscape, clouds, and opaque background have been removed. The strike,
 * glow, and brief illumination remain as a premultiplied transparent layer.
 */

uniform float frequency;
uniform float duration;
uniform float boltWidth;
uniform float jaggedness;
uniform float positionSpread;
uniform float boltLength;
uniform float glow;
uniform float glare;
uniform float brightness;
uniform float seed;
uniform vec4 strikeColor;
uniform float amount;

float lightningRand(float x) {
  return fract(sin(x + seed * 17.173) * 75154.32912);
}

float lightningNoise(float x) {
  float index = floor(x);
  float phase = fract(x);
  return mix(lightningRand(index), lightningRand(index + 1.0), phase);
}

float lightningPerlin(float x) {
  float result = 0.0;
  float scale = 1.0;
  float weight = 1.0;
  for (int octave = 0; octave < 6; octave++) {
    scale *= 2.0;
    weight *= 0.5;
    result += weight * lightningNoise(scale * x);
  }
  return result;
}

float lightningPath(float y) {
  return jaggedness * (lightningPerlin(2.0 * y) - 0.5);
}

float lightningPlot(vec2 point, float width, bool thickenTurns) {
  float adjustedWidth = width;
  if (thickenTurns) {
    adjustedWidth += 5.0 * abs(lightningPath(point.y + 0.001) - lightningPath(point.y));
  }
  return smoothstep(adjustedWidth, 0.0, abs(lightningPath(point.y) - point.x));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  uv.x = (uv.x * 2.0 - 1.0) * iResolution.x / max(iResolution.y, 1.0);

  float cycleLength = max(duration, 0.001);
  float cycle = iTime / cycleLength + 0.1;
  float strikeIndex = floor(cycle);
  float phase = fract(cycle);
  float eventNoise = lightningNoise(strikeIndex);
  float threshold = 1.0 - clamp(frequency, 0.0, 1.0);
  float occurrence = step(threshold, eventNoise);
  float activeDuration = max(0.0, eventNoise - threshold) / max(frequency, 0.0001);
  float active = occurrence * (1.0 - step(activeDuration, phase));
  float flashActive = occurrence * (1.0 - step(0.1, phase));
  float position = (lightningNoise(strikeIndex + 10.0) - 0.5) * 2.0 * positionSpread;

  float strike = 0.0;
  float localGlow = 0.0;
  float wideGlow = 0.0;
  float flash = 0.0;
  if (active > 0.5) {
    vec2 boltUv = uv;
    boltUv.y += strikeIndex * 2.0;
    boltUv.x -= position;

    float width = max(boltWidth, 0.0001);
    strike = lightningPlot(boltUv, width, true);
    localGlow = lightningPlot(boltUv, width * 4.0, false) * glow;
    wideGlow = lightningPlot(boltUv, width * 150.0, false) * glow;

    float bottom = (1.0 - boltLength) * lightningNoise(strikeIndex + 5.0);
    float lengthMask = smoothstep(
      bottom,
      bottom + 0.05,
      uv.y + lightningPerlin(1.2 * uv.x + 4.0 * bottom) * 0.03
    );
    strike *= lengthMask;
    localGlow *= lengthMask;
    wideGlow *= lengthMask;

  }
  float horizontalLight = smoothstep(5.0, 0.0, abs(uv.x - position));
  flash = flashActive * horizontalLight * glare;

  float boltEnergy = strike * 0.4 + localGlow * 0.15 + wideGlow * 0.3;
  float energy = max(0.0, boltEnergy + flash) * brightness;
  float alpha = clamp(energy * strikeColor.a * amount, 0.0, 1.0);
  vec3 color = mix(strikeColor.rgb, vec3(1.0), clamp(strike * brightness * 0.35, 0.0, 1.0));
  fragColor = vec4(color * alpha, alpha);
}
`,
  },
  sunRays: {
    id: "generator.sunRays",
    name: "Sun Rays Generator",
    type: "shadertoy",
    code: `
uniform float rayCount;
uniform float rayWidth;
uniform float rayLength;
uniform float coreSize;
uniform float lengthVariation;
uniform float edgeSoftness;
uniform float rotation;
uniform float rotationSpeed;
uniform float shimmer;
uniform float shimmerScale;
uniform float shimmerSpeed;
uniform float speed;
uniform float centerX;
uniform float centerY;
uniform float brightness;
uniform float seed;
uniform vec4 rayColorA;
uniform vec4 rayColorB;
uniform vec4 coreColor;
uniform vec4 backgroundColor;
uniform float amount;

float sunRayHash(float value) {
  return fract(sin(value * 91.713 + seed * 17.17) * 43758.5453);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  uv.y = 1.0 - uv.y;
  vec2 p = uv - vec2(centerX, centerY);
  p.x *= iResolution.x / max(iResolution.y, 1.0);
  float radius = length(p);
  float angle = atan(p.y, p.x);
  float clock = iTime * speed;
  float count = max(3.0, floor(rayCount + 0.5));
  float turns = (angle + rotation + clock * rotationSpeed) / 6.28318530718;

  float shimmerWave = sin(radius * shimmerScale * 26.0 - clock * shimmerSpeed * 3.1 + angle * 2.0)
    + 0.55 * sin(radius * shimmerScale * 11.0 + clock * shimmerSpeed * 2.3 - angle * 3.0);
  float angular = turns * count + shimmerWave * shimmer * 0.055;
  float rayIndex = floor(angular);
  float raySeed = sunRayHash(rayIndex);
  float acrossRay = abs(fract(angular) - 0.5) * 2.0;
  float width = clamp(rayWidth * mix(0.68, 1.22, raySeed), 0.005, 0.98);
  float rayMask = 1.0 - smoothstep(width, min(1.0, width + edgeSoftness), acrossRay);

  float localLength = rayLength * mix(1.0 - lengthVariation, 1.0, sunRayHash(rayIndex + 31.7));
  float radialFade = 1.0 - smoothstep(localLength * 0.42, max(localLength, 0.001), radius);
  float innerLift = smoothstep(0.0, max(coreSize * 0.36, 0.002), radius);
  float pulse = mix(1.0, 0.72 + 0.28 * sin(clock * shimmerSpeed * 4.7 + raySeed * 19.0 + radius * 35.0), clamp(shimmer, 0.0, 1.0));
  float rayAlpha = clamp(rayMask * radialFade * innerLift * pulse, 0.0, 1.0);

  float core = coreSize <= 0.0001 ? 0.0 : 1.0 - smoothstep(coreSize * 0.08, coreSize, radius);
  float halo = coreSize <= 0.0001 ? 0.0 : (1.0 - smoothstep(coreSize, coreSize * 3.2, radius)) * 0.28;
  float coreAlpha = clamp(max(core, halo) * coreColor.a, 0.0, 1.0);
  vec3 rayColor = mix(rayColorA.rgb, rayColorB.rgb, raySeed);
  float coloredRayAlpha = rayAlpha * mix(rayColorA.a, rayColorB.a, raySeed);
  float featureAlpha = clamp(coloredRayAlpha + coreAlpha * (1.0 - coloredRayAlpha), 0.0, 1.0);
  vec3 featureColor = mix(rayColor, coreColor.rgb, clamp(core + halo * 0.6, 0.0, 1.0));
  featureColor = clamp(featureColor * brightness, 0.0, 1.0);

  float combinedAlpha = clamp(featureAlpha + backgroundColor.a * (1.0 - featureAlpha), 0.0, 1.0);
  vec3 combinedPremultiplied = featureColor * featureAlpha
    + backgroundColor.rgb * backgroundColor.a * (1.0 - featureAlpha);
  fragColor = vec4(combinedPremultiplied * amount, combinedAlpha * amount);
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
