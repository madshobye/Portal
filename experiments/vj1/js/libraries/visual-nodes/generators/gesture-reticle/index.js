import { createColorParam, createNumberParam } from "../../shared/component-schema.js";
import { timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
  id: "gestureReticle",
  name: "Gesture Reticle",
  category: "interaction",
  description: "A parameter-driven gesture target with pulsing rings, rotating ticks, and a soft additive glow.",
  runtime: timeParamRuntime("speed"),
  primaryParamIds: ["x", "y", "size", "speed"],
  detailParamIds: ["rings", "ticks", "pulse", "lineWidth", "color", "accentColor"],
  params: [
    createNumberParam("x", "X", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 }),
    createNumberParam("y", "Y", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 }),
    createNumberParam("size", "Size", { min: 0.03, max: 0.7, step: 0.001, defaultValue: 0.22 }),
    createNumberParam("speed", "Speed", { min: 0, max: 5, step: 0.01, defaultValue: 1 }),
    createNumberParam("rings", "Rings", { min: 1, max: 6, step: 1, defaultValue: 3 }),
    createNumberParam("ticks", "Ticks", { min: 4, max: 24, step: 1, defaultValue: 12 }),
    createNumberParam("pulse", "Pulse", { min: 0, max: 1, step: 0.01, defaultValue: 0.45 }),
    createNumberParam("lineWidth", "Line width", { min: 0.001, max: 0.04, step: 0.001, defaultValue: 0.006 }),
    createColorParam("color", "Color", "#59e2d3ee"),
    createColorParam("accentColor", "Accent", "#ffe45eff"),
  ],
});

const shader = Object.freeze({
  id: "generator.gesture-reticle",
  name: "Gesture Reticle shader",
  type: "fragment",
  code: `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float x;
uniform float y;
uniform float size;
uniform float speed;
uniform float rings;
uniform float ticks;
uniform float pulse;
uniform float lineWidth;
uniform vec4 color;
uniform vec4 accentColor;
varying vec2 vTexCoord;

void main() {
  float unitPx = min(resolution.x, resolution.y);
  vec2 p = (vTexCoord - vec2(x, y)) * resolution / max(unitPx, 1.0);
  float clock = time * speed;
  float radius = size * (1.0 + sin(clock * 3.1) * 0.08 * pulse);
  float d = length(p);
  float width = max(lineWidth, 0.0005);
  float alpha = 0.0;
  float ringColorMix = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    if (fi >= floor(rings + 0.5)) continue;
    float rr = radius * (0.42 + fi * 0.29 + fract(clock * 0.25 + fi * 0.23) * 0.08 * pulse);
    float band = 1.0 - smoothstep(width, width + 1.5 / max(unitPx, 1.0), abs(d - rr));
    alpha = max(alpha, band * (1.0 - fi * 0.09));
    ringColorMix = max(ringColorMix, band * step(0.5, mod(fi, 2.0)));
  }

  float a = atan(p.y, p.x) + clock * 0.72;
  float sectors = max(floor(ticks + 0.5), 1.0);
  float angular = abs(fract(a / 6.28318530718 * sectors + 0.5) - 0.5);
  float tick = (1.0 - smoothstep(0.025, 0.075, angular))
    * smoothstep(radius * 0.82, radius * 0.88, d)
    * (1.0 - smoothstep(radius * 1.12, radius * 1.18, d));
  float cross = max(
    (1.0 - smoothstep(width, width * 1.8, abs(p.x))) * smoothstep(radius * 0.15, radius * 0.25, abs(p.y)) * (1.0 - smoothstep(radius * 0.7, radius * 0.78, abs(p.y))),
    (1.0 - smoothstep(width, width * 1.8, abs(p.y))) * smoothstep(radius * 0.15, radius * 0.25, abs(p.x)) * (1.0 - smoothstep(radius * 0.7, radius * 0.78, abs(p.x)))
  );
  float core = 1.0 - smoothstep(width * 1.5, width * 3.0, d);
  float glow = exp(-d * d / max(radius * radius * 0.38, 0.0001)) * 0.24;
  alpha = clamp(max(alpha, max(tick, max(cross, core))) + glow, 0.0, 1.0);
  float accent = clamp(max(tick, max(core, ringColorMix)), 0.0, 1.0);
  vec3 rgb = mix(color.rgb, accentColor.rgb, accent);
  float sourceAlpha = mix(color.a, accentColor.a, accent);
  alpha *= sourceAlpha;
  gl_FragColor = vec4(rgb * alpha, alpha);
}`,
});

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
