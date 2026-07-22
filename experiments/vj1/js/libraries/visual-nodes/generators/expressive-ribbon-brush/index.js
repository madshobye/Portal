import { createColorParam, createNumberParam } from "../../shared/component-schema.js";
import { timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
  id: "expressiveRibbonBrush",
  name: "Expressive Ribbon Brush",
  category: "drawing",
  description: "A GPU ribbon brush whose width, turn response, hairs, and breakup derive from a deterministic motion path.",
  runtime: timeParamRuntime("speed"),
  primaryParamIds: ["x", "y", "speed", "width", "trailLength"],
  detailParamIds: ["curve", "turnResponse", "hairs", "roughness", "splatter", "color", "accentColor"],
  params: [
    createNumberParam("x", "X", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 }),
    createNumberParam("y", "Y", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 }),
    createNumberParam("speed", "Speed", { min: 0, max: 4, step: 0.01, defaultValue: 0.75 }),
    createNumberParam("width", "Width", { min: 0.003, max: 0.24, step: 0.001, defaultValue: 0.055 }),
    createNumberParam("trailLength", "Length", { min: 0.1, max: 1.5, step: 0.01, defaultValue: 0.82 }),
    createNumberParam("curve", "Curve", { min: 0, max: 1, step: 0.01, defaultValue: 0.72 }),
    createNumberParam("turnResponse", "Turn response", { min: 0, max: 1, step: 0.01, defaultValue: 0.66 }),
    createNumberParam("hairs", "Hairs", { min: 1, max: 7, step: 1, defaultValue: 4 }),
    createNumberParam("roughness", "Roughness", { min: 0, max: 1, step: 0.01, defaultValue: 0.42 }),
    createNumberParam("splatter", "Splatter", { min: 0, max: 1, step: 0.01, defaultValue: 0.18 }),
    createColorParam("color", "Brush color", "#f7f3e8ee"),
    createColorParam("accentColor", "Edge color", "#ff4f92cc"),
  ],
});

const shader = Object.freeze({
  id: "generator.expressive-ribbon-brush",
  name: "Expressive Ribbon Brush shader",
  type: "fragment",
  code: `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float x;
uniform float y;
uniform float speed;
uniform float width;
uniform float trailLength;
uniform float curve;
uniform float turnResponse;
uniform float hairs;
uniform float roughness;
uniform float splatter;
uniform vec4 color;
uniform vec4 accentColor;
varying vec2 vTexCoord;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
vec2 brushPath(float t) {
  float clock = time * speed;
  float phase = clock - t * max(trailLength, 0.01) * 2.2;
  vec2 aspect = resolution / max(min(resolution.x, resolution.y), 1.0);
  return vec2(x, y) * aspect + vec2(
    sin(phase * 0.73) * 0.31 + sin(phase * 1.91 + 1.3) * 0.075 * curve,
    cos(phase * 0.61 + 0.4) * 0.25 + sin(phase * 1.37) * 0.09 * curve
  );
}
vec3 segmentSample(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 0.000001), 0.0, 1.0);
  vec2 tangent = normalize(ab + vec2(0.000001));
  vec2 delta = p - a - ab * h;
  float signedDistance = dot(delta, vec2(-tangent.y, tangent.x));
  return vec3(length(delta), signedDistance, h);
}

void main() {
  float unitPx = min(resolution.x, resolution.y);
  vec2 p = vTexCoord * resolution / max(unitPx, 1.0);
  float minDistance = 10.0;
  float transverseAtHit = 0.0;
  float progressAtHit = 0.0;
  vec2 previous = brushPath(0.0);
  for (int i = 1; i <= 48; i++) {
    float t = float(i) / 48.0;
    vec2 current = brushPath(t);
    float localWidth = width * mix(1.0, 0.18, t);
    float tangentTurn = abs(sin((time * speed - t * trailLength) * 1.31)) * turnResponse;
    localWidth *= mix(0.72, 1.42, tangentTurn);
    vec3 sampleValue = segmentSample(p, previous, current);
    float normalized = sampleValue.x / max(localWidth, 0.0005);
    if (normalized < minDistance) {
      minDistance = normalized;
      transverseAtHit = sampleValue.y / max(localWidth, 0.0005);
      progressAtHit = mix(t - 1.0 / 48.0, t, sampleValue.z);
    }
    previous = current;
  }
  float aa = 1.5 / max(unitPx * max(width, 0.001), 1.0);
  float body = 1.0 - smoothstep(0.78, 0.78 + aa, minDistance);
  // Bristles are an analytic mask inside the closest ribbon segment. This
  // replaces a nested segment loop and keeps the brush a single bounded pass.
  float bristleCount = max(floor(hairs + 0.5), 1.0);
  float bristleWave = abs(sin((transverseAtHit * bristleCount + progressAtHit * 1.7) * 3.14159265359));
  float hairMask = body * smoothstep(0.48, 0.92, bristleWave) * mix(0.25, 0.8, roughness);
  float grain = hash(floor(vTexCoord * resolution * mix(0.08, 0.55, roughness)));
  float breakup = mix(1.0, smoothstep(roughness * 0.72, 1.0, grain), roughness * 0.68);
  float speck = step(1.0 - splatter * 0.045, hash(floor(vTexCoord * resolution * 0.18)))
    * (1.0 - smoothstep(0.0, 0.16, abs(minDistance - 1.5))) * splatter;
  float alpha = clamp((body * breakup + hairMask * 0.7 + speck) * color.a, 0.0, 1.0);
  vec3 rgb = mix(color.rgb, accentColor.rgb, clamp(hairMask * 0.65 + progressAtHit * 0.18, 0.0, 1.0));
  gl_FragColor = vec4(rgb * alpha, alpha);
}`,
});

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
