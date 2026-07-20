import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  meshPatternNodeModuleParts,
  MeshPatternNodeModuleExports,
  meshPatternNodeProcess,
} from "./node-module.js?v=source-roi-view-3";

const manifest = Object.freeze({
    id: "meshPatterns",
    name: "2D Mesh Patterns",
    category: "pattern",
    runtime: timeParamRuntime("speed"),
    primaryParamIds: ["pattern", "drawMode", "scale", "density", "irregularity", "wireWidth", "palette", "colorCount", "baseColor"],
    detailParamIds: ["speed", "motion", "rotation", "offsetX", "offsetY", "fillOpacity", "wireOpacity", "seed", "colorB", "colorC", "colorD", "wireColor", "backgroundColor", "amount"],
    params: [
      createEnumParam("pattern", "Pattern", [
        "cells", "veins", "mountains", "soap", "cracks",
        "coral", "fabric", "rivers", "magnetic fields", "bone",
      ], "cells"),
      createEnumParam("drawMode", "Draw", ["fill", "wire", "fill + wire"], "fill + wire"),
      createNumberParam("scale", "Scale", { min: 1, max: 40, step: 0.01, defaultValue: 8, scale: "log" }),
      createNumberParam("density", "Density", { min: 0.25, max: 4, step: 0.01, defaultValue: 1 }),
      createNumberParam("irregularity", "Irregularity", { min: 0, max: 2, step: 0.01, defaultValue: 0.75 }),
      createNumberParam("wireWidth", "Wire width", { min: 0.25, max: 12, step: 0.01, defaultValue: 1.5, scale: "log" }),
      createNumberParam("fillOpacity", "Fill opacity", { min: 0, max: 1, step: 0.01, defaultValue: 0.82 }),
      createNumberParam("wireOpacity", "Wire opacity", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
      createNumberParam("rotation", "Rotation", { min: -3.14, max: 3.14, step: 0.01, defaultValue: 0 }),
      createNumberParam("offsetX", "Position X", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
      createNumberParam("offsetY", "Position Y", { min: -3, max: 3, step: 0.01, defaultValue: 0 }),
      createNumberParam("speed", "Speed", { min: 0, max: 3, step: 0.01, defaultValue: 0 }),
      createNumberParam("motion", "Motion", { min: 0, max: 2, step: 0.01, defaultValue: 0.35 }),
      createNumberParam("seed", "Seed", { min: 0, max: 1000, step: 1, defaultValue: 17 }),
      createEnumParam("palette", "Color harmony", ["custom", "analogous", "complementary", "triadic", "split complementary", "tetradic", "monochrome"], "triadic"),
      createNumberParam("colorCount", "Colors", { min: 2, max: 4, step: 1, defaultValue: 4 }),
      createColorParam("baseColor", "Base color", "#e34b7fff"),
      createColorParam("colorB", "Custom color 2", "#27c7c7ff"),
      createColorParam("colorC", "Custom color 3", "#f0c541ff"),
      createColorParam("colorD", "Custom color 4", "#45246dff"),
      createColorParam("wireColor", "Wire color", "#fff4d6ff"),
      createColorParam("backgroundColor", "Background", "#08070cff"),
      createNumberParam("amount", "Amount", { min: 0, max: 1, step: 0.01, defaultValue: 1 }),
    ],
  });

export const VisualComponent = defineGeneratorNode(manifest, null, {
  direct: false,
  process: meshPatternNodeProcess,
  exports: MeshPatternNodeModuleExports,
  parts: meshPatternNodeModuleParts(),
});
export default VisualComponent;
