import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "erode",
    name: "Erode",
    category: "filter",
    code: `
vec4 sampleMorph(vec2 uv) {
  return sampleSource(uv);
}

float morphLuma(vec3 rgb) {
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

vec4 darkerOf(vec4 current, vec4 candidate) {
  return morphLuma(candidate.rgb) < morphLuma(current.rgb) ? candidate : current;
}

vec4 runEffect(vec2 uv, vec4 color) {
  vec2 px = mix(1.0, 3.0, amount) / max(resolution, vec2(1.0));
  vec4 selected = color;
  selected = darkerOf(selected, sampleMorph(uv + px * vec2(-1.0, -1.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2( 0.0, -1.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2( 1.0, -1.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2(-1.0,  0.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2( 1.0,  0.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2(-1.0,  1.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2( 0.0,  1.0)));
  selected = darkerOf(selected, sampleMorph(uv + px * vec2( 1.0,  1.0)));
  return mix(color, selected, amount);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
