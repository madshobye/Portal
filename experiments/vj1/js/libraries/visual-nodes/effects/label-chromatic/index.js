import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "labelChromatic",
    name: "Label Chromatic",
    category: "color",
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 0.35 }),
      createBooleanParam("fullSplit", "Full split", false),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  if (amount <= 0.0001) return color;
  vec2 px = vec2(1.0 / max(resolution.x, 1.0), 1.0 / max(resolution.y, 1.0));
  vec2 offset = vec2(px.x * mix(2.0, 28.0, amount), 0.0);
  vec4 redColor = sampleSource(uv - offset);
  if (!fullSplit) return vec4(redColor.r, color.g, color.b, color.a);
  vec4 blueColor = sampleSource(uv + offset);
  return vec4(redColor.r, color.g, blueColor.b, color.a);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
