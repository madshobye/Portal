import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "cellularCircles",
    name: "Cellular Circles",
    category: "shadertoy",
    runtime: timeParamRuntime("speed"),
    params: [
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("scale", "Scale", { min: 1, max: 30, step: 0.01, defaultValue: 10, scale: "log" }),
      createNumberParam("searchRadius", "Search radius", { min: 1, max: 5, step: 1, defaultValue: 5 }),
      createNumberParam("orbitRadius", "Cell movement", { min: 0, max: 4, step: 0.01, defaultValue: 4 }),
      createNumberParam("cellMotion", "Motion variation", { min: 0, max: 3, step: 0.01, defaultValue: 1 }),
      createNumberParam("rotationSpeed", "Rotation", { min: -1, max: 1, step: 0.01, defaultValue: 0.1 }),
      createNumberParam("offsetX", "Position X", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
      createNumberParam("offsetY", "Position Y", { min: -3, max: 3, step: 0.01, defaultValue: -1.5 }),
      createNumberParam("circularity", "Circular cells", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("glowPower", "Glow shape", { min: 0.5, max: 10, step: 0.01, defaultValue: 4 }),
      createColorParam("cellColor", "Cell color", "#cc0000ff"),
      createColorParam("backgroundColor", "Background color", "#1a0000ff"),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
  });

const shader = Object.freeze({
    id: "generator.cellularCircles",
    name: "Cellular Circles Generator",
    type: "shadertoy",
    code: `
/*
 * "Cellular Circles" by Jan Mróz (jaszunio15)
 * License: Creative Commons Attribution 3.0 (CC BY 3.0)
 * Original shader: https://www.shadertoy.com/view/tsfGDM
 * Rotation and random optimizations credited by the author to FabriceNyret2.
 * Adapted for VJ1 with controls, premultiplied alpha, and a single nearest-pair pass.
 */

uniform float scale;
uniform float searchRadius;
uniform float orbitRadius;
uniform float cellMotion;
uniform float rotationSpeed;
uniform float offsetX;
uniform float offsetY;
uniform float circularity;
uniform float glowPower;
uniform vec4 cellColor;
uniform vec4 backgroundColor;
uniform float amount;

const float CELL_DOUBLE_PI = 6.283185;

vec2 cellularRandom(vec2 value) {
  return fract(sin(value * mat2(0.7400775, -0.6725215, 0.1241045, 0.9922691)) * vec2(541.9283, 638.1429));
}

vec2 cellularCenter(vec2 root) {
  vec2 randomValue = cellularRandom(root);
  float angle = iTime * cellMotion * randomValue.x * 0.3;
  return root + vec2(cos(angle), sin(angle)) * randomValue.y * orbitRadius;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / min(iResolution.x, iResolution.y);
  uv += vec2(offsetX, offsetY);
  float rotation = iTime * rotationSpeed;
  uv = mat2(cos(rotation), sin(rotation), -sin(rotation), cos(rotation)) * uv;
  uv *= scale;

  vec2 root = floor(uv);
  float nearestDistance = 99999.0;
  float secondDistance = 99999.0;
  for (int x = -5; x <= 5; x++) {
    for (int y = -5; y <= 5; y++) {
      if (abs(float(x)) > searchRadius || abs(float(y)) > searchRadius) continue;
      vec2 center = cellularCenter(root + vec2(float(x), float(y)));
      vec2 delta = uv - center;
      float distanceSquared = dot(delta, delta);
      if (distanceSquared < nearestDistance) {
        secondDistance = nearestDistance;
        nearestDistance = distanceSquared;
      } else if (distanceSquared < secondDistance && distanceSquared > nearestDistance) {
        secondDistance = distanceSquared;
      }
    }
  }

  float centralDistance = (sqrt(nearestDistance) + sqrt(secondDistance)) * 0.5;
  centralDistance = mix(centralDistance, min(centralDistance, 0.5), circularity);
  float wave = sin(fract(centralDistance) * CELL_DOUBLE_PI) * 0.5 + 0.5;
  float effect = pow(max(wave, 0.0), glowPower);
  vec4 color = mix(backgroundColor, cellColor, effect);
  float alpha = clamp(color.a * amount, 0.0, 1.0);
  fragColor = vec4(clamp(color.rgb, 0.0, 1.0) * alpha, alpha);
}
`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
