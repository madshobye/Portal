import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "custom",
    name: "Custom",
    category: "user",
    runtime: ALWAYS_TIME_RUNTIME,
    defaultAmount: 0.5,
    code: null,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
