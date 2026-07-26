import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "photoGrade",
    name: "Photo Grade",
    category: "color",
    runtime: {
      // Distortion changes which source pixels are sampled and therefore needs
      // the full input. All other Photo Grade operations are evaluated in the
      // full logical coordinate space but are pixel-local, so a regional render
      // is exactly equivalent to cropping the full result.
      roi: {
        mode: "full-frame",
        halo: 0,
        coordinateSpace: "full-frame",
        pixelEquivalentToFullFrame: true,
      },
      roiForParams: (params = {}) => (Number(params.distort) || 0) > 0.0001
        ? {
            mode: "full-frame",
            halo: 0,
            coordinateSpace: "full-frame",
            pixelEquivalentToFullFrame: true,
          }
        : {
            mode: "local",
            halo: 0,
            coordinateSpace: "full-frame",
            pixelEquivalentToFullFrame: true,
          },
      timeDependent: (params = {}) => params.seedMode !== "fixed" && (
        (Number(params.grain) || 0) > 0.0001 ||
        (Number(params.noise) || 0) > 0.0001 ||
        (Number(params.distort) || 0) > 0.0001
      ),
      timeKey: (params = {}, context = {}) => (Number(params.distort) || 0) > 0.0001
        ? context.time
        : Math.floor((Number(context.time) || 0) * 24),
    },
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("invert", "Invert", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("exposure", "Exposure", { min: -2, max: 2, step: 0.01, defaultValue: 0 }),
      createNumberParam("brightness", "Brightness", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("contrast", "Contrast", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("saturation", "Saturation", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("vibrance", "Vibrance", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("temperature", "Temperature", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("tint", "Tint", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("highlights", "Highlights", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("shadows", "Shadows", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("gamma", "Gamma", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("fade", "Fade", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("ditherAmount", "Print dither", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createEnumParam("ditherStyle", "Print style", ["offset color", "offset mono", "laser"], "offset color"),
      createNumberParam("ditherDotSize", "Dot size", { min: 2, max: 20, step: 0.1, defaultValue: 5 }),
      createNumberParam("ditherAngle", "Screen angle", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("ditherInkGain", "Ink gain", { min: 0.5, max: 1.5, step: 0.01, defaultValue: 1 }),
      createNumberParam("grain", "Grain", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("noise", "Noise", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("distort", "Distort", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("vignette", "Vignette", { min: 0, max: 1, step: 0.01, defaultValue: 0 }),
      ...noiseSeedParams(11),
    ],
    code: `
vec3 applySaturation(vec3 rgb, float sat) {
  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(luma), rgb, sat);
}

float photoGradePrintDot(vec2 p, vec2 direction, float coverage, float cellSize) {
  vec2 perpendicular = vec2(-direction.y, direction.x);
  vec2 cell = vec2(dot(p, direction), dot(p, perpendicular)) / max(cellSize, 1.0);
  float radius = sqrt(clamp(coverage, 0.0, 1.0)) * 0.69;
  float distanceToCenter = length(fract(cell) - 0.5);
  float edge = max(0.035, 0.72 / max(cellSize, 2.0));
  return 1.0 - smoothstep(radius - edge, radius + edge, distanceToCenter);
}

float photoGradeBayer2(vec2 p) {
  return p.x * 2.0 + p.y * 3.0 - p.x * p.y * 4.0;
}

float photoGradeBayer4(vec2 pixel) {
  vec2 p = mod(floor(pixel), 4.0);
  vec2 low = mod(p, 2.0);
  vec2 high = floor(p * 0.5);
  return (4.0 * photoGradeBayer2(low) + photoGradeBayer2(high) + 0.5) / 16.0;
}

vec3 photoGradePrintDither(vec3 rgb, vec2 uv) {
  vec2 pixel = uv * resolution;
  float baseCos = cos(ditherAngle);
  float baseSin = sin(ditherAngle);
  pixel = mat2(baseCos, -baseSin, baseSin, baseCos) * pixel;
  float gain = max(0.01, ditherInkGain);

  if (ditherStyle < 0.5) {
    float key = 1.0 - max(rgb.r, max(rgb.g, rgb.b));
    float remaining = max(0.0001, 1.0 - key);
    vec3 cmy = clamp((1.0 - rgb - key) / remaining, 0.0, 1.0);
    float cyan = photoGradePrintDot(pixel, vec2(0.965926, 0.258819), cmy.x * gain, ditherDotSize);
    float magenta = photoGradePrintDot(pixel, vec2(0.258819, 0.965926), cmy.y * gain, ditherDotSize);
    float yellow = photoGradePrintDot(pixel, vec2(1.0, 0.0), cmy.z * gain, ditherDotSize);
    float black = photoGradePrintDot(pixel, vec2(0.707107, 0.707107), key * gain, ditherDotSize);
    return clamp(vec3(1.0 - cyan, 1.0 - magenta, 1.0 - yellow) * (1.0 - black), 0.0, 1.0);
  }

  float ink = clamp((1.0 - dot(rgb, vec3(0.2126, 0.7152, 0.0722))) * gain, 0.0, 1.0);
  if (ditherStyle < 1.5) {
    float black = photoGradePrintDot(pixel, vec2(0.707107, 0.707107), ink, ditherDotSize);
    return vec3(1.0 - black);
  }
  float toner = step(photoGradeBayer4(pixel / max(ditherDotSize * 0.25, 1.0)), ink);
  return vec3(1.0 - toner);
}

vec4 runEffect(vec2 uv, vec4 color) {
  if (amount <= 0.0001) return color;
  vec2 gradeUv = uv;
  float noiseClock = seedMode < 0.5 ? time : seed;
  float noiseFrame = seed + (seedMode < 0.5 ? floor(time * 24.0) : 0.0);
  if (distort > 0.001) {
    float n = hash(floor(uv * resolution * 0.12) + vec2(noiseFrame * 11.0, noiseFrame * 7.0));
    vec2 wobble = vec2(
      sin((uv.y + n) * 38.0 + noiseClock * 2.2),
      cos((uv.x - n) * 31.0 - noiseClock * 1.7)
    ) * distort * 0.006;
    gradeUv = clamp(uv + wobble, vec2(0.0), vec2(1.0));
    color = sampleSource(gradeUv);
  }

  float alpha = color.a;
  vec3 original = alpha > 0.0001 ? color.rgb / alpha : color.rgb;
  vec3 rgb = original;
  if (abs(exposure) > 0.001) rgb *= exp2(exposure);
  if (abs(brightness) > 0.001) rgb += brightness;
  if (abs(contrast) > 0.001) rgb = (rgb - 0.5) * (1.0 + contrast * 1.45) + 0.5;

  if (abs(shadows) > 0.001 || abs(highlights) > 0.001) {
    float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float shadowMask = 1.0 - smoothstep(0.18, 0.74, luma);
    float highlightMask = smoothstep(0.35, 0.92, luma);
    rgb += shadows * shadowMask * 0.38;
    rgb += highlights * highlightMask * 0.34;
  }

  if (abs(temperature) > 0.001 || abs(tint) > 0.001) {
    rgb.r += temperature * 0.10;
    rgb.b -= temperature * 0.10;
    rgb.g += tint * 0.075;
    rgb.r -= tint * 0.035;
    rgb.b -= tint * 0.035;
  }

  if (abs(saturation) > 0.001) {
    float sat = 1.0 + saturation * 1.35;
    rgb = applySaturation(rgb, max(0.0, sat));
  }
  if (abs(vibrance) > 0.001) {
    float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float chroma = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
    float vibranceBoost = vibrance * (1.0 - clamp(chroma, 0.0, 1.0)) * (1.0 - smoothstep(0.72, 1.0, luma));
    rgb = applySaturation(rgb, max(0.0, 1.0 + vibranceBoost * 1.4));
  }

  if (abs(gamma) > 0.001) {
    float gammaValue = exp2(-gamma);
    rgb = pow(max(rgb, vec3(0.0)), vec3(gammaValue));
  }
  if (fade > 0.001) rgb = mix(rgb, rgb * 0.82 + vec3(0.055), fade);
  if (invert > 0.001) rgb = mix(rgb, 1.0 - rgb, invert);

  if (grain > 0.001) {
    float grainValue = cachedNoise(uv * resolution + vec2(noiseFrame * 37.0, noiseFrame * 19.0)) - 0.5;
    rgb += grainValue * grain * 0.16;
  }
  if (noise > 0.001) {
    float coarseNoise = cachedNoise(floor(uv * resolution * 0.14) + vec2(noiseFrame * 3.0, -noiseFrame * 2.0)) - 0.5;
    rgb += coarseNoise * noise * 0.18;
  }

  if (ditherAmount > 0.001) {
    rgb = mix(rgb, photoGradePrintDither(clamp(rgb, 0.0, 1.0), gradeUv), ditherAmount);
  }

  if (vignette > 0.001) {
    vec2 p = (uv - 0.5) * vec2(resolution.x / max(resolution.y, 1.0), 1.0);
    float vignetteMask = 1.0 - smoothstep(0.0324, 0.7396, dot(p, p));
    rgb *= mix(1.0, mix(0.62, 1.0, vignetteMask), vignette);
  }

  rgb = clamp(rgb, 0.0, 1.0);
  vec3 mixed = mix(original, rgb, amount);
  return vec4(mixed * alpha, alpha);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
