import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";

const manifest = Object.freeze({
    id: "screenShare",
    name: "Screen Share",
    category: "live",
    runtime: ALWAYS_TIME_RUNTIME,
    primaryParamIds: ["inputId", "fit", "mirrored"],
    params: [
      createTextParam("inputId", "Input", "", { ui: "screen-input", rows: 1 }),
      createEnumParam("fit", "Fit", ["contain", "cover", "stretch"], "contain"),
      createBooleanParam("mirrored", "Mirror", false),
    ],
  });

export const VisualComponent = defineGeneratorNode(manifest, null);
export default VisualComponent;
