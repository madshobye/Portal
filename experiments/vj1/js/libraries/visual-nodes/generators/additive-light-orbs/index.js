import { createColorParam, createNumberParam } from "../../shared/component-schema.js";
import { timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
  id: "additiveLightOrbs",
  name: "Additive Light Orbs",
  category: "particles",
  description: "Soft additive light bodies arranged around a controllable point with deterministic orbital motion.",
  runtime: timeParamRuntime("speed"),
  primaryParamIds: ["x", "y", "count", "size", "speed"],
  detailParamIds: ["spread", "brightness", "softness", "variation", "color", "accentColor"],
  params: [
    createNumberParam("x", "X", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 }),
    createNumberParam("y", "Y", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 }),
    createNumberParam("count", "Count", { min: 1, max: 20, step: 1, defaultValue: 9 }),
    createNumberParam("size", "Size", { min: 0.01, max: 0.35, step: 0.001, defaultValue: 0.085 }),
    createNumberParam("speed", "Speed", { min: 0, max: 4, step: 0.01, defaultValue: 0.65 }),
    createNumberParam("spread", "Spread", { min: 0, max: 1, step: 0.01, defaultValue: 0.48 }),
    createNumberParam("brightness", "Brightness", { min: 0, max: 4, step: 0.01, defaultValue: 1.35 }),
    createNumberParam("softness", "Softness", { min: 0.1, max: 4, step: 0.01, defaultValue: 1.4 }),
    createNumberParam("variation", "Variation", { min: 0, max: 1, step: 0.01, defaultValue: 0.7 }),
    createColorParam("color", "Color", "#ffda66ff"),
    createColorParam("accentColor", "Accent", "#ff4f92ff"),
  ],
});

const shader = Object.freeze({
  id: "generator.additive-light-orbs",
  name: "Additive Light Orbs shader",
  type: "fragment",
  code: `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float x;
uniform float y;
uniform float count;
uniform float size;
uniform float speed;
uniform float spread;
uniform float brightness;
uniform float softness;
uniform float variation;
uniform vec4 color;
uniform vec4 accentColor;
varying vec2 vTexCoord;

float hash(float n) { return fract(sin(n * 91.3458 + 17.71) * 47453.5453); }

void main() {
  float unitPx = min(resolution.x, resolution.y);
  vec2 p = vTexCoord * resolution / max(unitPx, 1.0);
  vec2 center = vec2(x, y) * resolution / max(unitPx, 1.0);
  vec3 sumColor = vec3(0.0);
  float sumAlpha = 0.0;
  float activeCount = floor(count + 0.5);
  float clock = time * speed;
  for (int i = 0; i < 20; i++) {
    float fi = float(i);
    if (fi >= activeCount) continue;
    float seed = fi * 7.137 + 3.17;
    float angle = clock * mix(0.18, 0.72, hash(seed)) + fi * 2.39996323;
    float orbit = spread * mix(0.12, 0.52, hash(seed + 2.0));
    vec2 pos = center + vec2(cos(angle), sin(angle * mix(0.72, 1.28, hash(seed + 4.0)))) * orbit;
    pos += vec2(sin(clock * 0.37 + seed), cos(clock * 0.29 + seed)) * spread * 0.06 * variation;
    float orbSize = max(size * mix(0.55, 1.35, hash(seed + 6.0)), 0.002);
    float d2 = dot(p - pos, p - pos);
    float core = exp(-d2 / max(orbSize * orbSize * 0.18, 0.000001));
    float glow = exp(-d2 / max(orbSize * orbSize * max(softness, 0.1) * 2.8, 0.000001));
    float light = (core * 1.7 + glow * 0.8) * brightness;
    float mixValue = hash(seed + 9.0);
    sumColor += mix(color.rgb, accentColor.rgb, mixValue) * light;
    sumAlpha += (core + glow * 0.55) * mix(color.a, accentColor.a, mixValue);
  }
  float alpha = clamp(sumAlpha, 0.0, 1.0);
  vec3 rgb = 1.0 - exp(-max(sumColor, vec3(0.0)));
  gl_FragColor = vec4(rgb * alpha, alpha);
}`,
});

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
