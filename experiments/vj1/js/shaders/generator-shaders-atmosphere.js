export const ATMOSPHERE_GENERATOR_SHADER_COMPONENTS = Object.freeze({
  fog: {
    id: "generator.fog",
    name: "Fog Generator",
    type: "shadertoy",
    code: `
/*
 * Adapted for transparent real-time layering from:
 * https://www.shadertoy.com/view/XtfSW4
 *
 * Simplex noise by Ian McEwan / Ashima Arts, distributed under the MIT
 * license: https://github.com/ashima/webgl-noise
 *
 * The original eight-octave opaque cloud pass is reduced to a quality-aware
 * maximum of five octaves and emits premultiplied alpha for VJ compositing.
 */

uniform float motionMode;
uniform float density;
uniform float coverage;
uniform float noisiness;
uniform float scale;
uniform float detail;
uniform float fromBelow;
uniform float fromAbove;
uniform float falloff;
uniform float softness;
uniform float driftAngle;
uniform float billow;
uniform float variation;
uniform float seed;
uniform float renderQuality;
uniform vec4 fogColor;
uniform float amount;

vec3 fogMod289(vec3 value) {
  return value - floor(value * (1.0 / 289.0)) * 289.0;
}

vec4 fogMod289(vec4 value) {
  return value - floor(value * (1.0 / 289.0)) * 289.0;
}

vec4 fogPermute(vec4 value) {
  return fogMod289(((value * 34.0) + 1.0) * value);
}

vec4 fogTaylorInvSqrt(vec4 value) {
  return 1.79284291400159 - 0.85373472095314 * value;
}

float fogSimplex3(vec3 point) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 cell = floor(point + dot(point, C.yyy));
  vec3 x0 = point - cell + dot(cell, C.xxx);
  vec3 order = step(x0.yzx, x0.xyz);
  vec3 inverseOrder = 1.0 - order;
  vec3 i1 = min(order.xyz, inverseOrder.zxy);
  vec3 i2 = max(order.xyz, inverseOrder.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  cell = fogMod289(cell);
  vec4 permutation = fogPermute(fogPermute(fogPermute(
    cell.z + vec4(0.0, i1.z, i2.z, 1.0))
    + cell.y + vec4(0.0, i1.y, i2.y, 1.0))
    + cell.x + vec4(0.0, i1.x, i2.x, 1.0));

  float seventh = 1.0 / 7.0;
  vec3 ns = seventh * D.wyz - D.xzx;
  vec4 j = permutation - 49.0 * floor(permutation * ns.z * ns.z);
  vec4 xGrid = floor(j * ns.z);
  vec4 yGrid = floor(j - 7.0 * xGrid);
  vec4 x = xGrid * ns.x + ns.yyyy;
  vec4 y = yGrid * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 normalization = fogTaylorInvSqrt(vec4(
    dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)
  ));
  p0 *= normalization.x;
  p1 *= normalization.y;
  p2 *= normalization.z;
  p3 *= normalization.w;
  vec4 influence = max(0.6 - vec4(
    dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)
  ), 0.0);
  influence *= influence;
  return 42.0 * dot(influence * influence, vec4(
    dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)
  ));
}

float fogFbm(vec3 point) {
  float sum = 0.0;
  float weight = 0.5;
  float normalization = 0.0;
  float octaveBudget = min(clamp(detail, 1.0, 5.0), mix(2.0, 5.0, clamp(renderQuality, 0.0, 1.0)));
  for (int octave = 0; octave < 5; octave++) {
    if (float(octave) < octaveBudget) {
      sum += fogSimplex3(point) * weight;
      normalization += weight;
    }
    point = point * 2.03 + vec3(13.1, 7.7, 5.3);
    weight *= 0.5;
  }
  return sum / max(normalization, 0.001);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  uv.y = 1.0 - uv.y;
  vec2 centered = uv - 0.5;
  centered.x *= iResolution.x / max(iResolution.y, 1.0);

  float animated = step(0.5, motionMode);
  float billowMode = step(1.5, motionMode);
  vec2 driftDirection = vec2(cos(driftAngle), sin(driftAngle));
  float clock = iTime * animated;
  vec2 drift = driftDirection * clock * 0.12;
  float billowAmount = max(clamp(billow, 0.0, 1.0), billowMode) * animated;
  float variationAmount = clamp(variation, 0.0, 1.0);
  float macroNoise = 0.5 + 0.5 * fogSimplex3(vec3(
    centered * max(scale * 0.22, 0.08) + drift * 0.16,
    seed * 0.013 + clock * 0.035
  ));
  float macroCentered = macroNoise - 0.5;
  vec2 billowWarp = vec2(macroCentered, -macroCentered) * billowAmount * 0.42;
  float depthDrift = clock * mix(0.035, 0.16, billowAmount);
  vec3 noisePoint = vec3(centered * max(scale, 0.01) + drift + billowWarp, seed * 0.071 + depthDrift);
  float noiseValue = 0.5 + 0.5 * fogFbm(noisePoint);

  float noiseMix = clamp(noisiness, 0.0, 1.0);
  float fogField = mix(1.0, noiseValue, noiseMix);
  float threshold = mix(0.92, 0.08, clamp(coverage + macroCentered * variationAmount * 0.42, 0.0, 1.0));
  float edge = max(softness, 0.001);
  float cloud = smoothstep(threshold - edge, threshold + edge, fogField);
  float bankMask = mix(1.0, smoothstep(0.2, 0.8, macroNoise), variationAmount);
  float displacedY = uv.y
    + (noiseValue - 0.5) * noisiness * 0.22
    + macroCentered * variationAmount * 0.24;
  float heightEdge = edge / max(falloff, 0.05);
  float lowerEdge = clamp(fromBelow, 0.0, 1.0);
  float upperEdge = clamp(1.0 - fromAbove, 0.0, 1.0);
  float lowerMask = smoothstep(lowerEdge - heightEdge, lowerEdge + heightEdge, displacedY);
  float upperMask = 1.0 - smoothstep(upperEdge - heightEdge, upperEdge + heightEdge, displacedY);
  float heightMask = lowerMask * upperMask;
  float densityVariation = mix(1.0, 0.35 + macroNoise * 1.15, variationAmount);
  float alpha = clamp(cloud * bankMask * heightMask * densityVariation * density * fogColor.a * amount, 0.0, 1.0);
  fragColor = vec4(fogColor.rgb * alpha, alpha);
}
`,
  },
  volumetricClouds: {
    id: "generator.volumetricClouds",
    name: "Volumetric Clouds Generator",
    type: "shadertoy",
    code: `
/*
 * Adapted for transparent real-time layering from Volumetric Clouds Experiment:
 * https://www.shadertoy.com/view/Xttcz2
 *
 * Based on the original volume integration and Ashima Arts simplex-noise ideas.
 * The sun and sky/background pass are intentionally removed. March depth and
 * noise detail are bounded for VJ rendering, and output is premultiplied alpha.
 */

uniform float speed;
uniform float density;
uniform float coverage;
uniform float scale;
uniform float detail;
uniform float raySteps;
uniform float softness;
uniform float thickness;
uniform float altitude;
uniform float cameraTilt;
uniform float fieldOfView;
uniform float windAngle;
uniform float absorption;
uniform float brightness;
uniform float seed;
uniform float renderQuality;
uniform vec4 cloudColor;
uniform vec4 shadowColor;
uniform float amount;

vec3 volumeCloudMod289(vec3 value) {
  return value - floor(value * (1.0 / 289.0)) * 289.0;
}

vec4 volumeCloudMod289(vec4 value) {
  return value - floor(value * (1.0 / 289.0)) * 289.0;
}

vec4 volumeCloudPermute(vec4 value) {
  return volumeCloudMod289(((value * 34.0) + 1.0) * value);
}

vec4 volumeCloudTaylorInvSqrt(vec4 value) {
  return 1.79284291400159 - 0.85373472095314 * value;
}

float volumeCloudSimplex3(vec3 point) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 cell = floor(point + dot(point, C.yyy));
  vec3 x0 = point - cell + dot(cell, C.xxx);
  vec3 order = step(x0.yzx, x0.xyz);
  vec3 inverseOrder = 1.0 - order;
  vec3 i1 = min(order.xyz, inverseOrder.zxy);
  vec3 i2 = max(order.xyz, inverseOrder.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  cell = volumeCloudMod289(cell);
  vec4 permutation = volumeCloudPermute(volumeCloudPermute(volumeCloudPermute(
    cell.z + vec4(0.0, i1.z, i2.z, 1.0))
    + cell.y + vec4(0.0, i1.y, i2.y, 1.0))
    + cell.x + vec4(0.0, i1.x, i2.x, 1.0));

  float seventh = 1.0 / 7.0;
  vec3 ns = seventh * D.wyz - D.xzx;
  vec4 j = permutation - 49.0 * floor(permutation * ns.z * ns.z);
  vec4 xGrid = floor(j * ns.z);
  vec4 yGrid = floor(j - 7.0 * xGrid);
  vec4 x = xGrid * ns.x + ns.yyyy;
  vec4 y = yGrid * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 normalization = volumeCloudTaylorInvSqrt(vec4(
    dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)
  ));
  p0 *= normalization.x;
  p1 *= normalization.y;
  p2 *= normalization.z;
  p3 *= normalization.w;
  vec4 influence = max(0.6 - vec4(
    dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)
  ), 0.0);
  influence *= influence;
  return 42.0 * dot(influence * influence, vec4(
    dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)
  ));
}

float volumeCloudFbm(vec3 point) {
  float sum = 0.0;
  float weight = 0.55;
  float normalization = 0.0;
  float octaveBudget = min(clamp(detail, 1.0, 4.0), mix(1.5, 4.0, clamp(renderQuality, 0.0, 1.0)));
  for (int octave = 0; octave < 4; octave++) {
    if (float(octave) < octaveBudget) {
      sum += abs(volumeCloudSimplex3(point)) * weight;
      normalization += weight;
    }
    point = point * 2.31 + vec3(7.1, 13.7, 5.9);
    weight *= 0.52;
  }
  return sum / max(normalization, 0.001);
}

float volumeCloudHash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  uv.y = 1.0 - uv.y;
  vec2 centered = uv * 2.0 - 1.0;
  centered.x *= iResolution.x / max(iResolution.y, 1.0);

  vec3 rayDirection = normalize(vec3(
    centered.x * fieldOfView,
    centered.y * fieldOfView + cameraTilt,
    1.0
  ));
  if (rayDirection.y <= 0.01 || amount <= 0.0 || density <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  float layerBottom = max(altitude, 0.01);
  float layerDepth = max(thickness, 0.01);
  float startDistance = layerBottom / rayDirection.y;
  float endDistance = (layerBottom + layerDepth) / rayDirection.y;
  float steps = clamp(floor(raySteps + 0.5), 8.0, 48.0);
  float travelStep = (endDistance - startDistance) / steps;
  float verticalStep = layerDepth / steps;
  float jitter = volumeCloudHash(fragCoord + seed);
  vec3 position = rayDirection * (startDistance + travelStep * jitter);
  vec2 windDirection = vec2(cos(windAngle), sin(windAngle));
  vec2 wind = windDirection * iTime * speed * 0.12;
  float threshold = mix(0.72, 0.12, clamp(coverage, 0.0, 1.0));
  float edge = max(softness, 0.001);
  float transmittance = 1.0;
  vec3 premultiplied = vec3(0.0);

  for (int stepIndex = 0; stepIndex < 48; stepIndex++) {
    if (float(stepIndex) >= steps || transmittance < 0.01) break;
    float height = clamp((position.y - layerBottom) / layerDepth, 0.0, 1.0);
    float heightMask = smoothstep(0.0, 0.16, height) * (1.0 - smoothstep(0.72, 1.0, height));
    vec3 noisePoint = vec3(
      position.x * scale + wind.x,
      position.y * scale + seed * 0.031,
      position.z * scale + wind.y
    );
    float field = volumeCloudFbm(noisePoint);
    float sampleDensity = smoothstep(threshold - edge, threshold + edge, field) * heightMask * density;
    float sampleAlpha = 1.0 - exp(-sampleDensity * max(absorption, 0.001) * verticalStep);
    float internalLight = clamp(mix(0.28, 1.0, height) - sampleDensity * 0.08, 0.0, 1.0);
    vec3 sampleColor = mix(shadowColor.rgb, cloudColor.rgb, internalLight);
    float colorAlpha = mix(shadowColor.a, cloudColor.a, internalLight);
    sampleAlpha *= colorAlpha;
    premultiplied += transmittance * sampleAlpha * sampleColor * brightness;
    transmittance *= 1.0 - sampleAlpha;
    position += rayDirection * travelStep;
  }

  float alpha = clamp((1.0 - transmittance) * amount, 0.0, 1.0);
  fragColor = vec4(premultiplied * amount, alpha);
}
`,
  },
});
