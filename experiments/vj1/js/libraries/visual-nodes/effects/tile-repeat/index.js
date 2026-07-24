import { createEnumParam, createNumberParam } from "../../shared/component-schema.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
  id: "tileRepeat",
  name: "Tile Repeat",
  category: "texture",
  description: "Repeats any connected texture along one or both axes.",
  spatial: true,
  // Repetition is a coordinate field, not a post-composition color effect.
  // The containing Group transform therefore changes the repeated field while
  // the connected texture retains the same physical transform. Sampling back
  // through the placement matrix cancels that source placement exactly once.
  transformSource: false,
  runtime: {
    timeDependent: (params = {}) =>
      Math.abs(Number(params.scrollX) || 0) > 0.0001 ||
      Math.abs(Number(params.scrollY) || 0) > 0.0001,
    // A wrapped output region can sample any part of its input texture. Until
    // the compiler has a periodic ROI mapper, requesting the complete input is
    // the only contract that is pixel-equivalent to cropping a full render.
    roi: {
      mode: "full-frame",
      coordinateSpace: "full-frame",
      inputMapping: "periodic",
    },
  },
  params: [
    createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    createEnumParam("tileAxis", "Tiling", ["both", "horizontal", "vertical"], "both"),
    createNumberParam("repeat", "Repeat", { min: 0.001, max: 64, step: 0.001, defaultValue: 1 }),
    createNumberParam("offsetX", "Offset X", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
    createNumberParam("offsetY", "Offset Y", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
    createNumberParam("scrollX", "Scroll X", { min: -2, max: 2, step: 0.01, defaultValue: 0 }),
    createNumberParam("scrollY", "Scroll Y", { min: -2, max: 2, step: 0.01, defaultValue: 0 }),
  ],
  code: `
vec4 runEffect(vec2 uv, vec4 color) {
  vec2 fieldUv = transformEffectUv(effectScreenUv());
  vec2 repeatAmount = vec2(max(repeat, 0.001));
  if (tileAxis > 0.5 && tileAxis < 1.5) repeatAmount.y = 1.0;
  if (tileAxis >= 1.5) repeatAmount.x = 1.0;
  vec2 tileFieldUv = fract(
    fieldUv * repeatAmount +
    vec2(offsetX, offsetY) +
    vec2(scrollX, scrollY) * time
  );
  vec2 sourceUv = textureUvFromEffectScreenUv(inverseTransformEffectUv(tileFieldUv));
  return mix(color, sampleSource(sourceUv), amount);
}`,
});

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
