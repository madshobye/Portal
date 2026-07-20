import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "blur",
    name: "Blur",
    category: "filter",
    code: `
vec4 sampleBlur(vec2 uv) {
  return sampleSource(uv);
}

vec4 runEffect(vec2 uv, vec4 color) {
  float radius = mix(0.0, 12.0, amount);
  vec2 px = radius / max(resolution, vec2(1.0));
  vec4 sum = color * 0.20;
  sum += sampleBlur(uv + px * vec2( 1.0,  0.0)) * 0.12;
  sum += sampleBlur(uv + px * vec2(-1.0,  0.0)) * 0.12;
  sum += sampleBlur(uv + px * vec2( 0.0,  1.0)) * 0.12;
  sum += sampleBlur(uv + px * vec2( 0.0, -1.0)) * 0.12;
  sum += sampleBlur(uv + px * vec2( 0.707,  0.707)) * 0.07;
  sum += sampleBlur(uv + px * vec2(-0.707,  0.707)) * 0.07;
  sum += sampleBlur(uv + px * vec2( 0.707, -0.707)) * 0.07;
  sum += sampleBlur(uv + px * vec2(-0.707, -0.707)) * 0.07;
  sum += sampleBlur(uv + px * vec2( 2.0,  0.0)) * 0.01;
  sum += sampleBlur(uv + px * vec2(-2.0,  0.0)) * 0.01;
  sum += sampleBlur(uv + px * vec2( 0.0,  2.0)) * 0.01;
  sum += sampleBlur(uv + px * vec2( 0.0, -2.0)) * 0.01;
  return sum;
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
