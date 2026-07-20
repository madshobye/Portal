import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createRangePairParams } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, animatedSeedRuntime, noiseSeedParams } from "../../shared/shader-component-common.js";
import { defineEffectNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "custom",
    name: "Custom",
    category: "user",
    // User code may sample arbitrary coordinates or introduce stateful/global
    // math. Keep it correct by promoting a bounded Custom effect to the
    // full-frame path and clipping only its final result.
    runtime: Object.freeze({ ...ALWAYS_TIME_RUNTIME, roi: { mode: "full-frame", coordinateSpace: "full-frame" } }),
    defaultAmount: 0.5,
    code: null,
  });

export const VisualComponent = defineEffectNode(manifest);
export default VisualComponent;
