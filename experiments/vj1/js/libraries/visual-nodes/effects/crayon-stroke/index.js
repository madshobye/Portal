import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "crayonStroke",
    name: "Crayon / Pen Stroke",
    category: "texture",
    params: [
      createEnumParam("style", "Style", ["crayon", "pen", "ink"], "crayon"),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("strokeScale", "Stroke scale", { min: 0.25, max: 4, step: 0.01, defaultValue: 1 }),
      createNumberParam("roughness", "Roughness", { min: 0, max: 1, step: 0.01, defaultValue: 0.7 }),
      createNumberParam("contrast", "Contrast", { min: 0.25, max: 3, step: 0.01, defaultValue: 1.35 }),
      createNumberParam("edgeStrength", "Edges", { min: 0, max: 2, step: 0.01, defaultValue: 0.65 }),
      createNumberParam("angle", "Direction", { min: -3.14, max: 3.14, step: 0.01, defaultValue: -0.12 }),
      createNumberParam("sourceColor", "Source color", { min: 0, max: 1, step: 0.01, defaultValue: 0.12 }),
      createColorParam("strokeColor", "Stroke color", "#111111ff"),
      createColorParam("paperColor", "Paper color", "#ffffffff"),
    ],
    code: `
float crayonLuma(vec4 sampleColor) {
  float alpha = sampleColor.a;
  vec3 straight = alpha > 0.0001 ? sampleColor.rgb / alpha : vec3(0.0);
  return dot(straight, vec3(0.299, 0.587, 0.114));
}

float crayonHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float smoothCrayonNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = crayonHash(cell);
  float b = crayonHash(cell + vec2(1.0, 0.0));
  float c = crayonHash(cell + vec2(0.0, 1.0));
  float d = crayonHash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

vec4 runEffect(vec2 uv, vec4 color) {
  if (amount <= 0.0001 || color.a <= 0.0001) return color;
  vec2 pixel = 1.0 / max(resolution, vec2(1.0));
  float luma = crayonLuma(color);
  float edge = abs(crayonLuma(sampleSource(uv + vec2(pixel.x, 0.0))) - crayonLuma(sampleSource(uv - vec2(pixel.x, 0.0))))
    + abs(crayonLuma(sampleSource(uv + vec2(0.0, pixel.y))) - crayonLuma(sampleSource(uv - vec2(0.0, pixel.y))));
  float c = cos(angle);
  float s = sin(angle);
  vec2 p = mat2(c, -s, s, c) * ((uv - 0.5) * vec2(resolution.x / max(resolution.y, 1.0), 1.0));
  float density = mix(95.0, 430.0, clamp(strokeScale, 0.25, 4.0) / 4.0);
  vec2 grainCoord = p * density * vec2(0.42, 1.0);
  float coarse = smoothCrayonNoise(grainCoord + vec2(17.0, 43.0));
  float fine = smoothCrayonNoise(uv * resolution * mix(0.48, 1.8, strokeScale) + vec2(71.0, 19.0));
  float fiber = abs(fract((p.y + (coarse - 0.5) * roughness * 0.035) * density) - 0.5);
  float line = 1.0 - smoothstep(mix(0.18, 0.42, roughness), 0.5, fiber);
  float darkness = pow(clamp(1.0 - luma, 0.0, 1.0), max(0.15, contrast));
  float crayonCoverage = clamp(darkness + edge * edgeStrength, 0.0, 1.0) * mix(0.72, 1.0, line);
  crayonCoverage *= step(mix(0.58, 0.18, crayonCoverage), mix(coarse, fine, 0.55 + roughness * 0.35));
  float penCoverage = clamp(edge * edgeStrength * 2.4 + darkness * line * 0.72, 0.0, 1.0);
  float inkBreak = 1.0 - smoothstep(0.02, max(0.03, roughness * 0.48), abs(fine - 0.5));
  float inkCoverage = clamp((darkness - 0.22 / max(contrast, 0.1)) * 2.2 + edge * edgeStrength, 0.0, 1.0);
  inkCoverage *= mix(1.0, 1.0 - inkBreak * 0.65, roughness);
  float coverage = style < 0.5 ? crayonCoverage : style < 1.5 ? penCoverage : inkCoverage;
  vec3 straight = color.rgb / max(color.a, 0.0001);
  vec3 paper = mix(straight, paperColor.rgb, paperColor.a);
  vec3 ink = mix(strokeColor.rgb, straight * strokeColor.rgb, sourceColor);
  vec3 effected = mix(paper, ink, clamp(coverage * strokeColor.a, 0.0, 1.0));
  return vec4(mix(straight, effected, amount) * color.a, color.a);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
