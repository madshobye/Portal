import { createBooleanParam, createColorParam, createEnumParam, createNumberParam, createTextParam } from "../../shared/component-schema.js";
import { ALWAYS_TIME_RUNTIME, timeParamRuntime } from "../../shared/shader-component-common.js";
import { defineGeneratorNode } from "../../shared/visual-node-factory.js";
import {
  tileTextureNodeProcess,
} from "./runtime.js?v=source-roi-view-3";
import {
  defineSpecializedVisualCompound,
  MediaImageResourceNode,
  TileTextureToImageNode,
} from "../../shared/specialized-compound.js?v=tile-texture-semantic-1";

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
      createTextParam("imageId", "Image", ""),
      createEnumParam("tileAxis", "Tiling", ["both", "horizontal", "vertical"], "both"),
      createNumberParam("repeat", "Repeat", { min: 0.001, max: 64, step: 0.001, defaultValue: 1 }),
      createNumberParam("offsetX", "Offset X", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("offsetY", "Offset Y", { min: -1, max: 1, step: 0.01, defaultValue: 0 }),
      createNumberParam("scrollX", "Scroll X", { min: -2, max: 2, step: 0.01, defaultValue: 0 }),
      createNumberParam("scrollY", "Scroll Y", { min: -2, max: 2, step: 0.01, defaultValue: 0 }),
    ],
  });

const NativeVisualComponent = defineGeneratorNode(manifest, null, {
  direct: false,
  process: tileTextureNodeProcess,
  exports: {},
  parts: [],
});

export const VisualComponent = defineSpecializedVisualCompound(NativeVisualComponent, {
  compoundKind: "tile-texture",
  nativeRenderer: "output/specialized:tileTexture",
  nodes: [
    { id: "image", type: MediaImageResourceNode.id },
    { id: "render", type: TileTextureToImageNode.id, parameters: { providerId: "tile-texture-pass" } },
  ],
  connections: [
    { from: "image.image", to: "render.image", type: "media-image-resource" },
  ],
  output: "render.texture",
  parameterBindings: {
    image: [{ publicParameterId: "imageId", targetParameterId: "mediaId" }],
    render: ["tileAxis", "repeat", "offsetX", "offsetY", "scrollX", "scrollY", "renderQuality"],
  },
  parameterPresentation: {
    image: { hidden: true },
    render: { label: "Tile render", order: 10 },
  },
});
export default VisualComponent;
