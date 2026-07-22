import { createColorParam, createNumberParam } from "../../shared/component-schema.js";
import { timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
  id: "chainFollowerTrails",
  name: "Chain Follower Trails",
  category: "motion",
  description: "Analytic follower chains sampled backwards through a shared motion path; no history framebuffer is required.",
  runtime: timeParamRuntime("speed"),
  primaryParamIds: ["x", "y", "chains", "followers", "speed"],
  detailParamIds: ["lag", "spread", "motion", "pointSize", "fade", "color", "accentColor"],
  params: [
    createNumberParam("x", "Target X", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 }),
    createNumberParam("y", "Target Y", { min: 0, max: 1, step: 0.001, defaultValue: 0.5 }),
    createNumberParam("chains", "Chains", { min: 1, max: 12, step: 1, defaultValue: 7 }),
    createNumberParam("followers", "Followers", { min: 2, max: 18, step: 1, defaultValue: 12 }),
    createNumberParam("speed", "Speed", { min: 0, max: 4, step: 0.01, defaultValue: 0.8 }),
    createNumberParam("lag", "Follower lag", { min: 0.01, max: 0.5, step: 0.001, defaultValue: 0.075 }),
    createNumberParam("spread", "Root spread", { min: 0, max: 0.7, step: 0.001, defaultValue: 0.24 }),
    createNumberParam("motion", "Motion amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.62 }),
    createNumberParam("pointSize", "Point size", { min: 0.002, max: 0.08, step: 0.001, defaultValue: 0.018 }),
    createNumberParam("fade", "Trail fade", { min: 0, max: 1, step: 0.01, defaultValue: 0.76 }),
    createColorParam("color", "Head color", "#ffe45eff"),
    createColorParam("accentColor", "Tail color", "#59e2d3cc"),
  ],
});

const shader = Object.freeze({
  id: "generator.chain-follower-trails",
  name: "Chain Follower Trails shader",
  type: "fragment",
  code: `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float x;
uniform float y;
uniform float chains;
uniform float followers;
uniform float speed;
uniform float lag;
uniform float spread;
uniform float motion;
uniform float pointSize;
uniform float fade;
uniform vec4 color;
uniform vec4 accentColor;
varying vec2 vTexCoord;

vec2 followerPath(float clock, float seed) {
  float a = clock * (0.73 + 0.07 * sin(seed * 2.1)) + seed;
  float b = clock * 1.173 - seed * 0.61;
  return vec2(
    sin(a) * 0.19 + sin(b * 1.37) * 0.075,
    cos(a * 0.83) * 0.17 + sin(b) * 0.085
  );
}

void main() {
  float unitPx = min(resolution.x, resolution.y);
  vec2 p = vTexCoord * resolution / max(unitPx, 1.0);
  vec2 center = vec2(x, y) * resolution / max(unitPx, 1.0);
  float activeChains = floor(chains + 0.5);
  float activeFollowers = floor(followers + 0.5);
  float clock = time * speed;
  vec3 sumColor = vec3(0.0);
  float sumAlpha = 0.0;

  for (int c = 0; c < 12; c++) {
    float fc = float(c);
    if (fc >= activeChains) continue;
    float rootAngle = fc * 2.39996323;
    vec2 root = vec2(cos(rootAngle), sin(rootAngle)) * spread * sqrt((fc + 1.0) / max(activeChains, 1.0));
    for (int j = 0; j < 18; j++) {
      float fj = float(j);
      if (fj >= activeFollowers) continue;
      float age = fj / max(activeFollowers - 1.0, 1.0);
      float sampleTime = clock - fj * lag;
      vec2 pos = center + root * mix(1.0, 0.28, age) + followerPath(sampleTime, rootAngle) * motion;
      float radius = max(pointSize * mix(1.0, 0.36, age), 0.001);
      float d = length(p - pos);
      float disk = 1.0 - smoothstep(radius, radius + 1.5 / max(unitPx, 1.0), d);
      float glow = exp(-d * d / max(radius * radius * 7.0, 0.000001)) * 0.32;
      float trailAlpha = mix(1.0, pow(max(1.0 - age, 0.0), 2.0), fade);
      vec4 trailColor = mix(color, accentColor, age);
      float light = (disk + glow) * trailAlpha * trailColor.a;
      sumColor += trailColor.rgb * light;
      sumAlpha += light;
    }
  }
  float alpha = clamp(sumAlpha, 0.0, 1.0);
  vec3 rgb = 1.0 - exp(-sumColor);
  gl_FragColor = vec4(rgb * alpha, alpha);
}`,
});

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
