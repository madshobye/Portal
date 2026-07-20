import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "checker",
    name: "Checker",
    category: "utility",
    runtime: ALWAYS_TIME_RUNTIME,
  });

export const VisualComponent = defineGeneratorNode(manifest, null);
export default VisualComponent;
