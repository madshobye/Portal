import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "waves",
    name: "Waves",
    category: "motion",
    runtime: ALWAYS_TIME_RUNTIME,
  });

const shader = Object.freeze({
    id: "generator.waves",
    name: "Waves Generator",
    type: "fragment",
    code: `
precision mediump float;
uniform vec2 resolution;
uniform float time;
varying vec2 vTexCoord;

float waveLine(vec2 uv, float index) {
  float baseY = 0.12 + index * 0.024;
  float y = baseY
    + sin(uv.x * resolution.x * 0.018 + time * (1.4 + index * 0.04)) * 34.0 / max(resolution.y, 1.0)
    + sin(uv.x * resolution.x * 0.006 - time * 0.8 + index) * 58.0 / max(resolution.y, 1.0);
  float distanceToLine = abs(uv.y - y);
  float width = 2.1 / max(resolution.y, 1.0);
  return 1.0 - smoothstep(width, width * 3.0, distanceToLine);
}

void main() {
  vec2 uv = vTexCoord;
  vec3 color = vec3(0.02, 0.024, 0.032);
  for (int i = 0; i < 34; i++) {
    float index = float(i);
    float hue = index / 34.0;
    vec3 stroke = vec3(
      70.0 + 150.0 * sin(time + hue * 6.28),
      100.0 + 110.0 * sin(time * 0.7 + hue * 4.1),
      150.0 + 95.0 * cos(time * 0.8 + hue * 5.0)
    ) / 255.0;
    float line = waveLine(uv, index);
    color = mix(color, stroke, line * 0.82);
  }
  gl_FragColor = vec4(color, 1.0);
}`,
  });

export const VisualComponent = defineGeneratorNode(manifest, shader);
export default VisualComponent;
