import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "swayingTrees",
    name: "Swaying Trees",
    category: "organic",
    runtime: ALWAYS_TIME_RUNTIME,
  });

const shader = Object.freeze({
    id: "generator.swayingTrees",
    name: "Swaying Trees Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float time;
varying vec2 vTexCoord;

float hash(float n) {
  vec3 p3 = fract(vec3(n, n + 19.19, n + 47.77) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float sdSegment2(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  vec2 delta = pa - ba * h;
  return dot(delta, delta);
}

float softLine(vec2 p, vec2 a, vec2 b, float width) {
  float d2 = sdSegment2(p, a, b);
  float outer = width * 2.65;
  return 1.0 - smoothstep(width * width, outer * outer, d2);
}

float leafShape(vec2 p, vec2 center, vec2 scale, float angle, float seed) {
  float c = cos(angle);
  float s = sin(angle);
  vec2 q = p - center;
  q = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
  q /= scale;
  float body = 1.0 - smoothstep(0.5476, 1.0, dot(q, q));
  float taper = smoothstep(-0.98, -0.08, q.y) * (1.0 - smoothstep(0.16, 0.98, q.y));
  float vein = (1.0 - smoothstep(0.012, 0.055, abs(q.x))) * body * 0.14;
  float fleck = hash(floor((q.x + 2.0) * 13.0 + floor((q.y + 2.0) * 17.0) + seed));
  return clamp(body * taper * (0.86 + fleck * 0.18) + vein, 0.0, 1.0);
}

void main() {
  vec2 uv = vTexCoord;
  float aspect = resolution.x / max(resolution.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec3 premul = vec3(0.0);
  float alpha = 0.0;

  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float seed = fi + 1.0;
    float slot = (fi + 0.5) / 7.0;
    float rootJitter = (hash(seed * 3.17) - 0.5) * 0.09;
    vec2 root = vec2(clamp(slot * aspect + rootJitter, 0.06, aspect - 0.06), 0.02);
    float height = mix(0.36, 0.86, hash(seed * 4.71));
    float bend = (hash(seed * 8.63) - 0.5) * 0.12;
    float swayPhase = time * mix(0.42, 0.74, hash(seed * 6.19)) + seed * 2.37;
    float sway = sin(swayPhase) * mix(0.018, 0.052, hash(seed * 5.41));
    vec2 top = root + vec2(bend + sway, height);
    float trunkWidth = mix(0.012, 0.026, hash(seed * 9.83));
    float trunk = softLine(p, root, top, trunkWidth);
    vec3 bark = mix(vec3(0.15, 0.08, 0.035), vec3(0.30, 0.18, 0.08), hash(seed * 2.0));
    premul += bark * trunk * 0.78;
    alpha = max(alpha, trunk * 0.9);

    for (int j = 0; j < 5; j++) {
      float fj = float(j);
      float k = 0.30 + fj * 0.13 + hash(seed * 11.0 + fj) * 0.055;
      vec2 branchRoot = mix(root, top, k);
      float side = mod(fi + fj, 2.0) < 1.0 ? -1.0 : 1.0;
      float branchLength = mix(0.10, 0.24, hash(seed * 13.0 + fj)) * aspect;
      float branchRise = mix(0.045, 0.16, hash(seed * 17.0 + fj));
      float branchSway = sin(swayPhase + fj * 0.9) * 0.030 * (0.5 + k);
      vec2 branchTip = branchRoot + vec2(side * branchLength + branchSway, branchRise);
      float branchMask = softLine(p, branchRoot, branchTip, trunkWidth * mix(0.36, 0.58, k));
      premul += bark * branchMask * 0.62;
      alpha = max(alpha, branchMask * 0.78);

      for (int l = 0; l < 3; l++) {
        float fl = float(l);
        float lk = 0.36 + fl * 0.25 + hash(seed * 23.0 + fj * 5.0 + fl) * 0.12;
        vec2 leafCenter = mix(branchRoot, branchTip, lk);
        leafCenter += vec2(
          sin(swayPhase * 1.24 + fj * 1.7 + fl) * 0.026,
          cos(swayPhase * 0.83 + fl * 2.0) * 0.015
        );
        float leafSize = mix(0.026, 0.064, hash(seed * 29.0 + fj * 3.0 + fl));
        float leafAngle = side * 0.68 + sin(time * 0.8 + seed + fj + fl) * 0.22;
        float leaf = leafShape(p, leafCenter, vec2(leafSize * 0.72, leafSize * 1.18), leafAngle, seed * 31.0 + fj * 7.0 + fl);
        vec3 leafColor = mix(
          vec3(0.10, 0.38, 0.13),
          vec3(0.55, 0.76, 0.22),
          hash(seed * 37.0 + fj * 11.0 + fl)
        );
        leafColor = mix(leafColor, vec3(0.84, 0.62, 0.20), smoothstep(0.62, 1.0, hash(seed * 43.0 + fj * 4.0 + fl)) * 0.35);
        premul += leafColor * leaf * 0.8;
        alpha = max(alpha, leaf * 0.82);
      }
    }
  }

  float ground = 1.0 - smoothstep(0.0, 0.03, uv.y);
  premul += vec3(0.08, 0.16, 0.07) * ground * 0.35;
  alpha = max(alpha, ground * 0.32);
  alpha = clamp(alpha, 0.0, 1.0);
  premul = clamp(premul, 0.0, 1.0) * alpha;
  gl_FragColor = vec4(premul, alpha);
}`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
