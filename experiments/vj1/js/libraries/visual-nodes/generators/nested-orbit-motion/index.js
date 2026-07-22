import { createColorParam, createEnumParam, createNumberParam } from "../../shared/component-schema.js";
import { timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
  id: "nestedOrbitMotion",
  name: "Nested Noise Orbit",
  category: "motion",
  description: "Visualizes reusable nested orbit and smooth-noise coordinate motion around a parameter-controlled center.",
  runtime: timeParamRuntime("speed"),
  primaryParamIds: ["mode", "x", "y", "count", "speed"],
  detailParamIds: ["radius", "secondaryRadius", "noiseAmount", "trail", "pointSize", "color", "accentColor"],
  params: [
    createEnumParam("mode", "Motion", ["nested orbit", "noise orbit", "spiral"], "nested orbit"),
    createNumberParam("x", "Center X", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 }),
    createNumberParam("y", "Center Y", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 }),
    createNumberParam("count", "Bodies", { min: 1, max: 16, step: 1, defaultValue: 8 }),
    createNumberParam("speed", "Speed", { min: 0, max: 4, step: 0.01, defaultValue: 0.8 }),
    createNumberParam("radius", "Orbit radius", { min: 0, max: 0.7, step: 0.001, defaultValue: 0.28 }),
    createNumberParam("secondaryRadius", "Nested radius", { min: 0, max: 0.4, step: 0.001, defaultValue: 0.09 }),
    createNumberParam("noiseAmount", "Noise amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.45 }),
    createNumberParam("trail", "Trail", { min: 0, max: 1, step: 0.01, defaultValue: 0.58 }),
    createNumberParam("pointSize", "Point size", { min: 0.002, max: 0.08, step: 0.001, defaultValue: 0.014 }),
    createColorParam("color", "Color", "#59e2d3ff"),
    createColorParam("accentColor", "Accent", "#ff4f92ff"),
  ],
});

const shader = Object.freeze({
  id: "generator.nested-orbit-motion",
  name: "Nested Noise Orbit shader",
  type: "fragment",
  code: `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float mode;
uniform float x;
uniform float y;
uniform float count;
uniform float speed;
uniform float radius;
uniform float secondaryRadius;
uniform float noiseAmount;
uniform float trail;
uniform float pointSize;
uniform vec4 color;
uniform vec4 accentColor;
varying vec2 vTexCoord;

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453123); }
float valueNoise(float v) {
  float i = floor(v);
  float f = fract(v);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash(i), hash(i + 1.0), f);
}
vec2 orbitPoint(float clock, float seed, float body) {
  float outer = clock * (0.48 + body * 0.025) + seed;
  float inner = -clock * (1.17 + body * 0.041) + seed * 2.13;
  vec2 point = vec2(cos(outer), sin(outer)) * radius;
  point += vec2(cos(inner), sin(inner)) * secondaryRadius;
  if (mode > 0.5 && mode < 1.5) {
    vec2 n = vec2(valueNoise(clock * 0.31 + seed), valueNoise(clock * 0.37 + seed + 19.1)) - 0.5;
    point += n * noiseAmount * 0.34;
  }
  if (mode > 1.5) {
    float spiral = 0.35 + 0.65 * (0.5 + 0.5 * sin(clock * 0.31 + seed));
    point *= spiral;
  }
  return point;
}

void main() {
  float unitPx = min(resolution.x, resolution.y);
  vec2 p = vTexCoord * resolution / max(unitPx, 1.0);
  vec2 center = vec2(x, y) * resolution / max(unitPx, 1.0);
  float active = floor(count + 0.5);
  float clock = time * speed;
  vec3 sumColor = vec3(0.0);
  float sumAlpha = 0.0;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    if (fi >= active) continue;
    float seed = fi * 2.39996323;
    for (int j = 0; j < 8; j++) {
      float fj = float(j);
      float age = fj / 7.0;
      if (age > trail + 0.001 && fj > 0.0) continue;
      vec2 pos = center + orbitPoint(clock - fj * 0.055, seed, fi);
      float r = max(pointSize * mix(1.0, 0.3, age), 0.001);
      float d = length(p - pos);
      float dotAlpha = (1.0 - smoothstep(r, r + 1.5 / max(unitPx, 1.0), d)) * (1.0 - age) + exp(-d * d / max(r * r * 8.0, 0.000001)) * 0.2;
      vec4 c = mix(color, accentColor, fi / max(active - 1.0, 1.0));
      sumColor += c.rgb * dotAlpha * c.a;
      sumAlpha += dotAlpha * c.a;
    }
  }
  float alpha = clamp(sumAlpha, 0.0, 1.0);
  vec3 rgb = 1.0 - exp(-sumColor);
  gl_FragColor = vec4(rgb * alpha, alpha);
}`,
});

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
