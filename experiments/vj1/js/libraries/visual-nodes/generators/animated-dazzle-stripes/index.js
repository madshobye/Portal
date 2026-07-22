import { createColorParam, createNumberParam } from "../../shared/component-schema.js";
import { timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
  id: "animatedDazzleStripes",
  name: "Animated Dazzle Stripes",
  category: "patterns",
  description: "Resolution-independent animated diagonal camouflage stripes with a pulsing calibration border.",
  runtime: timeParamRuntime("speed"),
  primaryParamIds: ["speed", "stripeWidth", "angle", "contrast"],
  detailParamIds: ["warp", "border", "phase", "colorA", "colorB", "backgroundColor"],
  params: [
    createNumberParam("speed", "Speed", { min: 0, max: 4, step: 0.01, defaultValue: 0.75 }),
    createNumberParam("stripeWidth", "Stripe width", { min: 0.015, max: 0.35, step: 0.001, defaultValue: 0.105 }),
    createNumberParam("angle", "Angle", { min: -3.1416, max: 3.1416, step: 0.001, defaultValue: -0.72 }),
    createNumberParam("contrast", "Contrast", { min: 0, max: 1, step: 0.01, defaultValue: 0.92 }),
    createNumberParam("warp", "Warp", { min: 0, max: 1, step: 0.01, defaultValue: 0.32 }),
    createNumberParam("border", "Border", { min: 0, max: 0.08, step: 0.001, defaultValue: 0.012 }),
    createNumberParam("phase", "Phase", { min: -1, max: 1, step: 0.001, defaultValue: 0 }),
    createColorParam("colorA", "Color A", "#ff4f92ff"),
    createColorParam("colorB", "Color B", "#6a35d4ff"),
    createColorParam("backgroundColor", "Background", "#08070dff"),
  ],
});

const shader = Object.freeze({
  id: "generator.animated-dazzle-stripes",
  name: "Animated Dazzle Stripes shader",
  type: "fragment",
  code: `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float speed;
uniform float stripeWidth;
uniform float angle;
uniform float contrast;
uniform float warp;
uniform float border;
uniform float phase;
uniform vec4 colorA;
uniform vec4 colorB;
uniform vec4 backgroundColor;
varying vec2 vTexCoord;

void main() {
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 p = (vTexCoord - 0.5) * aspect;
  float clock = time * speed + phase * 6.28318530718;
  float cs = cos(angle + sin(clock * 0.19) * 0.08 * warp);
  float sn = sin(angle + sin(clock * 0.19) * 0.08 * warp);
  vec2 q = mat2(cs, -sn, sn, cs) * p;
  q.x += sin(q.y * 9.0 + clock * 0.63) * 0.065 * warp;
  q.y += sin(q.x * 6.0 - clock * 0.37) * 0.035 * warp;
  float width = max(stripeWidth, 0.002);
  float wave = sin((q.x / width + clock) * 3.14159265359);
  // Pixel-derived filtering keeps this portable to the shared WebGL shader
  // path without requiring the derivative extension.
  float unitPx = max(min(resolution.x, resolution.y), 1.0);
  float aa = clamp(3.14159265359 / max(width * unitPx, 1.0), 0.001, 0.35);
  float mask = smoothstep(-aa, aa, wave);
  vec3 stripe = mix(colorA.rgb, colorB.rgb, mask);
  float stripeAlpha = mix(colorA.a, colorB.a, mask);
  vec3 color = mix(backgroundColor.rgb, stripe, clamp(contrast, 0.0, 1.0));
  float alpha = mix(backgroundColor.a, stripeAlpha, clamp(contrast, 0.0, 1.0));

  float edgeDistance = min(min(vTexCoord.x, 1.0 - vTexCoord.x), min(vTexCoord.y, 1.0 - vTexCoord.y));
  float pulseWidth = max(border * (0.78 + 0.22 * sin(clock * 1.7)), 0.0001);
  float frame = 1.0 - smoothstep(pulseWidth, pulseWidth + 1.5 / max(min(resolution.x, resolution.y), 1.0), edgeDistance);
  vec3 frameColor = mix(colorA.rgb, colorB.rgb, 0.5 + 0.5 * sin(clock * 0.7));
  color = mix(color, frameColor, frame);
  alpha = max(alpha, frame * 0.95);
  gl_FragColor = vec4(color * alpha, alpha);
}`,
});

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
