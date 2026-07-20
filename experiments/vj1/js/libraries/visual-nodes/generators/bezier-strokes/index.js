import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "bezierStrokes",
    name: "Bezier Strokes",
    category: "motion",
    runtime: timeParamRuntime("speed"),
    params: [
      createEnumParam("style", "Style", ["pen", "crayon", "brush"], "brush"),
      createNumberParam("count", "Strokes", { min: 1, max: 8, step: 1, defaultValue: 5 }),
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 0.8 }),
      createNumberParam("lifetime", "Lifetime", { min: 0.4, max: 6, step: 0.01, defaultValue: 2.4 }),
      createNumberParam("fade", "Fade", { min: 0.05, max: 1, step: 0.01, defaultValue: 0.55 }),
      createNumberParam("width", "Width", { min: 0.002, max: 0.16, step: 0.001, defaultValue: 0.045 }),
      createNumberParam("strokeLength", "Length", { min: 0.15, max: 1.4, step: 0.01, defaultValue: 0.95 }),
      createNumberParam("curve", "Curve", { min: 0, max: 1.5, step: 0.01, defaultValue: 0.7 }),
      createNumberParam("direction", "Direction", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("spread", "Spread", { min: 0, max: 1, step: 0.01, defaultValue: 0.72 }),
      createNumberParam("roughness", "Roughness", { min: 0, max: 1, step: 0.01, defaultValue: 0.7 }),
      createColorParam("strokeColor", "Stroke color", "#161314ee"),
    ],
  });

const shader = Object.freeze({
    id: "generator.bezierStrokes",
    name: "Bezier Strokes Generator",
    type: "fragment",
    code: `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float style;
uniform float count;
uniform float speed;
uniform float lifetime;
uniform float fade;
uniform float width;
uniform float strokeLength;
uniform float curve;
uniform float direction;
uniform float spread;
uniform float roughness;
uniform vec4 strokeColor;
varying vec2 vTexCoord;

float strokeHash(float n) {
  vec3 p3 = fract(vec3(n, n + 17.17, n + 43.31) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float strokeHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float smoothStrokeNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 blend = local * local * (3.0 - 2.0 * local);
  float a = strokeHash2(cell);
  float b = strokeHash2(cell + vec2(1.0, 0.0));
  float c = strokeHash2(cell + vec2(0.0, 1.0));
  float d = strokeHash2(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
}

void main() {
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 p = (vTexCoord - 0.5) * aspect;
  float cs = cos(direction);
  float sn = sin(direction);
  p = mat2(cs, -sn, sn, cs) * p;
  float outputAlpha = 0.0;
  float cycle = max(lifetime, 0.4) + 0.75;
  float clock = time * max(speed, 0.0);

  for (int i = 0; i < 8; i++) {
    float index = float(i);
    if (index >= floor(count + 0.5)) continue;
    float seed = index * 19.73 + 4.17;
    float phase = strokeHash(seed + 2.0) * cycle;
    float age = mod(clock + phase, cycle);
    float active = 1.0 - step(lifetime, age);
    float drawProgress = clamp(age / max(lifetime * 0.34, 0.05), 0.0, 1.0);
    float fadeStart = lifetime * (1.0 - clamp(fade, 0.05, 1.0));
    float lifeAlpha = active * (1.0 - smoothstep(fadeStart, lifetime, age));

    float currentLength = max(0.04, strokeLength) * aspect.x;
    float centerX = (strokeHash(seed + 3.0) - 0.5) * aspect.x * 0.18;
    float along = (p.x - centerX) / currentLength + 0.5;
    float startY = (strokeHash(seed + 5.0) - 0.5) * spread * 0.92;
    float endY = startY + (strokeHash(seed + 7.0) - 0.5) * spread * 0.42;
    float controlY = mix(startY, endY, 0.5) + (strokeHash(seed + 11.0) - 0.5) * curve * 0.72;
    float t = clamp(along, 0.0, 1.0);
    float curveY = mix(mix(startY, controlY, t), mix(controlY, endY, t), t);
    float localWidth = width * mix(0.72, 1.32, strokeHash(seed + floor(t * 9.0) + 13.0));
    float grain = smoothStrokeNoise((p + seed) * resolution.y * mix(0.24, 0.9, roughness));
    float distanceToCurve = abs(p.y - curveY) + (grain - 0.5) * localWidth * roughness * 1.7;
    float edgeSoftness = style > 1.5 ? 0.42 : style > 0.5 ? 0.72 : 0.28;
    float stroke = 1.0 - smoothstep(localWidth, localWidth * (1.0 + edgeSoftness), distanceToCurve);
    float taper = smoothstep(0.0, 0.045, along) * smoothstep(1.0, 0.92, along);
    float reveal = 1.0 - smoothstep(drawProgress, drawProgress + 0.035, along);
    float material = 1.0;
    if (style > 0.5 && style < 1.5) material = smoothstep(roughness * 0.72, 1.0, grain);
    if (style > 1.5) material = mix(0.68, 1.0, smoothstep(0.08, 0.68, grain));
    float strokeAlpha = stroke * taper * reveal * lifeAlpha * material * strokeColor.a;
    outputAlpha = 1.0 - (1.0 - outputAlpha) * (1.0 - clamp(strokeAlpha, 0.0, 1.0));
  }

  gl_FragColor = vec4(strokeColor.rgb * outputAlpha, outputAlpha);
}`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
