import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "paintDrips",
    name: "Paint Drips",
    category: "shadertoy",
    runtime: timeParamRuntime("speed"),
    params: [
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("variation", "Variation", { min: 0, max: 10, step: 0.01, defaultValue: 0.25 }),
      createNumberParam("dripSpacing", "Drip spacing", { min: 0.025, max: 0.3, step: 0.001, defaultValue: 0.1, scale: "log" }),
      createNumberParam("dripDensity", "Density", { min: 0, max: 1, step: 0.01, defaultValue: 0.75 }),
      createNumberParam("dripThickness", "Thickness", { min: 0.015, max: 0.45, step: 0.001, defaultValue: 0.18, scale: "log" }),
      createNumberParam("bounceCurve", "Bounce curve", { min: 0.2, max: 4, step: 0.01, defaultValue: 1.5 }),
      createNumberParam("cycleLength", "Cycle length", { min: 0.5, max: 10, step: 0.01, defaultValue: 3.5, scale: "log" }),
      createNumberParam("bounceRange", "Bounce range", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      createNumberParam("fallSpeed", "Fall speed", { min: 0, max: 15, step: 0.01, defaultValue: 6 }),
      createNumberParam("ceilingDepth", "Ceiling depth", { min: 0.02, max: 0.8, step: 0.01, defaultValue: 0.4 }),
      createNumberParam("ceilingRoughness", "Ceiling roughness", { min: 0, max: 0.35, step: 0.01, defaultValue: 0.15 }),
      createNumberParam("edgeSoftness", "Edge softness", { min: 0.001, max: 0.15, step: 0.001, defaultValue: 0.03, scale: "log" }),
      createColorParam("paintColor", "Paint color", "#0000ffff"),
      createColorParam("backgroundColor", "Background color", "#000000ff"),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
  });

const shader = Object.freeze({
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
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
