import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  tileTextureNodeModuleParts,
  tileTextureNodeProcess,
  TileTextureNodeModuleExports,
} from "./runtime.js?v=source-roi-view-3";

const manifest = Object.freeze({
    id: "tileTexture",
    name: "Tile Texture",
    category: "texture",
    runtime: {
      timeDependent: (params = {}) =>
        Math.abs(Number(params.scrollX) || 0) > 0.0001 ||
        Math.abs(Number(params.scrollY) || 0) > 0.0001,
    },
    params: [
      createEnumParam("tileAxis", "Tiling", ["both", "horizontal", "vertical"], "both"),
      createNumberParam("repeat", "Repeat", { min: 0.001, max: 64, step: 0.001, defaultValue: 1 }),
      createNumberParam("offsetX", "Offset X", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("offsetY", "Offset Y", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("scrollX", "Scroll X", { min: -2, max: 2, step: 0.01, defaultValue: 0 }),
      createNumberParam("scrollY", "Scroll Y", { min: -2, max: 2, step: 0.01, defaultValue: 0 }),
    ],
  });

export const VisualComponent = defineGeneratorNode(manifest, null, {
  direct: false,
  process: tileTextureNodeProcess,
  exports: TileTextureNodeModuleExports,
  parts: tileTextureNodeModuleParts(),
});
export default VisualComponent;
