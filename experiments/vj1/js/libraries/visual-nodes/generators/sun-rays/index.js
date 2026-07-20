import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "sunRays",
    name: "Sun Rays",
    category: "light",
    runtime: {
      timeDependent: (params = {}) => (Number(params.speed) || 0) > 0.0001 && (
        Math.abs(Number(params.rotationSpeed) || 0) > 0.0001 ||
        ((Number(params.shimmer) || 0) > 0.0001 && (Number(params.shimmerSpeed) || 0) > 0.0001)
      ),
    },
    primaryParamIds: ["rayCount", "rayWidth", "rayLength", "shimmer", "rotationSpeed", "rayColorA", "rayColorB", "coreColor"],
    detailParamIds: ["speed", "rotation", "centerX", "centerY", "coreSize", "lengthVariation", "edgeSoftness", "shimmerScale", "shimmerSpeed", "brightness", "seed", "backgroundColor", "amount"],
    params: [
      createNumberParam("rayCount", "Rays", { min: 3, max: 96, step: 1, defaultValue: 28 }),
      createNumberParam("rayWidth", "Ray width", { min: 0.02, max: 0.95, step: 0.01, defaultValue: 0.34 }),
      createNumberParam("rayLength", "Ray length", { min: 0.05, max: 2.5, step: 0.01, defaultValue: 0.9, scale: "log" }),
      createNumberParam("coreSize", "Core size", { min: 0, max: 0.6, step: 0.005, defaultValue: 0.12 }),
      createNumberParam("lengthVariation", "Length variation", { min: 0, max: 0.9, step: 0.01, defaultValue: 0.42 }),
      createNumberParam("edgeSoftness", "Edge softness", { min: 0.001, max: 0.5, step: 0.001, defaultValue: 0.12, scale: "log" }),
      createNumberParam("rotation", "Rotation", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("rotationSpeed", "Rotation speed", { min: -2, max: 2, step: 0.01, defaultValue: 0.08 }),
      createNumberParam("shimmer", "Shimmer", { min: 0, max: 1.5, step: 0.01, defaultValue: 0.48 }),
      createNumberParam("shimmerScale", "Shimmer scale", { min: 0.25, max: 12, step: 0.01, defaultValue: 3, scale: "log" }),
      createNumberParam("shimmerSpeed", "Shimmer speed", { min: 0, max: 6, step: 0.01, defaultValue: 1 }),
      createNumberParam("speed", "Speed", { min: 0, max: 4, step: 0.01, defaultValue: 1 }),
      createNumberParam("centerX", "Center X", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 }),
      createNumberParam("centerY", "Center Y", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 }),
      createNumberParam("brightness", "Brightness", { min: 0, max: 4, step: 0.01, defaultValue: 1.35 }),
      createNumberParam("seed", "Seed", { min: 0, max: 1000, step: 1, defaultValue: 17 }),
      createColorParam("rayColorA", "Ray color A", "#ffd36aff"),
      createColorParam("rayColorB", "Ray color B", "#ff6f91dd"),
      createColorParam("coreColor", "Core color", "#fff7d6ff"),
      createColorParam("backgroundColor", "Background", "#00000000"),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
  });

const shader = Object.freeze({
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
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
