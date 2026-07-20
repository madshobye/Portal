import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "flip",
    name: "Flip",
    category: "geometry",
    params: [
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createBooleanParam("flipX", "Flip X", true),
      createBooleanParam("flipY", "Flip Y", false),
    ],
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 flippedUv = vec2(
    flipX ? 1.0 - uv.x : uv.x,
    flipY ? 1.0 - uv.y : uv.y
  );
  vec4 flipped = sampleSource(flippedUv);
  return mix(color, flipped, amount);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
