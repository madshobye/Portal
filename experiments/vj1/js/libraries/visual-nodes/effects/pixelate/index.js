import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "pixelate",
    name: "Pixelate",
    category: "texture",
    spatial: true,
    transformSource: false,
    code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 localUv = transformEffectUv(effectScreenUv());
  float field = effectFieldMask(localUv);
  float cells = mix(220.0, 18.0, amount);
  vec2 grid = vec2(cells, cells * resolution.y / resolution.x);
  vec2 blockUv = (floor(localUv * grid) + 0.5) / grid;
  return mix(color, sampleSource(textureUvFromEffectScreenUv(inverseTransformEffectUv(blockUv))), field);
}`,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
