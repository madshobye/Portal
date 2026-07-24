import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "volumetricClouds",
    name: "Volumetric Clouds",
    category: "atmosphere",
    runtime: timeParamRuntime("speed"),
    primaryParamIds: ["density", "coverage", "scale", "raySteps", "cloudColor", "shadowColor"],
    detailParamIds: ["speed", "detail", "softness", "thickness", "altitude", "cameraTilt", "fieldOfView", "windAngle", "absorption", "brightness", "seed", "amount"],
    params: [
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 0.18 }),
      createNumberParam("density", "Density", { min: 0, max: 3, step: 0.01, defaultValue: 1.15 }),
      createNumberParam("coverage", "Coverage", { min: 0, max: 1, step: 0.01, defaultValue: 0.52 }),
      createNumberParam("scale", "Scale", { min: 0.2, max: 8, step: 0.01, defaultValue: 1.4, scale: "log" }),
      createNumberParam("detail", "Detail", {
        min: 1, max: 4, step: 1, defaultValue: 3,
        renderQualityScaling: { minimum: 0.5, maximum: 1.2 },
      }),
      createNumberParam("raySteps", "Volume steps", {
        min: 8, max: 48, step: 1, defaultValue: 28,
        renderQualityScaling: { minimum: 0.35, maximum: 1.5 },
      }),
      createNumberParam("softness", "Edge softness", { min: 0.005, max: 0.3, step: 0.005, defaultValue: 0.08, scale: "log" }),
      createNumberParam("thickness", "Layer thickness", { min: 0.1, max: 2.5, step: 0.01, defaultValue: 0.9, scale: "log" }),
      createNumberParam("altitude", "Layer altitude", { min: 0.05, max: 2, step: 0.01, defaultValue: 0.35, scale: "log" }),
      createNumberParam("cameraTilt", "Camera tilt", { min: 0.05, max: 1.5, step: 0.01, defaultValue: 0.62 }),
      createNumberParam("fieldOfView", "Field of view", { min: 0.25, max: 1.5, step: 0.01, defaultValue: 0.82 }),
      createNumberParam("windAngle", "Wind angle", { min: -3.1416, max: 3.1416, step: 0.01, defaultValue: 0 }),
      createNumberParam("absorption", "Absorption", { min: 0.1, max: 6, step: 0.01, defaultValue: 1.6, scale: "log" }),
      createNumberParam("brightness", "Brightness", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("seed", "Seed", { min: 0, max: 1000, step: 1, defaultValue: 17 }),
      createColorParam("cloudColor", "Cloud color", "#f2f5f7e8"),
      createColorParam("shadowColor", "Shadow color", "#677384d8"),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
  });

const shader = Object.freeze({
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
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
