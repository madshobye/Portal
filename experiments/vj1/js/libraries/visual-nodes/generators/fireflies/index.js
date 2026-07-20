import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "fireflies",
    name: "Fireflies",
    category: "particles",
    runtime: timeParamRuntime("speed"),
    params: [
      createNumberParam("count", "Count", { min: 4, max: 24, step: 1, defaultValue: 18 }),
      createNumberParam("glowSize", "Glow size", { min: 0.35, max: 2.5, step: 0.01, defaultValue: 1 }),
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("trail", "Trail", { min: 0, max: 1, step: 0.01, defaultValue: 0.25 }),
      createNumberParam("brightness", "Brightness", { min: 0, max: 2, step: 0.01, defaultValue: 1 }),
      createNumberParam("twinkle", "Twinkle", { min: 0, max: 1, step: 0.01, defaultValue: 0.75 }),
      createColorParam("tintColor", "Color", "#fff06dff"),
    ],
  });

const shader = Object.freeze({
    id: "generator.fireflies",
    name: "Fireflies Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float time;
uniform float count;
uniform float glowSize;
uniform float speed;
uniform float trail;
uniform float brightness;
uniform float twinkle;
uniform vec4 tintColor;
varying vec2 vTexCoord;

float hash(float n) {
  vec3 p3 = fract(vec3(n, n + 19.19, n + 47.77) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(float n) {
  return vec2(hash(n * 17.13), hash(n * 41.71));
}

void main() {
  vec2 uv = vTexCoord;
  vec2 aspect = vec2(resolution.x / max(resolution.y, 1.0), 1.0);
  vec2 p = uv * aspect;
  vec3 color = vec3(0.0);
  float alpha = 0.0;

  float qualityMultiplier = renderQuality <= 0.5
    ? mix(0.35, 1.0, renderQuality * 2.0)
    : mix(1.0, 1.34, (renderQuality - 0.5) * 2.0);
  float activeCount = clamp(floor(count * qualityMultiplier + 0.5), 1.0, 32.0);
  float motionSpeed = max(speed, 0.0);
  float sizeScale = max(glowSize, 0.05);
  float trailAmount = clamp(trail, 0.0, 1.0);
  float lightAmount = max(brightness, 0.0);
  float twinkleAmount = clamp(twinkle, 0.0, 1.0);

  for (int i = 0; i < 32; i++) {
    float fi = float(i);
    if (fi >= activeCount) continue;
    vec2 seed = hash2(fi + 3.0);
    float flySpeed = mix(0.12, 0.52, hash(fi * 9.7)) * motionSpeed;
    float orbit = time * flySpeed + seed.x * 6.28318530718;
    vec2 base = vec2(seed.x * aspect.x, seed.y);
    vec2 drift = vec2(
      sin(orbit * 0.7 + fi * 1.37) * 0.16 + cos(orbit * 0.31) * 0.08,
      cos(orbit * 0.9 + fi * 0.73) * 0.14 + sin(orbit * 0.43) * 0.06
    );
    vec2 pos = mod(base + drift + vec2(time * motionSpeed * 0.018 * (seed.y - 0.5), time * motionSpeed * 0.012 * (seed.x - 0.5)), aspect);
    float blinkWave = sin(time * motionSpeed * mix(2.0, 5.5, seed.x) + fi * 4.1) * 0.5 + 0.5;
    float blink = mix(1.0, smoothstep(0.22, 1.0, blinkWave), twinkleAmount);
    float size = mix(0.0045, 0.014, seed.y) * sizeScale;
    vec2 delta = p - pos;
    float dist2 = dot(delta, delta);
    float core = exp(-dist2 / (size * size)) * blink;
    float glow = renderQuality > 0.12 ? exp(-dist2 / (size * size * 18.0)) * blink : 0.0;
    float wideGlow = renderQuality > 0.72 ? exp(-dist2 / (size * size * 42.0)) * blink : 0.0;

    float trailGlow = 0.0;
    if (trailAmount > 0.001 && renderQuality > 0.22) {
      vec2 velocity = normalize(vec2(
        cos(orbit * 0.7 + fi * 1.37) * 0.11 - sin(orbit * 0.31) * 0.03,
        -sin(orbit * 0.9 + fi * 0.73) * 0.13 + cos(orbit * 0.43) * 0.03
      ) + vec2(0.001));
      vec2 trailDelta = delta + velocity * 0.075 * sizeScale;
      float along = clamp(dot(-delta, velocity) / 0.12, 0.0, 1.0);
      trailGlow = exp(-abs(dot(trailDelta, vec2(-velocity.y, velocity.x))) * 70.0 / sizeScale) * along * along * blink * 0.18 * trailAmount;
    }

    float light = (glow * 0.48 + wideGlow * 0.12 + core * 1.8 + trailGlow) * lightAmount;
    color += tintColor.rgb * light;
    alpha += (glow * 0.34 + wideGlow * 0.08 + core + trailGlow * 0.75) * tintColor.a;
  }

  alpha = clamp(alpha, 0.0, 1.0);
  color = clamp(color, 0.0, 1.0);
  gl_FragColor = vec4(color * alpha, alpha);
}`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
